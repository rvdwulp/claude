"""
VMware login + apps openen — geautomatiseerd met pyautogui.

Gebruik:
    python vmware_login.py          -> alle stappen
    python vmware_login.py 1        -> alleen stap 1 (VMware + login)
    python vmware_login.py 2        -> alleen stap 2 (clipboard -> openHAB)
    python vmware_login.py 3        -> alleen stap 3 (apps openen)
    python vmware_login.py teams    -> alleen Teams openen

Wachtwoord instellen (kies één van beide, NIET in de code zetten):
    - omgevingsvariabele VMWARE_WACHTWOORD, of
    - het script vraagt er bij de start om (onzichtbaar, via getpass).
"""

import os
import sys
import time
import getpass

import requests
import pyautogui
import pygetwindow as gw
import pyperclip

try:
    from screeninfo import get_monitors  # pip install screeninfo
except ImportError:
    get_monitors = None

# ================== CONFIG — alles wat je aanpast staat hier ==================

EMAIL = "125336@rotterdam.nl"
TEAMS_URL = "https://teams.microsoft.com/v2/"

# openHAB
OPENHAB_URL = "http://192.168.1.74:8080/rest/items/Code/state"
OPENHAB_TOKEN = ""          # optioneel: API-token
OPENHAB_TIMEOUT = 8

# Wachttijden (seconden)
PAUZE = 3            # standaard pauze tussen acties in stap 1
PAUZE_STAP3 = 10     # pauze tussen app-kliks in stap 3
PAUZE_STAGING = 2    # korte pauze na staging-klik
WACHT_NA_STAP2 = 180 # wachttijd tussen stap 2 en stap 3
EXTRA_WACHT = 300    # eenmalige extra wachttijd in stap 3
EXTRA_NA_INDEX = 2   # na de hoeveelste app (index) de extra wachttijd komt

# Coördinaten stap 1 (VMware + login)
COORD_VMWARE_ICOON   = (49, 456)
COORD_VMWARE_SERVER  = (454, 317)
COORD_LOGIN_VELD     = (914, 493)
COORD_LOGIN_KNOP     = (947, 608)
COORD_ACCOUNT_KIEZEN = (953, 550)
COORD_LAATSTE_LOCATIE = (958, 552)

# Stap 3: het app-raster in de staging-omgeving.
# Kolommen x: 397, 578, 759, 940, 1121, 1302, 1483
# Rijen   y: 372 (rij 1), 585 (rij 2), 798 (rij 3)
#
# Indeling per 2 sept 25:
# Rij 1: Adobe Reader | Afmelden Sessie | Diva | Diva BB | Email config | Kladblok | Excel
# Rij 2: Knipprogramma | OneNote | Outlook | Word | Mijn Shuttel | MijnHR | Firefox
# Rij 3: Oracle EBS | Oracle Fusion | PDF-XChange | PDF-XTools | Verkenner
APPS = [
    ("Outlook",      (759, 585)),
    ("Diva",         (759, 372)),
    ("OneNote",      (578, 585)),
    ("Oracle Cloud", (578, 798)),
    ("Verkenner",    (1121, 798)),
    ("Firefox",      (1483, 585)),
]

# Chrome-focus opties
USE_TASKBAR_HOTKEY = False  # True als Chrome op taakbalkpositie 1 staat (Win+1)
USE_OMNIBOX_FOCUS = True    # Ctrl+L en Esc na activeren, zodat een klik veilig is

# ==============================================================================

pyautogui.FAILSAFE = True   # muis naar linksboven = noodstop
pyautogui.PAUSE = 0.2


# ================== Helpers ==================

def now():
    return time.strftime("%H:%M:%S")


def log(msg):
    print(f"[{now()}] {msg}")


def wacht(seconden, reden=""):
    """Wacht met aftellende voortgang, zodat je ziet dat het script leeft."""
    if reden:
        log(f"⏳ {reden} ({seconden}s)…")
    rest = int(seconden)
    stap = 5 if rest > 15 else rest
    while rest > 0:
        if rest % 30 == 0 or rest <= 15:
            log(f"   … nog {rest}s")
        t = min(stap, rest)
        time.sleep(t)
        rest -= t


def klik(x, y, label="", dubbel=False, move_duration=0.25):
    """Eén klik-functie voor alles: checkt schermgrenzen, logt, en kan dubbelklikken."""
    w, h = pyautogui.size()
    if not (0 <= x < w and 0 <= y < h):
        log(f"⚠️ Punt buiten scherm overgeslagen: {label} @ ({x},{y})")
        return False
    pyautogui.moveTo(x, y, duration=move_duration)
    if dubbel:
        pyautogui.doubleClick()
    else:
        pyautogui.click()
    log(f"✅ {'Dubbelklik' if dubbel else 'Klik'}: {label} @ ({x},{y})")
    return True


def typ(tekst, interval=0.05):
    """Typ tekst. Voor tekens die pyautogui niet kan typen (bijv. é, €) wordt geplakt."""
    if tekst.isascii():
        pyautogui.write(tekst, interval=interval)
    else:
        oud = pyperclip.paste()
        pyperclip.copy(tekst)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.2)
        pyperclip.copy(oud)  # klembord terugzetten


def get_wachtwoord():
    """Haal het wachtwoord uit de omgevingsvariabele, of vraag er onzichtbaar om."""
    ww = os.environ.get("VMWARE_WACHTWOORD")
    if not ww:
        ww = getpass.getpass("Wachtwoord (wordt niet getoond): ")
    return ww


# ================== Console naar 2e scherm ==================

def get_second_screen_left_x(default_left=1920):
    if get_monitors:
        mons = get_monitors()
        if len(mons) >= 2:
            return max(mons, key=lambda m: m.x).x
    return default_left


def move_console_to_second_screen(pad=10, breedte=1800, hoogte=1000):
    """Verplaats het consolevenster naar het 2e scherm (alleen Windows)."""
    if sys.platform != "win32":
        return
    import ctypes
    kernel32 = ctypes.windll.kernel32

    # Unieke titel zetten zodat we het juiste venster vinden
    old_title_buf = ctypes.create_unicode_buffer(1024)
    kernel32.GetConsoleTitleW(old_title_buf, 1024)
    old_title = old_title_buf.value
    unique_title = f"Console-{os.getpid()}"
    kernel32.SetConsoleTitleW(unique_title)
    time.sleep(0.2)  # geef Windows even de tijd om de titel door te voeren

    win = next((w for w in gw.getAllWindows() if w.title == unique_title), None)
    if old_title:
        kernel32.SetConsoleTitleW(old_title)

    if not win:
        log("⚠️ Consolevenster niet gevonden.")
        return

    try:
        second_left = get_second_screen_left_x()
        win.restore()
        time.sleep(0.1)
        win.moveTo(second_left + pad, pad)
        win.resizeTo(breedte, hoogte)
        win.activate()
        log(f"✅ Console naar 2e scherm verplaatst @ x={second_left + pad}.")
    except Exception as e:
        log(f"⚠️ Console verplaatsen mislukt: {e}")


# ================== Chrome focus helpers ==================

def get_chrome_window():
    wins = [w for w in gw.getAllWindows() if "Chrome" in (w.title or "")]
    if not wins:
        return None
    return max(wins, key=lambda w: w.width * w.height)


def bring_chrome_to_front(max_retries=4):
    for poging in range(1, max_retries + 1):
        if USE_TASKBAR_HOTKEY:
            pyautogui.hotkey("win", "1")
            time.sleep(0.3)

        win = get_chrome_window()
        if not win:
            log(f"⚠️ Geen Chrome-venster gevonden (poging {poging}/{max_retries}).")
            time.sleep(0.5)
            continue

        try:
            if win.isMinimized:
                win.restore()
                time.sleep(0.2)
            # minimaliseer/restore-truc om z-order te forceren
            win.minimize(); time.sleep(0.15); win.restore(); time.sleep(0.15)
            win.activate()
            try:
                win.maximize()
            except Exception:
                pass
            time.sleep(0.3)

            active = gw.getActiveWindow()
            if active and "Chrome" in (active.title or ""):
                if USE_OMNIBOX_FOCUS:
                    pyautogui.hotkey("ctrl", "l")
                    time.sleep(0.15)
                    pyautogui.press("esc")
                log(f"✅ Chrome actief: {active.title}")
                return active
        except Exception as e:
            log(f"⚠️ Activeren mislukt (poging {poging}): {e}")

        time.sleep(0.4)

    log("⛔ Lukt niet automatisch. Zet Chrome zelf vooraan en druk Enter…")
    try:
        input()
    except Exception:
        pass
    win = gw.getActiveWindow()
    return win if (win and "Chrome" in (win.title or "")) else None


def click_center_of_window(win, label="STAGING"):
    if not win:
        log("❌ Geen Chrome-venster actief; klik overgeslagen.")
        return False
    return klik(win.left + win.width // 2, win.top + win.height // 2, label=label)


# ================== STAP 1: VMware + login ==================

def step1_vmware_login(wachtwoord):
    log("Stap 1 start over 3 seconden… (muis naar linksboven = noodstop)")
    time.sleep(3)

    # 1) Open VMware
    klik(*COORD_VMWARE_ICOON, label="VMware-icoon", dubbel=True)
    time.sleep(PAUZE)
    klik(*COORD_VMWARE_SERVER, label="VMware-server", dubbel=True)
    time.sleep(PAUZE * 3)

    # 2) E-mailadres invullen
    klik(*COORD_LOGIN_VELD, label="loginveld")
    typ(EMAIL)
    time.sleep(PAUZE)
    klik(*COORD_LOGIN_KNOP, label="volgende-knop")
    time.sleep(PAUZE * 2)

    # 3) Account kiezen
    klik(*COORD_ACCOUNT_KIEZEN, label="account kiezen")
    time.sleep(PAUZE * 2)

    # 4) Wachtwoord
    klik(*COORD_LOGIN_KNOP, label="wachtwoordscherm")
    pyautogui.press("tab", presses=2)
    typ(wachtwoord)
    time.sleep(PAUZE)

    # 5) Inloggen bevestigen
    pyautogui.press("tab")
    pyautogui.press("enter")
    time.sleep(PAUZE)

    # 6) Laatste locatie openen en code kopiëren
    klik(*COORD_LAATSTE_LOCATIE, label="laatste locatie", dubbel=True)
    time.sleep(PAUZE)
    pyautogui.hotkey("ctrl", "c")

    log("Stap 1 klaar.")


# ================== STAP 2: Clipboard → openHAB ==================

def step2_clipboard_to_openhab():
    log("Stap 2: push clipboard naar openHAB…")

    tekst = pyperclip.paste()
    if not tekst:
        log("⚠️ Klembord is leeg; er wordt niets verstuurd.")
        return

    headers = {"Content-Type": "text/plain"}
    if OPENHAB_TOKEN:
        headers["Authorization"] = f"Bearer {OPENHAB_TOKEN}"

    try:
        resp = requests.put(
            OPENHAB_URL,
            data=tekst.encode("utf-8"),
            headers=headers,
            timeout=OPENHAB_TIMEOUT,
        )
        if resp.ok:
            log(f"✅ Verstuurd naar openHAB (HTTP {resp.status_code}).")
        else:
            log(f"⚠️ Niet gelukt (HTTP {resp.status_code}): {resp.text}")
    except requests.exceptions.RequestException as e:
        log(f"❌ Verbindingsfout: {e}")

    log("Stap 2 klaar.")


# ================== STAP 3: Staging + apps openen ==================

def step3_click_sequence():
    log("Stap 3 start (Chrome focus + staging + apps)…")

    chrome = bring_chrome_to_front()
    click_center_of_window(chrome, label="STAGING")
    wacht(PAUZE_STAGING)

    for idx, (naam, (x, y)) in enumerate(APPS):
        klik(x, y, label=naam)
        wacht(PAUZE_STAP3)

        # Terug naar staging
        chrome = bring_chrome_to_front()
        click_center_of_window(chrome, label="STAGING")
        wacht(PAUZE_STAP3)

        if idx == EXTRA_NA_INDEX:
            wacht(EXTRA_WACHT, reden="eenmalige extra wacht na de eerste drie apps")

    log("Stap 3 klaar.")


# ================== Teams in nieuw tabblad ==================

def open_teams_in_new_tab():
    log(f"Teams openen in nieuw tabblad ({TEAMS_URL})…")

    chrome = bring_chrome_to_front()
    if not chrome:
        log("❌ Chrome niet actief. Teams-navigatie overgeslagen.")
        return

    pyautogui.hotkey("ctrl", "t")
    time.sleep(1.0)
    typ(TEAMS_URL, interval=0.01)
    pyautogui.press("enter")
    wacht(5, reden="Teams laden")

    click_center_of_window(chrome, label="Teams tab focus")
    log("✅ Teams geopend.")


# ================== MAIN ==================

def main():
    stap = sys.argv[1] if len(sys.argv) > 1 else "alles"

    if stap in ("alles", "1"):
        wachtwoord = get_wachtwoord()

    move_console_to_second_screen()

    if stap in ("alles", "1"):
        step1_vmware_login(wachtwoord)
        if stap == "alles":
            wacht(3, reden="pauze voor stap 2")

    if stap in ("alles", "2"):
        step2_clipboard_to_openhab()
        if stap == "alles":
            wacht(WACHT_NA_STAP2, reden="wachten tot de sessie klaar is voor stap 3")

    if stap in ("alles", "3"):
        step3_click_sequence()

    if stap in ("alles", "teams"):
        open_teams_in_new_tab()

    log("Alles klaar.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("⛔ Gestopt met Ctrl+C.")
    except pyautogui.FailSafeException:
        log("⛔ Noodstop: muis in linksboven-hoek.")
