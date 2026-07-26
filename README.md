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

**Testlocatie zonder GPS.** Hang `?at=<lat>,<lon>` aan de URL om een startpunt te
forceren — handig om te ontwikkelen en om een gebied te proberen waar je niet
staat. De locatiepil zegt dan dat het geen echte fix is.

```
http://localhost:5173/?at=52.247,6.755#/instellen
```

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
| `#/onderweg` | Live wandeling | **nog demo** |
| `#/kind` | Kindmodus | **nog demo** |
| `#/profiel` | Stickerboek | **nog demo** |

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

## Nog te doen

- **Live tracking** voor *onderweg* en *kindmodus*: `watchPosition`, voortgang
  langs de route, compasnaald, en de sticker achter GPS-nabijheid.
- **Opslag**: profiel, bewaarde rondjes en stickerboek in IndexedDB, plus de
  JSON-exportknop.
- **Offline**: service worker, en de vectortiles van de gekozen route vóór
  vertrek in de Cache API.
- **Geocaches**: wacht op de opencaching.nl-key.
- Leaving kindmodus accepteert nu elke vier cijfers — het ontwerp legt geen code
  vast.
