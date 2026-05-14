"use client";

// Public review page — /review/<appointment_id>
//
// Linked from the "balance paid" transactional email. Anonymous,
// luxury 5-star + open-notes form. Submit goes through
// submit_appointment_review (SECURITY DEFINER, anon callable). The
// underlying table has a UNIQUE on appointment_id so re-submits
// update the stored row in place — the page treats a returning
// visitor as "edit your review" rather than locking them out.

import { Suspense, use, useEffect, useMemo, useState } from "react";
import { getSupabase } from "../../lib/supabase";
import { formatAppointmentDate } from "../../lib/utils/formatAppointmentDate";
import { trackEvent } from "../../lib/track";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#2A1810",
  coffee: "#4A2C1A",
  gold: "#C9A961",
  goldDeep: "#A8893F",
  muted: "#8B7355",
  hairline: "rgba(74, 44, 26, 0.12)",
  success: "#5C7C4A",
  danger: "#9C3D2E",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

type ReviewInfo =
  | {
      ok: true;
      id: string;
      studio_name: string;
      service_name: string | null;
      client_name: string | null;
      appt_date: string | null;
      appt_time: string | null;
      already_submitted: boolean;
      existing_stars: number | null;
    }
  | { ok: false; reason: string };

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      minHeight: "100dvh",
      background: C.cream,
      color: C.espresso,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      paddingTop: "max(28px, env(safe-area-inset-top))",
      paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
      paddingLeft: 18,
      paddingRight: 18,
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
    }}
  >
    <div style={{ width: "100%", maxWidth: 440, margin: "0 auto" }}>{children}</div>
  </div>
);

const Brand = ({ studio }: { studio?: string }) => {
  const clean = studio?.trim();
  return (
    <div style={{ textAlign: "center", marginBottom: 24 }}>
      {clean ? (
        <>
          <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, letterSpacing: "-0.005em", lineHeight: 1.1 }}>
            {clean}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 9, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: C.muted }}>
            powered by Braid Boss Pro
          </p>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: C.goldDeep }}>
          Braid Boss Pro
        </p>
      )}
    </div>
  );
};

const Star = ({ filled, onClick, onHover }: { filled: boolean; onClick: () => void; onHover: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    onMouseEnter={onHover}
    onTouchStart={onHover}
    aria-label="Rate"
    style={{
      appearance: "none",
      WebkitAppearance: "none",
      background: "transparent",
      border: "none",
      padding: 6,
      cursor: "pointer",
      lineHeight: 1,
      fontSize: 38,
      color: filled ? C.goldDeep : "rgba(74, 44, 26, 0.18)",
      transition: "color 160ms ease, transform 120ms ease",
      transform: filled ? "scale(1.02)" : "scale(1)",
    }}
  >
    ★
  </button>
);

const ReviewInner = ({ id }: { id: string }) => {
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stars, setStars] = useState<number>(0);
  const [hoverStars, setHoverStars] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("public_get_appointment_for_review", { appt_id_in: id });
        if (cancelled) return;
        if (error) { setErr(error.message); return; }
        const v = data as ReviewInfo;
        setInfo(v);
        if (v.ok && v.already_submitted && v.existing_stars) {
          setStars(v.existing_stars);
        }
        trackEvent("review_page_viewed", { category: "feature" });
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Couldn't load this page.");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const submit = async () => {
    if (stars < 1 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("submit_appointment_review", {
        appt_id_in: id,
        stars_in: stars,
        notes_in: notes.trim() || null,
      });
      if (error) {
        setErr(error.message);
        trackEvent("review_submit_failed", { category: "error" });
        setBusy(false);
        return;
      }
      const ok = (data as { ok?: boolean } | null)?.ok;
      if (!ok) {
        setErr("Couldn't save your review.");
        trackEvent("review_submit_failed", { category: "error" });
        setBusy(false);
        return;
      }
      setSubmitted(true);
      trackEvent("review_submitted", { category: "feature", metadata: { stars, has_notes: !!notes.trim() } });
    } catch (e: any) {
      setErr(e?.message || "Couldn't save your review.");
      trackEvent("review_submit_failed", { category: "error" });
    } finally {
      setBusy(false);
    }
  };

  const studio = useMemo(() => (info && info.ok ? info.studio_name : undefined), [info]);

  if (!info && !err) {
    return <Shell><Brand /><p style={loadingP}>Loading…</p></Shell>;
  }
  if (err || (info && !info.ok)) {
    const reason = info && !info.ok ? info.reason : err;
    return (
      <Shell>
        <Brand studio={studio} />
        <div style={card}>
          <h1 style={{ ...h1, color: C.danger }}>We couldn&apos;t load this page.</h1>
          <p style={muted}>
            {reason === "not_found"
              ? "This review link doesn't match an appointment. Double-check with your stylist."
              : "Please refresh and try again."}
          </p>
        </div>
      </Shell>
    );
  }
  if (!info || !info.ok) return null;

  const when = formatAppointmentDate(info.appt_date, info.appt_time);
  const studioOrFallback = info.studio_name || "your stylist";

  if (submitted) {
    return (
      <Shell>
        <Brand studio={studio} />
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ width: 64, height: 64, borderRadius: 99, margin: "0 auto 10px",
              background: "radial-gradient(circle, rgba(201,169,97,0.32) 0%, rgba(201,169,97,0) 70%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.goldDeep, fontSize: 28 }}>★</div>
            <h1 style={h1}>Thank you.</h1>
            <p style={muted}>
              Your review went to {studioOrFallback}. They appreciate you taking the time.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const shown = hoverStars || stars;

  return (
    <Shell>
      <Brand studio={studio} />
      <div style={card}>
        <p style={eyebrow}>How was your visit?</p>
        <h1 style={h1}>
          {info.client_name ? `Thank you, ${info.client_name.split(" ")[0]}.` : "Thank you."}
        </h1>
        <p style={muted}>
          {info.service_name ? `${info.service_name}` : "Appointment"}
          {when ? ` · ${when}` : ""}
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 2, marginTop: 22, marginBottom: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              filled={n <= shown}
              onClick={() => setStars(n)}
              onHover={() => setHoverStars(n)}
            />
          ))}
        </div>
        <p style={{ ...muted, textAlign: "center", fontSize: 12 }}>
          {stars === 0 ? "Tap a star to rate" :
           stars === 5 ? "Outstanding" :
           stars === 4 ? "Great" :
           stars === 3 ? "Good" :
           stars === 2 ? "Okay" : "Disappointing"}
        </p>

        <div style={{ marginTop: 18 }}>
          <p style={fieldLabel}>Anything you&apos;d like to share?</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
            placeholder="Optional — what stood out, what could be better?"
            rows={4}
            style={textarea}
          />
        </div>

        {err && <p style={{ color: C.danger, fontSize: 12, marginTop: 10 }}>{err}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={busy || stars < 1}
          style={{ ...primaryBtn, opacity: busy || stars < 1 ? 0.55 : 1 }}
        >
          {info.already_submitted ? (busy ? "Updating…" : "Update review") : (busy ? "Sending…" : "Send review")}
        </button>
        {info.already_submitted && (
          <p style={{ ...muted, fontSize: 11, textAlign: "center", marginTop: 8 }}>
            You&apos;ve reviewed this appointment before — submitting will update your rating.
          </p>
        )}
      </div>
    </Shell>
  );
};

// =====================================================================
// Inline style helpers
// =====================================================================
const card: React.CSSProperties = {
  background: C.paper,
  border: `1px solid ${C.hairline}`,
  borderRadius: 22,
  padding: 22,
  boxShadow: "0 20px 40px -28px rgba(42,24,16,0.28), 0 2px 4px rgba(42,24,16,0.04)",
};
const h1: React.CSSProperties = {
  margin: "8px 0 4px",
  fontFamily: FONT_DISPLAY,
  fontSize: 28,
  fontWeight: 600,
  lineHeight: 1.1,
  letterSpacing: "-0.005em",
};
const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: C.goldDeep,
};
const muted: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: C.muted,
  lineHeight: 1.55,
};
const loadingP: React.CSSProperties = { textAlign: "center", color: C.muted, fontSize: 13 };
const fieldLabel: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: C.muted,
};
const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 96,
  background: C.cream,
  border: `1px solid ${C.hairline}`,
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 14,
  color: C.espresso,
  fontFamily: "inherit",
  resize: "vertical",
  appearance: "none",
  WebkitAppearance: "none",
};
const primaryBtn: React.CSSProperties = {
  marginTop: 18,
  width: "100%",
  appearance: "none",
  WebkitAppearance: "none",
  border: "none",
  borderRadius: 999,
  padding: "16px 22px",
  background: C.espresso,
  color: C.cream,
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: "0.02em",
  cursor: "pointer",
  minHeight: 52,
  boxShadow: "0 10px 22px rgba(42,24,16,0.18)",
  font: "inherit",
};

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={null}><ReviewInner id={id} /></Suspense>;
}
