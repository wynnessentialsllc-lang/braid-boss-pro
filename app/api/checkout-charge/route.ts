// Create a Stripe Checkout Session for an in-person Boss Checkout sale.
//
// The stylist rings up a walk-in and wants to charge the client's card
// without Tap to Pay (e.g. on the web app, or to let the client pay on
// their own phone). We mint a hosted Stripe Checkout link for the ticket
// total on the stylist's CONNECTED account (direct charge, same pattern as
// /api/balance-payment/checkout), hand the client a QR / link, and the
// stylist's app polls /api/checkout-charge/status to know when it clears.
//
// Auth: the caller is the SIGNED-IN stylist, so we authenticate with their
// Supabase access token (Bearer-in-body, like /api/no-show-charge) rather
// than a public token. Funds land in the stylist's connected account.

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
  let body: { access_token?: string; amount_cents?: number; description?: string; client_name?: string; client_email?: string };
  try { body = await req.json(); }
  catch { return fail(400, "Invalid JSON body."); }

  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");

  // Amount in cents — Stripe's USD minimum is 50¢; cap so a typo can't
  // bill a fortune.
  const amountRaw = Number(body?.amount_cents);
  if (!Number.isFinite(amountRaw)) return fail(400, "Missing amount.");
  const cents = Math.floor(amountRaw);
  if (cents < 50) return fail(400, "Amount is below the $0.50 card minimum.");
  if (cents > 5_000_000) return fail(400, "Amount is above the allowed maximum.");

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

  // Identify the signed-in stylist from their access token.
  const { data: who, error: whoErr } = await admin.auth.getUser(accessToken);
  if (whoErr || !who?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = who.user.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled, platform_approved")
    .eq("id", userId)
    .maybeSingle();

  const acctId = profile?.stripe_connect_account_id || null;
  if (!acctId) return fail(409, "Connect Stripe first (Settings → Payments) to charge cards here.");
  if (!profile?.stripe_connect_charges_enabled) {
    return fail(409, "Your Stripe account isn't ready to take charges yet.");
  }
  if (!profile?.platform_approved) {
    return fail(409, "Your account is pending a manual review before you can charge cards. This is usually quick — check back soon.");
  }

  const baseUrl = baseUrlOf(req);
  const cleanName = (body?.description || "").toString().trim().slice(0, 120);
  const productName = cleanName || "In-person sale";

  // Optional platform fee in basis points (matches the balance route).
  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw < 0 || raw > 10_000) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((cents * feeBps) / 10_000) : 0;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${baseUrl}/pay/complete`);
  params.set("cancel_url", `${baseUrl}/pay/complete?cancelled=1`);
  params.set("metadata[type]", "boss_checkout_charge");
  params.set("metadata[stylist_user_id]", userId);
  params.set("payment_intent_data[metadata][type]", "boss_checkout_charge");
  params.set("payment_intent_data[metadata][stylist_user_id]", userId);
  if (body?.client_name) {
    const cn = String(body.client_name).slice(0, 120);
    params.set("metadata[client_name]", cn);
    params.set("payment_intent_data[metadata][client_name]", cn);
  }
  if (applicationFeeCents > 0) {
    params.set("payment_intent_data[application_fee_amount]", String(applicationFeeCents));
  }
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(cents));
  params.set("line_items[0][price_data][product_data][name]", productName);
  if (body?.client_email) params.set("customer_email", String(body.client_email).slice(0, 200));

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "content-type": "application/x-www-form-urlencoded",
      "Stripe-Account": acctId, // direct charge on the connected account
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[checkout-charge] stripe error:", res.status, text.slice(0, 400));
    return fail(502, "Couldn't create the card payment link.");
  }
  const session = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
  if (!session?.url || !session?.id) return fail(502, "Stripe response missing url/id.");

  try {
    await admin.from("analytics_events").insert({
      event_name: "checkout_card_link_created",
      event_category: "feature",
      metadata: { cents },
      user_id: userId,
    });
  } catch { /* analytics best-effort */ }

  return NextResponse.json({ url: session.url, id: session.id });
}
