import { describe, it, expect } from "vitest";
import { buildDayReport, localDayKey } from "./day-report";
import type { Transaction } from "./transactions";

const txn = (over: Partial<Transaction>): Transaction => ({
  id: "t1",
  source: "manual",
  type: "full",
  method: "cash",
  amount: 100,
  tip: 0,
  fee: 0,
  net: 100,
  clientName: "Client",
  serviceName: "Service",
  paidAt: "2026-06-14T15:00:00.000Z",
  appointmentId: null,
  clientId: null,
  addOns: [],
  depositAmount: 0,
  balancePaid: 0,
  refunds: [],
  stripeId: null,
  note: "",
  ...over,
});

describe("localDayKey", () => {
  it("returns a YYYY-MM-DD key for a valid ISO", () => {
    expect(localDayKey("2026-06-14T15:00:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("returns empty for garbage", () => {
    expect(localDayKey("not-a-date")).toBe("");
  });
});

describe("buildDayReport", () => {
  const day = localDayKey("2026-06-14T15:00:00.000Z");

  it("only includes the requested day", () => {
    const r = buildDayReport([
      txn({ id: "a", amount: 50 }),
      txn({ id: "b", amount: 75, paidAt: "2026-06-10T15:00:00.000Z" }),
    ], day);
    expect(r.count).toBe(1);
    expect(r.grossCollected).toBe(50);
  });

  it("sums collections, tips, and nets refunds", () => {
    const r = buildDayReport([
      txn({ id: "a", amount: 100, tip: 20, method: "cash" }),
      txn({ id: "b", amount: 60, tip: 0, method: "stripe" }),
      txn({ id: "c", amount: -30, type: "refund", method: "cash" }),
    ], day);
    expect(r.grossCollected).toBe(160); // 100 + 60
    expect(r.tips).toBe(20);
    expect(r.refunds).toBe(30);
    expect(r.net).toBe(150); // 160 + 20 − 30
    expect(r.count).toBe(2); // refund not counted as a collection
  });

  it("breaks down by tender, biggest first, refunds reducing the net", () => {
    const r = buildDayReport([
      txn({ id: "a", amount: 100, tip: 10, method: "cash" }),
      txn({ id: "b", amount: 200, method: "stripe" }),
      txn({ id: "c", amount: -50, type: "refund", method: "cash" }),
    ], day);
    expect(r.byTender[0]).toMatchObject({ method: "stripe", amount: 200, count: 1 });
    const cash = r.byTender.find((t) => t.method === "cash")!;
    expect(cash.amount).toBe(60); // 100 + 10 tip − 50 refund
    expect(cash.count).toBe(1);
  });

  it("tracks deposits within the collections", () => {
    const r = buildDayReport([
      txn({ id: "a", amount: 40, type: "deposit" }),
      txn({ id: "b", amount: 100, type: "full" }),
    ], day);
    expect(r.deposits).toBe(40);
  });

  it("sorts the detail list newest first", () => {
    const r = buildDayReport([
      txn({ id: "early", paidAt: "2026-06-14T09:00:00.000Z" }),
      txn({ id: "late", paidAt: "2026-06-14T18:00:00.000Z" }),
    ], day);
    expect(r.txns[0].id).toBe("late");
  });

  it("is empty for a day with no transactions", () => {
    const r = buildDayReport([txn({})], "2020-01-01");
    expect(r.count).toBe(0);
    expect(r.net).toBe(0);
    expect(r.byTender).toEqual([]);
  });
});
