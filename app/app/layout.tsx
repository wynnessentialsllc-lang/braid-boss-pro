import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/app/page.tsx is a "use client" component and can't export its own
// metadata, so this thin server layout supplies it. It renders the page
// untouched — its only job is the metadata export.
export const metadata: Metadata = {
  title: "Braid Boss Pro",
  // The installed app's entry point. It is the authenticated dashboard
  // shell, so there is nothing here to index and nowhere to follow: a
  // crawler gets a splash and no links. The marketing landing at "/" is
  // the page that should rank for this content, and this route must not
  // compete with it.
  //
  // Both signals are set on purpose. The meta tag below is what keeps it
  // out of the index; /app is also disallowed in app/robots.ts so
  // crawlers don't spend budget fetching an empty shell in the first
  // place. That combination is only safe because nothing links here —
  // for a page with inbound links a disallow would hide the noindex (see
  // the note in app/discover/layout.tsx).
  robots: { index: false, follow: false },
};

export default function AppEntryLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
