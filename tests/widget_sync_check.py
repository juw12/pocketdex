"""iPhone widget feed check: PocketDex only talks to the relay when paired, sends the agreed snapshot,
follows a focus battle within seconds, and the setup page hands out a working Scriptable script.
The relay (ntfy.sh) is intercepted, so nothing leaves this computer."""
import functools
import http.server
import json
import os
import socketserver
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
CODE = "jw-0123456789abcdef0123456789abcdef"
OTHER_CODE = "jw-fedcba9876543210fedcba9876543210"
SEED = {
    "trainer": "Juwen",
    "caught": {str(i): {"d": "2026-11-01", "via": "focus"} for i in [1, 4, 7, 25, 39]},
    "partner": {"id": 25, "xp": 2400, "nick": "Sparky"},
    "habits": [{"id": "h1", "name": "Read"}, {"id": "h2", "name": "Walk"}],
    "habitLog": {},
    "focusLog": [],
}
failures = []


def check(condition, label):
    print(("ok   " if condition else "FAIL ") + label, flush=True)
    if not condition:
        failures.append(label)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class QuietServer(socketserver.ThreadingTCPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass  # the browser drops sprite downloads when a page closes


def serve():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = QuietServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def new_context(browser, relay_log, feed=""):
    context = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")

    def relay(route):
        request = route.request
        relay_log.append({"method": request.method, "url": request.url, "body": request.post_data})
        if request.method == "POST":
            route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body="{}")
        else:
            route.fulfill(status=200, content_type="application/x-ndjson", headers={"Access-Control-Allow-Origin": "*"}, body=feed)

    context.route("https://ntfy.sh/**", relay)
    return context


def posts(relay_log):
    return [json.loads(entry["body"]) for entry in relay_log if entry["method"] == "POST"]


def wait_for_posts(page, relay_log, count, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline and len(posts(relay_log)) < count:
        page.wait_for_timeout(250)
    return posts(relay_log)


def main():
    server = serve()
    root = f"http://127.0.0.1:{server.server_address[1]}"
    seed_script = f"if (!localStorage.getItem('pocketdex.v1')) localStorage.setItem('pocketdex.v1', JSON.stringify({json.dumps(SEED)}))"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=CHROME if Path(CHROME).exists() else None,
            args=["--no-proxy-server", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
        )

        # 1. not paired: the relay is never contacted, even when a focus battle starts
        relay_log = []
        context = new_context(browser, relay_log)
        context.add_init_script(seed_script)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{root}/index.html#/focus", wait_until="domcontentloaded")
        page.wait_for_selector("[data-f=start]", timeout=60000)
        page.click("[data-f=start]")
        page.wait_for_timeout(3500)
        check(relay_log == [], "unpaired: no request reaches the relay")
        check(page.evaluate("typeof window.Juw12Widget.publish") == "function", "widget/sync.js is loaded by the app")
        check(errors == [], f"unpaired: no page errors {errors}")
        context.close()

        # 2. paired: first snapshot, then the focus battle follows quickly
        relay_log = []
        context = new_context(browser, relay_log)
        context.add_init_script(seed_script)
        context.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ sessionStorage.setItem('seeded', '1'); localStorage.setItem('juw12.widget.code', '{CODE}'); }}")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{root}/index.html#/focus", wait_until="domcontentloaded")
        page.wait_for_selector("[data-f=start]", timeout=60000)
        sent = wait_for_posts(page, relay_log, 1, 8)
        check(len(sent) == 1, "paired: one snapshot is sent after opening the app")
        check(all(entry["url"] == f"https://ntfy.sh/{CODE}" for entry in relay_log), "paired: the snapshot goes to the code's own topic")
        if sent:
            first = sent[0]
            data = first.get("d", {})
            check(first.get("v") == 1 and first.get("app") == "pocketdex" and isinstance(first.get("at"), int), "snapshot envelope is v1 / pocketdex / timestamp")
            check(data.get("trainer") == "Juwen", "snapshot carries the trainer name")
            check(data.get("partner", {}).get("id") == 25 and data["partner"].get("name") == "Sparky" and data["partner"].get("level", 0) >= 1, "snapshot carries partner id, nickname and level")
            check(bool(data.get("partner", {}).get("mood")), "snapshot carries the partner mood")
            check(data.get("caught") == 5 and data.get("total", 0) > 1000, "snapshot carries Pokedex counts")
            check(data.get("habits") == {"done": 0, "total": 2}, "snapshot carries today's habit count")
            check(data.get("focus") is None and data.get("focusMin") == 0, "snapshot shows no battle and no focus minutes yet")
            check(len(json.dumps(first)) < 1000, "snapshot is small")
        started = int(time.time() * 1000)
        page.click("[data-f=start]")
        sent = wait_for_posts(page, relay_log, 2, 25)
        check(len(sent) == 2, "a focus battle start is sent within the urgent window")
        if len(sent) == 2:
            focus = sent[1]["d"].get("focus") or {}
            minutes = focus.get("minutes", 0)
            expected_end = started + minutes * 60000
            check(focus.get("paused") is False and minutes > 0 and bool(focus.get("name")), "battle snapshot has the wild Pokemon, minutes and running state")
            check(abs(focus.get("endsAt", 0) - expected_end) < 5000, "battle end time matches start + duration")
            check(sent[1]["d"]["partner"]["mood"] == "battle", "partner mood switches to battle")
        check(errors == [], f"paired: no page errors {errors}")

        # 3. Trainer page: status, unpair, bad code, new code
        page.goto(f"{root}/index.html#/trainer", wait_until="domcontentloaded")
        page.wait_for_selector("#widget-code")
        check(page.input_value("#widget-code") == CODE and "Paired" in page.inner_text("#widget-status"), "Trainer page shows the paired code")
        page.click("[data-tr=widget-clear]")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") is None and "Not paired" in page.inner_text("#widget-status"), "Unpair removes the code")
        page.fill("#widget-code", "hello")
        page.click("[data-tr=widget-save]")
        check("not a widget code" in page.inner_text("#widget-status") and page.evaluate("localStorage.getItem('juw12.widget.code')") is None, "a wrong code is refused")
        before = len(posts(relay_log))
        page.fill("#widget-code", OTHER_CODE)
        page.click("[data-tr=widget-save]")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") == OTHER_CODE, "a valid code is saved from the Trainer page")
        sent = wait_for_posts(page, relay_log, before + 1, 8)
        check(len(sent) == before + 1 and relay_log[-1]["url"] == f"https://ntfy.sh/{OTHER_CODE}", "the new code gets a snapshot straight away")
        context.close()

        # 4. pairing link
        relay_log = []
        context = new_context(browser, relay_log)
        context.add_init_script(seed_script)
        page = context.new_page()
        page.goto(f"{root}/index.html?widget={CODE}#/today", wait_until="domcontentloaded")
        page.wait_for_function("window.PocketDex")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") == CODE, "?widget= link pairs the browser")
        check("widget=" not in page.url and page.url.endswith("#/today"), "the code is removed from the address bar")
        context.close()

        # 5. setup page
        now = int(time.time() * 1000)
        today = time.strftime("%Y-%m-%d")
        messages = [
            {"v": 1, "app": "pocketdex", "at": now - 60000, "d": {"day": today, "trainer": "Juwen", "partner": {"id": 25, "name": "Sparky", "level": 12, "mood": "happy"}, "caught": 5, "total": 1025, "habits": {"done": 1, "total": 2}, "streak": 3, "focusMin": 25, "focus": {"id": 143, "name": "Snorlax", "minutes": 25, "endsAt": now + 600000, "paused": False}}},
            {"v": 1, "app": "haru", "at": now - 120000, "d": {"day": today, "scene": "clear__dusk__autumn", "weather": "clear", "tempC": 21, "time": "dusk", "season": "autumn", "moments": 2, "days": 14, "walkKm": 3.2, "inbox": 0, "sample": False}},
            {"v": 1, "app": "cozy", "at": now - 30000, "d": {"name": "Juwen", "season": "autumn", "rain": False, "fish": 4, "harvest": 9, "sessions": 6, "mindfulMin": 12, "garden": [{"s": "tulip", "b": now + 300000}], "focus": None}},
        ]
        feed = "\n".join(json.dumps({"event": "message", "message": json.dumps(message)}) for message in messages) + "\n"
        relay_log = []
        context = new_context(browser, relay_log, feed)
        context.grant_permissions(["clipboard-read", "clipboard-write"])
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{root}/widget/index.html", wait_until="domcontentloaded")
        page.wait_for_function("document.querySelector('#copy-script')")
        check(page.is_disabled("#copy-script") and page.is_disabled("#pair"), "setup: nothing can be copied before a code exists")
        page.click("#new-code")
        made = page.input_value("#code")
        check(len(made) == 35 and made.startswith("jw-"), "setup: New code makes a jw- code")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") is None, "setup: a new code is not paired until asked")
        page.click("#pair")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") == made, "setup: Pair this browser stores the code")
        page.wait_for_function("document.querySelectorAll('#cards .card').length === 3 && document.querySelector('#cards .age')", timeout=10000)
        cards = page.evaluate("[...document.querySelectorAll('#cards .card')].map((card) => card.innerText)")
        check("Sparky Lv 12" in cards[0] and "vs Snorlax" in cards[0], "setup preview: PocketDex card shows partner and battle")
        check("Clear 21" in cards[1] and "2 moments today" in cards[1], "setup preview: Haru card shows weather and moments")
        check("Juwen's island" in cards[2] and "Tulip blooms" in cards[2], "setup preview: Cozy Island card shows the garden timer")
        check(any(entry["method"] == "GET" and entry["url"].startswith(f"https://ntfy.sh/{made}/json?poll=1") for entry in relay_log), "setup preview reads the code's own topic")
        first_clock = page.inner_text("#cards .card .timer")
        page.wait_for_timeout(2200)
        check(page.inner_text("#cards .card .timer") != first_clock, "setup preview: the countdown ticks")
        page.click("#show-script")
        script = page.input_value("#script-text")
        check(f'const CODE = "{made}";' in script and "__CODE__" not in script and "trio.js" in script, "setup: the Scriptable script carries the code")
        page.click("#copy-script")
        page.wait_for_function("document.querySelector('#script-status').textContent.includes('copied')", timeout=5000)
        copied = page.evaluate("navigator.clipboard.readText()").replace("\r\n", "\n")
        check(copied == script.replace("\r\n", "\n"), "setup: Copy widget script puts it on the clipboard")
        links = page.evaluate("[...document.querySelectorAll('[data-app-link]')].map((link) => link.href)")
        check(len(links) == 3 and all(link.endswith(f"?widget={made}") for link in links), "setup: the three app links carry the code")
        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check(overflow <= 0, f"setup: no sideways scroll at 390px ({overflow})")
        check(errors == [], f"setup: no page errors {errors}")
        out = APP / "tests" / "out"
        out.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(out / "widget-setup-390.png"), full_page=True)
        context.close()
        browser.close()

    print(f"widget sync check: {len(failures)} failed", flush=True)
    os._exit(1 if failures else 0)


if __name__ == "__main__":
    main()
