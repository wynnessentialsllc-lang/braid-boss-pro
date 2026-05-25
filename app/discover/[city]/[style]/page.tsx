// Programmatic SEO landing for a city × style combination.
//
// URL: /discover/[city]/[style]  e.g.  /discover/atlanta/knotless-braids
//
// Filters opted-in stylists in the city to those whose service menu
// mentions the style (via STYLE_TAXONOMY aliases). Service lookups
// are bounded — we cap how many stylists we probe to keep the
// per-build fanout reasonable.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchDiscoverStylistsServer,
  fetchPublicServicesBySlug,
} from "../../../lib/marketplace-server";
import {
  SITE_URL,
  absUrl,
  unslugifyCity,
  slugify,
  findStyle,
  styleOfferedBy,
  STYLE_TAXONOMY,
  jsonLdScript,
  stylistItemListJsonLd,
  breadcrumbJsonLd,
  type StylistSeo,
} from "../../../lib/seo";

export const revalidate = 3600;

type Params = { city: string; style: string };

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

// Cap the per-page service probe so a popular city doesn't trigger
// hundreds of RPC calls per regeneration. Stylists past the cap
// still appear on the parent /discover/[city] page.
const PROBE_LIMIT = 40;

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { city, style } = await params;
  const entry = findStyle(style);
  const cityName = unslugifyCity(city);
  if (!entry) {
    return { title: `${cityName} braiders · Braid Boss Pro`, alternates: { canonical: `/discover/${city}` } };
  }
  const title = `${entry.name} in ${cityName} — Book a stylist · Braid Boss Pro`;
  const description = `${entry.blurb} Book a ${entry.name.toLowerCase()} stylist in ${cityName} on Braid Boss Pro — real-time availability, secure deposits.`;
  return {
    title,
    description,
    alternates: { canonical: `/discover/${city}/${style}` },
    openGraph: { title, description, url: absUrl(`/discover/${city}/${style}`), siteName: "Braid Boss Pro", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CityStylePage(
  { params }: { params: Promise<Params> },
) {
  const { city, style } = await params;
  const entry = findStyle(style);
  if (!entry) notFound();
  const cityName = unslugifyCity(city);

  const all = await fetchDiscoverStylistsServer();
  const inCity = all.filter(s => s.city && slugify(s.city) === city);

  // Probe service menus in parallel, capped.
  const probed: { stylist: StylistSeo; offers: boolean }[] = [];
  const head = inCity.slice(0, PROBE_LIMIT);
  await Promise.all(
    head.map(async (st) => {
      const services = await fetchPublicServicesBySlug(st.slug);
      probed.push({ stylist: st, offers: styleOfferedBy(entry, services.map(s => s.name)) });
    }),
  );
  const matches = probed.filter(p => p.offers).map(p => p.stylist);

  const listLd = stylistItemListJsonLd(matches, `/discover/${city}/${style}`);
  const crumbs = breadcrumbJsonLd([
    { name: "Discover", url: "/discover" },
    { name: cityName, url: `/discover/${city}` },
    { name: entry.name, url: `/discover/${city}/${style}` },
  ]);

  return (
    <main style={{ background: C.ivory, minHeight: "100vh", paddingBottom: 60 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <link rel="canonical" href={`${SITE_URL}/discover/${city}/${style}`} />

      <header style={{ padding: "44px 22px 26px", maxWidth: 1080, margin: "0 auto" }}>
        <nav style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
          <Link href="/discover" style={{ color: C.muted, textDecoration: "none" }}>Discover</Link>
          <span> · </span>
          <Link href={`/discover/${city}`} style={{ color: C.muted, textDecoration: "none" }}>{cityName}</Link>
          <span> · </span>
          <span style={{ color: C.espresso }}>{entry.name}</span>
        </nav>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 44, lineHeight: 1.05, margin: 0, color: C.espresso, fontWeight: 700 }}>
          {entry.name} in {cityName}
        </h1>
        <p style={{ color: C.coffee, fontSize: 16, lineHeight: 1.55, marginTop: 12, maxWidth: 720 }}>
          {entry.blurb}
        </p>
      </header>

      {matches.length > 0 ? (
        <section style={{ padding: "0 22px", maxWidth: 1080, margin: "0 auto" }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.espresso, fontWeight: 700, margin: "0 0 14px" }}>
            {matches.length} stylist{matches.length === 1 ? "" : "s"} offering {entry.name.toLowerCase()} in {cityName}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {matches.map(s => (
              <article key={s.slug} style={{ background: C.cream, borderRadius: 18, padding: 18, border: `1px solid ${C.hairline}` }}>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, margin: 0, color: C.espresso, fontWeight: 700 }}>
                  {s.businessName}
                </h3>
                {s.intro && (
                  <p style={{ fontSize: 13.5, color: C.coffee, lineHeight: 1.5, margin: "10px 0 0" }}>
                    {s.intro.slice(0, 140)}{s.intro.length > 140 ? "…" : ""}
                  </p>
                )}
                {s.ratingCount > 0 && s.ratingAvg != null && (
                  <p style={{ fontSize: 12, color: C.goldDeep, margin: "10px 0 0", fontWeight: 600 }}>
                    ★ {s.ratingAvg.toFixed(1)} · {s.ratingCount} review{s.ratingCount === 1 ? "" : "s"}
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
      ) : (
        <section style={{ padding: "0 22px", maxWidth: 720, margin: "0 auto" }}>
          <div style={{ background: C.cream, border: `1px solid ${C.hairline}`, borderRadius: 18, padding: 22 }}>
            <p style={{ color: C.coffee, fontSize: 15, lineHeight: 1.55, margin: 0 }}>
              No {entry.name.toLowerCase()} stylists in {cityName} on Braid Boss Pro yet.{" "}
              <Link href={`/discover/${city}`} style={{ color: C.goldDeep }}>See all braiders in {cityName}</Link>{" "}
              or browse another style below.
            </p>
          </div>
        </section>
      )}

      <section style={{ padding: "44px 22px 0", maxWidth: 1080, margin: "0 auto" }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.espresso, fontWeight: 700, margin: 0 }}>
          Other styles in {cityName}
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          {STYLE_TAXONOMY.filter(s => s.slug !== style).map(s => (
            <Link
              key={s.slug}
              href={`/discover/${city}/${s.slug}`}
              style={{
                padding: "8px 14px", borderRadius: 999, border: `1px solid ${C.hairline}`,
                background: C.cream, color: C.coffee, fontSize: 13, textDecoration: "none",
              }}
            >
              {s.name}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
