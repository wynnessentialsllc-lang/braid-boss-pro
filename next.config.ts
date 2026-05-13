import type { NextConfig } from "next";

// BBP_NATIVE=1 builds for the iOS Capacitor static bundle: no
// server-rendered routes, /book/[slug] excluded, source maps emitted
// (they ship inside the local app, not to the public web). Without
// the env var, builds behave exactly as before this change — Vercel
// auto-deploys keep full SSR + no public source maps.
const isNative = process.env.BBP_NATIVE === "1";

const nextConfig: NextConfig = isNative
  ? {
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
      productionBrowserSourceMaps: true,
    }
  : {};

export default nextConfig;
