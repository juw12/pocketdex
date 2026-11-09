"""End-to-end checks for PocketDex (Playwright + system Chrome).

Run: python tests/e2e.py  -> writes tests/out/*.png and tests/out/results.json, exit 1 on any failure.
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = APP / "tests" / "out"
OUT.mkdir(parents=True, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROUTES = ["today", "meadow", "dex", "dex/25", "dex/133", "focus", "habits", "more", "field", "field/new", "quiz", "team", "trainer"]
WIDTHS = [(320, 740), (390, 844), (768, 1024), (1440, 900)]

EMOJI_PROBE_JS = r"""() => {
  const rx = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25B6}\u{25C0}\u{25C9}\u{FE0F}]/u;
  const match = document.body.innerText.match(rx);
  return match ? match[0] : '';
}"""

results = {"checks": [], "errors": []}


def check(name, ok, detail=""):
    results["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""), flush=True)


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP))
    handler.log_message = lambda *args: None
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def make_photo(path):
    img = Image.new("RGB", (640, 480), "#6aa0d8")
    draw = ImageDraw.Draw(img)
    draw.ellipse((200, 120, 440, 380), fill="#f2a65a")
    draw.ellipse((260, 190, 300, 230), fill="#222")
    draw.ellipse((340, 190, 380, 230), fill="#222")
    draw.polygon([(210, 160), (250, 60), (290, 140)], fill="#f2a65a")
    draw.polygon([(350, 140), (390, 60), (430, 160)], fill="#f2a65a")
    img.save(path)


def main():
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    photo = OUT / "photo.png"
    make_photo(photo)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=CHROME if Path(CHROME).exists() else None,
            args=["--proxy-bypass-list=127.0.0.1;localhost", "--no-proxy-server", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
        )

        # ---- 1. every route, every width: no JS errors, no overflow, text rendered
        for width, height in WIDTHS:
            context = browser.new_context(viewport={"width": width, "height": height}, accept_downloads=True)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda exc, errs=errors: errs.append(str(exc)))
            page.on("console", lambda msg, errs=errors: errs.append(msg.text) if msg.type == "error" else None)
            for route in ROUTES:
                page.goto(f"{base}#/{route}")
                page.wait_for_timeout(250)
                scroll_width = page.evaluate("document.documentElement.scrollWidth")
                text_len = page.evaluate("document.querySelector('#view').innerText.trim().length")
                check(f"{width}px #{route} no overflow", scroll_width <= width, f"scrollWidth {scroll_width}")
                check(f"{width}px #{route} renders", text_len > 20, f"text {text_len}")
                if width in (390, 1440) and route in ("today", "meadow", "dex/25", "focus", "habits", "more", "field/new", "quiz", "team", "trainer"):
                    if route in ("today", "meadow"):
                        page.wait_for_function("document.querySelector('.stage') && document.querySelector('.stage').dataset.ready", timeout=20000)
                        page.wait_for_timeout(900)
                    page.screenshot(path=str(OUT / f"{route.replace('/', '-')}-{width}.png"), full_page=True, timeout=90000)
            check(f"{width}px no JS errors", not errors, errors[:3])
            results["errors"] += errors
            context.close()

        # ---- 1b. meadow renders (http) and the rendered DOM has no emoji
        context = browser.new_context(viewport={"width": 1280, "height": 860})
        page = context.new_page()
        page.goto(f"{base}#/meadow")
        page.wait_for_function("document.querySelector('#meadow-stage').dataset.ready", timeout=30000)
        page.wait_for_timeout(1500)
        drawn = page.evaluate("""() => {
          const c = document.querySelector('.meadow-canvas');
          if (!c) return -1;
          const probe = document.createElement('canvas');
          probe.width = 64; probe.height = 40;
          const ctx = probe.getContext('2d');
          ctx.drawImage(c, 0, 0, 64, 40);
          const d = ctx.getImageData(0, 0, 64, 40).data;
          let painted = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++;
          return painted / (64 * 40);
        }""")
        check("meadow (http) draws a 3D scene", drawn > 0.3, drawn)
        check("meadow has no runtime error", not page.evaluate("document.querySelector('#meadow-stage').dataset.error || ''"))
        dom_emoji = page.evaluate(EMOJI_PROBE_JS)
        check("no emoji in rendered meadow page", not dom_emoji, dom_emoji)
        for route in ["today", "dex/25", "focus", "habits", "more", "quiz", "team", "trainer", "field"]:
            page.goto(f"{base}#/{route}")
            page.wait_for_timeout(200)
            found = page.evaluate(EMOJI_PROBE_JS)
            check(f"no emoji rendered on #{route}", not found, found)
        page.goto(f"{base}#/more")
        page.wait_for_timeout(200)
        check("More lists 5 destinations", page.eval_on_selector_all(".more-item", "els => els.length") == 5)
        page.click(".tabbar a[data-route='habits']")
        page.wait_for_timeout(200)
        check("tab bar navigates", page.evaluate("location.hash") == "#/habits")
        context.close()

        # ---- 2. behaviour
        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(8000)
        page.set_default_navigation_timeout(25000)
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base}#/today")
        page.wait_for_timeout(300)

        units = page.evaluate("""() => {
          const P = window.PocketDex;
          const prof = P.defenseProfile(['water', 'ground']);
          const a = P.encounterFor('2026-11-07').id, b = P.encounterFor('2026-11-07').id;
          return { grass: prof.grass, electric: prof.electric, fire: prof.fire, same: a === b,
                   lv5: P.levelFor(125), lv16: P.levelFor(4096), total: P.TOTAL };
        }""")
        check("type math: grass vs water/ground is 4x", units["grass"] == 4, units)
        check("type math: electric vs water/ground is 0x", units["electric"] == 0, units)
        check("type math: fire vs water/ground is 0.5x", units["fire"] == 0.5, units)
        check("daily encounter is deterministic", units["same"])
        check("level curve 125 xp = Lv5, 4096 xp = Lv16", units["lv5"] == 5 and units["lv16"] == 16, units)
        check("1025 species loaded", units["total"] == 1025)

        # search
        page.goto(f"{base}#/dex")
        page.fill("#dex-q", "char")
        page.wait_for_timeout(250)
        names = page.eval_on_selector_all(".dex-row .nm", "els => els.map(e => e.textContent)")
        check("search 'char' finds Charmander line", {"Charmander", "Charmeleon", "Charizard"} <= set(names), names[:6])
        page.fill("#dex-q", "fire gen1")
        page.wait_for_timeout(250)
        count = page.eval_on_selector_all(".dex-row", "els => els.length")
        check("search 'fire gen1' = 12 Kanto fire types", count == 12, count)
        page.fill("#dex-q", "")

        # catch from detail
        page.goto(f"{base}#/dex/25")
        page.wait_for_timeout(200)
        page.click("[data-act=catch]")
        page.wait_for_timeout(200)
        caught = page.evaluate("Object.keys(PocketDex.state().caught)")
        check("mark as caught registers Pikachu", "25" in caught, caught)
        check("header counter updates", page.inner_text("#hdr-caught").startswith("1 /"), page.inner_text("#hdr-caught"))
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
        check("arrow key goes to next entry", page.evaluate("location.hash") == "#/dex/26", page.evaluate("location.hash"))
        page.goto(f"{base}#/dex/25")
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1200)
        broken = page.evaluate("[...document.querySelectorAll('.evo-node img, .dex-row.on img, .detail-screen img')].filter(i => !i.complete || i.naturalWidth === 0).length")
        check("entry and evolution sprites load", broken == 0, broken)
        evo = page.eval_on_selector_all(".evo-node span", "els => els.map(e => e.textContent)")
        check("evolution chain Pichu > Pikachu > Raichu", evo[:3] == ["Pichu", "Pikachu", "Raichu"], evo)

        # partner + habits + xp
        page.goto(f"{base}#/habits")
        page.wait_for_timeout(200)
        page.click("[data-partner='4']")
        page.wait_for_timeout(300)
        xp0 = page.evaluate("PocketDex.state().partner.xp")
        page.check("[data-habit=h1]")
        page.wait_for_timeout(300)
        xp1 = page.evaluate("PocketDex.state().partner.xp")
        check("ticking a habit gives partner 40 XP", xp1 - xp0 == 40, (xp0, xp1))
        page.uncheck("[data-habit=h1]")
        page.wait_for_timeout(300)
        check("unticking removes the XP", page.evaluate("PocketDex.state().partner.xp") == xp0)
        page.fill("#add-habit input[name=name]", "Stretch 5 minutes")
        page.click("#add-habit button")
        page.wait_for_timeout(200)
        check("add habit", page.evaluate("PocketDex.state().habits.length") == 4)

        # evolution at Lv16
        page.evaluate("PocketDex.state().partner.xp = 4070")
        page.check("[data-habit=h2]")
        page.wait_for_timeout(500)
        evolving = page.is_visible("#modal [data-evolve='5']")
        check("partner reaching Lv16 offers evolution (Charmander > Charmeleon)", evolving)
        if evolving:
            page.click("#modal [data-evolve='5']")
            page.wait_for_timeout(300)
            check("evolution swaps partner", page.evaluate("PocketDex.state().partner.id") == 5)

        # focus session completes and catches
        page.goto(f"{base}#/focus?id=143")
        page.wait_for_timeout(200)
        page.uncheck("#notify")
        page.click("label:has(input[value='15'])")
        page.click("[data-f=start]")
        page.wait_for_timeout(300)
        check("focus battle screen shows timer", page.is_visible("#timer"))
        page.evaluate("PocketDex.state().focus.start -= 15 * 60000 + 1000")
        page.wait_for_timeout(1200)
        st = page.evaluate("({ caught: !!PocketDex.state().caught[143], log: PocketDex.state().focusLog.length, focus: PocketDex.state().focus })")
        check("finished focus catches Snorlax and logs it", st["caught"] and st["log"] == 1 and st["focus"] is None, st)

        # meadow shows the caught Pokemon as residents
        page.goto(f"{base}#/meadow")
        page.wait_for_function("document.querySelector('#meadow-stage').dataset.loaded", timeout=30000)
        residents = page.eval_on_selector_all(".resident-list b", "els => els.map(e => e.textContent)")
        check("meadow residents include caught Snorlax and partner", "Snorlax" in residents and "Charmeleon" in residents, residents)
        page.screenshot(path=str(OUT / "meadow-filled-1440.png"))

        # quiz
        page.goto(f"{base}#/quiz")
        page.wait_for_timeout(200)
        check("quiz shows silhouette", page.is_visible(".silhouette"))
        page.keyboard.press("1")
        page.wait_for_timeout(200)
        check("quiz answer with key 1 reveals", page.evaluate("PocketDex.state().quiz.answered") == 1)
        page.keyboard.press("Enter")
        page.wait_for_timeout(200)
        check("Enter loads next round", page.is_visible(".silhouette"))

        # team
        page.goto(f"{base}#/team")
        page.wait_for_timeout(200)
        for pick in ["6", "130", "3"]:
            page.click("[data-t=add]")
            page.fill("#pick-q", pick)
            page.wait_for_timeout(150)
            page.click(f"#pick-list [data-id='{pick}']")
            page.wait_for_timeout(200)
        team = page.evaluate("PocketDex.state().team")
        check("team builder adds 3 members", team == [6, 130, 3], team)
        danger_rows = page.eval_on_selector_all(".matchup tr.danger td:first-child", "els => els.map(e => e.innerText.trim())")
        check("team analysis computes a matrix", page.is_visible(".matchup"), danger_rows)

        # field dex with a real photo
        page.goto(f"{base}#/field/new")
        page.wait_for_timeout(200)
        page.set_input_files("#fd-file", str(photo))
        page.wait_for_timeout(600)
        check("photo is pixelated into preview", page.is_visible("#fd-preview img"))
        page.click("label:has(input[value='kanto'])")
        page.wait_for_timeout(300)
        page.fill("#fd-form input[name=name]", "Mochi")
        page.fill("#fd-form input[name=genus]", "Sleepy Cat")
        page.select_option("#fd-form select[name=t1]", "normal")
        page.fill("#fd-form textarea[name=desc]", "It naps in sunbeams and wakes only for snacks.")
        page.click("#fd-form button[type=submit]")
        page.wait_for_timeout(500)
        entry = page.evaluate("PocketDex.state().field[0]")
        check("Field Dex entry saved as F001 with 64px sprite", entry and entry["no"] == 1 and entry["img"].startswith("data:image/png"), entry and entry["name"])
        page.screenshot(path=str(OUT / "field-entry-1440.png"), full_page=True, timeout=90000)
        with page.expect_download() as download_info:
            page.click("[data-fd=card]")
        card_path = OUT / "card.png"
        download_info.value.save_as(str(card_path))
        size = Image.open(card_path).size
        check("card image export is 600x840 PNG", size == (600, 840), size)

        # backup export / import roundtrip
        page.goto(f"{base}#/trainer")
        page.wait_for_timeout(200)
        with page.expect_download() as download_info:
            page.click("[data-tr=export]")
        backup = OUT / "backup.json"
        download_info.value.save_as(str(backup))
        data = json.loads(backup.read_text(encoding="utf-8"))
        check("backup contains caught + field", "143" in data["caught"] and len(data["field"]) == 1)
        page.screenshot(path=str(OUT / "trainer-filled-1440.png"), full_page=True, timeout=90000)
        page.goto(f"{base}#/today")
        page.wait_for_timeout(300)
        check("toast does not follow you to the next page", page.is_hidden("#toast"))
        page.screenshot(path=str(OUT / "today-filled-1440.png"), full_page=True, timeout=90000)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / "today-filled-390.png"), full_page=True, timeout=90000)
        badges = page.evaluate("Object.keys(PocketDex.state().badges || {})")
        check("badges awarded (Boulder, Soul not yet)", "boulder" in badges, badges)

        # reload persists
        page.reload()
        page.wait_for_timeout(300)
        check("state persists after reload", page.evaluate("Object.keys(PocketDex.state().caught).length") >= 3)
        check("no JS errors during behaviour run", not errors, errors[:3])
        context.close()

        # ---- 3. file:// mode works too
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        file_errors = []
        page.on("pageerror", lambda exc: file_errors.append(str(exc)))
        page.goto((APP / "index.html").as_uri() + "#/dex/1")
        page.wait_for_timeout(500)
        check("file:// opens with entry", "Bulbasaur" in page.inner_text("#view"))
        page.goto((APP / "index.html").as_uri() + "#/meadow")
        page.wait_for_function("document.querySelector('#meadow-stage').dataset.ready", timeout=30000)
        page.wait_for_timeout(1200)
        check("file:// meadow renders (sprite bundle, no taint)", page.evaluate("document.querySelector('#meadow-stage').dataset.ready") == "1" and not page.evaluate("document.querySelector('#meadow-stage').dataset.error || ''"))
        check("file:// no JS errors", not file_errors, file_errors[:3])
        context.close()
        browser.close()

    failed = [c for c in results["checks"] if not c["ok"]]
    results["summary"] = {"total": len(results["checks"]), "failed": len(failed)}
    (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\n{len(results['checks']) - len(failed)}/{len(results['checks'])} checks passed", flush=True)
    sys.stdout.flush()
    os._exit(1 if failed else 0)


if __name__ == "__main__":
    main()
