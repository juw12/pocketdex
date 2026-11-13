/* juw12 trio widget: PocketDex, Haru, Cozy Island and Cairn on one iPhone home-screen widget.
 *
 * Runs inside Scriptable (iOS). The small loader script (loader.js, copied from the setup page)
 * downloads this file and calls main({ code, param }), so fixes arrive without pasting again.
 * The top half is plain JavaScript and is also used by the setup page preview.
 */
const TRIO_VERSION = "1.1.0";
const TRIO_RELAY = "https://ntfy.sh";
const TRIO_SETUP = "juw12.github.io/widget";
const TRIO_LIVE = "https://juw12.github.io/pocketdex/widget/live.html";
const TRIO_APPS = ["pocketdex", "haru", "cozy", "cairn"];
const TRIO_INFO = {
  pocketdex: { title: "PocketDex", accent: "#ffcb05", link: "https://juw12.github.io/pocketdex/", symbol: "sparkles" },
  haru: { title: "Haru", accent: "#ff9db0", link: "https://juw12.github.io/projects/haru/app/", symbol: "sun.max.fill" },
  cozy: { title: "Cozy Island", accent: "#8fd694", link: "https://juw12.github.io/portfolio/cozy-island/", symbol: "leaf.fill" },
  cairn: { title: "Cairn", accent: "#9db4ff", link: "https://juw12.github.io/cairn/", symbol: "mountain.2.fill" },
};
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
  card.lines.push("Dex " + trioCount(d.caught) + "/" + trioCount(d.total));
  if (total) card.lines.push("Habits " + done + "/" + total + (trioCount(d.streak) ? " · " + trioCount(d.streak) + "d streak" : ""));
  const focus = d.focus;
  if (focus && focus.paused) {
    card.lines.push("Paused · " + trioClock(trioCount(focus.remainMs)) + " left");
  } else if (focus && Number.isFinite(focus.endsAt)) {
    if (focus.endsAt > now) card.timer = { at: focus.endsAt, label: "vs " + (focus.name || "wild") };
    else card.lines.push("Battle over · open to finish");
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
  if (live && sessions[0]) {
    card.lines.push(sessions[0].t);
    const step = TRIO_STEPS[sessions[0].k];
    if (step) card.lines.push("Last step: " + step);
  } else if (d.last && typeof d.last.t === "string" && today) {
    card.lines.push(trioWords(String(d.last.r || "done")) + ": " + d.last.t);
  }
  card.lines.push(shipped ? shipped + " shipped today" : "Nothing shipped yet today");
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

/** When iOS should run the script again: just after the next timer ends, every 2 minutes while
 * something changed in the last 15 minutes, else every 5 minutes. iOS treats this as a wish. */
function trioNextRefresh(cards, now) {
  const busy = cards.some((card) => card.updatedAt && now - card.updatedAt < 15 * 60 * 1000);
  let next = now + (busy ? 2 : 5) * 60 * 1000;
  cards.forEach((card) => {
    if (card.timer && card.timer.at > now) next = Math.min(next, card.timer.at + 3000);
  });
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

function trioTimerRow(stack, card, size) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  trioLabel(row, card.timer.label + " ", size, new Color("#ffffff", 0.75), false);
  const clock = row.addDate(new Date(card.timer.at));
  clock.applyTimerStyle();
  clock.font = Font.boldMonospacedSystemFont(size);
  clock.textColor = new Color(card.accent);
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

function trioTile(parent, card, images, scale) {
  const tile = parent.addStack();
  tile.layoutVertically();
  tile.setPadding(8, 8, 8, 8);
  tile.backgroundColor = new Color("#ffffff", 0.07);
  tile.cornerRadius = 12;
  tile.url = card.link;
  trioStretch(tile);
  trioLabel(tile, card.title.toUpperCase(), Math.round(9 * scale), new Color(card.accent), true);
  tile.addSpacer(4);
  trioPicture(tile, card, images, Math.round(36 * scale));
  tile.addSpacer(4);
  trioLabel(tile, card.headline, Math.round(12 * scale), Color.white(), true);
  const room = card.timer ? 1 : 2;
  card.lines.slice(0, room).forEach((line) => trioLabel(tile, line, Math.round(10 * scale), new Color("#ffffff", 0.75), false));
  if (card.timer) trioTimerRow(tile, card, Math.round(10 * scale));
  tile.addSpacer();
  return tile;
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
  if (liveUrl) trioLabel(row, "LIVE ›", 8, new Color("#7cf29c"), true);
}

/** The live view: the same tiles in a page that updates the moment an app sends. */
function trioLiveUrl(code) {
  return /^jw-[0-9a-f]{32}$/.test(code) ? TRIO_LIVE + "#" + code : "";
}

function trioLockScreen(widget, card, family) {
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

function trioBuild(cards, family, param, images, note, liveUrl) {
  const widget = new ListWidget();
  if (String(family).indexOf("accessory") === 0) {
    const card = trioPick(cards, param);
    widget.url = card.link;
    trioLockScreen(widget, card, family);
    return widget;
  }
  const backdrop = new LinearGradient();
  backdrop.colors = [new Color("#141a26"), new Color("#232c3f")];
  backdrop.locations = [0, 1];
  widget.backgroundGradient = backdrop;
  widget.setPadding(10, 10, 8, 10);
  if (family === "small") {
    const card = trioPick(cards, param);
    widget.url = card.link;
    const tile = trioTile(widget, card, images, 1.15);
    tile.backgroundColor = new Color("#ffffff", 0);
    tile.setPadding(0, 2, 0, 2);
  } else if (family === "large" || family === "extraLarge") {
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
  if (liveUrl && family !== "small") widget.url = liveUrl;
  widget.addSpacer(4);
  trioFooter(widget, cards, note, family === "small" ? "" : liveUrl);
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
  for (const card of cards) {
    if (!card.image) continue;
    const path = files.joinPath(folder, card.image.key + ".img");
    try {
      if (files.fileExists(path)) {
        images[card.app] = files.readImage(path);
      } else {
        const request = new Request(card.image.url);
        request.timeoutInterval = 8;
        const picture = await request.loadImage();
        files.writeImage(path, picture);
        images[card.app] = picture;
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
  const images = await trioImages(cards, files, folder);
  const liveUrl = trioLiveUrl(code);
  const widget = trioBuild(cards, family, param, images, note, liveUrl);
  widget.refreshAfterDate = new Date(trioNextRefresh(cards, now));

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
  module.exports = { TRIO_VERSION, TRIO_APPS, TRIO_INFO, trioParseFeed, trioMerge, trioCard, trioPick, trioNextRefresh, trioLiveUrl, trioBuild, main };
}
