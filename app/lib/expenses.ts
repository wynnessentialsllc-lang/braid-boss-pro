// Business Expenses V1 — pure aggregation helpers for the Money →
// Expenses screen and the dashboard KPIs. Mirrors the shape of
// reports.ts so the two surfaces compute the same numbers.
//
// All money in/out of this module is post-validation: amounts are
// coerced to finite, non-negative numbers. Recurring subscription
// monthly value normalises weekly/yearly intervals to a monthly
// number so the dashboard card can compare like with like.

export type ExpenseLike = {
  id?: string;
  title?: string | null;
  amount?: number | string | null;
  category?: string | null;
  note?: string | null;
  expenseDate?: string | null;     // YYYY-MM-DD
  isRecurring?: boolean | null;
  recurringInterval?: string | null; // "monthly" | "weekly" | "yearly"
  nextBillingDate?: string | null;
  receiptPath?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const EXPENSE_CATEGORIES = [
  "Hair / bundles",
  "Braiding hair",
  "Products",
  "Tools",
  "Supplies",
  "Booth rent",
  "Salon suite",
  "Travel",
  "Gas",
  "Apps & subscriptions",
  "Marketing",
  "Education/classes",
  "Packaging",
  "Shipping",
  "Taxes",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const RECURRING_INTERVALS = ["monthly", "weekly", "yearly"] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : Number.isFinite(n) ? Math.max(0, n) : 0;
};

const round2 = (n: number) => Number(n.toFixed(2));

const localDateISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const todayISO = (): string => localDateISO(new Date());

export const startOfWeekISO = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return localDateISO(d);
};

export const monthBoundary = (iso: string): { start: string; end: string } => {
  const d = new Date(iso + "T00:00:00");
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    start: localDateISO(new Date(y, m, 1)),
    end: localDateISO(new Date(y, m + 1, 1)),
  };
};

// Money helper that's tolerant of strings, nulls, and the occasional
// "$" the input field may leave behind.
export const expenseAmount = (e: ExpenseLike): number => num(e?.amount);

// Normalise a recurring subscription's amount to its monthly value.
// Used by the dashboard "Monthly Subscriptions" card so weekly /
// yearly subs don't lie about the monthly burn.
export const monthlyEquivalent = (e: ExpenseLike): number => {
  if (!e?.isRecurring) return 0;
  const a = expenseAmount(e);
  switch (e.recurringInterval) {
    case "weekly":  return round2(a * 52 / 12);
    case "yearly":  return round2(a / 12);
    case "monthly":
    default:        return round2(a);
  }
};

// ---- Aggregates ------------------------------------------------------

export type ExpenseTotals = {
  todayTotal: number;
  weekTotal: number;
  monthTotal: number;
  monthlySubscriptions: number;
  topCategory: { category: string; amount: number } | null;
  byCategory: { category: string; amount: number; count: number }[];
};

export const computeExpenseTotals = (
  expenses: ExpenseLike[] | null | undefined,
  reference: string = todayISO(),
): ExpenseTotals => {
  const list = expenses || [];
  const weekStart = startOfWeekISO(reference);
  const month = monthBoundary(reference);

  let todayTotal = 0;
  let weekTotal = 0;
  let monthTotal = 0;
  let monthlySubscriptions = 0;
  const cat = new Map<string, { amount: number; count: number }>();

  const addCategory = (e: ExpenseLike, amount: number) => {
    const k = (e.category || "Other").trim() || "Other";
    const cur = cat.get(k) || { amount: 0, count: 0 };
    cur.amount += amount;
    cur.count += 1;
    cat.set(k, cur);
  };

  for (const e of list) {
    const a = expenseAmount(e);
    const d = e.expenseDate || "";

    // Recurring expenses are part of the monthly budget regardless of
    // when they were entered — a $20/mo subscription costs $20 every
    // month, not just the month it was added. Fold the monthly
    // equivalent into the month total + category breakdown so profit
    // tracks the true monthly burn automatically, and keep the
    // subscriptions line as its own number. We deliberately count the
    // monthly equivalent (not the row's `expenseDate` amount) so
    // weekly/yearly subs normalise and a recurring item is never
    // double-counted via its date.
    if (e.isRecurring) {
      const me = monthlyEquivalent(e);
      monthlySubscriptions += me;
      monthTotal += me;
      addCategory(e, me);
      continue;
    }

    // One-off expenses count against the day/week/month they happened.
    if (d === reference) todayTotal += a;
    if (d && d >= weekStart && d <= reference) weekTotal += a;
    if (d && d >= month.start && d < month.end) {
      monthTotal += a;
      addCategory(e, a);
    }
  }

  const byCategory = Array.from(cat.entries())
    .map(([category, v]) => ({ category, amount: round2(v.amount), count: v.count }))
    .sort((a, b) => b.amount - a.amount);
  const topCategory = byCategory[0]
    ? { category: byCategory[0].category, amount: byCategory[0].amount }
    : null;

  return {
    todayTotal: round2(todayTotal),
    weekTotal: round2(weekTotal),
    monthTotal: round2(monthTotal),
    monthlySubscriptions: round2(monthlySubscriptions),
    topCategory,
    byCategory,
  };
};

// Estimated profit = revenue − expenses for the same window. Costs
// aren't tracked per-appointment yet, so this is the headline number
// the dashboard uses to give a profit signal.
export const estimateProfit = (revenue: number, expenses: number): number =>
  round2(revenue - expenses);

export const profitMargin = (revenue: number, expenses: number): number => {
  if (!revenue || revenue <= 0) return 0;
  return Math.round(((revenue - expenses) / revenue) * 100);
};

// ---- Grouped list view ----------------------------------------------

export type ExpenseGroup = {
  key: "today" | "week" | "month" | "older";
  label: string;
  items: ExpenseLike[];
  total: number;
};

export const groupExpensesForList = (
  expenses: ExpenseLike[] | null | undefined,
  reference: string = todayISO(),
): ExpenseGroup[] => {
  const list = (expenses || []).slice().sort((a, b) => {
    const da = (a.expenseDate || a.createdAt || "");
    const db = (b.expenseDate || b.createdAt || "");
    return db.localeCompare(da);
  });
  const weekStart = startOfWeekISO(reference);
  const month = monthBoundary(reference);

  const groups: Record<ExpenseGroup["key"], ExpenseGroup> = {
    today: { key: "today", label: "Today",      items: [], total: 0 },
    week:  { key: "week",  label: "This week",  items: [], total: 0 },
    month: { key: "month", label: "This month", items: [], total: 0 },
    older: { key: "older", label: "Older",      items: [], total: 0 },
  };

  for (const e of list) {
    const d = e.expenseDate || "";
    // Recurring costs belong to "this month" no matter when they were
    // first entered — they bill every month — and contribute their
    // monthly equivalent to the group total so it matches the headline
    // month total.
    const a = e.isRecurring ? monthlyEquivalent(e) : expenseAmount(e);
    let bucket: ExpenseGroup["key"] = "older";
    if (e.isRecurring) bucket = "month";
    else if (d === reference) bucket = "today";
    else if (d && d >= weekStart && d <= reference) bucket = "week";
    else if (d && d >= month.start && d < month.end) bucket = "month";
    groups[bucket].items.push(e);
    groups[bucket].total += a;
  }

  return (["today", "week", "month", "older"] as const)
    .map(k => ({ ...groups[k], total: round2(groups[k].total) }))
    .filter(g => g.items.length > 0);
};

// ---- Insights -------------------------------------------------------
// Plain-language summary lines the dashboard / Money screen can show.
// Keep these short and braider-friendly — no jargon, no negative
// framing unless it's actionable.

export type ExpenseInsight = { kind: "neutral" | "positive" | "warning"; text: string };

export const buildExpenseInsights = (
  expenses: ExpenseLike[] | null | undefined,
  monthRevenue: number,
  reference: string = todayISO(),
): ExpenseInsight[] => {
  const out: ExpenseInsight[] = [];
  const t = computeExpenseTotals(expenses, reference);

  if (t.monthlySubscriptions > 0) {
    out.push({
      kind: "neutral",
      text: `Subscriptions total $${t.monthlySubscriptions.toFixed(2)} this month.`,
    });
  }
  if (t.topCategory && t.topCategory.amount > 0) {
    out.push({
      kind: "neutral",
      text: `Your highest expense category is ${t.topCategory.category}.`,
    });
  }
  if (monthRevenue > 0) {
    const margin = profitMargin(monthRevenue, t.monthTotal);
    if (margin >= 50) {
      out.push({
        kind: "positive",
        text: `Estimated profit margin is ${margin}% this month — strong.`,
      });
    } else if (margin >= 25) {
      out.push({
        kind: "neutral",
        text: `Estimated profit margin is ${margin}% this month.`,
      });
    } else if (margin > 0) {
      out.push({
        kind: "warning",
        text: `Profit margin is only ${margin}% this month — review subscriptions and supplies.`,
      });
    } else {
      out.push({
        kind: "warning",
        text: "Expenses are running ahead of revenue this month.",
      });
    }
  }
  // Spending heat — flag if this week's spend is already > 60% of the
  // monthly total partway through the month.
  if (t.monthTotal > 0 && t.weekTotal / t.monthTotal > 0.6) {
    out.push({
      kind: "warning",
      text: "You spent more on supplies this week than the rest of the month combined.",
    });
  }
  return out;
};
