// Single source of truth for the SEO feature pages under /features/*.
//
// The /features hub, every individual feature page's "related features"
// rail, the footer, and the sitemap all read from this list so the set
// of pages, their canonical paths, titles, and short blurbs can never
// drift out of sync. Add a page here once and it shows up everywhere it
// should be linked.

export type FeaturePage = {
  // URL slug under /features/ (no leading slash).
  slug: string;
  // Short label used on cards + nav rails.
  navTitle: string;
  // One-line blurb used on the hub grid and related-feature cards.
  cardBlurb: string;
  // Slugs of 3 related feature pages, shown as cross-links at the bottom
  // of each page for internal linking + crawl depth.
  related: string[];
};

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: "booking-software-for-braiders",
    navTitle: "Booking & scheduling",
    cardBlurb:
      "A branded booking microsite, real-time availability calendar, intake forms, and self-service rescheduling built for the braid chair.",
    related: [
      "payments-and-deposits",
      "digital-contracts-for-braiders",
      "ai-tools-for-braiders",
    ],
  },
  {
    slug: "business-management-software-for-braiders",
    navTitle: "Business management",
    cardBlurb:
      "Clients, policies, services, branding, notifications, analytics, billing, and settings — the whole back office in one dashboard.",
    related: [
      "booking-software-for-braiders",
      "payments-and-deposits",
      "marketing-and-client-retention",
    ],
  },
  {
    slug: "payments-and-deposits",
    navTitle: "Payments & deposits",
    cardBlurb:
      "Stripe Connect deposits, balances, tips, no-show protection, Tap to Pay, BNPL, and a full transactions ledger you own.",
    related: [
      "booking-software-for-braiders",
      "storefront-and-product-sales",
      "memberships-and-packages",
    ],
  },
  {
    slug: "braiding-hair-inventory-management",
    navTitle: "Inventory management",
    cardBlurb:
      "Track braiding hair by color, length, quantity, and cost, watch stock levels, and price products with the profit calculator.",
    related: [
      "storefront-and-product-sales",
      "business-management-software-for-braiders",
      "payments-and-deposits",
    ],
  },
  {
    slug: "ai-tools-for-braiders",
    navTitle: "AI tools",
    cardBlurb:
      "An AI Business Coach, Social Media Studio, rebooking assistant, style consultant, and booking concierge in your corner.",
    related: [
      "booking-software-for-braiders",
      "marketing-and-client-retention",
      "business-management-software-for-braiders",
    ],
  },
  {
    slug: "storefront-and-product-sales",
    navTitle: "Storefront & products",
    cardBlurb:
      "Sell hair, products, and gift cards with multi-variant listings, pickup, delivery, Shippo shipping, and public order tracking.",
    related: [
      "braiding-hair-inventory-management",
      "payments-and-deposits",
      "memberships-and-packages",
    ],
  },
  {
    slug: "memberships-and-packages",
    navTitle: "Memberships & packages",
    cardBlurb:
      "Prepaid visit bundles, credit packages, and recurring memberships with self-service cancellation and public buy pages.",
    related: [
      "payments-and-deposits",
      "marketing-and-client-retention",
      "storefront-and-product-sales",
    ],
  },
  {
    slug: "digital-contracts-for-braiders",
    navTitle: "Digital contracts",
    cardBlurb:
      "Tokenized e-sign agreements with typed name, signature, optional initials, decline-with-reason, and a full status lifecycle.",
    related: [
      "booking-software-for-braiders",
      "business-management-software-for-braiders",
      "payments-and-deposits",
    ],
  },
  {
    slug: "marketing-and-client-retention",
    navTitle: "Marketing & retention",
    cardBlurb:
      "Confirmations, reminders, review requests, rebooking and win-back messages, newsletters, and segmented marketing blasts.",
    related: [
      "ai-tools-for-braiders",
      "memberships-and-packages",
      "braider-marketplace-and-profile",
    ],
  },
  {
    slug: "braider-marketplace-and-profile",
    navTitle: "Marketplace & profile",
    cardBlurb:
      "A public stylist profile and link-in-bio page with bio, services, gallery, reviews, shop, and a discover marketplace.",
    related: [
      "booking-software-for-braiders",
      "marketing-and-client-retention",
      "storefront-and-product-sales",
    ],
  },
  {
    slug: "mobile-app-for-braiders",
    navTitle: "Mobile app",
    cardBlurb:
      "A mobile-first iOS app experience with push notifications, native share, receipt downloads, and an offline fallback.",
    related: [
      "booking-software-for-braiders",
      "business-management-software-for-braiders",
      "ai-tools-for-braiders",
    ],
  },
];

// Build the absolute path for a feature slug.
export const featurePath = (slug: string): string => `/features/${slug}`;

// Look up a page by slug (used by the related-features rail).
export const getFeaturePage = (slug: string): FeaturePage | undefined =>
  FEATURE_PAGES.find((p) => p.slug === slug);

// Resolve the related-page objects for a given slug.
export const relatedFeaturePages = (slug: string): FeaturePage[] => {
  const page = getFeaturePage(slug);
  if (!page) return [];
  return page.related
    .map(getFeaturePage)
    .filter((p): p is FeaturePage => Boolean(p));
};
