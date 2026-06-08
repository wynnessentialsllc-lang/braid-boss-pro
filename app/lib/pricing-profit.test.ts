import { describe, it, expect } from "vitest";
import { computeProfit } from "./pricing-profit";

describe("computeProfit", () => {
  it("computes take-home, per-hour, and margin for a typical install", () => {
    // $225 service, $47 materials (hair $40 + overhead $7), 6 hours,
    // stylist's wage $30/hr (labor $180), no tip.
    const p = computeProfit({
      hairCost: 40,
      overhead: 7,
      labor: 180,
      hours: 6,
      subtotal: 225,
      tipAmount: 0,
    });
    expect(p.materialCost).toBe(47);
    expect(p.revenue).toBe(225);
    expect(p.takeHome).toBe(178); // 225 - 47
    expect(p.takeHomeWithTip).toBe(178);
    expect(p.takeHomePerHour).toBeCloseTo(29.67, 2); // 178 / 6
    expect(p.profitAboveWage).toBe(-2); // 225 - 47 - 180
    expect(p.marginPct).toBeCloseTo(79.11, 2); // 178 / 225
  });

  it("adds tips to take-home-with-tip but keeps them out of margin", () => {
    const p = computeProfit({
      hairCost: 0,
      overhead: 0,
      labor: 0,
      hours: 2,
      subtotal: 100,
      tipAmount: 20,
    });
    expect(p.takeHome).toBe(100);
    expect(p.takeHomeWithTip).toBe(120);
    expect(p.marginPct).toBe(100); // tip excluded from margin
    expect(p.takeHomePerHour).toBe(50); // 100 / 2 (tip excluded)
  });

  it("flags a money-losing style with negative take-home", () => {
    const p = computeProfit({
      hairCost: 80,
      overhead: 20,
      labor: 0,
      hours: 3,
      subtotal: 90, // priced below cost of materials
      tipAmount: 0,
    });
    expect(p.materialCost).toBe(100);
    expect(p.takeHome).toBe(-10);
    expect(p.takeHomePerHour).toBeCloseTo(-3.33, 2);
    expect(p.marginPct).toBeCloseTo(-11.11, 2);
  });

  it("returns null per-hour and margin when hours/revenue are zero", () => {
    const p = computeProfit({
      hairCost: 10,
      overhead: 0,
      labor: 0,
      hours: 0,
      subtotal: 0,
      tipAmount: 0,
    });
    expect(p.takeHomePerHour).toBeNull();
    expect(p.marginPct).toBeNull();
    expect(p.takeHome).toBe(-10);
  });

  it("coerces missing/garbage fields to 0", () => {
    const p = computeProfit({
      // @ts-expect-error testing runtime coercion of undefined
      hairCost: undefined,
      // @ts-expect-error testing runtime coercion of null
      overhead: null,
      // @ts-expect-error testing runtime coercion of non-numeric string
      labor: "abc",
      hours: 4,
      subtotal: 200,
      tipAmount: 0,
    });
    expect(p.materialCost).toBe(0);
    expect(p.takeHome).toBe(200);
    expect(p.takeHomePerHour).toBe(50);
  });
});
