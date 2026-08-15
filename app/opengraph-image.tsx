import { ImageResponse } from "next/og";

// Site-wide social share image (1200×630). Placed at the app root so it
// applies to every page by inheritance — link previews on iMessage,
// Slack, X, Facebook, LinkedIn, etc. now render a branded card instead
// of plain text. Individual segments can override by adding their own
// opengraph-image file. Next also reuses this for the Twitter card when
// no twitter-image is present.
export const alt = "Braid Boss Pro — Booking & Business App Built for Braid Stylists";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          // Brand gradient — matches the marketing hero (purple → pink).
          background: "linear-gradient(135deg, #1E0B3B 0%, #7C3AED 55%, #FF4D6D 100%)",
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
          Braid Boss Pro
        </div>
        <div
          style={{
            fontSize: 78,
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: 28,
            maxWidth: 980,
          }}
        >
          The booking &amp; business app built for braid stylists.
        </div>
        <div
          style={{
            fontSize: 32,
            marginTop: 32,
            opacity: 0.92,
            maxWidth: 900,
          }}
        >
          Branded booking links, Stripe deposits, contracts, retail, and reminders. $14.99/mo · 30-day free trial.
        </div>
      </div>
    ),
    size,
  );
}
