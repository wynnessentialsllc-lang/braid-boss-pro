// Guest-mode usage limits and gating helpers.
//
// We use a single source of truth — `lifetime_access` on profiles — to
// decide whether a user is "premium." Anyone without it (signed in or
// not) gets the same limits. The naming preserves the user-requested
// helper names (`isGuestUser`, `hasReachedGuestLimit`).
//
// Guest counts (clients, appointments, transactions, quotes) come from
// the live in-app arrays so refresh / reopen behaves correctly without
// needing an extra counter to maintain.

import { useEffect, useState } from "react";

export type GatedFeature =
  | "clients"
  | "appointments"
  | "transactions"
  | "calculations"
  | "export"
  | "reminders"
  | "communicationLog"
  | "analytics"
  | "sync"
  | "restore";

export const GUEST_LIMITS: Record<
  Extract<GatedFeature, "clients" | "appointments" | "transactions" | "calculations">,
  number
> = {
  clients: 2,
  appointments: 3,
  transactions: 3,
  calculations: 5,
};

export const FEATURE_LABEL: Record<GatedFeature, string> = {
  clients: "Clients",
  appointments: "Appointments",
  transactions: "Money entries",
  calculations: "Saved pricing quotes",
  export: "Export",
  reminders: "Reminders",
  communicationLog: "Communication log",
  analytics: "Advanced analytics",
  sync: "Cloud sync",
  restore: "Restore",
};

// Calm, premium copy — no aggressive lock language.
export const UPGRADE_HEADLINE = "Your guest workspace has reached its limit.";
export const UPGRADE_BODY =
  "Start your 30-day free trial of Braid Boss Pro — every feature unlocked, just $14.99/month after. Cancel anytime.";
export const UPGRADE_BADGE = "30-day free trial · then $14.99/mo";

// Subscription statuses that count as "live" access. trialing + active
// are obvious; past_due keeps access during Stripe's retry/grace window
// so a temporary card hiccup doesn't lock a paying stylist out.
const LIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due"]);
export const isSubscriptionActive = (status: string | null | undefined): boolean =>
  !!status && LIVE_SUBSCRIPTION_STATUSES.has(status);

// A signup gets a 30-day trial with no card on file: subscription_status
// is written as 'trialing' with subscription_current_period_end set to
// the trial cutoff. If that date has passed and the status is STILL
// 'trialing' (i.e. they never converted to a paid Stripe subscription,
// which would have moved the status to 'active'), the trial has lapsed.
//
// Only 'trialing' is subject to this cutoff — an 'active' subscriber's
// period_end is just their next billing-cycle rollover, not an access
// cutoff, so a past period_end on any other status never counts as
// "expired" here.
//
// An unparseable/missing period end is NOT treated as expired — that's
// the safe default (never punish someone before they even have a period
// end recorded).
export const isTrialExpired = (
  status: string | null | undefined,
  currentPeriodEnd: string | null | undefined,
): boolean => {
  if (status !== "trialing" || !currentPeriodEnd) return false;
  const endMs = new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(endMs)) return false;
  return endMs < Date.now();
};

export type AuthMode = "loading" | "guest" | "authed";

export const isGuestUser = (mode: AuthMode | undefined | null): boolean =>
  mode !== "authed";

export const hasLifetimeAccess = (
  profile: { lifetime_access?: boolean | null } | null | undefined,
): boolean => !!profile?.lifetime_access;

// Overall access read, folding lifetime/founding grants and subscription
// status (including the trial-expiry cutoff above) into one shape a
// caller can act on: `premium` gates feature access, `trialExpired`
// specifically flags the "signed up, trial lapsed, never converted"
// state so callers can show different copy / block record creation
// even though `premium` alone already covers the access decision.
export type AccessState = { premium: boolean; trialExpired: boolean };

export type AccessProfile = {
  lifetime_access?: boolean | null;
  founding_access?: boolean | null;
  subscription_status?: string | null;
  subscription_current_period_end?: string | null;
};

export const computeAccessState = (
  profile: AccessProfile | null | undefined,
): AccessState => {
  const trialExpired = isTrialExpired(
    profile?.subscription_status,
    profile?.subscription_current_period_end,
  );
  const premium =
    hasLifetimeAccess(profile) ||
    !!profile?.founding_access ||
    (isSubscriptionActive(profile?.subscription_status) && !trialExpired);
  return { premium, trialExpired };
};

// Generic limit check. `count` is the live entity count (clients.length etc.).
// Returns true if creating one MORE would exceed the limit and the user
// is not premium.
export const hasReachedGuestLimit = (
  feature: GatedFeature,
  count: number,
  premium: boolean,
): boolean => {
  if (premium) return false;
  switch (feature) {
    case "clients":
    case "appointments":
    case "transactions":
    case "calculations":
      return count >= GUEST_LIMITS[feature];
    case "export":
    case "reminders":
    case "communicationLog":
    case "analytics":
    case "sync":
    case "restore":
      // These are flat-disabled for non-premium — `count` is ignored.
      return true;
  }
};

// Convenience hook: read profiles.lifetime_access for the signed-in
// user. Reads the localStorage fast-path written by /payment-success
// so a fresh purchase shows premium instantly without waiting for the
// Supabase round-trip. The DB read still runs and reconciles.
//
// Listens to both window `focus` and document `visibilitychange`.
// WKWebView (Capacitor) doesn't fire `focus` after
// SFSafariViewController dismisses, so the redundancy is intentional —
// `visibilitychange` is what reliably fires when the app foregrounds.
const lifetimeCacheKey = (userId: string) => `bbp-lifetime:${userId}`;
const readCachedLifetime = (userId: string): boolean => {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(lifetimeCacheKey(userId)) === "1"; }
  catch { return false; }
};
const writeCachedLifetime = (userId: string, unlocked: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    if (unlocked) window.localStorage.setItem(lifetimeCacheKey(userId), "1");
    else window.localStorage.removeItem(lifetimeCacheKey(userId));
  } catch { /* quota / private mode */ }
};

export const usePremiumStatus = (
  userId: string | null,
): { premium: boolean; loading: boolean; trialExpired: boolean } => {
  const [premium, setPremium] = useState<boolean>(() =>
    userId ? readCachedLifetime(userId) : false,
  );
  // No cached fast-path for this one — until the DB read resolves we
  // default to "not expired" (the safe default: never punish before we
  // know).
  const [trialExpired, setTrialExpired] = useState<boolean>(false);
  const [loading, setLoading] = useState(!!userId);

  useEffect(() => {
    if (!userId) {
      setPremium(false);
      setTrialExpired(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPremium(readCachedLifetime(userId));

    const refresh = async () => {
      try {
        const { getSupabase } = await import("./supabase");
        const supabase = getSupabase();
        // Access = grandfathered lifetime/founding OR a live subscription
        // that hasn't run past its trial cutoff.
        const { data } = await supabase
          .from("profiles")
          .select("lifetime_access, founding_access, subscription_status, subscription_current_period_end")
          .eq("id", userId)
          .maybeSingle();
        if (cancelled) return;
        const { premium: next, trialExpired: expired } = computeAccessState(data);
        setPremium(next);
        setTrialExpired(expired);
        writeCachedLifetime(userId, next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();

    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  return { premium, loading, trialExpired };
};
