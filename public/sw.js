// Braid Boss Pro — push service worker
//
// Version: bump this string whenever the SW logic changes so the
// browser detects a byte-different /sw.js, installs the new worker,
// and skipWaiting + clients.claim cycle it onto every open tab.
const SW_VERSION = "bbp-sw-1.1.0";

// Scope: Web Push delivery + click → focus/openWindow. Native push
// (iOS via Capacitor) is handled inside the app shell; this file is
// browser-only.
//
// NO fetch handler by design. We deliberately do NOT intercept fetch
// here, so the browser uses its normal HTTP cache and Next.js's
// immutable asset hashes handle build-to-build invalidation. Adding
// a fetch listener would create a stale-cache trap on deploys; if a
// real offline mode is needed later, ship it behind a new SW_VERSION
// bump so cache keys are unambiguous and old caches are evicted on
// activate (see below).

self.addEventListener("install", () => {
  // Activate the new worker immediately so users get the latest push
  // logic on the next event instead of waiting for every tab to
  // close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Take control of any pages already open under the previous
      // worker — no manual reload required.
      self.clients.claim(),
      // Best-effort cleanup of stale CacheStorage entries from any
      // future version that does add caching. Currently a no-op.
      (async () => {
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((k) => !k.startsWith(SW_VERSION)).map((k) => caches.delete(k)),
          );
        } catch (_) { /* old browser — silent */ }
      })(),
    ]),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "Braid Boss Pro", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Braid Boss Pro";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon.png",
    badge: data.badge || "/icon.png",
    data: data.data || { url: "/" },
    tag: data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const client of all) {
        if ("focus" in client) {
          try {
            const u = new URL(client.url);
            if (u.pathname === "/" || u.pathname === target) {
              client.focus();
              if ("navigate" in client && target !== "/") client.navigate(target);
              return;
            }
          } catch (_) { /* ignore */ }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
