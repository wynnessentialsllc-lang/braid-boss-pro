// POST /api/stripe-connect/status
//
// Auth required. Pulls the latest from Stripe (charges_enabled,
// payouts_enabled, details_submitted) and mirrors those into the
// profiles row. Returns the canonical status the UI renders.
// Called after the stylist returns from onboarding and on demand
// via a "Refresh status" button.

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

const deriveStatus = (
  chargesEnabled: boolean,
  detailsSubmitted: boolean,
): "not_connected" | "onboarding" | "active" | "restricted" => {
  if (chargesEnabled) return "active";
  if (detailsSubmitted) return "restricted";
  return "onboarding";
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

  const { data: profile } = await admin
    .from("profiles")
    .select(
      "stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_updated_at",
    )
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.stripe_connect_account_id) {
    return NextResponse.json({
      status: "not_connected",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
  }

  // Fetch the latest from Stripe.
  const stripeRes = await fetch(
    `${STRIPE_API}/accounts/${encodeURIComponent(profile.stripe_connect_account_id)}`,
    {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
      },
      cache: "no-store",
    },
  );
  if (!stripeRes.ok) {
    // Fall back to the cached values rather than 500'ing.
    return NextResponse.json({
      status: profile.stripe_connect_status || "onboarding",
      charges_enabled: !!profile.stripe_connect_charges_enabled,
      payouts_enabled: !!profile.stripe_connect_payouts_enabled,
      details_submitted: !!profile.stripe_connect_details_submitted,
      stale: true,
    });
  }
  const account = (await stripeRes.json()) as {
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
  };

  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const detailsSubmitted = !!account.details_submitted;
  const status = deriveStatus(chargesEnabled, detailsSubmitted);

  await admin
    .from("profiles")
    .update({
      stripe_connect_status: status,
      stripe_connect_charges_enabled: chargesEnabled,
      stripe_connect_payouts_enabled: payoutsEnabled,
      stripe_connect_details_submitted: detailsSubmitted,
      stripe_connect_updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return NextResponse.json({
    status,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
  });
}
