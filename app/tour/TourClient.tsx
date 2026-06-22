"use client";

// Auto-cycling slideshow that walks visitors through the real
// Braid Boss Pro feature mockups. Reuses the polished hand-built
// showcase sections from /features so the tour stays in sync with
// the marketing copy and brand styling.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { MarketingShell } from "../components/marketing/MarketingShell";
import {
  AppointmentActionShowcase,
  CalendarShowcase,
  ClientInfoShowcase,
  SourceOrbitShowcase,
} from "../components/marketing/ShowcaseSections";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";

type Slide = {
  eyebrow: string;
  title: string;
  body: string;
  node: ReactNode;
};

const SLIDES: Slide[] = [
  {
    eyebrow: "Customizable calendar",
    title: "Your day, your colors",
    body: "Per-service color tints, theme gradients, light or dark — your calendar matches your brand the way clients see your work.",
    node: <CalendarShowcase />,
  },
  {
    eyebrow: "Action sheet",
    title: "Run the chair from one tap",
    body: "Change status, pull up client notes, view the signed contract, rebook, or check out — all without leaving the appointment.",
    node: <AppointmentActionShowcase />,
  },
  {
    eyebrow: "Client profiles",
    title: "Every visit, every dollar",
    body: "Visit history, preferences, lifetime spend, and last hairstyle photo — surfaced on one card the moment you tap her name.",
    node: <ClientInfoShowcase />,
  },
  {
    eyebrow: "Booking sources",
    title: "Know what's actually working",
    body: "Track which appointments came from Instagram, TikTok, Google, or your link in bio — and double down on what's bringing money in.",
    node: <SourceOrbitShowcase />,
  },
];

const AUTO_MS = 7000;

export default function TourClient() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback((next: number) => {
    setIndex(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
  }, []);

  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);

  useEffect(() => {
    if (!playing) return;
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql.matches) return;
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, AUTO_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // MarketingShell's IntersectionObserver only runs once on mount, so
  // showcase mockups injected by later slides never get .is-visible and
  // stay invisible. Force-reveal them every time the active slide changes.
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>(".bbp-tour-slide .bbp-reveal")
        .forEach((el) => el.classList.add("is-visible"));
    });
    return () => cancelAnimationFrame(t);
  }, [index]);

  const slide = SLIDES[index];

  return (
    <MarketingShell>
      <section style={{ padding: "28px 20px 12px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
          <span
            style={{
              display: "inline-block",
              padding: "6px 14px",
              borderRadius: 999,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            Take the tour
          </span>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: "clamp(28px, 5vw, 44px)",
              color: C.ink,
              margin: "14px 0 8px",
              lineHeight: 1.1,
            }}
          >
            See Braid Boss Pro in action.
          </h1>
          <p style={{ color: C.coffee, fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: "0 auto" }}>
            A quick visual walk-through of the screens stylists run their chair on every day. Use the arrows or arrow keys to step through.
          </p>
        </div>
      </section>

      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Braid Boss Pro feature tour"
        style={{ position: "relative" }}
      >
        <div
          key={index}
          className="bbp-tour-slide"
          style={{
            animation: "bbp-tour-fade 480ms cubic-bezier(.2,.8,.2,1) both",
          }}
        >
          {slide.node}
        </div>

        {/* Controls */}
        <div
          style={{
            position: "sticky",
            bottom: 16,
            zIndex: 40,
            display: "flex",
            justifyContent: "center",
            padding: "0 16px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(10px)",
              border: `1px solid ${C.brandBorder}`,
              boxShadow: SHADOWS.cardLifted,
            }}
          >
            <CtrlButton aria="Previous slide" onClick={prev}>
              <ArrowLeft size={16} />
            </CtrlButton>
            <CtrlButton
              aria={playing ? "Pause auto-advance" : "Play auto-advance"}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </CtrlButton>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
              {SLIDES.map((s, i) => (
                <button
                  key={s.title}
                  aria-label={`Go to slide ${i + 1}: ${s.title}`}
                  aria-current={i === index ? "true" : undefined}
                  onClick={() => go(i)}
                  style={{
                    width: i === index ? 22 : 8,
                    height: 8,
                    borderRadius: 999,
                    border: 0,
                    cursor: "pointer",
                    background: i === index ? GRADIENTS.primary : C.brandBorder,
                    transition: "width 200ms ease",
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <CtrlButton aria="Next slide" onClick={next}>
              <ArrowRight size={16} />
            </CtrlButton>
          </div>
        </div>
      </div>

      <section style={{ padding: "48px 20px 80px", textAlign: "center" }}>
        <p style={{ color: C.muted, fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800 }}>
          {slide.eyebrow}
        </p>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: "clamp(24px, 4vw, 36px)",
            color: C.ink,
            margin: "8px 0 10px",
          }}
        >
          {slide.title}
        </h2>
        <p style={{ color: C.coffee, fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: "0 auto 22px" }}>
          {slide.body}
        </p>
        <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <Link
            href="/?signup=1"
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            Start free trial
          </Link>
          <Link
            href="/features"
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              background: "transparent",
              color: C.brandPrimary,
              border: `1.5px solid ${C.brandPrimary}`,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            See all features
          </Link>
        </div>
      </section>

      <style>{`
        @keyframes bbp-tour-fade {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="bbp-tour-fade"] { animation: none !important; }
        }
      `}</style>
    </MarketingShell>
  );
}

const CtrlButton = ({
  children,
  onClick,
  aria,
}: {
  children: ReactNode;
  onClick: () => void;
  aria: string;
}) => (
  <button
    type="button"
    aria-label={aria}
    onClick={onClick}
    style={{
      width: 34,
      height: 34,
      borderRadius: 999,
      border: `1px solid ${C.brandBorder}`,
      background: "#FFFFFF",
      color: C.ink,
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);
