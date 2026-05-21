// Tax-time pack — annual P&L + Schedule C category map.
//
// A US sole-proprietor braider files Schedule C (Form 1040). This
// module turns the data the app already has — appointment income,
// storefront orders, business expenses tagged with Expenses-V1
// categories — into the numbers that go on that form, grouped by
// the Schedule C line each category belongs to.
//
// Accounting basis: cash. Income is recognized when money was
// collected (appointment.paymentDate / order.paid_at), expenses
// when they were dated (expense.expenseDate). That's what the vast
// majority of sole proprietors use and what the app actually
// tracks. The PDF carries a footer telling the stylist to confirm
// classifications with their accountant — this is a starting point,
// not tax advice.

import { EXPENSE_CATEGORIES, type ExpenseLike } from "./expenses";

// ---- Schedule C Part II expense lines (the subset a braider hits) ----
export type ScheduleCLine = {
  line: string;   // IRS line number, e.g. "22"
  label: string;  // IRS label
};

export const SCHEDULE_C_LINES: Record<string, ScheduleCLine> = {
  "8":   { line: "8",   label: "Advertising" },
  "9":   { line: "9",   label: "Car and truck expenses" },
  "17":  { line: "17",  label: "Legal and professional services" },
  "20b": { line: "20b", label: "Rent — other business property" },
  "22":  { line: "22",  label: "Supplies" },
  "23":  { line: "23",  label: "Taxes and licenses" },
  "24a": { line: "24a", label: "Travel" },
  "27a": { line: "27a", label: "Other expenses" },
};

// Default mapping: each Expenses-V1 category → a Schedule C line.
// Deliberately conservative — hair/products consumed on clients are
// treated as Supplies (line 22). A stylist who *resells* product
// inventory may need Cost of Goods Sold (Part III) instead; the PDF
// flags that for their accountant rather than guessing.
export const CATEGORY_TO_SCHEDULE_C: Record<string, string> = {
  "Hair / bundles":       "22",
  "Braiding hair":        "22",
  "Products":             "22",
  "Tools":                "22",
  "Supplies":             "22",
  "Packaging":            "22",
  "Booth rent":           "20b",
  "Salon suite":          "20b",
  "Travel":               "24a",
  "Gas":                  "9",
  "Marketing":            "8",
  "Apps & subscriptions": "27a",
  "Education/classes":    "27a",
  "Shipping":             "27a",
  "Taxes":                "23",
  "Other":                "27a",
};

// Anything not in the map (a legacy / free-text category) lands in
// Other expenses so no money silently disappears from the total.
export const scheduleCLineFor = (category: string | null | undefined): string => {
  const c = (category || "").trim();
  return CATEGORY_TO_SCHEDULE_C[c] || "27a";
};

// ---- Coercion --------------------------------------------------------
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Number(n.toFixed(2));
const yearOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(iso));
  return m ? Number(m[1]) : null;
};

// ---- Input shapes (loose — callers pass app records straight in) -----
export type TaxApptLike = {
  status?: string | null;
  kind?: string | null;
  totalPrice?: number | string | null;
  depositPaid?: number | string | null;
  balanceDue?: number | string | null;
  discountAmount?: number | string | null;
  paymentStatus?: string | null;
  paymentDate?: string | null;
  date?: string | null;
};

export type TaxOrderLike = {
  status?: string | null;
  amount_total?: number | string | null;
  paid_at?: string | null;
};

// ---- Income ----------------------------------------------------------
// Cash-basis: an appointment's collected money is attributed to the
// year of its paymentDate (falling back to the appointment date when
// no payment date was recorded). Cancelled / no-show / non-appointment
// rows never count.
const isCanceled = (s: unknown) => s === "cancelled" || s === "canceled";

const apptCollected = (a: TaxApptLike): number => {
  if (!a || isCanceled(a.status)) return 0;
  if (a.kind && a.kind !== "appointment") return 0;
  const deposit = num(a.depositPaid);
  if (deposit > 0) return round2(deposit);
  if (num(a.balanceDue) === 0 && num(a.totalPrice) > 0) return round2(num(a.totalPrice));
  return 0;
};

export type ScheduleCRow = {
  line: string;
  label: string;
  categories: { category: string; amount: number }[];
  total: number;
};

export type AnnualTaxSummary = {
  year: number;
  income: {
    appointments: number;
    storefront: number;
    total: number;
  };
  expenses: {
    byScheduleCLine: ScheduleCRow[];
    total: number;
  };
  netProfit: number;
  // Diagnostics surfaced in the UI / PDF footer.
  counts: {
    appointmentsCounted: number;
    ordersCounted: number;
    expensesCounted: number;
  };
};

export const computeAnnualTaxSummary = (
  year: number,
  appointments: TaxApptLike[] | null | undefined,
  expenses: ExpenseLike[] | null | undefined,
  orders: TaxOrderLike[] | null | undefined,
): AnnualTaxSummary => {
  // --- Income: appointments ---
  let apptIncome = 0;
  let apptCount = 0;
  for (const a of (appointments || [])) {
    const collected = apptCollected(a);
    if (collected <= 0) continue;
    const y = yearOf(a.paymentDate) ?? yearOf(a.date);
    if (y !== year) continue;
    apptIncome += collected;
    apptCount += 1;
  }

  // --- Income: storefront orders ---
  let orderIncome = 0;
  let orderCount = 0;
  for (const o of (orders || [])) {
    if (o?.status !== "paid") continue;
    const y = yearOf(o.paid_at);
    if (y !== year) continue;
    orderIncome += num(o.amount_total);
    orderCount += 1;
  }

  // --- Expenses grouped by Schedule C line ---
  const lineTotals = new Map<string, Map<string, number>>(); // line → category → amount
  let expenseTotal = 0;
  let expenseCount = 0;
  for (const e of (expenses || [])) {
    const y = yearOf(e?.expenseDate);
    if (y !== year) continue;
    const amount = num(e?.amount);
    if (amount <= 0) continue;
    const category = (e?.category || "Other").trim() || "Other";
    const line = scheduleCLineFor(category);
    if (!lineTotals.has(line)) lineTotals.set(line, new Map());
    const catMap = lineTotals.get(line)!;
    catMap.set(category, (catMap.get(category) || 0) + amount);
    expenseTotal += amount;
    expenseCount += 1;
  }

  // Order the Schedule C rows by IRS line number ascending so the
  // PDF reads like the actual form.
  const byScheduleCLine: ScheduleCRow[] = Array.from(lineTotals.entries())
    .map(([line, catMap]) => {
      const categories = Array.from(catMap.entries())
        .map(([category, amount]) => ({ category, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount);
      return {
        line,
        label: SCHEDULE_C_LINES[line]?.label || "Other expenses",
        categories,
        total: round2(categories.reduce((s, c) => s + c.amount, 0)),
      };
    })
    .sort((a, b) => {
      // "20b" / "24a" / "27a" sort by their numeric prefix.
      const na = parseInt(a.line, 10);
      const nb = parseInt(b.line, 10);
      return na - nb || a.line.localeCompare(b.line);
    });

  const incomeTotal = round2(apptIncome + orderIncome);
  const expensesRounded = round2(expenseTotal);

  return {
    year,
    income: {
      appointments: round2(apptIncome),
      storefront: round2(orderIncome),
      total: incomeTotal,
    },
    expenses: {
      byScheduleCLine,
      total: expensesRounded,
    },
    netProfit: round2(incomeTotal - expensesRounded),
    counts: {
      appointmentsCounted: apptCount,
      ordersCounted: orderCount,
      expensesCounted: expenseCount,
    },
  };
};

// Tax years offered in the picker: the current year + the two prior.
// January is when the stylist actually files, so last year is the
// common pick — it's the default in the screen.
export const taxYearOptions = (today: Date = new Date()): number[] => {
  const y = today.getFullYear();
  return [y, y - 1, y - 2];
};
