/* ============================================================================
   Geocaches van opencaching.nl (OKAPI).

   Beslissing 8. De API van geocaching.com is partner-gated en scrapen is in
   strijd met hun voorwaarden, dus dit is de open bron die overblijft — met
   dunnere dekking, wat je in de resultaten gaat merken.

   De consumer key komt uit de instellingen, niet uit de broncode: de repo is
   publiek en een sleutel die je commit is een sleutel die je weggeeft.

   Nagerekend tegen de echte apiref (juli 2026), zonder sleutel — die is publiek:
     - `center` is "lat|lon" in hele graden met een punt
     - `radius` is in kílometers, niet in meters zoals de rest van OKAPI
     - `status` mag Available | Temporarily unavailable | Archived
     - `limit` is 1..500
     - search/nearest geeft `{results: [codes], more: bool}`
     - caches/geocaches geeft een dictionary op cache-code, vandaar Object.values
     - `location` is óók "lat|lon", dus omdraaien naar [lon, lat]
     - CORS: `Access-Control-Allow-Origin: *`, dus dit kan gewoon uit de browser
     - een foute sleutel geeft 400 met een JSON-body die zegt wát er mis is

   Wat nog niet met een echte sleutel gelopen heeft, is het antwoord zelf. De code
   faalt daarom bewust stil: geen sleutel of een fout antwoord levert nul caches
   en laat de routegeneratie ongemoeid.
   ============================================================================ */

const BASE = 'https://www.opencaching.nl/okapi/services';
export const SIGNUP_URL = 'https://www.opencaching.nl/okapi/signup.html';

/* De acht soorten die op alle OKAPI-installaties bestaan. In het Nederlands, want
 * "Quiz" zegt een kind van zes niks en het staat straks in zijn speurtocht. */
const TYPE_NL = {
  Traditional: 'gewone cache',
  Multi: 'multicache',
  Quiz: 'puzzelcache',
  Moving: 'reizende cache',
  Virtual: 'virtuele cache',
  Webcam: 'webcamcache',
  Event: 'evenement',
  Other: 'bijzondere cache',
};

/**
 * Caches in de buurt.
 *
 * `attribution_note` en `url` zijn geen extraatjes: de Opencaching.NL Data License
 * eist naamsvermelding, en omdat wij geen cachebeschrijvingen tonen moet dat via
 * dit aparte veld. De link naar de cachepagina hoort daar volgens de voorwaarden
 * bij. Haal je die velden niet op, dan mag je de data niet gebruiken.
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
      fields: 'code|name|location|type|status|url|attribution_note',
      consumer_key: key,
    }, timeoutMs);

    return Object.values(detail || {})
      .map(parseCache)
      .filter(Boolean);
  } catch (e) {
    // Stil falen: een route zonder caches is beter dan geen route.
    console.warn('geocaches ophalen mislukt:', e.message);
    return [];
  }
}

function parseCache(c) {
  if (!c || !c.location) return null;
  const [lat, lon] = String(c.location).split('|').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    code: c.code || null,
    naam: c.name || 'Geocache',
    type: c.type || null,
    soort: TYPE_NL[c.type] || 'geocache',
    url: typeof c.url === 'string' && /^https?:\/\//.test(c.url) ? c.url : null,
    attributie: schoonAttributie(c.attribution_note),
    coord: [lon, lat],
  };
}

/**
 * De naamsvermelding is HTML met een link erin, en die komt van een server die
 * niet de onze is. Onbewerkt in de pagina zetten is een gat; de link wéghalen mag
 * niet, want de voorwaarden verbieden uitdrukkelijk het "wijzigen of verbergen van
 * enige vermelding of link".
 *
 * Dus: opnieuw opbouwen met alleen wat een naamsvermelding nodig heeft. Links
 * blijven, alles wat kan uitvoeren verdwijnt.
 */
const TOEGESTAAN = new Set(['A', 'B', 'I', 'EM', 'STRONG', 'BR', 'SPAN']);

/* Van deze verdwijnt ook de ínhoud. Bij al het andere houden we de tekst en gooien
 * we alleen het omhulsel weg — verbergen van een vermelding mag niet — maar de
 * broncode van een script als zichtbare tekst is geen vermelding. */
const INHOUD_WEG = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
                            'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH']);

export function schoonAttributie(html) {
  if (!html || typeof html !== 'string') return null;
  if (typeof DOMParser === 'undefined') {
    // Buiten de browser (de probe): alleen de tekst, en scriptinhoud eerst eruit.
    return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, '').trim() || null;
  }

  const bron = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstChild;
  const doel = document.createElement('span');

  const kopieer = (van, naar) => {
    for (const kind of van.childNodes) {
      if (kind.nodeType === 3) { naar.appendChild(document.createTextNode(kind.nodeValue)); continue; }
      if (kind.nodeType !== 1) continue;
      // Hoofdletters afdwingen: HTML-elementen geven 'SCRIPT' maar elementen
      // binnen svg of math geven 'script'. Zonder dit glipt <svg><script> erdoor.
      const tag = kind.tagName.toUpperCase();
      if (INHOUD_WEG.has(tag)) continue;
      if (!TOEGESTAAN.has(tag)) { kopieer(kind, naar); continue; }
      const nieuw = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = kind.getAttribute('href') || '';
        // Alleen http(s): javascript: en data: horen hier niet.
        if (!/^https?:\/\//i.test(href)) { kopieer(kind, naar); continue; }
        nieuw.setAttribute('href', href);
        nieuw.setAttribute('target', '_blank');
        nieuw.setAttribute('rel', 'noopener noreferrer');
      }
      kopieer(kind, nieuw);
      naar.appendChild(nieuw);
    }
  };
  kopieer(bron, doel);
  return doel.innerHTML.trim() || null;
}

async function get(path, params, timeoutMs) {
  const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new OkapiError(e.name === 'AbortError'
      ? 'opencaching.nl antwoordde niet op tijd'
      : 'geen verbinding met opencaching.nl', 'netwerk');
  } finally {
    clearTimeout(timer);
  }

  const tekst = await res.text();
  let json = null;
  try { json = JSON.parse(tekst); } catch { /* dan blijft json null */ }

  if (!res.ok) {
    // OKAPI zegt in de body wát er mis is; dat is bruikbaarder dan "400".
    const f = json && json.error;
    if (f && f.parameter === 'consumer_key') {
      throw new OkapiError('opencaching.nl kent deze sleutel niet', 'sleutel');
    }
    throw new OkapiError(
      (f && (f.whats_wrong_about_it || f.developer_message)) || `OKAPI gaf ${res.status}`,
      'api');
  }
  return json;
}

/** Werkt deze sleutel? Voor de instelling, zodat je het weet vóór de wandeling. */
export async function testKey(key) {
  if (!key) return { ok: false, soort: 'leeg', reden: 'Er staat nog geen sleutel.' };
  try {
    const r = await get('caches/search/nearest', {
      center: '52.09|5.12', radius: '5', limit: '1', consumer_key: key,
    }, 8000);
    if (!r || !Array.isArray(r.results)) {
      return { ok: false, soort: 'api', reden: 'Onverwacht antwoord van opencaching.nl.' };
    }
    return { ok: true, soort: null, reden: `Werkt — ${r.results.length ? 'caches gevonden' : 'geen caches in de proefstraal'}.` };
  } catch (e) {
    return { ok: false, soort: e.soort || 'api', reden: e.message };
  }
}

export class OkapiError extends Error {
  constructor(message, soort) {
    super(message);
    this.name = 'OkapiError';
    this.soort = soort;
  }
}
