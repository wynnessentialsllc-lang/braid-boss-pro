// Server component that emits the structured-data <script> tags for a
// comparison page: BreadcrumbList (Home > this comparison) and FAQPage
// (from the same QA[] the page renders visibly, so the markup matches
// on-page content per Google's structured-data guidelines).
//
// Mirrors FeatureSchema.tsx, but the breadcrumb leaf sits directly under
// Home because there is no /compare hub page to link to. Rendered
// server-side so crawlers see it in the initial HTML.
//
// No "use client" — this only produces inline <script type=ld+json>.

import { type FaqEntry } from "./FeatureSchema";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

export type CompareSchemaProps = {
  // Canonical path for this page, e.g. "/compare/braid-boss-pro-vs-styleseat".
  path: string;
  // Human label for the breadcrumb leaf, e.g. "Braid Boss Pro vs StyleSeat".
  breadcrumbName: string;
  // FAQ entries — plain-text answers for the schema (keep in lockstep
  // with what the page renders).
  faqs: FaqEntry[];
};

export default function CompareSchema({ path, breadcrumbName, faqs }: CompareSchemaProps) {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE },
      { "@type": "ListItem", position: 2, name: breadcrumbName, item: `${SITE}${path}` },
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

  return (
    <>
      {[breadcrumb, faqPage].map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </>
  );
}
