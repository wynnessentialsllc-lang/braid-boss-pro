// POST /api/terminal/connection-token
//
// Tap to Pay on iPhone (Stripe Terminal). The Terminal SDK on the
// braider's phone needs a short-lived ConnectionToken to talk to
// Stripe; that token MUST be minted server-side so the platform secret
// never ships in the app. We scope it to the braider's connected
// account (Stripe-Account header) so the reader + payments live on
// THEIR account, not the platform's.
//
// Auth required (same access_token pattern as the other stripe-connect
// routes). The braider must have completed Connect onboarding — we read
// their connected account id off the profile. Returns { secret } which
// the native Terminal plugin hands to the SDK.
//
// Note: this is a new, isolated endpoint — it does not touch the
// existing onboarding/checkout flows. Until Stripe enables Tap to Pay
// (card_present) for the platform's connected accounts, the Stripe call
// may 400; we surface that as a clear, non-fatal error.

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

export async function POST(req: Request) {
  let body: { access_token?: string; location?: string };
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
    .select("stripe_connect_account_id, stripe_connect_charges_enabled")
    .eq("id", userId)
    .maybeSingle();

  const connectedAccountId = profile?.stripe_connect_account_id;
  if (!connectedAccountId) {
    return fail(409, "Connect your Stripe account before accepting in-person payments.");
  }

  // Mint the ConnectionToken on the braider's connected account. An
  // optional Location scopes the reader to a physical operating site;
  // we pass it through when the caller supplies one.
  const form = new URLSearchParams();
  if (body?.location?.trim()) form.set("location", body.location.trim());

  const stripeRes = await fetch(`${STRIPE_API}/terminal/connection_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": STRIPE_VERSION,
      "Stripe-Account": connectedAccountId,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });

  const payload = (await stripeRes.json().catch(() => ({}))) as {
    secret?: string;
    error?: { message?: string };
  };

  if (!stripeRes.ok || !payload?.secret) {
    // Most common cause before launch: Tap to Pay / Terminal isn't
    // enabled for the connected account yet. Surface Stripe's message
    // so it's actionable, but never 500 the app over it.
    return fail(
      502,
      payload?.error?.message ||
        "Couldn't start an in-person payment session. Tap to Pay may not be enabled on this account yet.",
    );
  }

  return NextResponse.json({ secret: payload.secret });
}
