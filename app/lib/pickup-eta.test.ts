import { describe, it, expect } from "vitest";
import { formatPickupEta, type ShopFulfillment } from "./storefront";

const cfg = (
  over: Partial<Pick<ShopFulfillment, "turnaround_days_min" | "turnaround_days_max">> = {},
): ShopFulfillment => ({
  pickup_enabled: true,
  delivery_enabled: false,
  shipping_enabled: false,
  shipping_mode: "flat",
  shipping_flat_rate: null,
  shipping_free_threshold: null,
  delivery_fee: null,
  pickup_instructions: null,
  delivery_radius_miles: null,
  turnaround_days_min: null,
  turnaround_days_max: null,
  ...over,
});

describe("formatPickupEta", () => {
  it("returns null when neither bound is set", () => {
    expect(formatPickupEta(cfg())).toBeNull();
  });

  it("returns null when both bounds are 0 or negative (treated as unset)", () => {
    expect(formatPickupEta(cfg({ turnaround_days_min: 0, turnaround_days_max: 0 }))).toBeNull();
    expect(formatPickupEta(cfg({ turnaround_days_min: -1, turnaround_days_max: 0 }))).toBeNull();
  });

  it("renders a range when both bounds are set and different", () => {
    expect(formatPickupEta(cfg({ turnaround_days_min: 1, turnaround_days_max: 3 }))).toBe(
      "Usually ready in 1–3 days",
    );
  });

  it("collapses equal bounds to a single number with correct plural", () => {
    expect(formatPickupEta(cfg({ turnaround_days_min: 1, turnaround_days_max: 1 }))).toBe(
      "Usually ready in 1 day",
    );
    expect(formatPickupEta(cfg({ turnaround_days_min: 4, turnaround_days_max: 4 }))).toBe(
      "Usually ready in 4 days",
    );
  });

  it("uses min-only when max is missing", () => {
    expect(formatPickupEta(cfg({ turnaround_days_min: 2, turnaround_days_max: null }))).toBe(
      "Usually ready in 2 days",
    );
  });

  it("uses 'up to N' when only max is set", () => {
    expect(formatPickupEta(cfg({ turnaround_days_min: null, turnaround_days_max: 5 }))).toBe(
      "Usually ready in up to 5 days",
    );
    expect(formatPickupEta(cfg({ turnaround_days_min: null, turnaround_days_max: 1 }))).toBe(
      "Usually ready in up to 1 day",
    );
  });
});
