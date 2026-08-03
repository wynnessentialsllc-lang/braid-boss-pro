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

// Durable, cross-device dedup ledger. localStorage alone is wiped by iOS
// after the PWA sits idle (ITP storage eviction), which makes already-seen
// reminders re-fire on the next open. notification_reminder_deliveries is
// the authoritative record; we merge it with the local cache so a reminder
// seen once stays suppressed across restarts and across devices.
const DELIVERY_TABLE = "notification_reminder_deliveries";
// Only the recent window matters: appointment reminders key off a future
// date and the retention/business re-fire windows are <= 12h, so rows older
// than this are dead weight. We both read within it and prune past it.
const DELIVERY_WINDOW_DAYS = 45;

// Load the merged (server ∪ local) delivery history for a user. Falls back
// to the local cache on any error so a network blip can't unleash a flood
// of re-fired reminders. Re-seeds localStorage from the server so a later
// offline open still dedupes, and opportunistically prunes stale rows.
export const loadDeliveredHistoryRemote = async (
  userId: string,
): Promise<Record<string, string>> => {
  const local = loadDeliveredHistory();
  if (!userId) return local;
  try {
    const since = new Date(
      Date.now() - DELIVERY_WINDOW_DAYS * 86400_000,
    ).toISOString();
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from(DELIVERY_TABLE)
      .select("rule_id, delivered_at")
      .eq("user_id", userId)
      .gte("delivered_at", since);
    if (error || !data) return local;
    const merged: Record<string, string> = { ...local };
    for (const row of data as { rule_id: string; delivered_at: string }[]) {
      if (row?.rule_id) merged[row.rule_id] = row.delivered_at;
    }
    saveDeliveredHistory(merged);
    // Best-effort prune of rows past the window; never blocks the result.
    void supabase
      .from(DELIVERY_TABLE)
      .delete()
      .eq("user_id", userId)
      .lt("delivered_at", since)
      .then(() => {}, () => {});
    return merged;
  } catch {
    return local;
  }
};

// Record a single successful dispatch in the durable ledger. Best-effort:
// the local cache (saved by the caller) still holds it if this write fails.
export const recordDeliveryRemote = async (
  userId: string,
  ruleId: string,
  deliveredAtIso: string,
): Promise<void> => {
  if (!userId || !ruleId) return;
  try {
    await getSupabase()
      .from(DELIVERY_TABLE)
      .upsert(
        { user_id: userId, rule_id: ruleId, delivered_at: deliveredAtIso },
        { onConflict: "user_id,rule_id" },
      );
  } catch { /* local cache is the fallback */ }
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
        const b = body as { error?: string; detail?: string; message?: string; hint?: string };
        const text = b.error || b.detail || b.message;
        // send-push attaches an actionable `hint` on config errors
        // (e.g. "Set VAPID_PUBLIC_KEY … via supabase secrets set").
        // Surface it so the owner sees the exact fix, not just the code.
        if (text) return b.hint ? `${text} — ${b.hint}` : text;
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
      const r = data as { ok?: number; total?: number; errors?: { message?: string; status?: number }[] };
      if (typeof r.total === "number" && r.total > 0 && r.ok === 0) {
        const first = r.errors?.[0];
        const base = first?.message || "no successful delivery";
        // Surface the push-service HTTP status (e.g. 403 = VAPID key /
        // subject mismatch, 410 = stale subscription) so the exact
        // failure is obvious instead of a generic library message.
        return { ok: false, reason: first?.status ? `${base} (HTTP ${first.status})` : base };
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
      const r = data as { ok?: number; total?: number; message?: string; errors?: { message?: string; status?: number }[] };
      if (r.total === 0) {
        return { ok: false, reason: r.message || "No push subscription on this device. Enable push first." };
      }
      if (typeof r.total === "number" && r.total > 0 && r.ok === 0) {
        const first = r.errors?.[0];
        const base = first?.message || "no successful delivery";
        // Include the push-service HTTP status (403 = VAPID key/subject
        // mismatch, 410 = dead subscription) for one-glance diagnosis.
        return { ok: false, reason: first?.status ? `${base} (HTTP ${first.status})` : base };
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
