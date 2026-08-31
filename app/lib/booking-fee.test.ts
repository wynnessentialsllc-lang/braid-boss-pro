import { describe, it, expect } from "vitest";
import {
  bookingFeeCents,
  bookingCharge,
  formatFee,
  MAX_BOOKING_FEE_CENTS,
} from "./booking-fee";

describe("bookingFeeCents", () => {
  it("reads a configured fee", () => {
    expect(bookingFeeCents(150)).toBe(150);
    expect(bookingFeeCents("150")).toBe(150);
  });

  it("treats unset, zero and junk as no fee", () => {
    expect(bookingFeeCents(undefined)).toBe(0);
    expect(bookingFeeCents(null)).toBe(0);
    expect(bookingFeeCents(0)).toBe(0);
    expect(bookingFeeCents(-100)).toBe(0);
    expect(bookingFeeCents("abc")).toBe(0);
  });

  it("caps a runaway value rather than billing it", () => {
    expect(bookingFeeCents(999999)).toBe(MAX_BOOKING_FEE_CENTS);
  });

  it("never charges fractional cents", () => {
    expect(bookingFeeCents(150.9)).toBe(150);
  });
});

describe("bookingCharge", () => {
  it("adds the fee on top — the stylist's amount never moves", () => {
    const c = bookingCharge(2500, 150);
    expect(c.stylistCents).toBe(2500);
    expect(c.feeCents).toBe(150);
    expect(c.totalCents).toBe(2650);
  });

  it("is a no-op when no fee is configured", () => {
    const c = bookingCharge(2500, 0);
    expect(c).toEqual({ stylistCents: 2500, feeCents: 0, totalCents: 2500 });
  });

  it("charges no fee when nothing is being collected online", () => {
    // Otherwise a $0 deposit would bill the client purely for the fee.
    const c = bookingCharge(0, 150);
    expect(c.feeCents).toBe(0);
    expect(c.totalCents).toBe(0);
  });

  it("keeps the split adding up", () => {
    for (const base of [1, 500, 2500, 99999]) {
      const c = bookingCharge(base, 150);
      expect(c.stylistCents + c.feeCents).toBe(c.totalCents);
    }
  });
});

describe("formatFee", () => {
  it("renders whole and part dollars", () => {
    expect(formatFee(150)).toBe("$1.50");
    expect(formatFee(200)).toBe("$2.00");
    expect(formatFee(0)).toBe("$0.00");
  });
});
