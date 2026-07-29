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
  /* Iets lichter dan de platte variant: een opgetrokken vlak dat exact de kleur van
   * de grond heeft, ziet eruit als een gat in plaats van een huis. */
  building3d: '#1E3228',
  road:      '#2B4238',
  roadBig:   '#36503F',
  /* Drie soorten paadje, elk herkenbaar. Alle drie lichter dan de wegen, want
   * hier gaat de app over. */
  path:      '#A8CE63',   // bos- en voetpad
  track:     '#95A45E',   // zandpad / onverharde weg
  cycle:     '#5C9A92',   // fietspad, koeler zodat je het verschil ziet

  /* De route: de énige lijn op de kaart die niet groen is.
   *
   * Hij was lime, net als de voetpaden, en het onderscheid zat in breedte en in
   * wel/niet onderbroken. Dat is te weinig: op een kaart vol lime streepjes moet je
   * kijken welke lijn de jouwe is, en dat wil je niet terwijl je loopt.
   *
   * Roze en niet oranje of rood: die twee liggen te dicht bij de amberkleurige
   * waarschuwingen én bij het olijf van de zandpaden. Roze schuift juist naar blauw
   * toe, dus het blijft ook te onderscheiden als je rood en groen slecht ziet — bij
   * een rode route op groene paadjes is dat precies wat wegvalt. */
  route:     '#FF6FA3',
  routeDim:  'rgba(255,111,163,.32)',
  pathCase:  '#0D1C17',
  text:      '#EAF3EA',
  textHalo:  '#0A1512',
  textDim:   'rgba(234,243,234,.62)',
  poi:       '#6FE3D0',   // mint: onderscheidt punten van de lime routelijn
};

const TILES = 'https://tiles.openfreemap.org/planet';

/* Wat er van de poi-laag op de kaart mag. De laag zelf is vooral ruis — gemeten
 * in een schijf van 3 km: 174 parkeerplaatsen, 167 hekken, 146 bollards en 101
 * afvalbakken. Dus omgekeerd werken: alleen tonen wat je onderweg wíl zien. */
const POI_KLASSEN = [
  'playground', 'pitch', 'park', 'garden', 'shelter', 'information',
  'cafe', 'restaurant', 'fast_food', 'bakery', 'bar', 'ice_cream',
  'attraction', 'monument', 'castle', 'museum', 'artwork', 'viewpoint',
  'picnic_site', 'zoo', 'water', 'swimming_area', 'campsite', 'dog_park',
];
const POI_FILTER = ['in', ['get', 'class'], ['literal', POI_KLASSEN]];

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
      /* Dezelfde huizen, maar overeind. Staat uit tot je de kaart kantelt (zie
       * mapview.setView): platte vlakken bovenop opgetrokken vlakken is dubbel
       * getekend, en zonder kanteling zie je van de hoogte toch niets.
       *
       * `render_height` en `render_min_height` komen uit het OpenMapTiles-schema en
       * zijn precies bedoeld om dit te kunnen: hoogte in meters, met de onderkant
       * apart zodat een brug niet vanaf de grond wordt opgetrokken. */
      {
        id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles',
        'source-layer': 'building', minzoom: 15,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': C.building3d,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          // Doorschijnend: de route moet belangrijker blijven dan de huizen.
          'fill-extrusion-opacity': 0.72,
          'fill-extrusion-vertical-gradient': true,
        },
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

      /* ── paden ──────────────────────────────────────────────────────────
         Het onderwerp van de app, dus ze moeten opvallen. Eerdere versie tekende
         0,8 px lime op z12 bovenop een 2,4 px dónkere casing — die casing maakte
         het pad juist onzichtbaar tegen de donkere achtergrond.

         Drie soorten apart, want ze zijn niet hetzelfde en `line-dasharray` kan
         niet data-gestuurd: een bospad is geen fietspad. In het OpenMapTiles-
         schema valt `cycleway` onder klasse `path` — het is er zelfs de grootste
         subklasse van (702 van de 1434 op z13), dus zonder onderscheid teken je
         vooral fietspaden en noem je ze paadjes. */
      {
        id: 'pad-case', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.pathCase,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.2, 17, 9],
        },
      },
      {
        id: 'pad-fiets', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all',
          ['in', ['get', 'class'], ['literal', ['path']]],
          ['==', ['get', 'subclass'], 'cycleway']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.cycle,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 17, 3.4],
        },
      },
      {
        id: 'pad-track', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 12,
        filter: ['==', ['get', 'class'], 'track'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': C.track,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 17, 5],
          'line-dasharray': [4, 1.4],
        },
      },
      {
        id: 'pad-voet', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all',
          ['==', ['get', 'class'], 'path'],
          ['!=', ['get', 'subclass'], 'cycleway']],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': C.path,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 17, 5],
          'line-dasharray': [2.2, 1.2],
        },
      },

      /* ── straatnamen ────────────────────────────────────────────────────
         Langs de lijn geplaatst, want dan hoort de naam bij de weg in plaats
         van ergens los te zweven. Vanaf z14, anders wordt het een tapijt. */
      {
        id: 'straatnaam', type: 'symbol', source: 'openmaptiles',
        'source-layer': 'transportation_name', minzoom: 14,
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 17, 13],
          'symbol-placement': 'line', 'text-anchor': 'center',
          'text-max-angle': 40, 'symbol-spacing': 320, 'text-padding': 4,
        },
        paint: {
          // Stevig genoeg om buiten in de zon te lezen; een flets label is
          // hetzelfde als geen label.
          'text-color': 'rgba(234,243,234,.82)',
          'text-halo-color': C.textHalo, 'text-halo-width': 1.8,
        },
      },

      /* ── punten onderweg ────────────────────────────────────────────────
         Geen sprite beschikbaar, dus een stip plus de naam. De ruis uit de
         poi-laag — parkeerplaatsen, hekken, bollards, afvalbakken — is er
         uitgefilterd; die stonden er met 174, 167 en 146 stuks in en maken de
         kaart onleesbaar. */
      {
        id: 'poi-stip', type: 'circle', source: 'openmaptiles',
        'source-layer': 'poi', minzoom: 14,
        filter: POI_FILTER,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.2, 17, 4],
          'circle-color': C.poi,
          'circle-stroke-color': C.bg, 'circle-stroke-width': 1,
        },
      },
      {
        id: 'poi-naam', type: 'symbol', source: 'openmaptiles',
        'source-layer': 'poi', minzoom: 15,
        filter: POI_FILTER,
        layout: {
          'text-field': ['coalesce', ['get', 'name'], ''],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 12],
          'text-offset': [0, 0.9], 'text-anchor': 'top',
          'text-max-width': 8, 'text-optional': true,
        },
        paint: {
          'text-color': C.poi,
          'text-halo-color': C.textHalo, 'text-halo-width': 1.6,
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
