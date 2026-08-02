import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../../../components/marketing/MarketingShell";
import { StylistDirectoryCard } from "../../../components/marketing/StylistDirectoryCard";
import { C } from "../../../components/marketing/tokens";
import { STYLE_TAGS, styleLabel } from "../../../lib/marketplace";
import { getStylistsByStyle } from "../../../lib/directory";

export const revalidate = 1800;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app";
const STYLE_SLUGS = new Set(STYLE_TAGS.map((s) => s.slug));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ style: string }>;
}): Promise<Metadata> {
  const { style } = await params;
  if (!STYLE_SLUGS.has(style)) return {};
  const label = styleLabel(style);
  const title = `${label} Braiders — Find & Book a ${label} Stylist`;
  const description = `Find braid stylists who specialize in ${label.toLowerCase()} and book directly. Browse ${label.toLowerCase()} braiders by city and style on Braid Boss Pro.`;
  return {
    title,
    description,
    alternates: { canonical: `/braiders/style/${style}` },
    openGraph: { title, description, url: `/braiders/style/${style}`, siteName: "Braid Boss Pro", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function StyleDirectoryPage({
  params,
}: {
  params: Promise<{ style: string }>;
}) {
  const { style } = await params;
  if (!STYLE_SLUGS.has(style)) notFound();

  const label = styleLabel(style);
  const stylists = await getStylistsByStyle(style);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Find a Braider", item: `${SITE_URL}/braiders` },
      { "@type": "ListItem", position: 3, name: `${label} braiders`, item: `${SITE_URL}/braiders/style/${style}` },
    ],
  };
  const itemList = stylists.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `${label} braiders`,
        numberOfItems: stylists.length,
        itemListElement: stylists.map((s, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: s.businessName,
          url: `${SITE_URL}/book/${encodeURIComponent(s.slug)}`,
        })),
      }
    : null;

  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      {itemList && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      )}

      <MarketingHero
        eyebrow="Find a braider"
        title={
          <>
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {label}
            </em>{" "}
            braiders.
          </>
        }
        body={`Browse braid stylists who specialize in ${label.toLowerCase()} and take bookings directly through Braid Boss Pro. Find your match, see their work, and request a date — no booking fees added to you.`}
        primaryCta={{ label: "Search with a photo", href: "/discover" }}
        secondaryCta={{ label: "Browse all styles", href: "/braiders" }}
      />

      <Section
        eyebrow={`${label} specialists`}
        title={stylists.length > 0 ? `${stylists.length} ${label.toLowerCase()} ${stylists.length === 1 ? "braider" : "braiders"} to book` : `${label} braiders`}
        intro={`A ${label.toLowerCase()} specialist knows the tension, parting, and prep this style needs — booking one who does it every day is the difference between a set that lasts and one that doesn't.`}
      >
        {stylists.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
            {stylists.map((s) => (
              <StylistDirectoryCard key={s.slug} stylist={s} />
            ))}
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "36px 20px",
              borderRadius: 18,
              background: "#FBFAFD",
              border: `1px dashed ${C.brandBorder}`,
              color: C.coffee,
            }}
          >
            <p style={{ margin: 0, fontSize: 15 }}>
              No {label.toLowerCase()} braiders are listed here yet.
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 14 }}>
              <Link href="/braiders" style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}>
                Browse all braiders
              </Link>{" "}
              or{" "}
              <Link href="/discover" style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}>
                search with a photo
              </Link>
              . Are you a {label.toLowerCase()} braider?{" "}
              <Link href="/?signup=1" style={{ color: C.brandPrimary, fontWeight: 700, textDecoration: "underline" }}>
                Get listed free
              </Link>
              .
            </p>
          </div>
        )}
      </Section>

      <CtaFooter
        title={`Do you specialize in ${label.toLowerCase()}?`}
        body="Get your booking page in front of clients searching your styles and city. Start with a 14-day free trial — every feature unlocked."
        primaryCta={{ label: "Start free trial", href: "/?signup=1" }}
        secondaryCta={{ label: "Browse all braiders", href: "/braiders" }}
      />
    </MarketingShell>
  );
}
