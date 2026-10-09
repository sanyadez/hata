// The terminal page, shown in a frame by the UI: a window into a shell that lives on the server.
// `?app=<name>&container=<name>` opens a shell inside a container; without them — the server's own.
// The emulator is xterm.js (vendor/, third-party code).
(async () => {
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const COARSE = matchMedia("(pointer: coarse)").matches;
  /** The largest input message: a paste may be bigger than the server takes at once */
  const INPUT_CHUNK = 32 * 1024;
  /** Keys a screen keyboard does not have: label → what to send (or a modifier) */
  const KEYS = [["Esc", "\x1b"], ["Tab", "\t"], ["Ctrl", "ctrl"], ["Alt", "alt"], ["←", "D"], ["↓", "B"], ["↑", "A"], ["→", "C"], ["|", "|"], ["/", "/"], ["-", "-"], ["~", "~"]];

  const lang = params.get("lang") || "en";
  const load = (code) => fetch(`/lang/${code}.json`).then((r) => (r.ok ? r.json() : {}), () => ({}));
  const [fallback, dict] = await Promise.all([load("en"), lang === "en" ? {} : load(lang)]);
  const t = (key, vars = {}) => String(dict[key] ?? fallback[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
  document.documentElement.lang = lang;

  /** idle | connecting | live | lost | exited | failed */
  let state = "idle";
  let ws = null;
  let fails = 0;
  let timer = 0;
  /** "New shell" was asked for: connect again as soon as the old one is gone */
  let restart = false;
  /** Which terminal of the server this is: told by its `ready` */
  let key = "host";
  /** Sticky Ctrl and Alt of the key row: they apply to the next key */
  const sticky = { ctrl: false, alt: false };

  const setState = (next, text = "") => {
    state = next;
    $("status").textContent = text || (["live", "connecting", "lost"].includes(next) ? t("terminal.state." + next) : "");
    $("status").className = "term-status " + (next === "live" ? "live" : next === "lost" || next === "failed" ? "bad" : "");
  };
  /** The line above the terminal: why it does not work and, when there is something to do, a button */
  const setNote = (text, label, action) => {
    $("note").hidden = !text;
    $("note-text").textContent = text || "";
    $("note-btn").hidden = !label;
    $("note-btn").textContent = label || "";
    $("note-btn").onclick = action || null;
  };

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    fontFamily: 'ui-monospace, "Cascadia Mono", "JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace',
    fontSize: COARSE ? 12 : 13,
    theme: { background: color("--console"), foreground: "#d9d2c9", cursor: color("--accent"), cursorAccent: color("--console"), selectionBackground: "#f5a52459" },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($("box"));

  const send = (bytes) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    for (let at = 0; at < bytes.length; at += INPUT_CHUNK) ws.send(bytes.subarray(at, at + INPUT_CHUNK));
  };
  const paintKeys = () => {
    for (const button of $("keys").children) button.classList.toggle("on", sticky[KEYS[button.dataset.i][1]] === true);
  };
  /** Input from the keyboard or the key row, with the sticky Ctrl and Alt applied */
  const input = (data) => {
    if (state === "exited") {
      if (data === "\r") connect();
      return;
    }
    if (sticky.ctrl && data.length === 1) {
      const code = data.toUpperCase().charCodeAt(0);
      // Ctrl with a letter or one of @[\]^_ is a control code 0–31, Ctrl+? is 127
      if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31);
      else if (data === "?") data = "\x7f";
      else if (data === " ") data = "\0";
    }
    if (sticky.alt) data = "\x1b" + data;
    if (sticky.ctrl || sticky.alt) {
      sticky.ctrl = sticky.alt = false;
      paintKeys();
    }
    send(new TextEncoder().encode(data));
  };
  term.onData(input);
  // mouse reports come as a "binary string", a byte per character
  term.onBinary((data) => send(Uint8Array.from(data, (ch) => ch.charCodeAt(0))));
  term.onResize(({ cols, rows }) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "resize", cols, rows })));

  const refit = () => {
    if (!$("box").clientHeight) return;
    try {
      fit.fit();
    } catch {
      // not laid out yet
    }
  };
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refit);
  }).observe($("box"));
  // a screen keyboard changes the visible height: the terminal counts its rows again
  window.visualViewport?.addEventListener("resize", () => requestAnimationFrame(refit));

  if (COARSE) {
    $("keys").hidden = false;
    KEYS.forEach(([label], i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.dataset.i = i;
      button.textContent = label;
      $("keys").append(button);
    });
    // a press does not take the focus from the terminal: the screen keyboard stays where it is
    $("keys").addEventListener("mousedown", (e) => e.preventDefault());
    $("keys").addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button) return;
      const [label, what] = KEYS[button.dataset.i];
      if (what === "ctrl" || what === "alt") {
        sticky[what] = !sticky[what];
        return paintKeys();
      }
      // arrows: full-screen programs (vim, less) switch the terminal to other codes
      if ("←↓↑→".includes(label)) input((term.modes.applicationCursorKeysMode ? "\x1bO" : "\x1b[") + what);
      else input(what);
    });
  }

  function connect() {
    clearTimeout(timer);
    if (ws) return;
    refit();
    const url = new URL("/api/terminal/ws", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    for (const name of ["app", "container"]) if (params.get(name)) url.searchParams.set(name, params.get(name));
    url.searchParams.set("cols", term.cols);
    url.searchParams.set("rows", term.rows);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws = socket;
    // the server itself said why the connection is closing
    let ended = false;
    if (state !== "lost") setState("connecting");
    socket.onmessage = (e) => {
      if (ws !== socket) return;
      if (typeof e.data !== "string") return term.write(new Uint8Array(e.data));
      let message;
      try {
        message = JSON.parse(e.data);
      } catch {
        return;
      }
      if (message.type === "ready") {
        // the server is about to send the tail of the output: what is shown would be there twice
        term.reset();
        key = message.key;
        fails = 0;
        setState("live");
        setNote("");
        // a shell that was already running may have another size (it was opened elsewhere)
        if (message.cols !== term.cols || message.rows !== term.rows) socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        if (!COARSE) term.focus();
      } else if (message.type === "exit") {
        ended = true;
        setState("exited");
        if (!restart) setNote(t("terminal.exited", { code: message.code }), t("terminal.startAgain"), connect);
      } else if (message.type === "error") {
        ended = true;
        setState("failed");
        setNote(message.code && (dict[message.code] ?? fallback[message.code]) ? t(message.code) : message.message, t("terminal.retry"), connect);
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (restart) {
        restart = false;
        return connect();
      }
      if (ended) return;
      // the server refused before the connection was made (signed out, the container stopped): a
      // WebSocket does not say why — ask, and stop trying after a few attempts
      if (state !== "live" && state !== "lost" && ++fails >= 3) return void refused();
      setState("lost");
      // a page in the background (a phone) connects when it is back on the screen
      if (document.visibilityState === "visible") timer = setTimeout(connect, 1500);
    };
  }

  /** Why the server does not let us in: the same request without the upgrade gets a plain answer */
  async function refused() {
    setState("failed");
    const url = new URL("/api/terminal/ws", location.href);
    for (const name of ["app", "container"]) if (params.get(name)) url.searchParams.set(name, params.get(name));
    const res = await fetch(url).catch(() => null);
    const error = res && !res.ok ? (await res.json().catch(() => null))?.error : null;
    setNote(error?.code && (dict["error." + error.code] ?? fallback["error." + error.code]) ? t("error." + error.code, error.detail) : t("terminal.failed"), t("terminal.retry"), () => {
      fails = 0;
      connect();
    });
  }

  $("restart").textContent = t("terminal.newShell");
  $("restart").addEventListener("click", async () => {
    if (!ws) {
      fails = 0;
      return connect();
    }
    if (state === "live" && !confirm(t("terminal.confirmNew"))) return;
    restart = true;
    try {
      const res = await fetch("/api/terminal?key=" + encodeURIComponent(key), { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      restart = false;
    }
  });

  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && !ws && state === "lost" && connect());
  connect();
})();
