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
| Focus | Pomodoro as a wild battle: pick 15/25/45/60 min. The wild Pokémon (top right) loses HP as you work while your partner (bottom left) fights beside you and banks XP each minute. Finish to catch it, run away and it flees. While a session runs, a small widget follows you on every page, and **Pop out timer** opens an always-on-top battle window (Chrome/Edge) you can keep beside other apps. Survives reloads; optional browser notification. |
| Habits | Your daily habits, each with a type. Every tick gives your partner 40 XP, every focus minute 5 XP. Partners level up and evolve at Lv 16 and 32 (branching evolutions let you choose). 7-day grid and streak per habit. |
| Meadow | A quiet low-poly 3D clearing. Your partner, today's wild Pokémon and your recent catches wander there; the sky follows your local time, with drifting clouds, butterflies by day and ripples on the pond. Drag to look around, scroll or pinch to zoom, tap a Pokémon to see it. Nothing to win. |
| Field Dex | Make your own Pokédex entries of real life: take a photo, it becomes a 64 px sprite in a Game Boy, Pocket, Kanto-red or colour palette (with dithering). Add type, size, place and entry text, then save it as a 600x840 card image. |
| Quiz | "Who's that Pokémon?" silhouettes, filter by region, keys 1-4, streak and best score. |
| Team | 6-slot team builder with a defensive matchup matrix, shared-weakness warning, offensive coverage gaps and a dual-type calculator. |
| Trainer | Trainer card, 8 Kanto badges for real milestones, progress per region, sound toggle, backup export/import, reset. |

Navigation: the bottom tab bar holds Today, Pokédex, Focus, Habits and More (Meadow, Field Dex, Quiz, Team, Trainer).

## Files
- `index.html`, `styles.css`, `app.js` - the app (vanilla JS, no build step). `meadow.js` - the 3D Meadow.
- `vendor/three.min.js` - three.js r160 (MIT). `vendor/sprites-data.js` - sprite bundle used only when the app is opened from disk, so WebGL can read the sprites.
- `data.js` - generated from the PokeAPI CSV data by `../build/build_data.py`.
- `sprites/` - 1025 front sprites from the PokeAPI sprites repo. `fonts/` - Silkscreen (OFL), used for Dex numbers.
- `design.md` - design system (palette, type, rules). `tests/e2e.py` - Playwright end-to-end checks.

Pokémon and all related names are trademarks of Nintendo, Game Freak and Creatures. This is an unofficial,
non-commercial fan project.
