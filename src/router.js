/* ============================================================================
   Routeren met BRouter. Publieke instantie, geen key, CORS werkt vanuit de
   browser (gemeten).

   Profiel: 'hiking-beta'. Níet 'trekking' — dat is een fietsprofiel en gaf op
   dezelfde lus 27 minuten waar hiking-beta 112 minuten geeft. Zie
   spike/BEVINDINGEN.md.
   ============================================================================ */

const ENDPOINT = 'https://brouter.de/brouter';
export const WALK_PROFILE = 'hiking-beta';

/**
 * Routeert een gesloten lus: start → punten → start.
 * @param {[number,number]} start   [lon, lat]
 * @param {Array<[number,number]>} vias
 * @returns {Promise<{distanceM:number, timeS:number, coords:Array, ascendM:number}>}
 */
export function routeLoop(start, vias, { profile = WALK_PROFILE, timeoutMs = 20000, alt = 0 } = {}) {
  return request([start, ...vias, start], profile, timeoutMs, alt);
}

async function request(seq, profile, timeoutMs, alt = 0) {
  const lonlats = seq.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|');
  const url = `${ENDPOINT}?lonlats=${lonlats}&profile=${profile}&alternativeidx=${alt}&format=geojson`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new RouteError(`BRouter gaf ${res.status}`);

  // BRouter antwoordt op sommige fouten met status 200 en platte tekst.
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new RouteError(`BRouter: ${text.slice(0, 200)}`); }

  const feat = json.features && json.features[0];
  if (!feat || !feat.geometry) throw new RouteError('BRouter gaf geen route terug');

  const p = feat.properties || {};
  return {
    distanceM: Number(p['track-length']) || 0,
    timeS: Number(p['total-time']) || 0,
    ascendM: Number(p['filtered ascend']) || 0,
    coords: feat.geometry.coordinates,
    ...surfaceShares(p.messages),
  };
}

/* Wegsoorten die als "paadje" tellen. cycleway staat er bewust niet bij: een
 * asfaltfietspad is prima lopen maar het is niet waar je een kind mee naar
 * buiten lokt. */
const PATH_KINDS = ['path', 'footway', 'track', 'pedestrian', 'steps', 'bridleway'];

/**
 * BRouter geeft per segment de way-tags mee. Daaruit valt te berekenen hoeveel
 * van de route over paadjes loopt en hoeveel over asfalt — precies het verschil
 * tussen een wandelroute en een ommetje langs de weg.
 *
 * Gemeten in Twickel: kostenfactoren van wegen opschroeven verschuift dit
 * nauwelijks (53% → 55%), want het padennetwerk hangt daar niet aan elkaar. Wat
 * wél werkt is meerdere kandidaten maken en op dit getal kiezen.
 */
export function surfaceShares(messages) {
  if (!Array.isArray(messages) || messages.length < 2) {
    return { pathShare: null, byKind: {} };
  }
  const head = messages[0];
  const iDist = head.indexOf('Distance');
  const iTags = head.indexOf('WayTags');
  if (iDist < 0 || iTags < 0) return { pathShare: null, byKind: {} };

  const byKind = {};
  let total = 0, path = 0;

  for (let i = 1; i < messages.length; i++) {
    const d = Number(messages[i][iDist]) || 0;
    if (!d) continue;
    total += d;
    const m = /highway=([a-z_]+)/.exec(messages[i][iTags] || '');
    const kind = m ? m[1] : 'onbekend';
    byKind[kind] = (byKind[kind] || 0) + d;
    if (PATH_KINDS.includes(kind)) path += d;
  }
  return { pathShare: total ? path / total : null, byKind };
}

/**
 * Heen & terug: routeer de enkele reis naar buiten en spiegel de geometrie
 * terug. Niet start → punten → start laten routeren, want dan zoekt BRouter een
 * ándere terugweg en maak je er alsnog een rondje van.
 */
export async function routeOutAndBack(start, vias, opts = {}) {
  if (!vias.length) throw new RouteError('Heen & terug heeft minstens één punt nodig');
  const out = await routeLoopless(start, vias, opts);
  const back = out.coords.slice(0, -1).reverse();
  return {
    distanceM: out.distanceM * 2,
    timeS: out.timeS * 2,
    ascendM: out.ascendM * 2,
    coords: [...out.coords, ...back],
    // Dezelfde weg terug, dus dezelfde verhouding pad/asfalt.
    pathShare: out.pathShare,
    byKind: out.byKind,
  };
}

/** Enkele reis: start → punten, zonder terug. */
async function routeLoopless(start, vias, { profile = WALK_PROFILE, timeoutMs = 20000 } = {}) {
  const seq = [start, ...vias];
  return request(seq, profile, timeoutMs);
}

export class RouteError extends Error {
  constructor(message) { super(message); this.name = 'RouteError'; }
}
