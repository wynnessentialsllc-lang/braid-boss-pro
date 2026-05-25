import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/seo";

// Allow crawling of all public marketing + booking + discovery pages.
// Block authenticated/transactional surfaces that have no SEO value
// and shouldn't show up in search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          "/admin/",
          "/settings/",
          "/orders/",
          "/pay/",
          "/payment-success",
          "/founding-success",
          "/booking-action/",
          "/contract/",
          "/sign/",
          "/unsubscribe/",
          "/auth/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
