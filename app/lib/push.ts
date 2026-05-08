// Push notification subscription layer.
//
// Same surface for two transports:
//   - Web Push (today, browsers): registers the service worker, asks
//     for permission, subscribes to PushManager, persists the
//     endpoint + keys to Supabase under the current user.
//   - Native push (Capacitor / iOS / Android, future wrap): the
//     Capacitor PushNotifications plugin yields a device token; we
//     persist that token through the same `registerSubscription`
//     entry point. The schema already supports both — we just store
//     `device_token` instead of `endpoint`/`keys`.

import { getSupabase } from "./supabase";

const SW_PATH = "/sw.js";
// VAPID public key. Set via NEXT_PUBLIC env at build time. When unset
// (the current default), Web Push silently no-ops; native pushes via
// Capacitor still work because they don't need VAPID.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY || "";

const urlBase64ToUint8Array = (base64: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof atob === "function" ? atob(b64) : "";
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export type PushCapability =
  | "unsupported"
  | "blocked"
  | "default"
  | "granted"
  | "subscribed";

export const detectPushCapability = async (): Promise<PushCapability> => {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "default";
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!reg) return "granted";
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "granted";
  } catch {
    return "granted";
  }
};

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_PATH);
  } catch (err) {
    console.warn("[bbp] service worker register failed", err);
    return null;
  }
};

const requestPermission = async (): Promise<NotificationPermission> => {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return await Notification.requestPermission();
};

const persistSubscription = async (
  userId: string,
  payload: {
    platform: "web" | "ios" | "android";
    endpoint?: string | null;
    keys?: any;
    deviceToken?: string | null;
  },
) => {
  const supabase = getSupabase();
  const row: Record<string, any> = {
    user_id: userId,
    platform: payload.platform,
    enabled: true,
    last_seen_at: new Date().toISOString(),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 256) : null,
  };
  if (payload.endpoint) row.endpoint = payload.endpoint;
  if (payload.keys) row.keys = payload.keys;
  if (payload.deviceToken) row.device_token = payload.deviceToken;

  // Use a partial unique index for the conflict target. Web rows
  // upsert on (user_id, endpoint); native rows on (user_id,
  // device_token). One subscribe call uses one of the two paths.
  const onConflict = payload.endpoint
    ? "user_id,endpoint"
    : "user_id,device_token";
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(row, { onConflict });
  if (error) throw error;
};

// Web entry point: ask for permission, register the SW, subscribe to
// the PushManager, persist to Supabase. Returns the live subscription
// or null if the environment doesn't support it.
export const subscribeWebPush = async (userId: string): Promise<PushSubscription | null> => {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const perm = await requestPermission();
  if (perm !== "granted") return null;
  const reg = await registerServiceWorker();
  if (!reg) return null;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (!VAPID_PUBLIC_KEY) {
      // Without a VAPID key the browser allows subscribing only on
      // origin-restricted environments; we fall back to non-VAPID
      // subscription where supported, otherwise return null.
      try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true }); }
      catch { return null; }
    } else {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
    }
  }
  const json = sub.toJSON();
  await persistSubscription(userId, {
    platform: "web",
    endpoint: json.endpoint || null,
    keys: json.keys || null,
  });
  return sub;
};

// Native entry point: called by the Capacitor PushNotifications
// listener once we wrap the app for iOS/Android. Stays a tiny wrapper
// so consumers don't need to think about the underlying transport.
export const registerNativeSubscription = async (
  userId: string,
  platform: "ios" | "android",
  deviceToken: string,
): Promise<void> => {
  if (!deviceToken) return;
  await persistSubscription(userId, { platform, deviceToken });
};

// Unsubscribe both the browser-side push manager and the Supabase row.
export const unsubscribeWebPush = async (userId: string): Promise<void> => {
  if (typeof window === "undefined") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = sub?.endpoint;
    if (sub) await sub.unsubscribe();
    if (endpoint) {
      const supabase = getSupabase();
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", endpoint);
    }
  } catch (err) {
    console.warn("[bbp] unsubscribe failed", err);
  }
};

// Touch the row's last_seen_at so we can prune stale device tokens.
// Called once per app open for the active subscription, if any.
export const refreshSubscriptionHeartbeat = async (userId: string): Promise<void> => {
  if (typeof window === "undefined") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub?.endpoint) return;
    const supabase = getSupabase();
    await supabase
      .from("push_subscriptions")
      .update({ last_seen_at: new Date().toISOString(), enabled: true })
      .eq("user_id", userId)
      .eq("endpoint", sub.endpoint);
  } catch { /* swallow */ }
};
