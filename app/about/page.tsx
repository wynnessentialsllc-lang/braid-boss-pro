import type { Metadata } from "next";
import {
  MarketingShell,
  MarketingHero,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { FounderStory } from "../components/marketing/FounderStory";

export const metadata: Metadata = {
  title: "About Braid Boss Pro — built by a braider, for braiders",
  description:
    "Braid Boss Pro was built at a working braid chair (SBW Braiding) to replace the notes-app-and-three-payment-apps way of running a braid business. Meet the story, mission, and the people behind it.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Braid Boss Pro — built by a braider, for braiders",
    description:
      "The story behind Braid Boss Pro: built at a real braid chair to give braiders one place to run bookings, deposits, contracts, retail, and marketing.",
    url: "/about",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "About Braid Boss Pro",
    description:
      "Built at a real braid chair, for braiders — the story and mission behind Braid Boss Pro.",
  },
};

// Standalone Organization node. The root layout emits SoftwareApplication;
// this adds the company entity with logo, contact, and postal address
// (the same NAP shown in the footer) for entity/knowledge-panel SEO.
// sameAs is intentionally omitted until verified social profiles exist —
// add them here when ready.
const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Braid Boss Pro",
  legalName: "Wynn Essentials, LLC",
  url: "https://braidbosspro.app",
  logo: "https://braidbosspro.app/icons/icon-512.png",
  email: "hello@braidbosspro.app",
  telephone: "+1-213-267-0825",
  description:
    "Braid Boss Pro is the business operating system for braid stylists — booking links, deposits, contracts, retail storefronts, marketing, and analytics, built specifically for braiders.",
  address: {
    "@type": "PostalAddress",
    streetAddress: "3680 Wilshire Blvd, Ste P04 #A118",
    addressLocality: "Los Angeles",
    addressRegion: "CA",
    postalCode: "90010",
    addressCountry: "US",
  },
};

export default function AboutPage() {
  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSONLD) }}
      />
      <MarketingHero
        eyebrow="Our story"
        title={
          <>
            Built by a braider,{" "}
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
        body="Braid Boss Pro is made by Wynn Essentials, LLC — but it was born at a braid chair. We build the tools we needed ourselves, then hand them to every braider who wants to run their business like a brand."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See the features", href: "/features" }}
      />

      <FounderStory variant="full" />

      <CtaFooter
        title="Run your braid business like a brand."
        body="Start with a 30-day free trial — every feature unlocked. Then $14.99/month, or $149/year. No contracts, cancel anytime."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
