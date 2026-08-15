import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/discover/page.tsx is a "use client" component and can't export its
// own metadata, so this thin server layout supplies it. It renders the
// page untouched (no extra DOM) — its only job is the metadata export.
export const metadata: Metadata = {
  title: "Find a Braider Near You · Braid Boss Pro",
  description:
    "Search braid stylists near you by city and style. Browse box braids, knotless, locs, twists, and cornrow specialists, then book directly through their Braid Boss Pro booking page.",
  alternates: { canonical: "/discover" },
  // ── noindex, deliberately and temporarily ──────────────────────────
  // The directory is client-rendered, so a crawler gets a shell with no
  // braiders in it. Indexing that publishes an empty marketplace: a
  // thin, valueless page on the same domain as the pages we do want
  // ranked, competing with them for crawl budget and dragging on
  // sitewide quality signals.
  //
  // REVERSE THIS once there are 40+ listed braiders in a single metro —
  // enough that a search result for "braiders in <city>" lands on a page
  // with real inventory. At that point drop this `robots` block and put
  // /discover back in app/sitemap.ts.
  //
  // `follow: true` on purpose: keep passing link equity through to the
  // /u/<handle> braider pages, which are real content worth crawling.
  //
  // Note this is a meta robots tag, NOT a robots.txt disallow. A
  // disallow would stop Googlebot fetching the page, so it would never
  // see the noindex, and the URL could still be indexed from external
  // links. The tag has to be reachable to work — do not also add
  // /discover to the disallow list in app/robots.ts.
  robots: { index: false, follow: true },
  openGraph: {
    title: "Find a Braider Near You",
    description: "Search braid stylists by city and style, then book directly.",
    url: "/discover",
    type: "website",
  },
};

export default function DiscoverLayout({ children }: { children: ReactNode }) {
  return children;
}
