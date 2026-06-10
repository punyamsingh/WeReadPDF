/* WeReadPDF service worker — offline-first app shell.
 *
 * Strategy:
 * - Navigations: network-first so deploys land immediately, falling back to
 *   the cached shell ("/") when offline. Books live in IndexedDB, so the
 *   cached shell is everything the reader needs to open them with no network.
 * - Same-origin static assets (hashed filenames): cache-first — immutable.
 *   This covers the app bundle and the pdf.js worker chunk.
 * - Known CDNs (Google Fonts, OpenDyslexic, tesseract wasm/lang data):
 *   stale-while-revalidate, so fonts and OCR keep working offline after
 *   first use.
 *
 * Bump VERSION to invalidate old caches on deploy.
 */
const VERSION = "v1";
const SHELL_CACHE = `wereadpdf-shell-${VERSION}`;
const RUNTIME_CACHE = `wereadpdf-runtime-${VERSION}`;

const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

const CDN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "tessdata.projectnaptha.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("wereadpdf-") && !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // App navigations: network-first, offline falls back to the cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches
              .open(SHELL_CACHE)
              .then((c) => c.put("/", copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match("/", { cacheName: SHELL_CACHE }).then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  const isStaticDest = ["script", "style", "font", "image", "worker"].includes(req.destination);

  // Same-origin static assets: cache-first (hashed, immutable filenames).
  if (url.origin === self.location.origin && (isStaticDest || url.pathname.includes("/assets/"))) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(RUNTIME_CACHE)
                .then((c) => c.put(req, copy))
                .catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Fonts + OCR data from known CDNs: stale-while-revalidate.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok || res.type === "opaque") {
              cache.put(req, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => undefined);
        if (hit) {
          event.waitUntil(refresh.then(() => {}));
          return hit;
        }
        return refresh.then((res) => res || Response.error());
      }),
    );
  }
});
