// Lifetime access (one-time $9.99 unlock) — pure Stripe Payment Link flow.
//
// Flow:
//   1. User taps "Unlock lifetime" → opens STRIPE_PAYMENT_LINK with
//      ?client_reference_id=<supabase user id> appended.
//   2. Stripe hosts checkout. On success, Stripe redirects to
//      https://braidbosspro.app/payment-success?session_id={CHECKOUT_SESSION_ID}.
//   3. /payment-success calls /api/verify-payment, which retrieves the
//      Checkout Session via the Stripe secret key, confirms
//      payment_status === "paid" and client_reference_id matches the
//      signed-in user, then writes profiles.lifetime_access = true via
//      the Supabase service role.
//   4. useLifetimeAccess() reads profiles.lifetime_access — that single
//      column is the source of truth everywhere.
//
// No Edge Functions. No webhook. The verify endpoint is a Next.js Route
// Handler in this same repo (app/api/verify-payment/route.ts).

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// PASTE YOUR STRIPE PAYMENT LINK HERE.
// Create it in the Stripe Dashboard → Payment links → New:
//   - Product: Lifetime Access ($9.99 one-time)
//   - After payment: Redirect to
//       https://braidbosspro.app/payment-success?session_id={CHECKOUT_SESSION_ID}
//   - Save and copy the resulting buy.stripe.com URL into the constant
//     below.
export const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/3cI3co3S24hUdms5hv97G00";

export const LIFETIME_PRICE_LABEL = "$9.99";

// ---- Monthly subscription ($14.99/mo, 14-day free trial) ------------
// The current offer for NEW users. Existing lifetime/founding holders
// are grandfathered and never see this.
export type SubscriptionPlan = "monthly" | "annual";
export const SUBSCRIPTION_PRICE_LABEL = "$14.99/mo";
export const SUBSCRIPTION_TRIAL_DAYS = 14;
export const ANNUAL_PRICE_LABEL = "$149/yr";
export const ANNUAL_SAVINGS_LABEL = "Save $30.88"; // vs $14.99 × 12 = $179.88

// Open a hosted Stripe Checkout for the subscription (monthly or
// annual). Creates the session server-side (binds it to the signed-in
// user) then sends the user to Stripe — via SFSafariViewController on
// the Capacitor iOS shell so they return into the app cleanly.
export const startSubscription = async (
  userId: string,
  plan: SubscriptionPlan = "monthly",
  email?: string | null,
): Promise<{ ok: boolean; error?: string }> => {
  if (typeof window === "undefined") return { ok: false, error: "no_window" };
  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, plan, email: email || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error || `checkout_failed_${res.status}` };
    }
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      try {
        const mod = await import("@capacitor/browser");
        await mod.Browser.open({ url: data.url });
        return { ok: true };
      } catch { /* fall through to navigation */ }
    }
    window.location.href = data.url;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network" };
  }
};

// Open the Stripe Billing Portal so the user can update their card or
// cancel. Returns an error string when there's no subscription yet or
// the portal isn't enabled in the Stripe dashboard.
export const openBillingPortal = async (
  userId: string,
): Promise<{ ok: boolean; error?: string }> => {
  if (typeof window === "undefined") return { ok: false, error: "no_window" };
  try {
    // Identify the caller server-side via their access token — the route
    // derives the user from the JWT, not from the body, so the userId arg
    // is only used as a local convenience here.
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return { ok: false, error: "not_signed_in" };
    const res = await fetch("/api/subscribe/portal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ userId }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error || `portal_failed_${res.status}` };
    }
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      try {
        const mod = await import("@capacitor/browser");
        await mod.Browser.open({ url: data.url });
        return { ok: true };
      } catch { /* fall through */ }
    }
    window.location.href = data.url;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network" };
  }
};

export const isPaymentLinkConfigured = (): boolean =>
  STRIPE_PAYMENT_LINK.startsWith("https://buy.stripe.com/") &&
  !STRIPE_PAYMENT_LINK.includes("REPLACE_ME");

// Append ?client_reference_id=<uid> so Stripe echoes the Supabase user
// id back in the Checkout Session — that's how the verify route binds
// the payment to the right account.
export const buildPaymentLink = (userId: string): string => {
  const sep = STRIPE_PAYMENT_LINK.includes("?") ? "&" : "?";
  return `${STRIPE_PAYMENT_LINK}${sep}client_reference_id=${encodeURIComponent(userId)}`;
};

// Open Stripe checkout. On the iOS Capacitor shell we use
// SFSafariViewController via @capacitor/browser so the user comes back
// into the app cleanly; on the web we just navigate.
export const openCheckout = async (userId: string): Promise<void> => {
  const url = buildPaymentLink(userId);
  if (typeof window === "undefined") return;
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    try {
      const mod = await import("@capacitor/browser");
      await mod.Browser.open({ url });
      return;
    } catch {
      // Fall through to plain navigation if the plugin isn't available.
    }
  }
  window.location.href = url;
};

// localStorage fast-path. Set by /payment-success the moment
// /api/verify-payment confirms the unlock, so the next hook mount —
// even before Supabase replies — already shows premium. The DB read
// still runs in the background and reconciles if the cache is wrong
// (e.g. a refund). Key includes the userId so the cache can never
// leak premium status across accounts on the same device.
const lifetimeCacheKey = (userId: string) => `bbp-lifetime:${userId}`;

export const cacheLifetimeAccess = (userId: string, unlocked: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    if (unlocked) window.localStorage.setItem(lifetimeCacheKey(userId), "1");
    else window.localStorage.removeItem(lifetimeCacheKey(userId));
  } catch { /* quota / private mode */ }
};

const readCachedLifetime = (userId: string): boolean => {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(lifetimeCacheKey(userId)) === "1"; }
  catch { return false; }
};

// Read profiles.lifetime_access for the signed-in user. Returns null
// while loading so callers can render a skeleton instead of flashing
// the paywall — except when the localStorage fast-path already says
// "yes," in which case we open as `true` immediately.
export const useLifetimeAccess = (userId: string | null): boolean | null => {
  const [unlocked, setUnlocked] = useState<boolean | null>(() => {
    if (!userId) return false;
    return readCachedLifetime(userId) ? true : null;
  });

  useEffect(() => {
    if (!userId) {
      setUnlocked(false);
      return;
    }
    let cancelled = false;
    const supabase = getSupabase();
    const refresh = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("lifetime_access")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const next = !!data?.lifetime_access;
      setUnlocked(next);
      cacheLifetimeAccess(userId, next);
    };
    void refresh();

    // Re-check whenever the app comes back to the foreground. WKWebView
    // (Capacitor) doesn't reliably fire `focus` after SFSafariViewController
    // dismisses, so listen to `visibilitychange` and Capacitor's App
    // `resume` event as well.
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

  return unlocked;
};

// Synchronous check used by non-hook code paths (e.g. a guard inside a
// callback). `profile` is the row from `profiles`.
export const isPremiumUnlocked = (profile: { lifetime_access?: boolean | null } | null | undefined): boolean =>
  !!profile?.lifetime_access;

// Founding-membership read for the Account page. Returns the boolean
// 'active' flag (true when either the newer profiles.founding_access
// or the legacy profiles.lifetime_access is set) along with the
// activation timestamp when available. Stays simple — caller renders
// a card; null means 'still loading.'
export type FoundingMembershipState = {
  active: boolean | null;          // any access — grandfathered OR live subscription
  grandfathered: boolean;          // legacy lifetime or founding (one-time, forever)
  subscriptionStatus: string | null;
  subscriptionActive: boolean;     // trialing / active / past_due
  subscriptionPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activatedAt: string | null;
};

// Statuses that count as a live subscription. Kept in sync with
// guest-limits.isSubscriptionActive.
const LIVE_SUB = new Set(["trialing", "active", "past_due"]);

export const useFoundingMembership = (
  userId: string | null,
): FoundingMembershipState => {
  const [state, setState] = useState<FoundingMembershipState>({
    active: null,
    grandfathered: false,
    subscriptionStatus: null,
    subscriptionActive: false,
    subscriptionPeriodEnd: null,
    cancelAtPeriodEnd: false,
    activatedAt: null,
  });

  useEffect(() => {
    if (!userId) {
      setState({
        active: false, grandfathered: false, subscriptionStatus: null,
        subscriptionActive: false, subscriptionPeriodEnd: null,
        cancelAtPeriodEnd: false, activatedAt: null,
      });
      return;
    }
    let cancelled = false;
    const supabase = getSupabase();
    const refresh = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("lifetime_access, founding_access, founding_paid_at, subscription_status, subscription_current_period_end, subscription_cancel_at_period_end")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const founding = !!data?.founding_access;
      const legacy = !!data?.lifetime_access;
      const grandfathered = founding || legacy;
      const subStatus = (data?.subscription_status as string | null) ?? null;
      const subActive = !!subStatus && LIVE_SUB.has(subStatus);
      setState({
        active: grandfathered || subActive,
        grandfathered,
        subscriptionStatus: subStatus,
        subscriptionActive: subActive,
        subscriptionPeriodEnd: data?.subscription_current_period_end ?? null,
        cancelAtPeriodEnd: !!data?.subscription_cancel_at_period_end,
        activatedAt: data?.founding_paid_at ?? null,
      });
    };
    void refresh();
    // Re-check when the tab comes back to the foreground so a
    // freshly-paid customer sees their card flip without a refresh.
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  return state;
};
