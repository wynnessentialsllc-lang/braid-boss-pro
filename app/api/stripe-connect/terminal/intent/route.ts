// POST /api/stripe-connect/terminal/intent
//
// Creates a card-present PaymentIntent on the signed-in stylist's
// CONNECTED account for the in-app Tap to Pay on iPhone flow. The native
// Stripe Terminal SDK then collects the card and confirms this intent on
// the device; capture is automatic, so a `succeeded` PI means the money
// moved.
//
// Auth: Bearer JWT → stylist → profiles.stripe_connect_account_id, the
// same contract as the sibling /api/stripe-connect/* routes. Mirrors the
// no-show-charge PaymentIntent (amount/currency/fee/metadata) but with
// payment_method_types=card_present instead of an off-session card.
//
// Returns { ok, id, client_secret } or a friendly { error }.

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
    amount_cents?: number;
    appointment_id?: string;
    client_name?: string;
    currency?: string;
    description?: string;
  };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON body."); }

  const amountCents = Math.floor(Number(body?.amount_cents));
  if (!Number.isFinite(amountCents) || amountCents < 50) {
    return fail(400, "Enter an amount of at least $0.50.");
  }
  if (amountCents > 1_000_000) return fail(400, "That amount is too large.");

  const currency = (body?.currency || "usd").toLowerCase().slice(0, 3);
  const appointmentId = String(body?.appointment_id || "").trim();
  const clientName = String(body?.client_name || "").trim();
  const description =
    String(body?.description || "").trim() ||
    `In-person payment${clientName ? ` — ${clientName}` : ""}`;

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
    return fail(409, "Connect your Stripe account before taking a Tap to Pay payment.");
  }

  // Platform application fee in basis points (default 0), mirroring the
  // no-show charge and deposit checkout.
  const feeBps = (() => {
    const raw = Number(process.env.PLATFORM_FEE_BPS || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.floor(raw);
  })();
  const applicationFeeCents = feeBps > 0 ? Math.floor((amountCents * feeBps) / 10_000) : 0;

  const form = new URLSearchParams();
  form.set("amount", String(amountCents));
  form.set("currency", currency);
  form.set("payment_method_types[]", "card_present");
  form.set("capture_method", "automatic");
  form.set("description", description);
  if (clientName) form.set("metadata[client_name]", clientName);
  if (appointmentId) form.set("metadata[appointment_id]", appointmentId);
  form.set("metadata[kind]", "tap_to_pay");
  if (applicationFeeCents > 0) {
    form.set("application_fee_amount", String(applicationFeeCents));
  }

  let pi: any;
  try {
    const res = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": acctId,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    });
    pi = await res.json().catch(() => ({}));
    if (!res.ok || !pi?.client_secret) {
      return fail(502, pi?.error?.message || "Stripe couldn't create the charge.");
    }
  } catch {
    return fail(502, "Couldn't reach Stripe. Please try again.");
  }

  return NextResponse.json({ ok: true, id: pi.id, client_secret: pi.client_secret });
}
