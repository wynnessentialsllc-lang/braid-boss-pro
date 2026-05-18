// Create a Stripe Checkout Session for an appointment balance.
//
// Mirrors /api/booking-deposit/checkout exactly — same Stripe Connect
// pattern (direct charge on the stylist's connected account via the
// Stripe-Account header), same optional platform fee, same
// mid-flow-account-flip 409 guard. Funds land in the stylist's
// connected account, not the platform's.
//
// Flow:
//   1. Read the appointment via service role.
//   2. Refuse if balance already paid, appointment cancelled, or no
//      balance due.
//   3. Resolve the stylist's connected account from profiles.
//   4. Create the Checkout Session on the connected account.
//   5. Persist balance_checkout_session_id so the row reflects the
//      pending payment.
//   6. Return { url } so the browser can redirect.

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
  try { return new URL(req.url).origin; }
  catch { return ""; }
};

export async function POST(req: Request) {
  let body: { balance_token?: string };
  try { body = await req.json(); }
  catch { return fail(400, "Invalid JSON body."); }

  // The public page only ever holds the opaque balance_access_token,
  // never the internal appointment id. Resolve the appointment from
  // the token server-side (service role) below.
  const balanceToken = body?.balance_token?.trim();
  if (!balanceToken || balanceToken.length < 16 || balanceToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(balanceToken)) {
    return fail(400, "Missing or malformed balance token.");
  }

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

  const { data: row, error: readErr } = await admin
    .from("appointments")
    .select(
      "id, user_id, style, client_name, client_email, total_price, deposit_paid, balance_due, balance_paid, status, appt_date",
    )
    .eq("balance_access_token", balanceToken)
    .maybeSingle();

  if (readErr || !row) return fail(404, "Appointment not found.");
  const apptId = String(row.id);
  if (row.status === "cancelled" || row.status === "canceled") return fail(409, "Appointment is cancelled.");
  if (row.balance_paid) return fail(409, "Balance already paid.");

  const total = Number(row.total_price) || 0;
  const deposit = Number(row.deposit_paid) || 0;
  const balance = Number(row.balance_due) > 0
    ? Number(row.balance_due)
    : Math.max(0, total - deposit);
  if (!Number.isFinite(balance) || balance <= 0) {
    return fail(400, "No balance to collect.");
  }
  const cents = Math.round(balance * 100);
  if (cents < 50) {
    // Stripe minimum is 50 cents on USD. Below that there's nothing
    // meaningful to charge.
    return fail(400, "Balance is below the minimum chargeable amount.");
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled")
    .eq("id", row.user_id)
    .maybeSingle();

  const acctId = profile?.stripe_connect_account_id || null;
  if (!acctId) return fail(409, "Stylist hasn't connected Stripe yet.");
  if (!profile?.stripe_connect_charges_enabled) {
    return fail(409, "Stylist's Stripe account isn't ready to take charges.");
  }

  const baseUrl = baseUrlOf(req);
  const productName = `Balance · ${row.style || "Appointment"}`;

  // Optional platform fee in basis points. Matches the deposit route.
  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((cents * feeBps) / 10_000) : 0;

  // ---------------------------------------------------------------
  // Build the Stripe form-encoded payload.
  // ---------------------------------------------------------------
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${baseUrl}/pay/balance/${balanceToken}?paid=1`);
  params.set("cancel_url", `${baseUrl}/pay/balance/${balanceToken}?cancelled=1`);
  params.set("client_reference_id", apptId);
  params.set("metadata[appointment_id]", apptId);
  params.set("metadata[type]", "balance_payment");
  params.set("payment_intent_data[metadata][appointment_id]", apptId);
  params.set("payment_intent_data[metadata][type]", "balance_payment");
  if (applicationFeeCents > 0) {
    params.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
  }
  // Single line item — the balance.
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(cents));
  params.set("line_items[0][price_data][product_data][name]", productName);
  if (row.client_email) params.set("customer_email", String(row.client_email));

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "content-type": "application/x-www-form-urlencoded",
      // Direct charge on the connected account.
      "Stripe-Account": acctId,
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[balance-payment/checkout] stripe error:", res.status, text.slice(0, 400));
    return fail(502, "Couldn't create checkout session.");
  }
  const session = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
  if (!session?.url || !session?.id) return fail(502, "Stripe response missing url/id.");

  // Persist the pending session id; webhook will look it up on
  // checkout.session.completed. Failure here is non-fatal — Stripe
  // metadata already carries the appointment_id.
  const { error: updErr } = await admin
    .from("appointments")
    .update({
      balance_checkout_session_id: session.id,
      balance_payment_status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", apptId);
  if (updErr) console.warn("[balance-payment/checkout] update failed:", updErr.message);

  // Best-effort analytics — directly inserts into analytics_events.
  // We don't use the trackEvent helper here because this is server
  // code and the helper is client-side.
  try {
    await admin.from("analytics_events").insert({
      event_name: "balance_link_created",
      event_category: "feature",
      metadata: { appt: apptId.slice(0, 8), cents },
      user_id: row.user_id,
    });
  } catch { /* analytics best-effort */ }

  return NextResponse.json({ url: session.url, id: session.id });
}
