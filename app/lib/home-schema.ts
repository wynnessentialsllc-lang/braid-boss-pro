// SoftwareApplication structured data for the homepage.
//
// Gives search engines and LLMs a machine-readable summary of what the
// product is, who it is for, and what it costs.
//
// This lived in app/layout.tsx, which emitted it on every route — so
// /privacy, /terms, /payment-success and the rest each declared
// themselves to be the application. Exactly one page should own the app
// rich result, and it should be the one with the CTA, so it now renders
// only from app/page.tsx.
//
// Plain data, no JSX: app/page.tsx is a client component, and keeping
// this as a serialisable object means the page just stringifies it.
//
// NB: the trial length and prices below are duplicated from
// app/lib/premium.ts, app/api/subscribe/route.ts, app/pricing/page.tsx
// and app/components/marketing/PricingPlanCard.tsx. Changing the trial
// length means changing all of them.

export const HOME_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Braid Boss Pro",
  description:
    "The business operating system for braid stylists — branded booking links, deposits, contracts, retail storefronts, marketing, and analytics, built specifically for braiders.",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Salon and Spa Management",
  operatingSystem: "iOS, Android, Web (PWA)",
  url: "https://braidbosspro.app",
  image: "https://braidbosspro.app/icons/icon-512.png",
  offers: [
    {
      "@type": "Offer",
      name: "Monthly",
      price: "14.99",
      priceCurrency: "USD",
      category: "Subscription",
      description: "30-day free trial, then $14.99/month. Cancel anytime.",
    },
    {
      "@type": "Offer",
      name: "Annual",
      price: "149",
      priceCurrency: "USD",
      category: "Subscription",
      description: "$149/year — save $30.88 vs monthly. 30-day free trial.",
    },
  ],
  featureList: [
    "Branded /@handle booking links",
    "Stripe Connect deposits and balance payments",
    "Digital contracts with e-signature",
    "Pricing calculator and saved quotes",
    "Client CRM with histories, allergies, photos",
    "Retail storefront with product variants and inventory",
    "SMS and email reminder automation",
    "Marketing automation (rebooking, win-back, birthday)",
    "Analytics dashboard",
    "Public reviews and testimonials",
    "Web push notifications",
    "Progressive Web App — installs to home screen, no app store",
  ],
  audience: {
    "@type": "Audience",
    audienceType:
      "Braid stylists, loctitians, natural hair specialists, protective-style braiders",
  },
  provider: {
    "@type": "Organization",
    name: "Wynn Essentials",
    url: "https://braidbosspro.app",
  },
} as const;
