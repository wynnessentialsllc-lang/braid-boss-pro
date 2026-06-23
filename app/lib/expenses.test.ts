import { describe, it, expect } from "vitest";
import {
  computeExpenseTotals,
  groupExpensesForList,
  estimateProfit,
  monthlyEquivalent,
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
