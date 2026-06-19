"use client";

// Branded auth shell for Braid Boss Pro — a premium, mobile-first
// onboarding frame for the sign-in / sign-up / reset form (see AuthGate
// in app/page.tsx).
//
// Repurposed from the old first-launch WelcomeIntro: brand mark, a soft
// animated brand halo, ultra-subtle corner accents, a serif headline,
// and the gradient free-trial pill (sign-up). The form itself lives in
// AuthGate and is styled via the scoped `.bbpa-*` classes declared in
// this component's <style> block — so all the polish (elevated card,
// input focus rings, button micro-interactions) lives in one place
// while the auth logic stays in AuthGate.
//
// Self-contained: no imports from app/page.tsx. Hydration-safe: every
// animation is pure CSS; prefers-reduced-motion is resolved post-mount.

import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, ChevronLeft } from "lucide-react";
import { SUBSCRIPTION_PRICE_LABEL, SUBSCRIPTION_TRIAL_DAYS } from "../lib/premium";

// Palette mirrors the project's C tokens (app/page.tsx:529).
const P = {
  cream: "#FFFFFF",
  espresso: "#15111A",
  coffee: "#3D3447",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
} as const;

const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  heroHalo:
    "radial-gradient(circle, rgba(124, 58, 237, 0.20) 0%, rgba(255, 77, 109, 0.10) 50%, rgba(124, 58, 237, 0) 72%)",
} as const;
const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
} as const;

const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// =====================================================================
// Copy per mode
// =====================================================================
type AuthMode = "signin" | "signup" | "reset";

const COPY: Record<AuthMode, { title: string; subtitle: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Sign in to sync your clients, bookings, and money across devices.",
  },
  signup: {
    title: "Create your account",
    subtitle: "Built for braid stylists. Cloud-synced from your very first booking.",
  },
  reset: {
    title: "Reset password",
    subtitle: "Enter your email and we'll send you a secure reset link.",
  },
};

// =====================================================================
// Shell
// =====================================================================

export type AuthScreenProps = {
  mode: AuthMode;
  onBack?: () => void;
  // The form card + secondary controls (guest, marketing links), owned
  // by AuthGate so all the auth logic stays in one place.
  children: ReactNode;
};

export default function AuthScreen({ mode, onBack, children }: AuthScreenProps) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of an external media query on mount
      setReduced(mq.matches);
      const onChange = () => setReduced(mq.matches);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    } catch {
      /* old Safari — silent */
    }
  }, []);

  const copy = COPY[mode];

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: P.cream,
        color: P.espresso,
        fontFamily: FONT_BODY,
        position: "relative",
        overflowX: "hidden",
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(20px, calc(env(safe-area-inset-bottom) + 16px))",
        paddingLeft: 18,
        paddingRight: 18,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');

        @keyframes bbpa-fade-up { from { opacity: 0; transform: translate3d(0, 14px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
        @keyframes bbpa-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bbpa-glow { 0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.78; transform: translate(-50%, -50%) scale(1.08); } }
        @keyframes bbpa-float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
        .bbpa-anim { animation-fill-mode: both; animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); }

        /* ----- Form card ----- */
        .bbpa-card {
          background: #FFFFFF;
          border: 1px solid #EFEAF5;
          border-radius: 22px;
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-shadow:
            0 1px 2px rgba(21, 17, 26, 0.04),
            0 14px 30px -14px rgba(124, 58, 237, 0.20),
            0 28px 56px -34px rgba(21, 17, 26, 0.22);
        }

        /* ----- Fields ----- */
        .bbpa-fieldgroup { display: flex; flex-direction: column; gap: 6px; }
        .bbpa-label {
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: #6F6477;
        }
        .bbpa-input {
          width: 100%; height: 52px; border-radius: 14px;
          border: 1.5px solid #ECE7F2; background: #FFFFFF;
          padding: 0 15px; font-size: 16px; color: #15111A;
          font-family: inherit; line-height: 52px;
          transition: border-color 160ms ease, box-shadow 160ms ease;
          -webkit-appearance: none; appearance: none;
        }
        .bbpa-input::placeholder { color: #B3AABB; }
        .bbpa-input:hover { border-color: #DCD3E8; }
        .bbpa-input:focus {
          outline: none; border-color: #7C3AED;
          box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.13);
        }

        /* ----- Primary button ----- */
        .bbpa-btn-primary {
          width: 100%; min-height: 52px; border: none; border-radius: 14px;
          background: linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%);
          color: #FFFFFF; font-size: 15px; font-weight: 700; letter-spacing: 0.01em;
          font-family: inherit; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          box-shadow: 0 10px 24px -10px rgba(124, 58, 237, 0.55), 0 4px 12px -6px rgba(255, 77, 109, 0.40);
          transition: transform 150ms ease, box-shadow 150ms ease, filter 150ms ease, opacity 150ms ease;
        }
        .bbpa-btn-primary:hover {
          transform: translateY(-1px); filter: brightness(1.03);
          box-shadow: 0 16px 32px -12px rgba(124, 58, 237, 0.60), 0 6px 16px -8px rgba(255, 77, 109, 0.45);
        }
        .bbpa-btn-primary:active { transform: translateY(0) scale(0.985); box-shadow: 0 6px 16px -8px rgba(124, 58, 237, 0.50); }
        .bbpa-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; filter: none; }

        /* ----- Secondary actions ----- */
        .bbpa-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 2px; flex-wrap: wrap; }
        .bbpa-textbtn { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 13px; padding: 6px 2px; transition: opacity 140ms ease; }
        .bbpa-textbtn.link { color: #6D28D9; font-weight: 600; }
        .bbpa-textbtn.muted { color: #6F6477; }
        .bbpa-textbtn:hover { opacity: 0.72; }

        .bbpa-msg { font-size: 12.5px; margin: -2px 0 0; line-height: 1.4; }
        .bbpa-msg.err { color: #9C3D2E; }
        .bbpa-msg.ok { color: #4F7A3E; }

        .bbpa-guest { width: 100%; text-align: center; background: none; border: none; cursor: pointer; font-family: inherit; color: #6F6477; font-size: 13px; padding: 12px; transition: color 140ms ease; }
        .bbpa-guest:hover { color: #3D3447; }

        .bbpa-footnav { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 18px; }
        .bbpa-footnav a { color: #6F6477; font-size: 12.5px; text-decoration: none; transition: color 140ms ease; padding: 2px 0; }
        .bbpa-footnav a:hover { color: #7C3AED; }

        /* Tablet / desktop: keep the column tight + the card padded so it
           never reads as lost in empty space. */
        @media (min-width: 640px) {
          .bbpa-card { padding: 26px; border-radius: 24px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .bbpa-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
          .bbpa-btn-primary:hover, .bbpa-btn-primary:active { transform: none; }
        }
      `}</style>

      {/* Ultra-subtle abstract accents — keep the canvas predominantly
          white but give large screens something to breathe against so
          the form never floats in a void. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-12%",
          right: "-10%",
          width: 380,
          height: 380,
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(124, 58, 237, 0.10) 0%, rgba(124, 58, 237, 0) 70%)",
          filter: "blur(20px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: "-14%",
          left: "-12%",
          width: 420,
          height: 420,
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(255, 77, 109, 0.09) 0%, rgba(255, 77, 109, 0) 70%)",
          filter: "blur(24px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {/* Soft animated halo centered behind the card. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "44%",
          left: "50%",
          width: 340,
          height: 340,
          background: GRADIENTS.heroHalo,
          filter: "blur(10px)",
          pointerEvents: "none",
          animation: reduced ? "none" : "bbpa-glow 7s ease-in-out infinite",
          zIndex: 0,
        }}
      />

      {/* Back — top left, low affordance. */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          style={{
            position: "absolute",
            top: "max(14px, env(safe-area-inset-top))",
            left: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            fontSize: 13,
            letterSpacing: "0.02em",
            color: P.muted,
            background: "transparent",
            border: "none",
            padding: "10px 8px",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          <ChevronLeft size={16} /> Back
        </button>
      )}

      <div
        style={{
          width: "100%",
          maxWidth: 408,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 16,
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Brand mark */}
        <div
          className="bbpa-anim"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            animation: reduced ? "none" : "bbpa-fade 600ms ease both",
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: GRADIENTS.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: SHADOWS.primaryGlow,
              animation: reduced ? "none" : "bbpa-float 5s ease-in-out infinite",
            }}
          >
            <Sparkles size={19} style={{ color: "#FFFFFF" }} />
          </div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: P.goldDeep, margin: 0 }}>
            Braid Boss Pro
          </p>
        </div>

        {/* Headline + subhead */}
        <div style={{ textAlign: "center" }}>
          <h1
            className="bbpa-anim"
            style={{
              margin: 0,
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: "clamp(32px, 9vw, 40px)",
              lineHeight: 1.05,
              color: P.espresso,
              letterSpacing: "-0.015em",
              animation: reduced ? "none" : "bbpa-fade-up 700ms 120ms both",
            }}
          >
            {copy.title}
          </h1>
          <p
            className="bbpa-anim"
            style={{
              margin: "10px auto 0",
              maxWidth: 340,
              fontSize: 14.5,
              lineHeight: 1.5,
              color: P.coffee,
              animation: reduced ? "none" : "bbpa-fade-up 700ms 220ms both",
            }}
          >
            {copy.subtitle}
          </p>
        </div>

        {/* Trial pill — signup only, sets the price expectation up front. */}
        {mode === "signup" && (
          <div
            className="bbpa-anim"
            style={{
              display: "flex",
              justifyContent: "center",
              animation: reduced ? "none" : "bbpa-fade-up 600ms 300ms both",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "11px 16px",
                borderRadius: 16,
                background: GRADIENTS.primary,
                color: "#FFFFFF",
                boxShadow: SHADOWS.primaryGlow,
                width: "100%",
              }}
            >
              <div style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 999, background: "rgba(255,255,255,0.18)", flexShrink: 0 }}>
                <Sparkles size={15} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, letterSpacing: "0.01em" }}>{SUBSCRIPTION_TRIAL_DAYS}-day free trial</p>
                <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, opacity: 0.9 }}>Then {SUBSCRIPTION_PRICE_LABEL} · Cancel anytime</p>
              </div>
            </div>
          </div>
        )}

        {/* The auth form + secondary controls (owned by AuthGate). */}
        <div
          className="bbpa-anim"
          style={{ animation: reduced ? "none" : "bbpa-fade-up 600ms 380ms both", display: "flex", flexDirection: "column", gap: 12 }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
