import { describe, it, expect } from "vitest";
import { normalizeRate, sortAndCapRates, type NormalizedRate } from "./shippo";

const make = (over: Partial<NormalizedRate> = {}): NormalizedRate => ({
  id: over.id ?? `r_${Math.random().toString(36).slice(2, 8)}`,
  carrier: over.carrier ?? "USPS",
  service: over.service ?? "Priority Mail",
  amount_cents: over.amount_cents ?? 999,
  currency: over.currency ?? "USD",
  estimated_days: "estimated_days" in over ? over.estimated_days! : 2,
});

describe("normalizeRate", () => {
  it("returns null when object_id is missing", () => {
    expect(normalizeRate({ amount: "5.00", provider: "USPS" })).toBeNull();
  });

  it("returns null when amount is non-numeric", () => {
    expect(normalizeRate({ object_id: "r1", amount: "free" })).toBeNull();
  });

  it("converts decimal dollars to cents", () => {
    const r = normalizeRate({
      object_id: "r1",
      amount: "8.65",
      provider: "USPS",
      servicelevel: { name: "Priority Mail" },
      currency: "usd",
      estimated_days: 3,
    });
    expect(r).toEqual({
      id: "r1",
      carrier: "USPS",
      service: "Priority Mail",
      amount_cents: 865,
      currency: "USD",
      estimated_days: 3,
    });
  });

  it("falls back to servicelevel.token when name is missing", () => {
    const r = normalizeRate({
      object_id: "r1",
      amount: "5.00",
      provider: "UPS",
      servicelevel: { token: "ups_ground" },
    });
    expect(r?.service).toBe("ups_ground");
  });

  it("uses 'Carrier' / 'Standard' as last-resort labels", () => {
    const r = normalizeRate({ object_id: "r1", amount: "1.00" });
    expect(r?.carrier).toBe("Carrier");
    expect(r?.service).toBe("Standard");
  });

  it("treats a missing / negative estimated_days as null", () => {
    expect(normalizeRate({ object_id: "r1", amount: "1.00" })?.estimated_days).toBeNull();
    expect(
      normalizeRate({ object_id: "r1", amount: "1.00", estimated_days: -1 })?.estimated_days,
    ).toBeNull();
  });
});

describe("sortAndCapRates", () => {
  it("orders by price ascending, ties broken by speed", () => {
    const sorted = sortAndCapRates([
      make({ id: "a", amount_cents: 1500, estimated_days: 2 }),
      make({ id: "b", amount_cents: 999, estimated_days: 5 }),
      make({ id: "c", amount_cents: 999, estimated_days: 2 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("caps the list to 5 entries", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      make({ id: `r${i}`, amount_cents: 100 * (i + 1) }),
    );
    expect(sortAndCapRates(many)).toHaveLength(5);
  });

  it("sorts a null estimated_days last on ties", () => {
    const sorted = sortAndCapRates([
      make({ id: "a", amount_cents: 500, estimated_days: null }),
      make({ id: "b", amount_cents: 500, estimated_days: 3 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
