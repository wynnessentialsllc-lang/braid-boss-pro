// Shop vs Service revenue split.
//
// The app keeps two streams of money apart so the stylist can see what the
// chair earns vs what the shop earns:
//
//   * service — money from booked appointments (the style in the chair).
//     Derived from the appointments the stylist already tracks.
//   * shop    — retail money: in-person Boss Checkout sales (the POS) and
//               paid online storefront orders (product_orders).
//
// Why this split: a finished Boss Checkout sale and an online order are
// both "ringing up product / a walk-in", whereas an appointment (including
// one whose balance is collected from the Checkout "Appt" tab, which
// settles the booking rather than writing a sale row) is service revenue.
//
// Pure module: no React, no Supabase, no DOM. Money is in the currency's
// major unit (dollars). Unit-tested in shop-sales.test.ts.

export type RevenueStream = "shop" | "service";

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Local calendar day (YYYY-MM-DD) for either a date-only string or an ISO
// timestamp, so "today" lines up with the stylist's wall clock.
export const localDayKey = (value: string | null | undefined): string => {
  const s = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already a date-only key
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// ---- Stored transaction classification --------------------------------

// A stored payment_transactions record in the app's camelCase entity
// shape (what store.transactions holds). Loosely typed — manual sheet
// rows carry `type`/`category`; Boss Checkout rows carry `data.source`.
export type StoredTxn = {
  id?: string;
  type?: string | null;        // "income" | "expense" — manual sheet rows only
  date?: string | null;        // YYYY-MM-DD
  amount?: number | string | null;
  category?: string | null;    // manual sheet category
  data?: { source?: string | null } | null;
};

// A Boss Checkout in-person sale. These records DON'T carry a `type`
// field (they come from buildSaleTransaction), so income aggregators that
// only look for `type === "income"` miss them — recognise them explicitly.
export const isCheckoutSale = (t: StoredTxn | null | undefined): boolean =>
  t?.data?.source === "boss_checkout";

export const isExpenseTxn = (t: StoredTxn | null | undefined): boolean =>
  t?.type === "expense";

// New money this stored transaction brought in (0 for expenses/refunds).
// Counts both manual income rows AND Boss Checkout sales.
export const txnIncomeAmount = (t: StoredTxn | null | undefined): number => {
  if (!t || isExpenseTxn(t)) return 0;
  const amt = num(t.amount);
  if (amt < 0) return 0; // signed-negative refund row
  if (isCheckoutSale(t) || t.type === "income") return amt;
  return 0;
};

// Which stream an income transaction belongs to. Boss Checkout sales and
// hand-entered "Product sale" rows are shop; everything else is service.
export const txnStream = (t: StoredTxn | null | undefined): RevenueStream => {
  if (isCheckoutSale(t)) return "shop";
  if (String(t?.category || "").toLowerCase() === "product sale") return "shop";
  return "service";
};

// ---- Paid online storefront orders ------------------------------------

export type ShopOrder = {
  status?: string | null;
  amount_total?: number | string | null;
  paid_at?: string | null;
};

const orderIsPaid = (o: ShopOrder | null | undefined): boolean =>
  String(o?.status || "").toLowerCase() === "paid";

// ---- Range helpers (inclusive YYYY-MM-DD bounds) ----------------------

const inRange = (dayKey: string, startYMD: string, endYMD: string): boolean =>
  !!dayKey && dayKey >= startYMD && dayKey <= endYMD;

// Sum the shop-stream income from stored transactions within [start, end].
export const sumShopTransactions = (
  txns: StoredTxn[] | null | undefined,
  startYMD: string,
  endYMD: string,
): number => {
  let total = 0;
  for (const t of txns || []) {
    if (txnStream(t) !== "shop") continue;
    const amt = txnIncomeAmount(t);
    if (amt <= 0) continue;
    if (inRange(localDayKey(t.date), startYMD, endYMD)) total += amt;
  }
  return round2(total);
};

// Sum paid online storefront orders within [start, end] (by paid date).
export const sumShopOrders = (
  orders: ShopOrder[] | null | undefined,
  startYMD: string,
  endYMD: string,
): number => {
  let total = 0;
  for (const o of orders || []) {
    if (!orderIsPaid(o)) continue;
    if (inRange(localDayKey(o.paid_at), startYMD, endYMD)) total += num(o.amount_total);
  }
  return round2(total);
};

// Combined shop sales (in-person Checkout + online orders) in a range.
export const shopSalesInRange = (
  txns: StoredTxn[] | null | undefined,
  orders: ShopOrder[] | null | undefined,
  startYMD: string,
  endYMD: string,
): number =>
  round2(sumShopTransactions(txns, startYMD, endYMD) + sumShopOrders(orders, startYMD, endYMD));

// ---- Dashboard aggregate ----------------------------------------------

const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayYMD = (): string => ymd(new Date());
const startOfWeek = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - d.getDay()); // Sunday-based, matching reports.ts
  return ymd(d);
};

export type ShopSalesSummary = {
  today: number;
  week: number;
  month: number;
  year: number;
};

// Shop sales for the dashboard, bucketed to mirror the service revenue
// cards (today / week-to-date / month-to-date / year-to-date).
export const computeShopSales = (
  txns: StoredTxn[] | null | undefined,
  orders: ShopOrder[] | null | undefined,
  reference: string = todayYMD(),
): ShopSalesSummary => {
  const today = reference;
  const weekStart = startOfWeek(today);
  const d = new Date(today + "T00:00:00");
  const monthStart = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const yearStart = ymd(new Date(d.getFullYear(), 0, 1));
  return {
    today: shopSalesInRange(txns, orders, today, today),
    week: shopSalesInRange(txns, orders, weekStart, today),
    month: shopSalesInRange(txns, orders, monthStart, today),
    year: shopSalesInRange(txns, orders, yearStart, today),
  };
};
