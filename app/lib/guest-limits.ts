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
  "Unlock Braid Boss Pro once for lifetime access and every future upgrade. No subscriptions.";
export const UPGRADE_BADGE = "Lifetime Access · $9.99";

export type AuthMode = "loading" | "guest" | "authed";

export const isGuestUser = (mode: AuthMode | undefined | null): boolean =>
  mode !== "authed";

export const hasLifetimeAccess = (
  profile: { lifetime_access?: boolean | null } | null | undefined,
): boolean => !!profile?.lifetime_access;

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
// user. Returns false while loading so the UI conservatively assumes
// "not premium" (we'd rather show the upgrade card briefly than flash
// premium state).
export const usePremiumStatus = (
  userId: string | null,
): { premium: boolean; loading: boolean } => {
  const [premium, setPremium] = useState(false);
  const [loading, setLoading] = useState(!!userId);

  useEffect(() => {
    if (!userId) {
      setPremium(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { getSupabase } = await import("./supabase");
        const supabase = getSupabase();
        const { data } = await supabase
          .from("profiles")
          .select("lifetime_access")
          .eq("id", userId)
          .maybeSingle();
        if (cancelled) return;
        setPremium(!!data?.lifetime_access);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const onFocus = () => {
      (async () => {
        const { getSupabase } = await import("./supabase");
        const supabase = getSupabase();
        const { data } = await supabase
          .from("profiles")
          .select("lifetime_access")
          .eq("id", userId)
          .maybeSingle();
        if (cancelled) return;
        setPremium(!!data?.lifetime_access);
      })();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  return { premium, loading };
};
