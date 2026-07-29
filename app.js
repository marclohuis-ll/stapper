/* ============================================================================
   Stapper — implementation of "Stapper Boslamp.dc.html"

   Negen schermen in #app. De canvas-zijbalk en de Android-bezel uit het
   designdocument waren steigerwerk; hier is de app schermvullend en heeft elk
   scherm een hash-route (#/home, #/instellen, …) zodat de terugknop werkt.

   Echte data: instellen → zoeken → resultaten → detail. De schermen *onderweg*
   en *kindmodus* draaien nog op demo-waarden; die hebben live tracking nodig.
   ============================================================================ */
'use strict';

import { CATEGORIES, createHarvester, supplementFromOverpass } from './src/pois.js';
import { generateRoutes, GenerateError, formatDuration, vormLabel } from './src/generator.js';
import { createEditor } from './src/edit-map.js';
import { getPosition, watchPosition, LocationError, INSECURE } from './src/geolocate.js';
import { createTracker } from './src/tracking.js';
import { startCompass, needleRotation, requestCompassPermission } from './src/compass.js';
import { bearing, distM } from './src/geo.js';
import { simulateWalk, simulationSetting } from './src/simulate.js';
import { createVloeiend } from './src/vloeiend.js';
import { parseGpx, overslagTekst, cachesInBuurt, GpxError } from './src/gpx.js';
import { zoekPlaats } from './src/geocode.js';
import * as store from './src/store.js';
import * as offline from './src/offline.js';
import * as mapview from './src/mapview.js';

/* ── Feature flags ───────────────────────────────────────────────────────── */
const CONFIG = {
  stickerBeloningen: true,
};

/* Geocaches hebben geen eigen schakelaar. Laad je bij Instellingen een
 * GPX-bestand in, dan verschijnt de chip *Geocache* tussen de andere en werkt hij
 * als elke andere soort. Er stond hier eerder een tweede knop naast die hetzelfde
 * beloofde maar niks deed; twee bedieningen voor één ding is erger dan één. */
const geocachesBeschikbaar = () => state.caches.length > 0;

/* ── Inhoud die nog niet uit data komt ───────────────────────────────────── */
const WELKOM_PUNTEN = [
  { icon: 'near_me',        label: 'Rondjes vanaf waar je nu staat' },
  { icon: 'travel_explore', label: 'Speurtocht onderweg' },
  { icon: 'child_care',     label: 'Kindmodus: je kind wijst de weg' },
];

/* De drie tegels in de kindmodus. In het ontwerp waren ze decoratief; nu doet
 * elk iets. "zoek" is bewust geen vaste tekst maar volgt het volgende punt. */
const KID_HINTS = [
  { key: 'zoek',  icon: 'search',       label: 'wat zoeken we?' },
  { key: 'foto',  icon: 'photo_camera', label: 'maak foto' },
  { key: 'lees',  icon: 'volume_up',    label: 'voorlezen' },
];

/* Waar je naar moet uitkijken, per soort punt. Dit is wat een kind kan zien —
 * "leisure=playground" zegt hem niets. */
const ZOEK_HINT = {
  speeltuin: 'zoek een glijbaan of een schommel',
  brug: 'zoek een brug over het water',
  pauze: 'zoek een terras of een deur waar je naar binnen kan',
  sportveld: 'zoek een veld met doelen',
  knooppunt: 'zoek een bordje met pijlen en nummers',
  schuilhut: 'zoek een hutje waar je kunt schuilen',
  picknick: 'zoek een tafel van hout',
  uitkijk: 'zoek een plek waar je heel ver kunt kijken',
  // Een geocache is verstopt: niet "zoek een geocache" maar waar hij kan liggen.
  cache: 'zoek een doosje: onder een boomstronk, in een holletje, achter een steen',
};

/* Stickers zijn per soort punt; die van het gevonden punt wordt uitgereikt. */
const STICKER_FOR = {
  speeltuin: 'toys', brug: 'water_drop', pauze: 'cake', sportveld: 'sports_soccer',
  knooppunt: 'signpost', schuilhut: 'cabin', picknick: 'emoji_nature', uitkijk: 'landscape',
  cache: 'inventory_2',
};

const SCREENS = ['welkom','home','instellen','startpunt','zoeken','resultaten','detail','bewerken','onderweg','kind','recap','rondjes','boek','profiel'];

/* ── Het menu ────────────────────────────────────────────────────────────────
   Vier vaste plekken, en de rest van de app hangt eraan als een reis: je zoekt
   een rondje, je hebt rondjes, je hebt gelopen, en dat ben jij. Alles wat lineair
   is (instellen → zoeken → resultaten → detail → onderweg) komt hier bovenop te
   liggen met een eigen knop onderin, zonder tabbalk — dat zijn stappen in een
   handeling, geen bestemmingen.
   ───────────────────────────────────────────────────────────────────────────── */
const TABS = [
  { screen: 'home',    icon: 'hiking',       label: 'Lopen' },
  { screen: 'rondjes', icon: 'route',        label: 'Rondjes' },
  { screen: 'boek',    icon: 'auto_stories', label: 'Boek' },
  { screen: 'profiel', icon: 'person',       label: 'Profiel' },
];
const TAB_SCREENS = TABS.map((t) => t.screen);

/* ── State ──────────────────────────────────────────────────────────────── */
const state = {
  screen: 'welkom',
  km: 4.5,
  shape: 'loop',
  picked: { speeltuin: true, brug: true, pauze: true },
  profile: { naam: 'Sem', leeftijd: 6 },

  position: null,
  locating: false,
  locationError: null,

  /* Zelf gekozen startpunt; null betekent: gebruik de GPS. */
  startKeuze: null,
  plaatsZoek: '',
  plaatsResultaten: null,

  routes: [],
  routeId: null,
  /* Waar het detailscherm vandaan geopend is. Een bewaard rondje open je uit
   * Rondjes, en dan is "terug naar de zoekresultaten" een doodlopende weg. */
  detailVan: 'resultaten',
  genStatus: '',
  genError: null,
  offTarget: false,
  missing: [],
  poiCount: 0,

  pauze: false,
  code: '',
  showSticker: false,
  showLock: false,

  /* Uit IndexedDB, geladen bij het opstarten. */
  stickers: [],
  saved: [],
  walks: [],
  photos: [],

  /* Offline meenemen van de kaart voor de geopende route. */
  offline: { fraction: 0, busy: false, done: 0, total: 0 },

  /* Instellingen achter het stickerboek. */
  editProfile: false,
  editSetting: null,          // 'code' | null
  parentCode: null,

  /* Geocaches uit een GPX-bestand, uit IndexedDB geladen bij het opstarten. */
  caches: [],
  gpxBron: null,              // bestandsnaam van de laatste import
  gpxMelding: null,           // {ok, tekst} — wat er van de laatste import terechtkwam

  /* Welke versie draait er, en staat er een nieuwe klaar. Zie initVersie(). */
  versie: { naam: null, uitgebracht: null, staat: 'onbekend' },

  /* Plat of gekanteld tijdens het lopen. Blijft bewaard: dit is een voorkeur,
   * geen instelling die je per wandeling opnieuw wil kiezen. */
  aanzicht: 'plat',

  /* Een wandeling die niet is afgemaakt — na een herlaadactie of een afsluiting.
   * Zie de hervat-kaart op het beginscherm. */
  hervat: null,

  /* De wandeling die op de terugblik staat. */
  recap: null,

  /* De aangetikte geocache op de kaart, of null. */
  cacheKaart: null,

  /* Op het beginscherm zetten. `installer` is het beforeinstallprompt-event dat
   * Chrome ons geeft; dat mag je maar één keer gebruiken, dus we bewaren het. */
  installer: null,
  installKaartWeg: false,
};

/* ── De wandeling ────────────────────────────────────────────────────────
   Apart van `state`, want dit verandert elke seconde en mag dus géén
   volledige hertekening uitlokken: dat zou de kaart laten flikkeren en de
   compasnaald laten haperen. Deze waarden worden ter plekke in de DOM gezet.
   ───────────────────────────────────────────────────────────────────────── */
const walk = {
  tracker: null,
  progress: null,
  heading: null,
  sticker: null,      // het punt waarvoor net een sticker is uitgereikt
  nudge: '',          // "nog 120 meter!"
  nudgeTimer: null,
  override: false,    // ontsnappingsluik zichtbaar na een mislukte poging
  stopWatch: null,
  stopCompass: null,

  /* Volgt de kaart je positie? Gaat uit zodra jíj de kaart pakt, want anders schiet
   * hij bij elke GPS-tik terug en kun je nooit verder vooruit op de route kijken. */
  follow: true,
  stopKaartKijk: null,

  /* Richting waarin je loopt. Komt uit de routerichting zolang je die volgt, en
   * anders uit je eigen beweging over 20 meter — zie bepaalKoers(). Niet uit het
   * kompas: dat zegt waar de telefoon heen wijst, niet waar jij heen loopt. */
  koers: null,

  /* Het echt gelopen spoor, uitgedund, voor de terugblik. */
  trail: [],
  startedAt: null,
  bewaardOp: 0,
  klaarGemeld: false,

  /* Tekent tussen de GPS-metingen door, zodat de stip loopt in plaats van springt.
   * Zie src/vloeiend.js. */
  vloeiend: null,
};

/* ── Drie maten waar het lopen op afgeregeld is ───────────────────────────────
   Staan hier bij elkaar omdat ze op meerdere plekken meespelen: de kaart, de pijl, de
   kompasnaald in de kindmodus en het getal dat daaronder staat.
   ───────────────────────────────────────────────────────────────────────────── */

/* Tot hoe ver van de route je nog "op de route" bent. Ruim binnen wat GPS onder een
 * bladerdek doet (10–30 m), dus dit verbergt ruis en geen omweg. Erboven tekent de
 * kaart je ruwe positie, wijst de naald terug naar het pad, en komt de melding dat je
 * ernaast loopt. */
const OP_DE_LIJN_M = 25;

/* Hoeveel de richting mag afwijken voordat de kaart meedraait. Zonder deze dode zone
 * draait hij continu een paar graden heen en weer, en dát is wat onrustig aanvoelt —
 * niet de grote bochten. */
const DODE_ZONE_GRADEN = 8;

/* Over hoeveel meter de peiling gaat als we hem uit je eigen beweging moeten halen,
 * omdat je van de route af bent. Tussen twee GPS-metingen is te kort: bij 10 m fout
 * over 6 m beweging zit de richting er al meer dan 50° naast. */
const BASISLIJN_M = 20;

/* ── Helpers ────────────────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ico = (name, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
const komma = (n) => n.toFixed(1).replace('.', ',');

/** Een kind loopt langzamer dan BRouter's 5 km/u, en hoe jonger hoe langzamer.
 *  De factor is zo gekozen dat leeftijd 6 uitkomt op de 22 min/km waarmee het
 *  ontwerp rekende. */
const kidFactor = (age) => Math.max(1.35, Math.min(2.5, 2.6 - 0.125 * age));

const uurMin = (mins) => {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} u ${String(m).padStart(2, '0')}` : `${m} min`;
};

/* Alleen soorten die er ook echt zijn. Een aangevinkte geocache-chip zonder
 * sleutel zou een harde eis worden waar geen enkele bron aan kan voldoen: de
 * generator zoekt zich dan zes rondes lam en komt met niets terug. */
const pickedKeys = () => CATEGORIES
  .filter((c) => state.picked[c.key])
  .filter((c) => c.from !== 'gpx' || geocachesBeschikbaar())
  .map((c) => c.key);
const currentRoute = () => (state.routeId != null ? state.routes[state.routeId] : null);

/* ── Screens ────────────────────────────────────────────────────────────── */
const views = {};

views.welkom = () => `
  <div class="screen">
    <div class="screen__body">
      <div class="sheet welkom">
        <div class="welkom__glow"></div>
        <div class="welkom__mark">${ico('forest')}</div>
        <h1 class="welkom__title">Lopen wordt<br><em>zoeken.</em></h1>
        <p class="welkom__lead">Wij plakken vlonderpaden, kikkerbruggen en verstopte schatten aan elkaar. Jullie lopen ze af.</p>
        <div class="welkom__spacer"></div>
        <div class="welkom__points">
          ${WELKOM_PUNTEN.map((w) => `
            <div class="point">${ico(w.icon)}<span class="point__label">${esc(w.label)}</span></div>`).join('')}
        </div>
        <button class="btn-cta welkom__cta" data-go="home">Schoenen aan</button>
      </div>
    </div>
  </div>`;

views.home = () => `
  <div class="screen">
    <div class="screen__body pad-tabs">
      <div class="sheet home">
        <div class="home__top">
          <div>
            <div class="home__weather">${esc(dagLabel())}</div>
            <h1 class="home__h1">Waar gaan<br>we heen?</h1>
          </div>
        </div>

        ${locationPill()}
        ${hervatKaart()}
        ${installKaart()}

        <button class="bigcard" data-go="instellen">
          <span class="bigcard__blob"></span>
          <span class="bigcard__title">Nieuw rondje<br>uitzoeken</span>
          <span class="bigcard__sub">Kies de afstand en wat jullie onderweg willen zien.</span>
          <span class="bigcard__cta">Beginnen${ico('arrow_forward')}</span>
        </button>

        <div class="duo">
          <button class="tile tile--orange" data-act="snel" data-km="3" data-chips="pauze">
            ${ico('hourglass_top')}
            <span class="tile__title">Uurtje weg</span>
            <span class="tile__sub">± 3 km, veel pauze</span>
          </button>
          <button class="tile tile--mint" data-act="snel" data-km="4.5" data-chips="speeltuin,brug">
            ${ico('travel_explore')}
            <span class="tile__title">Speurtocht</span>
            <span class="tile__sub">speeltuin en bruggetjes</span>
          </button>
        </div>

        ${state.routes.length || state.saved.length ? `
          <button class="doorlink" data-go="rondjes">
            <span class="doorlink__text">
              <span class="doorlink__title">Je rondjes</span>
              <span class="doorlink__sub">${esc(rondjesSamenvatting())}</span>
            </span>
            ${ico('chevron_right', 'doorlink__chev')}
          </button>` : ''}
      </div>
    </div>
  </div>`;

/**
 * "Je was aan het lopen." Verschijnt als er een wandeling open is blijven staan —
 * na een per ongeluk herladen pagina, of omdat je de app dichtdeed.
 *
 * Staat bovenaan en met de lime knop, want dit is bijna altijd wat je wil: je stond
 * midden in een bos en je telefoon deed iets onverwachts.
 */
function hervatKaart() {
  const h = state.hervat;
  if (!h || !h.route) return '';
  const gedaan = komma(((h.voortgang && h.voortgang.walkedM) || 0) / 1000);

  return `
  <div class="hervat">
    <span class="hervat__ico">${ico('resume')}</span>
    <span class="hervat__text">
      <span class="hervat__title">Je was aan het lopen</span>
      <span class="hervat__sub">${esc(h.route.naam)} — ${gedaan} van ${esc(h.route.km)} gedaan</span>
    </span>
    <button class="hervat__doe" data-act="hervat-wandeling">Verder</button>
    <button class="hervat__weg" data-act="hervat-weg" aria-label="Wandeling weggooien">${ico('close')}</button>
  </div>`;
}

/** Wat er onder "Je rondjes" staat: liever de aantallen dan het woord "bekijken". */
function rondjesSamenvatting() {
  const d = [];
  if (state.routes.length) d.push(`${state.routes.length} net gevonden`);
  if (state.saved.length) {
    d.push(state.saved.length === 1 ? '1 bewaard' : `${state.saved.length} bewaard`);
  }
  return d.join(' · ');
}

/* ── Op het beginscherm zetten ────────────────────────────────────────────────
   Stapper is een PWA en was ook al te installeren, maar alleen via het menu van
   de browser — en daar gaat niemand zoeken. Dus vraagt de app het zelf.

   Drie situaties, en ze verschillen echt:
     - Chrome/Edge geven ons een `beforeinstallprompt`. Dan kunnen we een knop
       tonen die het systeemvenster opent.
     - Safari op iOS geeft dat nooit. Daar is Delen → Zet op beginscherm het enige
       dat werkt, dus staat dat er als tekst.
     - Al geïnstalleerd: dan draait de app in `display-mode: standalone` en hoort
       er niets te staan.
   ───────────────────────────────────────────────────────────────────────────── */

/** Draait dit al als losse app? */
const alsApp = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true;

const isIOS = () => /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);

/** Valt er iets te installeren, en heeft de gebruiker de kaart niet weggetikt? */
const installKanNu = () => !alsApp() && (state.installer || isIOS());

function installKaart() {
  if (state.installKaartWeg || !installKanNu()) return '';

  return `
  <div class="install">
    <span class="install__ico">${ico('install_mobile')}</span>
    <span class="install__text">
      <span class="install__title">Zet Stapper op je beginscherm</span>
      <span class="install__sub">${state.installer
        ? 'Dan start hij schermvullend, zonder adresbalk, en werkt de offline kaart ook los van de browser.'
        : 'Tik onderin op Delen en kies “Zet op beginscherm”.'}</span>
    </span>
    ${state.installer
      ? `<button class="install__doe" data-act="installeer">Zetten</button>`
      : ''}
    <button class="install__weg" data-act="install-weg" aria-label="Niet nu">${ico('close')}</button>
  </div>`;
}

/**
 * Dezelfde zaak bij de instellingen, want de kaart op het beginscherm kun je
 * wegtikken en dan moet je er alsnog bij kunnen. Hier staat ook wat je moet doen
 * als de browser ons geen venster gunt — Firefox op Android bijvoorbeeld doet dat
 * niet, en dan is "het kan niet" een leugen terwijl het via het menu wel gaat.
 */
function installRegel() {
  if (alsApp()) {
    return `
    <div class="setting setting--stil">
      ${ico('check_circle')}
      <span class="setting__text">
        <span class="setting__title">Staat op je beginscherm</span>
        <span class="setting__sub">je gebruikt Stapper nu als losse app</span>
      </span>
    </div>`;
  }

  if (state.installer) {
    return `
    <button class="setting" data-act="installeer">
      ${ico('install_mobile')}
      <span class="setting__text">
        <span class="setting__title">Op het beginscherm zetten</span>
        <span class="setting__sub">schermvullend, zonder adresbalk</span>
      </span>
      ${ico('chevron_right', 'setting__chev')}
    </button>`;
  }

  return `
  <div class="setting setting--stil">
    ${ico('install_mobile')}
    <span class="setting__text">
      <span class="setting__title">Op het beginscherm zetten</span>
      <span class="setting__sub">${isIOS()
        ? 'Tik onderin op Delen en kies “Zet op beginscherm”.'
        : 'Via het menu van je browser: “App installeren” of “Toevoegen aan beginscherm”.'}</span>
    </span>
  </div>`;
}

/* ── Versie en bijwerken ────────────────────────────────────────────────────
   Een PWA werkt zichzelf stil bij, en dat is precies het probleem: je duwt iets en
   ziet de oude app, want de service worker bedient je uit de cache. Er was geen
   moment waarop de app kon zeggen "er is een nieuwe versie" — dus is dat er nu.

   De service worker wacht bewust (geen skipWaiting bij het installeren). Daardoor
   bestaat de toestand "er staat een nieuwe versie klaar" écht, in plaats van dat we
   hem moeten verzinnen.
   ───────────────────────────────────────────────────────────────────────────── */
let swReg = null;
let herladenNaWissel = false;

function versieRegel() {
  const v = state.versie;
  const klaar = v.staat === 'klaar';
  const bezig = v.staat === 'zoeken' || v.staat === 'bijwerken';

  /* Bij "klaar" is de kop de nieuwe versie, want dat is waar het over gaat. En de
   * naam van de draaiende versie kan ontbreken: een versie van vóór deze wijziging
   * kent de vraag niet. Die "ontwikkelversie" noemen zou onwaar zijn — het is een
   * oude versie, en dat is precies waarom je hier staat. */
  const kop = klaar ? `${v.nieuw || 'Nieuwe versie'} staat klaar`
            : v.staat === 'geen-sw' ? 'Ontwikkelversie'
            : v.naam || 'Stapper';

  const sub = {
    klaar: v.naam ? `Je draait nu ${v.naam}. Bijwerken herstart de app.`
                  : 'Bijwerken herstart de app.',
    zoeken: 'Kijken of er een nieuwe is…',
    bijwerken: 'Bijwerken, een ogenblik…',
    actueel: v.uitgebracht ? `Nieuwste versie, van ${v.uitgebracht}.` : 'Je hebt de nieuwste versie.',
    'geen-sw': 'Draait zonder service worker — hier valt niets bij te werken.',
    onbekend: 'Nog niet nagekeken.',
  }[v.staat] || '';

  return `
  <div class="versie ${klaar ? 'versie--klaar' : ''}">
    <span class="versie__top">
      ${ico(klaar ? 'system_update' : 'verified')}
      <span class="versie__tekst">
        <span class="versie__naam">${esc(kop)}</span>
        <span class="versie__sub">${esc(sub)}</span>
      </span>
    </span>
    ${v.staat === 'geen-sw' ? '' : `
      <button class="versie__knop ${klaar ? 'versie__knop--nu' : ''}"
              data-act="${klaar ? 'werk-bij' : 'zoek-update'}" ${bezig ? 'disabled' : ''}>
        ${klaar ? 'Nu bijwerken' : bezig ? 'Bezig…' : 'Nakijken'}
      </button>`}
  </div>`;
}

/**
 * Staat er echt iets klaar?
 *
 * Een wachtende service worker is niet altijd een update. Bij de éérste
 * installatie is er nog geen controller; die worker neemt dan zelf over en er valt
 * niets bij te werken. Zonder dit onderscheid zegt de app "nieuwe versie klaar"
 * tegen iemand die de app net voor het eerst opent, en blijft die melding staan
 * nadat hij zichzelf al geactiveerd heeft.
 */
const staatVan = (reg) =>
  (reg.waiting && navigator.serviceWorker.controller ? 'klaar' : 'actueel');

async function initVersie(reg) {
  swReg = reg;
  state.versie.staat = staatVan(reg);
  if (reg.waiting) volgWachtende(reg, reg.waiting);

  reg.addEventListener('updatefound', () => {
    const nieuw = reg.installing;
    if (!nieuw) return;
    nieuw.addEventListener('statechange', async () => {
      if (nieuw.state !== 'installed') return;
      volgWachtende(reg, nieuw);
      state.versie.staat = staatVan(reg);
      Object.assign(state.versie, await leesVersies(reg));
      refreshIfShowing('profiel');
    });
  });

  // Alleen herladen als wíj erom gevraagd hebben. Deze gebeurtenis vuurt ook bij
  // de eerste installatie, en dan ongevraagd herladen is een sprong in het niets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (herladenNaWissel) location.reload();
  });

  /* Vlak na register() is er nog geen actieve worker — die is nog aan het
   * installeren — en dan is er niemand om de versie aan te vragen. `ready` wacht
   * daarop. Zonder dit staat er bij de eerste start geen versienummer. */
  const actief = await navigator.serviceWorker.ready;
  Object.assign(state.versie, await leesVersies(actief));
  state.versie.staat = staatVan(actief);
  refreshIfShowing('profiel');

  // Nog steeds geen naam? Dan was hij bezig. Eén keer opnieuw vragen is genoeg;
  // blijft het leeg, dan staat er "Stapper" en dat is niet onwaar.
  if (!state.versie.naam) {
    setTimeout(async () => {
      Object.assign(state.versie, await leesVersies(actief));
      refreshIfShowing('profiel');
    }, 2500);
  }

  // Bij terugkomst uit de achtergrond nog eens kijken: dat is precies het moment
  // waarop je de app opent na een deploy.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.versie.staat === 'actueel') reg.update().catch(() => {});
  });
}

/** Wordt de wachtende versie alsnog zelf actief, dan is er niets meer klaar te
 *  zetten en moet de melding weg — anders blijft er een knop staan die niets doet. */
function volgWachtende(reg, worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'activated' && worker.state !== 'redundant') return;
    if (state.versie.staat !== 'klaar') return;
    state.versie.staat = 'actueel';
    state.versie.nieuw = null;
    leesVersies(reg).then((v) => {
      Object.assign(state.versie, v);
      refreshIfShowing('profiel');
    });
  });
}

/**
 * De service worker kent zijn eigen versienummer; dat is één bron in plaats van een
 * string die in twee bestanden uit elkaar loopt.
 *
 * Twee keer vragen: aan de draaiende én aan de wachtende. De draaiende kan een
 * versie van vóór deze wijziging zijn en dan komt er geen antwoord — daarom mag het
 * ontbreken van een naam nooit als "geen versie" gelezen worden.
 */
async function leesVersies(reg) {
  const [nu, straks] = await Promise.all([
    vraagAan(reg.active || navigator.serviceWorker.controller),
    vraagAan(reg.waiting),
  ]);
  return {
    naam: nu.versie || null,
    uitgebracht: nu.uitgebracht || null,
    nieuw: straks.versie || null,
  };
}

/* Ruim wachten: bij de éérste installatie haalt de service worker 25 bestanden op
 * en antwoordt hij niet binnen een seconde. Gemeten: met 1,5 s bleef het
 * versienummer bij de eerste start leeg. */
function vraagAan(sw, timeoutMs = 5000) {
  if (!sw) return Promise.resolve({});
  return new Promise((resolve) => {
    const kanaal = new MessageChannel();
    const op = setTimeout(() => resolve({}), timeoutMs);
    kanaal.port1.onmessage = (e) => { clearTimeout(op); resolve(e.data || {}); };
    try { sw.postMessage({ type: 'VERSION' }, [kanaal.port2]); }
    catch { clearTimeout(op); resolve({}); }
  });
}

async function zoekUpdate() {
  if (!swReg) return;
  state.versie.staat = 'zoeken';
  render();
  try {
    await swReg.update();
  } catch (e) {
    console.warn('update zoeken mislukt:', e.message);
  }
  // update() is klaar zodra de controle gedaan is; een gevonden versie zit dan nog
  // te installeren. De statechange-luisteraar zet 'klaar' als het zover is.
  state.versie.staat = staatVan(swReg);
  Object.assign(state.versie, await leesVersies(swReg));
  refreshIfShowing('profiel');
}

function werkBij() {
  const wacht = swReg && swReg.waiting;
  if (!wacht) return;
  herladenNaWissel = true;
  state.versie.staat = 'bijwerken';
  render();
  wacht.postMessage({ type: 'SKIP_WAITING' });
  // Vangnet: komt de wissel niet, dan herladen we alsnog. Beter een herstart die
  // niets verandert dan een knop die blijft hangen op "bijwerken".
  setTimeout(() => { if (herladenNaWissel) location.reload(); }, 4000);
}

async function installeer() {
  const e = state.installer;
  if (!e) return;

  // Het event is eenmalig: na prompt() is het op, of het nu gelukt is of niet.
  state.installer = null;
  try {
    await e.prompt();
    const keuze = await e.userChoice;
    if (keuze && keuze.outcome === 'accepted') {
      state.installKaartWeg = true;
    } else {
      // Afgewezen: niet blijven zeuren deze sessie, maar de knop bij de
      // instellingen blijft staan zodat het later alsnog kan.
      state.installKaartWeg = true;
    }
  } catch (err) {
    console.warn('installeren mislukt:', err.message);
  }
  render();
}

const dagLabel = () => {
  const dagen = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
  return dagen[new Date().getDay()];
};

/** De locatiepil vertelt de waarheid over de GPS in plaats van een plaatsnaam
 *  te verzinnen: dit is de voorwaarde voor alles wat de app daarna doet. */
function locationPill() {
  if (INSECURE) {
    return `<div class="locpill locpill--warn">${ico('lock')}
      <span class="locpill__label">Locatie werkt alleen via https</span></div>`;
  }
  if (state.locating) {
    return `<div class="locpill">${ico('my_location')}
      <span class="locpill__label">Je locatie bepalen…</span></div>`;
  }
  if (state.locationError) {
    return `<button class="locpill locpill--warn" data-act="locate">${ico('location_off')}
      <span class="locpill__label">${esc(state.locationError)} — opnieuw</span></button>`;
  }
  if (state.position && state.position.override) {
    return `<div class="locpill locpill--warn">${ico('bug_report')}
      <span class="locpill__label">Testlocatie ${state.position.lat.toFixed(3)},
      ${state.position.lon.toFixed(3)} — niet je echte positie</span></div>`;
  }
  if (state.position) {
    const acc = Math.round(state.position.accuracy);
    return `<div class="locpill">${ico('my_location')}
      <span class="locpill__label">Hier waar je staat · ± ${acc} m nauwkeurig</span></div>`;
  }
  return `<button class="locpill" data-act="locate">${ico('my_location')}
    <span class="locpill__label">Locatie aanzetten</span></button>`;
}

const routeRow = (r, i) => `
  <button class="route-row" data-act="open-route" data-route="${i}">
    <span class="route-row__ico">${ico(r.pois[0] ? r.pois[0].icon : 'forest')}</span>
    <span class="route-row__text">
      <span class="route-row__name">${esc(r.naam)}</span>
      <span class="route-row__meta">${esc(r.km)} · ${esc(r.tijd)} · ${esc(r.punten)}</span>
    </span>
    ${ico('chevron_right', 'route-row__chev')}
  </button>`;

views.instellen = () => {
  const mins = state.km * 22 * (kidFactor(state.profile.leeftijd) / 1.85);
  return `
  <div class="screen">
    <div class="screen__body pad-footer">
      <div class="sheet">
        <div class="topbar">
          <button class="btn-icon" data-go="home" aria-label="Terug">${ico('arrow_back')}</button>
          <div class="topbar__title">Rondje uitzoeken</div>
        </div>

        <div class="pad">
          <div class="km-card">
            <div class="km-card__label" id="km-label">Hoe ver mogen de beentjes?</div>
            <div class="km-card__row">
              <div class="km-card__value" data-km-value>${komma(state.km)}</div>
              <div class="km-card__unit">km</div>
            </div>
            <input class="km-card__slider" type="range" min="1" max="12" step="0.5"
                   value="${state.km}" data-act="km"
                   aria-labelledby="km-label" aria-valuetext="${komma(state.km)} kilometer">
            <div class="km-card__scale">
              <span>1 km</span>
              <span class="km-card__time" data-km-time>± ${uurMin(mins)} met stops</span>
              <span>12 km</span>
            </div>
          </div>

          <div class="pair">
            <button class="pair__cell pair__cell--start" data-go="startpunt">
              ${ico(state.startKeuze ? 'place' : 'my_location')}
              <span class="pair__text">
                <span class="pair__k">Startpunt</span>
                <span class="pair__v">${esc(startLabel())}</span>
              </span>
            </button>
            <button class="pair__cell pair__cell--shape" data-act="toggle-shape"
                    aria-pressed="${state.shape === 'loop'}">
              ${ico(state.shape === 'loop' ? 'refresh' : 'sync_alt')}
              <span class="pair__text">
                <span class="pair__k">Vorm</span>
                <span class="pair__v">${state.shape === 'loop' ? 'Rondje' : 'Heen &amp; terug'}</span>
              </span>
            </button>
          </div>

          <div class="section-head section-head--rij">
            <span>Onderweg mag er zijn</span>
            ${pickedKeys().length
              ? `<button class="link-knop" data-act="wis-chips">niets, verras me</button>` : ''}
          </div>
          <div class="chips" role="group" aria-label="Onderweg moet er zijn">
            ${CATEGORIES.filter((c) => c.from !== 'gpx' || geocachesBeschikbaar()).map((c) => `
              <button class="chip ${c.from === 'overpass' ? 'chip--net' : ''}"
                      data-act="chip" data-chip="${c.key}"
                      aria-pressed="${!!state.picked[c.key]}"
                      ${c.from === 'overpass'
                        ? 'title="Heeft netwerk nodig — komt niet uit de kaarttegels"'
                        : c.from === 'gpx'
                          ? 'title="Uit je eigen GPX-bestand — staat op dit toestel"' : ''}>
                ${ico(c.icon)}<span>${esc(c.label)}</span>
              </button>`).join('')}
          </div>
          <p class="hint-line">${pickedKeys().length
            ? `Elke aangevinkte soort komt gegarandeerd in de route. Past dat niet
               binnen je afstand, dan krijg je ook kortere rondjes waarin er één
               ontbreekt — of gewoon een mooi rondje zonder eisen.`
            : `Niets aangevinkt is ook goed: dan zoekt hij simpelweg het mooiste
               rondje vanaf je startpunt, met zo veel paadjes als er te vinden zijn.`}</p>

        </div>
      </div>
    </div>

    <div class="screen__footer">
      <button class="btn-cta" data-act="zoek">Zoek paadjes</button>
    </div>
  </div>`;
};

const startLabel = () => {
  const k = state.startKeuze;
  if (k) return k.naam || `${k.lat.toFixed(4)}, ${k.lon.toFixed(4)}`;
  if (state.position) return 'Hier waar ik sta';
  return 'Nog onbekend';
};

/** Het punt waarvandaan gezocht wordt: een gekozen plek, anders je GPS. */
const startPunt = () => state.startKeuze
  ? { lat: state.startKeuze.lat, lon: state.startKeuze.lon }
  : (state.position ? { lat: state.position.lat, lon: state.position.lon } : null);

/* ── Startpunt kiezen ─────────────────────────────────────────────────────
   "Rondjes vanaf waar je nu staat" is de belofte, maar je wil ook thuis een
   route voor morgen kunnen maken. Dus: zoeken op naam, of de kaart verschuiven
   en het kruis in het midden gebruiken.
   ───────────────────────────────────────────────────────────────────────── */
views.startpunt = () => `
  <div class="screen">
    <div class="startpunt">
      <div class="startpunt__map" id="startpunt-map"></div>
      <div class="startpunt__kruis" aria-hidden="true">${ico('add')}</div>

      <div class="startpunt__top">
        <button class="btn-icon" data-go="instellen" aria-label="Terug">${ico('arrow_back')}</button>
        <form class="zoekbalk" data-act="zoek-plaats">
          ${ico('search')}
          <input class="zoekbalk__input" name="q" placeholder="Zoek een plek of adres"
                 value="${esc(state.plaatsZoek || '')}" autocomplete="off" enterkeyhint="search">
        </form>
      </div>

      ${state.plaatsResultaten && state.plaatsResultaten.length ? `
        <div class="zoekhits">
          ${state.plaatsResultaten.map((p, i) => `
            <button class="zoekhit" data-act="kies-hit" data-i="${i}">
              ${ico('place')}<span>${esc(p.naam)}</span>
            </button>`).join('')}
        </div>` : ''}

      <div class="startpunt__onder">
        <p class="startpunt__uitleg">Schuif de kaart tot het kruis op je startpunt staat.</p>
        <div class="startpunt__acties">
          <button class="btn-ghost" data-act="start-hier">${ico('my_location')}Mijn locatie</button>
          <button class="btn-cta btn-cta--flex" data-act="start-kies">Dit wordt het startpunt</button>
        </div>
      </div>
    </div>
  </div>`;

views.zoeken = () => `
  <div class="screen">
    <div class="screen__body">
      <div class="zoeken" role="status" aria-live="polite">
        <div class="zoeken__dial">
          <div class="zoeken__halo"></div>
          <div class="zoeken__ring"></div>
          <div class="zoeken__disc">${ico('explore')}</div>
        </div>
        <h1 class="zoeken__title">Paadjes zoeken…</h1>
        <p class="zoeken__sub">${esc(state.genStatus || 'punten in de buurt zoeken')}</p>
      </div>
    </div>
  </div>`;

views.resultaten = () => {
  if (state.genError) {
    return `
    <div class="screen">
      <div class="screen__body">
        <div class="sheet">
          <div class="topbar">
            <button class="btn-icon" data-go="instellen" aria-label="Terug">${ico('arrow_back')}</button>
            <div class="topbar__title">Niets gevonden</div>
          </div>
          <div class="pad">
            <div class="notice notice--warn">
              ${ico('sentiment_dissatisfied')}
              <div><strong>${esc(state.genError)}</strong>
              <p>Probeer een andere afstand, of vink minder soorten aan.</p></div>
            </div>
            <button class="btn-cta" data-go="instellen" style="margin-top:18px">Aanpassen</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  const n = state.routes.length;
  return `
  <div class="screen">
    <div class="screen__body">
      <div class="sheet">
        <div class="topbar">
          <button class="btn-icon" data-go="instellen" aria-label="Terug">${ico('arrow_back')}</button>
          <div>
            <div class="topbar__title">${n === 1 ? 'Eén rondje gevonden' : `${n} rondjes gevonden`}</div>
            <div class="topbar__sub">${komma(state.km)} km · ${state.profile.leeftijd} jaar · vanaf je locatie</div>
          </div>
        </div>

        ${state.offTarget ? `
          <div class="pad"><div class="notice">
            ${ico('info')}
            <div>Met alles wat je aanvinkte past er geen rondje van ${komma(state.km)} km in de
            buurt. Hieronder staan kortere rondjes waarin één soort ontbreekt, en het
            kortste rondje waarin alles zit.</div>
          </div></div>` : ''}

        ${state.missing.length ? `
          <div class="pad"><div class="notice notice--warn">
            ${ico('cloud_off')}
            <div>${esc(missingLabel())} niet meegenomen — die soort heeft netwerk nodig
            en dat lukte niet.</div>
          </div></div>` : ''}

        <div class="results">
          ${state.routes.map((r, i) => `
            <button class="rcard" style="animation-delay:${(0.06 * i).toFixed(2)}s"
                    data-act="open-route" data-route="${i}">
              <span class="rcard__map">
                ${window.__routeSvg ? window.__routeSvg(r) : ''}
                <span class="rcard__badge">${esc(r.badge)}</span>
              </span>
              <span class="rcard__body">
                <span class="rcard__name">${esc(r.naam)}</span>
                <span class="rcard__desc">${esc(r.omschrijving)}</span>
                <span class="rcard__tags">
                  <span class="tag">${esc(r.km)}</span>
                  <span class="tag">${esc(r.tijd)}</span>
                  <span class="tag tag--lime">${esc(r.punten)}</span>
                  ${r.padLabel ? `<span class="tag ${padKlasse(r.pathShare)}">${esc(r.padLabel)}</span>` : ''}
                  <span class="tag ${vormKlasse(r.overlap)}">${esc(r.vormLabel)}</span>
                </span>
              </span>
            </button>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
};

const WEG_NAAM = {
  path: 'bospad', footway: 'voetpad', track: 'zandpad', pedestrian: 'wandelgebied',
  steps: 'trap', bridleway: 'ruiterpad', cycleway: 'fietspad',
  residential: 'woonstraat', unclassified: 'landweg', service: 'toegangsweg',
  living_street: 'woonerf', tertiary: 'doorgaande weg', secondary: 'drukke weg',
  primary: 'hoofdweg', onbekend: 'onbekend',
};

/** Waar de route over loopt, in gewone woorden — de drie grootste soorten. */
function wegVerdeling(r) {
  const tot = Object.values(r.byKind).reduce((a, b) => a + b, 0);
  if (!tot) return '';
  const delen = Object.entries(r.byKind)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${Math.round(v / tot * 100)}% ${WEG_NAAM[k] || k}`);
  return `Onderweg: ${delen.join(', ')}.`;
}

/* Hoeveel van de route over paadjes gaat, in kleur. Boven 65% is het een
 * wandeling, onder 40% loop je vooral langs de weg — dat mag je zien vóórdat je
 * een route kiest. */
const padKlasse = (share) =>
  share == null ? '' : share >= 0.65 ? 'tag--lime' : share >= 0.4 ? 'tag--mint' : 'tag--warn';

/* Hoe rond het rondje is. Boven een derde dubbel gelopen is het er geen. */
const vormKlasse = (overlap) =>
  (overlap ?? 0) > 0.33 ? 'tag--warn' : (overlap ?? 0) > 0.15 ? 'tag--mint' : 'tag--lime';

const missingLabel = () => state.missing
  .map((k) => (CATEGORIES.find((c) => c.key === k) || {}).label || k)
  .join(' en ');

views.detail = () => {
  const r = currentRoute();
  if (!r) return views.resultaten();

  return `
  <div class="screen">
    <div class="screen__body pad-footer-l">
      <div class="sheet">
        <div class="detail__hero" id="detail-map">
          <button class="detail__back" data-go="${state.detailVan}" aria-label="Terug">${ico('arrow_back')}</button>
          <button class="detail__bewerk" data-act="bewerk">${ico('gesture')}Aanpassen</button>
        </div>

        <div class="detail__sheet">
          <div class="detail__grip"></div>
          <h1 class="detail__title">${esc(r.naam)}</h1>
          <div class="detail__tags">
            <span class="tag tag--lg">${esc(r.km)}</span>
            <span class="tag tag--lg">± ${esc(r.tijd)}</span>
            <span class="tag tag--lg ${r.dropped.length ? 'tag--warn' : 'tag--mint'}">${esc(r.badge)}</span>
            ${r.padLabel ? `<span class="tag tag--lg ${padKlasse(r.pathShare)}">${esc(r.padLabel)}</span>` : ''}
            <span class="tag tag--lg ${vormKlasse(r.overlap)}">${esc(r.vormLabel)}</span>
          </div>
          ${r.byKind ? `<p class="hint-line">${esc(wegVerdeling(r))}</p>` : ''}

          ${offlineCard()}

          <div class="section-head section-head--tight">Onderweg kom je langs</div>
          <div class="poi-list">
            ${r.pois.map((p) => poiRegel(p)).join('')}
          </div>
          ${cacheBronRegel(r)}
        </div>
      </div>
    </div>

    ${cacheKaartje('detail')}

    <div class="screen__footer">
      ${(() => {
        const opgeslagen = state.saved.some((x) => x.naam === r.naam);
        return `<button class="btn-round" data-act="bewaar" aria-pressed="${opgeslagen}"
                        aria-label="${opgeslagen ? 'Uit bewaarde rondjes halen' : 'Rondje bewaren'}">
          ${ico(opgeslagen ? 'bookmark_added' : 'bookmark')}</button>`;
      })()}
      <button class="btn-cta btn-cta--flex" data-go="onderweg">Start de wandeling</button>
    </div>
  </div>`;
};

/* ── Geocaches uit een GPX-bestand ──────────────────────────────────────────
   Geen API. De dekking in Nederland zit vrijwel helemaal op geocaching.com, en
   daar kom je alleen bij via een partner-gated API (OAuth met een geheim dat in een
   publieke static PWA nergens te verbergen is) of door met iemands inloggegevens de
   site uit te lezen. Het eerste kan niet, het tweede doen we niet.

   Een GPX-export uit c:geo is data waar je zelf legitiem bij mag, en past beter bij
   deze app: geen sleutel, werkt offline, en het is jóuw selectie in plaats van alles
   binnen drie kilometer.
   ───────────────────────────────────────────────────────────────────────────── */
function gpxRegel() {
  const n = state.caches.length;
  const m = state.gpxMelding;

  return `
  <button class="setting" data-act="gpx-kies">
    ${ico('travel_explore')}
    <span class="setting__text">
      <span class="setting__title">Geocaches uit een GPX-bestand</span>
      <span class="setting__sub">${n
        ? `${n} ${n === 1 ? 'cache' : 'caches'} klaar${state.gpxBron ? ` — ${esc(state.gpxBron)}` : ''}`
        : 'nog niets ingeladen — de speurtocht staat uit'}</span>
    </span>
    ${ico('chevron_right', 'setting__chev')}
  </button>
  <input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml"
         class="verborgen-input" data-act="gpx-file" aria-hidden="true" tabindex="-1">

  ${m ? `<p class="gpx-uitslag ${m.ok ? '' : 'gpx-uitslag--mis'}">
    ${ico(m.ok ? 'check_circle' : 'error')}<span>${esc(m.tekst)}</span></p>` : ''}

  <p class="hint-line">Exporteer in c:geo een lijst als GPX en laad die hier in. De
    caches blijven op dit toestel en werken zonder bereik.
    ${n ? `<button class="link-knop" data-act="gpx-wis">Alles wissen</button>` : ''}</p>`;
}

/**
 * Bestand inlezen en wegzetten.
 *
 * Wat er wordt overgeslagen wordt hardop gezegd. Een puzzelcache heeft met opzet
 * verkeerde coördinaten, en stil meenemen zou betekenen dat een kind van zes naar
 * een plek loopt waar niets ligt — dat is erger dan een cache minder.
 */
async function laadGpx(file) {
  state.gpxMelding = null;
  try {
    const xml = await file.text();
    const { caches, overgeslagen, gevonden } = parseGpx(xml, { bron: file.name });

    if (!caches.length) {
      const weg = overslagTekst(overgeslagen);
      state.gpxMelding = { ok: false, tekst: weg
        ? `Niets bruikbaars: ${weg}.`
        : `Geen caches gevonden in dit bestand (${gevonden} punten gelezen).` };
      render();
      return;
    }

    await store.putCaches(caches);
    state.caches = await store.listCaches();
    state.gpxBron = file.name;
    await store.setSetting('gpxBron', file.name);

    const weg = overslagTekst(overgeslagen);
    state.gpxMelding = {
      ok: true,
      tekst: `${caches.length} ${caches.length === 1 ? 'cache' : 'caches'} ingeladen` +
             (weg ? `. Overgeslagen: ${weg}.` : '.'),
    };
  } catch (e) {
    console.warn('gpx inladen mislukt:', e.message);
    state.gpxMelding = {
      ok: false,
      tekst: e instanceof GpxError ? e.message : 'Dit bestand kon niet gelezen worden.',
    };
  }
  render();
}

async function wisCaches() {
  try {
    await store.clearCaches();
    await store.setSetting('gpxBron', null);
  } catch (e) {
    console.warn('caches wissen mislukt:', e.message);
  }
  state.caches = [];
  state.gpxBron = null;
  state.gpxMelding = null;
  render();
}

/** Eén punt onderweg. Heeft het een eigen pagina — bij een geocache is dat zo —
 *  dan is de naam een link daarheen. Bij een geocache staat op die pagina wat je
 *  onderweg wil weten: de hint, de laatste logs, of hij nog te vinden is. */
function poiRegel(p) {
  const naam = p.url
    ? `<a class="poi__name poi__name--link" href="${esc(p.url)}"
          target="_blank" rel="noopener noreferrer">${esc(p.naam)}${ico('open_in_new', 'poi__uit')}</a>`
    : `<span class="poi__name">${esc(p.naam)}</span>`;

  return `
    <div class="poi">
      <span class="poi__ico">${ico(p.icon)}</span>
      <span class="poi__text">
        ${naam}
        <span class="poi__meta">${esc(p.meta)}</span>
      </span>
    </div>`;
}

/** Waar de geocaches in deze route vandaan komen. Kort, maar het hoort erbij:
 *  over een half jaar weet je niet meer welk bestand je hebt ingeladen. */
function cacheBronRegel(r) {
  if (!(r.pois || []).some((p) => p.category === 'cache')) return '';
  return `<p class="cachebron">Geocaches uit je eigen GPX-bestand${
    state.gpxBron ? ` (${esc(state.gpxBron)})` : ''}. Tik op een cache voor de pagina met de hint.</p>`;
}

/* ── Route aanpassen ──────────────────────────────────────────────────────
   Schermvullende kaart. Bewust geen sleepbare lijn in de 310 px hero van het
   detailscherm: je hebt de ruimte nodig om te zien waar je hem naartoe sleept,
   en met een blad eronder valt de helft van de route buiten beeld.
   ───────────────────────────────────────────────────────────────────────── */
views.bewerken = () => {
  const r = currentRoute();
  if (!r) return views.resultaten();

  return `
  <div class="screen bewerk">
    <div class="bewerk__map" id="bewerken-map"></div>

    <div class="bewerk__top">
      <button class="bewerk__terug" data-act="bewerk-af" aria-label="Aanpassen afbreken">${ico('close')}</button>
      <span class="bewerk__meting">
        <span class="bewerk__km" data-bewerk-km>${esc(r.km)}</span>
        <span class="bewerk__sub" data-bewerk-sub></span>
      </span>
    </div>

    <p class="bewerk__uitleg" data-bewerk-uitleg>
      Sleep de lijn naar waar je wél wil lopen. Tik op een punt om het eruit te halen.
    </p>

    <div class="bewerk__acties">
      <button class="btn-round" data-act="bewerk-undo" aria-label="Laatste aanpassing ongedaan maken" disabled>
        ${ico('undo')}</button>
      <button class="btn-ghost" data-act="bewerk-af">Laat maar</button>
      <button class="btn-cta btn-cta--flex" data-act="bewerk-klaar">Klaar</button>
    </div>
  </div>`;
};

/** In het bos is geen bereik. De kaart moet dus vóór vertrek mee, op de wifi. */
function offlineCard() {
  const o = state.offline;

  if (o.busy) {
    const pct = o.total ? Math.round(o.done / o.total * 100) : 0;
    return `<div class="offline offline--busy">
      <span class="offline__ico">${ico('cloud_download')}</span>
      <span class="offline__text">
        <span class="offline__title">Kaart wordt opgehaald…</span>
        <span class="offline__sub">${o.done} van ${o.total} tegels</span>
      </span>
      <span class="offline__bar"><span class="offline__fill" style="width:${pct}%"></span></span>
    </div>`;
  }

  if (o.fraction > 0.9) {
    return `<div class="offline offline--done">
      <span class="offline__ico">${ico('offline_pin')}</span>
      <span class="offline__text">
        <span class="offline__title">Kaart staat offline klaar</span>
        <span class="offline__sub">werkt zonder bereik</span>
      </span>
    </div>`;
  }

  return `<button class="offline" data-act="download-offline">
    <span class="offline__ico">${ico('cloud_download')}</span>
    <span class="offline__text">
      <span class="offline__title">Kaart offline meenemen</span>
      <span class="offline__sub">${o.fraction > 0
        ? `${Math.round(o.fraction * 100)}% staat er al — doe dit op de wifi`
        : 'doe dit op de wifi, in het bos is geen bereik'}</span>
    </span>
    ${ico('chevron_right', 'offline__chev')}
  </button>`;
}

views.onderweg = () => {
  const r = currentRoute();
  if (!r) return views.resultaten();

  const pr = walk.progress;
  const volgend = pr && pr.next ? pr.next : r.pois[0];

  return `
  <div class="screen">
    <div class="onderweg">
      <div class="onderweg__map" id="onderweg-map"></div>

      <div class="kaartknoppen">
        <button class="kaartknop ${state.aanzicht === 'schuin' ? 'kaartknop--aan' : ''}"
                data-act="aanzicht" aria-pressed="${state.aanzicht === 'schuin'}"
                aria-label="${state.aanzicht === 'schuin' ? 'Platte kaart' : 'Gekantelde kaart'}">
          ${ico(state.aanzicht === 'schuin' ? 'map' : 'deployed_code')}
          <span class="kaartknop__label">${state.aanzicht === 'schuin' ? '2D' : '3D'}</span>
        </button>
        <button class="kaartknop kaartknop--volg" data-act="volg-mij" data-volg
                hidden aria-label="Kaart weer op mij richten">
          ${ico('my_location')}
        </button>
      </div>

      <div class="onderweg__hud">
        <button class="onderweg__close" data-act="stop-wandeling" aria-label="Wandeling afsluiten">${ico('close')}</button>
        <div class="progress">
          <div class="progress__row">
            <span data-walked>${pr ? komma(pr.walkedM / 1000) : '0,0'} van ${esc(r.km)}</span>
            <span class="progress__eta" data-eta>${etaLabel(r, pr)}</span>
          </div>
          <div class="progress__track" role="progressbar" data-bar
               aria-valuenow="${pr ? pr.percent : 0}"
               aria-valuemin="0" aria-valuemax="100" aria-label="Voortgang wandeling">
            <div class="progress__fill" data-fill style="width:${pr ? pr.percent : 0}%"></div>
          </div>
        </div>
      </div>

      ${cacheKaartje('onderweg')}

      <div class="nextcard-wrap">
        <div class="nextcard">
          ${pr && pr.offRouteM > 60 ? `
            <div class="nextcard__alert">${ico('warning')}
              <span data-off>Je bent ${Math.round(pr.offRouteM)} m van de route</span></div>` : ''}
          <div class="nextcard__top">
            <div class="nextcard__ico" data-next-ico>${ico(volgend ? volgend.icon : 'flag')}</div>
            <div>
              <div class="nextcard__k" data-next-meta>${nextMeta(pr)}</div>
              <div class="nextcard__v" data-next-name>${esc(volgend ? volgend.naam : 'Terug bij het begin')}</div>
            </div>
          </div>
          <div class="nextcard__actions">
            ${pr && pr.done ? `
              <button class="btn-cta btn-cta--flex" data-act="stop-wandeling">
                Bekijk jullie wandeling
              </button>` : `
              <button class="btn-ghost" data-act="pauze" aria-pressed="${state.pauze}">
                ${state.pauze ? 'Doorlopen' : 'Pauze'}
              </button>
              <button class="btn-kid" data-act="to-kind">
                ${ico('child_care')}Kind wijst de weg
              </button>`}
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

/** Resterende tijd uit de echte gelopen afstand en het kindtempo van de route. */
function etaLabel(route, pr) {
  if (!pr) return `± ${route.tijd}`;
  const share = route.distanceM ? pr.remainingM / route.distanceM : 1;
  const mins = Math.round(route.kidTimeS * share / 60);
  return mins <= 1 ? 'bijna klaar' : `nog ± ${mins} min`;
}

/**
 * Hoeveel je nog te gaan hebt naar het volgende punt.
 *
 * De grootste van twee: langs de route, en hemelsbreed. Langs de route is het eerlijke
 * getal — een sloot ertussen betekent 445 meter lopen waar het 254 meter lijkt — maar
 * dat getal klapt naar nul zodra het punt naast of achter je op de lijn ligt, en dan zou
 * er "0 m" staan terwijl het punt 220 meter verderop is. De grootste van de twee is
 * altijd waar: minder dan de rechte lijn kan het nooit zijn, en minder dan wat de route
 * nog voor je heeft ook niet.
 */
function restAfstandM(pr) {
  if (!pr || !pr.next) return null;
  return Math.max(pr.nextAlongM ?? 0, pr.nextDistanceM ?? 0);
}

const nextMeta = (pr) => {
  if (!pr) return 'Volgende punt';
  if (!pr.next) return `Alle ${pr.reachedCount} punten gehad`;
  const d = Math.round(restAfstandM(pr));
  return `Volgende punt · ${d >= 1000 ? komma(d / 1000) + ' km' : d + ' m'}`;
};

views.kind = () => {
  const r = currentRoute();
  if (!r) return views.resultaten();

  const pr = walk.progress;
  const totaal = walk.tracker ? walk.tracker.pois.length : r.pois.length;
  const gevonden = pr ? pr.reachedCount : 0;
  const dots = Array.from({ length: totaal }, (_, i) =>
    `<span class="kind__dot ${i < gevonden ? 'kind__dot--on' : ''}"></span>`).join('');

  return `
  <div class="screen">
    <div class="screen__body">
      <div class="sheet kind">
        <div class="kind__blob"></div>
        <div class="kind__top">
          <div class="kind__dots" aria-label="${gevonden} van ${totaal} punten gevonden">
            ${dots}<span class="kind__count" data-kind-count>${gevonden}/${totaal}</span>
          </div>
          <button class="kind__lock" data-act="open-lock">
            ${ico('lock')}<span class="kind__lock-label">papa</span>
          </button>
        </div>

        <div class="kind__main">
          <div class="kind__compass">
            <span class="kind__needle-rot" data-needle
                  style="transform:rotate(${needleDeg()}deg)">${ico('navigation', 'kind__needle')}</span>
          </div>
          <div class="kind__dist" data-kind-dist>${kindDistance()}</div>
          <div class="kind__goal" data-kind-goal>${esc(kindGoal(pr))}</div>
          <div class="kind__nudge" data-nudge>${esc(walk.nudge)}</div>
        </div>

        <div class="kind__hints">
          ${KID_HINTS.map((k) => `
            <button class="hint" data-act="hint" data-hint="${k.key}">
              ${ico(k.icon)}<span class="hint__label">${esc(k.label)}</span>
            </button>`).join('')}
        </div>
        <input type="file" accept="image/*" capture="environment" class="verborgen-input"
               data-act="foto-file" aria-hidden="true" tabindex="-1">

        <button class="kind__cta" data-act="open-sticker">${ico('visibility')}ik zie het!</button>
        ${walk.override ? `
          <button class="kind__override" data-act="force-sticker">toch gevonden</button>` : ''}
      </div>
    </div>

    ${state.showSticker && CONFIG.stickerBeloningen ? stickerOverlay() : ''}
    ${state.showLock ? lockOverlay() : ''}
  </div>`;
};

/**
 * De afstand in de kindmodus. Zelfde regel als op het ouderscherm — zie restAfstandM():
 * langs de route als dat meer is, want dat is wat je nog moet lopen.
 */
function kindDistance() {
  const d = restAfstandM(walk.progress);
  if (d == null) return `<small>klaar!</small>`;
  const m = Math.round(d);
  return m >= 1000
    ? `${komma(m / 1000)}<small> km</small>`
    : `${m}<small> m</small>`;
}

const kindGoal = (pr) => {
  if (!pr) return 'even wachten op de satellieten…';
  // Van de route af? Dan wijst de naald terug naar het pad, en hoort dat er te staan.
  if (pr.offRouteM > OP_DE_LIJN_M) return 'eerst terug naar het pad!';
  if (!pr.next) return 'alles gevonden!';
  return `op naar ${pr.next.naam.toLowerCase()}!`;
};

/**
 * Waar de naald in de kindmodus naar wijst.
 *
 * Niet meer hemelsbreed naar het volgende punt. Dat was misleidend: de pijl wees dwars
 * door een heg, over een sloot of langs een spoor, en een kind loopt daar dan ook naar
 * toe. Hij wijst nu **de route langs** — dat is de kant waar je écht heen moet.
 *
 * Drie gevallen, en de volgorde is de rangorde:
 *   1. van de route af  → terug naar de lijn, want dat is nu het eerste dat moet;
 *   2. op de route      → de richting van de route hier (zie tracking.js);
 *   3. geen van beide   → dan is hemelsbreed naar het punt nog het beste dat we hebben.
 *
 * Alles daarna gecorrigeerd voor de kant waarop de telefoon gehouden wordt. Zonder
 * kompas houden we noord boven — beter dan niets.
 */
function needleDeg() {
  const pr = walk.progress;
  if (!pr || !state.position) return 0;
  const hier = [state.position.lon, state.position.lat];

  let doel = null;
  if (pr.offRouteM > OP_DE_LIJN_M && pr.snapped) doel = bearing(hier, pr.snapped);
  else if (pr.koersOpRoute != null) doel = pr.koersOpRoute;
  else if (pr.next) doel = bearing(hier, pr.next.coord);
  if (doel == null) return 0;

  return Math.round(needleRotation(doel, walk.heading));
}

const stickerOverlay = () => {
  const found = walk.sticker;
  const totaal = walk.tracker ? walk.tracker.pois.length : 0;
  const nummer = walk.progress ? walk.progress.reachedCount : 1;
  const icon = found ? (STICKER_FOR[found.category] || found.icon) : 'emoji_nature';
  const naam = found ? found.naam.toLowerCase() : 'iets moois';

  return `
  <div class="overlay overlay--sticker" role="dialog" aria-modal="true" aria-label="Sticker gevonden">
    <div class="sticker__badge">
      <div class="sticker__glow"></div>
      <div class="sticker__disc">${ico(icon)}</div>
    </div>
    <div class="sticker__title">${esc(naam)}<br>gevonden!</div>
    <div class="sticker__sub">sticker ${nummer} van ${totaal} · in je boek geplakt</div>
    <button class="btn-kid-cta" data-act="close-sticker">verder lopen</button>
  </div>`;
};

const lockOverlay = () => `
  <div class="overlay overlay--lock" role="dialog" aria-modal="true" aria-label="Kindmodus verlaten">
    ${ico('lock_open', 'lock__ico')}
    <h2 class="lock__title">Even voor de<br>grote mensen</h2>
    <p class="lock__sub">Voer de code in om de kindmodus te verlaten.</p>
    <div class="lock__code" data-act="focus-code">
      ${[0, 1, 2, 3].map((i) => `
        <div class="codebox ${i === state.code.length ? 'codebox--active' : ''}">${state.code[i] ? '•' : ''}</div>
      `).join('')}
      <input class="lock__input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4"
             autocomplete="off" aria-label="Code" data-act="code" value="${state.code}">
    </div>
    <button class="lock__unlock" data-act="unlock" ${state.code.length === 4 ? '' : 'disabled'}>Ontgrendelen</button>
    <button class="lock__back" data-act="close-lock">terug naar kindmodus</button>
  </div>`;

/* ── Rondjes ──────────────────────────────────────────────────────────────
   Wat je hebt: net gevonden en bewaard. Stond eerder verspreid over het
   beginscherm en het stickerboek, wat betekende dat je een bewaard rondje op twee
   plekken kon tegenkomen en op geen van beide verwachtte.
   ───────────────────────────────────────────────────────────────────────── */
views.rondjes = () => `
  <div class="screen">
    <div class="screen__body pad-tabs">
      <div class="sheet">
        <div class="topbar">
          <span class="topbar__titels">
            <span class="topbar__title">Rondjes</span>
            <span class="topbar__sub">${esc(rondjesSamenvatting() || 'nog niets')}</span>
          </span>
        </div>
        <div class="pad">
          ${state.routes.length ? `
            <div class="section-head section-head--tight" style="margin-top:6px">Net gevonden</div>
            <div class="trail">${state.routes.map(routeRow).join('')}</div>` : ''}

          ${state.saved.length ? `
            <div class="section-head section-head--tight" style="margin-top:26px">Bewaard</div>
            <div class="trail">${state.saved.map(savedRouteRow).join('')}</div>` : ''}

          ${!state.routes.length && !state.saved.length ? `
            <div class="leeg">
              ${ico('route', 'leeg__ico')}
              <p class="leeg__tekst">Hier komen de rondjes die je zoekt te staan.
                Tik op de bladwijzer bij een route om hem te bewaren.</p>
              <button class="btn-cta btn-cta--sm" data-go="instellen">Zoek een rondje</button>
            </div>` : ''}
        </div>
      </div>
    </div>
  </div>`;

/* ── Boek ─────────────────────────────────────────────────────────────────
   Van het kind. Stickers, foto's en waar jullie geweest zijn — niets om in te
   stellen, want dit is de bladzijde die hij zelf openslaat.
   ───────────────────────────────────────────────────────────────────────── */
views.boek = () => {
  const perSoort = {};
  for (const s of state.stickers) perSoort[s.category] = (perSoort[s.category] || 0) + 1;
  const km = state.walks.reduce((sum, w) => sum + (w.walkedM || 0), 0) / 1000;

  return `
  <div class="screen">
    <div class="screen__body pad-tabs">
      <div class="sheet">
        <div class="topbar">
          <span class="topbar__titels">
            <span class="topbar__title">Boek van ${esc(state.profile.naam)}</span>
            <span class="topbar__sub">${esc(statsLine(km))}</span>
          </span>
        </div>
        <div class="pad">
          <div class="section-head section-head--tight" style="margin-top:6px">Verzameld</div>
          <div class="stickers">
            ${CATEGORIES.map((c) => {
              const n = perSoort[c.key] || 0;
              return `<div class="sticker-cell ${n ? 'sticker-cell--on' : ''}"
                           title="${esc(c.label)}${n > 1 ? ` — ${n}×` : ''}">
                ${ico(STICKER_FOR[c.key] || c.icon)}
                ${n > 1 ? `<span class="sticker-cell__n">${n}</span>` : ''}
              </div>`;
            }).join('')}
          </div>

          ${state.photos.length ? `
            <div class="section-head section-head--tight" style="margin-top:28px">Foto's onderweg</div>
            <div class="fotos">
              ${state.photos.slice().reverse().map((p) => `
                <figure class="foto">
                  <img src="${fotoUrl(p)}" alt="${esc(p.naam || 'foto onderweg')}" loading="lazy">
                  ${p.naam ? `<figcaption>${esc(p.naam)}</figcaption>` : ''}
                </figure>`).join('')}
            </div>` : ''}

          ${state.walks.length ? `
            <div class="section-head section-head--tight" style="margin-top:28px">Waar jullie liepen</div>
            <div class="trail">${state.walks.slice().reverse().map(wandelingRij).join('')}</div>`
          : `<div class="leeg" style="margin-top:26px">
              ${ico('footprint', 'leeg__ico')}
              <p class="leeg__tekst">Nog niets gelopen. Na een wandeling komen hier
                de stickers en de plekken waar jullie waren.</p>
            </div>`}
        </div>
      </div>
    </div>
  </div>`;
};

/* Een gelopen wandeling. Wél een knop: erop tikken opent de terugblik met het
 * gelopen spoor erin. Wandelingen van vóór deze versie hebben dat spoor niet — die
 * openen dan met alleen de cijfers, en dat is beter dan een knop die niets doet. */
const wandelingRij = (w) => `
  <button class="wandeling" data-act="open-wandeling" data-id="${esc(w.id)}">
    <span class="wandeling__ico">${ico(w.voltooid ? 'flag' : 'footprint')}</span>
    <span class="wandeling__text">
      <span class="wandeling__naam">${esc(w.naam || 'Een rondje')}</span>
      <span class="wandeling__meta">${esc(wandelingMeta(w))}</span>
    </span>
    ${ico('chevron_right', 'wandeling__chev')}
  </button>`;

function wandelingMeta(w) {
  const d = [];
  if (w.at) d.push(new Date(w.at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }));
  if (w.walkedM) d.push(`${komma(w.walkedM / 1000)} km`);
  if (w.punten) d.push(w.punten === 1 ? '1 punt gevonden' : `${w.punten} punten gevonden`);
  return d.join(' · ');
}

/* ── Profiel ──────────────────────────────────────────────────────────────
   Wie er loopt, en alles wat je één keer instelt en daarna vergeet. Bewust
   gescheiden van het boek: dat is van hem, dit is van jou.
   ───────────────────────────────────────────────────────────────────────── */
views.profiel = () => {
  const km = state.walks.reduce((sum, w) => sum + (w.walkedM || 0), 0) / 1000;
  const tempo = Math.round(22 * (kidFactor(state.profile.leeftijd) / 1.85));

  return `
  <div class="screen">
    <div class="screen__body pad-tabs">
      <div class="sheet">
        <div class="profiel__head">
          ${state.editProfile ? profielForm() : `
          <div class="profiel__id">
            <div class="avatar">${esc(state.profile.naam[0] || '?')}</div>
            <div style="flex:1;min-width:0">
              <h1 class="profiel__name">${esc(state.profile.naam)}, ${state.profile.leeftijd} jaar</h1>
              <div class="profiel__stats">rekent met ± ${tempo} min per kilometer</div>
            </div>
            <button class="btn-icon btn-icon--flat" data-act="edit-profiel"
                    aria-label="Naam en leeftijd wijzigen">${ico('edit')}</button>
          </div>`}
        </div>

        <div class="profiel__body">
          <div class="cijfers">
            ${cijfer(komma(km), km === 1 ? 'kilometer' : 'kilometers')}
            ${cijfer(state.walks.length, state.walks.length === 1 ? 'keer op pad' : 'keer op pad')}
            ${cijfer(state.stickers.length, state.stickers.length === 1 ? 'sticker' : 'stickers')}
          </div>

          <div class="section-head">Voor de grote mensen</div>

          ${state.editSetting === 'code' ? settingForm({
            key: 'code', label: 'Oudercode (vier cijfers)', value: state.parentCode || '',
            type: 'number', hint: 'Leeg laten betekent: elke vier cijfers werkt.',
          }) : `
          <button class="setting" data-act="set-code">
            ${ico(state.parentCode ? 'lock' : 'lock_open')}
            <span class="setting__text">
              <span class="setting__title">Oudercode</span>
              <span class="setting__sub">${state.parentCode
                ? 'ingesteld — nodig om de kindmodus te verlaten'
                : 'niet ingesteld — elke vier cijfers werkt nu'}</span>
            </span>
            ${ico('chevron_right', 'setting__chev')}
          </button>`}

          ${gpxRegel()}

          <div class="section-head">De app</div>
          ${versieRegel()}
          ${installRegel()}

          <div class="dubbel">
            <button class="btn-export" data-act="export">
              ${ico('download')}Opslaan
            </button>
            <button class="btn-export" data-act="import">
              ${ico('upload')}Terugzetten
            </button>
          </div>
          <input type="file" accept="application/json,.json" class="verborgen-input"
                 data-act="import-file" aria-hidden="true" tabindex="-1">
          <p class="hint-line">Alles staat alleen op dit toestel. Eén gewiste telefoon
            en het boek is weg, dus bewaar af en toe een kopie.</p>
        </div>
      </div>
    </div>
  </div>`;
};

const cijfer = (waarde, label) => `
  <div class="cijfer">
    <span class="cijfer__n">${esc(String(waarde))}</span>
    <span class="cijfer__label">${esc(label)}</span>
  </div>`;

/* Het profiel was hardcoded op de naam uit het designdocument. Dat staat in het
 * stickerboek én in de kindmodus, dus het moet te wijzigen zijn. */
const profielForm = () => `
  <form class="profiel__form" data-act="save-profiel">
    <label class="veld">
      <span class="veld__label">Naam</span>
      <input class="veld__input" name="naam" maxlength="24" required
             value="${esc(state.profile.naam)}" autocomplete="off">
    </label>
    <label class="veld veld--kort">
      <span class="veld__label">Leeftijd</span>
      <input class="veld__input" name="leeftijd" type="number" min="1" max="17" required
             value="${state.profile.leeftijd}">
    </label>
    <div class="profiel__form-acties">
      <button type="button" class="btn-ghost btn-ghost--sm" data-act="cancel-profiel">Laat maar</button>
      <button type="submit" class="btn-cta btn-cta--sm">Opslaan</button>
    </div>
  </form>`;

/** Eén inline formulier voor de losse instellingen; leeg opslaan wist ze. */
const settingForm = ({ key, label, value, type, hint }) => `
  <form class="setting setting--form" data-act="save-setting" data-key="${key}">
    <label class="veld">
      <span class="veld__label">${esc(label)}</span>
      <input class="veld__input" name="waarde" type="${type}" value="${esc(value)}"
             autocomplete="off" ${key === 'code' ? 'inputmode="numeric" maxlength="4"' : ''}>
      <span class="veld__hint">${esc(hint)}</span>
    </label>
    <div class="profiel__form-acties">
      <button type="button" class="btn-ghost btn-ghost--sm" data-act="cancel-setting">Laat maar</button>
      <button type="submit" class="btn-cta btn-cta--sm">Opslaan</button>
    </div>
  </form>`;

function statsLine(km) {
  const w = state.walks.length, s = state.stickers.length;
  if (!w && !s) return 'nog geen wandelingen';
  const delen = [];
  delen.push(w === 1 ? '1 wandeling' : `${w} wandelingen`);
  if (km >= 0.1) delen.push(`${komma(km)} km`);
  delen.push(s === 1 ? '1 sticker' : `${s} stickers`);
  return delen.join(' · ');
}

const savedRouteRow = (r) => `
  <button class="route-row route-row--saved" data-act="open-saved" data-id="${esc(r.id)}">
    <span class="route-row__ico">${ico(r.pois && r.pois[0] ? r.pois[0].icon : 'forest')}</span>
    <span class="route-row__text">
      <span class="route-row__name">${esc(r.naam)}</span>
      <span class="route-row__meta">${esc(r.km)} · ${esc(r.tijd)} · ${esc(r.punten)}</span>
    </span>
    ${ico('chevron_right', 'route-row__chev')}
  </button>`;

/* ── Render ─────────────────────────────────────────────────────────────── */
const app = document.getElementById('schermen');
const tabs = document.getElementById('tabs');
let lastScreen = null;
let harvester = null;
let editor = null;              // actief op het bewerkscherm, anders null
let kaartWissel = false;        // is dit een schermwissel of alleen een hertekening?

// De resultaatkaartjes tekenen de echte routegeometrie als SVG; via window zodat
// de template-string erbij kan zonder de views tot modules te maken.
window.__routeSvg = (r) => mapview.routeMiniSvg(r);

/* ── De tabbalk ──────────────────────────────────────────────────────────────
   Eén keer gebouwd, daarna alleen bijgewerkt. Dat moet ook: staat hij binnen de
   schermen, dan wordt hij bij elke hertekening opnieuw gemaakt en kan de stip niet
   van tab naar tab schuiven — en juist dat schuiven is wat losse pagina's tot één
   app maakt.

   De stip is geen pil achter een icoon maar de "hier ben ik"-stip van de kaart, op
   een gestippeld paadje. Dezelfde opbouw als daar: donkere baan, lime streepjes,
   gevulde stip met een ring en een gloed. De app tekent zijn eigen navigatie in de
   taal van waar hij over gaat.
   ───────────────────────────────────────────────────────────────────────────── */
function bouwTabs() {
  tabs.innerHTML = `
    <span class="tabbar__pad" aria-hidden="true">
      <span class="tabbar__baan"></span>
      <span class="tabbar__hier"></span>
    </span>
    ${TABS.map((t) => `
      <button class="tab" data-tab="${t.screen}">
        ${ico(t.icon, 'tab__ico')}
        <span class="tab__label">${t.label}</span>
      </button>`).join('')}`;

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
}

function paintTabs() {
  const i = TAB_SCREENS.indexOf(state.screen);
  tabs.hidden = i < 0;
  if (i < 0) return;

  // Midden van het vak: het paadje loopt door de hele balk, de stip staat waar je
  // bent. Als percentage, zodat vier tabs of vijf niets aan de CSS verandert.
  tabs.style.setProperty('--hier', `${((i + 0.5) / TABS.length) * 100}%`);
  tabs.querySelectorAll('.tab').forEach((b, n) => {
    b.classList.toggle('tab--hier', n === i);
    if (n === i) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

/* Blob-URL's voor de foto's. Ze worden bij elke hertekening opnieuw gemaakt, dus
 * de oude moeten vrijgegeven worden — anders lekt elke render geheugen. */
let photoUrls = [];
const fotoUrl = (p) => {
  const url = URL.createObjectURL(p.blob);
  photoUrls.push(url);
  return url;
};

function render() {
  const body = app.querySelector('.screen__body');
  const keepScroll = lastScreen === state.screen && body ? body.scrollTop : 0;

  photoUrls.forEach(URL.revokeObjectURL);
  photoUrls = [];

  const kaartSchermen = ['detail', 'bewerken', 'onderweg', 'startpunt', 'recap'];
  if (kaartSchermen.includes(lastScreen) && !kaartSchermen.includes(state.screen)) {
    mapview.detach();
  }

  app.innerHTML = (views[state.screen] || views.welkom)();

  const newBody = app.querySelector('.screen__body');
  if (newBody && keepScroll) newBody.scrollTop = keepScroll;

  /* Kwam je net op dit scherm, of is het alleen opnieuw getekend? Dat verschil
   * bepaalt of de kaartstand opnieuw gezet mag worden. Bij elke hertekening de
   * camera terugzetten gooit een lopende kantelanimatie om — en het zou ook je
   * zoom weggooien elke keer dat er iets anders op het scherm verandert. */
  kaartWissel = lastScreen !== state.screen;
  lastScreen = state.screen;
  paintTabs();
  focusCode();
  mountMap();
}

/** De kaart verhuist naar het scherm dat hem nodig heeft. */
async function mountMap() {
  if (state.screen === 'bewerken') {
    const host = document.getElementById('bewerken-map');
    const route = currentRoute();
    if (!host || !route) return;
    await mapview.attach(window.maplibregl, host);
    // De gewone routelijn gaat uit; hieronder tekent de editor zijn eigen lijn,
    // knopen en elastiek, die per frame moeten kunnen veranderen.
    mapview.render({ route: null, position: null, fit: false });
    mapview.setRouteVisible(false);
    if (!editor) {
      editor = createEditor({
        map: mapview.instance(), container: host, route,
        targetM: state.km * 1000, shape: state.shape,
        onState: patchBewerk, onMessage: bewerkMelding,
      });
      editor.fit();
    }
    return;
  }

  /* De terugblik: bedoelde route en gelopen spoor naast elkaar, plat en stil. */
  if (state.screen === 'recap') {
    const host = document.getElementById('recap-map');
    const w = state.recap;
    if (!host || !w) return;
    await mapview.attach(window.maplibregl, host);
    mapview.setAanzicht('plat');
    mapview.setRouteVisible(true);
    mapview.render({
      route: w.coords ? { coords: w.coords, pois: [] } : null,
      trail: w.trail || null,
      position: null, padding: 34, fit: true,
    });
    return;
  }

  if (state.screen === 'startpunt') {
    const host = document.getElementById('startpunt-map');
    if (!host) return;
    const map = await mapview.attach(window.maplibregl, host);
    mapview.render({ route: null, position: state.position, fit: false });
    const p = startPunt();
    if (p) map.jumpTo({ center: [p.lon, p.lat], zoom: 14 });
    return;
  }

  const hostId = state.screen === 'detail' ? 'detail-map'
               : state.screen === 'onderweg' ? 'onderweg-map' : null;
  if (!hostId) return;
  const host = document.getElementById(hostId);
  const route = currentRoute();
  if (!host || !route) return;
  await mapview.attach(window.maplibregl, host);
  const pr = walk.progress;
  const onderweg = state.screen === 'onderweg';

  // Het detailscherm is altijd plat: daar kijk je naar een route, niet vooruit.
  // Alleen bij binnenkomst: anders klapt elke hertekening je zoom en kanteling terug.
  if (kaartWissel) mapview.setAanzicht(onderweg ? state.aanzicht : 'plat');

  mapview.render({
    // Ook het passend maken alleen bij binnenkomst: had je op het detailscherm
    // ingezoomd op een bruggetje, dan is het vervelend als dat wegspringt.
    route, position: state.position, padding: 46, fit: !onderweg && kaartWissel,
    progress: onderweg && pr && route.distanceM ? pr.walkedM / route.distanceM : null,
    // Meteen de pijl, niet eerst een frame een stip: je weet al welke kant je op liep.
    koers: onderweg ? walk.koers : null,
  });

  koppelCaches();

  if (!onderweg) return;
  // Alleen centreren als het volgen aan staat: kom je terug uit de kindmodus nadat
  // je de kaart hebt weggeschoven, dan hoort hij te blijven staan waar je hem liet.
  if (walk.follow && state.position) mapview.volg(state.position, walk.koers);
  koppelKaartKijk();
}

/* ── Geocaches op de kaart ────────────────────────────────────────────────────
   De caches uit je GPX-bestand stonden alleen in de generator: zaten ze niet in je
   route, dan wist je niet dat je er langs liep. Nu staan ze erop — als terzijde, hol
   en muntgroen, zodat ze niet te verwarren zijn met je routepunten.

   Alleen wat in beeld is. Een pocket query kan honderden caches bevatten, en die
   allemaal tekenen maakt de kaart onleesbaar terwijl je toch alleen ziet wat op het
   scherm staat.
   ───────────────────────────────────────────────────────────────────────────── */
let losCaches = null;

function koppelCaches() {
  if (losCaches) { losCaches(); losCaches = null; }

  /* Alleen waar het je helpt. Niet op *bewerken*, want daar sleep je de lijn en zijn
   * extra stippen ruis die je per ongeluk aantikt. Niet in de kindmodus, die is met
   * opzet leeg. Niet op de terugblik, die gaat over wat je gelópen hebt. */
  const hier = state.screen === 'detail' || state.screen === 'onderweg';
  if (!hier || !state.caches.length) { mapview.paintCaches([]); return; }

  const inDeRoute = new Set((currentRoute()?.pois || [])
    .filter((p) => p.category === 'cache').map((p) => p.naam));

  const bijwerken = () => {
    // De caches die al een punt van je route zijn, staan er al als lime ring.
    const kandidaten = state.caches.filter((c) => !inDeRoute.has(c.naam));
    mapview.paintCaches(mapview.cachesInBeeld(kandidaten));
  };

  bijwerken();
  const losBeeld = mapview.onBeeldWissel(bijwerken);
  const losTap = mapview.onCacheTap((props) => {
    state.cacheKaart = { naam: props.naam, url: props.url || null, code: props.code || null };
    render();
  });
  losCaches = () => { losBeeld(); losTap(); };
}

/** Het kaartje dat verschijnt als je een cache aantikt. Geen nieuw tabblad opengooien
 *  onder je duim: eerst zien wát je hebt aangetikt, dan zelf beslissen. */
function cacheKaartje(plek) {
  const c = state.cacheKaart;
  if (!c) return '';
  return `
  <div class="cachetip cachetip--${plek}">
    <span class="cachetip__ico">${ico('travel_explore')}</span>
    <span class="cachetip__text">
      <span class="cachetip__naam">${esc(c.naam)}</span>
      <span class="cachetip__sub">geocache uit je eigen bestand${c.code ? ` · ${esc(c.code)}` : ''}</span>
    </span>
    ${c.url ? `<a class="cachetip__doe" href="${esc(c.url)}" target="_blank"
                  rel="noopener noreferrer">Hint</a>` : ''}
    <button class="cachetip__weg" data-act="cachetip-weg" aria-label="Sluiten">${ico('close')}</button>
  </div>`;
}

/**
 * Zodra jij de kaart pakt, stopt het volgen — en komt er een knop om het weer aan
 * te zetten. Zonder dit schoot de kaart bij elke GPS-tik terug naar je eigen
 * positie en kon je dus nooit even verder vooruit op de route kijken.
 */
function koppelKaartKijk() {
  if (walk.stopKaartKijk) walk.stopKaartKijk();
  walk.stopKaartKijk = mapview.onUserMove(() => {
    if (!walk.follow) return;
    walk.follow = false;
    toonVolgKnop();
  });
  toonVolgKnop();
}

function toonVolgKnop() {
  const b = app.querySelector('[data-volg]');
  if (b) b.hidden = walk.follow;
}

function volgWeer() {
  walk.follow = true;
  toonVolgKnop();
  if (state.position) mapview.volg(state.position, walk.koers, { zacht: true });
}

function wisselAanzicht() {
  state.aanzicht = state.aanzicht === 'schuin' ? 'plat' : 'schuin';
  store.setSetting('aanzicht', state.aanzicht).catch(() => {});

  // Volgen weer aan: je hebt net gezegd hóe je wil kijken, dus wil je ook zien waar
  // je bent. En in gekantelde stand is een kaart die niet meedraait onbruikbaar.
  walk.follow = true;
  // Eén animatie voor kanteling, draaiing, zoom én middelpunt. Twee animaties over
  // dezelfde camera vechten, en dan haalt geen van beide zijn eindstand.
  const stand = walk.vloeiend && walk.vloeiend.stand();
  mapview.setAanzicht(state.aanzicht, {
    zacht: true,
    position: stand || state.position,
    koers: walk.koers,
  });
  render();
}

/* ── Live tracking ────────────────────────────────────────────────────────
   Loopt zolang je op *onderweg* of in de *kindmodus* bent; tussen die twee
   schermen wisselen laat de wandeling doorlopen.
   ───────────────────────────────────────────────────────────────────────── */
function startWalk() {
  const route = currentRoute();
  if (!route || walk.tracker) return;

  const hervat = hervatKlaar;
  hervatKlaar = null;

  walk.tracker = createTracker(route, hervat);
  // Bij hervatten meteen één keer doorrekenen, zodat de balk en de kaart de al
  // gelopen kilometers laten zien in plaats van nul tot de eerste GPS-tik.
  walk.progress = hervat
    ? walk.tracker.update(state.position || {
        lat: route.coords[0][1], lon: route.coords[0][0], accuracy: 99,
      })
    : null;
  walk.override = false;
  walk.follow = true;
  walk.koers = null;
  walk.trail = hervat && Array.isArray(hervat.trail) ? hervat.trail.slice() : [];
  walk.startedAt = (hervat && hervat.startedAt) || Date.now();
  walk.bewaardOp = 0;
  walk.klaarGemeld = false;
  state.pauze = false;
  hervatVolgen();
}

/** Positie en kompas (opnieuw) laten lopen. Apart, zodat pauze ze kan stoppen
 *  en weer starten zonder de voortgang kwijt te raken. */
function hervatVolgen() {
  const route = currentRoute();
  if (!route) return;

  startVloeiend();

  const onMove = (p) => {
    volgSpoor(p);
    state.position = p;
    walk.progress = walk.tracker.update(p);
    // Ná de tracker: de koers komt bij voorkeur uit de routerichting, en die weet de
    // tracker pas als hij je positie op de lijn geprojecteerd heeft.
    bepaalKoers(p, walk.progress);

    /* De stip en de kaart krijgen niet deze meting maar een doel om naartoe te
     * kruipen. Eén sprong per seconde is wat "hakkelig" is; het tekenen gebeurt
     * daarom 60 keer per seconde in startVloeiend().
     *
     * En niet de ruwe meting maar de op de route geprojecteerde plek, zolang je
     * binnen GPS-ruis van de lijn loopt — anders wiebelt de stip om het pad heen
     * terwijl je kaarsrecht loopt. Ben je écht van de route af, dan is de ruwe
     * meting het eerlijke antwoord en zegt de kaart dat ook. */
    const pr = walk.progress;
    const opDeLijn = pr.offRouteM <= OP_DE_LIJN_M && pr.snapped;
    walk.vloeiend.push({
      lon: opDeLijn ? pr.snapped[0] : p.lon,
      lat: opDeLijn ? pr.snapped[1] : p.lat,
      koers: walk.koers,
    });

    // Rondje rond: één keer hertekenen, zodat de kaart de knop naar de terugblik
    // krijgt in plaats van de pauzeknop. Daarna weer alleen ter plekke bijwerken.
    if (walk.progress.done && !walk.klaarGemeld) {
      walk.klaarGemeld = true;
      bewaarLopend({ nu: true });
      render();
      return;
    }

    paintWalk();
    bewaarLopend();
  };

  const sim = simulationSetting();
  walk.stopWatch = sim
    ? simulateWalk(route, onMove, {
        ...sim,
        startFraction: walk.progress && route.distanceM
          ? walk.progress.walkedM / route.distanceM : 0,
      })
    : watchPosition(onMove, (e) => showNudge(e.message));

  walk.stopCompass = startCompass((h) => { walk.heading = h; paintNeedle(); });
}

function stopWalk({ vastleggen = true } = {}) {
  const vast = vastleggen ? legWandelingVast() : null;
  /* Het wandelscherm verlaten is een besluit, dus de lopende wandeling is voorbij.
   * Een herlaadactie komt hier nooit langs — precies het geval dat wél hervat moet
   * worden. Zonder dit zou er later een hervat-kaart opduiken voor een wandeling die
   * al in het boek staat, en tel je hem dubbel. */
  store.clearLopend().catch(() => {});
  state.hervat = null;
  if (walk.stopWatch) walk.stopWatch();
  if (walk.stopCompass) walk.stopCompass();
  if (walk.stopKaartKijk) walk.stopKaartKijk();
  if (walk.vloeiend) walk.vloeiend.stop();
  clearTimeout(walk.nudgeTimer);
  Object.assign(walk, {
    tracker: null, progress: null, heading: null, sticker: null,
    nudge: '', override: false, stopWatch: null, stopCompass: null,
    stopKaartKijk: null, koers: null, trail: [],
    startedAt: null, bewaardOp: 0, klaarGemeld: false, vloeiend: null,
  });
  return vast;
}

/**
 * Het tekenen tussen de metingen door.
 *
 * Alles wat 60 keer per seconde gebeurt staat hier, en dat is bewust weinig: één punt
 * naar de kaart en de camera meeschuiven. De route, de balk en de teksten veranderen
 * maar één keer per meting en horen dus in paintWalk().
 */
function startVloeiend() {
  if (walk.vloeiend) walk.vloeiend.stop();
  walk.vloeiend = createVloeiend(({ lon, lat, koers }) => {
    if (state.screen !== 'onderweg' && state.screen !== 'kind') return;
    mapview.paintMij({ lon, lat }, koers);
    if (walk.follow) mapview.volg({ lon, lat }, koers);
  });
}

/* ── Waar je heen loopt, en waar je geweest bent ────────────────────────────── */

/**
 * Welke kant je op loopt.
 *
 * Níet het kompas: dat zegt waar de telefoon heen wijst, en met een telefoon los in je
 * hand klapt een op het kompas gedraaide kaart alle kanten op.
 *
 * Maar ook niet meer de peiling tussen twee GPS-metingen. Die is te onrustig om op te
 * draaien, en dat is geen kwestie van harder dempen: bij een fout van 10 m over 6 m
 * beweging zit de richting er al meer dan 50° naast. Zwaarder dempen maakt de kaart dan
 * traag én blijft onrustig.
 *
 * Dus: de richting van de róute, zolang je hem volgt. Die lijn beweegt niet, dus die
 * richting is rustig — en zolang je erop loopt is het precies waar je heen gaat. Ben je
 * er echt van af, dan valt hij terug op je eigen beweging, maar dan over 20 meter in
 * plaats van over twee metingen.
 */
function bepaalKoers(p, pr) {
  const nu = [p.lon, p.lat];
  let nieuw = null;

  if (pr && pr.koersOpRoute != null && pr.offRouteM <= OP_DE_LIJN_M) {
    nieuw = pr.koersOpRoute;
  } else {
    // Terug in het spoor tot we ver genoeg weg zijn. Het spoor is per 15 m uitgedund,
    // dus dit zijn hoogstens een paar stappen terug.
    for (let i = walk.trail.length - 1; i >= 0; i--) {
      if (distM(walk.trail[i], nu) >= BASISLIJN_M) { nieuw = bearing(walk.trail[i], nu); break; }
    }
  }
  if (nieuw == null) return;

  if (walk.koers == null) { walk.koers = nieuw; return; }
  // Alleen bijstellen als het echt een andere kant op is. De demper in
  // src/vloeiend.js maakt van elke stap alsnog een vloeiende draai.
  if (Math.abs(hoekVerschil(walk.koers, nieuw)) > DODE_ZONE_GRADEN) walk.koers = nieuw;
}

/** Verschil tussen twee richtingen, −180..180. */
const hoekVerschil = (a, b) => ((b - a + 540) % 360) - 180;

/** Het spoor uitgedund bijhouden: elke 15 meter een punt is genoeg om de vorm te
 *  bewaren, en houdt een wandeling van 6 km op een paar honderd punten. */
function volgSpoor(p) {
  const nu = [p.lon, p.lat];
  const laatste = walk.trail[walk.trail.length - 1];
  if (!laatste || distM(laatste, nu) >= 15) walk.trail.push(nu);
}

/**
 * De lopende wandeling wegschrijven.
 *
 * Bestaat om één reden: per ongeluk naar beneden trekken herlaadt de app, en dan was
 * je hele wandeling weg. De hele route gaat mee, want na een herlaadactie is
 * `state.routes` leeg en een net gegenereerd rondje is dan nergens meer te vinden.
 *
 * Hoogstens elke 4 seconden, want dit gebeurt bij elke GPS-tik en de opslag hoeft de
 * wandeling niet op te houden.
 */
function bewaarLopend({ nu = false } = {}) {
  if (!walk.tracker) return;
  const t = Date.now();
  if (!nu && t - walk.bewaardOp < 4000) return;
  walk.bewaardOp = t;

  const r = currentRoute();
  if (!r) return;
  store.setLopend({
    route: r,
    voortgang: walk.tracker.snapshot(),
    trail: walk.trail,
    startedAt: walk.startedAt,
    bewaardOp: t,
  }).catch((e) => console.warn('lopende wandeling niet bewaard:', e.message));
}

const paintText = (sel, text) => {
  const el = app.querySelector(sel);
  if (el) el.textContent = text;
};

/** Waarden bijwerken zonder hertekenen: een re-render per GPS-tik zou de kaart
 *  laten flikkeren en de naald laten haperen. */
function paintWalk() {
  const pr = walk.progress;
  const r = currentRoute();
  if (!pr || !r) return;

  if (state.screen === 'onderweg') {
    paintText('[data-walked]', `${komma(pr.walkedM / 1000)} van ${r.km}`);
    paintText('[data-eta]', etaLabel(r, pr));
    paintText('[data-next-meta]', nextMeta(pr));
    paintText('[data-next-name]', pr.next ? pr.next.naam : 'Terug bij het begin');

    const fill = app.querySelector('[data-fill]');
    if (fill) fill.style.width = `${pr.percent}%`;
    const bar = app.querySelector('[data-bar]');
    if (bar) bar.setAttribute('aria-valuenow', String(pr.percent));
    const icon = app.querySelector('[data-next-ico] .ms');
    if (icon && pr.next) icon.textContent = pr.next.icon;

    /* Alleen het verloop op de lijn; de lijn zelf en de punten staan er al. Hier de
     * hele route opnieuw wegschrijven zou honderden coördinaten per meting kosten,
     * en de stip en de camera worden al 60 keer per seconde bijgewerkt. */
    mapview.setProgress(r.distanceM ? pr.walkedM / r.distanceM : 0);
  }

  if (state.screen === 'kind') {
    const dist = app.querySelector('[data-kind-dist]');
    if (dist) dist.innerHTML = kindDistance();
    paintText('[data-kind-goal]', kindGoal(pr));
    paintText('[data-kind-count]', `${pr.reachedCount}/${walk.tracker.pois.length}`);
    app.querySelectorAll('.kind__dot').forEach((d, i) =>
      d.classList.toggle('kind__dot--on', i < pr.reachedCount));
    paintNeedle();
  }
}

function paintNeedle() {
  const el = app.querySelector('[data-needle]');
  if (el) el.style.transform = `rotate(${needleDeg()}deg)`;
}

/** "ik zie het!" — de nabijheids-gate. */
function claimSticker({ force = false } = {}) {
  if (!CONFIG.stickerBeloningen) return;
  const pr = walk.progress;

  if (!pr || !pr.next) {
    showNudge(pr ? 'je hebt alles al gevonden!' : 'nog even wachten op de satellieten…');
    return;
  }

  const near = pr.nextDistanceM <= pr.threshold;
  if (!near && !force) {
    // De app mag het nooit onterecht tegenhouden: na een mislukte poging komt er
    // een "toch gevonden" onder de knop te staan.
    showNudge(`nog ${Math.round(pr.nextDistanceM)} meter!`);
    if (!walk.override) { walk.override = true; render(); }
    return;
  }

  const found = pr.next;
  walk.sticker = found;
  walk.tracker.markReached(found.index);
  walk.progress = walk.tracker.update(state.position);
  walk.override = false;
  walk.nudge = '';
  state.showSticker = true;
  render();

  // Vastleggen mag de sticker niet ophouden: het kind ziet hem meteen, de
  // opslag volgt. Mislukt dat, dan is de wandeling niet stuk.
  store.addSticker({
    category: found.category, naam: found.naam,
    lat: found.coord[1], lon: found.coord[0],
    routeNaam: (currentRoute() || {}).naam || null,
  }).then(() => store.listStickers())
    .then((all) => { state.stickers = all; refreshIfShowing('profiel'); })
    .catch((e) => console.warn('sticker niet opgeslagen:', e.message));
}

/** Hertekenen alleen als het huidige scherm die data ook toont. Anders zou een
 *  achtergrondtaak de kaart onnodig opnieuw opbouwen en laten flikkeren. */
function refreshIfShowing(...screens) {
  if (screens.includes(state.screen)) render();
}

/* ── Opslag ─────────────────────────────────────────────────────────────── */

async function laadOpslag() {
  try {
    store.requestPersistence();          // niet op wachten; het is een verzoek
    const [profiel, stickers, saved, walks, photos, code, gpxBron, caches,
           aanzicht, lopend] = await Promise.all([
      store.getProfile(), store.listStickers(), store.listSavedRoutes(), store.listWalks(),
      store.listPhotos(), store.getSetting('parentCode'), store.getSetting('gpxBron'),
      store.listCaches(), store.getSetting('aanzicht'), store.getLopend(),
    ]);
    state.photos = photos;
    // Alleen overnemen als er echt een profiel staat; anders het huidige bewaren.
    if (profiel && profiel.naam) state.profile = profiel;
    else store.setProfile(state.profile);
    state.stickers = stickers;
    state.saved = saved;
    state.walks = walks;
    state.parentCode = code || null;
    state.gpxBron = gpxBron || null;
    state.caches = caches || [];
    if (aanzicht === 'plat' || aanzicht === 'schuin') state.aanzicht = aanzicht;
    pakLopendeOp(lopend);
    render();
  } catch (e) {
    // Zonder opslag werkt de app verder; alleen het boek onthoudt niets.
    console.warn('opslag niet beschikbaar:', e.message);
  }
}

/**
 * Wat te doen met een wandeling die open bleef staan.
 *
 * Sta je nog op `#/onderweg` of in de kindmodus, dan is de app net herladen terwijl
 * je liep — dan pak je hem stil weer op. Dat is de hele reden dat dit bestaat: een
 * per ongeluk naar beneden getrokken pagina mag je wandeling niet kosten.
 *
 * Open je de app gewoon opnieuw, dan verschijnt er een kaart op het beginscherm.
 * Ongevraagd in een wandeling belanden is verwarrend; één tik is genoeg.
 *
 * Ouder dan een halve dag laten we vallen. Dat is geen onderbreking meer maar een
 * vergeten wandeling, en die weer oppakken zou onzin optellen.
 */
function pakLopendeOp(lopend) {
  if (!lopend || !lopend.route || !lopend.route.coords) return;

  const uren = (Date.now() - (lopend.bewaardOp || 0)) / 36e5;
  if (uren > 12) { store.clearLopend().catch(() => {}); return; }

  const middenIn = state.screen === 'onderweg' || state.screen === 'kind';
  if (!middenIn) { state.hervat = lopend; return; }

  state.routes = [lopend.route, ...state.routes.filter((x) => x.id !== lopend.route.id)];
  state.routeId = 0;
  hervatKlaar = { ...(lopend.voortgang || {}), trail: lopend.trail, startedAt: lopend.startedAt };
  if (!walk.tracker) startWalk();
}

async function bewaarRoute(button) {
  const r = currentRoute();
  if (!r) return;
  const id = r.id && r.id.startsWith('saved-') ? r.id : `saved-${Date.now()}`;
  const aanwezig = state.saved.some((x) => x.id === id || x.naam === r.naam);

  if (aanwezig) {
    const bestaand = state.saved.find((x) => x.naam === r.naam);
    await store.deleteRoute(bestaand.id);
  } else {
    await store.saveRoute({ ...r, id });
  }
  state.saved = await store.listSavedRoutes();

  const nu = !aanwezig;
  button.setAttribute('aria-pressed', String(nu));
  button.querySelector('.ms').textContent = nu ? 'bookmark_added' : 'bookmark';
}

async function exportBestand() {
  try {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stapper-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn('export mislukt:', e.message);
  }
}

/** Pauze zette alleen een label om. Nu stopt hij het volgen echt — dat scheelt
 *  accu tijdens een picknick, en de voortgang blijft staan waar je stopte. */
function togglePauze() {
  state.pauze = !state.pauze;

  if (state.pauze) {
    if (walk.stopWatch) walk.stopWatch();
    if (walk.stopCompass) walk.stopCompass();
    // Ook het tekenen tussen de metingen stoppen: zonder nieuwe metingen kruipt de
    // stip nergens meer naartoe, en dan is een lopende animatielus alleen accu.
    if (walk.vloeiend) walk.vloeiend.stop();
    walk.stopWatch = walk.stopCompass = walk.vloeiend = null;
  } else if (walk.tracker) {
    hervatVolgen();
  }
  render();
}

/* ── Route aanpassen ────────────────────────────────────────────────────────
   De balk bovenin en de knoppen onderin worden ter plekke bijgewerkt, nooit via
   render(): een hertekening zou de kaart opnieuw opbouwen en het duimlabel
   weggooien — precies de twee dingen die tijdens het slepen moeten blijven staan.
   ───────────────────────────────────────────────────────────────────────────── */
let bewerkState = null;
let padPijlTimer = null;
let uitlegTimer = null;

const UITLEG = 'Sleep de lijn naar waar je wél wil lopen. Tik op een punt om het eruit te halen.';

function patchBewerk(s) {
  bewerkState = s;
  tekenBewerk();
}

function tekenBewerk() {
  const s = bewerkState;
  const km = app.querySelector('[data-bewerk-km]');
  const sub = app.querySelector('[data-bewerk-sub]');
  if (!s || !km || !sub) return;

  km.textContent = `${(s.distanceM / 1000).toFixed(1).replace('.', ',')} km`;
  km.classList.toggle('bewerk__km--bezig', s.bezig);

  if (s.bezig) {
    sub.innerHTML = 'het echte pad zoeken…';
  } else {
    const delen = [];
    if (s.pathShare != null) {
      const nu = Math.round(s.pathShare * 100);
      const was = s.vorigePad == null ? null : Math.round(s.vorigePad * 100);
      // Het verschil tonen is het hele punt van slepen: je ziet dat je omweg
      // je van asfalt naar paadjes brengt. Na een paar tellen valt het weg.
      const pijl = was != null && !s.pijlWeg && Math.abs(nu - was) >= 2;
      delen.push(pijl ? `<span class="bewerk__was">${was}%</span> ${nu}% paadjes`
                      : `${nu}% paadjes`);
      clearTimeout(padPijlTimer);
      if (pijl) padPijlTimer = setTimeout(() => { s.pijlWeg = true; tekenBewerk(); }, 2600);
    }
    delen.push(vormLabel(s.overlap));
    if (s.vormpunten) {
      delen.push(`${s.vormpunten} eigen bocht${s.vormpunten > 1 ? 'en' : ''}`);
    }
    sub.innerHTML = delen.join(' · ');
  }

  const undo = app.querySelector('[data-act="bewerk-undo"]');
  if (undo) undo.disabled = !s.canUndo;

  const klaar = app.querySelector('[data-act="bewerk-klaar"]');
  if (klaar) klaar.disabled = s.bezig;
}

function bewerkMelding(tekst) {
  const el = app.querySelector('[data-bewerk-uitleg]');
  if (!el) return;
  el.textContent = tekst;
  el.classList.add('bewerk__uitleg--melding');
  clearTimeout(uitlegTimer);
  uitlegTimer = setTimeout(() => {
    el.textContent = UITLEG;
    el.classList.remove('bewerk__uitleg--melding');
  }, 3600);
}

function sluitEditor() {
  clearTimeout(padPijlTimer);
  clearTimeout(uitlegTimer);
  bewerkState = null;
  editor.destroy();
  editor = null;
  mapview.setRouteVisible(true);
}

function bewerkKlaar() {
  if (!editor) { go('detail'); return; }
  const res = editor.resultaat();
  if (res.veranderd) pasRouteToe(res);
  go('detail');
  if (res.veranderd) {
    // De corridor is verschoven, dus de opgehaalde tegels dekken hem niet meer.
    state.offline = { fraction: 0, busy: false, done: 0, total: 0 };
    checkOffline();
    werkBewaardeBij();
  }
}

/**
 * De aangepaste route terugschrijven met dezelfde labels die de generator geeft.
 * Alles wat op het detailscherm staat komt hieruit, dus het moet compleet zijn:
 * een route met een nieuwe lijn maar een oude afstand is erger dan geen route.
 */
function pasRouteToe(res) {
  const r = currentRoute();
  const kf = kidFactor(state.profile.leeftijd);
  const pois = res.waypoints.filter((w) => w.kind === 'poi' && w.poi).map((w) => w.poi);
  const doel = state.km * 1000;

  state.routes[state.routeId] = {
    ...r,
    coords: res.coords,
    waypoints: res.waypoints,
    distanceM: res.distanceM,
    km: `${(res.distanceM / 1000).toFixed(1).replace('.', ',')} km`,
    walkTimeS: res.timeS,
    kidTimeS: res.timeS * kf,
    tijd: formatDuration(res.timeS * kf),
    pathShare: res.pathShare,
    padLabel: res.pathShare == null ? null : `${Math.round(res.pathShare * 100)}% paadjes`,
    byKind: res.byKind,
    overlap: res.overlap,
    vormLabel: vormLabel(res.overlap),
    pois,
    punten: `${pois.length} punten`,
    badge: 'Zelf aangepast',
    // De eis die je liet vallen is niet meer relevant zodra je zelf hebt gesleept.
    dropped: [],
    error: Math.abs(res.distanceM - doel) / doel,
  };
}

/** Stond dit rondje in het boek, dan hoort daar nu de aangepaste versie in. */
async function werkBewaardeBij() {
  const r = currentRoute();
  const bestaand = state.saved.find((x) => x.naam === r.naam);
  if (!bestaand) return;
  try {
    await store.saveRoute({ ...r, id: bestaand.id });
    state.saved = await store.listSavedRoutes();
  } catch (e) {
    console.warn('bewaarde route niet bijgewerkt:', e.message);
  }
}

/* ── Offline kaart ──────────────────────────────────────────────────────── */

async function haalOffline() {
  const r = currentRoute();
  if (!r || state.offline.busy) return;

  state.offline = { fraction: state.offline.fraction, busy: true, done: 0, total: 0 };
  render();

  try {
    await offline.downloadRoute(r, (done, total) => {
      state.offline.done = done;
      state.offline.total = total;
      // Ter plekke bijwerken; hertekenen zou de kaart opnieuw opbouwen.
      const bar = app.querySelector('.offline__fill');
      const sub = app.querySelector('.offline--busy .offline__sub');
      if (bar && total) bar.style.width = `${Math.round(done / total * 100)}%`;
      if (sub) sub.textContent = `${done} van ${total} tegels`;
    });
    state.offline.fraction = await offline.coverage(r);
  } catch (e) {
    console.warn('offline ophalen mislukt:', e.message);
    showNudge('Offline meenemen lukte niet.');
  } finally {
    state.offline.busy = false;
    render();
  }
}

/** Bij het openen van een route: staat die al offline? */
async function checkOffline() {
  const r = currentRoute();
  if (!r) return;
  try {
    const fraction = await offline.coverage(r);
    if (fraction !== state.offline.fraction) {
      state.offline.fraction = fraction;
      refreshIfShowing('detail');
    }
  } catch { /* geen cache-ondersteuning; dan blijft de knop gewoon staan */ }
}

/**
 * Wandeling vastleggen als er echt gelopen is. Zo blijven de statistieken in het
 * stickerboek eerlijk: even naar het scherm kijken is geen wandeling.
 *
 * De routelijn en het gelopen spoor gaan mee, want daar bestaat de terugblik uit —
 * en zonder dat kun je een wandeling van vorige maand alleen nog als getal zien.
 */
function legWandelingVast() {
  const r = currentRoute();
  const pr = walk.progress;
  if (!r || !pr || pr.walkedM < 250) return null;

  const record = {
    id: `walk-${Date.now()}`,
    naam: r.naam,
    km: r.km,
    distanceM: r.distanceM,
    walkedM: Math.round(pr.walkedM),
    punten: pr.reachedCount,
    puntenTotaal: walk.tracker ? walk.tracker.pois.length : r.pois.length,
    voltooid: pr.done,
    duurS: walk.startedAt ? Math.round((Date.now() - walk.startedAt) / 1000) : null,
    gevonden: walk.tracker
      ? walk.tracker.pois.filter((p) => p.reached).map((p) => ({ naam: p.naam, icon: p.icon, category: p.category }))
      : [],
    coords: r.coords,
    trail: walk.trail.slice(),
    pathShare: r.pathShare ?? null,
  };

  store.recordWalk(record)
    .then(() => store.listWalks())
    .then((all) => { state.walks = all; refreshIfShowing('profiel', 'home', 'boek'); })
    .catch((e) => console.warn('wandeling niet opgeslagen:', e.message));

  return { ...record, at: Date.now() };
}

/**
 * De wandeling afsluiten.
 *
 * Heb je echt gelopen, dan volgt de terugblik — anders was het een verkeerde tik en
 * ga je gewoon terug naar de route. In beide gevallen is de lopende wandeling weg,
 * zodat er niet later een hervat-kaart opduikt voor iets dat je hebt afgesloten.
 */
function sluitWandeling() {
  const vast = stopWalk();
  store.clearLopend().catch(() => {});
  state.hervat = null;
  state.recap = vast;
  go(vast ? 'recap' : 'detail');
}

/**
 * Een onderbroken wandeling weer oppakken.
 *
 * De route komt uit de opslag en niet uit `state.routes`: na een herlaadactie is die
 * lijst leeg, en een net gegenereerd rondje bestaat dan nergens meer.
 */
function hervatWandeling() {
  const h = state.hervat;
  if (!h || !h.route) return;

  state.routes = [h.route, ...state.routes.filter((x) => x.id !== h.route.id)];
  state.routeId = 0;
  state.detailVan = 'rondjes';
  state.hervat = null;
  hervatKlaar = { ...(h.voortgang || {}), trail: h.trail, startedAt: h.startedAt };
  go('onderweg');
}

/* Doorgeefluik naar startWalk(), die vanuit enter() geroepen wordt en dus geen
 * argument mee kan krijgen. Eén keer geldig: daarna begint een wandeling gewoon. */
let hervatKlaar = null;

/* ── De terugblik ────────────────────────────────────────────────────────────
   Na de wandeling wil je zien wát je gelopen hebt. Niet de bedoelde route maar de
   echte: het spoor uit de GPS, naast de lijn die je van plan was.
   ───────────────────────────────────────────────────────────────────────────── */

/* Gemiddelde lengte per leeftijd in centimeters. Staplengte is ruwweg 0,42 × je
 * lengte; dat is de vuistregel waar stappentellers ook mee beginnen. Er is geen
 * stappenteller in een browser, dus dit is en blijft een schatting — en de app
 * zegt dat er dan ook bij in plaats van een precies getal te suggereren. */
const LENGTE_CM = {
  2: 87, 3: 95, 4: 103, 5: 110, 6: 116, 7: 122, 8: 128, 9: 133, 10: 139, 11: 145, 12: 152,
};

function stappenVoor(meters, leeftijd) {
  const jaar = Math.round(Number(leeftijd) || 6);
  const cm = LENGTE_CM[Math.max(2, Math.min(12, jaar))] || 116;
  const stapM = 0.42 * (jaar > 12 ? 1.68 : cm / 100);
  // Op vijftigtallen afronden: alles preciezer dan dat zou doen alsof het gemeten is.
  return Math.max(0, Math.round(meters / stapM / 50) * 50);
}

views.recap = () => {
  const w = state.recap;
  if (!w) return views.boek();

  const stappen = stappenVoor(w.walkedM || 0, state.profile.leeftijd);
  const minuten = w.duurS ? Math.round(w.duurS / 60) : null;

  return `
  <div class="screen">
    <div class="screen__body pad-footer">
      <div class="sheet">
        <div class="recap__hero" id="recap-map">
          <button class="detail__back" data-act="recap-terug" aria-label="Terug">${ico('arrow_back')}</button>
          <span class="recap__legenda">
            <span class="recap__leg"><i class="recap__streep recap__streep--route"></i>bedoeld</span>
            <span class="recap__leg"><i class="recap__streep recap__streep--trail"></i>gelopen</span>
          </span>
        </div>

        <div class="detail__sheet">
          <div class="detail__grip"></div>
          <div class="recap__kicker">${w.voltooid ? 'Rondje rond!' : 'Onderweg gestopt'}</div>
          <h1 class="detail__title">${esc(w.naam || 'Jullie wandeling')}</h1>

          <div class="cijfers cijfers--recap">
            ${cijfer(komma((w.walkedM || 0) / 1000), 'km gelopen')}
            ${cijfer(`± ${stappen.toLocaleString('nl-NL')}`, 'stappen')}
            ${cijfer(minuten == null ? '—' : minuten, 'min onderweg')}
          </div>

          <p class="hint-line">De stappen zijn geschat uit de afstand en de gemiddelde
            staplengte bij ${state.profile.leeftijd} jaar; een browser heeft geen
            stappenteller. De tijd is van start tot afsluiten, dus pauzes en
            stilstaan bij een bruggetje zitten erin — er is geen manier om lopen van
            kijken te onderscheiden.</p>

          ${(w.gevonden || []).length ? `
            <div class="section-head section-head--tight">Gevonden onderweg</div>
            <div class="poi-list">
              ${w.gevonden.map((p) => `
                <div class="poi">
                  <span class="poi__ico">${ico(STICKER_FOR[p.category] || p.icon || 'star')}</span>
                  <span class="poi__text">
                    <span class="poi__name">${esc(p.naam)}</span>
                    <span class="poi__meta">sticker in het boek</span>
                  </span>
                </div>`).join('')}
            </div>`
          : `<p class="hint-line">Onderweg is er niets afgevinkt. Dat mag ook — een
              rondje lopen is genoeg.</p>`}

          ${w.puntenTotaal ? `<p class="hint-line">${w.punten} van ${w.puntenTotaal}
            punten gevonden${w.voltooid ? ', en het rondje is rond' : ''}.</p>` : ''}
        </div>
      </div>
    </div>

    <div class="screen__footer">
      <button class="btn-cta" data-act="recap-klaar">Klaar</button>
    </div>
  </div>`;
};

/* ── De drie tegels in de kindmodus ─────────────────────────────────────── */

function doeHint(key) {
  const pr = walk.progress;
  const next = pr && pr.next;

  if (key === 'zoek') {
    showNudge(next ? (ZOEK_HINT[next.category] || `zoek ${next.naam.toLowerCase()}`)
                   : 'je hebt alles al gevonden!');
    return;
  }

  if (key === 'foto') {
    app.querySelector('[data-act="foto-file"]')?.click();
    return;
  }

  if (key === 'lees') {
    if (!('speechSynthesis' in window)) { showNudge('voorlezen kan niet op dit toestel'); return; }
    const d = next && pr.nextDistanceM != null ? Math.round(pr.nextDistanceM) : null;
    const tekst = next
      ? `Nog ${d} meter naar ${next.naam}. ${ZOEK_HINT[next.category] || ''}`
      : 'Je hebt alle punten gevonden. Goed gedaan!';
    const u = new SpeechSynthesisUtterance(tekst);
    u.lang = 'nl-NL';
    u.rate = 0.9;                 // iets langzamer; het is voor een kind
    speechSynthesis.cancel();     // niet over een vorige heen praten
    speechSynthesis.speak(u);
    showNudge('luister…');
  }
}

async function bewaarFoto(file) {
  const pr = walk.progress;
  try {
    await store.addPhoto({
      blob: file,
      type: file.type,
      naam: pr && pr.next ? pr.next.naam : null,
      routeNaam: (currentRoute() || {}).naam || null,
      lat: state.position ? state.position.lat : null,
      lon: state.position ? state.position.lon : null,
    });
    state.photos = await store.listPhotos();
    showNudge('foto bewaard!');
  } catch (e) {
    console.warn('foto niet bewaard:', e.message);
    showNudge('foto bewaren lukte niet');
  }
}

function showNudge(text) {
  walk.nudge = text;
  paintText('[data-nudge]', text);
  clearTimeout(walk.nudgeTimer);
  walk.nudgeTimer = setTimeout(() => {
    walk.nudge = '';
    paintText('[data-nudge]', '');
  }, 3000);
}

function focusCode() {
  const input = app.querySelector('.lock__input');
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
}

function patchCode() {
  app.querySelectorAll('.codebox').forEach((box, i) => {
    box.textContent = state.code[i] ? '•' : '';
    box.classList.toggle('codebox--active', i === state.code.length);
  });
  const unlock = app.querySelector('.lock__unlock');
  if (unlock) unlock.disabled = state.code.length !== 4;
}

function go(screen) {
  if (!SCREENS.includes(screen)) screen = 'welkom';
  if (location.hash !== `#/${screen}`) { location.hash = `#/${screen}`; return; }
  enter(screen);
}

function enter(screen) {
  // De editor hangt aan DOM die bij het hertekenen verdwijnt, dus die moet weg
  // vóórdat we ergens anders naartoe gaan.
  if (screen !== 'bewerken' && editor) sluitEditor();

  state.screen = screen;
  state.showSticker = false;
  state.showLock = false;
  state.code = '';
  state.cacheKaart = null;      // hoort bij één kaart, niet bij de hele app

  // Tracking loopt over *onderweg* en *kindmodus* heen: tussen die twee wisselen
  // mag de wandeling niet opnieuw beginnen.
  const walking = screen === 'onderweg' || screen === 'kind';
  if (walking && !walk.tracker) startWalk();
  if (!walking && walk.tracker) stopWalk();

  render();

  // De locatie is de voorwaarde voor alles; vraag hem zodra we hem nodig hebben.
  if ((screen === 'home' || screen === 'instellen') && !state.position &&
      !state.locating && !state.locationError && (!INSECURE || positionOverride())) {
    locate();
  }
}

/* ── Locatie ────────────────────────────────────────────────────────────── */

/** Startpunt overschrijven met ?at=52.247,6.755 — om te ontwikkelen en om een
 *  gebied te proberen waar je niet staat. De pil zegt dat het geen echte fix is,
 *  zodat je het niet per ongeluk voor je locatie aanziet. */
function positionOverride() {
  const raw = new URLSearchParams(location.search).get('at');
  if (!raw) return null;
  const [lat, lon] = raw.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, accuracy: 0, override: true };
}

async function locate() {
  const fake = positionOverride();
  if (fake) { state.position = fake; state.locationError = null; render(); return; }

  state.locating = true;
  state.locationError = null;
  render();
  try {
    state.position = await getPosition();
  } catch (e) {
    state.locationError = e instanceof LocationError ? e.message : 'Locatie mislukt.';
  } finally {
    state.locating = false;
    render();
  }
}

/* ── Zoeken ─────────────────────────────────────────────────────────────── */

/**
 * Alles wat niet uit de kaarttegels komt: Overpass voor picknicktafels en
 * uitkijkpunten, en het ingeladen GPX-bestand voor geocaches. Beide optioneel —
 * valt er een weg, dan krijg je een route met één soort minder in plaats van geen
 * route.
 */
async function aanvullen({ lat, lon, radiusM, keys }) {
  const overpass = await supplementFromOverpass({ lat, lon, radiusM, keys });

  // Geocaches staan al op het toestel, dus dit is geen netwerkverkeer maar een
  // filter op afstand. Vandaar ook geen reden om het parallel aan Overpass te doen.
  const cachePois = keys.includes('cache')
    ? cachesInBuurt(state.caches, { lat, lon, radiusM })
    : [];

  const failed = [...overpass.failed];
  // Wel caches ingeladen maar geen enkele in de buurt: dat is een lege categorie
  // en dat mag de generator weten, zodat hij het benoemt in plaats van te zwoegen.
  if (keys.includes('cache') && !cachePois.length) failed.push('cache');

  return { pois: [...overpass.pois, ...cachePois], failed };
}
async function zoek() {
  // Een zelfgekozen startpunt gaat voor; anders de GPS, en die dan wel nodig.
  if (!startPunt()) {
    await locate();
    if (!startPunt()) { go('home'); return; }
  }
  const start = startPunt();

  state.routes = [];
  state.genError = null;
  state.offTarget = false;
  state.missing = [];
  state.genStatus = 'punten in de buurt zoeken';
  go('zoeken');

  try {
    if (!harvester) harvester = createHarvester(window.maplibregl);

    const out = await generateRoutes({
      lat: start.lat, lon: start.lon,
      targetKm: state.km, chips: pickedKeys(), shape: state.shape,
      harvester, supplement: aanvullen,
      kidFactor: kidFactor(state.profile.leeftijd),
      onProgress: (step, detail) => {
        state.genStatus = detail;
        if (state.screen === 'zoeken') {
          const el = app.querySelector('.zoeken__sub');
          if (el) el.textContent = detail;
        }
      },
    });

    state.routes = out.routes;
    state.offTarget = out.offTarget;
    state.missing = out.missing;
    state.poiCount = out.poiCount;
    state.routeId = null;
  } catch (e) {
    state.genError = e instanceof GenerateError ? e.message
      : 'Het zoeken lukte niet. Heb je verbinding?';
    console.error(e);
  }
  go('resultaten');
}

/* ── Interaction ────────────────────────────────────────────────────────── */
app.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-go]');
  if (nav) { go(nav.dataset.go); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;

  switch (el.dataset.act) {
    case 'locate': locate(); break;

    case 'toggle-shape':
      state.shape = state.shape === 'loop' ? 'outback' : 'loop';
      render();
      break;

    case 'chip': {
      const k = el.dataset.chip;
      state.picked[k] = !state.picked[k];
      render();
      break;
    }

    case 'wis-chips': state.picked = {}; render(); break;

    case 'snel':
      state.km = Number(el.dataset.km);
      state.picked = {};
      el.dataset.chips.split(',').forEach((k) => { state.picked[k] = true; });
      zoek();
      break;

    case 'zoek': zoek(); break;

    case 'open-route':
      state.routeId = Number(el.dataset.route);
      state.detailVan = state.screen === 'rondjes' ? 'rondjes' : 'resultaten';
      state.offline = { fraction: 0, busy: false, done: 0, total: 0 };
      go('detail');
      checkOffline();
      break;

    case 'bewaar': bewaarRoute(el); break;

    /* ── route aanpassen ── */
    case 'bewerk': go('bewerken'); break;
    case 'bewerk-undo': if (editor) editor.undo(); break;
    case 'bewerk-af': go('detail'); break;
    case 'bewerk-klaar': bewerkKlaar(); break;

    case 'open-saved': {
      const r = state.saved.find((x) => x.id === el.dataset.id);
      if (!r) break;
      // Bewaarde rondjes doen als de zojuist gegenereerde: vooraan zetten en openen.
      state.routes = [r, ...state.routes.filter((x) => x.id !== r.id)];
      state.routeId = 0;
      state.detailVan = 'rondjes';
      go('detail');
      break;
    }

    case 'export': exportBestand(); break;
    case 'import': app.querySelector('[data-act="import-file"]')?.click(); break;
    case 'download-offline': haalOffline(); break;

    /* ── startpunt ── */
    case 'start-hier':
      state.startKeuze = null;
      state.plaatsResultaten = null;
      if (!state.position) locate();
      go('instellen');
      break;

    case 'start-kies': {
      const map = mapview.instance();
      if (!map) break;
      const c = map.getCenter();
      // De naam alleen houden als je nog op de gekozen plek staat. Niet uit het
      // zoekveld overnemen: dat kan een term bevatten die niets opleverde, en dan
      // zou een willekeurig kaartmidden zich voordoen als die plek.
      const vorige = state.startKeuze;
      const zelfdePlek = vorige && vorige.naam &&
        distM([c.lng, c.lat], [vorige.lon, vorige.lat]) < 80;
      state.startKeuze = {
        lat: c.lat, lon: c.lng,
        naam: zelfdePlek ? vorige.naam : null,
      };
      state.plaatsResultaten = null;
      go('instellen');
      break;
    }

    case 'kies-hit': {
      const hit = (state.plaatsResultaten || [])[Number(el.dataset.i)];
      if (!hit) break;
      state.plaatsZoek = hit.naam;
      state.plaatsResultaten = null;
      state.startKeuze = { lat: hit.lat, lon: hit.lon, naam: hit.naam };
      render();
      mapview.instance()?.jumpTo({ center: [hit.lon, hit.lat], zoom: 14 });
      break;
    }

    case 'edit-profiel':   state.editProfile = true;  render(); break;
    case 'cancel-profiel': state.editProfile = false; render(); break;
    case 'set-code':       state.editSetting = 'code';  render(); break;
    case 'gpx-kies': app.querySelector('[data-act="gpx-file"]')?.click(); break;
    case 'gpx-wis': wisCaches(); break;

    case 'installeer':     installeer(); break;
    case 'install-weg':    state.installKaartWeg = true; render(); break;

    case 'zoek-update':    zoekUpdate(); break;
    case 'werk-bij':       werkBij(); break;

    /* ── onderweg: de kaart ── */
    case 'aanzicht':  wisselAanzicht(); break;
    case 'volg-mij':  volgWeer(); break;
    case 'cachetip-weg': state.cacheKaart = null; render(); break;

    /* ── de wandeling afsluiten en terugblikken ── */
    case 'stop-wandeling': sluitWandeling(); break;
    case 'recap-klaar':
    case 'recap-terug':
      state.recap = null;
      go('boek');
      break;

    case 'open-wandeling': {
      const w = state.walks.find((x) => x.id === el.dataset.id);
      if (!w) break;
      state.recap = w;
      go('recap');
      break;
    }

    /* ── een onderbroken wandeling ── */
    case 'hervat-wandeling': hervatWandeling(); break;
    case 'hervat-weg':
      state.hervat = null;
      store.clearLopend().catch(() => {});
      render();
      break;
    case 'cancel-setting': state.editSetting = null;  render(); break;

    case 'pauze': togglePauze(); break;

    /* Kompaspermissie vragen vóórdat je het toestel overhandigt — op iOS moet dat
       uit een gebruikersactie komen, en een zesjarige moet geen dialoog wegklikken. */
    case 'to-kind':
      requestCompassPermission().finally(() => go('kind'));
      break;

    case 'hint': doeHint(el.dataset.hint); break;

    case 'open-sticker':  claimSticker(); break;
    case 'force-sticker': claimSticker({ force: true }); break;
    case 'close-sticker': state.showSticker = false; walk.sticker = null; render(); break;

    case 'open-lock':  state.showLock = true;  state.code = ''; render(); break;
    case 'close-lock': state.showLock = false; state.code = ''; render(); break;
    case 'focus-code': focusCode(); break;

    /* Is er een oudercode ingesteld, dan moet die kloppen. Zo niet, dan volstaat
       elke vier cijfers — het ontwerp legt geen code vast, dus dat is jouw keuze
       en niet die van mij. */
    case 'unlock':
      if (state.code.length !== 4) break;
      if (state.parentCode && state.code !== state.parentCode) {
        state.code = '';
        render();
        showNudge('die code klopt niet');
        break;
      }
      go('onderweg');
      break;
  }
});

app.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-act]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);

  if (form.dataset.act === 'zoek-plaats') {
    const q = String(data.get('q') || '').trim();
    state.plaatsZoek = q;
    zoekPlaats(q)
      .then((hits) => {
        state.plaatsResultaten = hits.length ? hits : [];
        render();
        if (!hits.length) showNudge('Niets gevonden.');
      })
      .catch(() => { state.plaatsResultaten = []; render(); showNudge('Zoeken lukte niet.'); });
    return;
  }

  if (form.dataset.act === 'save-profiel') {
    const naam = String(data.get('naam') || '').trim();
    const leeftijd = Number(data.get('leeftijd'));
    if (!naam || !Number.isFinite(leeftijd)) return;
    state.profile = { ...state.profile, naam, leeftijd };
    state.editProfile = false;
    render();
    store.setProfile(state.profile).catch((err) => console.warn('profiel:', err.message));
    return;
  }

  if (form.dataset.act === 'save-setting') {
    const key = form.dataset.key;
    const raw = String(data.get('waarde') || '').trim();

    if (key === 'code') {
      const code = raw.replace(/\D/g, '').slice(0, 4);
      state.parentCode = code.length === 4 ? code : null;
      store.setSetting('parentCode', state.parentCode);
    }
    state.editSetting = null;
    render();
  }
});

app.addEventListener('change', async (e) => {
  const foto = e.target.closest('[data-act="foto-file"]');
  if (foto && foto.files && foto.files[0]) {
    await bewaarFoto(foto.files[0]);
    foto.value = '';
    return;
  }

  /* Geocaches uit een GPX-export van c:geo. */
  const gpx = e.target.closest('[data-act="gpx-file"]');
  if (gpx && gpx.files && gpx.files[0]) {
    await laadGpx(gpx.files[0]);
    gpx.value = '';                    // hetzelfde bestand nog eens kunnen kiezen
    return;
  }

  /* Terugzetten uit een export. */
  const input = e.target.closest('[data-act="import-file"]');
  if (!input || !input.files || !input.files[0]) return;
  try {
    const text = await input.files[0].text();
    await store.importAll(JSON.parse(text));
    await laadOpslag();
    showNudge('Teruggezet.');
  } catch (err) {
    console.warn('import mislukt:', err.message);
    alert(`Terugzetten lukte niet: ${err.message}`);
  } finally {
    input.value = '';
  }
});

/* Slider en codeveld worden ter plekke bijgewerkt: een re-render zou de sleep
   of de cursor onderbreken. */
app.addEventListener('input', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;

  if (el.dataset.act === 'km') {
    state.km = parseFloat(el.value);
    el.setAttribute('aria-valuetext', `${komma(state.km)} kilometer`);
    const mins = state.km * 22 * (kidFactor(state.profile.leeftijd) / 1.85);
    const v = app.querySelector('[data-km-value]');
    const t = app.querySelector('[data-km-time]');
    if (v) v.textContent = komma(state.km);
    if (t) t.textContent = `± ${uurMin(mins)} met stops`;
    return;
  }

  if (el.dataset.act === 'code') {
    state.code = el.value.replace(/\D/g, '').slice(0, 4);
    el.value = state.code;
    patchCode();
  }
});

/* ── Routing ────────────────────────────────────────────────────────────── */
function fromHash() {
  const name = (location.hash.match(/^#\/(\w+)$/) || [])[1];
  return SCREENS.includes(name) ? name : null;
}

window.addEventListener('hashchange', () => enter(fromHash() || 'welkom'));

bouwTabs();

const initial = fromHash();
if (initial) { enter(initial); } else { location.replace('#/welkom'); enter('welkom'); }

laadOpslag();

/* ── Installeren ────────────────────────────────────────────────────────── */
/* Chrome vuurt dit pas als hij de app installeerbaar vindt én je even bezig bent
 * geweest, dus soms bij de eerste blik nog niet. Daarom is er ook een uitleg voor
 * het geval het event nooit komt: zie installRegel(). */
window.addEventListener('beforeinstallprompt', (e) => {
  // Zonder dit laat Chrome zijn eigen balkje zien op het verkeerde moment.
  e.preventDefault();
  state.installer = e;
  refreshIfShowing('home', 'profiel');
});

/* De app kan elk moment weggeschoven of gesloten worden. Dan moet de laatste stand
 * van de wandeling er nog in staan, niet die van vier seconden eerder. */
for (const gebeurtenis of ['pagehide', 'visibilitychange']) {
  window.addEventListener(gebeurtenis, () => {
    if (walk.tracker && (gebeurtenis === 'pagehide' || document.hidden)) {
      bewaarLopend({ nu: true });
    }
  });
}

window.addEventListener('appinstalled', () => {
  state.installer = null;
  state.installKaartWeg = true;
  refreshIfShowing('home', 'profiel');
});

/* ── Service worker ─────────────────────────────────────────────────────── */
/* Niet op localhost, tenzij je hem expliciet wil testen met ?sw.
 *
 * De cache serveert bij voorkeur de oude versie en vernieuwt op de achtergrond.
 * Dat is precies goed op de telefoon en precies verkeerd tijdens ontwikkelen:
 * je bewerkt een bestand, herlaadt, en kijkt naar de vorige versie. Dat heeft
 * hier een half uur gekost, dus lokaal ruimen we hem juist actief op. */
const DEV_HOST = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const WANT_SW = new URLSearchParams(location.search).has('sw');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  if (DEV_HOST && !WANT_SW) {
    state.versie.staat = 'geen-sw';
    navigator.serviceWorker.getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => initVersie(reg))
        .catch((e) => {
          console.warn('sw:', e.message);
          state.versie.staat = 'geen-sw';
          refreshIfShowing('profiel');
        });
    });
  }
} else {
  state.versie.staat = 'geen-sw';
}
