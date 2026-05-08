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
    if (error) return { ok: false, reason: error.message };
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
// Edge Function fills in the title/body/icon defaults when no payload
// is provided, so this helper just invokes with an empty body.
export const sendTestPush = async (): Promise<{ ok: boolean; reason?: string }> => {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.functions.invoke("send-push", { body: {} });
    if (error) return { ok: false, reason: error.message };
    if (data && typeof data === "object") {
      const r = data as { ok?: number; total?: number; message?: string; errors?: { message?: string }[] };
      if (r.total === 0) {
        return { ok: false, reason: r.message || "no active subscriptions on this device" };
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
