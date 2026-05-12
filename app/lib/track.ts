"use client";

// Fire-and-forget analytics client. Use trackEvent() from anywhere
// in client code to record a privacy-conscious event.
//
// Privacy contract:
//   * Never accept or store client names, phone numbers, emails,
//     card data, raw notes, or message bodies. Treat metadata as a
//     bag of counts, IDs, statuses, and feature flags only. Forbidden
//     keys are stripped defensively before send.
//   * The browser supabase client never writes to analytics_events
//     directly. Instead, this helper POSTs to /api/analytics/track,
//     which uses the service role.
//   * Calls are best-effort. A 5xx or network failure must never
//     surface to the user. The function returns void synchronously.

import { getSupabase } from "./supabase";
import { isAdminUser } from "./admin";

const SESSION_KEY = "bbp-analytics-sid";

let cachedSessionId: string | null = null;

const safeStorageGet = (k: string): string | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(k);
  } catch { return null; }
};
const safeStorageSet = (k: string, v: string): void => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(k, v);
  } catch { /* private mode — silent */ }
};

const newSessionId = (): string => {
  const r = () => Math.random().toString(36).slice(2, 10);
  return `s_${Date.now().toString(36)}_${r()}${r()}`;
};

const getSessionId = (): string => {
  if (cachedSessionId) return cachedSessionId;
  const existing = safeStorageGet(SESSION_KEY);
  if (existing) {
    cachedSessionId = existing;
    return existing;
  }
  const fresh = newSessionId();
  safeStorageSet(SESSION_KEY, fresh);
  cachedSessionId = fresh;
  return fresh;
};

const FORBIDDEN_KEYS = new Set([
  "email", "phone", "client_name", "clientName", "name",
  "card", "card_number", "cardNumber", "cvc", "cvv",
  "address", "address_line", "addressLine",
  "ssn", "password", "token", "access_token", "refresh_token",
  "message", "body", "note", "notes",
]);

const sanitizeMetadata = (m: Record<string, unknown> | undefined): Record<string, unknown> => {
  if (!m || typeof m !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200);
    } else if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = v;
    }
  }
  return out;
};

export type TrackOptions = {
  category?: string;
  metadata?: Record<string, unknown>;
  path?: string;
};

/**
 * Record an analytics event. Best-effort — never throws.
 *
 * @example
 *   trackEvent("welcome_intro_view");
 *   trackEvent("get_started_click", { category: "activation" });
 *   trackEvent("appointment_created", {
 *     category: "feature",
 *     metadata: { has_deposit: true, hour: 14 },
 *   });
 */
export const trackEvent = (
  eventName: string,
  opts: TrackOptions = {},
): void => {
  if (typeof window === "undefined") return;
  if (!eventName || typeof eventName !== "string") return;

  (async () => {
    let userId: string | null = null;
    let accessToken: string | null = null;
    let email: string | null = null;
    try {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      userId = data?.session?.user?.id ?? null;
      email = data?.session?.user?.email ?? null;
      accessToken = data?.session?.access_token ?? null;
    } catch { /* anon */ }

    // Fast-skip: admin events never leave the device. The server has
    // a second check (in /api/analytics/track) using the JWT, so a
    // future call site that bypasses this helper still won't pollute
    // the dataset with admin behavior.
    if (isAdminUser(email)) return;

    const body = {
      event_name: eventName,
      event_category: opts.category ?? null,
      metadata: sanitizeMetadata(opts.metadata),
      path: opts.path ?? (typeof location !== "undefined" ? location.pathname : null),
      session_id: getSessionId(),
      user_id: userId,
    };

    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      // Sending the JWT lets the server resolve the email and apply
      // the admin filter as a defense-in-depth backstop.
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
      await fetch("/api/analytics/track", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      /* silent */
    }
  })();
};
