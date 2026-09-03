// Off-device notification sweep.
//
// Why this exists:
//   Every internal reminder the stylist gets — appointment timing, balance
//   due, retention nudges, business insights — was generated INSIDE the React
//   app, on a setInterval that only ticks while the app is open (see the
//   scheduler effect in AppRoot). Close the app and nothing runs; open it and
//   the backlog fires at once. That is exactly the reported symptom: "I have
//   to open the app to see that I received one."
//
//   This route runs the identical rule pipeline server-side on a schedule
//   (pg_cron → pg_net, see 20261242000000_notification_rules_cron.sql) so
//   reminders reach the phone with the app closed.
//
// Single source of truth:
//   It imports runNotificationRules / splitDeliverable / formatNotificationPayload
//   from app/lib directly — the SAME modules the client runs. Nothing is
//   reimplemented here, so the two can't drift. This route only supplies the
//   inputs (per-user data, a timezone-correct clock) and performs delivery.
//
// Timezone:
//   The rule generators build appointment starts with new Date(y, m-1, d, hh,
//   mm) — the process's local zone. That is the stylist's phone in the browser
//   but UTC here, so a 2 PM booking would read as 2 PM UTC and a "starts soon"
//   push would fire hours early. We feed the generators a shifted clock
//   instead of forking them; see app/lib/timezone.ts. A user with no stored
//   timezone is SKIPPED — silence beats a reminder at the wrong hour.
//
// Auth: internal-only. The caller presents the project service-role key as a
// Bearer token (constant-time compared), mirroring app/api/academy/reconcile
// and the send-push edge function. The cron job reads it from Supabase Vault.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { fromCloudRow } from "../../../lib/supabase";
import { runNotificationRules, splitDeliverable } from "../../../lib/notification-scheduler";
import {
  formatNotificationPayload,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationRule,
} from "../../../lib/notification-rules";
import { isValidTimeZone, todayIsoInTz, nowMsForTz } from "../../../lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bound every leg so one pathological account can't stall the whole sweep
// past pg_net's timeout.
const MAX_USERS_PER_RUN = 200;
const MAX_PUSHES_PER_USER = 5;
const DELIVERY_WINDOW_DAYS = 45;
// Appointments more than a day past are irrelevant to every generator, and
// the forward horizon only has to cover the 48h reminder plus retention math.
const APPT_LOOKBACK_DAYS = 120;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const constantTimeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

type UserOutcome = {
  userId: string;
  timezone: string;
  considered: number;
  sent: number;
  skipped?: string;
};

// Deliver one rule through the existing send-push edge function. Returns
// true only on a confirmed accepted send, so a failure leaves the rule
// un-recorded and it retries on the next tick.
const deliver = async (
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  rule: NotificationRule,
): Promise<boolean> => {
  const payload = formatNotificationPayload(rule);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ user_id: userId, payload }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    // send-push reports per-subscription results. Treat "accepted by at
    // least one endpoint" as delivered; a user whose every endpoint is dead
    // should retry next tick rather than burn the dedup entry.
    return Number((body as any)?.ok ?? 0) > 0;
  } catch {
    return false;
  }
};

const sweepUser = async (
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  timezone: string,
  now: Date,
): Promise<UserOutcome> => {
  const base: UserOutcome = { userId, timezone, considered: 0, sent: 0 };

  // Preferences live in the settings blob, same key the client reads.
  const { data: settingsRow } = await admin
    .from("settings")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  const preferences =
    ((settingsRow?.data as any)?.notification_preferences) || DEFAULT_NOTIFICATION_PREFERENCES;

  const since = new Date(now.getTime() - APPT_LOOKBACK_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const [
    apptRes, clientRes, deliveredRes,
    profileRes, servicesRes, availabilityRes, bookingLinkRes,
  ] = await Promise.all([
    admin.from("appointments").select("*").eq("user_id", userId).gte("appt_date", since),
    admin.from("clients").select("*").eq("user_id", userId),
    admin
      .from("notification_reminder_deliveries")
      .select("rule_id, delivered_at")
      .eq("user_id", userId)
      .gte(
        "delivered_at",
        new Date(now.getTime() - DELIVERY_WINDOW_DAYS * 86400_000).toISOString(),
      ),
    // Activation nudge signals. Every one of these is a plain count/flag
    // query — none needs fromCloudRow's camelCase merge, since the rule
    // generator only asks "is this done yet," not for the full record.
    admin
      .from("profiles")
      .select("business_name, full_name, subscription_started_at, stripe_connect_charges_enabled")
      .eq("id", userId)
      .maybeSingle(),
    admin.from("services").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin
      .from("availability_rules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_open", true),
    admin
      .from("booking_links")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("active", true),
  ]);

  // Map through the same cloud-row decoder the client uses, so the rule
  // generators see the exact record shape they expect (camelCase fields
  // merged over the data jsonb blob).
  const appointments = (apptRes.data || []).map((r) => fromCloudRow("appointments", r));
  const clients = (clientRes.data || []).map((r) => fromCloudRow("clients", r));

  const deliveredHistory: Record<string, string> = {};
  for (const row of (deliveredRes.data || []) as { rule_id: string; delivered_at: string }[]) {
    if (row?.rule_id) deliveredHistory[row.rule_id] = row.delivered_at;
  }

  const profileRow = profileRes.data as {
    business_name?: string | null;
    full_name?: string | null;
    subscription_started_at?: string | null;
    stripe_connect_charges_enabled?: boolean | null;
  } | null;

  const rules = runNotificationRules({
    clients,
    appointments,
    todayIso: todayIsoInTz(timezone, now),
    nowMs: nowMsForTz(timezone, now),
    preferences,
    deliveredHistory,
    activation: profileRow
      ? {
          signupIso: profileRow.subscription_started_at ?? null,
          businessNameSet: !!(profileRow.business_name || profileRow.full_name),
          servicesCount: servicesRes.count ?? 0,
          hasOpenAvailability: (availabilityRes.count ?? 0) > 0,
          bookingLinkActive: (bookingLinkRes.count ?? 0) > 0,
          stripeChargesEnabled: profileRow.stripe_connect_charges_enabled === true,
        }
      : null,
  });
  const { toSend } = splitDeliverable(rules, deliveredHistory, now);
  base.considered = toSend.length;

  for (const rule of toSend.slice(0, MAX_PUSHES_PER_USER)) {
    const ok = await deliver(supabaseUrl, serviceKey, userId, rule);
    if (!ok) continue;
    base.sent += 1;
    // Record only on a confirmed send. The ledger is what stops the client
    // scheduler from re-firing the same reminder when the app next opens,
    // so both paths stay deduped against each other.
    await admin
      .from("notification_reminder_deliveries")
      .upsert(
        { user_id: userId, rule_id: rule.id, delivered_at: new Date().toISOString() },
        { onConflict: "user_id,rule_id" },
      );
  }

  return base;
};

export async function POST(req: Request) {
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL")).replace(/\/$/, "");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch {
    // Deliberately generic: this runs BEFORE the bearer check (the service
    // key IS one of the values being read), so naming the missing variable
    // would leak deployment config to an unauthenticated caller.
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !constantTimeEqual(token, serviceKey)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();

  // Only users who can actually receive a push are worth sweeping.
  const { data: subs, error: subErr } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("enabled", true);
  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }
  const userIds = Array.from(new Set((subs || []).map((s: any) => s.user_id).filter(Boolean)));
  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, users: 0, sent: 0, results: [] });
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, timezone")
    .in("id", userIds.slice(0, MAX_USERS_PER_RUN));
  const tzById = new Map<string, string | null>(
    (profiles || []).map((p: any) => [p.id, p.timezone ?? null]),
  );

  const results: UserOutcome[] = [];
  for (const userId of userIds.slice(0, MAX_USERS_PER_RUN)) {
    const tz = tzById.get(userId);
    // No timezone yet (or a junk value) → skip. The client stamps it on the
    // next app open, so this self-heals; guessing UTC would fire reminders
    // at the wrong hour, which is worse than not firing at all.
    if (!isValidTimeZone(tz)) {
      results.push({
        userId,
        timezone: String(tz ?? ""),
        considered: 0,
        sent: 0,
        skipped: "no_timezone",
      });
      continue;
    }
    try {
      results.push(await sweepUser(admin, supabaseUrl, serviceKey, userId, tz, now));
    } catch (err) {
      // One bad account must never abort the sweep for everyone else.
      results.push({
        userId,
        timezone: tz,
        considered: 0,
        sent: 0,
        skipped: `error: ${(err as Error).message}`.slice(0, 120),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    users: results.length,
    sent: results.reduce((n, r) => n + r.sent, 0),
    skippedNoTimezone: results.filter((r) => r.skipped === "no_timezone").length,
    results,
  });
}
