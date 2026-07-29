/* ============================================================================
   Welke schermen vallen buiten beeld?

   Draaien: open de app en typ in de console
       (await import('/spike/hoogte-probe.js')).run()
       (await import('/spike/hoogte-probe.js')).run({ zoeken: true })

   `.screen` heeft `overflow: hidden`, dus inhoud die niet past wordt zwíjgend
   afgesneden — er komt geen scrollbalk die je waarschuwt. Alleen schermen met een
   `.screen__body` kunnen scrollen; de rest heeft een vaste indeling.

   Deze probe zet elk scherm neer en zoekt elementen die onder de onderkant van het
   scherm uitkomen zonder dat er een scrollcontainer is die je erbij kan brengen. Dat
   is precies de definitie van "valt buiten beeld".

   Layout werkt ook zonder dat er frames getekend worden, dus dit meet ook met een
   dicht browserpaneel.
   ============================================================================ */

/* De schermen die zonder route te bekijken zijn, en die met. */
const ZONDER_ROUTE = ['welkom', 'home', 'instellen', 'startpunt', 'zoeken', 'rondjes', 'boek', 'profiel'];
const MET_ROUTE = ['resultaten', 'detail', 'bewerken', 'onderweg', 'kind', 'recap'];

/* Waar we op meten.
 *
 * Niet alleen de volle hoogte van het toestel: in een browsertab kost de adresbalk
 * ruim honderd punten, en met gebaarnavigatie gaat er onderaan ook nog wat af. Juist
 * daar wordt het krap, dus die gevallen staan er expliciet bij. */
const MATEN = [
  { naam: 'OnePlus 13R, als app', breed: 412, hoog: 906 },
  { naam: 'OnePlus 13R, in Chrome', breed: 412, hoog: 780 },
  { naam: 'idem, adresbalk + toetsenbalk', breed: 412, hoog: 720 },
  { naam: 'klein toestel', breed: 360, hoog: 640 },
];

export async function run({ zoeken = false } = {}) {
  const regels = [];
  const gevonden = [];
  const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

  regels.push('Let op: het venster van dit paneel wordt niet aangepast — de maten');
  regels.push('hieronder worden nagebootst door #app tijdelijk vast te zetten.\n');

  let schermen = [...ZONDER_ROUTE];
  if (zoeken) {
    regels.push('Eerst een route zoeken, zodat ook de route-schermen te meten zijn…');
    const gelukt = await zoekEenRoute(wacht);
    regels.push(gelukt ? '  route gevonden\n' : '  zoeken lukte niet; route-schermen overgeslagen\n');
    if (gelukt) schermen = [...schermen, ...MET_ROUTE];
  } else {
    regels.push('Zonder ?zoeken: alleen de schermen die geen route nodig hebben.');
    regels.push('Roep run({ zoeken: true }) voor alle veertien.\n');
  }

  const app = document.getElementById('app');
  const oud = app.getAttribute('style') || '';

  for (const maat of MATEN) {
    regels.push(`\n── ${maat.naam} (${maat.breed} × ${maat.hoog}) ──`);
    // De app op maat zetten in plaats van het venster: dat kan van binnenuit, en de
    // app is toch een vaste kolom van maximaal 412 px breed.
    app.style.cssText = `${oud};position:fixed;top:0;left:0;transform:none;` +
      `width:${maat.breed}px;max-width:${maat.breed}px;height:${maat.hoog}px`;
    await wacht(120);

    for (const naam of schermen) {
      location.hash = `#/${naam}`;
      await wacht(naam === 'detail' || naam === 'bewerken' || naam === 'onderweg' ? 900 : 320);

      const uitslag = meetScherm(naam);
      if (!uitslag) { regels.push(`  ?      ${naam.padEnd(11)} niet te meten (geen .screen)`); continue; }

      if (uitslag.buiten.length) {
        gevonden.push({ maat: maat.naam, scherm: naam, ...uitslag });
        regels.push(` BUITEN ${naam.padEnd(11)} ${uitslag.tekort} px te kort` +
          `${uitslag.scrollbaar ? ' (heeft wél een scrollcontainer, maar deze elementen zitten erbuiten)' : ' (geen scrollcontainer)'}`);
        for (const b of uitslag.buiten.slice(0, 4)) {
          regels.push(`          ${b.pad} — ${b.over} px eronder`);
        }
      } else {
        regels.push(`  ok    ${naam.padEnd(11)} past` +
          (uitslag.scrollbaar ? ' (scrollt)' : ''));
      }
    }
  }

  app.setAttribute('style', oud);
  await wacht(150);
  location.hash = '#/home';

  regels.push(`\n${gevonden.length ? `${gevonden.length} scherm(en) snijden af` : 'alles past'}`);
  const verslag = regels.join('\n');
  console.log(verslag);
  return { gevonden, verslag };
}

/**
 * Elementen die onder de onderkant van het scherm uitkomen zonder dat je erbij kunt.
 *
 * Zit iets in een `.screen__body` die kan scrollen, dan is het niet weg maar verderop —
 * dat is geen fout. Zit het daarbuiten, of is er geen scrollcontainer, dan is het
 * afgesneden en onbereikbaar.
 */
function meetScherm(naam) {
  const scherm = document.querySelector('#schermen .screen');
  if (!scherm) return null;
  const rect = scherm.getBoundingClientRect();
  const body = scherm.querySelector('.screen__body');
  const scrollbaar = !!body && body.scrollHeight > body.clientHeight + 1;

  const buiten = [];
  for (const el of scherm.querySelectorAll('*')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;   // onzichtbaar
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) continue;
    const over = Math.round(r.bottom - rect.bottom);
    if (over <= 1) continue;
    // Binnen een scrollende body is "eronder" gewoon "verder naar beneden".
    if (body && body.contains(el) && scrollbaar) continue;
    // Zit er tussen dit element en het scherm een container die zélf afsnijdt, dan is
    // dat opzet — zoals de sierlijke blob in de kindmodus, die met `overflow: hidden`
    // buiten het beeld hoort te vallen. Dat is geen fout maar een vormgeving.
    if (bewustAfgesneden(el, scherm)) continue;
    // Alleen het buitenste element melden, niet elk kind ervan.
    if (buiten.some((b) => b.el.contains(el))) continue;
    buiten.push({ el, over, pad: pad(el) });
  }

  const tekort = buiten.reduce((m, b) => Math.max(m, b.over), 0);
  return { buiten, tekort, scrollbaar };
}

/** Snijdt een tussenliggende container dit element met opzet af? */
function bewustAfgesneden(el, scherm) {
  for (let n = el.parentElement; n && n !== scherm; n = n.parentElement) {
    const o = getComputedStyle(n);
    if (/hidden|clip/.test(o.overflow) || /hidden|clip/.test(o.overflowY)) return true;
  }
  return false;
}

/** Een korte aanduiding van waar een element zit, om het terug te vinden. */
function pad(el) {
  const stukjes = [];
  let n = el;
  for (let i = 0; i < 3 && n && n !== document.body; i++) {
    const klasse = (n.className || '').toString().trim().split(/\s+/)[0];
    stukjes.unshift(klasse ? `.${klasse}` : n.tagName.toLowerCase());
    n = n.parentElement;
  }
  return stukjes.join(' ');
}

/** Een echte route zoeken, zodat de route-schermen te meten zijn. */
async function zoekEenRoute(wacht) {
  if (document.querySelector('[data-act="open-route"]')) return true;
  location.hash = '#/instellen';
  await wacht(700);
  const knop = document.querySelector('[data-act="zoek"]');
  if (!knop) return false;
  knop.click();
  for (let i = 0; i < 150; i++) {
    await wacht(1000);
    if (location.hash === '#/resultaten') break;
  }
  if (location.hash !== '#/resultaten') return false;
  document.querySelector('[data-act="open-route"]')?.click();
  await wacht(1200);
  return true;
}
