import { describe, it, expect } from "vitest";
import { buildReceiptFromAppointment, buildReceiptSummaryText } from "./receipts";

// Claudia's booking: $325 subtotal, −$20.26 discount = $304.74 net, a $25
// deposit, and a $279.74 balance later paid by card with a $30 tip. The
// balance charge's Stripe fee was $18.85.
const claudiaPaid = {
  id: "appt_claudia",
  clientName: "Claudia Vine",
  style: "Boho Knotless Braids (Small/Medium)",
  date: "2026-07-11",
  totalPrice: 325,
  discountAmount: 20.26,
  discountName: "Knotless 2026",
  depositPaid: 25,
  balanceDue: 0,
  balance_paid: true,
  paymentStatus: "paid",
  tipAmount: 30,
  stripeFee: 18.85,
  stripeNet: 290.89,
};

describe("buildReceiptFromAppointment — payment breakdown", () => {
  const rcp = buildReceiptFromAppointment(claudiaPaid, "receipt", [], "rcp_1", "Claudia Vine");

  it("keeps the deposit at $25 instead of collapsing it into the total", () => {
    expect(rcp.depositPaid).toBe(25);
  });

  it("shows the balance actually paid ($279.74), not $0", () => {
    expect(rcp.balancePaid).toBe(279.74);
    expect(rcp.balanceDue).toBe(0);
  });

  it("surfaces the tip and the discount", () => {
    expect(rcp.tip).toBe(30);
    expect(rcp.discountAmount).toBe(20.26);
    expect(rcp.totalPrice).toBe(304.74);
    expect(rcp.subtotal).toBe(325);
  });

  it("collects the whole ticket plus tip — not just the deposit", () => {
    // $304.74 service + $30 tip. The old code returned $25 (the deposit).
    expect(rcp.amountCollected).toBe(334.74);
  });

  it("reports the Stripe fee and the true net payout", () => {
    expect(rcp.stripeFee).toBe(18.85);
    // amountCollected − fee.
    expect(rcp.netPayout).toBe(315.89);
  });

  it("marks the receipt paid", () => {
    expect(rcp.paymentStatus).toBe("paid");
  });
});

describe("buildReceiptFromAppointment — deposit only (unpaid balance)", () => {
  const rcp = buildReceiptFromAppointment(
    { id: "a2", totalPrice: 200, depositPaid: 50, balanceDue: 150, paymentStatus: "partial" },
    "receipt",
    [],
    "rcp_2",
  );

  it("collects only the deposit and still shows the balance due", () => {
    expect(rcp.depositPaid).toBe(50);
    expect(rcp.balanceDue).toBe(150);
    expect(rcp.balancePaid).toBeUndefined();
    expect(rcp.amountCollected).toBe(50);
  });

  it("omits Stripe fee / net when there's no card fee", () => {
    expect(rcp.stripeFee).toBeUndefined();
    expect(rcp.netPayout).toBeUndefined();
  });
});

// Danielle's booking (matches the shared receipt): medium Boho Knotless with
// a Boho Max add-on, $210 total, paid in full by Zelle.
describe("buildReceiptFromAppointment — itemized add-ons", () => {
  const danielle = {
    id: "appt_danielle",
    clientName: "Danielle Vine",
    style: "Boho Knotless Braids (Medium) — Boho Max",
    date: "2026-07-12",
    totalPrice: 210,
    addons: [{ id: "x1", name: "Boho Max", price: 50 }],
    depositPaid: 210,
    balanceDue: 0,
    paymentStatus: "paid",
    paymentMethod: "zelle",
  };
  const rcp = buildReceiptFromAppointment(danielle, "receipt", [], "rcp_d", "Danielle Vine");

  it("itemizes the base service and the add-on", () => {
    expect(rcp.lineItems).toEqual([
      { label: "Boho Knotless Braids (Medium)", amount: 160, kind: "service" },
      { label: "Boho Max", amount: 50, kind: "addon" },
    ]);
  });

  it("keeps the line items reconciled to the ticket total", () => {
    const sum = (rcp.lineItems || []).reduce((s, li) => s + li.amount, 0);
    expect(sum).toBe(rcp.totalPrice);
    expect(rcp.totalPrice).toBe(210);
  });

  it("surfaces the add-on and base in the shareable summary text", () => {
    const text = buildReceiptSummaryText(rcp);
    expect(text).toContain("Boho Knotless Braids (Medium): $160.00");
    expect(text).toContain("+ Boho Max: $50.00");
  });
});

// An appointment with no add-ons stays a single-line ticket — a lone base
// line would just restate "Service total".
describe("buildReceiptFromAppointment — no add-ons", () => {
  const rcp = buildReceiptFromAppointment(
    { id: "a3", style: "Knotless Braids", totalPrice: 180, depositPaid: 60, balanceDue: 120 },
    "receipt",
    [],
    "rcp_3",
  );
  it("leaves lineItems undefined", () => {
    expect(rcp.lineItems).toBeUndefined();
  });
});
