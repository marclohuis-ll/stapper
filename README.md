# Stapper

Wandelroutes die kinderen zelf willen lopen. Schemerdonker voor de ouder,
knalgroen daglicht voor het kind.

Implementatie van het Claude Design-document
[`Stapper Boslamp.dc.html`](https://claude.ai/design/p/edd8a40f-f530-4a2e-8454-bab993344ae4?file=Stapper+Boslamp.dc.html).

## Run it

Open [index.html](index.html) via een webserver — niet als bestand, want de app
gebruikt ES-modules. Er is geen buildstap en geen npm.

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
```

Dan <http://localhost:5173/>.

### Ontwikkelschakelaars

| Parameter | Doet |
| --- | --- |
| `?at=<lat>,<lon>` | forceert het startpunt — een gebied proberen waar je niet staat. De locatiepil zegt dan dat het geen echte fix is |
| `?sim` | bootst de wandeling na: loopt de route in 90 s af met wisselende GPS-nauwkeurigheid, zodat *onderweg* en *kindmodus* zonder GPS te bekijken zijn. `?sim=30` voor 30 s |
| `?sw` | zet de service worker óók op localhost aan (staat daar standaard uit, zie hieronder) |

```
http://localhost:5173/?at=52.247,6.755&sim=60#/instellen
```

De service worker is op localhost uitgeschakeld en ruimt zich daar zelfs actief
op. Hij serveert namelijk met voorkeur de gecachete versie — precies goed op je
telefoon, en precies verkeerd tijdens ontwikkelen, want dan bewerk je een
bestand en kijk je naar de vorige versie.

## Hoe het werkt

De kern is dat geen enkele routeplanner "een rondje van 4,5 km langs een
speeltuin en een bruggetje" kan. Ze doen rondjes óf via-punten, nooit beide. Dus:

1. **Punten uit de kaarttegels.** De POI's komen uit de vectortiles die de kaart
   toch al ophaalt, via `querySourceFeatures()`. Geen aparte databron, werkt
   overal, en offline zodra de tegels gecached zijn. Gemeten tegen Overpass:
   32 tegen 33 speeltuinen in dezelfde schijf.
2. **Spreiden en ordenen.** Per aangevinkte soort één punt, met de peilingen rond
   het startpunt verdeeld zodat het een lus wordt en geen heen-en-terug. Daarna
   dichtstbijzijnde-buur plus 2-opt.
3. **Routeren met BRouter**, profiel `hiking-beta`, als gesloten lus.
4. **Afstand itereren.** De lus is bij benadering een regelmatige k-hoek; de
   omwegfactor van echte paden wordt uit de eerste routercall geleerd, waarna de
   ringradius in één stap volgt. Doel: binnen ±15%.

Elke aangevinkte soort komt **gegarandeerd** in de route. Past dat niet binnen de
gevraagde afstand, dan laat de app liever een eis vieren dan te liegen over de
afstand: je krijgt kortere rondjes met een badge als "Zonder speeltuin", náást het
kortste rondje waarin alles zit.

Details en meetwaarden: [spike/BEVINDINGEN.md](spike/BEVINDINGEN.md).

## Layout

| Bestand | |
| --- | --- |
| [index.html](index.html) | shell: fonts, MapLibre, `#app` |
| [styles.css](styles.css) | tokens + één sectie per scherm |
| [app.js](app.js) | schermen, state, routing |
| [src/generator.js](src/generator.js) | de routegenerator |
| [src/pois.js](src/pois.js) | categorieën, de onzichtbare tegel-oogster, Overpass-aanvulling |
| [src/router.js](src/router.js) | BRouter, lus en heen-en-terug |
| [src/geo.js](src/geo.js) | afstand, peiling, tour-ordening |
| [src/map-style.js](src/map-style.js) | kaartstijl in het Boslamp-palet + oogst-stijl |
| [src/mapview.js](src/mapview.js) | één MapLibre-instantie die tussen schermen verhuist |
| [src/geolocate.js](src/geolocate.js) | positie, met duidelijke fout bij http |
| [src/tracking.js](src/tracking.js) | voortgang langs de route, volgend punt, aankomstdrempel |
| [src/compass.js](src/compass.js) | kompas voor de kindmodus, gedempt over de eenheidscirkel |
| [src/simulate.js](src/simulate.js) | wandeling nabootsen (`?sim`) |
| [spike/](spike) | testbanken en meetresultaten |
| [tools/serve.ps1](tools/serve.ps1) | dev-server (geen node of python op deze machine) |
| [design/](design) | het geïmporteerde designdocument, ongewijzigd |

## Schermen

Elk scherm heeft een hash-route, dus de terugknop werkt en je kunt er direct heen
linken.

| Route | Scherm | Data |
| --- | --- | --- |
| `#/welkom` | Onboarding | — |
| `#/home` | Start, met echte locatiestatus | echt |
| `#/instellen` | Afstand, vorm, wat er onderweg moet zijn | echt |
| `#/zoeken` | Zoeken, met echte voortgang | echt |
| `#/resultaten` | Gevonden rondjes | echt |
| `#/detail` | Route op de kaart + punten onderweg | echt |
| `#/onderweg` | Live wandeling: kaart, voortgang, volgend punt | echt |
| `#/kind` | Kindmodus: kompas, afstand, sticker | echt |
| `#/profiel` | Stickerboek | **nog demo** — wacht op opslag |

## Feature flags

`CONFIG` bovenaan [app.js](app.js):

- `geocachesAan` — **staat uit.** Beslissing 8 koos opencaching.nl, en dat vereist
  een consumer key die nog aangevraagd moet worden. Tot die er is blijft de kaart
  weg; een schakelaar die niets doet is erger dan geen schakelaar.
- `stickerBeloningen` — stickers in kindmodus en het stickerboek.

## Vastgelegde keuzes

Uit het ontwerpgesprek, voor wie zich afvraagt waarom iets zo is:

- Alleen voor één gezin. Geen accounts, geen backend, geen AVG-tak.
- Statische PWA op https. Zonder secure context is er geen GPS, geen compas en
  geen service worker — een LAN-adres over `http` werkt dus niet.
- Volwaardige vectorkaart met eigen donkere stijl, geen gestileerde lijn.
- Alles uit OSM. Vlakke labels geaccepteerd; slechts 26% van de punten heeft een
  naam, dus er staat vaak gewoon "Speeltuin".
- Beloning achter GPS-nabijheid met ruime drempel en een ontsnappingsluik.
- Één kind, vast profiel. Leeftijd bepaalt het looptempo.

## Onderweg en kindmodus

Tracking loopt over die twee schermen heen: heen en weer wisselen laat de
wandeling doorlopen. Drie dingen die niet uit het ontwerp af te lezen zijn:

- **Voortgang valt nooit terug.** De positie wordt op de routelijn geprojecteerd
  binnen een venster rond de vorige plek, niet globaal. Een globale zoektocht
  plakt je op de terugweg van een heen-en-terug meteen aan het eind, en één
  wilde fix onder de bomen zou je kilometers terugzetten.
- **Een punt telt ook als je er langs bént gelopen**, niet alleen als je er op
  een meetmoment dichtbij was. Onder een bladerdek vallen updates weg, en dan
  spring je zo over een punt heen.
- **De sticker-gate rekent de gerapporteerde nauwkeurigheid mee** (drempel 40–90 m)
  en kan het nooit onterecht tegenhouden: na een mislukte poging verschijnt er
  "toch gevonden" onder de knop.

## Nog te doen

- **Opslag**: profiel, bewaarde rondjes en stickerboek in IndexedDB, plus de
  JSON-exportknop. Het stickerboek toont nu nog vaste waarden.
- **Offline**: service worker, en de vectortiles van de gekozen route vóór
  vertrek in de Cache API.
- **Geocaches**: wacht op de opencaching.nl-key.
- Leaving kindmodus accepteert nu elke vier cijfers — het ontwerp legt geen code
  vast.
