// POST /api/stripe-tax
//
// Auth required. Configures Stripe Tax on the signed-in stylist's CONNECTED
// (Express) account so the storefront checkout can collect sales tax.
//
// Express accounts can't self-serve Stripe Tax in their limited dashboard, so
// the platform sets it up on their behalf via the connected account's Tax
// APIs (everything below carries the `Stripe-Account` header):
//
//   1. POST /v1/tax/settings        — head-office (business) address + a
//                                      default tax behavior → activates tax.
//   2. POST /v1/tax/registrations   — one per state the stylist attests they
//                                      are registered to collect in.
//
// Registrations are a legal statement, so this requires an explicit
// acknowledgement and only registers the states the stylist selected. Once
// configured, shop_settings is updated (active flag, states, business
// address, acknowledgement) and tax collection is switched on.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";

// US states + DC. Used to validate the selected registration jurisdictions.
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};
const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

const stripeReq = async (
  method: "GET" | "POST",
  path: string,
  account: string,
  secret: string,
  body?: URLSearchParams,
): Promise<any> => {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": STRIPE_VERSION,
      "Stripe-Account": account,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? body.toString() : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `stripe_${res.status}`);
  }
  return json;
};

export async function POST(req: Request) {
  let body: {
    access_token?: string;
    acknowledge?: boolean;
    business_address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
    };
    states?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON.");
  }

  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");
  if (body?.acknowledge !== true) {
    return fail(400, "You must acknowledge the tax responsibility statement.");
  }

  const addr = body?.business_address || {};
  const line1 = String(addr.line1 || "").trim();
  const city = String(addr.city || "").trim();
  const state = String(addr.state || "").trim().toUpperCase();
  const postal = String(addr.postal_code || "").trim();
  const line2 = String(addr.line2 || "").trim();
  if (!line1 || !city || !state || !postal) {
    return fail(400, "Enter your full business address (street, city, state, ZIP).");
  }
  if (!US_STATES.has(state)) {
    return fail(400, "Business address state must be a valid US state.");
  }

  const states = Array.from(
    new Set(
      (Array.isArray(body?.states) ? body.states : [])
        .map((s) => String(s || "").trim().toUpperCase())
        .filter((s) => US_STATES.has(s)),
    ),
  );
  if (states.length === 0) {
    return fail(400, "Select at least one state where you're registered to collect tax.");
  }

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
  const accountId = profile?.stripe_connect_account_id || null;
  if (!accountId) {
    return fail(409, "Connect your Stripe account before setting up tax.");
  }

  try {
    // 1) Activate tax settings (head-office address + default behavior +
    // a fallback product tax code so automatic tax always has a code to use).
    const settingsForm = new URLSearchParams();
    settingsForm.set("defaults[tax_behavior]", "exclusive");
    settingsForm.set("defaults[tax_code]", "txcd_99999999"); // General - Tangible Goods
    settingsForm.set("head_office[address][line1]", line1);
    if (line2) settingsForm.set("head_office[address][line2]", line2);
    settingsForm.set("head_office[address][city]", city);
    settingsForm.set("head_office[address][state]", state);
    settingsForm.set("head_office[address][postal_code]", postal);
    settingsForm.set("head_office[address][country]", "US");
    await stripeReq("POST", "/tax/settings", accountId, stripeSecret, settingsForm);

    // 2) Read existing active registrations so we don't double-register a
    // state the stylist already has on file.
    const existing = await stripeReq(
      "GET",
      "/tax/registrations?status=active&limit=100",
      accountId,
      stripeSecret,
    );
    const already = new Set<string>(
      (Array.isArray(existing?.data) ? existing.data : [])
        .map((r: any) => String(r?.country_options?.us?.state || "").toUpperCase())
        .filter(Boolean),
    );

    for (const st of states) {
      if (already.has(st)) continue;
      const regForm = new URLSearchParams();
      regForm.set("country", "US");
      regForm.set("country_options[us][type]", "state_sales_tax");
      regForm.set("country_options[us][state]", st);
      regForm.set("active_from", "now");
      await stripeReq("POST", "/tax/registrations", accountId, stripeSecret, regForm);
    }

    // Union of what we requested with anything already registered.
    const allStates = Array.from(new Set([...already, ...states])).sort();

    // 3) Persist setup + switch collection on.
    const { error: upErr } = await admin.from("shop_settings").upsert(
      {
        user_id: userId,
        tax_business_line1: line1,
        tax_business_line2: line2 || null,
        tax_business_city: city,
        tax_business_state: state,
        tax_business_postal_code: postal,
        tax_registered_states: allStates,
        tax_settings_active: true,
        tax_enabled: true,
        tax_legal_acknowledged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upErr) return fail(500, upErr.message);

    return NextResponse.json({ ok: true, active: true, states: allStates });
  } catch (e: any) {
    return fail(502, e?.message || "Stripe tax setup failed.");
  }
}
