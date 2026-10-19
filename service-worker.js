const CACHE_NAME = 'family-prime-v6';
const urlsToCache = [
  './',
  './index.html',
  './deployment-config.js',
  './styles.css',
  './app.js',
  './family-features.js',
  './lib/calendarDates.js',
  './lib/sortingPreferences.js',
  './manifest.json',
  './image/icon-192.png',
  './image/icon-512.png',
  './image/icon-maskable-192.png',
  './image/icon-maskable-512.png'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache).catch(err => {
          console.log('Cache addAll error (some files might not be available yet):', err);
          // Continue even if some files fail to cache
          return Promise.resolve();
        });
      })
  );
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Serve cached app resources immediately and refresh them in the background.
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // API and third-party requests must never be cached by the app shell.
  if (requestUrl.origin !== self.location.origin ||
      requestUrl.pathname.startsWith('/api/') ||
      event.request.url.includes('firebaseapp.com') ||
      event.request.url.includes('googleapis.com') ||
      event.request.method !== 'GET') {
    return;
  }

  const cachedResponse = caches.match(event.request);
  const networkUpdate = fetch(event.request)
    .then(response => {
      if (response.ok) {
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, response.clone()))
          .then(() => response);
      }
      return response;
    });

  event.respondWith((async () => {
    const cached = await cachedResponse;
    if (cached) return cached;

    try {
      return await networkUpdate;
    } catch {
      return (await caches.match('./index.html')) || Response.error();
    }
  })());

  event.waitUntil(networkUpdate.catch(() => {}));
});
