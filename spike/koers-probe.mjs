/* ============================================================================
   Hoe onrustig draait de kaart mee?

   Draaien:  node spike/koers-probe.mjs
   Vereist:  internet (BRouter).

   "Onrustig" is meetbaar: tel op hoeveel graden de kaart in totaal draait over een
   wandeling. Loopt de route 200 graden aan bochten, dan is 200 graden het minimum en
   is alles daarboven ruis — heen en weer gewiebel dat niets met de route te maken heeft.

   Twee bronnen naast elkaar, over dezelfde gesimuleerde wandeling met dezelfde
   GPS-ruis:
     A. peiling tussen twee opeenvolgende metingen (wat het was)
     B. de richting van de route op de geprojecteerde plek (wat het nu is)
   ============================================================================ */

import { routeLoop } from '../src/router.js';
import { createTracker } from '../src/tracking.js';
import { bearing, distM, destination } from '../src/geo.js';

let fouten = 0;
const ok = (naam, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
  if (!cond) fouten++;
};

const hoekVerschil = (a, b) => ((b - a + 540) % 360) - 180;
const DODE_ZONE = 8;
const BASISLIJN_M = 20;

/* Staat hier en niet onderaan bij de andere hulpjes: `let` is niet leesbaar vóór zijn
 * regel, ook niet uit een functie die eerder aangeroepen wordt. */
let cumCache = null;

/* ── Een echte route ─────────────────────────────────────────────────────── */
const START = [6.71705, 52.26417];
const VIAS = [[6.70915, 52.26417], [6.71295, 52.26474], [6.71666, 52.27209]];

console.log('Route ophalen bij BRouter…');
const leg = await routeLoop(START, VIAS);
const route = {
  coords: leg.coords, distanceM: leg.distanceM,
  pois: VIAS.map((c, i) => ({ coord: c, naam: `Punt ${i + 1}`, category: 'brug' })),
};
console.log(`  ${(leg.distanceM / 1000).toFixed(2)} km, ${leg.coords.length} punten\n`);

/* Hoeveel draait de route zélf? Dat is de ondergrens: die bochten moet je maken. */
let bochten = 0;
{
  const stap = 25;
  let vorige = null;
  for (let d = 0; d + stap < leg.distanceM; d += stap) {
    const k = koersOverLijn(leg.coords, d, stap);
    if (k != null && vorige != null) bochten += Math.abs(hoekVerschil(vorige, k));
    if (k != null) vorige = k;
  }
}
console.log(`De route zelf draait ${Math.round(bochten)}° aan bochten.\n`);

/* ── Wandeling nabootsen met GPS-ruis ────────────────────────────────────── */
/* Elke seconde een meting, ~1,3 m verder, met een zijwaartse fout die schommelt —
 * dat is wat een bladerdek doet. Dezelfde reeks voor beide bronnen, zodat het
 * verschil alleen aan de bron ligt. */
function metingen({ stapM = 1.3, foutM = 10 } = {}) {
  const uit = [];
  let langs = 0;
  let fase = 0;
  while (langs < leg.distanceM) {
    const echt = puntOp(leg.coords, langs);
    const richting = koersOverLijn(leg.coords, langs, 25) ?? 0;
    fase += 0.9;
    // Zijwaartse fout: haaks op de looprichting, wisselend van kant.
    const zij = foutM * Math.sin(fase) * (0.6 + 0.4 * Math.sin(fase * 0.37));
    uit.push({
      pos: destination(echt, (richting + 90) % 360, zij),
      accuracy: 8 + Math.abs(zij) * 1.5,
    });
    langs += stapM;
  }
  return uit;
}

const reeks = metingen();
console.log(`${reeks.length} metingen, ruis tot ±10 m.\n`);

/* ── A. Peiling tussen twee metingen ─────────────────────────────────────── */
function bronBeweging() {
  let koers = null, vorig = null, draai = 0;
  for (const m of reeks) {
    if (vorig && distM(vorig, m.pos) >= 6) {
      const nieuw = bearing(vorig, m.pos);
      vorig = m.pos;
      if (koers == null) koers = nieuw;
      else {
        // Zoals het was: mengen met vaste weging, geen dode zone.
        const w = 0.35, r = Math.PI / 180;
        const x = Math.cos(koers * r) * (1 - w) + Math.cos(nieuw * r) * w;
        const y = Math.sin(koers * r) * (1 - w) + Math.sin(nieuw * r) * w;
        const na = (Math.atan2(y, x) / r + 360) % 360;
        draai += Math.abs(hoekVerschil(koers, na));
        koers = na;
      }
    } else if (!vorig) vorig = m.pos;
  }
  return draai;
}

/* ── B. Richting van de route, met dode zone ─────────────────────────────── */
function bronRoute() {
  const tracker = createTracker(route);
  let koers = null, draai = 0, opDeLijn = 0, ernaast = 0;
  const spoor = [];

  for (const m of reeks) {
    const pr = tracker.update({ lon: m.pos[0], lat: m.pos[1], accuracy: m.accuracy });
    const laatste = spoor[spoor.length - 1];
    if (!laatste || distM(laatste, m.pos) >= 15) spoor.push(m.pos);

    let nieuw = null;
    if (pr.koersOpRoute != null && pr.offRouteM <= 25) { nieuw = pr.koersOpRoute; opDeLijn++; }
    else {
      ernaast++;
      for (let i = spoor.length - 1; i >= 0; i--) {
        if (distM(spoor[i], m.pos) >= BASISLIJN_M) { nieuw = bearing(spoor[i], m.pos); break; }
      }
    }
    if (nieuw == null) continue;
    if (koers == null) { koers = nieuw; continue; }
    if (Math.abs(hoekVerschil(koers, nieuw)) > DODE_ZONE) {
      draai += Math.abs(hoekVerschil(koers, nieuw));
      koers = nieuw;
    }
  }
  return { draai, opDeLijn, ernaast };
}

const a = bronBeweging();
const b = bronRoute();

console.log('Totaal gedraaid over de hele wandeling');
console.log(`  uit beweging (was):   ${Math.round(a)}°`);
console.log(`  uit de route (nu):    ${Math.round(b.draai)}°`);
console.log(`  de bochten zelf:      ${Math.round(bochten)}°`);
console.log(`  overtollig gewiebel:  ${Math.round(a - bochten)}° → ${Math.round(b.draai - bochten)}°\n`);
console.log(`Op de lijn geprojecteerd bij ${b.opDeLijn} van ${b.opDeLijn + b.ernaast} metingen.\n`);

ok('de routebron draait minder dan de bewegingsbron', b.draai < a,
   `${Math.round(b.draai)}° tegen ${Math.round(a)}°`);
ok('en minstens twee keer zo rustig', b.draai * 2 < a,
   `factor ${(a / Math.max(1, b.draai)).toFixed(1)}`);
ok('maar hij maakt de bochten wél', b.draai > bochten * 0.5,
   `${Math.round(b.draai)}° tegen ${Math.round(bochten)}° aan echte bochten`);
ok('vrijwel altijd op de lijn te projecteren', b.opDeLijn / (b.opDeLijn + b.ernaast) > 0.9,
   `${Math.round(b.opDeLijn / (b.opDeLijn + b.ernaast) * 100)}%`);

/* ── Ver van de route: dan moet de terugval het overnemen ────────────────── */
console.log('\nHonderd meter van de route af');
{
  const tracker = createTracker(route);
  const spoor = [];
  let gebruikteTerugval = 0, kreegKoers = 0;
  // Een zijpad inlopen: haaks weg van de route, 150 m lang.
  const startPunt = puntOp(leg.coords, leg.distanceM * 0.4);
  const weg = (koersOverLijn(leg.coords, leg.distanceM * 0.4, 25) ?? 0) + 90;
  for (let d = 0; d <= 150; d += 5) {
    const pos = destination(startPunt, weg, d);
    const pr = tracker.update({ lon: pos[0], lat: pos[1], accuracy: 10 });
    const laatste = spoor[spoor.length - 1];
    if (!laatste || distM(laatste, pos) >= 15) spoor.push(pos);
    if (pr.offRouteM > 25) {
      gebruikteTerugval++;
      for (let i = spoor.length - 1; i >= 0; i--) {
        if (distM(spoor[i], pos) >= BASISLIJN_M) { kreegKoers++; break; }
      }
    }
  }
  ok('de terugval wordt echt gebruikt', gebruikteTerugval > 10, `${gebruikteTerugval} metingen`);
  ok('en levert dan ook een richting op', kreegKoers > gebruikteTerugval * 0.6,
     `${kreegKoers} van ${gebruikteTerugval}`);
}

console.log(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
process.exit(fouten ? 1 : 0);

/* ── Hulp ─────────────────────────────────────────────────────────────────── */
function cumulatief(coords) {
  const uit = [0];
  for (let i = 1; i < coords.length; i++) uit.push(uit[i - 1] + distM(coords[i - 1], coords[i]));
  return uit;
}
function puntOp(coords, along) {
  cumCache = cumCache || cumulatief(coords);
  const cum = cumCache;
  const doel = Math.max(0, Math.min(cum[cum.length - 1], along));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < doel) i++;
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : (doel - cum[i - 1]) / span;
  const a = coords[i - 1], b = coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function koersOverLijn(coords, along, spanM) {
  const a = puntOp(coords, along);
  const b = puntOp(coords, along + spanM);
  return distM(a, b) < 1 ? null : bearing(a, b);
}
