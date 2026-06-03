// POST /api/no-show-charge
//
// No-show protection. Charges a configurable no-show fee off-session to
// the card saved at deposit time, on the stylist's CONNECTED account.
//
// Auth: Supabase access_token in the body (same contract as the other
// stripe-connect routes). The caller must own the appointment.
//
// Flow:
//   1. Identify the signed-in stylist from the access token.
//   2. Resolve the booking_request linked to the appointment (and scoped
//      to that stylist). It must have a saved customer + payment method
//      and not already have a no-show fee charged.
//   3. Create an off-session, confirmed PaymentIntent on the connected
//      account for the requested amount, with the platform application
//      fee, and record it on the row.
//
// Returns { ok: true, amount, last4 } on success, or a friendly
// { error } for declines / auth-required / not-configured cases.

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

export async function POST(req: Request) {
  let body: { access_token?: string; appointment_id?: string; amount_cents?: number };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON."); }

  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");
  const appointmentId = String(body?.appointment_id || "").trim();
  if (!appointmentId) return fail(400, "Missing appointment_id.");

  // Amount in cents, sane bounds ($1 – $10,000).
  const amountCents = Math.floor(Number(body?.amount_cents));
  if (!Number.isFinite(amountCents) || amountCents < 100) {
    return fail(400, "Enter a fee of at least $1.");
  }
  if (amountCents > 1_000_000) return fail(400, "That fee is too large.");

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

  // Resolve the booking_request linked to the appointment, scoped to the
  // signed-in stylist so a tampered appointment_id can't charge someone
  // else's client.
  const { data: row, error: rowErr } = await admin
    .from("booking_requests")
    .select(
      "id, user_id, client_name, stripe_connect_account_id, stripe_customer_id, stripe_payment_method_id, nshow_card_last4, no_show_fee_charged_at, no_show_consent_at",
    )
    .eq("appointment_id", appointmentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (rowErr) return fail(500, "Couldn't load the booking.");
  if (!row) return fail(404, "No booking on file for this appointment.");
  if (row.no_show_fee_charged_at) {
    return fail(409, "A no-show fee was already charged for this appointment.");
  }
  // Hard requirement: the client must have agreed to the no-show policy
  // (proof captured at booking time). No consent on file → no charge.
  if (!row.no_show_consent_at) {
    return fail(403, "This client didn't agree to a no-show fee at booking, so the card can't be charged.");
  }

  const acctId = row.stripe_connect_account_id;
  const customerId = row.stripe_customer_id;
  const paymentMethodId = row.stripe_payment_method_id;
  if (!acctId || !customerId || !paymentMethodId) {
    return fail(422, "No saved card on file. No-show fees need a card saved at the deposit step.");
  }

  // Platform application fee in basis points (default 0), mirroring the
  // deposit checkout.
  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((amountCents * feeBps) / 10_000) : 0;

  const form = new URLSearchParams();
  form.set("amount", String(amountCents));
  form.set("currency", "usd");
  form.set("customer", customerId);
  form.set("payment_method", paymentMethodId);
  form.set("off_session", "true");
  form.set("confirm", "true");
  form.set("description", `No-show fee${row.client_name ? ` — ${row.client_name}` : ""}`);
  form.set("metadata[booking_request_id]", row.id);
  form.set("metadata[appointment_id]", appointmentId);
  form.set("metadata[kind]", "no_show_fee");
  if (applicationFeeCents > 0) {
    form.set("application_fee_amount", String(applicationFeeCents));
  }

  let pi: any;
  try {
    const res = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": acctId,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    });
    pi = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Map common off-session failure modes to friendly copy.
      const code = pi?.error?.code || pi?.error?.decline_code;
      if (code === "authentication_required") {
        return fail(402, "The card needs re-authorization by the client and can't be charged automatically.");
      }
      if (pi?.error?.type === "card_error") {
        return fail(402, pi?.error?.message || "The card was declined.");
      }
      return fail(502, pi?.error?.message || "Stripe rejected the charge.");
    }
  } catch {
    return fail(502, "Couldn't reach Stripe. Please try again.");
  }

  if (pi?.status !== "succeeded") {
    return fail(402, "The charge didn't complete. The client's card may need re-authorization.");
  }

  // Record the charge. Best-effort — the money already moved, so we
  // still report success even if this write hiccups.
  await admin
    .from("booking_requests")
    .update({
      no_show_fee_amount: amountCents / 100,
      no_show_fee_charged_at: new Date().toISOString(),
      no_show_fee_payment_intent_id: typeof pi?.id === "string" ? pi.id : null,
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    amount: amountCents / 100,
    last4: row.nshow_card_last4 || null,
  });
}
