"use client";

// Reusable feature card — icon chip on a soft brand gradient
// background, title, body. Hover lifts the card slightly and the
// gradient deepens — tactile beauty-tech feel.

import { type ReactNode } from "react";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";

type Tone = "primary" | "secondary" | "soft-a" | "soft-b" | "soft-c";

const TONE_GRADIENT: Record<Tone, string> = {
  primary: GRADIENTS.primary,
  secondary: GRADIENTS.secondary,
  "soft-a": GRADIENTS.primary,
  "soft-b": GRADIENTS.secondary,
  "soft-c": "linear-gradient(135deg, #22C55E 0%, #7C3AED 100%)",
};

export const FeatureCard = ({
  icon,
  title,
  body,
  tone = "primary",
  delay = 0,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  tone?: Tone;
  delay?: 0 | 100 | 200 | 300 | 400;
}) => {
  const gradient = TONE_GRADIENT[tone];
  return (
    <article
      className="bbp-reveal bbp-feature-card"
      data-delay={delay || undefined}
      style={{
        position: "relative",
        background: C.paper,
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 20,
        padding: 22,
        boxShadow: SHADOWS.card,
        transition: "transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 200,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          background: gradient,
          color: "#FFFFFF",
          boxShadow: SHADOWS.primaryGlow,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <h3
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 22,
          color: C.ink,
          margin: 0,
          lineHeight: 1.15,
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </h3>
      <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{body}</p>
      <style jsx>{`
        .bbp-feature-card:hover { transform: translateY(-3px); box-shadow: 0 18px 36px -16px rgba(21, 17, 26, 0.22); }
        @media (prefers-reduced-motion: reduce) { .bbp-feature-card:hover { transform: none; box-shadow: 0 4px 14px rgba(21, 17, 26, 0.06); } }
      `}</style>
    </article>
  );
};

// Container — responsive grid for FeatureCards (1 col mobile,
// 2 col tablet, 3 col desktop).
export const FeatureGrid = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 18,
    }}
  >
    {children}
  </div>
);
