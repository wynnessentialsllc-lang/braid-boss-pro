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
    .map((c: any) => {
      const bt = c?.balance_transaction;
      const fee = bt && typeof bt === "object" ? cents(bt.fee) : 0;
      const net = bt && typeof bt === "object" ? cents(bt.net) : cents(c.amount) - fee;
      const meta = c?.metadata || {};
      const tipCents = Number(meta.tip_cents ?? meta.tip ?? 0);
      const refundList = Array.isArray(c?.refunds?.data) ? c.refunds.data : [];
      const refundedTotal = cents(c?.amount_refunded);
      // A fully-refunded charge is surfaced as a single "Refund" row, so
      // it must be dated when the refund actually happened — the latest
      // refund's timestamp — not when the original charge was created.
      const isFullyRefunded = refundedTotal > 0 && refundedTotal >= cents(c.amount);
      const latestRefundCreated = refundList.reduce(
        (max: number, r: any) => Math.max(max, Number(r?.created) || 0),
        0,
      );
      const rowCreatedUnix = isFullyRefunded && latestRefundCreated > 0
        ? latestRefundCreated
        : (c.created || 0);
      const bookingRequestId = meta.booking_request_id || meta.bookingRequestId || null;
      const br = bookingRequestId ? bookingRequestMap.get(String(bookingRequestId)) : null;
      return {
        id: String(c.id),
        amount: cents(c.amount),
        fee,
        net,
        tip: Number.isFinite(tipCents) && tipCents > 0 ? Math.round(tipCents) / 100 : 0,
        paid_at: new Date(rowCreatedUnix * 1000).toISOString(),
        // Prefer the booking's client over the card's billing name: the
        // person being served is who the stylist recognizes, not whoever
        // happened to pay (a friend/parent paying a deposit is common).
        client_name:
          br?.client_name ||
          c?.billing_details?.name ||
          meta.client_name ||
          meta.clientName ||
          "Stripe customer",
        service_name:
          br?.service_name_snapshot ||
          br?.service_name ||
          c?.description ||
          meta.service_name ||
          meta.serviceName ||
          "Stripe payment",
        payment_intent: typeof c?.payment_intent === "string" ? c.payment_intent : null,
        charge: String(c.id),
        // Real appointment id when the booking has been approved; fall back
        // to the booking_request id so a still-pending deposit stays linked.
        appointment_id:
          meta.appointment_id ||
          meta.appointmentId ||
          br?.appointment_id ||
          bookingRequestId ||
          null,
        payment_type:
          meta.type === "balance_payment"
            ? "final"
            : meta.booking_request_id
              ? "deposit"
              : "full",
        type: isFullyRefunded ? "refund" : "charge",
        refunds: refundList.map((r: any) => ({
          id: String(r.id),
          amount: cents(r.amount),
          reason: r.reason || undefined,
          date: new Date((r.created || 0) * 1000).toISOString(),
        })),
      };
    });

  return NextResponse.json({ transactions, connected: true });
}
