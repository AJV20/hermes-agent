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

function stripScope(pathname) {
  if (SCOPE_PATH && SCOPE_PATH !== "/" && pathname.startsWith(`${SCOPE_PATH}/`)) {
    return pathname.slice(SCOPE_PATH.length) || "/";
  }
  return pathname;
}

self.addEventListener("install", () => {
  self.skipWaiting();
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
  const pathname = stripScope(url.pathname);
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
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
  // HTML and handles WS ticket/token auth live.
  if (request.mode === "navigate" || !isStaticAsset(request, url)) {
    return;
  }

  event.respondWith(
    caches.open(HERMES_PWA_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
