// The service worker: shows the notifications Hata sends to this device and opens the page one is about.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {}
  // an agent's call that waits for a word carries the two answers as buttons, where the system shows buttons
  const actions = data.ask ? [{ action: "allow", title: data.allow || "Allow" }, { action: "decline", title: data.decline || "Decline" }] : [];
  event.waitUntil(self.registration.showNotification(data.title || "Hata", { body: data.body || "", icon: "/icon-192.png", badge: "/badge.png", tag: data.tag, actions, requireInteraction: actions.length > 0, data: { url: data.url || "/", ask: data.ask } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  const ask = event.notification.data?.ask;
  if (ask && event.action) {
    // answered right here with the session of this browser; when that does not work, the page is opened to answer there
    event.waitUntil(
      fetch(`/api/approvals/${ask}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allow: event.action === "allow" }) })
        .then((res) => (res.ok || res.status === 404 ? null : self.clients.openWindow(url)))
        .catch(() => self.clients.openWindow(url)),
    );
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      await open.navigate(url).catch(() => {});
      return open.focus();
    }),
  );
});

// the browser may replace the subscription by itself (keys rotated, the push service moved it); Hata is told,
// with the session of this browser, or the notifications would stop without a word
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let fresh = event.newSubscription;
      if (!fresh) {
        const key = old?.options?.applicationServerKey ?? (await fetch("/api/notify/push").then((r) => (r.ok ? r.json() : null)).then((d) => d && Uint8Array.from(atob(d.key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
        if (!key) return;
        fresh = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      if (!old) return;
      await fetch("/api/notify/push/renew", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ old: old.endpoint, subscription: fresh.toJSON() }) });
    })().catch(() => {}),
  );
});
