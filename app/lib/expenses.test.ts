import { describe, it, expect } from "vitest";
import {
  computeExpenseTotals,
  groupExpensesForList,
  estimateProfit,
  expensesForPeriod,
  monthlyEquivalent,
  nextOccurrenceISO,
  recurringDueDateISO,
  occurrenceInMonthISO,
  type ExpenseLike,
} from "./expenses";

// All cases reference a fixed "today" so the month/week boundaries are
// deterministic regardless of when the suite runs.
const REF = "2026-06-23";

describe("monthlyEquivalent", () => {
  it("is zero for non-recurring expenses", () => {
    expect(monthlyEquivalent({ amount: 50, isRecurring: false })).toBe(0);
  });

  it("normalises weekly and yearly subs to a monthly number", () => {
    expect(monthlyEquivalent({ amount: 10, isRecurring: true, recurringInterval: "weekly" })).toBe(43.33);
    expect(monthlyEquivalent({ amount: 120, isRecurring: true, recurringInterval: "yearly" })).toBe(10);
    expect(monthlyEquivalent({ amount: 20, isRecurring: true, recurringInterval: "monthly" })).toBe(20);
  });
});

describe("computeExpenseTotals — recurring counts against the month automatically", () => {
  it("folds recurring monthly burn into the month total even with no expenseDate", () => {
    const expenses: ExpenseLike[] = [
      { id: "a", amount: 20, isRecurring: true, recurringInterval: "monthly", nextBillingDate: "2026-07-06" },
      { id: "b", amount: 35, isRecurring: true, recurringInterval: "monthly", nextBillingDate: "2026-07-20" },
    ];
    const t = computeExpenseTotals(expenses, REF);
    expect(t.monthlySubscriptions).toBe(55);
    // The whole point: recurring burn shows up as monthly expense, not $0.
    expect(t.monthTotal).toBe(55);
  });

  it("does not double-count a recurring expense that also carries a this-month date", () => {
    const expenses: ExpenseLike[] = [
      { id: "a", amount: 20, isRecurring: true, recurringInterval: "monthly", expenseDate: REF },
    ];
    const t = computeExpenseTotals(expenses, REF);
    expect(t.monthTotal).toBe(20);
    expect(t.monthlySubscriptions).toBe(20);
    // Recurring isn't treated as a discrete cash-out on its entry day.
    expect(t.todayTotal).toBe(0);
    expect(t.weekTotal).toBe(0);
  });

  it("adds one-off expenses dated this month on top of recurring burn", () => {
    const expenses: ExpenseLike[] = [
      { id: "sub", amount: 100, isRecurring: true, recurringInterval: "monthly" },
      { id: "hair", amount: 40, category: "Braiding hair", expenseDate: REF },
    ];
    const t = computeExpenseTotals(expenses, REF);
    expect(t.monthTotal).toBe(140);
    expect(t.monthlySubscriptions).toBe(100);
    expect(t.todayTotal).toBe(40);
  });

  it("includes recurring burn in the category breakdown", () => {
    const expenses: ExpenseLike[] = [
      { id: "sub", amount: 50, category: "Apps & subscriptions", isRecurring: true, recurringInterval: "monthly" },
    ];
    const t = computeExpenseTotals(expenses, REF);
    expect(t.topCategory).toEqual({ category: "Apps & subscriptions", amount: 50 });
  });
});

describe("estimateProfit reflects recurring expenses", () => {
  it("subtracts the recurring monthly burn from revenue", () => {
    const expenses: ExpenseLike[] = [
      { id: "sub", amount: 345.38, isRecurring: true, recurringInterval: "monthly" },
    ];
    const t = computeExpenseTotals(expenses, REF);
    expect(estimateProfit(1000, t.monthTotal)).toBe(654.62);
  });
});

describe("expensesForPeriod — Money card Expenses/Net row", () => {
  const recurring: ExpenseLike[] = [
    { id: "sub", amount: 345.38, isRecurring: true, recurringInterval: "monthly" },
  ];

  it("shows a full month of recurring burn for the 30d window", () => {
    // Lines up with the 'Expenses (mo)' tile so the card's Net matches.
    expect(expensesForPeriod(recurring, "month", "2026-05-24", "2026-06-23")).toBe(345.38);
  });

  it("scales recurring burn down for a 7d window and up for 90d", () => {
    expect(expensesForPeriod(recurring, "week", "2026-06-17", "2026-06-23")).toBe(80.59);
    expect(expensesForPeriod(recurring, "quarter", "2026-03-25", "2026-06-23")).toBe(1036.14);
  });

  it("shows a single month's burn for 'all' rather than an unbounded projection", () => {
    expect(expensesForPeriod(recurring, "all", "2000-01-01", "2026-06-23")).toBe(345.38);
  });

  it("adds one-off expenses only when their date falls inside the window", () => {
    const mixed: ExpenseLike[] = [
      { id: "sub", amount: 100, isRecurring: true, recurringInterval: "monthly" },
      { id: "in", amount: 40, expenseDate: "2026-06-10" },
      { id: "out", amount: 25, expenseDate: "2026-04-01" },
    ];
    // month window: $100 recurring + $40 in-window one-off, $25 excluded.
    expect(expensesForPeriod(mixed, "month", "2026-05-24", "2026-06-23")).toBe(140);
  });
});

describe("groupExpensesForList", () => {
  it("buckets recurring expenses under 'this month' so they aren't hidden in 'older'", () => {
    const expenses: ExpenseLike[] = [
      { id: "sub", amount: 20, isRecurring: true, recurringInterval: "monthly" },
    ];
    const groups = groupExpensesForList(expenses, REF);
    const month = groups.find(g => g.key === "month");
    expect(month?.items).toHaveLength(1);
    expect(month?.total).toBe(20);
    expect(groups.find(g => g.key === "older")).toBeUndefined();
  });
});

describe("nextOccurrenceISO", () => {
  it("rolls a stale monthly anchor forward to the coming month", () => {
    // The reported case: anchored in May, viewed at the end of August.
    expect(nextOccurrenceISO("2026-05-06", "monthly", "2026-08-31")).toBe("2026-09-06");
  });

  it("stays in the reference month when the day hasn't passed yet", () => {
    expect(nextOccurrenceISO("2026-05-15", "monthly", "2026-08-03")).toBe("2026-08-15");
    expect(nextOccurrenceISO("2026-05-15", "monthly", "2026-08-15")).toBe("2026-08-15");
  });

  it("leaves a genuinely future anchor alone", () => {
    expect(nextOccurrenceISO("2026-12-01", "monthly", "2026-08-31")).toBe("2026-12-01");
  });

  it("clamps a 31st anchor into shorter months instead of overflowing", () => {
    expect(nextOccurrenceISO("2026-01-31", "monthly", "2026-02-01")).toBe("2026-02-28");
    expect(nextOccurrenceISO("2026-01-31", "monthly", "2026-04-01")).toBe("2026-04-30");
  });

  it("rolls across a year boundary", () => {
    expect(nextOccurrenceISO("2026-03-10", "monthly", "2026-12-20")).toBe("2027-01-10");
  });

  it("keeps the weekday for weekly intervals", () => {
    // 2026-05-06 is a Wednesday; every result should also be Wednesday.
    const got = nextOccurrenceISO("2026-05-06", "weekly", "2026-08-31");
    expect(got).toBe("2026-09-02");
    expect(new Date(got + "T00:00:00").getDay()).toBe(3);
  });

  it("moves yearly items to the next anniversary", () => {
    expect(nextOccurrenceISO("2025-05-06", "yearly", "2026-08-31")).toBe("2027-05-06");
    expect(nextOccurrenceISO("2025-11-06", "yearly", "2026-08-31")).toBe("2026-11-06");
  });

  it("passes through junk rather than inventing a date", () => {
    expect(nextOccurrenceISO(null, "monthly", "2026-08-31")).toBeNull();
    expect(nextOccurrenceISO("not-a-date", "monthly", "2026-08-31")).toBe("not-a-date");
  });
});

describe("recurringDueDateISO", () => {
  it("prefers the typed billing date as the anchor", () => {
    expect(recurringDueDateISO(
      { isRecurring: true, recurringInterval: "monthly", expenseDate: "2026-01-02", nextBillingDate: "2026-05-06" },
      "2026-08-31",
    )).toBe("2026-09-06");
  });

  it("falls back to the expense date when no billing date was set", () => {
    expect(recurringDueDateISO(
      { isRecurring: true, recurringInterval: "monthly", expenseDate: "2026-05-06" },
      "2026-08-31",
    )).toBe("2026-09-06");
  });

  it("returns null for one-off expenses", () => {
    expect(recurringDueDateISO({ isRecurring: false, expenseDate: "2026-05-06" }, "2026-08-31")).toBeNull();
  });
});

describe("occurrenceInMonthISO", () => {
  it("maps a monthly recurring row onto the month being viewed", () => {
    expect(occurrenceInMonthISO(
      { isRecurring: true, recurringInterval: "monthly", expenseDate: "2026-05-06" },
      "2026-08-31",
    )).toBe("2026-08-06");
  });

  it("clamps into short months", () => {
    expect(occurrenceInMonthISO(
      { isRecurring: true, recurringInterval: "monthly", expenseDate: "2026-01-31" },
      "2026-02-10",
    )).toBe("2026-02-28");
  });

  it("gives no date for weekly rows, which hit many times a month", () => {
    expect(occurrenceInMonthISO(
      { isRecurring: true, recurringInterval: "weekly", expenseDate: "2026-05-06" },
      "2026-08-31",
    )).toBeNull();
  });

  it("shows a yearly row only in its anniversary month", () => {
    expect(occurrenceInMonthISO(
      { isRecurring: true, recurringInterval: "yearly", expenseDate: "2025-08-06" },
      "2026-08-31",
    )).toBe("2026-08-06");
    expect(occurrenceInMonthISO(
      { isRecurring: true, recurringInterval: "yearly", expenseDate: "2025-05-06" },
      "2026-08-31",
    )).toBeNull();
  });

  it("leaves one-off expenses on their real date", () => {
    expect(occurrenceInMonthISO({ isRecurring: false, expenseDate: "2026-08-12" }, "2026-08-31"))
      .toBe("2026-08-12");
  });
});
