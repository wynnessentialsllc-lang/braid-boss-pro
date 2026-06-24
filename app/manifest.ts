import type { MetadataRoute } from "next";

export const dynamic = "force-static";

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
    // theme_color + background_color must match the viewport
    // themeColor in app/layout.tsx and the actual surface (cream) so
    // iOS Safari's status bar + Android's task switcher tint don't
    // flash a different shade on launch. Splash background matches
    // too so the install + cold-start sequence is uniform.
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    // The sparkle emblem as a scalable SVG — Android Chrome accepts SVG
    // manifest icons, so the installed PWA Home Screen icon renders the
    // brand mark at any density. iOS ignores manifest icons and uses the
    // generated app/apple-icon.tsx instead. "any" + "maskable" so Android
    // install banners get a valid maskable candidate.
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
