// Create a Stripe Checkout Session for Founding Stylist Access —
// a one-time $9.99 payment to the PLATFORM Stripe account (not a
// Connect-connected account). This is Braid Boss Pro charging the
// stylist directly for lifetime platform access.
//
// MVP scope: this route just creates the session + returns the URL.
// The auto-claim wiring (link the paid Stripe customer to their
// eventual sign-up email and stamp profiles.founding_access = true)
// lands in a follow-up PR. Stripe dashboard is the source of truth
// for who paid; reconciliation against new sign-ups happens there
// for the founding cohort.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const FOUNDING_PRICE_CENTS = 999; // $9.99

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
  let stripeSecret: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const baseUrl = baseUrlOf(req);

  // Optional email pre-fill — when the visitor was already signed
  // in or supplied an email upstream. Stripe Checkout always
  // collects an email at the payment step regardless.
  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const email = (body?.email || "").trim();

  // Build the Checkout Session. price_data inline (no Stripe Product
  // object stored) matches the rest of the app's Stripe usage.
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(FOUNDING_PRICE_CENTS));
  form.set(
    "line_items[0][price_data][product_data][name]",
    "Braid Boss Pro · Founding Stylist Access",
  );
  form.set(
    "line_items[0][price_data][product_data][description]",
    "One-time payment · Lifetime platform access for the first 100 stylists",
  );
  form.set(
    "success_url",
    `${baseUrl}/founding-success?session_id={CHECKOUT_SESSION_ID}`,
  );
  form.set("cancel_url", `${baseUrl}/pricing?canceled=1`);
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    form.set("customer_email", email);
  }
  form.set("metadata[purpose]", "founding_stylist_access");
  form.set("metadata[price_cents]", String(FOUNDING_PRICE_CENTS));
  form.set("payment_intent_data[metadata][purpose]", "founding_stylist_access");
  // Allow Stripe to consult the customer's prior cards on file for
  // a smoother checkout. Optional but improves conversion noticeably.
  form.set("payment_intent_data[setup_future_usage]", "off_session");

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
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    return fail(502, "Stripe returned an unusable session.");
  }

  return NextResponse.json({ url: session.url });
}
