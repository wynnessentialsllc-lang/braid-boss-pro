// Create a Stripe Checkout Session for the Braid Boss Pro monthly
// subscription — $14.99/mo with a 14-day free trial, charged to the
// PLATFORM Stripe account (not a Connect account).
//
// Pattern matches /api/founding-checkout: no Stripe SDK, inline
// price_data (no pre-created Stripe Price needed), raw fetch to the
// REST API. The subscription is bound to the signed-in user via
// client_reference_id so the webhook can stamp the right profile.
//
// The 14-day trial is configured with subscription_data[trial_period_days].
// A card IS collected up front (default payment_method_collection), so
// the subscription auto-converts to a paid charge when the trial ends
// unless the user cancels through the billing portal (/api/subscribe/portal).

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const TRIAL_DAYS = 14;

// Two billing intervals. Annual ($149/yr) is ~2 months free vs monthly
// ($14.99 × 12 = $179.88 → save $30.88).
const PLANS = {
  monthly: { unitAmount: 1499, interval: "month", label: "Monthly" },
  annual: { unitAmount: 14900, interval: "year", label: "Annual" },
} as const;
type PlanKey = keyof typeof PLANS;

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

  // The subscription binds to the signed-in user. The app passes the
  // Supabase user id (and optionally the email for Stripe to prefill).
  let body: { userId?: string; email?: string; plan?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const userId = (body?.userId || "").trim();
  const email = (body?.email || "").trim();
  const planKey: PlanKey = body?.plan === "annual" ? "annual" : "monthly";
  const plan = PLANS[planKey];
  if (!userId) {
    return fail(400, "Sign in before starting your subscription.");
  }

  const priceBlurb =
    planKey === "annual"
      ? "Full access to Braid Boss Pro. 14-day free trial, then $149/year. Cancel anytime."
      : "Full access to Braid Boss Pro. 14-day free trial, then $14.99/month. Cancel anytime.";

  // Inline recurring price_data — no stored Stripe Product/Price, same
  // as the rest of the app's Stripe usage.
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(plan.unitAmount));
  form.set("line_items[0][price_data][recurring][interval]", plan.interval);
  form.set("line_items[0][price_data][product_data][name]", `Braid Boss Pro — ${plan.label}`);
  form.set("line_items[0][price_data][product_data][description]", priceBlurb);
  form.set("subscription_data[trial_period_days]", String(TRIAL_DAYS));
  form.set("subscription_data[metadata][purpose]", "subscription");
  form.set("subscription_data[metadata][user_id]", userId);
  form.set("subscription_data[metadata][plan]", planKey);
  // Bind the subscription to the Supabase user so the webhook can stamp
  // the right profile on checkout.session.completed.
  form.set("client_reference_id", userId);
  form.set("metadata[purpose]", "subscription");
  form.set("metadata[user_id]", userId);
  form.set("metadata[plan]", planKey);
  // Let stylists apply a launch promo code at checkout.
  form.set("allow_promotion_codes", "true");
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    form.set("customer_email", email);
  }
  form.set("success_url", `${baseUrl}/subscription-success?session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${baseUrl}/pricing?canceled=1`);

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
    return fail(502, `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.url) {
    return fail(502, "Stripe returned an unusable session.");
  }
  return NextResponse.json({ url: session.url });
}
