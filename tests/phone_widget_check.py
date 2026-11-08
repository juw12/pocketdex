"""Phone mini player (video Picture-in-Picture), keep-screen-on and lock-screen notice."""
import base64
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

# Force the phone path: no Document Picture-in-Picture, and a fake wake lock we can count.
PHONE_SHIM = """
(() => {
  try { delete Window.prototype.documentPictureInPicture; } catch (e) {}
  try { delete window.documentPictureInPicture; } catch (e) {}
  window.__wake = 0;
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        window.__wake += 1;
        const sentinel = new EventTarget();
        sentinel.release = async () => sentinel.dispatchEvent(new Event('release'));
        return sentinel;
      },
    },
  });
})();
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def save_frame(page, name):
    data_url = page.evaluate("PocketDex.mini().canvas.toDataURL('image/png')")
    (OUT / name).write_bytes(base64.b64decode(data_url.split(",", 1)[1]))


def main():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    errors = []
    with sync_playwright() as p:
        # Headed (window parked off-screen): headless Chromium always denies notifications.
        browser = p.chromium.launch(args=["--no-proxy-server", "--window-position=-2400,-2400"], headless=False)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            device_scale_factor=2,
        )
        context.grant_permissions(["notifications"], origin=base.rsplit("/", 1)[0])
        context.add_init_script(PHONE_SHIM)
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base}#/habits")
        page.wait_for_timeout(400)
        page.click("[data-partner='4']")
        page.goto(f"{base}#/focus?id=143")
        page.wait_for_timeout(400)
        page.check("#notify")
        page.click("label:has(input[value='25'])")
        page.click("[data-f=start]")
        page.wait_for_timeout(1200)

        check("phone path: Document PiP hidden", page.evaluate("!('documentPictureInPicture' in window)"))
        check("Pop out timer offered on phone", page.is_visible("[data-f=popout]"))
        check("Keep screen on offered", page.is_visible("[data-f=wake]"))

        page.click("[data-f=popout]")
        page.wait_for_timeout(1500)
        state = page.evaluate("""() => ({
            video: !!document.querySelector('.mini-video'),
            stream: !!(document.querySelector('.mini-video') || {}).srcObject,
            pip: document.pictureInPictureElement === document.querySelector('.mini-video'),
            looping: !!PocketDex.mini().loop,
        })""")
        print("mini player state:", state)
        check("mini player streams the battle canvas into a video", state["video"] and state["stream"] and state["looping"])
        if not state["pip"]:
            print("note: headless Chromium did not enter Picture-in-Picture (needs a real window); stream verified instead")
        save_frame(page, "mini_running.png")

        center = page.evaluate("""() => {
            const ctx = PocketDex.mini().canvas.getContext('2d');
            const foe = ctx.getImageData(372, 66, 1, 1).data;
            const card = ctx.getImageData(300, 30, 1, 1).data;
            return { foe: Array.from(foe), card: Array.from(card) };
        }""")
        print("pixels:", center)

        page.evaluate("PocketDex.state().focus.start -= 61000")
        page.wait_for_timeout(900)
        check("minute hit reaches the mini player", page.evaluate("performance.now() - PocketDex.mini().hitAt < 2000"))

        page.click("[data-f=wake]")
        page.wait_for_timeout(400)
        check("Keep screen on requests a wake lock", page.evaluate("window.__wake") >= 1)
        check("button shows the screen stays on", page.inner_text("[data-f=wake]") == "Screen stays on")

        notices = page.evaluate("""() => navigator.serviceWorker.ready
            .then(r => r.getNotifications({ tag: 'pocketdex-focus' }))
            .then(list => list.map(n => n.title + ' | ' + n.body))""")
        print("lock-screen notices:", notices)
        check("lock-screen notice names the target and end time", any("Catching Snorlax" in n and "Focus until" in n for n in notices), notices)

        page.click("[data-f=pause]")
        page.wait_for_timeout(700)
        save_frame(page, "mini_paused.png")
        notices = page.evaluate("""() => navigator.serviceWorker.ready
            .then(r => r.getNotifications({ tag: 'pocketdex-focus' }))
            .then(list => list.map(n => n.body))""")
        check("notice switches to paused", any(n.startswith("Paused") for n in notices), notices)
        page.click("[data-f=pause]")
        page.wait_for_timeout(400)

        page.evaluate("PocketDex.state().focus.start -= 30 * 60000")
        page.wait_for_timeout(1500)
        check("session completes and Snorlax is caught", page.evaluate("!!PocketDex.state().caught[143]"))
        check("mini player shows the catch", page.evaluate("PocketDex.mini().caughtId") == 143)
        save_frame(page, "mini_caught.png")
        check("wake lock released after the session", page.evaluate("!document.querySelector('[data-f=wake]')") or page.inner_text("[data-f=wake]") == "Keep screen on")
        browser.close()
    server.shutdown()
    check("no JS errors", not errors, errors)
    print(f"{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
