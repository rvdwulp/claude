# Richard's Actielijst

Persoonlijke todo-list SPA — vanilla JS, geen framework. Draait op `anderspel.nl/Actielijst/`.

## Bestanden updaten op de server

Na wijzigingen op deze branch, download en upload deze 3 bestanden:

- `app.js`
- `index.html`
- `style.css`

**Niet aankomen:** `save.php`, `debug.php`, `.htaccess`, `firebaseconfig.js` (ongewijzigd) en zeker niet `data.json` (dat is de live data op de server).

Na uploaden: hard verversen in de browser (Ctrl+Shift+R), anders blijft de oude `app.js`/`style.css` in de cache hangen.

## Acties toevoegen via een link

Basis — alleen een omschrijving, komt in de master:

```
https://anderspel.nl/Actielijst/?taak=Rody+bellen
```

Spaties worden `+` of `%20`.

### Alle opties

| Parameter | Waarden | Standaard |
|---|---|---|
| `taak` | de omschrijving — **verplicht**, zonder deze doet de link niks | – |
| `thema` | `IURC` `AI` `Innovatie` `DHM` `TD` `EU` `Spreker` `Overig` | `Overig` |
| `type` | `zakelijk` `prive` | `zakelijk` |
| `periode` | `A` (nu) `B` (<2 weken) `C` (>2 weken) | `B` |
| `grootte` | `K` (<1u) `M` (2-3u) `L` (4-8u) `XL` (>8u) | `M` |
| `prio` | `1` t/m `10` | `5` |
| `tijdstip` | `HH:MM`, bijv. `14:30` | geen |
| `notities` | vrije tekst | leeg |
| `dag` | `vandaag` → zet hem óók meteen op de Dag-tab | alleen master |

### Voorbeelden

Volledig ingevuld, direct op vandaag:

```
https://anderspel.nl/Actielijst/?taak=Motie+haven+afmaken&thema=DHM&periode=A&grootte=L&prio=1&dag=vandaag
```

Met tijdstip en notitie:

```
https://anderspel.nl/Actielijst/?taak=Bellen+met+Michel&thema=Innovatie&tijdstip=10:15&notities=Over+CCAM+budget&dag=vandaag
```

Privé-klusje:

```
https://anderspel.nl/Actielijst/?taak=Nagels+knippen&type=prive&dag=vandaag
```

### Let op

- Na het toevoegen haalt de app de parameters uit de adresbalk weg, dus als je daarna ververst krijg je geen dubbele taak.
- Elke keer dat je de link opent maakt hij wél een nieuwe taak aan — dus niet als bladwijzer gebruiken voor iets dat maar één keer moet.
