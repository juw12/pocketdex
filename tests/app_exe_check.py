"""Windows app checks: PocketDex.exe opens one window, a second launch hands off, --buddy runs the buddy."""
import ctypes
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
EXE = APP / "build" / "windows" / "dist" / "PocketDex" / "PocketDex.exe"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"), flush=True)


def get(port, path):
    with opener.open(f"http://127.0.0.1:{port}{path}", timeout=3) as response:
        return response.read()


def wait_for(port, path, seconds=40):
    end = time.time() + seconds
    while time.time() < end:
        try:
            return get(port, path)
        except OSError:
            time.sleep(0.5)
    return None


def pocketdex_windows():
    user32 = ctypes.windll.user32
    found = []
    proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def callback(hwnd, _):
        buffer = ctypes.create_unicode_buffer(64)
        user32.GetWindowTextW(hwnd, buffer, 64)
        if buffer.value == "PocketDex" and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(proc(callback), 0)
    return found


def main():
    check("PocketDex.exe was built", EXE.exists(), EXE)
    first = subprocess.Popen([str(EXE)])
    reply = wait_for(47616, "/__pocketdex")
    check("app serves PocketDex on its fixed port", reply and json.loads(reply)["app"] == "pocketdex", reply)
    page = get(47616, "/index.html").decode("utf-8")
    check("app serves the bundled web app", "<title>PocketDex</title>" in page)
    check("bundled sprites are present", len(get(47616, "/sprites/25.png")) > 200)
    time.sleep(4)
    check("one PocketDex window is open", len(pocketdex_windows()) == 1, pocketdex_windows())

    second = subprocess.Popen([str(EXE)])
    try:
        second.wait(timeout=25)
        handed_off = True
    except subprocess.TimeoutExpired:
        handed_off = False
        second.kill()
    check("a second launch hands off and exits", handed_off)
    time.sleep(1)
    check("still exactly one window", len(pocketdex_windows()) == 1, pocketdex_windows())
    check("first app still running", first.poll() is None)

    buddy = subprocess.Popen([str(EXE), "--buddy"])
    status = None
    end = time.time() + 40
    while time.time() < end:
        try:
            status = json.loads(get(47615, "/status"))
            if status.get("partner"):
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    check("PocketDex.exe --buddy runs the desktop buddy", status and status.get("partner"), status)
    check("buddy reports its emote state", status is not None and "emote" in status, status)
    second_buddy = subprocess.Popen([str(EXE), "--buddy"])
    try:
        second_buddy.wait(timeout=20)
        check("a second buddy does not start", True)
    except subprocess.TimeoutExpired:
        second_buddy.kill()
        check("a second buddy does not start", False)

    for proc in (buddy, first):
        proc.kill()
    print(f"\n{sum(results)}/{len(results)} app checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
