/* ============================================================================
   OKAPI nakijken zonder consumer key.

   Draaien:  node spike/okapi-probe.mjs
   Vereist:  internet.

   De apiref van OKAPI is publiek. Daarmee is te controleren of de argumentnamen,
   de eenheden en de antwoordvorm kloppen — precies wat er niet klopte toen dit
   blind geschreven werd. Wat een echte sleutel wél moet uitwijzen: of het antwoord
   met data erin ook goed verwerkt wordt.
   ============================================================================ */
import { testKey, searchCaches, SIGNUP_URL, schoonAttributie } from '../src/okapi.js';

const REF = 'https://www.opencaching.nl/okapi/services/apiref';
let fouten = 0;
const ok = (naam, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FOUT '} ${naam}${extra ? ' — ' + extra : ''}`);
  if (!cond) fouten++;
};

const haal = async (u) => (await fetch(u)).json();
const plat = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/* ── Bestaan de methodes en de argumenten die wij gebruiken? ─────────────── */
console.log('Wat de apiref zegt');
const index = (await haal(`${REF}/method_index?format=json`)).map((m) => m.name);
ok('search/nearest bestaat', index.includes('services/caches/search/nearest'));
ok('caches/geocaches bestaat', index.includes('services/caches/geocaches'));

const nearest = await haal(`${REF}/method?name=services/caches/search/nearest&format=json`);
const argsVan = (j) => [...(j.arguments || []), ...(j.common_arguments || []),
                        ...(j.opt_arguments || [])].map((a) => a.name);
const argN = argsVan(nearest);
for (const a of ['center', 'radius', 'status', 'limit', 'consumer_key']) {
  // consumer_key is geen gedocumenteerd argument maar een auth-parameter.
  if (a === 'consumer_key') {
    ok('sleutel als losse parameter volstaat (geen OAuth)',
       nearest.auth_options.min_auth_level === 1 &&
       nearest.auth_options.oauth_token === false,
       `min_auth_level ${nearest.auth_options.min_auth_level}`);
    continue;
  }
  ok(`nearest kent '${a}'`, argN.includes(a));
}

const radius = plat([...(nearest.arguments || []), ...(nearest.opt_arguments || [])]
  .find((a) => a.name === 'radius').description);
ok('radius is in kilometers, niet meters', /in kilometers instead of meters/i.test(radius));

const alle = await haal(`${REF}/method?name=services/caches/search/all&format=json`);
const status = plat(argsVan2(alle, 'status'));
ok("status 'Available' is geldig", /Available/.test(status));
ok('limit gaat tot 500 (wij vragen 20)', /1\.\.500/.test(plat(argsVan2(alle, 'limit'))));
ok('nearest geeft {results, more}', /results - a list of cache codes/.test(plat(alle.returns)) ||
   /results/.test(plat(nearest.returns)));

const geocaches = await haal(`${REF}/method?name=services/caches/geocaches&format=json`);
const gArg = argsVan(geocaches);
ok("geocaches kent 'cache_codes'", gArg.includes('cache_codes'));
ok("geocaches kent 'fields'", gArg.includes('fields'));
ok('geocaches geeft een dictionary op cache-code',
   /Cache codes you provide will be mapped to dictionary keys/.test(plat(geocaches.returns)));

const geocache = await haal(`${REF}/method?name=services/caches/geocache&format=json`);
const velden = plat(geocache.returns);
for (const v of ['code -', 'name -', 'location -', 'type -', 'status -', 'url -',
                 'attribution_note -']) {
  ok(`veld ${v.replace(' -', '')} bestaat`, velden.includes(v));
}
ok('location is "lat|lon"', /location of the cache in the "lat\|lon" format/.test(velden));
ok('attribution_note is dé plek voor naamsvermelding',
   /the proper attribution note for the cache listing/.test(velden));

/* ── Doet de code wat hij moet doen zonder geldige sleutel? ──────────────── */
console.log('\nZonder geldige sleutel');
const leeg = await testKey('');
ok('lege sleutel wordt niet eens verstuurd', leeg.ok === false && leeg.soort === 'leeg');

const nep = await testKey('nepsleutel-die-niet-bestaat');
ok('foute sleutel wordt als zodanig herkend', nep.ok === false && nep.soort === 'sleutel',
   `${nep.soort}: ${nep.reden}`);
ok('en zegt het in gewoon Nederlands', /kent deze sleutel niet/.test(nep.reden), nep.reden);

const zonder = await searchCaches({ lat: 52.09, lon: 5.12, radiusM: 5000, key: null });
ok('geen sleutel geeft nul caches, geen fout', Array.isArray(zonder) && zonder.length === 0);
const metNep = await searchCaches({ lat: 52.09, lon: 5.12, radiusM: 5000, key: 'nep' });
ok('foute sleutel faalt stil', Array.isArray(metNep) && metNep.length === 0);

ok('CORS staat open voor de browser', await (async () => {
  const r = await fetch(
    'https://www.opencaching.nl/okapi/services/caches/search/nearest' +
    '?center=52.09%7C5.12&radius=5&limit=1&consumer_key=nep',
    { headers: { Origin: 'https://marclohuis-ll.github.io' } });
  return r.headers.get('access-control-allow-origin') === '*';
})());

ok('aanmeldpagina bestaat', (await fetch(SIGNUP_URL)).ok, SIGNUP_URL);

/* ── De naamsvermelding opschonen ────────────────────────────────────────── */
console.log('\nNaamsvermelding opschonen (buiten de browser: tekst zonder opmaak)');
ok('leeg blijft leeg', schoonAttributie('') === null && schoonAttributie(null) === null);
ok('tekst blijft over', schoonAttributie('© Jan, <a href="https://x.nl">opencaching.nl</a>')
   === '© Jan, opencaching.nl');
ok('scriptinhoud verdwijnt helemaal',
   schoonAttributie('a<script>alert(1)</script>b') === 'ab',
   JSON.stringify(schoonAttributie('a<script>alert(1)</script>b')));

console.log(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
console.log('\nWat een echte sleutel nog moet uitwijzen: of een antwoord mét caches');
console.log('goed verwerkt wordt, en hoe attribution_note er precies uitziet.');
process.exit(fouten ? 1 : 0);

function argsVan2(j, naam) {
  return [...(j.arguments || []), ...(j.common_arguments || []), ...(j.opt_arguments || [])]
    .find((a) => a.name === naam).description;
}
