import type { NextConfig } from "next";

// BBP_NATIVE=1 builds for the iOS Capacitor static bundle: no
// server-rendered routes, /book/[slug] excluded, source maps emitted
// (they ship inside the local app, not to the public web). Without
// the env var, builds behave exactly as before this change — Vercel
// auto-deploys keep full SSR + no public source maps.
const isNative = process.env.BBP_NATIVE === "1";

// Security headers for the SSR web build only. `output: "export"`
// (native) can't emit response headers, so these are scoped to the
// Vercel deploy where they're actually served.
//
// CSP notes — kept deliberately permissive on script/style so it does
// NOT break the app, while still closing the high-value holes:
//   • frame-ancestors 'none' + X-Frame-Options → clickjacking is dead.
//   • object-src 'none' / base-uri 'self' / form-action scoped → no
//     plugin or <base>/form hijack.
//   • connect-src pins Supabase (REST + realtime wss) and Stripe; an
//     injected script can't exfiltrate to an arbitrary origin.
//   • 'unsafe-inline' is required because the UI uses inline style
//     attributes throughout and Next injects inline bootstrap scripts;
//     tightening to nonces/hashes is a follow-up, not a launch blocker.
// Fonts resolve from the system stack (no external font CDN), so no
// font/style host needs allow-listing.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.stripe.com",
  "frame-src https://*.stripe.com",
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

const nextConfig: NextConfig = isNative
  ? {
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
      productionBrowserSourceMaps: true,
    }
  : {
      async headers() {
        return [{ source: "/:path*", headers: SECURITY_HEADERS }];
      },
    };

export default nextConfig;
