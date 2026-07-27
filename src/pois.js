/* ============================================================================
   POI-bron. Beslissing 6b: de punten komen uit de vectortiles die we voor de
   kaart toch al ophalen, met Overpass alleen als aanvulling voor de twee
   categorieën die niet in de tiles zitten.

   De categorieën en hun tags komen uit de meting in spike/BEVINDINGEN.md —
   niet uit gokwerk over wat OSM zou kunnen hebben.
   ============================================================================ */

import { distM, midpointOf } from './geo.js';
import { harvestStyle } from './map-style.js';

const SOURCE = 'openmaptiles';
const Z = 14;                     // de poi-laag in het OpenMapTiles-schema begint hier
const HARVEST_PX = 1400;          // canvas van de oogster; op z14 ≈ 8,2 km breed

/* ── Categorieën ──────────────────────────────────────────────────────────── */

export const CATEGORIES = [
  {
    key: 'speeltuin', label: 'Speeltuin', icon: 'toys', from: 'tiles',
    layers: ['poi'], test: (p) => p.subclass === 'playground',
  },
  {
    key: 'brug', label: 'Bruggetje', icon: 'water', from: 'tiles',
    layers: ['transportation'],
    test: (p) => p.brunnel === 'bridge' && ['path', 'track', 'bridge'].includes(p.class),
  },
  {
    key: 'pauze', label: 'Pauzeplek', icon: 'local_cafe', from: 'tiles',
    layers: ['poi'],
    test: (p) => ['cafe', 'restaurant', 'fast_food', 'bakery', 'bar', 'ice_cream'].includes(p.class),
  },
  {
    key: 'sportveld', label: 'Sportveld', icon: 'sports_soccer', from: 'tiles',
    layers: ['poi'], test: (p) => p.class === 'pitch',
  },
  {
    key: 'knooppunt', label: 'Wandelknooppunt', icon: 'signpost', from: 'tiles',
    layers: ['poi'], test: (p) => p.class === 'information',
  },
  {
    key: 'schuilhut', label: 'Schuilhut', icon: 'cabin', from: 'tiles',
    layers: ['poi'], test: (p) => p.subclass === 'shelter',
  },
  // Niet aanwezig in de tiles — zie BEVINDINGEN.md. Deze twee komen van
  // Overpass en kunnen dus ontbreken als die eruit ligt.
  {
    key: 'picknick', label: 'Picknicktafel', icon: 'table_restaurant', from: 'overpass',
    overpass: '[leisure=picnic_table]',
  },
  {
    key: 'uitkijk', label: 'Uitkijkpunt', icon: 'landscape', from: 'overpass',
    overpass: '[tourism=viewpoint]',
  },
  // Alleen beschikbaar als er een opencaching.nl-sleutel is ingevuld; zie
  // src/okapi.js. Zonder sleutel wordt deze categorie niet aangeboden.
  {
    key: 'cache', label: 'Geocache', icon: 'travel_explore', from: 'okapi',
  },
];

export const categoryByKey = (key) => CATEGORIES.find((c) => c.key === key);

/* ── Oogster ──────────────────────────────────────────────────────────────
   Een eigen, onzichtbare kaartinstantie. De zichtbare kaart mag niet
   verspringen tijdens het zoeken, en tegels laden alleen voor het canvas —
   vandaar een tweede instantie buiten het beeld met een groot canvas.
   ───────────────────────────────────────────────────────────────────────── */

export function createHarvester(maplibregl) {
  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:-20000px;top:0;width:${HARVEST_PX}px;height:${HARVEST_PX}px;` +
    `pointer-events:none;visibility:hidden;`;
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  // Eigen stijl, niet die van de app: zie harvestStyle() voor waarom dat moet.
  const map = new maplibregl.Map({
    container: host, style: harvestStyle(), center: [5.3, 52.1], zoom: Z,
    attributionControl: false, interactive: false, fadeDuration: 0,
  });

  /* Met timeout. Zonder wacht `collect()` oneindig als 'idle' nooit komt — dat
   * gebeurt bijvoorbeeld als de browser geen WebGL-context meer wil geven, en
   * dan hangt het zoeken zonder foutmelding. Liever een magere oogst dan een
   * app die blijft draaien terwijl je op een parkeerplaats staat. */
  const firstIdle = once(map, 'idle', 15000);

  return {
    /** Alle POI's van de gevraagde categorieën binnen radiusM. */
    async collect({ lat, lon, radiusM, keys }) {
      await firstIdle;
      const cats = CATEGORIES.filter((c) => c.from === 'tiles' && keys.includes(c.key));
      if (!cats.length) return [];

      const layers = [...new Set(cats.flatMap((c) => c.layers))];
      const found = new Map();

      for (const centre of viewportGrid([lon, lat], radiusM)) {
        map.jumpTo({ center: centre, zoom: Z });
        await settle(map);

        for (const layer of layers) {
          let feats;
          try { feats = map.querySourceFeatures(SOURCE, { sourceLayer: layer }); }
          catch { continue; }

          for (const f of feats) {
            if (!f.geometry) continue;
            const props = f.properties || {};
            const cat = cats.find((c) => c.layers.includes(layer) && c.test(props));
            if (!cat) continue;

            const coord = midpointOf(f.geometry);
            const d = distM([lon, lat], coord);
            if (d > radiusM) continue;

            // Dedup over tegelgrenzen: dezelfde brug kan in twee tegels zitten.
            const key = `${cat.key}|${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;
            if (!found.has(key)) {
              found.set(key, {
                category: cat.key, label: props.name || cat.label,
                name: props.name || null, icon: cat.icon, coord, distFromStart: d,
              });
            }
          }
        }
      }
      return [...found.values()];
    },

    destroy() { map.remove(); host.remove(); },
  };
}

/** Middens van de viewports die samen de schijf dekken. In de praktijk één,
 *  want een canvas van 1400 px op z14 is ~8 km breed en de zoekradius blijft
 *  onder de 4 km. Het rooster is de vangrail, niet het normale geval. */
function viewportGrid([lon, lat], radiusM) {
  const mPerPx = 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** Z);
  const canvasM = HARVEST_PX * mPerPx * 0.9;      // 10% marge tegen randeffecten
  const spanM = radiusM * 2;
  const n = Math.max(1, Math.ceil(spanM / canvasM));
  if (n === 1) return [[lon, lat]];

  const step = spanM / n;
  const out = [];
  const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push([
        lon + ((i + 0.5) * step - spanM / 2) / mPerDegLon,
        lat + ((j + 0.5) * step - spanM / 2) / mPerDegLat,
      ]);
    }
  }
  return out;
}

function once(map, event, timeoutMs) {
  return new Promise((res) => {
    let done = false;
    const fire = () => { if (!done) { done = true; res(); } };
    map.once(event, fire);
    if (timeoutMs) setTimeout(fire, timeoutMs);
  });
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wacht tot de tegels voor de huidige viewport er écht zijn.
 *
 * Niet op 'idle' vertrouwen: direct na een jumpTo kan dat event vuren vóórdat
 * MapLibre de nieuwe tegels heeft aangevraagd, en dan query je een lege cache.
 * Gemeten gevolg: 4 punten in plaats van 29. Daarom een minimale wachttijd om
 * het laden te laten beginnen, en daarna twee opeenvolgende bevestigingen van
 * areTilesLoaded() voordat we het geloven.
 */
async function settle(map, { minMs = 220, timeoutMs = 12000 } = {}) {
  const t0 = performance.now();
  await sleep(minMs);
  while (performance.now() - t0 < timeoutMs) {
    if (map.loaded() && map.areTilesLoaded()) {
      await frame();
      if (map.areTilesLoaded()) return true;
    }
    await sleep(60);
  }
  return false;
}

/* ── Overpass-aanvulling ──────────────────────────────────────────────────
   Uitdrukkelijk optioneel. Overpass lag tijdens het bouwen herhaaldelijk
   plat; een route met vijf van de zes soorten is beter dan geen route.
   ───────────────────────────────────────────────────────────────────────── */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export async function supplementFromOverpass({ lat, lon, radiusM, keys, timeoutMs = 8000 }) {
  const cats = CATEGORIES.filter((c) => c.from === 'overpass' && keys.includes(c.key));
  if (!cats.length) return { pois: [], failed: [] };

  const parts = cats.map((c, i) =>
    `nwr(around:${Math.round(radiusM)},${lat},${lon})${c.overpass}->.s${i}; .s${i} out center;`);
  const query = `[out:json][timeout:${Math.round(timeoutMs / 1000)}];${parts.join('')}`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(endpoint, {
        method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json();

      // Overpass geeft geen categorie per element terug, dus leiden we die af
      // uit de tags — dezelfde tags die we in de query hebben gezet.
      const pois = [];
      for (const el of json.elements || []) {
        const t = el.tags || {};
        const cat = cats.find((c) =>
          (c.key === 'picknick' && t.leisure === 'picnic_table') ||
          (c.key === 'uitkijk' && t.tourism === 'viewpoint'));
        if (!cat) continue;
        const coord = el.center ? [el.center.lon, el.center.lat] : [el.lon, el.lat];
        if (!Number.isFinite(coord[0])) continue;
        pois.push({
          category: cat.key, label: t.name || cat.label, name: t.name || null,
          icon: cat.icon, coord, distFromStart: distM([lon, lat], coord),
        });
      }
      return { pois, failed: [] };
    } catch { /* volgende endpoint */ }
  }
  return { pois: [], failed: cats.map((c) => c.key) };
}
