// KaijiBot Control UI — App Shell Service Worker
// Strategy: cache static assets (cache-first), network-first for navigations
// with cached index.html fallback. API and websocket requests are never intercepted.

const CACHE_VERSION = "kaijibot-shell-v1";
const APP_SHELL = ["./", "./manifest.webmanifest"];

// --- Install: precache minimal shell ---
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

// --- Activate: purge old caches, claim clients ---
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// --- Fetch: smart routing ---
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET from same origin
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Skip cross-origin
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip API, avatar, and websocket upgrades — let the app handle these
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/avatar/") ||
    url.pathname.startsWith("/__kaijibot/") ||
    request.headers.get("upgrade") === "websocket"
  ) {
    return;
  }

  // Navigations: network-first, fall back to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./")),
    );
    return;
  }

  // Static assets: cache-first, populate cache on miss
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        }),
    ),
  );
});
