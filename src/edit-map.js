/* ============================================================================
   Route slepen — het gebaar en wat je ziet.

   Hierboven zit `edit.js` (het model: waypoints, herrouteren, meten) en hieronder
   zit MapLibre. Dit bestand is de laag ertussen: wat je vinger doet, en wat er
   onder je vinger verschijnt.

   Drie beslissingen die het gevoel bepalen:

   1. Wie krijgt het gebaar? Raak je de lijn of een knoop binnen 22 px, dan pakken
      wij hem en gaat de kaart níet mee panoramen. Raak je iets anders, dan is het
      een gewone kaartbeweging. Er is dus geen sleepdrempel: als je de lijn pakt,
      pak je de lijn. Alles anders (eerst kijken of je horizontaal of verticaal
      beweegt) laat de eerste 10 px van elke sleep verloren gaan, en dat voelt op
      een telefoon meteen als plakken.

   2. Tijdens het slepen: rechte lijnen naar je vinger, geen router. Een netwerkcall
      per frame is niet te doen en een lijn die achterloopt op je duim voelt kapot.
      De echte route komt zodra je 250 ms stilhoudt — dan snapt hij vast terwijl je
      nog vasthoudt — of als je lost.

   3. Het getal bij je duim is een schátting en zegt dat ook (≈). Gemeten zit die
      er tot 25% naast; zie de toelichting bij estimateLength(). Zodra de echte
      route binnen is, valt de ≈ weg.
   ============================================================================ */

import {
  waypointsFromRoute, insertIndexForVertex, insertShapePoint, moveWaypoint,
  removeWaypoint, reroute, rubberBand, estimateLength, detourOf,
  spanForInsert, spanForMove, createHistory, EditError,
} from './edit.js';

const SRC = 'stapper-edit';
const RAAK_PX = 22;          // halve 44 px: de hele knoop is dan een duimdoel
const STIL_MS = 250;         // stilhouden = "doe het maar echt"
const TIK_PX = 8;            // hieronder is het een tik, geen sleep
const TIK_MS = 420;

/**
 * @param {object} o
 * @param {maplibregl.Map} o.map
 * @param {HTMLElement} o.container  het element waarin de kaart hangt (voor het duimlabel)
 * @param {object} o.route           gedecoreerde route uit de generator
 * @param {number} o.targetM         wat je wílde lopen, voor "méér dan je wilde"
 * @param {string} o.shape           'loop' | 'outback'
 * @param {(s:object)=>void} o.onState
 * @param {(t:string)=>void} o.onMessage
 */
export function createEditor({
  map, container, route, targetM, shape = 'loop',
  onState = () => {}, onMessage = () => {},
}) {
  let waypoints = waypointsFromRoute(route);
  let result = {
    coords: route.coords,
    distanceM: route.distanceM,
    timeS: route.walkTimeS ?? route.timeS ?? 0,
    pathShare: route.pathShare ?? null,
    byKind: route.byKind || {},
    overlap: route.overlap ?? 0,
  };
  const history = createHistory({ waypoints, result });

  let detour = detourOf(result.coords, waypoints);
  let vorigePad = null;        // voor "44% → 61% paadjes"
  let bezig = false;           // er loopt een echte routering
  let fout = null;
  let token = 0;               // alleen het nieuwste antwoord mag landen
  let drag = null;
  let stilTimer = null;
  let weg = false;

  /* ── Tekenen ────────────────────────────────────────────────────────────── */

  addLayers(map);
  const duim = maakDuim(container);
  // De balk en de knoppen zijn buren van de kaart, niet kinderen: de sleepklasse
  // hoort dus op het scherm, anders kunnen ze niet wijken.
  const scherm = container.closest('.screen') || container;

  function features(coords, { band = false } = {}) {
    const uit = [{
      type: 'Feature',
      properties: { soort: band ? 'band' : 'lijn' },
      geometry: { type: 'LineString', coordinates: coords },
    }];
    waypoints.forEach((w, i) => uit.push({
      type: 'Feature',
      properties: {
        soort: w.kind, i,
        pak: drag && drag.knoop === i ? true : false,
        label: w.kind === 'poi' && w.poi ? w.poi.naam : '',
      },
      geometry: { type: 'Point', coordinates: w.coord },
    }));
    return { type: 'FeatureCollection', features: uit };
  }

  function paint(coords, opts) {
    const src = map.getSource(SRC);
    if (src) src.setData(features(coords, opts));
  }

  function meld() {
    onState({
      distanceM: result.distanceM,
      timeS: result.timeS,
      pathShare: result.pathShare,
      vorigePad,
      byKind: result.byKind,
      overlap: result.overlap,
      punten: waypoints.filter((w) => w.kind === 'poi').length,
      vormpunten: waypoints.filter((w) => w.kind === 'shape').length,
      canUndo: history.canUndo,
      stappen: history.depth,
      bezig, fout,
      slepend: !!drag,
    });
  }

  /* ── Raken ──────────────────────────────────────────────────────────────── */

  /** Waar zit deze aanwijzer binnen de kaart, in pixels? */
  function punt(e) {
    const r = map.getCanvasContainer().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** De knoop onder je vinger, of -1. Van achter naar voren, zodat een knoop die
   *  bovenop een andere ligt de bovenste is — dat is degene die je ziet. */
  function knoopBij({ x, y }) {
    for (let i = waypoints.length - 1; i >= 0; i--) {
      const p = map.project(waypoints[i].coord);
      if (Math.hypot(p.x - x, p.y - y) <= RAAK_PX) return i;
    }
    return -1;
  }

  /** Het lijnstuk onder je vinger: welk hoekpunt, en hoe ver ernaast. */
  function lijnBij({ x, y }) {
    const pts = result.coords.map((c) => map.project(c));
    let best = -1, bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const d = afstandTotSegment(x, y, pts[i - 1], pts[i]);
      if (d < bestD) { bestD = d; best = i - 1; }
    }
    return { vertex: best, dist: bestD };
  }

  /* ── Slepen ─────────────────────────────────────────────────────────────── */

  function onDown(e) {
    if (weg || e.button > 0) return;

    if (drag) {                       // tweede vinger: dit wordt een knijpbeweging
      staakDrag();
      return;
    }

    const p = punt(e);
    const knoop = knoopBij(p);

    if (knoop === 0) return;          // het startpunt blijft waar het is
    if (knoop > 0) {
      begin(e, p, { knoop, span: spanForMove(result.coords, waypoints, knoop) });
      return;
    }

    const { vertex, dist } = lijnBij(p);
    if (dist > RAAK_PX) return;       // niks van ons: de kaart mag panoramen

    const invoeg = insertIndexForVertex(result.coords, waypoints, vertex);
    begin(e, p, { invoeg, span: spanForInsert(result.coords, waypoints, invoeg) });
  }

  function begin(e, p, extra) {
    e.stopPropagation();
    e.preventDefault();
    // `stopPropagation` op een pointer-event is hier níet genoeg: MapLibre luistert
    // naar touchstart/mousedown, en op een telefoon vuurt touchstart apart van
    // pointerdown. Wat het slepen van de kaart écht tegenhoudt is dit:
    map.dragPan.disable();
    map.dragRotate.disable();
    // Knijpen om te zoomen blijft aan; een tweede vinger breekt de sleep af.
    try { e.target.setPointerCapture(e.pointerId); } catch { /* niet erg */ }

    drag = {
      id: e.pointerId,
      vanaf: p, laatst: p, begonnen: performance.now(),
      basis: result, basisWp: waypoints,
      verplaatst: 0, geroute: false, knoop: null, invoeg: null,
      ...extra,
    };
    const vinger = map.unproject([p.x, p.y]);
    drag.coord = [vinger.lng, vinger.lat];

    // Nog géén elastiek en géén duimlabel: dit kan net zo goed een tik zijn om
    // een punt weg te halen, en dan is één frame elastiek een schrikbeeld. Wel
    // meteen de halo, zodat je ziet dat je hem te pakken hebt.
    paint(result.coords);
    meld();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    const p = punt(e);
    drag.verplaatst = Math.max(drag.verplaatst,
      Math.hypot(p.x - drag.vanaf.x, p.y - drag.vanaf.y));
    if (drag.verplaatst <= TIK_PX) return;      // dit is nog een tik in de maak

    scherm.classList.add('bewerk--sleept');
    beweeg(p);

    // Stilhouden betekent: doe het nu echt. Zo hoef je niet te lossen om te zien
    // waar de route werkelijk langs gaat.
    clearTimeout(stilTimer);
    stilTimer = setTimeout(() => { if (drag) leg(drag, { tussendoor: true }); }, STIL_MS);
  }

  function beweeg(p) {
    if (!drag) return;
    drag.laatst = p;
    const finger = map.unproject([p.x, p.y]);
    drag.coord = [finger.lng, finger.lat];

    const band = rubberBand(drag.basis.coords, drag.span, drag.coord);
    if (drag.knoop != null) waypoints = moveWaypoint(waypoints, drag.knoop, drag.coord);
    paint(band, { band: true });

    const schatting = estimateLength(drag.basis.coords, drag.span, drag.coord, {
      baseDistanceM: drag.basis.distanceM, detour,
    });
    zetDuim(p, schatting, { schatting: true });
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    clearTimeout(stilTimer);

    const tik = drag.verplaatst < TIK_PX &&
                performance.now() - drag.begonnen < TIK_MS;

    if (tik) {
      const d = drag;
      staakDrag();
      if (d.knoop != null) haalWeg(d.knoop);
      return;
    }

    const d = drag;
    drag = null;
    scherm.classList.remove('bewerk--sleept');
    leg(d, { tussendoor: false });
  }

  /** Sleep afbreken en alles terugzetten zoals het was. */
  function staakDrag() {
    clearTimeout(stilTimer);
    if (!drag) return;
    waypoints = drag.basisWp;
    drag = null;
    scherm.classList.remove('bewerk--sleept');
    map.dragPan.enable();
    map.dragRotate.enable();
    verbergDuim();
    paint(result.coords);
    meld();
  }

  /**
   * De sleep vastleggen: het punt in de lijst zetten en de echte route ophalen.
   *
   * `tussendoor` = je houdt nog vast (je stond even stil). Dan blijft het gebaar
   * doorlopen, maar vanaf hier sleep je het net gezette punt in plaats van
   * opnieuw de lijn — anders zou je bij elke stilstand een nieuw punt bijzetten.
   */
  async function leg(d, { tussendoor }) {
    // Het gebaar is voorbij: de kaart mag weer bewegen. Dit staat vóór alles wat
    // mis kan gaan, want een kaart die niet meer schuift is niet te herstellen
    // zonder het scherm te verlaten.
    if (!tussendoor) {
      map.dragPan.enable();
      map.dragRotate.enable();
      verbergDuim();
    }
    if (!d.coord) return;

    const nieuw = d.knoop != null
      ? moveWaypoint(d.basisWp, d.knoop, d.coord)
      : insertShapePoint(d.basisWp, d.invoeg, d.coord);

    const eerste = !d.geroute;
    d.geroute = true;
    if (tussendoor) {
      // Het gebaar gaat door, maar vanaf nu verplaats je dit punt. De lijst moet
      // hier meteen mee, nog vóór het wachten op de router: anders wijst
      // `d.knoop` een halve seconde naar het verkeerde punt en springt er een
      // knoop onder je vinger die er niet hoort.
      d.knoop = d.knoop ?? d.invoeg;
      d.invoeg = null;
      d.basisWp = nieuw;
      waypoints = nieuw;
    }

    const ok = await pasToe(nieuw, { vervang: !eerste });
    if (!ok) return;

    // Nog vast? Dan gaat het slepen verder op de nieuwe geometrie.
    if (drag === d) {
      d.basis = result;
      d.span = spanForMove(result.coords, waypoints, d.knoop);
    }
  }

  /** Waypoints doorrekenen en de uitkomst overnemen. Alleen het nieuwste
   *  antwoord mag landen: tijdens één sleep lopen er zo drie achter elkaar. */
  async function pasToe(nieuweWp, { vervang = false } = {}) {
    const mijn = ++token;
    bezig = true;
    fout = null;
    meld();

    let uit;
    try {
      uit = await reroute(nieuweWp, { shape, signal: { get aborted() { return mijn !== token; } } });
    } catch (e) {
      if (mijn !== token) return false;
      bezig = false;
      fout = e instanceof EditError ? e.message : 'Herberekenen lukte niet. Verbinding?';
      onMessage(fout);
      waypoints = history.current.waypoints;
      result = history.current.result;
      paint(result.coords);
      meld();
      return false;
    }
    if (mijn !== token || !uit) return false;

    vorigePad = result.pathShare;
    waypoints = nieuweWp;
    result = uit;
    detour = detourOf(result.coords, waypoints);
    bezig = false;
    if (vervang) history.replace({ waypoints, result });
    else history.push({ waypoints, result });
    paint(result.coords);
    meld();
    return true;
  }

  /* ── Punten weghalen ────────────────────────────────────────────────────── */

  async function haalWeg(index) {
    const w = waypoints[index];
    if (!w || index <= 0) return;

    // Een punt onderweg verplaats je niet, je haalt het eruit: de speeltuin staat
    // waar hij staat. Een vormpunt is alleen jouw omweg, die mag ook gewoon weg.
    const naam = w.kind === 'poi' && w.poi ? w.poi.naam : 'De omweg';
    const ok = await pasToe(removeWaypoint(waypoints, index));
    if (ok) onMessage(`${naam} eruit — ↺ maakt het ongedaan`);
  }

  /* ── Naar buiten ────────────────────────────────────────────────────────── */

  const canvas = map.getCanvasContainer();
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove, { capture: true });
  canvas.addEventListener('pointerup', onUp, { capture: true });
  canvas.addEventListener('pointercancel', staakDrag, { capture: true });

  paint(result.coords);
  meld();

  return {
    /** Eén stap terug. */
    async undo() {
      if (!history.canUndo) return;
      const s = history.undo();
      token++;                          // een lopende routering mag hier niet meer overheen
      waypoints = s.waypoints;
      result = s.result;
      vorigePad = null;
      bezig = false;
      fout = null;
      paint(result.coords);
      meld();
    },

    /** De route zoals hij nu is, om terug te schrijven. */
    resultaat() {
      return {
        waypoints: waypoints.map((w) => ({ ...w })),
        veranderd: history.depth > 0,
        ...result,
      };
    },

    /** Kaart passend in beeld, met ruimte voor de balk en de knoppen. */
    fit(padding = { top: 96, bottom: 132, left: 30, right: 30 }) {
      if (!result.coords.length) return;
      const b = result.coords.reduce(
        (a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]),
                   Math.max(a[2], c[0]), Math.max(a[3], c[1])],
        [Infinity, Infinity, -Infinity, -Infinity]);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, duration: 0 });
    },

    destroy() {
      weg = true;
      token++;
      clearTimeout(stilTimer);
      canvas.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.removeEventListener('pointermove', onMove, { capture: true });
      canvas.removeEventListener('pointerup', onUp, { capture: true });
      canvas.removeEventListener('pointercancel', staakDrag, { capture: true });
      map.dragPan.enable();
      map.dragRotate.enable();
      scherm.classList.remove('bewerk--sleept');
      duim.remove();
      removeLayers(map);
    },
  };

  /* ── Duimlabel ──────────────────────────────────────────────────────────── */

  function zetDuim(p, meters, { schatting }) {
    const km = (meters / 1000).toFixed(1).replace('.', ',');
    const diff = meters - targetM;
    const teken = diff > 0 ? 'méér' : 'minder';
    const afw = Math.abs(diff) < 300 ? ''
      : `<span class="duim__diff ${diff > 0 ? 'duim__diff--meer' : ''}">${
          (Math.abs(diff) / 1000).toFixed(1).replace('.', ',')} km ${teken} dan je wilde</span>`;

    duim.innerHTML = `<span class="duim__km">${schatting ? '≈ ' : ''}${km} km</span>${afw}`;
    // Boven de vinger, want daaronder zit je hand. Niet hoger dan de balk: dan
    // valt hij buiten het scherm en zie je juist niets.
    const y = Math.max(p.y, 116);
    duim.style.transform =
      `translate(calc(${p.x}px - 50%), calc(${y}px - 100% - 26px))`;
    duim.classList.add('duim--aan');
  }

  function verbergDuim() { duim.classList.remove('duim--aan'); }
}

/* ── Hulp ─────────────────────────────────────────────────────────────────── */

/** Afstand van een punt tot een lijnstuk, in pixels. Het hele raken hangt hieraan,
 *  dus hij is geëxporteerd om na te rekenen (zie spike/edit-probe.mjs). */
export function afstandTotSegment(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function maakDuim(container) {
  const el = document.createElement('div');
  el.className = 'duim';
  container.appendChild(el);
  return el;
}

/* De bewerklagen liggen bovenop de gewone routelijn, die tijdens het bewerken
 * verborgen is (zie mapview.setRouteVisible). Zo vecht er niets om dezelfde
 * geometrie en kan hier per frame data in zonder de rest te raken. */
const LAGEN = [
  ['edit-case', {
    type: 'line', filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0A1512', 'line-width': 13, 'line-opacity': .8 },
  }],
  ['edit-lijn', {
    type: 'line', filter: ['==', ['get', 'soort'], 'lijn'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#C9F26E', 'line-width': 6.5 },
  }],
  // De elastiek is onderbroken en iets dunner: zo zie je dat dit nog niet de
  // route is maar je bedoeling.
  ['edit-band', {
    type: 'line', filter: ['==', ['get', 'soort'], 'band'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#C9F26E', 'line-width': 5, 'line-opacity': .92,
      'line-dasharray': [1.5, 1.1],
    },
  }],
  ['edit-halo', {
    type: 'circle', filter: ['==', ['get', 'pak'], true],
    paint: { 'circle-radius': 20, 'circle-color': '#C9F26E', 'circle-opacity': .2 },
  }],
  ['edit-poi', {
    type: 'circle', filter: ['==', ['get', 'soort'], 'poi'],
    paint: {
      'circle-radius': 8, 'circle-color': '#0C1A17',
      'circle-stroke-color': '#C9F26E', 'circle-stroke-width': 3.5,
    },
  }],
  // Vormpunten zijn hol en muntgroen: het is jouw omweg, niet iets om te zien.
  ['edit-shape', {
    type: 'circle', filter: ['==', ['get', 'soort'], 'shape'],
    paint: {
      'circle-radius': 7, 'circle-color': '#0C1A17',
      'circle-stroke-color': '#6FE3D0', 'circle-stroke-width': 3.5,
    },
  }],
  ['edit-start', {
    type: 'circle', filter: ['==', ['get', 'soort'], 'start'],
    paint: {
      'circle-radius': 8, 'circle-color': '#C9F26E',
      'circle-stroke-color': '#0C1A17', 'circle-stroke-width': 3.5,
    },
  }],
  ['edit-poi-naam', {
    type: 'symbol', filter: ['==', ['get', 'soort'], 'poi'],
    layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'],
      'text-size': 11.5, 'text-offset': [0, 1.4], 'text-anchor': 'top',
      'text-max-width': 9, 'text-optional': true,
    },
    paint: { 'text-color': '#EAF3EA', 'text-halo-color': '#0A1512', 'text-halo-width': 2 },
  }],
];

function addLayers(map) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  for (const [id, def] of LAGEN) {
    if (!map.getLayer(id)) map.addLayer({ id, source: SRC, ...def });
  }
}

function removeLayers(map) {
  for (const [id] of LAGEN) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
}
