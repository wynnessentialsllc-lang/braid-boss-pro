import type { Metadata } from "next";
import FeaturesContent from "../components/marketing/FeaturesContent";

export const metadata: Metadata = {
  title: "Features · Braid Boss Pro — the business OS for braiders",
  description:
    "Braid Boss Pro is the business operating system for braiders. Branded booking links, deposits, Stripe Connect, retail storefronts, contracts, analytics, and modern beauty-tech tools built specifically for braid stylists.",
  alternates: { canonical: "/features" },
  keywords: [
    "braid business software",
    "braid business management app",
    "booking app for braiders",
    "braider booking software",
    "braider scheduling app",
    "business tools for braiders",
    "braid pricing software",
    "braider client management app",
    "creator economy braid platform",
  ],
  openGraph: {
    title: "Features · Braid Boss Pro — the business OS for braiders",
    description:
      "The business operating system for braiders. Branded booking links, deposits, Stripe Connect, retail storefronts, contracts, analytics — built specifically for braid stylists.",
    url: "/features",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Features · Braid Boss Pro",
    description: "The business operating system for braiders.",
  },
};

export default function FeaturesPage() {
  return <FeaturesContent />;
}
