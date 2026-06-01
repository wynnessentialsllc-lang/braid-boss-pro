import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../components/marketing/MarketingShell";
import { C } from "../../components/marketing/tokens";

export const metadata: Metadata = {
  title: "The Best Booking App for Braiders in 2026",
  description:
    "Honest, side-by-side guide to the best booking apps for braid stylists in 2026. We compare Braid Boss Pro, StyleSeat, Vagaro, Square Appointments, and GlossGenius on price, deposits, contracts, and braider-specific workflow.",
  alternates: { canonical: "/guides/best-booking-app-for-braiders" },
  keywords: [
    "best booking app for braiders",
    "best booking app for braid stylists",
    "booking app for braiders 2026",
    "salon software for braiders",
    "how to take deposits as a braider",
    "Stripe Connect for braiders",
  ],
  openGraph: {
    title: "The Best Booking App for Braiders in 2026",
    description: "Honest, side-by-side guide for braid stylists choosing booking software.",
    url: "/guides/best-booking-app-for-braiders",
    type: "article",
  },
};

const Card = ({
  rank,
  name,
  price,
  pros,
  cons,
  verdict,
  href,
  cta,
}: {
  rank: string;
  name: string;
  price: string;
  pros: string[];
  cons: string[];
  verdict: string;
  href?: string;
  cta?: string;
}) => (
  <div
    className="bbp-reveal"
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 18,
      padding: 22,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <div>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: C.brandPrimary, margin: 0 }}>{rank}</p>
        <h3 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: "4px 0 0" }}>{name}</h3>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.coffee, textAlign: "right", whiteSpace: "nowrap" }}>{price}</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.brandSuccess, margin: "0 0 6px" }}>Pros</p>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.55, color: C.coffee }}>
          {pros.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </div>
      <div>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E0354F", margin: "0 0 6px" }}>Cons</p>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.55, color: C.coffee }}>
          {cons.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: C.ink, margin: 0, fontStyle: "italic" }}>{verdict}</p>
    {href && cta && (
      <Link
        href={href}
        style={{
          alignSelf: "flex-start",
          fontSize: 13,
          fontWeight: 700,
          color: C.brandPrimary,
          textDecoration: "none",
          marginTop: 2,
        }}
      >
        {cta} →
      </Link>
    )}
  </div>
);

// Article structured data — lets search engines and AI assistants treat
// this page as an authored, dated guide (eligible for article rich
// results and easier to cite) rather than an anonymous marketing page.
const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "The Best Booking App for Braiders in 2026",
  description:
    "Honest, side-by-side guide to the best booking apps for braid stylists in 2026 — Braid Boss Pro, StyleSeat, Vagaro, Square Appointments, and GlossGenius compared on price, deposits, contracts, and braider-specific workflow.",
  about: ["Booking software for braid stylists", "Salon software", "Hair appointment apps"],
  datePublished: "2026-01-01",
  dateModified: "2026-06-01",
  inLanguage: "en-US",
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": "https://braidbosspro.app/guides/best-booking-app-for-braiders",
  },
  author: { "@type": "Organization", name: "Braid Boss Pro", url: "https://braidbosspro.app" },
  publisher: {
    "@type": "Organization",
    name: "Braid Boss Pro",
    url: "https://braidbosspro.app",
    logo: { "@type": "ImageObject", url: "https://braidbosspro.app/icons/icon-512.png" },
  },
};

export default function GuidePage() {
  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <MarketingHero
        eyebrow="Guide · Updated 2026"
        title={
          <>
            The best booking app for braiders{" "}
            <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>in 2026.</em>
          </>
        }
        body="Honest, side-by-side breakdown of the booking and business apps braid stylists actually use — what they cost, what's included, and which one fits the way braiders run their chairs."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See full pricing", href: "/pricing" }}
      />

      <Section eyebrow="The shortlist" title="Five apps stylists actually consider">
        <p style={{ fontSize: 15, lineHeight: 1.7, color: C.coffee, maxWidth: 720, margin: "0 auto 30px", textAlign: "center" }}>
          We focused on tools real braiders mention: <strong>Braid Boss Pro</strong>, <strong>StyleSeat</strong>, <strong>Vagaro</strong>, <strong>Square Appointments</strong>, and <strong>GlossGenius</strong>. We weighed the things braiders need most — deposits on long appointments, hair-included pricing, contracts, a real client list you own, and a price that doesn&apos;t scale with each new client.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, maxWidth: 1000, margin: "0 auto" }}>
          <Card
            rank="#1 · Best for braiders"
            name="Braid Boss Pro"
            price="$14.99/mo · 14-day free trial"
            pros={[
              "Built specifically for braid work — hair-included pricing, long-appointment deposits",
              "Branded /@handle booking link (Linktree-style)",
              "Stripe Connect — you own your payouts and your client list",
              "Pricing calculator, contracts, retail storefront, marketing automation — all included",
              "No per-staff or per-client fees",
              "Installs as a PWA — no app store",
            ]}
            cons={[
              "No built-in marketplace discovery (your own booking link is your storefront)",
              "Newer to market than StyleSeat or Vagaro",
            ]}
            verdict="If you&apos;re a braider running a solo chair or small team, this is the most braider-aligned option on the market — and the cheapest of the lot with no per-staff or per-client fees."
            href="/?signup=1"
            cta="Start free trial"
          />
          <Card
            rank="#2 · Best built-in marketplace"
            name="StyleSeat"
            price="$35/mo + $1 per new client + booking fees"
            pros={[
              "Built-in marketplace brings walk-in client discovery",
              "Strong brand recognition among hair clients",
              "Public reviews built in",
            ]}
            cons={[
              "$1 fee on every new client",
              "Client booking fee (up to $7.99) tacked on top",
              "Holds your payouts (no direct Stripe Connect ownership)",
              "Client list is locked behind the platform",
            ]}
            verdict="A strong day-one option if you have zero following and need the marketplace pipeline — but the per-client fees and lack of ownership make it expensive once your book is full."
            href="/compare/braid-boss-pro-vs-styleseat"
            cta="Read full comparison"
          />
          <Card
            rank="#3 · Best for multi-service salons"
            name="Vagaro"
            price="$30+/mo · scales per staff member"
            pros={[
              "Mature, all-in-one salon platform",
              "Marketplace presence (Find Beauty Pros)",
              "Strong if you offer hair + nails + skin + lashes together",
            ]}
            cons={[
              "Per-staff pricing climbs fast on a multi-chair team",
              "Built around generic clinical appointments, not long braid installs",
              "Vagaro Pay processes payments — not direct Stripe ownership",
            ]}
            verdict="Right pick for a multi-service salon owner who needs one back office for hair + nails + skin. Over-built and over-priced for a solo or small braid-focused chair."
            href="/compare/braid-boss-pro-vs-vagaro"
            cta="Read full comparison"
          />
          <Card
            rank="#4 · Best free tier"
            name="Square Appointments"
            price="$0 free tier · $29 Plus · per-staff fees apply"
            pros={[
              "Free tier for solo stylists",
              "Strong retail + tap-to-pay hardware ecosystem",
              "Reliable payment processing",
            ]}
            cons={[
              "Reminders, marketing, contracts are paid add-ons that erase the &quot;free&quot; advantage",
              "Built around quick clinical appointments, not 8-hour braid installs",
              "Per-staff fees as you grow",
            ]}
            verdict="Solid if you already use Square for retail and need basic appointment booking with zero monthly fee. Once you need braider workflow features, add-on creep makes it pricier than Braid Boss Pro."
            href="/compare/braid-boss-pro-vs-square-appointments"
            cta="Read full comparison"
          />
          <Card
            rank="#5 · Best UI design"
            name="GlossGenius"
            price="$24+/mo · scales by tier"
            pros={[
              "Beautiful, polished UI",
              "Built-in card reader",
              "Good basic marketing automation",
            ]}
            cons={[
              "Built for general beauty, not braiders specifically",
              "No hair-included pricing model out of the box",
              "Pricing tier limits features even at $24/mo",
            ]}
            verdict="A nice-looking pick for general beauty pros. Solid for nails or lashes, less tuned for the hair-included, long-appointment world braiders live in."
          />
        </div>
      </Section>

      <Section eyebrow="How to choose" title="The 4 questions that matter" background="#FBFAFD">
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18, fontSize: 15, lineHeight: 1.7, color: C.coffee }}>
          <div>
            <p style={{ fontWeight: 800, color: C.ink, margin: "0 0 4px" }}>1. Does it understand hair-included pricing?</p>
            <p style={{ margin: 0 }}>Generic salon software treats every service like a 60-minute clinical visit. Braid Boss Pro models hair cost, length variations, take-down, and travel as separate line items in a calculator — so you stop quoting from memory.</p>
          </div>
          <div>
            <p style={{ fontWeight: 800, color: C.ink, margin: "0 0 4px" }}>2. Do you own your client list and your payouts?</p>
            <p style={{ margin: 0 }}>StyleSeat locks your clients behind the platform; Vagaro and Square process your payments through their own systems. Braid Boss Pro uses Stripe Connect — your money lands in YOUR Stripe account same-day, your client list is exportable any time.</p>
          </div>
          <div>
            <p style={{ fontWeight: 800, color: C.ink, margin: "0 0 4px" }}>3. What&apos;s the true monthly cost?</p>
            <p style={{ margin: 0 }}>Add up the add-ons. SMS reminders, marketing automation, contracts, retail — most platforms charge separately for each. Braid Boss Pro is $14.99 flat with everything included.</p>
          </div>
          <div>
            <p style={{ fontWeight: 800, color: C.ink, margin: "0 0 4px" }}>4. Does it scale with you?</p>
            <p style={{ margin: 0 }}>If you add a chair, do you pay double? Vagaro and Square charge per staff. Braid Boss Pro doesn&apos;t — same flat price as your team grows.</p>
          </div>
        </div>
      </Section>

      <CtaFooter
        title="The booking app built for the way braiders work."
        body="14-day free trial. Then $14.99/month — every feature unlocked. Cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See features", href: "/features" }}
      />
    </MarketingShell>
  );
}
