// Server layout for the storefront shop grid (/@handle/shop). Refines
// the storefront layout's title to be shop-specific; everything else
// (OG image, description, canonical) is inherited/merged from the parent
// [handle] layout. {children} renders the existing client page untouched.

import type { Metadata } from "next";
import { cache } from "react";
import { getStorefrontMeta, SITE_URL } from "../../../lib/storefront-meta";

const loadMeta = cache(getStorefrontMeta);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const meta = await loadMeta(handle);
  if (!meta) return {};
  const canonical = `${SITE_URL}/@${encodeURIComponent(meta.handle)}/shop`;
  const title = `${meta.studioName} — Shop`;
  return {
    title,
    alternates: { canonical },
    openGraph: { title, url: canonical },
    twitter: { title },
  };
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
