import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/terms/page.tsx is a "use client" component and can't export its
// own metadata, so this thin server layout supplies it. It renders the
// page untouched (no extra DOM) — its only job is the metadata export.
// Without this, the terms page inherited the root homepage title and
// had no canonical, even though it's listed in the sitemap.
export const metadata: Metadata = {
  title: "Terms of Service · Braid Boss Pro",
  description:
    "The terms for using Braid Boss Pro, the booking and business app for braid stylists, operated by Wynn Essentials LLC. Plain language, no surprises.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service · Braid Boss Pro",
    description:
      "The plain-language terms for using Braid Boss Pro, operated by Wynn Essentials LLC.",
    url: "/terms",
    type: "website",
  },
};

export default function TermsLayout({ children }: { children: ReactNode }) {
  return children;
}
