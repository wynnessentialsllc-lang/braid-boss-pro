// POST /api/stripe-connect/next-payout
//
// Auth required (Supabase access_token in the body, same contract as the
// other /api/stripe-connect/* routes). Reports the stylist's *upcoming*
// automatic payout — the amount Stripe will deposit into their bank on
// their normal rolling schedule, and the date it's expected to land.
//
// This is the standard payout information every connected account gets
// for free. (Instant cash-out is a separate, Stripe-gated capability and
// is not surfaced here.)
//
// Returns:
//   {
//     currency,
//     amount,          // dollars — the next payout amount
//     pending,         // dollars — funds still settling (not yet payable)
//     arrival_date,    // ISO string | null — when the payout is expected
//     estimated,       // true when arrival_date is our estimate, false when
//                      // it comes from a real in-flight Stripe payout
//     interval,        // "daily" | "weekly" | "monthly" | "manual"
//     schedule_label,  // human string, e.g. "every business day"
//   }
//
// Never throws raw — Stripe read failures fall back to a soft response so
// the Payments page can always render something.

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

type BalanceBucket = { amount?: number; currency?: string };

// Pick the bucket matching `currency` (default usd), falling back to the
// first entry. Stripe returns one bucket per currency.
const pickBucket = (buckets: BalanceBucket[] | undefined, currency: string): BalanceBucket | null => {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  return buckets.find((b) => (b?.currency || "").toLowerCase() === currency) || buckets[0];
};

const sumBuckets = (buckets: BalanceBucket[] | undefined, currency: string): number => {
  if (!Array.isArray(buckets)) return 0;
  return buckets
    .filter((b) => (b?.currency || "").toLowerCase() === currency)
    .reduce((acc, b) => acc + (Math.round(Number(b.amount) || 0)), 0);
};

// ---- Date helpers (UTC; payout dates are calendar days) ----------------
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

const addBusinessDays = (from: Date, n: number): Date => {
  const d = new Date(from);
  let added = 0;
  while (added < Math.max(1, n)) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) added += 1;
  }
  return d;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

// Next occurrence of a weekday strictly after `from`.
const nextWeekday = (from: Date, anchorIndex: number): Date => {
  const d = new Date(from);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== anchorIndex);
  return d;
};

// Next occurrence of a day-of-month strictly after `from`, clamped to the
// number of days in the target month (so "31" lands on the last day of a
// short month).
const nextMonthlyAnchor = (from: Date, anchor: number): Date => {
  const build = (year: number, month: number) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchor, lastDay)));
  };
  let candidate = build(from.getUTCFullYear(), from.getUTCMonth());
  if (candidate <= from) candidate = build(from.getUTCFullYear(), from.getUTCMonth() + 1);
  return candidate;
};

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

type Schedule = {
  interval?: string;
  delay_days?: number;
  weekly_anchor?: string;
  monthly_anchor?: number;
};

const scheduleLabel = (schedule: Schedule): string => {
  switch (schedule.interval) {
    case "manual":
      return "when you release them in Stripe";
    case "weekly":
      return schedule.weekly_anchor
        ? `every ${capitalize(schedule.weekly_anchor)}`
        : "every week";
    case "monthly":
      return schedule.monthly_anchor
        ? `on the ${ordinal(schedule.monthly_anchor)} of each month`
        : "monthly";
    case "daily":
    default:
      return "every business day";
  }
};

// Estimate the next automatic-payout arrival date from the schedule. Used
// only when there is no concrete in-flight payout to read a real
// arrival_date from. Approximate — it doesn't account for bank holidays —
// which is why the response flags it as `estimated`.
const estimateArrival = (schedule: Schedule, now: Date): Date | null => {
  const delay = Number.isFinite(schedule.delay_days) ? Number(schedule.delay_days) : 2;
  switch (schedule.interval) {
    case "manual":
      return null;
    case "weekly": {
      const idx = WEEKDAY_INDEX[(schedule.weekly_anchor || "friday").toLowerCase()] ?? 5;
      return nextWeekday(now, idx);
    }
    case "monthly":
      return nextMonthlyAnchor(now, schedule.monthly_anchor || 1);
    case "daily":
    default:
      // Daily automatic payouts run each business day; the balance that's
      // already available lands about `delay`/next business day out.
      return addBusinessDays(now, Math.min(Math.max(delay, 1), 3));
  }
};

const stripeGet = async (path: string, secret: string, accountId?: string): Promise<{ ok: boolean; json: any }> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Stripe-Version": STRIPE_VERSION,
  };
  if (accountId) headers["Stripe-Account"] = accountId;
  const res = await fetch(`${STRIPE_API}${path}`, { headers, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
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
    .select("stripe_connect_account_id, stripe_connect_payouts_enabled")
    .eq("id", userId)
    .maybeSingle();

  const accountId = profile?.stripe_connect_account_id;
  if (!accountId) return fail(409, "Connect your Stripe account to see payouts.");
  if (!profile?.stripe_connect_payouts_enabled) {
    return fail(409, "Stripe hasn't enabled payouts on your account yet. Finish onboarding first.");
  }

  // ---- Balance: what's available (next payout) and still pending -------
  let currency = "usd";
  let availableCents = 0;
  let pendingCents = 0;
  {
    const { ok, json } = await stripeGet("/balance", stripeSecret, accountId);
    if (!ok) return fail(502, json?.error?.message || "Couldn't read your Stripe balance.");
    const avail = pickBucket(json?.available as BalanceBucket[], currency);
    if (avail?.currency) currency = String(avail.currency).toLowerCase();
    availableCents = Math.max(0, sumBuckets(json?.available as BalanceBucket[], currency));
    pendingCents = Math.max(0, sumBuckets(json?.pending as BalanceBucket[], currency));
  }

  // ---- Payout schedule (cadence + estimate the date from it) ----------
  let schedule: Schedule = { interval: "daily", delay_days: 2 };
  {
    const { ok, json } = await stripeGet(`/accounts/${encodeURIComponent(accountId)}`, stripeSecret);
    const s = ok ? json?.settings?.payouts?.schedule : null;
    if (s && typeof s === "object") schedule = s as Schedule;
  }

  // ---- Any payout already in flight? Its arrival_date is authoritative.
  let inFlight: { amount: number; arrival: number } | null = null;
  {
    const { ok, json } = await stripeGet("/payouts?limit=5", stripeSecret, accountId);
    if (ok && Array.isArray(json?.data)) {
      const upcoming = json.data.find(
        (p: any) => p?.status === "pending" || p?.status === "in_transit",
      );
      if (upcoming && Number.isFinite(upcoming.arrival_date)) {
        inFlight = {
          amount: Math.round(Number(upcoming.amount) || 0),
          arrival: Number(upcoming.arrival_date),
        };
      }
    }
  }

  const now = new Date();
  let amountCents: number;
  let arrivalIso: string | null;
  let estimated: boolean;

  if (inFlight) {
    // Money is already on its way — use the real amount and arrival date.
    amountCents = inFlight.amount;
    arrivalIso = new Date(inFlight.arrival * 1000).toISOString();
    estimated = false;
  } else {
    // Nothing in flight — the available balance is what pays out next.
    amountCents = availableCents;
    const est = amountCents > 0 ? estimateArrival(schedule, now) : null;
    arrivalIso = est ? est.toISOString() : null;
    estimated = est != null;
  }

  return NextResponse.json({
    currency,
    amount: cents(amountCents),
    pending: cents(pendingCents),
    arrival_date: arrivalIso,
    estimated,
    interval: schedule.interval || "daily",
    schedule_label: scheduleLabel(schedule),
  });
}
