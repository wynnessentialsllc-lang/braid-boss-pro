import type { NextConfig } from "next";

// The app is one SSR build (Vercel). The native iOS/Android shell does
// NOT ship a static export — it loads the live site via Capacitor
// `server.url` (see capacitor.config.ts) and falls back to a tiny
// offline page (native-fallback/). So there's no `output: "export"`
// mode anymore: a full static export was never viable here (dynamic
// SSR routes + /api/* can't be exported), and loading the live site
// makes it unnecessary.
//
// Security headers below are served by the Vercel deploy.
//
// CSP notes — kept deliberately permissive on script/style so it does
// NOT break the app, while still closing the high-value holes:
//   • frame-ancestors 'none' + X-Frame-Options → clickjacking is dead.
//   • object-src 'none' / base-uri 'self' / form-action scoped → no
//     plugin or <base>/form hijack.
//   • connect-src pins Supabase (REST + realtime wss) and Stripe; an
//     injected script can't exfiltrate to an arbitrary origin.
//   • frame-src allows Stripe Checkout plus the Academy video embed
//     hosts (YouTube / Vimeo / Loom) — the /watch page and the video
//     buy-page preview render lessons in an <iframe>, so these hosts
//     must be allow-listed or the player is silently blank.
//   • media-src allows uploaded lessons to stream from the private
//     Supabase bucket (signed URLs on *.supabase.co) in a <video>;
//     without it the element falls back to default-src 'self' and the
//     file never plays.
//   • 'unsafe-inline' is required because the UI uses inline style
//     attributes throughout and Next injects inline bootstrap scripts;
//     tightening to nonces/hashes is a follow-up, not a launch blocker.
// Fonts: the marketing shell, booking page, and storefront load
// Cormorant Garamond + DM Sans from Google Fonts via CSS @import, so
// the stylesheet host (fonts.googleapis.com) must be allow-listed on
// style-src and the font-file host (fonts.gstatic.com) on font-src —
// otherwise the CSP silently blocks them and the brand type falls back
// to Georgia/system. (A future move to next/font would self-host these
// and let us drop both hosts again.)
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.stripe.com",
  "media-src 'self' blob: https://*.supabase.co",
  "frame-src https://*.stripe.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com",
  "form-action 'self' https://*.stripe.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
