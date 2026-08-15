import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronLeft, Star } from "lucide-react";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import { C, FONT_DISPLAY, GRADIENTS } from "../../components/marketing/tokens";
import {
  getStoreProduct,
  isPurchasable,
  listStoreProducts,
  STORE_PRODUCTS,
} from "../../lib/store-catalog";
import { StoreVisual } from "../_components/StoreVisual";
import BuyPanel from "./BuyPanel";
import ProductGallery, { type GalleryImage } from "./ProductGallery";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app").replace(/\/$/, "");

// Pre-render every catalog product at build time.
export function generateStaticParams() {
  return STORE_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = getStoreProduct(slug);
  if (!product) {
    return { title: "Product not found · Braid Boss Pro Store" };
  }
  const title = `${product.name} · Braid Boss Pro Store`;
  const description = product.shortDescription;
  return {
    title,
    description,
    alternates: { canonical: `/store/${product.slug}` },
    openGraph: {
      title,
      description,
      url: `/store/${product.slug}`,
      siteName: "Braid Boss Pro",
      type: "website",
      // A relative path resolves to an absolute URL via metadataBase
      // (app/layout.tsx). The hero is a 2000×2000 designed graphic, so it
      // makes a strong share card on its own.
      ...(product.image
        ? {
            images: [
              { url: product.image, width: 2000, height: 2000, alt: product.imageAlt || product.name },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(product.image ? { images: [product.image] } : {}),
    },
  };
}

export default async function StoreProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = getStoreProduct(slug);
  if (!product) notFound();

  const buyable = isPurchasable(product);
  const others = listStoreProducts().filter((p) => p.slug !== product.slug);

  // Gallery = hero first, then the extra catalog images. Drives the
  // interactive <ProductGallery/>; empty when the product has no hero
  // (unconfigured / coming-soon), in which case the branded placeholder
  // renders instead.
  const galleryImages: GalleryImage[] = product.image
    ? [
        { src: product.image, alt: product.imageAlt || product.name },
        ...(product.gallery ?? []),
      ]
    : [];

  // Absolute image URLs for structured data (schema.org wants absolute).
  const toAbs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${SITE}${u}`);
  const productImages = [
    ...(product.image ? [product.image] : []),
    ...(product.gallery ?? []).map((g) => g.src),
  ].map(toAbs);

  // Product JSON-LD for rich results. Only advertise an Offer when the
  // product is actually purchasable and priced.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription,
    category: product.category,
    brand: { "@type": "Brand", name: "Braid Boss Pro" },
    sku: product.slug,
    ...(productImages.length ? { image: productImages } : {}),
    ...(buyable
      ? {
          offers: {
            "@type": "Offer",
            url: `${SITE}/store/${product.slug}`,
            priceCurrency: product.currency.toUpperCase(),
            price: (product.priceCents / 100).toFixed(2),
            availability: "https://schema.org/InStock",
            itemCondition: "https://schema.org/NewCondition",
            seller: { "@type": "Organization", name: "Braid Boss Pro" },
          },
        }
      : {}),
  };

  // Breadcrumbs — Home › Store › Product. Helps breadcrumb rich results.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Store", item: `${SITE}/store` },
      {
        "@type": "ListItem",
        position: 3,
        name: product.name,
        item: `${SITE}/store/${product.slug}`,
      },
    ],
  };

  const faqJsonLd =
    product.faqs && product.faqs.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: product.faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }
      : null;

  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}

      <div className="max-w-[1100px] mx-auto" style={{ padding: "24px 20px 0" }}>
        <Link
          href="/store"
          className="inline-flex items-center"
          style={{ gap: 4, color: C.brandPrimary, fontSize: 13, fontWeight: 700, textDecoration: "none" }}
        >
          <ChevronLeft size={16} /> Back to the store
        </Link>
      </div>

      {/* Top: visual + buy panel */}
      <section style={{ padding: "20px 20px 8px" }}>
        <div className="max-w-[1100px] mx-auto store-product-grid">
          <div className="bbp-reveal">
            {galleryImages.length > 0 ? (
              <ProductGallery images={galleryImages} />
            ) : (
              <StoreVisual product={product} minHeight={380} />
            )}
          </div>

          <div className="bbp-reveal" data-delay="100">
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
            <p
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: C.brandPrimary,
                margin: 0,
              }}
            >
              {product.category}
            </p>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: "clamp(30px, 5vw, 46px)",
                fontWeight: 700,
                color: C.ink,
                margin: "8px 0 0",
                lineHeight: 1.06,
              }}
            >
              {product.name}
            </h1>
            <p style={{ color: C.coffee, fontSize: 16, lineHeight: 1.6, marginTop: 12 }}>
              {product.tagline}
            </p>

            <div style={{ marginTop: 20 }}>
              <BuyPanel
                slug={product.slug}
                priceCents={product.priceCents}
                compareAtCents={product.compareAtCents}
                currency={product.currency}
                purchasable={buyable}
                isDigital={product.isDigital}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Description */}
      <section style={{ padding: "40px 20px 0" }}>
        <div className="max-w-[760px] mx-auto bbp-reveal">
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: "clamp(24px, 3.5vw, 32px)",
              fontWeight: 700,
              color: C.ink,
              margin: 0,
            }}
          >
            Why braiders love it
          </h2>
          {product.longDescription.map((para, i) => (
            <p key={i} style={{ color: C.coffee, fontSize: 15.5, lineHeight: 1.7, marginTop: 14 }}>
              {para}
            </p>
          ))}
        </div>
      </section>

      {/* What's inside */}
      {product.whatsInside && product.whatsInside.length > 0 && (
        <section id="whats-inside" style={{ padding: "40px 20px 0", scrollMarginTop: 80 }}>
          <div
            className="max-w-[820px] mx-auto bbp-reveal"
            style={{
              background: C.brandSurface,
              border: `1px solid ${C.brandBorder}`,
              borderRadius: 24,
              padding: "28px 24px",
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: C.brandPrimary,
                margin: 0,
                textAlign: "center",
              }}
            >
              What&apos;s inside
            </p>
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: "clamp(24px, 3.5vw, 32px)",
                fontWeight: 700,
                color: C.ink,
                margin: "8px 0 22px",
                textAlign: "center",
              }}
            >
              Everything you need in one file
            </h2>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              {product.whatsInside.map((item) => (
                <li
                  key={item}
                  className="flex items-start"
                  style={{
                    gap: 10,
                    background: "#FFFFFF",
                    border: `1px solid ${C.brandBorder}`,
                    borderRadius: 14,
                    padding: "12px 14px",
                  }}
                >
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
                  <span style={{ color: C.ink, fontSize: 14, lineHeight: 1.45 }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Highlights ribbon */}
      <section style={{ padding: "40px 20px 0" }}>
        <div
          className="max-w-[820px] mx-auto bbp-reveal flex flex-wrap items-center justify-center"
          style={{ gap: 10 }}
        >
          {product.highlights.map((h) => (
            <span
              key={h}
              className="inline-flex items-center"
              style={{
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                color: C.coffee,
                background: "#FFFFFF",
                border: `1px solid ${C.brandBorder}`,
                borderRadius: 999,
                padding: "8px 14px",
              }}
            >
              <Star size={13} style={{ color: C.brandWarning }} /> {h}
            </span>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      {product.whoItsFor && (
        <section style={{ padding: "44px 20px 0" }}>
          <div
            className="max-w-[760px] mx-auto bbp-reveal"
            style={{
              background: GRADIENTS.softB,
              border: `1px solid ${C.brandBorder}`,
              borderRadius: 22,
              padding: "26px 24px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: C.brandPrimary,
                margin: 0,
              }}
            >
              Who it&apos;s for
            </p>
            <p style={{ color: C.ink, fontSize: 16, lineHeight: 1.7, marginTop: 10 }}>
              {product.whoItsFor}
            </p>
          </div>
        </section>
      )}

      {/* What you get + What you'll need — two columns */}
      {(product.whatYouGet?.length || product.requirements?.length) && (
        <section style={{ padding: "40px 20px 0" }}>
          <div className="max-w-[900px] mx-auto store-two-col bbp-reveal">
            {product.whatYouGet?.length ? (
              <InfoCard title="What you get">
                {product.whatYouGet.map((item) => (
                  <li key={item} className="flex items-start" style={infoLi}>
                    <Check size={15} style={{ color: C.brandSuccess, flex: "0 0 auto", marginTop: 2 }} />
                    <span style={{ color: C.ink, fontSize: 14, lineHeight: 1.5 }}>{item}</span>
                  </li>
                ))}
              </InfoCard>
            ) : null}
            {product.requirements?.length ? (
              <InfoCard title="What you'll need">
                {product.requirements.map((item) => (
                  <li key={item} className="flex items-start" style={infoLi}>
                    <Check size={15} style={{ color: C.brandPrimary, flex: "0 0 auto", marginTop: 2 }} />
                    <span style={{ color: C.ink, fontSize: 14, lineHeight: 1.5 }}>{item}</span>
                  </li>
                ))}
              </InfoCard>
            ) : null}
          </div>
        </section>
      )}

      {/* FAQ */}
      {product.faqs && product.faqs.length > 0 && (
        <section id="faq" style={{ padding: "48px 20px 0", scrollMarginTop: 80 }}>
          <div className="max-w-[760px] mx-auto">
            <h2
              className="bbp-reveal"
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: "clamp(24px, 3.5vw, 32px)",
                fontWeight: 700,
                color: C.ink,
                margin: "0 0 18px",
                textAlign: "center",
              }}
            >
              Frequently asked questions
            </h2>
            <div style={{ display: "grid", gap: 10 }}>
              {product.faqs.map((f) => (
                <details
                  key={f.q}
                  className="bbp-reveal"
                  style={{
                    background: "#FFFFFF",
                    border: `1px solid ${C.brandBorder}`,
                    borderRadius: 14,
                    padding: "14px 18px",
                  }}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      fontWeight: 700,
                      color: C.ink,
                      fontSize: 15,
                      listStyle: "none",
                    }}
                  >
                    {f.q}
                  </summary>
                  <p style={{ color: C.coffee, fontSize: 14, lineHeight: 1.6, margin: "10px 0 0" }}>
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Licence / refund note */}
      {product.policyNote && (
        <section style={{ padding: "32px 20px 0" }}>
          <p
            className="max-w-[720px] mx-auto bbp-reveal"
            style={{ color: C.mutedSoft, fontSize: 12.5, lineHeight: 1.7, textAlign: "center" }}
          >
            {product.policyNote}
          </p>
        </section>
      )}

      {/* More from the store */}
      {others.length > 0 && (
        <section style={{ padding: "48px 20px 0" }}>
          <div className="max-w-[1100px] mx-auto">
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 24,
                fontWeight: 700,
                color: C.ink,
                margin: "0 0 18px",
              }}
            >
              More braider essentials
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 16,
              }}
            >
              {others.map((p) => (
                <Link
                  key={p.slug}
                  href={`/store/${p.slug}`}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    background: "#FFFFFF",
                    border: `1px solid ${C.brandBorder}`,
                    borderRadius: 18,
                    overflow: "hidden",
                  }}
                >
                  <StoreVisual product={p} rounded={0} minHeight={150} showLabel={false} />
                  <div style={{ padding: 14 }}>
                    <p style={{ fontWeight: 700, color: C.ink, margin: 0, fontSize: 15 }}>{p.name}</p>
                    <p style={{ color: C.muted, fontSize: 12.5, marginTop: 4 }}>{p.tagline}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <div style={{ height: 40 }} />

      <style>{`
        .store-product-grid { display: grid; grid-template-columns: 1fr; gap: 28px; align-items: start; }
        @media (min-width: 860px) {
          .store-product-grid { grid-template-columns: 1.05fr 0.95fr; gap: 40px; }
        }
        .store-two-col { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
        @media (min-width: 720px) {
          .store-two-col { grid-template-columns: 1fr 1fr; }
        }
        details > summary::-webkit-details-marker { display: none; }
      `}</style>
    </MarketingShell>
  );
}

// ── Small presentational helpers ──────────────────────────────────────
const infoLi: React.CSSProperties = { gap: 9, marginBottom: 10 };

const InfoCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div
    style={{
      background: "#FFFFFF",
      border: `1px solid ${C.brandBorder}`,
      borderRadius: 20,
      padding: "22px 22px 8px",
    }}
  >
    <p
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: C.brandPrimary,
        margin: "0 0 14px",
      }}
    >
      {title}
    </p>
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{children}</ul>
  </div>
);
