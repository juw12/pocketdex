"""Desktop buddy link: the web app talks to the real PocketDex Buddy link server (no Tk window)."""
import functools
import http.server
import importlib.machinery
import importlib.util
import queue
import socketserver
import sys
import threading
import time
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


def serve():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def load_buddy():
    path = APP / "desktop" / "pocketdex_buddy.pyw"
    loader = importlib.machinery.SourceFileLoader("pocketdex_buddy", str(path))
    spec = importlib.util.spec_from_loader("pocketdex_buddy", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def drain(inbox, wait=1.2):
    time.sleep(wait)
    items = []
    while True:
        try:
            items.append(inbox.get_nowait())
        except queue.Empty:
            return items


def main():
    buddy = load_buddy()
    inbox = queue.Queue()
    try:
        link = buddy.start_link(inbox)
    except OSError:
        print("FAIL port 47615 is busy (quit PocketDex Buddy before running this check)")
        return 1
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-proxy-server"])
        context = browser.new_context(viewport={"width": 1280, "height": 860})
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{base}#/habits")
        page.wait_for_timeout(300)
        page.click("[data-partner='4']")
        page.wait_for_timeout(300)
        page.goto(f"{base}#/focus?id=143")
        page.wait_for_timeout(200)
        page.uncheck("#notify")
        page.click("label:has(input[value='25'])")
        page.click("[data-f=start]")
        check("buddy off by default: nothing is sent", drain(inbox) == [])
        page.click("[data-f=end]") if page.query_selector("[data-f=end]") else None
        page.evaluate("PocketDex.state().focus = null")

        page.goto(f"{base}#/trainer")
        page.wait_for_timeout(300)
        check("Trainer shows the Desktop buddy setting", page.is_visible("#set-buddy"))
        check("download link points at the buddy app", page.get_attribute(".buddy-help a", "href") == "desktop/pocketdex_buddy.pyw")
        page.check("#set-buddy")
        page.wait_for_timeout(1200)
        check("status says Connected", "Connected" in page.inner_text("#buddy-status"), page.inner_text("#buddy-status"))
        sent = drain(inbox, 0.6)
        check("partner sent on switch-on", any(m.get("partner", {}) and m["partner"]["id"] == 4 for m in sent), sent)
        first = sent[-1] if sent else {}
        check("partner carries name and level", first.get("partner", {}).get("name") == "Charmander" and first["partner"]["level"] >= 1, first)
        check("payload passes the buddy's own validation", buddy.clean_state(first)["partner"]["id"] == 4 if first else False)

        page.goto(f"{base}#/focus?id=143")
        page.wait_for_timeout(200)
        page.uncheck("#notify")
        page.click("label:has(input[value='25'])")
        page.click("[data-f=start]")
        sent = drain(inbox)
        focus_msgs = [m for m in sent if m.get("focus")]
        check("focus start sends the wild Pokemon", focus_msgs and focus_msgs[-1]["focus"]["foe"]["id"] == 143, sent)
        if focus_msgs:
            focus = focus_msgs[-1]["focus"]
            check("focus has minutes and time left", focus["minutes"] == 25 and 1_400_000 < focus["remainMs"] <= 1_500_000, focus)
            check("focus foe has name and level", focus["foe"]["name"] == "Snorlax" and focus["foe"]["level"] >= 3, focus)
            check("focus not paused", focus["paused"] is False)

        page.click("[data-f=pause]")
        sent = drain(inbox)
        check("pause is sent", any(m.get("focus") and m["focus"]["paused"] for m in sent), sent)
        page.click("[data-f=pause]")
        sent = drain(inbox)
        check("resume is sent", any(m.get("focus") and not m["focus"]["paused"] for m in sent), sent)

        page.evaluate("PocketDex.state().focus.start -= 25 * 60000")
        page.wait_for_timeout(1500)
        sent = drain(inbox)
        caught = [m for m in sent if m.get("event")]
        check("finishing sends a caught event", caught and caught[-1]["event"]["type"] == "caught" and caught[-1]["event"]["pokemon"]["id"] == 143, sent)
        check("battle cleared after catch", caught and caught[-1]["focus"] is None)

        page.goto(f"{base}#/focus?id=16")
        page.wait_for_timeout(200)
        page.uncheck("#notify")
        page.click("[data-f=start]")
        drain(inbox, 0.8)
        page.goto(f"{base}#/trainer")
        page.wait_for_timeout(300)
        page.uncheck("#set-buddy")
        sent = drain(inbox)
        check("switching off clears the desktop battle (last message)", sent and sent[-1].get("focus") is None and sum(1 for m in sent if m.get("focus") is None) == 1, sent)
        page.evaluate("PocketDex.state().settings.sound = !PocketDex.state().settings.sound")
        page.click("#set-sound")
        check("nothing more is sent while off", drain(inbox) == [])
        check("no page errors", not errors, errors)
        browser.close()
    link.shutdown()
    server.shutdown()
    print(f"\n{sum(results)}/{len(results)} buddy checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
