// Server-rendered stylist card for the /braiders directory pages.
// Pure markup (no client JS) so the listing is fully in the initial HTML
// for crawlers. Links to the stylist's public booking page.

import Link from "next/link";
import { Star, MapPin, Plane } from "lucide-react";
import { priceRangeLabel, styleLabel, type DiscoverStylist } from "../../lib/marketplace";
import { C, FONT_DISPLAY, SHADOWS } from "./tokens";

export function StylistDirectoryCard({ stylist }: { stylist: DiscoverStylist }) {
  const price = priceRangeLabel(stylist.priceMin, stylist.priceMax);
  const location = [stylist.city, stylist.state].filter(Boolean).join(", ");
  const cover = stylist.coverPhoto || stylist.logoUrl;
  const tags = stylist.styleTags.slice(0, 4);

  return (
    <Link
      href={`/book/${encodeURIComponent(stylist.slug)}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <article
        className="bbp-reveal"
        style={{
          overflow: "hidden",
          borderRadius: 18,
          background: C.paper,
          border: `1px solid ${C.brandBorder}`,
          boxShadow: SHADOWS.card,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ position: "relative", aspectRatio: "16 / 10", background: C.brandSurface }}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- app has no next/image; marketing surface uses plain <img>
            <img
              src={cover}
              alt={`${stylist.businessName} — braid stylist${location ? ` in ${location}` : ""}`}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              aria-hidden
              style={{
                width: "100%",
                height: "100%",
                display: "grid",
                placeItems: "center",
                fontFamily: FONT_DISPLAY,
                fontSize: 34,
                fontWeight: 700,
                color: C.brandPrimary,
                background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(255,77,109,0.10))",
              }}
            >
              {stylist.businessName.slice(0, 1).toUpperCase()}
            </div>
          )}
          {stylist.travels && (
            <span
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 9px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.92)",
                color: C.brandPrimary,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <Plane size={11} aria-hidden /> Travels to you
            </span>
          )}
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, margin: 0, lineHeight: 1.15 }}>
              {stylist.businessName}
            </h3>
            {stylist.ratingCount > 0 && stylist.ratingAvg != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: C.coffee, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                <Star size={13} aria-hidden style={{ color: C.brandWarning, fill: C.brandWarning }} />
                {stylist.ratingAvg.toFixed(1)}
                <span style={{ color: C.mutedSoft, fontWeight: 500 }}>({stylist.ratingCount})</span>
              </span>
            )}
          </div>

          {location && (
            <p style={{ display: "flex", alignItems: "center", gap: 5, color: C.muted, fontSize: 13, margin: 0 }}>
              <MapPin size={13} aria-hidden /> {location}
            </p>
          )}

          {stylist.intro && (
            <p style={{ color: C.coffee, fontSize: 13, lineHeight: 1.5, margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {stylist.intro}
            </p>
          )}

          {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
              {tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.brandPrimary,
                    background: "#F2ECFB",
                    padding: "3px 8px",
                    borderRadius: 999,
                  }}
                >
                  {styleLabel(t)}
                </span>
              ))}
            </div>
          )}

          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 6 }}>
            {price ? (
              <span style={{ color: C.ink, fontSize: 13, fontWeight: 700 }}>{price}</span>
            ) : <span />}
            <span style={{ color: C.brandPrimary, fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              View &amp; book →
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
