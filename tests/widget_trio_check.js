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
    Font: { systemFont: font("regular"), boldSystemFont: font("bold"), boldMonospacedSystemFont: font("mono") },
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
    SFSymbol: { named: (name) => ({ applyFont() {}, image: { symbol: name } }) },
    config: { widgetFamily: options.family || "medium", runsInWidget: true },
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
const bloomAt = now + 3 * 60 * 1000;
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
const fullFeed = [
  '{"id":"open","time":1,"event":"open","topic":"t"}',
  "not json at all",
  feedLine("pocketdex", now - 9 * 60000, Object.assign({}, pocketdex, { caught: 1 })),
  feedLine("pocketdex", now - 60000, pocketdex),
  feedLine("haru", now - 120000, haru),
  feedLine("cozy", now - 30000, cozy),
  feedLine("someoneelse", now, { hello: 1 }),
].join("\n");

(async () => {
  // 1. medium: all three apps, live timers, tap targets, refresh time
  let world = await runLoader({ feed: fullFeed, family: "medium" });
  let seen = texts(world.shown);
  assert.ok(world.completed && world.shown, "medium widget was not set");
  ["POCKETDEX", "HARU", "COZY ISLAND", "Pikachu Lv 12", "Dex 37/1025", "Clear 18°", "Juwen's island", "vs Eevee ", "Tulip blooms "].forEach((needle) => {
    assert.ok(seen.includes(needle), "medium is missing: " + needle + " in " + JSON.stringify(seen));
  });
  assert.deepStrictEqual(dates(world.shown, "timer").sort(), [battleEnds, bloomAt].sort(), "timers should count down to the battle end and the bloom");
  assert.deepStrictEqual(dates(world.shown, "relative"), [now - 30000], "footer shows the newest update");
  assert.strictEqual(links(world.shown).length, 3, "each tile opens its app");
  const refresh = world.shown.refreshAfterDate.getTime();
  assert.ok(refresh >= bloomAt && refresh <= bloomAt + 5000, "refresh should follow the next timer end");
  assert.ok(world.disk.get("/docs/juw12-trio-widget.js") === TRIO_SOURCE, "loader keeps an offline copy of the widget code");
  assert.ok(world.requests.some((url) => url.includes("/" + CODE + "/json?poll=1&since=12h")), "polls the paired topic");

  // 2. small: one named app only
  world = await runLoader({ feed: fullFeed, family: "small", param: "Haru" });
  seen = texts(world.shown);
  assert.ok(seen.includes("HARU") && seen.includes("2 moments today"), "small haru: " + JSON.stringify(seen));
  assert.ok(!seen.includes("POCKETDEX") && !seen.includes("COZY ISLAND"), "small shows one app");
  assert.strictEqual(world.shown.url, "https://juw12.github.io/projects/haru/app/");

  // 3. small without a parameter follows the timer that ends first
  world = await runLoader({ feed: fullFeed, family: "small" });
  assert.ok(texts(world.shown).includes("COZY ISLAND"), "small default should follow the soonest timer");

  // 4. large: three rows with more detail
  world = await runLoader({ feed: fullFeed, family: "large" });
  seen = texts(world.shown);
  ["Habits 2/3 · 5d streak", "Dusk · Autumn", "14 days kept · 6.3 km", "Autumn · rain", "1 ready to harvest"].forEach((needle) => {
    assert.ok(seen.includes(needle), "large is missing: " + needle + " in " + JSON.stringify(seen));
  });

  // 5. lock screen
  world = await runLoader({ feed: fullFeed, family: "accessoryRectangular", param: "pocketdex" });
  assert.deepStrictEqual(texts(world.shown), ["PocketDex", "Pikachu Lv 12", "vs Eevee "]);
  world = await runLoader({ feed: fullFeed, family: "accessoryInline", param: "haru" });
  assert.deepStrictEqual(texts(world.shown), ["Haru · Clear 18°"]);

  // 6. nothing published yet
  world = await runLoader({ feed: "", family: "medium" });
  seen = texts(world.shown);
  assert.strictEqual(seen.filter((item) => item === "Not linked yet").length, 3, "empty feed: " + JSON.stringify(seen));
  assert.ok(seen.some((item) => item.includes("juw12.github.io/pocketdex/widget")), "empty widget points at the setup page");

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
  assert.ok(seen.includes("add your code: juw12.github.io/pocketdex/widget"), "missing code: " + JSON.stringify(seen));
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
  ["Habits 0/3 · 5d streak", "Battle over · open to finish", "No moments yet today", "Focus paused · 12:34"].forEach((needle) => {
    assert.ok(seen.includes(needle), "stale is missing: " + needle + " in " + JSON.stringify(seen));
  });
  assert.deepStrictEqual(dates(world.shown, "timer"), [], "no countdown once every timer has ended or is paused");

  // 12. odd data from the relay cannot crash the widget
  const oddFeed = [
    feedLine("pocketdex", now, { partner: { id: "25/../x", name: {}, level: "many" }, habits: "none", focus: { endsAt: "soon" } }),
    feedLine("haru", now, { scene: "../../secret", weather: 7, tempC: "hot" }),
    feedLine("cozy", now, { garden: "weeds", focus: 4 }),
  ].join("\n");
  world = await runLoader({ feed: oddFeed, family: "medium" });
  assert.ok(world.shown && texts(world.shown).includes("HARU"), "odd data should still draw");
  assert.ok(!world.requests.some((url) => url.includes("..")), "never requests an image path taken from odd data");

  console.log("widget trio check: 12 scenarios passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
