// Guest mode limits + premium unlock plumbing for Braid Boss Pro.
//
// The source of truth for "is this user Pro?" is now Supabase
// (`profiles.is_pro_user`). All gate functions in this module accept
// an `isPro` boolean that the calling component reads via
// useProStatus() in app/lib/pro-status.ts. Frontend-only flags are
// no longer authoritative — they cannot be: column-level GRANTs on
// `profiles` make is_pro_user writable only by the Stripe webhook
// running as service_role.
//
// Limits apply to anyone who is NOT Pro — guests and authed-free
// users alike. The product hook is the $9.99 lifetime unlock.
//
// Tone: every user-facing string here is calm and premium. No
// "blocked" / "denied" language. Velvet rope, not a paywall.

export const LIFETIME_PRICE = 9.99;
export const LIFETIME_PRICE_LABEL = "Lifetime Access · $9.99";
export const LIFETIME_TAGLINE = "One payment. No subscriptions.";

export type GuestFeature =
  | "calculator"     // saving a pricing quote
  | "clients"        // creating a client record
  | "appointments"   // creating an appointment
  | "money"          // creating an income/expense entry
  | "savedQuotes"    // viewing the saved-quotes list past the cap
  | "export"         // export-all-data (always premium)
  | "reminders"      // reminder settings (always premium)
  | "communicationLog" // communication log (always premium)
  | "analytics"      // advanced analytics (always premium)
  | "sync"           // cloud sync / backup / restore (always premium)
  ;

// Numeric quotas. Features marked `null` are gated outright (no
// quota — premium-only).
export const GUEST_LIMITS: Record<GuestFeature, number | null> = {
  calculator: 5,
  clients: 10,
  appointments: 3,
  money: 5,
  savedQuotes: 5,        // matches calculator quota; saved quotes is a 1:1 view
  export: null,
  reminders: null,
  communicationLog: null,
  analytics: null,
  sync: null,
};

export const GUEST_LIMIT_COPY: Record<GuestFeature, { headline: string; body: string }> = {
  calculator: {
    headline: "Your guest workspace has reached its quote limit",
    body: "Unlock once to save unlimited quotes, sync them across devices, and convert any of them into an appointment in a tap.",
  },
  clients: {
    headline: "Your guest client list is full",
    body: "Unlock to keep adding clients without limit, with private photo libraries, retention insights, and cross-device sync.",
  },
  appointments: {
    headline: "Your guest schedule has reached its limit",
    body: "Unlock to book unlimited appointments, send confirmations and reminders, and keep your calendar synced across every device.",
  },
  money: {
    headline: "Your guest ledger has reached its limit",
    body: "Unlock to track unlimited income and expenses, generate receipts and invoices, and see your full revenue trends.",
  },
  savedQuotes: {
    headline: "Your guest quote vault is full",
    body: "Unlock to keep an unlimited quote library, version history, and one-tap conversion into appointments.",
  },
  export: {
    headline: "Data export is part of the lifetime studio",
    body: "Unlock once to download a JSON archive of everything you've created — clients, appointments, receipts, communication, anytime.",
  },
  reminders: {
    headline: "Reminders are part of the lifetime studio",
    body: "Unlock once to send confirmations, 48h / 24h / same-day nudges, deposit reminders, and rebooking outreach to your clients.",
  },
  communicationLog: {
    headline: "Your communication log is part of the lifetime studio",
    body: "Unlock once to keep a private trail of every message sent, copied, or shared per client — and reach back to it anytime.",
  },
  analytics: {
    headline: "Advanced analytics are part of the lifetime studio",
    body: "Unlock once for retention insights, top-client trends, rebooking opportunities, productivity, and revenue charts.",
  },
  sync: {
    headline: "Cloud backup is part of the lifetime studio",
    body: "Unlock once to back your studio up to the cloud, work across iPhone and laptop seamlessly, and never lose a client list to a wiped device.",
  },
};

export const isGuestUser = (mode: string | undefined | null): boolean =>
  mode === "guest";

/**
 * Quota check.
 *
 * - Pro users: never limited.
 * - Everyone else (guest + authed-free) with a numeric quota:
 *   limited once `count >= quota`.
 * - Everyone else with a `null` quota: always limited (premium-only).
 */
export const hasReachedGuestLimit = (
  feature: GuestFeature,
  count: number,
  isPro: boolean,
): boolean => {
  if (isPro) return false;
  const quota = GUEST_LIMITS[feature];
  if (quota === null) return true;
  return count >= quota;
};

/**
 * Premium-only features — gated regardless of count when not Pro.
 * Equivalent to `hasReachedGuestLimit(feature, 0, isPro)` but reads
 * more clearly at the call site.
 */
export const isFeatureLocked = (
  feature: GuestFeature,
  isPro: boolean,
): boolean => {
  if (isPro) return false;
  return GUEST_LIMITS[feature] === null;
};

/**
 * "3 of 10 used" hint for the dashboard / settings. Returns null
 * for pro users and for premium-only features.
 */
export const remainingQuotaLabel = (
  feature: GuestFeature,
  count: number,
  isPro: boolean,
): string | null => {
  if (isPro) return null;
  const quota = GUEST_LIMITS[feature];
  if (quota === null) return null;
  return `${Math.min(count, quota)} of ${quota} used`;
};
