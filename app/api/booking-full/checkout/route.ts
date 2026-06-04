// Create a Stripe Checkout Session for paying a booking's FULL price via
// Buy-Now-Pay-Later (Affirm / Klarna / Afterpay) — or card.
//
// This is the BNPL sibling of /api/booking-deposit/checkout. The two
// differ in three deliberate ways:
//
//   1. Amount — this charges the whole ticket (service_price), not the
//      deposit. BNPL only makes sense (and only clears the providers'
//      minimums) against the full amount.
//   2. Payment methods — it OMITS payment_method_types so Stripe's
//      "dynamic payment methods" surface card PLUS any BNPL method the
//      stylist enabled on their connected account, filtered to what's
//      eligible for the amount + the direct-charge/application-fee shape.
//   3. No card-on-file — the deposit flow saves the card off-session for
//      no-show fees (customer_creation=always + setup_future_usage). BNPL
//      payment methods can't be saved off-session, and a fully-paid
//      booking has no no-show balance to protect, so we omit both.
//
// Gating: only stylists who turned the feature on (profiles
// .service_bnpl_enabled) can route a client here. The request must be in
// the same `awaiting_deposit` checkpoint the deposit flow uses, and the
// stylist's connected account must be charges-enabled. On success the
// shared booking-deposit webhook (which listens on connected accounts)
// dispatches on metadata.payment_kind = 'full'.

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

const baseUrlOf = (req: Request): string => {
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
      "id, user_id, link_slug, client_name, client_email, service_id, service_name_snapshot, service_name, deposit_amount, deposit_required, approval_status, preferred_date, preferred_time, stripe_connect_account_id, service_price, selected_variation_id, selected_variation_name",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (readErr || !row) {
    return fail(404, "Booking request not found.");
  }
  // Payable checkpoints: a deposit-taking service lands as
  // `awaiting_deposit`; a no-deposit service lands as `pending_review`
  // (the client opted to pay the full ticket up front instead of just
  // requesting). Both are valid entry points for a full payment.
  if (
    row.approval_status !== "awaiting_deposit" &&
    row.approval_status !== "pending_review"
  ) {
    return fail(409, `Request is not awaiting payment (state: ${row.approval_status}).`);
  }

  // The full ticket is the source of truth for this flow. Fall back to the
  // deposit only if (somehow) no service_price was snapshotted.
  const fullPrice = row.service_price != null
    ? Number(row.service_price)
    : Number(row.deposit_amount || 0);
  if (!Number.isFinite(fullPrice) || fullPrice <= 0) {
    return fail(400, "This booking has no payable amount.");
  }

  // Resolve the connected account + confirm the stylist opted into BNPL.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled, service_bnpl_enabled")
    .eq("id", row.user_id)
    .maybeSingle();

  if (!profile?.service_bnpl_enabled) {
    return fail(409, "This stylist hasn't enabled pay-in-full.");
  }

  const acctId =
    row.stripe_connect_account_id ||
    profile?.stripe_connect_account_id ||
    null;
  if (!acctId) {
    return fail(409, "Stylist hasn't connected Stripe yet.");
  }
  if (!profile?.stripe_connect_charges_enabled) {
    return fail(409, "Stylist's Stripe account isn't ready to take charges.");
  }
  // Mid-flow account-flip guard — identical to the deposit flow: refuse to
  // route funds to an account different from the one stamped at submit.
  if (
    row.stripe_connect_account_id &&
    profile?.stripe_connect_account_id &&
    row.stripe_connect_account_id !== profile.stripe_connect_account_id
  ) {
    console.warn(
      "[booking-full/checkout] account flip detected — refusing checkout",
      { request_id: row.id, original: row.stripe_connect_account_id, current: profile.stripe_connect_account_id },
    );
    return fail(
      409,
      "Stylist's Stripe account changed since this booking was created. Please start the booking again.",
    );
  }

  const baseUrl = baseUrlOf(req);
  const cents = Math.round(fullPrice * 100);
  const productName = (() => {
    const base = row.service_name_snapshot || row.service_name || "Booking";
    if (row.selected_variation_name) {
      return `${base}${
        String(base).includes(row.selected_variation_name) ? "" : ` — ${row.selected_variation_name}`
      }`;
    }
    return String(base);
  })();

  // Optional platform fee in basis points. Defaults to 0 — no fee.
  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((cents * feeBps) / 10_000) : 0;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  // NOTE: deliberately NO payment_method_types — let Stripe surface card +
  // BNPL dynamically. NO customer_creation / setup_future_usage either:
  // BNPL methods can't be saved off-session and a fully-paid booking has
  // no balance to no-show-protect.
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(cents));
  form.set("line_items[0][price_data][product_data][name]", productName);
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
  // Dispatch key for the shared webhook — marks this as a full payment so
  // the row is flipped via mark_full_payment_paid_via_webhook (not the
  // deposit RPC) and no no-show card capture is attempted.
  form.set("metadata[payment_kind]", "full");
  if (row.service_id) form.set("metadata[service_id]", row.service_id);
  if (row.client_name) form.set("metadata[client_name]", row.client_name);
  if (row.client_email) form.set("metadata[client_email]", row.client_email);
  if (row.preferred_date) form.set("metadata[appointment_date]", row.preferred_date);
  if (row.preferred_time) form.set("metadata[appointment_time]", row.preferred_time);
  if (row.selected_variation_id) form.set("metadata[variation_id]", String(row.selected_variation_id));
  if (row.selected_variation_name) form.set("metadata[variation_name]", String(row.selected_variation_name));
  form.set("metadata[full_price]", fullPrice.toFixed(2));
  form.set("metadata[amount_paid]", fullPrice.toFixed(2));
  form.set("metadata[balance_due]", "0.00");
  form.set("payment_intent_data[metadata][booking_request_id]", row.id);
  form.set("payment_intent_data[metadata][payment_kind]", "full");
  if (applicationFeeCents > 0) {
    form.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
  }

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
