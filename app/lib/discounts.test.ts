import { describe, it, expect } from "vitest";
import {
  selectableDiscounts,
  discountUsageFromAppointments,
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

  it("handles empty / nullish input", () => {
    expect(discountUsageFromAppointments(null).size).toBe(0);
    expect(discountUsageFromAppointments(undefined).size).toBe(0);
    expect(discountUsageFromAppointments([]).size).toBe(0);
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
