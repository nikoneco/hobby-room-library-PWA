const CACHE_NAME = "shumi-library-pwa-6490a343b0a0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./assets/css/style.legacy-core.css",
  "./assets/css/style.legacy-modal.css",
  "./assets/css/style.shelf.css",
  "./assets/css/style.modern-core.css",
  "./assets/css/style.modern-modal.css",
  "./assets/css/style.modern-shelf.css",
  "./assets/css/style.responsive.css",
  "./assets/css/pwa.css",
  "./assets/logo.png",
  "./assets/librarian-presence.jpg",
  "./assets/splash-lantern.jpg",
  "./assets/js/gas-run-shim.js",
  "./assets/js/pwa-client.js",
  "./assets/js/script.state.f46d41ac80.js",
  "./assets/js/script.images.6313de0b04.js",
  "./assets/js/script.search.4e2e3ec18b.js",
  "./assets/js/script.render.921eff7a34.js",
  "./assets/js/script.shelf.598dbdb6f7.js",
  "./assets/js/script.modal.5838231893.js",
  "./assets/js/script.boot.48b572d29e.js",
  "./assets/icons/icon-lantern-192.png",
  "./assets/icons/icon-lantern-512.png",
  "./assets/icons/apple-touch-icon-lantern-180.png"
];
const NAVIGATION_FALLBACK = './index.html';
const OFFLINE_FALLBACK = './offline.html';
const APP_SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.location.href).href));

function getCacheKey_(url) {
  const copy = new URL(url.href);
  copy.search = '';
  copy.hash = '';
  return copy.href;
}

function isAppShellUrl_(url) {
  return APP_SHELL_URLS.has(getCacheKey_(url));
}

function putCache_(cacheKey, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    const cacheKey = new URL(NAVIGATION_FALLBACK, self.location.href).href;
    event.respondWith(
      caches.match(cacheKey).then(cached => {
        const refresh = fetch(request)
          .then(response => putCache_(cacheKey, response))
          .catch(() => null);
        return cached || refresh.then(response => response || caches.match(OFFLINE_FALLBACK));
      })
    );
    return;
  }

  if (isAppShellUrl_(url)) {
    const cacheKey = getCacheKey_(url);
    event.respondWith(
      caches.match(cacheKey).then(cached => {
        const refresh = fetch(request)
          .then(response => putCache_(cacheKey, response))
          .catch(() => null);
        return cached || refresh.then(response => response || caches.match(OFFLINE_FALLBACK));
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => putCache_(getCacheKey_(url), response))
      .catch(() => caches.match(getCacheKey_(url)).then(cached => cached || caches.match(OFFLINE_FALLBACK)))
  );
});
