import { ImageResponse } from "next/og";

// The Braid Boss Pro sparkle emblem, mirrored from public/icon.svg.
// Kept here as a string so the favicon + apple-icon routes can
// rasterize it to PNG via next/og (Satori) — needed for platforms that
// don't accept an SVG icon (Safari tab, iOS Home Screen). next/og is the
// same mechanism app/opengraph-image.tsx already uses.
export const EMBLEM_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#5B21B6"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><g transform="translate(12 12) scale(1.66)" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></g></svg>`;

// URL-encoded data URI (no Buffer, so it works on the edge runtime too).
const EMBLEM_DATA_URI = `data:image/svg+xml,${encodeURIComponent(EMBLEM_SVG)}`;

// Build a square PNG of the emblem at the requested size via next/og.
// Shared by app/icon.tsx (favicon) and app/apple-icon.tsx.
export function brandIconResponse(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={size} height={size} src={EMBLEM_DATA_URI} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
