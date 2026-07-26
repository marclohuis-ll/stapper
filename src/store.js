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
const DB_VERSION = 1;
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
