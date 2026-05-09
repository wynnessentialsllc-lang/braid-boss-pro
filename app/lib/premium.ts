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
export const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/REPLACE_ME";

export const LIFETIME_PRICE_LABEL = "$9.99";

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

// Read profiles.lifetime_access for the signed-in user. Returns null
// while loading so callers can render a skeleton instead of flashing
// the paywall.
export const useLifetimeAccess = (userId: string | null): boolean | null => {
  const [unlocked, setUnlocked] = useState<boolean | null>(
    userId ? null : false,
  );

  useEffect(() => {
    if (!userId) {
      setUnlocked(false);
      return;
    }
    let cancelled = false;
    const supabase = getSupabase();
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("lifetime_access")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      setUnlocked(!!data?.lifetime_access);
    })();

    // Re-check on focus so a successful checkout in another tab/in the
    // SFSafariViewController surfaces immediately when the user returns.
    const onFocus = () => {
      (async () => {
        const { data } = await supabase
          .from("profiles")
          .select("lifetime_access")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        setUnlocked(!!data?.lifetime_access);
      })();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  return unlocked;
};

// Synchronous check used by non-hook code paths (e.g. a guard inside a
// callback). `profile` is the row from `profiles`.
export const isPremiumUnlocked = (profile: { lifetime_access?: boolean | null } | null | undefined): boolean =>
  !!profile?.lifetime_access;
