// The service worker: shows the notifications Hata sends to this device and opens the page one is about.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "Hata", { body: data.body || "", tag: data.tag, data: { url: data.url || "/" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      await open.navigate(url).catch(() => {});
      return open.focus();
    }),
  );
});
