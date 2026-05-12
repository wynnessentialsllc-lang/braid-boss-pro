// Stripe webhook for balance payments on connected accounts.
//
// Listens for checkout.session.completed events emitted by Stripe
// for sessions created via /api/balance-payment/checkout. The webhook
// is registered on the **platform** account with "Listen to events
// on Connected accounts" enabled in the Stripe dashboard, so
// connected-account events arrive here with evt.account set.
//
// Idempotency: record_stripe_webhook_event short-circuits replayed
// events. The RPC also short-circuits if balance_paid is already
// true, so even a multi-route replay won't double-credit.

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
    try { candidateBuf = Buffer.from(candidate, "hex"); }
    catch { continue; }
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

export async function POST(req: Request) {
  // Falls back to the deposit secret if a balance-specific secret isn't
  // configured, since both flows share one Stripe webhook endpoint on
  // the platform account (Connected accounts events).
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    secret = process.env.STRIPE_BALANCE_WEBHOOK_SECRET
      || process.env.STRIPE_DEPOSIT_WEBHOOK_SECRET
      || env("STRIPE_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const verify = verifySignature(rawBody, req.headers.get("stripe-signature"), secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 400 });
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  const eventType: string = evt?.type || "";
  const connectAccount: string | undefined = typeof evt?.account === "string" ? evt.account : undefined;

  // We only act on completed Checkout Sessions tagged as a balance
  // payment. Account / refund / other events are intentionally
  // ignored — the deposit webhook owns those flows.
  if (eventType !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: eventType }, { status: 200 });
  }
  const session = evt?.data?.object;
  const sessionType = session?.metadata?.type
    || session?.payment_intent_data?.metadata?.type
    || null;
  if (sessionType !== "balance_payment") {
    // Not ours — deposit webhook may pick it up. ACK so Stripe doesn't
    // retry forever.
    return NextResponse.json({ received: true, ignored: "non_balance_session" }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency claim — atomic.
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: eventType,
        endpoint_in: "balance_payment",
        account_id_in: connectAccount ?? null,
      },
    );
    if (dedupeErr) {
      console.error("[balance-payment/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true, event_id: eventId }, { status: 200 });
    }
  }

  const apptId: string | undefined =
    session?.metadata?.appointment_id
    || session?.payment_intent_data?.metadata?.appointment_id
    || session?.client_reference_id;
  const sessionId: string | undefined = session?.id;
  const paymentIntent: string | undefined =
    typeof session?.payment_intent === "string" ? session.payment_intent : undefined;
  const paymentStatus: string | undefined = session?.payment_status;
  const amountTotalCents: number | undefined =
    typeof session?.amount_total === "number" ? session.amount_total : undefined;

  if (!apptId) {
    return NextResponse.json({ received: true, ignored: "no_appointment_id" }, { status: 200 });
  }
  if (paymentStatus && paymentStatus !== "paid") {
    return NextResponse.json(
      { received: true, ignored: `payment_status=${paymentStatus}` },
      { status: 200 },
    );
  }

  const amount = typeof amountTotalCents === "number" && amountTotalCents > 0
    ? Math.round(amountTotalCents) / 100
    : null;

  const { data, error: rpcErr } = await admin.rpc("mark_balance_paid_via_webhook", {
    appt_id_in: apptId,
    stripe_session_id_in: sessionId || null,
    stripe_payment_intent_in: paymentIntent || null,
    amount_in: amount,
  });
  if (rpcErr) {
    console.error(
      `[balance-payment/webhook] RPC failed for ${apptId}: ${rpcErr.message}`,
    );
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  try {
    await admin.from("analytics_events").insert({
      event_name: "balance_payment_completed",
      event_category: "feature",
      metadata: { appt: apptId.slice(0, 8), amount_cents: amountTotalCents ?? null },
    });
  } catch { /* analytics best-effort */ }

  return NextResponse.json({ received: true, result: data }, { status: 200 });
}
