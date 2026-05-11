"use client";

// First-launch welcome / onboarding screen for Braid Boss Pro.
//
// Renders before AuthGate when localStorage has never recorded that
// the user has seen the intro. Hands control back via three
// callbacks — onGetStarted (→ signup), onSignIn (→ signin), onSkip
// (→ signin without bias). The parent owns the localStorage flag so
// the gating decision lives in one place.
//
// Self-contained: no imports from app/page.tsx — defines its own
// palette + animations so the component can be safely lifted, tested,
// or pre-rendered without dragging the monolithic page module in.
//
// Hydration safety: every animation is pure CSS via inline <style>.
// No window / matchMedia reads during render; the
// prefers-reduced-motion check happens inside useEffect on mount and
// only affects animation duration / delay.

import { useEffect, useState } from "react";
import {
  Calculator,
  CalendarCheck,
  Users,
  TrendingUp,
  ArrowRight,
  Sparkles,
} from "lucide-react";

// Palette mirrors the project's C tokens (app/page.tsx:231).
const P = {
  cream: "#FAF5EC",
  ivory: "#F5EBD9",
  paper: "#FFFBF2",
  espresso: "#2A1810",
  coffee: "#4A2C1A",
  gold: "#C9A961",
  goldDeep: "#A8893F",
  muted: "#8B7355",
  hairline: "rgba(74, 44, 26, 0.12)",
} as const;

const FONT_DISPLAY =
  "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

type Feature = {
  icon: React.ReactNode;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: <Calculator size={18} />,
    title: "Price every style with confidence",
    body: "Quote add-ons, deposits, and travel in seconds.",
  },
  {
    icon: <CalendarCheck size={18} />,
    title: "Manage appointments and deposits",
    body: "Public booking links, Stripe deposits, and reminders.",
  },
  {
    icon: <Users size={18} />,
    title: "Keep client details organized",
    body: "Histories, photos, and prep notes in one profile.",
  },
  {
    icon: <TrendingUp size={18} />,
    title: "Track money, policies, and growth",
    body: "Income, expenses, and lifetime client value — automatic.",
  },
];

export type WelcomeIntroProps = {
  onGetStarted: () => void;
  onSignIn: () => void;
  onSkip?: () => void;
};

const WelcomeIntro = ({
  onGetStarted,
  onSignIn,
  onSkip,
}: WelcomeIntroProps) => {
  // Reduced motion honored via a single state that's resolved
  // post-mount. SSR renders the full animation set; the first client
  // paint then re-applies if the user prefers reduced motion. Because
  // the animations are CSS keyframes (not JS-driven), the worst case
  // is a 400ms fade-in the user didn't ask for — acceptable for an
  // intro screen.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduced(mq.matches);
      const onChange = () => setReduced(mq.matches);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    } catch {
      /* old Safari — silent */
    }
  }, []);

  const dur = reduced ? 0 : undefined; // 0 → instant via inline style

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: P.cream,
        color: P.espresso,
        fontFamily: FONT_BODY,
        position: "relative",
        overflow: "hidden",
        paddingTop: "max(24px, env(safe-area-inset-top))",
        paddingBottom: "max(24px, env(safe-area-inset-bottom))",
        paddingLeft: 20,
        paddingRight: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <style>{`
        @keyframes bbp-fade-up {
          from { opacity: 0; transform: translate3d(0, 14px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes bbp-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes bbp-glow {
          0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 0.85; transform: translate(-50%, -50%) scale(1.08); }
        }
        @keyframes bbp-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50%      { transform: translateY(-10px) rotate(2deg); }
        }
        .bbp-intro-anim { animation-fill-mode: both; animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); }
        @media (prefers-reduced-motion: reduce) {
          .bbp-intro-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* Skip — top right, low affordance */}
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip introduction"
          style={{
            position: "absolute",
            top: "max(16px, env(safe-area-inset-top))",
            right: 18,
            fontSize: 12,
            letterSpacing: "0.04em",
            color: P.muted,
            background: "transparent",
            border: "none",
            padding: "8px 4px",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          Skip
        </button>
      )}

      {/* Soft floating gold glow behind the headline card */}
      <div
        aria-hidden
        className="bbp-intro-anim"
        style={{
          position: "absolute",
          top: "26%",
          left: "50%",
          width: 320,
          height: 320,
          background:
            "radial-gradient(circle, rgba(201,169,97,0.32) 0%, rgba(201,169,97,0) 65%)",
          filter: "blur(2px)",
          pointerEvents: "none",
          animation: reduced
            ? "none"
            : "bbp-glow 6s ease-in-out infinite",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 440,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          flex: 1,
          justifyContent: "center",
          gap: 18,
          position: "relative",
          zIndex: 1,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        {/* Brand mark */}
        <div
          className="bbp-intro-anim"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            animation: reduced ? "none" : "bbp-fade 600ms ease both",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: P.gold,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 16px rgba(168,137,63,0.32)",
              animation: reduced ? "none" : "bbp-float 5s ease-in-out infinite",
            }}
          >
            <Sparkles size={18} style={{ color: P.espresso }} />
          </div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: P.goldDeep,
              margin: 0,
            }}
          >
            Braid Boss Pro
          </p>
        </div>

        {/* Headline + subhead */}
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <h1
            className="bbp-intro-anim"
            style={{
              margin: 0,
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 36,
              lineHeight: 1.08,
              color: P.espresso,
              letterSpacing: "-0.01em",
              animation: reduced
                ? "none"
                : "bbp-fade-up 700ms 120ms both",
            }}
          >
            Welcome to <br />
            Braid Boss Pro
          </h1>
          <p
            className="bbp-intro-anim"
            style={{
              marginTop: 14,
              marginBottom: 0,
              fontSize: 15,
              lineHeight: 1.55,
              color: P.coffee,
              animation: reduced
                ? "none"
                : "bbp-fade-up 700ms 240ms both",
            }}
          >
            The business hub for braiders who want cleaner bookings,
            smarter pricing, and smoother client management.
          </p>
        </div>

        {/* Feature cards — stagger in */}
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "8px 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {FEATURES.map((f, i) => (
            <li
              key={f.title}
              className="bbp-intro-anim"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                background: P.paper,
                border: `1px solid ${P.hairline}`,
                borderRadius: 14,
                padding: "13px 14px",
                boxShadow: "0 1px 3px rgba(42,24,16,0.04)",
                animation: reduced
                  ? "none"
                  : `bbp-fade-up 560ms ${380 + i * 110}ms both`,
              }}
            >
              <div
                aria-hidden
                style={{
                  flex: "0 0 36px",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: P.ivory,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: P.goldDeep,
                }}
              >
                {f.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: P.espresso,
                    lineHeight: 1.3,
                  }}
                >
                  {f.title}
                </p>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 12,
                    color: P.muted,
                    lineHeight: 1.45,
                  }}
                >
                  {f.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* CTAs */}
        <div
          className="bbp-intro-anim"
          style={{
            marginTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            animation: reduced
              ? "none"
              : "bbp-fade-up 600ms 880ms both",
          }}
        >
          <button
            type="button"
            onClick={onGetStarted}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: 999,
              padding: "16px 22px",
              background: P.espresso,
              color: P.cream,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "0.02em",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "0 10px 22px rgba(42,24,16,0.18)",
              cursor: "pointer",
              transitionProperty: "transform, box-shadow",
              transitionDuration: "180ms",
              minHeight: 52,
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(0.985)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "";
            }}
            onTouchStart={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(0.985)";
            }}
            onTouchEnd={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "";
            }}
          >
            Get Started <ArrowRight size={16} />
          </button>
          <button
            type="button"
            onClick={onSignIn}
            style={{
              appearance: "none",
              borderRadius: 999,
              padding: "14px 22px",
              background: "transparent",
              color: P.espresso,
              fontSize: 14,
              fontWeight: 600,
              border: `1px solid ${P.hairline}`,
              cursor: "pointer",
              minHeight: 48,
            }}
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeIntro;
