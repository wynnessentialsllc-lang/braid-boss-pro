import type { MetadataRoute } from "next";
import { listPublicPages } from "./lib/public-pages";

// Public sitemap for search engines. The page list itself lives in
// app/lib/public-pages.ts, which /llms.txt also reads — one registry, so
// the map we hand crawlers and the map we hand AI assistants can never
// disagree. Add a page there and it appears in both.
//
// Only marketing / SEO-facing routes belong in that registry;
// transactional pages (success screens, settings, admin, auth callbacks)
// are intentionally excluded so crawlers spend their budget on pages we
// actually want ranked.
//
// Base URL resolution mirrors app/lib/site-url.ts: NEXT_PUBLIC_SITE_URL
// (set on Vercel for prod/preview) wins, with the production domain as
// the fallback. No trailing slash so paths concatenate cleanly.
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return listPublicPages().map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
