/* ============================================================================
   Het filter dat bepaalt welke geocaches op de kaart komen.

   Draaien:  node spike/cachekaart-probe.mjs
   Vereist:  niets.

   Waarom dit los te testen is: een pocket query kan honderden caches bevatten, en de
   vraag "welke horen nu op de kaart" is pure rekenkunde met vier getallen. Alleen het
   tékenen heeft MapLibre nodig, en dus frames — en die zijn er niet altijd.
   ============================================================================ */

import { filterOpVenster } from '../src/mapview.js';

let fouten = 0;
const ok = (naam, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
  if (!cond) fouten++;
};

/* Een kaartbeeld rond Twickel, ongeveer wat je op zoom 16 ziet. */
const beeld = { west: 6.710, oost: 6.724, zuid: 52.260, noord: 52.269 };
const cache = (naam, lon, lat) => ({ code: naam, naam, coord: [lon, lat] });

console.log('Binnen en buiten beeld');
const midden = cache('midden', 6.717, 52.2645);
const ver = cache('ver weg', 6.95, 52.40);
const netBuiten = cache('net buiten', 6.7255, 52.2645);      // 0,0015° oost van de rand
const ruimBuiten = cache('ruim buiten', 6.760, 52.2645);

const uit = filterOpVenster([midden, ver, netBuiten, ruimBuiten], beeld);
const namen = uit.map((c) => c.naam);
ok('wat in beeld is komt erin', namen.includes('midden'));
ok('20 km verderop niet', !namen.includes('ver weg'));
ok('net buiten de rand komt er wél in (de marge)', namen.includes('net buiten'),
   'zodat ze er al staan voordat je ze in beeld schuift');
ok('ruim buiten de marge niet', !namen.includes('ruim buiten'), namen.join(', '));

console.log('\nDe marge zelf');
const breedte = beeld.oost - beeld.west;
const opRand = cache('op de rand', beeld.oost + breedte * 0.2, 52.2645);
const netVoorbij = cache('voorbij de marge', beeld.oost + breedte * 0.3, 52.2645);
ok('0,2 keer de breedte erbuiten valt binnen de marge van 0,25',
   filterOpVenster([opRand], beeld).length === 1);
ok('0,3 keer erbuiten valt eraf', filterOpVenster([netVoorbij], beeld).length === 0);
ok('marge 0 betekent precies het beeld',
   filterOpVenster([opRand], beeld, 0).length === 0 &&
   filterOpVenster([midden], beeld, 0).length === 1);

console.log('\nRandgevallen');
ok('geen caches geeft een lege lijst', filterOpVenster([], beeld).length === 0);
ok('geen lijst geeft een lege lijst', filterOpVenster(null, beeld).length === 0);
ok('geen grenzen geeft een lege lijst', filterOpVenster([midden], null).length === 0);
ok('exact op de hoek hoort erbij',
   filterOpVenster([cache('hoek', beeld.west, beeld.zuid)], beeld, 0).length === 1);

console.log('\nOp schaal: 800 caches over de provincie');
const veel = [];
for (let i = 0; i < 800; i++) {
  veel.push(cache(`c${i}`, 6.4 + (i % 40) * 0.02, 52.15 + Math.floor(i / 40) * 0.01));
}
const t0 = process.hrtime.bigint();
const inBeeld = filterOpVenster(veel, beeld);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
ok('slechts een handvol blijft over', inBeeld.length < 20,
   `${inBeeld.length} van 800`);
ok('en het filteren kost vrijwel niets', ms < 5,
   `${ms.toFixed(2)} ms — dit gebeurt bij elke kaartbeweging`);

console.log(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
console.log('\nWat hier niet mee getest is: het tekenen van de stippen en het kaartje');
console.log('bij aantikken. Dat vraagt een kaart, en een kaart vraagt frames.');
process.exit(fouten ? 1 : 0);
