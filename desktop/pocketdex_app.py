"""PocketDex for Windows.

The whole PocketDex in its own window: offline, with its own save, and with the
desktop buddy built in (switch it on under Trainer). Built into PocketDex.exe by
desktop/build_windows.py; can also be run from source with `python pocketdex_app.py`.

    PocketDex.exe            open the app (or bring the open window to the front)
    PocketDex.exe --buddy    run only the desktop buddy
"""

import ctypes
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_PORT = 47616  # fixed, so the app's saved data (tied to this address) is found again next time
BUDDY_PORT = 47615
UPDATE_URL = "https://juw12.github.io/pocketdex/version.json"
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PocketDex"
FROZEN = getattr(sys, "frozen", False)


class ExclusiveServer(ThreadingHTTPServer):
    """Refuses to share its port, so a second copy can tell that one is already running.

    Python's HTTPServer sets SO_REUSEADDR, which on Windows lets two processes bind the same port.
    """

    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def web_root():
    if FROZEN:
        return Path(sys._MEIPASS) / "web"
    return Path(__file__).resolve().parent.parent


def bundled_version():
    try:
        return json.loads((web_root() / "version.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        return "0.0.0"


VERSION = bundled_version()


def version_tuple(text):
    parts = []
    for piece in str(text).split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts + [0] * (3 - len(parts)))[:3]


def check_for_update(url=UPDATE_URL, timeout=6):
    """Ask the PocketDex site which version is current. Returns details when a newer one exists."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            latest = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    if version_tuple(latest.get("version", "0")) > version_tuple(VERSION):
        return {
            "current": VERSION,
            "latest": latest.get("version"),
            "url": latest.get("windows") or "https://juw12.github.io/pocketdex/",
            "notes": str(latest.get("notes", ""))[:200],
        }
    return None


def local_get(port, path, timeout=1.5):
    """GET from a PocketDex process on this computer, ignoring any system proxy."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}{path}", timeout=timeout) as response:
        return json.loads(response.read() or b"null")


# ---------------------------------------------------------------- desktop buddy


def buddy_running():
    try:
        return local_get(BUDDY_PORT, "/ping").get("app") == "pocketdex-buddy"
    except (OSError, ValueError, AttributeError):
        return False


def start_buddy():
    if buddy_running():
        return True
    if FROZEN:
        command = [sys.executable, "--buddy"]
    else:
        runner = Path(sys.executable).with_name("pythonw.exe")
        command = [str(runner if runner.exists() else sys.executable), str(web_root() / "desktop" / "pocketdex_buddy.pyw")]
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(command, creationflags=flags, close_fds=True)
    for _ in range(40):
        time.sleep(0.15)
        if buddy_running():
            return True
    return False


def run_buddy():
    from importlib.machinery import SourceFileLoader

    module = SourceFileLoader("pocketdex_buddy", str(web_root() / "desktop" / "pocketdex_buddy.pyw")).load_module()
    module.main()


# ---------------------------------------------------------------- local file server for the app window

WINDOW = {"ref": None}


class AppHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
        ".png": "image/png",
        ".pyw": "text/plain",
    }

    def log_message(self, *_args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def reply_json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/__pocketdex"):
            self.reply_json({"app": "pocketdex", "version": VERSION})
            return
        if self.path.startswith("/__show"):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            threading.Thread(target=show_window, args=(query.get("hash", [""])[0],), daemon=True).start()
            self.reply_json({"ok": True})
            return
        super().do_GET()


def show_window(route_hash=""):
    window = WINDOW["ref"]
    if window is None:
        return
    try:
        window.restore()
        window.show()
        if route_hash.startswith("#/"):
            window.evaluate_js(f"location.hash = {json.dumps(route_hash)}")
        hwnd = ctypes.windll.user32.FindWindowW(None, "PocketDex")
        if hwnd:
            ctypes.windll.user32.SetForegroundWindow(hwnd)
    except Exception:
        pass


def start_server():
    handler = partial(AppHandler, directory=str(web_root()))
    server = ExclusiveServer(("127.0.0.1", APP_PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ---------------------------------------------------------------- bridge for the page (window.pywebview.api)


class Api:
    def start_buddy(self):
        return start_buddy()

    def buddy_running(self):
        return buddy_running()

    def app_info(self):
        return {"version": VERSION, "data": str(DATA_DIR)}

    def check_update(self):
        return check_for_update()


def shortcut_script(link_path_expr, exe):
    """PowerShell that writes one .lnk pointing at the app with its own icon."""
    return (
        f"$link = {link_path_expr};"
        "$shell = New-Object -ComObject WScript.Shell;"
        "$s = $shell.CreateShortcut($link);"
        f"$s.TargetPath = '{exe}'; $s.WorkingDirectory = '{exe.parent}';"
        f"$s.IconLocation = '{exe},0'; $s.Description = 'PocketDex'; $s.Save()"
    )


def ensure_shortcuts():
    """First run of the packaged app: add Start Menu and Desktop shortcuts once.

    A marker file remembers that this happened, so a shortcut the user deletes stays deleted.
    Windows 11 does not let apps pin themselves to the taskbar; the user pins it once
    (right-click the running PocketDex icon > Pin to taskbar).
    """
    if not FROZEN:
        return
    marker = DATA_DIR / "shortcuts-made"
    if marker.exists():
        return
    exe = Path(sys.executable)
    start_menu = "[IO.Path]::Combine([Environment]::GetFolderPath('Programs'), 'PocketDex.lnk')"
    desktop = "[IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'PocketDex.lnk')"
    script = shortcut_script(start_menu, exe) + ";" + shortcut_script(desktop, exe)
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            check=True,
            timeout=30,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        marker.write_text(str(exe), encoding="utf-8")
    except (OSError, subprocess.SubprocessError):
        pass


def main():
    if "--buddy" in sys.argv:
        run_buddy()
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("juw12.PocketDex")
    except (AttributeError, OSError):
        pass
    try:
        start_server()
    except OSError:
        # PocketDex is already open: bring that window forward instead of opening a second one.
        try:
            local_get(APP_PORT, "/__show")
        except OSError:
            ctypes.windll.user32.MessageBoxW(None, f"Port {APP_PORT} is in use by another program.", "PocketDex", 0x40)
        return

    import webview

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=ensure_shortcuts, daemon=True).start()
    WINDOW["ref"] = webview.create_window(
        "PocketDex",
        f"http://127.0.0.1:{APP_PORT}/index.html#/today",
        js_api=Api(),
        width=1240,
        height=860,
        min_size=(380, 560),
        background_color="#F6F2EB",
        text_select=True,
    )
    webview.start(
        gui="edgechromium",
        private_mode=False,
        storage_path=str(DATA_DIR / "webview"),
    )


if __name__ == "__main__":
    main()
