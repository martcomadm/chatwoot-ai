// Service worker de MARTCOM Operations: muestra los avisos que llegan por Web Push aunque la
// página esté cerrada y, al tocarlos, abre el expediente.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "MARTCOM Operations", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "MARTCOM Operations";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.sale_id ? `${data.sale_id}:${data.kind || ""}` : undefined,
    renotify: true,
    icon: "/operations/pwa/icon-192.png",
    badge: "/operations/pwa/icon-192.png",
    data: { url: data.url || "/operations" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/operations", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(w => new URL(w.url).pathname.startsWith("/operations"));
    if (existing) { await existing.focus(); existing.postMessage({ type: "open", url }); return; }
    await self.clients.openWindow(url);
  })());
});
