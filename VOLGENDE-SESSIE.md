# Klaargezet voor de volgende sessie

Drie punten uit de wandeling van 29 juli 2026, met de aanknopingspunten erbij zodat er
niet opnieuw gezocht hoeft te worden. Nog niets van gebouwd.

---

## 1. De kaart moet rústig meedraaien

**Wat er nu gebeurt.** In de gekantelde stand draait de kaart mee met je looprichting.
Die richting komt uit twee dempers achter elkaar:

| waar | wat |
| --- | --- |
| `app.js` → `volgKoers()` (regel ~1960) | peiling tussen twee opeenvolgende metingen, genegeerd onder 6 m, gemengd met een vaste weging van 0,35 |
| `src/vloeiend.js` → `TAU_KOERS = 0.28` | daarna nog eens exponentieel gedempt, per frame |

**Waarom dat onrustig blijft, en waarom méér dempen niet de oplossing is.** Het probleem
zit in de *bron*, niet in de demping. Een peiling over 6 meter beweging met een
GPS-fout van ±10 m heeft een onzekerheid van tientallen graden — reken het na: de
richtingsfout is ruwweg `atan(fout / afstand)`, dus bij 10 m fout over 6 m beweging zit
je al boven de 50°. Zwaarder dempen maakt de kaart dan traag én blijft onrustig.

**De richting die we eigenlijk al hebben.** De tracker projecteert je positie al op de
routelijn (`pr.snapped`, `pr.offRouteM` in `src/tracking.js`). De *tangent van de route*
op die plek is een uiterst stabiele peiling, en zolang je de route volgt is dat precies
"de kant waar je heen loopt". Dat is ook wat auto-navigatie doet.

Voorstel om te proberen, in deze volgorde:

1. **Routetangent als hoofdbron.** Peiling van `coords[i]` naar `coords[i+k]` rond de
   geprojecteerde plek, met `k` zo gekozen dat het over ~25 m gaat (niet één segment —
   die zijn soms 3 m en dan is de tangent weer ruis).
2. **Terugval op beweging** als je verder dan `OP_DE_LIJN_M` (25 m) van de route bent,
   want dan is de routerichting een leugen. Daar dan wél een langere basislijn: peiling
   tussen nu en de positie van ~20 m terug uit `walk.trail`, in plaats van tussen twee
   opeenvolgende fixes.
3. **Dode zone.** Pas draaien als het verschil meer dan ~8° is. Nu draait de kaart
   continu een paar graden heen en weer, en dat is wat "onrustig" is.
4. **Trager mengen** mag daarna, maar pas nadat 1 tot 3 er zijn — anders bestrijd je
   ruis met traagheid.

**Meten voordat we iets kiezen.** Twee reeksen naast elkaar over dezelfde gesimuleerde
wandeling: peiling-uit-beweging tegen routetangent, en dan per frame de gradenverandering.
Onrust is meetbaar als de som van absolute richtingsveranderingen; die moet omlaag zonder
dat de kaart merkbaar achterloopt in een bocht. Zelfde opzet als
`spike/vloeiend-probe.mjs`, dus zonder browser te draaien.

**Nog te beslissen:** moet de kaart ook in de plátte stand meedraaien? Nu staat plat
altijd op noord boven. Dat is een keuze, geen beperking.

---

## 2. Sommige schermen vallen buiten beeld (OnePlus 13R)

**Wat er nog niet bekend is: wélke schermen.** Dat is het eerste dat we moeten
vaststellen, en dat kan mechanisch — ik hoef het niet te onthouden en jij ook niet.

Zijn viewport is vermoedelijk ongeveer **412 × 906 CSS-px** (1264 × 2780 fysiek, ruim
3× beeldpuntdichtheid). Dat is een *lang* scherm, dus het gaat waarschijnlijk niet om
te weinig hoogte in het algemeen.

**Waar het aan ligt: `.screen { overflow: hidden }`.** Past de inhoud niet, dan wordt
hij zwijgend afgesneden — er is geen scrollbalk die je waarschuwt. Alleen schermen met
een `.screen__body` kunnen scrollen; de andere hebben een vaste indeling.

Verdachten, met de reden:

| scherm | waarom het kan afsnijden |
| --- | --- |
| `kind` | `.kind` is `min-height: 100%` mét `overflow: hidden`, en bevat een **compas van 280 × 280 px** dat niet kan krimpen, plus een afstand op 42 px+, de driekaartenrij en de grote knop. Alles bij elkaar is een vaste hoogte. |
| `zoeken` | `.zoeken` is `min-height: 100%` met 44 px rondom en een `dial` van 210 × 210 px, en zit *niet* in een `.screen__body` — dus niet scrollbaar. |
| `bewerken` | vaste indeling: balk boven absoluut, knoppen onder absoluut. Bij weinig hoogte overlappen die de kaart. |
| `onderweg` | de kaartknoppen staan op `top: 74px + safe-area`; met een hoge statusbalk kunnen die achter de voortgangsbalk schuiven. |
| `recap` | hero van 320 px plus het blad; die combinatie is nooit op een klein venster nagekeken. |

**Aanpak volgende sessie.** Een probe die alle veertien schermen langsgaat op meerdere
vensterformaten (412 × 906 voor zijn toestel, en 360 × 640 als ondergrens) en per scherm
meldt: is `scrollHeight > clientHeight`, en is er een scrollcontainer die dat kan
opvangen. Alles waar het antwoord "ja, nee" is, is een bug. Dat vindt ze allemaal in één
keer, in plaats van te gokken.

**Wat ik van jou nodig heb (mag ook niets zijn):** als je nog wéét welke schermen het
waren, scheelt dat het bevestigen. Een schermafdruk is genoeg. Zo niet: de probe vindt
ze zelf.

---

## 3. Ingeladen geocaches op de kaart

**Waar ze nu zijn.** De caches uit je GPX-bestand staan in IndexedDB en in
`state.caches` (`app.js` regel ~2126). Ze worden alleen gebruikt als kandidaat-punt bij
het genereren van een route — via `cachesInBuurt()` in `src/gpx.js`, regel ~2704 in
`app.js`. Op de kaart worden ze **niet** getekend. Zit een cache niet in je route, dan
weet je niet dat je er langs loopt.

**Wat het wordt.** Een eigen bron en laag in `src/mapview.js`, naast de route en de
eigen positie — dezelfde opzet als `stapper-mij`, want het verandert op andere momenten
dan de route. Zichtbaar op *detail*, *onderweg* en *bewerken*.

Vier dingen om bij het bouwen rekening mee te houden:

1. **Onderscheid tussen wél en niet in de route.** Een cache die een punt van je route
   is, staat er al als lime ring. De nieuwe zijn de *andere*, en die moeten daar
   duidelijk van verschillen — anders lijkt het of je route langer is dan hij is.
   Voorstel: de niet-route-caches kleiner en in een derde kleur (muntgroen is al het
   gelopen spoor, oranje is al waarschuwing — dus mogelijk een open ring).
2. **Niet allemaal tekenen.** Hoeveel caches heb je ingeladen? Bij een pocket query van
   500 stuks over de hele provincie wordt de kaart onleesbaar en het tekenen traag.
   Filteren op het zichtbare kaartvenster bij `moveend` is genoeg en kost bijna niets,
   want ze staan al in het geheugen.
3. **Aantikbaar.** We hebben `url` per cache, dus tikken kan de cachepagina met de hint
   openen — precies wat je wil als je er toevallig langs loopt.
4. **Niet in de kindmodus.** Dat scherm is met opzet leeg; daar hoort geen extra laag.

**Twee dingen die jij moet beslissen, want het zijn geen technische keuzes:**

- **Geeft een cache die niet in de route zit óók een sticker als je hem vindt?** Nu
  gaan stickers over de punten van je route. "Toevallig langs een cache" is een andere
  gebeurtenis — misschien juist een leukere. Maar het maakt de puntenteller
  (`3 van 5 punten`) onnavolgbaar als er onderweg punten bij kunnen komen.
- **Wil je onderweg een melding als er een cache dichtbij is** ("er ligt een cache 40 m
  links van je"), of is hem op de kaart zien genoeg? Het eerste is een grotere feature
  en heeft zijn eigen afwegingen (hoe vaak, hoe dichtbij, en niet zeuren als je hem al
  gehad hebt).

---

## Waar we stonden

Live: <https://marclohuis-ll.github.io/stapper/> — versie **stapper-v10**.
Alle probes groen: `node spike/edit-probe.mjs`, `node spike/vloeiend-probe.mjs`, en in
de console van de app `gpx-probe.js` en `gebaar-probe.js`.

Nog steeds onbeproefd, los van deze drie punten: de GPX-lezer heeft nog geen échte
c:geo-export gezien, en het sleepgebaar is nog niet met een echte duim getest.
