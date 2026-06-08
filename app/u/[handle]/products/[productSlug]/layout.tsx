// Server layout for a single public product page
// (/@handle/products/<slug>). Overrides the storefront layout's
// metadata with product-specific title, price, image, and Product +
// Offer JSON-LD so a shared product link unfurls as the actual item and
// is eligible for product rich results. {children} (the existing client
// page) is rendered untouched.

import type { Metadata } from "next";
import { cache } from "react";
import {
  getProductMeta,
  clampDescription,
  SITE_URL,
} from "../../../../lib/storefront-meta";

const loadProduct = cache(getProductMeta);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; productSlug: string }>;
}): Promise<Metadata> {
  const { handle, productSlug } = await params;
  const product = await loadProduct(handle, productSlug);
  if (!product) return {};

  const canonical = `${SITE_URL}/@${encodeURIComponent(product.handle)}/products/${encodeURIComponent(productSlug)}`;
  const priceSuffix =
    product.price != null ? ` — $${product.price.toFixed(2)}` : "";
  const title = `${product.title}${priceSuffix}`;
  const description =
    clampDescription(product.description) || `Shop ${product.title} online.`;
  const images = product.imageUrl ? [{ url: product.imageUrl }] : undefined;

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
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  };
}

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ handle: string; productSlug: string }>;
}) {
  const { handle, productSlug } = await params;
  const product = await loadProduct(handle, productSlug);

  const jsonLd = product
    ? {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.title,
        ...(product.description ? { description: product.description } : {}),
        ...(product.imageUrl ? { image: product.imageUrl } : {}),
        ...(product.price != null
          ? {
              offers: {
                "@type": "Offer",
                price: product.price.toFixed(2),
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
                url: `${SITE_URL}/@${encodeURIComponent(product.handle)}/products/${encodeURIComponent(productSlug)}`,
              },
            }
          : {}),
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
