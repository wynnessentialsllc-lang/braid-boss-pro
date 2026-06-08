// "Build your style" — domain logic for the client-facing AI consultation.
//
// When a client doesn't see the style they want on the booking page, they
// describe it (photo + a few structured answers), an AI proposes the
// closest catalog match, and the client gets a BALLPARK quote — explicitly
// pending stylist review, not a booking.
//
// This module is the brain shared by the client intake UI and the AI
// route: it validates the intake and turns the AI's suggestion into a
// price RANGE anchored to the stylist's REAL catalog (so the model can't
// invent prices — it only picks which service is closest; pricing comes
// from that service's base_price). Pure + tested; no React, no Supabase.

import type { Service } from "./services";

export const STYLE_SIZES = ["micro", "small", "medium", "large", "jumbo"] as const;
export const STYLE_LENGTHS = ["shoulder", "mid_back", "waist", "hip", "butt"] as const;
export type StyleSize = (typeof STYLE_SIZES)[number];
export type StyleLength = (typeof STYLE_LENGTHS)[number];

export const STYLE_SIZE_LABEL: Record<StyleSize, string> = {
  micro: "Micro", small: "Small", medium: "Medium", large: "Large", jumbo: "Jumbo",
};
export const STYLE_LENGTH_LABEL: Record<StyleLength, string> = {
  shoulder: "Shoulder", mid_back: "Mid-back", waist: "Waist", hip: "Hip-length", butt: "Butt-length",
};

export type StyleIntake = {
  clientName: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
  /** Storage path of the inspiration photo (reuses photo-storage). */
  photoPath?: string | null;
  size?: string | null;
  length?: string | null;
  /** Stylist provides the hair vs client brings their own. */
  hairIncluded?: boolean | null;
  humanHair?: boolean | null;
  color?: string | null;
  notes?: string | null;
  /** Desired date/time — reuses booking_requests.preferred_date/time. */
  preferredDate?: string | null;
  preferredTime?: string | null;
};

export type IntakeValidation = { ok: boolean; errors: string[] };

const hasText = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/**
 * Validate a client's style intake before it can be submitted. Required:
 * a name, at least one contact method, a photo OR a written description,
 * size + length, and a desired date + time (so the stylist can review a
 * real slot — per product requirement).
 */
export const validateStyleIntake = (intake: StyleIntake): IntakeValidation => {
  const errors: string[] = [];
  if (!hasText(intake.clientName)) errors.push("Add your name.");
  if (!hasText(intake.clientPhone) && !hasText(intake.clientEmail)) {
    errors.push("Add a phone number or email so the stylist can reach you.");
  }
  if (!hasText(intake.photoPath) && !hasText(intake.notes)) {
    errors.push("Upload a photo or describe the style you want.");
  }
  if (!hasText(intake.size)) errors.push("Pick a braid size.");
  if (!hasText(intake.length)) errors.push("Pick a length.");
  if (!hasText(intake.preferredDate)) errors.push("Pick a desired date.");
  if (!hasText(intake.preferredTime)) errors.push("Pick a desired time.");
  return { ok: errors.length === 0, errors };
};

/** The AI's structured suggestion (from the vision model). */
export type AiStyleQuote = {
  styleFamily?: string | null;
  /** Catalog service the model judged closest. Pricing comes from this. */
  suggestedServiceId?: string | null;
  sizeGuess?: string | null;
  lengthGuess?: string | null;
  estDurationHours?: number | null;
  rationale?: string | null;
};

export type ResolvedQuote = {
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  estDurationHours: number | null;
  /** True when the range is anchored to a real catalog service. */
  anchored: boolean;
};

const round5 = (n: number): number => Math.round(n / 5) * 5;

/**
 * Turn the AI suggestion into a ballpark price RANGE anchored to the
 * stylist's catalog. The model only chooses which service is closest; the
 * money comes from that service's `base_price` (± a band), so a tampered
 * or hallucinated price can never reach the client. When no active service
 * matches, price is left null (the stylist will quote on review).
 *
 * @param bandPct fractional band around the anchor price (default 0.15).
 */
export const resolveQuoteRange = (
  ai: AiStyleQuote | null | undefined,
  services: Service[] | null | undefined,
  bandPct = 0.15,
): ResolvedQuote => {
  const list = Array.isArray(services) ? services : [];
  const match = ai?.suggestedServiceId
    ? list.find(s => s.id === ai.suggestedServiceId && s.is_active !== false) || null
    : null;

  const aiHours = Number(ai?.estDurationHours);
  const estDurationHours = Number.isFinite(aiHours) && aiHours > 0
    ? aiHours
    : (match ? Number(match.duration_hours) || null : null);

  if (!match) {
    return {
      matchedServiceId: null,
      matchedServiceName: null,
      priceLow: null,
      priceHigh: null,
      estDurationHours,
      anchored: false,
    };
  }

  const base = Number(match.base_price) || 0;
  const band = Math.max(0, bandPct);
  return {
    matchedServiceId: match.id,
    matchedServiceName: match.name,
    priceLow: round5(base * (1 - band)),
    priceHigh: round5(base * (1 + band)),
    estDurationHours,
    anchored: true,
  };
};
