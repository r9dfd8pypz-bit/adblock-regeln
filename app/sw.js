// Offline-Speicher: Mit Internet kommt immer die neueste Version vom Server.
// Ohne Internet (oder wenn der Server nicht schnell antwortet) öffnet sich die gespeicherte
// Version, damit „Alles sofort stoppen“ auch dann erreichbar ist.
const CACHE = 'werbefrei-v17';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den Browser-Zwischenspeicher, damit wirklich die neuen Dateien landen.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eigene Dateien: zuerst frisch vom Server (mit Rückfrage, ob sich etwas geändert hat),
// bei Fehler oder Zeitüberschreitung aus dem Speicher. Anfragen an Surge und NextDNS
// werden nicht angefasst.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNetwork = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([fromNetwork, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || fromNetwork;
  })());
});
