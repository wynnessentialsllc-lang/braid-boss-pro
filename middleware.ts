// Storefront URL rewrites.
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
  // Limit middleware to URLs that begin with `@` (URL-encoded as %40
  // by some clients). Skip everything else so Next.js routing stays
  // fast for the rest of the app.
  matcher: ["/@:path*", "/%40:path*"],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  // `/@jane` → pathname is `/@jane`, segments[0] is `@jane`.
  // `/%40jane` (rare) → same once URL decodes.
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith("/@")) return NextResponse.next();

  // Strip the leading "/@" and isolate the handle from any trailing
  // segments. Empty handle → 404 (let Next.js fall through).
  const stripped = pathname.slice(2); // remove "/@"
  const slashIdx = stripped.indexOf("/");
  const handle = slashIdx >= 0 ? stripped.slice(0, slashIdx) : stripped;
  const tail = slashIdx >= 0 ? stripped.slice(slashIdx) : "";
  if (!handle) return NextResponse.next();

  const rewritten = new URL(url);
  rewritten.pathname = `/u/${encodeURIComponent(handle)}${tail}`;
  return NextResponse.rewrite(rewritten);
}
