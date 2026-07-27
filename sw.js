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

const VERSION = 'stapper-v3';

/* Losse cache, gevuld door src/offline.js wanneer je een route offline meeneemt.
 * Apart gehouden zodat het opruimen van een appversie je gedownloade tegels niet
 * meeneemt — die zijn duur om opnieuw op te halen en jij staat dan misschien al
 * in het bos. */
const TILE_CACHE = 'stapper-tiles';
const TILE_HOST = 'tiles.openfreemap.org';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  /* Alle modules, niet alleen die van het eerste scherm: stale-while-revalidate
     vult de rest pas ná een online bezoek, en dan sta je al in het bos. */
  'src/geo.js',
  'src/pois.js',
  'src/router.js',
  'src/generator.js',
  'src/map-style.js',
  'src/mapview.js',
  'src/geolocate.js',
  'src/edit.js',
  'src/edit-map.js',
  'src/tracking.js',
  'src/compass.js',
  'src/simulate.js',
  'src/store.js',
  'src/offline.js',
  'src/okapi.js',
  'src/geocode.js',
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
    await Promise.all(names
      .filter((n) => n !== VERSION && n !== TILE_CACHE)
      .map((n) => caches.delete(n)));
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

  // Kaarttegels, letters en TileJSON: eerst uit de offline-cache. Wat je vóór
  // vertrek hebt gedownload werkt dan zonder bereik; de rest gaat naar het
  // netwerk en wordt níet stilletjes bijgecached — anders zou je denken dat een
  // route offline klaarstaat omdat je hem toevallig een keer bekeken hebt.
  if (url.hostname === TILE_HOST) { event.respondWith(tileFirst(req)); return; }

  // BRouter en Overpass: altijd het netwerk. Een route bereken je thuis.
});

async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch {
    // Geen bereik en niet gedownload. 204 in plaats van een fout: MapLibre
    // tekent dan een lege tegel in plaats van de kaart te laten struikelen.
    return new Response(null, { status: 204 });
  }
}

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
