import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/discover/page.tsx is a "use client" component and can't export its
// own metadata, so this thin server layout supplies it. It renders the
// page untouched (no extra DOM) — its only job is the metadata export.
export const metadata: Metadata = {
  title: "Find a Braider Near You · Braid Boss Pro",
  description:
    "Search braid stylists near you by city and style. Browse box braids, knotless, locs, twists, and cornrow specialists, then book directly through their Braid Boss Pro booking page.",
  alternates: { canonical: "/discover" },
  openGraph: {
    title: "Find a Braider Near You",
    description: "Search braid stylists by city and style, then book directly.",
    url: "/discover",
    type: "website",
  },
};

export default function DiscoverLayout({ children }: { children: ReactNode }) {
  return children;
}
