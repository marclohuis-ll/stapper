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
