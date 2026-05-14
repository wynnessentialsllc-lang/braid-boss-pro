// Stripe webhook for product-checkout sessions.
//
// On `checkout.session.completed`, look the order up by
// metadata.product_order_id (or fall back to stripe_session_id) and
// flip it to 'paid' via mark_product_order_paid — a SECURITY DEFINER
// RPC that also decrements inventory_count for any tracked products
// in the line_items jsonb.
//
// Signature verification matches the booking-deposit webhook's
// manual HMAC-SHA256 implementation so we don't pull in the Stripe
// SDK.

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
  if (!ts || v1.length === 0)
    return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp out of tolerance" };
  }
  const payload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (
      candidateBuf.length === expectedBuf.length &&
      timingSafeEqual(candidateBuf, expectedBuf)
    ) {
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
    // Falls back to the deposit secret so single-endpoint deployments
    // (one Stripe webhook endpoint configured for both event sources)
    // still verify. Set STRIPE_PRODUCT_WEBHOOK_SECRET when you wire a
    // separate endpoint in the Stripe dashboard.
    secret =
      process.env.STRIPE_PRODUCT_WEBHOOK_SECRET ||
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
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (evt?.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "product_checkout",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      console.error("[product-checkout/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  const session = evt?.data?.object;
  const meta = session?.metadata || {};
  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | undefined =
    typeof session?.payment_intent === "string" ? session.payment_intent : undefined;

  // Not one of ours — booking deposit + product checkout share the
  // same dedupe table, so we must ignore events lacking our metadata
  // key rather than misroute them.
  if (!meta?.product_order_id) {
    return NextResponse.json({ received: true, ignored: "no_product_order_id" }, { status: 200 });
  }
  if (session?.payment_status && session.payment_status !== "paid") {
    return NextResponse.json(
      { received: true, ignored: `payment_status=${session.payment_status}` },
      { status: 200 },
    );
  }

  // Stripe surfaces total in cents on the session — convert to the
  // decimal the RPC stores.
  const amountTotal =
    typeof session?.amount_total === "number"
      ? Number((session.amount_total / 100).toFixed(2))
      : 0;

  const customerEmail: string | null =
    (typeof session?.customer_details?.email === "string" && session.customer_details.email) ||
    (typeof session?.customer_email === "string" && session.customer_email) ||
    null;
  const customerName: string | null =
    (typeof session?.customer_details?.name === "string" && session.customer_details.name) ||
    null;
  const shippingAddress = session?.shipping_details?.address || session?.customer_details?.address || null;

  const { data: marked, error: rpcErr } = await admin.rpc("mark_product_order_paid", {
    session_id_in: sessionId || null,
    payment_intent_in: paymentIntent || null,
    amount_total_in: amountTotal,
    customer_email_in: customerEmail,
    customer_name_in: customerName,
    shipping_address_in: shippingAddress,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  if (marked === false) {
    // No matching row — the pre-insert in the checkout route never
    // wrote the order (rare). Ack so Stripe doesn't retry forever.
    return NextResponse.json({ received: true, ignored: "no_matching_order" }, { status: 200 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
