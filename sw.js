// Network-first with cache fallback: always fresh online, still works offline.

const CACHE = 'maksim-v30';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/parse.js',
  '/keepawake.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(ASSETS);
    // Workout files are discovered from the manifest, so adding a workout
    // never needs an edit here — just bump CACHE as usual.
    try {
      const files = await (await fetch('/workouts/index.json')).json();
      await c.addAll(['/workouts/index.json', ...files.map((f) => `/workouts/${f}`)]);
    } catch (_) { /* offline install: runtime caching picks them up later */ }
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
