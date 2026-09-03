// Pure rule generators that turn state into actionable internal
// notifications. No React, no side effects, easy to unit test.
//
// Output is a NotificationRule[] that the scheduler dedupes and the
// dispatcher delivers via the existing push-subscriptions pipeline.
// These are *internal* alerts for the salon owner, NOT outbound
// client communications — those still live exclusively in commLog.

import { isRebookingMuted } from "./rebooking/rebooking-intelligence";
import { encodeTargetUrl, type PushTarget } from "./notification-target-url";

export type NotificationCategory = "appointment" | "balance" | "retention" | "business";
export type NotificationPriority = "low" | "medium" | "high";

export type NotificationRule = {
  id: string;                 // stable per (kind, ref); used for dedup
  kind: string;               // e.g. "appt_24h", "balance_today"
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  appointmentId?: string;
  clientId?: string;
  scheduledFor?: string;      // ISO; "when this would fire". For
                              // immediate alerts, omit (now).
  windowStart?: string;       // ISO; earliest acceptable delivery
  windowEnd?: string;         // ISO; latest acceptable delivery
  action?: { label: string; target: string };
};

export type NotificationPreferences = {
  appointmentReminders: boolean;
  balanceReminders: boolean;
  retentionReminders: boolean;
  businessInsights: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  appointmentReminders: true,
  balanceReminders: true,
  retentionReminders: true,
  businessInsights: true,
};

const isFinite_ = Number.isFinite;
const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite_(n) ? n : 0;
};
const safeArr = <T,>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : [];
const isCanceledStatus = (status: unknown): boolean =>
  status === "cancelled" || status === "canceled";
const isCanceledAppointment = (a: any): boolean => isCanceledStatus(a?.status);
// A booking still waiting on its deposit isn't confirmed yet, so it must
// not trigger timing reminders ("starts soon", "tomorrow", etc.). Mirrors
// the calendar's "deposit due" detection: a deposit is only outstanding
// when the appointment actually requires one and none has been paid.
// Manually-created appointments default to depositRequired=false, so a
// zero depositPaid alone never flags them as awaiting deposit.
const isAwaitingDeposit = (a: any): boolean =>
  a?.depositRequired === true && num(a?.depositPaid) <= 0;
const cleanIso = (date: string, time: string): string | null => {
  if (!date) return null;
  const t = time || "10:00";
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  if (!isFinite_(dt.getTime())) return null;
  return dt.toISOString();
};
const isoToMs = (iso: string | null | undefined): number => {
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return isFinite_(t) ? t : NaN;
};
// Numeric M/D/YYYY date for notification copy, e.g. "2026-06-13" → "6/13/2026".
// Renders the stored wall-clock date as-is (no timezone shift) so the
// pop-up matches what the stylist booked.
const fmtDateNumeric = (date: string): string => {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return date;
  }
  return `${m}/${d}/${y}`;
};

// 12-hour clock for in-app notification copy. Drops ":00" on the
// hour so "10:00" reads as "10 AM" — matches the canonical fmtTime
// helper in app/page.tsx.
const fmtClock = (date: string, time: string): string => {
  const t = time || "10:00";
  const [hh, mm] = t.split(":").map(Number);
  if (!Number.isFinite(hh)) return t;
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = (hh % 12) || 12;
  const mins = Number.isFinite(mm) ? mm : 0;
  return mins === 0
    ? `${h12} ${period}`
    : `${h12}:${String(mins).padStart(2, "0")} ${period}`;
};

// ---- rule generators ---------------------------------------------------

export const getAppointmentReminderNotifications = (
  appointments: any[],
  nowMs: number,
  prefs: NotificationPreferences,
): NotificationRule[] => {
  if (!prefs.appointmentReminders) return [];
  const out: NotificationRule[] = [];
  const TWO_H = 2 * 3600_000;
  const SAME_DAY_WINDOW = 6 * 3600_000; // anything inside 6h-of counts as "same day" if not yet 2h
  const TWENTY_FOUR_H = 24 * 3600_000;
  const FORTY_EIGHT_H = 48 * 3600_000;

  for (const a of safeArr(appointments)) {
    if (!a?.id || !a.date) continue;
    if (isCanceledAppointment(a) || a.status === "completed" || a.status === "no_show") continue;
    // Don't remind about an unconfirmed booking whose deposit is unpaid.
    if (isAwaitingDeposit(a)) continue;
    // Personal / blocked time (kind !== "appointment") isn't a client
    // booking, and a row with no client name produces a vague
    // "your client" pop-up. Skip both so every reminder names a real
    // client — mirrors the kind filter in getBalanceDueNotifications.
    if (a.kind && a.kind !== "appointment") continue;
    const clientName =
      typeof a.clientName === "string" ? a.clientName.trim() : "";
    if (!clientName) continue;
    const startIso = cleanIso(a.date, a.time);
    const startMs = isoToMs(startIso);
    if (!isFinite_(startMs)) continue;
    const delta = startMs - nowMs;
    if (delta < 0) continue; // already happened

    const style = a.style || "the appointment";
    const at = fmtClock(a.date, a.time);
    const on = fmtDateNumeric(a.date);

    const push = (kind: string, title: string, body: string, priority: NotificationPriority = "medium") => {
      out.push({
        id: `${kind}:${a.id}`,
        kind,
        category: "appointment",
        priority,
        title,
        body,
        appointmentId: a.id,
        clientId: a.clientId,
        scheduledFor: startIso || undefined,
        action: { label: "View appointment", target: `appointment:${a.id}` },
      });
    };

    if (delta <= FORTY_EIGHT_H && delta > TWENTY_FOUR_H) {
      push("appt_48h", `${clientName} in 2 days`, `${style} on ${on} at ${at}.`);
    } else if (delta <= TWENTY_FOUR_H && delta > SAME_DAY_WINDOW) {
      push("appt_24h", `${clientName} tomorrow`, `${style} at ${at}.`, "high");
    } else if (delta <= SAME_DAY_WINDOW && delta > TWO_H) {
      push("appt_same_day", `${clientName} today`, `${style} at ${at}.`, "high");
    } else if (delta <= TWO_H) {
      push("appt_2h", `${clientName} starts soon`, `${style} at ${at} — about ${Math.max(1, Math.round(delta / 60000))} min away.`, "high");
    }
  }
  return out;
};

export const getBalanceDueNotifications = (
  appointments: any[],
  todayIso: string,
  prefs: NotificationPreferences,
): NotificationRule[] => {
  if (!prefs.balanceReminders) return [];
  // One consolidated "who's on the books today + what they owe" alert,
  // instead of a separate pop-up per appointment (and per overdue
  // balance). Lists today's scheduled clients with their outstanding
  // balance so the stylist sees the day at a glance in a single notice.
  const todays = safeArr(appointments)
    .filter(a =>
      a?.id
      && (!a.kind || a.kind === "appointment")
      && !isCanceledAppointment(a)
      && a.status !== "no_show"
      && (a.date || "") === todayIso,
    )
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  if (todays.length === 0) return [];

  let totalDue = 0;
  const parts = todays.map(a => {
    const balance = Math.max(0, num(a.balanceDue));
    totalDue += balance;
    const name = a.clientName || "Client";
    return balance > 0 ? `${name} · $${balance.toFixed(2)} due` : `${name} · paid`;
  });
  const MAX = 5;
  const shown = parts.slice(0, MAX);
  const extra = parts.length - shown.length;
  const body = shown.join(" · ") + (extra > 0 ? ` · +${extra} more` : "");
  const count = todays.length;

  return [{
    id: `today_clients:${todayIso}`,
    kind: "today_clients",
    category: "balance",
    priority: totalDue > 0 ? "high" : "medium",
    title: `${count} ${count === 1 ? "client" : "clients"} today${totalDue > 0 ? ` · $${totalDue.toFixed(2)} to collect` : ""}`,
    body,
    action: { label: "View schedule", target: "tab:schedule" },
  }];
};

export const getRetentionNotifications = (
  clients: any[],
  appointments: any[],
  todayIso: string,
  prefs: NotificationPreferences,
  vipThreshold: number = 800,
): NotificationRule[] => {
  if (!prefs.retentionReminders) return [];
  const out: NotificationRule[] = [];
  const ms = (iso: string) => new Date(iso + "T00:00:00").getTime();
  const todayMs = ms(todayIso);
  const apptsByClient: Record<string, any[]> = {};
  for (const a of safeArr(appointments)) {
    if (!a?.clientId) continue;
    (apptsByClient[a.clientId] ||= []).push(a);
  }

  for (const c of safeArr(clients)) {
    if (!c?.id) continue;
    // Honor the same "Pause reminders" controls the in-app rebooking
    // surface respects (rebookingOptOut / rebookingSnoozedUntil). Without
    // this the push pipeline kept re-firing "due for rebooking" pop-ups
    // for a client the owner had explicitly snoozed or stopped — the
    // notification that wouldn't stay dismissed.
    if (isRebookingMuted(c, todayIso)) continue;
    const mine = apptsByClient[c.id] || [];
    if (mine.length === 0) continue;
    const completed = mine.filter(a => a.status === "completed" || a.paymentStatus === "paid");
    if (completed.length === 0) continue;
    const lifetimeValue = completed.reduce((s, a) => s + num(a.depositPaid || a.totalPrice), 0);
    const upcoming = mine.find(a => a.date >= todayIso && !isCanceledAppointment(a) && a.status !== "completed");
    if (upcoming) continue; // already booked, no nudge needed

    const lastDate = completed.map(a => a.date).filter(Boolean).sort().pop();
    if (!lastDate) continue;
    const days = Math.round((todayMs - ms(lastDate)) / 86400_000);
    if (days < 30) continue;

    const isVip = lifetimeValue >= vipThreshold && completed.length >= 3;
    const clientName = c.name || "Client";

    if (isVip && days >= 30) {
      out.push({
        id: `retention_vip:${c.id}`,
        kind: "retention_vip_inactive",
        category: "retention",
        priority: "high",
        title: `VIP client inactive · ${clientName}`,
        body: `${days} days since their last visit. Consider a personal rebooking nudge.`,
        clientId: c.id,
        action: { label: "Send rebooking reminder", target: `client:${c.id}` },
      });
    } else if (days >= 90) {
      out.push({
        id: `retention_atrisk:${c.id}`,
        kind: "retention_at_risk",
        category: "retention",
        priority: "medium",
        title: `${clientName} hasn't returned`,
        body: `${days} days since their last visit.`,
        clientId: c.id,
        action: { label: "Send rebooking reminder", target: `client:${c.id}` },
      });
    } else if (days >= 42) {
      out.push({
        id: `retention_due:${c.id}`,
        kind: "retention_due",
        category: "retention",
        priority: "medium",
        title: `${clientName} due for rebooking`,
        body: `${days} days since their last visit — likely time for a touch-up.`,
        clientId: c.id,
        action: { label: "Send rebooking reminder", target: `client:${c.id}` },
      });
    }
  }
  return out
    .sort((a, b) => (a.priority === "high" && b.priority !== "high" ? -1 : 0))
    .slice(0, 8); // cap so the bell doesn't flood
};

export const getBusinessInsightNotifications = (
  state: { appointments: any[]; today: string },
  prefs: NotificationPreferences,
): NotificationRule[] => {
  if (!prefs.businessInsights) return [];
  const out: NotificationRule[] = [];
  const today = state.today;
  const todays = safeArr(state.appointments)
    .filter(a => a?.date === today && !isCanceledAppointment(a));

  // Quiet-day nudge only. The "X appointments today" and the aggregate
  // "$X in pending balances" notices were removed — today's schedule and
  // what each client owes now come through one consolidated alert (see
  // getBalanceDueNotifications), so the app no longer fires several
  // balance pop-ups on open.
  if (todays.length === 0) {
    out.push({
      id: `insight_no_appts_today:${today}`,
      kind: "business_no_appts_today",
      category: "business",
      priority: "low",
      title: "Quiet day on the calendar",
      body: "No appointments today — a good window to follow up with inactive clients or post fresh photos.",
      action: { label: "View clients", target: "tab:clients" },
    });
  }

  return out;
};

// A stylist who signed up but never finished setting up her business
// has nothing else in this file to tell her that: appointment/balance/
// retention nudges all depend on having at least one client or booking,
// which is exactly what she doesn't have yet. This is the one generator
// that looks at SETUP progress rather than booking activity, and it is
// the thing that turns "signed up" into "actually running her book."
//
// Deliberately data-driven, same rule as the email side (see
// process_activation_nudges in the DB): if nothing is left to finish,
// this returns [] and says nothing at all — a fully set-up account
// should never see a nag it has already outgrown. When something IS
// left, it surfaces only the single next step (not the whole list),
// because a checklist of five things reads as homework and a checklist
// of one reads as a next tap.
export type ActivationState = {
  /** ISO timestamp of when this account's trial/account started. Null skips the generator entirely — no reliable "how long have they had this" to reason from. */
  signupIso: string | null;
  businessNameSet: boolean;
  servicesCount: number;
  hasOpenAvailability: boolean;
  bookingLinkActive: boolean;
  stripeChargesEnabled: boolean;
};

// Exported so every surface that shows setup progress — this push/email
// generator, the dashboard "finish setting up" checklist, and nothing
// else — reads the same five steps in the same order with the same
// copy. Never duplicate this list; import it.
export const ACTIVATION_STEPS: Array<{
  key: keyof Omit<ActivationState, "signupIso">;
  done: (s: ActivationState) => boolean;
  title: string;
  body: string;
}> = [
  {
    key: "businessNameSet",
    done: (s) => s.businessNameSet,
    title: "Add your business name",
    body: "Clients see this on every booking page and receipt. Takes ten seconds in Settings.",
  },
  {
    key: "servicesCount",
    done: (s) => s.servicesCount > 0,
    title: "Add your first service",
    body: "Set a price and length for one style. You can add the rest later — one is enough to start taking bookings.",
  },
  {
    key: "hasOpenAvailability",
    done: (s) => s.hasOpenAvailability,
    title: "Set your open days",
    body: "Pick the days and hours clients can actually book you.",
  },
  {
    key: "stripeChargesEnabled",
    done: (s) => s.stripeChargesEnabled,
    title: "Connect Stripe",
    body: "This is how deposits and payments land in your own account. Braid Boss Pro never holds your money.",
  },
  {
    key: "bookingLinkActive",
    done: (s) => s.bookingLinkActive,
    title: "Turn on your booking link",
    body: "This is the link you actually share. Nothing above matters to a client until this is live.",
  },
];

// Coaching window only — past this many days since signup the trial is
// either converted or nearly over, and a different message (trial
// ending) is the more useful one. Stop nagging rather than compete
// with it.
const ACTIVATION_NUDGE_WINDOW_DAYS = 21;

export const getActivationNotifications = (
  state: ActivationState,
  prefs: NotificationPreferences,
  nowMs: number,
): NotificationRule[] => {
  if (!prefs.businessInsights) return [];
  if (!state.signupIso) return [];
  const signupMs = new Date(state.signupIso).getTime();
  if (!isFinite_(signupMs)) return [];
  const daysSinceSignup = Math.floor((nowMs - signupMs) / 86_400_000);
  if (daysSinceSignup < 1 || daysSinceSignup > ACTIVATION_NUDGE_WINDOW_DAYS) return [];

  const next = ACTIVATION_STEPS.find((step) => !step.done(state));
  if (!next) return [];

  return [{
    id: "activation_setup",
    kind: "activation_setup",
    category: "business",
    priority: "medium",
    title: next.title,
    body: next.body,
    action: { label: "Open the setup guide", target: "tab:educationHub" },
  }];
};

// ---- scheduling / dedup ------------------------------------------------

// ---- scheduling / dedup ------------------------------------------------

// Has this exact rule id been delivered recently (e.g. last 12 hours)?
// `deliveredHistory` is a map of { ruleId: lastDeliveredIso }. Keeps the
// dispatcher idempotent so rerunning the rules every minute doesn't
// double-fire alerts.
export const shouldSendNotification = (
  rule: NotificationRule,
  deliveredHistory: Record<string, string>,
  now: Date,
): boolean => {
  const last = deliveredHistory?.[rule.id];
  if (!last) return true;
  const lastMs = isoToMs(last);
  if (!isFinite_(lastMs)) return true;
  const elapsedMs = now.getTime() - lastMs;
  // Re-fire windows by category — appointment timing reminders should
  // never re-fire (until the appt itself moves). A retention nudge is a
  // gentle "this client is overdue" heads-up, not a time-critical alert:
  // re-firing it every 12h made the same "due for rebooking" pop-up
  // reappear twice a day and feel impossible to dismiss, so it gets a
  // weekly cadence. Business insights still refresh daily.
  if (rule.category === "appointment") return false;
  const reFireMs = rule.category === "retention"
    ? 7 * 24 * 3600_000
    : 12 * 3600_000;
  return elapsedMs > reFireMs;
};

export const formatNotificationPayload = (rule: NotificationRule): {
  title: string;
  body: string;
  data: { url: string; ruleId: string; appointmentId?: string; clientId?: string };
  tag: string;
} => {
  // Build the tap destination as a canonical target so the push lands on
  // the thing it is ABOUT. encodeTargetUrl degrades to "/" on its own when
  // a record-scoped target is missing its id, so an incomplete rule still
  // opens the app instead of shipping a dead link.
  let target: PushTarget | null = null;
  if (rule.action?.target?.startsWith("appointment:")) {
    target = { kind: "appointment", appointmentId: rule.appointmentId || "" };
  } else if (rule.action?.target?.startsWith("client:")) {
    // Retention nudges deep-link straight to the rebooking Pause sheet so
    // "snooze / stop reminders" is one tap from the push — the way to make
    // a "due for rebooking" pop-up actually stay dismissed. Other
    // client-targeted pushes just open the profile.
    target = rule.category === "retention"
      ? { kind: "client", clientId: rule.clientId || "", action: "rebooking" }
      : { kind: "client", clientId: rule.clientId || "" };
  } else if (rule.action?.target === "tab:schedule") {
    target = { kind: "schedule" };
  } else if (rule.action?.target === "tab:clients") {
    target = { kind: "clientsTab" };
  } else if (rule.action?.target === "tab:educationHub") {
    target = { kind: "educationHub" };
  }
  const url = encodeTargetUrl(target);
  return {
    title: rule.title,
    body: rule.body,
    tag: rule.id,
    data: {
      url,
      ruleId: rule.id,
      appointmentId: rule.appointmentId,
      clientId: rule.clientId,
    },
  };
};
