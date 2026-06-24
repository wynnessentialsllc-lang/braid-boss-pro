// Create a Stripe Checkout Session to subscribe to a recurring membership.
//
// Mirrors /api/package-checkout, but mode=subscription: the buyer's card
// is charged on the stylist's connected account every cycle. We use an
// inline recurring price_data (interval from the template) so no Stripe
// Price object has to be pre-created. The membership row + each cycle's
// granted visits/credit are written by the membership webhook — nothing
// is written here.
//
// Anon: anyone with the signup link can subscribe.

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
  try { return new URL(req.url).origin; } catch { return ""; }
};

const VALID_INTERVALS = new Set(["week", "month", "year"]);

export async function POST(req: Request) {
  let body: { template_id?: string; buyer_name?: string; buyer_email?: string };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON body."); }

  const templateId = body?.template_id?.trim();
  if (!templateId || !/^[0-9a-f-]{36}$/i.test(templateId)) {
    return fail(400, "Missing or malformed template_id.");
  }
  const buyerName = String(body?.buyer_name || "").trim().slice(0, 120) || null;
  const buyerEmail = String(body?.buyer_email || "").trim().slice(0, 200) || null;
  if (!buyerEmail || !buyerEmail.includes("@")) {
    return fail(400, "A valid email is required.");
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

  const { data: tpl, error: tplErr } = await admin
    .from("package_templates")
    .select("id, user_id, name, kind, visits, credit_amount, price, service_label, active, billing_mode, billing_interval")
    .eq("id", templateId)
    .maybeSingle();
  if (tplErr || !tpl) return fail(404, "Membership not found.");
  if (!tpl.active) return fail(409, "This membership isn't available.");
  if (tpl.billing_mode !== "recurring") {
    return fail(409, "This isn't a recurring membership.");
  }
  const interval = String(tpl.billing_interval || "");
  if (!VALID_INTERVALS.has(interval)) {
    return fail(409, "This membership has no billing interval set.");
  }

  const price = Number(tpl.price) || 0;
  if (price <= 0) return fail(400, "This membership isn't purchasable online.");
  const cents = Math.round(price * 100);

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled")
    .eq("id", tpl.user_id)
    .maybeSingle();
  const acctId = profile?.stripe_connect_account_id || null;
  if (!acctId) return fail(409, "This stylist hasn't connected Stripe yet.");
  if (!profile?.stripe_connect_charges_enabled) {
    return fail(409, "This stylist's Stripe account isn't ready to take charges.");
  }

  // Platform fee as a percent of each cycle. Subscriptions take
  // application_fee_percent (not a fixed amount); convert from the
  // basis-point env used elsewhere (250 bps → 2.5%).
  const feePercent = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw <= 0 || raw > 10_000) return 0;
    return Math.round((raw / 100) * 100) / 100; // 2-dp percent
  })();

  const baseUrl = baseUrlOf(req);
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(cents));
  form.set("line_items[0][price_data][recurring][interval]", interval);
  form.set("line_items[0][price_data][product_data][name]", String(tpl.name || "Membership"));
  form.set("success_url", `${baseUrl}/buy/membership/${tpl.id}?status=success`);
  form.set("cancel_url", `${baseUrl}/buy/membership/${tpl.id}?status=cancel`);
  form.set("customer_email", buyerEmail);
  // Session metadata — read by the webhook on checkout.session.completed.
  form.set("metadata[membership_template_id]", String(tpl.id));
  form.set("metadata[stylist_user_id]", String(tpl.user_id));
  form.set("metadata[buyer_email]", buyerEmail);
  if (buyerName) form.set("metadata[buyer_name]", buyerName);
  // Subscription metadata — rides on every future invoice.* and
  // customer.subscription.* event so recurring cycles can be linked back
  // to the template even if the session record is unavailable.
  form.set("subscription_data[metadata][membership_template_id]", String(tpl.id));
  form.set("subscription_data[metadata][stylist_user_id]", String(tpl.user_id));
  form.set("subscription_data[metadata][buyer_email]", buyerEmail);
  if (buyerName) form.set("subscription_data[metadata][buyer_name]", buyerName);
  if (feePercent > 0) {
    form.set("subscription_data[application_fee_percent]", String(feePercent));
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
    return fail(502, `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.url) return fail(502, "Stripe returned an unusable session.");

  return NextResponse.json({ url: session.url });
}
