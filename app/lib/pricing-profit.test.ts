import { describe, it, expect } from "vitest";
import { computeProfit, rankStyleProfitability } from "./pricing-profit";

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

describe("rankStyleProfitability", () => {
  it("ranks styles by take-home per hour, highest first", () => {
    const ranked = rankStyleProfitability([
      // $180 over 4h, $40 materials → take-home 140 → $35/hr
      { id: "fulani", name: "Fulani", basePrice: 180, hairCost: 30, overhead: 10, estimatedHours: 4, hourlyRate: 50 },
      // $280 over 6h, $75 materials → take-home 205 → ~$34.17/hr
      { id: "knotless", name: "Knotless", basePrice: 280, hairCost: 60, overhead: 15, estimatedHours: 6, hourlyRate: 50 },
      // $320 over 5h, $95 materials → take-home 225 → $45/hr
      { id: "boho", name: "Boho Bob", basePrice: 320, hairCost: 80, overhead: 15, estimatedHours: 5, hourlyRate: 55 },
    ]);
    expect(ranked.map(r => r.id)).toEqual(["boho", "fulani", "knotless"]);
    expect(ranked[0].takeHomePerHour).toBe(45);
  });

  it("includes default add-ons in revenue", () => {
    const [r] = rankStyleProfitability([
      { id: "a", name: "A", basePrice: 200, hairCost: 0, overhead: 0, estimatedHours: 2, hourlyRate: 50, defaultAddOns: [{ amount: 20 }, { amount: 10 }] },
    ]);
    expect(r.revenue).toBe(230);
    expect(r.takeHomePerHour).toBe(115); // 230 / 2
  });

  it("sorts styles with no hours estimate last and handles empty input", () => {
    const ranked = rankStyleProfitability([
      { id: "nohrs", name: "No hours", basePrice: 100, estimatedHours: 0 },
      { id: "ok", name: "OK", basePrice: 100, hairCost: 0, overhead: 0, estimatedHours: 2, hourlyRate: 0 },
    ]);
    expect(ranked[0].id).toBe("ok");
    expect(ranked[1].takeHomePerHour).toBeNull();
    expect(rankStyleProfitability([])).toEqual([]);
    expect(rankStyleProfitability(null)).toEqual([]);
  });
});
