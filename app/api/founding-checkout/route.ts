// Create a Stripe Checkout Session for Founding Stylist Access —
// a one-time $9.99 payment to the PLATFORM Stripe account (not a
// Connect-connected account). This is Braid Boss Pro charging the
// stylist directly for lifetime platform access.
//
// MVP scope: this route just creates the session + returns the URL.
// The auto-claim wiring (link the paid Stripe customer to their
// eventual sign-up email and stamp profiles.founding_access = true)
// lands in a follow-up PR. Stripe dashboard is the source of truth
// for who paid; reconciliation against new sign-ups happens
// automatically via:
//   • /api/founding-checkout/webhook — flips the order to 'paid'
//     on checkout.session.completed + opportunistically claims the
//     order for any registered user whose email already matches.
//   • claim_founding_access_for_user RPC — called by the app after
//     sign-up; claims any 'paid' orders matching the new user's
//     email.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeSecret = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
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

  // Pre-insert a pending row in founding_access_orders so the
  // webhook can find us on checkout.session.completed (the webhook
  // looks the order up by stripe_session_id). If the row already
  // somehow exists for the same session id, the webhook's defensive
  // insert path covers it too.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderErr } = await admin
    .from("founding_access_orders")
    .insert({
      customer_email: email || null,
      amount_cents: FOUNDING_PRICE_CENTS,
      currency: "usd",
      status: "pending",
      metadata: { source: "founding_access_page" },
    })
    .select("id")
    .maybeSingle();
  if (orderErr || !order?.id) {
    return fail(500, orderErr?.message || "Couldn't create the order row.");
  }
  form.set("metadata[founding_order_id]", String(order.id));
  form.set("payment_intent_data[metadata][founding_order_id]", String(order.id));

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
    // Mark the pending row failed so we don't accumulate stuck
    // pending orders when Stripe rejects the session up front.
    await admin
      .from("founding_access_orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    return fail(
      502,
      `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`,
    );
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    await admin
      .from("founding_access_orders")
      .update({ status: "failed" })
      .eq("id", order.id);
    return fail(502, "Stripe returned an unusable session.");
  }

  // Stamp the session id so the webhook can find this row by
  // stripe_session_id when it fires.
  await admin
    .from("founding_access_orders")
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq("id", order.id);

  return NextResponse.json({ url: session.url });
}
