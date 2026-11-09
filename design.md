# PocketDex design system

Version 2: "A quiet place you visit". Same family as Jeda (juw12/jeda), with the calm of Sansa (the Korean
virtual temple: a place you visit, not a game you win). It replaced the v1 "field guide" print style.

## References
- Jeda (juw12/jeda): warm paper page, white soft cards, 20 px radius, serif titles, ink pill buttons,
  floating pill tab bar. Taken: the whole surface language.
- Sansa: one calm 3D place that follows the real time of day; nothing to win. Taken: the Meadow and its tone.
- Pokémon Red/Blue Pokédex (1996): pixel sprites and "No.025" numbering. Taken: sprites kept pixel-sharp,
  Silkscreen only for Dex numbers.

## Palette (one accent)
| token | hex | use |
|---|---|---|
| --bg | #f6f2eb | page (warm paper, faint top glow) |
| --surface | #ffffff | cards, inputs, tab bar |
| --surface-2 | #f0ebe2 | sprite plates, text boxes, quiet fills |
| --line | #e6dfd3 | hairlines and card borders |
| --text | #26221d | body text, primary (ink) buttons |
| --muted | #6b6157 | secondary text (AA on bg and surface) |
| --accent | #c0432f | Poké red: Dex numbers, progress, active states, the brand dot |
| --accent-soft | #f7e6df | accent tints |
| --ok | #3f7f52 | done / caught |

Type colours appear only as small dots inside neutral chips. No purple anywhere: ghost, poison, dragon,
psychic and fairy use slate, raspberry, teal and pinks.

## Type
- Titles: system serif stack (Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia) 600.
- Body and UI: system sans (Segoe UI, system-ui, Roboto).
- Dex numbers only: Silkscreen (bundled in `fonts/`, OFL).
- Eyebrows: 0.72 rem, 0.14 em tracking, uppercase, muted.

## Shape, depth, motion
- Radius 20 px (cards), 14 px (small), pills for buttons, chips and the tab bar.
- Shadow: two soft warm layers (`--shadow`), a slightly deeper one on hover (`--shadow-lift`). No glow.
- Motion: gentle; meadow idle drift, sprite hop, clouds, butterflies (day only), pond ripples, 150 ms hovers. prefers-reduced-motion stops all of it.
- Focus is a two-sided battle: wild Pokémon top right with a draining HP bar, partner bottom left (mirrored, seen from behind) with Lv, HP and the XP it is banking. A floating widget (partner vs wild, HP, countdown) follows every other page; Document Picture-in-Picture gives an always-on-top pop-out.
- Phones: the same battle is drawn on a 480x270 canvas and streamed into a Picture-in-Picture video, so it floats over other apps (Android Chrome, iPhone Safari). Wake Lock keeps the screen on; a silent lock-screen notice shows target + end time. A true home-screen widget needs a native app (WidgetKit / Glance), so it is out of scope for the web app.
- Today leads with one next-step strip (one sentence, one button) so the page always answers "what now?".

## Navigation
Top bar: serif wordmark with a red dot, "Caught n / 1025" count, sound toggle. Tabs with SVG line icons:
Today, Pokédex, Focus, Habits, More (More holds Meadow, Field Dex, Quiz, Team, Trainer). Below 1081 px they
float in a bottom pill tab bar; from 1081 px they sit in the top bar so nothing covers content on desktop.

## One action per screen
Each screen has one dark primary button. Secondary actions are outlined; tools (Play cry, Add favourite,
Add to team, Pop out timer, Keep screen on) are quiet underlined text links. Battle bars use the single
accent only for the wild Pokemon's HP; the partner's HP and XP are warm neutrals.

## Signature element
The Meadow: a low-poly 3D clearing (three.js, bundled) where the Pokémon you caught wander as pixel
billboards. The sky follows your local time (dawn, day, dusk, night with fireflies). Drag to look around,
tap a Pokémon to see it. A small live window of it opens the Today page.

## Voice
Plain, short, calm. Game text only where the originals had it ("A wild SNORLAX appeared!").
Banned words: supercharge, seamless, unlock, next-level, revolutionary, magic.

## Desktop buddy

The desktop companion follows the same system: the sprite itself is the interface, with no frame and no window chrome. The only surface is a paper-coloured bubble (#fffdf9, 1px #e3d9c8 line, 12px radius), with a Georgia time title, Segoe UI muted body and a single 4px HP bar in the accent. Copy stays calm ("Paused · Eevee is waiting", "Caught Eevee!"). It never flashes for attention, and it hides behind full-screen apps.

## Feelings and motion

Emotion lives in the partner, not in the chrome. Moods map to one pixel emote each (heart, note, sparkle, zzz, "!", sweat, dots), drawn as SVG bitmaps in the existing palette, never emoji. Motion is short and physical: squash and stretch hops, a 0.4s staggered page entrance that does not replay on in-page updates, and one full-screen moment at a time (catch, level up) on a paper card that never blocks clicks and leaves on its own. All of it stops under prefers-reduced-motion.

## Banned defaults
Purple or indigo; emoji or emoji-like glyphs as icons; gradient text; glassmorphism; glow blobs;
centred-everything hero; fake testimonials; Inter as the only face.
