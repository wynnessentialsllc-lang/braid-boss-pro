import { ImageResponse } from "next/og";

// Per-stylist link-preview card for the public booking page.
//
// Without this file, /book/<slug> inherits the site-wide marketing card
// (app/opengraph-image.tsx) — so when a stylist texts their booking link
// to a client, iMessage/Slack/etc. show the generic "Braid Boss Pro"
// pitch instead of the stylist's own brand. This renders a card
// headlined with the stylist's business name + tagline/intro, with
// their uploaded banner photo as the background when one exists.
//
// Resolution uses the same anon-callable RPC the page itself uses
// (public_resolve_booking_slug), so no new data surface is exposed.

export const alt = "Book an appointment";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Uncached: link previews must reflect the latest banner / business
// name the stylist has saved. force-dynamic also avoids prerendering
// the unbounded slug space at build time.
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_b-GByxuYeehWa-9F7Z1MdQ_FKqx32XO";

type BookingPreview = {
  businessName: string | null;
  tagline: string | null;
  intro: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  accentColor: string | null;
};

async function resolveBookingPreview(slug: string): Promise<BookingPreview> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/public_resolve_booking_slug`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ slug_in: slug }),
        cache: "no-store",
      },
    );
    if (!res.ok) return empty();
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.link_id || row.active === false) return empty();
    return {
      businessName: (row.business_name as string | null)?.trim() || null,
      tagline: (row.tagline as string | null)?.trim() || null,
      intro: (row.intro as string | null)?.trim() || null,
      bannerUrl: (row.banner_image_url as string | null) || null,
      logoUrl: (row.logo_url as string | null) || null,
      accentColor: (row.accent_color as string | null) || null,
    };
  } catch {
    return empty();
  }
}

const empty = (): BookingPreview => ({
  businessName: null,
  tagline: null,
  intro: null,
  bannerUrl: null,
  logoUrl: null,
  accentColor: null,
});

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const preview = await resolveBookingPreview(slug);

  const businessName = preview.businessName || "Book your appointment";
  const subtitle =
    preview.tagline || preview.intro || "Tap to book your next appointment.";
  const accent = preview.accentColor || "#7C3AED";

  // Banner background wins when set — the stylist's own photography is
  // the most recognizable preview. The dark gradient overlay keeps the
  // text legible regardless of what the banner contains.
  const hasBanner = !!preview.bannerUrl;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "80px",
          background: hasBanner
            ? `linear-gradient(180deg, rgba(21,17,26,0.10) 0%, rgba(21,17,26,0.55) 60%, rgba(21,17,26,0.85) 100%), url(${preview.bannerUrl}) center / cover no-repeat`
            : `linear-gradient(135deg, #1E0B3B 0%, ${accent} 55%, #FF4D6D 100%)`,
          color: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            opacity: 0.9,
          }}
        >
          {preview.logoUrl && (
            <img
              src={preview.logoUrl}
              width={64}
              height={64}
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                objectFit: "cover",
                border: "2px solid rgba(255,255,255,0.85)",
              }}
            />
          )}
          <span>Book an appointment</span>
        </div>
        <div
          style={{
            fontSize: 84,
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: 24,
            maxWidth: 1040,
            textShadow: hasBanner ? "0 2px 16px rgba(0,0,0,0.45)" : undefined,
          }}
        >
          {businessName}
        </div>
        <div
          style={{
            fontSize: 32,
            marginTop: 22,
            opacity: 0.95,
            maxWidth: 980,
            textShadow: hasBanner ? "0 2px 10px rgba(0,0,0,0.5)" : undefined,
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            fontSize: 22,
            marginTop: 36,
            opacity: 0.75,
          }}
        >
          Powered by Braid Boss Pro
        </div>
      </div>
    ),
    size,
  );
}
