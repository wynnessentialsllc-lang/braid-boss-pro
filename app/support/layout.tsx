import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/support/page.tsx is a "use client" component and can't export its
// own metadata, so this thin server layout supplies it. It renders the
// page untouched (no extra DOM) — its only job is the metadata export.
export const metadata: Metadata = {
  title: "Support & Help · Braid Boss Pro",
  description:
    "Get help with Braid Boss Pro — answers to common questions about booking links, deposits, payments, and your account, plus how to reach the team directly.",
  alternates: { canonical: "/support" },
  keywords: [
    "Braid Boss Pro support",
    "Braid Boss Pro help",
    "booking app help for braiders",
    "contact Braid Boss Pro",
  ],
  openGraph: {
    title: "Braid Boss Pro Support & Help",
    description: "Answers to common questions and how to reach the team.",
    url: "/support",
    type: "website",
  },
};

export default function SupportLayout({ children }: { children: ReactNode }) {
  return children;
}
