# Plaatjes voor vmware_login.py

Zet in deze map de screenshotjes (PNG) van de app-tegels in de staging-omgeving.
Knip ze met het Knipprogramma (Win+Shift+S), strak om het icoon heen, en sla ze
op met **precies deze namen**:

| Bestandsnaam       | App          |
|--------------------|--------------|
| `outlook.png`      | Outlook      |
| `diva.png`         | Diva (groene D) |
| `onenote.png`      | OneNote      |
| `oracle_cloud.png` | Oracle Cloud |
| `verkenner.png`    | Verkenner    |
| `firefox.png`      | Firefox      |

Extra (nog niet in de klikvolgorde, maar makkelijk toe te voegen in `APPS`):

| Bestandsnaam  | App              |
|---------------|------------------|
| `diva_bb.png` | Diva BB (groene BB) |

## Belangrijk

- **PNG, geen JPG** — JPG comprimeert waardoor het matchen mislukt.
- Knip de plaatjes op **dezelfde pc, resolutie en Windows-schaling** als waarop
  het script draait. Verandert de schaling (bijv. van 100% naar 125%), knip dan
  alle plaatjes opnieuw.
- Installeer eenmalig `pip install opencv-python`, anders staat het zoeken op
  plaatjes uit en gebruikt het script alleen de vaste posities.
