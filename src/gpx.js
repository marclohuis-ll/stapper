/* ============================================================================
   Geocaches uit een GPX-bestand.

   Waarom een bestand en geen API. De dekking in Nederland zit vrijwel helemaal op
   geocaching.com, en daar kom je alleen bij via een partner-gated API (OAuth met
   een geheim dat in een publieke static PWA nergens te verbergen is) of door met
   iemands inloggegevens de site uit te lezen. Het eerste kan niet, het tweede doen
   we niet. Maar een GPX-bestand dat jij zelf exporteert uit c:geo of als pocket
   query is data waar je legitiem een kopie van hebt, en die past beter bij deze
   app dan een API: geen sleutel, werkt offline, en het is jóuw selectie.

   Dit bestand kent geen kaart, geen opslag en geen DOM-opbouw — alleen XML in,
   caches uit. Zo is het na te rekenen met een handvol voorbeeldbestanden.
   ============================================================================ */

/* De acht soorten die je op geocaching.com tegenkomt, plus wat opencaching
 * gebruikt. Alleen de eerste drie hebben een doosje op de gepubliceerde plek —
 * en dat is precies wat een kind gaat zoeken. */
const SOORTEN = {
  'traditional cache':  { nl: 'gewone cache',   doosje: true },
  'traditional':        { nl: 'gewone cache',   doosje: true },
  'multi-cache':        { nl: 'multicache',     doosje: true, eerste: true },
  'multi':              { nl: 'multicache',     doosje: true, eerste: true },
  'letterbox hybrid':   { nl: 'letterbox',      doosje: true },

  // Gepubliceerde coördinaten zijn hier met opzet niet de vindplaats.
  'unknown cache':      { nl: 'puzzelcache',    reden: 'puzzel' },
  'mystery':            { nl: 'puzzelcache',    reden: 'puzzel' },
  'quiz':               { nl: 'puzzelcache',    reden: 'puzzel' },
  'whereigo cache':     { nl: 'wherigo',        reden: 'puzzel' },
  'wherigo cache':      { nl: 'wherigo',        reden: 'puzzel' },

  // Een plek, maar geen doosje: niets om te vinden.
  'virtual cache':      { nl: 'virtuele cache', reden: 'geenDoosje' },
  'virtual':            { nl: 'virtuele cache', reden: 'geenDoosje' },
  'webcam cache':       { nl: 'webcamcache',    reden: 'geenDoosje' },
  'webcam':             { nl: 'webcamcache',    reden: 'geenDoosje' },
  'earthcache':         { nl: 'earthcache',     reden: 'geenDoosje' },
  'project ape cache':  { nl: 'ape cache',      doosje: true },

  // Een moment, geen plek.
  'event cache':               { nl: 'evenement', reden: 'evenement' },
  'mega-event cache':          { nl: 'evenement', reden: 'evenement' },
  'giga-event cache':          { nl: 'evenement', reden: 'evenement' },
  'cache in trash out event':  { nl: 'evenement', reden: 'evenement' },
  'community celebration event': { nl: 'evenement', reden: 'evenement' },
  'event':                     { nl: 'evenement', reden: 'evenement' },
};

/* Terrein 5 betekent per definitie speciale uitrusting: een boot, klimspullen.
 * Dat is geen wandeling met een kind van zes. */
const TERREIN_GRENS = 5;

export class GpxError extends Error {
  constructor(message) { super(message); this.name = 'GpxError'; }
}

/**
 * Leest een GPX-bestand.
 *
 * @param {string} xml
 * @param {{parse?: (s:string)=>Document, bron?: string}} opts
 * @returns {{caches: Array, overgeslagen: object, gevonden: number}}
 */
export function parseGpx(xml, { parse = standaardParser, bron = null } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new GpxError('Het bestand is leeg.');
  }

  const doc = parse(xml);
  if (!doc || doc.getElementsByTagName('parsererror').length) {
    throw new GpxError('Dit is geen geldig GPX-bestand.');
  }
  const wpts = [...doc.getElementsByTagName('*')].filter((el) => el.localName === 'wpt');
  if (!wpts.length) {
    throw new GpxError('Geen punten in dit bestand. Is het een GPX-export van caches?');
  }

  const caches = [];
  const overgeslagen = {
    puzzel: 0, evenement: 0, geenDoosje: 0,
    archief: 0, terrein: 0, geenCoord: 0, hulppunt: 0, onbekend: 0,
  };

  for (const wpt of wpts) {
    const uit = leesWpt(wpt, bron);
    if (uit.reden) overgeslagen[uit.reden]++;
    else caches.push(uit.cache);
  }

  return { caches, overgeslagen, gevonden: wpts.length };
}

function leesWpt(wpt, bron) {
  const lat = Number(wpt.getAttribute('lat'));
  const lon = Number(wpt.getAttribute('lon'));

  const blok = kind(wpt, 'cache');            // <groundspeak:cache>, naamruimte-onafhankelijk
  const type = tekst(wpt, 'type') || '';

  // Parkeerplaatsen, stages en andere hulppunten hebben geen cacheblok en een
  // type dat met "Waypoint" begint. Die horen niet in een speurtocht.
  if (!blok && !/^geocache/i.test(type)) return { reden: 'hulppunt' };

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return { reden: 'geenCoord' };
  }

  // "Geocache|Traditional Cache" → "Traditional Cache"
  const soortRuw = (blok && tekst(blok, 'type')) || type.split('|').pop() || '';
  const soort = SOORTEN[soortRuw.trim().toLowerCase()];
  if (!soort) return { reden: 'onbekend' };
  if (soort.reden) return { reden: soort.reden };

  if (blok) {
    const beschikbaar = (blok.getAttribute('available') || 'true').toLowerCase();
    const gearchiveerd = (blok.getAttribute('archived') || 'false').toLowerCase();
    if (beschikbaar === 'false' || gearchiveerd === 'true') return { reden: 'archief' };
  }

  const terrein = getal(blok && tekst(blok, 'terrain'));
  if (terrein != null && terrein >= TERREIN_GRENS) return { reden: 'terrein' };

  const code = (tekst(wpt, 'name') || '').trim();
  const naam = ((blok && tekst(blok, 'name')) || tekst(wpt, 'urlname') || code || 'Geocache').trim();

  return {
    cache: {
      code: code || `zonder-code-${lat.toFixed(5)},${lon.toFixed(5)}`,
      naam,
      coord: [lon, lat],
      soort: soortRuw.trim(),
      soortNL: soort.nl,
      // Bij een multi is de gepubliceerde plek het eerste station, niet de vondst.
      eersteStation: !!soort.eerste,
      container: (blok && tekst(blok, 'container')) || null,
      difficulty: getal(blok && tekst(blok, 'difficulty')),
      terrain: terrein,
      eigenaar: (blok && (tekst(blok, 'placed_by') || tekst(blok, 'owner'))) || null,
      url: schooneUrl(tekst(wpt, 'url')),
      bron,
      toegevoegd: Date.now(),
    },
  };
}

/* ── Kleine hulpjes ─────────────────────────────────────────────────────────
   Alles op localName, niet op naamruimte-URI: die verschilt per GPX-versie
   (groundspeak/cache/1/0 tegen 1/0/1) en per exportprogramma, en een cache die
   je mist omdat de URI een cijfer anders is, is een cache die je niet gaat vinden.
   ───────────────────────────────────────────────────────────────────────────── */

function kind(el, naam) {
  for (const c of el.children) if (c.localName === naam) return c;
  return null;
}

/** Eerste directe kind met deze naam, als tekst. */
function tekst(el, naam) {
  const c = kind(el, naam);
  return c ? c.textContent.trim() : null;
}

function getal(s) {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Alleen http(s), want dit wordt straks een link in de app. */
function schooneUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}

function standaardParser(xml) {
  if (typeof DOMParser === 'undefined') {
    throw new GpxError('Geen XML-lezer beschikbaar in deze omgeving.');
  }
  return new DOMParser().parseFromString(xml, 'text/xml');
}

/* ── Voor de app ────────────────────────────────────────────────────────────── */

/** In gewone woorden wat er níet is ingeladen, zodat het niet stil verdwijnt. */
export function overslagTekst(o) {
  const delen = [];
  const zeg = (n, enkel, meer) => { if (n) delen.push(`${n} ${n === 1 ? enkel : meer}`); };
  zeg(o.puzzel, 'puzzelcache (coördinaten kloppen niet)', 'puzzelcaches (coördinaten kloppen niet)');
  zeg(o.geenDoosje, 'cache zonder doosje', 'caches zonder doosje');
  zeg(o.evenement, 'evenement', 'evenementen');
  zeg(o.archief, 'gearchiveerde cache', 'gearchiveerde caches');
  zeg(o.terrein, 'cache met terrein 5', 'caches met terrein 5');
  zeg(o.geenCoord, 'cache zonder coördinaten', 'caches zonder coördinaten');
  zeg(o.onbekend, 'cache van een onbekende soort', 'caches van een onbekende soort');
  return delen.join(', ');
}

/** Caches binnen een straal, als POI's voor de generator. */
export function cachesInBuurt(caches, { lat, lon, radiusM }) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180);
  return caches
    .map((c) => {
      const dx = (c.coord[0] - lon) * kx;
      const dy = (c.coord[1] - lat) * 111320;
      return { c, d: Math.hypot(dx, dy) };
    })
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map(({ c, d }) => ({
      category: 'cache',
      label: c.naam,
      name: c.naam,
      icon: 'travel_explore',
      coord: c.coord,
      distFromStart: d,
      soort: metaVan(c),
      url: c.url,
    }));
}

/** Wat er onder de naam komt te staan: soort, hoe zwaar, en of het doosje er ligt. */
function metaVan(c) {
  const delen = [c.soortNL];
  if (c.difficulty != null && c.terrain != null) {
    delen.push(`D${nummer(c.difficulty)}/T${nummer(c.terrain)}`);
  }
  if (c.eersteStation) delen.push('start van een multi');
  return delen.join(' · ');
}

const nummer = (n) => String(n).replace('.', ',');
