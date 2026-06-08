"use client";

// Public review page — /review/<token>
//
// Linked from the post-appointment "How was your appointment?" email
// (opaque review_request_token — no internal id exposed) and, for
// backward compat, the older "balance paid" email that linked
// /review/<appointment_id>. Anonymous, luxury 5-star form with an
// open review, optional "would you book again?", private note to the
// stylist, and a display name. Submit goes through
// submit_review_by_token (SECURITY DEFINER, anon callable); the RPC
// also accepts a raw appointment id so legacy links keep working.
// appointment_reviews is UNIQUE(appointment_id) so re-submits edit
// the stored row in place and drop back to 'pending' for re-review.

import { Suspense, use, useEffect, useMemo, useState } from "react";
import { getSupabase } from "../../lib/supabase";
import { formatAppointmentDate } from "../../lib/utils/formatAppointmentDate";
import { trackEvent } from "../../lib/track";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  success: "#5C7C4A",
  danger: "#9C3D2E",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

type ReviewInfo =
  | {
      ok: true;
      studio_name: string;
      service_name: string | null;
      client_name: string | null;
      appt_date: string | null;
      appt_time: string | null;
      already_submitted: boolean;
      existing_stars: number | null;
      existing_text: string | null;
      existing_would_book_again: boolean | null;
      existing_display_name: string | null;
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
      color: filled ? C.goldDeep : "rgba(21, 17, 26, 0.18)",
      transition: "color 160ms ease, transform 120ms ease",
      transform: filled ? "scale(1.02)" : "scale(1)",
    }}
  >
    ★
  </button>
);

const ReviewInner = ({ token }: { token: string }) => {
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stars, setStars] = useState<number>(0);
  const [hoverStars, setHoverStars] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [wouldBook, setWouldBook] = useState<boolean | null>(null);
  const [privateNote, setPrivateNote] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [googleUrl, setGoogleUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("public_get_review_by_token", { token_in: token });
        if (cancelled) return;
        if (error) {
          console.warn("[review] load failed:", error.message);
          setErr("This review link isn't valid. Ask your stylist to resend it.");
          return;
        }
        const v = data as ReviewInfo;
        setInfo(v);
        if (v.ok && v.already_submitted) {
          if (v.existing_stars) setStars(v.existing_stars);
          if (v.existing_text) setNotes(v.existing_text);
          if (typeof v.existing_would_book_again === "boolean") setWouldBook(v.existing_would_book_again);
          if (v.existing_display_name) setDisplayName(v.existing_display_name);
        }
        if (v.ok && !v.existing_display_name && v.client_name) {
          setDisplayName(v.client_name);
        }
        trackEvent("review_page_viewed", { category: "feature" });
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Couldn't load this page.");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async () => {
    if (stars < 1 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("submit_review_by_token", {
        token_in: token,
        stars_in: stars,
        review_text_in: notes.trim() || null,
        would_book_again_in: wouldBook,
        private_feedback_in: privateNote.trim() || null,
        display_name_in: displayName.trim() || null,
      });
      if (error) {
        console.warn("[review] submit failed:", error.message);
        setErr("Couldn't save your review. Please try again.");
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
      // Google review boost: funnel happy clients (4-5 stars) to the
      // stylist's public Google profile. Negative feedback stays
      // private. Best-effort — never blocks the thank-you screen.
      if (stars >= 4) {
        try {
          const { data: boost } = await supabase.rpc("public_get_review_boost", { token_in: token });
          const url = (boost as { ok?: boolean; google_review_url?: string | null } | null)?.google_review_url;
          if (url && typeof url === "string") setGoogleUrl(url);
        } catch { /* best-effort */ }
      }
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
          {googleUrl && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.hairline}`, textAlign: "center" }}>
              <p style={{ ...muted, marginBottom: 12 }}>
                Loved your visit? Help others find {studioOrFallback} — share it on Google.
              </p>
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent("google_review_boost_clicked", { category: "feature", metadata: { stars } })}
                style={{
                  display: "inline-block", padding: "13px 24px", borderRadius: 999,
                  background: C.espresso, color: C.cream, textDecoration: "none",
                  fontSize: 14, fontWeight: 700, letterSpacing: "0.03em",
                }}
              >
                Review us on Google · ★★★★★
              </a>
            </div>
          )}
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
          <p style={fieldLabel}>Your review</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
            placeholder="What stood out? This is what future clients will see."
            rows={4}
            style={textarea}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <p style={fieldLabel}>Would you book again?</p>
          <div style={{ display: "flex", gap: 10 }}>
            {([["Yes", true], ["No", false]] as const).map(([label, val]) => (
              <button
                key={label}
                type="button"
                onClick={() => setWouldBook(wouldBook === val ? null : val)}
                style={{
                  ...chip,
                  background: wouldBook === val ? C.espresso : C.cream,
                  color: wouldBook === val ? C.cream : C.coffee,
                  borderColor: wouldBook === val ? C.espresso : C.hairline,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <p style={fieldLabel}>Display name</p>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 80))}
            placeholder="The name shown with your review"
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <p style={fieldLabel}>Private note to your stylist (optional)</p>
          <textarea
            value={privateNote}
            onChange={(e) => setPrivateNote(e.target.value.slice(0, 4000))}
            placeholder="Only your stylist sees this — never shown publicly."
            rows={3}
            style={textarea}
          />
        </div>

        <p style={{ ...muted, fontSize: 12, marginTop: 14 }}>
          Your review helps your stylist grow and helps future clients book with confidence.
        </p>

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
  boxShadow: "0 20px 40px -28px rgba(21, 17, 26,0.28), 0 2px 4px rgba(21, 17, 26,0.04)",
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
const inputStyle: React.CSSProperties = {
  width: "100%",
  background: C.cream,
  border: `1px solid ${C.hairline}`,
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 14,
  color: C.espresso,
  fontFamily: "inherit",
  appearance: "none",
  WebkitAppearance: "none",
};
const chip: React.CSSProperties = {
  flex: 1,
  appearance: "none",
  WebkitAppearance: "none",
  border: `1px solid ${C.hairline}`,
  borderRadius: 999,
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  font: "inherit",
  transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
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
  boxShadow: "0 10px 22px rgba(21, 17, 26,0.18)",
  font: "inherit",
};

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={null}><ReviewInner token={id} /></Suspense>;
}
