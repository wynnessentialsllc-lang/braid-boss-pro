// POST /api/stripe-connect/onboard
//
// Auth required. Creates a Stripe **Express** connected account for
// the signed-in stylist if one doesn't exist yet, persists the
// resulting `acct_XXX` to `profiles.stripe_connect_account_id`, then
// generates a Stripe-hosted onboarding URL via accountLinks.create
// (type=account_onboarding) and returns it. The browser redirects
// the stylist to that URL.
//
// Stripe redirects the stylist back to:
//   ${APP_PUBLIC_URL}/settings/payments?stripe_return=true   (success)
//   ${APP_PUBLIC_URL}/settings/payments?refresh=true         (link expired)
//
// The payments page reads those flags to sync charges_enabled /
// payouts_enabled / details_submitted from Stripe and update the UI.
//
// IMPORTANT: This route only produces Stripe-hosted Express onboarding
// URLs (connect.stripe.com/setup/...). It does not — and must not —
// redirect stylists to dashboard.stripe.com (that's the platform-owner
// surface).
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
  // Honour an explicit override (APP_PUBLIC_URL is the canonical one;
  // NEXT_PUBLIC_SITE_URL kept for backwards compat with earlier code).
  const explicit =
    process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
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
    // URL contract — stylist returns to /settings/payments with
    // ?stripe_return=true after completing onboarding, or
    // ?refresh=true when the original link expires. The page reads
    // either flag to trigger an immediate status sync.
    linkForm.set("return_url", `${baseUrl}/settings/payments?stripe_return=true`);
    linkForm.set("refresh_url", `${baseUrl}/settings/payments?refresh=true`);
    const link = await stripePost("/account_links", linkForm, stripeSecret);
    if (!link?.url) return fail(502, "Stripe didn't return an onboarding URL.");

    // Sanity log so prod can confirm the URL Stripe returned is the
    // Express setup link (connect.stripe.com/setup/...) and not the
    // platform-owner dashboard (dashboard.stripe.com/...).
    const linkUrl: string = String(link.url);
    let host = "";
    try { host = new URL(linkUrl).host; } catch { host = "<unparseable>"; }
    const looksRight = host.endsWith("connect.stripe.com");
    console.info(
      `[stripe-connect/onboard] account_link → host=${host} ${looksRight ? "(express ok)" : "(UNEXPECTED HOST)"} account=${accountId}`,
    );
    if (!looksRight) {
      console.warn(
        `[stripe-connect/onboard] Stripe returned a non-Express URL: ${linkUrl}`,
      );
    }

    return NextResponse.json({ url: linkUrl, account_id: accountId });
  } catch (e: any) {
    return fail(502, e?.message || "Stripe onboarding failed.");
  }
}
