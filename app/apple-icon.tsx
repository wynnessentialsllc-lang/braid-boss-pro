import { brandIconResponse } from "./lib/brand-emblem";

// Generated apple-touch icon — the sparkle emblem at 180×180, used by
// iOS for the Home Screen icon (PWA "Add to Home Screen") and Safari.
// Replaces the old static apple-touch-icon.png (the triangle mark).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIconResponse(180);
}
