import { describe, it, expect } from "vitest";
import {
  getAppointmentReminderNotifications,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "./notification-rules";

// Regression: personal events / blocked time / all-day "Off" blocks share
// the appointments list but aren't client bookings. They carry no client
// name and no real start time (an empty time defaults to 10:00), so before
// the fix they produced bogus "your client tomorrow — the appointment at
// 10 AM" reminders for days the stylist had simply marked themselves off.

// "now" is fixed so the 24h / 48h windows are deterministic.
const NOW = new Date("2026-06-05T12:00:00").getTime();
const TOMORROW = "2026-06-06"; // ~24h out
const IN_TWO_DAYS = "2026-06-07"; // ~48h out

// An all-day "Off" personal block — exactly the shape that was firing
// false reminders in production.
const allDayOff = (date: string) => ({
  id: `personal_${date}`,
  kind: "personal",
  isAllDay: true,
  date,
  time: "",
  clientName: "",
  style: "",
  status: "scheduled",
});

// A genuine client appointment on the same day.
const realAppt = (date: string) => ({
  id: `appt_${date}`,
  kind: "appointment",
  isAllDay: false,
  date,
  time: "14:00",
  clientName: "Bailey Cooper",
  style: "Knotless Braids (Medium)",
  status: "scheduled",
});

describe("getAppointmentReminderNotifications — non-booking events", () => {
  it("never reminds about all-day personal/off blocks", () => {
    const out = getAppointmentReminderNotifications(
      [allDayOff(TOMORROW), allDayOff(IN_TWO_DAYS)],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });

  it("still reminds about real client appointments", () => {
    const out = getAppointmentReminderNotifications(
      [realAppt(TOMORROW)],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].appointmentId).toBe(`appt_${TOMORROW}`);
    expect(out[0].title).toContain("Bailey Cooper");
  });

  it("filters out the off block but keeps the real appointment when mixed", () => {
    const out = getAppointmentReminderNotifications(
      [allDayOff(TOMORROW), realAppt(TOMORROW)],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].appointmentId).toBe(`appt_${TOMORROW}`);
  });

  it("excludes non-appointment kinds even when not all-day", () => {
    const blocked = { ...realAppt(TOMORROW), id: "blk", kind: "blocked", isAllDay: false, clientName: "" };
    const out = getAppointmentReminderNotifications(
      [blocked],
      NOW,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(out).toHaveLength(0);
  });
});
