// IMPOSTERVERSE LIVE service worker.
// Keeps a copy of the app shell so pass-the-phone mode works with no connection
// once the app has been opened. Never caches the game socket, the API, or media.
const CACHE = 'ivl-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/favicon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// The page tells us what it loaded before we took control, so we can cache that too.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm') return;
  const urls = (event.data.urls || []).filter((u) => {
    try {
      const url = new URL(u, self.location.origin);
      return url.origin === self.location.origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/models/') && !url.pathname.startsWith('/mediapipe/');
    } catch {
      return false;
    }
  });
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  // Page loads: network first so updates arrive, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Everything else: cache first (build assets are content-hashed), filling the cache as we go.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
