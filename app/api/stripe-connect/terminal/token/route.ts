// POST /api/stripe-connect/terminal/token
//
// Bootstraps in-app Tap to Pay on iPhone (Stripe Terminal SDK) for the
// signed-in stylist's CONNECTED account. The native plugin needs two
// things before it can connect a Tap to Pay reader:
//
//   1. A Terminal *connection token* (short-lived) — the SDK trades this
//      for a session with Stripe.
//   2. A Terminal *location id* — Tap to Pay readers register against a
//      location. We reuse the account's existing location if it has one,
//      otherwise we create one from the connected account's own address
//      (so we never invent an address or need a new DB column).
//
// Auth: Bearer JWT → stylist → profiles.stripe_connect_account_id, the
// same contract the other /api/stripe-connect/* routes use.
//
// Returns { ok, secret, location_id } or a friendly { error }.

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

// Pull a usable postal address off the connected account. Tap to Pay
// location creation requires at least country + line1; we surface the
// best address Stripe has (support address → company → individual).
const addressFromAccount = (acct: any): Record<string, string> | null => {
  const candidates = [
    acct?.business_profile?.support_address,
    acct?.company?.address,
    acct?.individual?.address,
  ];
  for (const a of candidates) {
    if (a && a.country && a.line1) {
      const out: Record<string, string> = { country: a.country, line1: a.line1 };
      if (a.line2) out.line2 = a.line2;
      if (a.city) out.city = a.city;
      if (a.state) out.state = a.state;
      if (a.postal_code) out.postal_code = a.postal_code;
      return out;
    }
  }
  return null;
};

// Find an existing Terminal location on the connected account, or create
// one. Returns the location id, or null with a reason the caller maps to
// a friendly error.
const ensureLocation = async (
  secret: string,
  acctId: string,
): Promise<{ id: string } | { error: string }> => {
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Stripe-Version": STRIPE_VERSION,
    "Stripe-Account": acctId,
  };

  // 1) Reuse the first location if one already exists.
  try {
    const res = await fetch(`${STRIPE_API}/terminal/locations?limit=1`, {
      headers,
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(json?.data) && json.data[0]?.id) {
      return { id: json.data[0].id };
    }
  } catch {
    /* fall through to create */
  }

  // 2) Otherwise create one from the connected account's address. We
  // retrieve the account on the PLATFORM (no Stripe-Account header).
  let address: Record<string, string> | null = null;
  let displayName = "Tap to Pay";
  try {
    const acctRes = await fetch(`${STRIPE_API}/accounts/${acctId}`, {
      headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": STRIPE_VERSION },
      cache: "no-store",
    });
    const acct = await acctRes.json().catch(() => ({}));
    if (acctRes.ok) {
      address = addressFromAccount(acct);
      const name =
        acct?.business_profile?.name ||
        acct?.settings?.dashboard?.display_name ||
        null;
      if (name) displayName = String(name).slice(0, 100);
    }
  } catch {
    /* handled below */
  }

  if (!address) {
    return {
      error:
        "Add your business address in Stripe before using Tap to Pay — Stripe needs it to register the reader.",
    };
  }

  const form = new URLSearchParams();
  form.set("display_name", displayName);
  for (const [k, v] of Object.entries(address)) {
    form.set(`address[${k}]`, v);
  }

  try {
    const res = await fetch(`${STRIPE_API}/terminal/locations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.id) return { id: json.id };
    return { error: json?.error?.message || "Couldn't set up a Tap to Pay location." };
  } catch {
    return { error: "Couldn't reach Stripe to set up Tap to Pay." };
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
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .maybeSingle();
  const acctId = profile?.stripe_connect_account_id || null;
  if (!acctId) {
    return fail(409, "Connect your Stripe account before using Tap to Pay.");
  }

  // Terminal location (find-or-create) for the reader to register against.
  const loc = await ensureLocation(stripeSecret, acctId);
  if ("error" in loc) return fail(422, loc.error);

  // Connection token on the connected account.
  let secret: string | null = null;
  try {
    const res = await fetch(`${STRIPE_API}/terminal/connection_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": acctId,
        "content-type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.secret) {
      return fail(502, json?.error?.message || "Stripe couldn't start a Tap to Pay session.");
    }
    secret = json.secret;
  } catch {
    return fail(502, "Couldn't reach Stripe. Please try again.");
  }

  return NextResponse.json({ ok: true, secret, location_id: loc.id });
}
