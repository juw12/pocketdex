"""Feelings and motion: partner moods, petting, friendship, catch and level-up scenes."""
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = APP / "tests" / "out"
OUT.mkdir(exist_ok=True)
results = []


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))

# Effects remove themselves after about a second, and this check can run slower than
# that on a busy machine. Record every effect as it is added instead of polling for it.
FX_RECORDER = """
window.__fx = { added: [] };
window.__fxCount = (name) => window.__fx.added.filter((item) => item.cls.includes(name)).length;
window.__fxReset = () => { window.__fx.added = []; };
new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (!node.classList || ![...node.classList].some((c) => c.startsWith("fx-"))) continue;
            const item = { cls: node.className, html: node.innerHTML, text: node.textContent };
            window.__fx.added.push(item);
            setTimeout(() => { item.text = node.textContent; item.html = node.innerHTML; }, 0);
        }
    }
}).observe(document, { childList: true, subtree: true });  // <html> may not exist yet
"""


def new_context(browser, **options):
    context = browser.new_context(**options)
    context.set_default_timeout(90000)
    context.add_init_script(FX_RECORDER)
    return context


def serve():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-proxy-server"])
        context = new_context(browser, viewport={"width": 1280, "height": 900})
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base}#/habits")
        page.wait_for_timeout(300)
        page.click("[data-partner='25']")
        page.goto(f"{base}#/today")
        page.wait_for_timeout(700)

        check("Today partner shows a pixel emote", page.is_visible(".partner .emote svg"))
        mood = page.evaluate("PocketDex.partnerMood()")
        check("mood has an id, emote and line", mood and mood["id"] and mood["emote"] and "Pikachu" in mood["line"], mood)
        check("mood line is shown", mood["line"] in page.inner_text(".partner [data-mood-line]"))
        check("friendship row with 5 hearts", page.locator(".partner .friend-hearts i").count() == 5)
        anim = page.eval_on_selector(".partner .pet-target img", "e => getComputedStyle(e).animationName")
        check("partner sprite has a mood animation", anim not in ("", "none"), anim)
        page.screenshot(path=str(OUT / "feel_today.png"))

        page.evaluate("__fxReset()")
        page.click(".partner [data-pet]")
        page.wait_for_timeout(250)
        love = page.evaluate("PocketDex.state().partner.love")
        check("petting raises friendship", love == 2, love)
        check("petting swaps the emote to a heart", page.get_attribute(".partner .emote", "data-emote") == "heart")
        check("petting floats hearts", page.evaluate("__fxCount('fx-heart')") >= 1, page.evaluate("__fx.added"))
        check("petting changes the line", "Pikachu" in page.inner_text(".partner [data-mood-line]"))
        page.screenshot(path=str(OUT / "feel_pet.png"))
        for _ in range(12):
            page.click(".partner [data-pet]")
        love = page.evaluate("PocketDex.state().partner.love")
        check("daily petting is capped at 10 pets", love == 20, love)
        check("cap message is gentle", "content for now" in page.inner_text(".partner [data-mood-line]"))
        check("one heart filled at 20 friendship", page.locator(".partner .friend-hearts i.on").count() == 1)

        page.evaluate("__fxReset()")
        page.locator(".habit-quick input[data-habit]").first.check()
        page.wait_for_timeout(150)
        check("finishing a habit bursts sparkles", page.evaluate("__fxCount('fx-bit')") >= 6, page.evaluate("__fxCount('fx-bit')"))
        check("finishing a habit adds friendship", page.evaluate("PocketDex.state().partner.love") == 23)
        check("in-page re-render does not replay the page entrance", page.evaluate("document.querySelector('#view').classList.contains('stay')"))
        page.wait_for_timeout(2600)
        check("happy mood after a habit", page.evaluate("PocketDex.partnerMood().id") in ("happy", "proud"))

        page.goto(f"{base}#/dex/1")
        page.wait_for_timeout(400)
        mark = page.locator("button", has_text="Mark as caught")
        if mark.count():
            page.evaluate("__fxReset()")
            mark.first.click()
            page.wait_for_function("__fxCount('fx-scene') >= 1", timeout=15000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / "feel_catch_mid.png"))
            scenes = page.evaluate("__fx.added.filter((item) => item.cls.includes('fx-scene'))")
            catch = next((item for item in scenes if "catch" in item["cls"]), None)
            check("catch scene appears", catch, scenes)
            check("catch scene has a ball", catch and 'class="ball' in catch["html"], catch)
            check("catch scene names the Pokemon", catch and "Bulbasaur" in catch["text"], catch)
            try:
                page.wait_for_function("!document.querySelector('#fx .fx-scene')", timeout=15000)
                left = True
            except Exception:
                left = False
            check("catch scene leaves on its own", left)
        else:
            check("Mark as caught button exists", False)

        page.evaluate("PocketDex.state().partner.xp = 215")
        page.goto(f"{base}#/today")
        page.wait_for_timeout(300)
        page.evaluate("__fxReset()")
        page.locator(".habit-quick input[data-habit]").nth(1).check()
        try:
            page.wait_for_function("__fx.added.some((item) => item.cls.includes('fx-scene') && item.cls.includes('level'))", timeout=15000)
            levelled = True
        except Exception:
            levelled = False
        check("level-up scene appears", levelled, page.evaluate("__fx.added.map((item) => item.cls)"))
        page.screenshot(path=str(OUT / "feel_level.png"))

        page.goto(f"{base}#/habits")
        page.wait_for_timeout(500)
        check("Training partner shows mood and friendship", page.is_visible("#partner-panel .emote") and page.is_visible("#partner-panel .friend"))

        page.evaluate("PocketDex.state().lastVisit = '2020-01-01'; localStorage.setItem('pocketdex.v1', JSON.stringify(PocketDex.state()))")
        page.reload()
        page.wait_for_timeout(700)
        check("coming back after days away: partner missed you", page.evaluate("PocketDex.partnerMood().id") == "missed", page.evaluate("PocketDex.partnerMood()"))
        page.screenshot(path=str(OUT / "feel_missed.png"))

        reduced = new_context(browser, viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
        rpage = reduced.new_page()
        rpage.goto(f"{base}#/habits")
        rpage.wait_for_timeout(300)
        rpage.click("[data-partner='4']")
        rpage.goto(f"{base}#/today")
        rpage.wait_for_timeout(400)
        rpage.click(".partner [data-pet]")
        rpage.wait_for_timeout(100)
        check("reduced motion: no floating effects", rpage.evaluate("__fxCount('fx-heart') + __fxCount('fx-bit')") == 0)
        r_anim = rpage.eval_on_selector(".partner .pet-target img", "e => getComputedStyle(e).animationName")
        check("reduced motion: sprite holds still", r_anim == "none", r_anim)
        phone = new_context(browser, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        mpage = phone.new_page()
        mpage.on("pageerror", lambda exc: errors.append(str(exc)))
        mpage.goto(f"{base}#/habits")
        mpage.wait_for_timeout(300)
        mpage.click("[data-partner='7']")
        mpage.goto(f"{base}#/today")
        mpage.wait_for_timeout(600)
        mpage.eval_on_selector(".partner", "e => e.scrollIntoView({ block: 'center' })")
        box = mpage.locator(".partner").bounding_box()
        emote_box = mpage.locator(".partner .emote").bounding_box()
        check("phone: partner card fits the screen", box and box["x"] >= 0 and box["x"] + box["width"] <= 390, box)
        check("phone: emote stays inside the card", emote_box and box and emote_box["x"] + emote_box["width"] <= box["x"] + box["width"], (emote_box, box))
        mpage.tap(".partner [data-pet]")
        mpage.wait_for_timeout(200)
        check("phone: tapping pets the partner", mpage.evaluate("PocketDex.state().partner.love") == 2)
        mpage.screenshot(path=str(OUT / "feel_phone.png"))
        check("no page errors", not errors, errors)
        browser.close()
    server.shutdown()
    print(f"\n{sum(results)}/{len(results)} feel checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
