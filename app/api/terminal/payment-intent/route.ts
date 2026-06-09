// POST /api/terminal/payment-intent
//
// Tap to Pay on iPhone (Stripe Terminal). Creates the card_present
// PaymentIntent the on-device SDK collects + confirms when a braider
// taps a client's card at the chair. Created on the braider's connected
// account (Stripe-Account header) so funds land on THEIR balance, like
// the rest of the Connect flow. No platform application fee — Braid Boss
// Pro is subscription-funded and takes 0% of in-person payments.
//
// The happy path reconciles client-side: once the SDK reports success,
// the app marks the appointment paid via the existing Checkout path
// (paymentMethod "tap_to_pay" + this PaymentIntent id). This endpoint
// only mints the intent; it does not touch onboarding or checkout.
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

export async function POST(req: Request) {
  let body: {
    access_token?: string;
    amount?: number;
    currency?: string;
    appointment_id?: string;
    description?: string;
  };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON."); }

  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");

  // Amount is in the smallest currency unit (cents). Guard against
  // zero/negative and absurd values so a bad client can't mint junk.
  const amount = Math.round(Number(body?.amount) || 0);
  if (!Number.isFinite(amount) || amount <= 0) return fail(400, "A positive amount is required.");
  if (amount > 100_000_00) return fail(400, "Amount exceeds the in-person limit.");
  const currency = (body?.currency || "usd").trim().toLowerCase();

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
    .select("stripe_connect_account_id")
    .eq("id", userId)
    .maybeSingle();

  const connectedAccountId = profile?.stripe_connect_account_id;
  if (!connectedAccountId) {
    return fail(409, "Connect your Stripe account before accepting in-person payments.");
  }

  const form = new URLSearchParams();
  form.set("amount", String(amount));
  form.set("currency", currency);
  // card_present is the Tap to Pay payment method type. Automatic
  // capture so the sale settles as soon as the tap confirms — same as
  // any in-person checkout.
  form.set("payment_method_types[]", "card_present");
  form.set("capture_method", "automatic");
  if (body?.description?.trim()) form.set("description", body.description.trim().slice(0, 200));
  // Stamp provenance so the success webhook (and any reconciliation)
  // can tie the intent back to the appointment + know it was a tap.
  form.set("metadata[source]", "tap_to_pay");
  form.set("metadata[user_id]", userId);
  if (body?.appointment_id?.trim()) {
    form.set("metadata[appointment_id]", body.appointment_id.trim());
  }

  const stripeRes = await fetch(`${STRIPE_API}/payment_intents`, {
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
    id?: string;
    client_secret?: string;
    error?: { message?: string };
  };

  if (!stripeRes.ok || !payload?.id || !payload?.client_secret) {
    return fail(
      502,
      payload?.error?.message ||
        "Couldn't start the in-person charge. Tap to Pay may not be enabled on this account yet.",
    );
  }

  return NextResponse.json({ id: payload.id, client_secret: payload.client_secret });
}
