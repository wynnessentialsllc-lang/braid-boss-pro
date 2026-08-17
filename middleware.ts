// URL rewrites: the installed PWA's entry point, and stylist storefronts.
//
// ── Installed app launches ────────────────────────────────────────────
// The manifest's start_url is "/?app=1" (see app/manifest.ts). "/" has
// to server-render the marketing landing for crawlers, so an installed
// launch would otherwise paint the "Deposits up front" hero before the
// app bundle hydrates. We rewrite that one request to /app, whose server
// render is the splash. The address bar still reads "/?app=1", so the
// PWA's scope and start_url are unaffected.
//
// Phase 1 spec: stylist storefront lives at /@handle, /@handle/shop,
// and /@handle/products/<slug>. Next.js parses any folder name that
// starts with `@` as a parallel-route slot (not a URL segment), so we
// can't physically name a directory `@[handle]` in the app/ tree.
// Instead we mount the storefront under /u/<handle>/... and rewrite
// the public `@`-prefixed URLs to that internal tree here.
//
// The browser address bar keeps the user-facing /@handle URL; only
// the request that Next.js handles is rewritten. Shop assets, API
// routes, and the existing /book/<slug> path are untouched.

import { NextResponse, type NextRequest } from "next/server";

export const config = {
  // Catch-all matcher excluding static / API / Next internals.
  // The earlier `/@:path*` matcher was unreliable in production —
  // path-to-regexp's handling of a literal `@` adjacent to a named
  // param caused some `/@handle/...` requests to skip middleware
  // entirely, dropping the visitor on the bare /@handle/... path
  // which has no file-system route → 404. Letting middleware run on
  // every request and short-circuiting non-`@` paths in code is the
  // bulletproof shape; the early return keeps the cost negligible.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml).*)",
  ],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  // Decode in case a client sent %40 instead of @ (some link
  // shorteners / scanners do this).
  const pathname = decodeURIComponent(url.pathname);

  // Installed-app launch → serve the splash document instead of the
  // marketing landing. Only "/" is rewritten; every other in-app route
  // already renders its own shell.
  if (pathname === "/" && url.searchParams.get("app") === "1") {
    const rewritten = new URL(url);
    rewritten.pathname = "/app";
    return NextResponse.rewrite(rewritten);
  }

  if (!pathname.startsWith("/@")) return NextResponse.next();

  // Strip the leading "/@" and isolate the handle from any trailing
  // segments. Empty handle → fall through to Next.js 404.
  const stripped = pathname.slice(2);
  const slashIdx = stripped.indexOf("/");
  const handle = slashIdx >= 0 ? stripped.slice(0, slashIdx) : stripped;
  const tail = slashIdx >= 0 ? stripped.slice(slashIdx) : "";
  if (!handle) return NextResponse.next();

  const rewritten = new URL(url);
  rewritten.pathname = `/u/${encodeURIComponent(handle)}${tail}`;
  return NextResponse.rewrite(rewritten);
}
