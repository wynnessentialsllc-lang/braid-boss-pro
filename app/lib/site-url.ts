// Production-safe site URL resolver for Supabase auth redirects.
//
// Why this exists:
//   When Supabase sends a confirmation / password-reset email, it
//   embeds whatever URL we pass as `emailRedirectTo` / `redirectTo`.
//   If we pass `window.location.origin` from a developer's laptop,
//   the email links break for everyone else. If we pass a hardcoded
//   localhost callback, the production deploy is broken too.
//
// Resolution order (most specific wins):
//   1. NEXT_PUBLIC_SITE_URL env var (set on Vercel for prod/preview)
//   2. window.location.origin — but ONLY if it looks like a real
//      public origin (https + non-localhost host). Capacitor's
//      `capacitor://` and `http://localhost` are both filtered out so
//      we never bake a dev/native origin into an outbound email.
//   3. Hardcoded production fallback: https://braidbosspro.app
//
// All return values are normalized: no trailing slash, https where
// possible, ready to be concatenated with a path that starts with "/".

const PRODUCTION_FALLBACK = "https://braidbosspro.app";

const trimTrailingSlash = (u: string): string =>
  u.endsWith("/") ? u.slice(0, -1) : u;

const isUsableBrowserOrigin = (origin: string): boolean => {
  if (!origin || origin === "null") return false;
  // Capacitor / Cordova / file:// shells — never embed in an email.
  if (origin.startsWith("capacitor://")) return false;
  if (origin.startsWith("ionic://")) return false;
  if (origin.startsWith("file://")) return false;
  // Local dev — never embed in an email.
  if (origin.includes("localhost")) return false;
  if (origin.includes("127.0.0.1")) return false;
  if (origin.includes("0.0.0.0")) return false;
  return true;
};

export const getSiteUrl = (): string => {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl && envUrl.trim()) return trimTrailingSlash(envUrl.trim());

  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (isUsableBrowserOrigin(origin)) return trimTrailingSlash(origin);
  }

  return PRODUCTION_FALLBACK;
};

// Build a fully-qualified URL for a Supabase auth redirect target.
// The path argument should start with "/"; if omitted, the site root
// is returned (which is what we want for confirmation + reset flows
// — the app's auth listener picks up the session from the URL hash
// thanks to detectSessionInUrl: true on the client).
export const getAuthRedirectUrl = (path: string = "/auth/callback"): string => {
  const base = getSiteUrl();
  if (!path) return base;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
};
