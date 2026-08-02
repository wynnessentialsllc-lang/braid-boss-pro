import type { MetadataRoute } from "next";
import { FEATURE_PAGES, featurePath } from "./lib/feature-pages";
import { STYLE_TAGS } from "./lib/marketplace";
import { getListedStylists, groupCities } from "./lib/directory";

// Re-generate at most hourly. The directory portion (stylists, cities)
// queries Supabase, so we cache the whole sitemap instead of hitting the
// RPC on every crawl.
export const revalidate = 3600;

// Public sitemap for search engines. Only marketing / SEO-facing routes
// belong here — transactional pages (success screens, settings, admin,
// auth callbacks) are intentionally excluded so crawlers spend their
// budget on pages we actually want ranked.
//
// Base URL resolution mirrors app/lib/site-url.ts: NEXT_PUBLIC_SITE_URL
// (set on Vercel for prod/preview) wins, with the production domain as
// the fallback. No trailing slash so paths concatenate cleanly.
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

// Listed most-important first. `priority` is a relative hint to crawlers,
// not an absolute ranking signal.
const ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/features", priority: 0.9, changeFrequency: "monthly" },
  { path: "/why-braid-boss-pro", priority: 0.9, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  // Dedicated SEO feature pages — generated from the shared registry so
  // adding a page in app/lib/feature-pages.ts lists it here automatically.
  ...FEATURE_PAGES.map((p) => ({
    path: featurePath(p.slug),
    priority: 0.8,
    changeFrequency: "monthly" as const,
  })),
  { path: "/how-it-works", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tour", priority: 0.6, changeFrequency: "monthly" },
  { path: "/braiders", priority: 0.8, changeFrequency: "weekly" },
  { path: "/guides", priority: 0.6, changeFrequency: "monthly" },
  { path: "/compare/braid-boss-pro-vs-styleseat", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/braid-boss-pro-vs-vagaro", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/braid-boss-pro-vs-square-appointments", priority: 0.8, changeFrequency: "monthly" },
  { path: "/guides/best-booking-app-for-braiders", priority: 0.7, changeFrequency: "monthly" },
  { path: "/discover", priority: 0.9, changeFrequency: "daily" },
  { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
  { path: "/founding-access", priority: 0.6, changeFrequency: "monthly" },
  { path: "/support", priority: 0.4, changeFrequency: "yearly" },
  { path: "/security", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));

  // Style facet pages — bounded by the canonical vocabulary, no fetch.
  const styleEntries: MetadataRoute.Sitemap = STYLE_TAGS.map((s) => ({
    url: `${BASE}/braiders/style/${s.slug}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // Data-driven entries: per-city facet pages + individual stylist
  // booking pages. getListedStylists is fail-soft (returns [] on any
  // error), so a build-time prerender or a transient RPC failure just
  // omits these rather than failing the whole sitemap.
  let cityEntries: MetadataRoute.Sitemap = [];
  let stylistEntries: MetadataRoute.Sitemap = [];
  const stylists = await getListedStylists();
  if (stylists.length > 0) {
    cityEntries = groupCities(stylists).map((c) => ({
      url: `${BASE}/braiders/city/${c.slug}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
    stylistEntries = stylists.map((s) => ({
      url: `${BASE}/book/${encodeURIComponent(s.slug)}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  }

  return [...staticEntries, ...styleEntries, ...cityEntries, ...stylistEntries];
}
