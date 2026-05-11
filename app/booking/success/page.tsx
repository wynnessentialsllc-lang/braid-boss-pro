"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "../../lib/supabase";
import { formatAppointmentDate } from "../../lib/utils/formatAppointmentDate";

// Public confirmation page after Stripe Checkout. Polls the new
// `public_get_booking_request_status` RPC every few seconds until it
// sees `deposit_paid_pending_approval` (the webhook fires server-side
// roughly within a second of payment, but we don't want to depend on
// that being instant). Falls back to a "still processing" message
// after ~30s rather than spinning forever.

const C = {
  espresso: "#2A1810", coffee: "#4A2C1A", cream: "#FAF5EC",
  ivory: "#F5EBD9", paper: "#FFFBF2", gold: "#C9A961", goldDeep: "#A8893F",
  muted: "#8B7355", hairline: "rgba(74, 44, 26, 0.12)",
  success: "#5C7C4A",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

type Status = {
  approval_status: string;
  payment_status: string;
  deposit_paid: boolean;
  deposit_amount: number | null;
  service_name: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
};

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 30_000;

const fmtPrice = (n: number | null): string =>
  n == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function BookingSuccessPage() {
  return (
    <Suspense fallback={<SuccessShell body="Confirming your deposit…" />}>
      <BookingSuccessInner />
    </Suspense>
  );
}

function BookingSuccessInner() {
  const params = useSearchParams();
  const requestId = useMemo(() => (params?.get("request_id") || "").trim(), [params]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot validation
      setError("Missing request id in the URL.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    const startedAt = Date.now();
    const supabase = getSupabase();

    const poll = async (): Promise<void> => {
      const { data, error: err } = await supabase.rpc(
        "public_get_booking_request_status",
        { request_id_in: requestId },
      );
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const row = Array.isArray(data) && data.length > 0 ? (data[0] as Status) : null;
      if (row) {
        setStatus(row);
        setLoading(false);
        // Stop polling once the webhook landed or a terminal state hit.
        if (
          row.approval_status === "deposit_paid_pending_approval" ||
          row.approval_status === "approved" ||
          row.approval_status === "confirmed" ||
          row.approval_status === "denied" ||
          row.approval_status === "cancelled"
        ) {
          return;
        }
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      setTimeout(() => { if (!cancelled) void poll(); }, POLL_MS);
    };

    void poll();
    return () => { cancelled = true; };
  }, [requestId]);

  const bodyText = (() => {
    if (error) return error;
    if (loading) return "Confirming your deposit…";
    if (!status) return "We couldn't find this booking request.";
    if (status.approval_status === "deposit_paid_pending_approval") {
      return "Deposit received. Your appointment request is waiting for stylist approval.";
    }
    if (status.approval_status === "approved" || status.approval_status === "confirmed") {
      return "Your stylist has confirmed your appointment. See you soon.";
    }
    if (status.approval_status === "denied") {
      return "Your stylist couldn't accommodate this request. The deposit is being refunded.";
    }
    if (timedOut) {
      return "Your payment is still being processed. We'll email you once your stylist reviews the request.";
    }
    return "Confirming your deposit…";
  })();

  const headerText = (() => {
    if (error) return "Something went wrong";
    if (status?.approval_status === "approved" || status?.approval_status === "confirmed") {
      return "You're confirmed";
    }
    if (status?.approval_status === "denied") return "Couldn't accommodate";
    return "Deposit received";
  })();

  return (
    <SuccessShell body={bodyText} header={headerText}>
      {status && status.deposit_amount != null && status.deposit_paid && (
        <p style={{ marginTop: 12, fontSize: 12, color: C.muted }}>
          Deposit · <strong style={{ color: C.goldDeep }}>{fmtPrice(Number(status.deposit_amount))}</strong> paid
          {status.service_name ? ` for ${status.service_name}` : ""}
          {(() => {
            const when = formatAppointmentDate(status.preferred_date, status.preferred_time);
            return when ? ` · ${when}` : "";
          })()}
        </p>
      )}
      {status && status.approval_status === "deposit_paid_pending_approval" && (
        <p style={{ marginTop: 16, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
          Deposit payment doesn&apos;t guarantee approval until your stylist confirms.
          You&apos;ll get a message once they review.
        </p>
      )}
    </SuccessShell>
  );
}

function SuccessShell({
  header = "Deposit received",
  body,
  children,
}: { header?: string; body: string; children?: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;600&display=swap');
        body { margin: 0; }
      `}</style>
      <div className="mx-auto" style={{ maxWidth: 480, padding: "48px 20px" }}>
        <p style={{ textAlign: "center", letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 10, fontWeight: 700, color: C.gold }}>
          Booking
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, color: C.espresso, textAlign: "center", lineHeight: 1.1, marginTop: 8 }}>
          {header}
        </h1>
        <div
          style={{
            marginTop: 28,
            padding: 24,
            borderRadius: 16,
            background: C.paper,
            border: `1px solid ${C.hairline}`,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 14, color: C.coffee, lineHeight: 1.5 }}>{body}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
