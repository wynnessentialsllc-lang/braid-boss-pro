"use client";

// Anonymous client-side cancel flow.
//
// Loads the booking via `public_get_booking_action_state` (the only
// public surface — RLS-protected booking_requests are never read
// directly). Shows the appointment in human form, warns that the
// deposit will be forfeited, captures an optional reason, then calls
// `public_cancel_booking_by_token` on confirm. That RPC handles the
// rest: booking_requests + appointments rows flip to cancelled,
// stylist + client notifications are queued, audit log appended.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";

const C = {
  espresso: "#15111A", coffee: "#3D3447", paper: "#FFFFFF",
  ivory: "#F6F2EC", cream: "#FAF6EE",
  brandPrimary: "#7C3AED", brandDeep: "#5B21B6",
  muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
  danger: "#9C3D2E", warning: "#A8893F",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

type ActionState = {
  ok: true;
  action: "cancel" | "reschedule";
  request_id: string;
  studio_name: string;
  client_name: string | null;
  service_name: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  deposit_amount: number | null;
  reschedule_count: number;
  link_slug: string | null;
  service_duration_hours: number;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
};

const fmtTime = (hhmm: string | null): string => {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr); const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
};

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      minHeight: "100vh",
      background: C.ivory,
      color: C.espresso,
      fontFamily: FONT_BODY,
      padding: "32px 20px calc(40px + env(safe-area-inset-bottom, 0px))",
      paddingTop: "calc(32px + env(safe-area-inset-top, 0px))",
      WebkitFontSmoothing: "antialiased",
    }}
  >
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
    <div style={{ maxWidth: 520, margin: "0 auto" }}>{children}</div>
  </div>
);

const Card: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div
    style={{
      background: C.paper,
      borderRadius: 20,
      border: `1px solid ${C.hairline}`,
      padding: 24,
      boxShadow: "0 6px 22px -16px rgba(21, 17, 26, 0.20)",
    }}
  >
    {children}
  </div>
);

export default function CancelBookingPage() {
  const params = useParams();
  const token = useMemo(() => {
    const raw = params?.token;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ActionState | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("public_get_booking_action_state", { token_in: token });
      if (cancelled) return;
      setLoading(false);
      if (error) { setErrorReason("invalid_token"); return; }
      const res = data as any;
      if (!res?.ok) { setErrorReason(res?.reason || "invalid_token"); return; }
      if (res.action !== "cancel") { setErrorReason("wrong_action"); return; }
      setState(res as ActionState);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleCancel = useCallback(async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_cancel_booking_by_token", {
      token_in: token,
      reason_in: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) { setErrorReason(error.message || "server_error"); return; }
    const res = data as any;
    if (!res?.ok) { setErrorReason(res?.reason || "server_error"); return; }
    setDone(true);
  }, [token, reason, submitting]);

  if (loading) {
    return <Wrap><Card><p style={{ margin: 0, color: C.muted, textAlign: "center" }}>Loading…</p></Card></Wrap>;
  }

  if (done) {
    return (
      <Wrap>
        <Card>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: C.brandDeep, margin: "0 0 10px" }}>
            Cancelled
          </p>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, lineHeight: 1.15, margin: "0 0 14px", color: C.espresso }}>
            Your appointment was cancelled.
          </h1>
          <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.55, color: C.coffee }}>
            Your stylist has been notified. Per their policy, your deposit has been forfeited.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>You can close this page.</p>
        </Card>
      </Wrap>
    );
  }

  if (errorReason || !state) {
    const messages: Record<string, string> = {
      not_found: "This link is no longer valid.",
      invalid_token: "This link is no longer valid.",
      wrong_action: "This link is no longer valid.",
      already_cancelled: "This appointment is already cancelled.",
      appointment_past: "This appointment has already happened. Please reach out to your stylist directly.",
      server_error: "Something went wrong. Please try again, or contact your stylist directly.",
    };
    const msg = messages[errorReason || ""] || "This link is no longer valid.";
    return (
      <Wrap>
        <Card>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, margin: "0 0 12px", color: C.espresso }}>
            Can't cancel
          </h1>
          <p style={{ margin: 0, color: C.coffee, fontSize: 15, lineHeight: 1.55 }}>{msg}</p>
        </Card>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Card>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: C.danger, margin: "0 0 10px" }}>
          Cancel appointment
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, lineHeight: 1.15, margin: "0 0 18px", color: C.espresso }}>
          Cancel your appointment with {state.studio_name}?
        </h1>

        <div style={{ background: C.cream, border: `1px solid ${C.hairline}`, borderRadius: 14, padding: 16, marginBottom: 18 }}>
          {state.service_name && (
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: C.espresso }}>
              {state.service_name}
            </p>
          )}
          <p style={{ margin: 0, color: C.coffee, fontSize: 14, lineHeight: 1.5 }}>
            {fmtDate(state.preferred_date)}
            {state.preferred_time ? <> · {fmtTime(state.preferred_time)}</> : null}
          </p>
        </div>

        <div style={{ background: "#FBF2EE", borderRadius: 14, padding: 14, marginBottom: 18, border: `1px solid rgba(156, 61, 46, 0.18)` }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.danger }}>
            <strong>Heads up:</strong> Cancelling forfeits your deposit
            {state.deposit_amount && state.deposit_amount > 0 ? <> of ${Number(state.deposit_amount).toFixed(2)}</> : null}
            {" "}per your stylist's policy. If you need to change the time instead, look for the reschedule link in your reminder email.
          </p>
        </div>

        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: C.coffee, display: "block", marginBottom: 6 }}>
            Reason (optional)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Let your stylist know what came up — totally optional."
            rows={3}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px solid ${C.hairline}`,
              fontFamily: FONT_BODY,
              fontSize: 14,
              lineHeight: 1.5,
              color: C.espresso,
              background: C.paper,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </label>

        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          style={{
            width: "100%",
            padding: "14px 22px",
            borderRadius: 14,
            background: C.danger,
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            border: "none",
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting ? 0.7 : 1,
            transition: "opacity 160ms",
          }}
        >
          {submitting ? "Cancelling…" : "Cancel appointment and forfeit deposit"}
        </button>
        <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 12, color: C.muted }}>
          This can't be undone. You'll need to book again if you change your mind.
        </p>
      </Card>
    </Wrap>
  );
}
