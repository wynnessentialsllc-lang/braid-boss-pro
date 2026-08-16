// Lightweight write-only analytics event emitter.
//
// Anonymous booking-page submissions and stylist-side actions both
// land in `public.analytics_events`. The owner reads their own
// stream; nothing here exposes other users' rows.
//
// Keep payloads small and structured — these power funnel + KPI
// dashboards later. Don't put PII in payloads; reference ids only
// (appointmentId / waitlistId etc.). `sanitizeMetadata` enforces that
// on the way out, so the rule is checked rather than just documented.
//
// TWO COLUMN FAMILIES, ONE ROW
// ----------------------------
// `user_id` on these rows is the *stylist who owns the booking link*,
// not the person clicking — that's what makes the owner-scoped RPCs
// (`booking_intelligence_*`, which filter `user_id = auth.uid()` and
// read `event_type` / `payload`) work. It also meant the admin feed had
// no way to tell two visitors apart: every public event carried the
// same single id. So each row now ALSO carries the v2 columns
// (`event_name`, `event_category`, `metadata`, `session_id`, `path`)
// with the visitor's own anonymous identity and visit context in them.
//
//   legacy → event_type / event_source / payload  (owner dashboards)
//   v2     → event_name / event_category / metadata / session_id / path
//            (admin dashboard, visitor-level detail)
//
// Both are written together, so neither reader has to change and the
// two can never disagree about what happened.

import { getSupabase } from "./supabase";
import { analyticsContext, sanitizeMetadata } from "./analytics-context";

export type AnalyticsEventType =
  | "waitlist_joined"
  | "booking_requested"
  | "booking_approved"
  | "waitlist_converted"
  | "appointment_created"
  // Public booking-page events. `booking_intelligence_summary` reads all
  // three by name, so the strings are load-bearing — don't rename them
  // without updating the RPC in supabase/migrations.
  | "public_booking_viewed"
  | "public_service_viewed"
  | "public_slot_viewed";

export type AnalyticsEventSource = "app" | "public" | "system";

export type AnalyticsPayload = Record<string, unknown>;

// Fire-and-forget. Returns a Promise so the caller can await if it
// needs to chain UI off completion, but errors are swallowed —
// analytics never breaks the user flow.
export const emitAnalyticsEvent = async (params: {
  ownerUserId: string;
  type: AnalyticsEventType;
  source?: AnalyticsEventSource;
  payload?: AnalyticsPayload;
}): Promise<void> => {
  if (!params.ownerUserId || !params.type) return;
  try {
    const supabase = getSupabase();
    const source = params.source || "app";
    const payload = sanitizeMetadata(params.payload);
    const context = analyticsContext();
    const sessionId = typeof context.session_id === "string" ? context.session_id : null;

    await supabase.from("analytics_events").insert({
      // Legacy shape — owner-scoped dashboards read these.
      user_id: params.ownerUserId,
      event_type: params.type,
      event_source: source,
      payload,
      // v2 shape — visitor-level detail for the admin dashboard.
      event_name: params.type,
      event_category: source,
      metadata: { ...context, ...payload, owner_user_id: params.ownerUserId },
      session_id: sessionId,
      path: typeof location !== "undefined" ? location.pathname.slice(0, 200) : null,
    });
  } catch {
    // Intentional: a failed analytics insert must never propagate.
  }
};
