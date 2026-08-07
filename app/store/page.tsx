import type { Metadata } from "next";
import Link from "next/link";
import { Check, Sparkles, Download, Tablet, Infinity as InfinityIcon } from "lucide-react";
import {
  MarketingShell,
  MarketingHero,
  Section,
  CtaFooter,
} from "../components/marketing/MarketingShell";
import { C, FONT_DISPLAY, GRADIENTS, SHADOWS } from "../components/marketing/tokens";
import {
  listStoreProducts,
  isPurchasable,
  formatPrice,
  type StoreProduct,
} from "../lib/store-catalog";
import { StoreVisual } from "./_components/StoreVisual";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");
// Featured product hero doubles as the store's social-share image.
// Relative path — resolved to an absolute URL via metadataBase (layout).
const FEATURED_HERO = listStoreProducts().find((p) => p.featured)?.image;

export const metadata: Metadata = {
  title: "Braid Boss Pro Store — Braider Essentials & Digital Planners",
  description:
    "The Braid Boss Pro Store: braider essentials made for the chair. Shop the Braid Boss Pro Business Planner — a fully hyperlinked GoodNotes digital planner for bookings, income, clients, taxes and growth. Instant download.",
  alternates: { canonical: "/store" },
  keywords: [
    "braider essentials",
    "digital planner for braiders",
    "goodnotes planner braider",
    "braid business planner",
    "hair stylist digital planner",
    "braider booking planner",
    "braid boss pro store",
  ],
  openGraph: {
    title: "Braid Boss Pro Store — Braider Essentials",
    description:
      "Braider essentials made for the chair. First up: the Braid Boss Pro Business Planner, a fully hyperlinked GoodNotes digital planner that runs your whole braid business.",
    url: "/store",
    siteName: "Braid Boss Pro",
    type: "website",
    ...(FEATURED_HERO ? { images: [{ url: FEATURED_HERO, width: 2000, height: 2000 }] } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "Braid Boss Pro Store",
    description:
      "Braider essentials made for the chair — starting with the Braid Boss Pro Business Planner, a GoodNotes-ready digital planner.",
    ...(FEATURED_HERO ? { images: [FEATURED_HERO] } : {}),
  },
};

const PERKS = [
  { icon: Download, label: "Instant download" },
  { icon: Tablet, label: "Made for iPad & tablet" },
  { icon: InfinityIcon, label: "Yours forever" },
];

export default function StorePage() {
  const products = listStoreProducts();
  const featured = products.find((p) => p.featured) || products[0];

  // Breadcrumbs (Home › Store) + an ItemList of the catalog, so search
  // engines understand the store as a collection and can surface products.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Store", item: `${SITE}/store` },
    ],
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Braider Essentials",
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/store/${p.slug}`,
      name: p.name,
    })),
  };

  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <MarketingHero
        eyebrow="Braid Boss Pro Store"
        title={
          <>
            Braider essentials,
            <br />
            made for the chair.
          </>
        }
        body="Tools built at a real braid chair — not generic templates. Starting with a digital planner that runs your whole braid business, and growing into everything you reach for between installs."
        primaryCta={{ label: "Shop the planner", href: featured ? `/store/${featured.slug}` : "/store" }}
        secondaryCta={{ label: "See what's inside", href: "#featured" }}
      />

      {/* Perk strip */}
      <div style={{ background: C.paper }}>
        <div
          className="max-w-[1100px] mx-auto flex flex-wrap items-center justify-center"
          style={{ gap: 20, padding: "0 20px 8px" }}
        >
          {PERKS.map((p) => (
            <div
              key={p.label}
              className="flex items-center"
              style={{ gap: 8, color: C.coffee, fontSize: 13, fontWeight: 600 }}
            >
              <p.icon size={16} style={{ color: C.brandPrimary }} />
              {p.label}
            </div>
          ))}
        </div>
      </div>

      {/* Featured product spotlight */}
      {featured && (
        <Section id="featured" eyebrow="Featured" title="Meet your new business bestie" background={C.brandSurface}>
          <FeaturedSpotlight product={featured} />
        </Section>
      )}

      {/* Full catalog grid (shows the same one product for now, but scales
          the moment a second essential is added to the catalog). */}
      {products.length > 1 && (
        <Section eyebrow="The shop" title="Braider essentials">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 20,
            }}
          >
            {products.map((p) => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        </Section>
      )}

      <CtaFooter
        title="More essentials are coming"
        body="The planner is just the start. We're building the toolkit braiders actually reach for — sign in to Braid Boss Pro to be first to know when the next drop lands."
        primaryCta={{ label: featured ? "Shop the planner" : "Browse the store", href: featured ? `/store/${featured.slug}` : "/store" }}
        secondaryCta={{ label: "About Braid Boss Pro", href: "/about" }}
      />
    </MarketingShell>
  );
}

// ── Featured spotlight — large two-column feature for the hero product ──
const FeaturedSpotlight = ({ product }: { product: StoreProduct }) => {
  const buyable = isPurchasable(product);
  const priceEl = <PriceBlock product={product} />;

  return (
    <div className="bbp-reveal">
      <div className="store-spotlight-grid">
        <div>
          <Link href={`/store/${product.slug}`} style={{ display: "block" }}>
            <StoreVisual product={product} minHeight={340} />
          </Link>
        </div>
        <div>
          {product.badge && (
                <span
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#FFFFFF",
                    background: GRADIENTS.primary,
                    padding: "5px 12px",
                    borderRadius: 999,
                    marginBottom: 12,
                  }}
                >
                  {product.badge}
                </span>
              )}
              <h3
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: "clamp(28px, 4vw, 40px)",
                  fontWeight: 700,
                  color: C.ink,
                  margin: 0,
                  lineHeight: 1.08,
                }}
              >
                {product.name}
              </h3>
              <p style={{ color: C.coffee, fontSize: 16, lineHeight: 1.6, marginTop: 12 }}>
                {product.shortDescription}
              </p>

              <ul style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "grid", gap: 10 }}>
                {product.highlights.slice(0, 5).map((h) => (
                  <li key={h} className="flex items-start" style={{ gap: 10 }}>
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: 22,
                        height: 22,
                        marginTop: 1,
                        borderRadius: 999,
                        background: GRADIENTS.softC,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Check size={13} style={{ color: C.brandSuccess }} />
                    </span>
                    <span style={{ color: C.ink, fontSize: 14.5, lineHeight: 1.5 }}>{h}</span>
                  </li>
                ))}
              </ul>

              <div style={{ marginTop: 24 }}>{priceEl}</div>

              <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 18 }}>
                <Link
                  href={`/store/${product.slug}`}
                  style={{
                    padding: "14px 24px",
                    borderRadius: 14,
                    background: GRADIENTS.primary,
                    color: "#FFFFFF",
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    boxShadow: SHADOWS.primaryGlow,
                  }}
                >
                  {buyable ? "Get the planner" : "View details"}
                </Link>
                <Link
                  href={`/store/${product.slug}#whats-inside`}
                  style={{
                    padding: "14px 24px",
                    borderRadius: 14,
                    background: "transparent",
                    color: C.brandPrimary,
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    border: `1.5px solid ${C.brandPrimary}`,
                  }}
                >
                  What&apos;s inside
                </Link>
              </div>
            </div>
        </div>

      {/* Two-column layout via a scoped style tag (matches the marketing
          pages' inline-CSS approach; collapses to one column on mobile). */}
      <style>{`
        .store-spotlight-grid { display: grid; grid-template-columns: 1fr; gap: 28px; align-items: center; }
        @media (min-width: 820px) {
          .store-spotlight-grid { grid-template-columns: 0.95fr 1.05fr; gap: 40px; }
        }
      `}</style>
    </div>
  );
};

// ── Price block (local to the landing page) ───────────────────────────
const PriceBlock = ({ product }: { product: StoreProduct }) => {
  const buyable = isPurchasable(product);
  if (!buyable) {
    return (
      <span
        style={{
          display: "inline-block",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.brandPrimary,
          background: GRADIENTS.softA,
          border: `1px solid ${C.brandBorder}`,
          padding: "8px 14px",
          borderRadius: 999,
        }}
      >
        <Sparkles size={13} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
        Coming soon
      </span>
    );
  }
  const hasCompare =
    product.compareAtCents && product.compareAtCents > product.priceCents;
  return (
    <div className="flex items-baseline" style={{ gap: 10 }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 700, color: C.ink }}>
        {formatPrice(product.priceCents, product.currency)}
      </span>
      {hasCompare && (
        <span
          style={{
            fontSize: 18,
            color: C.mutedSoft,
            textDecoration: "line-through",
          }}
        >
          {formatPrice(product.compareAtCents!, product.currency)}
        </span>
      )}
    </div>
  );
};

// ── Compact catalog card ──────────────────────────────────────────────
const ProductCard = ({ product }: { product: StoreProduct }) => (
  <Link
    href={`/store/${product.slug}`}
    className="bbp-reveal"
    style={{
      display: "block",
      textDecoration: "none",
      background: "#FFFFFF",
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 22,
      overflow: "hidden",
      boxShadow: SHADOWS.card,
    }}
  >
    <StoreVisual product={product} rounded={0} minHeight={200} />
    <div style={{ padding: 18 }}>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.ink, margin: 0 }}>
        {product.name}
      </p>
      <p style={{ color: C.coffee, fontSize: 13.5, lineHeight: 1.5, marginTop: 6 }}>
        {product.tagline}
      </p>
      <div style={{ marginTop: 12 }}>
        <PriceBlock product={product} />
      </div>
    </div>
  </Link>
);
