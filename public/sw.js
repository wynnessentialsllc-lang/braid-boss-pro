// Braid Boss Pro — push service worker
// Handles incoming Web Push messages and click navigation.
// Native push (iOS via Capacitor) is handled inside the app shell;
// this file is browser-only.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
