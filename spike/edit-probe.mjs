/* ============================================================================
   Doorrekenen van de laag onder het slepen, tegen de échte BRouter.

   Draaien:  node spike/edit-probe.mjs
   Vereist:  internet (BRouter), geen browser.

   Bestaat omdat het gebaar zelf alleen met een vinger op een kaart te testen is,
   maar alles eronder — waar zit een waypoint op de lijn, welk stuk vervangt deze
   sleep, hoeveel schelen de schatting en de echte route — gewoon te berekenen is.
   Die scheiding is precies waarom edit.js geen kaart en geen DOM kent.
   ============================================================================ */
import {
  waypointsFromRoute, waypointPositions, insertIndexForVertex, insertShapePoint,
  moveWaypoint, removeWaypoint, reroute, rubberBand, rubberLength, estimateLength,
  detourOf, spanForInsert, spanForMove, createHistory,
} from '../src/edit.js';
import { distM, destination, bearing } from '../src/geo.js';
import { routeLoop } from '../src/router.js';
import { afstandTotSegment } from '../src/edit-map.js';

let fouten = 0;
const ok = (naam, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
  if (!cond) fouten++;
};

const START = [6.71705, 52.26417];
const VIAS = [[6.70915, 52.26417], [6.71295, 52.26474], [6.71666, 52.27209]];

console.log('Route ophalen bij BRouter…');
const leg = await routeLoop(START, VIAS);
console.log(`  ${leg.coords.length} punten, ${(leg.distanceM / 1000).toFixed(2)} km, ` +
            `${Math.round((leg.pathShare ?? 0) * 100)}% paadjes\n`);

const route = {
  coords: leg.coords, distanceM: leg.distanceM, timeS: leg.timeS,
  pathShare: leg.pathShare, byKind: leg.byKind, overlap: 0,
  pois: VIAS.map((c, i) => ({ coord: c, naam: `Punt ${i + 1}`, category: 'brug' })),
};

/* ── Raken ──────────────────────────────────────────────────────────────────
   Of je de lijn te pakken krijgt hangt hier volledig aan. Een fout van een paar
   pixels is op een telefoon het verschil tussen "hij pakt hem niet" en "hij pakt
   hem terwijl ik wilde panoramen".
   ───────────────────────────────────────────────────────────────────────────── */
console.log('Raken');
const A = { x: 0, y: 0 }, B = { x: 100, y: 0 };
ok('op de lijn is 0', afstandTotSegment(50, 0, A, B) === 0);
ok('haaks erboven', afstandTotSegment(50, 12, A, B) === 12);
ok('voorbij het uiteinde meet naar het uiteinde',
   Math.abs(afstandTotSegment(140, 0, A, B) - 40) < 1e-9);
ok('vóór het begin ook', Math.abs(afstandTotSegment(-30, 40, A, B) - 50) < 1e-9);
ok('een segment van niets valt niet om',
   afstandTotSegment(3, 4, A, { x: 0, y: 0 }) === 5);
ok('22 px raakt, 23 px niet',
   afstandTotSegment(50, 22, A, B) <= 22 && afstandTotSegment(50, 23, A, B) > 22);

/* ── Model ──────────────────────────────────────────────────────────────── */
console.log('\nModel');
let wp = waypointsFromRoute(route);
ok('waypoints: start + 3 punten', wp.length === 4 && wp[0].kind === 'start' &&
   wp.slice(1).every((w) => w.kind === 'poi'));

const pos = waypointPositions(leg.coords, wp);
ok('posities lopen op', pos.every((v, i) => i === 0 || v >= pos[i - 1]), pos.join(','));
ok('posities eindigen op het laatste punt', pos[pos.length - 1] === leg.coords.length - 1);
ok('elk waypoint ligt dicht bij zijn hoekpunt',
   wp.every((w, i) => distM(w.coord, leg.coords[pos[i]]) < 30),
   wp.map((w, i) => Math.round(distM(w.coord, leg.coords[pos[i]])) + 'm').join(' '));

// Hergebruik: een al aangepaste route houdt zijn vormpunten.
const metVorm = { ...route, waypoints: insertShapePoint(wp, 2, [6.7, 52.27]) };
ok('bestaande vormpunten blijven', waypointsFromRoute(metVorm).length === 5 &&
   waypointsFromRoute(metVorm)[2].kind === 'shape');

/* Waar valt een hoekpunt uit segment 2? */
const midVertex = Math.round((pos[1] + pos[2]) / 2);
const invoeg = insertIndexForVertex(leg.coords, wp, midVertex);
ok('hoekpunt tussen waypoint 1 en 2 voegt in op 2', invoeg === 2, `kreeg ${invoeg}`);
ok('hoekpunt vlak na het start voegt in op 1',
   insertIndexForVertex(leg.coords, wp, Math.max(1, pos[0] + 1)) === 1);
ok('hoekpunt aan het eind voegt achteraan in',
   insertIndexForVertex(leg.coords, wp, leg.coords.length - 2) === wp.length);

ok('startpunt is niet te verwijderen', removeWaypoint(wp, 0).length === wp.length);
ok('punt onderweg wél', removeWaypoint(wp, 2).length === wp.length - 1);

/* ── Spans en elastiek ──────────────────────────────────────────────────── */
console.log('\nElastiek');
const spanIn = spanForInsert(leg.coords, wp, invoeg);
ok('invoegspan is het segment zelf', spanIn[0] === pos[invoeg - 1] && spanIn[1] === pos[invoeg]);

const spanMove = spanForMove(leg.coords, wp, 2);
ok('verplaatsspan omvat vóór én na', spanMove[0] === pos[1] && spanMove[1] === pos[3],
   `${spanMove} vs ${[pos[1], pos[3]]}`);
ok('verplaatsspan is groter dan invoegspan', (spanMove[1] - spanMove[0]) > (spanIn[1] - spanIn[0]));

// Sleep het midden van segment 2 zijwaarts weg.
const a = leg.coords[spanIn[0]], b = leg.coords[spanIn[1]];
const haaks = (bearing(a, b) + 90) % 360;
const vinger = destination(leg.coords[midVertex], haaks, 300);

const band = rubberBand(leg.coords, spanIn, vinger);
ok('elastiek begint bij het start', distM(band[0], leg.coords[0]) < 1);
ok('elastiek eindigt waar de route eindigt',
   distM(band[band.length - 1], leg.coords[leg.coords.length - 1]) < 1);
ok('elastiek gaat door de vinger', band.some((c) => distM(c, vinger) < 1));
ok('elastiek is korter dan de route (rechte lijnen)',
   rubberLength(band) < leg.distanceM);

const schat = estimateLength(leg.coords, spanIn, vinger, {
  baseDistanceM: leg.distanceM, detour: detourOf(leg.coords, wp),
});
ok('schatting is langer dan de elastiek', schat > rubberLength(band),
   `${(schat / 1000).toFixed(2)} km vs ${(rubberLength(band) / 1000).toFixed(2)} km`);

/* ── Echt herrouteren ───────────────────────────────────────────────────── */
console.log('\nHerrouteren');
const gesleept = insertShapePoint(wp, invoeg, vinger);
const res = await reroute(gesleept);
ok('herrouteren geeft een route', !!res && res.coords.length > 10);
ok('meetwaarden compleet', res.distanceM > 0 && res.timeS > 0 &&
   res.pathShare != null && typeof res.overlap === 'number');

const afw = (res.distanceM - schat) / res.distanceM;
console.log(`       schatting ${(schat / 1000).toFixed(2)} km, echt ` +
            `${(res.distanceM / 1000).toFixed(2)} km → ${(afw * 100).toFixed(1)}% ernaast`);
ok('schatting binnen de gemeten bandbreedte (±30%)', Math.abs(afw) < 0.30);
ok('de omweg maakt de route langer', res.distanceM > leg.distanceM,
   `${(leg.distanceM / 1000).toFixed(2)} → ${(res.distanceM / 1000).toFixed(2)} km`);

// Het vormpunt moet ook echt op de nieuwe lijn liggen, anders klopt de span erna niet.
const posNa = waypointPositions(res.coords, gesleept);
const bijVinger = distM(vinger, res.coords[posNa[invoeg]]);
ok('het gesleepte punt ligt op de nieuwe lijn', bijVinger < 250, `${Math.round(bijVinger)} m ernaast`);

// Verplaatsen van datzelfde punt.
const verder = destination(vinger, haaks, 200);
const res2 = await reroute(moveWaypoint(gesleept, invoeg, verder));
ok('verplaatsen werkt', res2.distanceM > 0 && res2.coords.length > 10,
   `${(res2.distanceM / 1000).toFixed(2)} km`);

// Punt eruit halen brengt hem terug in de richting van het origineel.
const res3 = await reroute(removeWaypoint(gesleept, invoeg));
const terug = Math.abs(res3.distanceM - leg.distanceM);
ok('vormpunt weghalen geeft de oude route terug', terug < 60,
   `${Math.round(terug)} m verschil`);

/* ── Heen en terug ──────────────────────────────────────────────────────── */
console.log('\nHeen en terug');
const heen = await reroute(wp.slice(0, 3), { shape: 'outback' });
ok('outback wordt gespiegeld', Math.abs(heen.coords.length - (heen.coords.length)) === 0 &&
   distM(heen.coords[0], heen.coords[heen.coords.length - 1]) < 5);
ok('outback loopt dubbel', heen.overlap > 0.6, `overlap ${heen.overlap.toFixed(2)}`);

/* ── Ongedaan maken ─────────────────────────────────────────────────────── */
console.log('\nOngedaan maken');
const h = createHistory({ waypoints: wp, result: leg });
ok('vers: niets ongedaan te maken', !h.canUndo && h.depth === 0);
h.push({ waypoints: gesleept, result: res });
ok('na een sleep kan het terug', h.canUndo && h.depth === 1);
h.replace({ waypoints: gesleept, result: res2 });
ok('replace verdiept niet', h.depth === 1 && h.current.result === res2);
h.undo();
ok('terug bij het begin', h.current.result === leg && !h.canUndo);

const klein = createHistory({ n: 0 }, 3);
for (let i = 1; i <= 8; i++) klein.push({ n: i });
ok('historie loopt niet vol', klein.depth === 3 && klein.current.n === 8);

console.log(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
process.exit(fouten ? 1 : 0);
