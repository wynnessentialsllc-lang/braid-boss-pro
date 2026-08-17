"use client";

// /app — the installed PWA's entry point.
//
// The home route has to serve two audiences from one URL: search
// crawlers, which need the marketing landing in the server-rendered
// HTML, and stylists opening the app they installed, who need their
// dashboard. app/page.tsx decides between them in the browser, but the
// server render is fixed at build time, so an installed launch paints
// the marketing hero — "Deposits up front. Contracts signed." — for as
// long as it takes the app bundle to download and hydrate. That is a
// sales pitch shown to someone who already bought the product, and it
// is the first thing they see every time the app is reopened cold.
//
// This route exists so that launch has somewhere to land whose server
// render is already the splash. The manifest's start_url is /?app=1 and
// middleware.ts rewrites that to here, so the URL in the address bar is
// unchanged and only the document served differs.
//
// There is no auth check here on purpose: AppRoot owns that, shows this
// same splash until getSession() resolves, and falls through to its
// welcome screen when nobody is signed in.

import dynamic from "next/dynamic";
import AppSplash from "../components/AppSplash";

const AppRoot = dynamic(() => import("../AppRoot"), {
  ssr: false,
  loading: () => <AppSplash />,
});

export default function AppEntryRoute() {
  return <AppRoot />;
}
