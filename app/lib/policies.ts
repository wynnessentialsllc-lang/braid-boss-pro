// Booking policies — single-row-per-user table.
//
// Calm, optional fields. Empty strings save as null so the UI can
// cleanly distinguish "not set" from "explicitly empty". The
// useBookingPolicy hook returns one record (or null while loading).

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type BookingPolicy = {
  user_id: string;
  deposit_policy: string | null;
  cancellation_window_hours: number | null;
  cancellation_policy: string | null;
  late_arrival_policy: string | null;
  no_show_policy: string | null;
  hair_prep_instructions: string | null;
  guests_policy: string | null;
  reschedule_policy: string | null;
  custom_notes: string | null;
  // No-show protection — charge a fee to the card saved at deposit time.
  no_show_fee_enabled: boolean | null;
  no_show_fee_type: "flat" | "percent" | null;
  no_show_fee_value: number | null;
  created_at?: string;
  updated_at?: string;
};

export type BookingPolicyInput = Omit<BookingPolicy, "user_id" | "created_at" | "updated_at">;

export const EMPTY_POLICY: BookingPolicyInput = {
  deposit_policy: null,
  cancellation_window_hours: null,
  cancellation_policy: null,
  late_arrival_policy: null,
  no_show_policy: null,
  hair_prep_instructions: null,
  guests_policy: null,
  reschedule_policy: null,
  custom_notes: null,
  no_show_fee_enabled: false,
  no_show_fee_type: "flat",
  no_show_fee_value: null,
};

// Resolve the no-show fee amount (in dollars) for a given service price,
// per the stylist's policy. Returns 0 when protection is off / unset.
export const computeNoShowFee = (
  policy: Pick<BookingPolicy, "no_show_fee_enabled" | "no_show_fee_type" | "no_show_fee_value"> | null | undefined,
  servicePrice: number,
): number => {
  if (!policy || !policy.no_show_fee_enabled) return 0;
  const value = Number(policy.no_show_fee_value) || 0;
  if (value <= 0) return 0;
  if (policy.no_show_fee_type === "percent") {
    const price = Number(servicePrice) || 0;
    return Math.max(0, Math.round(price * (value / 100) * 100) / 100);
  }
  return value; // flat
};

// Public booking-page read of a stylist's no-show fee config (anon).
export type PublicNoShowFee = {
  enabled: boolean;
  type: "flat" | "percent";
  value: number | null;
};

export const fetchPublicNoShowFee = async (
  userId: string,
): Promise<PublicNoShowFee | null> => {
  if (!userId) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_get_no_show_fee", { user_id_in: userId });
    if (error || !data || (data as any).ok !== true) return null;
    const v = data as any;
    return {
      enabled: v.enabled === true,
      type: v.type === "percent" ? "percent" : "flat",
      value: v.value == null ? null : Number(v.value),
    };
  } catch {
    return null;
  }
};

// Stamp the client's no-show-fee consent on their booking request (anon).
export const recordNoShowConsent = async (requestId: string): Promise<boolean> => {
  if (!requestId) return false;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_record_no_show_consent", { request_id_in: requestId });
    return !error && !!data && (data as any).ok === true;
  } catch {
    return false;
  }
};

// Stamp the client's separate marketing/promotional SMS consent on their
// booking request (anon). Mirrors recordNoShowConsent: called only when the
// optional marketing checkbox was ticked. The transactional SMS opt-in is
// stamped server-side by the booking RPC; this records the distinct A2P /
// CTIA-required marketing consent (boolean + timestamp + IP/UA) as proof.
export const recordSmsMarketingConsent = async (requestId: string): Promise<boolean> => {
  if (!requestId) return false;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_record_sms_marketing_consent", { request_id_in: requestId });
    return !error && !!data && (data as any).ok === true;
  } catch {
    return false;
  }
};

// Calm presets the UI surfaces as quick-fill chips. The user can
// always override with their own copy.
export const POLICY_PRESETS = {
  deposit_policy: [
    "A non-refundable deposit is required to confirm every booking.",
    "Deposits are applied to the final total at checkout.",
  ],
  cancellation_policy: [
    "Cancellations within 24 hours forfeit the deposit.",
    "Please cancel at least 48 hours in advance to receive a credit toward a future booking.",
  ],
  late_arrival_policy: [
    "A 15-minute grace period applies. Arrivals beyond that may be rescheduled.",
    "Late arrivals may shorten service time at the stylist's discretion.",
  ],
  no_show_policy: [
    "No-shows forfeit the full deposit and may be asked to prepay future bookings in full.",
  ],
  hair_prep_instructions: [
    "Please arrive with hair freshly washed, blow-dried, and detangled.",
    "Bring any preferred edge control, oils, or beads you'd like used.",
  ],
  guests_policy: [
    "Out of respect for the studio space, please come solo. Children must be accompanied by a caregiver in the lobby.",
  ],
  reschedule_policy: [
    "One complimentary reschedule per booking with at least 24-hour notice.",
  ],
} as const;

const round = (n: number | string | null | undefined): number | null => {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  return Number.isFinite(v) && v >= 0 ? v : null;
};

const text = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
};

export const useBookingPolicy = (userId: string | null): {
  policy: BookingPolicy | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (draft: BookingPolicyInput) => Promise<BookingPolicy | null>;
} => {
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setPolicy(null); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("booking_policies")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setPolicy((data as BookingPolicy | null) || null);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const save: ReturnType<typeof useBookingPolicy>["save"] = async (draft) => {
    if (!userId) return null;
    const payload = {
      user_id: userId,
      deposit_policy: text(draft.deposit_policy),
      cancellation_window_hours: round(draft.cancellation_window_hours),
      cancellation_policy: text(draft.cancellation_policy),
      late_arrival_policy: text(draft.late_arrival_policy),
      no_show_policy: text(draft.no_show_policy),
      hair_prep_instructions: text(draft.hair_prep_instructions),
      guests_policy: text(draft.guests_policy),
      reschedule_policy: text(draft.reschedule_policy),
      custom_notes: text(draft.custom_notes),
      no_show_fee_enabled: !!draft.no_show_fee_enabled,
      no_show_fee_type: draft.no_show_fee_type === "percent" ? "percent" : "flat",
      no_show_fee_value:
        draft.no_show_fee_value == null || !Number.isFinite(Number(draft.no_show_fee_value))
          ? null
          : Number(draft.no_show_fee_value),
    };
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("booking_policies")
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .maybeSingle();
    if (err || !data) {
      setError(err?.message || "Could not save the policy.");
      return null;
    }
    setError(null);
    setPolicy(data as BookingPolicy);
    return data as BookingPolicy;
  };

  return { policy, loading, error, refresh, save };
};
