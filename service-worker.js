const CACHE_NAME = 'vectorama-version-0.1.48';
const LOCAL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/images/vectoramaLogo.png',
  '/images/panelLogo.png',
  '/images/icon-180.png',
  '/images/icon-192.png',
  '/images/icon-512.png'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js'
];

async function cacheFirstWithBackgroundRefresh(request, options = {}) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, options);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return { response: cached, background: networkPromise };
  }

  const networkResponse = await networkPromise;
  if (networkResponse) {
    return { response: networkResponse, background: null };
  }

  return { response: null, background: null };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Local shell is mandatory so launch is fast even with poor connectivity.
    await cache.addAll(LOCAL_ASSETS);

    // External CDN files are best-effort: don't block install when network is weak.
    await Promise.allSettled(CDN_ASSETS.map((url) => cache.add(url)));
  })());

  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate';
  const isStaticAsset = ['script', 'style', 'image', 'font'].includes(request.destination);
  const isJsDelivr = url.origin === 'https://cdn.jsdelivr.net';

  // Fast startup path: never wait on weak network for app shell navigation.
  if (isNavigation) {
    event.respondWith((async () => {
      const { response, background } = await cacheFirstWithBackgroundRefresh('/index.html', { ignoreSearch: true });
      if (background) {
        event.waitUntil(background);
      }

      if (response) {
        return response;
      }

      return fetch(request);
    })());

    return;
  }

  // Cache-first for local static files and CDN modules, then refresh in background.
  if ((isSameOrigin && isStaticAsset) || isJsDelivr) {
    event.respondWith((async () => {
      const { response, background } = await cacheFirstWithBackgroundRefresh(request, { ignoreSearch: true });
      if (background) {
        event.waitUntil(background);
      }

      if (response) {
        return response;
      }

      return fetch(request);
    })());

    return;
  }

  // Default behavior for other GET requests: network first with cache fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && isSameOrigin) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }

        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    );
  })());

  self.clients.claim();
});
