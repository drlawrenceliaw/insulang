const CACHE_NAME = "insu-lang-quick-check-v9";
const CORE_ASSETS = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.includes("/api/")) return;

  const url = new URL(req.url);
  const isPage = req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html");
  const isBrandLogo = url.pathname.endsWith("/images/insu-lang-logo-small.png");

  if (isPage || isBrandLogo) {
    // Network-first so GitHub/Vercel updates appear immediately; cache is only offline fallback.
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match("/index.html")))
    );
    return;
  }

  // Static assets: cache-first with background refresh.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
