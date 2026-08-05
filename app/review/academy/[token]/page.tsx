"use client";

// Public Academy review page — /review/academy/<token>
//
// Linked from the 24h "How was <video/class>?" email. Anonymous 5-star
// form: rating, an open review, and a display name. Submit goes through
// submit_academy_review_by_token (SECURITY DEFINER, anon callable). The
// review shows on that video's / class's own public page, gated by the
// braider's "show reviews" toggle. Mirrors the appointment review page's
// look so the two feel like one product.

import { Suspense, use, useEffect, useMemo, useState } from "react";
import {
  fetchAcademyReviewContext,
  submitAcademyReview,
  type AcademyReviewContext,
} from "../../../lib/academy";

const C = {
  cream: "#FFFFFF",
  paper: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  danger: "#9C3D2E",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

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
          <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
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

const Star = ({ value, filled, pressed, onClick, onHover }: {
  value: number; filled: boolean; pressed: boolean; onClick: () => void; onHover: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    onMouseEnter={onHover}
    role="radio"
    aria-checked={pressed}
    aria-label={`${value} star${value > 1 ? "s" : ""}`}
    style={{
      appearance: "none", WebkitAppearance: "none", background: "transparent", border: "none",
      minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: 4, cursor: "pointer", lineHeight: 1, fontSize: 38,
      color: filled ? C.goldDeep : "rgba(21, 17, 26, 0.18)",
      transition: "color 160ms ease, transform 120ms ease",
      transform: filled ? "scale(1.02)" : "scale(1)",
    }}
  >
    ★
  </button>
);

const ReviewInner = ({ token }: { token: string }) => {
  const [ctx, setCtx] = useState<AcademyReviewContext | null>(null);
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [notes, setNotes] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchAcademyReviewContext(token);
      if (cancelled) return;
      setCtx(r);
      if (r.ok && r.alreadyReviewed) setSubmitted(true);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const studio = useMemo(() => (ctx && ctx.ok ? ctx.studioName : undefined), [ctx]);

  const submit = async () => {
    if (stars < 1 || busy) return;
    setBusy(true);
    setErr(null);
    const r = await submitAcademyReview({ token, stars, notes: notes.trim(), displayName: displayName.trim() });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setSubmitted(true);
  };

  if (!ctx) return <Shell><Brand /><p style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>Loading…</p></Shell>;

  if (!ctx.ok) {
    return (
      <Shell>
        <Brand />
        <div style={card}>
          <h1 style={{ ...h1, color: C.danger }}>We couldn&apos;t load this page.</h1>
          <p style={muted}>{ctx.error} If this keeps happening, ask your braider to resend your access email.</p>
        </div>
      </Shell>
    );
  }

  const kindLabel = ctx.kind === "class" ? "class" : "video";

  if (submitted) {
    return (
      <Shell>
        <Brand studio={studio} />
        <div style={card}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: 99, margin: "0 auto 10px",
              background: "radial-gradient(circle, rgba(124,58,237,0.24) 0%, rgba(124,58,237,0) 70%)",
              display: "flex", alignItems: "center", justifyContent: "center", color: C.goldDeep, fontSize: 28 }}>★</div>
            <h1 style={h1}>Thank you.</h1>
            <p style={muted}>Your review of “{ctx.itemTitle}” went to {studio || "your braider"}. It helps future students book with confidence.</p>
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
        <p style={eyebrow}>How was your {kindLabel}?</p>
        <h1 style={h1}>{ctx.itemTitle}</h1>
        <p style={muted}>Thanks again for your purchase — a quick review would mean a lot.</p>

        <div
          role="radiogroup"
          aria-label="Star rating"
          onMouseLeave={() => setHoverStars(0)}
          style={{ display: "flex", justifyContent: "center", gap: 2, marginTop: 22, marginBottom: 6 }}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} value={n} filled={n <= shown} pressed={n <= stars} onClick={() => setStars(n)} onHover={() => setHoverStars(n)} />
          ))}
        </div>
        <p style={{ ...muted, textAlign: "center", fontSize: 12 }}>
          {stars === 0 ? "Tap a star to rate" : stars === 5 ? "Outstanding" : stars === 4 ? "Great" : stars === 3 ? "Good" : stars === 2 ? "Okay" : "Disappointing"}
        </p>

        <div style={{ marginTop: 18 }}>
          <p style={fieldLabel}>Your review</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
            placeholder="What stood out? This is what future students will see."
            rows={4}
            style={textarea}
          />
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

        {err && <p style={{ color: C.danger, fontSize: 12, marginTop: 10 }}>{err}</p>}

        <button type="button" onClick={submit} disabled={busy || stars < 1} style={{ ...primaryBtn, opacity: busy || stars < 1 ? 0.55 : 1 }}>
          {busy ? "Sending…" : "Send review"}
        </button>
      </div>
    </Shell>
  );
};

const card: React.CSSProperties = {
  background: C.paper, border: `1px solid ${C.hairline}`, borderRadius: 22, padding: 22,
  boxShadow: "0 20px 40px -28px rgba(21, 17, 26,0.28), 0 2px 4px rgba(21, 17, 26,0.04)",
};
const h1: React.CSSProperties = { margin: "8px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600, lineHeight: 1.1 };
const eyebrow: React.CSSProperties = { margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.goldDeep };
const muted: React.CSSProperties = { margin: "4px 0 0", fontSize: 13, color: C.muted, lineHeight: 1.55 };
const fieldLabel: React.CSSProperties = { margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted };
const textarea: React.CSSProperties = {
  width: "100%", minHeight: 96, background: C.cream, border: `1px solid ${C.hairline}`, borderRadius: 12,
  padding: "12px 14px", fontSize: 14, color: C.espresso, fontFamily: "inherit", resize: "vertical",
  appearance: "none", WebkitAppearance: "none",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: C.cream, border: `1px solid ${C.hairline}`, borderRadius: 12,
  padding: "12px 14px", fontSize: 14, color: C.espresso, fontFamily: "inherit",
  appearance: "none", WebkitAppearance: "none",
};
const primaryBtn: React.CSSProperties = {
  marginTop: 18, width: "100%", appearance: "none", WebkitAppearance: "none", border: "none", borderRadius: 999,
  padding: "16px 22px", background: C.espresso, color: C.cream, fontSize: 15, fontWeight: 600,
  cursor: "pointer", minHeight: 52, boxShadow: "0 10px 22px rgba(21, 17, 26,0.18)", font: "inherit",
};

export default function AcademyReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <Suspense fallback={null}><ReviewInner token={decodeURIComponent(token)} /></Suspense>;
}
