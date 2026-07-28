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

### Hoeveel loopt er over paadjes?

Uit de `WayTags` die BRouter per segment meegeeft rekent de app uit welk deel van
de route over bospad, voetpad of zandpad gaat. Dat staat als tag op elk
resultaatkaartje en als verdeling op het detailscherm — *"Onderweg: 34% bospad,
30% landweg, 24% fietspad."*

Het weegt ook mee in de keuze: onder kandidaten die allebei binnen de
afstandsmarge vallen wint die met meer pad.

Wat het **niet** doet is het landschap veranderen. Rond Twickel hangt het
padennetwerk niet aan elkaar, dus tussen twee bospaadjes moet je over een
landweg, en 40–55% is daar het plafond. Verzwaarde routerkosten, andere profielen
en alternatieve routes zijn alle drie gemeten en leverden niets op — zie
[BEVINDINGEN.md](spike/BEVINDINGEN.md), meting 5. Wat het getal wél doet: je ziet
vóór vertrek wat je krijgt.

### Is het wel een rondje?

Ook gemeten, en ook getoond. De app rekent uit welk deel van de route je twéé
keer loopt — voor elk punt kijken of er een ander punt is dat ver weg ligt lángs
de route maar dichtbij in de ruimte. Nul is een echt rondje, richting 1 is een
heen-en-terug.

Dat weegt zwaarder dan het pad-aandeel: een route waarvan je een derde dubbel
loopt is geen rondje, hoe mooi het pad ook is. Het staat als tag op het kaartje:
*echt rondje*, *rondje met een stukje terug*, of *deels heen en terug*.

De oorzaak van kromme lussen zat in de selectie: was er van een aangevinkte soort
alleen aan één kant iets te vinden, dan kwamen twee punten naast elkaar te liggen
— gemeten peilingen 169°, 16° en 355°, dus twee punten 21° van elkaar. Nu krijgt
een punt dat te dicht bij een al gekozen punt ligt een strafscore.

**Let op de afweging.** In een gebied waar het padennetwerk niet aan elkaar hangt
sluiten "echt rondje" en "veel paadjes" elkaar uit: gemeten kwam er een route uit
van 76% paadjes waarvan je 62% dubbel liep, naast een van 41% paadjes die een net
rondje was. Daarom laat de app niet drie bijna gelijke rondjes zien maar spreidt
hij de keuze: de beste, de meest paadjesrijke, en het rondste. Die afweging is aan
jou.

### Wat je op de kaart ziet

Straatnamen vanaf z14, langs de lijn geplaatst. Punten onderweg vanaf z14 als
mint stip, met hun naam vanaf z15 — voor zover OSM er een heeft, en dat is bij
ongeveer een kwart het geval.

Paden in drie soorten, elk herkenbaar: **voetpad** lime en kort gestippeld,
**zandpad** olijf en lang gestippeld, **fietspad** koel teal en doorlopend. Dat
onderscheid is nodig omdat `cycleway` in het OpenMapTiles-schema ónder klasse
`path` valt — het is er zelfs de grootste subklasse van — dus zonder splitsing
teken je vooral fietspaden en noem je ze paadjes.

De routelijn is 6,5 px doorlopend met een donkere baan eronder. Het verschil met
de paadjes zit in breedte en in wel/niet onderbroken, niet in kleur: op een kaart
vol lime streepjes zou een lime lijn anders wegvallen.

De `poi`-laag is streng gefilterd. Ongefilterd bestaat hij vooral uit ruis: in een
schijf van 3 km stonden er 174 parkeerplaatsen, 167 hekken, 146 bollards en 101
afvalbakken in. Er is dus een witte lijst van wat je onderweg wíl zien.

### Startpunt

Standaard je GPS-positie, maar via *Startpunt* op het instelscherm kun je een plek
zoeken op naam (Nominatim) of de kaart onder het kruis schuiven. Zo maak je thuis
een route voor morgen.

### Niets aanvinken mag ook

De chips zijn een wens, geen voorwaarde. Vink je niets aan, dan zoekt de app het
mooiste rondje vanaf je startpunt: hij ankert dan **op het padennetwerk zelf** —
punten die al op een bospad of zandpad liggen — en vertelt achteraf waar de route
langs komt.

Dat ankerpunt is niet willekeurig gekozen. Gemeten rond Twickel, zelfde afstand:

| Ankers op | pad-aandeel | dubbel gelopen |
| --- | --- | --- |
| POI's (speeltuin, café…) | 41% | 11–25% |
| Verzonnen punten op een ring | 22–38% | 69–89% |
| **Het padennetwerk** | **44–69%** | **6–37%** |

Een punt dat al op een pad ligt hoeft de router niet via asfalt te bereiken, dus
sluit de lus over paden. POI's liggen bij een parkeerplaats of in een dorp;
ringpunten snappen naar de naaste weg-uitloper, waar de router heen en weer naartoe
pendelt. Er staat *"niets, verras
me"* naast de chips om ze in één tik te wissen.

Lukt het mét eisen niet binnen je afstand, dan komt er als laatste ronde ook een
rondje zonder eisen bij — een mooie lus van de gevraagde lengte is een beter
antwoord dan een route van het dubbele die wél langs alles komt.

Elke aangevinkte soort komt **gegarandeerd** in de route. Past dat niet binnen de
gevraagde afstand, dan laat de app liever een eis vieren dan te liegen over de
afstand: je krijgt kortere rondjes met een badge als "Zonder speeltuin", náást het
kortste rondje waarin alles zit.

### De route zelf verslepen

Bevalt de route bijna, dan hoef je hem niet weg te gooien. *Aanpassen* op het
detailscherm geeft je de route schermvullend, en daar **sleep je de lijn** naar waar
je wél wil lopen. De app zoekt er zelf de paden bij.

- Pak je de lijn binnen 22 px, dan sleep je hem; raak je de kaart ernaast, dan
  schuift de kaart. Er is geen sleepdrempel — je pakt hem of niet.
- Tijdens het slepen zie je een **gestippelde elastiek** naar je vinger en bij je
  duim `≈ 5,3 km`, met eronder hoeveel dat méér of minder is dan je wilde. Rechte
  lijnen, geen router: een lijn die achterloopt op je duim voelt kapot.
- Houd je **250 ms stil**, dan snapt hij vast op de echte paden terwijl je nog
  vasthoudt. Vanaf dat moment versleep je dat punt in plaats van de lijn.
- Bovenin zie je wat het kost: `44% → 61% paadjes`, en of het nog een echt rondje is.
- **Tik** op een punt om het eruit te halen — een speeltuin verplaats je niet, die
  staat waar hij staat. Vormpunten (holle muntgroene knoopjes) zijn jouw omweg en
  mogen ook gewoon weg. Het startpunt blijft waar het is.
- **↺** onderin maakt de laatste aanpassing ongedaan; één sleep is één stap terug,
  ook als hij onderweg al een keer geroute heeft.

De `≈` is geen bescheidenheid: de schatting zit tot 22% naast de werkelijkheid, en
dat is niet weg te rekenen — sleep je naar links dan ligt daar een pad, naar rechts
moet de router om. Zodra de echte routering binnen is valt de `≈` weg. Zie meting 9.

Details en meetwaarden: [spike/BEVINDINGEN.md](spike/BEVINDINGEN.md). Beide lagen
zijn te controleren zonder dat er een kaart getekend hoeft te worden — het model
tegen de echte router, en het gebaar tegen een nepkaart:

```
node spike/edit-probe.mjs
```

En in de console van de app:

```js
(await import('/spike/gebaar-probe.js')).run()
```

## Layout

| Bestand | |
| --- | --- |
| [index.html](index.html) | shell: fonts, MapLibre, `#app` |
| [styles.css](styles.css) | tokens + één sectie per scherm |
| [app.js](app.js) | schermen, state, routing, tabbalk, bijwerken |
| [sw.js](sw.js) | service worker: app-shell offline, en wacht op *bijwerken* |
| [src/generator.js](src/generator.js) | de routegenerator |
| [src/pois.js](src/pois.js) | categorieën, de onzichtbare tegel-oogster, Overpass-aanvulling |
| [src/router.js](src/router.js) | BRouter, lus en heen-en-terug |
| [src/edit.js](src/edit.js) | route aanpassen: waypoints, elastiek, schatting, ongedaan — geen kaart, geen DOM |
| [src/edit-map.js](src/edit-map.js) | het gebaar en wat je onder je vinger ziet |
| [src/geo.js](src/geo.js) | afstand, peiling, tour-ordening |
| [src/map-style.js](src/map-style.js) | kaartstijl in het Boslamp-palet + oogst-stijl |
| [src/mapview.js](src/mapview.js) | één MapLibre-instantie die tussen schermen verhuist |
| [src/geolocate.js](src/geolocate.js) | positie, met duidelijke fout bij http |
| [src/tracking.js](src/tracking.js) | voortgang langs de route, volgend punt, aankomstdrempel, hervatten |
| [src/compass.js](src/compass.js) | kompas voor de kindmodus, gedempt over de eenheidscirkel |
| [src/simulate.js](src/simulate.js) | wandeling nabootsen (`?sim`) |
| [src/store.js](src/store.js) | IndexedDB: profiel, stickers, foto's, rondjes, wandelingen |
| [src/offline.js](src/offline.js) | kaarttegels van een route vóór vertrek binnenhalen |
| [src/gpx.js](src/gpx.js) | geocaches uit een GPX-export van c:geo lezen en filteren |
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
| `#/bewerken` | Route verslepen op een schermvullende kaart | echt |
| `#/onderweg` | Live wandeling: kaart, voortgang, volgend punt | echt |
| `#/kind` | Kindmodus: kompas, afstand, sticker | echt |
| `#/recap` | Terugblik: gelopen spoor, km, stappen, gevonden punten | echt |
| `#/rondjes` | Net gevonden en bewaarde rondjes | echt |
| `#/boek` | Stickerboek: stickers, foto's, gelopen wandelingen | echt |
| `#/profiel` | Kind, instellingen, appversie en bijwerken | echt |

## Onderweg

### De kaart blijft staan waar jij hem zet

De kaart volgt je positie, maar zodra je hem zélf pakt houdt hij op met volgen en
verschijnt er rechtsboven een knop om terug te springen. Zonder dat schoot hij bij
elke GPS-tik terug en kon je dus nooit even verder vooruit op de route kijken.

Het onderscheid tussen "jij sleept" en "de app centreert" zit in `originalEvent`: dat
zit in een MapLibre-gebeurtenis van een vinger, en niet in onze eigen `jumpTo` of
`easeTo`. Zonder die controle zet de app het volgen uit op zijn eigen bewegingen, en
volgt hij dus nooit meer.

### Plat of gekanteld

Rechtsboven staat een **2D/3D**-knop.

| | wat je ziet |
| --- | --- |
| **plat** | noord boven, geen kanteling, de hele lus in beeld — waar ben ik |
| **gekanteld** | 58° gekanteld, gedraaid naar de kant waar je loopt, dichterbij, huizen overeind — welk pad neem ik |

In gekantelde stand komen de gebouwen overeind (`fill-extrusion` op
`render_height` uit het OpenMapTiles-schema, vanaf z15). Ze staan uit zolang de kaart
plat is: platte vlakken bovenop opgetrokken vlakken is dubbel getekend, en zonder
kanteling zie je van hoogte toch niets.

De kaart draait mee met de **looprichting uit je opeenvolgende posities**, niet met
het kompas. Het kompas zegt waar de telefoon heen wijst, en met een telefoon los in
je hand klapt een op het kompas gedraaide kaart alle kanten op. Bewegingen onder
6 meter worden genegeerd — anders levert GPS-ruis onder een bladerdek een
willekeurige richting op terwijl je stilstaat. De richting wordt over de
eenheidscirkel gemengd, want anders springt 350° → 10° door het zuiden heen.

De keuze blijft bewaard: dit is een voorkeur, geen instelling die je per wandeling
opnieuw wil kiezen.

### Een herlaadactie kost je wandeling niet meer

Per ongeluk naar beneden trekken herlaadde de app, en dan was alles weg: voortgang,
gevonden punten, het spoor. Twee dingen daartegen.

**Het gebeurt niet meer zo snel:** `overscroll-behavior: none`, dus geen
pull-to-refresh.

**En als het toch gebeurt, is het niet erg:** de lopende wandeling staat in
IndexedDB, na elke stap bijgewerkt (hoogstens elke 4 seconden, en gegarandeerd bij
`pagehide` en bij het wegschuiven van de app). Sta je nog op `#/onderweg`, dan pakt de
app hem stil weer op. Open je de app later opnieuw, dan staat er een kaart op het
beginscherm: *"Je was aan het lopen — Rondje Oranjerie, 2,1 van 5,0 km gedaan"*, met
**Verder** en een kruisje.

De hele route gaat mee in die opslag, niet alleen een verwijzing: na een herlaadactie
is de lijst met gevonden rondjes leeg en bestaat een net gegenereerd rondje nergens
meer. Ouder dan twaalf uur laten we vallen — dat is geen onderbreking meer maar een
vergeten wandeling.

Het wandelscherm verlaten is wél een besluit: dan wordt de wandeling opgeschreven en
is er niets meer om te hervatten. Een herlaadactie komt daar nooit langs, en dat is
precies het geval dat hervat moet worden.

### Terugblik na de wandeling

Is het rondje rond, dan staat er **Bekijk jullie wandeling** in de kaart onderin; het
kruisje linksboven doet hetzelfde als je eerder stopt. Op de terugblik staat:

- de kaart met **twee lijnen**: lime is wat je van plan was, muntgroen is waar je
  echt liep — met een legenda, want dat verschil is het interessante
- kilometers, **geschatte stappen**, en minuten onderweg
- wat je onderweg hebt afgevinkt

Het spoor wordt tijdens het lopen uitgedund bijgehouden: elke 15 meter een punt is
genoeg voor de vorm en houdt een wandeling van 6 km op een paar honderd punten. Het
gaat mee in het boek, dus elke wandeling in **Boek** is aan te tikken en opent zijn
eigen terugblik.

**Over die stappen.** Er is geen stappenteller in een browser. Het getal is berekend
uit de afstand en de gemiddelde staplengte bij die leeftijd (ruwweg 0,42 × lengte),
afgerond op vijftigtallen om niet te doen alsof het gemeten is — en de app zegt dat
er ook bij. Ook de tijd is eerlijk gelabeld als *min onderweg*: pauzes en stilstaan
bij een bruggetje zitten erin, want er is geen manier om lopen van kijken te
onderscheiden.

## Navigatie

De app had negen schermen en geen menu: je kwam ergens via een knop en je vond de
weg terug niet. Nu is er een tabbalk met vier vaste bestemmingen, en daar hangt de
rest aan.

| Tab | Wat er staat |
| --- | --- |
| **Lopen** | begroeting, locatiestatus, en de twee manieren om te beginnen |
| **Rondjes** | net gevonden en bewaarde rondjes |
| **Boek** | van het kind: stickers, foto's, waar jullie liepen |
| **Profiel** | wie er loopt, de instellingen, en de appversie |

Wat *lineair* is krijgt géén tabbalk: instellen → zoeken → resultaten → detail →
bewerken → onderweg → kindmodus. Dat zijn stappen in één handeling, met een eigen
knop onderin en een terugknop bovenin — geen bestemmingen. De kindmodus mag de
tabbalk trouwens ook niet hebben: die zit achter een code.

### Het paadje onderin

De actieve tab is geen pil achter een icoon. Onderaan de balk loopt een gestippeld
lime paadje met de **"hier ben ik"-stip** erop, in exact dezelfde opbouw als op de
kaart: donkere baan, lime streepjes, gevulde stip met een ring en een gloed. Die
stip schuift als je van tab wisselt.

Dat is geen versiering. De verticale variant van datzelfde paadje staat al achter de
routelijsten (`.trail`), en de app gaat over waar je bent op een route — dus tekent
hij zijn navigatie in de taal van zijn eigen inhoud. Het onderscheid tussen actief
en niet zit bovendien in drie dingen tegelijk (kleur, gevuld versus omlijnd icoon,
en de stip), zodat het ook leesbaar is als je kleuren slecht ziet.

De balk staat in `index.html` naast `#schermen` en niet erin. Dat moet: binnen de
schermen wordt hij bij elke hertekening opnieuw gemaakt, en dan kan de stip niet
schuiven — precies het schuiven dat losse pagina's tot één app maakt.

Twee dingen die de meting rechtzette:

- De stip zat tot **7 px naast het midden** van zijn tab. Het paadje was 14 px
  ingesprongen, dus het percentage viel op een smallere doos dan de rij tabs. De
  doos is nu even breed als de tabs; alleen de streepjes springen in.
- Een bewaard rondje open je uit *Rondjes*, maar de terugknop op het detailscherm
  ging altijd naar de zoekresultaten — die dan leeg zijn. Het detailscherm onthoudt
  nu waar je vandaan kwam.

## Bijwerken

Een PWA werkt zichzelf stil bij, en dat is het probleem: je duwt iets, opent de app,
en ziet de oude versie omdat de service worker je uit de cache bedient. Er was geen
moment waarop de app kon zeggen dat er iets nieuws was.

Onder *Profiel → De app* staat nu de draaiende versie en één knop:

| Toestand | Wat je ziet |
| --- | --- |
| bij | `stapper-v6` · "Nieuwste versie, van 27 juli 2026." · **Nakijken** |
| nieuwe versie klaar | `stapper-v7 staat klaar` · "Je draait nu stapper-v6." · **Nu bijwerken** |
| geen service worker | "Ontwikkelversie" · geen knop, want er valt niets bij te werken |

Daarvoor moest de service worker veranderen. Er stond `skipWaiting()` in de
installatie, waardoor een nieuwe versie het meteen overnam terwijl het geopende
scherm nog de oude code draaide: nieuwe cache, oud scherm, en geen toestand om een
knop aan te hangen. Nu wacht hij tot de app `SKIP_WAITING` stuurt, en herlaadt de
app zichzelf zodra de wissel gedaan is.

Het versienummer komt uit de service worker zelf (één bron in plaats van een string
die in twee bestanden uiteenloopt), opgevraagd over een `MessageChannel`.

Vier dingen die pas bij het uitproberen bleken:

- **Een wachtende service worker is niet altijd een update.** Bij de eerste
  installatie is er nog geen controller; die worker neemt zelf over. Zonder dat
  onderscheid zei de app "nieuwe versie klaar" tegen iemand die de app net voor het
  eerst opende, en bleef die melding staan nadat hij al geactiveerd was.
- **De draaiende versie kan de vraag niet altijd beantwoorden.** Een versie van
  vóór deze wijziging kent het bericht niet. Dat mocht geen "ontwikkelversie" heten,
  want dat is onwaar — het is een oude versie, en dat is precies waarom je er staat.
  Bij een wachtende update vragen we het nummer daarom aan de wachtende worker.
- **Bij de eerste start is hij te druk.** Hij haalt 25 bestanden op en antwoordde
  niet binnen 1,5 s, waardoor het versienummer leeg bleef. Nu 5 s, met één herkansing.
- **`controllerchange` vuurt ook bij de eerste installatie.** Daarop ongevraagd
  herladen is een sprong in het niets, dus herlaadt de app alleen als hij er zelf om
  gevraagd heeft.

## Instellingen

Op de tab **Profiel**, onder "Voor de grote mensen" en "De app":

- **Naam en leeftijd** van het kind. De leeftijd bepaalt het looptempo en dus de
  tijdschattingen.
- **Oudercode.** Niet ingesteld betekent dat elke vier cijfers de kindmodus
  verlaat; stel je er een in, dan moet die kloppen. Het ontwerp legt geen code
  vast, dus dit is jouw keuze.
- **Geocaches uit een GPX-bestand.** Zonder bestand bestaat de geocache-categorie
  niet; laad je er een in, dan verschijnt hij als chip. Zie [Geocaches](#geocaches).
- **Opslaan en terugzetten** van alles als JSON. Foto's zitten er bewust niet in;
  dan wordt het bestand tientallen megabytes en is het geen back-up meer.

## Geocaches

Een geocache is een verstopt doosje, en dat is precies waar een speurtocht van een
kind om vraagt. Ze komen **uit een GPX-bestand dat je zelf inlaadt**, niet uit een
API. Die keuze is niet uit gemak gemaakt:

| bron | waarom niet |
| --- | --- |
| officiële Groundspeak API | partner-gated én OAuth met een geheim dat in een publieke static PWA nergens te verbergen is |
| geocaching.com uitlezen zoals c:geo doet | in strijd met hun voorwaarden, en het zou om jouw wachtwoord vragen |
| OKAPI (opencaching.nl) | werkte, maar de dekking in Nederland is te dun om een wandeling op te bouwen |

Een GPX-export is data waar je zelf legitiem een kopie van hebt, en past bovendien
beter bij deze app: geen sleutel, geen aanvraag, werkt offline, en het is **jouw
selectie** in plaats van alles binnen drie kilometer.

### Hoe je het gebruikt

Exporteer in **c:geo** een opgeslagen lijst als GPX (of gebruik een pocket query van
geocaching.com), en laad dat bestand in bij *Stickerboek → Voor de grote mensen →
Geocaches uit een GPX-bestand*. Daarna staat de chip *Geocache* tussen de andere bij
Instellen — en zónder oranje stipje, want deze soort heeft geen netwerk nodig.

Opnieuw inladen vult aan; de cachecode is de sleutel, dus dezelfde cache wordt
bijgewerkt in plaats van verdubbeld. Op het detailscherm linkt een cache naar zijn
eigen pagina, want daar staat de hint.

### Wat er niet in gaat, en waarom dat hardop gezegd wordt

Na het inladen meldt de app wat er is overgeslagen. Dat is geen bijzaak:

- **Puzzelcaches** (`Unknown Cache`, `Quiz`, Wherigo) — hun gepubliceerde
  coördinaten zijn met opzet niet de vindplaats. Stil meenemen zou betekenen dat een
  kind van zes naar een plek loopt waar niets ligt.
- **Caches zonder doosje** (virtual, webcam, earthcache) — echte plekken, maar er is
  niets te vinden, en "zoek een doosje" wordt dan een leugen.
- **Evenementen** — een moment, geen plek.
- **Gearchiveerd of niet beschikbaar** — ligt er niet meer.
- **Terrein 5** — dat betekent per definitie een boot of klimspullen.
- **Onbekende soorten** worden geteld in plaats van stil geslikt, zodat een nieuwe
  cachesoort opvalt in plaats van te verdwijnen.

Een **multicache** gaat er wél in: de gepubliceerde plek is het eerste station, en
dat is een echt punt om naartoe te lopen. Dat staat er ook bij in de puntenlijst.

### Wat gemeten is

Openen in de app en in de console:

```js
(await import('/spike/gpx-probe.js')).run()
```

38 controles tegen vier bestandsvormen: een pocket query van geocaching.com, een
export uit c:geo (andere naamruimteversie, komma als decimaalteken), een kale GPX
zonder groundspeak-blok, en rommel. Plus het filteren op afstand.

Dit draait in de browser en niet in node, om één reden: XML parseren doe je niet
zelf. GPX zit vol naamruimtes, CDATA en entiteiten, en een handgemaakte lezer die
daar negen van de tien keer goed doorheen komt, verliest precies die ene cache die je
wilde. Alles gaat op `localName` en niet op naamruimte-URI, want die verschilt per
GPX-versie — een cache missen omdat de URI één cijfer anders is, is een cache die je
niet gaat vinden.

## Installeren

Stapper is een PWA: op het beginscherm zetten geeft een schermvullende app zonder
adresbalk, met de eigen offline kaart. Dat kon altijd al via het browsermenu, maar
daar gaat niemand zoeken — dus vraagt de app het nu zelf, met een wegtikbare kaart
op het beginscherm en een regel bij *Voor de grote mensen*.

Drie gevallen, en ze verschillen echt:

| | wat je krijgt |
| --- | --- |
| Chrome, Edge | een knop **Zetten** die het systeemvenster opent (via `beforeinstallprompt`) |
| Safari op iOS | uitleg: Delen → Zet op beginscherm. Safari geeft nooit een venster |
| al geïnstalleerd | niets — de app draait in `display-mode: standalone` en houdt zijn mond |

Komt het venster niet, dan staat er nog steeds hoe het via het browsermenu moet.
Chrome vuurt `beforeinstallprompt` namelijk pas als hij vindt dat je even bezig
bent geweest, en "het kan niet" zou dan een leugen zijn.

Het manifest heeft `id`, `display_override`, snelkoppelingen naar *nieuw rondje*
en *stickerboek* (lang indrukken op het icoon), en vier iconen: 192 en 512 in
`any` en in `maskable`, want Android snijdt een vorm uit het icoon en kiest per
beeldpuntdichtheid. Alle vijf iconen zitten in de shellcache, zodat de
installatiedialoog ook zonder bereik een plaatje heeft.

## Offline

De service worker cachet de app-shell en de bibliotheken. De **kaarttegels** zijn
apart: op het detailscherm zit "Kaart offline meenemen", dat de tegels voor de
corridor van díe route binnenhaalt op zoom 12 tot 16, plus de TileJSON en de
letters. Voor een rondje van 5 km zijn dat ongeveer 95 bestanden.

Doe dat op de wifi. In het bos zonder bereik levert de service worker de
gedownloade tegels uit; wat er niet staat wordt een lege tegel in plaats van een
fout, zodat de kaart niet struikelt. De tegelcache blijft staan als de app zelf
een nieuwe versie krijgt — die tegels zijn duur om opnieuw te halen en jij staat
dan misschien al buiten.

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

## Opslag

Alles in IndexedDB op dit ene toestel — er is geen backend, dat was beslissing 1.
Profiel, stickers, bewaarde rondjes en gelopen wandelingen. `navigator.storage.persist()`
wordt gevraagd zodat Android het niet opruimt als de telefoon vol raakt.

Een bewaard rondje bevat de hele geometrie (een paar kB), dus je kunt hem later
opnieuw lopen zonder opnieuw te genereren, ook zonder bereik.

Twee dingen die geen bug zijn maar een keuze. Onder 250 meter gelopen telt niet
als wandeling — even naar het scherm kijken hoort de statistieken niet te
vervuilen. En elke sticker krijgt een `childId` mee terwijl er één kind is: dat
kost nu één veld en scheelt later een schemamigratie die je zou moeten testen
tegen de echte, opgebouwde geschiedenis van je kind.

De exportknop onderin het stickerboek schrijft alles als JSON weg. Dat is de
enige back-up die er is.

De drie tegels in de kindmodus doen elk iets: **wat zoeken we** geeft een
aanwijzing die bij het volgende punt past ("zoek een brug over het water"),
**maak foto** legt een foto vast die in het stickerboek verschijnt, en
**voorlezen** spreekt de afstand en het volgende punt uit via `speechSynthesis`.

## Nog te doen
- **Het sleepgebaar is niet met een echte vinger getest.** Het model is nagerekend
  tegen de echte router (40 controles) en het gebaar tegen een nepkaart (33
  controles), maar of de lijn lekker aanvoelt, of 250 ms het juiste moment is om
  vast te snappen, of 22 px raakafstand op een duim klopt en of de knoppen onderin
  niet in de weg zitten, is alleen op een telefoon te zien.
- **De GPX-lezer heeft nog geen échte c:geo-export gezien.** Hij is nagerekend tegen
  vier zelfgemaakte bestandsvormen (38 controles), maar wat c:geo er in de praktijk
  precies uitpoept — welke velden, welke naamruimteversie, of hulppunten meekomen —
  blijkt pas bij het eerste echte bestand. Loopt daar iets mis, dan zegt de app wat
  hij overslaat en waarom, dus dat is te zien in plaats van te raden.
- **Eén wandeling lopen.** Vier aannames zijn nog onbeproefd en geen regel code
  kan ze bevestigen: leesbaarheid van de donkere kaart in fel zonlicht,
  GPS-kwaliteit onder een bladerdek, gerammel van de compasnaald, en of een kind
  de kindmodus langer dan twee minuten boeiend vindt.
