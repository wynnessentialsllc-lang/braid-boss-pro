// Product Profit Calculator — pure costing/pricing/forecast engine.
//
// Helps a product-based beauty business (hair oils, sprays, butters, etc.)
// answer the six questions that actually decide whether a product line
// makes money:
//
//   1. True cost per finished unit.
//   2. How many finished units a bulk purchase yields.
//   3. What to charge for a target profit margin.
//   4. Expected revenue + profit at a sales volume.
//   5. Break-even units.
//   6. Profitability after merchant fees and taxes.
//
// Pure module: no React, no Supabase. Every number the UI shows is
// derived here so the math is unit-tested once (product-profit.test.ts)
// and reused by the form, the KPI cards, and the reporting dashboard.
//
// Future expansion (raw-ingredient %, formula costing, inventory
// deduction, COGS reporting, storefront price auto-suggest) all hangs
// off ProductProfitInput / calculateProduct without reshaping the table.

const round2 = (n: number): number => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export type SizeUnit = "oz" | "ml";

/** Fluid-ounce ⇄ millilitre. US fluid ounce. */
const ML_PER_OZ = 29.5735;

/** Convert a volume between oz and mL. Same-unit is a no-op. */
export const convertVolume = (
  value: number,
  from: SizeUnit,
  to: SizeUnit,
): number => {
  const v = num(value);
  if (from === to) return v;
  return from === "oz" ? v * ML_PER_OZ : v / ML_PER_OZ;
};

/**
 * A purchased-in-bulk cost line: you bought `quantity` of a thing for
 * `totalCost` (e.g. $30 for 50 bottles). Per-unit is totalCost ÷ quantity.
 */
export type CostLine = { totalCost: number; quantity: number };

/** Per-unit cost of a bulk line. Zero quantity (unset) → $0, never NaN. */
export const perUnitCost = (line: CostLine | null | undefined): number => {
  if (!line) return 0;
  const qty = num(line.quantity);
  if (qty <= 0) return 0;
  return round2(num(line.totalCost) / qty);
};

export const PRODUCT_CATEGORIES = [
  "Hair Oil",
  "Leave-In Spray",
  "Shampoo",
  "Conditioner",
  "Edge Control",
  "Hair Butter",
  "Serum",
  "Other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Everything the UI captures for one product. Persisted as `data` jsonb. */
export type ProductProfitInput = {
  name: string;
  category: ProductCategory | string;

  // Finished bottle.
  finishedSize: number;
  finishedUnit: SizeUnit;

  // Bulk base product.
  bulkCost: number;
  bulkSize: number;
  bulkUnit: SizeUnit;

  // Optional dilution: concentrate + water make up the finished bottle,
  // and yield is gated by how much *concentrate* each bottle consumes.
  diluted: boolean;
  concentratePerBottle: number;
  waterPerBottle: number;

  // Packaging — each is "totalCost for quantity". seal/box are optional.
  packaging: {
    bottle: CostLine;
    label: CostLine;
    sprayer: CostLine;
    safetySeal: CostLine;
    box: CostLine;
  };

  // Optional labor: time to make the whole batch × hourly rate.
  labor: { batchMinutes: number; hourlyRate: number };

  // Optional batch-level extras.
  additional: { shipping: number; customs: number; misc: number };

  // Profitability after fees + taxes (percent of revenue).
  fees: { processingPct: number; taxPct: number };

  // Pricing + forecast controls.
  marginPct: number; // selected retail margin, e.g. 50 → 0.5
  unitsToSell: number;
};

export const emptyCostLine = (): CostLine => ({ totalCost: 0, quantity: 0 });

/** A fresh product with sensible defaults for a new calculation. */
export const blankProduct = (): ProductProfitInput => ({
  name: "",
  category: "Hair Oil",
  finishedSize: 2,
  finishedUnit: "oz",
  bulkCost: 0,
  bulkSize: 0,
  bulkUnit: "oz",
  diluted: false,
  concentratePerBottle: 0,
  waterPerBottle: 0,
  packaging: {
    bottle: emptyCostLine(),
    label: emptyCostLine(),
    sprayer: emptyCostLine(),
    safetySeal: emptyCostLine(),
    box: emptyCostLine(),
  },
  labor: { batchMinutes: 0, hourlyRate: 0 },
  additional: { shipping: 0, customs: 0, misc: 0 },
  fees: { processingPct: 2.9, taxPct: 0 },
  marginPct: 50,
  unitsToSell: 0,
});

// ---- Yield -------------------------------------------------------------

export type YieldResult = {
  /** Whole finished units the bulk purchase produces. */
  units: number;
  /** Bulk volume expressed in the finished bottle's unit. */
  bulkInFinishedUnit: number;
  /** Volume each bottle draws from the bulk base (concentrate if diluted). */
  basePerBottle: number;
};

/**
 * How many finished units a bulk purchase yields.
 *
 *   Straight bottling:  floor(bulk ÷ finished size).
 *   Diluted:            each bottle only consumes `concentratePerBottle`
 *                       of the base, so yield = floor(bulk ÷ concentrate).
 *                       (Water is added per bottle and doesn't draw down
 *                       the bulk base.)
 *
 * Units are whole bottles — you can't sell a partial. Returns 0 rather
 * than Infinity/NaN when sizes are unset.
 */
export const computeYield = (input: ProductProfitInput): YieldResult => {
  const finishedUnit = input.finishedUnit === "ml" ? "ml" : "oz";
  const bulkInFinishedUnit = convertVolume(
    num(input.bulkSize),
    input.bulkUnit === "ml" ? "ml" : "oz",
    finishedUnit,
  );

  const basePerBottle = input.diluted
    ? num(input.concentratePerBottle)
    : num(input.finishedSize);

  const units =
    basePerBottle > 0 ? Math.floor(bulkInFinishedUnit / basePerBottle) : 0;

  return {
    units: Number.isFinite(units) && units > 0 ? units : 0,
    bulkInFinishedUnit: round2(bulkInFinishedUnit),
    basePerBottle: round2(basePerBottle),
  };
};

// ---- Cost breakdown ----------------------------------------------------

export type CostBreakdown = {
  units: number;
  bulkCost: number;
  packagingPerUnit: number;
  packagingBatch: number;
  laborBatch: number;
  laborPerUnit: number;
  additionalBatch: number;
  /** Bulk + packaging + labor + additional, for the whole batch. */
  totalBatchCost: number;
  /** True cost to make one finished unit. The headline number. */
  costPerUnit: number;
  /** Named lines for the per-unit cost breakdown UI. */
  perUnitLines: Array<{ label: string; amount: number }>;
};

export const computeCostBreakdown = (
  input: ProductProfitInput,
): CostBreakdown => {
  const { units } = computeYield(input);

  const bottle = perUnitCost(input.packaging?.bottle);
  const label = perUnitCost(input.packaging?.label);
  const sprayer = perUnitCost(input.packaging?.sprayer);
  const safetySeal = perUnitCost(input.packaging?.safetySeal);
  const box = perUnitCost(input.packaging?.box);
  const packagingPerUnit = round2(bottle + label + sprayer + safetySeal + box);

  const laborBatch = round2(
    (num(input.labor?.batchMinutes) / 60) * num(input.labor?.hourlyRate),
  );
  const additionalBatch = round2(
    num(input.additional?.shipping) +
      num(input.additional?.customs) +
      num(input.additional?.misc),
  );
  const bulkCost = round2(num(input.bulkCost));

  const packagingBatch = round2(packagingPerUnit * units);
  const totalBatchCost = round2(
    bulkCost + packagingBatch + laborBatch + additionalBatch,
  );
  const costPerUnit = units > 0 ? round2(totalBatchCost / units) : 0;
  const laborPerUnit = units > 0 ? round2(laborBatch / units) : 0;
  const bulkPerUnit = units > 0 ? round2(bulkCost / units) : 0;
  const additionalPerUnit = units > 0 ? round2(additionalBatch / units) : 0;

  return {
    units,
    bulkCost,
    packagingPerUnit,
    packagingBatch,
    laborBatch,
    laborPerUnit,
    additionalBatch,
    totalBatchCost,
    costPerUnit,
    perUnitLines: [
      { label: "Base product", amount: bulkPerUnit },
      { label: "Bottle", amount: bottle },
      { label: "Label", amount: label },
      { label: "Cap / sprayer", amount: sprayer },
      { label: "Safety seal", amount: safetySeal },
      { label: "Box / packaging", amount: box },
      { label: "Labor", amount: laborPerUnit },
      { label: "Shipping & extras", amount: additionalPerUnit },
    ].filter((l) => l.amount > 0),
  };
};

// ---- Pricing -----------------------------------------------------------

/**
 * Psychological "charm" pricing — round a raw suggested price UP to the
 * nearest x.99 (19.72 → 19.99, 21.34 → 21.99). Already-charm prices are
 * left alone (19.99 → 19.99). A whole dollar nudges to x.99 (19.00 →
 * 19.99) which reads better on a shelf.
 */
export const psychologicalPrice = (raw: number): number => {
  const n = round2(num(raw));
  if (n <= 0) return 0;
  const whole = Math.floor(n);
  const candidate = whole + 0.99;
  // `candidate` is below `n` only when n sits in (whole.99, whole+1):
  // bump to the next .99 so we never round a price DOWN.
  return round2(candidate >= n ? candidate : whole + 1.99);
};

export const MARGIN_PRESETS = [20, 30, 40, 50, 60, 70, 80] as const;

/**
 * Retail price for a target margin: cost ÷ (1 − margin). A 50% margin on
 * a $5 cost → $10, where margin is "profit as a share of the sale price".
 * Returns both the raw and the charm-rounded price.
 */
export const retailForMargin = (
  costPerUnit: number,
  marginPct: number,
): { raw: number; rounded: number } => {
  const cost = num(costPerUnit);
  const m = Math.min(Math.max(num(marginPct), 0), 99.9) / 100;
  const raw = m >= 1 ? cost : round2(cost / (1 - m));
  return { raw, rounded: psychologicalPrice(raw) };
};

/** Suggested wholesale price — the classic keystone (cost × 2). */
export const wholesalePrice = (costPerUnit: number): number =>
  round2(num(costPerUnit) * 2);

export type PricingRow = {
  marginPct: number;
  raw: number;
  rounded: number;
};

/** Build the margin → suggested-price table the UI renders. */
export const pricingTable = (
  costPerUnit: number,
  margins: readonly number[] = MARGIN_PRESETS,
): PricingRow[] =>
  margins.map((marginPct) => {
    const { raw, rounded } = retailForMargin(costPerUnit, marginPct);
    return { marginPct, raw, rounded };
  });

// ---- Revenue forecast --------------------------------------------------

export type ForecastResult = {
  unitsToSell: number;
  pricePerUnit: number;
  /** price × units sold. */
  grossRevenue: number;
  /** cost of the units sold. */
  cogs: number;
  /** Gross profit: revenue − COGS (before fees/taxes). */
  totalProfit: number;
  /** Merchant processing fees on revenue. */
  processingFees: number;
  /** Tax on pre-tax (gross) profit. */
  taxes: number;
  /** Profit after fees and taxes — the take-home. */
  netProfit: number;
  /** Return on the money spent: gross profit ÷ COGS, as a %. */
  roiPct: number | null;
  /** Units that must sell (at this price) to recover the batch cost. */
  breakEvenUnits: number | null;
};

/**
 * Revenue + profit at a chosen price and sales volume.
 *
 *   grossRevenue   = price × units
 *   COGS           = costPerUnit × units
 *   totalProfit    = grossRevenue − COGS
 *   processingFees = grossRevenue × processing%
 *   taxes          = max(0, totalProfit) × tax%
 *   netProfit      = totalProfit − fees − taxes
 *   ROI%           = totalProfit ÷ COGS
 *   break-even     = ceil(totalBatchCost ÷ price), null if price ≤ cost
 */
export const computeForecast = (
  input: ProductProfitInput,
  pricePerUnit: number,
  breakdown?: CostBreakdown,
): ForecastResult => {
  const cost = breakdown ?? computeCostBreakdown(input);
  const price = num(pricePerUnit);
  const units = Math.max(0, Math.floor(num(input.unitsToSell)));

  const grossRevenue = round2(price * units);
  const cogs = round2(cost.costPerUnit * units);
  const totalProfit = round2(grossRevenue - cogs);

  const processingFees = round2(
    grossRevenue * (num(input.fees?.processingPct) / 100),
  );
  const taxes = round2(
    Math.max(0, totalProfit) * (num(input.fees?.taxPct) / 100),
  );
  const netProfit = round2(totalProfit - processingFees - taxes);

  const roiPct = cogs > 0 ? round2((totalProfit / cogs) * 100) : null;

  const breakEvenUnits =
    price > cost.costPerUnit && cost.totalBatchCost > 0
      ? Math.ceil(cost.totalBatchCost / price)
      : null;

  return {
    unitsToSell: units,
    pricePerUnit: round2(price),
    grossRevenue,
    cogs,
    totalProfit,
    processingFees,
    taxes,
    netProfit,
    roiPct,
    breakEvenUnits,
  };
};

// ---- Composed product metrics (for saved products + dashboard) ---------

export type ProductMetrics = {
  yield: YieldResult;
  cost: CostBreakdown;
  pricing: PricingRow[];
  wholesale: number;
  /** Charm-rounded retail at the product's selected margin. */
  suggestedRetail: number;
  forecast: ForecastResult;
};

/** Run the full engine for one product. The single source the UI reads. */
export const calculateProduct = (input: ProductProfitInput): ProductMetrics => {
  const cost = computeCostBreakdown(input);
  const pricing = pricingTable(cost.costPerUnit);
  const suggested = retailForMargin(cost.costPerUnit, input.marginPct);
  const forecast = computeForecast(input, suggested.rounded, cost);
  return {
    yield: { ...computeYield(input) },
    cost,
    pricing,
    wholesale: wholesalePrice(cost.costPerUnit),
    suggestedRetail: suggested.rounded,
    forecast,
  };
};

// ---- Saved-product record (Supabase row → UI) --------------------------

export type SavedProduct = {
  id: string;
  name: string;
  category: string;
  archived: boolean;
  updatedAt: string;
  input: ProductProfitInput;
};

export type RankedProduct = {
  id: string;
  name: string;
  category: string;
  costPerUnit: number;
  suggestedRetail: number;
  marginPct: number | null;
  unitProfit: number;
  forecastRevenue: number;
  forecastProfit: number;
};

/**
 * Reduce saved products to the numbers the reporting dashboard ranks on
 * (highest profit, lowest margin, revenue by product, avg cost). Archived
 * products are excluded. Sorted by unit profit, highest first.
 */
export const rankProducts = (
  products: SavedProduct[] | null | undefined,
): RankedProduct[] => {
  if (!Array.isArray(products)) return [];
  return products
    .filter((p) => p && !p.archived)
    .map((p) => {
      const m = calculateProduct(p.input);
      const retail = m.suggestedRetail;
      const unitProfit = round2(retail - m.cost.costPerUnit);
      const marginPct =
        retail > 0 ? round2((unitProfit / retail) * 100) : null;
      return {
        id: p.id,
        name: (p.name || "").trim() || "Untitled product",
        category: p.category || "Other",
        costPerUnit: m.cost.costPerUnit,
        suggestedRetail: retail,
        marginPct,
        unitProfit,
        forecastRevenue: m.forecast.grossRevenue,
        forecastProfit: m.forecast.netProfit,
      };
    })
    .sort((a, b) => b.unitProfit - a.unitProfit);
};

/** Average true cost per unit across active products (dashboard KPI). */
export const averageCostPerUnit = (
  products: SavedProduct[] | null | undefined,
): number => {
  const ranked = rankProducts(products);
  if (ranked.length === 0) return 0;
  const total = ranked.reduce((sum, r) => sum + r.costPerUnit, 0);
  return round2(total / ranked.length);
};
