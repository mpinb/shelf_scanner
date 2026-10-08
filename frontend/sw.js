// Service Worker for ShelfScanner PWA
const CACHE_NAME = "shelfscanner-v1";
const STATIC_ASSETS = [
  "/",
  "/static/styles.css",
  "/static/app.js",
  "/static/supabase.min.js",
  "/favicon.svg",
  "/manifest.json",
  "/static/demo_data.json",
  "/static/demo_shelf.jpg"
];

// Install: pre-cache application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: purge stale cache versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for /api/, cache-first/stale-while-revalidate for static assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker cache for all API routes and uploads
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Handle static assets & navigation
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Fetch from network in parallel to keep cache fresh
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If offline and requesting navigation, return cached root
        if (event.request.mode === "navigate") {
          return caches.match("/");
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});
