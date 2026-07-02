import { describe, it, expect } from "vitest";
import { nextMonthAppts, nextMonthSummary, yearHourlyRateBreakdown, computeDashboardRevenue, type AppointmentLike } from "./reports";

// Reference date sits in June so "next month" is July 2026.
const REF = "2026-06-25";

const appt = (over: Partial<AppointmentLike>): AppointmentLike => ({
  id: Math.random().toString(36).slice(2),
  status: "scheduled",
  kind: "appointment",
  totalPrice: 0,
  discountAmount: 0,
  ...over,
});

describe("nextMonthAppts", () => {
  it("includes only billable appointments in the following calendar month", () => {
    const appts = [
      appt({ id: "jun", date: "2026-06-30", totalPrice: 100 }), // this month — excluded
      appt({ id: "jul1", date: "2026-07-01", totalPrice: 200 }), // next month
      appt({ id: "jul2", date: "2026-07-19", totalPrice: 300 }), // next month
      appt({ id: "aug", date: "2026-08-01", totalPrice: 400 }), // month after — excluded
    ];
    const out = nextMonthAppts(appts, REF).map(a => a.id);
    expect(out).toEqual(["jul1", "jul2"]);
  });

  it("excludes cancelled, no-show, and non-appointment rows", () => {
    const appts = [
      appt({ id: "ok", date: "2026-07-05", totalPrice: 100 }),
      appt({ id: "cancelled", date: "2026-07-06", status: "cancelled", totalPrice: 100 }),
      appt({ id: "noshow", date: "2026-07-07", status: "no_show", totalPrice: 100 }),
      appt({ id: "blocked", date: "2026-07-08", kind: "blocked", totalPrice: 100 }),
    ];
    const out = nextMonthAppts(appts, REF).map(a => a.id);
    expect(out).toEqual(["ok"]);
  });

  it("sorts by date then time", () => {
    const appts = [
      appt({ id: "later", date: "2026-07-19", time: "09:00" }),
      appt({ id: "earlyAM", date: "2026-07-01", time: "08:00" }),
      appt({ id: "earlyPM", date: "2026-07-01", time: "14:00" }),
    ];
    expect(nextMonthAppts(appts, REF).map(a => a.id)).toEqual(["earlyAM", "earlyPM", "later"]);
  });

  it("handles a December reference rolling into January of the next year", () => {
    const appts = [
      appt({ id: "jan", date: "2027-01-10", totalPrice: 100 }),
      appt({ id: "dec", date: "2026-12-20", totalPrice: 100 }),
    ];
    expect(nextMonthAppts(appts, "2026-12-15").map(a => a.id)).toEqual(["jan"]);
  });
});

describe("nextMonthSummary", () => {
  it("totals expected revenue (net of discounts) and counts unique clients", () => {
    const appts = [
      appt({ date: "2026-07-02", totalPrice: 200, clientId: "c1" }),
      appt({ date: "2026-07-09", totalPrice: 150, discountAmount: 50, clientId: "c1" }), // same client
      appt({ date: "2026-07-15", totalPrice: 300, clientId: "c2" }),
      appt({ date: "2026-06-30", totalPrice: 999, clientId: "c3" }), // this month — ignored
    ];
    const s = nextMonthSummary(appts, REF);
    expect(s.revenue).toBe(600); // 200 + (150-50) + 300
    expect(s.clientCount).toBe(2); // c1, c2
    expect(s.appointments).toHaveLength(3);
  });

  it("returns zeros when nothing is on the books next month", () => {
    const s = nextMonthSummary([appt({ date: "2026-06-10", totalPrice: 100 })], REF);
    expect(s).toEqual({ appointments: [], revenue: 0, clientCount: 0 });
  });
});

describe("yearHourlyRateBreakdown", () => {
  it("blends earned ÷ hours across completed/paid bookings in the year", () => {
    const appts = [
      // $200 over 4h → $50/hr
      appt({ id: "a", date: "2026-02-01", status: "completed", totalPrice: 200, durationHours: 4 }),
      // $300 over 5h, post-discount $250 → contributes 250 / 5h
      appt({ id: "b", date: "2026-03-01", status: "completed", totalPrice: 300, discountAmount: 50, durationHours: 5 }),
      // unpaid/scheduled — excluded
      appt({ id: "c", date: "2026-04-01", status: "scheduled", totalPrice: 500, durationHours: 5 }),
      // last year — excluded
      appt({ id: "d", date: "2025-12-01", status: "completed", totalPrice: 500, durationHours: 5 }),
    ];
    const b = yearHourlyRateBreakdown(appts, REF);
    // (200 + 250) / (4 + 5) = 450 / 9 = 50
    expect(b.rate).toBe(50);
    expect(b.earned).toBe(450);
    expect(b.hours).toBe(9);
    expect(b.rows.map(r => r.appointment.id)).toEqual(["a", "b"]); // sorted by rate desc (both 50)
  });

  it("skips paid bookings with no recorded duration so they can't inflate the rate", () => {
    const appts = [
      appt({ id: "timed", date: "2026-02-01", status: "completed", totalPrice: 100, durationHours: 2 }), // $50/hr
      appt({ id: "untimed", date: "2026-02-02", paymentStatus: "paid", totalPrice: 999, durationHours: 0 }),
    ];
    const b = yearHourlyRateBreakdown(appts, REF);
    expect(b.rate).toBe(50);   // untimed booking excluded from numerator AND denominator
    expect(b.skipped).toBe(1);
    expect(b.rows).toHaveLength(1);
  });

  it("returns a zero rate when nothing qualifies", () => {
    const b = yearHourlyRateBreakdown([appt({ date: "2026-02-01", status: "scheduled", totalPrice: 100, durationHours: 3 })], REF);
    expect(b.rate).toBe(0);
    expect(b.hours).toBe(0);
    expect(b.rows).toHaveLength(0);
  });

  it("matches the dashboard card's yearHourlyRate field", () => {
    const appts = [
      appt({ id: "a", date: "2026-02-01", status: "completed", totalPrice: 200, durationHours: 4 }),
      appt({ id: "b", date: "2026-03-01", paymentStatus: "paid", totalPrice: 300, durationHours: 6 }),
    ];
    const card = computeDashboardRevenue(appts, REF);
    const sheet = yearHourlyRateBreakdown(appts, REF);
    expect(card.yearHourlyRate).toBe(sheet.rate);
    expect(card.yearHoursWorked).toBe(sheet.hours);
    expect(card.yearRateEarnings).toBe(sheet.earned);
  });
});
