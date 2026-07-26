/* ============================================================================
   Plek zoeken op naam, via Nominatim.

   Nodig omdat "vanaf waar je nu staat" niet genoeg is: je wil thuis een route
   voor morgen kunnen maken, en een kaart naar Twente schuiven vanaf je bank is
   onbegonnen werk.

   Nominatim is een gratis publieke dienst met een gebruiksbeleid: maximaal één
   verzoek per seconde en een herkenbare herkomst. Daarom één aanroep per
   zoekactie van de gebruiker — geen zoeken-terwijl-je-typt — en een minimale
   tussentijd die we zelf afdwingen.
   ============================================================================ */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;

let laatsteAanroep = 0;

/**
 * @param {string} vraag
 * @returns {Promise<Array<{naam:string, lat:number, lon:number}>>}
 */
export async function zoekPlaats(vraag, { limit = 5, timeoutMs = 10000 } = {}) {
  const q = String(vraag || '').trim();
  if (q.length < 2) return [];

  const wacht = MIN_INTERVAL_MS - (Date.now() - laatsteAanroep);
  if (wacht > 0) await new Promise((r) => setTimeout(r, wacht));
  laatsteAanroep = Date.now();

  const url = `${ENDPOINT}?${new URLSearchParams({
    q, format: 'jsonv2', limit: String(limit), addressdetails: '0',
  })}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const json = await res.json();
    return (Array.isArray(json) ? json : [])
      .map((r) => ({
        naam: korteNaam(r.display_name),
        lat: Number(r.lat),
        lon: Number(r.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  } finally {
    clearTimeout(timer);
  }
}

/* display_name is een hele adresketen tot en met het land. De eerste drie delen
 * zijn genoeg om te zien of het de plek is die je bedoelde. */
function korteNaam(displayName) {
  const delen = String(displayName || '').split(',').map((s) => s.trim()).filter(Boolean);
  return delen.slice(0, 3).join(', ') || 'Onbekende plek';
}
