const CACHE_NAME = 'smsweb-v10';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './vendor/maplibre/maplibre-gl.css',
  './vendor/maplibre/maplibre-gl.js',
  './vendor/pmtiles/pmtiles.js',
  './vendor/protomaps/basemaps.js',
  './vendor/sprites/v4/light.json',
  './vendor/sprites/v4/light.png',
  './vendor/sprites/v4/light@2x.json',
  './vendor/sprites/v4/light@2x.png',
  './vendor/fonts/Noto Sans Regular/0-255.pbf',
  './vendor/fonts/Noto Sans Regular/256-511.pbf',
  './vendor/fonts/Noto Sans Regular/2304-2559.pbf',
  './vendor/fonts/Noto Sans Regular/8192-8447.pbf',
  './vendor/fonts/Noto Sans Medium/0-255.pbf',
  './vendor/fonts/Noto Sans Medium/256-511.pbf',
  './vendor/fonts/Noto Sans Medium/2304-2559.pbf',
  './vendor/fonts/Noto Sans Medium/8192-8447.pbf',
  './vendor/fonts/Noto Sans Italic/0-255.pbf',
  './vendor/fonts/Noto Sans Italic/256-511.pbf',
  './vendor/fonts/Noto Sans Italic/8192-8447.pbf',
  './data/dhaka.pmtiles',
  './app.js',
  './protocol.js',
  './storage.js',
  './multipart.js',
  './geo.js',
  './routing.js',
  './data/mirpur-road-graph.js',
  './map.js',
  './renderer.js',
  './navigation.js',
  './simulator.js',
  './gateway.js',
  './sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => cachedResponse || fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok && new URL(event.request.url).origin === self.location.origin) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }

        return networkResponse;
      }))
      .catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }

        return Response.error();
      })
  );
});
