// Pro / lifetime-access status, server-truth.
//
// This module centralises:
//   - reading profiles.is_pro_user from Supabase
//   - a React hook that keeps the boolean fresh across auth changes,
//     window focus, and explicit "Restore access" taps
//   - the "open Stripe checkout" client action
//   - the verify-checkout-session call from /unlocked
//
// Frontend gates MUST call into this module rather than reading a
// localStorage flag — otherwise any user could flip the boolean in
// the browser. The DB value is authoritative; column-level grants on
// `profiles` make is_pro_user writable only by the service role
// (i.e. the Stripe webhook + the verify endpoint).

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "./supabase";

export type ProStatus = {
  isPro: boolean;
  isLoading: boolean;
  upgradedAt: string | null;
};

const PRO_STATUS_DEFAULT: ProStatus = { isPro: false, isLoading: true, upgradedAt: null };

/** Fetch fresh pro status for the given user from Supabase. */
export const fetchProStatus = async (userId: string | null): Promise<ProStatus> => {
  if (!userId) return { isPro: false, isLoading: false, upgradedAt: null };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("is_pro_user, upgraded_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[bbp] fetchProStatus failed", error.message);
      return { isPro: false, isLoading: false, upgradedAt: null };
    }
    return {
      isPro: !!data?.is_pro_user,
      isLoading: false,
      upgradedAt: data?.upgraded_at ?? null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bbp] fetchProStatus threw", err);
    return { isPro: false, isLoading: false, upgradedAt: null };
  }
};

/**
 * React hook tied to the signed-in user. Loads pro status when the
 * userId becomes known, refreshes on window focus, and exposes a
 * `refresh` method the Restore access button can call.
 */
export const useProStatus = (userId: string | null): ProStatus & { refresh: () => Promise<void> } => {
  const [status, setStatus] = useState<ProStatus>(PRO_STATUS_DEFAULT);

  const load = useCallback(async () => {
    setStatus((prev) => ({ ...prev, isLoading: true }));
    const next = await fetchProStatus(userId);
    setStatus(next);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setStatus({ isPro: false, isLoading: false, upgradedAt: null });
      return;
    }
    void load();
  }, [userId, load]);

  // Refresh when the tab regains focus — covers the "user paid in
  // another tab and came back" path without polling.
  useEffect(() => {
    if (!userId) return;
    const onFocus = () => { void load(); };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }
  }, [userId, load]);

  return { ...status, refresh: load };
};

/**
 * Server-side Stripe Checkout session creation. Calls the
 * create-checkout-session Edge Function which mints a session bound
 * to the signed-in user and returns the redirect URL.
 *
 * Returns the URL to redirect to; throws on error.
 */
export const createCheckoutSession = async (): Promise<{ url: string; alreadyPro: boolean }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: {} });
  if (error) {
    // Surface the function's own JSON error body. supabase-js puts
    // the underlying Response on `error.context` for FunctionsHttpError;
    // we want the function's `error`/`detail` field, not the generic
    // "Edge Function returned a non-2xx status code" wrapper.
    let msg = error.message || "checkout session failed";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body: any = await ctx.clone().json();
        if (body) {
          const parts: string[] = [];
          if (body.error) parts.push(body.error);
          if (body.detail) parts.push(body.detail);
          if (body.code) parts.push(`(${body.code})`);
          if (parts.length > 0) msg = parts.join(" — ");
        }
      } catch { /* leave msg as-is */ }
    }
    throw new Error(msg);
  }
  if ((data as any)?.already_pro) {
    return { url: "", alreadyPro: true };
  }
  const url = (data as any)?.url;
  if (typeof url !== "string" || !url) throw new Error("checkout returned no URL");
  return { url, alreadyPro: false };
};

/**
 * Defense-in-depth verification used by /unlocked. Asks Stripe
 * directly whether the session is paid and backfills profiles if
 * the webhook hasn't yet (or didn't reach the project).
 */
export const verifyCheckoutSession = async (sessionId: string): Promise<{ paid: boolean }> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("verify-checkout-session", {
    body: { session_id: sessionId },
  });
  if (error) {
    return { paid: false };
  }
  return { paid: !!(data as any)?.paid };
};
