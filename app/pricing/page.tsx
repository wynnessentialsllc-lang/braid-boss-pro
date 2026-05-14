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
  title: "Founding Access · Braid Boss Pro — the business OS for braiders",
  description:
    "Lock in lifetime access to Braid Boss Pro — the business operating system for braiders — with a one-time Founding Stylist payment. After the first 100 stylists, the platform transitions to monthly membership pricing.",
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
    "founding stylist access",
  ],
  openGraph: {
    title: "Founding Access · Braid Boss Pro",
    description:
      "One-time Founding Stylist payment. Lifetime access to the business operating system for braiders. After the first 100 stylists, the platform moves to monthly membership pricing.",
    url: "/pricing",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Founding Access · Braid Boss Pro",
    description:
      "One-time Founding Stylist payment. Lifetime access to the business operating system for braiders.",
  },
};

const FOUNDING_PRICE_DOLLARS = 9.99;

export default function PricingPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Founding Access · First 100 stylists"
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
        body="Braid Boss Pro is built specifically for braid stylists — bookings, deposits, contracts, retail storefronts, analytics, and modern creator-economy tools designed around how braiders actually run their chairs. Founding stylists lock in lifetime access at a single one-time payment before the platform transitions to monthly membership pricing."
        primaryCta={{ label: "Claim founding access", href: "/" }}
        secondaryCta={{ label: "See the platform", href: "/features" }}
      />

      {/* Pricing tiers */}
      <Section eyebrow="Founding stylist offer" title="One-time payment. Lifetime access.">
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
            badge="First 100 Users"
            title="Founding Stylist Access"
            subtitle="One-Time Payment · Lifetime Access"
            price={`$${FOUNDING_PRICE_DOLLARS.toFixed(2)}`}
            cadence="one-time"
            description="Lock in lifetime access before Braid Boss Pro transitions to monthly membership pricing. Founding stylists receive early-access pricing, grandfathered platform access, and priority access to future platform upgrades and tools."
            features={[
              "Lifetime platform access — no monthly bill, ever",
              "Branded booking link with your own /@handle",
              "Stripe Connect direct charges + deposits",
              "Contracts + e-sign at booking",
              "Pricing calculator + saved quotes",
              "Retail storefront with variants + inventory",
              "Order management + customer tracking",
              "Reminder + email automation",
              "Mobile dashboard with PWA install",
              "Every future platform upgrade included",
              "Priority access to new tools as they ship",
            ]}
            cta={{ label: "Claim founding access", href: "/" }}
          />
          <PricingCard
            tone="future"
            badge="After the first 100"
            title="Future Membership Pricing"
            subtitle="Monthly Subscription"
            price="$TBA"
            cadence="per month"
            description="After the first 100 founding users, Braid Boss Pro will move to a monthly pricing structure as the platform expands with advanced booking, storefront, automation, analytics, and business tools. Founding stylists are grandfathered in at their one-time rate forever."
            features={[
              "Same complete feature set as Founding Access",
              "Cancel anytime",
              "Every platform upgrade included",
              "Stripe Connect direct charges",
              "Mobile dashboard + PWA install",
            ]}
            cta={{ label: "Join founding access", href: "/" }}
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
          Stripe processing fees (~2.9% + 30¢ per charge) are separate and
          paid to Stripe. Braid Boss Pro never custodies your funds — every
          deposit, balance, and product sale lands directly in your Stripe
          account the same day.
        </div>
      </Section>

      {/* Why founding access */}
      <Section
        eyebrow="Why founding access?"
        title="Built with the first 100 stylists."
        intro="Founding stylists shape the roadmap and lock in pricing before the platform scales. You get the early-builder rate forever — we get the feedback that makes Braid Boss Pro the operating system braiders actually want."
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
            title="Early-access pricing"
            body="A one-time payment unlocks the full platform — no monthly fee for founding stylists, ever."
          />
          <Benefit
            icon={<Zap size={20} />}
            title="Priority roadmap access"
            body="Founding feedback ships first. New tools land on your dashboard ahead of monthly subscribers."
          />
          <Benefit
            icon={<ShieldCheck size={20} />}
            title="Grandfathered forever"
            body="When monthly pricing turns on for the rest of the market, your founding rate stays locked in."
          />
          <Benefit
            icon={<Sparkles size={20} />}
            title="Braid-specific by design"
            body="Variations, hair-included pricing, deposit policies, retail storefronts — built for how braiders work, not generic salon software."
          />
        </div>
      </Section>

      <CtaFooter
        title="The window closes at 100 stylists."
        body="Create your founding account in under 10 minutes. Lock in lifetime access before the platform transitions to monthly membership pricing."
        primaryCta={{ label: "Claim my founding spot", href: "/" }}
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
