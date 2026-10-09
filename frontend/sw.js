// Service Worker for ShelfScanner PWA
const CACHE_NAME = "shelfscanner-v4";
const STATIC_ASSETS = [
  "/",
  "/static/styles.css?v=4",
  "/static/app.js?v=4",
  "/static/supabase.min.js",
  "/favicon.svg",
  "/manifest.json",
  "/static/demo_data.json",
  "/static/demo_shelf.jpg"
];

// Install: pre-cache application shell
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate: purge stale cache versions immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Deleting stale cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for all assets to prevent stale code, falling back to cache if offline
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker cache for all API routes and uploads
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Network-first strategy
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
