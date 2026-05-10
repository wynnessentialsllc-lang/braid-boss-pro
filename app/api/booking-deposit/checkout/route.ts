// Create a Stripe Checkout Session for a booking-request deposit.
//
// Public booking page POSTs here with { request_id } after the anon
// `public_submit_booking_request` RPC has landed an `awaiting_deposit`
// row. We:
//   1. Read the row via the Supabase service role (bypasses RLS).
//   2. Validate it actually requires a deposit.
//   3. Create a Stripe Checkout Session via the REST API.
//   4. Persist the session id back onto the booking_request.
//   5. Return { url } so the browser can redirect to Stripe.
//
// Platform-Stripe model for V1 (no Connect). The deposit lands in the
// platform account and the salon owner reconciles manually. Connect
// onboarding is a follow-up phase — this route is structured so that
// adding `stripe_account` to the session call is a one-line change.
//
// Webhook (/api/booking-deposit/webhook) flips the row to
// deposit_paid_pending_approval once Stripe fires
// checkout.session.completed.

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
      "id, user_id, link_slug, client_name, client_email, service_id, service_name_snapshot, service_name, deposit_amount, deposit_required, approval_status, preferred_date, preferred_time",
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

  const baseUrl = baseUrlOf(req);
  const cents = Math.round(Number(row.deposit_amount) * 100);
  const productName = `Deposit · ${row.service_name_snapshot || row.service_name || "Booking"}`;

  // Stripe REST expects application/x-www-form-urlencoded with bracket
  // notation for nested fields. Build the params manually so we don't
  // need to depend on the Stripe SDK.
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
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
  if (row.service_id) form.set("metadata[service_id]", row.service_id);
  if (row.client_name) form.set("metadata[client_name]", row.client_name);
  if (row.client_email) form.set("metadata[client_email]", row.client_email);
  if (row.preferred_date) form.set("metadata[appointment_date]", row.preferred_date);
  if (row.preferred_time) form.set("metadata[appointment_time]", row.preferred_time);
  // Mirror the booking_request id into payment_intent metadata too so
  // the webhook can recover even if the session metadata is missing.
  form.set("payment_intent_data[metadata][booking_request_id]", row.id);

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
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

  // Persist the session id so the queue UI can show "Pending" and the
  // webhook can dedupe against retries.
  await admin
    .from("booking_requests")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_session_id: session.id,
    })
    .eq("id", row.id);

  return NextResponse.json({ url: session.url });
}
