import { ImageResponse } from "next/og";

// Per-business link-preview card for the balance payment page.
//
// Without this file, /pay/balance/<id> inherits the site-wide marketing
// card (app/opengraph-image.tsx) — so when a stylist texts a client their
// balance link, iMessage/Slack/etc. show the generic "Braid Boss Pro"
// pitch instead of the stylist's own brand. This renders a card headlined
// with the studio/business name resolved from the appointment id.
//
// Resolution uses the same anon-callable RPC the page itself uses
// (public_get_balance_payment_info), so no new data surface is exposed.
// We deliberately do NOT render the balance amount here: the preview is
// visible to anyone the link is forwarded to, so amounts stay off the card.

export const alt = "Secure balance payment";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Uncached: keep the card in step with the current business name, and make
// the route dynamic so each appointment id is rendered on demand rather
// than statically prerendered (the id space is unbounded).
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_b-GByxuYeehWa-9F7Z1MdQ_FKqx32XO";

// Resolve the studio/business name (falling back to the stylist's name)
// for this appointment. Never throws — a failed lookup just yields null so
// the card falls back to the brand name. Link previews must always render.
async function resolveBusinessName(id: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/public_get_balance_payment_info`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ appt_id_in: id }),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      studio_name?: string;
      stylist_name?: string;
    };
    if (!data || data.ok !== true) return null;
    const studio = (data.studio_name || "").trim();
    const stylist = (data.stylist_name || "").trim();
    return studio || stylist || null;
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const businessName = (await resolveBusinessName(id)) || "Braid Boss Pro";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          // Brand gradient — matches the site-wide card (purple → pink).
          background:
            "linear-gradient(135deg, #1E0B3B 0%, #7C3AED 55%, #FF4D6D 100%)",
          color: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            opacity: 0.85,
          }}
        >
          Balance Payment
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: 28,
            maxWidth: 1040,
          }}
        >
          {businessName}
        </div>
        <div
          style={{
            fontSize: 34,
            marginTop: 30,
            opacity: 0.92,
            maxWidth: 940,
          }}
        >
          Tap to securely pay the remaining balance for your appointment.
        </div>
        <div
          style={{
            fontSize: 24,
            marginTop: 44,
            opacity: 0.7,
          }}
        >
          Powered by Braid Boss Pro · Payments secured by Stripe
        </div>
      </div>
    ),
    size,
  );
}
