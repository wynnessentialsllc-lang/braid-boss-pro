"use client";

// Home route (/).
//
// This file used to BE the entire product: a ~42k-line, ~2MB "use
// client" component that shipped the whole authenticated dashboard to
// every visitor — including logged-out marketing/SEO traffic that only
// ever sees the landing. That forced `/` to download and parse the full
// app bundle before it could paint anything, which is death for Core
// Web Vitals on the single most important page.
//
// The heavy app now lives in ./AppRoot and is code-split via
// next/dynamic (ssr:false). It's fetched ONLY when a visitor actually
// needs it — signed in, in guest mode, or arriving through a
// sign-in/up CTA. Pure logged-out visitors get just the lightweight
// marketing landing (<FeaturesContent/>), so the big chunk never
// downloads for them.
//
// The gating decision mirrors useAuth() in ./AppRoot exactly (URL
// intent → guest flag → live Supabase session), so behavior is
// unchanged — only the bundle boundary moved.
//
// The undecided render is the MARKETING landing, not a splash. This
// file is "use client", but client components still server-render, so
// whatever the first render returns is what a crawler receives. It
// used to return <Splash/>, which is why `/` prerendered ~750
// characters — a logo and nothing else — while /features prerendered
// ~10.5k from this very same <FeaturesContent/>. The homepage is the
// page most worth indexing, and it was the only one with no body copy.
//
// Rendering marketing while undecided means a signed-in visitor could
// see it flash before <AppRoot/> takes over. The synchronous signals
// (URL intent, guest flag) are therefore read in a layout effect, which
// commits before the browser paints, so those paths never flash. The
// session lookup is genuinely async and can show one frame of marketing
// on a cold start; that is the deliberate trade for having a homepage
// that exists to search engines.

import { useEffect, useLayoutEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import FeaturesContent from "./components/marketing/FeaturesContent";
import { getSupabase } from "./lib/supabase";
import { HOME_SCHEMA } from "./lib/home-schema";
import { C } from "./components/marketing/tokens";

// Must stay in sync with useAuth()'s GUEST_FLAG_KEY in ./AppRoot.
const GUEST_FLAG_KEY = "bbp-guest-mode";

// Minimal, self-contained cold-start splash. Deliberately imports
// nothing from ./AppRoot so showing it never pulls the heavy chunk.
const Splash = () => (
  <div
    className="flex items-center justify-center"
    style={{ minHeight: "100dvh", background: C.paper }}
  >
    <div
      className="animate-pulse flex items-center justify-center"
      style={{ width: 56, height: 56, borderRadius: 999, background: C.brandPrimary }}
    >
      <Sparkles size={28} style={{ color: "#FFFFFF" }} />
    </div>
  </div>
);

// The heavy app. ssr:false keeps it out of the server render (it's a
// client-only SPA) and, crucially, out of the marketing bundle — its
// chunk is fetched only when <AppRoot/> is actually rendered below.
const AppRoot = dynamic(() => import("./AppRoot"), {
  ssr: false,
  loading: () => <Splash />,
});

// useLayoutEffect commits before paint but does not run on the server,
// where React warns about it. Falling back to useEffect there keeps the
// server render silent while preserving the no-flash behaviour in the
// browser.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function HomeRoute() {
  const [view, setView] = useState<"pending" | "app" | "marketing">("pending");

  useIsomorphicLayoutEffect(() => {
    let cancelled = false;

    // Synchronous signals first — the URL intent and the guest flag
    // settle the decision without awaiting the session check.
    let immediate: "app" | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("signup") === "1" || params.get("signin") === "1") immediate = "app";
      else if (window.localStorage.getItem(GUEST_FLAG_KEY) === "1") immediate = "app";
    } catch {
      /* malformed URL / storage blocked — fall through to session check */
    }

    if (immediate) {
      // Committed in a layout effect, so this lands before paint and a
      // returning app user never sees the marketing landing flash.
      setView(immediate);
      return;
    }

    // A returning signed-in user (cold start / PWA resume) has a
    // persisted session; getSession() reads it from localStorage, so
    // this resolves fast and without a network round-trip. Committing
    // the view only after it resolves (in this async callback, not
    // synchronously in the effect body) means a signed-in user never
    // flashes the marketing landing on the way to their dashboard.
    (async () => {
      let hasSession = false;
      try {
        const { data } = await getSupabase().auth.getSession();
        hasSession = !!data?.session?.user;
      } catch {
        /* treat as logged-out */
      }
      if (!cancelled) setView(hasSession ? "app" : "marketing");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The SoftwareApplication schema is the homepage's alone (it used to
  // sit in the root layout and land on all 20 routes). Rendered outside
  // the branch so `/` carries it whichever view wins.
  const schema = (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_SCHEMA) }}
    />
  );

  // "pending" renders marketing too, so the server render — and every
  // crawler — gets the real landing page. <Splash/> is still used as
  // AppRoot's dynamic loading fallback above.
  return (
    <>
      {schema}
      {view === "app" ? <AppRoot /> : <FeaturesContent variant="home" />}
    </>
  );
}
