// Stripe webhook for booking-request deposits.
//
// On `checkout.session.completed`, look up the booking_request by
// metadata.booking_request_id and call mark_deposit_paid_via_webhook,
// which is SECURITY DEFINER and idempotent — a retried delivery is a
// no-op once the row is past awaiting_deposit.
//
// Signature verification is done manually using Node `crypto` so we
// don't have to pull in the Stripe SDK. The algorithm matches what
// the SDK's `webhooks.constructEvent` does:
//   sig header  → "t=<ts>,v1=<hex>,..."
//   payload     → `${ts}.${rawBody}`
//   expected    → HMAC-SHA256(secret, payload), hex
// We reject if no v1 signature matches and (optionally) if the
// timestamp is too old.

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
  const parts = header.split(",").map(p => p.trim());
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
    try { candidateBuf = Buffer.from(candidate, "hex"); }
    catch { continue; }
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
    secret = env("STRIPE_DEPOSIT_WEBHOOK_SECRET");
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

  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;

  // We only care about completed Checkout Sessions for this flow.
  // Other event types (refund, dispute, etc.) are ignored for V1.
  if (evt?.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency claim — atomic. A duplicate replay returns false
  // and we short-circuit before any side effects.
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "booking_deposit",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      // Don't proceed if the dedupe write failed — better to let
      // Stripe retry than risk double-processing.
      console.error("[booking-deposit/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true, event_id: eventId }, { status: 200 });
    }
  }

  const session = evt?.data?.object;
  const requestId: string | undefined =
    session?.metadata?.booking_request_id ||
    session?.payment_intent_data?.metadata?.booking_request_id;
  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | undefined =
    typeof session?.payment_intent === "string" ? session.payment_intent : undefined;

  if (!requestId) {
    // Not one of ours — ack so Stripe doesn't retry forever.
    return NextResponse.json({ received: true, ignored: "no_booking_request_id" }, { status: 200 });
  }
  if (session?.payment_status && session.payment_status !== "paid") {
    return NextResponse.json({ received: true, ignored: `payment_status=${session.payment_status}` }, { status: 200 });
  }

  const { error: rpcErr } = await admin.rpc("mark_deposit_paid_via_webhook", {
    request_id_in: requestId,
    stripe_session_id_in: sessionId || null,
    stripe_payment_intent_in: paymentIntent || null,
  });
  if (rpcErr) {
    // Surface the error so Stripe retries — it's likely a transient DB
    // issue worth re-delivering.
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // No-show protection: record the saved card (off-session reusable) on
  // the connected account so the stylist can later charge a no-show fee
  // via /api/no-show-charge. Best-effort — never blocks the deposit ack.
  try {
    const acctId = typeof evt?.account === "string" ? evt.account : null;
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (acctId && paymentIntent && stripeSecret) {
      const piRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/${paymentIntent}?expand[]=payment_method`,
        {
          headers: {
            Authorization: `Bearer ${stripeSecret}`,
            "Stripe-Version": "2024-06-20",
            "Stripe-Account": acctId,
          },
          cache: "no-store",
        },
      );
      if (piRes.ok) {
        const pi = await piRes.json();
        const pm = pi?.payment_method;
        const pmId = typeof pm === "string" ? pm : pm?.id || null;
        const card = pm && typeof pm === "object" ? pm.card : null;
        const cust =
          (typeof session?.customer === "string" ? session.customer : null) ||
          (typeof pi?.customer === "string" ? pi.customer : null);
        const patch: Record<string, unknown> = {};
        if (cust) patch.stripe_customer_id = cust;
        if (pmId) patch.stripe_payment_method_id = pmId;
        if (card?.brand) patch.nshow_card_brand = card.brand;
        if (card?.last4) patch.nshow_card_last4 = card.last4;
        if (Object.keys(patch).length > 0) {
          await admin.from("booking_requests").update(patch).eq("id", requestId);
        }
      }
    }
  } catch (e) {
    console.warn("[booking-deposit/webhook] no-show card capture failed:", e);
  }

  // Best-effort: enqueue the "deposit received — your appointment is
  // confirmed" email. The RPC's idempotency contract means this only
  // runs after a successful state transition, and queue_notification
  // dedupes on `deposit_received:<request_id>` so a Stripe replay
  // can't double-send.
  try {
    const { data: br } = await admin
      .from("booking_requests")
      .select("user_id, client_email, client_name, service_name_snapshot, service_name, preferred_date, preferred_time")
      .eq("id", requestId)
      .maybeSingle();
    if (br?.client_email) {
      const { data: studio } = await admin
        .rpc("public_get_studio_name", { user_id_in: br.user_id });
      await admin.rpc("queue_notification", {
        user_id_in: br.user_id,
        channel_in: "email",
        notification_type_in: "deposit_received",
        body_in: "Deposit received — your appointment is confirmed.",
        subject_in: "Deposit received — your appointment is confirmed",
        recipient_email_in: br.client_email,
        recipient_name_in: br.client_name || null,
        payload_in: {
          clientName: br.client_name || "there",
          studioName: (typeof studio === "string" && studio.trim()) ? studio.trim() : "your stylist",
          serviceName: br.service_name_snapshot || br.service_name || null,
          preferredDate: br.preferred_date || null,
          preferredTime: br.preferred_time || null,
        },
        dedupe_key_in: `deposit_received:${requestId}`,
        booking_request_id_in: requestId,
      });
    }
  } catch (e) {
    // Email enqueue failure is non-fatal — the row is already paid.
    console.warn("[booking-deposit/webhook] email enqueue failed:", e);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
