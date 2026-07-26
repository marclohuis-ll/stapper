/* ============================================================================
   Geocaches van opencaching.nl (OKAPI).

   Beslissing 8. De API van geocaching.com is partner-gated en scrapen is in
   strijd met hun voorwaarden, dus dit is de open bron die overblijft — met
   dunnere dekking, wat je in de resultaten gaat merken.

   De consumer key komt uit de instellingen, niet uit de broncode: de repo is
   publiek en een sleutel die je commit is een sleutel die je weggeeft.

   ⚠ ONGETEST. Ik had geen consumer key om dit tegen de echte dienst te
   verifiëren. De code faalt daarom bewust stil: geen sleutel of een fout
   antwoord levert nul caches op en laat de routegeneratie ongemoeid. Wat níet
   gecontroleerd is: of de veldnamen en het locatieformaat kloppen.
   ============================================================================ */

const BASE = 'https://www.opencaching.nl/okapi/services';

/**
 * Caches in de buurt.
 * @param {{lat:number, lon:number, radiusM:number, key:string, limit?:number}} opts
 * @returns {Promise<Array<{code:string,naam:string,coord:[number,number],type:string}>>}
 */
export async function searchCaches({ lat, lon, radiusM, key, limit = 20, timeoutMs = 8000 }) {
  if (!key) return [];

  try {
    const codes = await get('caches/search/nearest', {
      center: `${lat}|${lon}`,
      radius: (radiusM / 1000).toFixed(2),
      status: 'Available',
      limit: String(limit),
      consumer_key: key,
    }, timeoutMs);

    const list = codes && codes.results;
    if (!Array.isArray(list) || !list.length) return [];

    const detail = await get('caches/geocaches', {
      cache_codes: list.join('|'),
      fields: 'code|name|location|type|status',
      consumer_key: key,
    }, timeoutMs);

    return Object.values(detail || {})
      .map(parseCache)
      .filter(Boolean);
  } catch {
    // Stil falen: een route zonder caches is beter dan geen route.
    return [];
  }
}

function parseCache(c) {
  if (!c || !c.location) return null;
  // OKAPI geeft de locatie als "52.2470|6.7550".
  const [lat, lon] = String(c.location).split('|').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    code: c.code,
    naam: c.name || 'Geocache',
    type: c.type || null,
    coord: [lon, lat],
  };
}

async function get(path, params, timeoutMs) {
  const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`OKAPI ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Snelle controle of een sleutel werkt, voor de instelling. */
export async function testKey(key) {
  if (!key) return { ok: false, reden: 'geen sleutel' };
  try {
    const r = await get('caches/search/nearest', {
      center: '52.09|5.12', radius: '5', limit: '1', consumer_key: key,
    }, 8000);
    return { ok: Array.isArray(r && r.results), reden: null };
  } catch (e) {
    return { ok: false, reden: e.message };
  }
}
