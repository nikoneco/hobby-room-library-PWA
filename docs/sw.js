const CACHE_NAME = 'shumi-library-pwa-v41';
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/css/style.legacy-core.css',
  './assets/css/style.legacy-modal.css',
  './assets/css/style.shelf.css',
  './assets/css/style.modern-core.css',
  './assets/css/style.modern-modal.css',
  './assets/css/style.modern-shelf.css',
  './assets/css/style.responsive.css',
  './assets/css/pwa.css',
  './assets/logo.png',
  './assets/js/gas-run-shim.js',
  './assets/js/pwa-client.js',
  './assets/js/script.state.js',
  './assets/js/script.images.js',
  './assets/js/script.search.js',
  './assets/js/script.render.js',
  './assets/js/script.shelf.js',
  './assets/js/script.modal.js',
  './assets/js/script.boot.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

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
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./offline.html'))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('./offline.html')))
  );
});
