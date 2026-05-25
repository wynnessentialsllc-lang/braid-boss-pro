// Shared SEO primitives — site URL, slug/city helpers, the public
// style taxonomy that powers /discover/[city]/[style], and JSON-LD
// builders used by the booking page + discover landings.
//
// Kept dependency-free so it can be imported from server components,
// sitemap.ts, and route handlers without dragging in supabase-js.

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://braidbosspro.app"
);

export const absUrl = (path: string): string => {
  if (!path) return SITE_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

// ---- City / style slug helpers -------------------------------------------

export const slugify = (s: string): string =>
  s.toLowerCase().trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const unslugifyCity = (slug: string): string =>
  slug.split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");

// ---- Public style taxonomy -----------------------------------------------
// Drives /discover/[city]/[style] programmatic pages and (eventually)
// the visual style library. Order = display order on the matrix.
// `aliases` is what we match against stylist service names to decide
// who offers a given style.

export type StyleEntry = {
  slug: string;
  name: string;        // human display
  blurb: string;       // 1-line SEO description
  aliases: string[];   // lowercase substrings that count as "offers this"
};

export const STYLE_TAXONOMY: StyleEntry[] = [
  { slug: "knotless-braids", name: "Knotless Braids",
    blurb: "Tensionless feed-in braids that are gentler on the scalp and lay flat from the root.",
    aliases: ["knotless"] },
  { slug: "box-braids", name: "Box Braids",
    blurb: "Classic squared-section braids in any length, size, and color.",
    aliases: ["box braid", "box braids"] },
  { slug: "boho-braids", name: "Boho Braids",
    blurb: "Knotless braids with loose curly ends for a soft, lived-in finish.",
    aliases: ["boho", "bohemian"] },
  { slug: "fulani-braids", name: "Fulani Braids",
    blurb: "Cornrow + box-braid blend with signature center-part and side accents.",
    aliases: ["fulani"] },
  { slug: "passion-twists", name: "Passion Twists",
    blurb: "Soft, curly two-strand twists with a romantic, beachy texture.",
    aliases: ["passion twist", "passion twists"] },
  { slug: "goddess-braids", name: "Goddess Braids",
    blurb: "Thicker braids hand-laid against the scalp for a sculpted, regal finish.",
    aliases: ["goddess"] },
  { slug: "micro-braids", name: "Micro Braids",
    blurb: "Tiny, precise braids for maximum versatility and a sleek silhouette.",
    aliases: ["micro"] },
  { slug: "lemonade-braids", name: "Lemonade Braids",
    blurb: "Side-swept feed-in cornrows inspired by the iconic Beyoncé look.",
    aliases: ["lemonade"] },
  { slug: "feed-in-braids", name: "Feed-In Braids",
    blurb: "Cornrows fed with extensions so the braid grows naturally from your hair.",
    aliases: ["feed-in", "feed in"] },
  { slug: "cornrows", name: "Cornrows",
    blurb: "Tight, scalp-hugging braids in any pattern — straight-backs, designs, or freestyle.",
    aliases: ["cornrow"] },
  { slug: "jumbo-braids", name: "Jumbo Braids",
    blurb: "Oversized braids that install fast and make a statement.",
    aliases: ["jumbo"] },
  { slug: "stitch-braids", name: "Stitch Braids",
    blurb: "Cornrows with crisp horizontal partings between each braid.",
    aliases: ["stitch"] },
  { slug: "tribal-braids", name: "Tribal Braids",
    blurb: "Cornrows + free-hanging braids mixed with cuffs and beads.",
    aliases: ["tribal"] },
  { slug: "butterfly-locs", name: "Butterfly Locs",
    blurb: "Distressed faux locs with a soft, undone texture.",
    aliases: ["butterfly loc"] },
  { slug: "locs", name: "Locs & Faux Locs",
    blurb: "Traditional locs, starter locs, and faux loc installs.",
    aliases: ["loc", "dread"] },
];

export const findStyle = (slug: string): StyleEntry | null =>
  STYLE_TAXONOMY.find(s => s.slug === slug) || null;

export const styleOfferedBy = (style: StyleEntry, serviceNames: string[]): boolean => {
  const blob = serviceNames.join(" | ").toLowerCase();
  return style.aliases.some(a => blob.includes(a));
};

// ---- JSON-LD builders ----------------------------------------------------
// Output is plain objects; consumers wrap with <script type="application/ld+json">.

export const jsonLdScript = (obj: unknown): string =>
  // Escape `<` to keep the JSON safe inside a <script> tag.
  JSON.stringify(obj).replace(/</g, "\\u003c");

export type StylistSeo = {
  slug: string;
  businessName: string;
  intro: string | null;
  logoUrl: string | null;
  city: string | null;
  state: string | null;
  priceMin: number | null;
  priceMax: number | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export const stylistLocalBusinessJsonLd = (s: StylistSeo) => {
  const url = absUrl(`/book/${s.slug}`);
  const address = s.city || s.state
    ? {
        "@type": "PostalAddress",
        addressLocality: s.city || undefined,
        addressRegion: s.state || undefined,
        addressCountry: "US",
      }
    : undefined;
  const priceRange = s.priceMin != null && s.priceMax != null
    ? `$${Math.round(s.priceMin)}–$${Math.round(s.priceMax)}`
    : undefined;
  const aggregateRating = s.ratingCount > 0 && s.ratingAvg != null
    ? {
        "@type": "AggregateRating",
        ratingValue: Number(s.ratingAvg.toFixed(1)),
        reviewCount: s.ratingCount,
        bestRating: 5,
        worstRating: 1,
      }
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": ["HairSalon", "LocalBusiness"],
    "@id": url,
    name: s.businessName,
    url,
    image: s.logoUrl || undefined,
    description: s.intro || undefined,
    address,
    priceRange,
    aggregateRating,
  };
};

export const stylistItemListJsonLd = (
  stylists: StylistSeo[],
  pageUrl: string,
) => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  url: absUrl(pageUrl),
  numberOfItems: stylists.length,
  itemListElement: stylists.map((s, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: absUrl(`/book/${s.slug}`),
    name: s.businessName,
  })),
});

export const breadcrumbJsonLd = (
  trail: { name: string; url: string }[],
) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((t, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: t.name,
    item: absUrl(t.url),
  })),
});
