import type { Metadata } from "next";
import {
  Sparkles,
  Check,
  Crown,
  ArrowRight,
  ShieldCheck,
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
  title: "Pricing · Braid Boss Pro — Founding Stylist Lifetime Access",
  description:
    "Free to start. First 100 founding stylists get lifetime access to the full booking app — booking links, deposits, storefronts, contracts, analytics. Future users move to monthly subscription pricing.",
  alternates: { canonical: "/pricing" },
  keywords: [
    "braider booking app pricing",
    "booking app for braiders cost",
    "braid business software pricing",
    "hairstylist booking app price",
    "braider scheduling app subscription",
    "booking system for braiders pricing",
  ],
  openGraph: {
    title: "Pricing · Braid Boss Pro — Founding Stylist Lifetime Access",
    description:
      "Free to start. First 100 founding stylists get lifetime access. Future users move to monthly subscription pricing.",
    url: "/pricing",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing · Braid Boss Pro",
    description:
      "First 100 founding stylists get lifetime access to the full booking app.",
  },
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Founding Stylist Pricing"
        title={
          <>
            Lock in lifetime access.{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Forever.
            </em>
          </>
        }
        body="The first 100 stylists to sign up get lifetime access to the full Braid Boss Pro booking + commerce app — no monthly fee, ever. After that, future stylists move to monthly subscription pricing."
        primaryCta={{ label: "Claim founding access", href: "/" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />

      {/* Pricing tiers */}
      <Section eyebrow="The offer" title="Two tiers. One window.">
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
            badge="Founding Stylist · First 100"
            title="Lifetime access"
            price="$0"
            cadence="forever"
            description="The same full booking + commerce app every future subscriber will pay monthly for — yours for life, no recurring fee."
            features={[
              "Booking links + branded /@handle URL",
              "Stripe Connect direct charges",
              "Deposits, balances, cancellations",
              "Contracts + e-sign",
              "Pricing calculator + saved quotes",
              "Retail storefront + product variants",
              "Order management + tracking",
              "Reminder automation",
              "Mobile dashboard + PWA install",
              "All future feature updates included",
            ]}
            cta={{ label: "Claim my spot", href: "/" }}
          />
          <PricingCard
            tone="subscriber"
            badge="After the first 100"
            title="Monthly subscription"
            price="$TBA"
            cadence="per month"
            description="Future stylists subscribe to keep the same toolset active. Founding stylists are grandfathered in at $0 forever."
            features={[
              "Same complete feature set",
              "Cancel anytime",
              "All future updates included",
              "Stripe Connect direct charges",
              "Live customer support",
            ]}
            cta={{ label: "Join the waitlist", href: "/" }}
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
          Stripe processing fees are separate (~2.9% + 30¢ per charge) and go
          to Stripe — not to Braid Boss Pro. We never custody your funds; every
          deposit, balance, and product sale lands directly in your Stripe
          account.
        </div>
      </Section>

      {/* Why founding access */}
      <Section
        eyebrow="Why founding access?"
        title="We're building this with you."
        intro="Founding stylists shape the roadmap. You get the early-builder pricing forever; we get the feedback that makes Braid Boss Pro the best tool for braiders."
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
            title="Lifetime access"
            body="No monthly fee, ever. As long as the app runs, you're in."
          />
          <Benefit
            icon={<Zap size={20} />}
            title="Early roadmap input"
            body="Direct line to the team. Your feedback ships first."
          />
          <Benefit
            icon={<ShieldCheck size={20} />}
            title="Grandfathered forever"
            body="When monthly pricing turns on for new stylists, you stay at $0."
          />
        </div>
      </Section>

      <CtaFooter
        title="Only 100 founding spots. They don't come back."
        body="Create your account in under 10 minutes and lock in lifetime access before the seats fill."
        primaryCta={{ label: "Claim my founding spot", href: "/" }}
        secondaryCta={{ label: "Read the FAQ", href: "/faq" }}
      />
    </MarketingShell>
  );
}

// ---- Pricing card --------------------------------------------------------

const PricingCard = ({
  tone,
  badge,
  title,
  price,
  cadence,
  description,
  features,
  cta,
}: {
  tone: "founding" | "subscriber";
  badge: string;
  title: string;
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
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
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

      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
        {features.map((f) => (
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
