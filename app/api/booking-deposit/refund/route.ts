// POST /api/booking-deposit/refund
//
// Deny a booking request AND make the money correct. SQL can't call
// Stripe, so the refund is issued here, then deny_booking_request
// records the disposition:
//
//   * no_charge            — nothing was ever collected; just deny.
//   * refunded             — Stripe refund succeeded; amount + ids
//                            persisted on the booking_request.
//   * refund_failed_manual — a deposit WAS collected but the Stripe
//                            refund failed; the request is still
//                            denied but flagged so the stylist sees
//                            it needs a manual refund in Stripe.
//
// Mirrors /api/cancel-appointment's auth + Stripe Connect refund
// pattern (Bearer JWT → owner; refund on the connected account).
// The request is ALWAYS denied even if the refund fails, so it never
// gets stuck in the approval queue.

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

type RefundAttempt =
  | { ok: true; refundId: string; amount: number }
  | { ok: false; error: string };

const refundIntent = async (
  stripeSecret: string,
  accountId: string,
  paymentIntentId: string,
): Promise<RefundAttempt> => {
  try {
    const params = new URLSearchParams();
    params.set("payment_intent", paymentIntentId);
    params.set("reason", "requested_by_customer");
    const res = await fetch(`${STRIPE_API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "content-type": "application/x-www-form-urlencoded",
        "Stripe-Account": accountId,
      },
      body: params.toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error?.message || `stripe_${res.status}` };
    }
    return {
      ok: true,
      refundId: String(body?.id || ""),
      amount: typeof body?.amount === "number" ? Math.round(body.amount) / 100 : 0,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network" };
  }
};

export async function POST(req: Request) {
  let body: { request_id?: string; reason?: string };
  try { body = await req.json(); }
  catch { return fail(400, "Invalid JSON body."); }

  const requestId = body?.request_id?.trim();
  if (!requestId) return fail(400, "Missing request_id.");
  const reason = (body?.reason || "").trim() || null;

  let stripeSecret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const auth = req.headers.get("authorization") || "";
  const tokenStr = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tokenStr) return fail(401, "Missing bearer token.");

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${tokenStr}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !user) return fail(401, "Invalid session.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: reqRow, error: readErr } = await admin
    .from("booking_requests")
    .select(
      "id, user_id, approval_status, status, deposit_paid, payment_status, deposit_amount, stripe_payment_intent_id, stripe_connect_account_id",
    )
    .eq("id", requestId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr || !reqRow) return fail(404, "Booking request not found.");

  // Was money actually collected? Either flag is sufficient.
  const depositCollected =
    !!reqRow.deposit_paid || reqRow.payment_status === "paid";
  const paymentIntentId = reqRow.stripe_payment_intent_id
    ? String(reqRow.stripe_payment_intent_id)
    : null;

  let disposition: "no_charge" | "refunded" | "refund_failed_manual";
  let refundedAmount: number | null = null;
  let refundIds: string[] | null = null;
  let failure: string | null = null;

  if (!depositCollected || !paymentIntentId) {
    disposition = "no_charge";
  } else {
    // Connected account the deposit was charged on. profiles is
    // canonical; the request row is a fallback.
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", user.id)
      .maybeSingle();
    const acctId =
      profile?.stripe_connect_account_id ||
      reqRow.stripe_connect_account_id ||
      null;

    if (!acctId) {
      disposition = "refund_failed_manual";
      failure = "no_connected_account";
    } else {
      const attempt = await refundIntent(stripeSecret, acctId, paymentIntentId);
      if (attempt.ok) {
        disposition = "refunded";
        refundedAmount = attempt.amount > 0
          ? attempt.amount
          : Number(reqRow.deposit_amount) || null;
        refundIds = attempt.refundId ? [attempt.refundId] : null;
      } else {
        disposition = "refund_failed_manual";
        failure = attempt.error;
      }
    }
  }

  // Always deny — even when the refund failed — so the request leaves
  // the queue and the disposition is recorded for reconciliation.
  const { data: denied, error: rpcErr } = await userClient.rpc("deny_booking_request", {
    request_id_in: requestId,
    reason_in: reason,
    deposit_disposition_in: disposition,
    refund_amount_in: refundedAmount,
    refund_ids_in: refundIds,
  });
  if (rpcErr) {
    console.error("[booking-deposit/refund] deny RPC failed:", rpcErr.message);
    return fail(500, rpcErr.message);
  }

  return NextResponse.json({
    ok: true,
    disposition,
    refunded: refundedAmount || 0,
    refund_ids: refundIds || [],
    failure,
    request: denied || null,
  });
}
