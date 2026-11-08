"""Fast visual smoke run: a few routes with seeded progress, console errors, screenshots to tests/out/smoke-*.png."""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = APP / "tests" / "out"
OUT.mkdir(parents=True, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
SEED = {
    "trainer": "Juwen",
    "caught": {str(i): {"d": "2026-11-0" + str(1 + i % 7), "via": "focus"} for i in [1, 4, 7, 25, 39, 52, 54, 133, 143, 175, 187, 194, 252, 393]},
    "partner": {"id": 25, "xp": 2400, "nick": ""},
    "habitLog": {},
    "focusLog": [{"d": "2026-11-08", "id": 143, "minutes": 25, "result": "caught"}],
}


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP))
    handler.log_message = lambda *args: None
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


VISIBLE_IMAGES_LOADED_JS = """() => [...document.images].filter((img) => {
  const box = img.getBoundingClientRect();
  if (box.width === 0 || box.bottom <= 0 || box.top >= window.innerHeight) return false;
  const scroller = img.closest('.dex-list, .resident-list');
  if (!scroller) return true;
  const area = scroller.getBoundingClientRect();
  return box.bottom > area.top && box.top < area.bottom;
}).every((img) => img.complete && img.naturalWidth > 0)"""


def main():
    routes = sys.argv[1].split(",") if len(sys.argv) > 1 else ["today", "meadow", "dex/25", "habits", "more"]
    widths = [int(w) for w in sys.argv[2].split(",")] if len(sys.argv) > 2 else [1440, 390]
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    report = {"errors": [], "shots": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=CHROME if Path(CHROME).exists() else None,
            args=["--no-proxy-server", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
        )
        for width in widths:
            context = browser.new_context(viewport={"width": width, "height": 900 if width > 600 else 844})
            context.add_init_script(f"localStorage.setItem('pocketdex.v1', JSON.stringify(Object.assign({{}}, {json.dumps(SEED)})))")
            page = context.new_page()
            page.on("pageerror", lambda exc: report["errors"].append(str(exc)))
            page.on("console", lambda msg: report["errors"].append(msg.text) if msg.type == "error" else None)
            for route in routes:
                page.goto(f"{base}#/{route}", wait_until="commit", timeout=90000)
                page.wait_for_selector("main .view, #view, main", timeout=60000)
                if route in ("today", "meadow"):
                    try:
                        page.wait_for_function("document.querySelector('.stage') && document.querySelector('.stage').dataset.loaded", timeout=25000)
                    except Exception as error:
                        report["errors"].append(f"stage not ready on {route}: {error}")
                    page.wait_for_timeout(1500)
                else:
                    page.wait_for_timeout(400)
                name = f"smoke-{route.replace('/', '-')}-{width}.png"
                # Capture like a tall device: hide the transient toast and grow the viewport to the page,
                # so the fixed tab bar sits at the bottom instead of being stitched mid-page.
                base_height = 900 if width > 600 else 844
                page.evaluate("document.getElementById('toast') && (document.getElementById('toast').hidden = true)")
                page_height = page.evaluate("document.documentElement.scrollHeight")
                page.set_viewport_size({"width": width, "height": max(base_height, page_height)})
                page.wait_for_timeout(600)
                # Lazy sprites inside the viewport should be loaded before the capture, as a user would see them.
                try:
                    page.wait_for_function(VISIBLE_IMAGES_LOADED_JS, timeout=15000)
                except Exception:
                    report["errors"].append(f"images still loading on {route} at {width}px")
                page.screenshot(path=str(OUT / name), timeout=120000)
                page.set_viewport_size({"width": width, "height": base_height})
                overflow = page.evaluate("document.documentElement.scrollWidth") - width
                report["shots"].append({"name": name, "overflow": overflow})
            context.close()
        browser.close()
    (OUT / "smoke.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1), flush=True)
    os._exit(0)


if __name__ == "__main__":
    main()
