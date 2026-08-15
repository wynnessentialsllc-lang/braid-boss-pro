import type { Metadata, Viewport } from "next";
import "./globals.css";
import PullToRefresh from "./components/PullToRefresh";
import PrivacyNotice from "./components/PrivacyNotice";
import { CartProvider } from "./lib/cart";
import { CartDrawer, CartFloatingBadge } from "./components/CartDrawer";
import { Analytics } from "@vercel/analytics/next";

// Viewport for both the PWA and the Capacitor iOS shell.
// - viewportFit: "cover" lets `env(safe-area-inset-*)` produce real
//   values so the bottom nav clears the home indicator and the header
//   clears the dynamic island/notch.
// - userScalable: false / maximumScale: 1 prevents pinch-zoom that
//   would shove the layout off-grid; we already provide the normal
//   text-size respect via system Dynamic Type.
// - themeColor matches manifest backgroundColor so the iOS status bar
//   blends with the cream surface (statusBarStyle: "default" in
//   appleWebApp keeps the icons dark).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export const metadata: Metadata = {
  // metadataBase resolves every *relative* canonical / Open Graph URL
  // declared on child pages (e.g. the /compare/* pages set
  // `alternates.canonical: "/compare/..."`). Without it, Next.js falls
  // back to http://localhost:3000 at build time, which would publish
  // localhost canonicals and break SEO. Env var first (set on Vercel
  // for prod/preview), with the production domain as the fallback —
  // same resolution order as app/lib/site-url.ts.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://braidbosspro.app"),
  // These serve as the homepage's effective metadata (app/page.tsx is a
  // client component and can't export its own) and as fallbacks for any
  // page that doesn't set its own. Marketing subpages override title,
  // description, and canonical individually.
  title: "Braid Boss Pro — Booking & Business App Built for Braid Stylists",
  description:
    "The all-in-one booking and business app built specifically for braid stylists: branded booking links, Stripe deposits, contracts, retail, and reminders. $14.99/mo, 14-day free trial.",
  applicationName: "Braid Boss Pro",
  // NOTE: deliberately no `alternates.canonical` or `openGraph.url` here.
  // Pages without their own metadata (privacy, terms, support, admin…)
  // inherit root metadata, and a root canonical of "/" would wrongly
  // declare every such page to be the homepage. Marketing pages each set
  // their own canonical; the homepage is self-canonicalizing at the root.
  openGraph: {
    type: "website",
    siteName: "Braid Boss Pro",
    title: "Braid Boss Pro — Booking & Business App Built for Braid Stylists",
    description:
      "The all-in-one booking and business app built specifically for braid stylists. Branded booking links, Stripe deposits, contracts, retail, and reminders. $14.99/mo.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Braid Boss Pro — Built for Braid Stylists",
    description:
      "Booking links, Stripe deposits, contracts, retail, and reminders — built specifically for braiders. $14.99/mo, 14-day free trial.",
  },
  appleWebApp: {
    capable: true,
    title: "Braid Boss Pro",
    statusBarStyle: "default",
  },
  icons: {
    // /icon.svg → the crisp sparkle emblem on browsers that support SVG
    // favicons (Chrome/Firefox/Edge). app/icon.tsx + app/apple-icon.tsx
    // (next/og) generate PNG versions for Safari + iOS Home Screen. The
    // Android PWA Home Screen icon comes from manifest.ts.
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        {/* Preconnect to the Google Fonts hosts. The marketing shell,
            booking page, and storefront pull Cormorant Garamond + DM Sans
            from Google Fonts via CSS @import (allow-listed in the CSP,
            see next.config.ts). @import is discovered late, so opening the
            TLS connections early shaves the font-load waterfall. React 19
            hoists these <link> tags into <head>. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* NOTE: the SoftwareApplication JSON-LD used to live here, which
            put it on all 20 routes — /privacy, /terms, /payment-success
            and the rest all claimed to BE the product. It now lives on
            the homepage alone (app/lib/home-schema.ts, rendered by
            app/page.tsx), so one page owns the app rich result and it is
            the page carrying the CTA. Per-page schema lives with its
            page: FAQPage on /faq, Product + Offer on /pricing. */}
        {/* No-JavaScript fallback, kept as a safety net for the
            client-rendered transactional routes (payment-success,
            subscription-success, unsubscribe) which still render
            nothing without JS.

            It is no longer load-bearing for the marketing pages: the
            homepage server-renders its full landing (see app/page.tsx),
            as /features, /pricing, /how-it-works and /faq always did.

            The heading here is a <div>, not an <h1>. This block sits in
            the ROOT layout, so an <h1> here landed on every route — the
            first <h1> in the document on all of them, identical
            everywhere, ahead of each page's real hero heading. Demoting
            it leaves exactly one <h1> per page: the page's own. */}
        <noscript>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6, color: "#2b211c" }}>
            <div style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Braid Boss Pro</div>
            <p style={{ fontSize: 18, margin: "0 0 16px" }}>
              The all-in-one booking and business app built specifically for braid stylists, operated by Wynn Essentials LLC.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Braid Boss Pro is subscription software that helps independent braid stylists run their business:
            </p>
            <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
              <li>Branded online booking links and appointment scheduling</li>
              <li>Stripe deposits and balance payments</li>
              <li>Digital service contracts with e-signature</li>
              <li>Client records, pricing quotes, and a retail storefront</li>
              <li>Automated SMS and email appointment reminders (opt-in only)</li>
            </ul>
            <p style={{ margin: "0 0 16px" }}>
              <strong>Pricing:</strong> 14-day free trial, then $14.99/month or $149/year. Cancel anytime.
            </p>
            <p style={{ margin: 0 }}>
              Learn more:{" "}
              <a href="/discover">Find a Braider</a>{" · "}
              <a href="/features">Features</a>{" · "}
              <a href="/pricing">Pricing</a>{" · "}
              <a href="/how-it-works">How it works</a>{" · "}
              <a href="/faq">FAQ</a>{" · "}
              <a href="/support">Support</a>{" · "}
              <a href="/privacy">Privacy Policy</a>{" · "}
              <a href="/terms">Terms</a>
            </p>
            <p style={{ margin: "16px 0 0" }}>
              Contact: <a href="mailto:hello@braidbosspro.app">hello@braidbosspro.app</a>
            </p>
          </div>
        </noscript>
        <PullToRefresh />
        {/* CartProvider wraps everything so the storefront + admin
            can read/write the same cart state. The floating badge
            and slide-up drawer self-hide when the cart is empty,
            so non-shop screens see nothing. */}
        <CartProvider>
          {children}
          <CartFloatingBadge />
          <CartDrawer />
        </CartProvider>
        <PrivacyNotice />
        <Analytics />
      </body>
    </html>
  );
}
