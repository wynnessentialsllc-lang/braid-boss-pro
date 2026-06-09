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
  | "awaiting_deposit"
  | "deposit_paid_pending_approval"
  | "approved"
  | "confirmed"
  | "denied"
  | "declined"
  | "cancelled"
  | "expired";

export type PaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

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
  // Where the booking came from (instagram / tiktok / google / ...),
  // detected from UTM/referrer at submit time. Null when undetected;
  // the approval flow then falls back to "direct_link".
  referral_source: string | null;
  approval_status: ApprovalStatus;
  deposit_amount: number | null;
  deposit_paid: boolean;
  deposit_paid_at: string | null;
  deposit_required: boolean;
  // Set when the client paid the FULL ticket up front (BNPL/card via
  // /api/booking-full/checkout) instead of just the deposit.
  paid_in_full: boolean;
  amount_paid: number | null;
  payment_status: PaymentStatus;
  stripe_session_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  approval_expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  denied_at: string | null;
  expired_at: string | null;
  confirmed_at: string | null;
  decline_reason: string | null;
  denied_reason: string | null;
  appointment_id: string | null;
  // Per-variation snapshot, populated by public_submit_booking_request
  // when the client picked a variation. Null for legacy rows + for
  // services without variations. Survives services edits — the
  // booking is locked to the price the client saw at submit time.
  selected_variation_id: string | null;
  selected_variation_name: string | null;
  selected_variation_price: number | null;
  selected_variation_duration_hours: number | null;
  selected_variation_deposit_amount: number | null;
  // Optional paid add-ons picked at submit time. Each entry is a
  // snapshot of the services.extras row at the moment of booking,
  // so editing the catalog later never alters in-flight bookings.
  selected_addons: Array<{
    id: string;
    name: string;
    price: number;
    duration_hours_delta: number;
    include_in_deposit: boolean;
  }> | null;
  // Style customization + portal (Client Portal update). Present on
  // every booking_requests row at runtime (migrations applied to
  // prod); typed here so the confirmation payload + stylist card
  // can read them.
  selected_hair_color: string | null;
  selected_curl_pattern: string | null;
  client_style_notes: string | null;
  customization_summary: Record<string, any> | null;
  // Who the appointment is for. Null/empty = the client themselves;
  // a name means a dependent (e.g. a child the client booked for).
  booked_for_name: string | null;
  booked_for_note: string | null;
  portal_token: string | null;
  // Client self-service: cancel + one-time reschedule.
  cancel_token: string | null;
  reschedule_token: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  reschedule_count: number;
  rescheduled_from: string | null;
  rescheduled_at: string | null;
  reschedule_token_used_at: string | null;
  deposit_forfeited: boolean;
  deposit_rollover: boolean;
  last_reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending_review:                "Awaiting review",
  approved_pending_deposit:      "Approved · awaiting deposit",
  awaiting_deposit:              "Awaiting deposit",
  deposit_paid_pending_approval: "Deposit paid · needs approval",
  // `approved` is the post-confirmation terminal state in the RPC;
  // surface it to clients as "Confirmed" so the badge matches the
  // outbound email + the customer's mental model.
  approved:                      "Confirmed",
  confirmed:                     "Confirmed",
  denied:                        "Denied",
  declined:                      "Declined",
  cancelled:                     "Cancelled",
  expired:                       "Hold expired",
};

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, "neutral" | "gold" | "success" | "warning" | "danger"> = {
  pending_review:                "neutral",
  approved_pending_deposit:      "gold",
  awaiting_deposit:              "warning",
  deposit_paid_pending_approval: "gold",
  approved:                      "success",
  confirmed:                     "success",
  denied:                        "danger",
  declined:                      "danger",
  cancelled:                     "neutral",
  expired:                       "warning",
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
  deny: (id: string, reason?: string) => Promise<BookingRequestRecord | null>;
  markPaid: (id: string, sessionId?: string) => Promise<BookingRequestRecord | null>;
  confirmApproval: (id: string, appointmentId: string) => Promise<BookingRequestRecord | null>;
  generateAndSendContracts: (id: string, appointmentId?: string | null) => Promise<number>;
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

    const row = (data as BookingRequestRecord) || null;

    // Generate contracts NOW so the signing link(s) can ride embedded
    // in the approval email — no separate contract_signing email.
    // generate_booking_contracts is idempotent (dedupes on
    // request+template), so a re-approve never duplicates.
    let contractLinks: Array<{ title: string; url: string }> = [];
    if (row?.id) {
      try {
        await supabase.rpc("generate_booking_contracts", {
          booking_request_id_in: row.id,
          appointment_id_in: row.appointment_id || null,
        });
        contractLinks = await fetchContractLinks(row.id);
      } catch { /* contracts best-effort; never block approval */ }
    }

    if (row?.client_email) {
      try {
        const { data: studio } = await supabase
          .rpc("public_get_studio_name", { user_id_in: userId });
        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const paymentUrl = `${baseUrl}/booking/success?request_id=${row.id}`;
        await supabase.rpc("queue_notification", {
          user_id_in: userId,
          channel_in: "email",
          notification_type_in: "appointment_approved",
          body_in: "Your booking was approved.",
          subject_in: `${(typeof studio === "string" && studio.trim()) || "Your stylist"} approved your booking`,
          recipient_email_in: row.client_email,
          recipient_name_in: row.client_name || null,
          payload_in: {
            clientName: row.client_name || "there",
            studioName: (typeof studio === "string" && studio.trim()) ? studio.trim() : "your stylist",
            serviceName: (row as any).service_name_snapshot || (row as any).service_name || null,
            preferredDate: (row as any).preferred_date || null,
            preferredTime: (row as any).preferred_time || null,
            depositAmount: depositAmount || (row as any).deposit_amount || null,
            paymentUrl,
            expiresMinutes,
            // Embedded "Review and sign agreement" section. Empty
            // array → renderer omits it (no contract / already signed).
            contracts: contractLinks,
          },
          dedupe_key_in: `appointment_approved:${row.id}`,
          booking_request_id_in: row.id,
        });
      } catch {
        // Approval already succeeded — email failure shouldn't surface.
      }
    }

    await refresh();
    return row;
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

  const deny: ReturnType<typeof useBookingApprovalQueue>["deny"] = async (id, reason) => {
    if (!userId) return null;
    const supabase = getSupabase();
    // Denial must also make the money correct: if a deposit was
    // collected it has to be refunded (or explicitly flagged for a
    // manual refund). That requires Stripe, so it goes through the
    // server route, which issues the refund and then calls
    // deny_booking_request with the resulting disposition.
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) { setError("Sign in required."); return null; }
    try {
      const res = await fetch("/api/booking-deposit/refund", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: id, reason: reason || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || `deny_${res.status}`); return null; }
      if (body?.disposition === "refund_failed_manual") {
        setError(
          "Request denied, but the deposit refund failed — issue it manually in Stripe.",
        );
      }
      await refresh();
      return (body?.request as BookingRequestRecord) || null;
    } catch (e: any) {
      setError(e?.message || "Couldn't deny the request.");
      return null;
    }
  };

  const confirmApproval: ReturnType<typeof useBookingApprovalQueue>["confirmApproval"] = async (id, appointmentId) => {
    if (!userId) return null;
    const supabase = getSupabase();
    const { data, error: err } = await supabase.rpc("confirm_booking_request_approval", {
      request_id_in: id,
      appointment_id_in: appointmentId,
    });
    if (err) { setError(err.message); return null; }
    const row = (data as BookingRequestRecord) || null;

    // Resolve the client recipient. The booking_request sometimes
    // carries no client_email (it lives on the converted appointment
    // instead); without this the confirmation AND the contract link
    // never reach the client.
    let resolvedEmail = (row?.client_email || "").trim();
    let resolvedName = (row?.client_name || "").trim();
    if ((!resolvedEmail || !resolvedName) && appointmentId) {
      try {
        const { data: appt } = await supabase
          .from("appointments")
          .select("client_email, client_name")
          .eq("id", appointmentId)
          .maybeSingle();
        if (!resolvedEmail) resolvedEmail = String((appt as any)?.client_email || "").trim();
        if (!resolvedName) resolvedName = String((appt as any)?.client_name || "").trim();
      } catch { /* fallback best-effort */ }
    }

    // Generate contracts NOW (before the confirmation email) so the
    // signing link(s) can ride along inside it. generate_booking_
    // contracts is idempotent (dedupes on request+template), so a
    // double-tapped approve never creates duplicates. Variations
    // inherit the parent service's template (service_id is the
    // parent). The separate contract_signing email still goes out
    // below as a backup.
    let contractLinks: Array<{ title: string; url: string }> = [];
    try {
      await supabase.rpc("generate_booking_contracts", {
        booking_request_id_in: id,
        appointment_id_in: appointmentId || null,
      });
      const base = typeof window !== "undefined" ? window.location.origin : "https://braidbosspro.app";
      const { data: bcs } = await supabase
        .from("booking_contracts")
        .select("id, title, public_token, status")
        .eq("booking_request_id", id)
        .in("status", ["sent", "pending", "pending_signature", "viewed"])
        .order("created_at", { ascending: true });
      contractLinks = ((bcs as any[]) || [])
        .filter(c => c?.public_token)
        .map(c => ({
          title: String(c.title || "Appointment agreement"),
          url: `${base}/sign/contract/${c.public_token}`,
        }));
    } catch { /* contracts are best-effort; never block approval */ }

    // Customer-facing confirmation. Distinct from the earlier
    // "appointment_approved" (pay-deposit) email — this fires once
    // after the deposit has landed AND the stylist has tapped
    // Approve & schedule, so the client gets a clean "you're
    // officially booked" message. Dedupe key is per-request id, so
    // re-tapping approve (the RPC is idempotent) won't double-send.
    if (resolvedEmail) {
      try {
        const { data: studio } = await supabase
          .rpc("public_get_studio_name", { user_id_in: userId });
        const studioName = (typeof studio === "string" && studio.trim()) ? studio.trim() : "your stylist";
        // service_price is the submit RPC's resolved total — it already
        // includes the variation price AND every picked add-on.
        // selected_variation_price is a raw per-variation snapshot that
        // EXCLUDES add-ons, so it must not win here or the confirmation
        // email understates the balance whenever an add-on was chosen.
        const servicePrice = Number(
          row.service_price ?? (row as any).selected_variation_price ?? 0,
        );
        const depositPaid = Number(row.deposit_amount ?? 0);
        const remainingBalance = servicePrice > 0
          ? Math.max(0, servicePrice - depositPaid)
          : null;
        await supabase.rpc("queue_notification", {
          user_id_in: userId,
          channel_in: "email",
          notification_type_in: "appointment_confirmed",
          body_in: "Your appointment has been approved and confirmed.",
          subject_in: "Your appointment is confirmed — Braid Boss Pro",
          recipient_email_in: resolvedEmail,
          recipient_name_in: resolvedName || null,
          payload_in: {
            clientName: resolvedName || "there",
            studioName,
            serviceName: row.selected_variation_name || row.service_name || null,
            preferredDate: row.preferred_date || null,
            preferredTime: row.preferred_time || null,
            depositPaid: depositPaid > 0 ? depositPaid : null,
            remainingBalance,
            // Style customization + portal link (renderer skips any
            // that are absent — fully backward compatible).
            selectedHairColor: row.selected_hair_color
              || (row.customization_summary as any)?.custom_hair_color || null,
            selectedCurlPattern: row.selected_curl_pattern
              || (row.customization_summary as any)?.custom_curl_pattern || null,
            portalUrl: row.portal_token && typeof window !== "undefined"
              ? `${window.location.origin}/client/appointment/${row.portal_token}`
              : null,
            // Contract signing link(s) — empty array → renderer skips
            // the section entirely (no contract required).
            contracts: contractLinks,
          },
          // Date in the key so a re-approval after a reschedule
          // sends a fresh confirmation for the NEW time instead of
          // being deduped against the original approval's email.
          dedupe_key_in: `appointment_confirmed:${row.id}:${row.preferred_date || "nodate"}:${row.preferred_time || "notime"}`,
          booking_request_id_in: row.id,
          appointment_id_in: appointmentId,
        });
      } catch {
        // Confirmation already succeeded — email failure shouldn't surface.
      }
    }

    // Last-minute reminder. The pg_cron reminder enqueue only picks
    // up appointments in the [now+18h, now+30h] window, so a booking
    // that's confirmed inside the 18-hour blackout would otherwise
    // get no reminder at all. Mirror what the cron would have sent
    // immediately so the client still gets a heads-up email with
    // the cancel + reschedule action links. Dedupe key matches the
    // cron's so a later cron tick can't double-send.
    if (row?.client_email && row.preferred_date && row.preferred_time && row.cancel_token) {
      try {
        const startMs = new Date(`${row.preferred_date}T${row.preferred_time}:00Z`).getTime();
        const hoursOut = (startMs - Date.now()) / 3_600_000;
        if (hoursOut > 0 && hoursOut < 18) {
          const { data: studio2 } = await supabase
            .rpc("public_get_studio_name", { user_id_in: userId });
          const studioName2 = (typeof studio2 === "string" && studio2.trim()) ? studio2.trim() : "your stylist";
          const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://braidbosspro.app";
          await supabase.rpc("queue_notification", {
            user_id_in: userId,
            channel_in: "email",
            notification_type_in: "appointment_reminder",
            body_in: "Reminder: your appointment is coming up soon.",
            subject_in: `Reminder: your appointment with ${studioName2}`,
            recipient_email_in: row.client_email,
            recipient_name_in: row.client_name || null,
            payload_in: {
              clientName: row.client_name || "there",
              studioName: studioName2,
              serviceName: row.selected_variation_name || row.service_name || null,
              preferredDate: row.preferred_date,
              preferredTime: row.preferred_time,
              cancelUrl: `${baseUrl}/booking-action/${row.cancel_token}/cancel`,
              rescheduleUrl: row.reschedule_count === 0 && row.reschedule_token
                ? `${baseUrl}/booking-action/${row.reschedule_token}/reschedule`
                : null,
              rescheduleUsed: row.reschedule_count >= 1,
            },
            dedupe_key_in: `appointment_reminder:${row.id}:${row.preferred_date}`,
            booking_request_id_in: row.id,
            appointment_id_in: appointmentId,
          });
          // Stamp last_reminder_sent_at so the cron's 12-hour cooldown
          // skips this row even if it later falls into the window.
          await supabase
            .from("booking_requests")
            .update({ last_reminder_sent_at: new Date().toISOString() })
            .eq("id", row.id);
        }
      } catch {
        // Reminder is best-effort; never block the approval path.
      }
    }

    try {
      await generateAndSendContracts(id, appointmentId);
    } catch {
      // Keep appointment approval non-blocking; status UI can retry.
    }
    await refresh();
    return row;
  };

  // Generate-only. The contract signing link now rides EMBEDDED in
  // the approval / confirmation email (see approve + confirmApproval),
  // so we no longer fire a separate contract_signing email on
  // approval — that created redundant back-to-back emails. An
  // unsigned-contract reminder is sent ~48h before the appointment
  // by the enqueue_due_contract_reminders pg_cron job instead.
  const generateAndSendContracts: ReturnType<typeof useBookingApprovalQueue>["generateAndSendContracts"] = async (id, appointmentId = null) => {
    if (!userId) return 0;
    const supabase = getSupabase();
    const { error: genErr } = await supabase.rpc("generate_booking_contracts", {
      booking_request_id_in: id,
      appointment_id_in: appointmentId || null,
    });
    if (genErr) { setError(genErr.message); return 0; }
    return 0;
  };

  // Pull the unsigned contract signing link(s) for a request so they
  // can be embedded in the approval / confirmation email.
  const fetchContractLinks = async (
    id: string,
  ): Promise<Array<{ title: string; url: string }>> => {
    try {
      const supabase = getSupabase();
      const base = typeof window !== "undefined" ? window.location.origin : "https://braidbosspro.app";
      const { data: bcs } = await supabase
        .from("booking_contracts")
        .select("id, title, public_token, status")
        .eq("booking_request_id", id)
        .in("status", ["sent", "pending", "pending_signature", "viewed"])
        .order("created_at", { ascending: true });
      return ((bcs as any[]) || [])
        .filter(c => c?.public_token)
        .map(c => ({
          title: String(c.title || "Appointment agreement"),
          url: `${base}/sign/contract/${c.public_token}`,
        }));
    } catch {
      return [];
    }
  };


  return { requests, loading, error, refresh, approve, decline, deny, markPaid, confirmApproval, generateAndSendContracts };
};
