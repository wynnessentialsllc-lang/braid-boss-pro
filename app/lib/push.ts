// Push notification subscription layer.
//
// Same surface for two transports:
//   - Web Push (browsers, PWA): registers the service worker, asks
//     for permission, subscribes to PushManager, persists the
//     endpoint + keys to Supabase under the current user.
//   - Native push (Capacitor / iOS): the @capacitor/push-notifications
//     plugin yields a device token via the `registration` listener;
//     we persist that token under the same row shape (platform="ios",
//     device_token). WKWebView has no service worker or PushManager,
//     so the web path short-circuits in native and the native path
//     short-circuits in the browser.

import { getSupabase } from "./supabase";

const SW_PATH = "/sw.js";

// Capacitor runtime detection. We avoid a static `import` of
// @capacitor/core so the web bundle never pulls native code in. The
// `Capacitor` global is injected at runtime by the iOS shell.
const isNativePlatform = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};
// VAPID public key. Set via NEXT_PUBLIC env at build time. When unset
// (the current default), Web Push silently no-ops; native pushes via
// Capacitor still work because they don't need VAPID.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY || "";

// True when the build-time VAPID public key is present. When it's
// missing, a browser/PWA can't create a Web Push subscription at all —
// iOS/Safari REQUIRE an applicationServerKey, so pushManager.subscribe
// throws and enabling notifications silently fails. The Settings UI
// reads this so it can show an honest "server setup isn't finished yet"
// message instead of wrongly blaming the browser.
export const WEB_PUSH_PUBLIC_KEY_CONFIGURED = VAPID_PUBLIC_KEY.length > 0;

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

  // Native iOS shell: APNs is always supported on physical devices
  // (the Simulator returns no token, but we don't need to surface that
  // separately at this layer). Permission state comes from the
  // PushNotifications plugin.
  if (isNativePlatform()) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const status = await PushNotifications.checkPermissions();
      if (status.receive === "denied") return "blocked";
      if (status.receive === "granted") {
        // We don't track per-device subscription state on the client
        // for native — the Supabase row is the source of truth and
        // the dashboard already reads it. Treat granted as
        // "subscribed" so the UI lights up.
        return "subscribed";
      }
      return "default";
    } catch {
      return "unsupported";
    }
  }

  // Web path: requires service worker + PushManager.
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
  // Service workers don't run inside Capacitor / WKWebView. Skip
  // registration to avoid the inevitable error and keep the native
  // shell quiet.
  if (isNativePlatform()) return null;
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

  // Drop this user's OTHER rows on the same transport.
  //
  // iOS treats every "Add to Home Screen" as a separate web app with its
  // own push registration, so re-adding the icon (or ITP clearing the old
  // instance's storage) mints a brand-new endpoint and orphans the old
  // one. Apple keeps returning 201 for that dead endpoint instead of the
  // 410 that send-push prunes on, so it lingers forever — the server
  // reports a successful send while the notification goes nowhere. That
  // is exactly how push looked "fine" server-side for two weeks while no
  // banner ever reached the phone.
  //
  // A device only ever holds one live registration per transport, so any
  // row that isn't the one we just wrote is dead by definition. Deleting
  // it here keeps the send fan-out honest.
  //
  // Best-effort: a prune failure must never block enabling notifications,
  // and RLS already scopes the delete to this user's own rows.
  try {
    const stale = supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("platform", payload.platform);
    // `neq` on a NULL column never matches, so each branch only ever
    // touches rows of its own transport (web rows carry an endpoint,
    // native rows a device_token).
    if (payload.endpoint) await stale.neq("endpoint", payload.endpoint);
    else if (payload.deviceToken) await stale.neq("device_token", payload.deviceToken);
  } catch { /* stale rows are cosmetic — never fail the subscribe */ }
};

// Native iOS subscribe: APNs registration via Capacitor. Listens once
// for the registration event, persists the device token, then
// resolves. Returns true on success, false otherwise. Failures here
// surface the actual reason via a thrown Error so the UI's
// extractFunctionError-style helpers can show it inline.
const subscribeNative = async (userId: string): Promise<boolean> => {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  // Permission first. iOS shows the system prompt on requestPermissions
  // if the user hasn't decided yet.
  const status = await PushNotifications.requestPermissions();
  if (status.receive !== "granted") return false;

  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let regHandle: { remove: () => Promise<void> } | null = null;
    let errHandle: { remove: () => Promise<void> } | null = null;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      try { await regHandle?.remove(); } catch { /* ignore */ }
      try { await errHandle?.remove(); } catch { /* ignore */ }
      reject(new Error("APNs registration timed out"));
    }, 30000);

    const cleanup = async () => {
      clearTimeout(timeout);
      try { await regHandle?.remove(); } catch { /* ignore */ }
      try { await errHandle?.remove(); } catch { /* ignore */ }
    };

    void (async () => {
      regHandle = await PushNotifications.addListener("registration", async (token) => {
        if (settled) return;
        settled = true;
        try {
          await registerNativeSubscription(userId, "ios", token.value);
          await cleanup();
          resolve(true);
        } catch (err) {
          await cleanup();
          reject(err);
        }
      });
      errHandle = await PushNotifications.addListener("registrationError", async (e) => {
        if (settled) return;
        settled = true;
        await cleanup();
        const err = (e as { error?: string })?.error || "registration error";
        reject(new Error(String(err)));
      });
      // Kick off the actual APNs registration. The listeners above
      // resolve once the token (or error) comes back.
      try {
        await PushNotifications.register();
      } catch (err) {
        if (!settled) {
          settled = true;
          await cleanup();
          reject(err);
        }
      }
    })();
  });
};

// Subscribe entry point. Routes through APNs on native iOS, Web Push
// otherwise. Returns the live web subscription on web, true on native
// success, null when the platform doesn't support push.
export const subscribeWebPush = async (
  userId: string,
): Promise<PushSubscription | true | null> => {
  if (typeof window === "undefined") return null;

  if (isNativePlatform()) {
    try {
      const ok = await subscribeNative(userId);
      return ok ? true : null;
    } catch (err) {
      console.warn("[bbp] native push subscribe failed", err);
      return null;
    }
  }

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

// Unsubscribe. On native iOS the only thing we can do is delete the
// stored device-token row (APNs has no client-side unsubscribe call;
// the user revokes via system settings). On web we tear down the
// PushSubscription and prune the matching row.
export const unsubscribeWebPush = async (userId: string): Promise<void> => {
  if (typeof window === "undefined") return;

  if (isNativePlatform()) {
    try {
      const supabase = getSupabase();
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("platform", "ios");
    } catch (err) {
      console.warn("[bbp] native unsubscribe failed", err);
    }
    return;
  }

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

  if (isNativePlatform()) {
    // No client-side handle to the APNs token after registration is
    // complete (the plugin doesn't expose a getter). The token was
    // upserted into push_subscriptions on register; we touch the row
    // by user_id+platform to keep last_seen_at fresh for stale prune.
    try {
      const supabase = getSupabase();
      await supabase
        .from("push_subscriptions")
        .update({ last_seen_at: new Date().toISOString(), enabled: true })
        .eq("user_id", userId)
        .eq("platform", "ios");
    } catch { /* swallow */ }
    return;
  }

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
