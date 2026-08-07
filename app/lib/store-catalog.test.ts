import { describe, it, expect } from "vitest";
import {
  isPurchasable,
  formatPrice,
  unitPriceCents,
  getStoreProduct,
  listStoreProducts,
  type StoreProduct,
} from "./store-catalog";

const product = (over: Partial<StoreProduct> = {}): StoreProduct => ({
  slug: "test",
  name: "Test",
  tagline: "A test product",
  category: "Test",
  priceCents: 2700,
  currency: "usd",
  isDigital: true,
  digitalFilePath: "planner/test.pdf",
  shortDescription: "",
  longDescription: [],
  highlights: [],
  active: true,
  ...over,
});

describe("isPurchasable", () => {
  it("accepts an active, priced digital product with a file", () => {
    expect(isPurchasable(product())).toBe(true);
  });

  it("rejects an inactive product (the launch/coming-soon state)", () => {
    expect(isPurchasable(product({ active: false }))).toBe(false);
  });

  it("rejects a digital product with no file to deliver", () => {
    expect(isPurchasable(product({ digitalFilePath: undefined }))).toBe(false);
  });

  it("allows a non-digital product without a file", () => {
    expect(
      isPurchasable(product({ isDigital: false, digitalFilePath: undefined })),
    ).toBe(true);
  });

  it("rejects a zero or negative price", () => {
    expect(isPurchasable(product({ priceCents: 0 }))).toBe(false);
    expect(isPurchasable(product({ priceCents: -100 }))).toBe(false);
  });

  it("rejects a non-finite price", () => {
    expect(isPurchasable(product({ priceCents: NaN }))).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isPurchasable(undefined)).toBe(false);
  });
});

describe("formatPrice", () => {
  it("drops .00 for whole-dollar amounts", () => {
    expect(formatPrice(2700)).toBe("$27");
    expect(formatPrice(4500)).toBe("$45");
  });

  it("keeps cents when present", () => {
    expect(formatPrice(2499)).toBe("$24.99");
    expect(formatPrice(1050)).toBe("$10.50");
  });

  it("handles zero", () => {
    expect(formatPrice(0)).toBe("$0");
  });
});

describe("unitPriceCents", () => {
  it("returns the product price", () => {
    expect(unitPriceCents(product({ priceCents: 1234 }))).toBe(1234);
  });
});

describe("catalog integrity", () => {
  it("has unique, well-formed slugs", () => {
    const all = listStoreProducts();
    const slugs = all.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9-]+$/);
      expect(getStoreProduct(s)?.slug).toBe(s);
    }
  });

  it("never lists a digital product as purchasable without a file", () => {
    for (const p of listStoreProducts()) {
      if (isPurchasable(p) && p.isDigital) {
        expect(p.digitalFilePath).toBeTruthy();
      }
    }
  });
});
