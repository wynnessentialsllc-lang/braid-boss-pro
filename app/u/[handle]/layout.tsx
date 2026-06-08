// Server layout for the public storefront (/@handle, /@handle/shop, and
// — via the nested product layout — /@handle/products/<slug>).
//
// Its job is SEO/social metadata only: it renders {children} untouched
// (the existing client pages keep doing all the interactive work) but
// adds per-stylist <title>, description, Open Graph / Twitter image, a
// canonical pointing at the public /@handle URL, and LocalBusiness
// JSON-LD. Without this, every stylist's shared link unfurled with the
// generic app card and was invisible to crawlers.
//
// The middleware rewrites /@handle → /u/<handle>, so this layout sees
// the handle in params and we canonicalize back to the /@handle form.

import type { Metadata } from "next";
import { cache } from "react";
import {
  getStorefrontMeta,
  clampDescription,
  SITE_URL,
} from "../../lib/storefront-meta";

// Dedupe the fetch across generateMetadata + the layout body within one
// request.
const loadMeta = cache(getStorefrontMeta);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const meta = await loadMeta(handle);
  if (!meta) {
    // Unknown / inactive handle — let it inherit root metadata.
    return {};
  }
  const canonical = `${SITE_URL}/@${encodeURIComponent(meta.handle)}`;
  const title = `${meta.studioName} — Book & Shop`;
  const description =
    clampDescription(meta.description) ||
    `Book appointments and shop with ${meta.studioName} online.`;
  const images = meta.imageUrl ? [{ url: meta.imageUrl }] : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "profile",
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

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const meta = await loadMeta(handle);

  const jsonLd = meta
    ? {
        "@context": "https://schema.org",
        "@type": "HealthAndBeautyBusiness",
        name: meta.studioName,
        url: `${SITE_URL}/@${encodeURIComponent(meta.handle)}`,
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
