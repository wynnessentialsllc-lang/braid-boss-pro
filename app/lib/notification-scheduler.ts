// Pulls every rule generator together, dedupes by id, and produces a
// single ordered NotificationRule[] for the bell + the dispatcher.
//
// Pure function — depends only on data passed in, no Supabase
// imports. The scheduler caller owns delivery history (kept in a
// localStorage map so the same alert doesn't re-fire on every render).

import {
  getAppointmentReminderNotifications,
  getBalanceDueNotifications,
  getRetentionNotifications,
  getBusinessInsightNotifications,
  shouldSendNotification,
  type NotificationRule,
  type NotificationPreferences,
} from "./notification-rules";

export type SchedulerInput = {
  clients: any[];
  appointments: any[];
  todayIso: string;
  nowMs: number;
  preferences: NotificationPreferences;
  vipThreshold?: number;
  deliveredHistory?: Record<string, string>;
};

const PRIORITY_RANK: Record<NotificationRule["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// Pick the closest-in-time appointment reminder per appointment so we
// never show 48h + 24h + same-day + 2h cards stacked. Highest-
// resolution alert wins (appt_2h > appt_same_day > appt_24h > appt_48h).
const REMINDER_PRIORITY: Record<string, number> = {
  appt_2h: 4, appt_same_day: 3, appt_24h: 2, appt_48h: 1,
};

const collapseAppointmentReminders = (rules: NotificationRule[]): NotificationRule[] => {
  const apptBuckets = new Map<string, NotificationRule>();
  const passthrough: NotificationRule[] = [];
  for (const r of rules) {
    if (r.category === "appointment" && r.appointmentId && REMINDER_PRIORITY[r.kind]) {
      const existing = apptBuckets.get(r.appointmentId);
      if (!existing || (REMINDER_PRIORITY[r.kind] || 0) > (REMINDER_PRIORITY[existing.kind] || 0)) {
        apptBuckets.set(r.appointmentId, r);
      }
    } else {
      passthrough.push(r);
    }
  }
  return [...apptBuckets.values(), ...passthrough];
};

export const runNotificationRules = (input: SchedulerInput): NotificationRule[] => {
  const { clients, appointments, todayIso, nowMs, preferences, vipThreshold = 800 } = input;

  const all: NotificationRule[] = [
    ...getAppointmentReminderNotifications(appointments, nowMs, preferences),
    ...getBalanceDueNotifications(appointments, todayIso, preferences),
    ...getRetentionNotifications(clients, appointments, todayIso, preferences, vipThreshold),
    ...getBusinessInsightNotifications({ appointments, today: todayIso }, preferences),
  ];

  // Dedup by id first (id collisions are rare but possible across
  // generators), then collapse appointment reminders so a single appt
  // never shows up as multiple stacked cards.
  const byId = new Map<string, NotificationRule>();
  for (const r of all) byId.set(r.id, r);
  const collapsed = collapseAppointmentReminders(Array.from(byId.values()));

  return collapsed.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    return (a.scheduledFor || "").localeCompare(b.scheduledFor || "");
  });
};

export const splitDeliverable = (
  rules: NotificationRule[],
  deliveredHistory: Record<string, string>,
  now: Date = new Date(),
): { toSend: NotificationRule[]; suppressed: NotificationRule[] } => {
  const toSend: NotificationRule[] = [];
  const suppressed: NotificationRule[] = [];
  for (const r of rules) {
    if (shouldSendNotification(r, deliveredHistory, now)) toSend.push(r);
    else suppressed.push(r);
  }
  return { toSend, suppressed };
};
