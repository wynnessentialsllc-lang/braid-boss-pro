import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { C, FONT_DISPLAY, SHADOWS } from "../components/marketing/tokens";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Guides for Braiders · Braid Boss Pro",
  description:
    "Practical guides for professional braiders — choosing booking software, taking deposits, pricing braid work, and growing your business. Honest, braider-focused advice from Braid Boss Pro.",
  alternates: { canonical: "/guides" },
  openGraph: {
    title: "Guides for Braiders · Braid Boss Pro",
    description: "Practical, braider-focused guides on booking software, deposits, pricing, and growth.",
    url: "/guides",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Guides for Braiders · Braid Boss Pro",
    description: "Practical, braider-focused guides on booking software, deposits, pricing, and growth.",
  },
};

const GUIDES: Array<{ href: string; title: string; blurb: string }> = [
  {
    href: "/guides/best-booking-app-for-braiders",
    title: "The Best Booking App for Braiders in 2026",
    blurb:
      "An honest, side-by-side breakdown of the booking and business apps braiders actually use — price, deposits, contracts, and braider-specific workflow compared.",
  },
];

export default function GuidesIndexPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Guides"
        title={
          <>
            Guides for{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              professional braiders.
            </em>
          </>
        }
        body="Straight-talking guides on the decisions braiders face — what software to use, how to take deposits, how to price your work, and how to grow a business you own."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />

      <Section eyebrow="Latest" title="Read the guides">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 16,
            maxWidth: 900,
            margin: "0 auto",
          }}
        >
          {GUIDES.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="bbp-reveal"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: C.paper,
                border: `1px solid ${C.brandBorder}`,
                borderRadius: 18,
                padding: 22,
                boxShadow: SHADOWS.card,
                textDecoration: "none",
              }}
            >
              <h2
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 22,
                  color: C.ink,
                  margin: 0,
                  lineHeight: 1.15,
                }}
              >
                {g.title}
              </h2>
              <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.55, margin: 0, flex: 1 }}>
                {g.blurb}
              </p>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: C.brandPrimary,
                  fontSize: 13,
                  fontWeight: 700,
                  marginTop: 2,
                }}
              >
                Read guide <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <CtaFooter
        title="Put the advice to work."
        body="Start a 30-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "Browse features", href: "/features" }}
      />
    </MarketingShell>
  );
}
