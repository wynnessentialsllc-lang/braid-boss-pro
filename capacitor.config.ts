import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor configuration for the iOS shell.
//
// First TestFlight strategy: ship a thin native shell that loads the
// production Vercel deployment. We deliberately avoid `output: "export"`
// in next.config.ts so server-rendered routes (like /book/[slug]) keep
// working unchanged on Vercel, and we don't have to refactor data
// fetching for a static bundle.
//
// `webDir` is required by the CLI but unused at runtime when
// `server.url` points at a remote origin — we still need a directory
// to exist so `cap sync` doesn't error. We point it at `public/`
// (always present) rather than `.next/` (gitignored, build-output).
//
// IMPORTANT: pre-submission, decide whether to keep server.url for
// production. Apple's review guideline 4.2 ("Minimum Functionality")
// is normally fine for utility apps that load a remote site if the
// shell adds value (push, native share, native filesystem). All three
// are wired in this PR. If review pushes back, the fallback is to add
// `output: "export"` in a follow-up and ship a bundled-web build.

const config: CapacitorConfig = {
  appId: "com.hairwellnesslab.braidbosspro",
  appName: "Braid Boss Pro",
  webDir: "public",
  server: {
    // Live-hosted approach for first TestFlight. Swap to a Vercel
    // preview deployment URL if you want to run against staging.
    url: "https://braidbosspro.app",
    // Allow http during local dev only. The production URL above is
    // https, so this is a no-op in practice.
    cleartext: false,
  },
  ios: {
    scheme: "BraidBossPro",
    contentInset: "always",
    backgroundColor: "#FAF5EC",
    // Limit allowed origins inside the WKWebView. Anything else
    // (e.g. external links via @capacitor/browser) opens out-of-app.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // Native push: registration listener wires into
    // registerNativeSubscription() inside app/lib/push.ts.
    PushNotifications: {
      presentationOptions: ["alert", "sound", "badge"],
    },
  },
};

export default config;
