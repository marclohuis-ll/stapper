/* ============================================================================
   Voortgang langs een route.

   Kern is het projecteren van je GPS-positie op de routelijn. Dat lijkt een
   simpele "zoek het dichtstbijzijnde punt", maar dat is fout bij een route die
   over zichzelf heen loopt — en heen-en-terug doet dat per definitie, want de
   terugweg is dezelfde lijn gespiegeld. Een globale zoektocht zou je op de
   terugweg meteen aan het eind plakken.

   Daarom zoeken we in een venster rond de vorige positie en laten we de
   voortgang niet terugvallen. Dat is ook prettiger bij slechte fixes onder een
   bladerdek: één wilde meting zet je niet 2 km terug.
   ============================================================================ */

import { distM } from './geo.js';

const WINDOW_M = 300;        // hoe ver vooruit en achteruit we zoeken
const ARRIVE_BASE = 40;      // basisdrempel voor "je bent er" (meter)
const ARRIVE_MAX = 90;
const PASSED_OFFLINE_M = 60; // tot hoe ver van de lijn "erlangs gelopen" nog geldt
const REACQUIRE_M = 150;     // hierboven zoeken we de hele lijn opnieuw af

/** Cumulatieve afstand per punt van de lijn. */
function cumulative(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + distM(coords[i - 1], coords[i]));
  return out;
}

/** Dichtstbijzijnde punt op segment a→b, als fractie t plus de afstand ernaartoe. */
function projectOnSegment(p, a, b) {
  // Lokaal vlak benaderen is op segmentlengtes van tientallen meters ruim genoeg
  // en veel goedkoper dan bol-meetkunde per segment.
  const kx = Math.cos(a[1] * Math.PI / 180);
  const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1];
  const px = p[0] * kx, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const snapped = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { t, snapped, dist: distM(p, snapped) };
}

/**
 * Houdt de voortgang over één route bij.
 *
 * @param {{coords:Array, pois:Array, distanceM:number, kidTimeS:number}} route
 * @param {{walkedM:number, reached:number[]}} [hervat] eerder bewaarde voortgang.
 *   Bestaat omdat een per ongeluk herladen pagina anders je hele wandeling wist —
 *   en je staat op dat moment in het bos, niet achter een bureau.
 */
export function createTracker(route, hervat = null) {
  const coords = route.coords;
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] || route.distanceM || 0;

  // Elk punt onderweg krijgt zijn plek op de lijn, zodat we weten wat "volgende"
  // is en hoeveel meter dat nog is langs het pad — niet hemelsbreed.
  const pois = route.pois.map((p, i) => {
    let best = { dist: Infinity, along: 0 };
    for (let s = 0; s < coords.length - 1; s++) {
      const pr = projectOnSegment(p.coord, coords[s], coords[s + 1]);
      if (pr.dist < best.dist) {
        best = { dist: pr.dist, along: cum[s] + (cum[s + 1] - cum[s]) * pr.t };
      }
    }
    return { ...p, index: i, along: best.along, offLineM: best.dist, reached: false };
  }).sort((a, b) => a.along - b.along);

  let lastIndex = 0;          // segmentindex van de vorige projectie
  let walked = 0;             // meters langs de lijn, loopt nooit terug
  let offRoute = 0;

  if (hervat) {
    walked = Math.max(0, Math.min(total, Number(hervat.walkedM) || 0));
    // Het zoekvenster moet ook mee terug: begint dat op 0 terwijl je halverwege
    // bent, dan projecteert de eerste meting je op het begin van de route en denkt
    // de app dat je opnieuw begint.
    while (lastIndex < cum.length - 2 && cum[lastIndex + 1] < walked) lastIndex++;
    const gedaan = new Set(hervat.reached || []);
    for (const p of pois) if (gedaan.has(p.index)) p.reached = true;
  }

  return {
    total,
    pois,

    /** Genoeg om deze wandeling later precies zo terug te zetten. */
    snapshot() {
      return {
        walkedM: walked,
        reached: pois.filter((p) => p.reached).map((p) => p.index),
      };
    },

    /** @param {{lat:number, lon:number, accuracy:number}} position */
    update(position) {
      const p = [position.lon, position.lat];

      // Zoekvenster rond de vorige plek op de lijn.
      let from = lastIndex, to = lastIndex;
      while (from > 0 && cum[lastIndex] - cum[from] < WINDOW_M) from--;
      while (to < coords.length - 2 && cum[to] - cum[lastIndex] < WINDOW_M) to++;

      let best = { dist: Infinity, along: walked, index: lastIndex, snapped: p };
      for (let s = from; s <= to; s++) {
        const pr = projectOnSegment(p, coords[s], coords[s + 1]);
        if (pr.dist < best.dist) {
          best = {
            dist: pr.dist, index: s, snapped: pr.snapped,
            along: cum[s] + (cum[s + 1] - cum[s]) * pr.t,
          };
        }
      }

      /* Ver buiten het venster: dan is de vorige plek geen goede aanname meer.
       * Dat gebeurt als je een paar minuten geen fix had — onder een dicht
       * bladerdek is dat gewoon zo — en dan projecteert een vensterzoektocht je op
       * de rand van het venster in plaats van waar je bent. Eén keer de hele lijn
       * langs is dan het antwoord; dat is duurder, maar alleen als je verdwaald bent.
       * De voortgang loopt daarna nog steeds nooit terug. */
      if (best.dist > REACQUIRE_M) {
        for (let s = 0; s < coords.length - 1; s++) {
          const pr = projectOnSegment(p, coords[s], coords[s + 1]);
          if (pr.dist < best.dist) {
            best = {
              dist: pr.dist, index: s, snapped: pr.snapped,
              along: cum[s] + (cum[s + 1] - cum[s]) * pr.t,
            };
          }
        }
      }

      lastIndex = best.index;
      offRoute = best.dist;

      // Nooit achteruit: één slechte fix onder de bomen mag je niet terugzetten.
      const previous = walked;
      if (best.along > walked) walked = best.along;

      const threshold = arriveThreshold(position.accuracy);
      for (const poi of pois) {
        if (poi.reached) continue;

        // Dicht genoeg bij het punt zelf.
        if (distM(p, poi.coord) <= threshold) { poi.reached = true; continue; }

        // Of: je bent er langs gelopen. Alleen op de meetmomenten kijken is niet
        // genoeg — onder een bladerdek vallen updates weg en dan spring je zo
        // over een punt heen zonder ooit binnen de drempel te zijn gemeten.
        // Ligt het punt vlak langs de lijn en is je voortgang er voorbij, dan
        // ben je erlangs geweest, hoe grof de meting ook was.
        if (poi.offLineM <= PASSED_OFFLINE_M &&
            previous <= poi.along + threshold && walked >= poi.along - threshold) {
          poi.reached = true;
        }
      }

      const next = pois.find((x) => !x.reached) || null;

      return {
        walkedM: walked,
        remainingM: Math.max(0, total - walked),
        percent: total ? Math.min(100, Math.round(walked / total * 100)) : 0,
        offRouteM: offRoute,
        snapped: best.snapped,
        next,
        nextDistanceM: next ? distM(p, next.coord) : null,
        nextAlongM: next ? Math.max(0, next.along - walked) : null,
        reachedCount: pois.filter((x) => x.reached).length,
        threshold,
        done: total > 0 && walked >= total - 60,
      };
    },

    /** Handmatig als gevonden markeren — het ontsnappingsluik. */
    markReached(index) {
      const poi = pois.find((p) => p.index === index);
      if (poi) poi.reached = true;
    },

    reset() { lastIndex = 0; walked = 0; pois.forEach((p) => { p.reached = false; }); },
  };
}

/**
 * Hoe dicht moet je bij een punt zijn voordat het meetelt.
 *
 * Onder een bladerdek is GPS 10 tot 30 meter onnauwkeurig, soms slechter. Een
 * strakke drempel betekent een huilend kind dat óp de brug staat terwijl de app
 * zegt dat het er nog niet is. Dat is een veel ergere fout dan een sticker die
 * iets te vroeg komt, dus we rekenen de gerapporteerde nauwkeurigheid mee.
 */
export function arriveThreshold(accuracyM = 0) {
  const acc = Number.isFinite(accuracyM) ? accuracyM : 0;
  return Math.min(ARRIVE_MAX, Math.max(ARRIVE_BASE, acc * 1.5));
}
