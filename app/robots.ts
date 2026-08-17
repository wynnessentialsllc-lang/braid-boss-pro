import type { MetadataRoute } from "next";

// robots.txt — allow crawling of public marketing pages, keep crawlers
// out of transactional / authenticated areas, and point them at the
// sitemap. Base URL resolution matches app/sitemap.ts and
// app/lib/site-url.ts.
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

// Paths no crawler should spend budget on: the authenticated app, the
// admin dashboard, auth callbacks, API routes, and the signed-token
// pages (contracts, order tracking, appointment management) that are
// private to one client even though they need no login.
const PRIVATE_PATHS = [
  // The installed PWA's entry point — an empty app shell with no links.
  // It also carries a noindex tag (app/app/layout.tsx); nothing links
  // here, so the disallow can't hide that tag from a crawler.
  "/app",
  "/admin/",
  "/settings/",
  "/auth/",
  "/api/",
  "/contract/",
  "/sign/",
  "/client/",
  "/booking-action/",
  "/requests/",
  "/orders/",
  "/watch/",
  "/pay/",
  "/buy/",
  "/review/",
  "/unsubscribe",
  "/payment-success",
  "/subscription-success",
  "/founding-success",
  "/booking/success",
  "/store/success",
  "/shop/success",
];

// AI assistants and the crawlers that feed them. They are already
// covered by the "*" rule, but naming them is not decoration: a crawler
// that finds a group matching its own user-agent ignores the "*" group
// entirely, so anyone later adding a targeted rule for one of these
// starts from an explicit allow rather than accidentally inheriting
// nothing. Grouped by operator:
//
//   OpenAI     GPTBot (training), OAI-SearchBot (search index),
//              ChatGPT-User (fetches a page a user asked about)
//   Anthropic  ClaudeBot, Claude-User, Claude-SearchBot
//   Google     Google-Extended (Gemini grounding, separate from Googlebot)
//   Perplexity PerplexityBot, Perplexity-User
//   Microsoft  Bingbot also feeds Copilot
//   Others     Applebot-Extended (Apple Intelligence), Meta, Amazon,
//              Bytespider (TikTok search), CCBot (Common Crawl)
//
// We want to be found and cited by all of them: an assistant answering
// "best booking app for braiders" is a primary discovery path for this
// product, not an incidental one.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot-Extended",
  "meta-externalagent",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Diffbot",
  "omgili",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        // Same access as everyone else — stated explicitly so the group
        // exists and the disallow list is repeated rather than inherited.
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
