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

export const runNotificationRules = (input: SchedulerInput): NotificationRule[] => {
  const { clients, appointments, todayIso, nowMs, preferences, vipThreshold = 800 } = input;

  const all: NotificationRule[] = [
    ...getAppointmentReminderNotifications(appointments, nowMs, preferences),
    ...getBalanceDueNotifications(appointments, todayIso, preferences),
    ...getRetentionNotifications(clients, appointments, todayIso, preferences, vipThreshold),
    ...getBusinessInsightNotifications({ appointments, today: todayIso }, preferences),
  ];

  // Dedup by id (last writer wins so the highest-resolution rule for
  // an appointment, e.g. appt_2h, replaces appt_24h on the same day).
  const byId = new Map<string, NotificationRule>();
  for (const r of all) byId.set(r.id, r);

  return Array.from(byId.values()).sort((a, b) => {
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
