import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.braidbosspro.app",
  appName: "Braid Boss Pro",
  // The shell loads the live site (server.url below); this bundled
  // folder is just the offline fallback Capacitor shows when the site
  // can't be reached. We no longer ship a full static export (it was
  // never viable with this app's dynamic + /api routes).
  webDir: "native-fallback",
  // The native shell loads the live site so the full app works inside
  // the app — including SSR pages and every /api/* route (Stripe
  // Connect, subscription, etc.), which the static `out/` bundle can't
  // serve. `out/` stays as the offline fallback. The Capacitor bridge
  // and native plugins (push/share) still load because the production
  // CSP already permits 'unsafe-inline'/'unsafe-eval', and /api calls
  // resolve under connect-src 'self' once the origin is braidbosspro.app.
  // isNativePlatform() stays true, so the App-Store subscription gating
  // keeps working.
  server: {
    url: "https://braidbosspro.app",
    cleartext: false,
  },
};

export default config;
