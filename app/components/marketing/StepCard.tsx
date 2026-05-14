"use client";

// Reusable numbered step card — used by /how-it-works and any
// future onboarding-style page. Number bubble sits on a brand
// gradient; title + body to the right. Hover lifts.

import { type ReactNode } from "react";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";

export const StepCard = ({
  number,
  title,
  body,
  icon,
  cta,
  delay = 0,
}: {
  number: number;
  title: string;
  body: ReactNode;
  icon?: ReactNode;
  cta?: { label: string; href: string };
  delay?: 0 | 100 | 200 | 300 | 400;
}) => (
  <article
    className="bbp-reveal bbp-step-card"
    data-delay={delay || undefined}
    style={{
      display: "flex",
      gap: 16,
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 20,
      padding: 22,
      boxShadow: SHADOWS.card,
      transition: "transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease",
      alignItems: "flex-start",
    }}
  >
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 44,
        height: 44,
        borderRadius: 14,
        background: GRADIENTS.primary,
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: 18,
        boxShadow: SHADOWS.primaryGlow,
      }}
    >
      {String(number).padStart(2, "0")}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {icon && (
          <span aria-hidden style={{ color: C.brandPrimary, display: "inline-flex" }}>
            {icon}
          </span>
        )}
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
      </div>
      <div style={{ color: C.coffee, fontSize: 14, lineHeight: 1.6 }}>{body}</div>
      {cta && (
        <a
          href={cta.href}
          style={{
            display: "inline-block",
            marginTop: 12,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.brandPrimary,
            textDecoration: "none",
          }}
        >
          {cta.label} →
        </a>
      )}
    </div>
    <style jsx>{`
      .bbp-step-card:hover { transform: translateY(-3px); box-shadow: 0 18px 36px -16px rgba(21, 17, 26, 0.22); }
      @media (prefers-reduced-motion: reduce) { .bbp-step-card:hover { transform: none; box-shadow: 0 4px 14px rgba(21, 17, 26, 0.06); } }
    `}</style>
  </article>
);

// Phone mockup — a stylized iPhone-shaped frame used by the PWA
// install section to illustrate the home-screen install dialog.
// SVG-built so it stays crisp at any size.
export const PhoneMockup = ({
  children,
  label,
  tone = "ios",
}: {
  children?: ReactNode;
  label: string;
  tone?: "ios" | "android";
}) => (
  <div
    style={{
      width: "100%",
      maxWidth: 200,
      aspectRatio: "9 / 19",
      borderRadius: 32,
      background: "#15111A",
      padding: 8,
      boxShadow: SHADOWS.cardLifted,
      position: "relative",
    }}
  >
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 24,
        background: GRADIENTS.softA,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Notch / pill */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          width: tone === "ios" ? 72 : 14,
          height: 14,
          borderRadius: 999,
          background: "#15111A",
        }}
      />
      <div style={{ flex: 1, padding: "36px 12px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 10 }}>
        {children || (
          <>
            <div
              aria-hidden
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: GRADIENTS.primary,
                boxShadow: SHADOWS.primaryGlow,
              }}
            />
            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.brandPrimary, margin: 0 }}>
              Braid Boss Pro
            </p>
          </>
        )}
      </div>
      <p
        style={{
          textAlign: "center",
          fontSize: 9,
          fontWeight: 700,
          color: C.muted,
          padding: "6px 4px 10px",
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        {label}
      </p>
    </div>
  </div>
);
