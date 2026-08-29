// Mobile Services V1 — pure domain logic.
//
// Two responsibilities:
//   1. Distance — great-circle (haversine) miles between two coords.
//   2. Travel fee — given a service's fee model + a distance, return
//      the dollar fee the client should see. Pure functions only; no
//      React, no Supabase, no Mapbox calls. The /api/mobile-quote
//      route owns the I/O.

export const MOBILE_FEE_MODELS = ["flat", "per_mile", "hybrid", "tiered"] as const;
export type MobileFeeModel = (typeof MOBILE_FEE_MODELS)[number];

export type TieredBand = { max_miles: number; fee: number };

export type MobileServiceConfig = {
  mobile_service: boolean;
  mobile_fee_model: MobileFeeModel;
  mobile_flat_fee: number;
  mobile_per_mile_fee: number;
  mobile_hybrid_free_miles: number;
  mobile_tiered_bands: TieredBand[];
  mobile_minimum_price: number | null;
};

const EARTH_RADIUS_MILES = 3958.7613;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in miles between two (lat, lng) pairs. Returns
 * 0 when either coord is missing/invalid — callers should treat 0 as
 * "no distance computed" and gate their own UI accordingly.
 */
export const haversineMiles = (
  a: { lat: number | null | undefined; lng: number | null | undefined },
  b: { lat: number | null | undefined; lng: number | null | undefined },
): number => {
  const aLat = Number(a?.lat);
  const aLng = Number(a?.lng);
  const bLat = Number(b?.lat);
  const bLng = Number(b?.lng);
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return 0;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_RADIUS_MILES * c;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute the travel fee for a service + distance, honoring the
 * service's fee model. Negative or non-finite inputs are floored to 0
 * so a tampered geocode can't produce a negative quote.
 */
export const calculateTravelFee = (
  cfg: Pick<
    MobileServiceConfig,
    "mobile_fee_model" | "mobile_flat_fee" | "mobile_per_mile_fee"
    | "mobile_hybrid_free_miles" | "mobile_tiered_bands"
  >,
  miles: number,
): number => {
  const d = Number.isFinite(miles) && miles > 0 ? miles : 0;
  switch (cfg.mobile_fee_model) {
    case "flat":
      return round2(Math.max(0, Number(cfg.mobile_flat_fee) || 0));
    case "per_mile":
      return round2(d * Math.max(0, Number(cfg.mobile_per_mile_fee) || 0));
    case "hybrid": {
      const free = Math.max(0, Number(cfg.mobile_hybrid_free_miles) || 0);
      const billable = Math.max(0, d - free);
      return round2(billable * Math.max(0, Number(cfg.mobile_per_mile_fee) || 0));
    }
    case "tiered": {
      const bands = Array.isArray(cfg.mobile_tiered_bands) ? cfg.mobile_tiered_bands : [];
      // Smallest band that still covers the distance wins. Bands are
      // (max_miles, fee); if none match we fall back to the largest
      // band's fee so a misconfigured catalog still quotes SOMETHING.
      const sorted = bands
        .filter(b => Number.isFinite(b?.max_miles) && Number.isFinite(b?.fee))
        .map(b => ({ max_miles: Number(b.max_miles), fee: Math.max(0, Number(b.fee)) }))
        .sort((a, b) => a.max_miles - b.max_miles);
      if (sorted.length === 0) return 0;
      const hit = sorted.find(b => d <= b.max_miles);
      return round2(hit ? hit.fee : sorted[sorted.length - 1].fee);
    }
    default:
      return 0;
  }
};

/**
 * In-area test: distance fits inside radius AND the client's zip isn't
 * on the blocklist. A 0/null radius means "mobile not configured" →
 * always out of area.
 */
export const isInServiceArea = (
  area: { radius_miles: number; blocked_zips: string[] | null | undefined },
  miles: number,
  clientZip: string | null | undefined,
): { ok: true } | { ok: false; reason: "out_of_range" | "blocked_zip" | "no_coverage" } => {
  const radius = Number(area?.radius_miles) || 0;
  if (radius <= 0) return { ok: false, reason: "no_coverage" };
  if (miles > radius + 0.05) return { ok: false, reason: "out_of_range" };
  const zip = (clientZip || "").trim().slice(0, 10).toLowerCase();
  const blocked = (area?.blocked_zips || [])
    .map(z => (z || "").trim().toLowerCase())
    .filter(Boolean);
  if (zip && blocked.includes(zip)) return { ok: false, reason: "blocked_zip" };
  return { ok: true };
};

// ---- Validation -------------------------------------------------------

export type MobileServiceValidationError = string;

/**
 * Catch obvious misconfigurations before they reach the DB CHECK.
 * Returns an empty array when the config is consistent.
 */
export const validateMobileServiceConfig = (
  cfg: Partial<MobileServiceConfig>,
): MobileServiceValidationError[] => {
  if (!cfg?.mobile_service) return [];
  const errs: string[] = [];
  if (!MOBILE_FEE_MODELS.includes((cfg.mobile_fee_model || "flat") as MobileFeeModel)) {
    errs.push("Pick a travel fee model.");
  }
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  if (cfg.mobile_fee_model === "flat") {
    if (!Number.isFinite(num(cfg.mobile_flat_fee)) || num(cfg.mobile_flat_fee) < 0) {
      errs.push("Flat travel fee can't be negative.");
    }
  }
  if (cfg.mobile_fee_model === "per_mile" || cfg.mobile_fee_model === "hybrid") {
    if (!Number.isFinite(num(cfg.mobile_per_mile_fee)) || num(cfg.mobile_per_mile_fee) < 0) {
      errs.push("Per-mile fee can't be negative.");
    }
  }
  if (cfg.mobile_fee_model === "hybrid") {
    if (!Number.isFinite(num(cfg.mobile_hybrid_free_miles)) || num(cfg.mobile_hybrid_free_miles) < 0) {
      errs.push("Free-miles threshold can't be negative.");
    }
  }
  if (cfg.mobile_fee_model === "tiered") {
    const bands = Array.isArray(cfg.mobile_tiered_bands) ? cfg.mobile_tiered_bands : [];
    if (bands.length === 0) errs.push("Add at least one distance band.");
    bands.forEach((b, i) => {
      if (!Number.isFinite(num(b?.max_miles)) || num(b?.max_miles) <= 0) {
        errs.push(`Band ${i + 1} needs a positive distance.`);
      }
      if (!Number.isFinite(num(b?.fee)) || num(b?.fee) < 0) {
        errs.push(`Band ${i + 1} fee can't be negative.`);
      }
    });
  }
  if (cfg.mobile_minimum_price != null
      && (!Number.isFinite(num(cfg.mobile_minimum_price)) || num(cfg.mobile_minimum_price) < 0)) {
    errs.push("Minimum service price can't be negative.");
  }
  return errs;
};

/**
 * Normalize a US zip (5-digit or zip+4) from a free-text string. Used
 * on both sides — the stylist's blocklist input and the geocoded client
 * zip — so an entry like "  90210-1234 " matches "90210" cleanly.
 */
export const normalizeZip = (raw: string | null | undefined): string => {
  const s = (raw || "").trim();
  const m = s.match(/\b(\d{5})(?:-?\d{4})?\b/);
  return m ? m[1] : "";
};

// ---- Client address parts -------------------------------------------
//
// The booking page collects the client's address as four fields —
// street, city, state, zip — instead of one free-text line. A single
// line let people submit "318 e Fairview, Inglewood" with no zip,
// which Mapbox happily resolves to the wrong Fairview in another
// state, quoting a travel fee for a trip the stylist never agreed to.
// Splitting the fields makes the missing piece obvious and lets us
// gate the quote until there's enough to geocode unambiguously.

export type AddressParts = {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

/** Uppercase a 2-letter state code; pass longer names through trimmed. */
export const normalizeState = (raw: string | null | undefined): string => {
  const s = (raw || "").trim();
  return s.length === 2 ? s.toUpperCase() : s;
};

/**
 * Join address parts into a single geocodable line:
 * "318 E Fairview Blvd, Inglewood, CA 90302".
 *
 * State and zip share a segment (", CA 90302") because that's the
 * postal convention Mapbox parses best. Blank parts drop out, so a
 * street-plus-zip entry still composes cleanly.
 */
export const composeAddress = (parts: AddressParts): string => {
  const street = (parts.street || "").trim();
  const city = (parts.city || "").trim();
  const state = normalizeState(parts.state);
  const zip = normalizeZip(parts.zip);

  const segments: string[] = [];
  if (street) segments.push(street);
  if (city) segments.push(city);
  const tail = [state, zip].filter(Boolean).join(" ");
  if (tail) segments.push(tail);
  return segments.join(", ");
};

/**
 * Is there enough here to ask Mapbox for a trustworthy point? Street is
 * always required. Beyond that we need a city or a zip — a bare street
 * name is the exact input that geocodes to the wrong town.
 */
export const hasEnoughAddress = (parts: AddressParts): boolean => {
  const street = (parts.street || "").trim();
  if (street.length < 4) return false;
  return !!(parts.city || "").trim() || !!normalizeZip(parts.zip);
};

/**
 * Which field is the client missing? Drives the inline hint under the
 * address block so "nothing happened" never reads as a broken page.
 */
export const describeMissingAddress = (parts: AddressParts): string | null => {
  const street = (parts.street || "").trim();
  if (street.length < 4) return "Enter your street address.";
  if (!(parts.city || "").trim() && !normalizeZip(parts.zip)) {
    return "Add your city or ZIP so we can check the travel distance.";
  }
  return null;
};

/** A typed zip is either blank or a real 5-digit code — never half of one. */
export const isZipInputValid = (raw: string | null | undefined): boolean => {
  const s = (raw || "").trim();
  if (!s) return true;
  return /^\d{5}(-\d{4})?$/.test(s);
};
