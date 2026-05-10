// POST /api/stripe-connect/onboard
//
// Auth required. Creates a Stripe Express connected account for the
// signed-in stylist if one doesn't exist yet, then returns a fresh
// Stripe-hosted onboarding URL (`account_link`). The browser
// redirects to that URL; Stripe redirects the stylist back to
// NEXT_PUBLIC_SITE_URL/settings/payments?connect=ok (or ?connect=refresh
// if the link expired) where we poll /api/stripe-connect/status until
// charges_enabled flips true.
//
// Idempotent — re-calling reuses the existing acct id.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";

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

const stripePost = async (path: string, body: URLSearchParams, secret: string): Promise<any> => {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": STRIPE_VERSION,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `stripe_${res.status}`);
  }
  return json;
};

export async function POST(req: Request) {
  let body: { access_token?: string };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON."); }
  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");

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
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;
  const userEmail = userData.user.email || undefined;

  // Reuse or create the Express account.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, stripe_connect_account_id, business_name")
    .eq("id", userId)
    .maybeSingle();

  let accountId = profile?.stripe_connect_account_id || null;
  try {
    if (!accountId) {
      const form = new URLSearchParams();
      form.set("type", "express");
      form.set("country", "US");
      form.set("capabilities[card_payments][requested]", "true");
      form.set("capabilities[transfers][requested]", "true");
      if (userEmail) form.set("email", userEmail);
      form.set("metadata[stylist_user_id]", userId);
      const created = await stripePost("/accounts", form, stripeSecret);
      if (!created?.id) return fail(502, "Stripe didn't return an account id.");
      accountId = created.id as string;

      await admin
        .from("profiles")
        .upsert(
          {
            id: userId,
            stripe_connect_account_id: accountId,
            stripe_connect_status: "onboarding",
            stripe_connect_charges_enabled: false,
            stripe_connect_payouts_enabled: false,
            stripe_connect_details_submitted: false,
            stripe_connect_updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
    }

    const baseUrl = baseUrlOf(req);
    const linkForm = new URLSearchParams();
    linkForm.set("account", accountId);
    linkForm.set("type", "account_onboarding");
    linkForm.set("return_url", `${baseUrl}/settings/payments?connect=ok`);
    linkForm.set("refresh_url", `${baseUrl}/settings/payments?connect=refresh`);
    const link = await stripePost("/account_links", linkForm, stripeSecret);
    if (!link?.url) return fail(502, "Stripe didn't return an onboarding URL.");

    return NextResponse.json({ url: link.url, account_id: accountId });
  } catch (e: any) {
    return fail(502, e?.message || "Stripe onboarding failed.");
  }
}
