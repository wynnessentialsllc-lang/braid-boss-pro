"use client";

// Branded auth shell for Braid Boss Pro — the polished frame that wraps
// the sign-in / sign-up / reset form (see AuthGate in app/page.tsx).
//
// This is the old first-launch WelcomeIntro screen, repurposed: the
// brand mark, floating brand halo, serif headline, gradient trial pill,
// and the "Inside Braid Boss Pro" preview carousel now dress the auth
// form instead of a plain centered card. AuthGate passes the actual
// inputs/buttons as children; this component owns everything around
// them.
//
// Self-contained: no imports from app/page.tsx — its own palette +
// animations so it can be lifted/tested without dragging the monolith
// in. Hydration-safe: every animation is pure CSS; prefers-reduced-
// motion is resolved post-mount inside useEffect.

import { useEffect, useState, type ReactNode } from "react";
import {
  Calculator,
  CalendarCheck,
  Users,
  TrendingUp,
  Sparkles,
  DollarSign,
  ChevronLeft,
} from "lucide-react";
import { SUBSCRIPTION_PRICE_LABEL, SUBSCRIPTION_TRIAL_DAYS } from "../lib/premium";

// Palette mirrors the project's C tokens (app/page.tsx:529).
const P = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  paper: "#FFFFFF",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  goldSoft: "#F1EBFD",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  hairline: "rgba(21, 17, 26, 0.12)",
  hairlineSoft: "rgba(21, 17, 26, 0.06)",
  success: "#5C7C4A",
  successSoft: "rgba(92, 124, 74, 0.12)",
  brandPrimary: "#7C3AED",
  brandSecondary: "#FF4D6D",
  brandText: "#15111A",
  brandMuted: "#6F6477",
  brandBorder: "#ECE7F2",
  brandSurface: "#FFFDF8",
  brandSparkle: "#C6FF00",
} as const;

const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  secondary: "linear-gradient(135deg, #FF4D6D 0%, #FF7A45 100%)",
  heroHalo:
    "radial-gradient(circle, rgba(124, 58, 237, 0.22) 0%, rgba(255, 77, 109, 0.10) 50%, rgba(124, 58, 237, 0) 75%)",
} as const;
const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
} as const;

const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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

// Trust-signal value props shown under the form on the signup tab — a
// quick reminder of what the account unlocks. Order: purple → coral →
// amber → green chips so the column reads as polished onboarding.
type Feature = { icon: ReactNode; title: string; body: string };
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
    title: "Track income and business growth",
    body: "Income, expenses, and client value in one place.",
  },
];

// =====================================================================
// Preview-card subcomponents — "inside the app" thumbnails with
// realistic mock data, no images. (Carried over from the intro screen.)
// =====================================================================

const PreviewFrame = ({
  label,
  children,
  delaySec,
  reduced,
}: {
  label: string;
  children: ReactNode;
  delaySec: number;
  reduced: boolean;
}) => (
  <div
    style={{
      flex: "0 0 280px",
      scrollSnapAlign: "center",
      borderRadius: 22,
      background: P.paper,
      border: `1px solid ${P.hairline}`,
      boxShadow:
        "0 18px 38px -22px rgba(21, 17, 26,0.28), 0 2px 4px rgba(21, 17, 26,0.04)",
      overflow: "hidden",
      animation: reduced ? "none" : `bbpa-card-float 7.5s ease-in-out ${delaySec}s infinite`,
      willChange: "transform",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderBottom: `1px solid ${P.hairlineSoft}`,
        background: P.cream,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 99, background: P.gold, display: "inline-block" }} />
      <span style={{ width: 5, height: 5, borderRadius: 99, background: P.mutedSoft, display: "inline-block" }} />
      <span style={{ width: 5, height: 5, borderRadius: 99, background: P.mutedSoft, display: "inline-block" }} />
      <span
        style={{
          marginLeft: 6,
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: P.muted,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </div>
    <div style={{ padding: 16 }}>{children}</div>
  </div>
);

const PreviewPricing = () => (
  <>
    <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: P.espresso, lineHeight: 1.15 }}>
      Knotless braids
    </p>
    <p style={{ margin: "2px 0 14px", fontSize: 11, color: P.muted, letterSpacing: "0.04em" }}>
      Medium · waist length
    </p>
    {[
      ["Base", "$220.00"],
      ["Hair", "$45.00"],
      ["Add-ons · edges, wash", "$30.00"],
    ].map(([k, v]) => (
      <div
        key={k}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", fontSize: 12, color: P.coffee }}
      >
        <span>{k}</span>
        <span style={{ fontFamily: FONT_MONO, color: P.espresso }}>{v}</span>
      </div>
    ))}
    <div
      style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.hairline}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
    >
      <span style={{ fontSize: 11, color: P.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Total</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: P.goldDeep }}>$295.00</span>
    </div>
    <div
      style={{
        marginTop: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 99,
        background: P.successSoft,
        color: P.success,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}
    >
      <DollarSign size={11} /> Deposit collected · $50
    </div>
  </>
);

const Pill = ({ tone, children }: { tone: "gold" | "success" | "neutral"; children: ReactNode }) => {
  const colors =
    tone === "gold"
      ? { bg: P.goldSoft, fg: P.goldDeep }
      : tone === "success"
      ? { bg: P.successSoft, fg: P.success }
      : { bg: "rgba(21, 17, 26,0.06)", fg: P.coffee };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 99,
        background: colors.bg,
        color: colors.fg,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
};

const APPTS: Array<{ time: string; name: string; service: string; status: "gold" | "success" | "neutral"; statusLabel: string }> = [
  { time: "9:00 AM", name: "Amara", service: "Knotless braids", status: "gold", statusLabel: "Deposit paid" },
  { time: "12:30 PM", name: "Jasmine", service: "Box braids", status: "success", statusLabel: "Confirmed" },
  { time: "4:00 PM", name: "Tia", service: "Cornrows", status: "neutral", statusLabel: "Pending" },
];

const PreviewAppointments = () => (
  <>
    <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: P.espresso, lineHeight: 1.15 }}>
      Tuesday
    </p>
    <p style={{ margin: "2px 0 14px", fontSize: 11, color: P.muted, letterSpacing: "0.04em" }}>May 19 · 3 appointments</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {APPTS.map((a) => (
        <div
          key={a.time}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 11px", borderRadius: 12, background: P.cream, border: `1px solid ${P.hairlineSoft}` }}
        >
          <div style={{ flex: "0 0 56px" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: P.goldDeep, letterSpacing: "0.03em" }}>{a.time}</p>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: P.espresso, lineHeight: 1.25 }}>{a.name}</p>
            <p style={{ margin: "1px 0 6px", fontSize: 10.5, color: P.muted, lineHeight: 1.3 }}>{a.service}</p>
            <Pill tone={a.status}>{a.statusLabel}</Pill>
          </div>
        </div>
      ))}
    </div>
  </>
);

const PreviewClient = () => (
  <>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        aria-hidden
        style={{
          flex: "0 0 44px",
          width: 44,
          height: 44,
          borderRadius: 99,
          background: `linear-gradient(135deg, ${P.gold} 0%, ${P.goldDeep} 100%)`,
          color: P.cream,
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: "0.02em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        AJ
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: P.espresso, lineHeight: 1.15 }}>
          Amara Johnson
        </p>
        <p style={{ margin: "1px 0 0", fontSize: 11, color: P.muted }}>12 visits · since 2024</p>
      </div>
    </div>
    <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
      <Pill tone="gold">VIP</Pill>
      <Pill tone="success">Repeat client</Pill>
    </div>
    <div style={{ marginTop: 14 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: P.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Notes</p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: P.coffee, lineHeight: 1.45 }}>
        Sensitive scalp. Prefers tea tree spray. Light tension only.
      </p>
    </div>
    <div
      style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${P.hairline}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: P.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Lifetime spend</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: P.goldDeep }}>$1,420</span>
    </div>
  </>
);

const BAR_HEIGHTS = [22, 34, 28, 46, 38, 52, 64];

const PreviewMoney = () => (
  <>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: P.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>This week</p>
    <p style={{ margin: "2px 0 0", fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: P.espresso, lineHeight: 1.05 }}>$1,840</p>
    <p style={{ margin: "2px 0 14px", fontSize: 11, color: P.success, fontWeight: 600 }}>▲ 22% vs last week</p>
    <div aria-hidden style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 64, marginBottom: 14 }}>
      {BAR_HEIGHTS.map((h, i) => {
        const isLast = i === BAR_HEIGHTS.length - 1;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: h,
              borderRadius: 4,
              background: isLast ? `linear-gradient(180deg, ${P.gold} 0%, ${P.goldDeep} 100%)` : P.ivory,
              border: isLast ? "none" : `1px solid ${P.hairlineSoft}`,
            }}
          />
        );
      })}
    </div>
    {[
      ["Income", "$1,840", P.espresso],
      ["Expenses", "$280", P.coffee],
    ].map(([k, v, color]) => (
      <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 12, color: P.coffee }}>
        <span>{k}</span>
        <span style={{ fontFamily: FONT_MONO, color: color as string }}>{v}</span>
      </div>
    ))}
    <div
      style={{ marginTop: 8, paddingTop: 10, borderTop: `1px solid ${P.hairline}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: P.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Net</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: P.goldDeep }}>$1,560</span>
    </div>
  </>
);

const PREVIEWS: Array<{ label: string; body: ReactNode; delaySec: number }> = [
  { label: "Pricing", body: <PreviewPricing />, delaySec: 0 },
  { label: "Schedule", body: <PreviewAppointments />, delaySec: 0.6 },
  { label: "Client", body: <PreviewClient />, delaySec: 1.2 },
  { label: "Money", body: <PreviewMoney />, delaySec: 1.8 },
];

// =====================================================================
// Main shell
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
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes bbpa-fade-up { from { opacity: 0; transform: translate3d(0, 14px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
        @keyframes bbpa-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bbpa-glow { 0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.85; transform: translate(-50%, -50%) scale(1.08); } }
        @keyframes bbpa-float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
        @keyframes bbpa-card-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        .bbpa-anim { animation-fill-mode: both; animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); }
        .bbpa-track { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .bbpa-track::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .bbpa-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
          .bbpa-track > * { animation: none !important; transform: none !important; }
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
          top: 150,
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
          maxWidth: 440,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 18,
          position: "relative",
          zIndex: 1,
          paddingTop: 12,
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

        {/* Value props — signup only, a quick reminder of what's inside. */}
        {mode === "signup" && (
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
            {FEATURES.map((f, i) => {
              const chipGradients = [
                "linear-gradient(135deg, #7C3AED 0%, #B14BE0 100%)",
                "linear-gradient(135deg, #FF4D6D 0%, #FF7A45 100%)",
                "linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)",
                "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
              ];
              const chipGradient = chipGradients[i % chipGradients.length];
              return (
                <li
                  key={f.title}
                  className="bbpa-anim"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    background: P.paper,
                    border: `1px solid ${P.brandBorder}`,
                    borderRadius: 14,
                    padding: "13px 14px",
                    boxShadow: "0 4px 14px rgba(21, 17, 26, 0.05)",
                    animation: reduced ? "none" : `bbpa-fade-up 560ms ${480 + i * 90}ms both`,
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      flex: "0 0 36px",
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: chipGradient,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#FFFFFF",
                      boxShadow: "0 4px 12px -4px rgba(124, 58, 237, 0.30)",
                    }}
                  >
                    {f.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: P.espresso, lineHeight: 1.3 }}>{f.title}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: P.muted, lineHeight: 1.45 }}>{f.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Inside Braid Boss Pro — preview carousel */}
      <section
        aria-label="Inside Braid Boss Pro"
        className="bbpa-anim"
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "32px auto 0",
          position: "relative",
          zIndex: 1,
          animation: reduced ? "none" : "bbpa-fade-up 700ms 700ms both",
        }}
      >
        <div style={{ textAlign: "center", padding: "0 4px" }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: P.goldDeep }}>
            Inside Braid Boss Pro
          </p>
          <h2 style={{ margin: "8px 0 6px", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: P.espresso, lineHeight: 1.1, letterSpacing: "-0.005em" }}>
            A real look at the app
          </h2>
          <p style={{ margin: "0 auto", maxWidth: 360, fontSize: 13, color: P.muted, lineHeight: 1.5 }}>
            Everything braiders need to run business smoother — pricing, bookings, clients, and money in one place.
          </p>
        </div>

        <div
          className="bbpa-track"
          style={{
            marginTop: 18,
            display: "flex",
            gap: 14,
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            scrollPaddingInline: 20,
            paddingInline: "max(20px, calc((100% - 280px) / 2))",
            paddingBlock: 8,
          }}
        >
          {PREVIEWS.map((p) => (
            <PreviewFrame key={p.label} label={p.label} delaySec={p.delaySec} reduced={reduced}>
              {p.body}
            </PreviewFrame>
          ))}
        </div>

        <div aria-hidden style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 14 }}>
          {PREVIEWS.map((_, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: 99, background: i === 0 ? P.gold : P.hairline, display: "inline-block" }} />
          ))}
        </div>
      </section>
    </div>
  );
}
