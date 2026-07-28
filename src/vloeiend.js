/* ============================================================================
   Vloeiend bewegen tussen GPS-metingen.

   Het probleem: een GPS-fix komt ongeveer één keer per seconde. Zet je de kaart en
   de stip dán op de nieuwe plek, dan krijg je één sprong per seconde — en dat is
   precies wat "hakkelig" is. De beweging gebeurt niet in de wereld maar in het
   scherm: je loopt vloeiend, de app niet.

   De oplossing is niet sneller meten (dat kan de satelliet niet) maar tússen de
   metingen tekenen. Deze module houdt een *getoonde* positie bij die elk frame een
   stukje naar de laatste meting toe kruipt, en geeft die 60 keer per seconde door.

   Waarom exponentieel dempen en niet lineair interpoleren tussen twee fixes:
   lineair moet je vooraf weten wanneer de volgende meting komt, en dat weet je
   niet. Onder een bladerdek valt er zomaar drie seconden niets binnen. Exponentieel
   dempen heeft die aanname niet nodig, kan nooit voorbij het doel schieten, en
   vertraagt netjes als de metingen wegvallen in plaats van te bevriezen en dan te
   springen.

   De prijs is dat de stip een fractie achterloopt op de meting. Bij 0,35 s tijd-
   constante is dat op wandelsnelheid ongeveer een halve meter — een orde van
   grootte minder dan de GPS-onnauwkeurigheid zelf, dus je ziet het niet.
   ============================================================================ */

const TAU_POSITIE = 0.35;   // seconden; hoe snel de pijl de meting inhaalt
const TAU_KOERS = 0.28;     // draaien mag iets vlotter dan schuiven
const SPRONG_M = 120;       // hierboven niet dempen maar verplaatsen

/**
 * Eén stap van de getoonde stand naar de meting, over `dt` seconden.
 *
 * Los van requestAnimationFrame, en dat is niet toevallig: zo is dit na te rekenen
 * met een verzonnen klok in plaats van te moeten hopen dat de omgeving frames geeft.
 * De lus hieronder is verder niets anders dan deze functie plus een klok.
 *
 * @returns {{lon:number, lat:number, koers:number|null}} de nieuwe stand
 */
export function stapNaar(toon, doel, dt) {
  if (dt <= 0) return toon;
  const a = 1 - Math.exp(-dt / TAU_POSITIE);
  const uit = {
    lon: toon.lon + (doel.lon - toon.lon) * a,
    lat: toon.lat + (doel.lat - toon.lat) * a,
    koers: toon.koers,
  };
  if (doel.koers != null) {
    uit.koers = toon.koers == null
      ? doel.koers
      : draaiNaar(toon.koers, doel.koers, 1 - Math.exp(-dt / TAU_KOERS));
  }
  return uit;
}

/**
 * @param {(stand:{lon:number, lat:number, koers:number|null}) => void} onFrame
 */
export function createVloeiend(onFrame) {
  let doel = null;          // laatste meting
  let toon = null;          // wat er nu op het scherm staat
  let vorigeTijd = 0;
  let rafId = null;
  let gestopt = false;

  function frame(nu) {
    rafId = requestAnimationFrame(frame);
    if (!doel || !toon) return;

    // Op basis van echte tijd, niet van framenummers: bij 30 fps op een oude
    // telefoon moet de beweging even snel zijn, alleen met minder stapjes.
    const dt = vorigeTijd ? Math.min(0.25, (nu - vorigeTijd) / 1000) : 0;
    vorigeTijd = nu;
    if (dt <= 0) return;

    toon = stapNaar(toon, doel, dt);
    onFrame({ ...toon });
  }

  return {
    /** Een nieuwe meting. Alleen het doel verschuift; het tekenen doet het frame. */
    push({ lon, lat, koers = null }) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      doel = { lon, lat, koers };

      // Eerste meting, of een sprong die geen wandeling kan zijn (een verse fix na
      // lang niets, of een testlocatie). Dan is dempen verkeerd: dan zou de stip
      // seconden lang over het landschap zweven. Meteen neerzetten.
      if (!toon || ruwAfstandM(toon, doel) > SPRONG_M) {
        toon = { lon, lat, koers };
        onFrame({ ...toon });
      }
      if (!rafId && !gestopt) { vorigeTijd = 0; rafId = requestAnimationFrame(frame); }
    },

    /** Waar de stip nu staat — voor wie tussen frames iets wil weten. */
    stand() { return toon ? { ...toon } : null; },

    stop() {
      gestopt = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      doel = toon = null;
    },
  };
}

/** Kortste weg naar een richting, over de eenheidscirkel. Zonder dit draait een
 *  overgang van 350° naar 10° de verkeerde kant om, 340 graden lang. */
export function draaiNaar(van, naar, fractie) {
  let verschil = ((naar - van + 540) % 360) - 180;
  return (van + verschil * fractie + 360) % 360;
}

/** Ruwe afstand in meters. Genoeg om een sprong van een stap te onderscheiden. */
function ruwAfstandM(a, b) {
  const dx = (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  const dy = (b.lat - a.lat) * 111320;
  return Math.hypot(dx, dy);
}
