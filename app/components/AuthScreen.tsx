"use client";

// Branded auth shell for Braid Boss Pro — the polished frame that wraps
// the sign-in / sign-up / reset form (see AuthGate in app/page.tsx).
//
// This is the old first-launch WelcomeIntro screen, repurposed: the
// brand mark, floating brand halo, serif headline, and gradient trial
// pill now dress the auth form instead of a plain centered card.
// AuthGate passes the actual inputs/buttons as children; this component
// owns everything around them.
//
// Self-contained: no imports from app/page.tsx — its own palette +
// animations so it can be lifted/tested without dragging the monolith
// in. Hydration-safe: every animation is pure CSS; prefers-reduced-
// motion is resolved post-mount inside useEffect.

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
    "radial-gradient(circle, rgba(124, 58, 237, 0.22) 0%, rgba(255, 77, 109, 0.10) 50%, rgba(124, 58, 237, 0) 75%)",
} as const;
const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
} as const;

const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// =====================================================================
// Copy per mode
// =====================================================================
type AuthMode = "signin" | "signup" | "reset";

const COPY: Record<AuthMode, { title: ReactNode; subtitle: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Sign in to sync your clients, bookings, and money across devices.",
  },
  signup: {
    title: (
      <>
        Create your
        <br />
        account
      </>
    ),
    subtitle: "Built specifically for braid stylists. Cloud-synced from day one.",
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
        paddingTop: "max(24px, env(safe-area-inset-top))",
        paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
        paddingLeft: 20,
        paddingRight: 20,
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
        @keyframes bbpa-glow { 0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.85; transform: translate(-50%, -50%) scale(1.08); } }
        @keyframes bbpa-float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
        .bbpa-anim { animation-fill-mode: both; animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); }
        @media (prefers-reduced-motion: reduce) {
          .bbpa-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* Back — top left, low affordance. */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          style={{
            position: "absolute",
            top: "max(16px, env(safe-area-inset-top))",
            left: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            fontSize: 13,
            letterSpacing: "0.02em",
            color: P.muted,
            background: "transparent",
            border: "none",
            padding: "8px 6px",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          <ChevronLeft size={16} /> Back
        </button>
      )}

      {/* Soft floating brand halo behind the headline. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "28%",
          left: "50%",
          width: 360,
          height: 360,
          background: GRADIENTS.heroHalo,
          filter: "blur(8px)",
          pointerEvents: "none",
          animation: reduced ? "none" : "bbpa-glow 6s ease-in-out infinite",
          zIndex: 0,
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 18,
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
            gap: 8,
            animation: reduced ? "none" : "bbpa-fade 600ms ease both",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: GRADIENTS.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: SHADOWS.primaryGlow,
              animation: reduced ? "none" : "bbpa-float 5s ease-in-out infinite",
            }}
          >
            <Sparkles size={18} style={{ color: "#FFFFFF" }} />
          </div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: P.goldDeep, margin: 0 }}>
            Braid Boss Pro
          </p>
        </div>

        {/* Headline + subhead */}
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <h1
            className="bbpa-anim"
            style={{
              margin: 0,
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 38,
              lineHeight: 1.06,
              color: P.espresso,
              letterSpacing: "-0.01em",
              animation: reduced ? "none" : "bbpa-fade-up 700ms 120ms both",
            }}
          >
            {copy.title}
          </h1>
          <p
            className="bbpa-anim"
            style={{
              marginTop: 14,
              marginBottom: 0,
              fontSize: 15,
              lineHeight: 1.55,
              color: P.coffee,
              animation: reduced ? "none" : "bbpa-fade-up 700ms 240ms both",
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
              animation: reduced ? "none" : "bbpa-fade-up 600ms 320ms both",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 18px",
                borderRadius: 16,
                background: GRADIENTS.primary,
                color: "#FFFFFF",
                boxShadow: SHADOWS.primaryGlow,
                width: "100%",
                maxWidth: 360,
              }}
            >
              <div style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 999, background: "rgba(255,255,255,0.18)", flexShrink: 0 }}>
                <Sparkles size={16} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: "0.01em" }}>{SUBSCRIPTION_TRIAL_DAYS}-day free trial</p>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 500, opacity: 0.88 }}>Then {SUBSCRIPTION_PRICE_LABEL} · Cancel anytime</p>
              </div>
            </div>
          </div>
        )}

        {/* The auth form + secondary controls (owned by AuthGate). */}
        <div
          className="bbpa-anim"
          style={{ animation: reduced ? "none" : "bbpa-fade-up 600ms 400ms both" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
