import { describe, it, expect } from "vitest";
import {
  isCheckoutSale,
  txnIncomeAmount,
  txnStream,
  sumShopTransactions,
  sumShopOrders,
  shopSalesInRange,
  computeShopSales,
  type StoredTxn,
  type ShopOrder,
} from "./shop-sales";

const checkout = (over: Partial<StoredTxn> = {}): StoredTxn => ({
  id: "bcx_1",
  date: "2026-06-14",
  amount: 250,
  data: { source: "boss_checkout" },
  ...over,
});
const manualIncome = (over: Partial<StoredTxn> = {}): StoredTxn => ({
  id: "m1",
  type: "income",
  date: "2026-06-14",
  amount: 40,
  category: "Service",
  ...over,
});

describe("transaction classification", () => {
  it("recognises a Boss Checkout sale even without a type field", () => {
    expect(isCheckoutSale(checkout())).toBe(true);
    expect(txnIncomeAmount(checkout())).toBe(250);
    expect(txnStream(checkout())).toBe("shop");
  });

  it("treats a manual 'Product sale' row as shop", () => {
    expect(txnStream(manualIncome({ category: "Product sale" }))).toBe("shop");
  });

  it("treats other manual income as service", () => {
    expect(txnStream(manualIncome({ category: "Tip" }))).toBe("service");
    expect(txnIncomeAmount(manualIncome())).toBe(40);
  });

  it("counts no income for expenses or refunds", () => {
    expect(txnIncomeAmount({ type: "expense", amount: 99 })).toBe(0);
    expect(txnIncomeAmount(checkout({ amount: -250 }))).toBe(0);
  });
});

describe("sumShopTransactions", () => {
  const txns: StoredTxn[] = [
    checkout({ amount: 250, date: "2026-06-14" }),
    checkout({ amount: 100, date: "2026-06-10" }), // out of range
    manualIncome({ category: "Product sale", amount: 30, date: "2026-06-14" }),
    manualIncome({ category: "Service", amount: 40, date: "2026-06-14" }), // service, excluded
  ];
  it("sums only shop-stream rows within the range", () => {
    expect(sumShopTransactions(txns, "2026-06-14", "2026-06-14")).toBe(280);
  });
});

describe("sumShopOrders", () => {
  const orders: ShopOrder[] = [
    { status: "paid", amount_total: 60, paid_at: "2026-06-14T15:00:00Z" },
    { status: "paid", amount_total: 25, paid_at: "2026-06-01T15:00:00Z" }, // out of range
    { status: "pending", amount_total: 999, paid_at: "2026-06-14T15:00:00Z" }, // not paid
  ];
  it("sums only paid orders within the range", () => {
    expect(sumShopOrders(orders, "2026-06-14", "2026-06-14")).toBe(60);
  });
});

describe("shopSalesInRange + computeShopSales", () => {
  const txns: StoredTxn[] = [
    checkout({ amount: 250, date: "2026-06-14" }),
    checkout({ amount: 100, date: "2026-06-02" }),
  ];
  const orders: ShopOrder[] = [
    { status: "paid", amount_total: 60, paid_at: "2026-06-14T12:00:00" },
  ];

  it("combines in-person sales and online orders", () => {
    expect(shopSalesInRange(txns, orders, "2026-06-14", "2026-06-14")).toBe(310);
  });

  it("buckets today / week / month / year against a reference date", () => {
    // 2026-06-14 is a Sunday → week-to-date is just that day.
    const s = computeShopSales(txns, orders, "2026-06-14");
    expect(s.today).toBe(310);
    expect(s.week).toBe(310);
    expect(s.month).toBe(410); // + the 2026-06-02 checkout sale
    expect(s.year).toBe(410);
  });
});
