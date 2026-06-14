import { describe, it, expect } from "vitest";
import {
  computeSaleTotals,
  computeSaleProfit,
  buildSaleTransaction,
  saleDeductions,
  saleLoyaltyEarn,
  ticketLabel,
  tenderToMethod,
  type SaleLine,
  type SaleDraft,
} from "./boss-checkout";

const line = (over: Partial<SaleLine>): SaleLine => ({
  id: "l1",
  kind: "product",
  name: "Edge control",
  unitPrice: 12,
  quantity: 1,
  ...over,
});

describe("computeSaleTotals", () => {
  it("sums lines into a subtotal", () => {
    const t = computeSaleTotals({
      lines: [
        line({ id: "a", unitPrice: 12, quantity: 2 }),
        line({ id: "b", kind: "service", name: "Knotless", unitPrice: 180, quantity: 1 }),
      ],
    });
    expect(t.subtotal).toBe(204); // 12*2 + 180
    expect(t.grandTotal).toBe(204);
    expect(t.amountDue).toBe(204);
  });

  it("applies a percentage discount to the subtotal", () => {
    const t = computeSaleTotals({
      lines: [line({ unitPrice: 100, quantity: 1 })],
      discount: { id: "d", name: "VIP", discount_type: "percentage", value: 10 },
    });
    expect(t.discountAmount).toBe(10);
    expect(t.taxableBase).toBe(90);
  });

  it("clamps a fixed discount to the subtotal", () => {
    const t = computeSaleTotals({
      lines: [line({ unitPrice: 20, quantity: 1 })],
      discount: { id: "d", name: "Comp", discount_type: "fixed", value: 999 },
    });
    expect(t.discountAmount).toBe(20);
    expect(t.taxableBase).toBe(0);
  });

  it("applies tax to the post-discount base only", () => {
    const t = computeSaleTotals({
      lines: [line({ unitPrice: 100, quantity: 1 })],
      discount: { id: "d", name: "x", discount_type: "fixed", value: 20 },
      taxRate: 0.1,
    });
    expect(t.taxableBase).toBe(80);
    expect(t.taxAmount).toBe(8); // 80 * 0.10, not 100
  });

  it("adds tip on top of base + tax", () => {
    const t = computeSaleTotals({
      lines: [line({ unitPrice: 100, quantity: 1 })],
      taxRate: 0.1,
      tipAmount: 15,
    });
    expect(t.grandTotal).toBe(125); // 100 + 10 + 15
  });

  it("applies gift card then loyalty as tender, clamped to the total", () => {
    const t = computeSaleTotals({
      lines: [line({ unitPrice: 100, quantity: 1 })],
      giftCard: { id: "g", code: "ABC", amount: 40 },
      loyaltyReward: { pointsSpent: 100, rewardValue: 10 },
    });
    expect(t.giftCardApplied).toBe(40);
    expect(t.loyaltyApplied).toBe(10);
    expect(t.creditsApplied).toBe(50);
    expect(t.amountDue).toBe(50);
  });

  it("never lets credits exceed the grand total", () => {
    const t = computeSaleTotals({
      lines: [line({ unitPrice: 30, quantity: 1 })],
      giftCard: { id: "g", code: "ABC", amount: 100 },
      loyaltyReward: { pointsSpent: 100, rewardValue: 10 },
    });
    expect(t.giftCardApplied).toBe(30);
    expect(t.loyaltyApplied).toBe(0); // nothing left to apply
    expect(t.amountDue).toBe(0);
  });

  it("coerces garbage quantities to a sane subtotal", () => {
    const t = computeSaleTotals({
      // @ts-expect-error runtime coercion of bad quantity
      lines: [line({ unitPrice: 10, quantity: "x" }), line({ id: "b", unitPrice: 5, quantity: 3 })],
    });
    expect(t.subtotal).toBe(15);
  });
});

describe("computeSaleProfit", () => {
  it("take-home = revenue − material cost, tip excluded from margin", () => {
    const p = computeSaleProfit({
      lines: [
        line({ kind: "service", name: "Knotless", unitPrice: 180, quantity: 1, recipe: [
          { itemId: "hair", quantity: 4, unitCost: 5 }, // $20 hair
        ], overhead: 10, hours: 5 }),
      ],
      tipAmount: 40,
    });
    expect(p.revenue).toBe(180);
    expect(p.materialCost).toBe(30); // 20 hair + 10 overhead
    expect(p.takeHome).toBe(150);
    expect(p.takeHomeWithTip).toBe(190);
    expect(p.takeHomePerHour).toBe(30); // 150 / 5
    expect(p.marginPct).toBeCloseTo(83.33, 1);
  });

  it("uses product unit cost × qty for retail lines", () => {
    const p = computeSaleProfit({
      lines: [line({ kind: "product", unitPrice: 12, quantity: 2, unitCost: 4 })],
    });
    expect(p.revenue).toBe(24);
    expect(p.materialCost).toBe(8);
    expect(p.takeHome).toBe(16);
  });

  it("excludes gift-card sale lines from revenue and cost", () => {
    const p = computeSaleProfit({
      lines: [
        line({ kind: "service", name: "Box braids", unitPrice: 150, quantity: 1, overhead: 0 }),
        line({ id: "g", kind: "gift_card", name: "Gift card", unitPrice: 50, quantity: 1 }),
      ],
    });
    expect(p.revenue).toBe(150); // gift card not counted
  });

  it("apportions a discount across counted lines for margin", () => {
    const p = computeSaleProfit({
      lines: [
        line({ kind: "service", name: "Svc", unitPrice: 100, quantity: 1 }),
        line({ id: "g", kind: "gift_card", name: "GC", unitPrice: 100, quantity: 1 }),
      ],
      discount: { id: "d", name: "x", discount_type: "fixed", value: 40 },
    });
    // Discount is $40 over a $200 full subtotal; the counted (service)
    // line is half of it, so $20 comes off the counted revenue.
    expect(p.revenue).toBe(80);
  });
});

describe("buildSaleTransaction", () => {
  const draft: SaleDraft = {
    lines: [line({ kind: "service", name: "Knotless", unitPrice: 180, quantity: 1 })],
    tipAmount: 20,
    clientId: "c1",
    clientName: "Asha",
    appointmentId: "appt-9",
  };

  it("records camelCase fields the store + sync expect", () => {
    const rec = buildSaleTransaction(draft, { tender: "cash", paidAt: "2026-06-14T10:00:00.000Z" });
    expect(rec.paymentMethod).toBe("cash");
    expect(rec.paymentType).toBe("full");
    expect(rec.clientName).toBe("Asha");
    expect(rec.appointmentId).toBe("appt-9");
    expect(rec.tipAmount).toBe(20);
    expect(rec.amount).toBe(180); // goods portion (amountDue − tip)
    expect(rec.paidAt).toBe("2026-06-14T10:00:00.000Z");
    expect(rec.data.source).toBe("boss_checkout");
  });

  it("excludes credit-covered value from new-money amount", () => {
    const rec = buildSaleTransaction(
      { ...draft, tipAmount: 0, giftCard: { id: "g", code: "X", amount: 80 } },
      { tender: "tap_to_pay", stripePaymentIntentId: "pi_123" },
    );
    expect(rec.amount).toBe(100); // 180 total − 80 gift card
    expect(rec.paymentMethod).toBe("stripe");
    expect(rec.data.stripePaymentIntentId).toBe("pi_123");
    expect(rec.data.giftCardId).toBe("g");
  });
});

describe("saleDeductions", () => {
  it("deducts product stock and service recipe hair", () => {
    const ded = saleDeductions({
      lines: [
        line({ kind: "product", name: "Oil", unitPrice: 10, quantity: 3, inventoryItemId: "inv-oil", unitCost: 4 }),
        line({ id: "s", kind: "service", name: "Knotless", unitPrice: 180, quantity: 1, recipe: [
          { itemId: "hair", variationId: "v1", quantity: 4, unitCost: 5 },
        ] }),
      ],
    });
    expect(ded).toHaveLength(2);
    const oil = ded.find((d) => d.itemId === "inv-oil")!;
    expect(oil.quantity).toBe(3);
    expect(oil.reason).toBe("storefront_sale");
    const hair = ded.find((d) => d.itemId === "hair")!;
    expect(hair.quantity).toBe(4);
    expect(hair.variationId).toBe("v1");
    expect(hair.reason).toBe("service_use");
  });

  it("scales recipe quantity by service line quantity", () => {
    const ded = saleDeductions({
      lines: [line({ kind: "service", name: "x", unitPrice: 50, quantity: 2, recipe: [
        { itemId: "hair", quantity: 3, unitCost: 5 },
      ] })],
    });
    expect(ded[0].quantity).toBe(6); // 3 per service × 2 services
  });

  it("ignores custom + gift-card lines (no inventory)", () => {
    const ded = saleDeductions({
      lines: [
        line({ kind: "custom", name: "Touch-up", unitPrice: 25, quantity: 1 }),
        line({ id: "g", kind: "gift_card", name: "GC", unitPrice: 50, quantity: 1 }),
      ],
    });
    expect(ded).toHaveLength(0);
  });
});

describe("saleLoyaltyEarn", () => {
  const program = { enabled: true, pointsPerVisit: 10 };

  it("earns a visit's points when a service is sold to a known client", () => {
    expect(saleLoyaltyEarn({ lines: [line({ kind: "service", name: "x", unitPrice: 100, quantity: 1 })], clientId: "c1" }, program)).toBe(10);
  });

  it("earns nothing for a retail-only ticket", () => {
    expect(saleLoyaltyEarn({ lines: [line({ kind: "product", unitPrice: 10, quantity: 1 })], clientId: "c1" }, program)).toBe(0);
  });

  it("earns nothing without a client or with the program off", () => {
    expect(saleLoyaltyEarn({ lines: [line({ kind: "service", name: "x", unitPrice: 1, quantity: 1 })] }, program)).toBe(0);
    expect(saleLoyaltyEarn({ lines: [line({ kind: "service", name: "x", unitPrice: 1, quantity: 1 })], clientId: "c1" }, { enabled: false, pointsPerVisit: 10 })).toBe(0);
  });
});

describe("ticketLabel + tenderToMethod", () => {
  it("summarises a multi-line ticket", () => {
    expect(ticketLabel([line({ name: "Knotless", quantity: 1 }), line({ id: "b", name: "Oil", quantity: 1 })])).toBe("Knotless + 1 more");
    expect(ticketLabel([line({ name: "Oil", quantity: 2 })])).toBe("Oil ×2");
    expect(ticketLabel([])).toBe("Quick sale");
  });

  it("maps tenders onto payment methods", () => {
    expect(tenderToMethod("tap_to_pay")).toBe("stripe");
    expect(tenderToMethod("cash")).toBe("cash");
    expect(tenderToMethod("zelle")).toBe("zelle");
    expect(tenderToMethod("other")).toBe("other");
  });
});
