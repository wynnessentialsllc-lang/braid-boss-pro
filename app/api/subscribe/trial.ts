// Pure trial-decision logic for app/api/subscribe/route.ts, split into
// its own module rather than exported from route.ts: Next.js type-checks
// route.ts files against a closed set of allowed exports (GET/POST/
// config/runtime/etc.), so any other export — like a helper function —
// fails `tsc`. Keeping it here also makes it trivially unit-testable
// without touching Supabase, Stripe, or Next's request/response types.

export type TrialParam = { kind: "trial_end"; value: number } | { kind: "none" };

// A trial_end must sit far enough in the future that Stripe won't reject
// it as "too close to now" (Stripe's own floor is 48h, but we only ever
// hand it whatever's left of a 30-day local trial, so a small buffer is
// enough — this exists to catch a local trial that's down to its last
// minute, not to model Stripe's real minimum).
const TRIAL_END_BUFFER_SECONDS = 60;

/**
 * Decide what (if anything) to send Stripe for subscription_data's trial.
 *
 * Only a caller who is currently inside their LOCAL trial — status
 * 'trialing' with a current_period_end still in the future — gets a
 * Stripe trial_end carrying the remainder of that time. Every other case
 * (no row, any other status, a null/unparseable/past period end, or a
 * period end too close to "now" to safely send to Stripe) resolves to
 * "none": no trial_period_days, no trial_end, Stripe bills immediately.
 */
export function computeTrialParam(
  subscriptionStatus: string | null | undefined,
  currentPeriodEndIso: string | null | undefined,
  nowMs: number,
): TrialParam {
  if (subscriptionStatus !== "trialing") return { kind: "none" };
  if (!currentPeriodEndIso) return { kind: "none" };

  const endMs = Date.parse(currentPeriodEndIso);
  if (!Number.isFinite(endMs)) return { kind: "none" };
  if (endMs <= nowMs) return { kind: "none" };

  const endUnix = Math.floor(endMs / 1000);
  const nowUnix = nowMs / 1000;
  if (endUnix <= nowUnix + TRIAL_END_BUFFER_SECONDS) return { kind: "none" };

  return { kind: "trial_end", value: endUnix };
}
