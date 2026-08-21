import { describe, it, expect } from "vitest";
import {
  findAppointmentConflicts,
  startMinuteOf,
  slotLengthMinutes,
  conflictLabel,
  holdsItsSlot,
} from "./appointment-conflicts";

const appt = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  date: "2026-09-10",
  time: "10:00",
  durationHours: 3,
  status: "scheduled",
  clientName: "Jada",
  ...over,
});

describe("startMinuteOf", () => {
  it("parses a clock time", () => {
    expect(startMinuteOf("10:00")).toBe(600);
    expect(startMinuteOf("00:30")).toBe(30);
    expect(startMinuteOf("23:59")).toBe(1439);
  });

  it("rejects anything it can't read, including a half-typed field", () => {
    expect(startMinuteOf("")).toBeNull();
    expect(startMinuteOf("10")).toBeNull();
    expect(startMinuteOf(null)).toBeNull();
    expect(startMinuteOf("25:00")).toBeNull();
    expect(startMinuteOf("10:75")).toBeNull();
  });
});

describe("slotLengthMinutes", () => {
  it("converts hours to minutes", () => {
    expect(slotLengthMinutes(3)).toBe(180);
    expect(slotLengthMinutes(1.5)).toBe(90);
    expect(slotLengthMinutes("6.5")).toBe(390);
  });

  it("never returns zero — a missing duration must not hide a clash", () => {
    expect(slotLengthMinutes(0)).toBe(60);
    expect(slotLengthMinutes(null)).toBe(60);
    expect(slotLengthMinutes("")).toBe(60);
    // Tiny but real durations are floored, not defaulted.
    expect(slotLengthMinutes(0.1)).toBe(15);
  });
});

describe("holdsItsSlot", () => {
  it("ignores cancelled, no-show, all-day, and non-blocking entries", () => {
    expect(holdsItsSlot(appt())).toBe(true);
    expect(holdsItsSlot(appt({ status: "cancelled" }))).toBe(false);
    expect(holdsItsSlot(appt({ status: "canceled" }))).toBe(false);
    expect(holdsItsSlot(appt({ status: "no_show" }))).toBe(false);
    expect(holdsItsSlot(appt({ isAllDay: true }))).toBe(false);
    expect(holdsItsSlot(appt({ blocksAvailability: false }))).toBe(false);
  });
});

describe("conflictLabel", () => {
  it("names each kind the way the stylist would", () => {
    expect(conflictLabel(appt())).toBe("Jada");
    expect(conflictLabel(appt({ clientName: "", style: "Knotless mid-back" }))).toBe("Knotless mid-back");
    expect(conflictLabel(appt({ clientName: "", style: "" }))).toBe("Appointment");
    expect(conflictLabel(appt({ kind: "blocked" }))).toBe("Unavailable");
    expect(conflictLabel(appt({ kind: "personal", eventTitle: "School run" }))).toBe("School run");
  });
});

describe("findAppointmentConflicts", () => {
  const others = [
    appt({ id: "b1", time: "13:00", durationHours: 2, clientName: "Nia" }),      // 1–3pm
    appt({ id: "b2", time: "16:00", durationHours: 1, clientName: "Tasha" }),    // 4–5pm
  ];

  it("finds nothing when the day is clear", () => {
    const subject = appt({ id: "new", time: "08:00", durationHours: 2 });
    expect(findAppointmentConflicts(subject, others)).toEqual([]);
  });

  it("flags an appointment that grew into the next client", () => {
    // 10am + 3h = 1pm, clear. Adding a takedown makes it 4h → 2pm.
    const before = appt({ id: "new", time: "10:00", durationHours: 3 });
    expect(findAppointmentConflicts(before, others)).toEqual([]);

    const after = appt({ id: "new", time: "10:00", durationHours: 4 });
    const found = findAppointmentConflicts(after, others);
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Nia");
  });

  it("treats back-to-back as clear, not clashing", () => {
    // Ends exactly when Nia starts.
    const subject = appt({ id: "new", time: "11:00", durationHours: 2 });
    expect(findAppointmentConflicts(subject, others)).toEqual([]);
  });

  it("never flags an appointment against itself", () => {
    const subject = appt({ id: "b1", time: "13:00", durationHours: 2 });
    expect(findAppointmentConflicts(subject, others)).toEqual([]);
  });

  it("ignores other days", () => {
    const subject = appt({ id: "new", date: "2026-09-11", time: "13:00", durationHours: 2 });
    expect(findAppointmentConflicts(subject, others)).toEqual([]);
  });

  it("ignores cancelled and no-show bookings on both sides", () => {
    const subject = appt({ id: "new", time: "13:00", durationHours: 2 });
    expect(findAppointmentConflicts(subject, [appt({ id: "b1", time: "13:00", status: "cancelled" })])).toEqual([]);
    expect(findAppointmentConflicts(appt({ id: "new", time: "13:00", status: "cancelled" }), others)).toEqual([]);
  });

  it("counts blocked and personal time as a clash", () => {
    const subject = appt({ id: "new", time: "13:00", durationHours: 1 });
    const found = findAppointmentConflicts(subject, [
      appt({ id: "x", kind: "blocked", time: "12:00", durationHours: 4, eventTitle: "" }),
    ]);
    expect(found.map((f) => f.label)).toEqual(["Unavailable"]);
  });

  it("returns every overlap, earliest first", () => {
    const subject = appt({ id: "new", time: "12:00", durationHours: 6 }); // 12–6pm
    const found = findAppointmentConflicts(subject, others);
    expect(found.map((f) => f.label)).toEqual(["Nia", "Tasha"]);
    expect(found[0].startMinute).toBe(13 * 60);
    expect(found[0].endMinute).toBe(15 * 60);
  });

  it("stays quiet while the time field is still being typed", () => {
    expect(findAppointmentConflicts(appt({ id: "new", time: "1" }), others)).toEqual([]);
    expect(findAppointmentConflicts(appt({ id: "new", time: "" }), others)).toEqual([]);
  });

  it("handles a draft with no id yet", () => {
    const draft = { date: "2026-09-10", time: "13:30", durationHours: 1, status: "scheduled" };
    expect(findAppointmentConflicts(draft, others).map((f) => f.label)).toEqual(["Nia"]);
  });
});
