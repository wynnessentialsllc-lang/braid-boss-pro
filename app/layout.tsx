import type { Metadata, Viewport } from "next";
import "./globals.css";
import PullToRefresh from "./components/PullToRefresh";

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
  themeColor: "#FAF5EC",
};

export const metadata: Metadata = {
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
        <PullToRefresh />
        {children}
      </body>
    </html>
  );
}
