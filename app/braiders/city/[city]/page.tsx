import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../../components/marketing/MarketingShell";
import { StylistDirectoryCard } from "../../../components/marketing/StylistDirectoryCard";
import { C } from "../../../components/marketing/tokens";
import { getCityGroup } from "../../../lib/directory";

export const revalidate = 1800;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const found = await getCityGroup(city);
  if (!found) {
    // No listed stylists for this slug — keep it out of the index rather
    // than publishing a thin/empty city page.
    return {
      title: "Braiders — Find & Book | Braid Boss Pro",
      robots: { index: false, follow: true },
      alternates: { canonical: `/braiders/city/${city}` },
    };
  }
  const { label } = found.group;
  const title = `Braiders in ${label} — Find & Book a Braid Stylist`;
  const description = `Find and book braid stylists in ${label}. Browse knotless, box braids, locs, twists, and cornrow specialists taking bookings directly through Braid Boss Pro.`;
  return {
    title,
    description,
    alternates: { canonical: `/braiders/city/${city}` },
    openGraph: { title, description, url: `/braiders/city/${city}`, siteName: "Braid Boss Pro", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CityDirectoryPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const found = await getCityGroup(city);

  if (!found) {
    return (
      <MarketingShell>
        <MarketingHero
          eyebrow="Find a braider"
          title="No braiders here yet."
          body="We don't have any braid stylists listed in this area yet. Browse by style, search with an inspo photo, or — if you're a braider — get listed so clients here can find you."
          primaryCta={{ label: "Browse all braiders", href: "/braiders" }}
          secondaryCta={{ label: "Get listed free", href: "/?signup=1" }}
        />
        <CtaFooter
          title="Are you a braider in this area?"
          body="Be the first braider clients find when they search your city. Start with a 14-day free trial — every feature unlocked."
          primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
          secondaryCta={{ label: "Browse all braiders", href: "/braiders" }}
        />
      </MarketingShell>
    );
  }

  const { group, stylists } = found;
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Find a Braider", item: `${SITE_URL}/braiders` },
      { "@type": "ListItem", position: 3, name: `Braiders in ${group.label}`, item: `${SITE_URL}/braiders/city/${city}` },
    ],
  };
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Braiders in ${group.label}`,
    numberOfItems: stylists.length,
    itemListElement: stylists.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.businessName,
      url: `${SITE_URL}/book/${encodeURIComponent(s.slug)}`,
    })),
  };

  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />

      <MarketingHero
        eyebrow="Find a braider"
        title={
          <>
            Braiders in{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {group.label}.
            </em>
          </>
        }
        body={`Browse braid stylists in ${group.label} who take bookings directly through Braid Boss Pro. See their work, styles, and prices, then request a date — no booking fees added to you.`}
        primaryCta={{ label: "Search with a photo", href: "/discover" }}
        secondaryCta={{ label: "Browse all braiders", href: "/braiders" }}
      />

      <Section
        eyebrow={group.label}
        title={`${stylists.length} ${stylists.length === 1 ? "braider" : "braiders"} in ${group.label}`}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {stylists.map((s) => (
            <StylistDirectoryCard key={s.slug} stylist={s} />
          ))}
        </div>
        <p style={{ marginTop: 18, textAlign: "center", fontSize: 13.5, color: C.coffee }}>
          <Link href="/braiders" style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}>
            Browse braiders by style
          </Link>{" "}
          instead.
        </p>
      </Section>

      <CtaFooter
        title={`Do you braid in ${group.label}?`}
        body="Get your booking page in front of clients searching your city. Start with a 14-day free trial — every feature unlocked."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
