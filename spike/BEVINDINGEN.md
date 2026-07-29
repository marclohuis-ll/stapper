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

# Meting 6 — "het zijn vaak geen rondjes"

Ook terecht, en ook te kwantificeren: welk deel van de route loop je twee keer?
Voor elk punt kijken of er een ander punt bestaat dat ver weg is lángs de route
maar dichtbij in de ruimte.

Gemeten op de drie routes die de app maakte: **10%, 27% en 34% dubbel gelopen.**

De oorzaak stond in de peilingen van de 9 km-route: **169°, 16° en 355°** — twee
van de drie punten liggen 21° van elkaar. De harde categorie-eis overrulede de
spreiding: is er van een soort alleen aan één kant iets te vinden, dan koos de
selectie dat punt ongeacht waar de andere lagen.

Opgelost met een clusterstraf: een punt dat binnen tweederde van de sectorbreedte
van een al gekozen punt ligt, wordt afgestraft. De 9 km-route ging daarmee van 34%
naar 25%, en de gekozen 5,4 km is nu 11% — een echt rondje.

## De afweging die niet op te lossen is

Onder de kandidaten kwam deze langs: **7,73 km, 76% paadjes, 62% dubbel gelopen.**
Naast: **5,36 km, 41% paadjes, 11% dubbel.**

Dat is geen bug maar de aard van het gebied: de mooie paadjes zijn heen-en-terug
het bos in, en een rondje sluiten vereist een landweg. Beide wensen kunnen hier
niet tegelijk.

Daarom laat de app niet drie bijna gelijke rondjes zien maar spreidt hij de keuze
over de afweging — de beste op de rangschikking, de meest paadjesrijke, en het
rondste — en zet beide getallen op het kaartje. Rondje-zijn weegt zwaarder dan
pad-aandeel bij het rangschikken, want een derde dubbel lopen valt meer op dan
een paar procent minder bospad.

---

# Meting 8 — een route zonder eisen

De chips werden een wens in plaats van een voorwaarde. Zonder eisen zijn er geen
verplichte punten meer, dus waar anker je dan op?

Drie ankerbronnen gemeten, allemaal rond Twickel op dezelfde doelafstand:

| Ankers op | pad-aandeel | dubbel gelopen |
|---|---|---|
| POI's zonder soort-eis | 41% | 11–25% |
| Verzonnen punten op een ring | 22–38% | 69–89% |
| **Het padennetwerk** | **44–69%** | **6–37%** |

**Punten op een ring werken niet.** De afstand klopte prima (4,5 km op een doel van
4,5), maar 69 tot 89% dubbel gelopen: ringpunten landen op dezelfde weg-uitlopers,
dus de router pendelt er heen en weer naartoe. Meer ringpunten hielpen niet.

**POI-ankers werken half.** Ze liggen aan het netwerk, dus de vorm is redelijk,
maar ze liggen bij een parkeerplaats of in een dorp — en daar moet de router via
wegen naartoe.

**Padankers werken.** Punten uit de `transportation`-laag met klasse `path` of
`track`, fietspaden eruit gefilterd. Een handmatig gekozen set van vijf op 700 m
gaf **69% pad en 6% dubbel** bij 5,97 km. Door de generator gekozen uit 90 echte
padpunten: 44 tot 68% pad, 22 tot 37% dubbel, afstanden 6 tot 15% van het doel.

Ringankers blijven alleen het vangnet voor als er helemaal niets te ankeren valt.

## Drie fouten onderweg

**Het aantal hoekpunten mocht niet meebewegen met de ringradius.** Ik liet het
groeien met `r`, en dan convergeert de afstandsiteratie niet: elke ronde
veranderde het aantal hoekpunten, dus liep hij alle zes de rondes uit. Uitkomst
7,5 km op een doel van 4,5. Vast aantal uit de doelafstand: 5,1 km.

**Zes pogingen waren slechter dan drie.** Zonder eisen verschillen de pogingen
alleen in sectorhoek, en de straf op al gebruikte punten duwt latere pogingen naar
punten verder weg. Zes pogingen gaven 7,5 km waar twee op 5,1 km uitkwamen — en
het kostte 14 seconden in plaats van vijf.

**`metaFor` crashte op een anker.** Die doet `categoryByKey(p.category).label`, en
een ringanker heeft geen soort. De crash kwam ná al het routeerwerk, dus je zag
veertig seconden lang niets en daarna "het zoeken lukte niet".

## Wat ik niet heb kunnen verifiëren

De oogst zelf. Het Browser-paneel stond verborgen, en dan komen er geen frames:
MapLibre bereikt `idle` alleen als hij tekent, dus elke oogst liep in zijn timeout
en gaf nul punten. De generator is daarom getest met een stub-oogster en echte
BRouter-calls — dat dekt de afstandsconvergentie, de annotatie en de labels, maar
niet de vorm van routes op écht geoogste punten.

Bijkomend nut: `createHarvester` wachtte op `once(map, 'idle')` **zonder timeout**.
Dat hing dus oneindig zonder foutmelding. Nu 15 seconden, waarna je een magere
oogst krijgt in plaats van een app die blijft draaien.

---

# Meting 7 — "ik mis de granulariteit die OSM standaard wel heeft"

De data ontbrak niet. Geteld in de tegels rond Twickel, klasse `path`:

| zoom | features klasse `path` | totaal `transportation` |
|---|---|---|
| 12 | 580 | 3.483 |
| 13 | 1.434 | 7.518 |
| 14 | 319 | 1.053 |

De paden zaten er dus in, en mijn stijl tekende ze ook. Alleen: **0,8 px lime op
z12, bovenop een 2,4 px dónkere casing.** Die casing was breder dan de lijn zelf,
dus hij maakte het pad juist onzichtbaar tegen de donkere achtergrond in plaats
van het los te tillen.

## En een fout die niemand ziet maar die wel misleidt

In het OpenMapTiles-schema valt **`cycleway` onder klasse `path`** — het is er
zelfs de grootste subklasse van: 702 van de 1.434 op z13. Mijn stijl tekende dus
fietspaden als bospaadje, en het pad-aandeel uit meting 5 telde ze mee als "pad".

Nu drie soorten apart, want `line-dasharray` kan niet data-gestuurd:

- **voetpad** (`path` zonder subklasse `cycleway`) — lime, kort gestippeld
- **zandpad** (`track`) — olijf, lang gestippeld
- **fietspad** (subklasse `cycleway`) — koel teal, doorlopend

Breedtes van 1,8 naar 5 px in plaats van 0,8 naar 3,4, en de casing eronder.

## Gevolg voor de routelijn

Met een kaart vol lime streepjes kan de lime routelijn wegvallen. Die is daarom
6,5 px doorlopend met een donkere baan van 13 px eronder: het onderscheid zit nu
in breedte en in wel/niet onderbroken, niet in kleur.

## Wat er op de kaart mag

De `poi`-laag ongefilterd tekenen maakt de kaart onleesbaar: in een schijf van 3 km
zitten 174 parkeerplaatsen, 167 hekken, 146 bollards en 101 afvalbakken. Dus een
witte lijst van 24 klassen die je onderweg wél wil zien, in mint zodat ze niet met
de lime routelijn verwarren.

---

## Doorloop, gemeten

Route van 9,0 km in 25 s gesimuleerd: 0,5 → 3,0 → 5,0 km, balk 6% → 34% → 56%,
ETA loopt af, punten worden onderweg afgevinkt en "volgende punt" schuift door
van bruggetje naar speeltuin naar pauzeplek. De sticker-gate weigert op 2.137 m
met "nog 2137 meter!", biedt daarna het ontsnappingsluik, en reikt bij forceren
de sticker van de juiste soort uit.

---

# 9. Route slepen — wat je duim beloofd krijgt

`node spike/edit-probe.mjs` rekent de hele laag onder het slepen door tegen de
echte BRouter: 40 controles, geen browser nodig. Dat het kan is het bewijs dat de
scheiding klopt — `src/edit.js` kent geen kaart en geen DOM, alleen coördinaten.

## Het getal bij je duim is niet te halen uit de elastiek

Tijdens het slepen tekenen we rechte lijnen naar je vinger, want een netwerkcall
per frame is niet te doen. Maar de lengte van die rechte lijnen is *korter* dan
het pad dat ze vervangen: gemeten 3,60 km elastiek waar de echte route 3,93 km
werd. Een label dat "korter" zegt terwijl je route langer wordt is erger dan geen
label.

Dus: van de huidige afstand het vervangen stuk aftrekken en de nieuwe omweg
erbij met een omwegfactor, geijkt op de vorige echte routering.

## Welke opslagfactor?

Twee keer twaalf sleepbewegingen (3 segmenten × 2 richtingen × 200/350/600/900 m),
schatting tegen echte routering:

| opslag | gemiddeld | slechtste te laag | slechtste te hoog | binnen ±15% |
|--------|-----------|-------------------|-------------------|-------------|
| 1,00   | +1%       | −16%              | +16%              | 11/12       |
| 1,05   | +2%       | −6%               | +19%              | 11/12       |
| 1,10   | +4%       | −5%               | +22%              | 11/12       |
| 1,15   | +6%       | −3%               | +25%              | 11/12       |
| 1,20   | +8%       | −2%               | +28%              | 10/12       |

Het is **1,1** geworden, en niet 1,0 dat de kleinste spreiding heeft. De fouten
moeten namelijk de goede kant op vallen: 5,6 km lopen waar 5,9 km stond is een
opluchting, 6,4 km lopen waar 5,9 km stond is met een kind van zes het einde van
de wandeling.

De spreiding is niet weg te poetsen, en dat is geen slordigheid maar de zaak zelf:
sleep je naar links dan ligt daar een pad en klopt de rechte lijn bijna, sleep je
naar rechts dan moet de router 400 m om. Daarom staat er een **≈** bij, en
waarschuwt de app pas dat de route te lang wordt als de echte routering binnen is.

## Wat de meting nog opleverde

- Een vormpunt weer weghalen geeft de oude route **exact** terug (0 m verschil).
  Het model is dus omkeerbaar; ongedaan maken hoeft niets te reconstrueren.
- Het gesleepte punt landt 10 m van de nieuwe lijn — BRouter snapt het naar het
  dichtstbijzijnde pad. Dat is precies de bedoeling: je sleept een wens, niet een
  coördinaat.
- Een heen-en-terug moet gespiegeld blijven bij het herrouteren (overlap 0,86).
  Zou je `start → punten → start` laten routeren, dan maakt BRouter er stilletjes
  een rondje van en verandert het slepen ongevraagd het soort route.
- 22 px raakt, 23 px niet: de raakcirkel is de helft van een duimdoel van 44 px.

## Het gebaar zelf, zonder kaart

`edit-map.js` praat met MapLibre via een handjevol methodes — `project`,
`unproject`, `getSource`, `dragPan` — en met je vinger via pointer-events. Beide
zijn na te maken. `spike/gebaar-probe.js` doet dat: een nepkaart met een lineaire
projectie, en pointer-events die met de hand afgevuurd worden. 33 controles, geen
WebGL, geen tegels, geen frame getekend. Alle 33 goed.

Openen in de app en in de console:

```js
(await import('/spike/gebaar-probe.js')).run()
```

Wat het bewijst, in de volgorde waarin het misging toen ik het schreef:

- Naast de lijn tikken laat de kaart met rust; op de lijn tikken zet `dragPan`
  uit en na het lossen weer aan. Ook als het herrouteren mislukt — dat staat vóór
  alles wat mis kan gaan, want een kaart die niet meer schuift is niet te
  herstellen zonder het scherm te verlaten.
- Aanraken geeft nog géén elastiek en géén duimlabel. Dat kan namelijk net zo goed
  een tik zijn om een punt weg te halen, en één frame elastiek is dan een
  schrikbeeld. Vanaf 8 px is het een sleep.
- Het duimlabel staat gecentreerd 26 px boven de vinger (gemeten: midden op 268
  waar de vinger op 268 zat, onderkant op 422 waar de vinger op 448 zat).
- Eén sleep blijft één stap terug, ook als hij onderweg al vastgesnapt heeft.
- Een vormpunt weer weghalen brengt de afstand exact terug op 3,77 km.
- Na `destroy()` zijn alle acht lagen weg, is het duimlabel weg, en luistert er
  niets meer.

En een schatting die de andere kant op viel dan de tabel hierboven suggereert:
het duimlabel zei `≈ 5,1 km`, de echte route werd 5,51 km — 7% te laag. Precies
waarom er een `≈` bij staat.

## Wat hier níet mee getest is

Of het lekker aanvoelt. Of 250 ms stilstaan het juiste moment is om vast te
snappen, of 22 px raakafstand op een echte duim klopt, en of de knoppen onderin
niet in de weg zitten — dat vraagt een vinger op een telefoon.

---

# 10. Geocaches: waarom het uiteindelijk een bestand werd

Eerst is dit met OKAPI (opencaching.nl) gebouwd en nagerekend tegen de publieke
apiref. Die meting was niet voor niets — ze wees uit dat de code klopte — maar de
uitkomst was alsnog: **de bron is verkeerd.** De dekking in Nederland zit vrijwel
helemaal op geocaching.com, en opencaching.nl is te dun om een wandeling op te
bouwen.

## Wat er achter c:geo zit, en waarom dat geen optie is

c:geo gebruikt voor geocaching.com **geen API**. Het logt in met de inloggegevens
van de gebruiker en leest de website uit. Hun eigen argumenten daarvoor, uit
discussie #9814:

- via de officiële API krijgt een basic member **3 volledige caches per dag**,
  premium 16.000; op de website is er geen limiet
- 60 calls per minuut, en één call van 50 listings duurt ~13 seconden
- de licentie eist dat de client-credentials alleen bij "de partner" zichtbaar
  blijven, wat niet kan in een open-sourceproject

Voor Stapper valt die route dubbel af. De officiële API is partner-gated (aanvragen,
review van je app) én OAuth met een geheim — en een static PWA op GitHub Pages heeft
geen plek om een geheim te bewaren; iedereen die de repo opent leest het mee. En de
c:geo-route zelf vraagt om iemands wachtwoord, wat hier niet gebeurt.

| bron | verdict |
| --- | --- |
| officiële Groundspeak API | partner-gated + geheim niet te verbergen in een static PWA |
| site uitlezen met eigen login | tegen de voorwaarden, en vraagt om een wachtwoord |
| OKAPI (opencaching.nl) | werkt, maar te dunne dekking |
| **GPX-export uit c:geo** | **data waar je zelf legitiem bij mag** |

## Waarom een bestand niet de zwakke keuze is

Het voelt als een omweg, maar het is op drie punten beter dan een API:

- **werkt offline** — de caches staan in IndexedDB voordat je de deur uitgaat, en in
  het bos is er toch geen bereik
- **geen sleutel, geen aanvraag** — niets om te configureren of te laten verlopen
- **het is jóuw selectie** — je kiest in c:geo welke caches leuk zijn voor een kind
  van zes, in plaats van "alles binnen drie kilometer"

De prijs is dat je opnieuw exporteert als je in een ander gebied gaat wandelen.

## Wat de GPX-lezer moet weerstaan

38 controles (`spike/gpx-probe.js`) tegen vier bestandsvormen. Wat daarbij bleek:

- **Naamruimte-URI's verschillen.** Een pocket query gebruikt
  `groundspeak/cache/1/0/1`, c:geo `groundspeak/cache/1/0`. Zoeken op URI mist dan de
  helft. Alles gaat daarom op `localName` — een cache missen omdat de URI één cijfer
  anders is, is een cache die je niet gaat vinden.
- **Hulppunten zien eruit als caches.** Parkeerplaatsen en stages zijn ook `<wpt>`,
  maar zonder cacheblok en met een type dat met `Waypoint` begint. Zonder filter
  stuur je een kind naar een parkeerplaats.
- **Komma als decimaalteken** komt voor in `terrain` (`1,5`). Zonder omzetting wordt
  dat `NaN` en valt de terreinfilter stil om.
- **`lat="0" lon="0"`** komt voor bij caches zonder coördinaten. Dat is een punt in de
  Golf van Guinee, niet een ontbrekende waarde, en moet dus expliciet weg.

## De filters zijn een inhoudelijke keuze, niet techniek

Niet alles wat een cache is, is een bestemming voor een wandeling met een kind:

- **Puzzelcaches** (`Unknown Cache`, `Quiz`, Wherigo) hebben met opzet verkeerde
  gepubliceerde coördinaten. Dit is de belangrijkste: stil meenemen betekent dat een
  kind van zes naar een plek loopt waar níets ligt, en dat is het einde van de
  wandeling.
- **Virtual, webcam, earthcache**: echte plekken, maar er is geen doosje. "Zoek een
  doosje" wordt dan een leugen.
- **Evenementen**: een moment, geen plek.
- **Terrein 5** betekent per definitie speciale uitrusting — een boot, klimspullen.
- **Multicaches gaan er wél in.** De gepubliceerde plek is het eerste station, en dat
  is een echt punt om naartoe te lopen. Dat staat er ook bij in de puntenlijst, zodat
  je niet denkt dat het doosje daar ligt.

Alles wat wegvalt wordt **geteld en gemeld** na het inladen, inclusief onbekende
soorten. Een nieuwe cachesoort van Groundspeak valt dan op in plaats van stil te
verdwijnen.

## Waarom deze probe in de browser draait

XML parseren doe je niet zelf. GPX zit vol naamruimtes, CDATA en entiteiten, en een
handgemaakte lezer die daar negen van de tien keer goed doorheen komt, verliest
precies die ene cache die je wilde. `DOMParser` is er al en doet het wél goed — dus
draait de probe waar DOMParser is, net als die van het sleepgebaar.

## Wat nog niet getest is

Een échte export uit c:geo. Welke velden er precies in zitten, welke
naamruimteversie, of hulppunten meekomen — dat blijkt bij het eerste echte bestand.
Loopt daar iets mis, dan zégt de app wat hij overslaat en waarom, dus het is te zien
in plaats van te raden.

---

# 11. Installeerbaar als PWA

Manifest, iconen en service worker waren al goed, en de live site serveert ze met de
juiste `Content-Type` (`application/manifest+json`, `image/png`). De app was dus
altijd al installeerbaar. Wat ontbrak was dat ze het nergens **aanbood**: je moest
het in het browsermenu vinden.

Nagemeten in de browser (13 controles) met een nagemaakt `beforeinstallprompt`:
de kaart verschijnt, `preventDefault()` houdt Chrome's eigen balkje tegen, `prompt()`
wordt precies één keer geroepen, en de kaart verdwijnt daarna — want het event is
eenmalig, geaccepteerd of niet.

Drie dingen die je pas ziet als je het uitprobeert:

- **`beforeinstallprompt` is eenmalig.** Na `prompt()` is het op. De regel bij de
  instellingen valt daarom terug op "via het menu van je browser", en dat is geen
  smoesje maar de waarheid.
- **Chrome vuurt het niet altijd meteen.** Hij wil eerst wat gebruikersinteractie
  zien. Een app die dan zegt "installeren kan niet" liegt, terwijl het via het menu
  wél gaat. Vandaar dat er altijd een uitleg staat.
- **`display-mode: standalone` is de enige betrouwbare "al geïnstalleerd"-test.**
  `navigator.standalone` bestaat alleen op iOS.

Verder: `id` is `"./"` en niet `/stapper/` — dat laatste hardcodeert het pad en is
op localhost meteen fout. Relatief lost het op tegen de manifest-URL en klopt het
op beide plekken. En de 192-maskable is erbij gekomen: Android kiest per
beeldpuntdichtheid en schaalt 512 → 192 zichtbaar zachter dan een icoon dat op maat
getekend is.

---

# 12. Navigatie: van negen losse schermen naar één app

Negen schermen en geen menu. Je kwam ergens via een knop en vond de weg niet terug —
"een set losse pagina's zonder samenhang", en dat was het ook.

## Welke schermen bestemmingen zijn, en welke stappen

Niet alles verdient een tab. De scheiding die werkt:

| | |
| --- | --- |
| **bestemmingen** (tabbalk) | Lopen, Rondjes, Boek, Profiel |
| **stappen** (geen tabbalk, eigen knop onderin) | instellen, startpunt, zoeken, resultaten, detail, bewerken, onderweg, kindmodus |

De stappen zijn een handeling met een begin en een eind; een tabbalk eronder zou
uitnodigen om er middenin weg te lopen. En de kindmodus mág hem niet hebben: die zit
achter een oudercode.

Het oude `profiel` was stickerboek én instellingen in één. Dat is nu **Boek** (van
het kind: stickers, foto's, waar jullie liepen) en **Profiel** (van jou: wie er
loopt, instellingen, versie). Bewaarde rondjes stonden verspreid over het
beginscherm én het stickerboek — je kon ze dus op twee plekken tegenkomen en op geen
van beide verwachten. Nu staan ze in **Rondjes**.

## De stip in plaats van een pil

De actieve tab is geen gevulde pil achter een icoon. Onderaan de balk loopt het
gestippelde lime paadje van de kaart, met de "hier ben ik"-stip erop: donkere baan,
lime streepjes, gevulde stip met ring en gloed — dezelfde opbouw als in
`src/map-style.js` en `src/mapview.js`.

Dat is geen versiering maar dezelfde gedachte die al in de app zat: achter de
routelijsten staat `.trail`, precies dat paadje verticaal. De app gaat over waar je
bent op een route, dus tekent hij zijn navigatie in de taal van zijn inhoud.

Het verschil actief/niet zit in drie dingen tegelijk — kleur, gevuld tegen omlijnd
icoon (`font-variation-settings: 'FILL'`), en de stip — zodat het ook leest als je
kleuren slecht ziet.

## Drie dingen die de meting rechtzette

1. **De balk moet buiten de schermen staan.** `render()` vervangt de hele inhoud van
   `#schermen`. Zat de balk daarin, dan werd hij bij elke hertekening opnieuw
   gemaakt en kon de stip niet schuiven — en juist dat schuiven maakt losse pagina's
   tot één app. Vandaar `#app > #schermen + #tabs` in de HTML.
2. **De stip zat tot 7 px naast het midden.** Gemeten per tab: +7, +2, −2, −7. Het
   paadje was 14 px ingesprongen, dus `--hier` als percentage viel op een smallere
   doos dan de rij tabs — naar de randen toe loopt dat op. De doos is nu even breed
   als de tabs, alleen de streepjes springen in. Daarna: 0, 0, 0, 0.
3. **Een bewaard rondje liep dood.** Dat open je nu uit *Rondjes*, maar de terugknop
   op het detailscherm ging altijd naar de zoekresultaten — die dan leeg zijn. Het
   detailscherm onthoudt waar je vandaan kwam.

Verder: negen stickersoorten op vier kolommen liet er één alleen op een regel
achter. Drie kolommen vult 3×3 precies vol, en de stickers worden er groter van.

---

# 13. Bijwerken: een knop die niet kon bestaan

Een PWA werkt zichzelf stil bij, en dat is het probleem: je duwt iets, opent de app
op je telefoon, en ziet de oude versie omdat de service worker je uit de cache
bedient. Er was geen moment waarop de app kon zeggen dat er iets nieuws was.

## Waarom `skipWaiting()` in de weg zat

In de installatie stond `self.skipWaiting()`. Daarmee neemt een nieuwe service worker
het meteen over — terwijl de geopende pagina nog de óude `app.js` draait. Resultaat:
nieuwe cache, oud scherm, en geen enkele toestand waaraan je een knop kon hangen.

Nu wacht hij, en gaat pas door op `SKIP_WAITING` uit de app. Dan is er wél een
toestand: *er staat een nieuwe versie klaar*. Behalve bij de éérste installatie —
daar is niets om te onderbreken, dus `if (!self.registration.active) skipWaiting()`.

Het versienummer komt uit de service worker zelf, over een `MessageChannel`. Eén
bron in plaats van een string die in twee bestanden uiteenloopt.

## Vier dingen die pas bij het uitproberen bleken

1. **Een wachtende worker is niet altijd een update.** Bij de eerste installatie is
   er nog geen controller; die worker activeert zichzelf. Zonder dat onderscheid zei
   de app "nieuwe versie klaar" tegen iemand die de app net voor het eerst opende, en
   bleef die melding staan nadat hij al geactiveerd was. Vandaar
   `reg.waiting && navigator.serviceWorker.controller`.
2. **De draaiende versie kan de vraag niet altijd beantwoorden.** Een versie van
   vóór deze wijziging kent het bericht niet en zwijgt. Dat mocht geen
   "ontwikkelversie" heten — dat is onwaar, het is een óude versie, en dat is precies
   waarom je op dat scherm staat. Bij een wachtende update wordt het nummer daarom
   aan de wáchtende worker gevraagd, en is de kop "stapper-v7 staat klaar".
3. **Bij de eerste start is hij te druk om te antwoorden.** Hij haalt 25 bestanden
   op; met een tijdslimiet van 1,5 s bleef het versienummer leeg. Nu 5 s, plus één
   herkansing na 2,5 s.
4. **`controllerchange` vuurt ook bij de eerste installatie.** Daarop ongevraagd
   herladen is een sprong in het niets, dus herlaadt de app alleen als hij zelf om de
   wissel heeft gevraagd. Met een vangnet van 4 s, want een knop die op "bijwerken"
   blijft hangen is erger dan een herstart die niets verandert.

## Wat de devserver hier niet kan

`registration.update()` mislukt op `tools/serve.ps1` met *"Failed to update a
ServiceWorker … Not found"*: die TcpListener struikelt over het verzoek waarmee de
browser `sw.js` opnieuw ophaalt. De live site serveert `sw.js` correct
(`application/javascript`, 200), dus de bijwerkstroom is daar getest en niet lokaal.

Nog iets om te weten: **deze ene update landt nog op de oude manier.** De service
worker die nu op je telefoon staat heeft `skipWaiting()` en neemt het dus meteen
over. Vanaf de volgénde versie krijg je de knop.

---

# 14. Wat een echte wandeling blootlegde

De app is voor het eerst met een kind buiten gelopen. Vier dingen, en geen ervan was
uit code te voorspellen.

## De kaart schoot terug naar je eigen voeten

`walk.follow` stond al in de code — op `true` gezet en nooit meer aangeraakt. Elke
GPS-tik centreerde dus opnieuw, en vooruitkijken op de route was onmogelijk: je
schoof de kaart weg en een seconde later stond hij weer op je neus.

Het onderscheid dat dit oplost is **`originalEvent`** op de MapLibre-gebeurtenis. Die
zit erin bij slepen, knijpen of draaien met een vinger, en níet bij onze eigen
`jumpTo`/`easeTo`. Zonder die controle zet de app het volgen uit op zijn eigen
bewegingen en volgt hij daarna nooit meer.

Gemeten: na wegslepen bleef het middelpunt over vier simulatietikken exact staan
(6.72179, 52.26247 → 6.72179, 52.26247), en de terugknop bracht hem in één tik terug.

## Per ongeluk naar beneden trekken kostte de hele wandeling

Pull-to-refresh herlaadt de app, en er stond niets in de opslag: voortgang, gevonden
punten en het spoor waren weg. Terwijl je op dat moment in een bos staat.

Twee lagen. `overscroll-behavior: none` zodat het niet meer zo makkelijk gebeurt, en
de lopende wandeling in IndexedDB zodat het niet erg is als het toch gebeurt.

Drie dingen die daarbij bleken te moeten:

- **De hele route moet mee**, niet een verwijzing. Na een herlaadactie is de lijst
  met gevonden rondjes leeg, en een net gegenereerd rondje bestaat dan nergens meer.
- **Het zoekvenster van de tracker moet ook hervat worden.** `createTracker` begon
  altijd op index 0. Zet je de afstand terug op 2,1 km maar het venster op het begin,
  dan projecteert de eerste meting je op de start en denkt de app dat je opnieuw
  begint. Nu schuift `lastIndex` mee naar de bewaarde afstand.
- **Het wandelscherm verlaten is een besluit, een herlaadactie niet.** Verlaten legt
  de wandeling vast en wist de lopende; een herlaadactie komt daar nooit langs. Zonder
  dat verschil duikt er later een hervat-kaart op voor een wandeling die al in het
  boek staat, en tel je hem dubbel.

Gemeten met een echte herlaadactie halverwege: 3242 m bewaard, na herladen ging de
wandeling verder vanaf 3242 m in plaats van vanaf nul.

## Een gekantelde kaart vraagt om de looprichting, niet om het kompas

De 3D-stand draait de kaart naar de kant waar je heen loopt. Het kompas is daarvoor
de verkeerde bron: dat zegt waar de *telefoon* heen wijst, en met een telefoon los in
je hand klapt zo'n kaart alle kanten op. De richting komt daarom uit opeenvolgende
posities.

Twee dingen die daar misgingen:

- **Onder 6 meter negeren.** GPS-ruis onder een bladerdek levert anders een
  willekeurige richting op terwijl je stilstaat.
- **Mengen over de eenheidscirkel.** Gewoon gemiddelde van 350° en 10° is 180° — de
  kaart klapt dan naar het zuiden. Dus via sin/cos.

De gebouwen komen overeind met `fill-extrusion` op `render_height` uit het
OpenMapTiles-schema, vanaf z15, en staan uit zolang de kaart plat is: platte vlakken
bovenop opgetrokken vlakken is dubbel getekend en zonder kanteling zie je van hoogte
toch niets. Gemeten in Delden: laag zichtbaar, gebouwen getekend, `render_height` 5.

## Een terugblik, en wat daarin nét niet gemeten kan worden

Het gelopen spoor wordt uitgedund bijgehouden — elke 15 meter een punt — en gaat mee
in het boek. Op de terugblik liggen twee lijnen over elkaar: lime wat je van plan was,
muntgroen waar je echt liep.

Twee getallen die eerlijk gelabeld moeten worden, want ze zijn niet gemeten:

- **Stappen.** Er is geen stappenteller in een browser. Het getal komt uit de afstand
  en de gemiddelde staplengte bij die leeftijd (ruwweg 0,42 × lengte), afgerond op
  vijftigtallen om niet te doen alsof het gemeten is.
- **Tijd.** Van start tot afsluiten, dus pauzes en stilstaan bij een bruggetje zitten
  erin. Er stond eerst een afgeleid tempo bij ("± 1 min per kilometer" in een
  simulatie); dat is weggehaald, want er is geen manier om lopen van kijken te
  onderscheiden en een tempo dat pauzes meerekent is geen tempo.

## Eén ding dat de test zelf blootlegde

Tijdens het meten liep de simulatie door, waardoor de positie een paar honderd meter
verder sprong dan het zoekvenster van ±300 m. De tracker projecteerde toen op de rand
van het venster: *"Je bent 300 m van de route"* terwijl de route recht onder je lag.

Dat is niet alleen een testartefact — een paar minuten zonder fix onder een dicht
bladerdek doet hetzelfde. Boven 150 meter zoekt de tracker nu één keer de hele lijn af
om zich te heroriënteren. Duurder, maar alleen op het moment dat je verdwaald bent.

## En een flakkerende probe

`spike/gebaar-probe.js` viel om op "één sleep blijft één stap terug". Niet de app: één
sleep doet twee routeringen — één als je stilhoudt, één als je lost — en tussen die
twee staat `bezig` even op false. De probe keek precies in dat gaatje en mat de helft
van de handeling. Hij wacht nu tot het twee keer achter elkaar rustig is.

---

# 15. Hakkelig lopen, en een stip die niets zegt

Twee klachten uit dezelfde wandeling, en ze horen bij elkaar.

## Waarom het hakkelde

Een GPS-fix komt ongeveer één keer per seconde. De app zette de kaart en de marker
dán op de nieuwe plek. Gevolg: één sprong per seconde, en vijftig frames waarin niets
gebeurt. De beweging zat in de wereld, niet in het scherm.

Dat is niet op te lossen door sneller te meten — dat kan de satelliet niet — maar door
*tussen* de metingen te tekenen. `src/vloeiend.js` houdt een getoonde positie bij die
elk frame een stukje naar de laatste meting toe kruipt.

**Exponentieel dempen, niet lineair interpoleren.** Lineair tussen twee fixes moet je
vooraf weten wanneer de volgende komt, en dat weet je niet: onder een dicht bladerdek
valt er zomaar drie seconden niets binnen. Exponentieel dempen heeft die aanname niet
nodig, kan nooit voorbij het doel schieten, en vertraagt netjes als de metingen
wegvallen in plaats van te bevriezen en dan te springen.

Gemeten met `node spike/vloeiend-probe.mjs`, zes metingen op 1 Hz, getekend op 60 Hz:

| | ongedempt | gedempt |
| --- | --- | --- |
| grootste stap in één frame | 1300 mm | **64 mm** |
| frames die bewegen | 1 op 60 | **360 op 360** |
| gemiddelde stap per frame | — | 21 mm |
| achterstand op de meting | 0 | **8 cm** |

Die 8 cm is de prijs, en die is een orde van grootte kleiner dan de GPS-
onnauwkeurigheid zelf (10 tot 30 m onder bomen). Bij 30 fps legt hij per seconde exact
dezelfde weg af als bij 60 — de tijd bepaalt de beweging, niet het aantal frames.

## Drie dingen die erbij moesten

- **Op de lijn tekenen in plaats van op de meting.** Binnen 25 m van de route wordt de
  geprojecteerde plek getoond. Anders wiebelt de marker om het pad heen terwijl je
  kaarsrecht loopt, en dat leest óók als hakkelen. Erbuiten is de ruwe meting het
  eerlijke antwoord, en dat zegt de kaart al met "Je bent … m van de route".
- **De marker in een eigen bron.** Zat hij bij de route, dan zou elk frame een lijn
  van honderden punten opnieuw geserialiseerd worden.
- **Per frame `jumpTo`, geen `easeTo`.** Het schuiven zit al in de gedempte positie.
  Zou de kaart daar zélf ook nog over animeren, dan animeer je een animatie en loopt
  het achter.

## De pijl

Een chevron van 30 px, op een canvas getekend en met `addImage` toegevoegd — geen
bestand erbij dat mee moet in de offline-cache en kan 404'en. `icon-rotate` met
`icon-rotation-alignment: map` en `icon-pitch-alignment: map`, zodat hij naar de plek
in het landschap wijst en plat op de grond ligt als de kaart gekanteld staat.

Twee dingen die pas bij het kijken bleken:

- **Lime op lime verdwijnt.** De pijl staat pal op de 6,5 px lime routelijn. Met alleen
  een donkere rand las hij als een vlekje. Er ligt nu een donker schijfje van 13 px
  onder.
- **Geen koers, geen pijl.** Sta je stil of is er te weinig beweging gemeten, dan is
  het een ronde stip. Een pijl die een richting verzint is erger dan geen pijl. De
  lagen kiezen op `['has', 'koers']`, en de sleutel wordt alleen gezet als hij er echt
  is — `koers: null` zou de pijl laten verschijnen zonder richting.

## Twee echte fouten die het meten blootlegde

**Het detailscherm bleef gekanteld staan.** `setAanzicht` kantelde met een `easeTo`, en
de `fitBounds` die er direct achteraan kwam kapte die animatie halverwege af. Daarna
dacht de app dat hij plat stond terwijl de kaart op 58° hing — en omdat `setAanzicht`
oversloeg als de opgeslagen stand al klopte, kwam hij daar nooit meer uit. Nu is de
kaart de waarheid en niet de variabele: de stand wordt altijd toegepast, en de
eindstand wordt na de animatie hard gezet — via `moveend`, en met een klok als vangnet.
Dat laatste is niet overdreven: in een omgeving die 1 frame per seconde geeft, komt een
`easeTo` van 480 ms nooit aan en blijft de camera halverwege hangen.

**De camera werd bij elke hertekening opnieuw gezet.** `mountMap` liep bij elke
`render()`, dus elke keer dat er iets veranderde — een pauzeknop, een melding — sprong
je zoom en kanteling terug. Nu alleen bij het binnenkomen van een scherm. Dat was ook
wat de kantelanimatie omgooide.

---

# 16. De tabbalk viel onder de rand

De app was verticaal te scrollen, en dan schoof de tabbalk uit beeld.

De oorzaak zat in twee hoogtes die niet dezelfde bedoelen:

- `html, body { height: 100% }` rekent tegen de **grote** viewport — de hoogte alsof
  de adresbalk weggeschoven is.
- `.app { height: 100dvh }` is de **dynamische** viewport: wat er nú zichtbaar is.

Met de adresbalk in beeld is het document dus precies de hoogte van die balk te lang.
Het document krijgt een scrollbalk, en omdat `.app` `position: relative` was schoof het
hele blok mee — inclusief de tabbalk, die absoluut onderaan de app hangt.

Twee dingen aangepast, en ze doen elk iets anders:

1. **`overflow: hidden` en `100dvh` op html en body.** Er valt nu niets te scrollen,
   want het document is exact zo hoog als het venster. Dit is de eigenlijke oplossing.
2. **`.app` van `relative` naar `fixed`.** Dat is het vangnet: kan het document ooit
   tóch scrollen — een browser die zich niet aan `overflow: hidden` houdt, een
   uitschuivend toetsenbord — dan hangt de app aan het venster en blijft de balk staan.

`height: 100%` staat als terugval vóór `height: 100dvh`, voor browsers zonder `dvh`.

Gevolg voor de brede weergave: de gecentreerde telefoonkolom werd met flexbox op de
body gepositioneerd, en een `fixed` element trekt zich daar niets van aan. Die
centrering staat nu op `.app` zelf (`left: 50%` plus `translate(-50%, -50%)`).

Nagemeten op alle vier de tabs plus *instellen* en *welkom*: `scrollHeight` gelijk aan
`clientHeight`, de onderkant van de balk exact op de vensterhoogte, en na
`window.scrollTo(0, 800)` staat `scrollY` nog op 0 en is de balk niet verschoven.
Scrollen bínnen de app werkt onveranderd — het profiel is 979 px hoog in een venster
van 812 en scrollt netjes onder de balk door.

---

# 17. Drie punten uit de tweede wandeling

## De kaart draaide 20.000 graden te veel

`spike/koers-probe.mjs` maakt onrust meetbaar: tel op hoeveel graden de kaart in totaal
draait over één wandeling. Loopt de route 2200 graden aan bochten, dan is 2200 het
minimum en is al het meerdere gewiebel.

Gesimuleerde wandeling over een echte BRouter-route van 3,77 km, 2897 metingen op
wandeltempo met een zijwaartse GPS-fout tot ±10 m:

| koersbron | totaal gedraaid | waarvan gewiebel |
| --- | --- | --- |
| peiling tussen twee metingen | 21.584° | 19.384° |
| **richting van de route + dode zone** | **2.217°** | **17°** |

Factor 9,7 rustiger, en de bochten worden nog steeds gemaakt (2217 tegen 2200 aan
echte bochten). Bij alle 2897 metingen kon de positie op de lijn geprojecteerd worden.

**Waarom harder dempen niet de oplossing was.** De richtingsfout van een peiling is
ruwweg `atan(fout / afstand)`. Bij 10 m GPS-fout over 6 m beweging zit je al boven de
50°. Dat is geen ruis die je wegfiltert; dat is een bron die niet weet waar je heen
loopt. Zwaarder dempen maakt de kaart traag én laat hem onrustig.

**Wat er in plaats daarvan gebruikt wordt.** De tracker projecteert je positie al op de
routelijn. De *richting van die lijn* op die plek is een stabiele peiling — de lijn
beweegt niet — en zolang je de route volgt is het precies waar je heen gaat. Drie details
die nodig bleken:

- **Over 25 meter, niet over één segment.** Segmenten zijn soms drie meter lang; de
  "richting van de route" is dan net zo wisselend als een GPS-peiling.
- **Een dode zone van 8°.** Zonder die draait de kaart continu een paar graden heen en
  weer, en dát voelt onrustig — niet de grote bochten. De demper in `vloeiend.js` maakt
  van elke stap alsnog een vloeiende draai.
- **Terugval op eigen beweging** boven 25 m van de route, maar dan over een basislijn
  van 20 meter uit het gelopen spoor in plaats van tussen twee metingen. Gemeten op een
  zijpad van 150 m: 25 van de 25 metingen leverden een richting op.

## Welke schermen buiten beeld vallen: geen, op de gemeten formaten

`spike/hoogte-probe.js` zet elk van de veertien schermen neer op vier vensterformaten en
zoekt elementen die onder de onderkant uitkomen zonder dat er een scrollcontainer is die
je erbij kan brengen. Dat is de definitie van afgesneden, want `.screen` heeft
`overflow: hidden` en waarschuwt dus nergens.

Uitkomst op 412×906 (als app), 412×780 (Chrome), 412×720 en 360×640: **alles past.**
Het gerapporteerde probleem is hiermee niet gereproduceerd.

Twee dingen die de probe wél opleverde:

- **Eén valse positief die iets leert.** De sierlijke blob in de kindmodus valt 70 px
  buiten beeld — met opzet, want `.kind` heeft `overflow: hidden`. De probe kijkt nu of
  er tussen het element en het scherm een container zit die zélf afsnijdt; is dat zo, dan
  is het vormgeving en geen fout.
- **De kindmodus moest scrollen op korte schermen.** Compas 280 px, naald 186 px en
  afstand 104 px zijn vaste maten die onder 720 px hoogte samen niet passen, en dan stond
  "ik zie het!" onder de rand. Een kind hoort daar niet naartoe te scrollen. Alles schaalt
  nu mee met de beschikbare hoogte, met de ontworpen maat als bovengrens: op 906 nog exact
  280 px, op 640 krimpt het naar 198 px en past het (inhoud 640 in 640).

Niet met containereenheden, wat de eerste poging was: `container-type: size` snijdt de
inhoud af waar de hoogte van `.kind` juist uit moet komen, en dan valt alles op nul terug
— gemeten, compas 0 px.

**Wat nog niet uitgesloten is.** De probe bootst de vensterhoogte na en kan drie dingen
niet nadoen: de veilige zones van het toestel (`env(safe-area-inset-*)`), een
uitschuivend toetsenbord, en de tekstvergroting uit de Android-instellingen. Die laatste
is de sterkste kandidaat: Chrome schaalt daarmee ook px-tekst, en dan groeit alles binnen
vaste vakken. Één schermafdruk van een scherm dat bij hem misgaat maakt het verschil.

## Geocaches op de kaart

De caches uit het GPX-bestand stonden alleen in de generator. Zaten ze niet in je route,
dan wist je niet dat je er langs liep. Nu staan ze op de kaart van *detail* en *onderweg*
als holle muntgroene stippen vanaf z13, met hun naam vanaf z15.

Vier keuzes, met de reden:

- **Hol en muntgroen**, tegenover de gevulde lime ringen van je routepunten. Zonder dat
  onderscheid lijkt je route langer dan hij is.
- **Alleen wat in beeld is**, met een marge van een kwart beeld zodat ze er al staan
  voordat ze in beeld schuiven. `spike/cachekaart-probe.mjs`: van 800 caches over de
  provincie blijven er 2 over, in 0,04 ms — en dat gebeurt bij elke kaartbeweging.
- **Niet op *bewerken***, want daar sleep je de lijn en zijn extra stippen iets dat je per
  ongeluk aantikt. Niet in de kindmodus, die is met opzet leeg. Niet op de terugblik, die
  gaat over wat je gelopen hebt.
- **Aantikken geeft een kaartje, geen nieuw tabblad.** Eerst zien wát je aangetikt hebt,
  dan zelf beslissen of je de hint opent. Een tabblad dat onder je duim opengaat terwijl
  je loopt is geen antwoord op een vraag.

Het filter is losgeknoopt van de kaart (`filterOpVenster()` neemt vier getallen) zodat het
na te rekenen is zonder MapLibre. Het tékenen en het aantikken zijn dat niet: die vragen
een kaart, en een kaart vraagt frames.
