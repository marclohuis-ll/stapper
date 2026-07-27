/* ============================================================================
   Route aanpassen — de laag onder het slepen.

   Een gegenereerde route is een polyline plus de punten waar hij door moest. Om
   hem te kunnen verslepen heb je die punten expliciet nodig als geordende lijst,
   inclusief punten die alleen de vórm bepalen en niks te zien zijn.

   Twee soorten waypoint, en dat onderscheid is inhoudelijk:
     poi    — een punt onderweg. Dat is de inhoud; je verplaatst het niet, je
              haalt het er hoogstens uit.
     shape  — een vormpunt dat jij met een sleep hebt gezet. Alleen om de route
              ergens anders langs te laten lopen.

   Hier zit geen kaart en geen DOM in: alleen het model, BRouter en de meetwaarden.
   Zo is dit te testen zonder dat er iets gerenderd hoeft te worden.
   ============================================================================ */

import { distM, overlapFraction } from './geo.js';
import { routeLoop, RouteError } from './router.js';

/* ── Model ──────────────────────────────────────────────────────────────── */

/** Bouwt de bewerkbare lijst uit een gegenereerde route. */
export function waypointsFromRoute(route) {
  const start = route.coords[0];
  return [
    { coord: start, kind: 'start' },
    ...route.pois.map((p) => ({ coord: p.coord, kind: 'poi', poi: p })),
  ];
}

/** De coördinaten die naar de router gaan: start → via's → terug naar start. */
export const viasOf = (waypoints) => waypoints.slice(1).map((w) => w.coord);
export const startOf = (waypoints) => waypoints[0].coord;

/**
 * Waar ligt elk waypoint op de polyline?
 *
 * Nodig om te weten tussen wélke twee waypoints je de lijn hebt gepakt. BRouter
 * geeft één doorlopende lijn terug zonder te zeggen waar de via's zitten, dus we
 * zoeken per waypoint de naaste hoekpunt-index. Die indices verdelen de lijn in
 * segmenten.
 */
export function waypointPositions(coords, waypoints) {
  const uit = [];
  let vanaf = 0;
  for (const w of waypoints) {
    let best = vanaf, bestD = Infinity;
    // Vooruit zoeken vanaf het vorige waypoint: bij een route die over zichzelf
    // heen loopt zou een globale zoektocht het verkeerde punt kiezen.
    for (let i = vanaf; i < coords.length; i++) {
      const d = distM(w.coord, coords[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    uit.push(best);
    vanaf = best;
  }
  uit.push(coords.length - 1);            // de terugkeer naar het start
  return uit;
}

/**
 * Je hebt de lijn gepakt bij polyline-index `vertex`. Tussen welke twee
 * waypoints zit dat, en dus waar hoort het nieuwe vormpunt in de lijst?
 * Geeft de index waarop je moet invoegen.
 */
export function insertIndexForVertex(coords, waypoints, vertex) {
  const pos = waypointPositions(coords, waypoints);
  for (let i = 0; i < pos.length - 1; i++) {
    if (vertex >= pos[i] && vertex <= pos[i + 1]) return i + 1;
  }
  return waypoints.length;                // achteraan, vóór de terugkeer
}

export const insertShapePoint = (waypoints, index, coord) => [
  ...waypoints.slice(0, index),
  { coord, kind: 'shape' },
  ...waypoints.slice(index),
];

export const moveWaypoint = (waypoints, index, coord) =>
  waypoints.map((w, i) => (i === index ? { ...w, coord } : w));

/** Het startpunt kan er niet uit; de rest wel. */
export const removeWaypoint = (waypoints, index) =>
  (index <= 0 ? waypoints : waypoints.filter((_, i) => i !== index));

/* ── Herrouteren ────────────────────────────────────────────────────────── */

/**
 * Routeert de huidige waypoints en levert dezelfde meetwaarden die de generator
 * ook geeft, zodat de UI dezelfde getallen kan tonen.
 */
export async function reroute(waypoints, { signal } = {}) {
  if (waypoints.length < 2) throw new EditError('Te weinig punten om te routeren.');

  let leg;
  try {
    leg = await routeLoop(startOf(waypoints), viasOf(waypoints));
  } catch (e) {
    if (e instanceof RouteError) {
      throw new EditError('Hier kan geen pad langs. Sleep iets verder van het water of het spoor.');
    }
    throw e;
  }
  if (signal && signal.aborted) return null;

  return {
    coords: leg.coords,
    distanceM: leg.distanceM,
    timeS: leg.timeS,
    pathShare: leg.pathShare,
    byKind: leg.byKind,
    overlap: overlapFraction(leg.coords),
  };
}

/**
 * Wat de elastiek laat zien tijdens het slepen: de bestaande lijn met het
 * gepakte segment vervangen door twee rechte stukken naar je vinger.
 *
 * Rechte lijnen, geen router. Per frame een netwerkcall doen is niet te doen, en
 * een elastiek die achterloopt op je duim voelt gebroken. De echte route komt
 * zodra je even stilstaat of lost.
 */
export function rubberBand(coords, waypoints, insertIndex, fingerCoord) {
  const pos = waypointPositions(coords, waypoints);
  const van = pos[insertIndex - 1] ?? 0;
  const tot = pos[insertIndex] ?? coords.length - 1;
  return [
    ...coords.slice(0, van + 1),
    fingerCoord,
    ...coords.slice(tot),
  ];
}

/** Ruwe lengte van een lijnstuk. */
export function rubberLength(band) {
  let sum = 0;
  for (let i = 1; i < band.length; i++) sum += distM(band[i - 1], band[i]);
  return sum;
}

/**
 * Geschatte lengte van de route terwijl je sleept, voor het duimlabel.
 *
 * Níet de lengte van de elastiek nemen: twee rechte lijnen zijn korter dan het
 * pad dat ze vervangen. Gemeten kwam de elastiek op 6,19 km uit terwijl de echte
 * route 8,54 km werd — een label dat "korter" zegt terwijl je route langer wordt
 * is erger dan geen label.
 *
 * Dus: van de huidige afstand het stuk aftrekken dat je vervangt, en de nieuwe
 * omweg erbij tellen met een omwegfactor, want over paden loop je niet rechtdoor.
 * `detour` komt uit de vorige echte routering, dus de schatting wordt beter naarmate
 * je sleept.
 *
 * Blijft een schatting. Gemeten over twaalf sleeprichtingen en -afstanden zit hij
 * er tussen −9% en +25% naast, en geen enkele opslagfactor doet het overal goed:
 * naar de ene kant staat een pad, naar de andere kant moet de router om. Daarom
 * hoort de UI dit als schatting te tonen (met een ≈) en pas te waarschuwen dat de
 * route te lang wordt als de échte routering binnen is. Een label dat een afstand
 * belooft die het niet kan waarmaken is erger dan een label dat "ongeveer" zegt.
 */
const ESTIMATE_UPLIFT = 1.2;   // best gebalanceerd uit de meting

export function estimateLength(coords, waypoints, insertIndex, fingerCoord, {
  baseDistanceM, detour = 1.45,
}) {
  detour *= ESTIMATE_UPLIFT;
  const pos = waypointPositions(coords, waypoints);
  const van = pos[insertIndex - 1] ?? 0;
  const tot = pos[insertIndex] ?? coords.length - 1;

  const vervangen = rubberLength(coords.slice(van, tot + 1));
  const nieuw = distM(coords[van], fingerCoord) + distM(fingerCoord, coords[tot]);
  return Math.max(0, baseDistanceM - vervangen + nieuw * detour);
}

/** Omwegfactor uit een echte routering, om de volgende schatting te ijken. */
export function detourOf(coords, waypoints) {
  const recht = waypoints.reduce((sum, w, i) => (
    i === 0 ? 0 : sum + distM(waypoints[i - 1].coord, w.coord)
  ), 0) + distM(waypoints[waypoints.length - 1].coord, waypoints[0].coord);
  const echt = rubberLength(coords);
  return recht > 0 ? Math.min(3, Math.max(1.05, echt / recht)) : 1.45;
}

/* ── Ongedaan maken ─────────────────────────────────────────────────────── */

/**
 * Eén stap terug moet altijd kunnen: een misgesleepte route repareer je niet
 * door nóg een keer te slepen.
 */
export function createHistory(initial, limit = 20) {
  const stack = [initial];
  return {
    get current() { return stack[stack.length - 1]; },
    get canUndo() { return stack.length > 1; },
    get depth() { return stack.length - 1; },
    push(state) {
      stack.push(state);
      if (stack.length > limit + 1) stack.shift();
      return state;
    },
    undo() {
      if (stack.length > 1) stack.pop();
      return stack[stack.length - 1];
    },
    reset(state) { stack.length = 0; stack.push(state); return state; },
  };
}

export class EditError extends Error {
  constructor(message) { super(message); this.name = 'EditError'; }
}
