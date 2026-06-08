import { describe, it, expect } from "vitest";
import {
  findAcvExtra,
  isAcvTreatmentEnabled,
  resolveVariationPricing,
  ACV_EXTRA_ID,
  ACV_EXTRA_KIND,
  ACV_EXTRA_NAME,
  type ServiceExtra,
} from "./services";

const acv = (over: Partial<ServiceExtra> = {}): ServiceExtra => ({
  id: ACV_EXTRA_ID,
  kind: ACV_EXTRA_KIND,
  name: ACV_EXTRA_NAME,
  price: 0,
  active: true,
  ...over,
});

const plain = (over: Partial<ServiceExtra> = {}): ServiceExtra => ({
  id: "extra_curl",
  name: "Curl ends",
  price: 15,
  active: true,
  ...over,
});

describe("findAcvExtra", () => {
  it("locates the managed entry by kind", () => {
    const found = findAcvExtra([plain(), acv()]);
    expect(found?.id).toBe(ACV_EXTRA_ID);
  });

  it("locates it by id even if kind is missing (legacy row)", () => {
    const found = findAcvExtra([{ id: ACV_EXTRA_ID, name: ACV_EXTRA_NAME, price: 0 }]);
    expect(found?.id).toBe(ACV_EXTRA_ID);
  });

  it("returns null when absent", () => {
    expect(findAcvExtra([plain()])).toBeNull();
    expect(findAcvExtra([])).toBeNull();
    expect(findAcvExtra(null)).toBeNull();
  });
});

describe("isAcvTreatmentEnabled", () => {
  it("true when present and active", () => {
    expect(isAcvTreatmentEnabled({ extras: [acv({ active: true })] })).toBe(true);
  });

  it("false when soft-disabled (toggle off keeps the entry)", () => {
    expect(isAcvTreatmentEnabled({ extras: [acv({ active: false })] })).toBe(false);
  });

  it("false when there is no ACV entry", () => {
    expect(isAcvTreatmentEnabled({ extras: [plain()] })).toBe(false);
    expect(isAcvTreatmentEnabled({ extras: [] })).toBe(false);
  });
});

describe("ACV rides the existing add-on pricing rails", () => {
  // The booking page sums picked extras on top of the resolved
  // base/variation price; ACV is just another extra, so a paid ACV
  // adds to the total and a free ACV is a no-op on price.
  const base = {
    base_price: 200,
    duration_hours: 6,
    deposit_required: true,
    deposit_amount: 50,
    add_ons: [],
  };

  it("resolves the base unchanged regardless of ACV", () => {
    const r = resolveVariationPricing(base, null);
    expect(r.price).toBe(200);
    expect(r.depositAmount).toBe(50);
  });

  it("a paid ACV extra contributes its price to a booking total", () => {
    const extras = [acv({ price: 10 })];
    const picked = extras.filter(e => e.active !== false);
    const total = resolveVariationPricing(base, null).price
      + picked.reduce((s, e) => s + (Number(e.price) || 0), 0);
    expect(total).toBe(210);
  });

  it("a free ACV extra leaves the total unchanged", () => {
    const extras = [acv({ price: 0 })];
    const picked = extras.filter(e => e.active !== false);
    const total = resolveVariationPricing(base, null).price
      + picked.reduce((s, e) => s + (Number(e.price) || 0), 0);
    expect(total).toBe(200);
  });
});
