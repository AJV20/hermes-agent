const HERMES_DEPLOY_REVISION = "__HERMES_DEPLOY_REVISION__";
const HERMES_PWA_URL_REVISION = new URL(self.location.href).searchParams.get("v") ?? "app";
const HERMES_PWA_CACHE = `hermes-dashboard-static-${HERMES_DEPLOY_REVISION}-${HERMES_PWA_URL_REVISION}`;
const STATIC_PATH_PREFIXES = [
  "/assets/",
  "/fonts/",
  "/fonts-terminal/",
  "/ds-assets/",
];
const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style"]);
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const HERMES_OFFLINE_URL = new URL("offline.html", self.registration.scope).toString();

function stripScope(pathname) {
  if (SCOPE_PATH && SCOPE_PATH !== "/" && pathname.startsWith(`${SCOPE_PATH}/`)) {
    return pathname.slice(SCOPE_PATH.length) || "/";
  }
  return pathname;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(HERMES_PWA_CACHE).then(async (cache) => {
      await cache.add(HERMES_OFFLINE_URL);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const previous = keys.filter(
        (key) => key.startsWith("hermes-dashboard-static-") && key !== HERMES_PWA_CACHE,
      );
      await Promise.all(previous.map((key) => caches.delete(key)));
      await caches.open(HERMES_PWA_CACHE);
      await self.clients.claim();
      if (previous.length > 0) {
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.all(clients.map((client) => client.navigate(client.url)));
      }
    })(),
  );
});

function isStaticAsset(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (request.destination === "document") return false;
  if (request.headers.get("accept")?.includes("text/html")) return false;
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return false;
  const pathname = stripScope(url.pathname);
  if (pathname === "/" || pathname === "/index.html") return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return false;
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/favicon.ico") return true;
  return (
    STATIC_DESTINATIONS.has(request.destination) ||
    STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache navigations, dashboard HTML, auth endpoints, API traffic, or
  // WebSocket upgrades. The backend injects fresh auth bootstrap state into
  // HTML and handles WS ticket/token auth live. A failed navigation receives
  // only the static credential-free offline document cached during install.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(HERMES_PWA_CACHE);
      return (await cache.match(HERMES_OFFLINE_URL)) ?? Response.error();
    }));
    return;
  }

  if (!isStaticAsset(request, url)) {
    return;
  }

  event.respondWith(
    caches.open(HERMES_PWA_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
