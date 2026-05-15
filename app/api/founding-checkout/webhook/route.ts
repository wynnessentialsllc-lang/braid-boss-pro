// Stripe webhook for Founding Stylist Access payments.
//
// Listens for checkout.session.completed on the PLATFORM Stripe
// account (not a Connect account). On a successful payment:
//   1. Verifies the Stripe signature (manual HMAC-SHA256 — same
//      pattern as booking-deposit + product-checkout webhooks).
//   2. Dedupes via record_stripe_webhook_event so a Stripe replay
//      doesn't double-process.
//   3. Calls mark_founding_order_paid which flips the
//      founding_access_orders row to 'paid' and, if the customer's
//      email already matches a registered Supabase user, claims
//      the order immediately by stamping
//      profiles.founding_access = true.
//
// The complementary signup-time path is claim_founding_access_for_user,
// called from the app after a user signs up — that handles the
// inverse case where the customer pays BEFORE creating their account.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 5 * 60;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const verifySignature = (
  rawBody: string,
  header: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string } => {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",").map((p) => p.trim());
  let ts: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t" && v) ts = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  if (!ts || v1.length === 0) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp out of tolerance" };
  }
  const payload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    let candidateBuf: Buffer;
    try { candidateBuf = Buffer.from(candidate, "hex"); } catch { continue; }
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    // Fallback chain: dedicated founding secret → deposit secret.
    // Most deployments will start with a single Stripe webhook
    // endpoint serving all events; the dedicated secret env var is
    // available when you split endpoints in the Stripe dashboard.
    secret =
      process.env.STRIPE_FOUNDING_WEBHOOK_SECRET ||
      env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");
  const verify = verifySignature(rawBody, sigHeader, secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 400 });
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // We handle two event families:
  //   checkout.session.completed — flips orders to paid + claims them.
  //   charge.refunded            — stamps the order as refunded for
  //                                admin reconciliation. We deliberately
  //                                do NOT revoke founding access here;
  //                                see mark_founding_order_refunded for
  //                                the rationale.
  const handledTypes = new Set(["checkout.session.completed", "charge.refunded"]);
  if (!handledTypes.has(evt?.type)) {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Dedupe — shared with other webhooks via the existing
  // record_stripe_webhook_event RPC. Using a distinct endpoint name
  // keeps founding events from colliding with booking/product
  // events that share an event id namespace.
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "founding_checkout",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      console.error("[founding-checkout/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  // Refund branch — charge.refunded fires on the Charge, not a
  // Checkout Session, so we look the order up by payment_intent.
  if (evt.type === "charge.refunded") {
    const charge = evt?.data?.object;
    const paymentIntent: string | undefined =
      typeof charge?.payment_intent === "string" ? charge.payment_intent : undefined;
    const chargeMeta = charge?.metadata || {};
    // Only act when this charge was tagged as founding access (we set
    // payment_intent_data[metadata][purpose] at session creation).
    if (chargeMeta?.purpose !== "founding_stylist_access") {
      return NextResponse.json({ received: true, ignored: "not_founding_purpose" }, { status: 200 });
    }
    if (!paymentIntent) {
      return NextResponse.json({ received: true, ignored: "no_payment_intent" }, { status: 200 });
    }
    const refundSummary = {
      amount_refunded: typeof charge?.amount_refunded === "number" ? charge.amount_refunded : null,
      currency: typeof charge?.currency === "string" ? charge.currency : null,
      refunded: charge?.refunded === true,
      charge_id: typeof charge?.id === "string" ? charge.id : null,
      reason:
        Array.isArray(charge?.refunds?.data) && charge.refunds.data[0]?.reason
          ? charge.refunds.data[0].reason
          : null,
    };
    const { error: refundErr } = await admin.rpc("mark_founding_order_refunded", {
      session_id_in: null,
      payment_intent_in: paymentIntent,
      refund_metadata_in: refundSummary,
    });
    if (refundErr) {
      return NextResponse.json({ error: refundErr.message }, { status: 500 });
    }
    return NextResponse.json({ received: true, refunded: true }, { status: 200 });
  }

  const session = evt?.data?.object;
  const meta = session?.metadata || {};

  // Only handle sessions explicitly marked as founding access.
  // Booking + product webhooks set their own metadata.purpose flags,
  // so we ignore those here.
  if (meta?.purpose !== "founding_stylist_access") {
    return NextResponse.json({ received: true, ignored: "not_founding_purpose" }, { status: 200 });
  }
  if (session?.payment_status && session.payment_status !== "paid") {
    return NextResponse.json(
      { received: true, ignored: `payment_status=${session.payment_status}` },
      { status: 200 },
    );
  }

  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | undefined =
    typeof session?.payment_intent === "string" ? session.payment_intent : undefined;
  const customerEmail: string | null =
    (typeof session?.customer_details?.email === "string" && session.customer_details.email) ||
    (typeof session?.customer_email === "string" && session.customer_email) ||
    null;
  const amountTotalCents: number | null =
    typeof session?.amount_total === "number" ? session.amount_total : null;

  const { error: rpcErr } = await admin.rpc("mark_founding_order_paid", {
    session_id_in: sessionId || null,
    payment_intent_in: paymentIntent || null,
    customer_email_in: customerEmail,
    amount_total_cents_in: amountTotalCents,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
