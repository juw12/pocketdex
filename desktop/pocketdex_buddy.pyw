"""PocketDex Buddy - your partner Pokemon lives on the Windows taskbar.

It walks along the taskbar and on top of your open windows, rides along when you
move a window, falls when the window closes, and can be picked up and thrown.
While a focus session runs in PocketDex (with "Desktop buddy" switched on in
Trainer), the wild Pokemon appears next to it and the battle plays out on your
desktop, with the time left in a small bubble.

Windows only. Needs Python 3.9+ (tkinter is included with the python.org installer).
Run it with pythonw so no console window opens:

    pythonw pocketdex_buddy.pyw

Right-click the Pokemon for the menu. Double-click it to open PocketDex.
"""

import ctypes
import ctypes.wintypes as wt
import json
import math
import os
import queue
import random
import re
import sys
import threading
import time
import traceback
import tkinter as tk
import tkinter.font as tkfont
import urllib.request
import webbrowser
import winreg
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tkinter import simpledialog

APP_URL = "https://juw12.github.io/pocketdex/"
PORT = 47615
VERSION = 1
KEY = "#010203"  # window colour that Windows renders as fully transparent
TICK_MS = 33
GRAVITY = 0.9
ALLOWED_ORIGINS = re.compile(r"^(https://juw12\.github\.io|https?://(localhost|127\.0\.0\.1)(:\d+)?|null)$")
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PocketDex"
CONFIG_PATH = DATA_DIR / "buddy.json"
LOG_PATH = DATA_DIR / "buddy.log"
SPRITE_CACHE = DATA_DIR / "sprites"
LOCAL_SPRITES = Path(__file__).resolve().parent.parent / "sprites"
LOCAL_DATA = Path(__file__).resolve().parent.parent / "data.js"
SIZES = {"Small": (1, 1), "Medium": (3, 2), "Large": (2, 1)}  # zoom, subsample
PAPER = "#fffdf9"
LINE = "#e3d9c8"
INK = "#2b2621"
MUTED = "#6f665b"
ACCENT = "#c0432f"

# ---------------------------------------------------------------- Win32


def enable_dpi_awareness():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass


user32 = ctypes.windll.user32
dwmapi = ctypes.windll.dwmapi
user32.MonitorFromPoint.argtypes = [wt.POINT, wt.DWORD]
user32.MonitorFromPoint.restype = wt.HANDLE
user32.GetMonitorInfoW.argtypes = [wt.HANDLE, ctypes.c_void_p]
user32.GetForegroundWindow.restype = wt.HWND
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
ENUM_PROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
IGNORED_CLASSES = {
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Windows.UI.Core.CoreWindow",
    "TaskManagerWindow",
}
OWN_PID = os.getpid()


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wt.DWORD),
        ("rcMonitor", wt.RECT),
        ("rcWork", wt.RECT),
        ("dwFlags", wt.DWORD),
    ]


def monitor_areas(x, y):
    """Return (work_area, monitor_area) rectangles for the monitor nearest to a point."""
    handle = user32.MonitorFromPoint(wt.POINT(int(x), int(y)), 2)
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(handle, ctypes.byref(info))
    work = info.rcWork
    full = info.rcMonitor
    return (work.left, work.top, work.right, work.bottom), (full.left, full.top, full.right, full.bottom)


def visible_rect(hwnd):
    rect = wt.RECT()
    if dwmapi.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(rect), ctypes.sizeof(rect)) != 0:
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return rect.left, rect.top, rect.right, rect.bottom


def top_level_windows():
    """Visible application windows, front to back, as (hwnd, left, top, right, bottom)."""
    found = []

    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
            return True
        cloaked = ctypes.c_int(0)
        dwmapi.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
        if cloaked.value:
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == OWN_PID:
            return True
        if user32.GetWindowTextLengthW(hwnd) == 0:
            return True
        name = ctypes.create_unicode_buffer(80)
        user32.GetClassNameW(hwnd, name, 80)
        if name.value in IGNORED_CLASSES:
            return True
        ex_style = user32.GetWindowLongW(hwnd, -20)
        if ex_style & 0x20:  # WS_EX_TRANSPARENT overlays
            return True
        left, top, right, bottom = visible_rect(hwnd)
        if right - left < 160 or bottom - top < 80:
            return True
        found.append((int(hwnd or 0), left, top, right, bottom))
        return True

    user32.EnumWindows(ENUM_PROC(callback), 0)
    return found


def window_handle(widget):
    widget.update_idletasks()
    return user32.GetParent(widget.winfo_id()) or widget.winfo_id()


def make_quiet(widget):
    """Keep clicks on the pet from stealing focus and keep it out of Alt+Tab."""
    hwnd = window_handle(widget)
    ex_style = user32.GetWindowLongW(hwnd, -20)
    user32.SetWindowLongW(hwnd, -20, ex_style | 0x08000000 | 0x00000080)  # NOACTIVATE | TOOLWINDOW
    return hwnd


def keep_on_top(hwnd):
    # HWND_TOPMOST, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
    user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0010)


def foreground_is_fullscreen():
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return False
    name = ctypes.create_unicode_buffer(80)
    user32.GetClassNameW(hwnd, name, 80)
    if name.value in IGNORED_CLASSES:
        return False
    left, top, right, bottom = visible_rect(hwnd)
    _work, full = monitor_areas((left + right) // 2, (top + bottom) // 2)
    return left <= full[0] and top <= full[1] and right >= full[2] and bottom >= full[3]


# ---------------------------------------------------------------- data


def log_error(context):
    """Append the current exception to buddy.log (kept small)."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > 200_000:
            LOG_PATH.write_text("", encoding="utf-8")
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {context}\n{traceback.format_exc()}\n")
    except OSError:
        pass


def load_config():
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(config):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, indent=1), encoding="utf-8")


def load_names():
    """Pokemon names from PocketDex data.js (local copy, then cache, then the live site)."""
    cached = DATA_DIR / "names.json"
    try:
        return {int(k): v for k, v in json.loads(cached.read_text(encoding="utf-8")).items()}
    except (OSError, ValueError):
        pass
    text = ""
    try:
        text = LOCAL_DATA.read_text(encoding="utf-8")
    except OSError:
        try:
            with urllib.request.urlopen(APP_URL + "data.js", timeout=15) as response:
                text = response.read().decode("utf-8")
        except OSError:
            return {}
    names = {int(i): n for i, n in re.findall(r'\{"id":(\d+),"n":"([^"]+)"', text)}
    if names:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(names), encoding="utf-8")
    return names


def sprite_path(pokemon_id):
    local = LOCAL_SPRITES / f"{pokemon_id}.png"
    if local.exists():
        return local
    cached = SPRITE_CACHE / f"{pokemon_id}.png"
    if cached.exists():
        return cached
    try:
        SPRITE_CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{APP_URL}sprites/{pokemon_id}.png", timeout=15) as response:
            cached.write_bytes(response.read())
        return cached
    except OSError:
        return None


def pythonw_command():
    exe = Path(sys.executable)
    windowless = exe.with_name("pythonw.exe")
    runner = windowless if windowless.exists() else exe
    return f'"{runner}" "{Path(__file__).resolve()}"'


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def autostart_enabled():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, "PocketDex Buddy")
            return True
    except OSError:
        return False


def set_autostart(enabled):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, "PocketDex Buddy", 0, winreg.REG_SZ, pythonw_command())
        else:
            try:
                winreg.DeleteValue(key, "PocketDex Buddy")
            except OSError:
                pass


# ---------------------------------------------------------------- local link to the web app


class LinkHandler(BaseHTTPRequestHandler):
    inbox = None
    snapshot = {}

    def log_message(self, *_args):
        pass

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin and ALLOWED_ORIGINS.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def reply(self, code, body=b""):
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(204)

    def do_GET(self):
        if self.path.startswith("/ping"):
            self.reply(200, json.dumps({"app": "pocketdex-buddy", "version": VERSION}).encode())
        elif self.path.startswith("/status"):
            self.reply(200, json.dumps(LinkHandler.snapshot).encode())
        else:
            self.reply(404)

    def do_POST(self):
        origin = self.headers.get("Origin", "")
        if origin and not ALLOWED_ORIGINS.match(origin):
            self.reply(403)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if self.path != "/state" or length > 16384:
            self.reply(400)
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            self.reply(400)
            return
        self.inbox.put(payload)
        self.reply(200, b'{"ok":true}')


def start_link(inbox):
    LinkHandler.inbox = inbox
    server = ThreadingHTTPServer(("127.0.0.1", PORT), LinkHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def clean_state(payload):
    """Keep only well-formed fields from a web app message."""

    def pokemon(value):
        if not isinstance(value, dict):
            return None
        try:
            pid = int(value.get("id"))
        except (TypeError, ValueError):
            return None
        if not 1 <= pid <= 1025:
            return None
        return {
            "id": pid,
            "name": str(value.get("name") or "")[:24],
            "level": int(value.get("level") or 0) if str(value.get("level") or "0").isdigit() else 0,
        }

    focus = payload.get("focus") if isinstance(payload, dict) else None
    clean_focus = None
    if isinstance(focus, dict) and pokemon(focus.get("foe")):
        try:
            clean_focus = {
                "foe": pokemon(focus.get("foe")),
                "minutes": max(1, min(180, int(focus.get("minutes") or 25))),
                "remain": max(0, int(focus.get("remainMs") or 0)),
                "paused": bool(focus.get("paused")),
                "received": time.time(),
            }
        except (TypeError, ValueError):
            clean_focus = None
    event = payload.get("event") if isinstance(payload, dict) else None
    clean_event = None
    if isinstance(event, dict) and event.get("type") in ("caught", "fled") and pokemon(event.get("pokemon")):
        clean_event = {"type": event["type"], "pokemon": pokemon(event.get("pokemon")), "at": str(event.get("at", ""))[:32]}
    return {
        "partner": pokemon(payload.get("partner")) if isinstance(payload, dict) else None,
        "focus": clean_focus,
        "event": clean_event,
    }


# ---------------------------------------------------------------- sprites


def build_frames(root, pokemon_id, size_name):
    """Return (facing_left, facing_right, width, height) PhotoImages cropped to the Pokemon."""
    path = sprite_path(pokemon_id)
    if path is None:
        return None
    source = tk.PhotoImage(master=root, file=str(path))
    width, height = source.width(), source.height()
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            if not source.transparency_get(x, y):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    x0, y0, x1, y1 = min(xs), min(ys), max(xs) + 1, max(ys) + 1
    zoom, subsample = SIZES.get(size_name, (3, 2))
    cropped = tk.PhotoImage(master=root)
    cropped.tk.call(cropped, "copy", source, "-from", x0, y0, x1, y1, "-zoom", zoom, zoom)
    if subsample > 1:
        smaller = tk.PhotoImage(master=root)
        smaller.tk.call(smaller, "copy", cropped, "-subsample", subsample, subsample)
        cropped = smaller
    mirrored = tk.PhotoImage(master=root)
    try:
        mirrored.tk.call(mirrored, "copy", cropped, "-subsample", -1, 1)
    except tk.TclError:
        mirrored = cropped
    return cropped, mirrored, cropped.width(), cropped.height()


# ---------------------------------------------------------------- creatures


class Creature:
    """One Pokemon in its own borderless, transparent, always-on-top window."""

    def __init__(self, app, pokemon, role):
        self.app = app
        self.role = role
        self.pokemon = pokemon
        self.win = tk.Toplevel(app.root)
        self.win.overrideredirect(True)
        self.win.attributes("-topmost", True)
        self.win.attributes("-transparentcolor", KEY)
        self.win.configure(bg=KEY)
        self.canvas = tk.Canvas(self.win, bg=KEY, highlightthickness=0, bd=0)
        self.canvas.pack()
        self.hwnd = make_quiet(self.win)
        self.image_item = None
        self.frames = None
        self.width = self.height = 48
        self.x = 0.0  # centre
        self.feet = 0.0  # bottom edge
        self.vx = 0.0
        self.vy = 0.0
        self.mode = "fall"
        self.surface = None  # ("window", hwnd, left, top, right) or ("taskbar",)
        self.facing = "left"
        self.walk_dir = 0
        self.next_choice = time.time() + 2
        self.bob = 0
        self.flash_until = 0.0
        self.lunge_until = 0.0
        self.drag_offset = None
        self.drag_trail = []
        self.press_at = (0, 0)
        self.leave_until = 0.0
        self.load(pokemon["id"])
        for sequence, handler in (
            ("<ButtonPress-1>", self.on_press),
            ("<B1-Motion>", self.on_drag),
            ("<ButtonRelease-1>", self.on_release),
            ("<Double-Button-1>", lambda _e: app.open_app()),
            ("<Button-3>", app.show_menu),
        ):
            self.canvas.bind(sequence, handler)

    def load(self, pokemon_id):
        frames = build_frames(self.app.root, pokemon_id, self.app.config.get("size", "Medium"))
        self.canvas.delete("all")
        if frames is None:
            self.width = self.height = 40
            self.canvas.configure(width=40, height=40)
            self.canvas.create_oval(4, 4, 36, 36, fill=ACCENT, outline=INK, width=2)
            self.canvas.create_line(4, 20, 36, 20, fill=INK, width=2)
            self.canvas.create_oval(15, 15, 25, 25, fill=PAPER, outline=INK, width=2)
            self.frames = None
        else:
            self.frames = frames
            self.width, self.height = frames[2], frames[3]
            self.canvas.configure(width=self.width, height=self.height)
            self.image_item = self.canvas.create_image(0, 0, anchor="nw", image=frames[0])
        self.place()

    def set_facing(self, facing):
        if facing == self.facing or not self.frames:
            self.facing = facing
            return
        self.facing = facing
        self.canvas.itemconfigure(self.image_item, image=self.frames[0 if facing == "left" else 1])

    def place(self):
        hop = 0
        if self.mode == "stand" and self.walk_dir:
            hop = 2 if (self.bob // 6) % 2 else 0
        lunge = 0
        if time.time() < self.lunge_until:
            lunge = 10 if self.facing == "right" else -10
        left = int(self.x - self.width / 2 + lunge)
        top = int(self.feet - self.height - hop)
        self.win.geometry(f"{self.width}x{self.height}+{left}+{top}")
        visible = not (time.time() < self.flash_until and int(time.time() * 8) % 2)
        if self.image_item:
            self.canvas.itemconfigure(self.image_item, state="normal" if visible else "hidden")

    # mouse
    def on_press(self, event):
        self.drag_offset = (event.x_root - self.x, event.y_root - self.feet)
        self.drag_trail = [(time.time(), event.x_root, event.y_root)]
        self.press_at = (event.x_root, event.y_root)
        self.mode = "drag"

    def on_drag(self, event):
        if self.drag_offset is None:
            return
        self.x = event.x_root - self.drag_offset[0]
        self.feet = event.y_root - self.drag_offset[1]
        self.drag_trail = (self.drag_trail + [(time.time(), event.x_root, event.y_root)])[-6:]
        self.place()

    def on_release(self, event):
        if self.drag_offset is None:
            return
        moved = abs(event.x_root - self.press_at[0]) + abs(event.y_root - self.press_at[1])
        self.drag_offset = None
        self.mode = "fall"
        self.surface = None
        if moved < 4:
            self.vx, self.vy = 0.0, -7.0
            self.app.on_poke(self)
            return
        first, last = self.drag_trail[0], self.drag_trail[-1]
        span = max(0.016, last[0] - first[0])
        self.vx = max(-22, min(22, (last[1] - first[1]) / span * TICK_MS / 1000))
        self.vy = max(-20, min(22, (last[2] - first[2]) / span * TICK_MS / 1000))

    # physics
    def find_landing(self, previous_feet, windows):
        work, _full = monitor_areas(self.x, max(previous_feet, self.feet) - 5)
        best = None
        if previous_feet <= work[3] + 1 and self.feet >= work[3]:
            best = (work[3], ("taskbar",))
        for index, (hwnd, left, top, right, _bottom) in enumerate(windows):
            if not (left + 6 <= self.x <= right - 6):
                continue
            if not (previous_feet - 2 <= top <= self.feet + 1):
                continue
            if top - self.height < work[1]:
                continue
            if any(l <= self.x <= r and t <= top - 3 <= b for _h, l, t, r, b in windows[:index]):
                continue
            if best is None or top < best[0]:
                best = (top, ("window", hwnd, left, top, right))
        return best

    def step_physics(self, windows):
        work, full = monitor_areas(self.x, self.feet - 5)
        if self.mode == "fall":
            previous = self.feet
            self.vy = min(self.vy + GRAVITY, 30)
            self.x += self.vx
            self.feet += self.vy
            self.vx *= 0.99
            half = self.width / 2
            if self.x - half < full[0]:
                self.x = full[0] + half
                self.vx = abs(self.vx) * 0.5
            if self.x + half > full[2]:
                self.x = full[2] - half
                self.vx = -abs(self.vx) * 0.5
            if self.feet - self.height < full[1] and self.vy < 0:
                self.vy = 0
            if self.vy >= 0:
                landing = self.find_landing(previous, windows)
                if landing:
                    self.feet = landing[0]
                    self.surface = landing[1]
                    self.mode = "stand"
                    self.vx = self.vy = 0
                    self.next_choice = time.time() + random.uniform(0.6, 2.0)
            if self.feet > full[3] + 200:
                self.feet = work[3]
                self.mode = "stand"
                self.surface = ("taskbar",)
        elif self.mode == "stand":
            if self.surface and self.surface[0] == "window":
                hwnd = self.surface[1]
                match = next((w for w in windows if w[0] == hwnd), None)
                if match is None:
                    self.fall()
                    return
                _h, left, top, right, _bottom = match
                old_left, old_top = self.surface[2], self.surface[3]
                self.x += left - old_left
                self.feet = top
                self.surface = ("window", hwnd, left, top, right)
                index = windows.index(match)
                covered = any(l <= self.x <= r and t <= top - 3 <= b for _h2, l, t, r, b in windows[:index])
                too_high = top - self.height < work[1]
                if covered or too_high or not (left + 4 <= self.x <= right - 4):
                    self.fall()
                    return
            else:
                self.feet = work[3]
            half = self.width / 2
            self.x = max(full[0] + half, min(full[2] - half, self.x))

    def fall(self):
        self.mode = "fall"
        self.surface = None
        self.vx = self.walk_dir * 1.5
        self.vy = 0
        self.walk_dir = 0

    def hop(self, strength=7.0):
        if self.mode == "stand":
            self.mode = "fall"
            self.surface = None
            self.vy = -strength
            self.vx = 0

    def wander(self, allowed):
        if self.mode != "stand":
            return
        now = time.time()
        if now >= self.next_choice:
            choice = random.random()
            if not allowed or choice < 0.45:
                self.walk_dir = 0
            elif choice < 0.92:
                self.walk_dir = random.choice((-1, 1))
            else:
                self.walk_dir = 0
                self.hop(6)
            self.next_choice = now + random.uniform(1.5, 5.0)
        if self.walk_dir:
            self.x += self.walk_dir * 1.2
            self.bob += 1
            self.set_facing("right" if self.walk_dir > 0 else "left")
            work, full = monitor_areas(self.x, self.feet - 5)
            half = self.width / 2
            if self.x - half <= full[0] or self.x + half >= full[2]:
                self.walk_dir = -self.walk_dir
            if self.surface and self.surface[0] == "window":
                left, right = self.surface[2], self.surface[4]
                if not (left + 4 <= self.x <= right - 4):
                    if random.random() < 0.6:
                        self.walk_dir = -self.walk_dir
                        self.x = max(left + 5, min(right - 5, self.x))
                    else:
                        self.fall()

    def move_toward(self, target_x, speed=2.2):
        if self.mode != "stand":
            return
        delta = target_x - self.x
        if abs(delta) > 3:
            self.x += max(-speed, min(speed, delta))
            self.bob += 1
            self.walk_dir = 1 if delta > 0 else -1
        else:
            self.walk_dir = 0

    def destroy(self):
        self.win.destroy()


class Bubble:
    """A small speech bubble that floats above the partner."""

    def __init__(self, app):
        self.app = app
        self.win = tk.Toplevel(app.root)
        self.win.overrideredirect(True)
        self.win.attributes("-topmost", True)
        self.win.attributes("-transparentcolor", KEY)
        self.win.configure(bg=KEY)
        self.canvas = tk.Canvas(self.win, bg=KEY, highlightthickness=0, bd=0)
        self.canvas.pack()
        self.title_font = tkfont.Font(family="Georgia", size=11, weight="bold")
        self.body_font = tkfont.Font(family="Segoe UI", size=9)
        self.shown = None
        self.hwnd = make_quiet(self.win)
        self.win.withdraw()
        self.canvas.bind("<Double-Button-1>", lambda _e: app.open_app())
        self.canvas.bind("<Button-3>", app.show_menu)

    def show(self, title, body="", hp=None, anchor=None):
        signature = (title, body, None if hp is None else round(hp, 3))
        pad = 12
        width = max(self.title_font.measure(title), self.body_font.measure(body)) + pad * 2
        width = max(width, 120 if hp is not None else 60)
        height = pad * 2 + self.title_font.metrics("linespace")
        if body:
            height += self.body_font.metrics("linespace") + 2
        if hp is not None:
            height += 10
        tail = 8
        if signature != self.shown:
            self.shown = signature
            self.canvas.delete("all")
            self.canvas.configure(width=width, height=height + tail)
            self.rounded(1, 1, width - 2, height - 1, 12, fill=PAPER, outline=LINE)
            middle = width // 2
            self.canvas.create_polygon(middle - 7, height - 2, middle + 7, height - 2, middle, height + tail - 1, fill=PAPER, outline=LINE)
            self.canvas.create_line(middle - 6, height - 1, middle + 6, height - 1, fill=PAPER, width=2)
            y = pad
            self.canvas.create_text(pad, y, anchor="nw", text=title, font=self.title_font, fill=INK)
            y += self.title_font.metrics("linespace") + 2
            if body:
                self.canvas.create_text(pad, y, anchor="nw", text=body, font=self.body_font, fill=MUTED)
                y += self.body_font.metrics("linespace") + 2
            if hp is not None:
                y += 3
                self.canvas.create_rectangle(pad, y, width - pad, y + 4, fill="#eee7db", outline="")
                filled = pad + (width - pad * 2) * max(0.0, min(1.0, hp))
                self.canvas.create_rectangle(pad, y, filled, y + 4, fill=ACCENT, outline="")
        if anchor:
            x, y_top = anchor
            _work, full = monitor_areas(x, y_top)
            left = int(max(full[0] + 4, min(full[2] - width - 4, x - width / 2)))
            top = int(max(full[1] + 4, y_top - height - tail - 4))
            self.win.geometry(f"{width}x{height + tail}+{left}+{top}")
        self.win.deiconify()

    def rounded(self, x0, y0, x1, y1, r, **style):
        points = [
            x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
            x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0,
        ]
        self.canvas.create_polygon(points, smooth=True, **style)

    def hide(self):
        self.shown = None
        self.win.withdraw()


# ---------------------------------------------------------------- app


class BuddyApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title("PocketDex Buddy")
        self.config = load_config()
        self.config.setdefault("size", "Medium")
        self.config.setdefault("bubble", True)
        self.config.setdefault("wander", True)
        self.config.setdefault("partner", {"id": 25, "name": "Pikachu", "level": 5})
        self.names = {}
        self.inbox = queue.Queue()
        self.focus = None
        self.message = None  # (title, body, until)
        self.windows = []
        self.windows_at = 0.0
        self.hidden = False
        self.hidden_checked = 0.0
        self.last_minute = None
        self.ended_at = None
        self.leaving = []
        self.closing = False
        self.topmost_at = 0.0
        self.root.report_callback_exception = lambda *_args: log_error("callback")
        partner = self.config["partner"]
        self.partner = Creature(self, partner, "partner")
        work, _full = monitor_areas(*self.cursor())
        self.partner.x = float(self.config.get("x", work[2] - 160))
        self.partner.feet = float(work[3] - 300)
        self.foe = None
        self.bubble = Bubble(self)
        self.menu = None
        threading.Thread(target=self.fetch_names, daemon=True).start()
        self.say(partner.get("name") or "Hello", "Right-click me for options", 4)
        self.root.after(TICK_MS, self.tick)

    def cursor(self):
        point = wt.POINT()
        user32.GetCursorPos(ctypes.byref(point))
        return point.x, point.y

    def fetch_names(self):
        self.names = load_names()

    def name_of(self, pokemon):
        return pokemon.get("name") or self.names.get(pokemon["id"]) or f"No.{pokemon['id']:03d}"

    def say(self, title, body="", seconds=3.5):
        self.message = (title, body, time.time() + seconds)

    # -------------------------------------------------- web app messages
    def handle_message(self, payload):
        state = clean_state(payload)
        partner = state["partner"]
        if partner and (partner["id"] != self.partner.pokemon["id"] or partner["name"] != self.partner.pokemon.get("name")):
            changed = partner["id"] != self.partner.pokemon["id"]
            self.partner.pokemon = partner
            self.config["partner"] = partner
            save_config(self.config)
            if changed:
                self.partner.load(partner["id"])
                self.say(self.name_of(partner), "is your new partner", 4)
        elif partner:
            self.partner.pokemon["level"] = partner["level"]
        focus = state["focus"]
        if focus:
            if not self.focus or self.focus["foe"]["id"] != focus["foe"]["id"]:
                self.start_battle(focus)
            self.focus = focus
            self.ended_at = None
        elif self.focus:
            self.end_battle(state["event"])

    def start_battle(self, focus):
        if self.foe:
            self.foe.destroy()
        self.foe = Creature(self, focus["foe"], "foe")
        side = 1 if self.partner.x < monitor_areas(self.partner.x, self.partner.feet)[1][2] - self.partner.width * 3 else -1
        self.foe.x = self.partner.x + side * (self.partner.width + self.foe.width) * 0.75
        self.foe.feet = self.partner.feet - 140
        self.foe.mode = "fall"
        self.last_minute = None
        self.say(f"A wild {self.name_of(focus['foe'])}", "Focus to wear it down", 3)

    def end_battle(self, event, timed_out=False):
        """Finish the desktop battle: caught, fled, timed out, or quietly (buddy switched off)."""
        foe = self.foe
        name = self.name_of(self.focus["foe"]) if self.focus else ""
        self.focus = None
        self.foe = None
        self.ended_at = None
        if foe is None:
            return
        kind = event["type"] if event else ("timeout" if timed_out else "quiet")
        if kind == "caught":
            foe.flash_until = time.time() + 1.4
            self.root.after(1500, foe.destroy)
            self.say(f"Caught {name}!", "Registered in your Pokedex", 6)
            self.partner.hop(8)
            self.root.after(700, lambda: self.partner.hop(6))
            return
        if kind == "fled":
            self.say(f"{name} wandered off", "The session ended early", 5)
        elif kind == "timeout":
            self.say(f"{name} is waiting", "Open PocketDex to finish", 6)
        foe.walk_dir = 1 if foe.x > self.partner.x else -1
        foe.leave_until = time.time() + 4.0
        self.leaving.append(foe)

    def remaining_ms(self):
        if not self.focus:
            return 0
        if self.focus["paused"]:
            return self.focus["remain"]
        return max(0, self.focus["remain"] - (time.time() - self.focus["received"]) * 1000)

    # -------------------------------------------------- loop
    def tick(self):
        if self.closing:
            return
        try:
            self.tick_once()
        except Exception:
            log_error("tick")
        self.root.after(TICK_MS, self.tick)

    def tick_once(self):
        try:
            while True:
                payload = self.inbox.get_nowait()
                try:
                    self.handle_message(payload)
                except Exception:
                    log_error("message")
        except queue.Empty:
            pass
        now = time.time()
        if now - self.topmost_at > 1.5:
            self.topmost_at = now
            for creature in [self.partner, self.foe, *self.leaving]:
                if creature:
                    keep_on_top(creature.hwnd)
            keep_on_top(self.bubble.hwnd)
        if now - self.windows_at > 0.12:
            self.windows = top_level_windows()
            self.windows_at = now
        if now - self.hidden_checked > 1.0:
            self.hidden_checked = now
            should_hide = foreground_is_fullscreen()
            if should_hide != self.hidden:
                self.hidden = should_hide
                for creature in (self.partner, self.foe):
                    if creature:
                        (creature.win.withdraw if should_hide else creature.win.deiconify)()
                if should_hide:
                    self.bubble.hide()
        if not self.hidden:
            self.update_creatures(now)
            self.update_bubble(now)
        self.publish_status()

    def publish_status(self):
        """Small read-only snapshot for GET /status (used by tests and the web app)."""

        def describe(creature):
            if creature is None:
                return None
            return {
                "id": creature.pokemon["id"],
                "mode": creature.mode,
                "x": round(creature.x),
                "feet": round(creature.feet),
                "width": creature.width,
                "height": creature.height,
                "surface": creature.surface[0] if creature.surface else None,
            }

        LinkHandler.snapshot = {
            "partner": describe(self.partner),
            "foe": describe(self.foe),
            "leaving": len(self.leaving),
            "focus": None if not self.focus else {
                "foe": self.focus["foe"]["id"],
                "remainMs": round(self.remaining_ms()),
                "paused": self.focus["paused"],
            },
            "bubble": None if self.bubble.shown is None else self.bubble.shown[0],
            "hidden": self.hidden,
        }

    def update_creatures(self, now):
        partner = self.partner
        if partner.mode != "drag":
            partner.step_physics(self.windows)
        if self.focus and self.foe:
            foe = self.foe
            if foe.mode != "drag":
                foe.step_physics(self.windows)
            gap = (partner.width + foe.width) * 0.62
            if foe.mode == "stand" and partner.mode == "stand":
                target = partner.x + (gap if foe.x >= partner.x else -gap)
                foe.move_toward(target, 2.5)
                if abs(foe.feet - partner.feet) > 4 and abs(foe.x - target) < 6:
                    foe.hop(9)
            partner.walk_dir = 0
            partner.set_facing("right" if foe.x > partner.x else "left")
            foe.set_facing("left" if foe.x > partner.x else "right")
            remaining = self.remaining_ms()
            elapsed_minutes = int((self.focus["minutes"] * 60000 - remaining) // 60000)
            if self.last_minute is not None and elapsed_minutes > self.last_minute and not self.focus["paused"]:
                partner.lunge_until = now + 0.35
                foe.flash_until = now + 0.7
            self.last_minute = elapsed_minutes
            if remaining <= 0 and not self.focus["paused"] and self.ended_at is None:
                self.ended_at = now
            if self.ended_at and now - self.ended_at > 600:
                self.end_battle(None, timed_out=True)
            else:
                foe.place()
        else:
            partner.wander(self.config.get("wander", True))
        for foe in list(self.leaving):
            if now >= foe.leave_until:
                self.leaving.remove(foe)
                foe.destroy()
                continue
            if foe.mode != "drag":
                foe.step_physics(self.windows)
            if foe.mode == "stand":
                foe.x += foe.walk_dir * 2.4
                foe.bob += 1
                foe.set_facing("right" if foe.walk_dir > 0 else "left")
                work, full = monitor_areas(foe.x, foe.feet - 5)
                if foe.x - foe.width / 2 <= full[0] or foe.x + foe.width / 2 >= full[2]:
                    foe.leave_until = now
            foe.place()
        partner.place()
        if partner.mode == "stand":
            self.config["x"] = int(partner.x)

    def update_bubble(self, now):
        anchor = (self.partner.x, self.partner.feet - self.partner.height)
        if self.focus and self.foe:
            anchor = ((self.partner.x + self.foe.x) / 2, min(self.partner.feet - self.partner.height, self.foe.feet - self.foe.height))
        if self.message and now < self.message[2]:
            self.bubble.show(self.message[0], self.message[1], anchor=anchor)
            return
        self.message = None
        if self.focus and self.foe and self.config.get("bubble", True):
            remaining = self.remaining_ms()
            seconds = int(math.ceil(remaining / 1000))
            title = f"{seconds // 60:02d}:{seconds % 60:02d}"
            foe_name = self.name_of(self.focus["foe"])
            if self.focus["paused"]:
                body = f"Paused · {foe_name} is waiting"
            elif remaining <= 0:
                body = f"Time! Open PocketDex to catch {foe_name}"
            else:
                body = f"{self.name_of(self.partner.pokemon)} vs {foe_name}"
            hp = remaining / (self.focus["minutes"] * 60000)
            self.bubble.show(title, body, hp=hp, anchor=anchor)
        else:
            self.bubble.hide()

    # -------------------------------------------------- interaction
    def on_poke(self, creature):
        if creature is self.partner:
            pokemon = self.partner.pokemon
            level = f"Lv {pokemon['level']}" if pokemon.get("level") else "Your partner"
            if self.focus:
                self.say(self.name_of(pokemon), "Keep going, I have got this", 2.5)
            else:
                self.say(self.name_of(pokemon), level, 2.5)
        else:
            self.say(self.name_of(creature.pokemon), "A wild Pokemon. Stay focused", 2.5)

    def open_app(self):
        webbrowser.open(APP_URL + ("#/focus" if self.focus else "#/today"))

    def show_menu(self, event):
        menu = tk.Menu(self.root, tearoff=0)
        pokemon = self.partner.pokemon
        level = f" · Lv {pokemon['level']}" if pokemon.get("level") else ""
        menu.add_command(label=f"{self.name_of(pokemon)}{level}", state="disabled")
        menu.add_separator()
        menu.add_command(label="Open PocketDex", command=self.open_app)
        menu.add_command(label="Start a focus session", command=lambda: webbrowser.open(APP_URL + "#/focus"))
        menu.add_command(label="Choose partner by number...", command=self.choose_partner)
        menu.add_separator()
        sizes = tk.Menu(menu, tearoff=0)
        self.size_var = tk.StringVar(value=self.config.get("size", "Medium"))
        for name in SIZES:
            sizes.add_radiobutton(label=name, variable=self.size_var, value=name, command=self.set_size)
        menu.add_cascade(label="Size", menu=sizes)
        self.wander_var = tk.BooleanVar(value=self.config.get("wander", True))
        menu.add_checkbutton(label="Walk around", variable=self.wander_var, command=self.toggle_wander)
        self.bubble_var = tk.BooleanVar(value=self.config.get("bubble", True))
        menu.add_checkbutton(label="Show focus timer", variable=self.bubble_var, command=self.toggle_bubble)
        self.autostart_var = tk.BooleanVar(value=autostart_enabled())
        menu.add_checkbutton(label="Start with Windows", variable=self.autostart_var, command=self.toggle_autostart)
        menu.add_separator()
        menu.add_command(label="Bring to taskbar", command=self.bring_home)
        menu.add_command(label="Quit", command=self.quit)
        self.menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    def choose_partner(self):
        value = simpledialog.askinteger("PocketDex Buddy", "Pokedex number (1-1025):", minvalue=1, maxvalue=1025, parent=self.root)
        if value:
            partner = {"id": value, "name": self.names.get(value, ""), "level": 0}
            self.partner.pokemon = partner
            self.config["partner"] = partner
            save_config(self.config)
            self.partner.load(value)
            self.say(self.name_of(partner), "is now on your desktop", 3)

    def set_size(self):
        self.config["size"] = self.size_var.get()
        save_config(self.config)
        self.partner.load(self.partner.pokemon["id"])
        if self.foe:
            self.foe.load(self.foe.pokemon["id"])

    def toggle_wander(self):
        self.config["wander"] = bool(self.wander_var.get())
        save_config(self.config)

    def toggle_bubble(self):
        self.config["bubble"] = bool(self.bubble_var.get())
        save_config(self.config)

    def toggle_autostart(self):
        set_autostart(bool(self.autostart_var.get()))

    def bring_home(self):
        x, y = self.cursor()
        work, _full = monitor_areas(x, y)
        self.partner.x = float(x)
        self.partner.feet = float(work[3] - 200)
        self.partner.fall()

    def quit(self):
        self.closing = True
        save_config(self.config)
        self.root.destroy()

    def run(self):
        self.root.mainloop()


def main():
    enable_dpi_awareness()
    inbox = queue.Queue()
    try:
        start_link(inbox)
    except OSError:
        root = tk.Tk()
        root.withdraw()
        from tkinter import messagebox

        messagebox.showinfo("PocketDex Buddy", "PocketDex Buddy is already running. Look on your taskbar.")
        return
    app = BuddyApp()
    app.inbox = inbox
    app.run()


if __name__ == "__main__":
    main()
