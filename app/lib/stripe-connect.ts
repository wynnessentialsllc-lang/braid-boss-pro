// Stripe Connect — owner-side hook.
//
// Reads the cached connect state from profiles and exposes onboard /
// refresh / sync actions. All Stripe calls go through the server-side
// /api/stripe-connect/* routes so the publishable key isn't required
// and the access token never leaves the device.

import { useCallback, useEffect, useState } from "react";
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

const getAccessToken = async (): Promise<string | null> => {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
};

export const useStripeConnect = (userId: string | null): {
  profile: StripeConnectProfile;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  syncFromStripe: () => Promise<void>;
  startOnboarding: () => Promise<string | null>;
} => {
  const [profile, setProfile] = useState<StripeConnectProfile>(EMPTY);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

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

  return { profile, loading, error, refresh, syncFromStripe, startOnboarding };
};
