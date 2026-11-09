"""Build PocketDex for Windows (PocketDex.exe) with PyInstaller.

    python desktop/build_windows.py            build into build/windows/dist/PocketDex and zip it
    python desktop/build_windows.py --install  also copy it to %LOCALAPPDATA%\\Programs\\PocketDex
                                               and add a Start menu shortcut

Needs: pip install pywebview pyinstaller
"""

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build" / "windows"
STAGE = BUILD / "web"
DIST = BUILD / "dist"
ZIP_PATH = BUILD / "PocketDex-Windows.zip"
WEB_FILES = ["index.html", "app.js", "data.js", "meadow.js", "styles.css", "sw.js", "manifest.webmanifest", "version.json"]
WEB_DIRS = ["sprites", "fonts", "icons", "vendor"]
INSTALL_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Programs" / "PocketDex"


def stage_web():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    for name in WEB_FILES:
        shutil.copy2(ROOT / name, STAGE / name)
    for name in WEB_DIRS:
        if (ROOT / name).exists():
            shutil.copytree(ROOT / name, STAGE / name)
    (STAGE / "desktop").mkdir()
    shutil.copy2(ROOT / "desktop" / "pocketdex_buddy.pyw", STAGE / "desktop" / "pocketdex_buddy.pyw")


def run_pyinstaller():
    command = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--windowed",
        "--name", "PocketDex",
        "--icon", str(ROOT / "icons" / "pocketdex.ico"),
        "--add-data", f"{STAGE}{os.pathsep}web",
        # The desktop buddy is loaded at run time, so PyInstaller cannot see its imports: list them.
        "--hidden-import", "tkinter",
        "--hidden-import", "tkinter.font",
        "--hidden-import", "tkinter.simpledialog",
        "--hidden-import", "tkinter.messagebox",
        "--hidden-import", "winreg",
        "--hidden-import", "webbrowser",
        "--hidden-import", "queue",
        "--distpath", str(DIST),
        "--workpath", str(BUILD / "work"),
        "--specpath", str(BUILD),
        "--version-file", str(write_version_file()),
        str(ROOT / "desktop" / "pocketdex_app.py"),
    ]
    subprocess.run(command, check=True)


def write_version_file():
    path = BUILD / "version.txt"
    path.write_text(
        """VSVersionInfo(
  ffi=FixedFileInfo(filevers=(1, 1, 0, 0), prodvers=(1, 1, 0, 0), mask=0x3f, flags=0x0, OS=0x40004,
    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'juw12'),
      StringStruct('FileDescription', 'PocketDex'),
      StringStruct('FileVersion', '1.1.0'),
      StringStruct('ProductName', 'PocketDex'),
      StringStruct('ProductVersion', '1.1.0'),
      StringStruct('OriginalFilename', 'PocketDex.exe')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
""",
        encoding="utf-8",
    )
    return path


def make_zip():
    app_dir = DIST / "PocketDex"
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in app_dir.rglob("*"):
            archive.write(path, Path("PocketDex") / path.relative_to(app_dir))
    print(f"zip: {ZIP_PATH} ({ZIP_PATH.stat().st_size / 1e6:.1f} MB)")


def install():
    if INSTALL_DIR.exists():
        shutil.rmtree(INSTALL_DIR)
    shutil.copytree(DIST / "PocketDex", INSTALL_DIR)
    start_menu = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "PocketDex.lnk"
    exe = INSTALL_DIR / "PocketDex.exe"
    script = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}');"
        "$s.TargetPath = '{exe}'; $s.WorkingDirectory = '{cwd}'; $s.IconLocation = '{exe},0';"
        "$s.Description = 'PocketDex'; $s.Save()"
    ).format(lnk=start_menu, exe=exe, cwd=INSTALL_DIR)
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)
    desktop_script = (
        "$lnk = [IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'PocketDex.lnk');"
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk);"
        "$s.TargetPath = '{exe}'; $s.WorkingDirectory = '{cwd}'; $s.IconLocation = '{exe},0';"
        "$s.Description = 'PocketDex'; $s.Save(); Write-Output $lnk"
    ).format(exe=exe, cwd=INSTALL_DIR)
    desktop = subprocess.run(
        ["powershell", "-NoProfile", "-Command", desktop_script],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    # The app makes these shortcuts itself on first run; tell it they already exist.
    data_dir = Path(os.environ["LOCALAPPDATA"]) / "PocketDex"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "shortcuts-made").write_text(str(exe), encoding="utf-8")
    print(f"installed: {exe}\nshortcut: {start_menu}\ndesktop: {desktop}")
    print("taskbar: Windows 11 only lets you pin it yourself - right-click the running icon > Pin to taskbar")


if __name__ == "__main__":
    stage_web()
    run_pyinstaller()
    make_zip()
    if "--install" in sys.argv:
        install()
