// Create a Stripe Checkout Session for an SMS credit pack.
//
// A platform charge — Braid Boss Pro charging the stylist directly
// for prepaid SMS credits (NOT a Connect charge). Mirrors the
// founding-checkout route.
//
// The buyer is a signed-in stylist: the request carries their
// Supabase access token, which we verify server-side so the
// credited account can't be spoofed. The pack is validated against
// the canonical SMS_PACKS list — client-supplied prices are ignored.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findSmsPack } from "../../../lib/sms-packs";

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

  // Verify the caller — the access token determines which account
  // gets credited, so it must come from a real signed-in session.
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return fail(401, "Sign in to buy credits.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userErr || !userId) return fail(401, "Your session has expired. Sign in again.");

  let body: { pack?: string } = {};
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const pack = findSmsPack(String(body?.pack || "").trim());
  if (!pack) return fail(400, "Unknown credit pack.");

  // Pre-insert a pending purchase row so the webhook can find it by
  // session id on checkout.session.completed.
  const { data: purchase, error: purchaseErr } = await admin
    .from("sms_credit_purchases")
    .insert({
      user_id: userId,
      pack_id: pack.id,
      credits: pack.credits,
      amount_cents: pack.priceCents,
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (purchaseErr || !purchase?.id) {
    return fail(500, purchaseErr?.message || "Couldn't start the purchase.");
  }

  const baseUrl = baseUrlOf(req);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(pack.priceCents));
  form.set(
    "line_items[0][price_data][product_data][name]",
    `Braid Boss Pro · ${pack.credits} SMS credits`,
  );
  form.set(
    "line_items[0][price_data][product_data][description]",
    `${pack.label} pack · ${pack.credits} text messages`,
  );
  // Credits are fulfilled by the webhook (record_sms_credit_purchase),
  // so the return page just needs to land the stylist back in the app —
  // NOT /payment-success, which is the lifetime-access verifier and
  // errors without a session_id. Balance refreshes when the SMS credits
  // screen reopens.
  form.set("success_url", `${baseUrl}/?sms_credits=success`);
  form.set("cancel_url", `${baseUrl}/?sms_credits=cancelled`);
  form.set("metadata[purpose]", "sms_credits");
  form.set("metadata[sms_credit_purchase_id]", String(purchase.id));
  form.set("metadata[user_id]", userId);
  form.set("metadata[credits]", String(pack.credits));
  form.set("payment_intent_data[metadata][purpose]", "sms_credits");
  form.set("payment_intent_data[metadata][sms_credit_purchase_id]", String(purchase.id));

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
    await admin
      .from("sms_credit_purchases")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", purchase.id);
    return fail(502, `Stripe rejected the session (${stripeRes.status}). ${text.slice(0, 200)}`);
  }
  const session = (await stripeRes.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) {
    await admin.from("sms_credit_purchases").update({ status: "failed" }).eq("id", purchase.id);
    return fail(502, "Stripe returned an unusable session.");
  }

  await admin
    .from("sms_credit_purchases")
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq("id", purchase.id);

  return NextResponse.json({ url: session.url });
}
