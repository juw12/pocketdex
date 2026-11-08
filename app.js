/* PocketDex - a retro field companion. Vanilla JS, no build step, works offline. */
(function () {
  "use strict";

  // ---------------------------------------------------------------- data
  const DATA = window.DEX_DATA;
  const DEX = DATA.dex;
  const EFF = DATA.eff;
  const BY_ID = new Map(DEX.map((p) => [p.id, p]));
  const TOTAL = DEX.length;
  const TYPES = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
    "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
  ];
  const STAT_LABELS = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];
  const GEN_NAMES = ["", "Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
  const GENS = [...new Set(DEX.map((p) => p.gen))].sort((a, b) => a - b);

  const CHILDREN = new Map();
  DEX.forEach((p) => {
    if (p.from) {
      if (!CHILDREN.has(p.from)) CHILDREN.set(p.from, []);
      CHILDREN.get(p.from).push(p.id);
    }
  });

  // ---------------------------------------------------------------- storage
  // Opaque origins (sandboxed frames, some file:// hosts) throw on localStorage access.
  const memoryStore = {};
  const store = (function () {
    try {
      const probe = "__pocketdex_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) {
      return {
        getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
        setItem: (key, value) => { memoryStore[key] = String(value); },
        removeItem: (key) => { delete memoryStore[key]; },
      };
    }
  })();

  const STORAGE_KEY = "pocketdex.v1";
  const DEFAULT_STATE = () => ({
    trainer: "Trainer",
    started: todayKey(),
    caught: {},
    seen: {},
    fav: {},
    notes: {},
    team: [],
    habits: [
      { id: "h1", name: "Drink 8 glasses of water", type: "water" },
      { id: "h2", name: "Walk 20 minutes", type: "fighting" },
      { id: "h3", name: "Read 10 pages", type: "psychic" },
    ],
    habitLog: {},
    partner: null,
    focus: null,
    focusLog: [],
    field: [],
    quiz: { best: 0, streak: 0, answered: 0, correct: 0 },
    settings: { sound: true },
    lastId: 25,
  });

  function loadState() {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_STATE();
      return Object.assign(DEFAULT_STATE(), JSON.parse(raw));
    } catch (error) {
      return DEFAULT_STATE();
    }
  }

  let state = loadState();

  function save() {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      toast("Storage is full. Export a backup from the Trainer page.");
    }
  }

  // ---------------------------------------------------------------- helpers
  function todayKey(date) {
    const d = date || new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
  }

  function dayOffset(key, offset) {
    const [y, m, d] = key.split("-").map(Number);
    return todayKey(new Date(y, m - 1, d + offset));
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function num(id) {
    return String(id).padStart(3, "0");
  }

  function cap(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sprite(id) {
    return `sprites/${id}.png`;
  }

  function typeChip(type) {
    return `<span class="chip t-${type}">${type}</span>`;
  }

  const ICON = {
    left: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
    right: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
    arrow: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6.5 18.5 12 13 17.5"/></svg>',
    meadow: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18.5c3-1.6 6-1.6 9 0s6 1.6 9 0M7 15V9.5M7 9.5c-1.8 0-3-1.3-3-3 1.8 0 3 1.3 3 3Zm0 0c1.8 0 3-1.3 3-3-1.8 0-3 1.3-3 3ZM16.5 14.5V7m0 0a2.5 2.5 0 1 0 0-.1"/></svg>',
    leaf: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Zm0 0 7-7"/></svg>',
    camera: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    question: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2 1-1.2 1.9M12 16.6v.1"/></svg>',
    team: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3 19c.6-3 2.7-4.5 5-4.5s4.4 1.5 5 4.5M14 15.2c2.6-.5 5.3.8 6 3.8"/></svg>',
    card: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 15.5c.6-1.3 1.7-2 3-2s2.4.7 3 2M14.5 10h3.5M14.5 13h3.5"/></svg>',
    checks: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  };

  function isCaught(id) {
    return Boolean(state.caught[id]);
  }

  function caughtCount() {
    return Object.keys(state.caught).length;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  // ---------------------------------------------------------------- type math
  function multiplier(attack, defenders) {
    return defenders.reduce((product, defender) => {
      const row = EFF[attack] || {};
      return product * (defender in row ? row[defender] : 1);
    }, 1);
  }

  function defenseProfile(types) {
    const profile = {};
    TYPES.forEach((attack) => {
      profile[attack] = multiplier(attack, types);
    });
    return profile;
  }

  // ---------------------------------------------------------------- sound
  let audio = null;
  function tone(freq, start, length, volume, wave) {
    if (!state.settings.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = wave || "square";
      osc.frequency.value = freq;
      gain.gain.value = volume || 0.04;
      osc.connect(gain);
      gain.connect(audio.destination);
      const t0 = audio.currentTime + start;
      gain.gain.setValueAtTime(volume || 0.04, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.start(t0);
      osc.stop(t0 + length + 0.02);
    } catch (error) {
      /* audio unavailable */
    }
  }

  const sfx = {
    blip: () => tone(1320, 0, 0.05, 0.03),
    select: () => {
      tone(988, 0, 0.06);
      tone(1319, 0.06, 0.08);
    },
    catch: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.12, 0.05)),
    level: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.1, 0.05)),
    wrong: () => {
      tone(220, 0, 0.12);
      tone(165, 0.12, 0.2);
    },
    cry: (id) => {
      const random = rng(id * 7919);
      for (let i = 0; i < 6; i++) {
        tone(300 + random() * 900, i * 0.06, 0.08, 0.035, random() > 0.5 ? "square" : "sawtooth");
      }
    },
  };

  // ---------------------------------------------------------------- toast / dialog box
  let toastTimer = null;
  function toast(message) {
    const box = $("#toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.hidden = true;
    }, 3600);
  }

  function modal(html, onMount) {
    const layer = $("#modal");
    layer.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
    layer.hidden = false;
    const close = () => {
      layer.hidden = true;
      layer.innerHTML = "";
    };
    layer.onclick = (event) => {
      if (event.target === layer || event.target.closest("[data-close]")) close();
    };
    if (onMount) onMount(layer.firstElementChild, close);
    const focusable = layer.querySelector("button, input, select, textarea");
    if (focusable) focusable.focus();
    return close;
  }

  // ---------------------------------------------------------------- core actions
  function markSeen(id) {
    if (!state.seen[id]) {
      state.seen[id] = todayKey();
      save();
    }
  }

  function catchPokemon(id, via) {
    const p = BY_ID.get(id);
    if (!p) return;
    const fresh = !isCaught(id);
    state.caught[id] = state.caught[id] || { d: todayKey(), via: via || "manual" };
    state.seen[id] = state.seen[id] || todayKey();
    save();
    if (fresh) {
      sfx.catch();
      toast(`Gotcha! ${p.n} was caught. ${caughtCount()} of ${TOTAL} registered.`);
      checkBadges();
    }
    updateHeader();
  }

  function releasePokemon(id) {
    delete state.caught[id];
    save();
    updateHeader();
  }

  // Daily encounter: deterministic per date, skips legendaries except on Sundays.
  function encounterFor(key) {
    const random = rng(hashString("encounter-" + key));
    const sunday = new Date(key + "T12:00:00").getDay() === 0;
    for (let tries = 0; tries < 20; tries++) {
      const p = DEX[Math.floor(random() * TOTAL)];
      if (sunday || !p.leg) return p;
    }
    return DEX[0];
  }

  // ---------------------------------------------------------------- partner / xp
  const XP = { habit: 40, focusMinute: 5 };
  function levelFor(xp) {
    return Math.max(1, Math.min(100, Math.floor(Math.cbrt(xp))));
  }

  function xpForLevel(level) {
    return level * level * level;
  }

  function evolutionStage(id) {
    let stage = 1;
    let p = BY_ID.get(id);
    while (p && p.from) {
      stage += 1;
      p = BY_ID.get(p.from);
    }
    return stage;
  }

  function addXp(amount, reason) {
    if (!state.partner) return;
    const before = levelFor(state.partner.xp);
    state.partner.xp = Math.max(125, state.partner.xp + amount);
    const after = levelFor(state.partner.xp);
    save();
    if (after > before && amount > 0) {
      const p = BY_ID.get(state.partner.id);
      sfx.level();
      toast(`${p.n} grew to Lv ${after}! (${reason})`);
      maybeEvolve();
    }
  }

  function maybeEvolve() {
    const partner = state.partner;
    if (!partner) return;
    const level = levelFor(partner.xp);
    const stage = evolutionStage(partner.id);
    const threshold = stage === 1 ? 16 : stage === 2 ? 32 : 999;
    const options = CHILDREN.get(partner.id) || [];
    if (level < threshold || !options.length) return;
    const p = BY_ID.get(partner.id);
    const choices = options
      .map((id) => {
        const child = BY_ID.get(id);
        return `<button class="evo-choice" data-evolve="${id}"><img src="${sprite(id)}" alt="">${esc(child.n)}</button>`;
      })
      .join("");
    modal(
      `<p class="eyebrow">What?</p><h2>${esc(p.n)} is evolving!</h2>
       <div class="evo-row"><img class="evo-from" src="${sprite(p.id)}" alt="${esc(p.n)}"></div>
       <p>${options.length > 1 ? "Choose how it evolves:" : "Let it evolve?"}</p>
       <div class="evo-options">${choices}</div>
       <button class="btn ghost" data-close>Not now (B)</button>`,
      (card, close) => {
        $all("[data-evolve]", card).forEach((button) => {
          button.addEventListener("click", () => {
            const id = Number(button.dataset.evolve);
            state.partner.id = id;
            catchPokemon(id, "evolution");
            save();
            sfx.level();
            close();
            toast(`Congratulations! Your ${p.n} evolved into ${BY_ID.get(id).n}!`);
            render();
          });
        });
      }
    );
  }

  // ---------------------------------------------------------------- streaks
  function activeDays() {
    const days = new Set();
    Object.entries(state.habitLog).forEach(([day, entries]) => {
      if (Object.values(entries).some(Boolean)) days.add(day);
    });
    state.focusLog.forEach((entry) => {
      if (entry.result === "caught") days.add(entry.d);
    });
    return days;
  }

  function streakFrom(days) {
    let key = todayKey();
    if (!days.has(key)) key = dayOffset(key, -1);
    let count = 0;
    while (days.has(key)) {
      count += 1;
      key = dayOffset(key, -1);
    }
    return count;
  }

  function streakLabel(days) {
  if (!days) {
    return "No streak yet";
  }
  return days === 1 ? "1-day streak" : `${days}-day streak`;
}

function habitStreak(habitId) {
    const days = new Set(
      Object.entries(state.habitLog)
        .filter(([, entries]) => entries[habitId])
        .map(([day]) => day)
    );
    return streakFrom(days);
  }

  function focusMinutesOn(key) {
    return state.focusLog
      .filter((entry) => entry.d === key && entry.result === "caught")
      .reduce((sum, entry) => sum + entry.minutes, 0);
  }

  // ---------------------------------------------------------------- badges
  const BADGES = [
    { id: "boulder", name: "Boulder", color: "#8a8a8a", rule: "Catch your first Pokémon", test: () => caughtCount() >= 1 },
    { id: "cascade", name: "Cascade", color: "#3b82c4", rule: "Catch 10 Pokémon", test: () => caughtCount() >= 10 },
    { id: "thunder", name: "Thunder", color: "#e2b714", rule: "Finish 5 focus sessions", test: () => state.focusLog.filter((e) => e.result === "caught").length >= 5 },
    { id: "rainbow", name: "Rainbow", color: "#3aa35b", rule: "Keep a 7 day streak", test: () => streakFrom(activeDays()) >= 7 },
    { id: "soul", name: "Soul", color: "#d6457a", rule: "Create 3 Field Dex entries", test: () => state.field.length >= 3 },
    { id: "marsh", name: "Marsh", color: "#c9a227", rule: "Reach a quiz streak of 10", test: () => state.quiz.best >= 10 },
    { id: "volcano", name: "Volcano", color: "#d8432b", rule: "Build a full team of 6", test: () => state.team.length >= 6 },
    { id: "earth", name: "Earth", color: "#4f8a3c", rule: "Catch all 151 Kanto Pokémon", test: () => DEX.filter((p) => p.gen === 1).every((p) => isCaught(p.id)) },
  ];

  function checkBadges() {
    state.badges = state.badges || {};
    BADGES.forEach((badge) => {
      if (!state.badges[badge.id] && badge.test()) {
        state.badges[badge.id] = todayKey();
        save();
        setTimeout(() => toast(`You earned the ${badge.name} Badge! ${badge.rule}.`), 1800);
      }
    });
  }

  function badgeSvg(badge, earned) {
    const fill = earned ? badge.color : "none";
    return `<svg viewBox="0 0 16 16" class="badge-svg" aria-hidden="true" shape-rendering="crispEdges">
      <path d="M5 1h6v1h2v2h1v2h1v4h-1v2h-1v2h-2v1H5v-1H3v-2H2v-2H1V6h1V4h1V2h2z" fill="${fill}" stroke="currentColor" stroke-width="1"/>
      ${earned ? '<path d="M6 4h2v1H6zM5 5h1v2H5z" fill="#fff" opacity=".7"/>' : ""}
    </svg>`;
  }

  // ---------------------------------------------------------------- header
  function updateHeader() {
    const count = caughtCount();
    $("#hdr-caught").textContent = `${count} / ${TOTAL}`;
    $("#hdr-bar").style.width = `${(count / TOTAL) * 100}%`;
    $("#sound-toggle").setAttribute("aria-pressed", String(state.settings.sound));
    $("#sound-label").textContent = state.settings.sound ? "Sound on" : "Sound off";
  }

  // ---------------------------------------------------------------- router
  const ROUTES = ["today", "meadow", "dex", "focus", "habits", "field", "quiz", "team", "trainer", "more"];
  const TAB_FOR = { meadow: "more", field: "more", quiz: "more", team: "more", trainer: "more" };
  function parseRoute() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [path, query] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(query || "");
    const name = ROUTES.includes(parts[0]) ? parts[0] : "today";
    return { name, arg: parts[1], params };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  let currentRoute = null;
  let activeMeadow = null;
  function render() {
    const route = parseRoute();
    currentRoute = route;
    if (activeMeadow) {
      activeMeadow.destroy();
      activeMeadow = null;
    }
    const tab = TAB_FOR[route.name] || route.name;
    $all(".tabbar a").forEach((link) => {
      const active = link.dataset.route === tab;
      link.classList.toggle("on", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const view = $("#view");
    view.dataset.route = route.name;
    const renderer = VIEWS[route.name];
    view.innerHTML = renderer.html(route);
    if (renderer.mount) renderer.mount(view, route);
    updateHeader();
    if (!route.keepScroll) window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- shared pieces
  function statBars(p) {
    const rows = p.s
      .map((value, index) => {
        const pct = Math.min(100, Math.round((value / 180) * 100));
        return `<div class="stat"><span>${STAT_LABELS[index]}</span><b>${value}</b><i><u style="width:${pct}%"></u></i></div>`;
      })
      .join("");
    const total = p.s.reduce((a, b) => a + b, 0);
    return `${rows}<div class="stat total"><span>Total</span><b>${total}</b><i></i></div>`;
  }

  function weaknessBlock(types) {
    const profile = defenseProfile(types);
    const groups = [
      [4, "4x weak"],
      [2, "2x weak"],
      [0.5, "Resists"],
      [0.25, "Resists 4x"],
      [0, "Immune"],
    ];
    return groups
      .map(([factor, label]) => {
        const list = TYPES.filter((t) => profile[t] === factor);
        if (!list.length) return "";
        return `<div class="weak-row"><span class="weak-label">${label}</span><div class="chips">${list.map(typeChip).join("")}</div></div>`;
      })
      .join("");
  }

  function chainRoot(id) {
    let p = BY_ID.get(id);
    while (p && p.from && BY_ID.get(p.from)) p = BY_ID.get(p.from);
    return p.id;
  }

  function evolutionBlock(id) {
    const root = chainRoot(id);
    function branch(nodeId) {
      const p = BY_ID.get(nodeId);
      const kids = CHILDREN.get(nodeId) || [];
      const node = `<a class="evo-node ${nodeId === id ? "on" : ""}" href="#/dex/${nodeId}">
        <img src="${sprite(nodeId)}" alt="" loading="lazy"><span>${esc(p.n)}</span></a>`;
      if (!kids.length) return node;
      return `${node}<span class="evo-arrow" aria-hidden="true">${ICON.right}</span><div class="evo-kids">${kids.map(branch).map((b) => `<div class="evo-line">${b}</div>`).join("")}</div>`;
    }
    if (!(CHILDREN.get(root) || []).length) {
      return `<p class="muted">${esc(BY_ID.get(id).n)} does not evolve.</p>`;
    }
    return `<div class="evo-chain">${branch(root)}</div>`;
  }

  function pickerModal(title, onPick, filterFn) {
    modal(
      `<h2>${esc(title)}</h2>
       <input class="field-input" id="pick-q" placeholder="Name or number" autocomplete="off">
       <div class="pick-list" id="pick-list"></div>
       <button class="btn ghost" data-close>Cancel</button>`,
      (card, close) => {
        const list = $("#pick-list", card);
        const input = $("#pick-q", card);
        const draw = () => {
          const q = input.value.trim().toLowerCase();
          const results = DEX.filter((p) => (!filterFn || filterFn(p)) && (!q || p.n.toLowerCase().includes(q) || String(p.id) === q.replace(/^0+/, ""))).slice(0, 60);
          list.innerHTML = results.length
            ? results.map((p) => `<button class="pick-item" data-id="${p.id}"><img src="${sprite(p.id)}" alt="" loading="lazy"><span>No.${num(p.id)}</span>${esc(p.n)}</button>`).join("")
            : `<p class="muted">No match.</p>`;
        };
        input.addEventListener("input", draw);
        list.addEventListener("click", (event) => {
          const button = event.target.closest("[data-id]");
          if (!button) return;
          close();
          onPick(Number(button.dataset.id));
        });
        draw();
      }
    );
  }

  // ---------------------------------------------------------------- meadow (3D)
  let meadowLibs = null;
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = url;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error("Could not load " + url));
      document.head.appendChild(tag);
    });
  }
  // The meadow starts after the page has loaded so the 3D scene never delays first paint.
  function pageLoaded() {
    if (document.readyState === "complete") {
      return Promise.resolve();
    }
    return new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  }
  function ensureMeadowLibs() {
    if (!meadowLibs) {
      meadowLibs = Promise.all([
        window.THREE ? null : loadScript("vendor/three.min.js"),
        window.SPRITE_DATA || location.protocol !== "file:" ? null : loadScript("vendor/sprites-data.js"),
      ]);
    }
    return meadowLibs;
  }
  const PHASE_LABEL = { dawn: "Dawn", day: "Daytime", dusk: "Dusk", night: "Night" };

  function meadowResidents(limit) {
    const list = [];
    const seen = new Set();
    const encounter = encounterFor(todayKey());
    if (state.partner && BY_ID.get(state.partner.id)) {
      list.push({ id: state.partner.id, role: "Partner", partner: true });
      seen.add(state.partner.id);
    }
    if (!isCaught(encounter.id) && !seen.has(encounter.id)) {
      list.push({ id: encounter.id, role: "Wild today", encounter: true });
      seen.add(encounter.id);
    }
    Object.entries(state.caught)
      .sort((a, b) => (a[1].d < b[1].d ? 1 : -1))
      .forEach(([id, info]) => {
        const num = Number(id);
        if (!seen.has(num) && BY_ID.get(num) && list.length < limit) {
          list.push({ id: num, role: "Caught " + info.d });
          seen.add(num);
        }
      });
    return list.slice(0, limit);
  }

  function mountMeadow(stage, compact) {
    const residents = meadowResidents(compact ? 14 : 26);
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pageLoaded()
      .then(ensureMeadowLibs)
      .then(() => {
        if (!stage.isConnected) return;
        if (activeMeadow) activeMeadow.destroy();
        activeMeadow = window.PocketMeadow.mount(stage, {
          compact,
          reduceMotion,
          creatures: residents.map((r) => ({ id: r.id, name: BY_ID.get(r.id).n, partner: Boolean(r.partner), encounter: Boolean(r.encounter) })),
          onSelect: (id) => showResident(stage, id, residents),
        });
      })
      .catch(() => {
        stage.dataset.ready = "fallback";
        stage.insertAdjacentHTML("afterbegin", '<p class="meadow-fallback">The meadow could not load here. Everything else in PocketDex still works.</p>');
      });
  }

  function showResident(stage, id, residents) {
    const pick = $(".meadow-pick", stage);
    if (!pick) return;
    const p = BY_ID.get(id);
    const resident = residents.find((r) => r.id === id) || { role: "" };
    sfx.cry(id);
    pick.innerHTML = `<img src="${sprite(id)}" alt="">
      <div><p class="eyebrow">No.${num(id)} &middot; ${esc(resident.role)}</p><p class="pick-name">${esc(state.partner && state.partner.id === id && state.partner.nick ? state.partner.nick : p.n)}</p>
      <div class="chips">${p.t.map(typeChip).join("")}</div></div>
      <div class="pick-actions">${resident.encounter ? `<a class="btn primary sm" href="#/focus?id=${id}">Focus to catch</a>` : ""}<a class="btn ghost sm" href="#/dex/${id}">Open entry</a>
      <button class="icon-close" type="button" aria-label="Close" data-close-pick><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>`;
    pick.hidden = false;
    pick.querySelector("[data-close-pick]").addEventListener("click", () => {
      pick.hidden = true;
    });
  }

  // ---------------------------------------------------------------- views
  const VIEWS = {};

  VIEWS.meadow = {
    html() {
      const residents = meadowResidents(26);
      const phase = window.PocketMeadow ? window.PocketMeadow.phaseFor(new Date()) : "day";
      const caughtHere = residents.filter((r) => !r.encounter).length;
      return `
      <section class="page-head">
        <p class="eyebrow">${PHASE_LABEL[phase]} in the meadow</p>
        <h1>The Meadow</h1>
        <p class="lead">A quiet place where the Pokémon you catch come to rest. It follows your local time, from dawn to night. Nothing to win here; stay as long as you like.</p>
      </section>
      <div class="meadow-layout">
        <div class="stage tall" id="meadow-stage" data-phase="${phase}">
          <div class="meadow-pick" hidden></div>
        </div>
        <aside class="card residents">
          <h2 class="h3">Residents <span class="muted">${caughtHere} caught</span></h2>
          <ul class="resident-list">
            ${residents.map((r) => `<li><a href="#/dex/${r.id}"><img src="${sprite(r.id)}" alt="" loading="lazy"><span><b>${esc(BY_ID.get(r.id).n)}</b><small>${esc(r.role)}</small></span></a></li>`).join("")}
          </ul>
          ${caughtHere === 0 ? `<p class="muted small">Finish a focus session to catch today's wild Pokémon. It will stay here afterwards.</p>` : ""}
          <p class="hint">Drag to look around, scroll or pinch to zoom, tap a Pokémon to say hello.</p>
        </aside>
      </div>`;
    },
    mount(view) {
      mountMeadow($("#meadow-stage", view), false);
    },
  };

  VIEWS.more = {
    html() {
      const items = [
        ["#/meadow", ICON.meadow, "The Meadow", "A calm 3D field where your caught Pokémon wander."],
        ["#/field", ICON.camera, "Field Dex", "Turn photos from your day into Pokédex entries."],
        ["#/quiz", ICON.question, "Who's that Pokémon?", "Silhouette quiz, by region."],
        ["#/team", ICON.team, "Team builder", "Six slots, weaknesses and coverage."],
        ["#/trainer", ICON.card, "Trainer card", "Badges, progress by region, backup and settings."],
      ];
      return `
      <section class="page-head"><h1>More</h1><p class="lead">Everything else in PocketDex.</p></section>
      <div class="more-list">
        ${items.map(([href, icon, title, text]) => `<a class="more-item" href="${href}"><span class="more-icon">${icon}</span><span><b>${title}</b><small>${text}</small></span>${ICON.right}</a>`).join("")}
      </div>`;
    },
  };

  // ---- Today
  VIEWS.today = {
    html() {
      const key = todayKey();
      const encounter = encounterFor(key);
      const caughtToday = isCaught(encounter.id);
      const hour = new Date().getHours();
      const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      const habitsDone = state.habits.filter((h) => (state.habitLog[key] || {})[h.id]).length;
      const streak = streakFrom(activeDays());
      const minutes = focusMinutesOn(key);
      const partner = state.partner ? BY_ID.get(state.partner.id) : null;
      const recent = Object.entries(state.caught)
        .sort((a, b) => (a[1].d < b[1].d ? 1 : -1))
        .slice(0, 8);

      const habitList = state.habits.length
        ? state.habits
            .map((h) => {
              const done = (state.habitLog[key] || {})[h.id];
              return `<li><label class="check"><input type="checkbox" data-habit="${h.id}" ${done ? "checked" : ""}><span>${esc(h.name)}</span></label>${typeChip(h.type)}</li>`;
            })
            .join("")
        : `<li class="muted">No habits yet. Add some on the Habits page.</li>`;

      let partnerBlock = `<div class="panel partner-empty"><h3>Partner</h3><p>Pick a partner Pokémon. It gains experience every time you finish a habit or a focus session, and evolves at Lv 16 and Lv 32.</p><a class="btn" href="#/habits">Choose a partner</a></div>`;
      if (partner) {
        const level = levelFor(state.partner.xp);
        const lo = xpForLevel(level);
        const hi = xpForLevel(level + 1);
        const pct = Math.round(((state.partner.xp - lo) / (hi - lo)) * 100);
        partnerBlock = `<div class="panel partner"><h3>Partner</h3>
          <div class="partner-row"><img class="sprite-md bob" src="${sprite(partner.id)}" alt="${esc(partner.n)}">
          <div><p class="big-name">${esc(state.partner.nick || partner.n)}</p><p class="muted">Lv ${level} &middot; ${state.partner.xp - lo} / ${hi - lo} XP</p>
          <div class="xpbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><u style="width:${pct}%"></u></div></div></div></div>`;
      }

      return `
      <section class="today-head">
        <div><p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1>${greeting}, ${esc(state.trainer)}.</h1></div>
        <dl class="kpis">
          <div><dt>Caught</dt><dd>${caughtCount()}</dd></div>
          <div><dt>Streak</dt><dd>${streak}<small> day${streak === 1 ? "" : "s"}</small></dd></div>
          <div><dt>Focus today</dt><dd>${minutes}<small> min</small></dd></div>
          <div><dt>Habits</dt><dd>${habitsDone}<small> / ${state.habits.length}</small></dd></div>
        </dl>
      </section>
      <section class="stage hero" id="today-stage">
        <div class="stage-caption">
          <p class="eyebrow">${PHASE_LABEL[window.PocketMeadow ? window.PocketMeadow.phaseFor(new Date()) : "day"]} in your meadow</p>
          <p class="stage-title">${caughtCount() ? `${caughtCount()} Pokémon resting here` : "Your meadow is waiting"}</p>
          <a class="stage-cta" href="#/meadow">Enter the meadow ${ICON.arrow}</a>
        </div>
        <div class="meadow-pick" hidden></div>
      </section>
      <div class="today-grid">
        <section class="panel encounter">
          <h3>Today's encounter</h3>
          <div class="lcd encounter-screen">
            <img class="sprite-lg ${caughtToday ? "" : "bob"}" src="${sprite(encounter.id)}" alt="${esc(encounter.n)}">
          </div>
          <div class="dialog">
            ${caughtToday
              ? `<p>${esc(encounter.n)} is registered in your Pokédex. A new Pokémon appears tomorrow.</p>`
              : `<p>A wild <b>${esc(encounter.n.toUpperCase())}</b> appeared! Finish a focus session to catch it.</p>`}
          </div>
          <div class="row">
            ${caughtToday ? `<a class="btn" href="#/dex/${encounter.id}">View entry</a>` : `<a class="btn primary" href="#/focus?id=${encounter.id}">Focus to catch</a><a class="btn ghost" href="#/dex/${encounter.id}">No.${num(encounter.id)} entry</a>`}
          </div>
        </section>
        <section class="panel">
          <h3>Today's training</h3>
          <ul class="habit-quick">${habitList}</ul>
          <a class="text-link" href="#/habits">Manage habits</a>
        </section>
        ${partnerBlock}
        <section class="panel">
          <h3>Recently caught</h3>
          ${recent.length
            ? `<div class="mini-grid">${recent.map(([id]) => `<a href="#/dex/${id}" title="${esc(BY_ID.get(Number(id)).n)}"><img src="${sprite(id)}" alt="${esc(BY_ID.get(Number(id)).n)}"></a>`).join("")}</div>`
            : `<p class="muted">Nothing yet. Your first catch is one focus session away.</p>`}
          <div class="row"><a class="btn ghost sm" href="#/quiz">Who's that Pokémon?</a><a class="btn ghost sm" href="#/field">Add a Field Dex entry</a></div>
        </section>
      </div>`;
    },
    mount(view) {
      view.addEventListener("change", (event) => {
        const box = event.target.closest("[data-habit]");
        if (box) toggleHabit(box.dataset.habit, box.checked);
      });
      mountMeadow($("#today-stage", view), true);
    },
  };

  function toggleHabit(habitId, done) {
    const key = todayKey();
    state.habitLog[key] = state.habitLog[key] || {};
    const was = Boolean(state.habitLog[key][habitId]);
    if (was === done) return;
    state.habitLog[key][habitId] = done;
    save();
    const habit = state.habits.find((h) => h.id === habitId);
    if (done) {
      sfx.select();
      addXp(XP.habit, habit ? habit.name : "habit");
      checkBadges();
    } else {
      addXp(-XP.habit, "undo");
    }
    if (currentRoute && currentRoute.name === "today") {
      const scroll = window.scrollY;
      render();
      window.scrollTo(0, scroll);
    }
  }

  // ---- Pokedex
  const dexFilter = { q: "", type: "", gen: "", status: "" };

  function matchQuery(p, q) {
    if (!q) return true;
    return q.split(/\s+/).every((token) => {
      if (/^\d+$/.test(token)) return String(p.id).startsWith(String(Number(token)));
      if (/^gen\d$/.test(token)) return p.gen === Number(token.slice(3));
      if (TYPES.includes(token)) return p.t.includes(token);
      return p.n.toLowerCase().includes(token) || p.g.toLowerCase().includes(token);
    });
  }

  function filteredDex() {
    const q = dexFilter.q.trim().toLowerCase();
    return DEX.filter((p) => {
      if (dexFilter.type && !p.t.includes(dexFilter.type)) return false;
      if (dexFilter.gen && p.gen !== Number(dexFilter.gen)) return false;
      if (dexFilter.status === "caught" && !isCaught(p.id)) return false;
      if (dexFilter.status === "missing" && isCaught(p.id)) return false;
      if (dexFilter.status === "fav" && !state.fav[p.id]) return false;
      return matchQuery(p, q);
    });
  }

  function dexRows(list, selected) {
    if (!list.length) return `<p class="empty">No Pokémon match. Try a name, a number, a type such as "fire", or "gen2".</p>`;
    return list
      .map((p) => `<a class="dex-row ${p.id === selected ? "on" : ""} ${isCaught(p.id) ? "caught" : ""}" href="#/dex/${p.id}" data-id="${p.id}">
        <span class="no">${num(p.id)}</span><img src="${sprite(p.id)}" alt="" loading="lazy" width="40" height="40">
        <span class="nm">${esc(p.n)}</span><span class="tp">${p.t.map(typeChip).join("")}</span>
        <span class="mark" aria-label="${isCaught(p.id) ? "caught" : "not caught"}">${isCaught(p.id) ? '<i class="dot"></i>' : ""}</span></a>`)
      .join("");
  }

  function detailHtml(p) {
    markSeen(p.id);
    const caught = state.caught[p.id];
    const idx = DEX.indexOf(p);
    const prev = DEX[idx - 1];
    const next = DEX[idx + 1];
    const inTeam = state.team.includes(p.id);
    return `
    <article class="detail" aria-label="${esc(p.n)} entry">
      <div class="detail-nav">
        ${prev ? `<a class="btn ghost sm" href="#/dex/${prev.id}" aria-label="Previous">${ICON.left}${num(prev.id)}</a>` : "<span></span>"}
        <a class="btn ghost sm back-link" href="#/dex">All Pokémon</a>
        ${next ? `<a class="btn ghost sm" href="#/dex/${next.id}" aria-label="Next">${num(next.id)}${ICON.right}</a>` : "<span></span>"}
      </div>
      <div class="detail-top">
        <div class="lcd detail-screen"><img class="sprite-xl" src="${sprite(p.id)}" alt="${esc(p.n)}"></div>
        <div class="detail-id">
          <p class="eyebrow">No.${num(p.id)} &middot; ${GEN_NAMES[p.gen]}${p.leg === 1 ? " &middot; Legendary" : p.leg === 2 ? " &middot; Mythical" : ""}</p>
          <h2>${esc(p.n)}</h2>
          <p class="genus">${esc(p.g)} Pokémon</p>
          <div class="chips">${p.t.map(typeChip).join("")}</div>
          <dl class="facts">
            <div><dt>Height</dt><dd>${(p.h / 10).toFixed(1)} m</dd></div>
            <div><dt>Weight</dt><dd>${(p.w / 10).toFixed(1)} kg</dd></div>
            <div><dt>Catch rate</dt><dd>${p.cr}</dd></div>
            <div><dt>Habitat</dt><dd>${p.hab ? esc(cap(p.hab.replace("-", " "))) : "Unknown"}</dd></div>
          </dl>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn ${caught ? "" : "primary"}" data-act="catch">${caught ? "Caught " + caught.d : "Mark as caught"}</button>
        <button class="btn ghost" data-act="cry">Play cry</button>
        <button class="btn ghost" data-act="fav" aria-pressed="${Boolean(state.fav[p.id])}">${state.fav[p.id] ? "Favourite" : "Add favourite"}</button>
        <button class="btn ghost" data-act="team" ${!inTeam && state.team.length >= 6 ? "disabled" : ""}>${inTeam ? "In team" : "Add to team"}</button>
        ${caught ? "" : `<a class="btn ghost" href="#/focus?id=${p.id}">Focus to catch</a>`}
      </div>
      <div class="dialog entry-text"><p>${esc(p.f)}</p></div>
      <div class="detail-cols">
        <section><h3>Base stats</h3>${statBars(p)}</section>
        <section><h3>Type matchups</h3>${weaknessBlock(p.t)}
          <h3 class="mt">Abilities</h3><p>${p.a.map((a) => (a.endsWith("*") ? esc(a.slice(0, -1)) + ' <span class="muted">(hidden)</span>' : esc(a))).join(", ")}</p>
        </section>
      </div>
      <section><h3>Evolution</h3>${evolutionBlock(p.id)}</section>
      <section><h3>Your field note</h3>
        <textarea class="field-input note" data-note="${p.id}" rows="3" placeholder="Where did you see it? Why do you like it? Notes stay on this device.">${esc(state.notes[p.id] || "")}</textarea>
      </section>
    </article>`;
  }

  VIEWS.dex = {
    html(route) {
      const id = Number(route.arg) || 0;
      const selected = BY_ID.get(id) ? id : 0;
      const list = filteredDex();
      const typeOptions = TYPES.map((t) => `<option value="${t}" ${dexFilter.type === t ? "selected" : ""}>${cap(t)}</option>`).join("");
      const genOptions = GENS.map((g) => `<option value="${g}" ${String(dexFilter.gen) === String(g) ? "selected" : ""}>Gen ${g} ${GEN_NAMES[g]}</option>`).join("");
      return `
      <div class="dex ${selected ? "has-detail" : ""}">
        <section class="dex-list-pane">
          <div class="dex-tools">
            <label class="sr" for="dex-q">Search</label>
            <input id="dex-q" class="field-input search" type="search" placeholder="Search by name, number or type" value="${esc(dexFilter.q)}" autocomplete="off">
            <div class="filters">
              <select id="dex-type" class="field-input" aria-label="Type"><option value="">All types</option>${typeOptions}</select>
              <select id="dex-gen" class="field-input" aria-label="Generation"><option value="">All regions</option>${genOptions}</select>
              <select id="dex-status" class="field-input" aria-label="Status">
                <option value="">Everything</option>
                <option value="caught" ${dexFilter.status === "caught" ? "selected" : ""}>Caught</option>
                <option value="missing" ${dexFilter.status === "missing" ? "selected" : ""}>Not caught</option>
                <option value="fav" ${dexFilter.status === "fav" ? "selected" : ""}>Favourites</option>
              </select>
            </div>
            <p class="count" id="dex-count">${list.length} shown &middot; ${caughtCount()} caught</p>
          </div>
          <div class="dex-list" id="dex-list">${dexRows(list, selected)}</div>
        </section>
        <section class="dex-detail-pane" id="dex-detail">${selected ? detailHtml(BY_ID.get(selected)) : `<div class="detail-empty lcd"><p>Select a Pokémon to open its entry.</p><p class="muted">Tip: press / to search, and use the arrow keys on an entry.</p></div>`}</section>
      </div>`;
    },
    mount(view, route) {
      const id = Number(route.arg) || 0;
      if (BY_ID.get(id)) state.lastId = id;
      const listEl = $("#dex-list", view);
      const redraw = () => {
        const list = filteredDex();
        listEl.innerHTML = dexRows(list, id);
        $("#dex-count", view).textContent = `${list.length} shown \u00b7 ${caughtCount()} caught`;
      };
      let timer = null;
      $("#dex-q", view).addEventListener("input", (event) => {
        dexFilter.q = event.target.value;
        clearTimeout(timer);
        timer = setTimeout(redraw, 90);
      });
      [["#dex-type", "type"], ["#dex-gen", "gen"], ["#dex-status", "status"]].forEach(([sel, key]) => {
        $(sel, view).addEventListener("change", (event) => {
          dexFilter[key] = event.target.value;
          redraw();
        });
      });
      const active = $(".dex-row.on", view);
      if (active && window.innerWidth > 900) active.scrollIntoView({ block: "center" });
      const detail = $("#dex-detail", view);
      detail.addEventListener("click", (event) => {
        const button = event.target.closest("[data-act]");
        if (!button || !id) return;
        const act = button.dataset.act;
        if (act === "catch") {
          if (isCaught(id)) {
            if (confirm(`Remove ${BY_ID.get(id).n} from your caught list?`)) releasePokemon(id);
          } else {
            catchPokemon(id, "manual");
          }
        } else if (act === "cry") {
          sfx.cry(id);
          return;
        } else if (act === "fav") {
          if (state.fav[id]) delete state.fav[id];
          else state.fav[id] = 1;
          save();
        } else if (act === "team") {
          if (state.team.includes(id)) state.team = state.team.filter((t) => t !== id);
          else if (state.team.length < 6) state.team.push(id);
          save();
          checkBadges();
        }
        const scroll = window.scrollY;
        render();
        window.scrollTo(0, scroll);
      });
      detail.addEventListener("input", (event) => {
        const note = event.target.closest("[data-note]");
        if (!note) return;
        state.notes[note.dataset.note] = note.value;
        if (!note.value) delete state.notes[note.dataset.note];
        save();
      });
      if (id && window.innerWidth <= 900) detail.scrollIntoView();
    },
  };

  // ---- Focus
  function focusRemaining(session) {
    const now = Date.now();
    const paused = session.pausedTotal + (session.pausedAt ? now - session.pausedAt : 0);
    return Math.max(0, session.minutes * 60000 - (now - session.start - paused));
  }

  function fmt(ms) {
    const total = Math.ceil(ms / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function finishFocus(success) {
    const session = state.focus;
    if (!session) return;
    const p = BY_ID.get(session.id);
    const doneMinutes = success ? session.minutes : Math.floor((session.minutes * 60000 - focusRemaining(session)) / 60000);
    state.focusLog.push({ d: todayKey(), id: session.id, minutes: success ? session.minutes : doneMinutes, result: success ? "caught" : "fled" });
    state.focus = null;
    save();
    document.title = "PocketDex";
    if (success) {
      catchPokemon(session.id, "focus");
      addXp(session.minutes * XP.focusMinute, `${session.minutes} min focus`);
      if (window.Notification && Notification.permission === "granted" && document.hidden) {
        try {
          new Notification("PocketDex", { body: `Focus complete. ${p.n} was caught!`, icon: sprite(p.id) });
        } catch (error) { /* ignore */ }
      }
    } else {
      toast(`${p.n} fled. Ready when you are.`);
    }
    checkBadges();
    if (currentRoute && currentRoute.name === "focus") render();
  }

  VIEWS.focus = {
    html(route) {
      const session = state.focus;
      if (session) {
        const p = BY_ID.get(session.id);
        const remain = focusRemaining(session);
        const pct = (remain / (session.minutes * 60000)) * 100;
        return `
        <section class="battle">
          <div class="lcd battle-screen">
            <div class="foe-box"><p>${esc(p.n.toUpperCase())}</p><div class="hp"><span>HP</span><i><u id="hp" style="width:${pct}%"></u></i></div></div>
            <img class="sprite-xl ${session.pausedAt ? "" : "bob"}" src="${sprite(p.id)}" alt="${esc(p.n)}">
            <p class="timer" id="timer" aria-live="off">${fmt(remain)}</p>
          </div>
          <div class="dialog"><p id="battle-msg">${session.pausedAt ? "Paused. The wild Pokémon is waiting." : `Stay on task. Every minute wears ${esc(p.n)} down.`}</p></div>
          <div class="row center">
            <button class="btn primary" data-f="pause">${session.pausedAt ? "Resume" : "Pause"}</button>
            <button class="btn ghost" data-f="run">Run away</button>
          </div>
        </section>`;
      }
      const preset = Number(route.params.get("id"));
      const target = BY_ID.get(preset) || encounterFor(todayKey());
      const history = state.focusLog.slice(-8).reverse();
      const totalMin = state.focusLog.filter((e) => e.result === "caught").reduce((s, e) => s + e.minutes, 0);
      return `
      <section class="focus-setup">
        <div class="panel">
          <h1>Focus encounter</h1>
          <p class="lead">Pick a length and start. Stay with your task until the timer ends and the Pokémon is caught. Leave early and it runs away.</p>
          <div class="target">
            <img class="sprite-lg" src="${sprite(target.id)}" alt="${esc(target.n)}" id="target-img">
            <div><p class="eyebrow">Target</p><p class="big-name" id="target-name">${esc(target.n)}</p>
              <div class="row"><button class="btn ghost sm" data-f="random">Random wild</button><button class="btn ghost sm" data-f="pick">Choose</button></div></div>
          </div>
          <fieldset class="durations"><legend>Length</legend>
            ${[15, 25, 45, 60].map((m) => `<label><input type="radio" name="mins" value="${m}" ${m === 25 ? "checked" : ""}><span>${m} min</span></label>`).join("")}
          </fieldset>
          <label class="check"><input type="checkbox" id="notify" ${window.Notification && Notification.permission === "granted" ? "checked" : ""}><span>Notify me when it ends (browser notification)</span></label>
          <button class="btn primary wide" data-f="start" data-id="${target.id}">Start focus</button>
        </div>
        <div class="panel">
          <h3>Focus log</h3>
          <p class="muted">${totalMin} minutes focused in total.</p>
          ${history.length
            ? `<ul class="log">${history.map((e) => `<li><img src="${sprite(e.id)}" alt=""><span>${e.d}</span><span>${e.minutes} min</span><b class="${e.result}">${e.result === "caught" ? "Caught" : "Fled"}</b></li>`).join("")}</ul>`
            : `<p class="muted">Your sessions will show up here.</p>`}
        </div>
      </section>`;
    },
    mount(view) {
      view.addEventListener("click", (event) => {
        const button = event.target.closest("[data-f]");
        if (!button) return;
        const action = button.dataset.f;
        if (action === "start") {
          const minutes = Number(($("input[name=mins]:checked", view) || {}).value || 25);
          const id = Number($("[data-f=start]", view).dataset.id);
          const wantNotify = $("#notify", view).checked;
          if (wantNotify && window.Notification && Notification.permission === "default") Notification.requestPermission();
          state.focus = { id, minutes, start: Date.now(), pausedAt: null, pausedTotal: 0 };
          save();
          sfx.select();
          render();
        } else if (action === "pause") {
          const session = state.focus;
          if (session.pausedAt) {
            session.pausedTotal += Date.now() - session.pausedAt;
            session.pausedAt = null;
          } else {
            session.pausedAt = Date.now();
          }
          save();
          render();
        } else if (action === "run") {
          if (confirm("Run away? The Pokémon will flee and this session will not count.")) finishFocus(false);
        } else if (action === "random" || action === "pick") {
          const setTarget = (id) => {
            const p = BY_ID.get(id);
            $("#target-img", view).src = sprite(id);
            $("#target-img", view).alt = p.n;
            $("#target-name", view).textContent = p.n;
            $("[data-f=start]", view).dataset.id = id;
          };
          if (action === "random") {
            const pool = DEX.filter((p) => !p.leg && !isCaught(p.id));
            setTarget((pool[Math.floor(Math.random() * pool.length)] || DEX[0]).id);
            sfx.blip();
          } else {
            pickerModal("Choose a target", setTarget);
          }
        }
      });
    },
  };

  setInterval(() => {
    const session = state.focus;
    if (!session) return;
    const remain = focusRemaining(session);
    if (!session.pausedAt) document.title = `${fmt(remain)} - PocketDex`;
    if (remain <= 0 && !session.pausedAt) {
      finishFocus(true);
      return;
    }
    const timer = $("#timer");
    if (timer) {
      timer.textContent = fmt(remain);
      $("#hp").style.width = `${(remain / (session.minutes * 60000)) * 100}%`;
    }
  }, 500);

  // ---- Habits
  VIEWS.habits = {
    html() {
      const key = todayKey();
      const days = [...Array(7)].map((_, i) => dayOffset(key, i - 6));
      const rows = state.habits
        .map((h) => {
          const cells = days
            .map((d) => {
              const done = (state.habitLog[d] || {})[h.id];
              const label = new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
              return `<span class="day ${done ? "done" : ""} ${d === key ? "today" : ""}" title="${d}">${label}</span>`;
            })
            .join("");
          const doneToday = (state.habitLog[key] || {})[h.id];
          return `<li class="habit">
            <label class="check"><input type="checkbox" data-habit="${h.id}" ${doneToday ? "checked" : ""}><span>${esc(h.name)}</span></label>
            ${typeChip(h.type)}
            <span class="streak">${streakLabel(habitStreak(h.id))}</span>
            <span class="week" aria-label="Last 7 days">${cells}</span>
            <button class="icon-btn" data-del="${h.id}" aria-label="Delete ${esc(h.name)}">Delete</button>
          </li>`;
        })
        .join("");
      const partner = state.partner ? BY_ID.get(state.partner.id) : null;
      const level = partner ? levelFor(state.partner.xp) : 0;
      const lo = xpForLevel(level);
      const hi = xpForLevel(level + 1);
      const pct = partner ? Math.round(((state.partner.xp - lo) / (hi - lo)) * 100) : 0;
      const starters = [1, 4, 7, 25, 133, 152, 155, 158, 252, 255, 258];
      return `
      <div class="habits-grid">
        <section class="panel">
          <h1>Training</h1>
          <p class="lead">Each habit you tick gives your partner ${XP.habit} XP. Each focus minute gives ${XP.focusMinute} XP.</p>
          <ul class="habit-list">${rows || `<li class="muted">No habits yet.</li>`}</ul>
          <form class="add-habit" id="add-habit">
            <input class="field-input" name="name" placeholder="New habit, for example: Stretch 5 minutes" maxlength="60" required>
            <select class="field-input" name="type" aria-label="Habit type">${TYPES.map((t) => `<option value="${t}">${cap(t)}</option>`).join("")}</select>
            <button class="btn primary" type="submit">Add habit</button>
          </form>
        </section>
        <section class="panel">
          <h3>Partner Pokémon</h3>
          ${partner
            ? `<div class="partner-big lcd"><img class="sprite-xl bob" src="${sprite(partner.id)}" alt="${esc(partner.n)}"></div>
               <p class="big-name">${esc(state.partner.nick || partner.n)} <span class="muted">Lv ${level}</span></p>
               <div class="xpbar"><u style="width:${pct}%"></u></div>
               <p class="muted">${hi - state.partner.xp} XP to Lv ${level + 1}. ${CHILDREN.get(partner.id) ? `Evolves at Lv ${evolutionStage(partner.id) === 1 ? 16 : 32}.` : "Final form."}</p>
               <div class="row"><button class="btn ghost sm" data-p="nick">Nickname</button><button class="btn ghost sm" data-p="change">Change partner</button></div>`
            : `<p>Choose a partner to train with. Starters are listed, or pick any Pokémon you have caught.</p>
               <div class="starter-grid">${starters.map((id) => `<button class="starter" data-partner="${id}"><img src="${sprite(id)}" alt=""><span>${esc(BY_ID.get(id).n)}</span></button>`).join("")}</div>
               <button class="btn ghost" data-p="change">Pick from caught</button>`}
        </section>
      </div>`;
    },
    mount(view) {
      view.addEventListener("change", (event) => {
        const box = event.target.closest("[data-habit]");
        if (box) {
          toggleHabit(box.dataset.habit, box.checked);
          render();
        }
      });
      $("#add-habit", view).addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.target;
        const name = form.name.value.trim();
        if (!name) return;
        state.habits.push({ id: "h" + Date.now().toString(36), name, type: form.type.value });
        save();
        sfx.select();
        render();
      });
      view.addEventListener("click", (event) => {
        const del = event.target.closest("[data-del]");
        if (del) {
          const habit = state.habits.find((h) => h.id === del.dataset.del);
          if (habit && confirm(`Delete "${habit.name}"? Its history is kept in backups only.`)) {
            state.habits = state.habits.filter((h) => h.id !== habit.id);
            save();
            render();
          }
          return;
        }
        const starter = event.target.closest("[data-partner]");
        if (starter) {
          setPartner(Number(starter.dataset.partner));
          return;
        }
        const action = event.target.closest("[data-p]");
        if (!action) return;
        if (action.dataset.p === "nick") {
          const nick = prompt("Nickname (leave empty to reset)", state.partner.nick || "");
          if (nick !== null) {
            state.partner.nick = nick.trim().slice(0, 12);
            save();
            render();
          }
        } else {
          const caughtIds = Object.keys(state.caught).map(Number);
          if (!caughtIds.length) {
            toast("Catch a Pokémon first, or choose a starter.");
            return;
          }
          pickerModal("Choose a partner", setPartner, (p) => isCaught(p.id));
        }
      });
    },
  };

  function setPartner(id) {
    const keepXp = state.partner ? state.partner.xp : 125;
    state.partner = { id, xp: keepXp, nick: "" };
    catchPokemon(id, "partner");
    save();
    sfx.cry(id);
    toast(`${BY_ID.get(id).n} is now your partner.`);
    render();
  }

  // ---- Field Dex (make your own entries from photos)
  const PALETTES = {
    dmg: { name: "Game Boy", colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] },
    pocket: { name: "Pocket", colors: ["#1e1e1e", "#555753", "#a3a59e", "#e3e5dc"] },
    kanto: { name: "Kanto red", colors: ["#3a0b0f", "#a3121f", "#e8836f", "#f7efe2"] },
    color: { name: "Color", colors: null },
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function pixelate(img, paletteKey, dither, size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - side) / 2;
    const sy = ((img.naturalHeight || img.height) - side) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size);
    const px = data.data;
    const palette = PALETTES[paletteKey].colors;
    let lo = 255;
    let hi = 0;
    const lum = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      lum[i] = l;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const threshold = dither ? (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) : 0;
      if (palette) {
        const norm = (lum[i] - lo) / range;
        const level = Math.max(0, Math.min(3, Math.round(norm * 3 + threshold * 0.9)));
        const [r, g, b] = hexToRgb(palette[level]);
        px[i * 4] = r;
        px[i * 4 + 1] = g;
        px[i * 4 + 2] = b;
      } else {
        for (let c = 0; c < 3; c++) {
          const v = px[i * 4 + c] / 255;
          px[i * 4 + c] = Math.max(0, Math.min(3, Math.round(v * 3 + threshold * 0.9))) * 85;
        }
      }
      px[i * 4 + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL("image/png");
  }

  const fieldDraft = { src: null, img: null, palette: "dmg", dither: true, pixel: null };

  VIEWS.field = {
    html(route) {
      if (route.arg === "new") {
        return `
        <section class="panel field-new">
          <a class="text-link back" href="#/field">${ICON.left}Field Dex</a>
          <h1>New Field Dex entry</h1>
          <p class="lead">Photograph something from your day: your cat, a houseplant, your coffee mug. PocketDex turns it into a 4-shade sprite and files it like a real Pokédex entry.</p>
          <div class="field-new-grid">
            <div>
              <div class="lcd field-preview" id="fd-preview"><p class="muted">No photo yet</p></div>
              <label class="btn wide file-btn">Take or choose a photo<input type="file" accept="image/*" capture="environment" id="fd-file"></label>
              <fieldset class="palette-pick"><legend>Palette</legend>
                ${Object.entries(PALETTES).map(([key, pal]) => `<label><input type="radio" name="pal" value="${key}" ${fieldDraft.palette === key ? "checked" : ""}><span>${pal.colors ? pal.colors.map((c) => `<i style="background:${c}"></i>`).join("") : '<i class="rainbow"></i>'}${pal.name}</span></label>`).join("")}
              </fieldset>
              <label class="check"><input type="checkbox" id="fd-dither" ${fieldDraft.dither ? "checked" : ""}><span>Dither (classic shading)</span></label>
            </div>
            <form id="fd-form" class="fd-form">
              <label>Name<input class="field-input" name="name" maxlength="24" required placeholder="Mochi"></label>
              <label>Category<input class="field-input" name="genus" maxlength="24" placeholder="Sleepy Cat"></label>
              <div class="two"><label>Type<select class="field-input" name="t1">${TYPES.map((t) => `<option value="${t}">${cap(t)}</option>`).join("")}</select></label>
              <label>Second type<select class="field-input" name="t2"><option value="">None</option>${TYPES.map((t) => `<option value="${t}">${cap(t)}</option>`).join("")}</select></label></div>
              <div class="two"><label>Height (m)<input class="field-input" name="h" type="number" step="0.01" min="0" placeholder="0.3"></label>
              <label>Weight (kg)<input class="field-input" name="w" type="number" step="0.1" min="0" placeholder="4.2"></label></div>
              <label>Found at<input class="field-input" name="place" maxlength="40" placeholder="Living room sofa"></label>
              <label>Entry<textarea class="field-input" name="desc" rows="3" maxlength="220" placeholder="It naps in sunbeams and wakes only for snacks."></textarea></label>
              <button class="btn primary wide" type="submit">Register entry</button>
            </form>
          </div>
        </section>`;
      }
      const entry = route.arg ? state.field.find((e) => e.id === route.arg) : null;
      if (entry) {
        return `
        <section class="panel field-entry">
          <a class="text-link back" href="#/field">${ICON.left}Field Dex</a>
          <div class="detail-top">
            <div class="lcd detail-screen"><img class="sprite-xl" src="${entry.img}" alt="${esc(entry.name)}"></div>
            <div class="detail-id">
              <p class="eyebrow">No.F${num(entry.no)} &middot; registered ${entry.d}</p>
              <h2>${esc(entry.name)}</h2>
              <p class="genus">${esc(entry.genus || "Unknown")} Pokémon</p>
              <div class="chips">${entry.types.map(typeChip).join("")}</div>
              <dl class="facts">
                <div><dt>Height</dt><dd>${entry.h ? esc(entry.h) + " m" : "?"}</dd></div>
                <div><dt>Weight</dt><dd>${entry.w ? esc(entry.w) + " kg" : "?"}</dd></div>
                <div><dt>Found at</dt><dd>${esc(entry.place || "?")}</dd></div>
              </dl>
            </div>
          </div>
          <div class="dialog entry-text"><p>${esc(entry.desc || "No entry written yet.")}</p></div>
          <div class="row"><button class="btn primary" data-fd="card">Save as card image</button><button class="btn ghost" data-fd="delete">Delete entry</button></div>
        </section>`;
      }
      return `
      <section class="field-head">
        <div><h1>Field Dex</h1><p class="lead">Your own Pokédex of real life. Snap anything, give it a type and an entry, and keep a pixel catalogue of your days.</p></div>
        <a class="btn primary" href="#/field/new">New entry</a>
      </section>
      ${state.field.length
        ? `<div class="field-grid">${state.field.slice().reverse().map((e) => `<a class="field-card" href="#/field/${e.id}"><span class="no">F${num(e.no)}</span><img src="${e.img}" alt=""><b>${esc(e.name)}</b><span class="chips">${e.types.map(typeChip).join("")}</span></a>`).join("")}</div>`
        : `<div class="panel empty-state"><div class="lcd"><p>NO DATA</p></div><p>No entries yet. Start with something close by, like a plant on your desk.</p><a class="btn" href="#/field/new">Create the first entry</a></div>`}`;
    },
    mount(view, route) {
      if (route.arg === "new") {
        const preview = $("#fd-preview", view);
        const refresh = () => {
          if (!fieldDraft.img) return;
          fieldDraft.pixel = pixelate(fieldDraft.img, fieldDraft.palette, fieldDraft.dither, 64);
          preview.innerHTML = `<img class="sprite-xl" src="${fieldDraft.pixel}" alt="Pixel preview">`;
        };
        if (fieldDraft.img) refresh();
        $("#fd-file", view).addEventListener("change", (event) => {
          const file = event.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              fieldDraft.img = img;
              refresh();
              sfx.blip();
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        });
        $all("input[name=pal]", view).forEach((radio) => radio.addEventListener("change", () => {
          fieldDraft.palette = radio.value;
          refresh();
        }));
        $("#fd-dither", view).addEventListener("change", (event) => {
          fieldDraft.dither = event.target.checked;
          refresh();
        });
        $("#fd-form", view).addEventListener("submit", (event) => {
          event.preventDefault();
          if (!fieldDraft.pixel) {
            toast("Add a photo first.");
            return;
          }
          const form = event.target;
          const no = state.field.reduce((m, e) => Math.max(m, e.no), 0) + 1;
          const types = [form.t1.value, form.t2.value].filter((t, i, arr) => t && arr.indexOf(t) === i);
          const entry = {
            id: "f" + Date.now().toString(36),
            no,
            name: form.name.value.trim(),
            genus: form.genus.value.trim(),
            types,
            h: form.h.value,
            w: form.w.value,
            place: form.place.value.trim(),
            desc: form.desc.value.trim(),
            img: fieldDraft.pixel,
            d: todayKey(),
          };
          state.field.push(entry);
          fieldDraft.img = null;
          fieldDraft.pixel = null;
          save();
          sfx.catch();
          toast(`${entry.name} was registered as No.F${num(no)}.`);
          checkBadges();
          go(`#/field/${entry.id}`);
        });
        return;
      }
      const entry = route.arg ? state.field.find((e) => e.id === route.arg) : null;
      if (!entry) return;
      view.addEventListener("click", (event) => {
        const button = event.target.closest("[data-fd]");
        if (!button) return;
        if (button.dataset.fd === "delete") {
          if (confirm(`Delete ${entry.name}?`)) {
            state.field = state.field.filter((e) => e.id !== entry.id);
            save();
            go("#/field");
          }
        } else {
          exportCard(entry);
        }
      });
    },
  };

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    words.forEach((word) => {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    });
    if (line) ctx.fillText(line, x, y);
  }

  async function exportCard(entry) {
    try {
      await document.fonts.ready;
    } catch (error) { /* fonts optional */ }
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 840;
    const ctx = canvas.getContext("2d");
    const serif = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
    const sans = "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    ctx.fillStyle = "#f6f2eb";
    ctx.fillRect(0, 0, 600, 840);
    ctx.shadowColor = "rgba(60,45,25,0.12)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ffffff";
    roundRect(32, 32, 536, 776, 28);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#f0ebe2";
    roundRect(64, 132, 472, 300, 22);
    ctx.fill();
    ctx.fillStyle = "#c0432f";
    ctx.font = `600 15px ${sans}`;
    ctx.fillText(`FIELD DEX  No.F${num(entry.no)}`, 64, 82);
    ctx.fillStyle = "#26221d";
    ctx.font = `600 40px ${serif}`;
    ctx.fillText(entry.name, 64, 118);
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = entry.img;
    });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 172, 154, 256, 256);
    ctx.fillStyle = "#6b6157";
    ctx.font = `400 17px ${sans}`;
    ctx.fillText(`${entry.genus || "Unknown"} Pokémon`, 64, 470);
    const rows = [
      ["Type", entry.types.map(cap).join(" / ")],
      ["Height", entry.h ? entry.h + " m" : "?"],
      ["Weight", entry.w ? entry.w + " kg" : "?"],
      ["Found at", entry.place || "?"],
    ];
    rows.forEach(([label, value], index) => {
      const y = 516 + index * 34;
      ctx.fillStyle = "#6b6157";
      ctx.font = `400 16px ${sans}`;
      ctx.fillText(label, 64, y);
      ctx.fillStyle = "#26221d";
      ctx.font = `600 16px ${sans}`;
      ctx.fillText(value, 200, y);
    });
    ctx.fillStyle = "#26221d";
    ctx.font = `italic 400 18px ${serif}`;
    wrapText(ctx, entry.desc || "No entry written yet.", 64, 680, 472, 28);
    ctx.fillStyle = "#6b6157";
    ctx.font = `400 13px ${sans}`;
    ctx.fillText(`Registered ${entry.d} with PocketDex`, 64, 780);
    const link = document.createElement("a");
    link.download = `pocketdex-F${num(entry.no)}-${entry.name.replace(/\W+/g, "-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("Card image saved to your downloads.");
  }

  // ---- Quiz
  const quiz = { round: null, gen: "" };

  function newRound() {
    const pool = DEX.filter((p) => !quiz.gen || p.gen === Number(quiz.gen));
    const answer = pool[Math.floor(Math.random() * pool.length)];
    const options = new Set([answer.id]);
    while (options.size < 4 && options.size < pool.length) options.add(pool[Math.floor(Math.random() * pool.length)].id);
    quiz.round = { answer: answer.id, options: [...options].sort(() => Math.random() - 0.5), picked: null };
  }

  VIEWS.quiz = {
    html() {
      if (!quiz.round) newRound();
      const round = quiz.round;
      const answer = BY_ID.get(round.answer);
      const revealed = round.picked !== null;
      const correct = revealed && round.picked === round.answer;
      return `
      <section class="quiz">
        <div class="quiz-head"><h1>Who's that Pokémon?</h1>
          <select class="field-input" id="quiz-gen" aria-label="Region">
            <option value="">All regions</option>${GENS.map((g) => `<option value="${g}" ${String(quiz.gen) === String(g) ? "selected" : ""}>Gen ${g} ${GEN_NAMES[g]}</option>`).join("")}
          </select></div>
        <div class="lcd quiz-screen"><img class="sprite-xl ${revealed ? "" : "silhouette"}" src="${sprite(answer.id)}" alt="${revealed ? esc(answer.n) : "Mystery Pokémon silhouette"}"></div>
        <div class="dialog" aria-live="polite"><p>${revealed ? (correct ? `Correct! It's ${esc(answer.n)}.` : `It's ${esc(answer.n)}!`) : "Pick the right name. Keys 1 to 4 work too."}</p></div>
        <div class="quiz-options">
          ${round.options.map((id, i) => {
            const p = BY_ID.get(id);
            const cls = revealed ? (id === round.answer ? "right" : id === round.picked ? "wrong" : "") : "";
            return `<button class="btn option ${cls}" data-opt="${id}" ${revealed ? "disabled" : ""}><span class="key">${i + 1}</span>${esc(p.n)}</button>`;
          }).join("")}
        </div>
        <div class="row center">
          ${revealed ? `<button class="btn primary" data-q="next">Next (Enter)</button><a class="btn ghost" href="#/dex/${answer.id}">Open entry</a>` : ""}
        </div>
        <p class="quiz-score">Streak <b>${state.quiz.streak}</b> &middot; Best <b>${state.quiz.best}</b> &middot; ${state.quiz.correct} / ${state.quiz.answered} correct</p>
      </section>`;
    },
    mount(view) {
      $("#quiz-gen", view).addEventListener("change", (event) => {
        quiz.gen = event.target.value;
        newRound();
        render();
      });
      view.addEventListener("click", (event) => {
        const option = event.target.closest("[data-opt]");
        if (option) answerQuiz(Number(option.dataset.opt));
        if (event.target.closest("[data-q=next]")) {
          newRound();
          render();
        }
      });
    },
  };

  function answerQuiz(id) {
    const round = quiz.round;
    if (!round || round.picked !== null) return;
    round.picked = id;
    state.quiz.answered += 1;
    if (id === round.answer) {
      state.quiz.correct += 1;
      state.quiz.streak += 1;
      state.quiz.best = Math.max(state.quiz.best, state.quiz.streak);
      sfx.select();
      sfx.cry(round.answer);
    } else {
      state.quiz.streak = 0;
      sfx.wrong();
    }
    markSeen(round.answer);
    save();
    checkBadges();
    render();
  }

  // ---- Team
  VIEWS.team = {
    html() {
      const team = state.team.map((id) => BY_ID.get(id)).filter(Boolean);
      const slots = [...Array(6)]
        .map((_, i) => {
          const p = team[i];
          if (!p) return `<button class="slot empty" data-t="add"><span>+ Add</span></button>`;
          return `<div class="slot"><img src="${sprite(p.id)}" alt=""><b>${esc(p.n)}</b><span class="chips">${p.t.map(typeChip).join("")}</span><button class="icon-btn" data-remove="${p.id}" aria-label="Remove ${esc(p.n)}">Remove</button></div>`;
        })
        .join("");
      let analysis = `<p class="muted">Add Pokémon to see which types your team handles well and where it is exposed.</p>`;
      if (team.length) {
        const rows = TYPES.map((attack) => {
          const factors = team.map((p) => multiplier(attack, p.t));
          const weak = factors.filter((f) => f > 1).length;
          const resist = factors.filter((f) => f < 1).length;
          const flag = weak >= 3 && resist === 0 ? "danger" : weak > resist ? "warn" : "";
          return `<tr class="${flag}"><td>${typeChip(attack)}</td>${factors.map((f) => `<td class="m m${String(f).replace(".", "")}">${f === 1 ? "" : f === 0.5 ? "\u00bd" : f === 0.25 ? "\u00bc" : f + "x"}</td>`).join("")}<td>${weak}</td><td>${resist}</td></tr>`;
        }).join("");
        const offense = new Set();
        team.forEach((p) => p.t.forEach((t) => TYPES.forEach((target) => {
          if (multiplier(t, [target]) > 1) offense.add(target);
        })));
        const gaps = TYPES.filter((t) => !offense.has(t));
        const dangers = TYPES.filter((attack) => {
          const factors = team.map((p) => multiplier(attack, p.t));
          return factors.filter((f) => f > 1).length >= 3 && !factors.some((f) => f < 1);
        });
        analysis = `
          <div class="summary">
            <p><b>Super effective coverage (same-type moves):</b> ${offense.size} of 18 types.</p>
            ${gaps.length ? `<p><b>No super effective answer to:</b></p><div class="chips">${gaps.map(typeChip).join("")}</div>` : "<p>Your types hit every type super effectively.</p>"}
            ${dangers.length ? `<p class="mt"><b>Shared weakness (3+ weak, no resist):</b></p><div class="chips">${dangers.map(typeChip).join("")}</div>` : `<p class="mt">No shared weakness across 3 or more members.</p>`}
          </div>
          <div class="table-wrap"><table class="matchup"><thead><tr><th>Attack</th>${team.map((p) => `<th><img src="${sprite(p.id)}" alt="${esc(p.n)}" title="${esc(p.n)}"></th>`).join("")}<th>Weak</th><th>Resist</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      return `
      <section class="panel">
        <div class="field-head"><div><h1>Team builder</h1><p class="lead">Six slots. PocketDex checks defensive weak spots and offensive coverage from real type data.</p></div></div>
        <div class="slots">${slots}</div>
      </section>
      <section class="panel"><h3>Team analysis</h3>${analysis}</section>
      <section class="panel"><h3>Type calculator</h3>
        <p class="muted">Choose one or two defending types to see what hits them hard.</p>
        <div class="calc"><select class="field-input" id="calc1">${TYPES.map((t) => `<option ${t === "water" ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="field-input" id="calc2"><option value="">None</option>${TYPES.map((t) => `<option ${t === "ground" ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div id="calc-out"></div>
      </section>`;
    },
    mount(view) {
      const calc = () => {
        const types = [$("#calc1", view).value, $("#calc2", view).value].filter((t, i, arr) => t && arr.indexOf(t) === i);
        $("#calc-out", view).innerHTML = weaknessBlock(types);
      };
      $("#calc1", view).addEventListener("change", calc);
      $("#calc2", view).addEventListener("change", calc);
      calc();
      view.addEventListener("click", (event) => {
        if (event.target.closest("[data-t=add]")) {
          pickerModal("Add to team", (id) => {
            if (!state.team.includes(id) && state.team.length < 6) {
              state.team.push(id);
              save();
              checkBadges();
              sfx.select();
              render();
            }
          });
        }
        const remove = event.target.closest("[data-remove]");
        if (remove) {
          state.team = state.team.filter((id) => id !== Number(remove.dataset.remove));
          save();
          render();
        }
      });
    },
  };

  // ---- Trainer card
  VIEWS.trainer = {
    html() {
      state.badges = state.badges || {};
      const seen = Object.keys(state.seen).length;
      const focusSessions = state.focusLog.filter((e) => e.result === "caught").length;
      const focusMinutes = state.focusLog.filter((e) => e.result === "caught").reduce((s, e) => s + e.minutes, 0);
      const byGen = GENS.map((g) => {
        const all = DEX.filter((p) => p.gen === g);
        const got = all.filter((p) => isCaught(p.id)).length;
        return `<div class="gen-row"><span>${GEN_NAMES[g]}</span><i><u style="width:${(got / all.length) * 100}%"></u></i><b>${got}/${all.length}</b></div>`;
      }).join("");
      return `
      <div class="trainer-grid">
        <section class="panel trainer-card">
          <p class="eyebrow">Trainer card</p>
          <h1><span id="trainer-name">${esc(state.trainer)}</span> <button class="btn ghost sm" data-tr="rename">Rename</button></h1>
          <dl class="facts">
            <div><dt>Started</dt><dd>${state.started}</dd></div>
            <div><dt>Pokédex</dt><dd>${caughtCount()} caught, ${seen} seen</dd></div>
            <div><dt>Focus</dt><dd>${focusSessions} sessions, ${focusMinutes} min</dd></div>
            <div><dt>Streak</dt><dd>${streakFrom(activeDays())} days</dd></div>
            <div><dt>Field Dex</dt><dd>${state.field.length} entries</dd></div>
            <div><dt>Quiz best</dt><dd>${state.quiz.best}</dd></div>
          </dl>
          <h3>Badges</h3>
          <div class="badges">${BADGES.map((b) => `<div class="badge ${state.badges[b.id] ? "earned" : ""}" title="${esc(b.rule)}">${badgeSvg(b, Boolean(state.badges[b.id]))}<b>${b.name}</b><span>${state.badges[b.id] ? state.badges[b.id] : esc(b.rule)}</span></div>`).join("")}</div>
        </section>
        <section class="panel">
          <h3>Progress by region</h3>
          <div class="gens">${byGen}</div>
          <h3 class="mt">Settings and data</h3>
          <label class="check"><input type="checkbox" id="set-sound" ${state.settings.sound ? "checked" : ""}><span>Chiptune sound effects</span></label>
          <p class="muted">Everything is saved in this browser only. Export a backup to move it to another device.</p>
          <div class="row">
            <button class="btn" data-tr="export">Export backup</button>
            <label class="btn ghost file-btn">Import backup<input type="file" accept="application/json" id="import-file"></label>
            <button class="btn ghost danger" data-tr="reset">Reset all</button>
          </div>
          <h3 class="mt">Keyboard</h3>
          <ul class="keys-help"><li><kbd>/</kbd> search the Pokédex</li><li><kbd>&larr;</kbd> <kbd>&rarr;</kbd> previous or next entry</li><li><kbd>1</kbd>-<kbd>4</kbd> answer the quiz, <kbd>Enter</kbd> next</li><li><kbd>Esc</kbd> close a dialog</li></ul>
          <p class="muted small">Pokémon data and sprites come from the open PokeAPI project. Pokémon is a trademark of Nintendo, Game Freak and Creatures. PocketDex is an unofficial fan tool.</p>
        </section>
      </div>`;
    },
    mount(view) {
      $("#set-sound", view).addEventListener("change", (event) => {
        state.settings.sound = event.target.checked;
        save();
        updateHeader();
      });
      $("#import-file", view).addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (!file) return;
        file.text().then((text) => {
          try {
            const data = JSON.parse(text);
            if (!data || typeof data !== "object" || !("caught" in data)) throw new Error("bad file");
            state = Object.assign(DEFAULT_STATE(), data);
            save();
            toast("Backup restored.");
            render();
          } catch (error) {
            toast("That file is not a PocketDex backup.");
          }
        });
      });
      view.addEventListener("click", (event) => {
        const button = event.target.closest("[data-tr]");
        if (!button) return;
        const action = button.dataset.tr;
        if (action === "rename") {
          const name = prompt("Trainer name", state.trainer);
          if (name && name.trim()) {
            state.trainer = name.trim().slice(0, 16);
            save();
            render();
          }
        } else if (action === "export") {
          const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = `pocketdex-backup-${todayKey()}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 2000);
        } else if (action === "reset") {
          if (confirm("Erase all PocketDex data on this device? Export a backup first if you want to keep it.")) {
            state = DEFAULT_STATE();
            save();
            render();
          }
        }
      });
    },
  };

  // ---------------------------------------------------------------- global events
  document.addEventListener("keydown", (event) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((event.target.tagName || "")) && event.target.type !== "checkbox" && event.target.type !== "radio";
    if (event.key === "Escape" && !$("#modal").hidden) {
      $("#modal").hidden = true;
      $("#modal").innerHTML = "";
      return;
    }
    if (typing || !$("#modal").hidden) return;
    const route = currentRoute || parseRoute();
    if (event.key === "/") {
      event.preventDefault();
      if (route.name !== "dex") go("#/dex");
      setTimeout(() => {
        const input = $("#dex-q");
        if (input) input.focus();
      }, 0);
    } else if (route.name === "dex" && route.arg && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const idx = DEX.findIndex((p) => p.id === Number(route.arg));
      const next = DEX[idx + (event.key === "ArrowRight" ? 1 : -1)];
      if (next) {
        sfx.blip();
        go(`#/dex/${next.id}`);
      }
    } else if (route.name === "quiz") {
      if (/^[1-4]$/.test(event.key) && quiz.round && quiz.round.picked === null) {
        const id = quiz.round.options[Number(event.key) - 1];
        if (id) answerQuiz(id);
      } else if (event.key === "Enter" && quiz.round && quiz.round.picked !== null) {
        newRound();
        render();
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("a, button") && !event.target.closest("[data-silent]")) sfx.blip();
  });

  document.addEventListener("error", (event) => {
    const img = event.target;
    if (img && img.tagName === "IMG" && !img.dataset.fallback) {
      img.dataset.fallback = "1";
      img.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path d="M5 3h6v1h1v2h1v4h-1v2h-1v1H5v-1H4v-2H3V6h1V4h1z" fill="#30623088"/></svg>');
    }
  }, true);

  $("#sound-toggle").addEventListener("click", () => {
    state.settings.sound = !state.settings.sound;
    save();
    updateHeader();
  });

  window.addEventListener("hashchange", () => {
    // a message belongs to the page that raised it; do not carry it onto the next page
    $("#toast").hidden = true;
    render();
  });
  $("#toast").addEventListener("click", () => {
    $("#toast").hidden = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.focus && focusRemaining(state.focus) <= 0 && !state.focus.pausedAt) finishFocus(true);
  });

  // Expose a tiny hook for automated checks.
  window.PocketDex = { state: () => state, encounterFor, defenseProfile, levelFor, pixelate, TOTAL };

  checkBadges();
  render();
})();
