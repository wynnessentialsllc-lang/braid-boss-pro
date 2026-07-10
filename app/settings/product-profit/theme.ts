// Shared design tokens for the Product Profit Calculator screens.
//
// Extracted so the page and every reusable card (ProductHealthCard,
// FounderInsights, ProfitTimeline, …) draw from one palette, one type
// scale, and one card treatment. Purple theme, no gradients beyond the
// existing headline banners, matching the booking/payments language.

import type { CSSProperties } from "react";

export const C = {
  espresso: "#15111A",
  coffee: "#3D3447",
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  paper: "#FFFFFF",
  gold: "#7C3AED", // purple accent (recommendations)
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
  success: "#5C7C4A", // green — healthy
  warning: "#B8860B", // orange — needs attention
  danger: "#9C3D2E", // red — negative profit
};

export const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
export const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

export const fmt$ = (n: number | null | undefined): string =>
  n == null ? "—" : `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export const fmtPct = (n: number | null | undefined): string =>
  n == null ? "—" : `${Math.round(n)}%`;

export const cardStyle: CSSProperties = {
  padding: 16,
  borderRadius: 16,
  background: C.cream,
  border: `1px solid ${C.hairline}`,
  boxShadow: "0 1px 2px rgba(21,17,26,0.04), 0 8px 24px -16px rgba(21,17,26,0.12)",
};

export const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: C.muted,
};
