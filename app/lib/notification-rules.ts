// Pure rule generators that turn state into actionable internal
// notifications. No React, no side effects, easy to unit test.
//
// Output is a NotificationRule[] that the scheduler dedupes and the
// dispatcher delivers via the existing push-subscriptions pipeline.
// These are *internal* alerts for the salon owner, NOT outbound
// client communications — those still live exclusively in commLog.

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
    const startIso = cleanIso(a.date, a.time);
    const startMs = isoToMs(startIso);
    if (!isFinite_(startMs)) continue;
    const delta = startMs - nowMs;
    if (delta < 0) continue; // already happened

    const clientName = a.clientName || "your client";
    const style = a.style || "the appointment";
    const at = fmtClock(a.date, a.time);

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
      push("appt_48h", `${clientName} in 2 days`, `${style} on ${a.date} at ${at}.`);
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
  const out: NotificationRule[] = [];
  for (const a of safeArr(appointments)) {
    if (!a?.id) continue;
    if (isCanceledAppointment(a) || a.paymentStatus === "paid") continue;
    const balance = num(a.balanceDue);
    if (balance <= 0) continue;
    const apptDate = a.date || "";
    const isToday = apptDate === todayIso;
    const isPast = apptDate && apptDate < todayIso;
    const clientName = a.clientName || "Client";

    if (isToday) {
      out.push({
        id: `balance_today:${a.id}`,
        kind: "balance_today",
        category: "balance",
        priority: "high",
        title: `Balance due today · ${clientName}`,
        body: `$${balance.toFixed(2)} due at today's appointment.`,
        appointmentId: a.id,
        clientId: a.clientId,
        action: { label: "Mark paid", target: `appointment:${a.id}` },
      });
    } else if (isPast) {
      out.push({
        id: `balance_overdue:${a.id}`,
        kind: "balance_overdue",
        category: "balance",
        priority: "high",
        title: `Balance overdue · ${clientName}`,
        body: `$${balance.toFixed(2)} unpaid since ${apptDate}.`,
        appointmentId: a.id,
        clientId: a.clientId,
        action: { label: "Mark paid", target: `appointment:${a.id}` },
      });
    }
  }
  return out;
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
  } else if (todays.length >= 4) {
    out.push({
      id: `insight_full_day:${today}`,
      kind: "business_full_day",
      category: "business",
      priority: "medium",
      title: `${todays.length} appointments today`,
      body: "Heavy day ahead. Hydrate, snack between heads, and check your prep list.",
      action: { label: "View schedule", target: "tab:schedule" },
    });
  }

  const pendingTotal = safeArr(state.appointments)
    .filter(a => !isCanceledAppointment(a) && a?.paymentStatus !== "paid")
    .reduce((s, a) => s + num(a.balanceDue), 0);
  if (pendingTotal > 0) {
    out.push({
      id: `insight_pending_total:${today}`,
      kind: "business_pending_total",
      category: "business",
      priority: pendingTotal > 200 ? "medium" : "low",
      title: `$${pendingTotal.toFixed(2)} in pending balances`,
      body: "Outstanding money across active appointments. Tap to review.",
      action: { label: "View pending", target: "tab:schedule" },
    });
  }

  return out;
};

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
  // never re-fire (until the appt itself moves), retention/business
  // alerts can re-fire once a day.
  if (rule.category === "appointment") return false;
  return elapsedMs > 12 * 3600_000;
};

export const formatNotificationPayload = (rule: NotificationRule): {
  title: string;
  body: string;
  data: { url: string; ruleId: string; appointmentId?: string; clientId?: string };
  tag: string;
} => {
  let url = "/";
  if (rule.action?.target?.startsWith("appointment:")) url = `/?focus=appointment&id=${rule.appointmentId || ""}`;
  else if (rule.action?.target?.startsWith("client:")) url = `/?focus=client&id=${rule.clientId || ""}`;
  else if (rule.action?.target === "tab:schedule") url = "/?tab=schedule";
  else if (rule.action?.target === "tab:clients") url = "/?tab=clients";
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
