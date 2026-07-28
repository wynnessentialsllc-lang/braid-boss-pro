// Server layout for the public booking page (/book/<slug>) — the
// canonical destination that /@handle redirects to and the link
// stylists most often share directly. Adds per-stylist metadata + a
// LocalBusiness JSON-LD while leaving the existing client page (which
// does all the booking work) untouched.
//
// public_resolve_booking_slug accepts either the random legacy slug or
// the branded slug, so getStorefrontMeta works here with the route's
// `slug` param exactly as it does for /@handle.

import type { Metadata } from "next";
import { cache } from "react";
import {
  getStorefrontMeta,
  clampDescription,
  SITE_URL,
} from "../../lib/storefront-meta";

const loadMeta = cache(getStorefrontMeta);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = await loadMeta(slug);
  if (!meta) return {};
  const canonical = `${SITE_URL}/book/${encodeURIComponent(slug)}`;
  // Lead with the stylist's studio (personal) name — e.g. "Book with Sheree" —
  // matching the in-app booking-page title and the "Studio name" setting,
  // rather than the shop/brand name used on the storefront pages.
  const title = `Book with ${meta.bookingName}`;
  const description =
    clampDescription(meta.description) ||
    `Request an appointment with ${meta.bookingName} — pick a service, date, and time online.`;
  const images = meta.imageUrl ? [{ url: meta.imageUrl }] : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      siteName: "Braid Boss Pro",
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      images: meta.imageUrl ? [meta.imageUrl] : undefined,
    },
  };
}

export default async function BookingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const meta = await loadMeta(slug);

  const jsonLd = meta
    ? {
        "@context": "https://schema.org",
        "@type": "HealthAndBeautyBusiness",
        name: meta.bookingName,
        url: `${SITE_URL}/book/${encodeURIComponent(slug)}`,
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.imageUrl ? { image: meta.imageUrl } : {}),
        ...(meta.locationText ? { areaServed: meta.locationText } : {}),
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
