/* ============================================================================
   Kompas voor de kindmodus.

   Twee dingen die je in het ontwerp niet ziet maar die het verschil maken.

   Magnetometers zijn onrustig: ruwe waarden laten de naald dansen, en een kind
   dat een dansende pijl ziet vertrouwt hem niet. Daarom dempen we, en wel over
   de eenheidscirkel — een gewoon gemiddelde van graden springt bij de overgang
   van 359° naar 0° naar het zuiden.

   En het event verschilt per platform: Android geeft `deviceorientationabsolute`
   met alpha ten opzichte van het noorden, iOS geeft `webkitCompassHeading` op
   het gewone `deviceorientation`-event en vraagt eerst expliciet toestemming.
   ============================================================================ */

const SMOOTH = 0.18;         // 0 = niets doorlaten, 1 = geen demping

export const needsPermission =
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof DeviceOrientationEvent.requestPermission === 'function';

/**
 * Vraagt toestemming waar dat nodig is (iOS). Moet uit een gebruikersactie
 * komen, dus in de oudermodus aanroepen vóórdat je het toestel overhandigt —
 * een zesjarige moet geen permissiedialoog wegklikken.
 */
export async function requestCompassPermission() {
  if (!needsPermission) return true;
  try { return (await DeviceOrientationEvent.requestPermission()) === 'granted'; }
  catch { return false; }
}

/**
 * @param {(headingDeg:number|null) => void} onHeading  0–360, noord = 0
 * @returns {() => void} stopfunctie
 */
export function startCompass(onHeading) {
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    onHeading(null);
    return () => {};
  }

  let sx = null, cy = null;

  const handle = (e) => {
    const raw = readHeading(e);
    if (raw == null) return;

    const rad = raw * Math.PI / 180;
    const s = Math.sin(rad), c = Math.cos(rad);
    if (sx == null) { sx = s; cy = c; }
    else { sx += (s - sx) * SMOOTH; cy += (c - cy) * SMOOTH; }

    onHeading((Math.atan2(sx, cy) * 180 / Math.PI + 360) % 360);
  };

  // Absoluut is wat we willen; het gewone event erbij als vangnet, want niet
  // elk toestel stuurt de absolute variant.
  window.addEventListener('deviceorientationabsolute', handle, true);
  window.addEventListener('deviceorientation', handle, true);

  return () => {
    window.removeEventListener('deviceorientationabsolute', handle, true);
    window.removeEventListener('deviceorientation', handle, true);
  };
}

function readHeading(e) {
  // iOS
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    return e.webkitCompassHeading;
  }
  // Android: alpha loopt tegen de klok in vanaf noord, dus omkeren.
  if (e.absolute === true && typeof e.alpha === 'number') return (360 - e.alpha) % 360;
  if (typeof e.alpha === 'number') return (360 - e.alpha) % 360;
  return null;
}

/**
 * Hoeveel graden de naald moet draaien om naar het doel te wijzen: de peiling
 * naar het doel min de richting waarin de telefoon wijst.
 */
export function needleRotation(bearingToTarget, deviceHeading) {
  if (deviceHeading == null) return bearingToTarget;   // geen kompas: noord boven
  return (bearingToTarget - deviceHeading + 360) % 360;
}
