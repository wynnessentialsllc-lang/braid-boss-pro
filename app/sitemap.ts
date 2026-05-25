import type { MetadataRoute } from "next";
import { SITE_URL, slugify, STYLE_TAXONOMY } from "./lib/seo";
import { fetchDiscoverStylistsServer } from "./lib/marketplace-server";

// Dynamic sitemap. Static marketing routes are listed inline;
// the `/discover/[city]` and `/discover/[city]/[style]` matrix and
// `/book/[slug]` per-stylist entries are pulled from the active
// opted-in stylists in Supabase.
//
// Rebuilds with the same revalidation window as the underlying RPC
// fetches (1h). Failures fall back to the static list so a Supabase
// blip never breaks the build.

export const revalidate = 3600;

const STATIC_PATHS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/",                priority: 1.0, changeFrequency: "weekly" },
  { path: "/pricing",         priority: 0.9, changeFrequency: "weekly" },
  { path: "/features",        priority: 0.8, changeFrequency: "monthly" },
  { path: "/how-it-works",    priority: 0.7, changeFrequency: "monthly" },
  { path: "/discover",        priority: 0.9, changeFrequency: "daily" },
  { path: "/faq",             priority: 0.5, changeFrequency: "monthly" },
  { path: "/founding-access", priority: 0.6, changeFrequency: "weekly" },
  { path: "/support",         priority: 0.3, changeFrequency: "monthly" },
  { path: "/privacy",         priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms",           priority: 0.2, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map(e => ({
    url: `${SITE_URL}${e.path}`,
    lastModified: now,
    changeFrequency: e.changeFrequency,
    priority: e.priority,
  }));

  const stylists = await fetchDiscoverStylistsServer();

  // /book/[slug] — one per opted-in stylist.
  for (const s of stylists) {
    entries.push({
      url: `${SITE_URL}/book/${s.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  // /discover/[city] — one per unique city among opted-in stylists.
  const cities = new Set<string>();
  for (const s of stylists) {
    if (s.city) cities.add(slugify(s.city));
  }
  for (const city of cities) {
    entries.push({
      url: `${SITE_URL}/discover/${city}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
    // /discover/[city]/[style] — full matrix for indexed cities.
    for (const style of STYLE_TAXONOMY) {
      entries.push({
        url: `${SITE_URL}/discover/${city}/${style.slug}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  return entries;
}
