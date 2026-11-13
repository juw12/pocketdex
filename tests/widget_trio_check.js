/* Checks the iPhone trio widget without an iPhone: runs widget/loader.js and widget/trio.js against
 * stand-ins for the Scriptable APIs and inspects the widget tree they build.
 * Run: node tests/widget_trio_check.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WIDGET_DIR = path.join(__dirname, "..", "widget");
const TRIO_SOURCE = fs.readFileSync(path.join(WIDGET_DIR, "trio.js"), "utf8");
const LOADER_SOURCE = fs.readFileSync(path.join(WIDGET_DIR, "loader.js"), "utf8");
const CODE = "jw-0123456789abcdef0123456789abcdef";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class Stack {
  constructor(kind) {
    this.kind = kind || "stack";
    this.children = [];
  }
  add(node) {
    this.children.push(node);
    return node;
  }
  addStack() {
    return this.add(new Stack());
  }
  addText(text) {
    assert.strictEqual(typeof text, "string", "addText needs a string");
    return this.add({ kind: "text", text });
  }
  addDate(date) {
    assert.ok(date instanceof Date && !Number.isNaN(date.getTime()), "addDate needs a real date");
    const node = { kind: "date", date, style: "plain" };
    node.applyTimerStyle = () => (node.style = "timer");
    node.applyRelativeStyle = () => (node.style = "relative");
    return this.add(node);
  }
  addImage(image) {
    assert.ok(image, "addImage needs an image");
    return this.add({ kind: "image", image });
  }
  addSpacer(length) {
    return this.add({ kind: "spacer", length });
  }
  layoutVertically() {}
  layoutHorizontally() {}
  centerAlignContent() {}
  setPadding() {}
}

function makeWorld(options) {
  const disk = new Map(Object.entries(options.disk || {}));
  const world = { disk, requests: [], shown: null, completed: false };
  class ListWidget extends Stack {
    constructor() {
      super("widget");
    }
    async presentMedium() {
      world.presented = this;
    }
  }
  class Request {
    constructor(url) {
      this.url = url;
    }
    async loadString() {
      world.requests.push(this.url);
      if (options.offline) throw new Error("offline");
      if (this.url.includes("/widget/trio.js")) return options.trioSource === undefined ? TRIO_SOURCE : options.trioSource;
      if (this.url.includes("/json?poll=1")) return options.feed || "";
      throw new Error("unexpected url " + this.url);
    }
    async loadImage() {
      world.requests.push(this.url);
      if (options.offline) throw new Error("offline");
      return { picture: this.url };
    }
  }
  const files = {
    documentsDirectory: () => "/docs",
    joinPath: (a, b) => a + "/" + b,
    fileExists: (file) => disk.has(file),
    createDirectory: (file) => disk.set(file, "<dir>"),
    readString: (file) => disk.get(file),
    writeString: (file, text) => disk.set(file, text),
    readImage: (file) => disk.get(file),
    writeImage: (file, image) => disk.set(file, image),
  };
  const font = (name) => (size) => ({ name, size });
  world.globals = {
    ListWidget,
    Request,
    FileManager: { local: () => files },
    Font: class Font {
      constructor(name, size) {
        assert.ok(typeof name === "string" && size > 0, "named font needs a name and a size");
        this.name = name;
        this.size = size;
      }
      static systemFont(size) {
        return font("regular")(size);
      }
      static boldSystemFont(size) {
        return font("bold")(size);
      }
      static boldMonospacedSystemFont(size) {
        return font("mono")(size);
      }
      static boldRoundedSystemFont(size) {
        return font("bold-rounded")(size);
      }
      static mediumRoundedSystemFont(size) {
        return font("medium-rounded")(size);
      }
    },
    Color: class Color {
      constructor(hex, alpha) {
        assert.ok(/^#[0-9a-f]{6}$/i.test(hex), "bad colour " + hex);
        this.hex = hex;
        this.alpha = alpha === undefined ? 1 : alpha;
      }
      static white() {
        return new Color("#ffffff");
      }
    },
    Size: class Size {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
    },
    LinearGradient: class LinearGradient {},
    Rect: class Rect {
      constructor(x, y, width, height) {
        Object.assign(this, { x, y, width, height });
      }
    },
    DrawContext: options.noDraw
      ? undefined
      : class DrawContext {
          constructor() {
            this.drawn = [];
          }
          drawImageInRect(picture, rect) {
            assert.ok(picture && rect instanceof world.globals.Rect, "drawImageInRect needs an image and a Rect");
            this.drawn.push(picture.picture);
          }
          getImage() {
            return { composite: this.drawn.slice(), size: this.size };
          }
        },
    SFSymbol: { named: (name) => ({ applyFont() {}, image: { symbol: name } }) },
    config: { widgetFamily: options.family || "medium", runsInWidget: options.inApp ? false : true },
    WebView: options.webView
      ? class WebView {
          async loadURL(url) {
            world.webViewUrl = url;
          }
          async present(fullScreen) {
            world.webViewPresented = fullScreen;
          }
        }
      : undefined,
    args: { widgetParameter: options.param || null },
    Script: {
      setWidget: (widget) => (world.shown = widget),
      complete: () => (world.completed = true),
    },
  };
  return world;
}

/** Runs the loader exactly as pasted into Scriptable, with the code filled in. */
async function runLoader(options) {
  const world = makeWorld(options);
  const names = Object.keys(world.globals);
  const source = LOADER_SOURCE.replace("__CODE__", options.code === undefined ? CODE : options.code);
  // Node has its own Request, so every stand-in replaces the global and is put back afterwards.
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { value: world.globals[name], configurable: true, writable: true }));
  try {
    await new AsyncFunction(source)();
  } finally {
    names.forEach((name, index) => {
      delete globalThis[name];
      if (before[index]) Object.defineProperty(globalThis, name, before[index]);
    });
  }
  return world;
}

function walk(node, visit) {
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

function texts(widget) {
  const found = [];
  walk(widget, (node) => node.kind === "text" && found.push(node.text));
  return found;
}

function dates(widget, style) {
  const found = [];
  walk(widget, (node) => node.kind === "date" && node.style === style && found.push(node.date.getTime()));
  return found;
}

function links(widget) {
  const found = [];
  walk(widget, (node) => node.url && found.push(node.url));
  return found;
}

function dayKey(time) {
  const date = new Date(time);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function feedLine(app, at, d) {
  return JSON.stringify({ id: "x" + at, time: Math.floor(at / 1000), event: "message", topic: CODE, message: JSON.stringify({ v: 1, app, at, d }) });
}

const now = Date.now();
const today = dayKey(now);
const battleEnds = now + 12 * 60 * 1000;
const bloomAt = now + 90 * 1000;
const pocketdex = {
  day: today,
  trainer: "Juwen",
  partner: { id: 25, name: "Pikachu", level: 12, mood: "battle" },
  caught: 37,
  total: 1025,
  habits: { done: 2, total: 3 },
  streak: 5,
  focusMin: 50,
  focus: { id: 133, name: "Eevee", minutes: 25, endsAt: battleEnds, paused: false },
};
const haru = { day: today, scene: "clear__dusk__autumn", weather: "clear", tempC: 18.4, time: "dusk", season: "autumn", moments: 2, days: 14, walkKm: 6.25, inbox: 3, sample: false };
const cozy = {
  name: "Juwen",
  season: "autumn",
  rain: true,
  fish: 9,
  harvest: 4,
  sessions: 6,
  mindfulMin: 22,
  garden: [{ s: "tulip", b: bloomAt }, { s: "daisy", b: now - 60000 }, { s: "tomato", t: now - 1000 }],
  focus: null,
};
const cairn = {
  day: today,
  live: 2,
  sessions: [
    { t: "Add dark mode to the settings page", k: "pass", at: now - 60000, since: now - 3600000 },
    { t: "Fix the GPX import", k: "note", at: now - 120000, since: now - 7200000 },
  ],
  shipped: 3,
  ended: 4,
  last: { t: "Widget for Cairn", r: "shipped", at: now - 600000 },
};
const LIVE = "https://juw12.github.io/pocketdex/widget/live.html#" + CODE;
const fullFeed = [
  '{"id":"open","time":1,"event":"open","topic":"t"}',
  "not json at all",
  feedLine("pocketdex", now - 9 * 60000, Object.assign({}, pocketdex, { caught: 1 })),
  feedLine("pocketdex", now - 60000, pocketdex),
  feedLine("haru", now - 120000, haru),
  feedLine("cozy", now - 30000, cozy),
  feedLine("cairn", now - 45000, cairn),
  feedLine("someoneelse", now, { hello: 1 }),
].join("\n");

(async () => {
  // 1. medium: all four apps in a 2 x 2 grid, live timers, tap targets, refresh time
  let world = await runLoader({ feed: fullFeed, family: "medium" });
  let seen = texts(world.shown);
  assert.ok(world.completed && world.shown, "medium widget was not set");
  ["POCKETDEX", "HARU", "COZY ISLAND", "CAIRN", "Pikachu Lv 12", "Clear 18°", "Juwen's island", "2 live sessions", "vs Eevee ", "Tulip blooms ", "LIVE ›"].forEach((needle) => {
    assert.ok(seen.includes(needle), "medium is missing: " + needle + " in " + JSON.stringify(seen));
  });
  assert.deepStrictEqual(dates(world.shown, "timer").sort(), [battleEnds, bloomAt].sort(), "timers should count down to the battle end and the bloom");
  assert.deepStrictEqual(dates(world.shown, "relative"), [now - 30000], "footer shows the newest update");
  const tapped = links(world.shown);
  ["https://juw12.github.io/pocketdex/", "https://juw12.github.io/projects/haru/app/", "https://juw12.github.io/portfolio/cozy-island/", "https://juw12.github.io/cairn/"].forEach((url) => {
    assert.ok(tapped.includes(url), "a tile should open " + url);
  });
  assert.strictEqual(world.shown.url, LIVE, "tapping the widget opens the live view");
  assert.ok(tapped.filter((url) => url === LIVE).length === 2, "widget and footer open the live view");
  const refresh = world.shown.refreshAfterDate.getTime();
  assert.ok(refresh >= bloomAt && refresh <= bloomAt + 5000, "refresh should follow the next timer end");
  assert.ok(world.disk.get("/docs/juw12-trio-widget.js") === TRIO_SOURCE, "loader keeps an offline copy of the widget code");
  assert.ok(world.requests.some((url) => url.includes("/" + CODE + "/json?poll=1&since=12h")), "polls the paired topic");

  // 2. small: one named app only
  world = await runLoader({ feed: fullFeed, family: "small", param: "Haru" });
  seen = texts(world.shown);
  assert.ok(seen.includes("Haru") && seen.includes("Clear 18°"), "small haru: " + JSON.stringify(seen));
  assert.ok(!seen.includes("PocketDex") && !seen.includes("Cozy Island"), "small shows one app");
  assert.strictEqual(world.shown.url, "https://juw12.github.io/projects/haru/app/");

  // 3. small without a parameter follows the timer that ends first
  world = await runLoader({ feed: fullFeed, family: "small" });
  assert.ok(texts(world.shown).includes("Cozy Island"), "small default should follow the soonest timer");

  // 4. large: four rows with more detail
  world = await runLoader({ feed: fullFeed, family: "large" });
  seen = texts(world.shown);
  ["Dex 37/1025", "Dusk · Autumn", "2 moments today", "Autumn · rain", "CAIRN", "Add dark mode to the settings page", "Last step: tests passed"].forEach((needle) => {
    assert.ok(seen.includes(needle), "large is missing: " + needle + " in " + JSON.stringify(seen));
  });

  // 5. lock screen
  world = await runLoader({ feed: fullFeed, family: "accessoryRectangular", param: "pocketdex" });
  assert.deepStrictEqual(texts(world.shown), ["vs Eevee"], "a running battle takes over the PocketDex lock screen");
  world = await runLoader({ feed: fullFeed, family: "accessoryInline", param: "haru" });
  assert.deepStrictEqual(texts(world.shown), ["Haru · Clear 18°"]);

  // 6. nothing published yet
  world = await runLoader({ feed: "", family: "medium" });
  seen = texts(world.shown);
  assert.strictEqual(seen.filter((item) => item === "Not linked yet").length, 4, "empty feed: " + JSON.stringify(seen));
  assert.ok(seen.some((item) => item.includes("juw12.github.io/widget")), "empty widget points at the setup page");

  // 7. offline: the saved code and the saved snapshots are used
  const savedDisk = Object.fromEntries((await runLoader({ feed: fullFeed, family: "medium" })).disk);
  world = await runLoader({ offline: true, disk: savedDisk, family: "medium" });
  seen = texts(world.shown);
  assert.ok(seen.includes("Pikachu Lv 12") && seen.includes("offline · showing the last update"), "offline: " + JSON.stringify(seen));

  // 8. offline on the very first run: a plain message instead of a crash
  world = await runLoader({ offline: true, family: "medium" });
  assert.deepStrictEqual(texts(world.shown), ["Trio widget needs the internet once."]);

  // 9. a broken download (for example a 404 page) never replaces the saved copy
  world = await runLoader({ trioSource: "<html>404</html>", disk: savedDisk, feed: fullFeed, family: "medium" });
  assert.ok(texts(world.shown).includes("Pikachu Lv 12"), "should fall back to the saved widget code");
  assert.strictEqual(world.disk.get("/docs/juw12-trio-widget.js"), TRIO_SOURCE);

  // 10. no code pasted
  world = await runLoader({ code: "", feed: fullFeed, family: "medium" });
  seen = texts(world.shown);
  assert.ok(seen.includes("add your code: juw12.github.io/widget"), "missing code: " + JSON.stringify(seen));
  assert.ok(!world.shown.url, "no live view without a code");
  assert.ok(!world.requests.some((url) => url.includes("ntfy.sh")), "must not poll without a code");

  // 11. yesterday's numbers do not pose as today's; ended and paused timers read correctly
  const yesterday = dayKey(now - 26 * 3600 * 1000);
  const staleFeed = [
    feedLine("pocketdex", now - 26 * 3600000, Object.assign({}, pocketdex, { day: yesterday, focus: { id: 1, name: "Bulbasaur", minutes: 25, endsAt: now - 5000, paused: false } })),
    feedLine("haru", now - 26 * 3600000, Object.assign({}, haru, { day: yesterday })),
    feedLine("cozy", now - 1000, Object.assign({}, cozy, { garden: [], focus: { phase: "focus", paused: true, remainMs: 754000 } })),
  ].join("\n");
  world = await runLoader({ feed: staleFeed, family: "large" });
  seen = texts(world.shown);
  ["Habits 0/3 · 5d streak", "No moments yet today", "Focus paused · 12:34"].forEach((needle) => {
    assert.ok(seen.includes(needle), "stale is missing: " + needle + " in " + JSON.stringify(seen));
  });
  const staleSmall = await runLoader({ feed: staleFeed, family: "small", param: "pocketdex" });
  assert.ok(texts(staleSmall.shown).includes("Habits 0/3 · 5d streak"), "small pocketdex keeps the habit line");
  const staleCard = await runLoader({ feed: staleFeed, family: "accessoryRectangular", param: "pocketdex" });
  assert.ok(texts(staleCard.shown).includes("Dex 37/1025"), "lock screen shows the first line");
  assert.deepStrictEqual(dates(world.shown, "timer"), [], "no countdown once every timer has ended or is paused");

  // 12. odd data from the relay cannot crash the widget
  const oddFeed = [
    feedLine("pocketdex", now, { partner: { id: "25/../x", name: {}, level: "many" }, habits: "none", focus: { endsAt: "soon" } }),
    feedLine("haru", now, { scene: "../../secret", weather: 7, tempC: "hot" }),
    feedLine("cozy", now, { garden: "weeds", focus: 4 }),
    feedLine("cairn", now, { live: "lots", sessions: [{ t: 5 }, null, "x"], last: { t: {} } }),
  ].join("\n");
  world = await runLoader({ feed: oddFeed, family: "medium" });
  assert.ok(world.shown && texts(world.shown).includes("HARU"), "odd data should still draw");
  assert.ok(!world.requests.some((url) => url.includes("..")), "never requests an image path taken from odd data");

  // 13. small Cairn tile, and yesterday's Cairn numbers do not pose as today's
  world = await runLoader({ feed: fullFeed, family: "small", param: "cairn" });
  seen = texts(world.shown);
  assert.ok(seen.includes("Cairn") && seen.includes("2 live sessions"), "small cairn: " + JSON.stringify(seen));
  assert.strictEqual(world.shown.url, "https://juw12.github.io/cairn/");
  world = await runLoader({ feed: feedLine("cairn", now - 26 * 3600000, Object.assign({}, cairn, { day: yesterday, live: 0 })), family: "large" });
  seen = texts(world.shown);
  assert.ok(seen.includes("No live sessions") && seen.includes("Nothing shipped yet today"), "stale cairn: " + JSON.stringify(seen));

  // 14. run inside Scriptable (or tapped): the live view opens, full screen
  world = await runLoader({ feed: fullFeed, family: "medium", inApp: true, webView: true });
  assert.strictEqual(world.webViewUrl, LIVE, "in the app, the live view opens");
  assert.strictEqual(world.webViewPresented, true);
  world = await runLoader({ feed: fullFeed, family: "medium", inApp: true, webView: false });
  assert.ok(world.presented, "without a web view the widget preview still shows");

  // 15. medium with an app name: that one app fills the whole widget, drawn like the app (for a Smart Stack)
  world = await runLoader({ feed: fullFeed, family: "medium", param: "Haru" });
  seen = texts(world.shown);
  assert.ok(seen.includes("Haru") && seen.includes("Clear 18°") && seen.includes("2 moments today"), "medium haru: " + JSON.stringify(seen));
  ["PocketDex", "Cozy Island", "Cairn", "LIVE ›"].forEach((other) => assert.ok(!seen.includes(other), "medium haru must not show " + other));
  assert.strictEqual(world.shown.url, "https://juw12.github.io/projects/haru/app/", "tapping a one-app widget opens that app");
  assert.ok(!links(world.shown).includes(LIVE), "a one-app widget does not open the dashboard");
  assert.strictEqual(seen.filter((item) => item === "●").length, 4, "one dot per app shows where this widget sits");
  assert.deepStrictEqual(world.shown.backgroundImage, { picture: "https://juw12.github.io/projects/haru/app/scenes/clear__dusk__autumn.jpg" }, "Haru's scene fills the widget");
  assert.deepStrictEqual(dates(world.shown, "relative"), [now - 120000], "shows when Haru last updated");

  // 16. large with an app name, and its countdown still runs
  world = await runLoader({ feed: fullFeed, family: "large", param: "pocketdex" });
  seen = texts(world.shown);
  assert.ok(seen.includes("PocketDex") && seen.includes("Pikachu Lv 12") && !seen.includes("Haru"), "large pocketdex: " + JSON.stringify(seen));
  assert.deepStrictEqual(dates(world.shown, "timer"), [battleEnds], "large pocketdex counts down to the battle end");
  assert.strictEqual(world.shown.backgroundColor.hex, "#f6f2eb", "PocketDex keeps its cream paper");
  assert.strictEqual(seen.filter((item) => item === "Dex 37/1025").length, 1, "the Dex count shows once, as a pill");
  assert.ok(!world.shown.backgroundImage, "PocketDex has no photo background");

  // 17. "rotate": one widget takes turns, one app per 5-minute slot, and asks iOS to redraw at the next turn
  const trio = require(path.join(WIDGET_DIR, "trio.js"));
  const slot = 5 * 60 * 1000;
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((index) => trio.trioFocusApp("rotate", index * slot + 10)), ["pocketdex", "haru", "cozy", "cairn", "pocketdex"]);
  assert.strictEqual(trio.trioFocusApp("cozy-island", 0), "cozy");
  assert.strictEqual(trio.trioFocusApp("", 0), "", "empty parameter keeps the all-apps view");
  assert.strictEqual(trio.trioFocusApp("nonsense", 0), "", "an unknown word keeps the all-apps view");
  world = await runLoader({ feed: fullFeed, family: "medium", param: "rotate" });
  seen = texts(world.shown);
  const titles = ["PocketDex", "Haru", "Cozy Island", "Cairn"].filter((title) => seen.includes(title));
  assert.strictEqual(titles.length, 1, "rotate shows exactly one app: " + JSON.stringify(titles));
  const nextTurn = (Math.floor(Date.now() / slot) + 1) * slot;
  // iOS is never asked for a redraw sooner than a minute away, so a turn due within a minute waits that long.
  assert.ok(world.shown.refreshAfterDate.getTime() <= Math.max(nextTurn + 1000, Date.now() + 61000), "rotate asks for a redraw by the next turn");

  // 18. each app in its own look: Cozy's island art (rainbow after rain), Cairn's session cards, offline-safe colours
  world = await runLoader({ feed: fullFeed, family: "medium", param: "cozy" });
  seen = texts(world.shown);
  assert.ok(seen.includes("Juwen's island") && seen.includes("Cozy Island"), "medium cozy: " + JSON.stringify(seen));
  assert.deepStrictEqual(world.shown.backgroundImage, { picture: "https://juw12.github.io/pocketdex/widget/art/cozy-rain.jpg" }, "rain shows the rainbow art");
  assert.strictEqual(world.shown.url, "https://juw12.github.io/portfolio/cozy-island/");
  const dryCozy = feedLine("cozy", now, Object.assign({}, cozy, { rain: false }));
  world = await runLoader({ feed: dryCozy, family: "small", param: "cozy" });
  assert.deepStrictEqual(world.shown.backgroundImage, { picture: "https://juw12.github.io/pocketdex/widget/art/cozy-day.jpg" }, "a dry island shows the island art");
  world = await runLoader({ feed: fullFeed, family: "large", param: "cairn" });
  seen = texts(world.shown);
  ["Cairn", "2 live sessions", "Add dark mode to the settings page", "tests passed", "Fix the GPX import", "3 shipped"].forEach((needle) => {
    assert.ok(seen.includes(needle), "large cairn is missing: " + needle + " in " + JSON.stringify(seen));
  });
  assert.strictEqual(world.shown.backgroundColor.hex, "#f4f1ea", "Cairn keeps its paper colour");
  assert.strictEqual(world.shown.url, "https://juw12.github.io/cairn/");
  // offline and no pictures yet: Haru falls back to its own warm colours and says it is offline
  world = await runLoader({ offline: true, disk: savedDisk, family: "small", param: "haru" });
  seen = texts(world.shown);
  assert.ok(seen.includes("Clear 18°") && seen.includes("offline · showing the last update"), "offline haru: " + JSON.stringify(seen));
  // an app that never sent anything still looks like itself and explains what to do
  world = await runLoader({ feed: "", family: "medium", param: "pocketdex" });
  seen = texts(world.shown);
  assert.ok(seen.includes("PocketDex") && seen.includes("Not linked yet") && seen.includes("open PocketDex once to link it"), "empty pocketdex: " + JSON.stringify(seen));
  assert.strictEqual(world.shown.backgroundColor.hex, "#f6f2eb");

  // 19. PocketDex lock screen during a focus battle: partner vs the wild Pokémon, live countdown, draining HP bar
  world = await runLoader({ feed: fullFeed, family: "accessoryRectangular", param: "pocketdex" });
  const pictures = [];
  walk(world.shown, (node) => node.kind === "image" && pictures.push(node.image));
  const sprite25 = "https://juw12.github.io/pocketdex/sprites/25.png";
  const sprite133 = "https://juw12.github.io/pocketdex/sprites/133.png";
  assert.strictEqual(pictures.length, 1, "one battle picture");
  assert.deepStrictEqual(pictures[0].composite, [sprite25, sprite133], "partner drawn first (bottom-left), the wild Pokémon second (top-right)");
  const plain = await runLoader({ feed: fullFeed, family: "accessoryRectangular", param: "pocketdex", noDraw: true });
  const loose = [];
  walk(plain.shown, (node) => node.kind === "image" && loose.push(node.image.picture));
  assert.deepStrictEqual(loose, [sprite25, sprite133], "without drawing, the two sprites sit side by side");
  assert.deepStrictEqual(dates(world.shown, "timer"), [battleEnds], "the countdown ticks live to the battle end");
  const bars = [];
  walk(world.shown, (node) => node.size && node.size.height === 4 && bars.push(node));
  assert.strictEqual(bars[0].size.width, 64, "HP bar track");
  const hpFill = bars[1].size.width;
  assert.ok(hpFill >= 29 && hpFill <= 32, "12 of 25 minutes left is about half HP: " + hpFill);
  assert.strictEqual(world.shown.url, "https://juw12.github.io/pocketdex/");
  assert.ok(world.shown.refreshAfterDate.getTime() <= Date.now() + 2 * 60 * 1000 + 1000, "redraws every couple of minutes so the HP bar keeps draining");
  const trioModule = require(path.join(WIDGET_DIR, "trio.js"));
  assert.strictEqual(trioModule.trioFoeHp({ startAt: 0, endsAt: 100 }, 25), 0.75);
  assert.strictEqual(trioModule.trioFoeHp({ startAt: 0, endsAt: 100 }, 200), 0, "HP never goes below empty");
  world = await runLoader({ feed: fullFeed, family: "accessoryInline", param: "pocketdex" });
  assert.ok(/^Pikachu vs Eevee · until \d\d:\d\d$/.test(texts(world.shown)[0]), "inline: " + texts(world.shown)[0]);
  world = await runLoader({ feed: fullFeed, family: "accessoryCircular", param: "pocketdex" });
  assert.deepStrictEqual(dates(world.shown, "timer"), [battleEnds], "circular shows the live countdown");
  // no battle: the usual PocketDex lock screen
  const calm = feedLine("pocketdex", now, Object.assign({}, pocketdex, { focus: null }));
  world = await runLoader({ feed: calm, family: "accessoryRectangular", param: "pocketdex" });
  assert.deepStrictEqual(texts(world.shown), ["PocketDex", "Pikachu Lv 12", "Dex 37/1025"]);

  // 20. the widget shows when it last ran, and a drawing error shows a message instead of freezing
  world = await runLoader({ feed: fullFeed, family: "medium", param: "haru" });
  const stamp = "✓ " + trioModule.trioRanAt(Date.now());
  assert.ok(texts(world.shown).includes(stamp), "one-app widget shows when it last ran: " + JSON.stringify(texts(world.shown)));
  world = await runLoader({ feed: fullFeed, family: "medium" });
  assert.ok(texts(world.shown).some((item) => item.startsWith(stamp)), "dashboard shows when it last ran");
  const broken = TRIO_SOURCE.replace("function trioBuild(cards, family", "function trioBuild(cards, family) { throw new Error('boom'); }\nfunction trioBuildUnused(cards, family");
  world = await runLoader({ trioSource: broken, feed: fullFeed, family: "medium" });
  seen = texts(world.shown);
  assert.ok(seen.some((item) => /could not draw/.test(item)) && seen.includes("boom"), "error widget: " + JSON.stringify(seen));
  assert.ok(world.completed, "the script still completes");

  console.log("widget trio check: 20 scenarios passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
