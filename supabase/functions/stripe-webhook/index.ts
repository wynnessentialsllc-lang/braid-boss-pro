// Edge Function: stripe-webhook
//
// Receives Stripe webhook events from the Stripe-side endpoint
// configured at https://<project>.functions.supabase.co/stripe-webhook
//
// Required secrets:
//   STRIPE_SECRET_KEY      — same secret key used by the API
//   STRIPE_WEBHOOK_SECRET  — whsec_… from the Stripe webhook console
// Auto-provided:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Events we care about (configure these in the Stripe webhook):
//   checkout.session.completed    — flips profiles.is_pro_user = true
//   checkout.session.async_payment_succeeded  — same handler (rare)
//   checkout.session.expired      — no-op (logged for observability)
//
// Idempotency: setting is_pro_user = true is idempotent. Stripe may
// retry a webhook on transient failure; the upsert is safe to run
// multiple times. We also write stripe_checkout_session_id so a
// future reconciliation job can detect duplicates.

// deno-lint-ignore-file no-explicit-any
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@14.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-09-30.acacia" as any,
  httpClient: Stripe.createFetchHttpClient(),
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const upgradeUserToPro = async (
  admin: ReturnType<typeof createClient>,
  userId: string,
  session: Stripe.Checkout.Session,
): Promise<{ ok: boolean; error?: string }> => {
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  // Use UPDATE first (preserves any existing row contents like
  // full_name); fall back to INSERT if no row exists. UPSERT with
  // onConflict on `id` would also work but loses non-pro fields if
  // they weren't included in the upsert payload.
  const { data: existing } = await admin
    .from("profiles")
    .select("id, is_pro_user")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.is_pro_user) {
      // Already pro; idempotent return. Still touch the session id
      // so we have a record of which session granted access.
      await admin
        .from("profiles")
        .update({
          stripe_customer_id: customerId,
          stripe_checkout_session_id: session.id,
        })
        .eq("id", userId);
      return { ok: true };
    }
    const { error } = await admin
      .from("profiles")
      .update({
        is_pro_user: true,
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        upgraded_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error: insertErr } = await admin.from("profiles").insert({
    id: userId,
    is_pro_user: true,
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
    upgraded_at: new Date().toISOString(),
  });
  if (insertErr) return { ok: false, error: insertErr.message };
  return { ok: true };
};

const handleCheckoutCompleted = async (
  admin: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
): Promise<{ ok: boolean; error?: string }> => {
  // Prefer metadata.user_id (the spec's authoritative field).
  // Fall back to client_reference_id which we set as a backup.
  // If both are missing we try the customer email lookup as a
  // last-resort recovery path.
  const userId =
    session.metadata?.user_id ||
    session.client_reference_id ||
    null;

  if (userId) {
    return await upgradeUserToPro(admin, userId, session);
  }

  const email = session.customer_details?.email || session.customer_email;
  if (!email) {
    console.error("[stripe-webhook] session has no user_id, client_reference_id, or email", session.id);
    return { ok: false, error: "no user identifier on session" };
  }

  // Email fallback: list users (paged) to find a match. This is
  // best-effort; it's only reached if both metadata.user_id and
  // client_reference_id were dropped, which shouldn't happen with
  // create-checkout-session in front of every payment.
  const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) return { ok: false, error: listErr.message };
  const match = usersPage.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
  if (!match) {
    console.error("[stripe-webhook] no user matches email", email);
    return { ok: false, error: "no user matches checkout email" };
  }
  return await upgradeUserToPro(admin, match.id, session);
};

const handle = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return json(500, { error: "stripe env missing" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "supabase env missing" });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json(400, { error: "missing stripe-signature header" });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[stripe-webhook] signature verification failed:", msg);
    return json(400, { error: "invalid signature", detail: msg });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Only mark paid sessions. async_payment_succeeded is paid by
      // definition; checkout.session.completed may fire with an
      // unpaid session for one-off methods that need async settling.
      if (session.payment_status !== "paid") {
        console.info("[stripe-webhook] session not paid yet, ignoring", session.id, session.payment_status);
        break;
      }
      const result = await handleCheckoutCompleted(admin, session);
      if (!result.ok) {
        console.error("[stripe-webhook] upgrade failed:", result.error);
        // 500 makes Stripe retry. Idempotent so retries are safe.
        return json(500, { error: "upgrade failed", detail: result.error });
      }
      break;
    }
    case "checkout.session.expired":
      console.info("[stripe-webhook] session expired:", (event.data.object as any).id);
      break;
    default:
      // Acknowledge other events without action so Stripe stops
      // retrying. Log so we can see what's coming through.
      console.info("[stripe-webhook] unhandled event:", event.type);
  }

  return json(200, { received: true });
};

Deno.serve(async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] unhandled:", msg);
    return json(500, { error: "internal error", detail: msg });
  }
});
