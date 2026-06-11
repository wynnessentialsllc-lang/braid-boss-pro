// POST /api/stripe-connect/terminal/enable
//
// Opt-in "turn on in-person payments (Tap to Pay)" for the signed-in
// stylist, and the readiness probe behind the self-test button. Kept
// SEPARATE from onboarding/checkout so it can never break those flows.
//
// On the stylist's CONNECTED account it:
//   1. Requests the `card_present` capability (what Tap to Pay needs).
//   2. Ensures a Terminal Location exists (Stripe requires one to register
//      the iPhone-as-reader), caching its id on profiles so we don't
//      recreate it every session.
//
// It doubles as the "do we need a Stripe ticket?" probe: if Stripe
// auto-grants card_present, no ticket is needed; if it stays inactive,
// that's surfaced so the operator knows to contact Stripe.
//
// Auth: Bearer JWT → stylist → profiles.stripe_connect_account_id, the
// same contract as the sibling /api/stripe-connect/* routes.
//
// Returns { ok, card_present, location_id, ready } or a friendly { error }.

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

const stripeHeaders = (secret: string, account?: string): Record<string, string> => {
  const h: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Stripe-Version": STRIPE_VERSION,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (account) h["Stripe-Account"] = account;
  return h;
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

  // Auth: resolve caller via Bearer JWT.
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(401, "Missing bearer token.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !user) return fail(401, "Invalid session.");

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_terminal_location_id")
    .eq("id", user.id)
    .maybeSingle();

  const acct = profile?.stripe_connect_account_id || null;
  if (!acct) {
    return fail(409, "Connect your Stripe account before enabling in-person payments.");
  }

  // 1. Request the card_present capability on the connected account. This
  //    is the probe: success = no ticket needed; a non-2xx tells us (and
  //    surfaces the reason) if the platform still needs Terminal enabled.
  const capForm = new URLSearchParams();
  capForm.set("capabilities[card_present][requested]", "true");
  const capRes = await fetch(`${STRIPE_API}/accounts/${encodeURIComponent(acct)}`, {
    method: "POST",
    headers: stripeHeaders(stripeSecret),
    body: capForm.toString(),
    cache: "no-store",
  });
  const account = (await capRes.json().catch(() => ({}))) as {
    capabilities?: { card_present?: string };
    business_profile?: { name?: string };
    individual?: { address?: Record<string, string | null> };
    company?: { address?: Record<string, string | null> };
    error?: { message?: string };
  };
  if (!capRes.ok) {
    return fail(
      502,
      account?.error?.message ||
        "Stripe couldn't enable in-person payments for this account. Tap to Pay may not be enabled for the platform yet.",
    );
  }
  const cardPresent = account?.capabilities?.card_present || "inactive";

  // 2. Ensure a Terminal Location (reuse cached → list → create).
  let locationId: string | null = profile?.stripe_terminal_location_id || null;
  if (!locationId) {
    try {
      const listRes = await fetch(`${STRIPE_API}/terminal/locations?limit=1`, {
        headers: stripeHeaders(stripeSecret, acct),
        cache: "no-store",
      });
      const list = (await listRes.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
      locationId = list?.data?.[0]?.id || null;
    } catch { /* fall through to create */ }
  }
  if (!locationId) {
    // Build the address from whatever the connected account already has
    // (collected during Connect onboarding); default to US country.
    const addr = account?.individual?.address || account?.company?.address || {};
    const locForm = new URLSearchParams();
    locForm.set("display_name", (account?.business_profile?.name || "Braid Boss Pro").slice(0, 80));
    locForm.set("address[country]", String(addr?.country || "US"));
    if (addr?.line1) locForm.set("address[line1]", String(addr.line1));
    if (addr?.city) locForm.set("address[city]", String(addr.city));
    if (addr?.state) locForm.set("address[state]", String(addr.state));
    if (addr?.postal_code) locForm.set("address[postal_code]", String(addr.postal_code));
    try {
      const locRes = await fetch(`${STRIPE_API}/terminal/locations`, {
        method: "POST",
        headers: stripeHeaders(stripeSecret, acct),
        body: locForm.toString(),
        cache: "no-store",
      });
      const loc = (await locRes.json().catch(() => ({}))) as { id?: string };
      if (locRes.ok && loc?.id) locationId = loc.id;
    } catch { /* non-fatal — the capability is the important part */ }
  }
  if (locationId && locationId !== profile?.stripe_terminal_location_id) {
    await admin.from("profiles").update({ stripe_terminal_location_id: locationId }).eq("id", user.id);
  }

  return NextResponse.json({
    ok: true,
    card_present: cardPresent, // "active" | "pending" | "inactive"
    location_id: locationId,
    // True once the capability is live and a location exists — the app
    // shows "Tap to Pay ready" only when both are set.
    ready: cardPresent === "active" && !!locationId,
  });
}
