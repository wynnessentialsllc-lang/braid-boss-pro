import type { MetadataRoute } from "next";

// Web App Manifest. Next.js convention: a `manifest.ts` (or .json)
// at this path is served at /manifest.webmanifest automatically and
// linked from <head> on every page.
//
// On iOS, the PWA "Add to Home Screen" install reads `name`,
// `short_name`, and `icons` from this file. Web Push notifications
// delivered to an installed PWA show the `name` value as the source
// app on the lock screen / banner. Without this manifest, iOS falls
// back to the page <title>, which is why notifications were
// previously labelled "from Create Next App".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Braid Boss Pro",
    short_name: "Braid Boss Pro",
    description:
      "Appointments, clients, payments, and reminders for braid stylists.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5EFE6",
    theme_color: "#3B2A1A",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
