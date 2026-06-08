import { describe, it, expect } from "vitest";
import {
  validateStyleIntake,
  resolveQuoteRange,
  type StyleIntake,
  type AiStyleQuote,
} from "./style-request";
import type { Service } from "./services";

const intake = (over: Partial<StyleIntake>): StyleIntake => ({
  clientName: "Tiana",
  clientEmail: "tiana@example.com",
  photoPath: "photos/abc.jpg",
  size: "medium",
  length: "mid_back",
  preferredDate: "2026-07-01",
  preferredTime: "10:00",
  ...over,
});

const svc = (over: Partial<Service>): Service => ({
  id: "svc1",
  user_id: "u1",
  name: "Knotless Medium",
  description: null,
  duration_hours: 6,
  base_price: 200,
  deposit_required: true,
  deposit_amount: 50,
  add_ons: [],
  extras: [],
  prep_instructions: null,
  is_active: true,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  max_concurrent: 1,
  contract_template_id: null,
  category_id: null,
  featured: false,
  ...over,
} as Service);

describe("validateStyleIntake", () => {
  it("passes a complete intake", () => {
    expect(validateStyleIntake(intake({})).ok).toBe(true);
  });

  it("requires a name and a contact method", () => {
    const r = validateStyleIntake(intake({ clientName: "  ", clientEmail: null, clientPhone: null }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("Add your name.");
    expect(r.errors.some(e => e.includes("phone number or email"))).toBe(true);
  });

  it("accepts a written description instead of a photo", () => {
    expect(validateStyleIntake(intake({ photoPath: null, notes: "Boho knotless, honey blonde" })).ok).toBe(true);
  });

  it("requires photo or description", () => {
    const r = validateStyleIntake(intake({ photoPath: null, notes: "  " }));
    expect(r.errors.some(e => e.includes("photo or describe"))).toBe(true);
  });

  it("requires size, length, and a desired date + time", () => {
    const r = validateStyleIntake(intake({ size: null, length: "", preferredDate: "", preferredTime: null }));
    expect(r.errors).toContain("Pick a braid size.");
    expect(r.errors).toContain("Pick a length.");
    expect(r.errors).toContain("Pick a desired date.");
    expect(r.errors).toContain("Pick a desired time.");
  });
});

describe("resolveQuoteRange", () => {
  const services = [svc({ id: "knotless", name: "Knotless Medium", base_price: 200, duration_hours: 6 })];

  it("anchors the range to the matched service's base price (±15%, rounded to $5)", () => {
    const ai: AiStyleQuote = { suggestedServiceId: "knotless", estDurationHours: 7 };
    const q = resolveQuoteRange(ai, services);
    expect(q.anchored).toBe(true);
    expect(q.matchedServiceName).toBe("Knotless Medium");
    expect(q.priceLow).toBe(170); // 200 * 0.85
    expect(q.priceHigh).toBe(230); // 200 * 1.15
    expect(q.estDurationHours).toBe(7); // AI estimate preferred
  });

  it("falls back to the service duration when AI gives none", () => {
    const q = resolveQuoteRange({ suggestedServiceId: "knotless" }, services);
    expect(q.estDurationHours).toBe(6);
  });

  it("returns an unanchored, price-less quote when nothing matches", () => {
    const q = resolveQuoteRange({ suggestedServiceId: "ghost" }, services);
    expect(q.anchored).toBe(false);
    expect(q.priceLow).toBeNull();
    expect(q.priceHigh).toBeNull();
    expect(q.matchedServiceId).toBeNull();
  });

  it("ignores inactive services (no price from a hidden service)", () => {
    const q = resolveQuoteRange({ suggestedServiceId: "knotless" }, [svc({ id: "knotless", is_active: false })]);
    expect(q.anchored).toBe(false);
  });

  it("never throws on empty/garbage input", () => {
    expect(resolveQuoteRange(null, null).anchored).toBe(false);
    expect(resolveQuoteRange(undefined, []).priceLow).toBeNull();
  });
});
