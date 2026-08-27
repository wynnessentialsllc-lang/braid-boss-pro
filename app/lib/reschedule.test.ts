import { describe, it, expect } from "vitest";
import {
  depositCarryover,
  moveAppointment,
  scheduleChanged,
  type ReschedulableAppointment,
} from "./reschedule";

const APPT: ReschedulableAppointment = {
  id: "appt_1",
  clientName: "Adrienne Gordon",
  style: "Knotless Braids",
  date: "2026-09-12",
  time: "09:00",
  totalPrice: 250,
  depositPaid: 75,
  balanceDue: 175,
  paymentStatus: "partial",
  paymentDate: "2026-08-20",
  paymentMethod: "stripe",
};

describe("moveAppointment", () => {
  it("carries the deposit and its payment provenance to the new slot", () => {
    const moved = moveAppointment(APPT, { date: "2026-09-19", time: "13:00" });
    expect(moved.date).toBe("2026-09-19");
    expect(moved.time).toBe("13:00");
    expect(moved.depositPaid).toBe(75);
    expect(moved.balanceDue).toBe(175);
    expect(moved.paymentStatus).toBe("partial");
    expect(moved.paymentDate).toBe("2026-08-20");
    expect(moved.paymentMethod).toBe("stripe");
  });

  it("never mutates the original", () => {
    const before = JSON.stringify(APPT);
    moveAppointment(APPT, { date: "2026-09-19", time: "13:00" });
    expect(JSON.stringify(APPT)).toBe(before);
  });

  it("passes every unrelated field through untouched", () => {
    const moved = moveAppointment(
      { ...APPT, serviceId: "svc_1", addons: [{ name: "Beads" }], notes: "detangled" },
      { date: "2026-09-19", time: "13:00" },
    );
    expect(moved.serviceId).toBe("svc_1");
    expect(moved.addons).toEqual([{ name: "Beads" }]);
    expect(moved.notes).toBe("detangled");
  });

  it("handles a deposit held as a display string", () => {
    const moved = moveAppointment(
      { ...APPT, depositPaid: "75.00", totalPrice: "250" },
      { date: "2026-09-19", time: "13:00" },
    );
    expect(moved.depositPaid).toBe(75);
    expect(moved.balanceDue).toBe(175);
  });

  it("recomputes the balance against a discount", () => {
    const moved = moveAppointment(
      { ...APPT, discountAmount: 50 },
      { date: "2026-09-19", time: "13:00" },
    );
    expect(moved.depositPaid).toBe(75);
    expect(moved.balanceDue).toBe(125);
  });

  it("keeps a paid-in-full appointment at a zero balance", () => {
    const moved = moveAppointment(
      { ...APPT, depositPaid: 250, balance_paid: true },
      { date: "2026-09-19", time: "13:00" },
    );
    expect(moved.depositPaid).toBe(250);
    expect(moved.balanceDue).toBe(0);
  });

  it("leaves an appointment with no deposit owing the full ticket", () => {
    const moved = moveAppointment(
      { ...APPT, depositPaid: 0, paymentStatus: "unpaid", paymentDate: "", paymentMethod: "" },
      { date: "2026-09-19", time: "13:00" },
    );
    expect(moved.depositPaid).toBe(0);
    expect(moved.balanceDue).toBe(250);
  });
});

describe("depositCarryover", () => {
  it("reports what was paid and what is still owed", () => {
    expect(depositCarryover(APPT)).toEqual({
      depositPaid: 75,
      remainingBalance: 175,
      paidInFull: false,
    });
  });

  it("nets out store credit already applied", () => {
    expect(depositCarryover({ ...APPT, creditApplied: 25 })).toEqual({
      depositPaid: 75,
      remainingBalance: 150,
      paidInFull: false,
    });
  });

  it("clamps a deposit larger than the ticket", () => {
    const out = depositCarryover({ ...APPT, depositPaid: 400 });
    expect(out.depositPaid).toBe(250);
    expect(out.remainingBalance).toBe(0);
    expect(out.paidInFull).toBe(true);
  });

  it("treats a zero-price appointment as owing nothing extra", () => {
    expect(depositCarryover({ totalPrice: 0, depositPaid: 0 })).toEqual({
      depositPaid: 0,
      remainingBalance: 0,
      paidInFull: false,
    });
  });
});

describe("scheduleChanged", () => {
  it("is true when the date or the time moves", () => {
    expect(scheduleChanged(APPT, { date: "2026-09-19", time: "09:00" })).toBe(true);
    expect(scheduleChanged(APPT, { date: "2026-09-12", time: "13:00" })).toBe(true);
  });

  it("is false for the same slot", () => {
    expect(scheduleChanged(APPT, { date: "2026-09-12", time: "09:00" })).toBe(false);
  });
});
