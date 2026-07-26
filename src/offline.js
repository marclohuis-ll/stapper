/* ============================================================================
   Kaart offline meenemen.

   Beslissing 10, herzien: geen vast gebied vooruit downloaden, maar de tegels
   voor de corridor van de gekozen route — vóór vertrek, op de wifi. Dat werkt
   overal en is een fractie van een provincie-extract.

   Alleen de tegels die de route daadwerkelijk raakt, plus één ring eromheen.
   De bounding box nemen zou bij een lange lus tien keer zo veel tegels opleveren
   waarvan je het merendeel nooit ziet.
   ============================================================================ */

const TILE_HOST = 'tiles.openfreemap.org';
export const TILE_CACHE = 'stapper-tiles';

/* De zooms waar je onderweg naar kijkt. Onder 12 heb je geen detail nodig, boven
 * 16 kijk je niet als je loopt. */
const ZOOMS = [12, 13, 14, 15, 16];

const rad = (d) => d * Math.PI / 180;
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor(
  (1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * 2 ** z);

/** Tegels die de route raakt, plus een ring eromheen zodat je bij de rand van
 *  het beeld niet in het niets kijkt. */
export function tilesForRoute(coords, { zooms = ZOOMS, ring = 1 } = {}) {
  const out = [];
  for (const z of zooms) {
    const seen = new Set();
    const max = 2 ** z - 1;
    for (const [lon, lat] of coords) {
      const cx = lon2x(lon, z), cy = lat2y(lat, z);
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x > max || y > max) continue;
          const key = `${x}/${y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ z, x, y });
        }
      }
    }
  }
  return out;
}

const tileUrl = ({ z, x, y }) => `https://${TILE_HOST}/planet/${z}/${x}/${y}.pbf`;

/* Naast de tegels heeft de kaart de TileJSON en de letters nodig. Zonder de
 * glyphs staat er offline geen enkel label op de kaart. */
const SUPPORT_URLS = [
  `https://${TILE_HOST}/planet`,
  ...['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'].flatMap((font) =>
    ['0-255', '256-511'].map((range) =>
      `https://${TILE_HOST}/fonts/${encodeURIComponent(font)}/${range}.pbf`)),
];

/**
 * Haalt alles binnen wat deze route offline nodig heeft.
 * @param {{coords:Array}} route
 * @param {(done:number, total:number) => void} onProgress
 */
export async function downloadRoute(route, onProgress = () => {}) {
  if (!('caches' in window)) throw new Error('Deze browser kan niets offline bewaren.');

  const tiles = tilesForRoute(route.coords);
  const urls = [...SUPPORT_URLS, ...tiles.map(tileUrl)];
  const cache = await caches.open(TILE_CACHE);

  let done = 0, failed = 0;
  onProgress(0, urls.length);

  // Vier tegelijk: genoeg om het snel te houden, weinig genoeg om een gratis
  // publieke tegelserver niet te overvallen.
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const hit = await cache.match(url);
        if (!hit) {
          const res = await fetch(url, { mode: 'cors' });
          // 404 op een tegel is normaal: buiten de dekking bestaat hij niet.
          if (res.ok) await cache.put(url, res.clone());
        }
      } catch { failed++; }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  await markRoute(route, tiles.length);
  return { total: urls.length, failed };
}

/** Hoeveel van deze route al offline staat, als fractie 0–1. */
export async function coverage(route) {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(TILE_CACHE);
  const tiles = tilesForRoute(route.coords);
  if (!tiles.length) return 0;

  // Steekproef in plaats van alles: bij 150 tegels is elke vijfde genoeg om te
  // weten of het er staat, en het scheelt een berg cache-lookups bij elke render.
  const sample = tiles.filter((_, i) => i % 5 === 0);
  let hits = 0;
  for (const t of sample) if (await cache.match(tileUrl(t))) hits++;
  return hits / sample.length;
}

export async function forget(route) {
  if (!('caches' in window)) return;
  const cache = await caches.open(TILE_CACHE);
  for (const t of tilesForRoute(route.coords)) await cache.delete(tileUrl(t));
  const meta = await caches.open(TILE_CACHE);
  await meta.delete(markerUrl(route));
}

/* Een merkteken in dezelfde cache, zodat we weten wát er offline staat zonder
 * een tweede opslagplek te openen. */
const markerUrl = (route) => `https://${TILE_HOST}/__stapper__/${encodeURIComponent(route.id || route.naam)}`;

async function markRoute(route, tileCount) {
  const cache = await caches.open(TILE_CACHE);
  await cache.put(markerUrl(route), new Response(JSON.stringify({
    naam: route.naam, tiles: tileCount, at: Date.now(),
  }), { headers: { 'content-type': 'application/json' } }));
}

/** Ruwe schatting van wat er in de tegelcache zit, in MB. */
export async function cacheSizeMB() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage } = await navigator.storage.estimate();
    return usage ? usage / 1024 / 1024 : null;
  } catch { return null; }
}
