/* global self, caches, fetch, URL */
/* Feronavi PWA service worker：只缓存静态壳；API/SSE/SCIM/MCP 一律不缓存。 */
const CACHE = "feronavi-shell-v1";
const SHELL = ["/", "/offline.html", "/site.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/scim/") || url.pathname.startsWith("/mcp")) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html").then((r) => r || caches.match("/"))));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    }));
  }
});
