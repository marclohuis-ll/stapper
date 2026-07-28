/* ============================================================================
   Kaartweergave.

   Eén MapLibre-instantie voor de hele app, die tussen schermen verhuisd wordt.
   Per scherm een nieuwe kaart maken kost elke keer een WebGL-context en ~200 ms,
   en drie kaarten naast elkaar (voor de drie resultaatkaartjes) is op een
   telefoon simpelweg te zwaar. Vandaar: de resultaatkaartjes krijgen de échte
   routegeometrie als SVG, en de volwaardige kaart is er waar je hem nodig hebt.
   ============================================================================ */

import { darkStyle, MAP_COLOURS } from './map-style.js';

const SRC = 'stapper-route';

let map = null;
let host = null;
let ready = null;

function ensure(maplibregl) {
  if (map) return ready;

  host = document.createElement('div');
  host.className = 'mapview';
  map = new maplibregl.Map({
    container: host,
    style: darkStyle(),
    center: [5.3, 52.1],
    zoom: 12,
    attributionControl: { compact: true },
  });

  ready = new Promise((res) => map.once('load', () => {
    // lineMetrics is nodig voor line-gradient: zo kunnen we het gelopen deel
    // anders kleuren dan de rest, zoals in het ontwerp.
    map.addSource(SRC, { type: 'geojson', data: empty(), lineMetrics: true });

    map.addLayer({
      id: 'route-shadow', type: 'line', source: SRC,
      filter: ['==', ['get', 'soort'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Donkere baan onder de route. Breed genoeg om de route los te maken van
      // de gestippelde paadjes eronder, die sinds de kaartlabels ook lime zijn.
      paint: { 'line-color': '#0A1512', 'line-width': 13, 'line-opacity': .8 },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: SRC,
      filter: ['==', ['get', 'soort'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Doorlopend en fors: het onderscheid met de gestippelde paadjes zit in
      // breedte en in wel/niet onderbroken, niet in kleur.
      paint: { 'line-width': 6.5, 'line-gradient': gradientFor(null) },
    });
    /* Waar je écht gelopen hebt, uit de GPS. Alleen op de terugblik: tijdens de
     * wandeling zou een tweede lijn naast de route vooral ruis zijn. Muntgroen en
     * dunner, zodat de bedoelde route en de gelopen route naast elkaar te lezen
     * zijn — dat verschil is precies wat een terugblik interessant maakt. */
    map.addLayer({
      id: 'trail-line', type: 'line', source: SRC,
      filter: ['==', ['get', 'soort'], 'trail'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': MAP_COLOURS.mint || '#6FE3D0', 'line-width': 4, 'line-opacity': .95 },
    });
    map.addLayer({
      id: 'route-poi', type: 'circle', source: SRC,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'kind'], 'me']],
      paint: {
        'circle-radius': 7, 'circle-color': '#0C1A17',
        'circle-stroke-color': '#C9F26E', 'circle-stroke-width': 3,
      },
    });
    map.addLayer({
      id: 'route-poi-label', type: 'symbol', source: SRC,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'kind'], 'me']],
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'],
        'text-size': 11.5, 'text-offset': [0, 1.5], 'text-anchor': 'top',
        'text-max-width': 9, 'text-optional': true,
      },
      paint: { 'text-color': '#EAF3EA', 'text-halo-color': '#0A1512', 'text-halo-width': 2 },
    });
    map.addLayer({
      id: 'me-halo', type: 'circle', source: SRC,
      filter: ['==', ['get', 'kind'], 'me'],
      paint: { 'circle-radius': 16, 'circle-color': '#C9F26E', 'circle-opacity': .18 },
    });
    map.addLayer({
      id: 'me', type: 'circle', source: SRC,
      filter: ['==', ['get', 'kind'], 'me'],
      paint: {
        'circle-radius': 7, 'circle-color': '#C9F26E',
        'circle-stroke-color': '#0C1A17', 'circle-stroke-width': 3,
      },
    });
    res();
  }));

  return ready;
}

const empty = () => ({ type: 'FeatureCollection', features: [] });

const WALKED = '#C9F26E';                    // achter je: helder
const AHEAD = 'rgba(234,243,234,.38)';       // voor je: gedempt

/**
 * Verloop met een harde overgang op het punt waar je nu bent. Stops moeten
 * strikt oplopen, dus de knik zit een haartje voorbij de voortgang.
 *
 * `null` betekent: we volgen geen wandeling. Dan is de hele lijn helder — op het
 * detailscherm kijk je naar een route, niet naar je voortgang erin.
 */
function gradientFor(fraction) {
  const flat = (c) => ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c];
  if (fraction == null) return flat(WALKED);

  const f = Math.max(0, Math.min(0.999, fraction));
  if (f <= 0) return flat(AHEAD);
  return ['interpolate', ['linear'], ['line-progress'],
    0, WALKED, f, WALKED, f + 0.001, AHEAD, 1, AHEAD];
}

/** Verhuist de kaart naar dit element. Resize is nodig: MapLibre kent de nieuwe
 *  maat niet uit zichzelf. */
export async function attach(maplibregl, container) {
  await ensure(maplibregl);
  if (host.parentElement !== container) {
    container.appendChild(host);
  }
  map.resize();
  return map;
}

export function detach() {
  if (host && host.parentElement) host.parentElement.removeChild(host);
}

/** Zet route en eigen positie op de kaart. Beide mogen ontbreken. */
export function render({
  route, position, progress = null, fit = true, padding = 40, trail = null,
}) {
  if (!map || !map.getSource(SRC)) return;

  // Gelopen deel helder, de rest gedempt. Op het detailscherm (geen voortgang)
  // is de hele lijn gedempt: je hebt er nog niets van gelopen.
  if (map.getLayer('route-line')) {
    map.setPaintProperty('route-line', 'line-gradient', gradientFor(progress));
  }

  const features = [];
  if (trail && trail.length > 1) {
    features.push({
      type: 'Feature', properties: { soort: 'trail' },
      geometry: { type: 'LineString', coordinates: trail },
    });
  }
  if (route) {
    features.push({
      type: 'Feature', properties: { soort: 'route' },
      geometry: { type: 'LineString', coordinates: route.coords },
    });
    route.pois.forEach((p, i) => features.push({
      type: 'Feature',
      properties: { label: `${i + 1}. ${p.naam}` },
      geometry: { type: 'Point', coordinates: p.coord },
    }));
  }
  if (position) {
    features.push({
      type: 'Feature', properties: { kind: 'me' },
      geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
    });
  }
  map.getSource(SRC).setData({ type: 'FeatureCollection', features });

  if (fit && ((route && route.coords.length) || (trail && trail.length))) {
    // Bedoelde route én gelopen spoor samen in beeld: op de terugblik is een
    // uitstapje buiten de route juist het interessante deel.
    const punten = [...(route ? route.coords : []), ...(trail || [])];
    const b = punten.reduce(
      (acc, c) => [Math.min(acc[0], c[0]), Math.min(acc[1], c[1]),
                   Math.max(acc[2], c[0]), Math.max(acc[3], c[1])],
      [Infinity, Infinity, -Infinity, -Infinity]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, duration: 0 });
  }
}

/** De kaartinstantie, voor controleren en debuggen. */
export const instance = () => map;

/* Tijdens het bewerken tekent edit-map.js zijn eigen lijn en knopen, want die
 * moet per frame kunnen veranderen. Twee lagen over dezelfde geometrie zou een
 * dubbele lijn geven, dus gaat deze even uit. */
const ROUTE_LAGEN = ['route-shadow', 'route-line', 'route-poi', 'route-poi-label'];

export function setRouteVisible(zichtbaar) {
  if (!map) return;
  for (const id of ROUTE_LAGEN) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', zichtbaar ? 'visible' : 'none');
    }
  }
}

export function centreOn(position, zoom = 16) {
  if (!map || !position) return;
  map.jumpTo({ center: [position.lon, position.lat], zoom });
}

/* ── Onderweg: platte kaart of gekantelde kaart ──────────────────────────────
   Twee standen, en het verschil is niet decoratief.

   `plat` is de kaart als overzicht: noord boven, geen kanteling, je ziet de hele
   lus. Goed om te weten waar je bent.

   `schuin` is de kaart als vooruitzicht: gekanteld, en gedraaid naar de kant waar
   je heen loopt, dus wat vóór je op het scherm staat is ook wat vóór je ligt. Dat
   is waar je "welk pad neem ik" mee beantwoordt. Huizen komen dan overeind, want
   zonder hoogte is een gekantelde kaart alleen een uitgerekte platte kaart.
   ───────────────────────────────────────────────────────────────────────────── */

const AANZICHT = {
  plat:   { pitch: 0,  zoom: 16,   koersVolgen: false },
  schuin: { pitch: 58, zoom: 17.2, koersVolgen: true },
};

let aanzicht = 'plat';

export function setAanzicht(soort) {
  aanzicht = AANZICHT[soort] ? soort : 'plat';
  if (!map) return;
  if (map.getLayer('building-3d')) {
    map.setLayoutProperty('building-3d', 'visibility', aanzicht === 'schuin' ? 'visible' : 'none');
  }
  // Terug naar plat betekent ook: noord weer boven. Anders blijf je met een
  // scheve kaart zitten en is "plat" maar half waar.
  if (aanzicht === 'plat') map.easeTo({ pitch: 0, bearing: 0, duration: 420 });
  else map.easeTo({ pitch: AANZICHT.schuin.pitch, duration: 420 });
}

export const huidigAanzicht = () => aanzicht;

/**
 * De kaart op jouw positie zetten zoals het huidige aanzicht dat wil.
 *
 * @param {{lat:number,lon:number}} position
 * @param {number|null} course  richting waarin je loopt, in graden; null = onbekend
 * @param {boolean} zacht      met een animatie (na een tik) of meteen (elke GPS-tik)
 */
export function volg(position, course = null, { zacht = false } = {}) {
  if (!map || !position) return;
  const a = AANZICHT[aanzicht];

  const doel = { center: [position.lon, position.lat], zoom: a.zoom, pitch: a.pitch };
  // Alleen draaien als we een koers hebben. Zonder koers de kaart op 0 zetten zou
  // hem bij elke tik terugklappen naar noord, en dat is erger dan niet draaien.
  if (a.koersVolgen && Number.isFinite(course)) doel.bearing = course;

  if (zacht) map.easeTo({ ...doel, duration: 520 });
  else map.jumpTo(doel);
}

/**
 * Merkt wanneer de gebruiker zélf de kaart pakt.
 *
 * `originalEvent` is het onderscheid: bij slepen, knijpen of draaien met een vinger
 * zit die erin, bij onze eigen jumpTo/easeTo niet. Zonder dat onderscheid zet de
 * app het volgen uit op zijn eigen bewegingen en dan volgt hij nooit meer.
 */
export function onUserMove(cb) {
  if (!map) return () => {};
  const soorten = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'];
  const h = (e) => { if (e && e.originalEvent) cb(); };
  soorten.forEach((s) => map.on(s, h));
  return () => soorten.forEach((s) => map.off(s, h));
}

/* ── Mini-kaartje voor de resultaatkaartjes ───────────────────────────────
   Echte routegeometrie, geen verzonnen kronkel — maar als SVG, zodat drie
   kaartjes naast elkaar geen drie WebGL-contexten kosten.
   ───────────────────────────────────────────────────────────────────────── */

export function routeMiniSvg(route, w = 372, h = 124, pad = 16) {
  const coords = route.coords;
  if (!coords || coords.length < 2) return '';

  const lat0 = coords[0][1] * Math.PI / 180;
  const kx = Math.cos(lat0);                       // lengtegraden korten in naar de pool
  const xs = coords.map((c) => c[0] * kx);
  const ys = coords.map((c) => -c[1]);             // schermas loopt omlaag
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const scale = Math.min((w - pad * 2) / (maxX - minX || 1e-9),
                         (h - pad * 2) / (maxY - minY || 1e-9));
  const offX = (w - (maxX - minX) * scale) / 2;
  const offY = (h - (maxY - minY) * scale) / 2;
  const px = (i) => [(xs[i] - minX) * scale + offX, (ys[i] - minY) * scale + offY];

  // Elk punt tekenen is zinloos op 372 px breed; elke derde is ruim genoeg.
  const step = Math.max(1, Math.round(coords.length / 120));
  let d = '';
  for (let i = 0; i < coords.length; i += step) {
    const [x, y] = px(i);
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const [sx, sy] = px(0);
  const [ex, ey] = px(coords.length - 1);

  return `<svg class="rcard__svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="#C9F26E" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round" opacity=".95"></path>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5.5" fill="#EAF3EA"></circle>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="6" fill="#C9F26E"></circle>
  </svg>`;
}
