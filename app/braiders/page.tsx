import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";
import { STYLE_TAGS } from "../lib/marketplace";
import { getListedStylists, groupCities } from "../lib/directory";

// ISR: rebuild at most every 30 min so newly-listed stylists/cities show
// up without rendering on every request.
export const revalidate = 1800;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app";

export const metadata: Metadata = {
  title: "Find a Braider — Browse Braid Stylists by City & Style",
  description:
    "Browse and book braid stylists by city and by style — knotless, boho, box braids, locs, twists, cornrows, and more. Every stylist takes bookings directly through Braid Boss Pro.",
  alternates: { canonical: "/braiders" },
  keywords: [
    "find a braider",
    "braid stylists near me",
    "book a braider",
    "braiders by city",
    "knotless braids near me",
    "loctitian near me",
  ],
  openGraph: {
    title: "Find a Braider — Browse by City & Style",
    description: "Browse and book braid stylists by city and by style, directly through Braid Boss Pro.",
    url: "/braiders",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Find a Braider — Browse by City & Style",
    description: "Browse and book braid stylists by city and by style.",
  },
};

export default async function BraidersHubPage() {
  const stylists = await getListedStylists();
  const cities = groupCities(stylists);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Find a Braider", item: `${SITE_URL}/braiders` },
    ],
  };
  const styleList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Braid styles",
    itemListElement: STYLE_TAGS.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${s.label} braiders`,
      url: `${SITE_URL}/braiders/style/${s.slug}`,
    })),
  };

  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(styleList) }} />

      <MarketingHero
        eyebrow="Find a braider"
        title={
          <>
            Find your braider by{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              city & style.
            </em>
          </>
        }
        body="Browse braid stylists who take bookings on Braid Boss Pro — filter by the style you want or the city you're in, then book directly. No middleman, no booking fees added to you."
        primaryCta={{ label: "Search with a photo", href: "/discover" }}
        secondaryCta={{ label: "Are you a braider? Get listed", href: "/?signup=1" }}
      />

      {/* Styles */}
      <Section
        eyebrow="Browse by style"
        title="What are you getting done?"
        intro="Pick a style to see the braiders who specialize in it."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {STYLE_TAGS.map((s) => (
            <Link
              key={s.slug}
              href={`/braiders/style/${s.slug}`}
              className="bbp-reveal"
              style={{
                display: "block",
                padding: "16px 18px",
                borderRadius: 14,
                background: C.paper,
                border: `1px solid ${C.brandBorder}`,
                boxShadow: SHADOWS.card,
                textDecoration: "none",
                color: C.ink,
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              {s.label}
              <span style={{ display: "block", marginTop: 4, fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.brandPrimary }}>
                Braiders →
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* Cities */}
      {cities.length > 0 && (
        <Section
          eyebrow="Browse by city"
          title="Braiders in your area."
          intro="These cities have braid stylists taking bookings right now."
          background="#FBFAFD"
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {cities.map((c) => (
              <Link
                key={c.slug}
                href={`/braiders/city/${c.slug}`}
                className="bbp-reveal"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: C.paper,
                  border: `1px solid ${C.brandBorder}`,
                  boxShadow: SHADOWS.card,
                  textDecoration: "none",
                  color: C.ink,
                }}
              >
                <MapPin size={16} aria-hidden style={{ color: C.brandPrimary, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>
                  {c.count} {c.count === 1 ? "braider" : "braiders"}
                </span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Interactive search cross-link */}
      <Section background={cities.length > 0 ? C.paper : "#FBFAFD"}>
        <div
          className="bbp-reveal"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "22px 24px",
            borderRadius: 20,
            background: GRADIENTS.softA,
            border: `1px solid ${C.brandBorder}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: GRADIENTS.primary, color: "#FFFFFF", boxShadow: SHADOWS.primaryGlow }}>
              <Search size={18} />
            </span>
            <div>
              <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink }}>
                Have an inspo photo?
              </p>
              <p style={{ margin: "2px 0 0", color: C.coffee, fontSize: 13.5 }}>
                Upload it and our AI matches you to braiders who do that exact style.
              </p>
            </div>
          </div>
          <Link
            href="/discover"
            style={{
              padding: "12px 20px",
              borderRadius: 14,
              background: GRADIENTS.primary,
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              textDecoration: "none",
              boxShadow: SHADOWS.primaryGlow,
            }}
          >
            Try photo search
          </Link>
        </div>
      </Section>

      <CtaFooter
        title="Are you a braider? Get discovered."
        body="List your booking page on Braid Boss Pro and show up when clients search your city and styles. Start with a 14-day free trial — every feature unlocked."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
