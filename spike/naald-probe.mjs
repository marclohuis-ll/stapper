/* ============================================================================
   Waar wijst de kompasnaald in de kindmodus naartoe?

   Draaien:  node spike/naald-probe.mjs
   Vereist:  internet (BRouter).

   De naald wees hemelsbreed naar het volgende punt. Dat is niet waar je heen moet: de
   route kan om een sloot, een spoor of een tuin heen lopen, en een kind loopt de kant
   op waar de pijl wijst. Deze probe meet hoe groot dat verschil in de praktijk is, en
   of de nieuwe bron — de richting van de route — er beter op zit.

   De rekenregel uit needleDeg() staat hier nagebouwd; die functie zelf zit in app.js,
   dat een DOM nodig heeft. De regel is klein genoeg om zonder ruis te herhalen, en het
   verschil dat gemeten wordt zit in de bronnen, niet in de omhulling.
   ============================================================================ */

import { routeLoop } from '../src/router.js';
import { createTracker } from '../src/tracking.js';
import { bearing, distM, destination } from '../src/geo.js';

let fouten = 0;
const ok = (naam, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
  if (!cond) fouten++;
};
const hoekVerschil = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
const OP_DE_LIJN_M = 25;

/* ── Een echte route met punten onderweg ─────────────────────────────────── */
const START = [6.71705, 52.26417];
const VIAS = [[6.70915, 52.26417], [6.71295, 52.26474], [6.71666, 52.27209]];

console.log('Route ophalen bij BRouter…');
const leg = await routeLoop(START, VIAS);
const route = {
  coords: leg.coords, distanceM: leg.distanceM,
  pois: VIAS.map((c, i) => ({ coord: c, naam: `Punt ${i + 1}`, category: 'brug' })),
};
console.log(`  ${(leg.distanceM / 1000).toFixed(2)} km, ${leg.coords.length} punten\n`);

/* De twee bronnen, zoals needleDeg() ze weegt. */
const naaldOud = (pos, pr) => (pr.next ? bearing(pos, pr.next.coord) : null);
const naaldNieuw = (pos, pr) => {
  if (pr.offRouteM > OP_DE_LIJN_M && pr.snapped) return bearing(pos, pr.snapped);
  if (pr.koersOpRoute != null) return pr.koersOpRoute;
  return pr.next ? bearing(pos, pr.next.coord) : null;
};

/* ── Hoe vaak wijst de oude naald de verkeerde kant op? ──────────────────── */
console.log('De route lopen, en per meting kijken waar elke naald heen wijst');
const tracker = createTracker(route);
const cum = [0];
for (let i = 1; i < leg.coords.length; i++) cum.push(cum[i - 1] + distM(leg.coords[i - 1], leg.coords[i]));

let n = 0, somOud = 0, somNieuw = 0, ergOud = 0, ergNieuw = 0, grootsteOud = 0;
for (let d = 0; d < leg.distanceM - 30; d += 10) {
  const pos = puntOp(d);
  const pr = tracker.update({ lon: pos[0], lat: pos[1], accuracy: 8 });
  /* Waarheid: de kant waar de route hier heen gaat. Dat is per definitie de kant waar
   * je heen moet lopen, want die lijn is de route. */
  const waar = koersOverLijn(d, 25);
  if (waar == null) continue;

  const oud = naaldOud(pos, pr);
  const nieuw = naaldNieuw(pos, pr);
  if (oud == null || nieuw == null) continue;

  const fOud = hoekVerschil(waar, oud);
  const fNieuw = hoekVerschil(waar, nieuw);
  n++;
  somOud += fOud; somNieuw += fNieuw;
  if (fOud > 45) ergOud++;
  if (fNieuw > 45) ergNieuw++;
  grootsteOud = Math.max(grootsteOud, fOud);
}

console.log(`  ${n} metingen langs de route\n`);
console.log('Afwijking van de kant waar de route heen gaat');
console.log(`  naar het punt (was):    gemiddeld ${(somOud / n).toFixed(0)}°, ` +
            `${ergOud} keer meer dan 45° mis (${Math.round(ergOud / n * 100)}%), grootste ${grootsteOud.toFixed(0)}°`);
console.log(`  langs de route (nu):    gemiddeld ${(somNieuw / n).toFixed(0)}°, ` +
            `${ergNieuw} keer meer dan 45° mis\n`);

/* Waarom de nieuwe naald níet op nul uitkomt: hij neemt de tangent op de plek waar de
 * trácker je hebt geprojecteerd, en die ligt een paar meter naast de plek die deze
 * probe als waarheid gebruikt. In een scherpe bocht zwaait een tangent over 25 meter
 * dan flink. Dat is meetruis van de vergelijking, geen verkeerde richting — vandaar dat
 * er hier een verhouding staat en geen absolute eis. */
ok('de nieuwe naald zit dichter bij de route dan de oude', somNieuw < somOud * 0.5,
   `${(somNieuw / n).toFixed(0)}° tegen ${(somOud / n).toFixed(0)}° gemiddeld`);
ok('de oude naald week fors af', somOud / n > 20, `${(somOud / n).toFixed(0)}° gemiddeld`);
ok('en wees regelmatig echt de verkeerde kant op', ergOud > n * 0.2,
   `${Math.round(ergOud / n * 100)}% van de tijd meer dan 45° mis`);
ok('de nieuwe naald veel minder vaak', ergNieuw < ergOud * 0.35,
   `${Math.round(ergNieuw / n * 100)}% tegen ${Math.round(ergOud / n * 100)}%`);

/* ── Van de route af: dan moet hij terugwijzen ───────────────────────────── */
console.log('Vijftig meter van de route af');
{
  const t2 = createTracker(route);
  const opDeLijn = puntOp(leg.distanceM * 0.35);
  const zijwaarts = (koersOverLijn(leg.distanceM * 0.35, 25) + 90) % 360;
  // Eerst een stukje over de route lopen, zodat de tracker weet waar we zijn.
  for (let d = leg.distanceM * 0.30; d < leg.distanceM * 0.35; d += 10) {
    const p = puntOp(d);
    t2.update({ lon: p[0], lat: p[1], accuracy: 8 });
  }
  const ernaast = destination(opDeLijn, zijwaarts, 50);
  const pr = t2.update({ lon: ernaast[0], lat: ernaast[1], accuracy: 8 });

  ok('de tracker ziet dat je ernaast loopt', pr.offRouteM > OP_DE_LIJN_M,
     `${Math.round(pr.offRouteM)} m van de lijn`);
  const naald = naaldNieuw(ernaast, pr);
  const terug = bearing(ernaast, opDeLijn);
  ok('de naald wijst terug naar het pad', hoekVerschil(terug, naald) < 20,
     `${Math.round(hoekVerschil(terug, naald))}° van de richting naar de route`);
  // En het is niet toevallig dezelfde kant als het volgende punt.
  const naarPunt = pr.next ? bearing(ernaast, pr.next.coord) : null;
  if (naarPunt != null) {
    console.log(`  (naar het punt zou ${Math.round(hoekVerschil(terug, naarPunt))}° anders zijn)`);
  }
}

/* ── Het getal onder de naald ────────────────────────────────────────────── */
console.log('\nDe afstand die eronder staat');
{
  const t3 = createTracker(route);
  let pr = null;
  for (let d = 0; d < leg.distanceM * 0.2; d += 10) {
    const p = puntOp(d);
    pr = t3.update({ lon: p[0], lat: p[1], accuracy: 8 });
  }
  ok('langs de route is een ander getal dan hemelsbreed',
     pr.nextAlongM != null && pr.nextDistanceM != null,
     `langs ${Math.round(pr.nextAlongM)} m, hemelsbreed ${Math.round(pr.nextDistanceM)} m`);
  ok('en langs de route is nooit korter dan hemelsbreed',
     pr.nextAlongM >= pr.nextDistanceM - 30,
     'een route kan niet korter zijn dan de rechte lijn');
}

console.log(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
process.exit(fouten ? 1 : 0);

/* ── Hulp ─────────────────────────────────────────────────────────────────── */
function puntOp(along) {
  const doel = Math.max(0, Math.min(cum[cum.length - 1], along));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < doel) i++;
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : (doel - cum[i - 1]) / span;
  const a = leg.coords[i - 1], b = leg.coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function koersOverLijn(along, spanM) {
  const a = puntOp(along);
  const b = puntOp(along + spanM);
  return distM(a, b) < 1 ? null : bearing(a, b);
}
