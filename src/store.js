/* ============================================================================
   Opslag in IndexedDB.

   Beslissing 1 was: geen backend. Alles staat dus op dit ene toestel, en dat
   heeft één onaangename kant — een gewiste of verloren telefoon neemt het hele
   stickerboek mee. Voor jou is dat een lege database, voor je kind is het zijn
   boek. Vandaar exportAll(): één knop die alles als JSON wegschrijft.

   Beslissing 11 was één kind met een vast profiel. Toch krijgt elke sticker en
   elke wandeling een childId mee. Dat kost nu één veld, en het scheelt later een
   schemamigratie die je moet testen tegen de echte, opgebouwde geschiedenis van
   je kind — precies de data die je niet mag slopen.
   ============================================================================ */

const DB_NAME = 'stapper';

/* Verhoog dit bij elke nieuwe object store, anders draait onupgradeneeded niet
 * en krijg je "object store not found" op een database die al bestond. De
 * handler hieronder maakt alleen wat er nog niet is, dus hij is veilig voor
 * zowel een verse als een bestaande database.
 *   1 → kv, stickers, routes, walks
 *   2 → photos
 *   3 → caches (geocaches uit een GPX-bestand)
 */
const DB_VERSION = 3;
export const DEFAULT_CHILD = 'kind-1';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('stickers')) {
        const s = db.createObjectStore('stickers', { keyPath: 'id', autoIncrement: true });
        s.createIndex('childId', 'childId');
      }
      if (!db.objectStoreNames.contains('routes')) {
        db.createObjectStore('routes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('walks')) {
        const w = db.createObjectStore('walks', { keyPath: 'id' });
        w.createIndex('childId', 'childId');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const p = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        p.createIndex('childId', 'childId');
      }
      if (!db.objectStoreNames.contains('caches')) {
        // Sleutel is de cachecode (GC1ABCD): opnieuw hetzelfde bestand inladen
        // overschrijft dan in plaats van te verdubbelen.
        db.createObjectStore('caches', { keyPath: 'code' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/* Een leesactie levert zijn resultaat pas ná de transactie, dus geven we een
 * doosje door en pakken dat bij oncomplete uit. Het merkteken is nodig omdat
 * `undefined` een geldige uitkomst is — "niets gevonden" mag niet als "het
 * doosje zelf" terugkomen, want een object is altijd truthy. */
const BOX = Symbol('box');

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && result[BOX] ? result.value : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = (req) => {
  const box = { [BOX]: true, value: undefined };
  req.onsuccess = () => { box.value = req.result; };
  return box;
};

/** Vraagt de browser de opslag niet op te ruimen als het toestel vol raakt.
 *  Drie regels, en het scheelt je een keer een leeg stickerboek. */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

/* ── Profiel ────────────────────────────────────────────────────────────── */

export const getProfile = () => tx('kv', 'readonly', (s) => wrap(s.get('profile')));
export const setProfile = (profile) => tx('kv', 'readwrite', (s) => s.put(profile, 'profile'));

/* ── Losse instellingen ─────────────────────────────────────────────────
   De oudercode, en wat er over het ingeladen GPX-bestand te melden valt. Bewust
   hier en niet in de broncode: de repo is publiek.
   ───────────────────────────────────────────────────────────────────────── */

export const getSetting = (key) => tx('kv', 'readonly', (s) => wrap(s.get(`set:${key}`)));
export const setSetting = (key, value) =>
  tx('kv', 'readwrite', (s) => (value === null || value === undefined
    ? s.delete(`set:${key}`)
    : s.put(value, `set:${key}`)));

/* ── Stickers ───────────────────────────────────────────────────────────── */

export const addSticker = (sticker) => tx('stickers', 'readwrite', (s) => s.add({
  childId: DEFAULT_CHILD, at: Date.now(), ...sticker,
}));

export const listStickers = () => tx('stickers', 'readonly', (s) => wrap(s.getAll()));

/* ── Bewaarde rondjes ───────────────────────────────────────────────────── */

/** Een route is een paar honderd coördinaten; als JSON een handvol kB. Klein
 *  genoeg om hem hele­maal te bewaren, en dan kun je hem later opnieuw lopen
 *  zonder opnieuw te genereren — ook zonder bereik. */
export const saveRoute = (route) => tx('routes', 'readwrite', (s) => s.put({
  ...route, savedAt: Date.now(),
}));

export const listSavedRoutes = () => tx('routes', 'readonly', (s) => wrap(s.getAll()));
export const deleteRoute = (id) => tx('routes', 'readwrite', (s) => s.delete(id));

/* ── Wandelingen ────────────────────────────────────────────────────────── */

export const recordWalk = (walk) => tx('walks', 'readwrite', (s) => s.put({
  childId: DEFAULT_CHILD, at: Date.now(), ...walk,
}));

export const listWalks = () => tx('walks', 'readonly', (s) => wrap(s.getAll()));

/* ── Foto's ─────────────────────────────────────────────────────────────
   De blob zelf gaat de database in; IndexedDB kan dat en het scheelt een tweede
   opslagplek. Wel de reden dat foto's níet in de JSON-export zitten: dan wordt
   het bestand tientallen megabytes en is het geen back-up meer maar een verhuizing.
   ───────────────────────────────────────────────────────────────────────── */

export const addPhoto = (photo) => tx('photos', 'readwrite', (s) => s.add({
  childId: DEFAULT_CHILD, at: Date.now(), ...photo,
}));

export const listPhotos = () => tx('photos', 'readonly', (s) => wrap(s.getAll()));
export const deletePhoto = (id) => tx('photos', 'readwrite', (s) => s.delete(id));

/* ── Geocaches uit een GPX-bestand ──────────────────────────────────────────
   Jouw eigen selectie, geëxporteerd uit c:geo of als pocket query. Ze staan hier
   en niet achter een API: dan werken ze offline, hoeft er geen sleutel aangevraagd
   te worden, en zijn het de caches die jíj leuk vond in plaats van alles binnen
   drie kilometer.
   ───────────────────────────────────────────────────────────────────────────── */

export async function putCaches(caches) {
  if (!caches.length) return 0;
  await tx('caches', 'readwrite', (s) => { for (const c of caches) s.put(c); });
  return caches.length;
}

export const listCaches = () => tx('caches', 'readonly', (s) => wrap(s.getAll()));
export const countCaches = () => tx('caches', 'readonly', (s) => wrap(s.count()));
export const clearCaches = () => tx('caches', 'readwrite', (s) => s.clear());

/* ── Export en import ───────────────────────────────────────────────────── */

export async function exportAll() {
  const [profile, stickers, routes, walks] = await Promise.all([
    getProfile(), listStickers(), listSavedRoutes(), listWalks(),
  ]);
  return {
    app: 'stapper', version: DB_VERSION, exportedAt: new Date().toISOString(),
    profile: profile || null, stickers, routes, walks,
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'stapper') throw new Error('Dit is geen Stapper-export.');
  if (data.profile) await setProfile(data.profile);
  for (const s of data.stickers || []) await tx('stickers', 'readwrite', (st) => st.put(s));
  for (const r of data.routes || []) await tx('routes', 'readwrite', (st) => st.put(r));
  for (const w of data.walks || []) await tx('walks', 'readwrite', (st) => st.put(w));
}
