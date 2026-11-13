# PocketDex

A calm, pixel-sprite Pokédex that you also use every day, with a small 3D meadow where the Pokémon you catch come to rest. Works offline: all 1025 Pokémon, sprites and fonts
are bundled. No account, no server; your progress is saved in the browser.

## Open it
- Double-click `index.html` (works straight from disk), or
- serve the folder for the offline service worker and "install" option: `python -m http.server 8000` then open
  http://localhost:8000.

## What's inside
| Page | What it does |
|---|---|
| Today | One clear next step (catch today's Pokémon, finish a habit, or rest), a live window into your Meadow, daily encounter (a new Pokémon each date, same for everyone), streak, focus minutes, habit checklist, partner, recent catches. |
| Pokédex | 1025 species. Search by name, number, type or `gen2`; filter by type, region, caught/missing/favourites. Entry: stats, type matchups, abilities, evolution chain, chiptune cry, your own field note. Arrow keys flip entries, `/` searches. |
| Focus | Pomodoro as a wild battle: pick 15/25/45/60 min. The wild Pokémon (top right) loses HP as you work while your partner (bottom left) fights beside you and banks XP each minute. Finish to catch it; end early and it wanders off. While a session runs, a small widget follows you on every page, and **Pop out timer** opens an always-on-top battle window you can keep beside other apps (Chrome/Edge on desktop; on phones it becomes a floating mini player over other apps, with the same live animation). **Keep screen on** turns a phone on a stand into a battle desk clock, and an optional lock-screen notice shows who you are catching and when the session ends. Survives reloads; optional browser notification. |
| Habits | Your daily habits, each with a type. Every tick gives your partner 40 XP, every focus minute 5 XP. Partners level up and evolve at Lv 16 and 32 (branching evolutions let you choose). 7-day grid and streak per habit. |
| Meadow | A quiet low-poly 3D clearing. Your partner, today's wild Pokémon and your recent catches wander there; the sky follows your local time, with drifting clouds, butterflies by day and ripples on the pond. Drag to look around, scroll or pinch to zoom, tap a Pokémon to see it. Nothing to win. |
| Field Dex | Make your own Pokédex entries of real life: take a photo, it becomes a 64 px sprite in a Game Boy, Pocket, Kanto-red or colour palette (with dithering). Add type, size, place and entry text, then save it as a 600x840 card image. |
| Quiz | "Who's that Pokémon?" silhouettes, filter by region, keys 1-4, streak and best score. |
| Team | 6-slot team builder with a defensive matchup matrix, shared-weakness warning, offensive coverage gaps and a dual-type calculator. |
| Trainer | Trainer card, 8 Kanto badges for real milestones, progress per region, sound toggle, backup export/import, reset. |

Navigation: Today, Pokédex, Focus, Habits and More (Meadow, Field Dex, Quiz, Team, Trainer). On phones and tablets they sit in a floating bottom tab bar; on desktop (1081 px and wider) the same tabs move into the top bar so nothing floats over the content.

## PocketDex as an app

**Windows:** download [PocketDex for Windows](downloads/PocketDex-Windows.zip), unzip it anywhere and open `PocketDex.exe`. It is the whole PocketDex in its own window. It works offline, keeps its own save, and has the desktop buddy built in: switch on Trainer > Desktop buddy and your partner hops onto the taskbar, no Python needed. Opening it again brings the open window to the front. The first time it opens, it adds PocketDex to the Start menu and the Desktop (delete them and they stay gone). To keep it on the taskbar, right-click its icon while it runs and choose Pin to taskbar; Windows only lets you do that yourself. When a new version is out, a small banner in the app says so and links to the download (it checks [version.json](version.json) on the site). To move your progress over from the browser, use Trainer > Export backup in the browser, then Import backup in the app.

Build it yourself: `pip install pywebview pyinstaller`, then `python desktop/build_windows.py` (add `--install` to copy it to your user Programs folder with a Start menu shortcut). The app source is `desktop/pocketdex_app.py`.

**Phone and tablet:** open the site and choose Add to Home screen (Android Chrome also shows an Install button under Trainer). It opens full screen with its own icon, works offline, and long-pressing the icon offers Focus, Habits and Pokedex shortcuts.

## Feelings

Your partner has moods that come from what you actually do: happy after a habit, proud when the day is done, sleepy late at night, and it misses you when you have been away for days. A small pixel emote shows above its head, with a line saying how it feels. Tap it to pet it: it hops, hearts float up and friendship grows (five hearts, up to ten pets a day; habits and focus sessions add to it too). Catching a Pokemon plays a short catch scene: the Pokemon is drawn into the ball, the ball wobbles three times, then clicks. Levelling up shows a glow. On the desktop the buddy reacts too: a heart when you click it, "!" when a wild Pokemon appears, a sweat drop while paused, sparkles on a catch, and it dozes with "zzz" when you have been away from the keyboard. Everything holds still when the system asks for reduced motion.

## Desktop buddy (Windows)

`desktop/pocketdex_buddy.pyw` puts your partner on the Windows desktop with a transparent background, always on top:

- it walks along the taskbar and climbs onto the top edges of open windows
- it rides along when you move that window, and falls when the window is closed, minimised or covered
- drag it to pick it up, let go mid-swing to throw it; click for a hop, double-click to open PocketDex
- right-click for the menu: open PocketDex, start a focus session, choose a partner by Pokedex number, size, walk around, show focus timer, start with Windows, bring to taskbar, quit
- it hides while a full-screen app or video is in front

Linked to the web app: switch on **Trainer > Desktop buddy for Windows**. The buddy picks up your partner, and during a focus session the wild Pokemon drops in beside it. A small bubble shows the time left with an HP bar. Pauses, the catch and an early end all play out on the desktop.

Run it: install Python 3 from python.org (tkinter is included), then double-click `pocketdex_buddy.pyw` or run `pythonw pocketdex_buddy.pyw`. It uses only the standard library. Sprites come from this repo (or are downloaded once and cached in `%LOCALAPPDATA%\PocketDex`).

Privacy: the buddy listens on `127.0.0.1:47615` only, accepts state from the PocketDex page alone, and sends nothing anywhere. The browser may ask once to allow access to apps on this device. Allow it so the page can reach the buddy.

## iPhone widget (with Haru and Cozy Island)

One home-screen widget shows PocketDex, [Haru](https://juw12.github.io/projects/haru/app/) and [Cozy Island](https://juw12.github.io/portfolio/cozy-island/) side by side: your partner, level and mood, today's habits and streak, the Haru scene and day counts, the island season and garden. A running focus battle or focus session counts down live on the widget.

Set it up at [juw12.github.io/pocketdex/widget/](https://juw12.github.io/pocketdex/widget/): make a widget code, pair the browser, then paste the widget script into the free Scriptable app on the iPhone and add a Scriptable widget (medium or large for all three; small or lock-screen for one app). In PocketDex the code field is under **Trainer > iPhone widget**.

How it works: while a code is saved, each app posts a small summary (names, counts and timer end times; no diary text, photos or place names) to `https://ntfy.sh/<code>`, a free public relay, and the widget reads the newest one per app. Nothing is sent without a code. Anyone who has the code can read those summaries, so keep it private; unpairing stops the updates. Timers tick every second; other changes show when iOS next redraws the widget, usually within 5 to 15 minutes.

Not covered yet: the Windows download above was not rebuilt, so it has no widget feed until the next build.

## Files
- `index.html`, `styles.css`, `app.js` - the app (vanilla JS, no build step). `meadow.js` - the 3D Meadow.
- `vendor/three.min.js` - three.js r160 (MIT). `vendor/sprites-data.js` - sprite bundle used only when the app is opened from disk, so WebGL can read the sprites.
- `data.js` - generated from the PokeAPI CSV data by `../build/build_data.py`.
- `sprites/` - 1025 front sprites from the PokeAPI sprites repo. `fonts/` - Silkscreen (OFL), used for Dex numbers.
- `widget/` - iPhone widget: `sync.js` (shared sender, also loaded by Haru and Cozy Island), `trio.js` (the Scriptable widget), `loader.js`, `index.html` (setup page). Checks: `tests/widget_sync_check.py`, `tests/widget_trio_check.js`.
- `design.md` - design system (palette, type, rules). `tests/e2e.py` - Playwright end-to-end checks.

Pokémon and all related names are trademarks of Nintendo, Game Freak and Creatures. This is an unofficial,
non-commercial fan project.
