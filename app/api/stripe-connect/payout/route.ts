// POST /api/stripe-connect/payout
//
// Auth required (Supabase access_token in the body, same contract as
// the other /api/stripe-connect/* routes). Lets a stylist sweep their
// available Stripe balance to their debit card *instantly* (Stripe
// Instant Payouts) instead of waiting for the default rolling payout.
//
// SUBSCRIBER-GATED. Instant cash-out is a paid-tier perk: the caller
// must hold lifetime/founding access or a live subscription
// (trialing / active / past_due). The check mirrors
// guest-limits.usePremiumStatus so the server is the source of truth —
// hiding the button client-side is not enough.
//
// Two modes, switched by the `probe` flag in the body:
//   { access_token, probe: true }
//       → returns the connected account's instant-available balance
//         without moving any money. Used to render the "X ready to
//         cash out" figure and enable/disable the button.
//   { access_token, amount? }
//       → creates an instant Payout on the connected account. When
//         `amount` (dollars) is omitted, sweeps the entire
//         instant-available balance. Returns the created payout.
//
// Never throws raw — Stripe's own error message is surfaced so the UI
// can tell the stylist exactly why a cash-out didn't go through (e.g.
// "Your debit card does not support Instant Payouts").

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

const cents = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n) / 100 : 0;

// Subscription statuses that count as live access. Kept in sync with
// guest-limits.isSubscriptionActive / premium.LIVE_SUB.
const LIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due"]);

type BalanceBucket = { amount?: number; currency?: string };

// Pick the bucket matching `currency` (default usd), falling back to
// the first entry. Stripe returns one bucket per currency.
const pickBucket = (buckets: BalanceBucket[] | undefined, currency: string): BalanceBucket | null => {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  return buckets.find((b) => (b?.currency || "").toLowerCase() === currency) || buckets[0];
};

export async function POST(req: Request) {
  let body: { access_token?: string; amount?: number; probe?: boolean };
  try { body = await req.json(); } catch { return fail(400, "Invalid JSON."); }
  const accessToken = body?.access_token?.trim();
  if (!accessToken) return fail(401, "Missing access_token.");
  const probe = body?.probe === true;

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
      "stripe_connect_account_id, stripe_connect_payouts_enabled, lifetime_access, founding_access, subscription_status",
    )
    .eq("id", userId)
    .maybeSingle();

  // ---- Subscriber gate -------------------------------------------------
  const subscriber =
    !!profile?.lifetime_access ||
    !!profile?.founding_access ||
    (!!profile?.subscription_status &&
      LIVE_SUBSCRIPTION_STATUSES.has(profile.subscription_status));
  if (!subscriber) {
    return fail(403, "Instant cash-out is available on the paid plan. Start your free trial to unlock it.");
  }

  // ---- Connect readiness ----------------------------------------------
  const accountId = profile?.stripe_connect_account_id;
  if (!accountId) {
    return fail(409, "Connect your Stripe account before cashing out.");
  }
  if (!profile?.stripe_connect_payouts_enabled) {
    return fail(409, "Stripe hasn't enabled payouts on your account yet. Finish onboarding first.");
  }

  // ---- Read the connected account's instant-available balance ---------
  let instantAvailableCents = 0;
  let currency = "usd";
  try {
    const balRes = await fetch(`${STRIPE_API}/balance`, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": accountId,
      },
      cache: "no-store",
    });
    const bal = await balRes.json().catch(() => ({}));
    if (!balRes.ok) {
      return fail(502, bal?.error?.message || "Couldn't read your Stripe balance.");
    }
    const bucket = pickBucket(bal?.instant_available as BalanceBucket[], currency);
    if (bucket) {
      instantAvailableCents = Math.max(0, Math.round(Number(bucket.amount) || 0));
      currency = (bucket.currency || currency).toLowerCase();
    }
  } catch {
    return fail(502, "Couldn't reach Stripe to read your balance.");
  }

  // Probe mode — just report what's available to cash out.
  if (probe) {
    return NextResponse.json({
      instant_available: cents(instantAvailableCents),
      currency,
    });
  }

  if (instantAvailableCents <= 0) {
    return fail(409, "No funds are available for instant cash-out right now.");
  }

  // ---- Resolve the payout amount (cents) ------------------------------
  // Omitted amount → sweep the full instant-available balance. An
  // explicit amount is clamped to what's actually available so a stale
  // client figure can't trigger a Stripe "insufficient funds" error.
  let payoutCents = instantAvailableCents;
  if (body?.amount != null) {
    const requested = Math.round(Number(body.amount) * 100);
    if (!Number.isFinite(requested) || requested <= 0) {
      return fail(400, "Enter a valid cash-out amount.");
    }
    payoutCents = Math.min(requested, instantAvailableCents);
  }

  // ---- Create the instant payout on the connected account -------------
  const form = new URLSearchParams();
  form.set("amount", String(payoutCents));
  form.set("currency", currency);
  form.set("method", "instant");
  form.set("metadata[stylist_user_id]", userId);
  form.set("metadata[source]", "braid_boss_instant_cashout");

  try {
    const res = await fetch(`${STRIPE_API}/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Stripe-Version": STRIPE_VERSION,
        "Stripe-Account": accountId,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    });
    const payout = await res.json().catch(() => ({}));
    if (!res.ok) {
      return fail(502, payout?.error?.message || "Stripe couldn't complete the instant payout.");
    }
    return NextResponse.json({
      ok: true,
      payout: {
        id: String(payout.id),
        amount: cents(payout.amount),
        currency: (payout.currency || currency).toLowerCase(),
        status: payout.status || "pending",
        arrival_date: payout.arrival_date
          ? new Date(payout.arrival_date * 1000).toISOString()
          : null,
      },
      // What's left after this sweep, so the UI can update without a
      // second round-trip.
      instant_available: cents(Math.max(0, instantAvailableCents - payoutCents)),
    });
  } catch {
    return fail(502, "Couldn't reach Stripe to start the payout.");
  }
}
