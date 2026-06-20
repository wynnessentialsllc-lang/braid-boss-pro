"use client";

// Premium split-panel auth experience for Braid Boss Pro.
//
// Layout: a marketing panel ("Run Your Braid Business Like a Pro" +
// feature list + rotating iPhone mockup + trust) alongside the auth form
// column (brand mark, headline, feature chips, trial badge, and the form
// itself — passed in as children by AuthGate, which owns all auth logic).
//
// Mobile: single column, the form column appears FIRST, marketing below.
// Desktop (>= 920px): two columns side-by-side, marketing on the left.
//
// White background + pink/purple brand gradient throughout. Subtle,
// performance-friendly CSS animations only; prefers-reduced-motion
// disables motion. The form markup uses the scoped `.bbpa-*` classes
// declared here so all polish lives in one place.

import { useEffect, useState, type ReactNode } from "react";
import {
  Sparkles,
  ChevronLeft,
  CalendarCheck,
  Bell,
  FileSignature,
  BarChart3,
  RefreshCw,
  ShoppingBag,
  Star,
  Clock,
} from "lucide-react";
import { SUBSCRIPTION_PRICE_LABEL, SUBSCRIPTION_TRIAL_DAYS } from "../lib/premium";

// Palette mirrors the project's C tokens (app/page.tsx:529).
const P = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  hairlineSoft: "rgba(21, 17, 26, 0.06)",
} as const;

const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  heroHalo:
    "radial-gradient(circle, rgba(124, 58, 237, 0.18) 0%, rgba(255, 77, 109, 0.10) 50%, rgba(124, 58, 237, 0) 72%)",
} as const;
const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
} as const;

const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
const FONT_BODY = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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

const CHIPS = ["Bookings", "Deposits", "Reminders", "Reviews", "Storefront"];

const FEATURES: Array<{ icon: ReactNode; title: string; body: string }> = [
  { icon: <CalendarCheck size={18} />, title: "Online Booking", body: "A branded /@handle link with real-time availability." },
  { icon: <Bell size={18} />, title: "Automated Reminders", body: "Text + email nudges that quietly cut no-shows." },
  { icon: <FileSignature size={18} />, title: "Contracts & Deposits", body: "E-sign contracts and collect deposits up front." },
  { icon: <BarChart3 size={18} />, title: "Reviews & Analytics", body: "Collect reviews and see what grows your chair." },
  { icon: <RefreshCw size={18} />, title: "Rebook Tracking", body: "See who's due and pre-fill the rebooking text." },
  { icon: <ShoppingBag size={18} />, title: "Product Storefront", body: "Sell retail from your own /@handle/shop." },
];

// =====================================================================
// Rotating iPhone mockup
// =====================================================================

const PhoneScreenDashboard = () => (
  <div style={{ padding: 14 }}>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.muted }}>This week</p>
    <p style={{ margin: "2px 0 0", fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: P.espresso, lineHeight: 1.05 }}>$1,840</p>
    <p style={{ margin: "2px 0 12px", fontSize: 11, color: "#4F7A3E", fontWeight: 600 }}>▲ 22% vs last week</p>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 56, marginBottom: 12 }}>
      {[22, 34, 28, 46, 38, 52, 64].map((h, i) => {
        const last = i === 6;
        return <div key={i} style={{ flex: 1, height: h, borderRadius: 4, background: last ? GRADIENTS.primary : P.ivory }} />;
      })}
    </div>
    {[["Today", "$320"], ["Deposits", "$150"], ["Upcoming", "5 appts"]].map(([k, v]) => (
      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, color: P.coffee }}>
        <span>{k}</span>
        <span style={{ fontFamily: FONT_MONO, color: P.espresso }}>{v}</span>
      </div>
    ))}
  </div>
);

const PhoneScreenCalendar = () => (
  <div style={{ padding: 14 }}>
    <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: P.espresso }}>Tuesday</p>
    <p style={{ margin: "2px 0 12px", fontSize: 11, color: P.muted }}>May 19 · 3 appointments</p>
    {[
      ["9:00", "Amara", "Knotless braids"],
      ["12:30", "Jasmine", "Box braids"],
      ["4:00", "Tia", "Cornrows"],
    ].map(([t, n, s]) => (
      <div key={t} style={{ display: "flex", gap: 10, padding: "9px 10px", borderRadius: 11, background: P.cream, border: `1px solid ${P.hairlineSoft}`, marginBottom: 8 }}>
        <span style={{ flex: "0 0 42px", fontSize: 11, fontWeight: 700, color: P.goldDeep }}>{t}</span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: P.espresso }}>{n}</p>
          <p style={{ margin: "1px 0 0", fontSize: 10.5, color: P.muted }}>{s}</p>
        </div>
      </div>
    ))}
  </div>
);

const PhoneScreenClient = () => (
  <div style={{ padding: 14 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 42, height: 42, borderRadius: 99, background: GRADIENTS.primary, color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>AJ</div>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, color: P.espresso }}>Amara Johnson</p>
        <p style={{ margin: "1px 0 0", fontSize: 11, color: P.muted }}>12 visits · since 2024</p>
      </div>
    </div>
    <div style={{ display: "flex", gap: 6, marginTop: 11 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: P.goldDeep, background: "#F1EBFD", padding: "2px 8px", borderRadius: 99 }}>VIP</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#4F7A3E", background: "rgba(92,124,74,0.12)", padding: "2px 8px", borderRadius: 99 }}>Repeat</span>
    </div>
    <p style={{ margin: "14px 0 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: P.muted }}>Notes</p>
    <p style={{ margin: "4px 0 0", fontSize: 12, color: P.coffee, lineHeight: 1.45 }}>Sensitive scalp. Prefers tea tree spray. Light tension only.</p>
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${P.hairlineSoft}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: P.muted }}>Lifetime</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600, color: P.goldDeep }}>$1,420</span>
    </div>
  </div>
);

const PhoneScreenAnalytics = () => (
  <div style={{ padding: 14 }}>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.muted }}>Top services</p>
    {[
      ["Knotless braids", 0.9],
      ["Box braids", 0.62],
      ["Boho braids", 0.45],
      ["Cornrows", 0.3],
    ].map(([label, pct]) => (
      <div key={label as string} style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: P.coffee, marginBottom: 4 }}>
          <span>{label}</span>
        </div>
        <div style={{ height: 7, borderRadius: 99, background: P.ivory, overflow: "hidden" }}>
          <div style={{ width: `${(pct as number) * 100}%`, height: "100%", borderRadius: 99, background: GRADIENTS.primary }} />
        </div>
      </div>
    ))}
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${P.hairlineSoft}`, display: "flex", justifyContent: "space-between" }}>
      <span style={{ fontSize: 11.5, color: P.muted }}>Retention</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: P.espresso }}>78%</span>
    </div>
  </div>
);

const PHONE_SCREENS: Array<{ label: string; node: ReactNode }> = [
  { label: "Dashboard", node: <PhoneScreenDashboard /> },
  { label: "Calendar", node: <PhoneScreenCalendar /> },
  { label: "Clients", node: <PhoneScreenClient /> },
  { label: "Analytics", node: <PhoneScreenAnalytics /> },
];

const PhoneMock = ({ active, reduced }: { active: number; reduced: boolean }) => (
  <div
    aria-hidden
    style={{
      position: "relative",
      width: 240,
      height: 496,
      borderRadius: 40,
      background: "#15111A",
      padding: 9,
      boxShadow: "0 30px 60px -28px rgba(124, 58, 237, 0.45), 0 12px 28px -16px rgba(21, 17, 26, 0.3)",
      animation: reduced ? "none" : "bbpa-floaty 7s ease-in-out infinite",
    }}
  >
    {/* notch */}
    <div style={{ position: "absolute", top: 9, left: "50%", transform: "translateX(-50%)", width: 92, height: 22, background: "#15111A", borderBottomLeftRadius: 14, borderBottomRightRadius: 14, zIndex: 3 }} />
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 32, background: "#FFFFFF", overflow: "hidden" }}>
      {/* status strip */}
      <div style={{ height: 34 }} />
      <div style={{ position: "absolute", inset: "34px 0 0 0" }}>
        {PHONE_SCREENS.map((s, i) => (
          <div
            key={s.label}
            style={{
              position: "absolute",
              inset: 0,
              opacity: i === active ? 1 : 0,
              transition: reduced ? "none" : "opacity 600ms ease",
              pointerEvents: "none",
            }}
          >
            {s.node}
          </div>
        ))}
      </div>
    </div>
  </div>
);

// =====================================================================
// Shell
// =====================================================================

export type AuthScreenProps = {
  mode: AuthMode;
  onBack?: () => void;
  children: ReactNode;
};

export default function AuthScreen({ mode, onBack, children }: AuthScreenProps) {
  const [reduced, setReduced] = useState(false);
  const [screen, setScreen] = useState(0);

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

  // Rotate the phone mockup through the app screens (paused for reduced
  // motion so we never animate against the user's preference).
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setScreen((s) => (s + 1) % PHONE_SCREENS.length), 3500);
    return () => clearInterval(id);
  }, [reduced]);

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
        paddingTop: "max(20px, env(safe-area-inset-top))",
        paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 20px))",
        paddingLeft: 18,
        paddingRight: 18,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');

        @keyframes bbpa-fade-up { from { opacity: 0; transform: translate3d(0, 14px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
        @keyframes bbpa-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bbpa-glow { 0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.75; transform: translate(-50%, -50%) scale(1.07); } }
        @keyframes bbpa-floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes bbpa-mark { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-6px) rotate(2deg); } }
        .bbpa-anim { animation-fill-mode: both; animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); }

        /* ---- Layout ---- */
        /* margin: auto (not justify-content: center on the parent) so the
           shell centers when it fits but releases the top edge for normal
           scrolling once the content is taller than the viewport. */
        .bbpa-shell { width: 100%; max-width: 1060px; margin: auto; display: flex; flex-direction: column; gap: 36px; position: relative; z-index: 1; }
        .bbpa-formcol { width: 100%; max-width: 416px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
        .bbpa-marketing { width: 100%; max-width: 460px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 22px; text-align: center; }

        @media (min-width: 920px) {
          .bbpa-shell { flex-direction: row; align-items: center; justify-content: center; gap: 64px; }
          .bbpa-formcol { order: 2; flex: 0 0 416px; margin: 0; }
          .bbpa-marketing { order: 1; flex: 1 1 0; max-width: 520px; align-items: flex-start; text-align: left; margin: 0; }
        }

        /* ---- Form card ---- */
        .bbpa-card { background: #FFFFFF; border: 1px solid #EFEAF5; border-radius: 24px; padding: 24px; display: flex; flex-direction: column; gap: 14px;
          box-shadow: 0 1px 2px rgba(21,17,26,0.04), 0 16px 34px -16px rgba(124,58,237,0.22), 0 30px 60px -36px rgba(21,17,26,0.22); }

        .bbpa-fieldgroup { display: flex; flex-direction: column; gap: 6px; }
        .bbpa-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6F6477; }
        .bbpa-input { width: 100%; height: 52px; border-radius: 14px; border: 1.5px solid #ECE7F2; background: #FFFFFF; padding: 0 15px; font-size: 16px; color: #15111A; font-family: inherit; line-height: 52px; transition: border-color 160ms ease, box-shadow 160ms ease; -webkit-appearance: none; appearance: none; }
        .bbpa-input::placeholder { color: #B3AABB; }
        .bbpa-input:hover { border-color: #DCD3E8; }
        .bbpa-input:focus { outline: none; border-color: #7C3AED; box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.13); }

        .bbpa-btn-primary { width: 100%; min-height: 52px; border: none; border-radius: 14px; background: linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%); color: #FFFFFF; font-size: 15px; font-weight: 700; letter-spacing: 0.01em; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          box-shadow: 0 10px 24px -10px rgba(124,58,237,0.55), 0 4px 12px -6px rgba(255,77,109,0.40); transition: transform 150ms ease, box-shadow 150ms ease, filter 150ms ease, opacity 150ms ease; }
        .bbpa-btn-primary:hover { transform: translateY(-1px); filter: brightness(1.03); box-shadow: 0 16px 32px -12px rgba(124,58,237,0.60), 0 6px 16px -8px rgba(255,77,109,0.45); }
        .bbpa-btn-primary:active { transform: translateY(0) scale(0.985); box-shadow: 0 6px 16px -8px rgba(124,58,237,0.50); }
        .bbpa-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; filter: none; }

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

        /* ---- Chips ---- */
        .bbpa-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; list-style: none; margin: 0; padding: 0; }
        .bbpa-chip { font-size: 11.5px; font-weight: 600; color: #5B21B6; background: #F5F0FE; border: 1px solid #ECE3FB; border-radius: 99px; padding: 5px 11px; }

        /* ---- Marketing feature list ---- */
        .bbpa-feats { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; width: 100%; }
        @media (min-width: 560px) { .bbpa-feats { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 920px) { .bbpa-feats { grid-template-columns: 1fr 1fr; } }
        .bbpa-feat { display: flex; align-items: flex-start; gap: 11px; text-align: left; }
        .bbpa-feat-ic { flex: 0 0 36px; width: 36px; height: 36px; border-radius: 11px; background: #F5F0FE; color: #7C3AED; display: flex; align-items: center; justify-content: center; }

        @media (prefers-reduced-motion: reduce) {
          .bbpa-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
          .bbpa-btn-primary:hover, .bbpa-btn-primary:active { transform: none; }
        }
      `}</style>

      {/* Subtle luxury background accents — predominantly white. */}
      <div aria-hidden style={{ position: "absolute", top: "-10%", right: "-8%", width: 420, height: 420, borderRadius: 999, background: "radial-gradient(circle, rgba(124,58,237,0.10) 0%, rgba(124,58,237,0) 70%)", filter: "blur(20px)", pointerEvents: "none", zIndex: 0 }} />
      <div aria-hidden style={{ position: "absolute", bottom: "-12%", left: "-10%", width: 460, height: 460, borderRadius: 999, background: "radial-gradient(circle, rgba(255,77,109,0.09) 0%, rgba(255,77,109,0) 70%)", filter: "blur(24px)", pointerEvents: "none", zIndex: 0 }} />
      <div aria-hidden style={{ position: "absolute", top: "46%", left: "50%", width: 360, height: 360, background: GRADIENTS.heroHalo, filter: "blur(10px)", pointerEvents: "none", animation: reduced ? "none" : "bbpa-glow 7s ease-in-out infinite", zIndex: 0 }} />

      {/* Back — top left. */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          style={{ position: "absolute", top: "max(14px, env(safe-area-inset-top))", left: 12, display: "inline-flex", alignItems: "center", gap: 2, fontSize: 13, color: P.muted, background: "transparent", border: "none", padding: "10px 8px", cursor: "pointer", zIndex: 2 }}
        >
          <ChevronLeft size={16} /> Back
        </button>
      )}

      <div className="bbpa-shell">
        {/* ============ FORM COLUMN (first on mobile) ============ */}
        <section className="bbpa-formcol" aria-label={mode === "signup" ? "Create your account" : "Sign in"}>
          {/* Brand mark */}
          <div className="bbpa-anim" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, animation: reduced ? "none" : "bbpa-fade 600ms ease both" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: GRADIENTS.primary, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOWS.primaryGlow, animation: reduced ? "none" : "bbpa-mark 5s ease-in-out infinite" }}>
              <Sparkles size={19} style={{ color: "#FFFFFF" }} />
            </div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: P.goldDeep, margin: 0 }}>Braid Boss Pro</p>
          </div>

          {/* Headline + subhead */}
          <div style={{ textAlign: "center" }}>
            <h1 className="bbpa-anim" style={{ margin: 0, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "clamp(32px, 9vw, 40px)", lineHeight: 1.05, color: P.espresso, letterSpacing: "-0.015em", animation: reduced ? "none" : "bbpa-fade-up 700ms 100ms both" }}>
              {copy.title}
            </h1>
            <p className="bbpa-anim" style={{ margin: "10px auto 0", maxWidth: 340, fontSize: 14.5, lineHeight: 1.5, color: P.coffee, animation: reduced ? "none" : "bbpa-fade-up 700ms 200ms both" }}>
              {copy.subtitle}
            </p>
          </div>

          {/* 14-day free trial badge — signup only, prominent. */}
          {mode === "signup" && (
            <div className="bbpa-anim" style={{ display: "flex", justifyContent: "center", animation: reduced ? "none" : "bbpa-fade-up 600ms 280ms both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderRadius: 16, background: GRADIENTS.primary, color: "#FFFFFF", boxShadow: SHADOWS.primaryGlow, width: "100%" }}>
                <div style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 999, background: "rgba(255,255,255,0.18)", flexShrink: 0 }}>
                  <Sparkles size={15} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{SUBSCRIPTION_TRIAL_DAYS}-day free trial</p>
                  <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, opacity: 0.9 }}>Then {SUBSCRIPTION_PRICE_LABEL} · Cancel anytime</p>
                </div>
              </div>
            </div>
          )}

          {/* Feature chips above the form. */}
          <ul className="bbpa-chips bbpa-anim" aria-label="Included features" style={{ animation: reduced ? "none" : "bbpa-fade-up 600ms 340ms both" }}>
            {CHIPS.map((c) => (
              <li key={c} className="bbpa-chip">{c}</li>
            ))}
          </ul>

          {/* The auth form + secondary controls (owned by AuthGate). */}
          <div className="bbpa-anim" style={{ display: "flex", flexDirection: "column", gap: 12, animation: reduced ? "none" : "bbpa-fade-up 600ms 400ms both" }}>
            {children}
          </div>
        </section>

        {/* ============ MARKETING PANEL (below on mobile, left on desktop) ============ */}
        <section className="bbpa-marketing bbpa-anim" aria-label="Why Braid Boss Pro" style={{ animation: reduced ? "none" : "bbpa-fade-up 700ms 240ms both" }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: P.goldDeep }}>The business OS for braiders</p>
            <h2 style={{ margin: "10px 0 0", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "clamp(30px, 7vw, 44px)", lineHeight: 1.04, letterSpacing: "-0.015em", color: P.espresso }}>
              Run Your Braid Business Like a Pro
            </h2>
            <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.55, color: P.coffee, maxWidth: 460 }}>
              The all-in-one platform built for braid stylists — manage bookings, deposits, contracts, clients, and money from one beautiful app made for your chair.
            </p>
          </div>

          {/* Feature list with icons */}
          <ul className="bbpa-feats">
            {FEATURES.map((f) => (
              <li key={f.title} className="bbpa-feat">
                <span aria-hidden className="bbpa-feat-ic">{f.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: P.espresso, lineHeight: 1.3 }}>{f.title}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: P.muted, lineHeight: 1.4 }}>{f.body}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* iPhone mockup with rotating screens */}
          <div style={{ display: "flex", justifyContent: "center", width: "100%", paddingTop: 6 }}>
            <PhoneMock active={screen} reduced={reduced} />
          </div>

          {/* Trust */}
          <div style={{ width: "100%", maxWidth: 420 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "inherit" }} aria-label="Rated 5 out of 5 by braiders">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={15} aria-hidden style={{ color: "#FBBF24", fill: "#FBBF24" }} />
              ))}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: P.coffee, marginLeft: 4 }}>Loved by braiders</span>
            </div>
            <figure style={{ margin: "12px 0 0", padding: "14px 16px", borderRadius: 16, background: "#FBFAFD", border: "1px solid #EFEAF5" }}>
              <blockquote style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: P.coffee, fontStyle: "italic" }}>
                “It runs my whole chair — booking, deposits, and follow-ups. I look so professional now.”
              </blockquote>
              <figcaption style={{ marginTop: 8, fontSize: 12, color: P.muted }}>
                — Amara · Knotless specialist
              </figcaption>
            </figure>
            <p style={{ margin: "12px 0 0", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: P.goldDeep }}>
              <Clock size={13} aria-hidden /> Built by a professional braider, for professional braiders.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
