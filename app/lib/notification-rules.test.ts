import { describe, it, expect } from "vitest";
import {
  getAppointmentReminderNotifications,
  DEFAULT_NOTIFICATION_PREFERENCES,
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
