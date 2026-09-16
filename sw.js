const XO_CACHE = "xo-pickleball-shell-v1";
const XO_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/config.js",
  "/auth-config.js",
  "/pwa.css",
  "/pwa.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(XO_CACHE)
      .then((cache) => cache.addAll(XO_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("xo-pickleball-") && key !== XO_CACHE)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache Supabase, Turnstile, CDN, or other third-party traffic.
  if (url.origin !== self.location.origin) return;

  // Navigation: network first, app shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(XO_CACHE).then((cache) => cache.put("/index.html", copy));
          return res;
        })
        .catch(async () => {
          return (await caches.match("/index.html")) || (await caches.match("/"));
        })
    );
    return;
  }

  // Same-origin static assets: network first so updates arrive quickly,
  // cache fallback so the installed app still opens offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(XO_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
