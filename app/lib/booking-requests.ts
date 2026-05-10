// Booking approval queue — Phase B5a.
//
// The owner-facing approval workflow. Reads booking_requests, calls
// expire_stale_approvals() before every refresh so the queue reflects
// the current truth, and exposes typed actions: approve / decline /
// markPaid (the last one is the manual fallback while Stripe wiring
// is staged in Phase B5c).

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type ApprovalStatus =
  | "pending_review"
  | "approved_pending_deposit"
  | "confirmed"
  | "expired"
  | "declined";

export type BookingRequestRecord = {
  id: string;
  user_id: string;
  link_slug: string | null;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  service_id: string | null;
  service_name: string | null;
  service_price: number | null;
  service_duration_hours: number | null;
  service_duration: number | null;
  service_deposit_required: boolean | null;
  service_deposit_amount: number | null;
  preferred_date: string | null;
  preferred_time: string | null;
  notes: string | null;
  status: "pending" | "approved" | "declined" | "converted" | string;
  approval_status: ApprovalStatus;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  stripe_session_id: string | null;
  approval_expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  confirmed_at: string | null;
  decline_reason: string | null;
  appointment_id: string | null;
  created_at: string;
  updated_at: string;
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending_review:           "Awaiting review",
  approved_pending_deposit: "Approved · awaiting deposit",
  confirmed:                "Confirmed",
  expired:                  "Hold expired",
  declined:                 "Declined",
};

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, "neutral" | "gold" | "success" | "warning" | "danger"> = {
  pending_review:           "neutral",
  approved_pending_deposit: "gold",
  confirmed:                "success",
  expired:                  "warning",
  declined:                 "danger",
};

// Time-left for an approval hold, in seconds. Negative when past due.
export const approvalSecondsLeft = (req: BookingRequestRecord, now: number = Date.now()): number | null => {
  if (req.approval_status !== "approved_pending_deposit") return null;
  if (!req.approval_expires_at) return null;
  return Math.round((new Date(req.approval_expires_at).getTime() - now) / 1000);
};

export const formatCountdown = (secondsLeft: number): string => {
  if (secondsLeft <= 0) return "Expired";
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m left`;
  }
  return `${mins}:${String(secs).padStart(2, "0")} left`;
};

export const useBookingApprovalQueue = (userId: string | null): {
  requests: BookingRequestRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  approve: (id: string, depositAmount: number | null, expiresMinutes?: number) => Promise<BookingRequestRecord | null>;
  decline: (id: string, reason?: string) => Promise<BookingRequestRecord | null>;
  markPaid: (id: string, sessionId?: string) => Promise<BookingRequestRecord | null>;
} => {
  const [requests, setRequests] = useState<BookingRequestRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!userId) { setRequests([]); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    // Lazy expire: flip stale holds to `expired` before reading so the
    // queue reflects the current truth without pg_cron.
    try { await supabase.rpc("expire_stale_approvals"); } catch { /* lazy cleanup is best-effort */ }
    const { data, error: err } = await supabase
      .from("booking_requests")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setRequests((data || []) as BookingRequestRecord[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const approve: ReturnType<typeof useBookingApprovalQueue>["approve"] = async (id, depositAmount, expiresMinutes = 30) => {
    if (!userId) return null;
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("approve_booking_request", {
      request_id_in: id,
      deposit_amount_in: depositAmount,
      expires_minutes_in: expiresMinutes,
    });
    if (err) { setError(err.message); return null; }
    await refresh();
    return (data as BookingRequestRecord) || null;
  };

  const decline: ReturnType<typeof useBookingApprovalQueue>["decline"] = async (id, reason) => {
    if (!userId) return null;
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("decline_booking_request", {
      request_id_in: id,
      reason_in: reason || null,
    });
    if (err) { setError(err.message); return null; }
    await refresh();
    return (data as BookingRequestRecord) || null;
  };

  const markPaid: ReturnType<typeof useBookingApprovalQueue>["markPaid"] = async (id, sessionId) => {
    if (!userId) return null;
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("mark_booking_deposit_paid", {
      request_id_in: id,
      stripe_session_id_in: sessionId || null,
    });
    if (err) { setError(err.message); return null; }
    await refresh();
    return (data as BookingRequestRecord) || null;
  };

  return { requests, loading, error, refresh, approve, decline, markPaid };
};
