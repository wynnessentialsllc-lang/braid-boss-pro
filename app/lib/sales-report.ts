// Sales Report — pure aggregation for the Square-style reports page.
//
// Two sources, combined the same way the app already reasons about money:
//   * appointments    — billable tickets drive Gross/Net sales, the sales
//                       count, discounts, top items and top categories.
//                       (Same isBillable / ticketTotal rules as reports.ts
//                       so the numbers can never disagree with Dashboard.)
//   * transactions     — the merged ledger (cash / card / Stripe) drives the
//                       "Sales by payment type" block, processing fees, and
//                       returns (refunds).
//
// Side-effect free + DOM-free so the page, the API and tests share it.
// Money is always in the currency's major unit (dollars).

import type { Transaction, PaymentMethod } from "./transactions";

// ---- Inputs -----------------------------------------------------------

export type ReportAppointment = {
  id?: string;
  date?: string;            // YYYY-MM-DD
  status?: string;
  kind?: string;            // "appointment" | "personal" | "blocked"
  totalPrice?: number | string;
  discountAmount?: number | string;
  discountName?: string | null;
  clientName?: string | null;
  style?: string | null;
  serviceId?: string | null;
  cancelledAt?: string | null;
  cancelled_at?: string | null;
  canceledAt?: string | null;
  canceled_at?: string | null;
};

export type ReportRange = "1D" | "1W" | "1M" | "3M" | "1Y";

export const RANGES: { key: ReportRange; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "1Y", label: "1Y" },
];

// ---- Outputs ----------------------------------------------------------

export type SalesSummary = {
  grossSales: number;   // pre-discount ticket totals
  netSales: number;     // gross − discounts − returns
  salesCount: number;   // billable tickets in range
  averageSale: number;  // netSales / salesCount
  returns: number;      // magnitude of refunds (>= 0)
  discounts: number;    // sum of discount snapshots
};

export type PaymentBreakdown = {
  totalCollected: number; // cash + card + other (gross, before fees)
  cash: number;
  card: number;           // card + Stripe
  other: number;          // Zelle / Cash App / Venmo / other
  fees: number;           // processing fees (Stripe)
  netTotal: number;       // totalCollected − fees
};

export type RankedRow = { label: string; gross: number; count: number };

export type SeriesPoint = { label: string; current: number; previous: number };

// One underlying row behind a summary card, for the tap-to-drill-down list.
export type SaleDetail = {
  id: string;
  title: string;     // client (or style) the sale/refund/discount is for
  subtitle: string;  // style / payment method / discount name
  date: string;      // YYYY-MM-DD
  gross: number;     // pre-discount ticket (sales only; 0 elsewhere)
  net: number;       // post-discount ticket (sales only; 0 elsewhere)
  amount: number;    // the figure this row contributes (refund/discount $)
};

export type ReportDetails = {
  sales: SaleDetail[];      // billable tickets (Gross / Net / Sales / Average)
  returns: SaleDetail[];    // refunds
  discounts: SaleDetail[];  // discounted tickets
};

export type SalesReport = {
  summary: SalesSummary;
  payments: PaymentBreakdown;
  topItems: RankedRow[];
  topCategories: RankedRow[];
  series: SeriesPoint[];
  details: ReportDetails;
  previousGross: number;   // total gross of the comparison period
  rangeLabel: string;      // human label for the active range
};

// ---- Small helpers ----------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Number((n + Number.EPSILON).toFixed(2));

const isCanceled = (a: ReportAppointment): boolean => {
  const s = String(a?.status || "").toLowerCase();
  if (s === "cancelled" || s === "canceled" || s === "no_show") return true;
  return !!(a?.cancelledAt || a?.cancelled_at || a?.canceledAt || a?.canceled_at);
};
const isBillable = (a: ReportAppointment): boolean => {
  if (!a) return false;
  if (isCanceled(a)) return false;
  if (a.kind && a.kind !== "appointment") return false;
  return true;
};
const ticketTotal = (a: ReportAppointment): number =>
  Math.max(0, num(a.totalPrice) - num(a.discountAmount));

// ---- Local date helpers (timezone-safe ISO math) ----------------------

const pad = (n: number): string => String(n).padStart(2, "0");
const toISO = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso: string): Date => new Date(`${iso}T00:00:00`);
const addDays = (iso: string, days: number): string => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};
const addMonths = (iso: string, months: number): string => {
  const d = fromISO(iso);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
};
const daysInclusive = (start: string, end: string): number =>
  Math.round((fromISO(end).getTime() - fromISO(start).getTime()) / 86400000) + 1;

export const todayISO = (): string => toISO(new Date());

// Window [start, end] (both inclusive) for a range ending at `reference`.
export const rangeWindow = (
  range: ReportRange,
  reference: string,
): { start: string; end: string } => {
  const end = reference;
  switch (range) {
    case "1D": return { start: end, end };
    case "1W": return { start: addDays(end, -6), end };
    case "1M": return { start: addDays(addMonths(end, -1), 1), end };
    case "3M": return { start: addDays(addMonths(end, -3), 1), end };
    case "1Y":
    default:   return { start: addDays(addMonths(end, -12), 1), end };
  }
};

const RANGE_LABEL: Record<ReportRange, string> = {
  "1D": "Today",
  "1W": "This week",
  "1M": "This month",
  "3M": "Last 3 months",
  "1Y": "This year",
};

// ---- Chart buckets ----------------------------------------------------
// Each current bucket is paired with the same-shaped bucket exactly one
// window-length earlier, so current[i] and previous[i] line up on the chart.

type Bucket = { label: string; start: string; end: string };

const monthLabel = (iso: string): string =>
  fromISO(iso).toLocaleDateString("en-US", { month: "short" });
const dayLabel = (iso: string): string =>
  fromISO(iso).toLocaleDateString("en-US", { weekday: "short" });
const dayNumLabel = (iso: string): string =>
  fromISO(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

const buildBuckets = (range: ReportRange, start: string, end: string): Bucket[] => {
  const out: Bucket[] = [];
  if (range === "1D") {
    out.push({ label: dayLabel(start), start, end });
    return out;
  }
  if (range === "1W") {
    for (let iso = start; iso <= end; iso = addDays(iso, 1)) {
      out.push({ label: dayLabel(iso), start: iso, end: iso });
    }
    return out;
  }
  if (range === "1M") {
    // ~weekly chunks
    let s = start;
    while (s <= end) {
      const e = addDays(s, 6) > end ? end : addDays(s, 6);
      out.push({ label: dayNumLabel(s), start: s, end: e });
      s = addDays(e, 1);
    }
    return out;
  }
  // 3M / 1Y — one bucket per calendar month overlapping the window.
  let cursor = `${start.slice(0, 7)}-01`;
  const endMonth = `${end.slice(0, 7)}-01`;
  while (cursor <= endMonth) {
    const next = addMonths(cursor, 1);
    const bucketStart = cursor < start ? start : cursor;
    const bucketEnd = addDays(next, -1) > end ? end : addDays(next, -1);
    out.push({ label: monthLabel(cursor), start: bucketStart, end: bucketEnd });
    cursor = next;
  }
  return out;
};

// ---- Payment-type mapping ---------------------------------------------

const collectedBucketFor = (m: PaymentMethod): "cash" | "card" | "other" => {
  if (m === "cash") return "cash";
  if (m === "card" || m === "stripe") return "card";
  return "other"; // zelle / cashapp / venmo / other
};

// ---- Main builder -----------------------------------------------------

export const buildSalesReport = (
  appointments: ReportAppointment[] | null | undefined,
  transactions: Transaction[] | null | undefined,
  serviceCategoryById: Record<string, string> | null | undefined,
  range: ReportRange,
  reference: string = todayISO(),
): SalesReport => {
  const { start, end } = rangeWindow(range, reference);
  const winLen = daysInclusive(start, end);
  const prevStart = addDays(start, -winLen);
  const prevEnd = addDays(end, -winLen);
  const catMap = serviceCategoryById || {};

  const appts = (appointments || []).filter(isBillable);

  // --- Summary + top items/categories (appointment-driven) ---
  let grossSales = 0;
  let discounts = 0;
  let salesCount = 0;
  const itemMap = new Map<string, { gross: number; count: number }>();
  const catRollup = new Map<string, { gross: number; count: number }>();
  const salesDetail: SaleDetail[] = [];
  const discountsDetail: SaleDetail[] = [];

  for (const a of appts) {
    const d = a.date || "";
    if (d < start || d > end) continue;
    const gross = num(a.totalPrice);
    const ticket = ticketTotal(a);
    if (ticket <= 0 && gross <= 0) continue;
    grossSales += gross;
    const disc = num(a.discountAmount);
    discounts += disc;
    salesCount += 1;

    const item = (a.style || "Other service").trim() || "Other service";
    const ri = itemMap.get(item) || { gross: 0, count: 0 };
    ri.gross += ticket; ri.count += 1; itemMap.set(item, ri);

    const catName = (a.serviceId && catMap[a.serviceId]) || "Uncategorized";
    const rc = catRollup.get(catName) || { gross: 0, count: 0 };
    rc.gross += ticket; rc.count += 1; catRollup.set(catName, rc);

    const id = String(a.id || `${d}-${salesCount}`);
    const title = (a.clientName || a.style || "Sale").toString().trim() || "Sale";
    salesDetail.push({ id, title, subtitle: (a.style || "").toString(), date: d, gross: round2(gross), net: round2(ticket), amount: round2(ticket) });
    if (disc > 0) {
      discountsDetail.push({ id: `disc-${id}`, title, subtitle: (a.discountName || a.style || "Discount").toString(), date: d, gross: 0, net: 0, amount: round2(disc) });
    }
  }

  // --- Payment types + returns (transaction-driven) ---
  const pay: PaymentBreakdown = {
    totalCollected: 0, cash: 0, card: 0, other: 0, fees: 0, netTotal: 0,
  };
  let returns = 0;
  const returnsDetail: SaleDetail[] = [];
  for (const t of transactions || []) {
    const d = (t.paidAt || "").slice(0, 10);
    if (!d || d < start || d > end) continue;
    if (t.type === "refund" || t.amount < 0) {
      const amt = Math.abs(t.amount);
      returns += amt;
      returnsDetail.push({ id: String(t.id), title: t.clientName || "Refund", subtitle: t.serviceName || "", date: d, gross: 0, net: 0, amount: round2(amt) });
      continue;
    }
    const collected = t.amount + (t.amount > 0 ? t.tip : 0);
    pay[collectedBucketFor(t.method)] += collected;
    pay.totalCollected += collected;
    pay.fees += t.fee > 0 ? t.fee : 0;
  }
  pay.netTotal = pay.totalCollected - pay.fees;

  const netSales = grossSales - discounts - returns;

  const summary: SalesSummary = {
    grossSales: round2(grossSales),
    netSales: round2(netSales),
    salesCount,
    averageSale: salesCount > 0 ? round2(netSales / salesCount) : 0,
    returns: round2(returns),
    discounts: round2(discounts),
  };

  const rank = (m: Map<string, { gross: number; count: number }>): RankedRow[] =>
    Array.from(m.entries())
      .map(([label, v]) => ({ label, gross: round2(v.gross), count: v.count }))
      .sort((a, b) => b.gross - a.gross || b.count - a.count)
      .slice(0, 5);

  // --- Chart series (gross by bucket, current vs previous window) ---
  const buckets = buildBuckets(range, start, end);
  const grossInRange = (s: string, e: string): number => {
    let sum = 0;
    for (const a of appts) {
      const d = a.date || "";
      if (d >= s && d <= e) sum += num(a.totalPrice);
    }
    return sum;
  };
  const series: SeriesPoint[] = buckets.map((b) => ({
    label: b.label,
    current: round2(grossInRange(b.start, b.end)),
    previous: round2(grossInRange(addDays(b.start, -winLen), addDays(b.end, -winLen))),
  }));
  const previousGross = round2(grossInRange(prevStart, prevEnd));

  return {
    summary,
    payments: {
      totalCollected: round2(pay.totalCollected),
      cash: round2(pay.cash),
      card: round2(pay.card),
      other: round2(pay.other),
      fees: round2(pay.fees),
      netTotal: round2(pay.netTotal),
    },
    topItems: rank(itemMap),
    topCategories: rank(catRollup),
    series,
    details: {
      sales: salesDetail.sort((a, b) => (a.date < b.date ? 1 : -1)),
      returns: returnsDetail.sort((a, b) => (a.date < b.date ? 1 : -1)),
      discounts: discountsDetail.sort((a, b) => (a.date < b.date ? 1 : -1)),
    },
    previousGross,
    rangeLabel: RANGE_LABEL[range],
  };
};

// The reference day to pass to buildSalesReport to get the PREVIOUS
// comparable period (one window-length earlier), for the green/red deltas.
export const previousPeriodReference = (range: ReportRange, reference: string): string => {
  const { start } = rangeWindow(range, reference);
  return addDays(start, -1);
};

// Percentage change vs the previous comparable period, for the green/red
// deltas under each summary figure. Returns null when there's no prior
// basis to compare against (avoids a meaningless "+∞%").
export const pctChange = (current: number, previous: number): number | null => {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
};
