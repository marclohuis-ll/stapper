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
const MIJ = 'stapper-mij';
const CACHES = 'stapper-caches';
const PIJL = 'mij-pijl-icoon';

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
      // Donkere baan onder de route, zodat hij ook boven licht bos en over een
      // paadje heen een eigen lijn blijft in plaats van met de ondergrond te versmelten.
      paint: { 'line-color': '#0A1512', 'line-width': 15, 'line-opacity': .82 },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: SRC,
      filter: ['==', ['get', 'soort'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Doorlopend, fors, en in een kleur die nergens anders op de kaart voorkomt:
      // je moet de route zíen, niet hoeven zoeken welke lijn de jouwe is.
      paint: { 'line-width': 7.5, 'line-gradient': gradientFor(null) },
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
      // Alleen nog de punten onderweg: de eigen positie zit in een eigen bron.
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 7, 'circle-color': '#0C1A17',
        'circle-stroke-color': '#C9F26E', 'circle-stroke-width': 3,
      },
    });
    map.addLayer({
      id: 'route-poi-label', type: 'symbol', source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'],
        'text-size': 11.5, 'text-offset': [0, 1.5], 'text-anchor': 'top',
        'text-max-width': 9, 'text-optional': true,
      },
      paint: { 'text-color': '#EAF3EA', 'text-halo-color': '#0A1512', 'text-halo-width': 2 },
    });
    /* De geocaches uit je GPX-bestand die níet in deze route zitten. Onder de eigen
     * positie en onder de routepunten, want ze zijn een terzijde: leuk als je er
     * toevallig langs loopt, maar niet waar de route om gaat.
     *
     * Muntgroen en hol, zodat ze niet te verwarren zijn met de gevulde lime ringen van
     * je routepunten — anders lijkt je route langer dan hij is. */
    map.addSource(CACHES, { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'cache-stip', type: 'circle', source: CACHES,
      minzoom: 13,
      paint: {
        'circle-radius': 5.5, 'circle-color': '#0A1512',
        'circle-stroke-color': MAP_COLOURS.mint || '#6FE3D0', 'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'cache-naam', type: 'symbol', source: CACHES,
      minzoom: 15,
      layout: {
        'text-field': ['get', 'naam'], 'text-font': ['Noto Sans Regular'],
        'text-size': 10.5, 'text-offset': [0, 1.2], 'text-anchor': 'top',
        'text-max-width': 8, 'text-optional': true,
      },
      paint: {
        'text-color': MAP_COLOURS.mint || '#6FE3D0',
        'text-halo-color': '#0A1512', 'text-halo-width': 2,
      },
    });

    /* Waar jij bent staat in een éigen bron. Dat is geen ordening maar snelheid:
     * de stip wordt 60 keer per seconde bijgewerkt (zie src/vloeiend.js), en zat
     * hij in dezelfde bron als de route, dan zou elke frame een lijn van
     * honderden punten opnieuw geserialiseerd worden. */
    map.addSource(MIJ, { type: 'geojson', data: empty() });

    map.addLayer({
      id: 'mij-halo', type: 'circle', source: MIJ,
      paint: { 'circle-radius': 25, 'circle-color': '#C9F26E', 'circle-opacity': .14 },
    });
    /* Een donker schijfje onder de pijl, zodat hij overal leesbaar blijft — op een
     * lime paadje, op de roze routelijn, en op donker bos. */
    map.addLayer({
      id: 'mij-schijf', type: 'circle', source: MIJ,
      paint: {
        'circle-radius': 17, 'circle-color': '#0A1512', 'circle-opacity': .92,
        'circle-stroke-color': 'rgba(201,242,110,.4)', 'circle-stroke-width': 1.5,
      },
    });
    /* Twee weergaven, en het verschil is inhoudelijk: een pijl beweert dat hij weet
     * welke kant je op loopt. Weten we dat niet — je staat stil, of er is nog niet
     * genoeg beweging gemeten — dan is een ronde stip het eerlijke antwoord. */
    map.addLayer({
      id: 'mij-stip', type: 'circle', source: MIJ,
      filter: ['!', ['has', 'koers']],
      paint: {
        'circle-radius': 7, 'circle-color': '#C9F26E',
        'circle-stroke-color': '#0A1512', 'circle-stroke-width': 3,
      },
    });
    if (!map.hasImage(PIJL)) map.addImage(PIJL, pijlAfbeelding(), { pixelRatio: 2 });
    map.addLayer({
      id: 'mij-pijl', type: 'symbol', source: MIJ,
      filter: ['has', 'koers'],
      layout: {
        'icon-image': PIJL,
        'icon-rotate': ['get', 'koers'],
        // In kaartruimte draaien én kantelen: dan wijst de pijl naar de plek in het
        // landschap waar je heen loopt, en ligt hij plat op de grond als de kaart
        // gekanteld staat in plaats van als een bordje overeind.
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    res();
  }));

  return ready;
}

const empty = () => ({ type: 'FeatureCollection', features: [] });

/**
 * De pijl die jou voorstelt, getekend op een canvas.
 *
 * Geen bestand erbij: dan moet het mee in de offline-cache, kan het 404'en, en is de
 * kleur op twee plekken vastgelegd. Zeventien regels canvas is hier goedkoper dan een
 * afhankelijkheid.
 *
 * Hij wijst naar boven (0° = noord), want `icon-rotate` draait met de klok mee vanaf
 * boven — precies zoals een peiling loopt.
 */
function pijlAfbeelding(ratio = 2) {
  /* 42 px. Was 30, en dat is op een telefoon in de hand net te klein om in één
   * oogopslag een richting uit te lezen — je moest ernaar kijken in plaats van hem te
   * zien. Het donkere schijfje eronder groeit mee (radius 17). */
  const s = 42 * ratio;
  const k = ratio;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);

  // Een chevron met een inkeping onderin: die leest als richting, waar een
  // gelijkbenige driehoek er op een kleine maat uitziet als een vlekje.
  g.beginPath();
  g.moveTo(0, -15.5 * k);
  g.lineTo(11 * k, 12.5 * k);
  g.lineTo(0, 6.5 * k);
  g.lineTo(-11 * k, 12.5 * k);
  g.closePath();

  // Eerst de donkere rand eronder, dan de vulling erover: zo blijft de pijl leesbaar
  // boven een lime paadje én boven donker bos.
  g.strokeStyle = '#0A1512';
  g.lineWidth = 3.4 * k;
  g.lineJoin = 'round';
  g.stroke();
  g.fillStyle = '#C9F26E';
  g.fill();

  return { width: s, height: s, data: g.getImageData(0, 0, s, s).data };
}

/**
 * De geocaches die in beeld zijn en niet in de route zitten.
 *
 * Alleen wat in het kaartvenster past. Een pocket query kan honderden caches bevatten
 * en die allemaal in de bron zetten maakt de kaart onleesbaar én het tekenen traag —
 * terwijl je toch alleen ziet wat op het scherm staat.
 */
export function paintCaches(caches) {
  if (!map || !map.getSource(CACHES)) return;
  if (!caches || !caches.length) { map.getSource(CACHES).setData(empty()); return; }

  map.getSource(CACHES).setData({
    type: 'FeatureCollection',
    features: caches.map((c) => ({
      type: 'Feature',
      properties: { code: c.code || '', naam: c.naam || 'Geocache', url: c.url || '' },
      geometry: { type: 'Point', coordinates: c.coord },
    })),
  });
}

/**
 * Welke caches vallen binnen een kaartbeeld? Met een marge, zodat ze er al staan
 * voordat ze in beeld schuiven.
 *
 * De grenzen komen als gewone getallen binnen en niet uit de kaart. Zo is dit na te
 * rekenen zonder MapLibre — en dat moet, want een kaart heeft frames nodig om te
 * bestaan en die zijn er niet altijd.
 *
 * @param {Array} caches
 * @param {{west:number, oost:number, zuid:number, noord:number}} grenzen
 */
export function filterOpVenster(caches, grenzen, marge = 0.25) {
  if (!caches || !caches.length || !grenzen) return [];
  const { west, oost, zuid, noord } = grenzen;
  const dLon = (oost - west) * marge;
  const dLat = (noord - zuid) * marge;
  return caches.filter(({ coord }) =>
    coord[0] >= west - dLon && coord[0] <= oost + dLon &&
    coord[1] >= zuid - dLat && coord[1] <= noord + dLat);
}

/** Hetzelfde filter, maar met de grenzen van de kaart zoals hij nu staat. */
export function cachesInBeeld(caches, marge = 0.25) {
  if (!map || !caches || !caches.length) return [];
  const b = map.getBounds();
  return filterOpVenster(caches, {
    west: b.getWest(), oost: b.getEast(), zuid: b.getSouth(), noord: b.getNorth(),
  }, marge);
}

/** Aangetikt op een cache? Geeft de eigenschappen terug, of niets. */
export function onCacheTap(cb) {
  if (!map) return () => {};
  const h = (e) => {
    const f = e.features && e.features[0];
    if (f) cb(f.properties, f.geometry.coordinates);
  };
  map.on('click', 'cache-stip', h);
  return () => map.off('click', 'cache-stip', h);
}

/** Laat de kaart weten wanneer het beeld verschoven is, zodat de caches bijgewerkt
 *  kunnen worden zonder ze alle honderden in de bron te houden. */
export function onBeeldWissel(cb) {
  if (!map) return () => {};
  map.on('moveend', cb);
  return () => map.off('moveend', cb);
}

/**
 * Waar jij bent, en welke kant je op loopt.
 *
 * Dit is het enige dat per frame verandert, dus het staat apart van render(): één
 * punt wegschrijven in plaats van de route erbij.
 */
export function paintMij(position, koers = null) {
  if (!map || !map.getSource(MIJ)) return;
  if (!position) { map.getSource(MIJ).setData(empty()); return; }

  // De sleutel alleen zetten als we hem écht hebben: de lagen kiezen op `has`, en
  // een `koers: null` zou de pijl laten verschijnen zonder richting.
  const props = Number.isFinite(koers) ? { koers } : {};
  map.getSource(MIJ).setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: props,
      geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
    }],
  });
}

/* Achter je gedempt, vóór je vol.
 *
 * Dit was omgedraaid: het gelópen deel was helder lime en het deel dat je nog moest
 * lopen gedempt wit. Dat is de logica van een voortgangsbalk, en op een kaart is het
 * precies verkeerd om — het stuk dat je nog moet doen is het stuk dat je wil zien. Nu
 * is de route vóór je vol roze en is wat je gehad hebt een flauwe echo in dezelfde
 * kleur, zodat je nog kunt zien waar je vandaan komt. */
const GELOPEN = MAP_COLOURS.routeDim;
const TE_GAAN = MAP_COLOURS.route;

/**
 * Verloop met een harde overgang op het punt waar je nu bent. Stops moeten
 * strikt oplopen, dus de knik zit een haartje voorbij de voortgang.
 *
 * `null` betekent: we volgen geen wandeling. Dan is de hele lijn vol — op het
 * detailscherm kijk je naar een route, niet naar je voortgang erin.
 */
function gradientFor(fraction) {
  const flat = (c) => ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c];
  if (fraction == null) return flat(TE_GAAN);

  const f = Math.max(0, Math.min(0.999, fraction));
  if (f <= 0) return flat(TE_GAAN);
  return ['interpolate', ['linear'], ['line-progress'],
    0, GELOPEN, f, GELOPEN, f + 0.001, TE_GAAN, 1, TE_GAAN];
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
  route, position, progress = null, fit = true, padding = 40, trail = null, koers = null,
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
  map.getSource(SRC).setData({ type: 'FeatureCollection', features });

  // De eigen positie zit in zijn eigen bron; hier alleen doorgeven zodat schermen
  // die render() aanroepen niet ook nog paintMij hoeven te kennen.
  paintMij(position, koers);

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

/** Alleen het verloop bijwerken: gelopen deel helder, de rest gedempt.
 *  Apart van render(), zodat de route zelf niet elke meting opnieuw de lijn in hoeft. */
export function setProgress(fraction) {
  if (!map || !map.getLayer('route-line')) return;
  map.setPaintProperty('route-line', 'line-gradient', gradientFor(fraction));
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
let kantelt = false;        // er loopt een kantelanimatie; volg() blijft dan af

/**
 * De kaart in een stand zetten.
 *
 * Dit is de énige plek die kanteling, draaiing en zoom bepaalt — anders vechten twee
 * animaties om dezelfde camera. Dat gebeurde: het kantelen liep als easeTo, en de
 * fitBounds die er direct achteraan kwam kapte die animatie halverwege af. Daarna
 * dacht de app dat hij plat stond terwijl de kaart op 58° bleef hangen.
 *
 * Vandaar ook: nooit overslaan omdat de opgeslagen stand al klopt. De kaart is de
 * waarheid, niet onze variabele.
 *
 * `zacht` is voor als jíj op de knop tikt; bij een schermwissel moet het meteen goed
 * staan, want daar komt een fitBounds achteraan.
 */
export function setAanzicht(soort, { zacht = false, position = null, koers = null } = {}) {
  aanzicht = AANZICHT[soort] ? soort : 'plat';
  if (!map) return;

  if (map.getLayer('building-3d')) {
    map.setLayoutProperty('building-3d', 'visibility', aanzicht === 'schuin' ? 'visible' : 'none');
  }

  const a = AANZICHT[aanzicht];
  const doel = { pitch: a.pitch, zoom: a.zoom };
  // Terug naar plat betekent ook: noord weer boven. Anders blijf je met een scheve
  // kaart zitten en is "plat" maar half waar.
  if (!a.koersVolgen) doel.bearing = 0;
  else if (Number.isFinite(koers)) doel.bearing = koers;
  if (position) doel.center = [position.lon, position.lat];

  if (!zacht) { map.jumpTo(doel); return; }

  /* Animeren én de eindstand afdwingen.
   *
   * Een easeTo hangt aan frames, en een animatie die geen frames krijgt blijft
   * halverwege staan: gemeten in een omgeving op 1 fps bleef de kaart op pitch 58
   * hangen terwijl de app dacht dat hij plat was. De stand van de kaart mag niet
   * afhangen van hoe vlot het toestel tekent, dus wordt hij aan het eind hard gezet
   * — via moveend als de animatie wél loopt, en anders via de klok.
   */
  kantelt = true;
  let gedaan = false;
  const afronden = () => {
    if (gedaan) return;
    gedaan = true;
    kantelt = false;
    map.jumpTo(doel);
  };
  map.once('moveend', afronden);
  setTimeout(afronden, 700);
  map.easeTo({ ...doel, duration: 480 });
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
  // Tijdens het kantelen niets doen: een jumpTo per frame zou die animatie
  // onmiddellijk doodslaan en dan klapt de kaart om in plaats van te kantelen.
  if (kantelt && !zacht) return;

  const a = AANZICHT[aanzicht];
  const doel = { center: [position.lon, position.lat] };
  // Alleen draaien als we een koers hebben. Zonder koers de kaart op 0 zetten zou
  // hem bij elke tik terugklappen naar noord, en dat is erger dan niet draaien.
  if (a.koersVolgen && Number.isFinite(course)) doel.bearing = course;

  if (zacht) {
    map.easeTo({ ...doel, zoom: a.zoom, pitch: a.pitch, duration: 520 });
    return;
  }
  /* Elk frame een jumpTo, en dat is precies goed: het schuiven zit al in de
   * gedempte positie die src/vloeiend.js aanlevert. Zou de kaart hier zélf ook nog
   * animeren, dan animeer je een animatie en loopt het achter. Zoom en kanteling
   * blijven met opzet ongemoeid — die veranderen alleen als jij ze verandert. */
  map.jumpTo(doel);
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
    <path d="${d}" fill="none" stroke="${MAP_COLOURS.route}" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round" opacity=".95"></path>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5.5" fill="#EAF3EA"></circle>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="6" fill="#C9F26E"></circle>
  </svg>`;
}
