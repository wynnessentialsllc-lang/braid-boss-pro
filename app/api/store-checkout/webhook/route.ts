// Stripe webhook for Braid Boss Pro Store checkouts.
//
// On `checkout.session.completed` (and the async-payment success event,
// for delayed methods), look the order up by metadata.store_order_id (or
// stripe_session_id) and hand it to fulfillStoreOrder — which flips it to
// 'paid' and sends the download email exactly once. The success-page
// confirm (/api/store-order) shares that same fulfillment path, so
// whichever fires first delivers and the other is a no-op.
//
// Signature verification is the same manual HMAC-SHA256 used across the
// other webhooks (no Stripe SDK). Uses its own secret,
// STRIPE_STORE_WEBHOOK_SECRET, falling back to the product/deposit
// secrets for single-endpoint deployments.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { fulfillStoreOrder, storeBaseUrl } from "../../../lib/store-fulfillment";

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
    try {
      candidateBuf = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

// Events that mean "the money is in": the synchronous card path and the
// async settle (bank debits, some wallets) both fulfill.
const PAID_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    secret =
      process.env.STRIPE_STORE_WEBHOOK_SECRET ||
      process.env.STRIPE_PRODUCT_WEBHOOK_SECRET ||
      env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const verify = verifySignature(rawBody, req.headers.get("stripe-signature"), secret);
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: 400 });

  let evt: any;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!PAID_EVENTS.has(evt?.type)) {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency: claim the event id before doing side-effect work. A
  // redelivery returns early. (fulfillStoreOrder is itself idempotent, so
  // this is belt-and-suspenders, but it keeps duplicate emails impossible
  // even under concurrent redelivery.)
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "store_checkout",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      console.error("[store-checkout/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  const session = evt?.data?.object || {};
  const meta = session?.metadata || {};
  const orderId: string | null =
    (typeof meta?.store_order_id === "string" && meta.store_order_id) || null;
  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | null =
    typeof session?.payment_intent === "string" ? session.payment_intent : null;
  const buyerEmail: string | null =
    (session?.customer_details?.email as string) ||
    (session?.customer_email as string) ||
    null;
  const buyerName: string | null = (session?.customer_details?.name as string) || null;

  // Resolve the order by id (preferred) or session id (fallback).
  let resolvedId = orderId;
  if (!resolvedId && sessionId) {
    const { data: row } = await admin
      .from("store_orders")
      .select("id")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();
    resolvedId = row?.id ?? null;
  }
  if (!resolvedId) {
    // Not one of ours (or metadata missing) — ack so Stripe stops retrying.
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  try {
    const result = await fulfillStoreOrder(admin, {
      orderId: resolvedId,
      baseUrl: storeBaseUrl(req),
      paymentIntent,
      buyerEmail,
      buyerName,
    });
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (e: any) {
    console.error("[store-checkout/webhook] fulfillment error:", e?.message || e);
    // 500 so Stripe retries — the order may not be delivered yet.
    return NextResponse.json({ error: "fulfillment failed" }, { status: 500 });
  }
}
