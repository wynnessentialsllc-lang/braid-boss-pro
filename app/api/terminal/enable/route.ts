// POST /api/terminal/enable
//
// Opt-in "turn on in-person payments (Tap to Pay)" for a braider. This
// is intentionally SEPARATE from onboarding so it can never break
// signups: if Terminal isn't enabled for the platform yet, only this
// call fails — new-braider onboarding is untouched.
//
// It does two things on the braider's connected account:
//   1. Requests the `card_present` capability (what Tap to Pay needs).
//   2. Ensures a Terminal Location exists (Stripe requires one to
//      register the iPhone-as-reader), reusing the cached id when set.
//
// It also doubles as the probe that answers "do we need a Stripe
// support ticket?": if Stripe auto-grants card_present, no ticket is
// needed; if it rejects with "Terminal not enabled for the platform,"
// that message is returned verbatim so the braider/operator knows to
// contact Stripe.
//
// Auth: same access_token pattern as the other stripe-connect routes.

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
    .select("stripe_connect_account_id, stripe_terminal_location_id")
    .eq("id", userId)
    .maybeSingle();

  const acct = profile?.stripe_connect_account_id;
  if (!acct) return fail(409, "Connect your Stripe account before enabling in-person payments.");

  // 1. Request the card_present capability on the connected account.
  //    This is the probe: success = no ticket needed; a 400 here tells
  //    us (and surfaces the reason) if the platform needs enabling.
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
    } catch { /* non-fatal — capability is the important part */ }
  }
  if (locationId && locationId !== profile?.stripe_terminal_location_id) {
    await admin.from("profiles").update({ stripe_terminal_location_id: locationId }).eq("id", userId);
  }

  return NextResponse.json({
    card_present: cardPresent,       // "active" | "pending" | "inactive"
    location_id: locationId,
    // True once the capability is live and a location exists — the app
    // can show "Tap to Pay ready" only when both are set.
    ready: cardPresent === "active" && !!locationId,
  });
}
