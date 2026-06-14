// Poll a Boss Checkout card-payment session.
//
// After /api/checkout-charge mints a hosted Checkout link, the stylist's
// app polls this endpoint until the client finishes paying, then records
// the sale locally (the in-person flow keeps the app open at the chair, so
// a poll is simpler and self-contained — no webhook/table needed for v1).
//
// We retrieve the session on the stylist's CONNECTED account (via the
// Stripe-Account header), which scopes it to them, and return just the
// payment status + intent id.

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

export async function POST(req: Request) {
  let body: { access_token?: string; session_id?: string };
  try { body = await req.json(); }
  catch { return fail(400, "Invalid JSON body."); }

  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");
  const sessionId = body?.session_id?.trim();
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return fail(400, "Missing or malformed session id.");

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

  const { data: who, error: whoErr } = await admin.auth.getUser(accessToken);
  if (whoErr || !who?.user) return fail(401, "Could not identify the signed-in user.");

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", who.user.id)
    .maybeSingle();
  const acctId = profile?.stripe_connect_account_id || null;
  if (!acctId) return fail(409, "No connected Stripe account.");

  const res = await fetch(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Stripe-Account": acctId,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[checkout-charge/status] stripe error:", res.status, text.slice(0, 300));
    return fail(502, "Couldn't read the payment status.");
  }
  const session = (await res.json().catch(() => ({}))) as {
    payment_status?: string;
    status?: string;
    payment_intent?: string | { id?: string };
  };
  const pi = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id || null;

  return NextResponse.json({
    payment_status: session.payment_status || "unpaid", // "paid" | "unpaid" | "no_payment_required"
    status: session.status || "open",                   // "open" | "complete" | "expired"
    payment_intent: pi,
  });
}
