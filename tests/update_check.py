"""App update notice: version check against the site, banner in the page."""
import functools
import http.server
import json
import socketserver
import sys
import tempfile
import threading
from importlib.machinery import SourceFileLoader
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
results = []


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def serve(directory):
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    app = SourceFileLoader("pocketdex_app", str(APP / "desktop" / "pocketdex_app.py")).load_module()
    bundled = json.loads((APP / "version.json").read_text(encoding="utf-8"))["version"]
    check("app reads its version from version.json", app.VERSION == bundled, (app.VERSION, bundled))
    check("version compare handles 1.10 > 1.9", app.version_tuple("1.10.0") > app.version_tuple("1.9.3"))

    site = Path(tempfile.mkdtemp())
    server = serve(site)
    url = f"http://127.0.0.1:{server.server_address[1]}/version.json"
    (site / "version.json").write_text(json.dumps({"version": "9.9.9", "windows": "https://example.invalid/x.zip", "notes": "Shiny"}), encoding="utf-8")
    newer = app.check_for_update(url)
    check("newer version on the site is reported", newer and newer["latest"] == "9.9.9" and newer["url"].endswith("x.zip"), newer)
    (site / "version.json").write_text(json.dumps({"version": bundled}), encoding="utf-8")
    check("same version is quiet", app.check_for_update(url) is None)
    check("unreachable site is quiet", app.check_for_update("http://127.0.0.1:9/version.json", timeout=1) is None)
    server.shutdown()

    web = serve(APP)
    base = f"http://127.0.0.1:{web.server_address[1]}/index.html"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-proxy-server"])
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base}#/today")
        page.wait_for_timeout(400)
        check("no banner on the website by itself", page.locator("#update-banner").count() == 0)
        page.evaluate("PocketDex.showUpdateBanner({latest: '9.9.9', url: 'https://example.invalid/x.zip', notes: 'Shiny'})")
        page.wait_for_timeout(300)
        check("banner shows the new version", "9.9.9" in page.inner_text("#update-banner"))
        check("banner links to the download in the browser", page.get_attribute("#update-banner a", "target") == "_blank")
        page.click("[data-dismiss-update]")
        check("Later hides the banner", page.locator("#update-banner").count() == 0)
        check("no page errors", not errors, errors)
        browser.close()
    web.shutdown()
    print(f"\n{sum(results)}/{len(results)} update checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
