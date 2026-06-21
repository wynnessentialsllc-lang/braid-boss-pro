import { describe, it, expect } from "vitest";
import {
  getAppointmentReminderNotifications,
  getRetentionNotifications,
  shouldSendNotification,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationRule,
} from "./notification-rules";

// Fixed "now" so deltas are deterministic. 2026-06-07T09:00 local.
const NOW = new Date(2026, 5, 7, 9, 0, 0).getTime();

// An appointment 24h-ish out lands inside the appt_24h window, so the
// base fixture always produces exactly one reminder when not suppressed.
const baseAppt = (overrides: Record<string, unknown> = {}) => ({
  id: "appt-1",
  clientId: "client-1",
  clientName: "Sheree Wynn",
  style: "Boho Knotless Bob",
  date: "2026-06-08",
  time: "09:00",
  status: "scheduled",
  totalPrice: 190,
  ...overrides,
});

describe("getAppointmentReminderNotifications — deposit gating", () => {
  it("suppresses reminders for a booking awaiting its deposit", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ depositRequired: true, depositPaid: 0 })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("treats a null/empty depositPaid as unpaid when a deposit is required", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ depositRequired: true, depositPaid: null })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("fires once the required deposit has been paid", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ depositRequired: true, depositPaid: 50 })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("appt_24h");
  });

  it("still fires for manual appointments that don't require a deposit", () => {
    // depositRequired falsy + depositPaid 0 must NOT read as 'awaiting'.
    const out = getAppointmentReminderNotifications(
      [baseAppt({ depositPaid: 0 })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
  });
});

describe("getAppointmentReminderNotifications — client name required", () => {
  it("skips a reminder when the appointment has no client name", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ clientName: "" })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("skips when the client name is only whitespace", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ clientName: "   " })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("never emits the 'your client' fallback copy", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ clientName: null })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("skips personal/blocked time even when it has a name", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ kind: "personal", clientName: "Lunch" })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("trims surrounding whitespace from the client name in copy", () => {
    const out = getAppointmentReminderNotifications(
      [baseAppt({ clientName: "  Chanda Picott  ", date: "2026-06-09" })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Chanda Picott in 2 days");
  });
});

describe("getRetentionNotifications — respects the Pause reminders mute", () => {
  // A client whose last visit was 50 days ago lands in the
  // retention_due window (42–89 days) — matching the real "due for
  // rebooking" pop-up that wouldn't stay dismissed.
  const TODAY = "2026-06-21";
  const overdueClient = (overrides: Record<string, unknown> = {}) => ({
    id: "client-1",
    name: "Tracie",
    ...overrides,
  });
  const overdueAppt = {
    id: "appt-1",
    clientId: "client-1",
    date: "2026-05-02", // 50 days before TODAY
    status: "completed",
    totalPrice: 180,
  };

  it("fires a due-for-rebooking nudge for an overdue client", () => {
    const out = getRetentionNotifications(
      [overdueClient()],
      [overdueAppt],
      TODAY,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("retention_due");
  });

  it("suppresses the nudge once the client is opted out", () => {
    const out = getRetentionNotifications(
      [overdueClient({ rebookingOptOut: true })],
      [overdueAppt],
      TODAY,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("suppresses the nudge while a snooze is still active", () => {
    const out = getRetentionNotifications(
      [overdueClient({ rebookingSnoozedUntil: "2026-07-15" })],
      [overdueAppt],
      TODAY,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("resumes the nudge once the snooze has elapsed", () => {
    const out = getRetentionNotifications(
      [overdueClient({ rebookingSnoozedUntil: "2026-06-01" })],
      [overdueAppt],
      TODAY,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
  });
});

describe("shouldSendNotification — retention re-fire cadence", () => {
  const retentionRule: NotificationRule = {
    id: "retention_due:client-1",
    kind: "retention_due",
    category: "retention",
    priority: "medium",
    title: "Tracie due for rebooking",
    body: "50 days since their last visit — likely time for a touch-up.",
  };
  const now = new Date("2026-06-21T12:00:00Z");

  it("does not re-fire a retention nudge sent 13 hours ago", () => {
    const last = new Date(now.getTime() - 13 * 3600_000).toISOString();
    expect(
      shouldSendNotification(retentionRule, { [retentionRule.id]: last }, now),
    ).toBe(false);
  });

  it("re-fires a retention nudge only after a week", () => {
    const last = new Date(now.getTime() - 8 * 24 * 3600_000).toISOString();
    expect(
      shouldSendNotification(retentionRule, { [retentionRule.id]: last }, now),
    ).toBe(true);
  });
});

describe("getAppointmentReminderNotifications — date formatting", () => {
  it("renders the 48h reminder date as numeric M/D/YYYY, not ISO", () => {
    // 2 days out from NOW (2026-06-07T09:00) lands in the appt_48h window.
    const out = getAppointmentReminderNotifications(
      [baseAppt({ date: "2026-06-09", time: "09:00" })],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("appt_48h");
    expect(out[0].body).toBe("Boho Knotless Bob on 6/9/2026 at 9 AM.");
    expect(out[0].body).not.toContain("2026-06-09");
  });
});
