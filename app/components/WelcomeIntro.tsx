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
//
// Layout note: the page now scrolls naturally (overflowX:hidden,
// overflowY:visible). The CTAs sit ABOVE the "Inside Braid Boss
// Pro" preview carousel so users on smaller iPhones can reach Get
// Started without scrolling; the preview is a "learn more" reward
// beneath.

import { useEffect, useState } from "react";
import {
  Calculator,
  CalendarCheck,
  Users,
  TrendingUp,
  ArrowRight,
  Sparkles,
  DollarSign,
} from "lucide-react";
import { trackEvent } from "../lib/track";
import { SUBSCRIPTION_PRICE_LABEL, SUBSCRIPTION_TRIAL_DAYS } from "../lib/premium";

// Palette mirrors the project's C tokens (app/page.tsx:231).
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
  // 2026 refresh tokens — used for the new gradient hero, the
  // primary "Get Started" CTA, and the colorful feature icon chips.
  brandPrimary: "#7C3AED",
  brandSecondary: "#FF4D6D",
  brandText: "#15111A",
  brandMuted: "#6F6477",
  brandBorder: "#ECE7F2",
  brandSurface: "#FFFDF8",
  brandSparkle: "#C6FF00",
} as const;

const GRADIENTS = {
  primary:   "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  secondary: "linear-gradient(135deg, #FF4D6D 0%, #FF7A45 100%)",
  // The hero halo behind the page title — soft, low-saturation, so
  // the white surface still owns the canvas.
  heroHalo:  "radial-gradient(circle, rgba(124, 58, 237, 0.22) 0%, rgba(255, 77, 109, 0.10) 50%, rgba(124, 58, 237, 0) 75%)",
} as const;
const SHADOWS = {
  primaryGlow: "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
} as const;

const FONT_DISPLAY =
  "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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
    title: "Track income, policies, and business growth",
    body: "See income, expenses, client value, and business progress in one place.",
  },
];

export type WelcomeIntroProps = {
  onGetStarted: () => void;
  onSignIn: () => void;
  onSkip?: () => void;
};

// =====================================================================
// Preview-card subcomponents
// =====================================================================
// Each one renders an "inside the app" thumbnail — realistic mock
// data, real layout primitives, no images. They share a common
// frame via PreviewFrame so a future fifth card slots in cleanly.

const PreviewFrame = ({
  label,
  children,
  delaySec,
  reduced,
}: {
  label: string;
  children: React.ReactNode;
  delaySec: number;
  reduced: boolean;
}) => (
  <div
    style={{
      // Mobile-first card size — fits comfortably with one neighbor
      // peeking on a 390px-wide iPhone.
      flex: "0 0 280px",
      scrollSnapAlign: "center",
      borderRadius: 22,
      background: P.paper,
      border: `1px solid ${P.hairline}`,
      boxShadow:
        "0 18px 38px -22px rgba(21, 17, 26,0.28), 0 2px 4px rgba(21, 17, 26,0.04)",
      overflow: "hidden",
      animation: reduced
        ? "none"
        : `bbp-card-float 7.5s ease-in-out ${delaySec}s infinite`,
      willChange: "transform",
    }}
  >
    {/* Tiny status-strip evokes a real screen header without faking a
        Dynamic Island. Three dots + label. */}
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
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: P.gold,
          display: "inline-block",
        }}
      />
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: P.mutedSoft,
          display: "inline-block",
        }}
      />
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: P.mutedSoft,
          display: "inline-block",
        }}
      />
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
    <p
      style={{
        margin: 0,
        fontFamily: FONT_DISPLAY,
        fontSize: 20,
        fontWeight: 600,
        color: P.espresso,
        lineHeight: 1.15,
      }}
    >
      Knotless braids
    </p>
    <p
      style={{
        margin: "2px 0 14px",
        fontSize: 11,
        color: P.muted,
        letterSpacing: "0.04em",
      }}
    >
      Medium · waist length
    </p>

    {[
      ["Base", "$220.00"],
      ["Hair", "$45.00"],
      ["Add-ons · edges, wash", "$30.00"],
    ].map(([k, v]) => (
      <div
        key={k}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "5px 0",
          fontSize: 12,
          color: P.coffee,
        }}
      >
        <span>{k}</span>
        <span style={{ fontFamily: FONT_MONO, color: P.espresso }}>{v}</span>
      </div>
    ))}

    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: `1px solid ${P.hairline}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <span
        style={{ fontSize: 11, color: P.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        Total
      </span>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 26,
          fontWeight: 600,
          color: P.goldDeep,
        }}
      >
        $295.00
      </span>
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

const Pill = ({
  tone,
  children,
}: {
  tone: "gold" | "success" | "neutral";
  children: React.ReactNode;
}) => {
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

const APPTS: Array<{
  time: string;
  name: string;
  service: string;
  status: "gold" | "success" | "neutral";
  statusLabel: string;
}> = [
  { time: "9:00 AM", name: "Amara", service: "Knotless braids", status: "gold", statusLabel: "Deposit paid" },
  { time: "12:30 PM", name: "Jasmine", service: "Box braids", status: "success", statusLabel: "Confirmed" },
  { time: "4:00 PM", name: "Tia", service: "Cornrows", status: "neutral", statusLabel: "Pending" },
];

const PreviewAppointments = () => (
  <>
    <p
      style={{
        margin: 0,
        fontFamily: FONT_DISPLAY,
        fontSize: 20,
        fontWeight: 600,
        color: P.espresso,
        lineHeight: 1.15,
      }}
    >
      Tuesday
    </p>
    <p
      style={{
        margin: "2px 0 14px",
        fontSize: 11,
        color: P.muted,
        letterSpacing: "0.04em",
      }}
    >
      May 19 · 3 appointments
    </p>

    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {APPTS.map((a) => (
        <div
          key={a.time}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 11px",
            borderRadius: 12,
            background: P.cream,
            border: `1px solid ${P.hairlineSoft}`,
          }}
        >
          <div style={{ flex: "0 0 56px" }}>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 700,
                color: P.goldDeep,
                letterSpacing: "0.03em",
              }}
            >
              {a.time}
            </p>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                fontWeight: 600,
                color: P.espresso,
                lineHeight: 1.25,
              }}
            >
              {a.name}
            </p>
            <p
              style={{
                margin: "1px 0 6px",
                fontSize: 10.5,
                color: P.muted,
                lineHeight: 1.3,
              }}
            >
              {a.service}
            </p>
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
        <p
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontSize: 18,
            fontWeight: 600,
            color: P.espresso,
            lineHeight: 1.15,
          }}
        >
          Amara Johnson
        </p>
        <p style={{ margin: "1px 0 0", fontSize: 11, color: P.muted }}>
          12 visits · since 2024
        </p>
      </div>
    </div>

    <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
      <Pill tone="gold">VIP</Pill>
      <Pill tone="success">Repeat client</Pill>
    </div>

    <div style={{ marginTop: 14 }}>
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          color: P.muted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Notes
      </p>
      <p
        style={{
          margin: "4px 0 0",
          fontSize: 12,
          color: P.coffee,
          lineHeight: 1.45,
        }}
      >
        Sensitive scalp. Prefers tea tree spray. Light tension only.
      </p>
    </div>

    <div style={{ marginTop: 12 }}>
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          color: P.muted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Preferred styles
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: P.coffee }}>
        Knotless · Boho · Goddess
      </p>
    </div>

    <div
      style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: `1px solid ${P.hairline}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: P.muted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Lifetime spend
      </span>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 20,
          fontWeight: 600,
          color: P.goldDeep,
        }}
      >
        $1,420
      </span>
    </div>
  </>
);

// 7 mock bars — last bar is "this" period so it pops in gold.
const BAR_HEIGHTS = [22, 34, 28, 46, 38, 52, 64];

const PreviewMoney = () => (
  <>
    <p
      style={{
        margin: 0,
        fontSize: 10,
        fontWeight: 700,
        color: P.muted,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      This week
    </p>
    <p
      style={{
        margin: "2px 0 0",
        fontFamily: FONT_DISPLAY,
        fontSize: 30,
        fontWeight: 600,
        color: P.espresso,
        lineHeight: 1.05,
      }}
    >
      $1,840
    </p>
    <p
      style={{
        margin: "2px 0 14px",
        fontSize: 11,
        color: P.success,
        fontWeight: 600,
      }}
    >
      ▲ 22% vs last week
    </p>

    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        height: 64,
        marginBottom: 14,
      }}
    >
      {BAR_HEIGHTS.map((h, i) => {
        const isLast = i === BAR_HEIGHTS.length - 1;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: h,
              borderRadius: 4,
              background: isLast
                ? `linear-gradient(180deg, ${P.gold} 0%, ${P.goldDeep} 100%)`
                : P.ivory,
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
      <div
        key={k}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "4px 0",
          fontSize: 12,
          color: P.coffee,
        }}
      >
        <span>{k}</span>
        <span style={{ fontFamily: FONT_MONO, color: color as string }}>{v}</span>
      </div>
    ))}

    <div
      style={{
        marginTop: 8,
        paddingTop: 10,
        borderTop: `1px solid ${P.hairline}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: P.muted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Net
      </span>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          fontWeight: 600,
          color: P.goldDeep,
        }}
      >
        $1,560
      </span>
    </div>
  </>
);

const PREVIEWS: Array<{
  label: string;
  body: React.ReactNode;
  delaySec: number;
}> = [
  { label: "Pricing", body: <PreviewPricing />, delaySec: 0 },
  { label: "Schedule", body: <PreviewAppointments />, delaySec: 0.6 },
  { label: "Client", body: <PreviewClient />, delaySec: 1.2 },
  { label: "Money", body: <PreviewMoney />, delaySec: 1.8 },
];

// =====================================================================
// Main component
// =====================================================================

// Shared style for the marketing-link row beneath the Sign In
// button. Quiet uppercase chips in brand purple, no underline.
const welcomeLinkStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: P.brandPrimary,
  textDecoration: "none",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const WelcomeIntro = ({
  onGetStarted,
  onSignIn,
  onSkip,
}: WelcomeIntroProps) => {
  // Reduced motion is resolved post-mount so the initial server
  // render is consistent across all clients. Mounted ref keeps the
  // matchMedia listener safe in StrictMode double-invocation.
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

  // Track the welcome view once per mount — entrance funnel signal.
  useEffect(() => {
    trackEvent("welcome_intro_view", { category: "activation" });
  }, []);

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
        // Extra padding bottom keeps the final element clear of the
        // iOS Safari toolbar even while it's expanded.
        paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
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
        @keyframes bbp-card-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-5px); }
        }
        .bbp-intro-anim { animation-fill-mode: both; animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); }
        .bbp-preview-track {
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .bbp-preview-track::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .bbp-intro-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
          .bbp-preview-track > * { animation: none !important; transform: none !important; }
        }
      `}</style>

      {/* Skip — top right, low affordance */}
      {onSkip && (
        <button
          type="button"
          onClick={() => { trackEvent("welcome_intro_skip", { category: "activation" }); onSkip(); }}
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

      {/* Soft floating gold glow behind the headline. Anchored to top
          so it stays in the hero area even when the page scrolls. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 180,
          left: "50%",
          width: 360,
          height: 360,
          // 2026 refresh: the gold halo behind the title becomes
          // the new purple→coral brand halo. Same calm intensity
          // so the page still reads white-first.
          background: GRADIENTS.heroHalo,
          filter: "blur(8px)",
          pointerEvents: "none",
          animation: reduced ? "none" : "bbp-glow 6s ease-in-out infinite",
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
              animation: reduced
                ? "none"
                : "bbp-float 5s ease-in-out infinite",
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
          {FEATURES.map((f, i) => {
            // Feature-icon chip palette — each row gets a slightly
            // different gradient so the column reads as polished
            // app-store onboarding instead of one repeated color.
            // Order intentional: purple → coral → orange → green.
            const chipGradients = [
              "linear-gradient(135deg, #7C3AED 0%, #B14BE0 100%)",   // purple
              "linear-gradient(135deg, #FF4D6D 0%, #FF7A45 100%)",   // coral
              "linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)",   // amber
              "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",   // green
              "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",   // brand
            ];
            const chipGradient = chipGradients[i % chipGradients.length];
            return (
            <li
              key={f.title}
              className="bbp-intro-anim"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                background: P.paper,
                border: `1px solid ${P.brandBorder}`,
                borderRadius: 14,
                padding: "13px 14px",
                boxShadow: "0 4px 14px rgba(21, 17, 26, 0.05)",
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
          );
          })}
        </ul>

        {/* Up-front pricing card — sets expectations before the
            CTA so users don't hit a paywall surprise after signup. */}
        <div
          className="bbp-intro-anim"
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 18,
            animation: reduced ? "none" : "bbp-fade-up 600ms 820ms both",
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
            <div
              style={{
                display: "grid",
                placeItems: "center",
                width: 32,
                height: 32,
                borderRadius: 999,
                background: "rgba(255,255,255,0.18)",
                flexShrink: 0,
              }}
            >
              <Sparkles size={16} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: "0.01em" }}>
                {SUBSCRIPTION_TRIAL_DAYS}-day free trial
              </p>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 500, opacity: 0.88 }}>
                Then {SUBSCRIPTION_PRICE_LABEL} · Cancel anytime
              </p>
            </div>
          </div>
        </div>

        {/* CTAs — placed above the preview carousel so they're
            reachable without scrolling on smaller iPhones. */}
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
          <div style={{ position: "relative" }}>
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: -6,
                borderRadius: 999,
                background:
                  "radial-gradient(ellipse at center, rgba(201,169,97,0.42) 0%, rgba(201,169,97,0) 70%)",
                filter: "blur(6px)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
            <button
              type="button"
              onClick={() => { trackEvent("get_started_click", { category: "activation" }); onGetStarted(); }}
              // 2026 refresh: Get Started swaps the espresso pill for
              // the platform's brand gradient + glow. Same shape so
              // the press/hover handlers below keep working.
              style={{
                appearance: "none",
                border: "none",
                borderRadius: 999,
                padding: "16px 22px",
                background: GRADIENTS.primary,
                backgroundColor: P.brandPrimary,
                color: "#FFFFFF",
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "0.02em",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: SHADOWS.primaryGlow,
                cursor: "pointer",
                transitionProperty: "transform, box-shadow",
                transitionDuration: "180ms",
                minHeight: 52,
                position: "relative",
                zIndex: 1,
                width: "100%",
              }}
              onMouseDown={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.transform = "scale(0.985)";
                el.style.boxShadow = "0 6px 14px rgba(124, 58, 237, 0.32)";
              }}
              onMouseUp={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.transform = "";
                el.style.boxShadow = SHADOWS.primaryGlow;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.transform = "";
                el.style.boxShadow = SHADOWS.primaryGlow;
              }}
              onTouchStart={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.transform = "scale(0.985)";
                el.style.boxShadow = "0 6px 14px rgba(124, 58, 237, 0.32)";
              }}
              onTouchEnd={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.transform = "";
                el.style.boxShadow = SHADOWS.primaryGlow;
              }}
            >
              Get Started <ArrowRight size={16} />
            </button>
          </div>

          <p
            style={{
              margin: "4px 0 0",
              textAlign: "center",
              fontSize: 11,
              letterSpacing: "0.04em",
              color: P.muted,
              lineHeight: 1.5,
            }}
          >
            Bookings · Deposits · Clients · Storefronts
          </p>

          <button
            type="button"
            onClick={() => { trackEvent("sign_in_click", { category: "activation" }); onSignIn(); }}
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
              marginTop: 4,
            }}
          >
            Sign In
          </button>

          {/* Public marketing-page links. Quiet uppercase row,
              brand purple — never competes with the primary
              'Get Started' CTA above. Sign In already has its
              own button so it's not duplicated here. */}
          <nav
            aria-label="Learn more"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <a
              href="/features"
              onClick={() => trackEvent("welcome_features_link", { category: "activation" })}
              style={welcomeLinkStyle}
            >
              Features
            </a>
            <a
              href="/how-it-works"
              onClick={() => trackEvent("welcome_how_it_works_link", { category: "activation" })}
              style={welcomeLinkStyle}
            >
              How it works
            </a>
            <a
              href="/pricing"
              onClick={() => trackEvent("welcome_pricing_link", { category: "activation" })}
              style={welcomeLinkStyle}
            >
              Pricing
            </a>
            <a
              href="/faq"
              onClick={() => trackEvent("welcome_faq_link", { category: "activation" })}
              style={welcomeLinkStyle}
            >
              FAQ
            </a>
            <a
              href="/privacy"
              onClick={() => trackEvent("welcome_privacy_link", { category: "activation" })}
              style={welcomeLinkStyle}
            >
              Privacy
            </a>
            <a
              href="/terms"
              onClick={() => trackEvent("welcome_terms_link", { category: "activation" })}
              style={welcomeLinkStyle}
            >
              Terms
            </a>
          </nav>
        </div>
      </div>

      {/* =====================================================
          Inside Braid Boss Pro — preview carousel
          ===================================================== */}
      <section
        aria-label="Inside Braid Boss Pro"
        className="bbp-intro-anim"
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "32px auto 0",
          position: "relative",
          zIndex: 1,
          animation: reduced ? "none" : "bbp-fade-up 700ms 1100ms both",
        }}
      >
        <div style={{ textAlign: "center", padding: "0 4px" }}>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: P.goldDeep,
            }}
          >
            Inside Braid Boss Pro
          </p>
          <h2
            style={{
              margin: "8px 0 6px",
              fontFamily: FONT_DISPLAY,
              fontSize: 26,
              fontWeight: 600,
              color: P.espresso,
              lineHeight: 1.1,
              letterSpacing: "-0.005em",
            }}
          >
            A real look at the app
          </h2>
          <p
            style={{
              margin: "0 auto",
              maxWidth: 360,
              fontSize: 13,
              color: P.muted,
              lineHeight: 1.5,
            }}
          >
            Everything braiders need to run business smoother — pricing,
            bookings, clients, and money in one place.
          </p>
        </div>

        {/* Horizontal scroller with snap. Side padding lets the first
            and last cards sit centered when snapped. */}
        <div
          className="bbp-preview-track"
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
            <PreviewFrame
              key={p.label}
              label={p.label}
              delaySec={p.delaySec}
              reduced={reduced}
            >
              {p.body}
            </PreviewFrame>
          ))}
        </div>

        {/* Subtle dot row hints there's more to scroll. Purely
            decorative — no interactive state needed. */}
        <div
          aria-hidden
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 6,
            marginTop: 14,
          }}
        >
          {PREVIEWS.map((_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: i === 0 ? P.gold : P.hairline,
                display: "inline-block",
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

export default WelcomeIntro;
