/* ============================================================================
   Wandeling nabootsen.

   Live tracking valt niet te testen achter een bureau: er is geen GPS-fix en
   je loopt niet echt. Deze module levert dezelfde vorm posities als
   watchPosition(), maar afgelezen van de routelijn.

   Ook nuttig buiten het ontwikkelen om: zo kun je vooraf zien hoe een route
   zich onderweg gedraagt zonder hem te lopen.

   Aanzetten met ?sim in de URL, en ?sim=30 om de route in 30 seconden af te
   leggen in plaats van de standaard 90.
   ============================================================================ */

import { distM } from './geo.js';

/** Leest ?sim uit de URL. Geeft null als er niet gesimuleerd moet worden. */
export function simulationSetting(search = location.search) {
  const raw = new URLSearchParams(search).get('sim');
  if (raw === null) return null;
  const seconds = Number(raw);
  return { durationS: Number.isFinite(seconds) && seconds > 0 ? seconds : 90 };
}

/**
 * Loopt de route af en meldt onderweg posities.
 *
 * De nauwkeurigheid wisselt bewust tussen 8 en 35 meter: dat is wat je onder een
 * bladerdek krijgt, en de nabijheids-gate rekent die waarde mee. Met een vaste,
 * perfecte nauwkeurigheid zou je die logica nooit uitgeoefend zien.
 *
 * @param {{coords:Array}} route
 * @param {(pos:{lat:number,lon:number,accuracy:number,at:number}) => void} onUpdate
 * @returns {() => void} stopfunctie
 */
export function simulateWalk(route, onUpdate, { durationS = 90, tickMs = 700 } = {}) {
  const coords = route.coords;
  if (!coords || coords.length < 2) return () => {};

  // Cumulatieve afstanden, zodat we op elk moment lineair kunnen interpoleren.
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];

  const startedAt = performance.now();
  let jitterPhase = 0;

  const emit = () => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const frac = Math.min(1, elapsed / durationS);
    const target = total * frac;

    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const span = cum[i] - cum[i - 1];
    const t = span === 0 ? 0 : (target - cum[i - 1]) / span;

    const a = coords[i - 1], b = coords[i];
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;

    // Een beetje afdwalen van de lijn, want in het echt loop je er niet exact op.
    jitterPhase += 0.7;
    const wobbleM = 6 * Math.sin(jitterPhase);
    const dLat = wobbleM / 111320;

    onUpdate({
      lat: lat + dLat,
      lon,
      accuracy: 8 + 27 * (0.5 + 0.5 * Math.sin(jitterPhase * 0.31)),
      heading: null,
      at: Date.now(),
      simulated: true,
    });

    if (frac >= 1) stop();
  };

  let timer = setInterval(emit, tickMs);
  emit();

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  return stop;
}
