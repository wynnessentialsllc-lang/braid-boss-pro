// Server component that emits the structured-data <script> tags for a
// feature page: BreadcrumbList (always), FAQPage (from the same QA[]
// the page renders), and an optional SoftwareApplication describing the
// specific capability. Rendered server-side so crawlers see it in the
// initial HTML.
//
// No "use client" — this only produces inline <script type=ld+json>.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

export type FaqEntry = { q: string; a: string };

export type FeatureSchemaProps = {
  // Canonical path for this page, e.g. "/features/payments-and-deposits".
  path: string;
  // Human label for the breadcrumb leaf, e.g. "Payments & Deposits".
  breadcrumbName: string;
  // FAQ entries — plain-text answers for the schema (keep in lockstep
  // with what the page renders).
  faqs: FaqEntry[];
  // Optional SoftwareApplication block for this feature.
  software?: {
    name: string;
    description: string;
    featureList: string[];
  };
};

export default function FeatureSchema({ path, breadcrumbName, faqs, software }: FeatureSchemaProps) {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE },
      { "@type": "ListItem", position: 2, name: "Features", item: `${SITE}/features` },
      { "@type": "ListItem", position: 3, name: breadcrumbName, item: `${SITE}${path}` },
    ],
  };

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const softwareApp = software
    ? {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: software.name,
        description: software.description,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Salon and Spa Management",
        operatingSystem: "iOS, Android, Web (PWA)",
        url: `${SITE}${path}`,
        image: `${SITE}/icons/icon-512.png`,
        offers: {
          "@type": "Offer",
          price: "14.99",
          priceCurrency: "USD",
          category: "Subscription",
          description: "30-day free trial, then $14.99/month. Cancel anytime.",
        },
        featureList: software.featureList,
        audience: {
          "@type": "Audience",
          audienceType: "Professional braiders, loctitians, and natural-hair stylists",
        },
        provider: { "@type": "Organization", name: "Wynn Essentials", url: SITE },
      }
    : null;

  const blocks = [breadcrumb, faqPage, ...(softwareApp ? [softwareApp] : [])];

  return (
    <>
      {blocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </>
  );
}
