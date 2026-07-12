// POST /api/stripe-connect/transactions
//
// Auth required (Supabase access_token in the body, same contract as
// /api/stripe-connect/status). Pulls the most recent charges from the
// stylist's CONNECTED account and flattens each into the shape the
// Payments page consumes:
//
//   { id, amount, fee, net, tip, created, client_name, service_name,
//     payment_intent, charge, appointment_id, type, refunds[] }
//
// Amounts are returned in the currency's major unit (dollars). The
// Stripe processing fee + net payout come from the expanded
// balance_transaction. Refunds are flattened into a child array so the
// detail view can render refund history without a second round-trip.
//
// Never 500s on a Stripe hiccup — returns { transactions: [], stale }
// so the page can fall back to appointment-derived data.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const cents = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n) / 100 : 0;

export async function POST(req: Request) {
  let body: { access_token?: string; limit?: number };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON."); }
  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");
  const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 100);

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

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled")
    .eq("id", userId)
    .maybeSingle();

  const accountId = profile?.stripe_connect_account_id;
  if (!accountId) {
    return NextResponse.json({ transactions: [], connected: false });
  }

  // Expand balance_transaction (for fee + net) and refunds (for refund
  // history) so we don't fan out into N extra calls per charge.
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.append("expand[]", "data.balance_transaction");
  params.append("expand[]", "data.refunds.data.balance_transaction");

  let charges: any[] = [];
  try {
    const res = await fetch(`${STRIPE_API}/charges?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": accountId,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ transactions: [], connected: true, stale: true });
    }
    const json = await res.json();
    charges = Array.isArray(json?.data) ? json.data : [];
  } catch {
    return NextResponse.json({ transactions: [], connected: true, stale: true });
  }

  // Deposit charges only carry `booking_request_id` in their metadata —
  // the actual appointment id and the authoritative client/service live
  // on the booking_requests row (stamped at approval time). Resolve them
  // here so each Stripe row can (a) be labeled with the real client +
  // service instead of the cardholder's billing name + a "Stripe payment"
  // placeholder, and (b) share the appointment id with the appointment-
  // derived deposit row so the Payments page can de-dupe the two into one.
  const bookingRequestIds = Array.from(
    new Set(
      charges
        .map((c: any) => c?.metadata?.booking_request_id || c?.metadata?.bookingRequestId)
        .filter((v: any): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const bookingRequestMap = new Map<string, any>();
  if (bookingRequestIds.length > 0) {
    const { data: brRows } = await admin
      .from("booking_requests")
      .select("id, appointment_id, client_name, service_name, service_name_snapshot")
      .eq("user_id", userId)
      .in("id", bookingRequestIds);
    for (const row of brRows || []) bookingRequestMap.set(String(row.id), row);
  }

  const transactions = charges
    .filter((c: any) => c?.status === "succeeded" || c?.paid)
    .flatMap((c: any) => {
      const bt = c?.balance_transaction;
      const fee = bt && typeof bt === "object" ? cents(bt.fee) : 0;
      const net = bt && typeof bt === "object" ? cents(bt.net) : cents(c.amount) - fee;
      const meta = c?.metadata || {};
      const tipCents = Number(meta.tip_cents ?? meta.tip ?? 0);
      const refundList = Array.isArray(c?.refunds?.data) ? c.refunds.data : [];
      const bookingRequestId = meta.booking_request_id || meta.bookingRequestId || null;
      const br = bookingRequestId ? bookingRequestMap.get(String(bookingRequestId)) : null;
      // Prefer the booking's client over the card's billing name, and the
      // booked service over Stripe's description.
      const clientName =
        br?.client_name ||
        c?.billing_details?.name ||
        meta.client_name ||
        meta.clientName ||
        "Stripe customer";
      const serviceName =
        br?.service_name_snapshot ||
        br?.service_name ||
        c?.description ||
        meta.service_name ||
        meta.serviceName ||
        "Stripe payment";
      const paymentIntent = typeof c?.payment_intent === "string" ? c.payment_intent : null;
      const appointmentId =
        meta.appointment_id ||
        meta.appointmentId ||
        br?.appointment_id ||
        bookingRequestId ||
        null;
      const paymentType =
        meta.type === "balance_payment"
          ? "final"
          : meta.booking_request_id
            ? "deposit"
            : "full";
      const refunds = refundList.map((r: any) => ({
        id: String(r.id),
        amount: cents(r.amount),
        reason: r.reason || undefined,
        date: new Date((r.created || 0) * 1000).toISOString(),
      }));

      // Always record the charge as income, dated when it was charged, and
      // record each refund as its OWN line, dated when it was refunded. A
      // paid-then-refunded charge therefore nets to zero (income in, refund
      // out) instead of showing as pure money-out — which used to wipe out a
      // later re-payment. The charge row keeps the refund history for the
      // detail view; the refund rows carry the ledger entries.
      const tipAmount = Number.isFinite(tipCents) && tipCents > 0 ? Math.round(tipCents) / 100 : 0;
      const chargeRow = {
        id: String(c.id),
        // The Stripe amount already includes the tip; carry the tip
        // separately and exclude it from `amount` so amount + tip (how the
        // app sums a row) equals the charge total, not double the tip.
        amount: Math.max(0, cents(c.amount) - tipAmount),
        fee,
        net,
        tip: tipAmount,
        paid_at: new Date((c.created || 0) * 1000).toISOString(),
        client_name: clientName,
        service_name: serviceName,
        payment_intent: paymentIntent,
        charge: String(c.id),
        appointment_id: appointmentId,
        payment_type: paymentType,
        type: "charge",
        refunds,
      };
      // The service portion of the charge (what shows as the payment amount,
      // tip excluded). A refund is measured against this so a full refund
      // reverses the whole charge even when Stripe returned the tip too.
      const serviceAmount = Math.max(0, cents(c.amount) - tipAmount);
      const refundRows = refundList.map((r: any) => {
        const refundAmt = cents(r.amount);
        // How much of the charge this refund covers (capped at 1 = full). A
        // full refund reverses the entire tip and processing fee; a partial
        // refund reverses them proportionally — so the summary nets a
        // refunded charge to zero (tip and Stripe fee included), the way
        // Stripe treats a refunded payment.
        const denom = serviceAmount > 0 ? serviceAmount : cents(c.amount);
        const frac = denom > 0 ? Math.min(1, refundAmt / denom) : 1;
        const round2 = (n: number) => Math.round(n * 100) / 100;
        const tipReversed = round2(tipAmount * frac);
        const feeReversed = round2(fee * frac);
        // Show the refund as the service amount returned; carry the reversed
        // tip/fee alongside so the ledger totals net out correctly.
        const shownAmount = denom > 0 ? Math.min(refundAmt, denom) : refundAmt;
        return {
          id: `${String(c.id)}_re_${String(r.id)}`,
          amount: shownAmount,
          fee: feeReversed,
          net: round2(shownAmount + tipReversed),
          tip: tipReversed,
          paid_at: new Date((r.created || 0) * 1000).toISOString(),
          client_name: clientName,
          service_name: serviceName,
          payment_intent: paymentIntent,
          charge: String(c.id),
          appointment_id: appointmentId,
          payment_type: "refund",
          type: "refund",
          refunds: [],
        };
      });
      return [chargeRow, ...refundRows];
    });

  return NextResponse.json({ transactions, connected: true });
}
