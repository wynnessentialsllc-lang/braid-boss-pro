import type { Metadata } from "next";
import TourClient from "./TourClient";

export const metadata: Metadata = {
  title: "Take the tour · Braid Boss Pro",
  description:
    "A guided slideshow of Braid Boss Pro — the calendar, action sheet, client profiles, and booking-source dashboard your stylists actually use every day.",
  alternates: { canonical: "/tour" },
  openGraph: {
    title: "Take the tour · Braid Boss Pro",
    description:
      "Cycle through the real Braid Boss Pro features — calendar, contracts, rebooking, analytics — in a quick visual tour.",
    url: "/tour",
    siteName: "Braid Boss Pro",
    type: "website",
  },
};

export default function TourPage() {
  return <TourClient />;
}
