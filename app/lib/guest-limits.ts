// Guest mode limits + premium unlock plumbing for Braid Boss Pro.
//
// Guest workspace is intentionally constrained so the salon owner
// graduates to a real account (and the $9.99 lifetime unlock) before
// their data outgrows the local-only sandbox. Limits are enforced at
// the action layer (creating a client, saving a quote, etc.) — read
// access stays unrestricted so a guest can still browse what they've
// already created.
//
// Tone: every user-facing string here is calm and premium. No
// "blocked" / "denied" language. The intent is to feel like a velvet
// rope, not a paywall.

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

// localStorage flag set by the future paywall integration. Until
// payments are wired, this stays unset for everyone — but the helper
// already reads through it so the eventual switch is one line of
// code (in whatever post-purchase callback we wire up).
const LIFETIME_FLAG_KEY = "bbp-lifetime-unlock";

export const LIFETIME_PRICE = 9.99;
export const LIFETIME_PRICE_LABEL = "Lifetime Access · $9.99";
export const LIFETIME_TAGLINE = "One payment. No subscriptions.";

export type GuestFeature =
  | "calculator"     // saving a pricing quote
  | "clients"        // creating a client record
  | "appointments"   // creating an appointment
  | "money"          // creating an income/expense entry
  | "export"         // export-all-data (always premium)
  | "reminders"      // reminder settings (always premium)
  | "communicationLog" // communication log (always premium)
  | "analytics"      // advanced analytics (always premium)
  | "sync"           // cloud sync / backup / restore (always premium)
  ;

// Numeric quotas. Features marked `null` are gated outright in
// guest mode (no quota — the action is unavailable until unlock).
export const GUEST_LIMITS: Record<GuestFeature, number | null> = {
  calculator: 5,
  clients: 2,
  appointments: 3,
  money: 3,
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

// Lifetime access lookup. Reads localStorage on the client; returns
// false on the server / during SSR. Designed to be called from React
// render — it never throws.
export const hasLifetimeAccess = (): boolean => {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(LIFETIME_FLAG_KEY) === "1";
  } catch {
    return false;
  }
};

export const grantLifetimeAccess = (): void => {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(LIFETIME_FLAG_KEY, "1"); } catch { /* quota */ }
};

// Test/QA only — strip any local flag.
export const revokeLifetimeAccess = (): void => {
  if (!isBrowser()) return;
  try { window.localStorage.removeItem(LIFETIME_FLAG_KEY); } catch { /* ignore */ }
};

// Quota check. `count` is whatever the caller has already created
// for that feature (e.g. `store.clients.length` for "clients").
//
// - Authed users: never limited.
// - Lifetime-unlocked users: never limited.
// - Guests with a feature in GUEST_LIMITS that's `null`: always
//   limited (the feature is fully premium).
// - Guests with a numeric quota: limited once `count >= quota`.
export const hasReachedGuestLimit = (
  feature: GuestFeature,
  count: number,
  mode: string | null | undefined,
): boolean => {
  if (mode === "authed") return false;
  if (hasLifetimeAccess()) return false;
  if (!isGuestUser(mode)) return false;
  const quota = GUEST_LIMITS[feature];
  if (quota === null) return true;
  return count >= quota;
};

// Premium-only features — always gated for guests, regardless of
// count. Equivalent to `hasReachedGuestLimit(feature, 0, mode)` but
// reads more clearly at the call site.
export const isGuestBlocked = (
  feature: GuestFeature,
  mode: string | null | undefined,
): boolean => {
  if (mode === "authed") return false;
  if (hasLifetimeAccess()) return false;
  if (!isGuestUser(mode)) return false;
  return GUEST_LIMITS[feature] === null;
};

// Soft progress label — "3 of 5 used" when there's a quota, else
// returns null. Used to render an unobtrusive hint above the
// upgrade card on the dashboard / settings.
export const guestRemainingLabel = (
  feature: GuestFeature,
  count: number,
  mode: string | null | undefined,
): string | null => {
  if (mode !== "guest") return null;
  if (hasLifetimeAccess()) return null;
  const quota = GUEST_LIMITS[feature];
  if (quota === null) return null;
  const remaining = Math.max(0, quota - count);
  if (remaining === 0) return `${quota} of ${quota} guest entries used`;
  return `${count} of ${quota} guest entries used`;
};
