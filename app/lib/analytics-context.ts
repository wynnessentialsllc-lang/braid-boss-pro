"use client";

// Shared analytics context — anonymous visitor identity, per-request
// context, and the privacy scrubber used by every analytics write path
// (app/lib/track.ts for product events, app/lib/analytics-events.ts for
// owner-scoped public booking events).
//
// WHY THIS EXISTS
// ---------------
// Public booking-page events used to be written with `user_id` set to
// the *stylist who owns the link* and nothing else — no session, no
// path, no context. Every visitor to a booking page therefore looked
// like the same person in the admin feed, because the only identity on
// the row was the owner's. This module supplies the missing half: who
// the (anonymous) visitor is, which visit this event belongs to, and
// where they came from.
//
// PRIVACY CONTRACT
// ----------------
//   * Identifiers are random and first-party. No fingerprinting, no
//     third-party pixels, nothing derived from a name/email/phone.
//   * Context is coarse on purpose: device class (not model), referrer
//     host (not the full URL), timezone name (not coordinates).
//   * sanitizeMetadata() is the single chokepoint that strips PII-shaped
//     keys before anything leaves the device.

// ---------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------
// `bbp-analytics-sid` predates this module and was durable (it never
// rotated), so historically "session" and "visitor" were the same thing.
// It is now the rotating session id; an existing value is adopted once as
// the durable visitor id so returning visitors aren't all reset to new.
const SESSION_KEY = "bbp-analytics-sid";
const SESSION_SEEN_KEY = "bbp-analytics-sid-at";
const VISITOR_KEY = "bbp-analytics-vid";
const ATTRIBUTION_KEY = "bbp-analytics-attr";

/** A visit ends after this much inactivity, matching the GA-style norm. */
const SESSION_TTL_MS = 30 * 60_000;

// ---------------------------------------------------------------------
// Storage helpers — every access is best-effort. Safari private mode and
// storage-partitioned iframes throw on access, and analytics must never
// break a booking.
// ---------------------------------------------------------------------
const lsGet = (k: string): string | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(k);
  } catch { return null; }
};

const lsSet = (k: string, v: string): void => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(k, v);
  } catch { /* private mode — silent */ }
};

const ssGet = (k: string): string | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(k);
  } catch { return null; }
};

const ssSet = (k: string, v: string): void => {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(k, v);
  } catch { /* private mode — silent */ }
};

const randomId = (prefix: string): string => {
  const r = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${r()}${r()}`;
};

// ---------------------------------------------------------------------
// Privacy scrubber
// ---------------------------------------------------------------------
export const FORBIDDEN_METADATA_KEYS = new Set([
  "email", "phone", "client_name", "clientName", "name",
  "card", "card_number", "cardNumber", "cvc", "cvv",
  "address", "address_line", "addressLine",
  "ssn", "password", "token", "access_token", "refresh_token",
  "message", "body", "note", "notes",
]);

/**
 * Reduce a free-form metadata bag to scalars, drop PII-shaped keys, and
 * cap string length. Anything that isn't a string/number/boolean/null is
 * dropped rather than serialised — nested objects are how raw records
 * (and the PII inside them) sneak into an event log.
 */
export const sanitizeMetadata = (
  m: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  if (!m || typeof m !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (FORBIDDEN_METADATA_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200);
    } else if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = v;
    }
  }
  return out;
};

// ---------------------------------------------------------------------
// Pure classifiers — exported for unit tests, and because they carry the
// judgement calls worth reviewing in one place.
// ---------------------------------------------------------------------
export type ReferrerType =
  | "direct"
  | "internal"
  | "search"
  | "social"
  | "ai"
  | "referral";

// Matched as suffixes of the referrer hostname so subdomains count
// (m.facebook.com → social). Order of the checks below matters:
// gemini.google.com is an AI assistant, not a search result.
const AI_HOSTS = [
  "chatgpt.com", "chat.openai.com", "openai.com", "oai.azure.com",
  "claude.ai", "anthropic.com", "perplexity.ai", "gemini.google.com",
  "bard.google.com", "copilot.microsoft.com", "you.com", "poe.com",
  "phind.com", "meta.ai", "grok.com", "x.ai", "deepseek.com",
  "chat.mistral.ai", "duckduckgo.com/chat", "arc.net",
];

const SEARCH_HOSTS = [
  "google.com", "google.co.uk", "google.ca", "bing.com", "duckduckgo.com",
  "search.yahoo.com", "yahoo.com", "ecosia.org", "search.brave.com",
  "startpage.com", "baidu.com", "yandex.com", "qwant.com",
];

const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "l.facebook.com",
  "tiktok.com", "pinterest.com", "twitter.com", "x.com", "t.co",
  "youtube.com", "youtu.be", "snapchat.com", "linkedin.com",
  "reddit.com", "threads.net", "threads.com", "nextdoor.com",
];

const hostMatches = (host: string, list: string[]): boolean =>
  list.some((h) => host === h || host.endsWith(`.${h}`) || host.startsWith(`${h}/`));

/**
 * Bucket a referrer hostname. `ownHost` is the site's own hostname so
 * in-site navigation doesn't get counted as an external referral.
 */
export const classifyReferrer = (
  host: string | null,
  ownHost: string | null,
): ReferrerType => {
  if (!host) return "direct";
  const h = host.toLowerCase().replace(/^www\./, "");
  const own = (ownHost || "").toLowerCase().replace(/^www\./, "");
  if (own && (h === own || h.endsWith(`.${own}`))) return "internal";
  if (hostMatches(h, AI_HOSTS)) return "ai";
  if (hostMatches(h, SEARCH_HOSTS)) return "search";
  if (hostMatches(h, SOCIAL_HOSTS)) return "social";
  return "referral";
};

export type DeviceClass = "phone" | "tablet" | "desktop";

/** Coarse device bucket. UA first, viewport width as the tiebreaker. */
export const deviceClass = (ua: string, width: number): DeviceClass => {
  const s = (ua || "").toLowerCase();
  // iPadOS 13+ reports a desktop Safari UA, so a touch-sized viewport is
  // the only signal left for it.
  if (/ipad|tablet|playbook|silk/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(s)) return "phone";
  if (/android/.test(s)) return "tablet";
  if (width > 0 && width < 640) return "phone";
  if (width > 0 && width < 1024) return "tablet";
  return "desktop";
};

export const osFromUa = (ua: string): string => {
  const s = (ua || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (/android/.test(s)) return "android";
  if (/mac os x|macintosh/.test(s)) return "macos";
  if (/windows/.test(s)) return "windows";
  if (/linux/.test(s)) return "linux";
  return "other";
};

export const browserFromUa = (ua: string): string => {
  const s = (ua || "").toLowerCase();
  // Order matters — Edge and Chrome both claim "chrome"/"safari".
  if (/edg\//.test(s)) return "edge";
  if (/opr\/|opera/.test(s)) return "opera";
  if (/firefox|fxios/.test(s)) return "firefox";
  if (/crios|chrome/.test(s)) return "chrome";
  if (/safari/.test(s)) return "safari";
  return "other";
};

// ---------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------
type Identity = {
  visitorId: string;
  sessionId: string;
  /** First time we've ever seen this browser. */
  isNewVisitor: boolean;
  /** This event opened a new visit (first ever, or after the TTL). */
  isNewSession: boolean;
};

let cached: Identity | null = null;

const resolveIdentity = (): Identity => {
  if (cached) return cached;

  const legacySid = lsGet(SESSION_KEY);
  let visitorId = lsGet(VISITOR_KEY);
  let isNewVisitor = false;
  if (!visitorId) {
    // Adopt the pre-rotation session id so browsers that were already
    // tracked keep a stable identity instead of resetting to "new".
    visitorId = legacySid ? `v_${legacySid.replace(/^s_/, "")}` : randomId("v");
    isNewVisitor = !legacySid;
    lsSet(VISITOR_KEY, visitorId);
  }

  const seenAt = Number(lsGet(SESSION_SEEN_KEY) || 0);
  const fresh = legacySid && Number.isFinite(seenAt) && Date.now() - seenAt < SESSION_TTL_MS;
  const sessionId = fresh && legacySid ? legacySid : randomId("s");
  if (!fresh) lsSet(SESSION_KEY, sessionId);
  lsSet(SESSION_SEEN_KEY, String(Date.now()));

  cached = { visitorId, sessionId, isNewVisitor, isNewSession: !fresh };
  return cached;
};

/** Push the session's idle clock forward. Called on every tracked event. */
const touchSession = (): void => {
  lsSet(SESSION_SEEN_KEY, String(Date.now()));
};

export const getVisitorId = (): string => resolveIdentity().visitorId;
export const getSessionId = (): string => resolveIdentity().sessionId;

// ---------------------------------------------------------------------
// Attribution — captured once per visit (first touch) so an event fired
// five clicks deep still knows the visitor arrived from Instagram.
// ---------------------------------------------------------------------
type Attribution = {
  referrer_host: string | null;
  referrer_type: ReferrerType;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_path: string | null;
};

const trimParam = (v: string | null): string | null => {
  if (!v) return null;
  const s = v.trim().slice(0, 60);
  return s || null;
};

const computeAttribution = (): Attribution => {
  let referrerHost: string | null = null;
  try {
    if (typeof document !== "undefined" && document.referrer) {
      referrerHost = new URL(document.referrer).hostname || null;
    }
  } catch { referrerHost = null; }

  const ownHost = typeof location !== "undefined" ? location.hostname : null;
  let params: URLSearchParams | null = null;
  try {
    params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  } catch { params = null; }

  return {
    referrer_host: referrerHost ? referrerHost.replace(/^www\./, "").slice(0, 80) : null,
    referrer_type: classifyReferrer(referrerHost, ownHost),
    // `?ref=` is the shorthand we use in shared booking links; treat it
    // as a utm_source so both spellings land in one column.
    utm_source: trimParam(params?.get("utm_source") || params?.get("ref") || null),
    utm_medium: trimParam(params?.get("utm_medium") || null),
    utm_campaign: trimParam(params?.get("utm_campaign") || null),
    landing_path: typeof location !== "undefined" ? location.pathname.slice(0, 120) : null,
  };
};

const getAttribution = (): Attribution => {
  const stored = ssGet(ATTRIBUTION_KEY);
  if (stored) {
    try { return JSON.parse(stored) as Attribution; } catch { /* recompute */ }
  }
  const fresh = computeAttribution();
  ssSet(ATTRIBUTION_KEY, JSON.stringify(fresh));
  return fresh;
};

// ---------------------------------------------------------------------
// The context bag attached to every event
// ---------------------------------------------------------------------
export type AnalyticsContext = Record<string, string | number | boolean | null>;

/**
 * Everything we know about *this* visit that isn't the event itself.
 * Returns `{}` on the server so callers can merge unconditionally.
 */
export const analyticsContext = (): AnalyticsContext => {
  if (typeof window === "undefined") return {};
  touchSession();
  const id = resolveIdentity();
  const attr = getAttribution();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const width = typeof window.innerWidth === "number" ? window.innerWidth : 0;

  let standalone = false;
  try {
    standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { standalone = false; }

  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch { timezone = null; }

  return {
    visitor_id: id.visitorId,
    session_id: id.sessionId,
    is_new_visitor: id.isNewVisitor,
    is_new_session: id.isNewSession,
    device: deviceClass(ua, width),
    os: osFromUa(ua),
    browser: browserFromUa(ua),
    installed_pwa: standalone,
    viewport_w: width,
    language: typeof navigator !== "undefined" ? (navigator.language || "").slice(0, 12) : null,
    timezone: timezone ? timezone.slice(0, 60) : null,
    local_hour: new Date().getHours(),
    ...attr,
  };
};
