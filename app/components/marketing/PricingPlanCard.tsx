"use client";

// Interactive primary pricing card with a monthly/annual billing toggle.
// Replaces the static "founding" card on /pricing so the $149/year plan
// (previously buried in the FAQ) is visible with its savings inline.
// Emits analytics on toggle + CTA so we can see annual interest and
// which cadence converts.

import { useState } from "react";
import { ArrowRight, Check, Crown } from "lucide-react";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "./tokens";
import { trackEvent } from "../../lib/track";

const MONTHLY_PRICE = 14.99;
const ANNUAL_PRICE = 149;
const TRIAL_DAYS = 14;
// $14.99 × 12 − $149 = $30.88 saved; $149 ÷ 12 ≈ $12.42/mo effective.
const ANNUAL_SAVINGS = (MONTHLY_PRICE * 12 - ANNUAL_PRICE).toFixed(2);
const ANNUAL_PER_MONTH = (ANNUAL_PRICE / 12).toFixed(2);

const FEATURES = [
  "Online Booking",
  "Deposits & Payments",
  "Digital Contracts",
  "Email & SMS Reminders",
  "Client Management CRM",
  "Reviews & Testimonials",
  "Business Analytics",
  "Expense Tracking",
  "Education Hub",
  "Mobile App Access",
];

export function PricingPlanCard() {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const isAnnual = billing === "annual";

  const setCadence = (next: "monthly" | "annual") => {
    setBilling(next);
    trackEvent("pricing_billing_toggle", { category: "pricing", metadata: { billing: next } });
  };

  return (
    <article
      className="bbp-reveal"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 24,
        padding: 26,
        background: C.paper,
        border: "2px solid transparent",
        backgroundImage: `linear-gradient(${C.paper}, ${C.paper}), ${GRADIENTS.primary}`,
        backgroundOrigin: "border-box",
        backgroundClip: "padding-box, border-box",
        boxShadow: SHADOWS.cardLifted,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: -120,
          right: -60,
          width: 240,
          height: 240,
          borderRadius: 999,
          background: "conic-gradient(from 200deg, rgba(124, 58, 237, 0.20), rgba(255, 77, 109, 0.20))",
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          alignSelf: "flex-start",
          padding: "5px 12px",
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
        <Crown size={12} aria-hidden />
        {TRIAL_DAYS}-Day Free Trial
      </div>

      {/* Billing toggle */}
      <div
        role="group"
        aria-label="Choose billing period"
        style={{
          position: "relative",
          display: "inline-flex",
          alignSelf: "flex-start",
          padding: 4,
          borderRadius: 999,
          background: C.brandSurface,
          border: `1px solid ${C.brandBorder}`,
          gap: 4,
        }}
      >
        {(["monthly", "annual"] as const).map((option) => {
          const active = billing === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setCadence(option)}
              aria-pressed={active}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 999,
                border: 0,
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "0.02em",
                background: active ? GRADIENTS.primary : "transparent",
                color: active ? "#FFFFFF" : C.muted,
                boxShadow: active ? SHADOWS.primaryGlow : "none",
                transition: "background 160ms ease, color 160ms ease",
              }}
            >
              {option === "monthly" ? "Monthly" : "Annual"}
              {option === "annual" && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "2px 6px",
                    borderRadius: 999,
                    background: active ? "rgba(255,255,255,0.22)" : "#E8E3F0",
                    color: active ? "#FFFFFF" : C.brandPrimary,
                  }}
                >
                  Save ${ANNUAL_SAVINGS}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ position: "relative" }}>
        <h3
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 28,
            color: C.ink,
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          Braid Boss Pro
        </h3>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.brandPrimary,
            margin: "6px 0 0",
          }}
        >
          {TRIAL_DAYS}-day free trial · cancel anytime
        </p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 44,
              color: C.ink,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {isAnnual ? `$${ANNUAL_PRICE}` : `$${MONTHLY_PRICE.toFixed(2)}`}
          </span>
          <span style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>
            {isAnnual ? "/year" : "/month"}
          </span>
        </div>
        <p style={{ color: C.coffee, fontSize: 13, lineHeight: 1.5, marginTop: 6, minHeight: 20 }}>
          {isAnnual
            ? `That's just $${ANNUAL_PER_MONTH}/mo, billed annually — you save $${ANNUAL_SAVINGS} vs monthly.`
            : "Billed monthly. Switch to annual anytime to save."}
        </p>
        <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.55, marginTop: 10 }}>
          Try every feature free for {TRIAL_DAYS} days — no charge until your trial ends. No contracts.
          Cancel anytime.
        </p>
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "6px 0 0",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          position: "relative",
        }}
      >
        {FEATURES.map((f) => (
          <li
            key={f}
            style={{ display: "flex", alignItems: "flex-start", gap: 8, color: C.coffee, fontSize: 13.5, lineHeight: 1.5 }}
          >
            <span
              aria-hidden
              style={{
                width: 18,
                height: 18,
                flexShrink: 0,
                borderRadius: 999,
                background: GRADIENTS.primary,
                color: "#FFFFFF",
                display: "grid",
                placeItems: "center",
                marginTop: 2,
              }}
            >
              <Check size={11} />
            </span>
            {f}
          </li>
        ))}
      </ul>

      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full reload to remount the app signup gate, which reads ?signup=1 on mount */}
      <a
        href="/?signup=1"
        onClick={() =>
          trackEvent("pricing_cta_click", { category: "activation", metadata: { billing, location: "pricing_plan_card" } })
        }
        style={{
          position: "relative",
          marginTop: "auto",
          padding: "14px 18px",
          borderRadius: 14,
          background: GRADIENTS.primary,
          color: "#FFFFFF",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          textDecoration: "none",
          textAlign: "center",
          border: 0,
          boxShadow: SHADOWS.primaryGlow,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        Start Your Free Trial
        <ArrowRight size={14} />
      </a>
    </article>
  );
}
