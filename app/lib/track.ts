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
//
// Visitor identity, visit context, and the PII scrubber live in
// ./analytics-context, shared with the public booking-page write path in
// ./analytics-events so both sides of the product describe a visit the
// same way.

import { getSupabase } from "./supabase";
import { isAdminUser } from "./admin";
import {
  analyticsContext,
  getSessionId,
  sanitizeMetadata,
} from "./analytics-context";

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
      // Visit context first so an explicit metadata key from the call
      // site always wins over the ambient value.
      metadata: sanitizeMetadata({ ...analyticsContext(), ...(opts.metadata || {}) }),
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
