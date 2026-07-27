/* ============================================================================
   Het sleepgebaar testen zonder kaart.

   Draaien: open de app en typ in de console
       (await import('./spike/gebaar-probe.js')).run()

   `edit-map.js` praat met MapLibre via een handjevol methodes — project,
   unproject, getSource, dragPan — en met je vinger via pointer-events. Beide zijn
   na te maken. Dus kan het hele gebaar doorlopen worden zonder dat er ook maar één
   frame getekend wordt: geen WebGL, geen tegels, geen zonlicht.

   Wat hiermee níet getest is, blijft: of het lekker aanvoelt. Dat vraagt een duim.
   ============================================================================ */

import { createEditor } from '../src/edit-map.js';

/* Een lus rond Twickel, en een lineaire projectie eromheen. De schaal is zo
   gekozen dat de route ongeveer 300 px hoog is, net als op een telefoon. */
const LON0 = 6.7050, LAT0 = 52.2800;
const K = 37500;                          // px per graad breedte
const KX = K * Math.cos(52.27 * Math.PI / 180);

const project = ([lon, lat]) => ({ x: (lon - LON0) * KX, y: (LAT0 - lat) * K });
const unproject = ([x, y]) => ({ lng: LON0 + x / KX, lat: LAT0 - y / K });

const START = [6.71705, 52.26417];
const VIAS = [[6.70915, 52.26417], [6.71295, 52.26474], [6.71666, 52.27209]];

export async function run() {
  const uit = [];
  let fouten = 0;
  const ok = (naam, cond, extra = '') => {
    uit.push(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
    if (!cond) fouten++;
  };

  /* ── Een echte route om op te slepen ─────────────────────────────────────── */
  const { routeLoop } = await import('../src/router.js');
  const leg = await routeLoop(START, VIAS);
  const route = {
    coords: leg.coords, distanceM: leg.distanceM, walkTimeS: leg.timeS,
    pathShare: leg.pathShare, byKind: leg.byKind, overlap: 0,
    pois: VIAS.map((c, i) => ({ coord: c, naam: `Punt ${i + 1}`, category: 'brug' })),
  };
  uit.push(`route ${(leg.distanceM / 1000).toFixed(2)} km, ${leg.coords.length} punten`);

  /* ── Nepkaart en nepscherm ───────────────────────────────────────────────── */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:760px;pointer-events:none;opacity:0';
  document.body.appendChild(host);

  const lagen = new Set();
  let laatsteData = null;
  const paden = { pan: true, rotate: true };
  const map = {
    getCanvasContainer: () => host,
    project, unproject,
    getSource: (id) => (id === 'stapper-edit' ? { setData: (d) => { laatsteData = d; } } : null),
    addSource: () => {}, removeSource: () => {},
    addLayer: ({ id }) => lagen.add(id),
    getLayer: (id) => (lagen.has(id) ? { id } : undefined),
    removeLayer: (id) => lagen.delete(id),
    fitBounds: () => {},
    dragPan: { enable: () => { paden.pan = true; }, disable: () => { paden.pan = false; } },
    dragRotate: { enable: () => { paden.rotate = true; }, disable: () => { paden.rotate = false; } },
  };

  const staten = [];
  const meldingen = [];
  const ed = createEditor({
    map, container: host, route, targetM: 4500, shape: 'loop',
    onState: (s) => staten.push(s), onMessage: (m) => meldingen.push(m),
  });

  const laatste = () => staten[staten.length - 1];
  const soorten = () => (laatsteData ? laatsteData.features.map((f) => f.properties.soort) : []);
  const band = () => (laatsteData || { features: [] }).features
    .find((f) => f.properties.soort === 'band');
  const duim = () => host.querySelector('.duim');

  /* ── Gereedschap om te tikken en te slepen ──────────────────────────────── */
  const pointer = (soort, x, y, id = 1) => host.dispatchEvent(new PointerEvent(soort, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0,
  }));
  const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sleep(van, naar, { stappen = 6, houdVast = 0 } = {}) {
    pointer('pointerdown', van.x, van.y);
    for (let i = 1; i <= stappen; i++) {
      pointer('pointermove', van.x + (naar.x - van.x) * i / stappen,
                             van.y + (naar.y - van.y) * i / stappen);
      await wacht(16);
    }
    if (houdVast) await wacht(houdVast);
    pointer('pointerup', naar.x, naar.y);
  }

  /* ── 1. Beginstand ──────────────────────────────────────────────────────── */
  uit.push('\nBeginstand');
  ok('lagen toegevoegd', lagen.has('edit-lijn') && lagen.has('edit-band') &&
     lagen.has('edit-poi') && lagen.has('edit-start'), `${lagen.size} lagen`);
  ok('lijn + start + 3 punten getekend',
     soorten().join(',') === 'lijn,start,poi,poi,poi', soorten().join(','));
  ok('niets ongedaan te maken', laatste().canUndo === false);
  ok('duimlabel bestaat maar staat uit', !!duim() && !duim().classList.contains('duim--aan'));

  /* ── 2. Naast de lijn: de kaart mag panoramen ───────────────────────────── */
  uit.push('\nNaast de lijn');
  const ver = project(leg.coords[0]);
  pointer('pointerdown', ver.x + 200, ver.y + 200);
  ok('geen sleep begonnen', paden.pan === true);
  pointer('pointerup', ver.x + 200, ver.y + 200);

  /* ── 3. Het startpunt blijft waar het is ────────────────────────────────── */
  uit.push('\nStartpunt');
  const s0 = project(START);
  pointer('pointerdown', s0.x, s0.y);
  ok('start pakt niet', paden.pan === true);
  pointer('pointerup', s0.x, s0.y);

  /* ── 4. De lijn verslepen ───────────────────────────────────────────────── */
  uit.push('\nDe lijn verslepen');
  const posMid = Math.round(leg.coords.length * 0.30);
  const pakPunt = project(leg.coords[posMid]);
  // Flink ver weg: een kleine sleep snapt terug op hetzelfde pad, en dan meet je
  // niet of het herrouteren werkt.
  const doel = { x: pakPunt.x + 170, y: pakPunt.y - 110 };

  pointer('pointerdown', pakPunt.x, pakPunt.y);
  ok('kaart staat stil tijdens de sleep', paden.pan === false && paden.rotate === false);
  ok('nog geen elastiek na alleen aanraken', !band());
  ok('nog geen duimlabel na alleen aanraken', !duim().classList.contains('duim--aan'));

  pointer('pointermove', pakPunt.x + 4, pakPunt.y);
  ok('4 px is nog een tik, geen sleep', !band());

  pointer('pointermove', doel.x, doel.y);
  ok('elastiek verschijnt', !!band());
  ok('elastiek gaat door de vinger', (() => {
    const v = unproject([doel.x, doel.y]);
    return band().geometry.coordinates.some(
      (c) => Math.abs(c[0] - v.lng) < 1e-9 && Math.abs(c[1] - v.lat) < 1e-9);
  })());
  ok('duimlabel staat aan met een ≈', duim().classList.contains('duim--aan') &&
     duim().textContent.includes('≈'), duim().textContent);
  // Boven de vinger en horizontaal gecentreerd, want daaronder zit je hand.
  ok('duimlabel zit gecentreerd boven de vinger', (() => {
    const r = duim().getBoundingClientRect();
    return Math.abs((r.left + r.width / 2) - doel.x) < 2 &&
           r.bottom > doel.y - 60 && r.bottom <= doel.y - 20;
  })(), (() => {
    const r = duim().getBoundingClientRect();
    return `midden ${Math.round(r.left + r.width / 2)} vs vinger ${Math.round(doel.x)}, ` +
           `onderkant ${Math.round(r.bottom)} vs vinger ${Math.round(doel.y)}`;
  })());

  const voor = laatste().distanceM;
  pointer('pointerup', doel.x, doel.y);
  ok('kaart mag meteen weer bewegen', paden.pan === true && paden.rotate === true);

  // De echte routering loopt nu; wachten tot hij landt.
  for (let i = 0; i < 60 && laatste().bezig !== false; i++) await wacht(100);
  await wacht(200);

  ok('duimlabel is weg na lossen', !duim().classList.contains('duim--aan'));
  ok('elastiek is vervangen door de echte lijn', !band() && soorten().includes('lijn'));
  ok('er staat nu een vormpunt', soorten().filter((s) => s === 'shape').length === 1,
     soorten().join(','));
  ok('de route is echt langer geworden', laatste().distanceM > voor + 100,
     `${(voor / 1000).toFixed(2)} → ${(laatste().distanceM / 1000).toFixed(2)} km`);
  ok('ongedaan maken kan nu', laatste().canUndo === true);
  ok('pad-aandeel gemeten', laatste().pathShare != null &&
     laatste().vorigePad != null,
     `${Math.round(laatste().vorigePad * 100)}% → ${Math.round(laatste().pathShare * 100)}%`);

  /* ── 5. Vasthouden snapt tussentijds vast ───────────────────────────────── */
  uit.push('\nStilhouden tijdens de sleep');
  const stappenVoor = laatste().stappen;
  const knoopPx = project(vormpuntVan(laatsteData));
  const doel2 = { x: knoopPx.x - 60, y: knoopPx.y + 50 };
  await sleep(knoopPx, doel2, { stappen: 5, houdVast: 700 });
  for (let i = 0; i < 60 && laatste().bezig !== false; i++) await wacht(100);
  await wacht(200);
  ok('vormpunt verplaatst, er is er nog één',
     soorten().filter((s) => s === 'shape').length === 1, soorten().join(','));
  // Stilhouden routeert tussendoor én bij het lossen. Voor jou is dat één
  // handeling, dus mag het maar één stap terug zijn.
  ok('één sleep blijft één stap terug', laatste().stappen === stappenVoor + 1,
     `${stappenVoor} → ${laatste().stappen}`);

  /* ── 6. Tikken haalt een punt weg ───────────────────────────────────────── */
  uit.push('\nTikken op een punt');
  const poiPx = project(VIAS[1]);
  const puntenVoor = laatste().punten;
  pointer('pointerdown', poiPx.x, poiPx.y);
  pointer('pointerup', poiPx.x, poiPx.y);
  for (let i = 0; i < 60 && laatste().punten === puntenVoor; i++) await wacht(100);
  ok('punt eruit', laatste().punten === puntenVoor - 1,
     `${puntenVoor} → ${laatste().punten}`);
  ok('en het zegt het', meldingen.some((m) => m.includes('Punt 2')), meldingen.join(' | '));
  ok('kaart mag nog steeds bewegen', paden.pan === true);

  /* ── 7. Ongedaan maken ──────────────────────────────────────────────────── */
  uit.push('\nOngedaan maken');
  const naTik = laatste().distanceM;
  await ed.undo();
  ok('punt is terug', laatste().punten === puntenVoor);
  ok('afstand is terug', laatste().distanceM !== naTik);
  await ed.undo();
  await ed.undo();
  ok('helemaal terug bij de oorspronkelijke route',
     Math.abs(laatste().distanceM - leg.distanceM) < 1 && !laatste().canUndo,
     `${(laatste().distanceM / 1000).toFixed(2)} km`);
  ok('geen vormpunten meer', !soorten().includes('shape'), soorten().join(','));

  /* ── 8. Opruimen ────────────────────────────────────────────────────────── */
  uit.push('\nOpruimen');
  ed.destroy();
  ok('lagen weg', lagen.size === 0);
  ok('duimlabel weg', !host.querySelector('.duim'));
  ok('kaart weer volledig vrij', paden.pan === true && paden.rotate === true);
  pointer('pointerdown', pakPunt.x, pakPunt.y);
  ok('luistert niet meer na destroy', paden.pan === true);
  host.remove();

  uit.push(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
  console.log(uit.join('\n'));
  return { fouten, verslag: uit.join('\n') };
}

/** Het vormpunt uit de laatst getekende data, om erop te kunnen mikken. */
function vormpuntVan(data) {
  const f = data.features.find((x) => x.properties.soort === 'shape');
  return f ? f.geometry.coordinates : START;
}
