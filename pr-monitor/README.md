# P+R Rotterdam — actuele bezetting

Losstaande, zelfstandige webpagina die de actuele bezetting toont van drie
Rotterdamse P+R-terreinen:

- P+R Slinge
- P+R Noorderhelling
- P+R Kralingse Zoom

## Bron

[RDW open parkeerdata / Nationaal Parkeer Register](https://npropendata.rdw.nl/parkingdata/v2/)
— open data, geen API-key nodig.

De pagina zoekt de drie locaties één keer op in de RDW-index en bewaart de
gevonden dynamische data-URL's in `localStorage`. Daarna wordt per locatie het
dynamische endpoint elke 60 seconden opgevraagd (alleen als het tabblad
zichtbaar is), met `vacantSpaces`, `parkingCapacity`, `open`, `full` en
`lastUpdated`.

## Gebruik

Alles zit in één bestand zonder dependencies: open `index.html` in een browser,
of host de map als statische site (bijv. GitHub Pages).

Let op: het RDW-endpoint stuurt niet gegarandeerd CORS-headers mee. Werkt de
pagina niet rechtstreeks vanuit de browser, dan is een kleine server-side proxy
nodig die de RDW-antwoorden doorgeeft.
