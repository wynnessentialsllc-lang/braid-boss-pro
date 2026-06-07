// POST /api/cancel-appointment
//
// Cancel a real appointment + refund any deposit / balance paid via
// Stripe Connect. Order of operations:
//
//   1. Auth: Bearer JWT must resolve to the appointment's owner.
//   2. Look up payment_intent_ids attached to this appointment:
//        - balance_payment_intent_id on the appointment row itself
//        - booking_requests.stripe_payment_intent_id (deposit), via
//          the appt's referenced booking_request_id when present
//   3. Call Stripe refunds API for each payment_intent on the
//      connected account (Stripe-Account header). Track success.
//   4. Call cancel_appointment RPC with the refund total + Stripe
//      refund IDs so the row is flipped to status='cancelled' and
//      the audit columns are populated.
//
// If Stripe refund fails partway, we still attempt to cancel the
// appointment with whatever did refund successfully and surface the
// partial result. The stylist sees what refunded and can chase the
// rest manually in the Stripe dashboard.

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
  | { ok: true; intent: string; refundId: string; amount: number }
  | { ok: false; intent: string; error: string };

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
      return { ok: false, intent: paymentIntentId, error: body?.error?.message || `stripe_${res.status}` };
    }
    return {
      ok: true,
      intent: paymentIntentId,
      refundId: String(body?.id || ""),
      amount: typeof body?.amount === "number" ? Math.round(body.amount) / 100 : 0,
    };
  } catch (e: any) {
    return { ok: false, intent: paymentIntentId, error: e?.message || "network" };
  }
};

export async function POST(req: Request) {
  let body: { appointment_id?: string; reason?: string; skip_refund?: boolean; notify_client?: boolean };
  try { body = await req.json(); }
  catch { return fail(400, "Invalid JSON body."); }

  const apptId = body?.appointment_id?.trim();
  if (!apptId) return fail(400, "Missing appointment_id.");
  const reason = (body?.reason || "").trim() || null;
  const skipRefund = !!body?.skip_refund;
  // Default to notifying (back-compat: callers that omit it still email).
  const notifyClient = body?.notify_client !== false;

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

  // Auth: resolve caller via Bearer JWT.
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(401, "Missing bearer token.");

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !user) return fail(401, "Invalid session.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look up the appointment. Service role so we can also reach the
  // related booking_requests row for the deposit payment_intent.
  const { data: appt, error: readErr } = await admin
    .from("appointments")
    .select("id, user_id, status, balance_payment_intent_id, data, client_email, client_name, style, appt_date, appt_time")
    .eq("id", apptId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr || !appt) return fail(404, "Appointment not found.");
  if (appt.status === "cancelled" || appt.status === "canceled") {
    return NextResponse.json({ ok: true, already_cancelled: true });
  }

  // Connected account for the refund — same one the deposit / balance
  // was charged on. profiles is the canonical source.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .maybeSingle();
  const acctId = profile?.stripe_connect_account_id || null;

  // Resolve every Stripe payment_intent linked to this booking.
  // Order: deposit (booking_request) first so a partial refund hits
  // the older charge; balance second.
  const intents: string[] = [];

  // Deposit — booking_request linked via the appt's `data` jsonb
  // (where the app stashes the originating booking_request_id when
  // an appointment was converted from a request).
  const bookingRequestId: string | null =
    (appt.data && typeof appt.data === "object" && (appt.data as any).bookingRequestId) || null;
  if (bookingRequestId) {
    const { data: br } = await admin
      .from("booking_requests")
      .select("stripe_payment_intent_id")
      .eq("id", bookingRequestId)
      .maybeSingle();
    if (br?.stripe_payment_intent_id) intents.push(String(br.stripe_payment_intent_id));
  }
  // Fallback: public-booking appointments don't always stash the
  // originating booking_request id in `data`, so the lookup above can
  // miss the deposit entirely (silently cancelling without refunding).
  // The booking_request row back-references the appointment, so resolve
  // the deposit intent that way too. De-dupe below collapses any overlap.
  {
    const { data: brByAppt } = await admin
      .from("booking_requests")
      .select("stripe_payment_intent_id")
      .eq("appointment_id", apptId)
      .eq("user_id", user.id)
      .not("stripe_payment_intent_id", "is", null);
    for (const r of brByAppt || []) {
      if (r?.stripe_payment_intent_id) intents.push(String(r.stripe_payment_intent_id));
    }
  }
  // Balance — direct on the appointment.
  if (appt.balance_payment_intent_id) intents.push(String(appt.balance_payment_intent_id));

  // De-dupe and skip refund entirely if the caller asked us to.
  const uniqueIntents = Array.from(new Set(intents));
  const attempts: RefundAttempt[] = [];
  if (!skipRefund && uniqueIntents.length > 0) {
    if (!acctId) {
      return fail(409, "Stylist's Stripe account isn't connected — can't issue a refund.");
    }
    for (const pi of uniqueIntents) {
      attempts.push(await refundIntent(stripeSecret, acctId, pi));
    }
  }

  const successful = attempts.filter((a): a is Extract<RefundAttempt, { ok: true }> => a.ok);
  const refundedAmount = successful.reduce((s, r) => s + r.amount, 0);
  const refundIds = successful.map((r) => r.refundId).filter(Boolean);

  // Flip the row to cancelled + record refund metadata. Even if
  // refunds partially failed, the appointment is still cancelled.
  const { error: rpcErr } = await userClient.rpc("cancel_appointment", {
    appt_id_in: apptId,
    reason_in: reason,
    refund_amount_in: refundedAmount > 0 ? refundedAmount : null,
    refund_ids_in: refundIds.length > 0 ? refundIds : null,
  });
  if (rpcErr) {
    console.error("[cancel-appointment] RPC failed:", rpcErr.message);
    return fail(500, rpcErr.message);
  }

  // Tell the client their appointment was cancelled (stylist-side
  // cancel previously emailed nobody on the client side). Best-effort
  // + idempotent via the dedupe key; never fails the cancel. Deposit
  // was refunded above where possible, so we don't claim forfeiture.
  const clientEmail = String(appt.client_email || "").trim();
  if (clientEmail && notifyClient) {
    try {
      let studioName = "your stylist";
      try {
        const { data: studio } = await admin.rpc("public_get_studio_name", { user_id_in: user.id });
        if (typeof studio === "string" && studio.trim()) studioName = studio.trim();
      } catch { /* studio name best-effort */ }
      await admin.rpc("queue_notification", {
        user_id_in: user.id,
        channel_in: "email",
        notification_type_in: "client_booking_cancelled",
        body_in: "Your appointment has been cancelled.",
        subject_in: "Your appointment was cancelled",
        recipient_email_in: clientEmail,
        recipient_name_in: appt.client_name || null,
        payload_in: {
          clientName: appt.client_name || "there",
          studioName,
          serviceName: appt.style || null,
          preferredDate: appt.appt_date || null,
          preferredTime: appt.appt_time || null,
          depositForfeited: false,
          depositAmount: refundedAmount > 0 ? refundedAmount : null,
        },
        dedupe_key_in: `client_booking_cancelled:appt:${apptId}`,
        appointment_id_in: apptId,
      });
    } catch (e: any) {
      console.warn("[cancel-appointment] client email enqueue failed:", e?.message || e);
    }
  }

  return NextResponse.json({
    ok: true,
    refunded: refundedAmount,
    refund_ids: refundIds,
    failures: attempts.filter((a) => !a.ok),
  });
}
