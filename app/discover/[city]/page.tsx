// Programmatic SEO landing page for a single city.
//
// URL: /discover/[city]  e.g.  /discover/atlanta
//
// Server-rendered so every stylist + their listing copy ends up
// in the HTML that Googlebot sees. Pulls from the same
// `public_discover_stylists` RPC the client /discover page uses,
// filtered server-side by the city slug.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchDiscoverStylistsServer } from "../../lib/marketplace-server";
import {
  SITE_URL,
  absUrl,
  unslugifyCity,
  slugify,
  STYLE_TAXONOMY,
  jsonLdScript,
  stylistItemListJsonLd,
  breadcrumbJsonLd,
} from "../../lib/seo";

export const revalidate = 3600;

type Params = { city: string };

// Cheap palette inline so this server page doesn't need to import
// the marketing shell client component.
const C = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { city } = await params;
  const cityName = unslugifyCity(city);
  const title = `Braiders in ${cityName} — Book online · Braid Boss Pro`;
  const description = `Find and book the best braid stylists in ${cityName}. Real-time availability, verified reviews, and secure online deposits.`;
  return {
    title,
    description,
    alternates: { canonical: `/discover/${city}` },
    openGraph: { title, description, url: absUrl(`/discover/${city}`), siteName: "Braid Boss Pro", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CityDiscoverPage(
  { params }: { params: Promise<Params> },
) {
  const { city } = await params;
  const cityName = unslugifyCity(city);
  const all = await fetchDiscoverStylistsServer();
  const stylists = all.filter(s => s.city && slugify(s.city) === city);

  // 404 only if the URL itself is empty/garbage. Empty result is
  // still a valid (indexable) page so Google can re-crawl when
  // stylists join.
  if (!city) notFound();

  const listLd = stylistItemListJsonLd(stylists, `/discover/${city}`);
  const crumbs = breadcrumbJsonLd([
    { name: "Discover", url: "/discover" },
    { name: cityName, url: `/discover/${city}` },
  ]);

  return (
    <main style={{ background: C.ivory, minHeight: "100vh", paddingBottom: 60 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <link rel="canonical" href={`${SITE_URL}/discover/${city}`} />

      <header style={{ padding: "44px 22px 26px", maxWidth: 1080, margin: "0 auto" }}>
        <nav style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
          <Link href="/discover" style={{ color: C.muted, textDecoration: "none" }}>Discover</Link>
          <span> · </span>
          <span style={{ color: C.espresso }}>{cityName}</span>
        </nav>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 44, lineHeight: 1.05, margin: 0, color: C.espresso, fontWeight: 700 }}>
          Braiders in {cityName}
        </h1>
        <p style={{ color: C.coffee, fontSize: 16, lineHeight: 1.55, marginTop: 12, maxWidth: 640 }}>
          {stylists.length > 0
            ? `${stylists.length} stylist${stylists.length === 1 ? "" : "s"} in ${cityName} taking online bookings on Braid Boss Pro. Pick a style, check availability, and lock in your appointment in under a minute.`
            : `No stylists in ${cityName} on Braid Boss Pro yet. Browse nearby or check back soon — new stylists are listed every week.`}
        </p>
      </header>

      {stylists.length > 0 && (
        <section style={{ padding: "0 22px", maxWidth: 1080, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {stylists.map(s => (
              <article key={s.slug} style={{ background: C.cream, borderRadius: 18, padding: 18, border: `1px solid ${C.hairline}` }}>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, margin: 0, color: C.espresso, fontWeight: 700 }}>
                  {s.businessName}
                </h2>
                {(s.city || s.state) && (
                  <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0" }}>
                    {[s.city, s.state].filter(Boolean).join(", ")}
                  </p>
                )}
                {s.intro && (
                  <p style={{ fontSize: 13.5, color: C.coffee, lineHeight: 1.5, margin: "10px 0 0" }}>
                    {s.intro.slice(0, 160)}{s.intro.length > 160 ? "…" : ""}
                  </p>
                )}
                {s.ratingCount > 0 && s.ratingAvg != null && (
                  <p style={{ fontSize: 12, color: C.goldDeep, margin: "10px 0 0", fontWeight: 600 }}>
                    ★ {s.ratingAvg.toFixed(1)} · {s.ratingCount} review{s.ratingCount === 1 ? "" : "s"}
                  </p>
                )}
                {s.priceMin != null && s.priceMax != null && (
                  <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0" }}>
                    ${Math.round(s.priceMin)}–${Math.round(s.priceMax)}
                  </p>
                )}
                <Link
                  href={`/book/${s.slug}`}
                  style={{
                    display: "inline-block", marginTop: 14, padding: "10px 16px",
                    borderRadius: 12, background: C.gold, color: "#fff", textDecoration: "none",
                    fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  }}
                >
                  Book online
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <section style={{ padding: "44px 22px 0", maxWidth: 1080, margin: "0 auto" }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, color: C.espresso, fontWeight: 700, margin: 0 }}>
          Browse {cityName} braiders by style
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          {STYLE_TAXONOMY.map(style => (
            <Link
              key={style.slug}
              href={`/discover/${city}/${style.slug}`}
              style={{
                padding: "8px 14px", borderRadius: 999, border: `1px solid ${C.hairline}`,
                background: C.cream, color: C.coffee, fontSize: 13, textDecoration: "none",
              }}
            >
              {style.name}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
