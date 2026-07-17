import { describe, it, expect } from "vitest";
import {
  blankProduct,
  calculateProduct,
  computeCostBreakdown,
  computeForecast,
  computeYield,
  convertVolume,
  perUnitCost,
  pricingTable,
  psychologicalPrice,
  rankProducts,
  topEarner,
  averageCostPerUnit,
  retailForMargin,
  wholesalePrice,
  type ProductProfitInput,
  type SavedProduct,
} from "./product-profit";

// A complete "Nourish Oil" product mirroring the spec's worked example.
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
    bottle: { totalCost: 30, quantity: 50 }, // $0.60
    label: { totalCost: 18, quantity: 100 }, // $0.18
    sprayer: { totalCost: 12, quantity: 50 }, // $0.24
    safetySeal: { totalCost: 0, quantity: 0 },
    box: { totalCost: 0, quantity: 0 },
  },
  ...over,
});

describe("convertVolume", () => {
  it("is a no-op for matching units", () => {
    expect(convertVolume(32, "oz", "oz")).toBe(32);
    expect(convertVolume(500, "ml", "ml")).toBe(500);
  });
  it("converts oz ⇄ ml", () => {
    expect(convertVolume(1, "oz", "ml")).toBeCloseTo(29.5735, 3);
    expect(convertVolume(29.5735, "ml", "oz")).toBeCloseTo(1, 4);
  });
});

describe("perUnitCost", () => {
  it("divides total cost by quantity", () => {
    expect(perUnitCost({ totalCost: 30, quantity: 50 })).toBe(0.6);
    expect(perUnitCost({ totalCost: 18, quantity: 100 })).toBe(0.18);
  });
  it("returns 0 for unset / zero-quantity lines", () => {
    expect(perUnitCost({ totalCost: 0, quantity: 0 })).toBe(0);
    expect(perUnitCost(null)).toBe(0);
    expect(perUnitCost(undefined)).toBe(0);
  });
});

describe("computeYield", () => {
  it("floors bulk ÷ finished size for straight bottling", () => {
    const y = computeYield(nourishOil());
    expect(y.units).toBe(16); // 32 / 2
    expect(y.bulkInFinishedUnit).toBe(32);
    expect(y.basePerBottle).toBe(2);
  });

  it("gates yield on concentrate when diluted", () => {
    // 32 oz bulk, 6 oz concentrate + 2 oz water per 8 oz bottle.
    const y = computeYield(
      nourishOil({
        diluted: true,
        finishedSize: 8,
        concentratePerBottle: 6,
        waterPerBottle: 2,
      }),
    );
    expect(y.units).toBe(5); // floor(32 / 6)
    expect(y.basePerBottle).toBe(6);
  });

  it("converts when bulk and finished units differ", () => {
    // 1000 mL bulk, 50 mL bottles → 20 units.
    const y = computeYield(
      nourishOil({ bulkSize: 1000, bulkUnit: "ml", finishedSize: 50, finishedUnit: "ml" }),
    );
    expect(y.units).toBe(20);
  });

  it("returns 0 (not NaN/Infinity) when sizes are unset", () => {
    expect(computeYield(nourishOil({ finishedSize: 0 })).units).toBe(0);
    expect(computeYield(nourishOil({ bulkSize: 0 })).units).toBe(0);
  });
});

describe("resale / unit mode (bought to resell)", () => {
  // 50 scrunchies bought for $30 total.
  const scrunchies = (over: Partial<ProductProfitInput> = {}): ProductProfitInput => ({
    ...blankProduct(),
    name: "Scrunchie",
    category: "Accessories",
    pricingMode: "unit",
    unitCount: 50,
    bulkCost: 30,
    ...over,
  });

  it("yields the count bought, ignoring volume/dilution", () => {
    const y = computeYield(scrunchies({
      // These liquid fields must be ignored in unit mode.
      finishedSize: 0, bulkSize: 0, diluted: true, concentratePerBottle: 6,
    }));
    expect(y.units).toBe(50);
  });

  it("computes cost per item as total ÷ count (plus optional add-ons)", () => {
    const c = computeCostBreakdown(scrunchies());
    expect(c.units).toBe(50);
    expect(c.costPerUnit).toBe(0.6); // 30 / 50, no add-ons
    expect(c.perUnitLines.find((l) => l.label === "Item cost")?.amount).toBe(0.6);
  });

  it("folds optional packaging into the per-item cost", () => {
    const c = computeCostBreakdown(scrunchies({
      packaging: {
        bottle: { totalCost: 0, quantity: 0 },
        label: { totalCost: 10, quantity: 50 }, // $0.20 hang tag
        sprayer: { totalCost: 0, quantity: 0 },
        safetySeal: { totalCost: 0, quantity: 0 },
        box: { totalCost: 0, quantity: 0 },
      },
    }));
    expect(c.costPerUnit).toBe(0.8); // 0.60 item + 0.20 tag
  });

  it("is 0 (not NaN) before a quantity is entered", () => {
    expect(computeYield(scrunchies({ unitCount: 0 })).units).toBe(0);
    expect(computeCostBreakdown(scrunchies({ unitCount: 0 })).costPerUnit).toBe(0);
  });
});

describe("computeCostBreakdown", () => {
  it("sums packaging per unit and computes true cost per unit", () => {
    const c = computeCostBreakdown(nourishOil());
    expect(c.units).toBe(16);
    // packaging per unit: 0.60 + 0.18 + 0.24 = 1.02
    expect(c.packagingPerUnit).toBe(1.02);
    // batch: bulk 47 + packaging 1.02*16 (16.32) = 63.32
    expect(c.totalBatchCost).toBe(63.32);
    expect(c.costPerUnit).toBe(3.96); // 63.32 / 16 = 3.9575 → 3.96
  });

  it("adds labor and additional batch costs", () => {
    const c = computeCostBreakdown(
      nourishOil({
        labor: { batchMinutes: 90, hourlyRate: 25 }, // $37.50 batch
        additional: { shipping: 8, customs: 0, misc: 4 }, // $12 batch
      }),
    );
    // batch: 47 + 16.32 + 37.50 + 12 = 112.82
    expect(c.laborBatch).toBe(37.5);
    expect(c.additionalBatch).toBe(12);
    expect(c.totalBatchCost).toBe(112.82);
    expect(c.costPerUnit).toBe(7.05); // 112.82 / 16 = 7.05125 → 7.05
  });

  it("yields 0 cost per unit when nothing is produced", () => {
    const c = computeCostBreakdown(nourishOil({ bulkSize: 0 }));
    expect(c.units).toBe(0);
    expect(c.costPerUnit).toBe(0);
  });
});

describe("psychologicalPrice", () => {
  it("rounds up to the nearest x.99", () => {
    expect(psychologicalPrice(19.72)).toBe(19.99);
    expect(psychologicalPrice(21.34)).toBe(21.99);
    expect(psychologicalPrice(14.01)).toBe(14.99);
  });
  it("leaves charm prices and whole dollars sensible", () => {
    expect(psychologicalPrice(19.99)).toBe(19.99);
    expect(psychologicalPrice(19)).toBe(19.99);
  });
  it("handles zero / negative", () => {
    expect(psychologicalPrice(0)).toBe(0);
    expect(psychologicalPrice(-5)).toBe(0);
  });
});

describe("retailForMargin & wholesalePrice", () => {
  it("computes retail as cost ÷ (1 − margin)", () => {
    expect(retailForMargin(5, 50).raw).toBe(10);
    expect(retailForMargin(5, 50).rounded).toBe(10.99);
    expect(retailForMargin(6, 40).raw).toBe(10); // 6 / 0.6
  });
  it("keystones wholesale at cost × 2", () => {
    expect(wholesalePrice(4.82)).toBe(9.64);
  });
  it("guards a 100%+ margin from dividing by zero", () => {
    expect(retailForMargin(5, 100).raw).toBeGreaterThan(0);
    expect(Number.isFinite(retailForMargin(5, 100).raw)).toBe(true);
  });
});

describe("pricingTable", () => {
  it("returns a row per preset margin with rounded prices", () => {
    const rows = pricingTable(4.82);
    expect(rows.map((r) => r.marginPct)).toEqual([20, 30, 40, 50, 60, 70, 80]);
    // 4.82 / (1 - 0.5) = 9.64 → 9.99
    const fifty = rows.find((r) => r.marginPct === 50)!;
    expect(fifty.rounded).toBe(9.99);
  });
});

describe("computeForecast", () => {
  it("computes revenue, profit, ROI and break-even", () => {
    // Cost per unit 4.82, sell 24 units at 14.66.
    const input = nourishOil({ unitsToSell: 24, fees: { processingPct: 0, taxPct: 0 } });
    const cost = computeCostBreakdown(input);
    const f = computeForecast(input, 14.66, cost);
    expect(f.grossRevenue).toBe(round2(14.66 * 24));
    expect(f.cogs).toBe(round2(cost.costPerUnit * 24));
    expect(f.totalProfit).toBe(round2(f.grossRevenue - f.cogs));
    // ROI = profit / cogs
    expect(f.roiPct).toBe(round2((f.totalProfit / f.cogs) * 100));
    // break-even = ceil(batch cost / price)
    expect(f.breakEvenUnits).toBe(Math.ceil(cost.totalBatchCost / 14.66));
  });

  it("subtracts processing fees and taxes from net profit", () => {
    const input = nourishOil({
      unitsToSell: 10,
      fees: { processingPct: 2.9, taxPct: 10 },
    });
    const f = computeForecast(input, 20);
    expect(f.processingFees).toBe(round2(f.grossRevenue * 0.029));
    expect(f.taxes).toBe(round2(f.totalProfit * 0.1));
    expect(f.netProfit).toBe(
      round2(f.totalProfit - f.processingFees - f.taxes),
    );
    expect(f.netProfit).toBeLessThan(f.totalProfit);
  });

  it("returns null ROI/break-even when nothing is produced or priced at a loss", () => {
    const empty = computeForecast(nourishOil({ bulkSize: 0, unitsToSell: 0 }), 0);
    expect(empty.roiPct).toBeNull();
    expect(empty.breakEvenUnits).toBeNull();
  });
});

describe("calculateProduct", () => {
  it("composes yield, cost, pricing and forecast", () => {
    const m = calculateProduct(nourishOil({ marginPct: 50, unitsToSell: 16 }));
    expect(m.yield.units).toBe(16);
    expect(m.cost.costPerUnit).toBe(3.96);
    expect(m.wholesale).toBe(round2(3.96 * 2));
    expect(m.suggestedRetail).toBe(psychologicalPrice(3.96 / 0.5));
    expect(m.forecast.unitsToSell).toBe(16);
    expect(m.forecast.grossRevenue).toBe(round2(m.suggestedRetail * 16));
  });
});

describe("rankProducts & averageCostPerUnit", () => {
  const saved = (id: string, over: Partial<ProductProfitInput>, archived = false): SavedProduct => ({
    id,
    name: over.name || id,
    category: over.category || "Hair Oil",
    archived,
    updatedAt: "2026-06-20",
    input: nourishOil(over),
  });

  it("ranks active products by unit profit, excludes archived", () => {
    const ranked = rankProducts([
      saved("cheap", { name: "Cheap", marginPct: 30 }),
      saved("rich", { name: "Rich", marginPct: 80 }),
      saved("hidden", { name: "Hidden", marginPct: 90 }, true),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["rich", "cheap"]);
    expect(ranked.find((r) => r.id === "hidden")).toBeUndefined();
    expect(ranked[0].unitProfit).toBeGreaterThan(ranked[1].unitProfit);
  });

  it("averages cost per unit across active products", () => {
    const list = [saved("a", {}), saved("b", { bulkCost: 94 })];
    const avg = averageCostPerUnit(list);
    expect(avg).toBeGreaterThan(0);
    expect(rankProducts(null)).toEqual([]);
    expect(averageCostPerUnit([])).toBe(0);
  });
});

describe("topEarner", () => {
  const saved = (id: string, over: Partial<ProductProfitInput>): SavedProduct => ({
    id, name: over.name || id, category: "Hair Oil", archived: false,
    updatedAt: "2026-06-20", input: nourishOil(over),
  });

  it("picks the highest TOTAL projected profit when volumes are set", () => {
    // "premium" has the higher unit profit but sells few; "bulk" has a lower
    // unit profit but sells enough to earn more overall.
    const e = topEarner([
      saved("premium", { name: "Premium", marginPct: 80, unitsToSell: 5 }),
      saved("bulk", { name: "Bulk", marginPct: 40, unitsToSell: 100 }),
    ]);
    expect(e?.name).toBe("Bulk");
    expect(e?.basis).toBe("total");
  });

  it("falls back to highest unit profit when no volumes are entered", () => {
    const e = topEarner([
      saved("cheap", { name: "Cheap", marginPct: 30 }),
      saved("rich", { name: "Rich", marginPct: 80 }),
    ]);
    expect(e?.name).toBe("Rich");
    expect(e?.basis).toBe("unit");
  });

  it("returns null with no active products", () => {
    expect(topEarner([])).toBeNull();
    expect(topEarner(null)).toBeNull();
  });
});

const round2 = (n: number): number => Math.round(n * 100) / 100;
