// Hard daily ceilings for the PUBLIC booking-page endpoints.
//
// style-consult, booking-concierge and booking-color-photo are anon and
// keyed by slug: no session, open to anyone holding a booking link. The
// first two spend the platform's Anthropic budget on every call; the
// third writes up to ~7 MB into storage. All three are costs the
// platform absorbs directly.
//
// The only thing in front of them today is app/lib/rate-limit.ts, whose
// own header is candid: "this is a speed bump, not a guarantee. On
// serverless the counter lives in a single instance's memory, so it
// resets on cold starts and isn't shared across concurrent instances."
// So the per-minute gate resets whenever a lambda recycles, is enforced
// per-instance rather than globally, and stops caring the moment the
// minute rolls over. A patient caller with one booking link can spend
// without bound.
//
// This is the shared store that comment asks for: a per-day counter in
// Postgres, incremented by a conditional UPDATE so two requests at the
// boundary can't both win.
//
// ---- Why not bill the stylist ---------------------------------------
//
// See app/lib/ai-credits.ts: metering these against her prepaid wallet
// would let any visitor drain the credits her appointment reminders
// depend on. The platform eats the cost and caps it instead.
//
// Two ceilings, because they fail differently:
//   * per slug — contains one abused booking link to its own budget
//                without taking the feature away from everyone else.
//   * global   — the circuit breaker for an attack spread across many
//                slugs, which a per-slug cap alone would never see.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily ceilings per feature. Sized off real usage: the busiest booking
 * link on the platform sees single-digit consultations a day, so a slug
 * cap in the tens is well clear of any genuine client while cutting an
 * abuser off after a few dollars. The global caps assume the current
 * roster; raise them as stylists are added.
 *
 * Override either number per feature without a deploy by setting
 * PUBLIC_AI_CAP_<FEATURE>_SLUG / _GLOBAL (dashes become underscores,
 * e.g. PUBLIC_AI_CAP_STYLE_CONSULT_SLUG=60).
 */
export const PUBLIC_AI_CAPS = {
  // Opus vision, ~$0.05 a call — the most expensive thing an anonymous
  // visitor can trigger anywhere in the app.
  "style-consult": { slug: 25, global: 400 },
  // Sonnet chat, ~$0.005 a turn. A real booking conversation is a
  // handful of turns; the cap allows a whole day of them per slug.
  "booking-concierge": { slug: 120, global: 3000 },
  // No model call — a storage write. Capped for the same reason: it is
  // an anonymous, unauthenticated way to spend the platform's money.
  "booking-color-photo": { slug: 40, global: 600 },
} as const;

export type PublicAiFeature = keyof typeof PUBLIC_AI_CAPS;

export type PublicAiClaim =
  | { ok: true }
  | { ok: false; reason: "slug_daily_cap" | "global_daily_cap"; cap: number };

const envCap = (feature: PublicAiFeature, which: "SLUG" | "GLOBAL"): number | null => {
  const key = `PUBLIC_AI_CAP_${feature.toUpperCase().replace(/-/g, "_")}_${which}`;
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export const capsFor = (feature: PublicAiFeature): { slug: number; global: number } => ({
  slug: envCap(feature, "SLUG") ?? PUBLIC_AI_CAPS[feature].slug,
  global: envCap(feature, "GLOBAL") ?? PUBLIC_AI_CAPS[feature].global,
});

/**
 * Take a slot before doing the expensive thing.
 *
 * Claim up front rather than counting afterwards: a burst of concurrent
 * requests would otherwise each read a count below the cap and blow
 * through it together. The atomic increment in claim_public_ai_call is
 * the only gate that holds under concurrency. Release it with
 * releasePublicAiCall if the work then fails.
 *
 * Fails OPEN. If the counter itself is unreachable, the booking page
 * keeps working — an outage in the guard must not become an outage in
 * the product. The failure is logged so a broken cap is visible rather
 * than silent.
 */
export const claimPublicAiCall = async (
  admin: SupabaseClient,
  feature: PublicAiFeature,
  slug: string,
): Promise<PublicAiClaim> => {
  const caps = capsFor(feature);
  try {
    const { data, error } = await admin.rpc("claim_public_ai_call", {
      feature_in: feature,
      slug_in: slug,
      slug_cap_in: caps.slug,
      global_cap_in: caps.global,
    });
    if (error) throw error;
    const res = (data || {}) as any;
    if (res.ok === true) return { ok: true };
    if (res.reason === "slug_daily_cap" || res.reason === "global_daily_cap") {
      return { ok: false, reason: res.reason, cap: Number(res.cap) || caps.slug };
    }
    return { ok: true };
  } catch (e: any) {
    console.error(`[public-ai-cap] claim failed for ${feature}:`, e?.message || e);
    return { ok: true };
  }
};

/** Hand the slot back when the work didn't happen. Best-effort. */
export const releasePublicAiCall = async (
  admin: SupabaseClient,
  feature: PublicAiFeature,
  slug: string,
): Promise<void> => {
  try {
    await admin.rpc("refund_public_ai_call", { feature_in: feature, slug_in: slug });
  } catch (e: any) {
    console.error(`[public-ai-cap] release failed for ${feature}:`, e?.message || e);
  }
};

/**
 * Seconds until the counters reset (UTC midnight), for the retry-after
 * header. Clamped to at least a minute so a request landing a hair
 * before the rollover doesn't advertise "retry immediately".
 */
export const secondsUntilCapReset = (now: Date = new Date()): number => {
  const next = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  );
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
};

/**
 * Client-facing copy. Deliberately vague about which ceiling was hit —
 * a caller probing the limits shouldn't learn whether they've exhausted
 * one stylist's budget or the whole platform's.
 */
export const capReachedMessage = (feature: PublicAiFeature): string =>
  feature === "booking-concierge"
    ? "The booking assistant has hit its limit for today. You can still browse services and book below."
    : feature === "style-consult"
      ? "Style consultations have hit their limit for today. Please send your request to the stylist instead — she'll still see it."
      : "Photo uploads have hit their limit for today. Please describe the color you want in the notes instead.";
