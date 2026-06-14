import { describe, it, expect } from "vitest";
import {
  selectableDiscounts,
  discountUsageFromAppointments,
  computeStackedDiscounts,
  type Discount,
} from "./discounts";

const base: Discount = {
  id: "d1",
  user_id: "u1",
  name: "Spring",
  kind: "percent",
  value: 10,
  applies_to: "all",
  is_active: true,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  times_used: 0,
} as unknown as Discount;

describe("discountUsageFromAppointments", () => {
  it("counts non-cancelled appointments per discount id", () => {
    const m = discountUsageFromAppointments([
      { discountId: "d1", status: "scheduled" },
      { discountId: "d1", status: "completed" },
      { discountId: "d2", status: "scheduled" },
      { discountId: "d1", status: "cancelled" }, // excluded
      { discountId: "d1", status: "canceled" }, // excluded (US spelling)
      { discountId: null, status: "scheduled" }, // no discount
      { status: "scheduled" }, // no discount field
    ]);
    expect(m.get("d1")).toBe(2);
    expect(m.get("d2")).toBe(1);
  });

  it("counts each discount in a stacked (multi-discount) appointment once", () => {
    const m = discountUsageFromAppointments([
      { discounts: [{ id: "d1" }, { id: "d2" }], status: "scheduled" },
      { discounts: [{ id: "d1" }], status: "completed" },
      { discounts: [{ id: "d1" }, { id: "d2" }], status: "cancelled" }, // excluded
      // legacy single-discount record still counts via discountId fallback
      { discountId: "d2", status: "scheduled" },
    ]);
    expect(m.get("d1")).toBe(2);
    expect(m.get("d2")).toBe(2);
  });

  it("handles empty / nullish input", () => {
    expect(discountUsageFromAppointments(null).size).toBe(0);
    expect(discountUsageFromAppointments(undefined).size).toBe(0);
    expect(discountUsageFromAppointments([]).size).toBe(0);
  });
});

describe("computeStackedDiscounts", () => {
  const fixed = (id: string, value: number): Discount =>
    ({ id, name: id, discount_type: "fixed", value } as unknown as Discount);
  const pct = (id: string, value: number): Discount =>
    ({ id, name: id, discount_type: "percentage", value } as unknown as Discount);

  it("stacks two fixed discounts additively", () => {
    const { lines, total } = computeStackedDiscounts(100, [fixed("a", 25), fixed("b", 10)]);
    expect(lines.map(l => l.amount)).toEqual([25, 10]);
    expect(total).toBe(35);
  });

  it("computes each percentage off the original subtotal", () => {
    const { lines, total } = computeStackedDiscounts(200, [pct("a", 10), pct("b", 5)]);
    expect(lines.map(l => l.amount)).toEqual([20, 10]);
    expect(total).toBe(30);
  });

  it("caps the combined total at the subtotal (never negative net)", () => {
    const { lines, total } = computeStackedDiscounts(100, [fixed("a", 80), fixed("b", 50)]);
    expect(lines.map(l => l.amount)).toEqual([80, 20]);
    expect(total).toBe(100);
  });

  it("returns no lines for an empty / nullish list", () => {
    expect(computeStackedDiscounts(100, []).total).toBe(0);
    expect(computeStackedDiscounts(100, null).lines).toEqual([]);
  });
});

describe("selectableDiscounts usage_limit enforcement", () => {
  it("keeps a discount with no usage_limit regardless of usage", () => {
    const usage = new Map([["d1", 99]]);
    expect(selectableDiscounts([base], Date.now(), usage).map(d => d.id)).toEqual(["d1"]);
  });

  it("hides a discount once derived usage reaches its limit", () => {
    const d: Discount = { ...base, usage_limit: 2 };
    expect(selectableDiscounts([d], Date.now(), new Map([["d1", 1]])).length).toBe(1);
    expect(selectableDiscounts([d], Date.now(), new Map([["d1", 2]])).length).toBe(0);
    expect(selectableDiscounts([d], Date.now(), new Map([["d1", 3]])).length).toBe(0);
  });

  it("falls back to stored times_used when no usage map is supplied", () => {
    const exhausted: Discount = { ...base, usage_limit: 1, times_used: 1 };
    expect(selectableDiscounts([exhausted], Date.now()).length).toBe(0);
    const fresh: Discount = { ...base, usage_limit: 1, times_used: 0 };
    expect(selectableDiscounts([fresh], Date.now()).length).toBe(1);
  });

  it("uses the max of stored counter and derived usage", () => {
    const d: Discount = { ...base, usage_limit: 3, times_used: 3 };
    // stored counter alone already exhausts it even with low derived usage
    expect(selectableDiscounts([d], Date.now(), new Map([["d1", 0]])).length).toBe(0);
  });
});
