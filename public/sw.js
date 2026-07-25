// YHC-OS service worker — caches static assets only (JS/CSS/icons).
// Deliberately does NOT cache API calls, Supabase requests, or HTML pages,
// so patient data is always fresh and never served stale offline.

const CACHE_NAME = "yhc-os-shell-v1";
const SHELL_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (/\.(js|css|png|jpg|jpeg|svg|woff2?|ico)$/.test(url.pathname) || url.pathname.startsWith("/assets/"))
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only ever touch same-origin static assets. Everything else (pages,
  // Supabase/API calls, cross-origin requests) goes straight to the network.
  if (event.request.method !== "GET" || !isStaticAsset(url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => cached);
    }),
  );
});
