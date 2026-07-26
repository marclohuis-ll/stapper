# Meting 1 — is de vectortile-laag bruikbaar als POI-bron?

Dit was het enige onbeproefde fundament onder beslissing 6b. Meetopstelling:
[poi-probe.html](poi-probe.html), 49 tegels op z14 over een schijf van 3 km rond
52.247 / 6.755 (Landgoed Twickel), tiles van OpenFreeMap, features uitgelezen met
`querySourceFeatures()` en gededupliceerd over tegelgrenzen.

## Uitkomst: bruikbaar

2.947 unieke features in de schijf, waarvan 1.195 in de `poi`-laag.

| Laag | Features |
|---|---|
| `transportation` | 1.198 |
| `poi` | 1.195 |
| `waterway` | 268 |
| `water` | 171 |
| `landuse` | 115 |

**Uitdunning is geen probleem voor de categorieën die tellen.** Tegen Overpass
als grondwaarheid in exact dezelfde schijf:

| Categorie | Uit tiles | Overpass | Dekking |
|---|---|---|---|
| `playground` | 32 | 33 | 97% |
| `restaurant` | 5 | 5 | 100% |

Overpass viel tijdens deze sessie herhaaldelijk uit (504's op vier endpoints),
dus de overige categorieën konden niet tegen grondwaarheid worden gelegd. Dat
falen is zelf het argument voor 6b.

## Wat er wél in zit (3 km rond Twickel)

| Bruikbaar voor | Bron | Aantal |
|---|---|---|
| Speeltuin | `poi` subclass `playground` | 32 |
| Bruggetje over een pad | `transportation` brunnel `bridge`, class `path`/`track` | 29 |
| Water & sloten | `water` + `waterway` | 439 |
| Pauzeplek | `poi` `cafe` 4, `restaurant` 5, `fast_food` 16, `bakery` 2, `bar` 2 | 29 |
| Schuilhut | `poi` subclass `shelter` | 16 |
| Sportveld | `poi` class `pitch` (soccer 18, tennis 8, basketball 4, boules 4) | 44 |
| Wandelknooppunt / infobord | `poi` class `information` (`map` 19, `guidepost` 7) | 27 |
| Kunstwerk | `poi` subclass `artwork` | 7 |
| Park & tuin | `poi` `park` 3 + `garden` 6, plus de `park`-laag | 9 |

## Wat er níet in zit

Deze zijn afwezig in de tiles en hebben dus de Overpass-aanvulling nodig:

`picnic_table` (0 — terwijl NL er 27.464 heeft), `viewpoint` (0), `bench` (0),
`castle` (0 — kasteel Twickel zelf staat niet in de `poi`-laag), `windmill` (0),
`ford` (0 in dit gebied).

De ruis in de `poi`-laag is aanzienlijk en moet weggefilterd worden: `parking`
174, `gate` 167, `bollard` 146, `waste_basket` 101, `cycle_barrier` 40,
`lift_gate` 40.

## Twee dingen die het ontwerp raken

**Namen ontbreken meestal.** Slechts 307 van de 1.195 POI's heeft een naam — 26%.
Van de 32 speeltuinen hadden er twee een naam ("Speeltuin 't Lansink",
"Speeltuinvereniging De Jeugd"). De POI-lijst op het detailscherm zal dus
overwegend "Speeltuin" zonder meer tonen. Dat volgt uit de keuze bij vraag 7
(alles uit OSM, vlakke labels), maar het is scherper dan het toen klonk.

**BRouter-profiel: `hiking-beta`, niet `trekking`.** Gemeten op een gesloten lus
door drie echte speeltuincoördinaten:

| Profiel | Afstand | Tijd | Opmerking |
|---|---|---|---|
| `hiking-beta` | 9.391 m | 112 min | ≈ 5 km/u — een wandeltempo |
| `trekking` | 9.621 m | 27 min | ≈ 21 km/u — dit is een fietsprofiel |
| `shortest` | 9.186 m | 109 min | |

BRouter levert een gesloten lus met `track-length` en een polyline van ~400
punten. De drie willekeurig gekozen punten gaven 9,4 km terwijl het doel 4,5 km
was — precies waar de afstandsiteratie uit beslissing 6 voor is.

---

# Meting 2 — de generator afstemmen

Testbank: [generator.html](generator.html). Zelfde startpunt, doel 4,5 km, chips
speeltuin + bruggetje + pauzeplek. CORS werkt vanuit de browser voor zowel
BRouter als Overpass, dus er is geen proxy en dus geen backend nodig.

## Vier fouten die de meting blootlegde

**De schaalregel uit meting 1 was gemeten op een ontaard geval.** Die drie
speeltuinen lagen alle drie noordoostelijk, dus `lus ≈ 5,9 × ringradius` beschreef
een heen-en-terug, geen rondje. Voor gespreide punten is de lus bij benadering een
regelmatige k-hoek: `2·k·r·sin(π/k)`, maal een omwegfactor voor het echte pad. Die
factor gokken we niet meer maar leren we uit de eerste routercall, waarna de
ringradius in één stap volgt. Afwijking ging van 39% naar 8,5%.

**`map.once('idle')` is niet te vertrouwen na een `jumpTo`.** Het event vuurt soms
vóórdat MapLibre de nieuwe tegels heeft aangevraagd, en dan query je een lege
cache: **4 punten in plaats van 29**. Opgelost met een minimale wachttijd plus
twee opeenvolgende bevestigingen van `areTilesLoaded()`.

**Sectorrotatie moet een breuk van de sectorbreedte zijn, niet van 360°.** Bij
drie stops zijn de sectoren zelf 120°, dus roteren met `360/count` = 120° gaf
exact dezelfde indeling en dus dezelfde route — drie kandidaten werden er één.

**Categoriedekking moet een hárde eis zijn.** Als zachte score van 0,5 verloor hij
consequent van de radiale afstand: bij 19 bruggetjes tegen 4 speeltuinen leverde
een verzoek om speeltuin + bruggetje + pauzeplek een route op met **twee
bruggetjes**. En "een stop laten vallen" om een te lange lus te korten gooit een
hele aangevinkte categorie weg. Beide gerepareerd: één punt per aangevinkte soort,
gegarandeerd.

## Wat het gebied zelf oplegt

De POI's rond Twickel liggen niet gespreid: 10 van de 29 in het octant noord,
**nul in het zuidwesten**. Met een harde eis van speeltuin én bruggetje én
pauzeplek is een rondje van 4,5 km daar niet mogelijk — het kortste met alles
erin is **9,0 km**. Dat is geen tekortkoming van de generator maar een feit over
het gebied.

Daarom laat de generator liever de *eisen* vieren dan de afstand, en zegt dat:

| Kaartje | Afstand | Afwijking |
|---|---|---|
| Zonder speeltuin | 5,4 km | 19% |
| Zonder speeltuin | 6,1 km | 36% |
| Alles erbij | 9,0 km | 100% |

Welke eis eruit gaat kiest de generator niet zelf. De rekenkundig verdedigbare
keuze (de soort waarvan het naaste exemplaar het verst weg ligt) gooide hier de
*speeltuin* uit een kinder-wandelapp. Dus bieden we de twee kansrijkste
weglatingen aan náást de volledige route, met een badge die zegt wat je inlevert.

## Prestaties

1,6 s voor drie routes: één tegel-oogst plus zeven BRouter-calls. Dat past binnen
het laadscherm van 1,7 s dat in het ontwerp al stond.

---

# Meting 3 — kaartstijl, en een valkuil die de POI-bron sloopt

## `querySourceFeatures()` hangt aan de stíjl, niet aan de tegels

De donkere stijl tekent de `poi`-laag bewust niet: op een wandeling wil je paden
en water zien, geen winkelcategorieën. Gevolg: **de oogster vond nul punten**,
terwijl exact dezelfde tegels er 29 in hebben.

MapLibre laat de tile-worker alleen de source-layers parseren waar een stijllaag
naar verwijst. Wat de stijl niet gebruikt, bestaat niet voor `querySourceFeatures()`.

Dat is een stille valkuil: de kaart ziet er perfect uit en de generator zegt
"geen punten gevonden". Dichtgezet door de oogster zijn **eigen** stijl te geven
(`harvestStyle()`) met precies de lagen die we uitvragen, en `createHarvester()`
neemt geen stijl meer als argument — zo kan niemand er per ongeluk een stijl in
duwen die de oogst stilzwijgend leegmaakt.

## Kaartstijl

Geverifieerd tegen OpenFreeMap: de glyphs staan op
`https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` en de drie
fontnamen die de stijl gebruikt (`Noto Sans Regular/Bold/Italic`) geven alle drie
200. De TileJSON op `/planet` werkt zonder key.

De stijl is kaal gehouden: bos, gras, water, waterlopen, gebouwen, wegen gedempt,
en paden mét casing zodat ze boven donker bos leesbaar blijven. Attributie voor
OpenFreeMap en OpenStreetMap zit in de source.

## Heen & terug

De `Rondje / Heen & terug`-schakelaar uit het ontwerp is nu echt. Niet door
BRouter start → punten → start te laten routeren — dan zoekt hij een ándere
terugweg en krijg je alsnog een rondje. In plaats daarvan de enkele reis routeren
en de geometrie spiegelen. Punten worden dan uit één windstreek van 70° gekozen
in plaats van rond het startpunt gespreid.

Gemeten op doel 4,5 km: 4,8 km zonder speeltuin (7% afwijking) en 6,8 km met
alles erin.

---

# Meting 4 — live tracking

Niet te testen achter een bureau, dus met [simulate.js](../src/simulate.js): de
route in 25 tot 120 seconden aflopen met een nauwkeurigheid die tussen 8 en 35 m
heen en weer beweegt, zoals onder een bladerdek.

## Twee fouten die de simulatie blootlegde

**Een punt telt niet als je er alleen langs *gemeten* bent.** In de simulatie
liggen de meetmomenten 360 m uit elkaar; de wandelaar liep het bruggetje voorbij
zonder ooit binnen de drempel van 40 m te vallen, en "volgende punt" bleef op
het bruggetje staan terwijl de afstand groeide.

Dat is geen simulatie-artefact: onder een bladerdek vallen echte GPS-updates ook
weg. Opgelost door óók te kijken of je voortgang langs de lijn het punt is
gepasseerd — mits dat punt binnen 60 m van de lijn ligt, want een punt dat 200 m
naast de route staat heb je niet gezien door er langs te lopen.

**De service worker serveerde een half uur lang oude code.** De app draaide op
demo-constanten die ik al verwijderd had, met "320 m" en "42%" als
verklikkers. Stale-while-revalidate is precies goed op de telefoon en precies
verkeerd tijdens ontwikkelen. Bovendien houdt een pagina zijn controller ook na
`unregister()`, dus de oude worker bleef de oude `app.js` leveren, die zichzelf
opnieuw registreerde. Nu: op localhost registreert hij niet en ruimt hij zich
actief op, tenzij je `?sw` meegeeft.

## Wat verder bleek

De naald en zijn zweefanimatie kunnen niet in hetzelfde element: `animation` en
`transform` vechten om dezelfde eigenschap en de animatie wint altijd. Dat was
in het designdocument ook al zo — daar verdween de bedoelde rotatie van 26°
stilzwijgend. Nu twee lagen: de buitenste draait naar het doel, de binnenste
zweeft.

Magnetometerwaarden moeten gedempt worden over de eenheidscirkel, niet over
graden: een gewoon gemiddelde springt bij de overgang van 359° naar 0° naar het
zuiden.

---

# Meting 5 — "de routes lopen over grote wegen"

Klacht uit echt gebruik. Terecht: BRouter geeft per segment `WayTags` mee, en
daaruit blijkt dat de route die de app maakte rond Twickel voor **39% over wegen**
liep — `unclassified` 17,9%, `residential` 16,1%. Dat zijn precies de
asfaltweggetjes die als grote weg aanvoelen als je met een kind loopt.

## Vier dingen geprobeerd, drie werkten niet

**Ander standaardprofiel.** `hiking-mountain` 54,0% pad tegen `hiking-beta` 53,4%.
`trekking` en `gravel` zijn fietsprofielen (30%). `shortest` 48,7%. Geen winst.

**Ingebouwde profielparameters.** `hiking-mountain` heeft `consider_town`,
`consider_forest` en `hiking_routes_preference`. De publieke server negeert ze in
de URL, dus het profiel aangepast en geüpload (`POST /brouter/profile` werkt en
geeft een `custom_…`-id terug). Resultaat: **49,7% — slechter.** `consider_town`
mijdt de bebouwing door over landweggetjes te gaan; `unclassified` ging van 19%
naar 28,5%.

**Wegkosten in het profiel verzwaren.** In `hiking-mountain.brf` kost
`unclassified` maar 1,1–1,5 en `residential` 1,0–1,1 — vrijwel hetzelfde als een
pad. Opgeschroefd naar 4,5 en 3,5, plus `tertiary` 7 en `secondary` 12. Resultaat:
**54,9%.** Met alleen `cycleway` en `service` verzwaard was het 56,6%; met alles
verzwaard schoof hij van de ene wegsoort naar de andere.

**Alternatieve routes nabellen.** BRouter's `alternativeidx` 1–3 over dezelfde
punten geeft 17,8% tot 53,4% — grote spreiding, maar alt 0 was al de beste. Als
extra stap ingebouwd en weer verwijderd: 3,8 s in plaats van 1,6 s voor precies
nul verbetering.

## Wat de oorzaak wél is

Een lus door drie bruggetjes-die-op-een-pad-liggen gaf **40,4%** pad — slechter
dan de caféroute. De punten zijn dus niet het probleem: het padennetwerk rond
Twickel hangt niet aan elkaar, dus tussen twee bospaadjes moet je over een
landweg. Rond 40–55% is daar het plafond, niet een instelling die verkeerd staat.

## Wat er dan gedaan is

Het pad-aandeel wordt nu **gemeten en getoond** — als tag op elk resultaatkaartje
("41% paadjes", oranje onder 40%, lime boven 65%) en op het detailscherm als
verdeling in gewone woorden: *"Onderweg: 34% bospad, 30% landweg, 24% fietspad."*

En het weegt mee in de keuze: onder kandidaten die allebei binnen de
afstandsmarge vallen wint die met meer pad. Afstand blijft voorgaan — een rondje
van 9 km is geen antwoord op 4,5 km, hoe mooi het pad ook is.

Dat lost het landschap niet op, maar het maakt zichtbaar wat je krijgt vóórdat je
in de auto stapt. In dit gebied blijkt de eerlijke uitkomst 41%; ergens met een
dichter padennetwerk zal datzelfde getal veel hoger uitvallen.

---

## Doorloop, gemeten

Route van 9,0 km in 25 s gesimuleerd: 0,5 → 3,0 → 5,0 km, balk 6% → 34% → 56%,
ETA loopt af, punten worden onderweg afgevinkt en "volgende punt" schuift door
van bruggetje naar speeltuin naar pauzeplek. De sticker-gate weigert op 2.137 m
met "nog 2137 meter!", biedt daarna het ontsnappingsluik, en reikt bij forceren
de sticker van de juiste soort uit.
