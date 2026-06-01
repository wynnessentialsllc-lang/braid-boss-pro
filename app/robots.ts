import type { MetadataRoute } from "next";

// robots.txt — allow crawling of public marketing pages, keep crawlers
// out of transactional / authenticated areas, and point them at the
// sitemap. Base URL resolution matches app/sitemap.ts and
// app/lib/site-url.ts.
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/settings/", "/auth/", "/api/"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
