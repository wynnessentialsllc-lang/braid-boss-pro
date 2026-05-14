// Issue a Stripe refund for a product_orders row.
//
// Authorization
// -------------
// Owner-only: the caller must be the stylist who owns the order.
// We accept the user's Supabase JWT via the Authorization header,
// resolve auth.uid() with the anon client, and compare against the
// order's user_id. The refund itself is issued through Stripe with
// the platform secret key + Stripe-Account header (the connected
// account that received the original charge) so the refund debits
// the same balance.
//
// Duplicate-refund guard
// ----------------------
// Orders already in 'refunded' state are rejected with 409. We also
// pass an idempotency key to Stripe scoped to the order + amount, so
// a retried POST never double-refunds.
//
// After Stripe returns success we update the row through the
// existing mark_order_refunded RPC (security definer, also writable
// by service_role for the webhook path).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  let body: { order_id?: string; amount?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const orderId = (body?.order_id || "").trim();
  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return fail(400, "Missing or malformed order_id.");
  }
  // Optional partial amount in dollars (we'll convert to cents).
  // null / 0 / negative / NaN → full refund.
  const partialAmount = Number(body?.amount);
  const partialCents =
    Number.isFinite(partialAmount) && partialAmount > 0
      ? Math.round(partialAmount * 100)
      : null;
  const reason = (body?.reason || "").slice(0, 500).trim() || null;

  // Pull caller identity from the Authorization header.
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!bearer) return fail(401, "Missing auth.");

  let stripeSecret: string;
  let supabaseUrl: string;
  let anonKey: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env("SUPABASE_ANON_KEY");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  // Identify the caller via the anon client + their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return fail(401, "Invalid auth.");
  }
  const callerUserId = userData.user.id;

  // Service-role read for the order row so we don't rely on RLS for
  // a write-blocking transition. We still owner-check below.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderErr } = await admin
    .from("product_orders")
    .select(
      "id, user_id, stripe_account_id, stripe_payment_intent, amount_total, currency, status, fulfillment_status",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return fail(500, orderErr.message);
  if (!order) return fail(404, "Order not found.");
  if (order.user_id !== callerUserId) return fail(403, "Not your order.");
  if (order.status !== "paid") {
    return fail(409, `Can't refund — order is ${order.status}.`);
  }
  if (order.fulfillment_status === "refunded") {
    return fail(409, "Order is already refunded.");
  }
  if (!order.stripe_payment_intent) {
    return fail(409, "No Stripe payment to refund — this order wasn't charged through Stripe.");
  }
  if (!order.stripe_account_id) {
    return fail(409, "Connected account missing on the order row.");
  }

  // Refund amount: explicit partial or full (Stripe defaults to full
  // when 'amount' is omitted from the form body).
  const totalCents = Math.round(Number(order.amount_total || 0) * 100);
  const refundCents = partialCents
    ? Math.min(partialCents, totalCents)
    : null;
  if (partialCents && refundCents !== null && refundCents <= 0) {
    return fail(400, "Refund amount must be positive.");
  }

  const form = new URLSearchParams();
  form.set("payment_intent", String(order.stripe_payment_intent));
  if (refundCents !== null) form.set("amount", String(refundCents));
  if (reason) form.set("metadata[reason]", reason);
  form.set("metadata[product_order_id]", order.id);

  const idempotencyKey = `refund:${order.id}:${refundCents ?? "full"}`;

  const stripeRes = await fetch(`${STRIPE_API}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "Stripe-Account": String(order.stripe_account_id),
      "Idempotency-Key": idempotencyKey,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
    return fail(
      502,
      `Stripe rejected the refund (${stripeRes.status}). ${text.slice(0, 200)}`,
    );
  }
  const refund = (await stripeRes.json()) as {
    id?: string;
    amount?: number;
    status?: string;
  };
  if (!refund?.id) {
    return fail(502, "Stripe returned an unusable refund.");
  }

  const refundAmountDollars = refund.amount != null
    ? Number((refund.amount / 100).toFixed(2))
    : refundCents != null
      ? Number((refundCents / 100).toFixed(2))
      : Number(order.amount_total || 0);

  // Mark the order refunded via the existing RPC so the path is
  // exactly the same one a webhook would take. RPC is idempotent.
  const { error: rpcErr } = await admin.rpc("mark_order_refunded", {
    order_id_in: order.id,
    refund_id_in: refund.id,
    refund_amount_in: refundAmountDollars,
  });
  if (rpcErr) {
    // The Stripe refund did succeed — surface the DB error but the
    // money has moved. Stripe webhook (when wired) will reconcile.
    return fail(500, `Refund issued but couldn't update the order: ${rpcErr.message}`);
  }

  return NextResponse.json({
    ok: true,
    refund_id: refund.id,
    amount_refunded: refundAmountDollars,
    stripe_status: refund.status || null,
  });
}
