// Single source of truth for the site's public, indexable pages.
//
// Three consumers read this list, and they used to drift apart:
//
//   app/sitemap.ts      → XML sitemap for search crawlers
//   app/llms.txt/route.ts → plain-text site brief for AI assistants
//   (anything else that needs "what pages does this site have?")
//
// The old llms.txt was a hand-maintained static file in /public. It
// listed eleven URLs while the sitemap listed thirty-one, and it still
// advertised a 14-day trial months after the product moved to 30 days.
// An AI assistant reading it was answering from a stale, partial map of
// the site. Generating both outputs from this one array is what stops
// that from happening again — add a page here and every machine-facing
// surface learns about it at once.
//
// Only list pages we actually want crawled and cited: marketing and
// reference routes. Transactional routes (checkout success screens,
// signed-token pages, the authenticated app, /admin) are deliberately
// absent, and app/robots.ts disallows them.

import { FEATURE_PAGES, featurePath } from "./feature-pages";
import { listStoreProducts } from "./store-catalog";

export type PublicPageSection =
  | "Product"
  | "Comparisons"
  | "Guides"
  | "Store"
  | "Company";

export type PublicPage = {
  /** Absolute path, no host, no trailing slash. */
  path: string;
  /** Human title — used as the link text in llms.txt. */
  title: string;
  /** One sentence an assistant can quote or summarise from. */
  summary: string;
  /** Sitemap hint, 0–1, relative within this site. */
  priority: number;
  changeFrequency: "yearly" | "monthly" | "weekly" | "daily";
  section: PublicPageSection;
};

// The three pages that introduce the product. Listed first everywhere.
const HEADLINE_PAGES: PublicPage[] = [
  {
    path: "/",
    title: "Braid Boss Pro",
    summary:
      "The business operating system for braid stylists — booking link, deposits, contracts, retail, marketing, and analytics in one mobile-first app.",
    priority: 1.0,
    changeFrequency: "weekly",
    section: "Product",
  },
  {
    path: "/features",
    title: "All features",
    summary:
      "The full feature index — booking, payments and deposits, inventory, AI tools, contracts, storefront, memberships, marketing, public profile, and the mobile app.",
    priority: 0.9,
    changeFrequency: "monthly",
    section: "Product",
  },
  {
    path: "/why-braid-boss-pro",
    title: "Why Braid Boss Pro",
    summary:
      "Why braiders pick a braider-specific platform over generic salon software: hair-included pricing, long-appointment deposit logic, and a creator-style booking link.",
    priority: 0.9,
    changeFrequency: "monthly",
    section: "Product",
  },
];

// The rest of the product surface, after the per-feature pages.
const SUPPORTING_PAGES: PublicPage[] = [
  {
    path: "/pricing",
    title: "Pricing",
    summary:
      "Flat pricing with no per-staff and no per-client fees, billed monthly or annually after a free trial.",
    priority: 0.9,
    changeFrequency: "monthly",
    section: "Product",
  },
  {
    path: "/how-it-works",
    title: "How it works",
    summary:
      "The setup path end to end — connect Stripe, add services, publish your booking link, and take your first deposit in under ten minutes.",
    priority: 0.7,
    changeFrequency: "monthly",
    section: "Product",
  },
  {
    path: "/tour",
    title: "Product tour",
    summary:
      "A guided walkthrough of the calendar, action sheet, client profiles, and booking-source dashboard stylists use daily.",
    priority: 0.6,
    changeFrequency: "monthly",
    section: "Product",
  },
  {
    path: "/faq",
    title: "FAQ",
    summary:
      "Common questions about trials, Stripe Connect payouts, deposits, the storefront, and installing the app on iPhone and Android.",
    priority: 0.6,
    changeFrequency: "monthly",
    section: "Product",
  },
  {
    path: "/founding-access",
    title: "Founding access",
    summary: "The founding-member offer and what grandfathered access includes.",
    priority: 0.6,
    changeFrequency: "monthly",
    section: "Product",
  },
];

const COMPARISON_PAGES: PublicPage[] = [
  {
    path: "/compare/braid-boss-pro-vs-styleseat",
    title: "Braid Boss Pro vs StyleSeat",
    summary:
      "Side-by-side against StyleSeat: per-new-client charges, client-facing booking fees, and who holds the payout.",
    priority: 0.8,
    changeFrequency: "monthly",
    section: "Comparisons",
  },
  {
    path: "/compare/braid-boss-pro-vs-vagaro",
    title: "Braid Boss Pro vs Vagaro",
    summary:
      "Side-by-side against Vagaro: per-staff pricing, paid add-ons, and what each plan actually bundles.",
    priority: 0.8,
    changeFrequency: "monthly",
    section: "Comparisons",
  },
  {
    path: "/compare/braid-boss-pro-vs-square-appointments",
    title: "Braid Boss Pro vs Square Appointments",
    summary:
      "Side-by-side against Square Appointments: generic salon/retail tooling versus braid-specific pricing, deposits, and intake.",
    priority: 0.8,
    changeFrequency: "monthly",
    section: "Comparisons",
  },
];

const GUIDE_PAGES: PublicPage[] = [
  {
    path: "/guides",
    title: "Guides for braiders",
    summary:
      "Practical, braider-focused guides on booking software, deposits, pricing braid work, and growing a chair.",
    priority: 0.6,
    changeFrequency: "monthly",
    section: "Guides",
  },
  {
    path: "/guides/best-booking-app-for-braiders",
    title: "Best booking app for braiders",
    summary:
      "A multi-app breakdown for braid stylists covering Braid Boss Pro, StyleSeat, Vagaro, Square Appointments, and GlossGenius.",
    priority: 0.7,
    changeFrequency: "monthly",
    section: "Guides",
  },
];

const COMPANY_PAGES: PublicPage[] = [
  {
    path: "/about",
    title: "About",
    summary:
      "Built at a working braid chair (SBW Braiding) to replace the notes-app-and-three-payment-apps way of running a braid business.",
    priority: 0.6,
    changeFrequency: "monthly",
    section: "Company",
  },
  {
    path: "/support",
    title: "Support",
    summary: "How to reach the team and get help with an account.",
    priority: 0.4,
    changeFrequency: "yearly",
    section: "Company",
  },
  {
    path: "/privacy",
    title: "Privacy policy",
    summary: "What data the platform collects, how it is used, and how to request deletion.",
    priority: 0.3,
    changeFrequency: "yearly",
    section: "Company",
  },
  {
    path: "/terms",
    title: "Terms of service",
    summary: "The terms covering subscriptions, payments, and acceptable use.",
    priority: 0.3,
    changeFrequency: "yearly",
    section: "Company",
  },
];

/** Feature pages, generated from the registry in ./feature-pages. */
const featurePages = (): PublicPage[] =>
  FEATURE_PAGES.map((p) => ({
    path: featurePath(p.slug),
    title: p.navTitle,
    summary: p.cardBlurb,
    priority: 0.8,
    changeFrequency: "monthly" as const,
    section: "Product" as const,
  }));

/** Storefront hub + a page per listed product, from ./store-catalog. */
const storePages = (): PublicPage[] => [
  {
    path: "/store",
    title: "Braid Boss Pro Store",
    summary: "First-party braider essentials — digital planners and tools made for the chair.",
    priority: 0.8,
    changeFrequency: "weekly",
    section: "Store",
  },
  ...listStoreProducts().map((p) => ({
    path: `/store/${p.slug}`,
    title: p.name,
    summary: p.tagline,
    priority: 0.7,
    changeFrequency: "weekly" as const,
    section: "Store" as const,
  })),
];

/**
 * Every public page, in sitemap order.
 *
 * NOT included, on purpose:
 *   /discover  — noindex until the braider directory has real inventory
 *                (see app/discover/layout.tsx). Listing it would spend
 *                crawl budget to be told not to index it.
 *   /@handle/* — tenant storefronts and booking links. They're public and
 *                individually indexable, but they belong to stylists and
 *                change constantly; they aren't part of the site's own map.
 */
export const listPublicPages = (): PublicPage[] => [
  ...HEADLINE_PAGES,
  ...featurePages(),
  ...SUPPORTING_PAGES,
  ...COMPARISON_PAGES,
  ...GUIDE_PAGES,
  ...storePages(),
  ...COMPANY_PAGES,
];

/** Pages of one section, preserving sitemap order. */
export const pagesInSection = (section: PublicPageSection): PublicPage[] =>
  listPublicPages().filter((p) => p.section === section);

export const PUBLIC_PAGE_SECTIONS: PublicPageSection[] = [
  "Product",
  "Comparisons",
  "Guides",
  "Store",
  "Company",
];
