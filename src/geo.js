/* ============================================================================
   Geo-rekenwerk. Coördinaten zijn overal [lon, lat] — de volgorde van GeoJSON,
   van MapLibre en van BRouter, dus die houden we aan om conversiefouten te
   vermijden.
   ============================================================================ */

const R = 6371008.8;                       // gemiddelde aardradius, meter
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

export function distM([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Peiling van a naar b, 0–360° met noord = 0. */
export function bearing([lon1, lat1], [lon2, lat2]) {
  const φ1 = rad(lat1), φ2 = rad(lat2), Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function destination([lon, lat], bearingDeg, dM) {
  const δ = dM / R, θ = rad(bearingDeg), φ1 = rad(lat), λ1 = rad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
                             Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((deg(λ2) + 540) % 360) - 180, deg(φ2)];
}

/** Kleinste hoek tussen twee peilingen, 0–180°. */
export function bearingDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function pathLengthM(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += distM(coords[i - 1], coords[i]);
  return sum;
}

/** Middelpunt van een lijnstuk — een brug is in de tiles een LineString, maar
 *  wij willen er één punt van maken. */
export function midpointOf(geometry) {
  const line = flattenToLine(geometry);
  if (line.length === 1) return line[0];
  const half = pathLengthM(line) / 2;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = distM(line[i - 1], line[i]);
    if (walked + seg >= half) {
      const t = seg === 0 ? 0 : (half - walked) / seg;
      return [
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
      ];
    }
    walked += seg;
  }
  return line[line.length - 1];
}

function flattenToLine(geometry) {
  let c = geometry.coordinates;
  while (Array.isArray(c[0]) && Array.isArray(c[0][0])) c = c[0];
  return Array.isArray(c[0]) ? c : [c];
}

/* ── Tour-ordening ─────────────────────────────────────────────────────────
   Voor het aantal punten waar we mee werken (2–6) is dichtstbijzijnde-buur
   gevolgd door 2-opt ruim genoeg, en veel voorspelbaarder dan iets slimmers.
   ───────────────────────────────────────────────────────────────────────── */

/** Ordent punten tot een gesloten lus die bij `start` begint en eindigt.
 *  Geeft alleen de tussenpunten terug, in looporde. */
export function orderTour(start, points) {
  if (points.length < 2) return points.slice();

  // dichtstbijzijnde buur
  const rest = points.slice();
  const tour = [];
  let cur = start;
  while (rest.length) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = distM(cur, rest[i].coord);
      if (d < bestD) { bestD = d; best = i; }
    }
    cur = rest[best].coord;
    tour.push(rest.splice(best, 1)[0]);
  }

  // 2-opt op de gesloten lus
  const loopCost = (t) => {
    const seq = [start, ...t.map(p => p.coord), start];
    return pathLengthM(seq);
  };
  let improved = true, cost = loopCost(tour);
  while (improved) {
    improved = false;
    for (let i = 0; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const cand = tour.slice();
        cand.splice(i, j - i + 1, ...tour.slice(i, j + 1).reverse());
        const c = loopCost(cand);
        if (c < cost - 1) { tour.splice(0, tour.length, ...cand); cost = c; improved = true; }
      }
    }
  }
  return tour;
}
