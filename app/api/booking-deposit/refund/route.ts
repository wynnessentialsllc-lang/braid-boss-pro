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
      "id, user_id, approval_status, status, deposit_paid, paid_in_full, amount_paid, payment_status, deposit_amount, stripe_payment_intent_id, stripe_connect_account_id, client_name, client_email, service_name, service_name_snapshot, preferred_date, preferred_time, denied_email_sent_at, refund_email_sent_at, refund_manual_email_sent_at",
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

  // ---- Client-facing denial / refund email (idempotent) ----------
  // Atomically claim the matching one-shot column (UPDATE ... WHERE
  // col IS NULL) before enqueueing, so a re-deny / Stripe retry /
  // double-click can't duplicate the email. Uses the existing
  // notification_queue + Resend worker — no second email system.
  try {
    const clientEmail = (reqRow.client_email || "").trim();
    const serviceName = reqRow.service_name || reqRow.service_name_snapshot || null;
    let studioName: string | null = null;
    try {
      const { data: sn } = await admin.rpc("public_get_studio_name", { user_id_in: user.id });
      studioName = typeof sn === "string" && sn.trim() ? sn.trim() : null;
    } catch { /* studio name is best-effort */ }

    const claimFlag = async (
      col: "denied_email_sent_at" | "refund_email_sent_at" | "refund_manual_email_sent_at",
    ): Promise<boolean> => {
      const { data } = await admin
        .from("booking_requests")
        .update({ [col]: new Date().toISOString() })
        .eq("id", requestId)
        .eq("user_id", user.id)
        .is(col, null)
        .select("id")
        .maybeSingle();
      return !!data;
    };

    const basePayload = {
      clientName: reqRow.client_name || "there",
      studioName: studioName || "your stylist",
      serviceName,
      preferredDate: reqRow.preferred_date || null,
      preferredTime: reqRow.preferred_time || null,
    };

    if (disposition === "no_charge" && clientEmail) {
      if (await claimFlag("denied_email_sent_at")) {
        await admin.rpc("queue_notification", {
          user_id_in: user.id,
          channel_in: "email",
          notification_type_in: "booking_denied_no_charge",
          body_in: "Your booking request was not approved by the stylist. No payment was collected.",
          subject_in: "Booking request update — Braid Boss Pro",
          recipient_email_in: clientEmail,
          recipient_name_in: reqRow.client_name || null,
          payload_in: basePayload,
          dedupe_key_in: `booking_denied:${requestId}`,
          booking_request_id_in: requestId,
        });
      }
    } else if (disposition === "refunded" && clientEmail) {
      const wasPaidInFull = !!reqRow.paid_in_full;
      if (await claimFlag("refund_email_sent_at")) {
        await admin.rpc("queue_notification", {
          user_id_in: user.id,
          channel_in: "email",
          notification_type_in: "booking_denied_refunded",
          body_in: wasPaidInFull
            ? "Your booking request was not approved. Your payment has been refunded."
            : "Your booking request was not approved. Your deposit has been refunded.",
          subject_in: "Booking request refunded — Braid Boss Pro",
          recipient_email_in: clientEmail,
          recipient_name_in: reqRow.client_name || null,
          payload_in: {
            ...basePayload,
            refundAmount: refundedAmount ?? (Number(reqRow.amount_paid) || Number(reqRow.deposit_amount) || null),
            paidInFull: wasPaidInFull,
          },
          dedupe_key_in: `booking_denied:${requestId}`,
          booking_request_id_in: requestId,
        });
      }
    } else if (disposition === "refund_failed_manual") {
      if (await claimFlag("refund_manual_email_sent_at")) {
        if (clientEmail) {
          await admin.rpc("queue_notification", {
            user_id_in: user.id,
            channel_in: "email",
            notification_type_in: "booking_denied_refund_manual",
            body_in: "Your booking request was not approved. The stylist has been notified to review your deposit refund manually.",
            subject_in: "Booking request update — Braid Boss Pro",
            recipient_email_in: clientEmail,
            recipient_name_in: reqRow.client_name || null,
            payload_in: basePayload,
            dedupe_key_in: `booking_denied:${requestId}`,
            booking_request_id_in: requestId,
          });
        }
        // Stylist/admin: manual refund needed — clear, actionable.
        // Resolve the stylist email SERVER-SIDE via queue_stylist_email_alert.
        // admin.auth.admin.getUserById returns no email in this runtime, so the
        // old `if (stylistEmail)` guard silently dropped this critical
        // "manual refund needed" alert every time. Isolated in its own try.
        try {
          await admin.rpc("queue_stylist_email_alert", {
            user_id_in: user.id,
            notification_type_in: "booking_refund_manual_stylist",
            subject_in: "Action needed: manual deposit refund — Braid Boss Pro",
            body_in: "Manual refund needed: a denied booking's deposit could not be auto-refunded.",
            payload_in: {
              clientName: reqRow.client_name || "the client",
              serviceName,
              preferredDate: reqRow.preferred_date || null,
              preferredTime: reqRow.preferred_time || null,
              depositAmount: Number(reqRow.deposit_amount) || null,
              reason: failure || "refund_failed",
            },
            dedupe_key_in: `booking_refund_manual_stylist:${requestId}`,
            booking_request_id_in: requestId,
          });
        } catch (e) {
          console.warn("[booking-deposit/refund] stylist alert enqueue failed:", e);
        }
      }
    }
  } catch (e: any) {
    // Email is best-effort — never fail the denial because of it.
    console.error("[booking-deposit/refund] denial email enqueue failed:", e?.message || e);
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
