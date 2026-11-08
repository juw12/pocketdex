"""Static hard gates for PocketDex (rubric G2, G3, G4, G6). Exit 1 on any failure."""
import colorsys
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
SHIPPED = ["index.html", "styles.css", "app.js", "meadow.js", "manifest.webmanifest", "README.md"]
PY = sys.executable
SLOP = Path.home() / ".vector" / "skills" / "hone" / "design" / "tools" / "slop_check.py"

# emoji and pictographs, plus symbols that browsers may draw as emoji (play/reverse triangles, check marks, stars)
EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\uFE0F\u25B6\u25C0\u25C9\u2190-\u21FF\u2705\u2714\u2728]"
)
EMOJI_ENTITY = re.compile(r"&#(9654|9664|9673|128\d{3}|127\d{3}|9733|9734|10003|10004);")

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
    if not ok:
        failures.append(name)


def hex_colors(text):
    for match in re.finditer(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", text):
        value = match.group(1)
        if len(value) == 3:
            value = "".join(c * 2 for c in value)
        yield "#" + value, tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))
    for match in re.finditer(r"0x([0-9a-fA-F]{6})\b", text):
        value = match.group(1)
        yield "0x" + value, tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(rgb):
    def channel(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted([luminance(a), luminance(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def rgb(hex_value):
    return tuple(int(hex_value[i : i + 2], 16) / 255 for i in (1, 3, 5))


# G3 no emoji
emoji_hits = []
for name in SHIPPED:
    text = (APP / name).read_text(encoding="utf-8")
    for line_no, line in enumerate(text.splitlines(), 1):
        if EMOJI.search(line) or EMOJI_ENTITY.search(line):
            emoji_hits.append(f"{name}:{line_no}")
check("G3 no emoji or emoji-like symbols in shipped files", not emoji_hits, emoji_hits[:5])

# G4 no purple
purple = []
for name in ["styles.css", "app.js", "meadow.js", "index.html"]:
    text = (APP / name).read_text(encoding="utf-8")
    for token, color in hex_colors(text):
        h, l, s = colorsys.rgb_to_hls(*color)
        if 255 / 360 <= h <= 320 / 360 and s > 0.2 and 0.08 < l < 0.95:
            purple.append(f"{name}:{token}")
check("G4 no purple colours (hue 255-320, sat > 0.2)", not purple, purple[:8])

# G6 contrast of text tokens
css = (APP / "styles.css").read_text(encoding="utf-8")
tokens = dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})", css))
pairs = [
    ("text", "bg"), ("text", "surface"), ("muted", "bg"), ("muted", "surface"), ("muted", "surface-2"),
    ("accent", "surface"), ("accent", "bg"), ("bg", "text"),
]
low = []
for fg, bg in pairs:
    ratio = contrast(rgb(tokens[fg]), rgb(tokens[bg]))
    if ratio < 4.5:
        low.append(f"{fg}/{bg}={ratio:.2f}")
check("G6 text tokens meet AA 4.5:1", not low, low)

# G2 slop_check
result = subprocess.run([PY, str(SLOP), str(APP / "index.html"), str(APP / "styles.css"), str(APP / "app.js")], capture_output=True, text=True)
check("G2 slop_check 0 blockers", result.returncode == 0, result.stdout[-400:])
print(result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "")

sys.exit(1 if failures else 0)
