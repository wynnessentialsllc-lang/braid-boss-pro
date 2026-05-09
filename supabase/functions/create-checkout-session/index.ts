// Edge Function: create-checkout-session
//
// Server-side Stripe Checkout Session creation for the $9.99 Lifetime
// Access unlock. We do NOT use a plain Stripe Payment Link because we
// need to reliably bind the payment to the logged-in Supabase user
// via session.metadata.user_id; the webhook reads that field to flip
// profiles.is_pro_user.
//
// Required secrets (set via supabase secrets):
//   STRIPE_SECRET_KEY      — sk_live_… or sk_test_…
//   STRIPE_PRICE_ID        — price_… of the $9.99 lifetime product
//                            (optional; we fall back to creating an
//                            inline price_data of $9.99 if missing)
//   APP_PUBLIC_URL         — production site URL, e.g.
//                            https://braidbosspro.app (used for
//                            success_url / cancel_url)
//
// Auto-provided:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@14.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";
const APP_PUBLIC_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://braidbosspro.app").replace(/\/$/, "");

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

  if (!STRIPE_SECRET_KEY) return json(500, { error: "STRIPE_SECRET_KEY not configured" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "supabase env missing" });

  // Verify the JWT in-function so we know the real user_id. We
  // intentionally don't trust anything in the request body here.
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing bearer token" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !userResult?.user) return json(401, { error: "invalid session" });
  const user = userResult.user;

  // Already pro? Don't bother charging — return a flag the client
  // uses to refresh their UI.
  const { data: profile } = await admin
    .from("profiles")
    .select("is_pro_user")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.is_pro_user) return json(200, { already_pro: true });

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-09-30.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Use a real Price if configured, otherwise inline price_data so
  // the function works as soon as STRIPE_SECRET_KEY is set even if
  // the operator hasn't created a Product/Price yet.
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = STRIPE_PRICE_ID
    ? { price: STRIPE_PRICE_ID, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 999,
          product_data: {
            name: "Braid Boss Pro · Lifetime Access",
            description: "One-time $9.99 unlock. Lifetime studio access. No subscriptions.",
          },
        },
      };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [lineItem],
      success_url: `${APP_PUBLIC_URL}/unlocked?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: APP_PUBLIC_URL,
      // Both metadata.user_id (the spec's preferred field) and
      // client_reference_id (Stripe's standard hook) — the webhook
      // reads metadata.user_id first and falls back gracefully.
      metadata: { user_id: user.id, source: "bbp_lifetime" },
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      allow_promotion_codes: true,
      // 30 minutes is plenty for a one-page checkout. Expiring
      // earlier is one less stale URL floating around if someone
      // shares it.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[create-checkout-session] stripe error:", msg);
    return json(502, { error: "checkout creation failed", detail: msg });
  }

  if (!session.url) return json(502, { error: "checkout has no url" });

  return json(200, { url: session.url, session_id: session.id });
};

Deno.serve(async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[create-checkout-session] unhandled:", msg);
    return json(500, { error: "internal error", detail: msg });
  }
});
