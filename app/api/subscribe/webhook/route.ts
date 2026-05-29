// Stripe webhook for the Braid Boss Pro monthly subscription.
//
// Mirrors /api/founding-checkout/webhook: manual HMAC-SHA256 signature
// verification + record_stripe_webhook_event dedupe. Keeps the
// subscription lifecycle mirrored onto profiles via two RPCs:
//   • start_subscription_for_user   — on checkout.session.completed,
//     binds customer + subscription ids to the user (from
//     client_reference_id) and records the initial (trialing) status.
//   • apply_subscription_status     — on customer.subscription.*,
//     updates status / period end / cancel flag, matched by
//     subscription or customer id.
//
// We never revoke lifetime_access / founding_access here — grandfathered
// access is independent of subscription state.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
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

const toTs = (epochSeconds: unknown): string | null => {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
};

// Retrieve a subscription so checkout.session.completed can record the
// accurate status + current_period_end without waiting for the
// customer.subscription.* event.
const retrieveSubscription = async (
  stripeSecret: string,
  subscriptionId: string,
): Promise<any | null> => {
  try {
    const res = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": "2024-06-20",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  let stripeSecret: string;
  try {
    // Dedicated subscription secret preferred; fall back to the shared
    // webhook secret when a single endpoint serves all events.
    secret =
      process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET ||
      env("STRIPE_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    stripeSecret = env("STRIPE_SECRET_KEY");
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

  const handledTypes = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (!handledTypes.has(evt?.type)) {
    return NextResponse.json({ received: true, ignored: evt?.type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Dedupe — distinct endpoint name keeps subscription events out of
  // the founding/booking/product namespaces.
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc(
      "record_stripe_webhook_event",
      {
        event_id_in: eventId,
        event_type_in: evt.type,
        endpoint_in: "subscription",
        account_id_in: typeof evt?.account === "string" ? evt.account : null,
      },
    );
    if (dedupeErr) {
      console.error("[subscribe/webhook] dedupe failed:", dedupeErr.message);
      return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    }
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  // ---- checkout.session.completed (subscription mode) --------------
  if (evt.type === "checkout.session.completed") {
    const session = evt?.data?.object;
    const meta = session?.metadata || {};
    if (session?.mode !== "subscription" || meta?.purpose !== "subscription") {
      return NextResponse.json({ received: true, ignored: "not_subscription" }, { status: 200 });
    }
    const userId: string | null =
      (typeof session?.client_reference_id === "string" && session.client_reference_id) ||
      (typeof meta?.user_id === "string" && meta.user_id) ||
      null;
    const customerId: string | null = typeof session?.customer === "string" ? session.customer : null;
    const subscriptionId: string | null =
      typeof session?.subscription === "string" ? session.subscription : null;
    if (!userId) {
      return NextResponse.json({ received: true, ignored: "no_user_ref" }, { status: 200 });
    }

    // Retrieve the subscription for accurate status + period end.
    let status = "trialing";
    let periodEnd: string | null = null;
    let cancelAtPeriodEnd = false;
    if (subscriptionId) {
      const sub = await retrieveSubscription(stripeSecret, subscriptionId);
      if (sub) {
        status = typeof sub.status === "string" ? sub.status : status;
        periodEnd = toTs(sub.current_period_end);
        cancelAtPeriodEnd = sub.cancel_at_period_end === true;
      }
    }

    const { error } = await admin.rpc("start_subscription_for_user", {
      user_id_in: userId,
      customer_id_in: customerId,
      subscription_id_in: subscriptionId,
      status_in: status,
      current_period_end_in: periodEnd,
      cancel_at_period_end_in: cancelAtPeriodEnd,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ---- customer.subscription.created / updated / deleted -----------
  const sub = evt?.data?.object;
  const subscriptionId: string | null = typeof sub?.id === "string" ? sub.id : null;
  const customerId: string | null = typeof sub?.customer === "string" ? sub.customer : null;
  // On deletion Stripe still reports the final status ('canceled').
  const status: string | null = typeof sub?.status === "string" ? sub.status : null;
  const periodEnd = toTs(sub?.current_period_end);
  const cancelAtPeriodEnd = sub?.cancel_at_period_end === true;

  if (!status || (!subscriptionId && !customerId)) {
    return NextResponse.json({ received: true, ignored: "incomplete_subscription" }, { status: 200 });
  }

  const { error } = await admin.rpc("apply_subscription_status", {
    customer_id_in: customerId,
    subscription_id_in: subscriptionId,
    status_in: status,
    current_period_end_in: periodEnd,
    cancel_at_period_end_in: cancelAtPeriodEnd,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
