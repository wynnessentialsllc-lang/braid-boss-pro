// Edge Function: verify-checkout-session
//
// Defense-in-depth for the /unlocked page. Asks Stripe directly
// "did this session_id complete and was it paid?" — and if so, also
// flips profiles.is_pro_user as a safety net in case the webhook
// hasn't fired yet (or Stripe couldn't reach it).
//
// Required secrets:
//   STRIPE_SECRET_KEY
// Auto-provided:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@14.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const handle = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "server misconfigured" });
  }

  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing bearer token" });

  let body: { session_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const sessionId = body.session_id;
  if (!sessionId || !/^cs_/.test(sessionId)) return json(400, { error: "session_id required" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !userResult?.user) return json(401, { error: "invalid session" });
  const user = userResult.user;

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-09-30.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(),
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[verify-checkout-session] stripe error:", msg);
    return json(404, { error: "session not found", detail: msg });
  }

  // The session must belong to THIS user. Without this check, a
  // user could pass a different session_id and inherit another
  // person's payment.
  const sessionUserId = session.metadata?.user_id || session.client_reference_id || null;
  if (sessionUserId && sessionUserId !== user.id) {
    return json(403, { error: "session does not belong to this user" });
  }

  const paid = session.payment_status === "paid";
  if (!paid) {
    return json(200, {
      session_id: session.id,
      paid: false,
      payment_status: session.payment_status,
      already_pro: false,
    });
  }

  // Backfill: if the webhook hasn't fired or failed to fire, flip
  // is_pro_user here as the safety net. Idempotent.
  const { data: existing } = await admin
    .from("profiles")
    .select("id, is_pro_user")
    .eq("id", user.id)
    .maybeSingle();

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  if (existing) {
    if (!existing.is_pro_user) {
      await admin
        .from("profiles")
        .update({
          is_pro_user: true,
          stripe_customer_id: customerId,
          stripe_checkout_session_id: session.id,
          upgraded_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    }
  } else {
    await admin.from("profiles").insert({
      id: user.id,
      is_pro_user: true,
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      upgraded_at: new Date().toISOString(),
    });
  }

  return json(200, {
    session_id: session.id,
    paid: true,
    payment_status: session.payment_status,
    already_pro: !!existing?.is_pro_user,
  });
};

Deno.serve(async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[verify-checkout-session] unhandled:", msg);
    return json(500, { error: "internal error", detail: msg });
  }
});
