"""Battle screen + focus widget checks (partner vs wild Pokemon)."""
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = APP / "tests" / "out"
results = []


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def serve():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def start_focus(page, base, pokemon_id=143, minutes=25):
    page.goto(f"{base}#/focus?id={pokemon_id}")
    page.wait_for_timeout(200)
    page.uncheck("#notify")
    page.click(f"label:has(input[value='{minutes}'])")
    page.click("[data-f=start]")
    page.wait_for_timeout(400)


def main():
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-proxy-server"])

        # ---- with a partner (Charmander), desktop
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base}#/habits")
        page.wait_for_timeout(300)
        page.click("[data-partner='4']")
        page.wait_for_timeout(300)
        start_focus(page, base)
        check("battle shows wild Snorlax card", "Snorlax" in page.inner_text(".combatant.foe .sc-name"))
        check("battle shows partner Charmander card", "Charmander" in page.inner_text(".combatant.ally .sc-name"))
        check("partner sprite faces the foe (mirrored)", "matrix(-1" in page.eval_on_selector("#ally-sprite", "e => getComputedStyle(e).transform"))
        check("timer visible", page.is_visible("#timer"))
        check("widget hidden on Focus page", page.is_hidden("#focus-widget"))
        page.screenshot(path=str(OUT / "battle_1440.png"))

        page.evaluate("PocketDex.state().focus.start -= 61000")
        page.wait_for_timeout(900)
        check("one minute in: foe HP below 100%", page.evaluate("parseFloat(document.querySelector('#hp').style.width)") < 97)
        check("one minute in: partner XP note shows level progress and +5 this session", page.inner_text("#xp-note").endswith("+5 this session") and " XP " in page.inner_text("#xp-note"), page.inner_text("#xp-note"))
        check("one minute in: foe hit animation played", page.evaluate("document.querySelector('#foe-sprite').classList.contains('hit')"))

        page.goto(f"{base}#/today")
        page.wait_for_timeout(700)
        check("widget visible on Today during focus", page.is_visible("#focus-widget"))
        widget_text = page.inner_text("#focus-widget")
        check("widget names the foe and partner", "Snorlax" in widget_text and "Charmander" in widget_text, widget_text)
        check("widget countdown ticks", ":" in page.inner_text("#focus-widget .fw-time"))
        page.screenshot(path=str(OUT / "widget_today_1440.png"))
        page.goto(f"{base}#/dex")
        page.wait_for_timeout(500)
        check("widget stays visible on Pokedex", page.is_visible("#focus-widget"))
        page.click("#focus-widget")
        page.wait_for_timeout(500)
        check("tapping widget opens Focus", page.evaluate("location.hash") == "#/focus")

        page.click("[data-f=pause]")
        page.wait_for_timeout(300)
        page.goto(f"{base}#/habits")
        page.wait_for_timeout(600)
        check("paused state shows in widget", page.evaluate("document.querySelector('#focus-widget').classList.contains('is-paused')"))
        page.goto(f"{base}#/focus")
        page.wait_for_timeout(300)
        page.click("[data-f=pause]")
        page.wait_for_timeout(300)

        page.goto(f"{base}#/today")
        page.wait_for_timeout(300)
        page.evaluate("PocketDex.state().focus.start -= 25 * 60000")
        page.wait_for_timeout(1200)
        check("finished session caught Snorlax", page.evaluate("!!PocketDex.state().caught[143]"))
        check("widget hides after the session ends", page.is_hidden("#focus-widget"))
        context.close()

        # ---- phone width, no partner
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        start_focus(page, base, pokemon_id=25, minutes=15)
        check("no-partner state offers Choose a partner", "Choose a partner" in page.inner_text(".combatant.ally"))
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
        check("battle fits 390px without sideways scroll", not overflow)
        page.screenshot(path=str(OUT / "battle_390.png"), full_page=True)
        page.goto(f"{base}#/today")
        page.wait_for_timeout(600)
        box = page.eval_on_selector("#focus-widget", "e => e.getBoundingClientRect().toJSON()")
        tab = page.eval_on_selector(".tabbar", "e => e.getBoundingClientRect().toJSON()")
        check("phone widget sits above the tab bar", box["bottom"] <= tab["top"] + 1, (box, tab))
        check("phone widget fits the screen", box["left"] >= 0 and box["right"] <= 390, box)
        page.screenshot(path=str(OUT / "widget_today_390.png"))
        context.close()
        browser.close()
    server.shutdown()
    check("no JS errors", not errors, errors)
    print(f"{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
