// POST /api/sms-credits/autorecharge-setup — save a card for auto-recharge.
//
// Opens a Stripe Checkout session in `setup` mode: no charge, it just
// collects a card and attaches it to a Customer so later top-ups can
// run off-session. The resulting payment method is stored by the SMS
// webhook, never by the client — a browser can't nominate which card
// gets charged.
//
// A platform charge path, like the credit packs themselves. Nothing
// here touches the stylist's connected account.

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
    return "https://braidbosspro.app";
  }
};

export async function POST(req: Request) {
  let body: { access_token?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body.");
  }
  const accessToken = (body.access_token || "").trim();
  if (!accessToken) return fail(401, "Sign in to set up auto-recharge.");

  let stripeKey: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    stripeKey = env("STRIPE_SECRET_KEY");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return fail(500, e?.message || "Server is not configured.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;
  const email = userData.user.email || undefined;

  // Reuse the subscription customer when there is one so a stylist
  // doesn't accumulate a Stripe Customer per feature.
  let customerId: string | null = null;
  try {
    const { data: prof } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();
    customerId = (prof as any)?.stripe_customer_id || null;
  } catch {
    /* fall through — Checkout will create one */
  }

  const baseUrl = baseUrlOf(req);
  const form = new URLSearchParams();
  form.set("mode", "setup");
  form.set("success_url", `${baseUrl}/?autorecharge=saved`);
  form.set("cancel_url", `${baseUrl}/?autorecharge=cancelled`);
  form.set("metadata[purpose]", "sms_autorecharge_setup");
  form.set("metadata[user_id]", userId);
  // Mirrored onto the SetupIntent so the webhook can identify the
  // stylist from either object.
  form.set("setup_intent_data[metadata][purpose]", "sms_autorecharge_setup");
  form.set("setup_intent_data[metadata][user_id]", userId);
  if (customerId) form.set("customer", customerId);
  else if (email) form.set("customer_email", email);
  // Without this Stripe creates the SetupIntent for on-session use and
  // later off-session charges get declined for missing authentication.
  form.set("customer_creation", customerId ? "" : "always");
  if (!customerId) form.delete("customer_creation");

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = await res.json().catch(() => null) as any;
  if (!res.ok || !json?.url) {
    console.error("[autorecharge-setup] stripe error:", json?.error?.message || res.status);
    return fail(502, "Couldn't open the card form. Please try again.");
  }
  return NextResponse.json({ ok: true, url: json.url });
}
