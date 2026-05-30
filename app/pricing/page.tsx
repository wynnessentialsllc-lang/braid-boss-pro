import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  Crown,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";

export const metadata: Metadata = {
  title: "Pricing · Braid Boss Pro — the business OS for braiders",
  description:
    "Braid Boss Pro is the business operating system for braiders — bookings, deposits, contracts, storefront, and marketing. Start a 14-day free trial, then $14.99/month. Cancel anytime.",
  alternates: { canonical: "/pricing" },
  keywords: [
    "braid business software",
    "braid business management app",
    "booking app for braiders",
    "braider booking software",
    "braider scheduling app",
    "business tools for braiders",
    "braid pricing software",
    "creator economy braid platform",
    "braider app monthly price",
  ],
  openGraph: {
    title: "Pricing · Braid Boss Pro",
    description:
      "Everything braiders need to run their chair — for $14.99/month. Start with a 14-day free trial. Cancel anytime.",
    url: "/pricing",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing · Braid Boss Pro",
    description:
      "Everything braiders need to run their chair — $14.99/month after a 14-day free trial.",
  },
};

const MONTHLY_PRICE_DOLLARS = 14.99;
const ANNUAL_PRICE_DOLLARS = 149;
const ANNUAL_SAVINGS_DOLLARS = 30.88; // $14.99 × 12 = $179.88 → save $30.88
const TRIAL_DAYS = 14;

export default function PricingPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Simple pricing · 14-day free trial"
        title={
          <>
            The business operating system{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              for braiders.
            </em>
          </>
        }
        body="Braid Boss Pro is built specifically for braid stylists — bookings, deposits, contracts, retail storefronts, analytics, and modern creator-economy tools designed around how braiders actually run their chairs. Every feature included. Start free for 14 days, then just $14.99/month — or $149/year (save $30.88). Less than every major salon app, with no per-staff fees."
        primaryCta={{ label: "Start Your Free Trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See the platform", href: "/features" }}
      />

      {/* Pricing */}
      <Section eyebrow="One simple plan" title="Everything included. $14.99/mo or $149/yr.">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <span
            className="bbp-reveal"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 16px",
              borderRadius: 999,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            <Sparkles size={13} aria-hidden /> Built Specifically for Braiders
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 18,
            alignItems: "stretch",
          }}
        >
          <PricingCard
            tone="founding"
            badge="14-Day Free Trial"
            title="Braid Boss Pro"
            subtitle={`$${ANNUAL_PRICE_DOLLARS}/year option · save $${ANNUAL_SAVINGS_DOLLARS.toFixed(2)}`}
            price={`$${MONTHLY_PRICE_DOLLARS.toFixed(2)}`}
            cadence="/month"
            description={`Try every feature free for ${TRIAL_DAYS} days — no charge until your trial ends. Or go annual at $${ANNUAL_PRICE_DOLLARS}/year and save $${ANNUAL_SAVINGS_DOLLARS.toFixed(2)} (about 2 months free). No contracts. Cancel anytime.`}
            features={[
              "Online Booking",
              "Deposits & Payments",
              "Digital Contracts",
              "Appointment Reminders",
              "Client Management CRM",
              "Reviews & Testimonials",
              "Business Analytics",
              "Expense Tracking",
              "Education Hub",
              "Mobile App Access",
            ]}
            cta={{ label: "Start Your Free Trial", href: "/?signup=1" }}
          />
          <PricingCard
            tone="future"
            badge="Grandfathered members"
            title="You're set — forever"
            subtitle="Lifetime access"
            price="Lifetime"
            cadence="already yours"
            description="Already have a lifetime unlock on your account? You keep full access forever at no monthly cost — nothing changes for you, and there's nothing to do. The monthly plan only applies to new stylists joining now."
            features={[
              "Lifetime access stays active — no monthly bill",
              "Every current and future feature included",
              "No action needed",
              "Same account, same data, same login",
            ]}
            cta={{ label: "Open the app", href: "/" }}
          />
        </div>

        <div
          className="bbp-reveal"
          style={{
            marginTop: 28,
            padding: 18,
            background: "#FBFAFD",
            border: `1px dashed ${C.brandBorder}`,
            borderRadius: 18,
            color: C.coffee,
            fontSize: 13.5,
            lineHeight: 1.55,
            textAlign: "center",
          }}
        >
          <strong style={{ color: C.brandPrimary }}>Note:</strong>{" "}
          Stripe processing fees (~2.9% + 30¢ per charge) on your clients&apos;
          deposits and payments are separate and paid to Stripe. Braid Boss Pro
          never custodies your funds — every deposit, balance, and product sale
          lands directly in your Stripe account the same day.
        </div>
      </Section>

      {/* Why Braid Boss Pro */}
      <Section
        eyebrow="Why Braid Boss Pro?"
        title="More than booking — your whole business."
        intro="Most salon apps charge $24–$48/month and tack on per-staff fees. Braid Boss Pro is one flat $14.99 — bookings, payments, contracts, storefront, and marketing — built around how braiders actually work."
        background="#FBFAFD"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          <Benefit
            icon={<Crown size={20} />}
            title="Lower, flat pricing"
            body="$14.99/month, everything included — and no per-staff charges like the other apps."
          />
          <Benefit
            icon={<Zap size={20} />}
            title="Try it free for 14 days"
            body="Take real bookings and get paid before you ever pay us. Cancel anytime, no questions."
          />
          <Benefit
            icon={<ShieldCheck size={20} />}
            title="Your money, same day"
            body="Payments land directly in your own Stripe account. We never custody your funds or mark up card fees."
          />
          <Benefit
            icon={<Sparkles size={20} />}
            title="Braid-specific by design"
            body="Variations, hair-included pricing, deposit policies, retail storefronts — built for braiders, not generic salon software."
          />
        </div>
      </Section>

      <CtaFooter
        title="Start free. Pay when you're ready."
        body={`Create your account in under 10 minutes and try every feature free for ${TRIAL_DAYS} days. Then it's just $14.99/month — or $149/year. No contracts. Cancel anytime.`}
        primaryCta={{ label: "Start Your Free Trial", href: "/?signup=1" }}
        secondaryCta={{ label: "Read the FAQ", href: "/faq" }}
      />
    </MarketingShell>
  );
}

// ---- Pricing card ----------------------------------------------------------

const PricingCard = ({
  tone,
  badge,
  title,
  subtitle,
  price,
  cadence,
  description,
  features,
  cta,
}: {
  tone: "founding" | "future";
  badge: string;
  title: string;
  subtitle: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
}) => {
  const isFounding = tone === "founding";
  return (
    <article
      className="bbp-reveal"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 24,
        padding: 26,
        background: isFounding ? C.paper : "#FBFAFD",
        border: `${isFounding ? 2 : 1}px solid ${isFounding ? "transparent" : C.brandBorder}`,
        backgroundImage: isFounding
          ? `linear-gradient(${C.paper}, ${C.paper}), ${GRADIENTS.primary}`
          : undefined,
        backgroundOrigin: isFounding ? "border-box" : undefined,
        backgroundClip: isFounding ? "padding-box, border-box" : undefined,
        boxShadow: isFounding ? SHADOWS.cardLifted : SHADOWS.card,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {isFounding && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -120,
            right: -60,
            width: 240,
            height: 240,
            borderRadius: 999,
            background:
              "conic-gradient(from 200deg, rgba(124, 58, 237, 0.20), rgba(255, 77, 109, 0.20))",
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          alignSelf: "flex-start",
          padding: "5px 12px",
          borderRadius: 999,
          background: isFounding ? GRADIENTS.primary : C.brandBorder,
          color: isFounding ? "#FFFFFF" : C.muted,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          boxShadow: isFounding ? SHADOWS.primaryGlow : "none",
        }}
      >
        {isFounding && <Crown size={12} aria-hidden />}
        {badge}
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
          {title}
        </h3>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: isFounding ? C.brandPrimary : C.muted,
            margin: "6px 0 0",
          }}
        >
          {subtitle}
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
            {price}
          </span>
          <span style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>{cadence}</span>
        </div>
        <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.55, marginTop: 10 }}>
          {description}
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
        {features.map((f) => (
          <li
            key={f}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              color: C.coffee,
              fontSize: 13.5,
              lineHeight: 1.5,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 18,
                height: 18,
                flexShrink: 0,
                borderRadius: 999,
                background: isFounding ? GRADIENTS.primary : "#E8E3F0",
                color: isFounding ? "#FFFFFF" : C.brandPrimary,
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

      <a
        href={cta.href}
        style={{
          position: "relative",
          marginTop: "auto",
          padding: "14px 18px",
          borderRadius: 14,
          background: isFounding ? GRADIENTS.primary : "transparent",
          color: isFounding ? "#FFFFFF" : C.brandPrimary,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          textDecoration: "none",
          textAlign: "center",
          border: isFounding ? 0 : `1.5px solid ${C.brandPrimary}`,
          boxShadow: isFounding ? SHADOWS.primaryGlow : "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {cta.label}
        <ArrowRight size={14} />
      </a>
    </article>
  );
};

const Benefit = ({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) => (
  <article
    className="bbp-reveal"
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 18,
      padding: 18,
      boxShadow: SHADOWS.card,
    }}
  >
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        background: GRADIENTS.primary,
        color: "#FFFFFF",
        boxShadow: SHADOWS.primaryGlow,
        marginBottom: 10,
      }}
    >
      {icon}
    </span>
    <h3
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: 18,
        color: C.ink,
        margin: 0,
        lineHeight: 1.15,
      }}
    >
      {title}
    </h3>
    <p style={{ color: C.coffee, fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>{body}</p>
  </article>
);
