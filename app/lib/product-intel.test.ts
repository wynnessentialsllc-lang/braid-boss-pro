import { describe, it, expect } from "vitest";
import {
  blankProduct,
  computeCostBreakdown,
  type ProductProfitInput,
} from "./product-profit";
import {
  batchSnapshot,
  founderInsights,
  priceBounds,
  productHealth,
  profitTimeline,
  recommendedPrice,
  TIMELINE_UNITS,
  unitEconomics,
} from "./product-intel";

// "Nourish Oil": 32 oz bulk @ $47 into 2 oz bottles → 16 units.
// packaging 0.60 + 0.18 + 0.24 = 1.02/unit → cost/unit $3.96.
const nourishOil = (over: Partial<ProductProfitInput> = {}): ProductProfitInput => ({
  ...blankProduct(),
  name: "Nourish Oil",
  category: "Hair Oil",
  finishedSize: 2,
  finishedUnit: "oz",
  bulkCost: 47,
  bulkSize: 32,
  bulkUnit: "oz",
  packaging: {
    bottle: { totalCost: 30, quantity: 50 },
    label: { totalCost: 18, quantity: 100 },
    sprayer: { totalCost: 12, quantity: 50 },
    safetySeal: { totalCost: 0, quantity: 0 },
    box: { totalCost: 0, quantity: 0 },
  },
  fees: { processingPct: 0, taxPct: 0 },
  ...over,
});

describe("unitEconomics", () => {
  it("computes gross, net and ROI per unit", () => {
    const ue = unitEconomics(nourishOil(), 12);
    expect(ue.costPerUnit).toBe(3.96);
    expect(ue.grossProfit).toBe(round2(12 - 3.96));
    expect(ue.netProfit).toBe(ue.grossProfit); // no fees/tax
    expect(ue.roiPct).toBe(round2((ue.grossProfit / 3.96) * 100));
  });

  it("subtracts processing fees and tax from net profit", () => {
    const ue = unitEconomics(
      nourishOil({ fees: { processingPct: 2.9, taxPct: 10 } }),
      12,
    );
    expect(ue.processingFee).toBe(round2(12 * 0.029));
    expect(ue.netProfit).toBeLessThan(ue.grossProfit);
  });

  it("returns null ROI when nothing is produced", () => {
    expect(unitEconomics(nourishOil({ bulkSize: 0 }), 12).roiPct).toBeNull();
  });
});

describe("productHealth", () => {
  it("is incomplete before costs/price exist", () => {
    expect(productHealth(nourishOil({ bulkSize: 0 }), 0).status).toBe("incomplete");
    expect(productHealth(nourishOil(), 0).status).toBe("incomplete");
  });

  it("rates excellent at ROI ≥ 50% with positive net profit", () => {
    // cost 3.96, price 8 → ROI ~102%.
    const h = productHealth(nourishOil(), 8);
    expect(h.status).toBe("excellent");
    expect(h.tone).toBe("green");
  });

  it("rates healthy in the 30–49% ROI band", () => {
    // cost 3.96, price 5.35 → ROI ~35%.
    const h = productHealth(nourishOil(), 5.35);
    expect(h.status).toBe("healthy");
    expect(h.tone).toBe("green");
  });

  it("flags needs-improvement in the 15–29% band", () => {
    // cost 3.96, price 4.75 → ROI ~20%.
    const h = productHealth(nourishOil(), 4.75);
    expect(h.status).toBe("needs-improvement");
    expect(h.tone).toBe("orange");
  });

  it("says reprice below 15% ROI", () => {
    // cost 3.96, price 4.2 → ROI ~6%.
    const h = productHealth(nourishOil(), 4.2);
    expect(h.status).toBe("reprice");
    expect(h.tone).toBe("red");
  });

  it("says reprice when net profit is negative", () => {
    // price below cost → negative net profit.
    const h = productHealth(nourishOil(), 3);
    expect(h.status).toBe("reprice");
  });
});

describe("recommendedPrice", () => {
  it("recommends a charm price clearing a 40% ROI floor", () => {
    const rec = recommendedPrice(nourishOil());
    expect(rec.price).toBeGreaterThan(3.96);
    expect(rec.roiPct).toBeGreaterThanOrEqual(40);
    expect(rec.price.toFixed(2).endsWith(".99")).toBe(true);
    expect(rec.reason).toMatch(/competitive/i);
  });

  it("returns 0 when there are no costs", () => {
    expect(recommendedPrice(nourishOil({ bulkSize: 0 })).price).toBe(0);
  });
});

describe("priceBounds", () => {
  it("bounds min at cost + $1 and max at 3× current retail", () => {
    const b = priceBounds(nourishOil({ retailPrice: 12 }));
    expect(b.min).toBe(round2(3.96 + 1));
    expect(b.current).toBe(12);
    expect(b.max).toBe(round2(12 * 3));
  });

  it("keeps max above min even with no retail set", () => {
    const b = priceBounds(nourishOil({ marginPct: 50 }));
    expect(b.max).toBeGreaterThan(b.min);
  });
});

describe("profitTimeline", () => {
  it("projects every configured volume", () => {
    const rows = profitTimeline(nourishOil(), 12);
    expect(rows.map((r) => r.units)).toEqual([...TIMELINE_UNITS]);
    const at100 = rows.find((r) => r.units === 100)!;
    expect(at100.revenue).toBe(round2(12 * 100));
    expect(at100.netProfit).toBe(round2((12 - 3.96) * 100));
    expect(at100.roiPct).toBe(round2(((12 - 3.96) / 3.96) * 100));
  });

  it("scales net profit with volume but keeps ROI constant", () => {
    const rows = profitTimeline(nourishOil(), 12);
    const a = rows.find((r) => r.units === 10)!;
    const b = rows.find((r) => r.units === 500)!;
    expect(b.netProfit).toBeGreaterThan(a.netProfit);
    expect(a.roiPct).toBe(b.roiPct);
  });
});

describe("batchSnapshot", () => {
  it("summarizes the batch at the chosen price", () => {
    const input = nourishOil();
    const c = computeCostBreakdown(input);
    const s = batchSnapshot(input, 12, c);
    expect(s.unitsProduced).toBe(16);
    expect(s.batchCost).toBe(c.totalBatchCost);
    expect(s.retailValue).toBe(round2(12 * 16));
    expect(s.grossProfit).toBe(round2(12 * 16 - c.totalBatchCost));
    expect(s.profitPerUnit).toBe(unitEconomics(input, 12, c).netProfit);
    expect(s.breakEvenUnits).toBe(Math.ceil(c.totalBatchCost / 12));
  });

  it("has no break-even when priced at or below cost", () => {
    expect(batchSnapshot(nourishOil(), 3, undefined).breakEvenUnits).toBeNull();
  });
});

describe("founderInsights", () => {
  it("always returns between 2 and 4 insights", () => {
    const many = founderInsights(nourishOil({ unitsToSell: 10 }), 4.2);
    expect(many.length).toBeGreaterThanOrEqual(2);
    expect(many.length).toBeLessThanOrEqual(4);
    const few = founderInsights(nourishOil({ unitsToSell: 200 }), 9);
    expect(few.length).toBeGreaterThanOrEqual(2);
    expect(few.length).toBeLessThanOrEqual(4);
  });

  it("recommends raising price when ROI is low", () => {
    const out = founderInsights(nourishOil(), 4.2);
    expect(out.some((i) => i.id === "raise-price")).toBe(true);
  });

  it("flags high packaging share", () => {
    // Expensive packaging: bottle $2/unit dwarfs the base cost.
    const input = nourishOil({
      packaging: {
        bottle: { totalCost: 200, quantity: 100 },
        label: { totalCost: 100, quantity: 100 },
        sprayer: { totalCost: 0, quantity: 0 },
        safetySeal: { totalCost: 0, quantity: 0 },
        box: { totalCost: 0, quantity: 0 },
      },
    });
    expect(founderInsights(input, 12).some((i) => i.id === "packaging-high")).toBe(true);
  });

  it("celebrates excellent margins", () => {
    const out = founderInsights(nourishOil({ unitsToSell: 200 }), 12);
    expect(out.some((i) => i.id === "healthy-volume")).toBe(true);
  });

  it("suggests selling more when volume is low", () => {
    const out = founderInsights(nourishOil({ unitsToSell: 12 }), 9);
    expect(out.some((i) => i.id === "low-volume")).toBe(true);
  });

  it("onboards when no costs are entered", () => {
    const out = founderInsights(nourishOil({ bulkSize: 0 }), 0);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((i) => i.id.startsWith("start-"))).toBe(true);
  });
});

const round2 = (n: number): number => Math.round(n * 100) / 100;
