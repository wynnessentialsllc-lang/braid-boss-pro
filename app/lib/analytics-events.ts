// Lightweight write-only analytics event emitter.
//
// Anonymous booking-page submissions and stylist-side actions both
// land in `public.analytics_events`. The owner reads their own
// stream; nothing here exposes other users' rows.
//
// Keep payloads small and structured — these power funnel + KPI
// dashboards later. Don't put PII in payloads; reference ids only
// (appointmentId / waitlistId etc.).

import { getSupabase } from "./supabase";

export type AnalyticsEventType =
  | "waitlist_joined"
  | "booking_requested"
  | "booking_approved"
  | "waitlist_converted"
  | "appointment_created";

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
    await supabase.from("analytics_events").insert({
      user_id: params.ownerUserId,
      event_type: params.type,
      event_source: params.source || "app",
      payload: params.payload || {},
    });
  } catch {
    // Intentional: a failed analytics insert must never propagate.
  }
};
