/* Wyre Field service worker — app-shell cache + offline navigation fallback. */
const VERSION = "wyre-field-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/wyre-logo.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // The API is same-origin in production. Its replies are per-user and authenticated — never cache them,
  // and never serve a stale snapshot to somebody who has just signed in as someone else.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/static/admin/")) return;
  if (req.mode === "navigate") {
    // network first, fall back to the cached shell so the app opens offline
    e.respondWith(fetch(req).then((res) => { caches.open(VERSION).then((c) => c.put("/index.html", res.clone())); return res; }).catch(() => caches.match("/index.html")));
    return;
  }
  // assets: stale-while-revalidate
  e.respondWith(caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => cached);
    return cached || net;
  }));
});
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });
