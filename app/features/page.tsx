import type { Metadata } from "next";
import FeaturesContent from "../components/marketing/FeaturesContent";
import { FeatureDirectory } from "../components/marketing/FeatureDirectory";

export const metadata: Metadata = {
  title: "Features · Braid Boss Pro — the all-in-one platform for braiders",
  description:
    "Explore every feature of Braid Boss Pro — booking software, payments and deposits, inventory, AI tools, contracts, storefront, memberships, marketing, public profile, and the mobile app. Built specifically for professional braiders.",
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
    "all-in-one platform for braiders",
  ],
  openGraph: {
    title: "Features · Braid Boss Pro — the all-in-one platform for braiders",
    description:
      "The all-in-one business platform built specifically for professional braiders. Booking, deposits, inventory, AI tools, contracts, storefront, memberships, marketing, and more.",
    url: "/features",
    siteName: "Braid Boss Pro",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Features · Braid Boss Pro",
    description: "The all-in-one business platform built specifically for professional braiders.",
  },
};

export default function FeaturesPage() {
  return <FeaturesContent directory={<FeatureDirectory />} />;
}
