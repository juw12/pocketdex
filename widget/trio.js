/* juw12 trio widget: PocketDex, Haru, Cozy Island and Cairn on one iPhone home-screen widget.
 *
 * Runs inside Scriptable (iOS). The small loader script (loader.js, copied from the setup page)
 * downloads this file and calls main({ code, param }), so fixes arrive without pasting again.
 * The top half is plain JavaScript and is also used by the setup page preview.
 */
const TRIO_VERSION = "1.4.1";
const TRIO_RELAY = "https://ntfy.sh";
const TRIO_SETUP = "juw12.github.io/widget";
const TRIO_LIVE = "https://juw12.github.io/pocketdex/widget/live.html";
const TRIO_APPS = ["pocketdex", "haru", "cozy", "cairn"];
/** Parameter words that make one widget take turns showing each app, one per time slot. */
const TRIO_ROTATE_WORDS = ["rotate", "auto", "cycle", "switch"];
const TRIO_ROTATE_MS = 5 * 60 * 1000;
const TRIO_INFO = {
  pocketdex: { title: "PocketDex", accent: "#ffcb05", link: "https://juw12.github.io/pocketdex/", symbol: "sparkles" },
  haru: { title: "Haru", accent: "#ff9db0", link: "https://juw12.github.io/projects/haru/app/", symbol: "sun.max.fill" },
  cozy: { title: "Cozy Island", accent: "#8fd694", link: "https://juw12.github.io/portfolio/cozy-island/", symbol: "leaf.fill" },
  cairn: { title: "Cairn", accent: "#9db4ff", link: "https://juw12.github.io/cairn/", symbol: "mountain.2.fill" },
};
/** How each app looks on its own (small widgets and one-app medium/large widgets), taken from the apps. */
const TRIO_THEMES = {
  pocketdex: { bg: "#f6f2eb", ink: "#26221d", muted: "#6b6157", accent: "#c0432f", soft: "#f7e6df", face: "rounded" },
  haru: { bg: "#f6efe2", ink: "#3b3127", muted: "#7a6a58", accent: "#d9826b", soft: "#fffaf2", face: "plain", photo: true },
  cozy: { bg: "#f0c3ae", ink: "#4a2e22", muted: "#7a5444", accent: "#c8643f", soft: "#fff4ea", face: "rounded", photo: true },
  cairn: { bg: "#f4f1ea", ink: "#1b1a17", muted: "#6c665d", accent: "#d9481f", soft: "#fffdf8", face: "serif" },
};
/** Cozy Island screenshots cropped clear of the game menu, kept next to this widget. */
const TRIO_COZY_ART = "https://juw12.github.io/pocketdex/widget/art/";
const TRIO_ALIASES = {
  pokedex: "pocketdex",
  pocket: "pocketdex",
  dex: "pocketdex",
  island: "cozy",
  "cozy-island": "cozy",
  cozyisland: "cozy",
  vibe: "cairn",
  sessions: "cairn",
};
const TRIO_STEPS = { pass: "tests passed", fail: "check failed", commit: "committed", start: "just started", prompt: "prompting", skill: "using a skill", end: "wrapping up" };

// ---------------------------------------------------------------- data (no Scriptable APIs below)

/** Newest valid snapshot per app from the relay's newline-separated JSON. */
function trioParseFeed(text) {
  const latest = {};
  String(text || "").split("\n").forEach((line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.event && event.event !== "message") return;
      const message = JSON.parse(event.message);
      if (!message || message.v !== 1 || TRIO_APPS.indexOf(message.app) < 0) return;
      if (!message.d || typeof message.d !== "object" || !Number.isFinite(message.at)) return;
      if (!latest[message.app] || message.at > latest[message.app].at) {
        latest[message.app] = { at: message.at, d: message.d };
      }
    } catch (error) {
      /* not one of ours */
    }
  });
  return latest;
}

/** Keeps the newer snapshot of each app, so the widget still shows data after the relay forgets it. */
function trioMerge(saved, fresh) {
  const merged = {};
  TRIO_APPS.forEach((app) => {
    const a = saved && saved[app];
    const b = fresh && fresh[app];
    const pick = a && b ? (b.at >= a.at ? b : a) : a || b;
    if (pick && pick.d && Number.isFinite(pick.at)) merged[app] = pick;
  });
  return merged;
}

function trioDayKey(now) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function trioWords(value) {
  const text = String(value || "").replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function trioCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function trioClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

/** The local time the widget last ran, so a stale widget is easy to spot. */
function trioRanAt(now) {
  const date = new Date(now);
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function trioPlural(count, one, many) {
  return count + " " + (count === 1 ? one : many);
}

function trioPocketdex(card, d, now) {
  const today = d.day === trioDayKey(now);
  const partner = d.partner && d.partner.id ? d.partner : null;
  const habits = d.habits || {};
  const done = today ? trioCount(habits.done) : 0;
  const total = trioCount(habits.total);
  card.headline = partner ? partner.name + " Lv " + trioCount(partner.level) : d.trainer || "PocketDex";
  if (partner) {
    card.image = { url: "https://juw12.github.io/pocketdex/sprites/" + trioCount(partner.id) + ".png", key: "pd-" + trioCount(partner.id) };
  }
  card.pill = "Dex " + trioCount(d.caught) + "/" + trioCount(d.total);
  card.lines.push(card.pill);
  if (total) card.lines.push("Habits " + done + "/" + total + (trioCount(d.streak) ? " · " + trioCount(d.streak) + "d streak" : ""));
  const focus = d.focus;
  if (focus && focus.paused) {
    card.lines.push("Paused · " + trioClock(trioCount(focus.remainMs)) + " left");
  } else if (focus && Number.isFinite(focus.endsAt)) {
    if (focus.endsAt > now) {
      card.timer = { at: focus.endsAt, label: "vs " + (focus.name || "wild") };
      const minutes = trioCount(focus.minutes);
      card.battle = {
        foe: String(focus.name || "wild").slice(0, 20),
        partner: partner ? String(partner.name).slice(0, 20) : "",
        startAt: minutes ? focus.endsAt - minutes * 60000 : now,
        endsAt: focus.endsAt,
      };
      if (trioCount(focus.id)) {
        card.foeImage = { url: "https://juw12.github.io/pocketdex/sprites/" + trioCount(focus.id) + ".png", key: "pd-" + trioCount(focus.id) };
      }
    } else {
      card.lines.push("Battle over · open to finish");
    }
  } else {
    card.lines.push((today ? trioCount(d.focusMin) : 0) + " min focus today");
  }
}

function trioHaru(card, d, now) {
  const today = d.day === trioDayKey(now);
  const moments = today ? trioCount(d.moments) : 0;
  const temp = Number.isFinite(d.tempC) ? " " + Math.round(d.tempC) + "°" : "";
  card.headline = (trioWords(d.weather) || "Haru") + temp;
  if (/^[a-z_]+$/.test(String(d.scene || ""))) {
    card.image = { url: "https://juw12.github.io/projects/haru/app/scenes/" + d.scene + ".jpg", key: "haru-" + d.scene, wide: true };
  }
  const when = [trioWords(d.time), trioWords(d.season)].filter(Boolean).join(" · ");
  if (when) card.lines.push(when);
  card.lines.push(moments ? trioPlural(moments, "moment", "moments") + " today" : "No moments yet today");
  const km = Number(d.walkKm) > 0 ? " · " + Number(d.walkKm).toFixed(1) + " km" : "";
  card.lines.push(trioPlural(trioCount(d.days), "day", "days") + " kept" + km);
  if (trioCount(d.inbox)) card.lines.push(trioCount(d.inbox) + " to tidy");
  if (d.sample) card.lines.push("Sample days");
}

function trioCozy(card, d, now) {
  card.headline = d.name ? d.name + "'s island" : "Cozy Island";
  const art = d.rain ? "cozy-rain" : "cozy-day";
  card.image = { url: TRIO_COZY_ART + art + ".jpg", key: art, wide: true };
  card.lines.push(trioWords(d.season) + (d.rain ? " · rain" : ""));
  const beds = Array.isArray(d.garden) ? d.garden : [];
  const ready = beds.filter((bed) => Number.isFinite(bed.b) && bed.b <= now);
  const growing = beds.filter((bed) => Number.isFinite(bed.b) && bed.b > now).sort((x, y) => x.b - y.b);
  const thirsty = beds.filter((bed) => !Number.isFinite(bed.b) && Number.isFinite(bed.t) && bed.t <= now);
  const focus = d.focus;
  if (focus && !focus.paused && Number.isFinite(focus.endsAt) && focus.endsAt > now) {
    card.timer = { at: focus.endsAt, label: focus.phase === "break" ? "Break" : "Focus" };
  } else if (growing.length) {
    card.timer = { at: growing[0].b, label: trioWords(growing[0].s) + " blooms" };
  }
  if (ready.length) card.lines.push(ready.length + " ready to harvest");
  if (thirsty.length) card.lines.push(trioPlural(thirsty.length, "plant is", "plants are") + " thirsty");
  if (focus && focus.paused) card.lines.push("Focus paused · " + trioClock(trioCount(focus.remainMs)));
  card.lines.push(trioCount(d.fish) + " fish · " + trioCount(d.harvest) + " harvest");
  card.lines.push(trioCount(d.sessions) + " focus · " + trioCount(d.mindfulMin) + " min calm");
}

function trioCairn(card, d, now) {
  const today = d.day === trioDayKey(now);
  const live = trioCount(d.live);
  const sessions = Array.isArray(d.sessions) ? d.sessions.filter((item) => item && typeof item.t === "string") : [];
  const shipped = today ? trioCount(d.shipped) : 0;
  card.headline = live ? trioPlural(live, "live session", "live sessions") : "No live sessions";
  card.sessions = live ? sessions.slice(0, 4).map((item) => ({ t: item.t.slice(0, 60), step: TRIO_STEPS[item.k] || "" })) : [];
  card.pill = shipped ? shipped + " shipped" : "";
  if (live && sessions[0]) {
    card.lines.push(sessions[0].t);
    const step = TRIO_STEPS[sessions[0].k];
    if (step) card.lines.push("Last step: " + step);
  } else if (d.last && typeof d.last.t === "string" && today) {
    card.lines.push(trioWords(String(d.last.r || "done")) + ": " + d.last.t);
  }
  card.lines.push(shipped ? shipped + " shipped today" : "Nothing shipped yet today");
}

/** Share of the wild Pokémon's HP left: full when the focus battle starts, empty when it ends. */
function trioFoeHp(battle, now) {
  const length = battle.endsAt - battle.startAt;
  if (!(length > 0)) return 1;
  return Math.min(1, Math.max(0, (battle.endsAt - now) / length));
}

/** What one app's tile says right now. `entry` is { at, d } or undefined when nothing arrived yet. */
function trioCard(app, entry, now) {
  const info = TRIO_INFO[app];
  const card = {
    app,
    title: info.title,
    accent: info.accent,
    link: info.link,
    symbol: info.symbol,
    image: null,
    foeImage: null,
    battle: null,
    pill: "",
    sessions: [],
    headline: "Not linked yet",
    lines: [],
    timer: null,
    updatedAt: entry ? entry.at : 0,
    empty: !entry,
  };
  if (!entry) {
    card.lines.push("Pair, then open " + info.title);
    return card;
  }
  try {
    if (app === "pocketdex") trioPocketdex(card, entry.d, now);
    else if (app === "haru") trioHaru(card, entry.d, now);
    else if (app === "cozy") trioCozy(card, entry.d, now);
    else trioCairn(card, entry.d, now);
  } catch (error) {
    card.headline = info.title;
    card.lines = ["Could not read the last update"];
    card.timer = null;
    card.pill = "";
    card.sessions = [];
    card.battle = null;
    card.foeImage = null;
  }
  card.headline = String(card.headline).slice(0, 40);
  card.lines = card.lines.filter(Boolean).map((line) => String(line).slice(0, 60));
  return card;
}

/** The tile a one-app widget shows: the named app, else a running timer, else the freshest update. */
function trioPick(cards, param) {
  const wanted = TRIO_ALIASES[param] || param;
  const named = cards.find((card) => card.app === wanted);
  if (named) return named;
  const timed = cards.filter((card) => card.timer).sort((a, b) => a.timer.at - b.timer.at)[0];
  if (timed) return timed;
  return cards.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Which single app a medium or large widget shows, or "" for the all-apps view.
 * An app name (or alias) pins that app; "rotate" takes turns, one app per 5-minute slot. */
function trioFocusApp(param, now) {
  const word = String(param || "").trim().toLowerCase();
  if (!word || word === "all") return "";
  if (TRIO_ROTATE_WORDS.indexOf(word) >= 0) {
    return TRIO_APPS[Math.floor(now / TRIO_ROTATE_MS) % TRIO_APPS.length];
  }
  const wanted = TRIO_ALIASES[word] || word;
  return TRIO_APPS.indexOf(wanted) >= 0 ? wanted : "";
}

/** When iOS should run the script again: just after the next timer ends, every 2 minutes while
 * something changed in the last 15 minutes, else every 5 minutes. iOS treats this as a wish. */
function trioNextRefresh(cards, now, rotating) {
  const busy = cards.some((card) => card.updatedAt && now - card.updatedAt < 15 * 60 * 1000);
  let next = now + (busy ? 2 : 5) * 60 * 1000;
  cards.forEach((card) => {
    if (card.timer && card.timer.at > now) next = Math.min(next, card.timer.at + 3000);
    if (card.battle && card.battle.endsAt > now) next = Math.min(next, now + 2 * 60 * 1000);
  });
  if (rotating) next = Math.min(next, (Math.floor(now / TRIO_ROTATE_MS) + 1) * TRIO_ROTATE_MS + 1000);
  return Math.max(next, now + 60 * 1000);
}

// ---------------------------------------------------------------- drawing (Scriptable only)

function trioLabel(stack, value, size, color, bold) {
  const label = stack.addText(String(value));
  label.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  label.textColor = color;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.6;
  return label;
}

function trioTimerRow(stack, card, size, labelColor, clockColor, face) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  trioLabel(row, card.timer.label + " ", size, labelColor || new Color("#ffffff", 0.75), false);
  const clock = row.addDate(new Date(card.timer.at));
  clock.applyTimerStyle();
  clock.font = face === "rounded" && typeof Font.boldRoundedSystemFont === "function" ? Font.boldRoundedSystemFont(size) : Font.boldMonospacedSystemFont(size);
  clock.textColor = clockColor || new Color(card.accent);
  clock.lineLimit = 1;
  clock.minimumScaleFactor = 0.6;
}

function trioPicture(stack, card, images, height) {
  const picture = images[card.app];
  if (picture) {
    const view = stack.addImage(picture);
    const wide = card.image && card.image.wide;
    view.imageSize = new Size(wide ? Math.round(height * 1.5) : height, height);
    view.cornerRadius = wide ? 6 : 0;
    return;
  }
  const symbol = SFSymbol.named(card.symbol);
  symbol.applyFont(Font.systemFont(height));
  const view = stack.addImage(symbol.image);
  view.imageSize = new Size(Math.round(height * 0.8), Math.round(height * 0.8));
  view.tintColor = new Color(card.accent);
}

/** Fills the stack's width, so tiles side by side end up the same size. */
function trioStretch(stack) {
  const filler = stack.addStack();
  filler.layoutHorizontally();
  filler.addSpacer();
}

/** A compact tile for the medium widget's 2 x 2 grid: picture on the left, words on the right. */
function trioCell(parent, card, images) {
  const cell = parent.addStack();
  cell.layoutHorizontally();
  cell.centerAlignContent();
  cell.setPadding(5, 6, 5, 6);
  cell.backgroundColor = new Color("#ffffff", 0.07);
  cell.cornerRadius = 10;
  cell.url = card.link;
  trioPicture(cell, card, images, 26);
  cell.addSpacer(6);
  const words = cell.addStack();
  words.layoutVertically();
  trioLabel(words, card.title.toUpperCase(), 8, new Color(card.accent), true);
  trioLabel(words, card.headline, 11, Color.white(), true);
  if (card.timer) trioTimerRow(words, card, 9);
  else if (card.lines[0]) trioLabel(words, card.lines[0], 9, new Color("#ffffff", 0.75), false);
  cell.addSpacer();
  return cell;
}

function trioRow(parent, card, images) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.setPadding(6, 10, 6, 10);
  row.backgroundColor = new Color("#ffffff", 0.07);
  row.cornerRadius = 12;
  row.url = card.link;
  trioPicture(row, card, images, 44);
  row.addSpacer(10);
  const words = row.addStack();
  words.layoutVertically();
  trioLabel(words, card.title.toUpperCase(), 9, new Color(card.accent), true);
  trioLabel(words, card.headline, 14, Color.white(), true);
  const room = card.timer ? 1 : 2;
  card.lines.slice(0, room).forEach((line) => trioLabel(words, line, 11, new Color("#ffffff", 0.75), false));
  if (card.timer) trioTimerRow(words, card, 11);
  row.addSpacer();
  return row;
}

function trioFooter(widget, cards, note, liveUrl) {
  const newest = Math.max.apply(null, cards.map((card) => card.updatedAt));
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  if (liveUrl) row.url = liveUrl;
  const grey = new Color("#ffffff", 0.5);
  if (note) {
    trioLabel(row, note, 8, grey, false);
  } else if (newest > 0) {
    trioLabel(row, "updated ", 8, grey, false);
    const age = row.addDate(new Date(newest));
    age.applyRelativeStyle();
    age.font = Font.systemFont(8);
    age.textColor = grey;
    age.lineLimit = 1;
    trioLabel(row, " ago", 8, grey, false);
  } else {
    trioLabel(row, "set up at " + TRIO_SETUP, 8, grey, false);
  }
  row.addSpacer();
  trioLabel(row, "✓ " + trioRanAt(Date.now()) + (liveUrl ? "  " : ""), 8, grey, false);
  if (liveUrl) trioLabel(row, "LIVE ›", 8, new Color("#7cf29c"), true);
}

/** Four small dots, the shown app's dot lit, so a stack or a rotating widget shows where it is. */
function trioDots(parent, cards, shown, lit, unlit) {
  const dots = parent.addStack();
  dots.layoutHorizontally();
  dots.centerAlignContent();
  cards.forEach((card, index) => {
    if (index) dots.addSpacer(3);
    trioLabel(dots, "●", 7, card.app === shown.app ? lit : unlit, false);
  });
}

// ---------------------------------------------------------------- one app, drawn like the app itself

/** The app's own type: rounded for PocketDex and Cozy Island, serif for Cairn, plain for Haru. */
function trioFont(face, size, bold) {
  try {
    if (face === "rounded" && typeof Font.boldRoundedSystemFont === "function") {
      return bold ? Font.boldRoundedSystemFont(size) : Font.mediumRoundedSystemFont(size);
    }
    if (face === "serif" && bold) return new Font("Georgia-Bold", size);
  } catch (error) {
    /* older Scriptable: plain system type below */
  }
  return bold ? Font.boldSystemFont(size) : Font.systemFont(size);
}

function trioWrite(stack, value, size, color, face, bold, lines) {
  const label = stack.addText(String(value));
  label.font = trioFont(face, size, bold);
  label.textColor = color;
  label.lineLimit = lines || 1;
  label.minimumScaleFactor = 0.6;
  return label;
}

/** Colours for this app: its own palette, or white words when its picture fills the widget. */
function trioLook(theme, photo) {
  if (photo) {
    return { ink: Color.white(), muted: new Color("#ffffff", 0.88), accent: Color.white(), faint: new Color("#ffffff", 0.4), panel: new Color("#000000", 0.38) };
  }
  return { ink: new Color(theme.ink), muted: new Color(theme.muted), accent: new Color(theme.accent), faint: new Color(theme.ink, 0.18), panel: new Color(theme.soft, 0.85) };
}

/** "updated 2 min ago" (or the setup/offline note) in the app's quiet colour. */
function trioAppFooter(stack, card, note, look) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  if (note) {
    trioLabel(row, note, 9, look.muted, false);
  } else if (card.updatedAt > 0) {
    trioLabel(row, "updated ", 9, look.muted, false);
    const age = row.addDate(new Date(card.updatedAt));
    age.applyRelativeStyle();
    age.font = Font.systemFont(9);
    age.textColor = look.muted;
    age.lineLimit = 1;
    trioLabel(row, " ago", 9, look.muted, false);
  } else {
    trioLabel(row, "open " + card.title + " once to link it", 9, look.muted, false);
  }
  row.addSpacer();
  trioLabel(row, "✓ " + trioRanAt(Date.now()), 9, look.muted, false);
}

/** Title row: the app's name in its own colour and type, PocketDex's Dex count, and the dots. */
function trioAppHeader(widget, card, cards, theme, look, size) {
  const head = widget.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  trioWrite(head, card.title, size === "small" ? 13 : 15, look.accent, theme.face, true);
  head.addSpacer();
  const pillText = size === "small" && card.app === "pocketdex" ? "" : card.pill;
  if (pillText) {
    const pill = head.addStack();
    pill.setPadding(2, 7, 2, 7);
    pill.cornerRadius = 8;
    pill.backgroundColor = new Color(theme.soft);
    trioWrite(pill, pillText, size === "small" ? 9 : 10, new Color(theme.accent), theme.face, true);
  }
  if (size !== "small") {
    if (pillText) head.addSpacer(8);
    trioDots(head, cards, card, look.accent, look.faint);
  }
}

/** PocketDex's partner sprite on a soft round badge, as in the app's partner card. */
function trioSpriteBadge(parent, card, images, theme, side) {
  const badge = parent.addStack();
  badge.size = new Size(side, side);
  badge.cornerRadius = Math.round(side / 2);
  badge.backgroundColor = new Color(theme.soft);
  badge.centerAlignContent();
  const picture = images[card.app];
  if (picture) {
    const view = badge.addImage(picture);
    view.imageSize = new Size(Math.round(side * 0.86), Math.round(side * 0.86));
    return;
  }
  const symbol = SFSymbol.named(card.symbol);
  symbol.applyFont(Font.systemFont(side));
  const view = badge.addImage(symbol.image);
  view.imageSize = new Size(Math.round(side * 0.5), Math.round(side * 0.5));
  view.tintColor = new Color(theme.accent);
}

/** Headline, detail lines and the countdown, in the app's colours. */
function trioAppWords(parent, card, theme, look, sizes, room, skip) {
  trioWrite(parent, card.headline, sizes.headline, look.ink, theme.face, true);
  parent.addSpacer(sizes.gap);
  const lines = card.lines.filter((line) => line !== skip);
  lines.slice(0, room - (card.timer ? 1 : 0)).forEach((line) => trioWrite(parent, line, sizes.line, look.muted, theme.face, false));
  if (card.timer) trioTimerRow(parent, card, sizes.line + 1, look.muted, look.accent, theme.face);
}

function trioPocketdexView(widget, card, images, theme, look, size) {
  const sizes = size === "large" ? { headline: 24, line: 15, gap: 6 } : size === "medium" ? { headline: 19, line: 13, gap: 3 } : { headline: 14, line: 11, gap: 1 };
  if (size === "medium") {
    const body = widget.addStack();
    body.layoutHorizontally();
    body.centerAlignContent();
    trioSpriteBadge(body, card, images, theme, 84);
    body.addSpacer(14);
    const words = body.addStack();
    words.layoutVertically();
    trioAppWords(words, card, theme, look, sizes, 3, card.pill);
    body.addSpacer();
    return;
  }
  const center = widget.addStack();
  center.layoutHorizontally();
  center.addSpacer();
  trioSpriteBadge(center, card, images, theme, size === "large" ? 150 : 54);
  center.addSpacer();
  widget.addSpacer(size === "large" ? 14 : 4);
  trioAppWords(widget, card, theme, look, sizes, size === "large" ? 4 : 1, card.pill);
}

/** Haru and Cozy Island: the scene fills the widget like the app's own screen, words on a glass panel. */
function trioPhotoView(widget, card, theme, look, size) {
  const sizes = size === "large" ? { headline: 24, line: 14, gap: 4 } : size === "medium" ? { headline: 18, line: 12, gap: 2 } : { headline: 15, line: 11, gap: 1 };
  widget.addSpacer();
  const panel = widget.addStack();
  panel.layoutVertically();
  panel.setPadding(size === "small" ? 6 : 8, 10, size === "small" ? 6 : 8, 10);
  panel.cornerRadius = 14;
  panel.backgroundColor = look.panel;
  trioStretch(panel);
  trioAppWords(panel, card, theme, look, sizes, size === "large" ? 4 : size === "medium" ? 2 : 1, "");
}

/** Cairn: the live count in the site's serif, then each live session as a card, like the Vibe page. */
function trioCairnView(widget, card, theme, look, size) {
  trioWrite(widget, card.headline, size === "small" ? 17 : size === "medium" ? 19 : 22, look.ink, theme.face, true);
  widget.addSpacer(size === "large" ? 8 : 4);
  const room = size === "large" ? 4 : size === "medium" ? 2 : 1;
  const sessions = card.sessions.slice(0, room);
  sessions.forEach((session, index) => {
    if (index) widget.addSpacer(4);
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.setPadding(size === "large" ? 6 : 3, 8, size === "large" ? 6 : 3, 8);
    row.cornerRadius = 8;
    row.backgroundColor = new Color(theme.soft);
    trioLabel(row, "●", 7, look.accent, false);
    row.addSpacer(6);
    trioWrite(row, session.t, size === "small" ? 10 : 12, look.ink, "plain", true, size === "small" ? 2 : 1);
    row.addSpacer();
    if (session.step && size !== "small") trioWrite(row, session.step, 10, look.muted, "plain", false);
  });
  if (!sessions.length) {
    card.lines.slice(0, size === "small" ? 1 : 2).forEach((line) => trioWrite(widget, line, size === "small" ? 10 : 12, look.muted, "plain", false, 2));
  }
}

/** One app on its own, looking like that app; tapping it opens the app. */
function trioAppView(widget, card, cards, images, family, note) {
  const theme = TRIO_THEMES[card.app];
  const size = family === "small" ? "small" : family === "medium" ? "medium" : "large";
  const picture = images[card.app];
  const photo = Boolean(theme.photo && picture);
  const look = trioLook(theme, photo);
  widget.url = card.link;
  widget.backgroundColor = new Color(theme.bg);
  if (photo) widget.backgroundImage = picture;
  widget.setPadding(size === "small" ? 12 : 14, 14, size === "small" ? 10 : 12, 14);
  trioAppHeader(widget, card, cards, theme, look, size);
  widget.addSpacer(size === "large" ? 14 : 6);
  if (card.app === "pocketdex") trioPocketdexView(widget, card, images, theme, look, size);
  else if (photo) trioPhotoView(widget, card, theme, look, size);
  else if (card.app === "cairn") trioCairnView(widget, card, theme, look, size);
  else trioAppWords(widget, card, theme, look, size === "large" ? { headline: 24, line: 14, gap: 4 } : { headline: 17, line: 12, gap: 2 }, size === "small" ? 2 : 3, "");
  // The photo panel already sits at the bottom; everything else is pushed up by this spacer.
  if (photo) widget.addSpacer(5);
  else widget.addSpacer();
  if (size !== "small" || !photo || note) trioAppFooter(widget, card, note, look);
}

/** The live view: the same tiles in a page that updates the moment an app sends. */
function trioLiveUrl(code) {
  return /^jw-[0-9a-f]{32}$/.test(code) ? TRIO_LIVE + "#" + code : "";
}

/** A lock-screen sprite, or nothing if the picture has not downloaded yet. */
function trioLockSprite(stack, picture, side) {
  if (!picture) return false;
  const view = stack.addImage(picture);
  view.imageSize = new Size(side, side);
  return true;
}

/** Partner bottom-left, wild Pokémon top-right, like the app's battle screen, in one picture.
 * The sprites are drawn a little larger than their slots, which trims their empty margins. */
function trioBattleArt(partner, foe, width, height) {
  if (!partner || !foe || typeof DrawContext === "undefined") return null;
  try {
    const art = new DrawContext();
    art.size = new Size(width, height);
    art.opaque = false;
    art.respectScreenScale = true;
    const slot = Math.min(width / 2, height);
    const side = Math.round(slot * 1.35);
    const inset = Math.round((side - slot) / 2);
    art.drawImageInRect(partner, new Rect(-inset, height - slot - inset + 2, side, side));
    art.drawImageInRect(foe, new Rect(width - slot - inset, -inset - 2, side, side));
    return art.getImage();
  } catch (error) {
    return null;
  }
}

/** The battle picture, or the two sprites side by side if it cannot be drawn. */
function trioBattlePicture(stack, images, width, height) {
  const art = trioBattleArt(images.pocketdex, images["pocketdex:foe"], width, height);
  if (art) {
    const view = stack.addImage(art);
    view.imageSize = new Size(width, height);
    return;
  }
  trioLockSprite(stack, images.pocketdex, Math.round(height * 0.8));
  trioLockSprite(stack, images["pocketdex:foe"], Math.round(height * 0.8));
}

/** The wild Pokémon's HP bar: shrinks as the focus battle runs down. */
function trioHpBar(stack, share, width) {
  const bar = stack.addStack();
  bar.layoutHorizontally();
  bar.size = new Size(width, 4);
  bar.cornerRadius = 2;
  bar.backgroundColor = new Color("#ffffff", 0.25);
  const fill = Math.round(width * share);
  if (fill > 0) {
    const left = bar.addStack();
    left.size = new Size(fill, 4);
    left.cornerRadius = 2;
    left.backgroundColor = Color.white();
  }
  bar.addSpacer();
}

/** PocketDex on the lock screen during a focus battle: partner vs the wild Pokémon, a live
 * countdown that ticks every second, and the wild Pokémon's HP bar draining. */
function trioLockBattle(widget, card, family, images, now) {
  const battle = card.battle;
  const share = trioFoeHp(battle, now);
  if (family === "accessoryInline") {
    const ends = new Date(battle.endsAt);
    const clock = String(ends.getHours()).padStart(2, "0") + ":" + String(ends.getMinutes()).padStart(2, "0");
    widget.addText((battle.partner ? battle.partner + " vs " : "vs ") + battle.foe + " · until " + clock);
    return;
  }
  if (family === "accessoryCircular") {
    const sprites = widget.addStack();
    sprites.layoutHorizontally();
    sprites.addSpacer();
    trioBattlePicture(sprites, images, 52, 30);
    sprites.addSpacer();
    const clock = widget.addDate(new Date(battle.endsAt));
    clock.applyTimerStyle();
    clock.font = Font.boldMonospacedSystemFont(11);
    clock.centerAlignText && clock.centerAlignText();
    clock.lineLimit = 1;
    clock.minimumScaleFactor = 0.6;
    return;
  }
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  trioBattlePicture(row, images, 72, 46);
  row.addSpacer(6);
  const words = row.addStack();
  words.layoutVertically();
  const title = words.addText("vs " + battle.foe);
  title.font = Font.boldSystemFont(12);
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.6;
  const clock = words.addDate(new Date(battle.endsAt));
  clock.applyTimerStyle();
  clock.font = Font.boldMonospacedSystemFont(17);
  clock.lineLimit = 1;
  clock.minimumScaleFactor = 0.6;
  words.addSpacer(2);
  trioHpBar(words, share, 64);
  row.addSpacer();
}

function trioLockScreen(widget, card, family, images, now) {
  if (card.app === "pocketdex" && card.battle && card.battle.endsAt > now) {
    trioLockBattle(widget, card, family, images || {}, now);
    return;
  }
  if (family === "accessoryInline") {
    const words = card.timer ? card.title + " · " + card.timer.label : card.title + " · " + card.headline;
    widget.addText(words);
    return;
  }
  const title = widget.addText(card.title);
  title.font = Font.boldSystemFont(family === "accessoryCircular" ? 9 : 12);
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.6;
  if (family === "accessoryCircular") {
    return;
  }
  const headline = widget.addText(card.headline);
  headline.font = Font.systemFont(12);
  headline.lineLimit = 1;
  headline.minimumScaleFactor = 0.6;
  if (card.timer) {
    const row = widget.addStack();
    const label = row.addText(card.timer.label + " ");
    label.font = Font.systemFont(12);
    label.lineLimit = 1;
    const clock = row.addDate(new Date(card.timer.at));
    clock.applyTimerStyle();
    clock.font = Font.boldMonospacedSystemFont(12);
  } else if (card.lines[0]) {
    const line = widget.addText(card.lines[0]);
    line.font = Font.systemFont(12);
    line.lineLimit = 1;
    line.minimumScaleFactor = 0.6;
  }
}

function trioBuild(cards, family, param, images, note, liveUrl, focus) {
  const widget = new ListWidget();
  if (String(family).indexOf("accessory") === 0) {
    const card = trioPick(cards, focus || param);
    widget.url = card.link;
    trioLockScreen(widget, card, family, images, Date.now());
    return widget;
  }
  if (family === "small" || focus) {
    // One app on its own looks like that app and opens it.
    const card = family === "small" ? trioPick(cards, focus || param) : cards.find((item) => item.app === focus);
    trioAppView(widget, card, cards, images, family, note);
    return widget;
  }
  const backdrop = new LinearGradient();
  backdrop.colors = [new Color("#141a26"), new Color("#232c3f")];
  backdrop.locations = [0, 1];
  widget.backgroundGradient = backdrop;
  widget.setPadding(10, 10, 8, 10);
  if (family === "large" || family === "extraLarge") {
    cards.forEach((card, index) => {
      if (index) widget.addSpacer(6);
      trioRow(widget, card, images);
    });
    widget.addSpacer();
  } else {
    for (let start = 0; start < cards.length; start += 2) {
      if (start) widget.addSpacer(5);
      const line = widget.addStack();
      line.layoutHorizontally();
      cards.slice(start, start + 2).forEach((card, index) => {
        if (index) line.addSpacer(5);
        trioCell(line, card, images);
      });
    }
    widget.addSpacer();
  }
  if (liveUrl) widget.url = liveUrl;
  widget.addSpacer(4);
  trioFooter(widget, cards, note, liveUrl);
  return widget;
}

function trioReadJson(files, path) {
  try {
    return files.fileExists(path) ? JSON.parse(files.readString(path)) : null;
  } catch (error) {
    return null;
  }
}

async function trioImages(cards, files, folder) {
  const images = {};
  const wanted = [];
  cards.forEach((card) => {
    if (card.image) wanted.push([card.app, card.image]);
    if (card.foeImage) wanted.push([card.app + ":foe", card.foeImage]);
  });
  for (const [name, image] of wanted) {
    const path = files.joinPath(folder, image.key + ".img");
    try {
      if (files.fileExists(path)) {
        images[name] = files.readImage(path);
      } else {
        const request = new Request(image.url);
        request.timeoutInterval = 8;
        const picture = await request.loadImage();
        files.writeImage(path, picture);
        images[name] = picture;
      }
    } catch (error) {
      /* the tile falls back to its symbol */
    }
  }
  return images;
}

async function main(ctx) {
  const options = ctx || {};
  const code = String(options.code || "").trim().toLowerCase();
  const param = String(options.param || "").trim().toLowerCase();
  const family = options.family || config.widgetFamily || "medium";
  const files = FileManager.local();
  const folder = files.joinPath(files.documentsDirectory(), "juw12-trio");
  if (!files.fileExists(folder)) files.createDirectory(folder, true);
  const statePath = files.joinPath(folder, "state-" + code.slice(-8) + ".json");

  let note = "";
  let fresh = null;
  if (!/^jw-[0-9a-f]{32}$/.test(code)) {
    note = "add your code: " + TRIO_SETUP;
  } else {
    try {
      const request = new Request(TRIO_RELAY + "/" + code + "/json?poll=1&since=12h");
      request.timeoutInterval = 10;
      fresh = trioParseFeed(await request.loadString());
    } catch (error) {
      note = "offline · showing the last update";
    }
  }
  const state = trioMerge(trioReadJson(files, statePath), fresh);
  if (fresh) {
    try {
      files.writeString(statePath, JSON.stringify(state));
    } catch (error) {
      /* the next run asks the relay again */
    }
  }

  const now = Date.now();
  const cards = TRIO_APPS.map((app) => trioCard(app, state[app], now));
  const liveUrl = trioLiveUrl(code);
  let widget;
  try {
    const images = await trioImages(cards, files, folder);
    const focus = trioFocusApp(param, now);
    const rotating = TRIO_ROTATE_WORDS.indexOf(param) >= 0;
    widget = trioBuild(cards, family, param, images, note, liveUrl, focus);
    widget.refreshAfterDate = new Date(trioNextRefresh(cards, now, rotating));
  } catch (error) {
    // A drawing problem must not freeze the widget on an old picture: say what broke and try again soon.
    widget = new ListWidget();
    const title = widget.addText("Trio " + TRIO_VERSION + " could not draw");
    title.font = Font.boldSystemFont(12);
    const detail = widget.addText(String((error && error.message) || error).slice(0, 120));
    detail.font = Font.systemFont(10);
    detail.lineLimit = 3;
    widget.addText("✓ " + trioRanAt(now)).font = Font.systemFont(9);
    widget.refreshAfterDate = new Date(now + 5 * 60 * 1000);
  }

  if (config.runsInWidget || config.runsInAccessoryWidget) {
    Script.setWidget(widget);
  } else if (!options.quiet && liveUrl && typeof WebView !== "undefined") {
    // Run inside Scriptable (or tapped from the widget): the live view, updated the moment an app sends.
    const view = new WebView();
    await view.loadURL(liveUrl);
    await view.present(true);
  } else if (!options.quiet) {
    await widget.presentMedium();
  }
  Script.complete();
  return widget;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TRIO_VERSION, TRIO_APPS, TRIO_INFO, trioParseFeed, trioMerge, trioCard, trioPick, trioFoeHp, trioRanAt, trioFocusApp, trioNextRefresh, trioLiveUrl, trioBuild, main };
}
