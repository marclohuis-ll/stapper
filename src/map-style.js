/* ============================================================================
   Kaartstijl in het Boslamp-palet.

   Dit is de hele reden dat beslissing 5 op vector uitkwam: rastertiles zijn
   afbeeldingen die de provider rendert, en de standaard OSM-kaart is beige met
   rode wegen. In een app op #0C1A17 ziet dat eruit als een bug. Vector betekent
   dat we onze eigen stijl schrijven en de kaart in de kleuren van het ontwerp
   zetten.

   Bewust kaal gehouden: op een wandeling wil je paden, water en bos zien, niet
   winkelcategorieën. Elke laag die er niet in zit, is er niet in gezet.
   ============================================================================ */

const C = {
  bg:        '#0C1A17',
  wood:      '#13291F',
  grass:     '#102520',
  park:      '#143026',
  water:     '#12363A',
  waterLine: '#1E5A57',
  building:  '#182720',
  road:      '#24382F',
  roadBig:   '#2E4438',
  path:      '#7FA24E',   // gedempte lime — een pad moet opvallen, niet schreeuwen
  pathCase:  '#0F211B',
  text:      '#EAF3EA',
  textHalo:  '#0A1512',
  textDim:   'rgba(234,243,234,.62)',
};

const TILES = 'https://tiles.openfreemap.org/planet';

export function darkStyle() {
  return {
    version: 8,
    name: 'Stapper Boslamp',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: TILES,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },

      /* ── groen en water ─────────────────────────────────────────────── */
      {
        id: 'landcover-wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]],
        paint: { 'fill-color': C.wood },
      },
      {
        id: 'landcover-grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'scrub', 'heath']]],
        paint: { 'fill-color': C.grass },
      },
      {
        id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
        paint: { 'fill-color': C.park, 'fill-opacity': .7 },
      },
      {
        id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': C.water },
      },
      {
        id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: {
          'line-color': C.waterLine,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 2.6],
        },
      },

      /* ── bebouwing ──────────────────────────────────────────────────── */
      {
        id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': C.building },
      },

      /* ── wegen, gedempt: ze zijn oriëntatie, geen hoofdrol ──────────── */
      {
        id: 'road-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'raceway']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.road,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 5],
        },
      },
      {
        id: 'road-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'],
          ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.roadBig,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 8],
        },
      },

      /* ── paden: het onderwerp van de app, dus met een casing zodat ze
             ook boven donker bos leesbaar blijven ─────────────────────── */
      {
        id: 'path-case', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.pathCase,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 17, 8],
        },
      },
      {
        id: 'path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.path,
          'line-opacity': .85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 3.4],
          'line-dasharray': [3, 1.6],
        },
      },

      /* ── labels ─────────────────────────────────────────────────────── */
      {
        id: 'water-name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'],
          'text-size': 11, 'symbol-placement': 'point',
        },
        paint: { 'text-color': C.waterLine, 'text-halo-color': C.textHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'place-village', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['village', 'hamlet', 'suburb', 'neighbourhood']]],
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
          'text-size': 11.5, 'text-max-width': 8,
        },
        paint: { 'text-color': C.textDim, 'text-halo-color': C.textHalo, 'text-halo-width': 1.4 },
      },
      {
        id: 'place-town', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15],
          'text-max-width': 8,
        },
        paint: { 'text-color': C.text, 'text-halo-color': C.textHalo, 'text-halo-width': 1.6 },
      },
    ],
  };
}

/** Kleuren die de route-overlay ook nodig heeft, zodat ze niet uiteenlopen. */
export const MAP_COLOURS = C;

/* ============================================================================
   Stijl voor de onzichtbare oogster.

   Gemeten valkuil: `querySourceFeatures()` geeft niets terug uit een
   source-layer waar geen enkele stijllaag naar verwijst. MapLibre laat de
   tile-worker alleen de lagen parseren die de stijl gebruikt. De donkere stijl
   hierboven tekent de `poi`-laag bewust niet — en dus vond de oogster met die
   stijl nul punten, terwijl dezelfde tegels er 29 in hebben.

   Daarom heeft de oogster zijn eigen stijl, die precies de lagen bevat die we
   uitvragen. Hij wordt nooit bekeken; het gaat er alleen om dat de features
   geparseerd worden.
   ============================================================================ */

const QUERIED_LAYERS = ['poi', 'transportation', 'water', 'waterway', 'landuse', 'park'];

export function harvestStyle() {
  return {
    version: 8,
    name: 'Stapper oogster',
    sources: { openmaptiles: { type: 'vector', url: TILES } },
    layers: QUERIED_LAYERS.map((layer) => ({
      id: `q-${layer}`,
      type: 'circle',
      source: 'openmaptiles',
      'source-layer': layer,
      paint: { 'circle-radius': 1, 'circle-opacity': 0 },
    })),
  };
}
