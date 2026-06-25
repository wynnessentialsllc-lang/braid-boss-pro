import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import {
  Breadcrumbs,
  FaqAccordion,
  GradientText,
} from "../components/marketing/FeaturePageKit";
import FeatureSchema, { type FaqEntry } from "../components/marketing/FeatureSchema";
import { FEATURE_PAGES, featurePath } from "../lib/feature-pages";
import { C, FONT_DISPLAY, SHADOWS } from "../components/marketing/tokens";
import { ArrowRight, Check } from "lucide-react";

const PATH = "/why-braid-boss-pro";

export const metadata: Metadata = {
  title: "Why Braid Boss Pro · The All-in-One Platform for Braiders",
  description:
    "Braid Boss Pro is an all-in-one business platform built specifically for professional braiders — bookings, deposits, inventory, AI tools, contracts, storefront, memberships, marketing, profile, and analytics in one mobile-first system.",
  alternates: { canonical: PATH },
  keywords: [
    "why Braid Boss Pro",
    "all-in-one platform for braiders",
    "business platform for braiders",
    "software for professional braiders",
  ],
  openGraph: {
    title: "Why Braid Boss Pro · The All-in-One Platform for Braiders",
    description:
      "The all-in-one business platform built specifically for professional braiders. One mobile-first system for bookings, deposits, inventory, AI, contracts, and growth.",
    url: PATH,
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Why Braid Boss Pro",
    description: "The all-in-one business platform built specifically for professional braiders.",
  },
};

// The before/after rows — the core argument of the page.
const COMPARISON: Array<{ before: string; after: string }> = [
  { before: "Searching for deposit screenshots", after: "Deposits tracked automatically" },
  { before: "Guessing inventory levels", after: "Real-time inventory tracking" },
  { before: "Answering pricing questions manually", after: "Build Your Style and AI quote support" },
  { before: "Forgetting to follow up", after: "Automated reminders and rebooking" },
  {
    before: "Using separate apps for booking, payments, products, and messages",
    after: "One platform built for braiders",
  },
  { before: "Manually managing policies", after: "Digital contracts and client portals" },
  { before: "Losing repeat clients", after: "Retention and win-back tools" },
];

// Pillars — each links to the dedicated feature page so the overview
// page distributes crawl equity to all of them.
const PILLARS: Array<{ title: string; body: string; slug?: string }> = [
  {
    title: "Built specifically for professional braiders",
    body: "Not generic salon software — every workflow is shaped around braid work, from hair-included pricing to long-appointment deposits.",
  },
  {
    title: "Booking and scheduling",
    body: "A branded booking microsite, real-time availability, intake forms, and self-service rescheduling.",
    slug: "booking-software-for-braiders",
  },
  {
    title: "Payments and deposits",
    body: "Stripe Connect deposits, balances, tips, no-show protection, Tap to Pay, and a ledger you own.",
    slug: "payments-and-deposits",
  },
  {
    title: "Inventory management",
    body: "Track braiding hair by color, length, quantity, and cost, with low-stock visibility and a profit calculator.",
    slug: "braiding-hair-inventory-management",
  },
  {
    title: "AI tools",
    body: "A business coach, social media studio, rebooking assistant, style consultant, and booking concierge.",
    slug: "ai-tools-for-braiders",
  },
  {
    title: "Digital contracts",
    body: "Tokenized e-sign agreements that protect your policies on every appointment.",
    slug: "digital-contracts-for-braiders",
  },
  {
    title: "Storefront",
    body: "Sell hair, products, and gift cards with multi-variant listings, pickup, delivery, and Shippo shipping.",
    slug: "storefront-and-product-sales",
  },
  {
    title: "Memberships",
    body: "Prepaid visit bundles, credit packages, and recurring memberships with public buy pages.",
    slug: "memberships-and-packages",
  },
  {
    title: "Marketing and retention",
    body: "Confirmations, opt-in reminders, review requests, rebooking, win-back, and segmented blasts.",
    slug: "marketing-and-client-retention",
  },
  {
    title: "Public profile and marketplace",
    body: "A link-in-bio stylist profile with gallery, reviews, and a book-now CTA, plus a discover marketplace.",
    slug: "braider-marketplace-and-profile",
  },
  {
    title: "Analytics and admin tools",
    body: "A mobile-first dashboard with the revenue, retention, and deposit numbers you run your business on.",
    slug: "business-management-software-for-braiders",
  },
];

const FAQS: FaqEntry[] = [
  {
    q: "What is Braid Boss Pro?",
    a: "Braid Boss Pro is an all-in-one business platform built specifically for professional braiders, helping you manage bookings, deposits, inventory, contracts, client communication, product sales, and growth from one mobile-first system.",
  },
  {
    q: "Who is Braid Boss Pro for?",
    a: "It's built for professional braiders, loctitians, and natural-hair stylists — solo chairs and small teams who want one platform instead of stitching together a booking app, a payment app, a spreadsheet, and a messaging tool.",
  },
  {
    q: "How is it different from generic salon software?",
    a: "Generic salon tools treat every appointment like a quick clinical visit. Braid Boss Pro is shaped around braid work — variations and hair-included pricing, deposits for long installs, Build Your Style requests, and inventory for braiding hair.",
  },
  {
    q: "How much does Braid Boss Pro cost?",
    a: "Braid Boss Pro is $14.99/month (or $149/year) after a 14-day free trial, with every feature unlocked. There are no contracts and you can cancel anytime.",
  },
  {
    q: "Do I keep ownership of my clients and payments?",
    a: "Yes. Your client list is exportable and yours, and payments run through Stripe Connect directly to your own account — Braid Boss Pro never custodies your funds.",
  },
];

export default function WhyBraidBossProPage() {
  return (
    <MarketingShell>
      <FeatureSchema
        path={PATH}
        breadcrumbName="Why Braid Boss Pro"
        faqs={FAQS}
        software={{
          name: "Braid Boss Pro",
          description:
            "An all-in-one business platform built specifically for professional braiders — bookings, deposits, inventory, AI tools, contracts, storefront, memberships, marketing, public profile, and analytics in one mobile-first system.",
          featureList: PILLARS.map((p) => p.title),
        }}
      />
      <Breadcrumbs
        trail={[
          { label: "Home", href: "/" },
          { label: "Why Braid Boss Pro" },
        ]}
      />

      <MarketingHero
        eyebrow="Why Braid Boss Pro"
        title={
          <>
            One platform, <GradientText>built for braiders.</GradientText>
          </>
        }
        body="Braid Boss Pro is an all-in-one business platform built specifically for professional braiders, helping you manage bookings, deposits, inventory, contracts, client communication, product sales, and growth from one mobile-first system."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <Section
        eyebrow="The pillars"
        title="Everything your braid business runs on."
        intro="Each pillar is a full feature in its own right — explore the ones that matter most to you."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {PILLARS.map((p) => {
            const inner = (
              <>
                <h3
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 700,
                    fontSize: 20,
                    color: C.ink,
                    margin: 0,
                    lineHeight: 1.18,
                  }}
                >
                  {p.title}
                </h3>
                <p style={{ color: C.coffee, fontSize: 13.5, lineHeight: 1.55, margin: 0, flex: 1 }}>
                  {p.body}
                </p>
                {p.slug && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: C.brandPrimary,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Learn more <ArrowRight size={14} />
                  </span>
                )}
              </>
            );
            const cardStyle: React.CSSProperties = {
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: C.paper,
              border: `1px solid ${C.brandBorder}`,
              borderRadius: 18,
              padding: 20,
              boxShadow: SHADOWS.card,
              textDecoration: "none",
            };
            return p.slug ? (
              <Link key={p.title} href={featurePath(p.slug)} className="bbp-reveal" style={cardStyle}>
                {inner}
              </Link>
            ) : (
              <div key={p.title} className="bbp-reveal" style={cardStyle}>
                {inner}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="The difference"
        title="Before Braid Boss Pro vs. with Braid Boss Pro"
        intro="The day-to-day friction braiders know too well — and what it looks like once it's handled."
        background="#FBFAFD"
      >
        <div
          style={{
            background: C.paper,
            border: `1px solid ${C.brandBorder}`,
            borderRadius: 18,
            overflow: "hidden",
            maxWidth: 920,
            margin: "0 auto",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              background: C.brandSurface,
              padding: "14px 18px",
              borderBottom: `1px solid ${C.brandBorder}`,
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.coffee,
              gap: 12,
            }}
          >
            <div>Before Braid Boss Pro</div>
            <div>With Braid Boss Pro</div>
          </div>
          {COMPARISON.map((row, i) => (
            <div
              key={row.before}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                padding: "14px 18px",
                gap: 12,
                borderBottom: i === COMPARISON.length - 1 ? "none" : `1px solid ${C.brandBorder}`,
                background: i % 2 === 1 ? "#FBFAFD" : "transparent",
                alignItems: "flex-start",
              }}
            >
              <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{row.before}</div>
              <div
                style={{
                  fontSize: 13.5,
                  color: C.ink,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <Check size={16} style={{ color: C.brandSuccess, flexShrink: 0, marginTop: 1 }} />
                <span>{row.after}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="FAQ" title="Questions about the platform, answered.">
        <FaqAccordion items={FAQS} />
      </Section>

      <Section eyebrow="Explore" title="Browse every feature">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            maxWidth: 980,
            margin: "0 auto",
          }}
        >
          {FEATURE_PAGES.map((p) => (
            <Link
              key={p.slug}
              href={featurePath(p.slug)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                background: C.paper,
                border: `1px solid ${C.brandBorder}`,
                borderRadius: 12,
                padding: "13px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: C.ink,
                textDecoration: "none",
                boxShadow: SHADOWS.card,
              }}
            >
              {p.navTitle}
              <ArrowRight size={15} style={{ color: C.brandPrimary, flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      </Section>

      <CtaFooter
        title="The all-in-one platform built for braiders."
        body="Start a 14-day free trial — every feature unlocked. Then $14.99/month. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
