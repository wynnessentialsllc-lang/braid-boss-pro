// Subscription plan constants — the single source of truth.
//
// Deliberately dependency-free. app/lib/premium.ts (which owns the
// checkout helpers) imports React hooks and the Supabase browser client,
// so it can't be pulled into a server component like app/pricing/page.tsx.
// These values are needed on both sides of the boundary, so they live
// here and premium.ts re-exports them under its existing names.
//
// TRIAL_DAYS is authoritative: app/api/subscribe/route.ts sends it to
// Stripe as subscription_data[trial_period_days]. Changing it here
// changes what new subscribers actually get. Existing subscribers are
// unaffected — their trial_end is already fixed on the Stripe
// subscription and is never recomputed from this value.
//
// Marketing prose still spells the number out in English ("30-day free
// trial") in ~30 files. Those are hand-written sentences rather than
// templated strings; if this number changes again, grep for "30-day"
// and "30 days" alongside it.

/** Free-trial length in days, sent to Stripe as trial_period_days. */
export const TRIAL_DAYS = 30;

/** Monthly plan price in USD. */
export const MONTHLY_PRICE = 14.99;

/** Annual plan price in USD. */
export const ANNUAL_PRICE = 149;
