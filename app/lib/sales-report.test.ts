import { describe, it, expect } from "vitest";
import {
  buildSalesReport,
  rangeWindow,
  pctChange,
  type ReportAppointment,
} from "./sales-report";
import { type Transaction } from "./transactions";

const appt = (over: Partial<ReportAppointment>): ReportAppointment => ({
  status: "completed",
  kind: "appointment",
  totalPrice: 0,
  discountAmount: 0,
  ...over,
});

const txn = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2),
  source: "manual",
  type: "full",
  method: "cash",
  amount: 0,
  tip: 0,
  fee: 0,
  net: 0,
  clientName: "C",
  serviceName: "S",
  paidAt: "2026-06-07T12:00:00.000Z",
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

const REF = "2026-06-07";

describe("rangeWindow", () => {
  it("computes inclusive windows ending at the reference day", () => {
    expect(rangeWindow("1D", REF)).toEqual({ start: "2026-06-07", end: "2026-06-07" });
    expect(rangeWindow("1W", REF)).toEqual({ start: "2026-06-01", end: "2026-06-07" });
    expect(rangeWindow("1Y", REF).start).toBe("2025-06-08");
  });
});

describe("buildSalesReport — summary", () => {
  it("nets discounts and returns out of gross sales", () => {
    const appts = [
      appt({ date: "2026-06-05", totalPrice: 200, discountAmount: 25, style: "Knotless", serviceId: "svc1" }),
      appt({ date: "2026-06-06", totalPrice: 100, discountAmount: 0, style: "Twists", serviceId: "svc2" }),
    ];
    const txns = [
      txn({ paidAt: "2026-06-06T10:00:00Z", method: "cash", amount: 100, type: "full" }),
      txn({ paidAt: "2026-06-06T11:00:00Z", method: "stripe", amount: 175, fee: 5, type: "final" }),
      txn({ paidAt: "2026-06-06T12:00:00Z", method: "stripe", amount: 25, type: "refund" }),
    ];
    const r = buildSalesReport(appts, txns, { svc1: "Knotless Braids", svc2: "Twists" }, "1W", REF);

    expect(r.summary.grossSales).toBe(300);     // 200 + 100
    expect(r.summary.discounts).toBe(25);
    expect(r.summary.returns).toBe(25);
    expect(r.summary.netSales).toBe(250);       // 300 − 25 − 25
    expect(r.summary.salesCount).toBe(2);
    expect(r.summary.averageSale).toBe(125);    // 250 / 2
  });

  it("excludes cancelled / non-appointment rows", () => {
    const appts = [
      appt({ date: "2026-06-06", totalPrice: 100, status: "cancelled" }),
      appt({ date: "2026-06-06", totalPrice: 50, kind: "blocked" }),
      appt({ date: "2026-06-06", totalPrice: 80 }),
    ];
    const r = buildSalesReport(appts, [], {}, "1W", REF);
    expect(r.summary.grossSales).toBe(80);
    expect(r.summary.salesCount).toBe(1);
  });
});

describe("buildSalesReport — payment types", () => {
  it("splits collected money by method and nets fees", () => {
    const txns = [
      txn({ paidAt: "2026-06-06T10:00:00Z", method: "cash", amount: 100, tip: 10 }),
      txn({ paidAt: "2026-06-06T11:00:00Z", method: "card", amount: 200, fee: 6 }),
      txn({ paidAt: "2026-06-06T12:00:00Z", method: "venmo", amount: 50 }),
    ];
    const r = buildSalesReport([], txns, {}, "1W", REF);
    expect(r.payments.cash).toBe(110);          // 100 + 10 tip
    expect(r.payments.card).toBe(200);
    expect(r.payments.other).toBe(50);
    expect(r.payments.totalCollected).toBe(360);
    expect(r.payments.fees).toBe(6);
    expect(r.payments.netTotal).toBe(354);
  });
});

describe("buildSalesReport — top items & categories", () => {
  it("ranks by gross and maps services to categories", () => {
    const appts = [
      appt({ date: "2026-06-06", totalPrice: 300, style: "Boho Knotless", serviceId: "s1" }),
      appt({ date: "2026-06-06", totalPrice: 100, style: "Twists", serviceId: "s2" }),
      appt({ date: "2026-06-05", totalPrice: 200, style: "Boho Knotless", serviceId: "s1" }),
    ];
    const r = buildSalesReport(appts, [], { s1: "Goddess/Boho", s2: "Twists" }, "1W", REF);
    expect(r.topItems[0]).toEqual({ label: "Boho Knotless", gross: 500, count: 2 });
    expect(r.topCategories[0]).toEqual({ label: "Goddess/Boho", gross: 500, count: 2 });
  });

  it("falls back to Uncategorized when no service mapping exists", () => {
    const appts = [appt({ date: "2026-06-06", totalPrice: 100, style: "X" })];
    const r = buildSalesReport(appts, [], {}, "1W", REF);
    expect(r.topCategories[0].label).toBe("Uncategorized");
  });
});

describe("buildSalesReport — series", () => {
  it("produces 7 daily buckets for 1W with aligned previous week", () => {
    const appts = [
      appt({ date: "2026-06-07", totalPrice: 100 }), // current Sun
      appt({ date: "2026-05-31", totalPrice: 40 }),  // previous Sun (7 days back)
    ];
    const r = buildSalesReport(appts, [], {}, "1W", REF);
    expect(r.series).toHaveLength(7);
    const last = r.series[r.series.length - 1];
    expect(last.current).toBe(100);
    expect(last.previous).toBe(40);
  });
});

describe("buildSalesReport — drill-down details", () => {
  it("lists the underlying sales, returns and discounts", () => {
    const appts = [
      appt({ id: "a1", date: "2026-06-05", totalPrice: 200, discountAmount: 25, style: "Knotless", clientName: "Bailey", discountName: "Loyalty" }),
      appt({ id: "a2", date: "2026-06-06", totalPrice: 100, clientName: "Dana", style: "Twists" }),
    ];
    const txns = [
      txn({ id: "r1", paidAt: "2026-06-06T11:00:00Z", method: "stripe", amount: 25, type: "refund", clientName: "Bailey", serviceName: "Knotless" }),
    ];
    const r = buildSalesReport(appts, txns, {}, "1W", REF);

    expect(r.details.sales).toHaveLength(2);
    expect(r.details.sales.map(s => s.title)).toContain("Bailey");
    const bailey = r.details.sales.find(s => s.id === "a1")!;
    expect(bailey.gross).toBe(200);
    expect(bailey.net).toBe(175);

    expect(r.details.returns).toHaveLength(1);
    expect(r.details.returns[0]).toMatchObject({ title: "Bailey", amount: 25 });

    expect(r.details.discounts).toHaveLength(1);
    expect(r.details.discounts[0]).toMatchObject({ title: "Bailey", subtitle: "Loyalty", amount: 25 });
  });
});

describe("pctChange", () => {
  it("returns null with no prior basis, percent otherwise", () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });
});
