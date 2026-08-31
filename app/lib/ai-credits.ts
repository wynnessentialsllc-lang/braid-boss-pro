// Metering for the AI features — server-side only.
//
// Every AI route calls Anthropic on the platform's key, so each one is
// a real cost the platform absorbs. A Sonnet call at these token
// budgets runs a couple of cents; a text costs about a fifth of that.
// Billing them against the same prepaid wallet turns an uncapped
// expense into a metered one, and gives the credit balance a second
// reason to exist besides SMS.
//
// ---- Why only the stylist-authenticated routes -----------------------
//
// style-consult, booking-concierge and booking-color-photo run on the
// PUBLIC booking page: no session, keyed by slug, open to anyone with
// the link. Billing those against the stylist's balance would let any
// visitor spend her credits. The concierge alone allows 60 requests a
// minute per slug, so a bored visitor could drain a 250-credit pack in
// well under five minutes -- and because the same balance pays for
// texts, the first casualty would be her appointment reminders.
// Denial-of-wallet dressed as a feature.
//
// Those three stay unmetered here. Capping them needs a mechanism that
// doesn't spend someone else's money: a per-slug daily ceiling, or
// folding concierge access into a subscription tier.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Credits per AI action, by route. Two credits (~$0.08 at pack pricing)
 * against roughly $0.018 of Sonnet spend leaves the same kind of margin
 * the SMS packs carry. Tune here — nothing else hard-codes a cost.
 */
export const AI_CREDIT_COSTS = {
  "business-coach": 2,
  "rebooking-ai": 2,
  "social-ai": 2,
  // Photo analysis runs on Opus rather than Sonnet — roughly double the
  // spend per call, so it carries its own price.
  "social-ai-photo": 3,
} as const;

export type AiFeature = keyof typeof AI_CREDIT_COSTS;

export type AiChargeResult =
  | { ok: true; charged: number; balance: number }
  | { ok: false; reason: "insufficient_credits"; needed: number; balance: number }
  | { ok: false; reason: "error" };

/**
 * Reserve credits before calling Anthropic. Charging up front (rather
 * than after) means a burst of concurrent requests can't each see a
 * sufficient balance and collectively overspend it — the atomic
 * decrement in consume_credits is the only gate that holds under
 * concurrency. Refund with refundAiCredits if the model call fails.
 */
export const chargeAiCredits = async (
  admin: SupabaseClient,
  userId: string,
  feature: AiFeature,
): Promise<AiChargeResult> => {
  const cost = AI_CREDIT_COSTS[feature];
  try {
    const { data, error } = await admin.rpc("consume_credits", {
      user_id_in: userId,
      amount_in: cost,
      reason_in: "ai",
      note_in: feature,
    });
    if (error) throw error;
    const res = (data || {}) as any;
    if (res.ok === true) {
      return { ok: true, charged: Number(res.charged) || cost, balance: Number(res.balance) || 0 };
    }
    if (res.reason === "insufficient_credits") {
      return {
        ok: false,
        reason: "insufficient_credits",
        needed: Number(res.needed) || cost,
        balance: Number(res.balance) || 0,
      };
    }
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
};

/**
 * Hand credits back when the model call fails. Best-effort: a failed
 * refund must never turn a model error into a request error, but it is
 * logged so a systematic leak is visible.
 */
export const refundAiCredits = async (
  admin: SupabaseClient,
  userId: string,
  feature: AiFeature,
  amount: number,
): Promise<void> => {
  try {
    await admin.rpc("refund_credits", {
      user_id_in: userId,
      amount_in: Math.max(1, Math.floor(amount) || 1),
      note_in: `${feature}_failed`,
    });
  } catch (e: any) {
    console.error(`[ai-credits] refund failed for ${feature}:`, e?.message || e);
  }
};

/** Client-facing copy when the balance can't cover an AI action. */
export const outOfCreditsMessage = (needed: number, balance: number): string =>
  `This uses ${needed} credit${needed === 1 ? "" : "s"} and you have ${balance}. `
  + `Top up under Settings → SMS credits.`;
