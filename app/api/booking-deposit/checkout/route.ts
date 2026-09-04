// Create a Stripe Checkout Session for a booking-request deposit.
//
// Phase B11 — Stripe Connect Express direct charges. The session is
// created on the stylist's connected account via the `Stripe-Account`
// header; their statement descriptor shows on the client's card, the
// money lands in their Stripe balance directly, and (optionally) the
// platform takes an application fee of PLATFORM_FEE_BPS basis points.
//
// Flow:
//   1. Read the row via the Supabase service role.
//   2. Require approval_status = 'awaiting_deposit'.
//   3. Resolve the stylist's connected acct_XXX from profiles; refuse
//      if Connect onboarding hasn't completed (charges_enabled = false).
//   4. Create the Checkout Session AS the connected account.
//   5. Persist the session id and acct id onto the booking_request.
//   6. Return { url } so the browser can redirect.
//
// Webhook (/api/booking-deposit/webhook) flips the row to
// deposit_paid_pending_approval once Stripe fires
// checkout.session.completed on the connected account (the platform
// endpoint must have "Listen to events on Connected accounts"
// enabled in the Stripe dashboard).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bookingCharge, BOOKING_FEE_LABEL } from "../../../lib/booking-fee";

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

const baseUrlOf = (req: Request): string => {
  // Use the configured public site URL when set; otherwise fall back
  // to the request origin so this works on Vercel preview deploys.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
};

export async function POST(req: Request) {
  let body: { request_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const requestId = body?.request_id?.trim();
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return fail(400, "Missing or malformed request_id.");
  }

  let stripeSecret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row, error: readErr } = await admin
    .from("booking_requests")
    .select(
      "id, user_id, link_slug, client_name, client_email, service_id, service_name_snapshot, service_name, deposit_amount, deposit_required, approval_status, preferred_date, preferred_time, stripe_connect_account_id, service_price, selected_variation_id, selected_variation_name, selected_variation_price, selected_variation_deposit_amount",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (readErr || !row) {
    return fail(404, "Booking request not found.");
  }
  if (row.approval_status !== "awaiting_deposit") {
    return fail(409, `Request is not awaiting deposit (state: ${row.approval_status}).`);
  }
  if (!row.deposit_required || !row.deposit_amount || Number(row.deposit_amount) <= 0) {
    return fail(400, "This request doesn't require a deposit.");
  }

  // Phase B11 — resolve the connected account. The submit RPC stamps
  // `stripe_connect_account_id` only when the stylist had a
  // charges_enabled account at submit time, so most rows arrive here
  // pre-flight checked. Re-read profiles defensively in case the
  // stylist's status flipped between submit and checkout.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled, platform_approved")
    .eq("id", row.user_id)
    .maybeSingle();

  const acctId =
    row.stripe_connect_account_id ||
    profile?.stripe_connect_account_id ||
    null;
  if (!acctId) {
    return fail(409, "Stylist hasn't connected Stripe yet.");
  }
  if (!profile?.stripe_connect_charges_enabled || !profile?.platform_approved) {
    return fail(409, "Stylist's Stripe account isn't ready to take charges.");
  }
  // Mid-flow account flip guard. If the booking_request was stamped
  // with a connected account at submit time and the stylist has since
  // disconnected + reconnected under a different account, refuse to
  // route funds to the new one and tell the client to restart the
  // booking so they get a fresh checkout against the current account.
  if (
    row.stripe_connect_account_id &&
    profile?.stripe_connect_account_id &&
    row.stripe_connect_account_id !== profile.stripe_connect_account_id
  ) {
    console.warn(
      "[booking-deposit/checkout] account flip detected — refusing checkout",
      { request_id: row.id, original: row.stripe_connect_account_id, current: profile.stripe_connect_account_id },
    );
    return fail(
      409,
      "Stylist's Stripe account changed since this booking was created. Please start the booking again.",
    );
  }

  const baseUrl = baseUrlOf(req);
  // Trust the submit RPC's resolved snapshot. public_submit_booking_
  // request already folds variation pricing AND every picked add-on
  // (including the include_in_deposit ones) into:
  //   * deposit_amount  → the deposit due today
  //   * service_price   → the full ticket price
  // The per-variation columns (selected_variation_deposit_amount /
  // selected_variation_price) are a RAW snapshot that EXCLUDES add-ons
  // and must never drive the charge — doing so undercharged the
  // deposit whenever an add-on was selected. Use the resolved columns
  // verbatim so the Stripe amount equals the booking page exactly.
  const depositAmount = Number(row.deposit_amount);
  const fullPrice = row.service_price != null
    ? Number(row.service_price)
    : depositAmount;
  const balanceDue = Math.max(0, fullPrice - depositAmount);
  const cents = Math.round(depositAmount * 100);
  const productName = (() => {
    const base = row.service_name_snapshot || row.service_name || "Booking";
    if (row.selected_variation_name) {
      // service_name already carries the " — variation" suffix from the
      // submit RPC; service_name_snapshot is the bare parent. Compose
      // a tidy receipt label either way.
      return `Deposit · ${base}${
        String(base).includes(row.selected_variation_name) ? "" : ` — ${row.selected_variation_name}`
      }`;
    }
    return `Deposit · ${base}`;
  })();

  // Optional platform fee in basis points. Defaults to 0 — no fee.
  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const percentFeeCents = feeBps > 0 ? Math.floor((cents * feeBps) / 10_000) : 0;

  // Client-paid booking fee. Added as its own line item so the client
  // sees and agrees to it, and added to the application fee so the
  // whole amount routes to the platform. Because this is a direct
  // charge on the stylist's connected account, that combination leaves
  // her payout at exactly the deposit she set -- the fee is additive
  // to the client, not deducted from her.
  const charge = bookingCharge(cents);
  const applicationFeeCents = percentFeeCents + charge.feeCents;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(cents));
  form.set("line_items[0][price_data][product_data][name]", productName);
  if (charge.feeCents > 0) {
    form.set("line_items[1][quantity]", "1");
    form.set("line_items[1][price_data][currency]", "usd");
    form.set("line_items[1][price_data][unit_amount]", String(charge.feeCents));
    form.set("line_items[1][price_data][product_data][name]", BOOKING_FEE_LABEL);
    // Reconciliation: the deposit webhook credits the stylist from
    // metadata[deposit_amount], so the fee must be separately legible
    // or the two figures look like they disagree.
    form.set("metadata[booking_fee_cents]", String(charge.feeCents));
    form.set("payment_intent_data[metadata][booking_fee_cents]", String(charge.feeCents));
  }
  form.set(
    "success_url",
    `${baseUrl}/booking/success?request_id=${encodeURIComponent(row.id)}&session_id={CHECKOUT_SESSION_ID}`,
  );
  form.set(
    "cancel_url",
    `${baseUrl}/book/${encodeURIComponent(row.link_slug || "")}?cancelled=1`,
  );
  if (row.client_email) form.set("customer_email", row.client_email);
  form.set("metadata[booking_request_id]", row.id);
  form.set("metadata[stylist_user_id]", row.user_id);
  form.set("metadata[stylist_account_id]", acctId);
  if (row.service_id) form.set("metadata[service_id]", row.service_id);
  if (row.client_name) form.set("metadata[client_name]", row.client_name);
  if (row.client_email) form.set("metadata[client_email]", row.client_email);
  if (row.preferred_date) form.set("metadata[appointment_date]", row.preferred_date);
  if (row.preferred_time) form.set("metadata[appointment_time]", row.preferred_time);
  // Per-variation metadata — surfaces the picked flavor in the Stripe
  // dashboard so reconciliation between Braid Boss Pro + Stripe is
  // unambiguous when the same parent service has multiple price
  // points. All four fields are safe to include (no client PII).
  if (row.selected_variation_id) form.set("metadata[variation_id]", String(row.selected_variation_id));
  if (row.selected_variation_name) form.set("metadata[variation_name]", String(row.selected_variation_name));
  form.set("metadata[full_price]", fullPrice.toFixed(2));
  form.set("metadata[deposit_amount]", depositAmount.toFixed(2));
  form.set("metadata[balance_due]", balanceDue.toFixed(2));
  form.set("payment_intent_data[metadata][booking_request_id]", row.id);
  if (applicationFeeCents > 0) {
    form.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
  }
  // No-show protection: save the card so the stylist can charge a
  // no-show fee off-session later. customer_creation=always mints a
  // Customer on the connected account; setup_future_usage attaches the
  // payment method to it for off-session reuse. The deposit webhook
  // records the resulting customer + payment method on the booking row.
  form.set("customer_creation", "always");
  form.set("payment_intent_data[setup_future_usage]", "off_session");

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "Stripe-Account": acctId,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!stripeRes.ok) {
    const text = await stripeRes.text().catch(() => "");
    return fail(
      502,
      `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`,
    );
  }
  const session = (await stripeRes.json()) as {
    id?: string;
    url?: string;
  };
  if (!session.id || !session.url) {
    return fail(502, "Stripe returned an unusable session.");
  }

  // Persist the session id and lock the acct id on the row so refunds
  // (when we wire them) route through the same connected account.
  await admin
    .from("booking_requests")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_session_id: session.id,
      stripe_connect_account_id: acctId,
    })
    .eq("id", row.id);

  return NextResponse.json({ url: session.url });
}
