"use client";

// Marketing-surface design tokens — mirror of app/page.tsx so the
// public /features + /how-it-works pages render the same brand
// palette as the booking page and the storefront without importing
// the 18k admin shell.

export const C = {
  ink: "#15111A",
  coffee: "#3D3447",
  paper: "#FFFFFF",
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  muted: "#6F6477",
  mutedSoft: "#9F95A8",
  hairline: "rgba(21, 17, 26, 0.08)",
  brandPrimary: "#7C3AED",
  brandPrimaryDeep: "#5B21B6",
  brandSecondary: "#FF4D6D",
  brandSecondaryDeep: "#E0354F",
  brandSparkle: "#C6FF00",
  brandText: "#15111A",
  brandBorder: "#ECE7F2",
  brandSurface: "#FBFAFD",
  brandSuccess: "#22C55E",
  brandWarning: "#FBBF24",
};

export const GRADIENTS = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 100%)",
  secondary: "linear-gradient(135deg, #FF4D6D 0%, #FF7A45 100%)",
  hero: "linear-gradient(160deg, #7C3AED 0%, #B14BE0 45%, #FF4D6D 100%)",
  softA: "linear-gradient(135deg, rgba(124, 58, 237, 0.10), rgba(255, 77, 109, 0.10))",
  softB: "linear-gradient(135deg, rgba(255, 77, 109, 0.10), rgba(255, 122, 69, 0.10))",
  softC: "linear-gradient(135deg, rgba(34, 197, 94, 0.10), rgba(124, 58, 237, 0.10))",
};

// 2026 depth pass — layered elevation (tight contact + wide soft
// ambient) so marketing cards float like the app's, and the hover
// state blooms a brand-tinted glow. Kept in lockstep with the app's
// SHADOWS in AppRoot.tsx so both surfaces share one design language.
export const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
  card: "0 1px 2px rgba(21, 17, 26, 0.04), 0 10px 26px -14px rgba(21, 17, 26, 0.14)",
  cardLifted: "0 2px 6px rgba(21, 17, 26, 0.05), 0 22px 48px -22px rgba(21, 17, 26, 0.24)",
  cardHover: "0 4px 10px rgba(21, 17, 26, 0.06), 0 28px 56px -24px rgba(124, 58, 237, 0.28)",
};

export const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
export const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;
