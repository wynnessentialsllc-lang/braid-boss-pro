// Server layout for the storefront policies page (/@handle/policies).
// Refines the title to "<Studio> — Policies"; everything else (OG, etc.)
// is inherited from the parent [handle] layout.

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
  const canonical = `${SITE_URL}/@${encodeURIComponent(meta.handle)}/policies`;
  const title = `${meta.studioName} — Policies`;
  return {
    title,
    alternates: { canonical },
    openGraph: { title, url: canonical },
    twitter: { title },
  };
}

export default function PoliciesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
