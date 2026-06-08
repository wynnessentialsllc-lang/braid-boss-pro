import { describe, it, expect } from "vitest";
import {
  haversineMiles,
  calculateTravelFee,
  isInServiceArea,
  validateMobileServiceConfig,
  normalizeZip,
  type MobileServiceConfig,
} from "./mobile-service";

const baseCfg: MobileServiceConfig = {
  mobile_service: true,
  mobile_fee_model: "flat",
  mobile_flat_fee: 0,
  mobile_per_mile_fee: 0,
  mobile_hybrid_free_miles: 0,
  mobile_tiered_bands: [],
  mobile_minimum_price: null,
};

describe("haversineMiles", () => {
  it("returns 0 when any coord is missing", () => {
    expect(haversineMiles({ lat: null, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: undefined })).toBe(0);
  });

  it("returns 0 for identical points", () => {
    expect(haversineMiles({ lat: 34.05, lng: -118.25 }, { lat: 34.05, lng: -118.25 })).toBe(0);
  });

  it("matches a known distance within tolerance (LAX -> JFK ~2475 mi)", () => {
    const d = haversineMiles(
      { lat: 33.9416, lng: -118.4085 },
      { lat: 40.6413, lng: -73.7781 },
    );
    expect(d).toBeGreaterThan(2450);
    expect(d).toBeLessThan(2500);
  });

  it("handles short distances (LA downtown -> Beverly Hills ~9 mi)", () => {
    const d = haversineMiles(
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0736, lng: -118.4004 },
    );
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(11);
  });
});

describe("calculateTravelFee", () => {
  it("flat ignores distance", () => {
    expect(calculateTravelFee({ ...baseCfg, mobile_flat_fee: 25 }, 0)).toBe(25);
    expect(calculateTravelFee({ ...baseCfg, mobile_flat_fee: 25 }, 100)).toBe(25);
  });

  it("per_mile multiplies", () => {
    const cfg = { ...baseCfg, mobile_fee_model: "per_mile" as const, mobile_per_mile_fee: 2 };
    expect(calculateTravelFee(cfg, 10)).toBe(20);
    expect(calculateTravelFee(cfg, 7.5)).toBe(15);
  });

  it("hybrid bills only beyond the free threshold", () => {
    const cfg = {
      ...baseCfg, mobile_fee_model: "hybrid" as const,
      mobile_per_mile_fee: 2, mobile_hybrid_free_miles: 5,
    };
    expect(calculateTravelFee(cfg, 3)).toBe(0);
    expect(calculateTravelFee(cfg, 5)).toBe(0);
    expect(calculateTravelFee(cfg, 10)).toBe(10);
  });

  it("tiered picks the smallest covering band", () => {
    const cfg = {
      ...baseCfg, mobile_fee_model: "tiered" as const,
      mobile_tiered_bands: [
        { max_miles: 5, fee: 25 },
        { max_miles: 10, fee: 40 },
        { max_miles: 20, fee: 60 },
      ],
    };
    expect(calculateTravelFee(cfg, 3)).toBe(25);
    expect(calculateTravelFee(cfg, 5)).toBe(25);
    expect(calculateTravelFee(cfg, 7)).toBe(40);
    expect(calculateTravelFee(cfg, 20)).toBe(60);
  });

  it("tiered beyond the largest band falls back to the top band's fee", () => {
    const cfg = {
      ...baseCfg, mobile_fee_model: "tiered" as const,
      mobile_tiered_bands: [{ max_miles: 10, fee: 30 }],
    };
    expect(calculateTravelFee(cfg, 999)).toBe(30);
  });

  it("never returns a negative fee for tampered inputs", () => {
    const cfg = { ...baseCfg, mobile_fee_model: "per_mile" as const, mobile_per_mile_fee: -5 };
    expect(calculateTravelFee(cfg, 10)).toBe(0);
    expect(calculateTravelFee({ ...baseCfg, mobile_flat_fee: 25 }, -10)).toBe(25);
  });
});

describe("isInServiceArea", () => {
  it("blocks when radius is 0/unset", () => {
    expect(isInServiceArea({ radius_miles: 0, blocked_zips: [] }, 2, "90210"))
      .toEqual({ ok: false, reason: "no_coverage" });
  });

  it("blocks beyond the radius", () => {
    expect(isInServiceArea({ radius_miles: 10, blocked_zips: [] }, 12, "90210"))
      .toEqual({ ok: false, reason: "out_of_range" });
  });

  it("allows on the radius edge", () => {
    expect(isInServiceArea({ radius_miles: 10, blocked_zips: [] }, 10, "90210"))
      .toEqual({ ok: true });
  });

  it("blocks a zip on the blocklist (case + whitespace tolerant)", () => {
    expect(isInServiceArea(
      { radius_miles: 50, blocked_zips: [" 90210 "] }, 5, "90210",
    )).toEqual({ ok: false, reason: "blocked_zip" });
  });

  it("allows when zip is missing", () => {
    expect(isInServiceArea({ radius_miles: 10, blocked_zips: ["90210"] }, 5, null))
      .toEqual({ ok: true });
  });
});

describe("validateMobileServiceConfig", () => {
  it("returns [] when mobile is off", () => {
    expect(validateMobileServiceConfig({ mobile_service: false })).toEqual([]);
  });

  it("flat requires non-negative fee", () => {
    expect(validateMobileServiceConfig({
      mobile_service: true, mobile_fee_model: "flat", mobile_flat_fee: -1,
    })).toContain("Flat travel fee can't be negative.");
  });

  it("tiered requires at least one band", () => {
    expect(validateMobileServiceConfig({
      mobile_service: true, mobile_fee_model: "tiered", mobile_tiered_bands: [],
    })).toContain("Add at least one distance band.");
  });

  it("clean configs pass", () => {
    expect(validateMobileServiceConfig({
      mobile_service: true, mobile_fee_model: "hybrid",
      mobile_per_mile_fee: 2, mobile_hybrid_free_miles: 5,
    })).toEqual([]);
  });
});

describe("normalizeZip", () => {
  it("extracts a 5-digit zip from messy strings", () => {
    expect(normalizeZip("Los Angeles, CA 90210")).toBe("90210");
    expect(normalizeZip("90210-1234")).toBe("90210");
    expect(normalizeZip("  90210 ")).toBe("90210");
  });

  it("returns '' when no zip is found", () => {
    expect(normalizeZip("Los Angeles")).toBe("");
    expect(normalizeZip(null)).toBe("");
  });
});
