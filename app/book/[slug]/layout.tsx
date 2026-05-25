// Server layout wrapping the client booking page so we can emit
// real per-stylist metadata and JSON-LD without rewriting the
// (large) interactive page itself. The child page.tsx still owns
// all UX; this file only contributes <head> tags + structured data
// that crawlers care about.

import type { Metadata } from "next";
import { fetchDiscoverStylistsServer } from "../../lib/marketplace-server";
import {
  SITE_URL,
  absUrl,
  jsonLdScript,
  stylistLocalBusinessJsonLd,
  breadcrumbJsonLd,
  slugify,
} from "../../lib/seo";

export const revalidate = 3600;

type Params = { slug: string };

const findStylist = async (slug: string) => {
  const all = await fetchDiscoverStylistsServer();
  return all.find(s => s.slug === slug) || null;
};

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { slug } = await params;
  const s = await findStylist(slug);
  if (!s) {
    return {
      title: "Book a braider · Braid Boss Pro",
      alternates: { canonical: `/book/${slug}` },
    };
  }
  const where = [s.city, s.state].filter(Boolean).join(", ");
  const title = `${s.businessName}${where ? ` · ${where}` : ""} — Book online`;
  const description = s.intro
    ? s.intro.slice(0, 200)
    : `Book ${s.businessName}${where ? ` in ${where}` : ""} online. Real-time availability, secure deposits, and instant confirmation.`;
  return {
    title,
    description,
    alternates: { canonical: `/book/${slug}` },
    openGraph: {
      title,
      description,
      url: absUrl(`/book/${slug}`),
      siteName: "Braid Boss Pro",
      type: "website",
      images: s.logoUrl ? [{ url: s.logoUrl }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: s.logoUrl ? [s.logoUrl] : undefined,
    },
  };
}

export default async function BookingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const s = await findStylist(slug);
  if (!s) return <>{children}</>;

  const businessLd = stylistLocalBusinessJsonLd(s);
  const trail = [
    { name: "Discover", url: "/discover" },
  ];
  if (s.city) {
    trail.push({ name: s.city, url: `/discover/${slugify(s.city)}` });
  }
  trail.push({ name: s.businessName, url: `/book/${slug}` });
  const crumbs = breadcrumbJsonLd(trail);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(businessLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }}
      />
      <link rel="canonical" href={`${SITE_URL}/book/${slug}`} />
      {children}
    </>
  );
}
