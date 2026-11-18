/**
 * Service worker — REVISION-21 Q6 + REVISION-22 A7:
 * - caché de confirmación de reserva (QR)
 * - caché da pantalla de conserxaría + API do día
 * - fallback offline (páxina cos QR gardados)
 */
const CACHE = "pa-pwa-v3";
const PRECACHE = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"];

const BOOKING_API = /^\/api\/c\/[^/]+\/reservas\/[^/?#]+$/;
const CONSERXERIA_API = /^\/api\/c\/[^/]+\/conserxeria\/dia\/?$/;
const CONSERXERIA = /^\/c\/[^/]+\/conserxeria\/?$/;
const OFFLINE_SPA = /^\/c\/[^/]+\/offline\/?$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isNavigation(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept") &&
      request.headers.get("accept").includes("text/html"))
  );
}

function networkFirstCache(event) {
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  /* API de reserva: network-first + caché (QR offline). */
  if (BOOKING_API.test(url.pathname)) {
    networkFirstCache(event);
    return;
  }

  /* REVISION-22 A7 — API conserxaría/día (últimas reservas offline). */
  if (CONSERXERIA_API.test(url.pathname)) {
    networkFirstCache(event);
    return;
  }

  /* Conserxaría + páxina offline SPA: network-first, garda shell. */
  if (CONSERXERIA.test(url.pathname) || OFFLINE_SPA.test(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const shell = await caches.match("/");
          if (shell) return shell;
          return caches.match("/offline.html");
        }),
    );
    return;
  }

  /* Navegación xeral: se falla a rede, offline.html cos QR. */
  if (isNavigation(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && (CONSERXERIA.test(url.pathname) || OFFLINE_SPA.test(url.pathname))) {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return (
            (await caches.match("/offline.html")) ||
            new Response("Sen conexión", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
  }
});
