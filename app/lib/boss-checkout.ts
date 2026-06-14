// Boss Checkout — the in-person point-of-sale "ticket" model (pure).
//
// This is the Braid Boss Pro answer to Square's Checkout screen: ring up
// a walk-in or an appointment from three sources (a booked appointment, a
// quick custom amount, or the services/products catalog), apply a
// discount + gift-card + loyalty reward, add a tip, take payment, and
// turn the finished sale into the side effects the rest of the app
// already understands:
//
//   * a payment_transactions row (manual ledger — see transactions.ts /
//     the payment_transactions_v1 migration),
//   * inventory movements to deduct what was sold/used (product stock +
//     a service line's hair recipe — see inventory.ts applyMovement),
//   * a loyalty redemption (loyalty.ts recordLoyaltyRedemption),
//   * a take-home / $-per-hour readout (pricing-profit.ts computeProfit) —
//     the thing no other POS shows the stylist at checkout.
//
// Pure module: no React, no Supabase, no DOM. Every number is in the
// currency's MAJOR unit (dollars), matching the rest of the app. Unit-
// tested in boss-checkout.test.ts. The monolith maps its `store` shapes
// onto these types; this module never imports store types so the math
// stays testable in isolation.

import type { PaymentMethod } from "./transactions";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

// What a ticket line represents. Drives both the price math and the
// post-sale side effects:
//   * service   — a booked/added style. Revenue; may carry a hair recipe
//                 (auto-deduct) and hours (for the $/hr readout).
//   * product   — retail stock sold at the chair. Revenue; deducts the
//                 linked inventory item on completion.
//   * custom    — a free-typed amount (the "keypad" path). Revenue; no
//                 catalog link and no inventory effect.
//   * gift_card — SELLING/loading a gift card. Collected as cash but it's
//                 deferred revenue (recognised when redeemed), so it's
//                 excluded from the service/retail profit math below.
export type SaleLineKind = "service" | "product" | "custom" | "gift_card";

// A single hair/supply component a service line consumes. Mirrors the
// shape recipe-cost.ts already uses so a service's saved recipe rides
// straight onto the ticket and into the deduction.
export type SaleRecipeLine = {
  itemId: string;
  variationId?: string | null;
  quantity: number;
  unitCost?: number | null;
  itemName?: string | null;
};

export type SaleLine = {
  // Unique within the ticket (not a catalog id — see refId for that).
  id: string;
  kind: SaleLineKind;
  name: string;
  /** Price per unit in dollars (already resolved for the chosen variation). */
  unitPrice: number;
  quantity: number;

  /** Catalog id this line came from: service id / product id / gift-card sku. */
  refId?: string | null;
  variationId?: string | null;
  variationLabel?: string | null;

  /** Product lines: the inventory item (+ variation) to deduct on completion. */
  inventoryItemId?: string | null;
  inventoryVariationId?: string | null;

  /**
   * Real out-of-pocket cost PER UNIT for this line (product unit cost, or a
   * custom material cost). Used for the take-home readout. Service lines
   * usually leave this null and carry a `recipe` instead, whose cost is
   * summed below.
   */
  unitCost?: number | null;

  /** Service lines: hair recipe for the take-home readout + auto-deduct. */
  recipe?: SaleRecipeLine[] | null;
  /** Service lines: per-appointment overhead (supplies/utilities) for profit. */
  overhead?: number | null;
  /** Service lines: hours in the chair, for the take-home-per-hour readout. */
  hours?: number | null;
};

// ---------------------------------------------------------------------------
// The ticket
// ---------------------------------------------------------------------------

// A discount the stylist already created (discounts.ts). We only need the
// shape that drives the math; the picker passes the selected row through.
export type SaleDiscount = {
  id: string | null;
  name: string | null;
  discount_type: "fixed" | "percentage";
  value: number;
};

// A gift card redeemed AS TENDER (spending a code), distinct from a
// gift_card sale LINE (loading a new card).
export type SaleGiftCardTender = {
  id: string;
  code: string;
  /** Dollars the stylist chose to pull off the card for this sale. */
  amount: number;
};

// A loyalty reward redeemed as tender — points traded for dollars off.
export type SaleLoyaltyTender = {
  pointsSpent: number;
  rewardValue: number;
};

export type SaleDraft = {
  lines: SaleLine[];
  discount?: SaleDiscount | null;
  giftCard?: SaleGiftCardTender | null;
  loyaltyReward?: SaleLoyaltyTender | null;
  tipAmount?: number | null;
  /** Sales-tax rate as a fraction (e.g. 0.0875). Optional; defaults to 0. */
  taxRate?: number | null;
  clientId?: string | null;
  clientName?: string | null;
  appointmentId?: string | null;
};

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type SaleTotals = {
  /** Sum of every line (price × qty), before any discount. */
  subtotal: number;
  /** Dollars removed by the selected discount (never exceeds subtotal). */
  discountAmount: number;
  /** subtotal − discount. The base tax + profit are figured on. */
  taxableBase: number;
  /** round(taxableBase × taxRate). */
  taxAmount: number;
  tip: number;
  /** taxableBase + tax + tip. The full price of the ticket. */
  grandTotal: number;
  /** Gift-card tender actually applied (clamped to the grand total). */
  giftCardApplied: number;
  /** Loyalty reward tender applied (clamped to what's left after gift card). */
  loyaltyApplied: number;
  /** giftCardApplied + loyaltyApplied — non-cash tender. */
  creditsApplied: number;
  /** grandTotal − credits. What the card/cash/Tap-to-Pay must cover. */
  amountDue: number;
};

// Per-unit real cost of a line (product unit cost, custom material cost,
// or a service's summed hair recipe). gift_card sale lines have no COGS.
const lineUnitCost = (line: SaleLine): number => {
  if (line.kind === "gift_card") return 0;
  if (line.recipe && line.recipe.length > 0) {
    return line.recipe.reduce(
      (sum, r) => sum + Math.max(0, toNum(r.quantity)) * Math.max(0, toNum(r.unitCost)),
      0,
    );
  }
  return Math.max(0, toNum(line.unitCost));
};

const lineSubtotal = (line: SaleLine): number =>
  Math.max(0, toNum(line.unitPrice)) * Math.max(0, Math.floor(toNum(line.quantity)));

// Dollars a discount removes from a subtotal. Kept local (rather than
// importing discounts.ts computeDiscountAmount) so this module stays free
// of the discounts hook's React import; the math is identical and covered
// by tests.
const discountAmountFor = (subtotal: number, d: SaleDiscount | null | undefined): number => {
  if (!d || subtotal <= 0) return 0;
  const value = Math.max(0, toNum(d.value));
  if (value <= 0) return 0;
  if (d.discount_type === "percentage") {
    return round2((subtotal * Math.min(100, value)) / 100);
  }
  return round2(Math.min(subtotal, value));
};

export const computeSaleTotals = (draft: SaleDraft): SaleTotals => {
  const lines = Array.isArray(draft.lines) ? draft.lines : [];
  const subtotal = round2(lines.reduce((s, l) => s + lineSubtotal(l), 0));
  const discountAmount = discountAmountFor(subtotal, draft.discount);
  const taxableBase = round2(Math.max(0, subtotal - discountAmount));

  const taxRate = Math.max(0, toNum(draft.taxRate));
  const taxAmount = round2(taxableBase * taxRate);
  const tip = round2(Math.max(0, toNum(draft.tipAmount)));
  const grandTotal = round2(taxableBase + taxAmount + tip);

  // Credits are applied as tender, gift card first then loyalty, each
  // clamped so we never refund value the ticket doesn't owe.
  const giftCardApplied = round2(Math.min(grandTotal, Math.max(0, toNum(draft.giftCard?.amount))));
  const remaining = round2(Math.max(0, grandTotal - giftCardApplied));
  const loyaltyApplied = round2(Math.min(remaining, Math.max(0, toNum(draft.loyaltyReward?.rewardValue))));
  const creditsApplied = round2(giftCardApplied + loyaltyApplied);
  const amountDue = round2(Math.max(0, grandTotal - creditsApplied));

  return {
    subtotal,
    discountAmount,
    taxableBase,
    taxAmount,
    tip,
    grandTotal,
    giftCardApplied,
    loyaltyApplied,
    creditsApplied,
    amountDue,
  };
};

// ---------------------------------------------------------------------------
// Take-home readout (the differentiator)
// ---------------------------------------------------------------------------

export type SaleProfit = {
  /** Service/retail revenue counted for margin (excludes gift-card sales). */
  revenue: number;
  /** Real out-of-pocket cost of everything sold (hair + product + overhead). */
  materialCost: number;
  /** revenue − materialCost. What the stylist keeps before tip. */
  takeHome: number;
  /** takeHome + tip. */
  takeHomeWithTip: number;
  /** takeHome ÷ total service hours, or null when no hours on the ticket. */
  takeHomePerHour: number | null;
  /** takeHome ÷ revenue × 100, or null when revenue is 0. */
  marginPct: number | null;
};

// Profit is figured on the post-discount, pre-tax, pre-tip revenue, since
// tax is the government's money and tip is pass-through. Gift-card SALE
// lines are excluded from both revenue and cost (deferred revenue). The
// discount is apportioned across the counted lines so margin reflects what
// the client actually paid.
export const computeSaleProfit = (draft: SaleDraft): SaleProfit => {
  const lines = (Array.isArray(draft.lines) ? draft.lines : []).filter(
    (l) => l.kind !== "gift_card",
  );
  const grossRevenue = round2(lines.reduce((s, l) => s + lineSubtotal(l), 0));

  // Apportion the discount only across the counted (non-gift-card) lines.
  const fullSubtotal = round2(
    (draft.lines || []).reduce((s, l) => s + lineSubtotal(l), 0),
  );
  const totalDiscount = discountAmountFor(fullSubtotal, draft.discount);
  const countedDiscount =
    fullSubtotal > 0 ? round2((totalDiscount * grossRevenue) / fullSubtotal) : 0;
  const revenue = round2(Math.max(0, grossRevenue - countedDiscount));

  const materialCost = round2(
    lines.reduce((s, l) => {
      const units = Math.max(0, Math.floor(toNum(l.quantity)));
      const perUnit = lineUnitCost(l);
      const overhead = Math.max(0, toNum(l.overhead));
      return s + perUnit * units + overhead;
    }, 0),
  );
  const hours = round2(
    lines.reduce((s, l) => s + Math.max(0, toNum(l.hours)), 0),
  );
  const tip = round2(Math.max(0, toNum(draft.tipAmount)));

  const takeHome = round2(revenue - materialCost);
  return {
    revenue,
    materialCost,
    takeHome,
    takeHomeWithTip: round2(takeHome + tip),
    takeHomePerHour: hours > 0 ? round2(takeHome / hours) : null,
    marginPct: revenue > 0 ? round2((takeHome / revenue) * 100) : null,
  };
};

// ---------------------------------------------------------------------------
// Post-sale side effects
// ---------------------------------------------------------------------------

// Tender the stylist took payment with. "tap_to_pay" routes through the
// Stripe Terminal flow (taptopay.ts); the rest are recorded by hand.
export type SaleTender =
  | "tap_to_pay"
  | "cash"
  | "zelle"
  | "cashapp"
  | "venmo"
  | "card"
  | "other";

// Map a chosen tender onto the payment_transactions.payment_method enum.
export const tenderToMethod = (tender: SaleTender): PaymentMethod => {
  switch (tender) {
    case "tap_to_pay":
      return "stripe";
    case "cash":
      return "cash";
    case "zelle":
      return "zelle";
    case "cashapp":
      return "cashapp";
    case "venmo":
      return "venmo";
    case "card":
      return "card";
    default:
      return "other";
  }
};

// A short, human ticket label for the transaction's service_name column,
// so the Payments list reads like the stylist's mental model:
//   "Knotless Medium + 1 more"  /  "Edge control ×2"  /  "Quick sale".
export const ticketLabel = (lines: SaleLine[]): string => {
  const named = (lines || []).filter((l) => (l.name || "").trim());
  if (named.length === 0) return "Quick sale";
  const first = named[0];
  const firstQty = Math.max(1, Math.floor(toNum(first.quantity)));
  const head = firstQty > 1 ? `${first.name} ×${firstQty}` : first.name;
  const rest = named.length - 1;
  return rest > 0 ? `${head} + ${rest} more` : head;
};

// The transaction record a finished sale writes through
// store.upsertTransaction(). Shape is the app's camelCase entity (the
// `transactions` store → payment_transactions cloud table): the sync
// layer (lib/supabase.ts toCloudRow) promotes these to the table's
// snake_case columns and drops the rest — including `data` — into the
// jsonb blob, so the full ticket survives for receipts + refunds.
// transactions.ts fromManualRecord reads these same camelCase fields.
export type SaleTransactionRecord = {
  appointmentId: string | null;
  clientId: string | null;
  clientName: string | null;
  serviceName: string;
  /** New money collected through the tender (excludes tip; tip is its own field). */
  amount: number;
  tipAmount: number;
  paymentType: "full";
  paymentMethod: PaymentMethod;
  paidAt: string;
  note: string;
  data: {
    source: "boss_checkout";
    tender: SaleTender;
    lines: SaleLine[];
    totals: SaleTotals;
    discount: SaleDiscount | null;
    giftCardId: string | null;
    loyaltyPointsSpent: number;
    taxAmount: number;
    stripePaymentIntentId: string | null;
  };
};

// Build the ledger row. `amount` is the NEW money that moved through this
// tender (amountDue minus the tip portion), so gift-card / loyalty credit
// — already-recognised or give-away value — never double-counts as fresh
// revenue. Tip is stored separately, matching the rest of the app.
export const buildSaleTransaction = (
  draft: SaleDraft,
  args: {
    tender: SaleTender;
    paidAt?: string;
    note?: string;
    stripePaymentIntentId?: string | null;
  },
): SaleTransactionRecord => {
  const totals = computeSaleTotals(draft);
  const tender = args.tender;
  // amountDue includes the tip; the goods/services portion newly paid is
  // amountDue − tip (credits are applied to the goods first).
  const goodsPaid = round2(Math.max(0, totals.amountDue - totals.tip));
  return {
    appointmentId: draft.appointmentId ?? null,
    clientId: draft.clientId ?? null,
    clientName: draft.clientName ?? null,
    serviceName: ticketLabel(draft.lines),
    amount: goodsPaid,
    tipAmount: totals.tip,
    paymentType: "full",
    paymentMethod: tenderToMethod(tender),
    paidAt: args.paidAt || new Date().toISOString(),
    note: args.note || "",
    data: {
      source: "boss_checkout",
      tender,
      lines: draft.lines,
      totals,
      discount: draft.discount ?? null,
      giftCardId: draft.giftCard?.id ?? null,
      loyaltyPointsSpent: Math.max(0, Math.floor(toNum(draft.loyaltyReward?.pointsSpent))),
      taxAmount: totals.taxAmount,
      stripePaymentIntentId: args.stripePaymentIntentId ?? null,
    },
  };
};

// The inventory deductions a finished sale should apply: every product
// line (its own stock) plus every service line's hair recipe. Returned as
// plain descriptors so the caller can feed each to inventory.applyMovement
// with a deterministic, idempotent movement id (saleId + index) — re-
// running a failed finalize can't double-deduct.
export type SaleDeduction = {
  itemId: string;
  variationId: string | null;
  /** Positive count consumed; the caller passes it to applyMovement as −qty. */
  quantity: number;
  reason: "storefront_sale" | "service_use";
  unitCostSnapshot: number | null;
  note: string;
};

export const saleDeductions = (draft: SaleDraft): SaleDeduction[] => {
  const out: SaleDeduction[] = [];
  for (const line of draft.lines || []) {
    const units = Math.max(0, Math.floor(toNum(line.quantity)));
    if (units <= 0) continue;
    if (line.kind === "product" && line.inventoryItemId) {
      out.push({
        itemId: line.inventoryItemId,
        variationId: line.inventoryVariationId ?? null,
        quantity: units,
        reason: "storefront_sale",
        unitCostSnapshot: line.unitCost == null ? null : round2(toNum(line.unitCost)),
        note: `Boss Checkout — ${line.name}`,
      });
    }
    if (line.kind === "service" && line.recipe && line.recipe.length > 0) {
      for (const r of line.recipe) {
        const q = Math.max(0, toNum(r.quantity)) * units;
        if (!r.itemId || q <= 0) continue;
        out.push({
          itemId: r.itemId,
          variationId: r.variationId ?? null,
          quantity: q,
          reason: "service_use",
          unitCostSnapshot: r.unitCost == null ? null : round2(toNum(r.unitCost)),
          note: `Boss Checkout — ${line.name}`,
        });
      }
    }
  }
  return out;
};

// Loyalty points a completed sale earns the client. Mirrors the rest of
// the app: points are per-VISIT, not per-dollar, so one in-person sale
// tied to a client earns one visit's worth (when the program is on and a
// client is attached). Returns 0 when there's nothing to earn.
export const saleLoyaltyEarn = (
  draft: SaleDraft,
  program: { enabled: boolean; pointsPerVisit: number } | null | undefined,
): number => {
  if (!program?.enabled) return 0;
  if (!draft.clientId) return 0;
  // A pure product/gift-card sale isn't a "visit"; only count it when a
  // service was actually performed on the ticket.
  const hasService = (draft.lines || []).some((l) => l.kind === "service");
  if (!hasService) return 0;
  return Math.max(0, Math.floor(toNum(program.pointsPerVisit)));
};
