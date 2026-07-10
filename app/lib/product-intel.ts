// Product Profit Calculator — advisory / business-intelligence layer.
//
// The "CFO built into the app". product-profit.ts answers the mechanical
// questions (what does a unit cost, what should I charge, what will I
// make). This module turns those raw numbers into judgement: a health
// rating, plain-English recommendations, an optimal price, volume
// projections, and a batch snapshot.
//
// Pure module — no React, no Supabase. Every piece of advice a card shows
// is derived here so it's unit-tested once (product-intel.test.ts) and
// reused across the Product Health card, Founder Insights, the pricing
// simulator, the profit timeline and the batch snapshot.

import {
  computeCostBreakdown,
  psychologicalPrice,
  retailForMargin,
  type CostBreakdown,
  type ProductProfitInput,
} from "./product-profit";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const money = (n: number): string => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

const cost = (input: ProductProfitInput, given?: CostBreakdown): CostBreakdown =>
  given ?? computeCostBreakdown(input);

// ---- Per-unit economics ------------------------------------------------

export type UnitEconomics = {
  price: number;
  costPerUnit: number;
  /** price − cost, before fees/tax. */
  grossProfit: number;
  processingFee: number;
  tax: number;
  /** Take-home on a single unit, after fees and tax. */
  netProfit: number;
  /** Return on the money spent per unit: gross ÷ cost, as %. */
  roiPct: number | null;
};

/**
 * What one unit earns at a given price. Volume-independent, so it stays
 * meaningful even before the user enters an expected sales quantity —
 * which is exactly what the health score and per-unit card need.
 */
export const unitEconomics = (
  input: ProductProfitInput,
  price: number,
  breakdown?: CostBreakdown,
): UnitEconomics => {
  const c = cost(input, breakdown);
  const p = num(price);
  const costPerUnit = c.costPerUnit;
  const grossProfit = round2(p - costPerUnit);
  const processingFee = round2(p * (num(input.fees?.processingPct) / 100));
  const tax = round2(Math.max(0, grossProfit) * (num(input.fees?.taxPct) / 100));
  const netProfit = round2(grossProfit - processingFee - tax);
  const roiPct = costPerUnit > 0 ? round2((grossProfit / costPerUnit) * 100) : null;
  return { price: round2(p), costPerUnit, grossProfit, processingFee, tax, netProfit, roiPct };
};

// ---- Product health score ---------------------------------------------

export type HealthStatus =
  | "excellent"
  | "healthy"
  | "needs-improvement"
  | "reprice"
  | "incomplete";

/** Colour family — always paired with a label/icon, never colour alone. */
export type HealthTone = "green" | "orange" | "red" | "neutral";

export type ProductHealth = {
  status: HealthStatus;
  label: string;
  tone: HealthTone;
  explanation: string;
  roiPct: number | null;
  netProfit: number;
};

/**
 * Overall health rating for the current price.
 *
 *   🟢 Excellent Product   ROI ≥ 50% and positive net profit
 *   🟢 Healthy Margins     ROI 30–49%
 *   🟡 Needs Improvement   ROI 15–29%
 *   🔴 Reprice Before Launch  ROI < 15% or negative net profit
 *
 * Before any costs/price are entered we return an `incomplete` neutral
 * state rather than alarming the user with a red "reprice" verdict.
 */
export const productHealth = (
  input: ProductProfitInput,
  price: number,
  breakdown?: CostBreakdown,
): ProductHealth => {
  const c = cost(input, breakdown);
  const ue = unitEconomics(input, price, c);
  const roi = ue.roiPct;
  const net = ue.netProfit;

  if (c.units <= 0 || c.costPerUnit <= 0 || num(price) <= 0) {
    return {
      status: "incomplete",
      label: "Add your numbers",
      tone: "neutral",
      explanation: "Enter your costs and price to see your product health score.",
      roiPct: roi,
      netProfit: net,
    };
  }

  if (roi == null || roi < 15 || net < 0) {
    return {
      status: "reprice",
      label: "Reprice Before Launch",
      tone: "red",
      explanation:
        net < 0
          ? "This product loses money at the current price. Reprice it before production."
          : "This product should be repriced before production.",
      roiPct: roi,
      netProfit: net,
    };
  }
  if (roi >= 50 && net > 0) {
    return {
      status: "excellent",
      label: "Excellent Product",
      tone: "green",
      explanation: "Strong returns and healthy margins. Focus on driving sales volume.",
      roiPct: roi,
      netProfit: net,
    };
  }
  if (roi >= 30) {
    return {
      status: "healthy",
      label: "Healthy Margins",
      tone: "green",
      explanation: "Your pricing provides healthy, sustainable margins.",
      roiPct: roi,
      netProfit: net,
    };
  }
  return {
    status: "needs-improvement",
    label: "Needs Improvement",
    tone: "orange",
    explanation: "Your current pricing is limiting profitability.",
    roiPct: roi,
    netProfit: net,
  };
};

// ---- Recommended retail price -----------------------------------------

export type PriceRecommendation = {
  price: number;
  reason: string;
  roiPct: number | null;
};

/**
 * The optimal selling price: a healthy competitive retail margin (~45%)
 * that also clears a 40% ROI floor, then charm-rounded to x.99. Balances
 * profitability with staying competitive on the shelf.
 */
export const recommendedPrice = (
  input: ProductProfitInput,
  breakdown?: CostBreakdown,
): PriceRecommendation => {
  const c = cost(input, breakdown);
  const costPerUnit = c.costPerUnit;
  if (costPerUnit <= 0) {
    return { price: 0, reason: "Enter your costs to see a recommended price.", roiPct: null };
  }
  const roiFloor = costPerUnit * 1.4; // ≥ 40% ROI
  const healthyMargin = costPerUnit / (1 - 0.45); // 45% retail margin
  const price = psychologicalPrice(Math.max(roiFloor, healthyMargin));
  const roiPct = round2(((price - costPerUnit) / costPerUnit) * 100);
  return {
    price,
    reason: "This price balances profitability while remaining competitive.",
    roiPct,
  };
};

// ---- Pricing-simulator bounds -----------------------------------------

export type PriceBounds = {
  /** Cost of goods + $1 — never sell below cost. */
  min: number;
  /** 3× the current retail price. */
  max: number;
  /** The current retail price the slider centres on. */
  current: number;
};

/** Slider range for the pricing simulator. */
export const priceBounds = (
  input: ProductProfitInput,
  breakdown?: CostBreakdown,
): PriceBounds => {
  const c = cost(input, breakdown);
  const costPerUnit = c.costPerUnit;
  const min = round2(costPerUnit + 1);
  const override = num(input.retailPrice);
  const current =
    override > 0
      ? round2(override)
      : retailForMargin(costPerUnit, input.marginPct).rounded;
  const base = current > min ? current : min;
  let max = round2(base * 3);
  if (max <= min) max = round2(min * 3 + 3);
  return { min, max, current };
};

// ---- Profit timeline ---------------------------------------------------

export const TIMELINE_UNITS = [10, 25, 50, 100, 250, 500] as const;

export type TimelineRow = {
  units: number;
  revenue: number;
  netProfit: number;
  roiPct: number | null;
};

/** Live revenue / net-profit / ROI projections across sales volumes. */
export const profitTimeline = (
  input: ProductProfitInput,
  price: number,
  breakdown?: CostBreakdown,
  unitCounts: readonly number[] = TIMELINE_UNITS,
): TimelineRow[] => {
  const c = cost(input, breakdown);
  const p = num(price);
  const procPct = num(input.fees?.processingPct) / 100;
  const taxPct = num(input.fees?.taxPct) / 100;
  return unitCounts.map((units) => {
    const revenue = round2(p * units);
    const cogs = round2(c.costPerUnit * units);
    const grossProfit = round2(revenue - cogs);
    const fees = round2(revenue * procPct);
    const taxes = round2(Math.max(0, grossProfit) * taxPct);
    const netProfit = round2(grossProfit - fees - taxes);
    const roiPct = cogs > 0 ? round2((grossProfit / cogs) * 100) : null;
    return { units, revenue, netProfit, roiPct };
  });
};

// ---- Batch snapshot ----------------------------------------------------

export type BatchSnapshot = {
  unitsProduced: number;
  batchCost: number;
  retailValue: number;
  grossProfit: number;
  netProfit: number;
  profitPerUnit: number;
  roiPct: number | null;
  breakEvenUnits: number | null;
};

/** Quick overview of the current production batch at the chosen price. */
export const batchSnapshot = (
  input: ProductProfitInput,
  price: number,
  breakdown?: CostBreakdown,
): BatchSnapshot => {
  const c = cost(input, breakdown);
  const p = num(price);
  const units = c.units;
  const retailValue = round2(p * units);
  const batchCost = c.totalBatchCost;
  const grossProfit = round2(retailValue - batchCost);
  const fees = round2(retailValue * (num(input.fees?.processingPct) / 100));
  const taxes = round2(Math.max(0, grossProfit) * (num(input.fees?.taxPct) / 100));
  const netProfit = round2(grossProfit - fees - taxes);
  const profitPerUnit = unitEconomics(input, p, c).netProfit;
  const roiPct = batchCost > 0 ? round2((grossProfit / batchCost) * 100) : null;
  const breakEvenUnits =
    p > c.costPerUnit && batchCost > 0 ? Math.ceil(batchCost / p) : null;
  return {
    unitsProduced: units,
    batchCost,
    retailValue,
    grossProfit,
    netProfit,
    profitPerUnit,
    roiPct,
    breakEvenUnits,
  };
};

// ---- Founder insights --------------------------------------------------

/** recommendation = purple, attention = orange, healthy = green. */
export type InsightTone = "recommendation" | "attention" | "healthy";

export type Insight = {
  id: string;
  tone: InsightTone;
  text: string;
};

/**
 * Between 2 and 4 dynamic recommendations generated from the live
 * numbers — never hardcoded. Candidates are evaluated in priority order;
 * generic-but-true fallbacks guarantee at least two useful lines.
 */
export const founderInsights = (
  input: ProductProfitInput,
  price: number,
  breakdown?: CostBreakdown,
): Insight[] => {
  const c = cost(input, breakdown);

  if (c.units <= 0 || c.costPerUnit <= 0) {
    return [
      {
        id: "start-costs",
        tone: "recommendation",
        text: "Enter your bulk cost, packaging and finished size to unlock personalized pricing advice.",
      },
      {
        id: "start-price",
        tone: "recommendation",
        text: "Once your costs are in, the simulator will suggest a price that protects your margin.",
      },
    ];
  }

  const p = num(price);
  const ue = unitEconomics(input, p, c);
  const rec = recommendedPrice(input, c);
  const candidates: Insight[] = [];

  // 1. ROI is low — nudge the price toward the recommendation.
  if (ue.roiPct != null && ue.roiPct < 30 && rec.price > p) {
    const bump = Math.max(1, Math.round(rec.price - p));
    candidates.push({
      id: "raise-price",
      tone: "attention",
      text: `Consider increasing your retail price by $${bump} to about ${money(rec.price)}. This would significantly improve your ROI.`,
    });
  }

  // 2. Packaging is a large share of production cost.
  if (c.costPerUnit > 0) {
    const packShare = c.packagingPerUnit / c.costPerUnit;
    if (packShare >= 0.35) {
      candidates.push({
        id: "packaging-high",
        tone: "attention",
        text: `Packaging accounts for ${Math.round(packShare * 100)}% of your production cost. Buying containers in larger quantities could lower it.`,
      });
    }
  }

  // 3. Shipping exceeds 15% of total batch cost.
  const shipping = num(input.additional?.shipping);
  if (c.totalBatchCost > 0 && shipping / c.totalBatchCost > 0.15) {
    candidates.push({
      id: "shipping-high",
      tone: "recommendation",
      text: "Shipping is a large share of your costs. Ordering larger quantities may reduce your shipping cost per unit.",
    });
  }

  // 4. Expected sales volume is low.
  const units = Math.max(0, Math.floor(num(input.unitsToSell)));
  if (units > 0 && units < 25) {
    const target = Math.max(25, units * 2);
    candidates.push({
      id: "low-volume",
      tone: "recommendation",
      text: `Selling ${target} units instead of ${units} would dramatically improve your overall profitability.`,
    });
  } else if (units === 0) {
    candidates.push({
      id: "set-volume",
      tone: "recommendation",
      text: "Add how many units you expect to sell to forecast your total profit and break-even point.",
    });
  }

  // 5. Margins are already excellent — shift focus to volume.
  if (ue.roiPct != null && ue.roiPct >= 50 && ue.netProfit > 0) {
    candidates.push({
      id: "healthy-volume",
      tone: "healthy",
      text: "Your margins are healthy. Focus on increasing sales volume to grow total profit.",
    });
  }

  // Fallbacks so we always show at least two insights.
  const fallbacks: Insight[] = [
    {
      id: "fallback-track",
      tone: "recommendation",
      text: "Revisit your true cost per unit whenever supplier prices change to protect your margin.",
    },
    {
      id: "fallback-bundle",
      tone: "recommendation",
      text: "Bundling two products can raise your average order value without adding much cost.",
    },
  ];

  const seen = new Set<string>();
  const out: Insight[] = [];
  for (const insight of [...candidates, ...fallbacks]) {
    if (seen.has(insight.id)) continue;
    seen.add(insight.id);
    out.push(insight);
    if (out.length >= 4) break;
  }
  return out.slice(0, Math.min(4, Math.max(2, out.length)));
};
