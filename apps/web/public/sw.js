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

// Çevrimdışı: atölyede sık kullanılan sayfalar son hâliyle saklanır; statik dosyalar önbellekten
const PAGES = "mb-pages-v2";
const STATIC = "mb-static-v2";
const OFFLINE_PATHS = ["/uretim/okut", "/atolye", "/kurye", "/benim"];
const offlineHtml = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#072A50;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h2>İnternet bağlantısı yok</h2><p>Bağlantı gelince sayfayı yenileyin. Kutu okutma sayfası daha önce açıldıysa çevrimdışı da çalışır.</p></div>', { headers: { "Content-Type": "text/html; charset=utf-8" } });

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("mb-") && k !== PAGES && k !== STATIC).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // değişmeyen derleme dosyaları: önce önbellek
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode !== "navigate") return;
  // oturum kapanınca (giriş sayfası) saklanan kişisel sayfalar silinir
  if (url.pathname.startsWith("/giris") || url.pathname.startsWith("/auth")) { event.waitUntil(caches.delete(PAGES)); return; }
  const keep = OFFLINE_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.redirected && new URL(res.url).pathname.startsWith("/giris")) { caches.delete(PAGES); return res; }
        if (keep && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(url.pathname, copy)); }
        return res;
      })
      .catch(async () => (keep ? (await caches.open(PAGES).then((c) => c.match(url.pathname))) : null) || offlineHtml()),
  );
});
