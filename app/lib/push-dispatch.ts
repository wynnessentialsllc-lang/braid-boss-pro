// Thin wrapper around the existing send-push Edge Function. Tracks
// delivered ids in localStorage so we can dedup across renders, and
// always calls the function with the current authed user_id (never
// allows cross-user dispatch from the client).

import { getSupabase } from "./supabase";
import {
  formatNotificationPayload,
  type NotificationRule,
} from "./notification-rules";

const DELIVERED_KEY = "bbp-notif-delivered";

export const loadDeliveredHistory = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DELIVERED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
};

export const saveDeliveredHistory = (history: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DELIVERED_KEY, JSON.stringify(history)); }
  catch { /* quota */ }
};

// supabase-js wraps Edge Function failures in three error classes:
//  - FunctionsFetchError ("Failed to send a request to the Edge
//    Function") — network / function crashed on import / CORS.
//  - FunctionsHttpError — function returned non-2xx with a body.
//  - FunctionsRelayError — Supabase gateway problem.
// FunctionsHttpError stashes the original Response on
// error.context, so we can dig out the function's own JSON
// `error` / `detail` fields and surface them to the user.
const extractFunctionError = async (error: unknown): Promise<string> => {
  if (!error) return "unknown error";
  const fallback =
    (error as { message?: string })?.message || "unknown error";
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body === "object") {
        const b = body as { error?: string; detail?: string; message?: string };
        const text = b.error || b.detail || b.message;
        if (text) return text;
      }
    } catch {
      try {
        const text = (await ctx.clone().text()).trim();
        if (text) return text.slice(0, 240);
      } catch { /* ignore */ }
    }
  }
  return fallback;
};

export const dispatchPush = async (
  userId: string,
  rule: NotificationRule,
): Promise<{ ok: boolean; reason?: string }> => {
  if (!userId) return { ok: false, reason: "no user" };
  const supabase = getSupabase();
  const payload = formatNotificationPayload(rule);
  try {
    const { data, error } = await supabase.functions.invoke("send-push", {
      body: { user_id: userId, payload },
    });
    if (error) return { ok: false, reason: await extractFunctionError(error) };
    if (data && typeof data === "object") {
      const r = data as { ok?: number; total?: number; errors?: { message?: string }[] };
      if (typeof r.total === "number" && r.total > 0 && r.ok === 0) {
        return { ok: false, reason: r.errors?.[0]?.message || "no successful delivery" };
      }
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "invoke failed" };
  }
};

// Send a default test push to the currently authenticated user. The
// Edge Function treats `{ type: "test" }` (or an empty body) as a
// signal to fill in the title/body/icon defaults so the same default
// copy lives in one place — the function.
export const sendTestPush = async (): Promise<{ ok: boolean; reason?: string }> => {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.functions.invoke("send-push", {
      body: { type: "test" },
    });
    if (error) return { ok: false, reason: await extractFunctionError(error) };
    if (data && typeof data === "object") {
      const r = data as { ok?: number; total?: number; message?: string; errors?: { message?: string }[] };
      if (r.total === 0) {
        return { ok: false, reason: r.message || "No push subscription on this device. Enable push first." };
      }
      if (typeof r.total === "number" && r.total > 0 && r.ok === 0) {
        return { ok: false, reason: r.errors?.[0]?.message || "no successful delivery" };
      }
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "invoke failed" };
  }
};

export const dispatchAndRemember = async (
  userId: string,
  rule: NotificationRule,
  history: Record<string, string>,
): Promise<Record<string, string>> => {
  const result = await dispatchPush(userId, rule);
  if (!result.ok) return history;
  return { ...history, [rule.id]: new Date().toISOString() };
};

// Statuses that mean an appointment is no longer "upcoming" and must
// never trigger a reminder push. Covers both spellings of cancelled and
// every no-show variant the codebase / DB has used over time.
const INACTIVE_APPOINTMENT_STATUSES = new Set([
  "cancelled", "canceled", "completed", "no_show", "no-show", "noshow", "declined",
]);

// Authoritative guard against stale local state.
//
// The client scheduler builds appointment reminders from the in-memory
// appointments cache, which can lag behind a cancellation made on
// another device or through a client self-service link. Without this
// check a "starts soon" push fires for an appointment that's already
// cancelled in the database.
//
// Re-check every appointment-category reminder against the DB right
// before dispatch and drop any whose row is missing (deleted) or no
// longer active. Non-appointment rules pass through untouched. Fails
// OPEN (returns the input unchanged) on a query error so a transient
// network blip can never silence legitimate reminders.
export const dropInactiveAppointmentRules = async (
  rules: NotificationRule[],
): Promise<NotificationRule[]> => {
  const apptIds = Array.from(
    new Set(
      rules
        .filter((r) => r.category === "appointment" && r.appointmentId)
        .map((r) => r.appointmentId as string),
    ),
  );
  if (apptIds.length === 0) return rules;
  try {
    const { data, error } = await getSupabase()
      .from("appointments")
      .select("id, status")
      .in("id", apptIds);
    if (error || !data) return rules; // fail open
    const statusById = new Map<string, string>(
      data.map((r: { id: unknown; status: unknown }) => [
        String(r.id),
        String(r.status || "").toLowerCase(),
      ]),
    );
    return rules.filter((r) => {
      if (r.category !== "appointment" || !r.appointmentId) return true;
      const status = statusById.get(r.appointmentId);
      if (status === undefined) return false; // row deleted — suppress
      return !INACTIVE_APPOINTMENT_STATUSES.has(status);
    });
  } catch {
    return rules; // fail open
  }
};
