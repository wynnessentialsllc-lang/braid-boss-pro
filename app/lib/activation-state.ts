"use client";

// Client-side activation state — the same five-field shape the
// onboarding drip already computes server-side (see sweepUser in
// app/api/notifications/run-rules/route.ts and process_activation_nudges
// in supabase/migrations), fetched fresh here so the dashboard "finish
// setting up" checklist can render it without waiting on the push/email
// pipeline. All three surfaces read ACTIVATION_STEPS in
// ./notification-rules for step copy, so they can never disagree about
// what's left.
//
// Also fires activation_step_completed the first time a step flips from
// not-done to done, so the funnel is measurable instead of guessed at.
// The very first read for a browser never fires anything — with nothing
// to compare against, "already done" and "just finished" are
// indistinguishable, so it only seeds the baseline.

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { trackEvent } from "./track";
import { ACTIVATION_STEPS, type ActivationState } from "./notification-rules";

export type { ActivationState };

const SEEN_DONE_KEY_PREFIX = "bbp-activation-done-";

const readSeenDone = (userId: string): Set<string> | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SEEN_DONE_KEY_PREFIX + userId);
    if (raw == null) return null;
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return null;
  }
};

const writeSeenDone = (userId: string, keys: Set<string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_DONE_KEY_PREFIX + userId, JSON.stringify(Array.from(keys)));
  } catch {
    /* private mode — tracking is best-effort */
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A HEAD/count request that comes back with a PostgREST error still
// resolves (never rejects), with `count: null` and `error` set — the
// exact same shape a genuine "zero rows" result produces. Trusting
// `count` alone can't tell "nothing's set up yet" apart from "the
// request failed," and getting that wrong means falsely telling a
// stylist to finish a step she already finished. So every leg is
// checked for `.error` before any of it is trusted; one failed leg
// fails the whole read (rather than trusting the other three and
// guessing on the fourth) and retries with backoff before giving up.
const MAX_ATTEMPTS = 3;

export const useActivationState = (
  userId: string | null,
): { state: ActivationState | null; loading: boolean } => {
  const [state, setState] = useState<ActivationState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const supabase = getSupabase();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const [profileRes, servicesRes, availabilityRes, bookingLinkRes] = await Promise.all([
            supabase
              .from("profiles")
              .select("business_name, full_name, subscription_started_at, stripe_connect_charges_enabled")
              .eq("id", userId)
              .maybeSingle(),
            supabase.from("services").select("id", { count: "exact", head: true }).eq("user_id", userId),
            supabase
              .from("availability_rules")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("is_open", true),
            supabase
              .from("booking_links")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("active", true),
          ]);
          if (cancelled) return;

          const failed = [profileRes, servicesRes, availabilityRes, bookingLinkRes].find((r) => r.error);
          if (failed) throw failed.error;

          const p = (profileRes.data as any) || null;
          const next: ActivationState = {
            signupIso: p?.subscription_started_at ?? null,
            businessNameSet: !!(p?.business_name || p?.full_name),
            servicesCount: servicesRes.count ?? 0,
            hasOpenAvailability: (availabilityRes.count ?? 0) > 0,
            bookingLinkActive: (bookingLinkRes.count ?? 0) > 0,
            stripeChargesEnabled: p?.stripe_connect_charges_enabled === true,
          };
          setState(next);

          const nowDone = new Set(
            ACTIVATION_STEPS.filter((step) => step.done(next)).map((step) => step.key),
          );
          const prevDone = readSeenDone(userId);
          if (prevDone) {
            for (const key of nowDone) {
              if (!prevDone.has(key)) {
                trackEvent("activation_step_completed", { category: "activation", metadata: { step: key } });
              }
            }
          }
          writeSeenDone(userId, nowDone);
          break;
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) {
            if (!cancelled) {
              console.warn("useActivationState: giving up after retries", err);
            }
            break;
          }
          await sleep(800 * attempt);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { state, loading };
};
