"use client";

// Anonymous client-side reschedule flow.
//
// One-shot. The token is single-use (burned by the server RPC after a
// successful reschedule), and the booking_request row also tracks
// reschedule_count so even if the same token were retried, the
// server-side guard rejects it.
//
// Slot picker reuses the same RPC the public booking page uses
// (`public_list_availability`) so respecting buffers + capacity is
// automatic — we just feed it the booking's existing link_slug,
// service duration, and the date the client picked.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";
import {
  fetchPublicAvailability,
  fetchPublicMonthAvailability,
  type PublicSlot,
  type MonthDay,
} from "../../../lib/services";
import { AvailabilityCalendar } from "../../../components/booking/AvailabilityCalendar";

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


const fmtDateLong = (iso: string | null): string => {
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
    <div style={{ maxWidth: 540, margin: "0 auto" }}>{children}</div>
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

export default function ReschedulePage() {
  const params = useParams();
  const token = useMemo(() => {
    const raw = params?.token;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ActionState | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const [newDate, setNewDate] = useState<string>("");
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [monthDays, setMonthDays] = useState<MonthDay[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [pickedTime, setPickedTime] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ date: string; time: string } | null>(null);

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
      if (res.action !== "reschedule") { setErrorReason("wrong_action"); return; }
      setState(res as ActionState);
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Load month-level availability so the calendar can show which
  // days the stylist has openings — same view as the booking link.
  useEffect(() => {
    if (!state?.link_slug) return;
    let cancelled = false;
    (async () => {
      setMonthLoading(true);
      setMonthError(null);
      const durationMinutes = Math.round((state.service_duration_hours || 1) * 60);
      const res = await fetchPublicMonthAvailability({
        slug: state.link_slug!,
        year: monthCursor.year,
        month: monthCursor.month,
        durationMinutes,
      });
      if (cancelled) return;
      setMonthLoading(false);
      if (!res.ok) { setMonthError(res.error || "Couldn't load availability."); return; }
      setMonthDays(res.days);
    })();
    return () => { cancelled = true; };
  }, [state?.link_slug, state?.service_duration_hours, monthCursor.year, monthCursor.month]);

  const monthHasAnyAvailability = useMemo(
    () => monthDays.some(d => d.status === "available" || d.status === "limited"),
    [monthDays],
  );

  // Fetch slots whenever the chosen date changes.
  useEffect(() => {
    if (!state?.link_slug || !newDate) return;
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      setSlotsError(null);
      setPickedTime(null);
      const durationMinutes = Math.round((state.service_duration_hours || 1) * 60);
      const res = await fetchPublicAvailability({
        slug: state.link_slug!,
        dateIso: newDate,
        durationMinutes,
      });
      if (cancelled) return;
      setSlotsLoading(false);
      if (!res.ok) { setSlotsError(res.error || "Couldn't load times."); return; }
      setSlots(res.slots);
    })();
    return () => { cancelled = true; };
  }, [state?.link_slug, state?.service_duration_hours, newDate]);

  const handleSubmit = useCallback(async () => {
    if (!token || !pickedTime || !newDate || submitting) return;
    setSubmitting(true);
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("public_reschedule_booking_by_token", {
      token_in: token,
      new_date_in: newDate,
      new_time_in: pickedTime,
    });
    setSubmitting(false);
    if (error) { setErrorReason(error.message || "server_error"); return; }
    const res = data as any;
    if (!res?.ok) { setErrorReason(res?.reason || "server_error"); return; }
    setDone({ date: newDate, time: pickedTime });
  }, [token, pickedTime, newDate, submitting]);

  if (loading) {
    return <Wrap><Card><p style={{ margin: 0, color: C.muted, textAlign: "center" }}>Loading…</p></Card></Wrap>;
  }

  if (done) {
    return (
      <Wrap>
        <Card>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: C.brandDeep, margin: "0 0 10px" }}>
            Reschedule requested
          </p>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, lineHeight: 1.15, margin: "0 0 14px", color: C.espresso }}>
            Request sent.
          </h1>
          <p style={{ margin: "0 0 8px", fontSize: 15, lineHeight: 1.55, color: C.coffee }}>
            Requested time: <strong>{fmtDateLong(done.date)} · {fmtTime(done.time)}</strong>
          </p>
          <p style={{ margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.55 }}>
            Your deposit rolls over — no new charge. Your stylist needs to confirm the new time; you&apos;ll get an email once it&apos;s approved.
          </p>
        </Card>
      </Wrap>
    );
  }

  if (errorReason || !state) {
    const messages: Record<string, string> = {
      not_found: "This link is no longer valid.",
      invalid_token: "This link is no longer valid.",
      wrong_action: "This link is no longer valid.",
      already_cancelled: "This appointment has been cancelled.",
      already_rescheduled: "You've already used your one-time reschedule for this appointment. Please contact your stylist directly for further changes.",
      appointment_past: "This appointment has already happened. Please reach out to your stylist directly.",
      cancelled: "This appointment has been cancelled.",
      time_in_past: "Pick a time in the future.",
      server_error: "Something went wrong. Please try again, or contact your stylist directly.",
    };
    const msg = messages[errorReason || ""] || "This link is no longer valid.";
    return (
      <Wrap>
        <Card>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, margin: "0 0 12px", color: C.espresso }}>
            Can&apos;t reschedule
          </h1>
          <p style={{ margin: 0, color: C.coffee, fontSize: 15, lineHeight: 1.55 }}>{msg}</p>
        </Card>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Card>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: C.brandDeep, margin: "0 0 10px" }}>
          Reschedule appointment
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, lineHeight: 1.15, margin: "0 0 16px", color: C.espresso }}>
          Pick a new time with {state.studio_name}.
        </h1>

        <div style={{ background: C.cream, border: `1px solid ${C.hairline}`, borderRadius: 14, padding: 16, marginBottom: 18 }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: C.muted }}>
            Current
          </p>
          {state.service_name && (
            <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: C.espresso }}>{state.service_name}</p>
          )}
          <p style={{ margin: 0, color: C.coffee, fontSize: 14, lineHeight: 1.5 }}>
            {fmtDateLong(state.preferred_date)}
            {state.preferred_time ? <> · {fmtTime(state.preferred_time)}</> : null}
          </p>
        </div>

        <div style={{ background: "#F4F0FB", borderRadius: 14, padding: 14, marginBottom: 18, border: `1px solid rgba(124, 58, 237, 0.18)` }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.brandDeep }}>
            <strong>One-time only.</strong> Your existing deposit
            {state.deposit_amount && state.deposit_amount > 0 ? <> of ${Number(state.deposit_amount).toFixed(2)}</> : null}
            {" "}rolls over to the new appointment — no second charge. After this change, further updates need to go through your stylist.
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: C.coffee, display: "block", marginBottom: 8 }}>
            Pick a new date
          </span>
          <AvailabilityCalendar
            monthCursor={monthCursor}
            setMonthCursor={setMonthCursor}
            monthDays={monthDays}
            monthLoading={monthLoading}
            monthError={monthError}
            monthHasAnyAvailability={monthHasAnyAvailability}
            selectedDate={newDate}
            onSelectDate={(iso) => { setNewDate(iso); setPickedTime(null); }}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: C.coffee, margin: "0 0 8px" }}>
            Available times
          </p>
          {!newDate && (
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Pick a date above to see open times.</p>
          )}
          {newDate && slotsLoading && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Loading…</p>}
          {newDate && !slotsLoading && slotsError && (
            <p style={{ margin: 0, fontSize: 13, color: C.danger }}>{slotsError}</p>
          )}
          {newDate && !slotsLoading && !slotsError && slots.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No openings on this day. Try another date.</p>
          )}
          {newDate && !slotsLoading && slots.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {slots.map((slot) => {
                const active = pickedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => setPickedTime(slot.time)}
                    style={{
                      padding: "12px 8px",
                      borderRadius: 12,
                      border: `1.5px solid ${active ? C.brandPrimary : C.hairline}`,
                      background: active ? C.brandPrimary : C.paper,
                      color: active ? "#FFFFFF" : C.espresso,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 120ms",
                    }}
                  >
                    {slot.label || slot.time}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!pickedTime || submitting}
          style={{
            width: "100%",
            padding: "14px 22px",
            borderRadius: 14,
            background: !pickedTime ? "#CFC7DA" : C.brandPrimary,
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            border: "none",
            cursor: !pickedTime || submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1,
            transition: "opacity 160ms",
          }}
        >
          {submitting ? "Rescheduling…" : "Confirm new time"}
        </button>
        <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 12, color: C.muted }}>
          Your deposit will carry over automatically.
        </p>
      </Card>
    </Wrap>
  );
}
