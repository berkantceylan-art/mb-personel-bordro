/* MB Personel service worker: telefon bildirimleri ve ana ekrana ekleme */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Bildirim bağlantısı yalnız site içi bir yol olabilir (dış siteye yönlendirme / oltalama engeli)
function safeLink(link) {
  try {
    const u = new URL(typeof link === "string" ? link : "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "MB Personel", body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(d.title || "MB Personel", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag || undefined,
      data: { link: safeLink(d.link) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = safeLink(event.notification.data && event.notification.data.link);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      for (const c of list) {
        if ("focus" in c) {
          try { await c.navigate(link); } catch { /* kontrolsüz pencere: yeni pencere açılır */ }
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});

// Ağ her zaman öncelikli; yalnızca bağlantı yoksa basit bir uyarı sayfası
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#072A50;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h2>İnternet bağlantısı yok</h2><p>Bağlantı gelince sayfayı yenileyin.</p></div>', { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});
