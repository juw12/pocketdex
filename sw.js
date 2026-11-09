/* PocketDex offline cache: core files up front, sprites cached on first view. */
const CACHE = "pocketdex-v10";
const CORE = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "meadow.js",
  "data.js",
  "vendor/three.min.js",
  "fonts/fonts.css",
  "fonts/silkscreen-400.woff2",
  "manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((response) => {
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => offlineFallback(event.request));
    })
  );
});

// A 1x1 transparent PNG, so a sprite that cannot be fetched (offline, aborted) degrades quietly.
const BLANK_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0)
);

function offlineFallback(request) {
  if (request.mode === "navigate") return caches.match("index.html");
  if (request.destination === "image") {
    return new Response(BLANK_PNG, { headers: { "Content-Type": "image/png" } });
  }
  return new Response("", { status: 503, statusText: "Offline" });
}

// Tapping the focus notice brings the app back to the battle.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "#/focus", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.startsWith(self.registration.scope));
      if (open) {
        open.navigate(target).catch(() => {});
        return open.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
