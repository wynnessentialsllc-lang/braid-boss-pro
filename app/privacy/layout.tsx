import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/privacy/page.tsx is a "use client" component and can't export its
// own metadata, so this thin server layout supplies it. It renders the
// page untouched (no extra DOM) — its only job is the metadata export.
// Without this, the privacy page inherited the root homepage title and
// had no canonical, even though it's listed in the sitemap.
export const metadata: Metadata = {
  title: "Privacy Policy · Braid Boss Pro",
  description:
    "How Braid Boss Pro, operated by Wynn Essentials LLC, collects, uses, and protects your data. Minimal, scoped to you, and never sold.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy · Braid Boss Pro",
    description:
      "How Braid Boss Pro handles your data — minimal, scoped to you, and never sold.",
    url: "/privacy",
    type: "website",
  },
};

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return children;
}
