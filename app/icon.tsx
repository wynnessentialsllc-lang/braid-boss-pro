import { brandIconResponse } from "./lib/brand-emblem";

// Generated browser-tab favicon — the Braid Boss Pro sparkle emblem,
// rasterized to PNG via next/og so it renders on every browser
// (including Safari, which doesn't use SVG favicons). Chrome/Firefox/Edge
// still prefer the crisp /icon.svg listed in layout metadata.
export const size = { width: 48, height: 48 };
export const contentType = "image/png";

export default function Icon() {
  return brandIconResponse(48);
}
