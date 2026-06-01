import type { Metadata, Viewport } from "next";
import "./globals.css";
import PullToRefresh from "./components/PullToRefresh";
import { CartProvider } from "./lib/cart";
import { CartDrawer, CartFloatingBadge } from "./components/CartDrawer";

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
  title: "Braid Boss Pro",
  description: "Appointments, clients, payments, and reminders for braid stylists.",
  applicationName: "Braid Boss Pro",
  appleWebApp: {
    capable: true,
    title: "Braid Boss Pro",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
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
        {/* SoftwareApplication structured data — gives LLMs and
            search engines a machine-readable summary of what this
            product is, who it's for, and what it costs. Emitted once
            on the root layout so every page carries it. */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "Braid Boss Pro",
              description:
                "The business operating system for braid stylists — branded booking links, deposits, contracts, retail storefronts, marketing, and analytics, built specifically for braiders.",
              applicationCategory: "BusinessApplication",
              applicationSubCategory: "Salon and Spa Management",
              operatingSystem: "iOS, Android, Web (PWA)",
              url: "https://braidbosspro.app",
              image: "https://braidbosspro.app/icons/icon-512.png",
              offers: [
                {
                  "@type": "Offer",
                  name: "Monthly",
                  price: "14.99",
                  priceCurrency: "USD",
                  category: "Subscription",
                  description: "14-day free trial, then $14.99/month. Cancel anytime.",
                },
                {
                  "@type": "Offer",
                  name: "Annual",
                  price: "149",
                  priceCurrency: "USD",
                  category: "Subscription",
                  description: "$149/year — save $30.88 vs monthly. 14-day free trial.",
                },
              ],
              featureList: [
                "Branded /@handle booking links",
                "Stripe Connect deposits and balance payments",
                "Digital contracts with e-signature",
                "Pricing calculator and saved quotes",
                "Client CRM with histories, allergies, photos",
                "Retail storefront with product variants and inventory",
                "SMS and email reminder automation",
                "Marketing automation (rebooking, win-back, birthday)",
                "Analytics dashboard",
                "Public reviews and testimonials",
                "Web push notifications",
                "Progressive Web App — installs to home screen, no app store",
              ],
              audience: {
                "@type": "Audience",
                audienceType: "Braid stylists, loctitians, natural hair specialists, protective-style braiders",
              },
              provider: {
                "@type": "Organization",
                name: "Wynn Essentials",
                url: "https://braidbosspro.app",
              },
            }),
          }}
        />
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
      </body>
    </html>
  );
}
