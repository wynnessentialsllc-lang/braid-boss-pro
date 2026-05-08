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
    const { error } = await supabase.functions.invoke("send-push", {
      body: { user_id: userId, payload },
    });
    if (error) return { ok: false, reason: error.message };
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
