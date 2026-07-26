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
import { generateRoutes, GenerateError } from './src/generator.js';
import { getPosition, LocationError, INSECURE } from './src/geolocate.js';
import * as mapview from './src/mapview.js';

/* ── Feature flags ───────────────────────────────────────────────────────── */
const CONFIG = {
  // Beslissing 8: geocaches komen van opencaching.nl, en dat vereist een
  // consumer key die nog aangevraagd moet worden. Tot die er is blijft de kaart
  // uit — een schakelaar die niets doet is erger dan geen schakelaar.
  geocachesAan: false,
  stickerBeloningen: true,
};

/* ── Inhoud die nog niet uit data komt ───────────────────────────────────── */
const WELKOM_PUNTEN = [
  { icon: 'near_me',        label: 'Rondjes vanaf waar je nu staat' },
  { icon: 'travel_explore', label: 'Speurtocht onderweg' },
  { icon: 'child_care',     label: 'Kindmodus: je kind wijst de weg' },
];

const KID_HINTS = [
  { icon: 'water',        label: 'zoek water' },
  { icon: 'photo_camera', label: 'maak foto' },
  { icon: 'volume_up',    label: 'voorlezen' },
];

const STICKER_ICONS = [
  'emoji_nature', 'forest', 'egg', 'sailing', 'castle', 'pets',
  'water_drop', 'park', 'nightlight', 'cake', 'star', 'diamond',
];

/* Demo-waarden voor de twee schermen die nog niet op live tracking zitten. */
const WALK = {
  percent: 42, etaMin: 55, volgendAfstand: '320 m',
  kindAfstand: 80, punten: 6, gevonden: 3,
  sticker: { icon: 'emoji_nature', titel: 'kikker<br>gevonden!' },
};

const SCREENS = ['welkom','home','instellen','zoeken','resultaten','detail','onderweg','kind','profiel'];

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

  routes: [],
  routeId: null,
  genStatus: '',
  genError: null,
  offTarget: false,
  missing: [],
  poiCount: 0,

  pauze: false,
  code: '',
  showSticker: false,
  showLock: false,
};

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

const pickedKeys = () => CATEGORIES.filter((c) => state.picked[c.key]).map((c) => c.key);
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
    <div class="screen__body">
      <div class="sheet home">
        <div class="home__top">
          <div>
            <div class="home__weather">${esc(dagLabel())}</div>
            <h1 class="home__h1">Waar gaan<br>we heen?</h1>
          </div>
          <button class="home__profile" data-go="profiel" aria-label="Stickerboek openen">
            ${ico('auto_awesome')}
          </button>
        </div>

        ${locationPill()}

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

        ${state.routes.length ? `
          <div class="section-head section-head--tight">Laatst gevonden</div>
          <div class="trail">${state.routes.map(routeRow).join('')}</div>` : ''}
      </div>
    </div>
  </div>`;

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
            <div class="pair__cell pair__cell--start">
              ${ico('my_location')}
              <div>
                <div class="pair__k">Startpunt</div>
                <div class="pair__v">${state.position ? 'Hier waar ik sta' : 'Nog onbekend'}</div>
              </div>
            </div>
            <button class="pair__cell pair__cell--shape" data-act="toggle-shape"
                    aria-pressed="${state.shape === 'loop'}">
              ${ico(state.shape === 'loop' ? 'refresh' : 'sync_alt')}
              <span class="pair__text">
                <span class="pair__k">Vorm</span>
                <span class="pair__v">${state.shape === 'loop' ? 'Rondje' : 'Heen &amp; terug'}</span>
              </span>
            </button>
          </div>

          <div class="section-head">Onderweg moet er zijn</div>
          <div class="chips" role="group" aria-label="Onderweg moet er zijn">
            ${CATEGORIES.map((c) => `
              <button class="chip ${c.from === 'overpass' ? 'chip--net' : ''}"
                      data-act="chip" data-chip="${c.key}"
                      aria-pressed="${!!state.picked[c.key]}"
                      ${c.from === 'overpass' ? 'title="Heeft netwerk nodig — komt niet uit de kaarttegels"' : ''}>
                ${ico(c.icon)}<span>${esc(c.label)}</span>
              </button>`).join('')}
          </div>
          <p class="hint-line">Elke aangevinkte soort komt gegarandeerd in de route.
            Lukt dat niet binnen je afstand, dan krijg je ook kortere rondjes te zien
            waarin er één ontbreekt.</p>

          ${CONFIG.geocachesAan ? cacheCard() : ''}
        </div>
      </div>
    </div>

    <div class="screen__footer">
      <button class="btn-cta" data-act="zoek" ${pickedKeys().length ? '' : 'disabled'}>Zoek paadjes</button>
    </div>
  </div>`;
};

const cacheCard = () => `
  <button class="cache" data-act="toggle-cache" aria-pressed="true">
    <span class="cache__ico">${ico('travel_explore')}</span>
    <span class="cache__text">
      <span class="cache__title">Geocaches meenemen</span>
      <span class="cache__sub">via opencaching.nl</span>
    </span>
    <span class="switch"><span class="switch__knob"></span></span>
  </button>`;

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
                </span>
              </span>
            </button>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
};

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
          <button class="detail__back" data-go="resultaten" aria-label="Terug">${ico('arrow_back')}</button>
        </div>

        <div class="detail__sheet">
          <div class="detail__grip"></div>
          <h1 class="detail__title">${esc(r.naam)}</h1>
          <div class="detail__tags">
            <span class="tag tag--lg">${esc(r.km)}</span>
            <span class="tag tag--lg">± ${esc(r.tijd)}</span>
            <span class="tag tag--lg ${r.dropped.length ? 'tag--warn' : 'tag--mint'}">${esc(r.badge)}</span>
          </div>

          <div class="section-head section-head--tight">Onderweg kom je langs</div>
          <div class="poi-list">
            ${r.pois.map((p) => `
              <div class="poi">
                <span class="poi__ico">${ico(p.icon)}</span>
                <span class="poi__text">
                  <span class="poi__name">${esc(p.naam)}</span>
                  <span class="poi__meta">${esc(p.meta)}</span>
                </span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="screen__footer">
      <button class="btn-round" data-act="bewaar" aria-label="Rondje bewaren">${ico('bookmark')}</button>
      <button class="btn-cta btn-cta--flex" data-go="onderweg">Start de wandeling</button>
    </div>
  </div>`;
};

views.onderweg = () => {
  const r = currentRoute();
  const totaal = r ? r.km : '4,5 km';
  const volgend = r && r.pois[0] ? r.pois[0] : { naam: 'het eerste punt', icon: 'water' };
  const gelopen = r ? komma(r.distanceM / 1000 * WALK.percent / 100) : '1,9';

  return `
  <div class="screen">
    <div class="onderweg">
      <svg class="onderweg__svg" viewBox="0 0 396 760" aria-hidden="true">
        <path d="M72 640 C 132 560, 92 448, 172 396 S 302 356, 302 232 S 332 128, 344 74"
              fill="none" stroke="rgba(234,243,234,.18)" stroke-width="4"
              stroke-linecap="round" stroke-dasharray="2 11"></path>
        <path d="M72 640 C 132 560, 92 448, 172 396"
              fill="none" stroke="#C9F26E" stroke-width="5" stroke-linecap="round"></path>
        <circle class="onderweg__pos-glow" cx="172" cy="396" r="22" fill="rgba(201,242,110,.3)"></circle>
        <circle cx="172" cy="396" r="12" fill="#C9F26E" stroke="#0C1A17" stroke-width="3"></circle>
      </svg>

      <div class="onderweg__hud">
        <button class="onderweg__close" data-go="detail" aria-label="Wandeling afsluiten">${ico('close')}</button>
        <div class="progress">
          <div class="progress__row">
            <span>${gelopen} van ${esc(totaal)}</span>
            <span class="progress__eta">nog ± ${WALK.etaMin} min</span>
          </div>
          <div class="progress__track" role="progressbar" aria-valuenow="${WALK.percent}"
               aria-valuemin="0" aria-valuemax="100" aria-label="Voortgang wandeling">
            <div class="progress__fill" style="width:${WALK.percent}%"></div>
          </div>
        </div>
      </div>

      <div class="nextcard-wrap">
        <div class="nextcard">
          <div class="nextcard__top">
            <div class="nextcard__ico">${ico(volgend.icon)}</div>
            <div>
              <div class="nextcard__k">Volgende punt · ${WALK.volgendAfstand}</div>
              <div class="nextcard__v">${esc(volgend.naam)}</div>
            </div>
          </div>
          <div class="nextcard__actions">
            <button class="btn-ghost" data-act="pauze" aria-pressed="${state.pauze}">
              ${state.pauze ? 'Doorlopen' : 'Pauze'}
            </button>
            <button class="btn-kid" data-go="kind">
              ${ico('child_care')}Kind wijst de weg
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

views.kind = () => {
  const r = currentRoute();
  const doel = r && r.pois[0] ? r.pois[0].naam.toLowerCase() : 'het volgende punt';
  const dots = Array.from({ length: WALK.punten }, (_, i) =>
    `<span class="kind__dot ${i < WALK.gevonden ? 'kind__dot--on' : ''}"></span>`).join('');

  return `
  <div class="screen">
    <div class="screen__body">
      <div class="sheet kind">
        <div class="kind__blob"></div>
        <div class="kind__top">
          <div class="kind__dots" aria-label="${WALK.gevonden} van ${WALK.punten} punten gevonden">
            ${dots}<span class="kind__count">${WALK.gevonden}/${WALK.punten}</span>
          </div>
          <button class="kind__lock" data-act="open-lock">
            ${ico('lock')}<span class="kind__lock-label">papa</span>
          </button>
        </div>

        <div class="kind__main">
          <div class="kind__compass">${ico('navigation', 'kind__needle')}</div>
          <div class="kind__dist">${WALK.kindAfstand}<small> m</small></div>
          <div class="kind__goal">op naar ${esc(doel)}!</div>
        </div>

        <div class="kind__hints">
          ${KID_HINTS.map((k) => `
            <div class="hint">${ico(k.icon)}<span class="hint__label">${esc(k.label)}</span></div>`).join('')}
        </div>

        <button class="kind__cta" data-act="open-sticker">${ico('visibility')}ik zie het!</button>
      </div>
    </div>

    ${state.showSticker && CONFIG.stickerBeloningen ? stickerOverlay() : ''}
    ${state.showLock ? lockOverlay() : ''}
  </div>`;
};

const stickerOverlay = () => `
  <div class="overlay overlay--sticker" role="dialog" aria-modal="true" aria-label="Sticker gevonden">
    <div class="sticker__badge">
      <div class="sticker__glow"></div>
      <div class="sticker__disc">${ico(WALK.sticker.icon)}</div>
    </div>
    <div class="sticker__title">${WALK.sticker.titel}</div>
    <div class="sticker__sub">sticker ${WALK.gevonden + 1} van ${WALK.punten} · in je boek geplakt</div>
    <button class="btn-kid-cta" data-act="close-sticker">verder lopen</button>
  </div>`;

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

views.profiel = () => `
  <div class="screen">
    <div class="screen__body">
      <div class="sheet">
        <div class="profiel__head">
          <div class="profiel__nav">
            <button class="btn-icon btn-icon--flat" data-go="home" aria-label="Terug">${ico('arrow_back')}</button>
            <div class="profiel__kicker">Stickerboek van</div>
          </div>
          <div class="profiel__id">
            <div class="avatar">${esc(state.profile.naam[0])}</div>
            <div>
              <h1 class="profiel__name">${esc(state.profile.naam)}, ${state.profile.leeftijd} jaar</h1>
              <div class="profiel__stats">nog geen wandelingen bewaard</div>
            </div>
          </div>
        </div>

        <div class="profiel__body">
          <div class="section-head" style="margin-top:0">Verzameld</div>
          <div class="stickers">
            ${STICKER_ICONS.map((icon, i) => {
              const vol = CONFIG.stickerBeloningen && i < 9;
              return `<div class="sticker-cell ${vol ? 'sticker-cell--on' : ''}">${ico(icon)}</div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>`;

/* ── Render ─────────────────────────────────────────────────────────────── */
const app = document.getElementById('app');
let lastScreen = null;
let harvester = null;

// De resultaatkaartjes tekenen de echte routegeometrie als SVG; via window zodat
// de template-string erbij kan zonder de views tot modules te maken.
window.__routeSvg = (r) => mapview.routeMiniSvg(r);

function render() {
  const body = app.querySelector('.screen__body');
  const keepScroll = lastScreen === state.screen && body ? body.scrollTop : 0;

  if (lastScreen === 'detail' && state.screen !== 'detail') mapview.detach();

  app.innerHTML = (views[state.screen] || views.welkom)();

  const newBody = app.querySelector('.screen__body');
  if (newBody && keepScroll) newBody.scrollTop = keepScroll;

  lastScreen = state.screen;
  focusCode();
  mountMap();
}

/** De kaart verhuist naar het scherm dat hem nodig heeft. */
async function mountMap() {
  if (state.screen !== 'detail') return;
  const host = document.getElementById('detail-map');
  const route = currentRoute();
  if (!host || !route) return;
  await mapview.attach(window.maplibregl, host);
  mapview.render({ route, position: state.position, padding: 46 });
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
  state.screen = screen;
  state.showSticker = false;
  state.showLock = false;
  state.code = '';
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
async function zoek() {
  if (!state.position) {
    await locate();
    if (!state.position) { go('home'); return; }
  }

  state.routes = [];
  state.genError = null;
  state.offTarget = false;
  state.missing = [];
  state.genStatus = 'punten in de buurt zoeken';
  go('zoeken');

  try {
    if (!harvester) harvester = createHarvester(window.maplibregl);

    const out = await generateRoutes({
      lat: state.position.lat, lon: state.position.lon,
      targetKm: state.km, chips: pickedKeys(), shape: state.shape,
      harvester, supplement: supplementFromOverpass,
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

    case 'snel':
      state.km = Number(el.dataset.km);
      state.picked = {};
      el.dataset.chips.split(',').forEach((k) => { state.picked[k] = true; });
      zoek();
      break;

    case 'zoek': zoek(); break;

    case 'open-route':
      state.routeId = Number(el.dataset.route);
      go('detail');
      break;

    case 'bewaar':
      el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      el.querySelector('.ms').textContent =
        el.getAttribute('aria-pressed') === 'true' ? 'bookmark_added' : 'bookmark';
      break;

    case 'pauze': state.pauze = !state.pauze; render(); break;

    case 'open-sticker':
      if (!CONFIG.stickerBeloningen) break;
      state.showSticker = true; render(); break;
    case 'close-sticker': state.showSticker = false; render(); break;

    case 'open-lock':  state.showLock = true;  state.code = ''; render(); break;
    case 'close-lock': state.showLock = false; state.code = ''; render(); break;
    case 'focus-code': focusCode(); break;

    /* Geen code vastgelegd in het ontwerp — vier cijfers volstaat voorlopig. */
    case 'unlock':
      if (state.code.length === 4) go('onderweg');
      break;
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

const initial = fromHash();
if (initial) { enter(initial); } else { location.replace('#/welkom'); enter('welkom'); }

/* ── Service worker ─────────────────────────────────────────────────────── */
// Relatief pad, want op GitHub Pages staat de app in een submap.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw:', e.message));
  });
}
