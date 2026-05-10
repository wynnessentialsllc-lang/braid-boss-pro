// Booking policies — single-row-per-user table.
//
// Calm, optional fields. Empty strings save as null so the UI can
// cleanly distinguish "not set" from "explicitly empty". The
// useBookingPolicy hook returns one record (or null while loading).

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type AvailabilitySensitivity = "conservative" | "balanced" | "aggressive";

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
  // Phase B3 — biases the public slot engine. Conservative spreads
  // bookings out (60-min slot interval); aggressive packs them
  // tighter (15-min); balanced is the 30-min default.
  availability_sensitivity: AvailabilitySensitivity;
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
  availability_sensitivity: "balanced",
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
      availability_sensitivity: (["conservative", "balanced", "aggressive"] as const).includes(
        (draft.availability_sensitivity || "balanced") as any,
      )
        ? draft.availability_sensitivity || "balanced"
        : "balanced",
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
