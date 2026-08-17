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
// see it flash before <AppRoot/> takes over. The synchronous signals are
// therefore read in a layout effect, which commits before the browser
// paints, so those paths never flash.
//
// getSession() was originally the only signal that could recognise a
// returning signed-in user, and awaiting it is what made a PWA cold
// start sit on the marketing hero — "Deposits up front. Contracts
// signed." — before the dashboard appeared. It is worst after the app
// has been idle for a while, because by then the persisted access token
// has expired and getSession() blocks on a network token refresh before
// it resolves. On a phone waking up on cellular that is seconds of
// looking at a sales pitch for software you already pay for.
//
// So three cheaper signals now settle it synchronously, before paint:
// a launch from the installed app (?app=1 in the manifest start_url, or
// display-mode: standalone for installs that predate it), and a
// persisted Supabase session in localStorage. None of them prove the
// session is still valid — that is <AppRoot/>'s job, and it shows its
// own splash until getSession() answers — but all three prove this is
// not a logged-out visitor who should be reading marketing.
//
// A crawler has no storage, no standalone display mode and no ?app=1,
// so it still gets the full landing page server-rendered.

import { useEffect, useLayoutEffect, useState } from "react";
import dynamic from "next/dynamic";
import FeaturesContent from "./components/marketing/FeaturesContent";
import AppSplash from "./components/AppSplash";
import { getSupabase } from "./lib/supabase";
import { HOME_SCHEMA } from "./lib/home-schema";

// Must stay in sync with useAuth()'s GUEST_FLAG_KEY in ./AppRoot.
const GUEST_FLAG_KEY = "bbp-guest-mode";

// Must stay in sync with the `storageKey` passed to createClient() in
// ./lib/supabase. supabase-js writes the persisted session here; its
// mere presence means someone has signed in on this device.
const AUTH_STORAGE_KEY = "bbp-auth";

// True when localStorage holds a persisted Supabase session. Deliberately
// does NOT check expiry: an expired access token with a live refresh
// token is exactly the returning-user case this exists to catch, and
// refreshing it is the slow step we're trying to get off the critical
// path.
const hasPersistedSession = (): boolean => {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    // Shape has moved between supabase-js versions (v1 nested the
    // session under `currentSession`), so accept any of them, and fall
    // back to a substring test if the blob doesn't parse.
    try {
      const parsed = JSON.parse(raw);
      return !!(
        parsed?.access_token ||
        parsed?.refresh_token ||
        parsed?.currentSession?.access_token
      );
    } catch {
      return raw.includes("access_token");
    }
  } catch {
    // Storage blocked (private mode / partitioned iframe) — fall through
    // to the async session check.
    return false;
  }
};

// True when running as an installed app rather than a browser tab.
// matchMedia covers Android/desktop; navigator.standalone is the iOS
// Safari equivalent, which is the install path most stylists use.
const isStandaloneLaunch = (): boolean => {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
};

// The heavy app. ssr:false keeps it out of the server render (it's a
// client-only SPA) and, crucially, out of the marketing bundle — its
// chunk is fetched only when <AppRoot/> is actually rendered below.
// <AppSplash/> stands in meanwhile; it lives in its own module so this
// route and /app show the same thing, and it imports nothing from
// ./AppRoot so rendering it never pulls the heavy chunk.
const AppRoot = dynamic(() => import("./AppRoot"), {
  ssr: false,
  loading: () => <AppSplash />,
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

    // Synchronous signals first — anything that settles the decision
    // without awaiting the session check.
    let immediate: "app" | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      // `app=1` is the installed PWA's start_url (see ./manifest.ts).
      if (
        params.get("signup") === "1" ||
        params.get("signin") === "1" ||
        params.get("app") === "1"
      ) immediate = "app";
      else if (window.localStorage.getItem(GUEST_FLAG_KEY) === "1") immediate = "app";
    } catch {
      /* malformed URL / storage blocked — fall through to the checks below */
    }

    // Installs that predate the start_url change carry no ?app=1, and a
    // returning user in a browser tab has no URL intent either. Both are
    // still recognisable without a network call.
    if (!immediate && (isStandaloneLaunch() || hasPersistedSession())) immediate = "app";

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
