/* ============================================================================
   De routegenerator — beslissing 6, "punten eerst".

   Geen routeplanner kan "een rondje van 4,5 km langs een speeltuin en een
   bruggetje". Ze doen rondjes óf via-punten, nooit beide. Dus draaien we het
   om: eerst punten kiezen die de gevraagde soorten dekken en die rond het
   startpunt gespreid liggen, dan de router er als gesloten lus door laten
   rijden, en de afstand met een iteratie op de ringradius bijstellen.

   De schaalregel komt uit de meting: drie punten op ~1,6 km van het start gaven
   een lus van 9,4 km, dus lus ≈ 5,9 × ringradius. Vandaar r0 = doel / 6.
   ============================================================================ */

import { bearing, bearingDelta, distM, orderTour, overlapFraction } from './geo.js';
import { routeLoop, routeOutAndBack, RouteError } from './router.js';
import { categoryByKey } from './pois.js';

const DETOUR0 = 1.45;           // startschatting: paden zijn langer dan de rechte lijn
const HARVEST_SLACK = 2.6;      // ruimer oogsten dan r0, want r kan groeien
const MAX_ITERS = 6;            // routercalls per kandidaat
const TOLERANCE = 0.15;         // ±15%, zoals afgesproken
const MAX_ERROR = 0.45;         // daarboven is het geen antwoord op de vraag
const KID_TIME_FACTOR = 1.85;   // wandeltempo → tempo mét een kind (zie hieronder)

/* Een lus door k punten op ringradius r is bij benadering een regelmatige
 * k-hoek: omtrek 2·k·r·sin(π/k). Het echte pad is langer, want je loopt niet
 * rechtdoor — die factor (`detour`) leren we per kandidaat uit de eerste
 * routercall, in plaats van hem te gokken. */
const polygonPerimeter = (k, r) => 2 * k * r * Math.sin(Math.PI / k);
const ringForTarget = (targetM, k, detour) => targetM / (detour * 2 * k * Math.sin(Math.PI / k));

/**
 * @param {object}   opts
 * @param {number}   opts.lat            startpunt
 * @param {number}   opts.lon
 * @param {number}   opts.targetKm       gewenste lusafstand
 * @param {string[]} opts.chips          categorie-keys die onderweg moeten liggen
 * @param {object}   opts.harvester      uit createHarvester()
 * @param {function} [opts.supplement]   optionele Overpass-aanvulling
 * @param {number}   [opts.count]        aantal kandidaten
 * @param {function} [opts.onProgress]   (stap, detail) → void
 */
export async function generateRoutes({
  lat, lon, targetKm, chips, harvester, supplement, shape = 'loop',
  kidFactor = KID_TIME_FACTOR, count = 3, onProgress = () => {},
}) {
  const start = [lon, lat];
  const targetM = targetKm * 1000;
  const harvestR = ringForTarget(targetM, 3, DETOUR0) * HARVEST_SLACK;

  onProgress('oogsten', 'punten in de buurt zoeken');
  const pois = await harvester.collect({ lat, lon, radiusM: harvestR, keys: chips });

  let missing = [];
  if (supplement) {
    const extra = await supplement({ lat, lon, radiusM: harvestR, keys: chips });
    pois.push(...extra.pois);
    missing = extra.failed;
  }

  const available = [...new Set(pois.map((p) => p.category))];
  if (!pois.length) {
    throw new GenerateError('Geen enkel punt gevonden in de buurt van dit startpunt.');
  }

  // Aantal stops: één per gevraagde soort die we ook daadwerkelijk gevonden
  // hebben, met een boven- en ondergrens zodat een rondje van 2 km niet zes
  // stops krijgt en een van 12 km niet één.
  // Alleen de aangevinkte soorten die we ook echt gevonden hebben. Elke soort
  // hierin komt gegarandeerd in de route — dat is de belofte van de chips.
  const wanted = chips.filter((c) => available.includes(c)).slice(0, 6);

  const candidates = [];
  const seen = new Set();

  // Verschuif de sectorgrenzen met een breuk van de sectorbreedte, niet met een
  // breuk van 360°: bij drie stops zijn de sectoren zelf 120°, dus een rotatie
  // van 120° geeft exact dezelfde indeling en dus dezelfde route.
  const usedByOthers = new Set();
  const attempts = [];

  /** Eén ronde kandidaten voor een gegeven set eisen. */
  const runPass = async (subset, tries) => {
    const out = [];
    for (let i = 0; i < tries && out.length < count; i++) {
      onProgress('routeren', `rondje ${candidates.length + out.length + 1} van ${count}`);
      const cand = await buildCandidate({
        start, targetM, wanted: subset, pois, shape,
        offsetFraction: i / tries, usedByOthers, onProgress,
      });
      if (!cand) { attempts.push({ i, subset: subset.join('+'), reason: 'geen route' }); continue; }

      const fingerprint = cand.pois.map((p) => p.coord.join()).sort().join('|');
      const info = {
        i, subset: subset.join('+'), stops: cand.pois.length, ringM: Math.round(cand.ringM),
        km: +(cand.distanceM / 1000).toFixed(2), error: +cand.error.toFixed(3),
        pad: cand.pathShare == null ? null : Math.round(cand.pathShare * 100),
        dubbel: Math.round((cand.overlap ?? 0) * 100),
        cats: cand.pois.map((p) => p.category).join('+'),
      };
      if (seen.has(fingerprint)) { attempts.push({ ...info, reason: 'zelfde punten' }); continue; }
      seen.add(fingerprint);
      cand.pois.forEach((p) => usedByOthers.add(p));
      cand.dropped = wanted.filter((w) => !subset.includes(w));
      out.push(cand);
      attempts.push({ ...info, reason: 'behouden' });
    }
    return out;
  };

  // Meer pogingen dan gevraagde routes: in een gebied waar de punten aan één
  // kant liggen vallen kandidaten samen, en dan wil je nog een schot hebben.
  candidates.push(...await runPass(wanted, count * 2));

  // Haalt niets de marge met álle eisen erin, dan is de afstand niet het
  // probleem maar de combinatie. Eén eis laten vallen levert vaak een rondje op
  // dat wél in de buurt van het doel komt — en dat is een beter aanbod dan een
  // rondje van 9 km voor iemand die om 4,5 km vroeg. Welke eis eruit gaat is
  // niet willekeurig: de soort waarvan het naaste exemplaar het verst weg ligt.
  // Welke eis we laten vallen kiezen we niet zélf. "De categorie waarvan het
  // naaste exemplaar het verst weg ligt" is rekenkundig verdedigbaar en
  // product-technisch fout: dat gooide hier de speeltuin uit een kinder-app.
  // Dus proberen we de twee kansrijkste weglatingen en bieden we ze náást de
  // volledige route aan. De gebruiker ziet dan wat hij inlevert.
  if (!candidates.some((c) => c.error <= MAX_ERROR) && wanted.length > 1) {
    const cost = (key) => Math.min(...pois.filter((p) => p.category === key)
                                        .map((p) => p.distFromStart));
    for (const drop of [...wanted].sort((a, b) => cost(b) - cost(a)).slice(0, 2)) {
      const subset = wanted.filter((w) => w !== drop);
      if (!subset.length) continue;
      onProgress('routeren', `opnieuw zonder ${categoryByKey(drop).label.toLowerCase()}`);
      candidates.push(...await runPass(subset, 2));
    }
  }

  if (!candidates.length) {
    throw new GenerateError('Geen route gevonden. Probeer een andere afstand of minder eisen.');
  }

  // Binnen de marge sorteren op pad-aandeel, daarbuiten op afstandsfout: eerst
  // een antwoord op de vraag, dan zo veel paadjes als mogelijk.
  const byError = (a, b) => {
    const aOk = a.error <= TOLERANCE, bOk = b.error <= TOLERANCE;
    if (aOk !== bOk) return aOk ? -1 : 1;
    if (aOk && bOk) {
      const rondje = (a.overlap ?? 0) - (b.overlap ?? 0);
      if (Math.abs(rondje) > 0.10) return rondje;
      return (b.pathShare ?? 0) - (a.pathShare ?? 0);
    }
    return a.error - b.error;
  };
  const fits = (c) => c.error <= MAX_ERROR;
  const full = candidates.filter((c) => !c.dropped.length).sort(byError);
  const relaxed = candidates.filter((c) => c.dropped.length).sort(byError);

  let kept;
  if (full.some(fits)) {
    kept = spreidKeuze(full.filter(fits), count);
    if (kept.length < count) kept.push(...relaxed.filter(fits).slice(0, count - kept.length));
  } else {
    // Niets haalt de marge met álle eisen erin. Bied de kortere alternatieven
    // aan én de volledige route, met de echte afstand op het kaartje — dan
    // liegt niets en kiest de gebruiker.
    kept = [...relaxed.filter(fits).slice(0, count - 1), ...full.slice(0, 1)];
    if (!kept.length) kept = candidates.slice(0, 1);
  }
  kept.sort(byError);

  return {
    routes: kept.map(decorate(targetM, kept, kidFactor)),
    // Lukt het niet binnen de marge mét alle eisen, dan is dat geen bug maar een
    // feit over het gebied. De UI hoort dat te zeggen in plaats van een rondje
    // van 9 km "4,5 km" te noemen.
    offTarget: !full.some(fits),
    fullCoverageM: full.length ? full[0].distanceM : null,
    covered: wanted,
    missing,
    poiCount: pois.length,
    attempts,          // voor het afstemmen van de heuristiek
  };
}

/* ── Eén kandidaat, met de afstandsiteratie ───────────────────────────────── */

async function buildCandidate({
  start, targetM, wanted, pois, shape = 'loop', offsetFraction, usedByOthers, onProgress,
}) {
  const outback = shape === 'outback';
  let extraStops = 0;
  let detour = DETOUR0;
  // Bij heen-en-terug is de enkele reis de helft, en liggen de punten op een lijn
  // in plaats van op een ring — dus een andere startschatting.
  let r = outback
    ? (targetM / 2) / DETOUR0
    : ringForTarget(targetM, Math.max(wanted.length, 2), detour);
  let best = null;
  const tried = new Set();

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const picked = outback
      ? pickWedge({ start, pois, r, wanted, offsetFraction, usedByOthers })
      : pickCovering({ start, pois, r, wanted, extraStops, offsetFraction, usedByOthers });
    if (picked.length < 1 || (!outback && picked.length < 2)) break;

    // Bij heen-en-terug loop je naar buiten en dezelfde weg terug, dus de
    // volgorde is simpelweg op afstand; een tour-optimalisatie zou hem juist
    // tot een lus willen maken.
    const tour = outback
      ? [...picked].sort((a, b) => a.distFromStart - b.distFromStart)
      : orderTour(start, picked);

    // Dezelfde puntenset opnieuw routeren levert hetzelfde antwoord op.
    const key = tour.map((p) => p.coord.join()).sort().join('|');
    if (tried.has(key)) break;
    tried.add(key);

    let leg;
    try {
      leg = outback
        ? await routeOutAndBack(start, tour.map((p) => p.coord))
        : await routeLoop(start, tour.map((p) => p.coord));
    } catch (e) {
      if (e instanceof RouteError) break;            // router weigert deze set
      throw e;
    }

    const error = Math.abs(leg.distanceM - targetM) / targetM;
    const kandidaat = {
      distanceM: leg.distanceM, timeS: leg.timeS, ascendM: leg.ascendM,
      coords: leg.coords, pois: tour, error, ringM: r, stops: tour.length,
      pathShare: leg.pathShare, byKind: leg.byKind,
      // Bij heen-en-terug ís dubbel lopen de bedoeling; daar niet op afrekenen.
      overlap: outback ? 0 : overlapFraction(leg.coords),
    };
    // Zit de afstand goed, dan is het pad-aandeel de tiebreak: het is een
    // wandelapp, dus tussen twee rondjes van de juiste lengte wint het rondje
    // dat over paadjes gaat.
    if (!best || beter(kandidaat, best)) best = kandidaat;

    if (error <= TOLERANCE) break;

    // Leer de omweg-factor uit wat de router werkelijk deed, en los daarmee de
    // ringradius in één stap op in plaats van er blind naartoe te schalen.
    const straight = outback ? 2 * r : polygonPerimeter(tour.length, r);
    if (straight > 0) detour = clamp(leg.distanceM / straight, 1.05, 3.0);

    if (outback) {
      const next = clamp((targetM / 2) / detour, 120, targetM / 2);
      if (Math.abs(next - r) < 25) break;
      r = next;
      onProgress('routeren', `${(leg.distanceM / 1000).toFixed(1)} km — afstand bijstellen`);
      continue;
    }

    // Te kórt kunnen we oplossen door de ring op te blazen en desnoods een stop
    // toe te voegen. Te lang lossen we alleen met de ring op — een stop laten
    // vallen zou een aangevinkte categorie uit de route gooien, en dat is
    // precies de belofte die we niet mogen breken.
    if (leg.distanceM < targetM && r >= targetM / 2 - 1) extraStops++;

    onProgress('routeren', `${(leg.distanceM / 1000).toFixed(1)} km — afstand bijstellen`);

    const next = ringForTarget(targetM, tour.length + extraStops, detour);
    if (Math.abs(next - r) < 25) break;
    r = clamp(next, 120, targetM / 2);
  }

  return best;
}

/* Geprobeerd en verworpen: BRouter's alternatieve routes (alternativeidx 1 en 2)
 * over dezelfde punten nabellen en de meest paadjesrijke houden. Kostte 3,8 s in
 * plaats van 1,6 s en leverde in Twickel precies nul verbetering — de variatie in
 * pad-aandeel komt van welke púnten je kiest, niet van welke route ertussen. De
 * `alt`-parameter in router.js is blijven staan; die is bruikbaar als je hier ooit
 * op terug wil komen. */

/**
 * Is a beter dan b? Afstand eerst — een rondje van 9 km is geen antwoord op
 * 4,5 km, hoe mooi het pad ook is. Maar zodra beide binnen de marge vallen,
 * beslist het pad-aandeel.
 *
 * Waarom die volgorde: gemeten in Twickel schuift het pad-aandeel tussen
 * kandidaten van 40% naar 55%, en dat verschil is groter dan wat je met
 * routerkosten kunt afdwingen. Zoeken en kiezen werkt hier beter dan sturen.
 */
function beter(a, b) {
  const aOk = a.error <= TOLERANCE, bOk = b.error <= TOLERANCE;
  if (aOk !== bOk) return aOk;
  if (aOk && bOk) {
    // Eerst rondje-zijn: een route waarvan je een derde twee keer loopt is geen
    // rondje, en dat weegt zwaarder dan een paar procent meer pad.
    const rondje = (b.overlap ?? 0) - (a.overlap ?? 0);
    if (Math.abs(rondje) > 0.10) return rondje > 0;

    const pad = (a.pathShare ?? 0) - (b.pathShare ?? 0);
    if (Math.abs(pad) > 0.04) return pad > 0;
  }
  return a.error < b.error;
}

/* ── Puntenselectie: spreid de peilingen ──────────────────────────────────
   Zonder spreiding kiest de selectie de dichtstbijzijnde punten, die vaak
   allemaal dezelfde kant op liggen — dan krijg je een heen-en-terug in plaats
   van een rondje. Daarom verdelen we de horizon in sectoren en nemen per
   sector één punt.
   ───────────────────────────────────────────────────────────────────────── */

function pickCovering({ start, pois, r, wanted, extraStops = 0, offsetFraction = 0, usedByOthers }) {
  const stops = Math.max(wanted.length + extraStops, 2);
  const sectorSize = 360 / stops;
  const offset = offsetFraction * sectorSize;
  const picked = [];
  const used = new Set();

  /* Minimale hoek tussen punten om nog een rondje te krijgen. Bij drie stops
   * hoort dat 120° te zijn; we eisen tweederde daarvan, want anders vind je in
   * een gebied met een gat aan één kant helemaal niets. */
  const minGap = (360 / stops) * 0.66;

  const score = (p, centreBearing) => {
    const b = bearing(start, p.coord);
    const radial = Math.abs(p.distFromStart - r) / r;          // hoe dicht bij de ring
    const off = bearingDelta(b, centreBearing) / 180;
    const reused = usedByOthers?.has(p) ? 0.35 : 0;            // liever een ánder rondje

    // Straf voor te dicht bij een al gekozen punt. Zonder dit lag de hele lus aan
    // één kant zodra een sector leeg was: gemeten peilingen 169°, 16° en 355° —
    // twee punten 21° van elkaar, dus een heen-en-terug in plaats van een rondje.
    let cluster = 0;
    for (const q of picked) {
      const gap = bearingDelta(b, bearing(start, q.coord));
      if (gap < minGap) cluster += (minGap - gap) / minGap * 2.5;
    }
    return radial + off * 0.9 + reused + cluster;
  };

  for (let s = 0; s < stops; s++) {
    const centreBearing = (offset + s * sectorSize + sectorSize / 2) % 360;
    // Elke sector krijgt één aangevinkte soort toegewezen, en die soort is een
    // hárde eis: de gebruiker heeft hem aangevinkt.
    const required = wanted.length ? wanted[s % wanted.length] : null;

    const ofKind = pois.filter((p) => !used.has(p) && (!required || p.category === required));
    if (!ofKind.length) continue;

    // Eerst binnen de sector zoeken. Is die leeg — de punten liggen vaak aan
    // één kant, in Twickel zit een gat in het zuidwesten — dan nemen we het
    // punt van die soort dat het best scoort, waar het ook ligt. De clusterstraf
    // in score() zorgt dat het dan alsnog zo ver mogelijk van de rest ligt.
    const inSector = ofKind.filter(
      (p) => bearingDelta(bearing(start, p.coord), centreBearing) <= sectorSize / 2);
    const pool = inSector.length ? inSector : ofKind;

    const pick = pool.reduce((a, b) => (score(b, centreBearing) < score(a, centreBearing) ? b : a));
    used.add(pick);
    picked.push(pick);
  }

  return fillUp(picked, used, pois, r);
}

/* Heen & terug: alle punten in één windstreek, want je loopt naar buiten en
   dezelfde weg terug. Spreiden zou er juist een rondje van maken. */
function pickWedge({ start, pois, r, wanted, offsetFraction = 0, usedByOthers }) {
  const WEDGE = 70;                                   // graden
  const centreBearing = (offsetFraction * 360) % 360;
  const picked = [];
  const used = new Set();

  const inWedge = (p) => bearingDelta(bearing(start, p.coord), centreBearing) <= WEDGE / 2;

  for (const required of wanted) {
    const ofKind = pois.filter((p) => !used.has(p) && p.category === required);
    if (!ofKind.length) continue;
    const pool = ofKind.filter(inWedge).length ? ofKind.filter(inWedge) : ofKind;
    const score = (p) => Math.abs(p.distFromStart - r) / r +
                         bearingDelta(bearing(start, p.coord), centreBearing) / 180 * 1.4 +
                         (usedByOthers?.has(p) ? 0.35 : 0);
    const pick = pool.reduce((a, b) => (score(b) < score(a) ? b : a));
    used.add(pick);
    picked.push(pick);
  }
  return picked.length ? picked : fillUp(picked, used, pois, r);
}

function fillUp(picked, used, pois, r) {
  // Te weinig punten voor een lus: vul aan met wat er is.
  if (picked.length < 2) {
    for (const p of [...pois].sort((a, b) =>
      Math.abs(a.distFromStart - r) - Math.abs(b.distFromStart - r))) {
      if (used.has(p)) continue;
      used.add(p); picked.push(p);
      if (picked.length >= 2) break;
    }
  }
  return picked;
}

/**
 * Kies wélke kandidaten je laat zien.
 *
 * Drie bijna gelijke rondjes tonen is zonde van de ruimte. Erger: in dit
 * landschap sluiten "echt rondje" en "veel paadjes" elkaar uit — gemeten kwam er
 * een route uit van 76% paadjes waarvan je 62% dubbel liep, en een van 41%
 * paadjes die een net rondje was. Dat is een afweging die de gebruiker moet
 * maken, niet ik. Dus: de beste op de rangschikking, plus de meest paadjesrijke,
 * plus het rondste rondje.
 */
function spreidKeuze(lijst, count) {
  if (lijst.length <= count) return lijst.slice();

  const gekozen = [lijst[0]];
  const rest = () => lijst.filter((c) => !gekozen.includes(c));

  const meestPad = rest().reduce((a, b) => ((b.pathShare ?? 0) > (a.pathShare ?? 0) ? b : a), rest()[0]);
  if (meestPad && gekozen.length < count) gekozen.push(meestPad);

  const rondst = rest().reduce((a, b) => ((b.overlap ?? 1) < (a.overlap ?? 1) ? b : a), rest()[0]);
  if (rondst && gekozen.length < count) gekozen.push(rondst);

  for (const c of rest()) {
    if (gekozen.length >= count) break;
    gekozen.push(c);
  }
  return gekozen;
}

/* ── Presentatie ──────────────────────────────────────────────────────────── */

function decorate(targetM, all, kidFactor = KID_TIME_FACTOR) {
  const maxPois = Math.max(...all.map((c) => c.pois.length));
  const minDist = Math.min(...all.map((c) => c.distanceM));
  const anyRelaxed = all.some((c) => c.dropped.length);

  return (c, i) => {
    // Een route waarvoor we een eis hebben laten vallen zegt dat zelf, zodat de
    // gebruiker ziet wat hij inlevert voor de kortere afstand.
    let badge;
    if (c.dropped && c.dropped.length) {
      badge = 'Zonder ' + c.dropped.map((k) => categoryByKey(k).label.toLowerCase()).join(' en ');
    } else if (anyRelaxed) badge = 'Alles erbij';
    else if (i === 0) badge = 'Beste match';
    else if (c.pois.length === maxPois) badge = 'Meeste te zien';
    else if (c.distanceM === minDist) badge = 'Kortste rondje';
    else badge = 'Andere kant op';

    return {
      id: `r${i}`,
      naam: nameFor(c),
      badge,
      dropped: c.dropped || [],
      km: `${(c.distanceM / 1000).toFixed(1).replace('.', ',')} km`,
      distanceM: c.distanceM,
      tijd: formatDuration(c.timeS * kidFactor),
      walkTimeS: c.timeS,
      kidTimeS: c.timeS * kidFactor,
      punten: `${c.pois.length} punten`,
      pathShare: c.pathShare,
      padLabel: c.pathShare == null ? null : `${Math.round(c.pathShare * 100)}% paadjes`,
      byKind: c.byKind,
      overlap: c.overlap ?? 0,
      // Eerlijk benoemen wat het is. Boven een derde dubbel gelopen mag je het
      // geen rondje meer noemen.
      vormLabel: (c.overlap ?? 0) > 0.33 ? 'deels heen en terug'
               : (c.overlap ?? 0) > 0.15 ? 'rondje met een stukje terug'
               : 'echt rondje',
      omschrijving: describe(c),
      pois: c.pois.map((p, n) => ({
        naam: p.label, icon: p.icon, category: p.category, coord: p.coord,
        meta: metaFor(p),
      })),
      coords: c.coords,
      error: c.error,
    };
  };
}

/* Namen komen uit OSM en 26% van de punten heeft er een. Is er een naam, dan
 * gebruiken we die; anders benoemen we de route naar wat er te zien is. */
function nameFor(c) {
  const named = c.pois.find((p) => p.name);
  if (named) return `Rondje ${named.name}`;
  const counts = tally(c.pois);
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return `Rondje langs ${labelPlural(dominant[0], dominant[1])}`;
}

function describe(c) {
  const parts = Object.entries(tally(c.pois))
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => labelPlural(key, n));
  const list = parts.length > 1
    ? parts.slice(0, -1).join(', ') + ' en ' + parts[parts.length - 1]
    : parts[0];
  return `Langs ${list}.`;
}

function metaFor(p) {
  const cat = categoryByKey(p.category);
  return p.name ? cat.label : `${cat.label} · ${Math.round(p.distFromStart)} m van start`;
}

function tally(pois) {
  const out = {};
  for (const p of pois) out[p.category] = (out[p.category] || 0) + 1;
  return out;
}

const PLURALS = {
  speeltuin: ['een speeltuin', 'speeltuinen'],
  brug: ['een bruggetje', 'bruggetjes'],
  pauze: ['een pauzeplek', 'pauzeplekken'],
  sportveld: ['een sportveld', 'sportvelden'],
  knooppunt: ['een wandelknooppunt', 'wandelknooppunten'],
  schuilhut: ['een schuilhut', 'schuilhutten'],
  picknick: ['een picknicktafel', 'picknicktafels'],
  uitkijk: ['een uitkijkpunt', 'uitkijkpunten'],
};

function labelPlural(key, n) {
  const [one, many] = PLURALS[key] || [key, key];
  return n === 1 ? one : `${n} ${many}`;
}

/** BRouter's hiking-beta loopt ~5 km/u. Met een kind erbij is dat onrealistisch,
 *  en de factor 1,85 reproduceert de 22 min/km waar het ontwerp van uitging. */
function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} u ${String(m).padStart(2, '0')}` : `${m} min`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class GenerateError extends Error {
  constructor(message) { super(message); this.name = 'GenerateError'; }
}
