"use client";

// Marketing-surface design tokens — mirror of app/page.tsx so the
// public /features + /getting-started pages render the same brand
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

export const SHADOWS = {
  primaryGlow:
    "0 10px 28px -10px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(255, 77, 109, 0.30)",
  card: "0 4px 14px rgba(21, 17, 26, 0.06)",
  cardLifted: "0 12px 32px -12px rgba(21, 17, 26, 0.18)",
  cardHover: "0 18px 36px -16px rgba(21, 17, 26, 0.22)",
};

export const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
export const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;
