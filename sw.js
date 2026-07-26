/* ============================================================================
   Service worker — de app-shell offline.

   Bewust beperkt: dit cachet de eigen bestanden en de twee CDN-bibliotheken,
   zodat de app opent zonder bereik. Kaarttegels en routes zitten hier nog
   níet in — dat is het aparte offline-werk (de tegels van de gekozen route vóór
   vertrek binnenhalen).

   Strategie voor eigen bestanden: uit de cache serveren en ondertussen
   vernieuwen. Dat maakt de app snel, en na een deploy zie je de nieuwe versie
   bij de tweede keer openen. Dus als je iets pusht en het lijkt oud: nog een
   keer openen.
   ============================================================================ */

const VERSION = 'stapper-v1';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'src/geo.js',
  'src/pois.js',
  'src/router.js',
  'src/generator.js',
  'src/map-style.js',
  'src/mapview.js',
  'src/geolocate.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

/* Versievaste bibliotheken van de CDN: die veranderen niet, dus cache-first. */
const VENDOR = [
  'https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individueel toevoegen: één mislukte URL mag niet de hele installatie
    // laten falen, want dan werkt de app helemaal niet offline.
    await Promise.all([...SHELL, ...VENDOR].map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch { /* laat maar */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  const vendor = VENDOR.includes(req.url) ||
                 url.hostname === 'fonts.googleapis.com' ||
                 url.hostname === 'fonts.gstatic.com';

  if (own) { event.respondWith(staleWhileRevalidate(req)); return; }
  if (vendor) { event.respondWith(cacheFirst(req)); return; }

  // Tegels, BRouter, Overpass: altijd het netwerk. Cachen daarvan is het
  // offline-werk dat nog moet gebeuren, en half doen is erger dan niet doen.
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });

  const fresh = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  if (hit) return hit;
  const res = await fresh;
  if (res) return res;
  // Navigatie zonder cache en zonder net: val terug op de shell.
  if (req.mode === 'navigate') {
    const shell = await cache.match('index.html');
    if (shell) return shell;
  }
  return new Response('offline', { status: 503, statusText: 'offline' });
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
