/* ============================================================================
   De GPX-lezer nakijken met echte bestandsvormen.

   Draaien: open de app en typ in de console
       (await import('/spike/gpx-probe.js')).run()

   In de browser en niet in node, om één reden: XML parseren doe je niet zelf. GPX
   zit vol naamruimtes, CDATA en entiteiten, en een handgemaakte lezer die daar
   negen van de tien keer goed doorheen komt, verliest precies die ene cache die je
   wilde. DOMParser is er al en doet het wél goed.
   ============================================================================ */

import { parseGpx, overslagTekst, cachesInBuurt, GpxError } from '../src/gpx.js';

/* Een pocket query van geocaching.com: naamruimte 1/0/1, alles in het cacheblok. */
const PQ = `<?xml version="1.0" encoding="utf-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/0" version="1.0" creator="Groundspeak Pocket Query">
  <wpt lat="52.26417" lon="6.71705">
    <name>GC1TEST</name>
    <desc>Twickel Traditional by Marc, Traditional Cache (1.5/2)</desc>
    <url>https://www.geocaching.com/geocache/GC1TEST</url>
    <urlname>Twickel Traditional</urlname>
    <sym>Geocache</sym>
    <type>Geocache|Traditional Cache</type>
    <groundspeak:cache id="1" available="True" archived="False"
        xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
      <groundspeak:name>Twickel Traditional</groundspeak:name>
      <groundspeak:placed_by>Marc</groundspeak:placed_by>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Small</groundspeak:container>
      <groundspeak:difficulty>1.5</groundspeak:difficulty>
      <groundspeak:terrain>2</groundspeak:terrain>
      <groundspeak:short_description><![CDATA[Een <b>klein</b> doosje bij de brug]]></groundspeak:short_description>
    </groundspeak:cache>
  </wpt>

  <!-- Puzzelcache: de coördinaten hieronder zijn met opzet niet de vindplaats. -->
  <wpt lat="52.27000" lon="6.72000">
    <name>GC2PUZZ</name><sym>Geocache</sym><type>Geocache|Unknown Cache</type>
    <groundspeak:cache available="True" archived="False"
        xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
      <groundspeak:name>Reken maar uit</groundspeak:name>
      <groundspeak:type>Unknown Cache</groundspeak:type>
      <groundspeak:difficulty>4</groundspeak:difficulty>
      <groundspeak:terrain>2</groundspeak:terrain>
    </groundspeak:cache>
  </wpt>

  <!-- Gearchiveerd: ligt er niet meer. -->
  <wpt lat="52.26000" lon="6.70000">
    <name>GC3OUD</name><type>Geocache|Traditional Cache</type>
    <groundspeak:cache available="False" archived="True"
        xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
      <groundspeak:name>Weg</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
    </groundspeak:cache>
  </wpt>

  <!-- Terrein 5: vereist een boot of klimspullen. -->
  <wpt lat="52.25500" lon="6.71000">
    <name>GC4BOOT</name><type>Geocache|Traditional Cache</type>
    <groundspeak:cache available="True" archived="False"
        xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
      <groundspeak:name>Alleen per kano</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>5</groundspeak:terrain>
    </groundspeak:cache>
  </wpt>

  <!-- Multi: de gepubliceerde plek is het eerste station. Bruikbaar. -->
  <wpt lat="52.26800" lon="6.71500">
    <name>GC5MULTI</name><type>Geocache|Multi-cache</type>
    <groundspeak:cache available="True" archived="False"
        xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
      <groundspeak:name>Vier stations</groundspeak:name>
      <groundspeak:type>Multi-cache</groundspeak:type>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
    </groundspeak:cache>
  </wpt>

  <!-- Earthcache: een plek, maar geen doosje om te zoeken. -->
  <wpt lat="52.26100" lon="6.71100">
    <name>GC6AARDE</name><type>Geocache|Earthcache</type>
    <groundspeak:cache available="True" archived="False"
        xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
      <groundspeak:name>Stuwwal</groundspeak:name>
      <groundspeak:type>Earthcache</groundspeak:type>
    </groundspeak:cache>
  </wpt>

  <!-- Hulppunt: parkeerplaats bij GC5MULTI. Geen cache. -->
  <wpt lat="52.26810" lon="6.71510">
    <name>PK5MULTI</name><desc>Parking Area</desc>
    <sym>Parking Area</sym><type>Waypoint|Parking Area</type>
  </wpt>
</gpx>`;

/* c:geo exporteert GPX 1.1 met een andere naamruimteversie (1/0) en het
   groundspeak-voorvoegsel op de gpx-tag. Dat mag de uitkomst niet veranderen. */
const CGEO = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="c:geo" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:groundspeak="http://www.groundspeak.com/cache/1/0">
  <wpt lat="52.2700" lon="6.7300">
    <name>OC1NL</name>
    <url>https://www.opencaching.nl/viewcache.php?cacheid=1</url>
    <sym>Geocache</sym><type>Geocache|Traditional Cache</type>
    <groundspeak:cache available="True" archived="False">
      <groundspeak:name>Uit c:geo</groundspeak:name>
      <groundspeak:owner>Iemand</groundspeak:owner>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:difficulty>1</groundspeak:difficulty>
      <groundspeak:terrain>1,5</groundspeak:terrain>
    </groundspeak:cache>
  </wpt>
</gpx>`;

/* Een kale GPX zonder groundspeak-blok, zoals sommige programma's exporteren. */
const KAAL = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="52.2650" lon="6.7150">
    <name>GC7KAAL</name><urlname>Zonder blok</urlname>
    <url>https://www.geocaching.com/geocache/GC7KAAL</url>
    <type>Geocache|Traditional Cache</type>
  </wpt>
  <wpt lat="52.2660" lon="6.7160">
    <name>WEG1</name><type>Waypoint|Trailhead</type>
  </wpt>
</gpx>`;

export async function run() {
  const uit = [];
  let fouten = 0;
  const ok = (n, c, x = '') => {
    uit.push(`${c ? '  ok  ' : ' FOUT '} ${n}${x ? ' — ' + x : ''}`);
    if (!c) fouten++;
  };

  /* ── Pocket query ────────────────────────────────────────────────────────── */
  uit.push('Pocket query van geocaching.com');
  const pq = parseGpx(PQ, { bron: 'twickel.gpx' });
  const codes = pq.caches.map((c) => c.code);
  ok('zeven punten gelezen', pq.gevonden === 7, `${pq.gevonden}`);
  ok('alleen de bruikbare caches erin', codes.join(',') === 'GC1TEST,GC5MULTI',
     codes.join(',') || '(niets)');
  ok('puzzelcache overgeslagen', pq.overgeslagen.puzzel === 1);
  ok('gearchiveerde overgeslagen', pq.overgeslagen.archief === 1);
  ok('terrein 5 overgeslagen', pq.overgeslagen.terrein === 1);
  ok('earthcache overgeslagen (geen doosje)', pq.overgeslagen.geenDoosje === 1);
  ok('parkeerplaats is geen cache', pq.overgeslagen.hulppunt === 1);

  const t = pq.caches[0];
  ok('coördinaten als [lon, lat]',
     t.coord[0] === 6.71705 && t.coord[1] === 52.26417, JSON.stringify(t.coord));
  ok('naam uit het cacheblok', t.naam === 'Twickel Traditional', t.naam);
  ok('soort vertaald', t.soortNL === 'gewone cache', t.soortNL);
  ok('D en T gelezen', t.difficulty === 1.5 && t.terrain === 2, `D${t.difficulty}/T${t.terrain}`);
  ok('eigenaar gelezen', t.eigenaar === 'Marc', t.eigenaar);
  ok('container gelezen', t.container === 'Small', t.container);
  ok('link bewaard', t.url === 'https://www.geocaching.com/geocache/GC1TEST', t.url);
  ok('bron bewaard', t.bron === 'twickel.gpx', t.bron);

  const multi = pq.caches[1];
  ok('multi is gemarkeerd als eerste station', multi.eersteStation === true);

  ok('overslagtekst leest als een zin',
     /puzzelcache/.test(overslagTekst(pq.overgeslagen)),
     overslagTekst(pq.overgeslagen));

  /* ── c:geo, andere naamruimteversie ──────────────────────────────────────── */
  uit.push('\nExport uit c:geo');
  const cg = parseGpx(CGEO, { bron: 'cgeo.gpx' });
  ok('andere naamruimteversie werkt net zo', cg.caches.length === 1,
     `${cg.caches.length} cache(s)`);
  ok('komma als decimaalteken in terrain', cg.caches[0].terrain === 1.5,
     String(cg.caches[0].terrain));
  ok('naam uit het blok', cg.caches[0].naam === 'Uit c:geo', cg.caches[0].naam);
  ok('owner als terugval voor placed_by', cg.caches[0].eigenaar === 'Iemand');

  /* ── Kale GPX ────────────────────────────────────────────────────────────── */
  uit.push('\nGPX zonder groundspeak-blok');
  const k = parseGpx(KAAL);
  ok('cache op <type> herkend', k.caches.length === 1, `${k.caches.length}`);
  ok('naam uit urlname', k.caches[0].naam === 'Zonder blok', k.caches[0].naam);
  ok('trailhead is geen cache', k.overgeslagen.hulppunt === 1);
  ok('geen D/T is null, geen 0',
     k.caches[0].difficulty === null && k.caches[0].terrain === null);

  /* ── Wat er stuk mag gaan ────────────────────────────────────────────────── */
  uit.push('\nRommel');
  const stuk = (xml) => { try { parseGpx(xml); return null; } catch (e) { return e; } };
  ok('leeg bestand geeft een nette fout', stuk('') instanceof GpxError,
     (stuk('') || {}).message);
  ok('geen XML geeft een nette fout', stuk('dit is geen xml <<<') instanceof GpxError,
     (stuk('dit is geen xml <<<') || {}).message);
  ok('XML zonder punten geeft een nette fout',
     stuk('<?xml version="1.0"?><gpx></gpx>') instanceof GpxError,
     (stuk('<?xml version="1.0"?><gpx></gpx>') || {}).message);
  const nul = parseGpx(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1">
    <wpt lat="0" lon="0"><name>GC0</name><type>Geocache|Traditional Cache</type></wpt></gpx>`);
  ok('0,0 telt niet als coördinaat', nul.caches.length === 0 && nul.overgeslagen.geenCoord === 1);
  const raar = parseGpx(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1">
    <wpt lat="52.1" lon="6.1"><name>GCX</name><type>Geocache|Iets Nieuws</type></wpt></gpx>`);
  ok('onbekende soort wordt geteld, niet stil geslikt',
     raar.caches.length === 0 && raar.overgeslagen.onbekend === 1);

  /* ── Filteren op afstand ─────────────────────────────────────────────────── */
  uit.push('\nCaches in de buurt');
  const alles = [...pq.caches, ...cg.caches, ...k.caches];
  const dicht = cachesInBuurt(alles, { lat: 52.26417, lon: 6.71705, radiusM: 700 });
  ok('binnen 700 m blijven er drie over', dicht.length === 3,
     dicht.map((p) => `${p.label} (${Math.round(p.distFromStart)}m)`).join(', '));
  ok('gesorteerd op afstand',
     dicht.every((p, i) => i === 0 || p.distFromStart >= dicht[i - 1].distFromStart));
  ok('POI-vorm klopt voor de generator',
     dicht.every((p) => p.category === 'cache' && Array.isArray(p.coord) &&
                        typeof p.distFromStart === 'number' && p.icon));
  ok('meta vertelt soort en zwaarte', /gewone cache · D1,5\/T2/.test(dicht[0].soort),
     dicht[0].soort);
  ok('multi zegt dat het een start is',
     dicht.some((p) => /start van een multi/.test(p.soort)));
  const ver = cachesInBuurt(alles, { lat: 52.0, lon: 5.0, radiusM: 500 });
  ok('ver weg levert niets', ver.length === 0);

  uit.push(`\n${fouten ? `${fouten} FOUT(EN)` : 'alles goed'}`);
  const verslag = uit.join('\n');
  console.log(verslag);
  return { fouten, verslag };
}
