// Stripe Connect — owner-side hook.
//
// Reads the cached connect state from profiles and exposes onboard /
// refresh / sync actions. All Stripe calls go through the server-side
// /api/stripe-connect/* routes so the publishable key isn't required
// and the access token never leaves the device.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase";

export type ConnectStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted"
  | "disabled";

export type StripeConnectProfile = {
  stripe_connect_account_id: string | null;
  stripe_connect_status: ConnectStatus;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  stripe_connect_details_submitted: boolean;
  stripe_connect_updated_at: string | null;
};

const EMPTY: StripeConnectProfile = {
  stripe_connect_account_id: null,
  stripe_connect_status: "not_connected",
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
  stripe_connect_details_submitted: false,
  stripe_connect_updated_at: null,
};

export const STATUS_LABEL: Record<ConnectStatus, string> = {
  not_connected: "Not connected",
  onboarding:    "Continue onboarding",
  active:        "Active",
  restricted:    "Action required",
  disabled:      "Disconnected",
};

export const STATUS_TONE: Record<ConnectStatus, "neutral" | "gold" | "success" | "warning" | "danger"> = {
  not_connected: "neutral",
  onboarding:    "gold",
  active:        "success",
  restricted:    "warning",
  disabled:      "danger",
};

// A fresh idempotency token for one cash-out "intent." Stripe collapses
// any payout requests carrying the same Idempotency-Key into a single
// payout, so a double-tap (or a network retry of the same intent) can
// never move money twice. We rotate the token after each successful
// payout so the *next* cash-out is treated as a distinct operation.
const makeIdempotencyKey = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `bbp_instant_${crypto.randomUUID()}`;
    }
  } catch { /* fall through */ }
  return `bbp_instant_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const getAccessToken = async (): Promise<string | null> => {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
};

// Result of an instant cash-out attempt — surfaced so the Payments page
// can show a confirmation ("$X on its way to your card").
export type InstantPayoutResult = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: string | null;
};

export const useStripeConnect = (userId: string | null): {
  profile: StripeConnectProfile;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  syncFromStripe: () => Promise<void>;
  startOnboarding: () => Promise<string | null>;
  // Instant Payouts (subscriber-gated). `instantAvailable` is the
  // dollar amount Stripe says can be swept to the debit card right now;
  // null while it hasn't been probed yet.
  instantAvailable: number | null;
  payoutBusy: boolean;
  payoutError: string | null;
  refreshInstantBalance: () => Promise<void>;
  cashOutNow: (amount?: number) => Promise<InstantPayoutResult | null>;
} => {
  const [profile, setProfile] = useState<StripeConnectProfile>(EMPTY);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);
  const [instantAvailable, setInstantAvailable] = useState<number | null>(null);
  const [payoutBusy, setPayoutBusy] = useState<boolean>(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  // Stable across re-renders so every tap of the same intent reuses one
  // idempotency key; rotated only after a payout actually succeeds.
  const idempotencyKeyRef = useRef<string>(makeIdempotencyKey());

  const refresh = useCallback(async () => {
    if (!userId) { setProfile(EMPTY); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("profiles")
      .select(
        "stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_updated_at",
      )
      .eq("id", userId)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setProfile({
      stripe_connect_account_id: data?.stripe_connect_account_id ?? null,
      stripe_connect_status: (data?.stripe_connect_status as ConnectStatus) || "not_connected",
      stripe_connect_charges_enabled: !!data?.stripe_connect_charges_enabled,
      stripe_connect_payouts_enabled: !!data?.stripe_connect_payouts_enabled,
      stripe_connect_details_submitted: !!data?.stripe_connect_details_submitted,
      stripe_connect_updated_at: data?.stripe_connect_updated_at ?? null,
    });
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
  }, [refresh]);

  const syncFromStripe = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) { setError("Sign in required."); return; }
    setError(null);
    try {
      const res = await fetch("/api/stripe-connect/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `status_${res.status}`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Couldn't refresh from Stripe.");
    }
  }, [refresh]);

  const startOnboarding = useCallback(async (): Promise<string | null> => {
    const token = await getAccessToken();
    if (!token) { setError("Sign in required."); return null; }
    setError(null);
    try {
      const res = await fetch("/api/stripe-connect/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) throw new Error(body?.error || `onboard_${res.status}`);
      return String(body.url);
    } catch (e: any) {
      setError(e?.message || "Couldn't start Stripe onboarding.");
      return null;
    }
  }, []);

  // Probe the connected account's instant-available balance. Quiet on
  // the gate/connect errors (subscriber-only, not yet onboarded) —
  // those just mean "nothing to show," not a failure to report.
  const refreshInstantBalance = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) { setInstantAvailable(null); return; }
    try {
      const res = await fetch("/api/stripe-connect/payout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: token, probe: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setInstantAvailable(null); return; }
      setInstantAvailable(typeof data?.instant_available === "number" ? data.instant_available : 0);
    } catch {
      setInstantAvailable(null);
    }
  }, []);

  const cashOutNow = useCallback(async (amount?: number): Promise<InstantPayoutResult | null> => {
    const token = await getAccessToken();
    if (!token) { setPayoutError("Sign in required."); return null; }
    setPayoutBusy(true);
    setPayoutError(null);
    try {
      const res = await fetch("/api/stripe-connect/payout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          access_token: token,
          amount,
          idempotency_key: idempotencyKeyRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `payout_${res.status}`);
      // The cash-out went through — rotate the key so the next one is a
      // distinct Stripe operation, not a dedup of this one.
      idempotencyKeyRef.current = makeIdempotencyKey();
      // Server returns the remaining balance after the sweep.
      if (typeof data?.instant_available === "number") setInstantAvailable(data.instant_available);
      return (data.payout as InstantPayoutResult) ?? null;
    } catch (e: any) {
      setPayoutError(e?.message || "Couldn't complete the cash-out.");
      return null;
    } finally {
      setPayoutBusy(false);
    }
  }, []);

  return {
    profile, loading, error, refresh, syncFromStripe, startOnboarding,
    instantAvailable, payoutBusy, payoutError, refreshInstantBalance, cashOutNow,
  };
};
