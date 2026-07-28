/* ============================================================================
   Is de beweging echt vloeiend?

   Draaien:  node spike/vloeiend-probe.mjs
   Vereist:  niets.

   "Vloeiend" is geen gevoel maar een meetbare eigenschap: de afstand die de stip
   per frame aflegt moet klein zijn, en er mag geen enkel frame tussen zitten dat de
   hele stap in één keer doet. Eén sprong per GPS-meting geeft één frame met een
   grote stap en negenenvijftig met nul — dát is wat hakkelig is.

   Dit draait in node en niet in de browser omdat `stapNaar()` losgeknoopt is van
   requestAnimationFrame. Dat is niet alleen makkelijker te testen: het is ook de
   enige manier om dit te meten in een omgeving die geen frames geeft.
   ============================================================================ */

import { stapNaar, draaiNaar } from '../src/vloeiend.js';

let fouten = 0;
const ok = (naam, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
  if (!cond) fouten++;
};

const M_PER_GRAAD = 111320;

/* ── Draaien over de eenheidscirkel ──────────────────────────────────────── */
console.log('Draaien');
ok('350° → 10° gaat 20° vooruit, niet 340° achteruit',
   Math.abs(draaiNaar(350, 10, 0.5) - 0) < 1e-9, `${draaiNaar(350, 10, 0.5)}`);
ok('10° → 350° gaat achteruit', Math.abs(draaiNaar(10, 350, 0.5) - 0) < 1e-9);
ok('halverwege 0° en 90° is 45°', Math.abs(draaiNaar(0, 90, 0.5) - 45) < 1e-9);
ok('fractie 0 verandert niets', draaiNaar(123, 200, 0) === 123);
ok('blijft altijd binnen 0..360',
   [[359, 5, 1], [1, 359, 1], [180, 0, 0.7]].every(([a, b, f]) => {
     const r = draaiNaar(a, b, f);
     return r >= 0 && r < 360;
   }));

/* ── Wandelen op 1 Hz, getekend op 60 Hz ─────────────────────────────────── */
console.log('\nWandelen: meting per seconde, 60 frames per seconde');

const lat0 = 52.26, lon0 = 6.717;
const STAP_M = 1.3;                       // ≈ 4,7 km/u bij één meting per seconde
const stapGraden = STAP_M / M_PER_GRAAD;
const dt = 1 / 60;

let toon = { lon: lon0, lat: lat0, koers: 0 };
const perFrame = [];                      // afgelegde afstand per frame, in mm

for (let meting = 1; meting <= 6; meting++) {
  const doel = { lon: lon0, lat: lat0 + meting * stapGraden, koers: 0 };
  for (let f = 0; f < 60; f++) {
    const vorige = toon;
    toon = stapNaar(toon, doel, dt);
    perFrame.push(Math.abs(toon.lat - vorige.lat) * M_PER_GRAAD * 1000);
  }
}

const grootste = Math.max(...perFrame);
const bewogen = perFrame.filter((s) => s > 0.05).length;
const gemiddeld = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;

ok('360 frames voor 6 metingen', perFrame.length === 360, `${perFrame.length}`);
ok('elk frame beweegt', bewogen === perFrame.length,
   `${bewogen} van ${perFrame.length}`);
ok('gemiddelde stap is een paar centimeter', gemiddeld > 5 && gemiddeld < 40,
   `${gemiddeld.toFixed(1)} mm per frame`);
/* Ongedempt zou één frame per meting de volle 1300 mm doen en de rest 0. De
 * grootste stap is dus de maat voor hakkeligheid. */
ok('geen enkel frame maakt de hele stap',
   grootste < STAP_M * 1000 / 10,
   `grootste ${grootste.toFixed(0)} mm tegen ${STAP_M * 1000} mm ongedempt`);

/* ── Wat het kost: achterstand ───────────────────────────────────────────── */
console.log('\nWat het kost');
const echt = lat0 + 6 * stapGraden;
const achter = Math.abs(echt - toon.lat) * M_PER_GRAAD;
ok('de stip loopt onder een halve meter achter', achter < 0.5,
   `${achter.toFixed(2)} m — ruim binnen de GPS-onnauwkeurigheid van 10 tot 30 m`);

/* ── Trage frames mogen niet trager bewegen ──────────────────────────────── */
console.log('\nBij 30 frames per seconde');
let t30 = { lon: lon0, lat: lat0, koers: 0 };
const doel30 = { lon: lon0, lat: lat0 + stapGraden, koers: 0 };
for (let f = 0; f < 30; f++) t30 = stapNaar(t30, doel30, 1 / 30);
let t60 = { lon: lon0, lat: lat0, koers: 0 };
for (let f = 0; f < 60; f++) t60 = stapNaar(t60, doel30, 1 / 60);
const verschil = Math.abs(t30.lat - t60.lat) * M_PER_GRAAD * 1000;
ok('na één seconde staan 30 en 60 fps op dezelfde plek', verschil < 1,
   `${verschil.toFixed(2)} mm verschil — de tijd bepaalt de beweging, niet het aantal frames`);

/* ── Draaien tijdens het lopen ───────────────────────────────────────────── */
console.log('\nEen bocht om');
let b = { lon: lon0, lat: lat0, koers: 350 };
const naarKoers = { lon: lon0, lat: lat0, koers: 20 };
const draaien = [];
for (let f = 0; f < 60; f++) {
  const vorige = b.koers;
  b = stapNaar(b, naarKoers, dt);
  let d = ((b.koers - vorige + 540) % 360) - 180;
  draaien.push(Math.abs(d));
}
ok('de bocht gaat de korte kant om', b.koers > 15 && b.koers < 21, `${b.koers.toFixed(1)}°`);
ok('geen enkel frame draait meer dan 3°', Math.max(...draaien) < 3,
   `grootste ${Math.max(...draaien).toFixed(2)}°`);

/* ── Stilstaan ───────────────────────────────────────────────────────────── */
console.log('\nStilstaan');
let s = { lon: lon0, lat: lat0 + 0.0001, koers: 0 };
const stil = { lon: lon0, lat: lat0, koers: 0 };
for (let f = 0; f < 600; f++) s = stapNaar(s, stil, dt);
ok('komt tot stilstand op de meting, zonder overschieten',
   Math.abs(s.lat - lat0) * M_PER_GRAAD < 0.01,
   `${(Math.abs(s.lat - lat0) * M_PER_GRAAD * 1000).toFixed(2)} mm ernaast`);

/* ── Geen koers bekend ───────────────────────────────────────────────────── */
console.log('\nGeen richting bekend');
const zonder = stapNaar({ lon: lon0, lat: lat0, koers: null },
                        { lon: lon0, lat: lat0 + stapGraden, koers: null }, dt);
ok('koers blijft null en wordt geen 0', zonder.koers === null, JSON.stringify(zonder.koers));
const eerste = stapNaar({ lon: lon0, lat: lat0, koers: null },
                        { lon: lon0, lat: lat0, koers: 77 }, dt);
ok('de eerste bekende koers wordt meteen overgenomen', eerste.koers === 77,
   `${eerste.koers}° — anders zou de pijl vanaf noord komen draaien`);

console.log(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
process.exit(fouten ? 1 : 0);
