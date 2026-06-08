// Create a Stripe Billing Portal session so a subscriber can manage or
// cancel their Braid Boss Pro subscription and update their card.
//
// Looks up the user's stripe_customer_id (set by the subscription
// webhook) via the service role, then creates a portal session.
//
// NOTE: the Billing Portal must be enabled once in the Stripe dashboard
// (Settings → Billing → Customer portal). Until then Stripe returns an
// error which we surface to the caller.

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
  try { return new URL(req.url).origin; } catch { return ""; }
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

  // Auth: the caller MUST present a valid Supabase access token, and we
  // derive the user id from THAT — never from the request body. Trusting
  // a body-supplied userId would let anyone open another user's Stripe
  // billing portal (view their card/invoices, cancel their plan) just by
  // knowing their UUID. A leftover `userId` in the body is ignored.
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(401, "Missing access token.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !userData?.user) return fail(401, "Could not identify the signed-in user.");
  const userId = userData.user.id;

  const { data: profile, error } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  const customerId = profile?.stripe_customer_id;
  if (!customerId) {
    return fail(404, "No subscription found for this account.");
  }

  const form = new URLSearchParams();
  form.set("customer", String(customerId));
  form.set("return_url", `${baseUrlOf(req)}/?billing=done`);

  const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Version": "2024-06-20",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(502, `Couldn't open billing portal (${res.status}). ${text.slice(0, 200)}`);
  }
  const session = (await res.json()) as { url?: string };
  if (!session.url) return fail(502, "Stripe returned an unusable portal session.");
  return NextResponse.json({ url: session.url });
}
