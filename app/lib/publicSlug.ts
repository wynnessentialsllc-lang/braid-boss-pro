// Branded public booking slugs.
//
// Stylists set a memorable URL like /book/sbw-braiding instead of
// the random /book/hfqcy1js they got at signup. This module owns the
// validation + normalization rules — the same regex + reserved list
// is duplicated server-side (supabase migration
// 20260616000000_branded_booking_slugs.sql) so the server is the
// authoritative gate; this lib gives the UI fast, offline feedback.
//
// Future-proof: the same value will eventually power /<slug>
// storefronts. Keep this module dependency-free so it can move to a
// shared package later without dragging app code with it.

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

// First and last char must be alphanumeric; middle can be any of
// [a-z0-9-]. Mirrors the SQL CHECK constraint exactly.
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

// Slugs we never hand out — booking surfaces, app shell paths,
// likely-future product URLs. Mirrors public._reserved_public_slugs()
// in the migration. Keep both sides in sync if you add more.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin", "api", "dashboard", "pricing", "support",
  "login", "signup", "book", "shop", "app",
  "settings", "help", "privacy", "terms",
  "account", "billing", "checkout", "logout",
  "signin", "register", "reset", "verify", "callback",
  "webhook", "static", "public", "assets", "favicon",
  "manifest", "robots", "sitemap", "admin-panel",
  "braid-boss-pro", "braidbosspro", "me", "user", "users",
  "profile", "profiles", "contract", "pay", "review",
  "booking", "reviews", "gallery", "storefront",
]);

// Lowercase, trim, swap any run of non-alphanumeric characters for a
// single hyphen, strip leading/trailing hyphens. Used both during
// typing (live normalize the input field) and to seed a suggestion
// from a business name.
export const normalizeSlug = (raw: string | null | undefined): string => {
  if (raw == null) return "";
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
};

export const isReservedSlug = (slug: string): boolean => {
  if (!slug) return false;
  return RESERVED_SLUGS.has(normalizeSlug(slug));
};

// Suggest a slug from a free-form business name. Adds an optional
// short random suffix when caller wants a unique-ish candidate (e.g.
// auto-generation for legacy users on signup). Suffix is base36 so
// it stays short and slug-safe.
export const generateSlug = (
  businessName: string,
  opts: { suffix?: boolean } = {},
): string => {
  const base = normalizeSlug(businessName) || "studio";
  if (!opts.suffix) return base;
  const tail = Math.random().toString(36).slice(2, 5);
  const head = base.slice(0, SLUG_MAX_LENGTH - (tail.length + 1));
  return `${head}-${tail}`;
};

export type SlugValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_short" | "too_long" | "invalid_format" | "reserved"; message: string };

// Pure validation — no network. Returns a typed reason so the UI can
// localize / re-style the message. Server-side check_slug_available
// must still run for the "taken" case since we can't know that here.
export const validateSlug = (raw: string): SlugValidationResult => {
  const normalized = normalizeSlug(raw);
  if (normalized.length < SLUG_MIN_LENGTH) {
    return {
      ok: false,
      reason: "too_short",
      message: `Use at least ${SLUG_MIN_LENGTH} characters.`,
    };
  }
  if (normalized.length > SLUG_MAX_LENGTH) {
    return {
      ok: false,
      reason: "too_long",
      message: `Keep it under ${SLUG_MAX_LENGTH} characters.`,
    };
  }
  if (!SLUG_PATTERN.test(normalized)) {
    return {
      ok: false,
      reason: "invalid_format",
      message: "Lowercase letters, numbers, and hyphens only.",
    };
  }
  if (isReservedSlug(normalized)) {
    return {
      ok: false,
      reason: "reserved",
      message: "That slug is reserved — try a longer or more specific one.",
    };
  }
  return { ok: true };
};

// Convert a server availability `reason` into a human message. Keeps
// the wording in one place so the UI doesn't drift from the messages
// validateSlug returns above.
export const slugReasonMessage = (reason: string): string => {
  switch (reason) {
    case "available":      return "This link is available.";
    case "saved":          return "Saved.";
    case "cleared":        return "Branded link removed.";
    case "too_short":      return `Use at least ${SLUG_MIN_LENGTH} characters.`;
    case "too_long":       return `Keep it under ${SLUG_MAX_LENGTH} characters.`;
    case "invalid_format": return "Lowercase letters, numbers, and hyphens only.";
    case "reserved":       return "That slug is reserved — try a longer or more specific one.";
    case "taken":          return "Another stylist is already using this link. Try another.";
    case "auth_required":  return "Sign in to set your booking link.";
    default:               return "Couldn't save that booking link. Try again.";
  }
};

// Build the public-facing URL for a slug. Centralized so SEO
// metadata + copy-link button + share text all use the same prefix.
export const PUBLIC_BOOKING_DOMAIN = "https://braidbosspro.app";
export const buildBookingUrl = (slug: string): string =>
  `${PUBLIC_BOOKING_DOMAIN}/book/${slug}`;
