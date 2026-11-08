"""Pop-out (Document Picture-in-Picture) focus widget check."""
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = APP / "tests" / "out"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    errors = []
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-proxy-server"])
        context = browser.new_context(viewport={"width": 1280, "height": 860})
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base}#/habits")
        page.wait_for_timeout(300)
        page.click("[data-partner='7']")
        page.goto(f"{base}#/focus?id=1")
        page.wait_for_timeout(300)
        page.uncheck("#notify")
        page.click("[data-f=start]")
        page.wait_for_timeout(400)
        supported = page.evaluate("'documentPictureInPicture' in window")
        print("API present:", supported)
        if supported:
            page.click("[data-f=popout]")
            page.wait_for_timeout(1500)
            opened = page.evaluate("!!(window.documentPictureInPicture && documentPictureInPicture.window)")
            print("PiP window opened:", opened)
            if opened:
                info = page.evaluate("""() => {
                    const doc = documentPictureInPicture.window.document;
                    return {
                        text: doc.body.innerText,
                        time: (doc.querySelector('.fw-time') || {}).textContent,
                        foeLoaded: [...doc.images].every(i => i.complete && i.naturalWidth > 0),
                        styled: getComputedStyle(doc.querySelector('.pip-battle')).display,
                    };
                }""")
                print(info)
                ok = ok and "Bulbasaur" in info["text"] and "Squirtle" in info["text"] and info["styled"] == "grid" and info["foeLoaded"]
                page.evaluate("document.querySelector(\"[data-f=pause]\").click()")
                page.wait_for_timeout(800)
                paused_label = page.evaluate("documentPictureInPicture.window.document.querySelector('[data-fw=pause]').textContent")
                print("pip pause label after pausing in app:", paused_label)
                ok = ok and paused_label == "Resume"
                page.evaluate("documentPictureInPicture.window.document.querySelector('[data-fw=pause]').click()")
                page.wait_for_timeout(600)
                resumed = page.evaluate("PocketDex.state().focus.pausedAt === null")
                print("resume from pop-out works:", resumed)
                ok = ok and resumed
        browser.close()
    server.shutdown()
    print("errors:", errors)
    sys.exit(0 if ok and not errors else 1)


if __name__ == "__main__":
    main()
