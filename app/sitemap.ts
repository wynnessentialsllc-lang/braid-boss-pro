import type { MetadataRoute } from "next";
import { FEATURE_PAGES, featurePath } from "./lib/feature-pages";
import { listStoreProducts } from "./lib/store-catalog";

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
  { path: "/guides", priority: 0.6, changeFrequency: "monthly" },
  { path: "/compare/braid-boss-pro-vs-styleseat", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/braid-boss-pro-vs-vagaro", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/braid-boss-pro-vs-square-appointments", priority: 0.8, changeFrequency: "monthly" },
  { path: "/guides/best-booking-app-for-braiders", priority: 0.7, changeFrequency: "monthly" },
  { path: "/discover", priority: 0.9, changeFrequency: "daily" },
  // Braid Boss Pro Store — first-party storefront + each product page.
  { path: "/store", priority: 0.8, changeFrequency: "weekly" },
  ...listStoreProducts().map((p) => ({
    path: `/store/${p.slug}`,
    priority: 0.7,
    changeFrequency: "weekly" as const,
  })),
  { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
  { path: "/founding-access", priority: 0.6, changeFrequency: "monthly" },
  { path: "/support", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
