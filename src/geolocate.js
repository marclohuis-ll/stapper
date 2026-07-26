/* ============================================================================
   Locatiebepaling.

   De hele app hangt hieraan: "rondjes vanaf waar je nu staat". Belangrijk om te
   weten is dat dit een *powerful feature* is en dus een secure context vereist.
   Browsers maken één uitzondering: localhost. Op http://<lan-ip> weigert Chrome
   de uitvraag zonder dat er iets kapot lijkt — je krijgt simpelweg nooit een
   positie. Vandaar de expliciete melding daarover, anders zoek je een uur naar
   de verkeerde fout.
   ============================================================================ */

export const INSECURE =
  !window.isSecureContext &&
  !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Eenmalige positiebepaling. */
export function getPosition({ timeoutMs = 12000, maxAgeMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    if (INSECURE) {
      reject(new LocationError(
        'Locatie werkt alleen via https. Open de app op een https-adres of op localhost.',
        'insecure'));
      return;
    }
    if (!navigator.geolocation) {
      reject(new LocationError('Deze browser kan geen locatie bepalen.', 'unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(fromPosition(p)),
      (err) => reject(translate(err)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maxAgeMs },
    );
  });
}

/** Blijft de positie volgen. Geeft een functie terug die het stopt. */
export function watchPosition(onUpdate, onError = () => {}) {
  if (INSECURE || !navigator.geolocation) {
    onError(new LocationError('Locatie niet beschikbaar.', 'insecure'));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate(fromPosition(p)),
    (err) => onError(translate(err)),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

const fromPosition = (p) => ({
  lat: p.coords.latitude,
  lon: p.coords.longitude,
  accuracy: p.coords.accuracy,
  heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
  at: p.timestamp,
});

function translate(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return new LocationError(
        'Geen toegang tot je locatie. Zet dat aan in de browserinstellingen.', 'denied');
    case err.POSITION_UNAVAILABLE:
      return new LocationError('Geen positie te krijgen. Sta je binnen?', 'unavailable');
    case err.TIMEOUT:
      return new LocationError('Het duurde te lang om je locatie te bepalen.', 'timeout');
    default:
      return new LocationError(err.message || 'Locatie mislukt.', 'unknown');
  }
}

export class LocationError extends Error {
  constructor(message, reason) { super(message); this.name = 'LocationError'; this.reason = reason; }
}
