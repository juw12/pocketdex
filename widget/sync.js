/* juw12 widget sync
 *
 * Sends a small status snapshot (counts, names, timer end times) to a private relay topic, so the
 * iPhone home-screen widget can show PocketDex, Haru and Cozy Island together.
 *
 * - Does nothing until a widget code is paired in this browser (see widget/index.html).
 * - Relay: ntfy.sh, which keeps messages for about 12 hours. Anyone who has the code can read them,
 *   so no diary text, photos or place names are ever put in a snapshot.
 * - Never throws: a failure here must not break the app that calls it.
 */
(function () {
  "use strict";
  if (window.Juw12Widget) return;

  const RELAY = "https://ntfy.sh";
  const CODE_KEY = "juw12.widget.code";
  const LAST_PREFIX = "juw12.widget.last.";
  const BACKOFF_KEY = "juw12.widget.backoff";
  const CODE_PATTERN = /^jw-[0-9a-f]{32}$/;
  const APP_PATTERN = /^[a-z]{2,12}$/;

  const NORMAL_GAP_MS = 5 * 60 * 1000; // ordinary changes: at most one message per app in 5 minutes
  const URGENT_GAP_MS = 15 * 1000; // timers starting or stopping: at most one in 15 seconds
  const SETTLE_MS = 1500; // lets a burst of saves collapse into one message
  const RESEND_AFTER_MS = 6 * 60 * 60 * 1000; // the relay forgets after ~12 h, so repeat an unchanged snapshot
  const BACKOFF_MS = 15 * 60 * 1000; // after the relay says "too many requests"
  const RETRY_MS = 60 * 1000; // after a network failure
  const MAX_BYTES = 3500; // the relay rejects messages over 4096 bytes

  const pending = {}; // app -> { body, urgent }
  const timers = {}; // app -> { id, due }

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) {
      /* private mode: pairing just does not persist */
    }
  }

  function code() {
    const value = read(CODE_KEY) || "";
    return CODE_PATTERN.test(value) ? value : "";
  }

  function forgetSent() {
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.indexOf(LAST_PREFIX) === 0)
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (error) {
      /* nothing to forget */
    }
  }

  function announce() {
    try {
      window.dispatchEvent(new CustomEvent("juw12-widget-code", { detail: { paired: Boolean(code()) } }));
    } catch (error) {
      /* old browser without CustomEvent */
    }
  }

  /** Pair this browser. An empty value unpairs. Returns false when the code is not valid. */
  function setCode(value) {
    const next = String(value || "").trim().toLowerCase();
    if (next && !CODE_PATTERN.test(next)) return false;
    if (next === code()) return true;
    Object.keys(timers).forEach(clearTimer);
    Object.keys(pending).forEach((app) => delete pending[app]);
    forgetSent();
    write(CODE_KEY, next || null);
    announce();
    return true;
  }

  function newCode() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return "jw-" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function lastSent(app) {
    try {
      const value = JSON.parse(read(LAST_PREFIX + app) || "null");
      return value && value.code === code() ? value : null;
    } catch (error) {
      return null;
    }
  }

  function backoffUntil() {
    return Number(read(BACKOFF_KEY)) || 0;
  }

  function clearTimer(app) {
    if (timers[app]) {
      window.clearTimeout(timers[app].id);
      delete timers[app];
    }
  }

  function schedule(app, due) {
    if (timers[app] && timers[app].due <= due) return;
    clearTimer(app);
    const wait = Math.max(0, due - Date.now());
    timers[app] = { due, id: window.setTimeout(() => send(app, false), wait) };
  }

  function byteLength(value) {
    try {
      return new TextEncoder().encode(value).length;
    } catch (error) {
      return value.length * 3;
    }
  }

  function send(app, leaving) {
    clearTimer(app);
    const item = pending[app];
    const topic = code();
    if (!item || !topic) return;
    const now = Date.now();
    if (now < backoffUntil()) {
      if (!leaving) schedule(app, backoffUntil());
      return;
    }
    delete pending[app];
    const message = '{"v":1,"app":"' + app + '","at":' + now + ',"d":' + item.body + "}";
    if (byteLength(message) > MAX_BYTES) return;
    const retry = () => {
      if (!pending[app]) pending[app] = item;
      if (!leaving) schedule(app, Date.now() + RETRY_MS);
    };
    try {
      window
        .fetch(RELAY + "/" + topic, { method: "POST", body: message, keepalive: true, cache: "no-store", credentials: "omit" })
        .then((response) => {
          if (response.ok) {
            write(LAST_PREFIX + app, JSON.stringify({ code: topic, at: now, body: item.body }));
            return;
          }
          if (response.status === 429) write(BACKOFF_KEY, String(Date.now() + BACKOFF_MS));
          retry();
        })
        .catch(retry);
    } catch (error) {
      retry();
    }
  }

  /**
   * Queue a snapshot for one app ("pocketdex", "haru" or "cozy"). Cheap to call on every save:
   * an unchanged snapshot is dropped, and changes are rate limited. Use { urgent: true } when a
   * timer starts, pauses or ends so the widget countdown follows within seconds.
   */
  function publish(app, snapshot, options) {
    try {
      if (!code() || !APP_PATTERN.test(app) || !snapshot || typeof snapshot !== "object") return false;
      const body = JSON.stringify(snapshot);
      const last = lastSent(app);
      const now = Date.now();
      if (last && last.body === body && now - last.at < RESEND_AFTER_MS) {
        delete pending[app];
        clearTimer(app);
        return false;
      }
      const urgent = Boolean(options && options.urgent) || Boolean(pending[app] && pending[app].urgent);
      pending[app] = { body, urgent };
      const gap = urgent ? URGENT_GAP_MS : NORMAL_GAP_MS;
      schedule(app, Math.max(now + SETTLE_MS, (last ? last.at : 0) + gap, backoffUntil()));
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Send whatever is waiting. Used when the page is hidden or closed, so the widget is not left behind. */
  function flush() {
    const now = Date.now();
    Object.keys(pending).forEach((app) => {
      const last = lastSent(app);
      if (!last || now - last.at >= URGENT_GAP_MS) send(app, true);
    });
  }

  function adoptCodeFromUrl() {
    try {
      const url = new URL(window.location.href);
      const value = url.searchParams.get("widget");
      if (value === null) return;
      setCode(value);
      url.searchParams.delete("widget");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch (error) {
      /* file: pages and old browsers keep the address as it is */
    }
  }

  adoptCodeFromUrl();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);

  window.Juw12Widget = {
    RELAY,
    SETUP_URL: "https://juw12.github.io/pocketdex/widget/",
    code,
    setCode,
    newCode,
    isCode: (value) => CODE_PATTERN.test(String(value || "")),
    publish,
    flush,
  };
})();
