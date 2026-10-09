// Hata web UI. No build step and no framework: the DOM is built with h() below, which only ever sets
// text and attributes — store content (titles, descriptions) never reaches the page as markup.

// --- Small tools --------------------------------------------------------------------------------

const $app = document.getElementById("app");
const $toasts = document.getElementById("toasts");

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key in el && key !== "list" && key !== "form") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === false || child == null) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Line icons on a 24×24 grid, drawn for this UI.
const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  cpu: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  memory: "M3 8h18v8H3zM7 16v3M12 16v3M17 16v3M7 11v2M12 11v2M17 11v2",
  disk: "M4 13h16v6H4zM4 13l3-8h10l3 8M8 16h.01M12 16h.01",
  network: "M8 4v14M8 18l-3-3M8 18l3-3M16 20V6M16 6l-3 3M16 6l3 3",
  temp: "M12 3a2 2 0 0 0-2 2v9.5a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z",
  plus: "M12 5v14M5 12h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 5v3h3M4 13a8 8 0 0 0 14.9 3M20 19v-3h-3",
  stop: "M6 6h12v12H6z",
  play: "M7 5l12 7-12 7z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  logs: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  check: "M5 12l5 5 9-10",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  x: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  up: "M12 19V5M6 11l6-6 6 6",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  folder: "M3 6h6l2 2h10v11H3z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  signin: "M14 4h5v16h-5M4 12h11M11 8l4 4-4 4",
  signout: "M10 4H5v16h5M20 12H9M16 8l4 4-4 4",
  chevron: "M9 6l6 6-6 6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  terminal: "M5 8l4 4-4 4M12 16h7",
  store: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  undo: "M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  file: "M6 3h9l4 4v14H6zM14 3v5h5",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  film: "M4 5h16v14H4zM10 9l5 3-5 3z",
  music: "M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  pin: "M12 17v5M8 3h8l-1 6 3 4H6l3-4z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

const SVG_NS = "http://www.w3.org/2000/svg";
function icon(name, className = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ico " + className);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.box);
  svg.append(path);
  return svg;
}

let dict = {};
let fallbackDict = {};

const has = (key) => key in dict || key in fallbackDict;
function t(key, vars = {}) {
  const text = dict[key] ?? fallbackDict[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : ""));
}

class ApiError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail ?? {};
  }
}

function errorText(e) {
  if (!(e instanceof ApiError)) return t("error.network");
  const key = "error." + e.code;
  return has(key) ? t(key, e.detail).trim() : e.detail.message || e.code;
}

async function api(method, path, data) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: data === undefined ? {} : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, payload.error?.code ?? "request.failed", payload.error?.detail);
    // the session ended (expired or the server was reinstalled): back to the sign-in screen
    if (res.status === 401 && err.code === "auth.required" && state.user) {
      state.user = null;
      stopEvents();
      render();
    }
    throw err;
  }
  return payload;
}

function toast(text, kind = "info") {
  const el = h("div", { class: "toast " + kind }, text);
  $toasts.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 7000 : 3500);
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
function bytes(n) {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)) + " " + UNITS[i];
}

/** A number and its unit apart, for the big figures of the status strip */
function bytesParts(n) {
  const [value, unit] = bytes(n).split(" ");
  return { value, unit };
}

function duration(seconds) {
  const d = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return d ? t("time.days", { n: d }) : hrs ? t("time.hours", { n: hrs }) + " " + t("time.minutes", { n: min }) : t("time.minutes", { n: min });
}

function ago(ts) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return t("time.now");
  if (seconds < 3600) return t("time.ago", { time: t("time.minutes", { n: Math.floor(seconds / 60) }) });
  if (seconds < 86400) return t("time.ago", { time: t("time.hours", { n: Math.floor(seconds / 3600) }) });
  return new Date(ts).toLocaleDateString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Opens a modal dialog; it is removed from the page when closed */
function openDialog(className, ...content) {
  const dialog = h("dialog", { class: className }, ...content);
  dialog.addEventListener("close", () => dialog.remove());
  // a click on the backdrop (the dialog element itself, outside its content box) closes it — a press
  // that began inside and was let go outside (selecting text, a slip of the hand) is not such a click
  // the dialog's own padding is the dialog element too, so "outside" is told by where the pointer is
  const outside = (e) => {
    const box = dialog.getBoundingClientRect();
    return e.target === dialog && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom);
  };
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (e) => (pressedOutside = outside(e)));
  dialog.addEventListener("click", (e) => {
    if (pressedOutside && outside(e)) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** Replaces what an element holds; like h(), it takes arrays and skips what is false or missing */
const put = (el, ...children) => el.replaceChildren(...h("div", null, children).childNodes);

const button = (label, attrs = {}, iconName) => h("button", { type: "button", ...attrs, class: "btn " + (attrs.class ?? "") }, iconName && icon(iconName), label && h("span", null, label));
const closeButton = (dialog, label = t("common.close")) => button(label, { onclick: () => dialog().close() });
const closeX = (dialog) => h("button", { type: "button", class: "icon-btn", "aria-label": t("common.close"), onclick: () => dialog().close() }, icon("x"));

// --- The look: colours and the background picture chosen in the settings -------------------------

/** How light a `#rrggbb` colour is to the eye, 0–1 */
function lightness(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const wallpaperUrl = (look, name = look.wallpaper) => (name === "custom" ? `/api/wallpaper?v=${look.stamp}` : name ? `/wallpapers/${name}.svg` : "");

function applyAppearance(look) {
  const root = document.documentElement;
  const set = (name, value) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
  set("--accent", look?.accent);
  // text on the accent colour is dark or white, whichever reads
  set("--on-accent", look?.accent && (lightness(look.accent) > 0.4 ? "#1a1206" : "#ffffff"));
  root.toggleAttribute("data-accent", !!look?.accent);
  set("--bg", look?.background);
  // a colour of the user's decides between the light and the dark set; without one the system does
  root.style.colorScheme = look?.background ? (lightness(look.background) > 0.35 ? "light" : "dark") : "";
  root.toggleAttribute("data-bg", !!look?.background);
  const picture = look ? wallpaperUrl(look) : "";
  set("--wallpaper", picture && `url("${picture}")`);
  set("--wallpaper-dim", picture && look.dim + "%");
  root.classList.toggle("has-wallpaper", !!picture);
}

// --- State --------------------------------------------------------------------------------------

const state = {
  version: "",
  setup: false,
  user: null,
  lang: "en",
  languages: ["en"],
  /** Passkeys can be used on this address (the domain, over HTTPS) and in this browser */
  passkeys: false,
  route: { view: "home" },
  overview: null,
  store: null,
  storeFilter: { query: "", category: "" },
  settings: null,
  account: null,
  users: null,
  invites: null,
  access: null,
  signIns: null,
  backups: null,
  files: null,
  import: null,
  update: null,
  app: null,
};

async function loadLanguage(lang) {
  const get = (code) => fetch(`/lang/${code}.json`).then((r) => (r.ok ? r.json() : {}), () => ({}));
  fallbackDict = Object.keys(fallbackDict).length ? fallbackDict : await get("en");
  dict = lang === "en" ? fallbackDict : await get(lang);
  state.lang = lang;
  document.documentElement.lang = lang;
}

function pickLanguage(server) {
  const saved = localStorage.getItem("hata.lang");
  const browser = (navigator.language || "").slice(0, 2).toLowerCase();
  return [saved, browser, server.language, "en"].find((l) => l && server.languages.includes(l));
}

// --- Routes -------------------------------------------------------------------------------------
// The address after `#` is the view: #/ · #/store · #/import · #/files/<folders> · #/apps/<name>/<tab> · #/settings/<section>

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "store" && state.user?.role !== "guest") return { view: "store" };
  // "#/files" is the data root, wherever it is; "#/files/" is the root of the server
  if (parts[0] === "files" && isAdmin()) return { view: "files", path: /^#\/?files$/.test(location.hash) ? "" : "/" + parts.slice(1).join("/") };
  if (parts[0] === "backups" && isAdmin()) return { view: "backups" };
  if (parts[0] === "users" && isAdmin()) return { view: "users" };
  if (parts[0] === "import" && isAdmin()) return { view: "import" };
  if (parts[0] === "terminal" && isAdmin()) return { view: "terminal" };
  if (parts[0] === "apps" && parts[1]) return { view: "app", name: parts[1], tab: isAdmin() && ["logs", "compose", "backups", "terminal"].includes(parts[2]) ? parts[2] : "overview" };
  if (parts[0] === "settings") return { view: "settings", section: sections().some((item) => item.id === parts[1]) ? parts[1] : "account" };
  return { view: "home" };
}

function go(hash) {
  if (location.hash === hash) onRoute();
  else location.hash = hash;
}

/** The address a protected app sent the visitor from, if it is on this server */
function nextAddress() {
  const next = new URLSearchParams(location.search).get("next");
  try {
    const url = new URL(next);
    // an app's own address under our domain, or another port of this host
    const ours = url.hostname === location.hostname || url.hostname.endsWith("." + location.hostname);
    return ours && /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// read once: the sign-in form tidies the address bar before the visitor is let in
const NEXT = nextAddress();

function onRoute() {
  if (/^#(setup|invite)=/.test(location.hash)) return;
  leaveView();
  state.route = parseRoute();
  render();
  if (!state.user) return;
  if (state.route.view === "store") void loadStore();
  if (state.route.view === "settings") void loadSettings();
  if (state.route.view === "files") void loadFiles();
  if (state.route.view === "backups") void loadBackups();
  if (state.route.view === "users") void loadUsers();
  if (state.route.view === "import") void loadImport();
  if (state.route.view === "app") void loadApp();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", onRoute);

/** Things a view started that must not outlive it: log streams, stats polling */
let cleanups = [];
function leaveView() {
  for (const stop of cleanups) stop();
  cleanups = [];
}

// --- Live events --------------------------------------------------------------------------------

let source = null;
let appsTimer = null;
const jobListeners = new Set();

function startEvents() {
  if (source) return;
  source = new EventSource("/api/events");
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "system" && state.overview) {
      state.overview.system = event.system;
      renderSystem();
    } else if (event.type === "apps" || event.type === "activity") {
      clearTimeout(appsTimer);
      appsTimer = setTimeout(refresh, 150);
    } else if (event.type === "job") {
      for (const listener of jobListeners) listener(event);
    } else if (event.type === "store" && state.route.view === "store") {
      void loadStore();
    }
  };
  // after a reconnect anything may have changed while we were away
  source.onopen = () => void refresh();
}

function stopEvents() {
  source?.close();
  source = null;
}

/** Reloads what the current view shows about apps */
async function refresh() {
  if (!state.user) return;
  try {
    state.overview = await api("GET", `/api/overview?lang=${state.lang}`);
  } catch {
    return;
  }
  if (state.route.view === "home") renderHomeBody();
  if (state.route.view === "store") renderStoreList();
  if (state.route.view === "app") void loadApp(true);
  if (state.route.view === "backups") void loadBackups();
  if (state.route.view === "import") void loadImport();
}

// --- Sign-in and setup --------------------------------------------------------------------------

// --- Passkeys: bytes travel as base64url ----------------------------------------------------------

const toB64url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
/** The browser's own refusals (cancelled, timed out, no such key) are not errors to show as ours */
const passkeyCancelled = (e) => e instanceof DOMException && ["NotAllowedError", "AbortError"].includes(e.name);

async function passkeySignIn() {
  const begin = await api("POST", "/api/login/passkey/begin", {});
  const cred = await navigator.credentials.get({ publicKey: { challenge: fromB64url(begin.challenge), rpId: begin.rpId, userVerification: "required", timeout: 120000 } });
  const r = cred.response;
  return api("POST", "/api/login/passkey", { id: toB64url(cred.rawId), clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature) });
}

async function passkeyCreate(password, name) {
  const begin = await api("POST", "/api/account/passkeys/begin", { password });
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64url(begin.challenge),
      rp: { id: begin.rpId, name: "Hata" },
      user: { id: new TextEncoder().encode(begin.user.id), name: begin.user.name, displayName: begin.user.name },
      pubKeyCredParams: begin.algorithms.map((alg) => ({ type: "public-key", alg })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: begin.exclude.map((id) => ({ type: "public-key", id: fromB64url(id) })),
      attestation: "none",
      timeout: 120000,
    },
  });
  const r = cred.response;
  const publicKey = r.getPublicKey?.();
  if (!publicKey) throw new ApiError(400, "passkey.rejected");
  await api("POST", "/api/account/passkeys", { name, clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.getAuthenticatorData()), publicKey: toB64url(publicKey), alg: r.getPublicKeyAlgorithm() });
}

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "label" }, label), input, hint && h("span", { class: "hint" }, hint));
}

async function inviteScreen(token) {
  let invite = null;
  try {
    invite = await api("GET", `/api/invite?token=${token}`);
  } catch {}
  if (!invite) {
    return $app.replaceChildren(h("main", { class: "center" }, h("div", { class: "auth card" }, h("div", { class: "brand big" }, h("img", { src: "/logo.svg", alt: "" }), "hata"), h("h1", null, t("invite.invalidTitle")), h("p", { class: "muted" }, t("invite.invalid")), h("a", { class: "btn wide", href: "/" }, t("auth.signIn")))));
  }
  const name = h("input", { name: "name", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: false });
  const password = h("input", { name: "password", type: "password", autocomplete: "new-password", required: true, minLength: 8 });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "btn primary wide" }, t("invite.join"));
  $app.replaceChildren(
    h(
      "main",
      { class: "center" },
      h(
        "form",
        {
          class: "auth card",
          onsubmit: async (e) => {
            e.preventDefault();
            submit.disabled = true;
            error.textContent = "";
            try {
              const res = await api("POST", "/api/invite", { token, name: name.value.trim(), password: password.value });
              history.replaceState(null, "", location.pathname);
              state.user = res.user;
              await enter();
            } catch (err) {
              error.textContent = errorText(err);
              submit.disabled = false;
            }
          },
        },
        h("div", { class: "brand big" }, h("img", { src: "/logo.svg", alt: "" }), "hata"),
        h("h1", null, t("invite.title")),
        h("p", { class: "muted" }, t("invite.lead", { role: t("user.role." + invite.role) })),
        field(t("auth.name"), name),
        field(t("auth.password"), password, t("auth.passwordHint")),
        error,
        submit,
      ),
    ),
  );
  name.focus();
}

function authScreen() {
  const invite = /^#invite=([0-9a-f]+)$/.exec(location.hash)?.[1];
  if (invite && !state.setup) return void inviteScreen(invite);
  const setup = state.setup;
  const tokenFromLink = /^#setup=([0-9a-f]+)$/.exec(location.hash)?.[1] ?? "";
  const token = h("input", { name: "token", value: tokenFromLink, autocomplete: "off", required: true, spellcheck: false });
  const name = h("input", { name: "name", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: false });
  const password = h("input", { name: "password", type: "password", autocomplete: setup ? "new-password" : "current-password", required: true, minLength: setup ? 8 : 1 });
  const code = h("input", { name: "code", inputMode: "numeric", autocomplete: "one-time-code", spellcheck: false, class: "mono" });
  const codeField = field(t("auth.code"), code, t("auth.codeHint"));
  codeField.hidden = true;
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "btn primary wide" }, t(setup ? "setup.create" : "auth.signIn"));

  const form = h(
    "form",
    {
      class: "auth card",
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          const data = { name: name.value.trim(), password: password.value };
          const res = setup ? await api("POST", "/api/setup", { ...data, token: token.value.trim() }) : await api("POST", "/api/login", codeField.hidden ? data : { ...data, code: code.value.trim() });
          history.replaceState(null, "", location.pathname + (setup ? "" : location.hash));
          state.user = res.user;
          state.setup = false;
          await enter();
        } catch (err) {
          submit.disabled = false;
          // the password was right and the account has two-factor sign-in: ask for the code
          if (err instanceof ApiError && err.code === "auth.codeRequired") {
            codeField.hidden = false;
            code.required = true;
            code.focus();
            return;
          }
          error.textContent = errorText(err);
        }
      },
    },
    h("div", { class: "brand big" }, h("img", { src: "/logo.svg", alt: "" }), "hata"),
    h("h1", null, t(setup ? "setup.title" : "auth.title")),
    setup && h("p", { class: "muted" }, t("setup.lead")),
    !setup && NEXT && h("p", { class: "muted" }, t("auth.nextLead", { address: new URL(NEXT).host })),
    setup && !tokenFromLink && field(t("setup.token"), token, t("setup.tokenHint")),
    field(t("auth.name"), name),
    field(t("auth.password"), password, setup && t("auth.passwordHint")),
    codeField,
    error,
    submit,
    !setup &&
      state.passkeys &&
      button(t("passkey.signIn"), {
        class: "wide",
        onclick: async () => {
          error.textContent = "";
          try {
            const res = await passkeySignIn();
            history.replaceState(null, "", location.pathname + location.hash);
            state.user = res.user;
            await enter();
          } catch (err) {
            if (!passkeyCancelled(err)) error.textContent = errorText(err);
          }
        },
      }, "lock"),
  );
  $app.replaceChildren(h("main", { class: "center" }, form));
  (setup && !tokenFromLink ? token : name).focus();
}

// --- Shell --------------------------------------------------------------------------------------

const NAV = [
  { view: "home", hash: "#/", icon: "home" },
  { view: "store", hash: "#/store", icon: "grid", guest: false },
  { view: "files", hash: "#/files", icon: "folder", admin: true },
  { view: "backups", hash: "#/backups", icon: "archive", admin: true },
  { view: "users", hash: "#/users", icon: "user", admin: true },
  { view: "settings", hash: "#/settings", icon: "sliders" },
];

/** Members look at the apps; everything that changes the server is an administrator's */
const isAdmin = () => state.user?.role === "admin";

function navLinks(className) {
  const current = state.route.view === "app" ? "home" : state.route.view === "import" ? "store" : state.route.view;
  return NAV.filter((item) => (!item.admin || isAdmin()) && (item.guest !== false || state.user.role !== "guest")).map((item) =>
    h("a", { class: className + (current === item.view ? " active" : ""), href: item.hash, "aria-current": current === item.view ? "page" : null }, icon(item.icon), h("span", null, t("nav." + item.view))),
  );
}

async function signOut() {
  await api("POST", "/api/logout", {}).catch(() => {});
  state.user = null;
  stopEvents();
  leaveView();
  render();
}

function userMenu(e) {
  let dialog;
  const anchor = e.currentTarget.getBoundingClientRect();
  dialog = openDialog(
    "menu dropdown",
    h("header", null, h("span", { class: "avatar" }, state.user.name.slice(0, 1).toUpperCase()), h("div", null, h("h2", null, state.user.name), h("span", { class: "muted small" }, t("user.role." + state.user.role)))),
    h("a", { class: "menu-item", href: "#/settings/account", onclick: () => dialog.close() }, icon("user"), t("settings.account")),
    h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), signOut()) }, icon("signout"), t("nav.signOut")),
  );  // it hangs under the button it was opened from, by its right edge
  dialog.style.top = anchor.bottom + 8 + "px";
  dialog.style.right = Math.max(8, document.documentElement.clientWidth - anchor.right) + "px";
}

/** The search field of the header: installed apps first, then the store */
function globalSearch() {
  const results = h("div", { class: "search-results", hidden: true });
  const input = h("input", { type: "search", placeholder: t("search.placeholder"), "aria-label": t("search.placeholder"), autocomplete: "off", spellcheck: false });
  let hits = [];
  const openHit = (hit) => {
    input.value = "";
    results.hidden = true;
    input.blur();
    if (hit.installed) go(`#/apps/${hit.name}`);
    else {
      go("#/store");
      void storeDialog(hit);
    }
  };
  const update = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return void (results.hidden = true);
    if (!state.store && state.user.role !== "guest") state.store = await api("GET", `/api/store?lang=${state.lang}`).catch(() => null);
    const match = (a) => `${a.title} ${a.name}`.toLowerCase().includes(q);
    const installed = (state.overview?.apps ?? []).filter(match).map((a) => ({ ...a, installed: true }));
    const names = new Set(installed.map((a) => a.name));
    hits = [...installed, ...(state.store?.apps ?? []).filter((a) => match(a) && !names.has(a.name))].slice(0, 7);
    results.replaceChildren(
      ...(hits.length
        ? hits.map((hit) => h("button", { type: "button", class: "search-hit", onmousedown: (e) => (e.preventDefault(), openHit(hit)) }, appIcon(hit, "sm"), h("span", { class: "grow" }, hit.title), h("span", { class: "muted small" }, t(hit.installed ? "search.installed" : "search.store"))))
        : [h("p", { class: "muted small pad" }, t("store.nothing"))]),
    );
    results.hidden = false;
  };
  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => (results.hidden = true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && hits[0]) openHit(hits[0]);
    if (e.key === "Escape") input.blur();
  });
  return h("div", { class: "search" }, icon("search"), input, h("kbd", null, "/"), results);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.querySelector("dialog[open]")) return;
  const input = document.querySelector(".top .search input");
  if (input) {
    e.preventDefault();
    input.focus();
  }
});

function shell(...content) {
  $app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("a", { class: "brand", href: "#/" }, h("img", { src: "/logo.svg", alt: "" }), "hata"),
      h("nav", { class: "nav" }, navLinks("nav-link")),
      h("div", { class: "top-right" }, globalSearch(), isAdmin() && h("a", { class: "icon-btn top-tool" + (state.route.view === "terminal" ? " active" : ""), href: "#/terminal", title: t("terminal.title"), "aria-label": t("terminal.title") }, icon("terminal")), h("button", { type: "button", class: "user", onclick: userMenu }, h("span", { class: "avatar" }, state.user.name.slice(0, 1).toUpperCase()), h("span", { class: "user-name" }, state.user.name))),
    ),
    h("main", { id: "view" }, content),
    h("nav", { class: "bottom-bar" }, navLinks("bottom-link")),
  );
}

function render() {
  if (state.setup || !state.user) return authScreen();
  const view = state.route.view;
  if (view === "store") return renderStore();
  if (view === "settings") return renderSettings();
  if (view === "files") return renderFiles();
  if (view === "backups") return renderBackups();
  if (view === "users") return renderUsers();
  if (view === "import") return renderImport();
  if (view === "terminal") return renderTerminal();
  if (view === "app") return renderApp();
  renderHome();
}

// --- Apps: shared pieces ------------------------------------------------------------------------

const TILE_COLORS = ["#7B5CD6", "#3B82C4", "#1D8FD1", "#2FA7C4", "#C44A3F", "#4B63B8", "#4E8A9B", "#3F9B6B", "#C4862A", "#B8612F"];

function appIcon(app, size = "") {
  const title = app.title || app.name || "?";
  let hash = 0;
  for (const ch of app.name ?? title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const letter = h("span", { class: `app-icon letter ${size}` }, title.slice(0, 1).toUpperCase());
  letter.style.background = TILE_COLORS[hash % TILE_COLORS.length];
  if (!app.icon) return letter;
  return h("img", { class: `app-icon ${size}`, src: app.icon, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onerror: (e) => e.target.replaceWith(letter) });
}

/** The app's own name under the domain, when Hata itself is opened by that domain; otherwise null */
function appDomain(app) {
  const domain = state.overview?.site?.domain;
  return domain && location.hostname === domain && !app.hostname ? `${app.name.replace(/_/g, "-")}.${domain}` : null;
}

function appUrl(app) {
  if (!app.port) return null;
  const host = appDomain(app);
  if (host) return `${location.protocol}//${host}${app.index}`;
  return `${app.scheme}://${app.hostname || location.hostname}:${app.port}${app.index}`;
}

/** What the tile shows under the name: where the app answers */
function appAddress(app) {
  return app.port ? (appDomain(app) ?? `${app.hostname || location.hostname}:${app.port}`) : "";
}

const isUp = (app) => app.status === "running" || app.status === "partial";
const appState = (app) => (app.job ? "busy" : app.containers?.some((c) => c.state === "restarting") ? "restarting" : app.status);
const stateChip = (app) => h("span", { class: "state " + appState(app) }, t("status." + appState(app)));

// --- Home ---------------------------------------------------------------------------------------

function sparkline(values, max) {
  const top = max ?? Math.max(1, ...values);
  const bars = values.slice(-28).map((v, i, list) => {
    const bar = h("i", { class: i === list.length - 1 ? "last" : "" });
    bar.style.height = Math.max(6, Math.round((v / top) * 100)) + "%";
    return bar;
  });
  return h("div", { class: "spark", "aria-hidden": "true" }, bars);
}

function statCell(id, iconName, label) {
  return h(
    "div",
    { class: "stat", id: "stat-" + id },
    h("div", { class: "stat-label" }, icon(iconName), label),
    h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, "—"), h("span", { class: "unit" })), h("div", { class: "stat-chart" })),
    h("div", { class: "stat-hint" }, " "),
  );
}

function setStat(id, value, unit, hint, chart, level = "") {
  const el = document.getElementById("stat-" + id);
  if (!el) return;
  const strong = el.querySelector("strong");
  strong.textContent = value;
  strong.className = level;
  el.querySelector(".unit").textContent = unit;
  el.querySelector(".stat-hint").textContent = hint || " ";
  el.querySelector(".stat-chart").replaceChildren(chart ?? "");
}

const level = (percent) => (percent >= 95 ? "danger" : percent >= 85 ? "warn" : "");

function renderSystem() {
  const s = state.overview?.system;
  if (!s || state.route.view !== "home") return;
  const meta = document.getElementById("host");
  if (meta) meta.replaceChildren(...[s.hostname, location.host, t("sys.uptime", { time: duration(s.uptime) }), "Hata " + state.version].flatMap((part, i) => (i ? [h("span", { class: "dot-sep" }, "·"), part] : [part])));

  setStat("cpu", s.cpu == null ? "—" : String(s.cpu), "%", t("sys.cores", { n: s.cores }) + " · " + t("sys.load", { load: s.load[0] }), sparkline(s.history.cpu, 100));
  const mem = s.memory;
  const memPercent = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
  const used = bytesParts(mem.used);
  setStat("memory", used.value, used.unit, t("sys.ofPercent", { total: bytes(mem.total), percent: memPercent }), sparkline(s.history.memory, 100), level(memPercent));
  const disk = s.disks[s.disks.length - 1];
  if (disk) {
    const percent = Math.round((disk.used / disk.total) * 100);
    const fill = h("i", { class: level(percent) });
    fill.style.width = percent + "%";
    setStat("disk", String(percent), "%", t("sys.free", { free: bytes(disk.total - disk.used), total: bytes(disk.total) }), h("div", { class: "bar" }, fill), level(percent));
    const label = document.querySelector("#stat-disk .stat-label");
    if (label) label.lastChild.textContent = `${t("sys.disk")} ${disk.path}`;
  }
  const net = s.net ? bytesParts(s.net.rx + s.net.tx) : null;
  setStat("network", net ? net.value : "—", net ? net.unit + "/s" : "", s.net ? `↓ ${bytes(s.net.rx)}/s · ↑ ${bytes(s.net.tx)}/s` : "", sparkline(s.history.net));
  const temp = document.getElementById("stat-temp");
  if (temp) temp.hidden = s.temperature == null;
  if (s.temperature != null) setStat("temp", String(s.temperature), "°C", t("sys.cpu"), null, s.temperature >= 85 ? "warn" : "");
}

// --- Dashboard: tiles, groups, folders of tiles -------------------------------------------------

/** `folder` — the open folder of tiles; `drag` — what is in the air; `widgets` — the blocks of the page */
const homeUi = { folder: null, drag: null, stale: false, widgets: null };

const tileKey = (item) => item.type + ":" + (item.type === "app" ? item.name : item.type === "files" ? item.path : item.id);
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const linkHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
/** A link without a picture of its own shows the site's icon */
const linkIcon = (link) => {
  if (link.icon) return link.icon;
  try {
    return new URL("/favicon.ico", link.url).href;
  } catch {
    return "";
  }
};

/** What a tile of the layout stands for: the app, the pinned folder; null when it is not there */
function tileTarget(item) {
  const o = state.overview;
  if (item.type === "app") return o.apps.find((app) => app.name === item.name) ?? null;
  if (item.type === "files") return (o.folders ?? []).find((folder) => folder.path === item.path) ?? null;
  return item;
}

const tileTitle = (item) => {
  const target = tileTarget(item);
  return item.type === "app" ? (target?.title ?? item.name) : item.type === "files" ? (target?.name ?? item.path) : item.title || (item.type === "folder" ? t("home.folder") : linkHost(item.url));
};

function tileIcon(item, size = "") {
  const target = tileTarget(item);
  if (item.type === "app") return appIcon(target ?? { name: item.name }, size);
  if (item.type === "link") return appIcon({ name: item.id, title: tileTitle(item), icon: linkIcon(item) }, size);
  if (item.type === "files") return h("span", { class: `app-icon plus ${size}` }, icon("folder"));
  return h("span", { class: "app-icon stack" }, item.items.filter(tileTarget).slice(0, 4).map((inner) => tileIcon(inner, "mini")));
}

function tile(item) {
  const target = tileTarget(item);
  if (!target) return null;
  const admin = isAdmin();
  const title = tileTitle(item);
  let cls = "";
  let href = null;
  let external = false;
  let sub;
  let side = null;
  let badges = null;
  if (item.type === "app") {
    const app = target;
    const st = (cls = appState(app));
    const url = isUp(app) ? appUrl(app) : null;
    // the tile opens the app; while it has no page to open, its own page here
    href = url ?? `#/apps/${app.name}`;
    external = !!url;
    sub = [h("i", { class: "dot " + st }), st === "running" && appAddress(app) ? appAddress(app) : t("status." + st)];
    badges = [app.protected && h("span", { class: "lock", title: t("access.protected") }, icon("lock")), app.update && isAdmin() && h("span", { class: "lock", title: t("app.storeUpdate") }, icon("up"))];
    side = h("a", { class: "tile-open", href: `#/apps/${app.name}`, title: t("home.manage"), "aria-label": `${t("home.manage")}: ${title}` }, icon("sliders"));
  } else if (item.type === "link") {
    href = item.url;
    external = true;
    sub = linkHost(item.url);
    side = isAdmin() && h("button", { type: "button", class: "tile-open", title: t("home.editLink"), "aria-label": `${t("home.editLink")}: ${title}`, onclick: () => linkDialog(item) }, icon("sliders"));
  } else if (item.type === "files") {
    cls = target.missing ? "stopped" : "";
    href = filesHash(item.path);
    sub = h("span", { class: "mono clip", title: item.path }, target.missing ? t("home.folderMissing") : item.path);
  } else {
    const shown = item.items.filter(tileTarget).length;
    if (!shown) return null;
    sub = t("home.items", { n: shown });
  }
  // what has no page of its own to manage it gets a menu: where to move it, how to take it off
  if (admin && !side) side = h("button", { type: "button", class: "tile-open", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${title}`, onclick: () => tileMenu(item) }, icon("more"));
  const content = [tileIcon(item), h("span", { class: "tile-text" }, h("span", { class: "tile-top" }, h("span", { class: "tile-name" }, title), badges), h("span", { class: "tile-sub" }, sub))];
  const key = tileKey(item);
  const main =
    item.type === "folder"
      ? h("button", { type: "button", class: "tile-main", onclick: () => homeUi.drag?.moved || openFolder(item.id) }, content)
      : h("a", { class: "tile-main", href, draggable: false, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, content);
  if (!admin) return h("div", { class: `tile kind-${item.type} ${cls}`, "data-key": key }, main, side);
  // an administrator moves tiles by dragging them; a long press of a finger is the start of that, not a menu
  return h("div", { class: `tile kind-${item.type} ${cls} movable`, "data-key": key, onpointerdown: (e) => dragStart(e, item), oncontextmenu: (e) => homeUi.drag?.active && e.preventDefault(), ondragstart: (e) => e.preventDefault() }, main, side);
}

// --- Changing the layout: every change is made on a copy, shown at once and sent to the server ----

const layoutCopy = () => structuredClone(state.overview.dashboard);
const allFolders = (layout) => layout.groups.flatMap((group) => group.items.filter((item) => item.type === "folder"));

/** Where a tile is: its list, its place in it, the group and (inside one) the folder */
function locate(layout, key) {
  for (const group of layout.groups) {
    for (const [index, item] of group.items.entries()) {
      if (tileKey(item) === key) return { list: group.items, index, group, folder: null, item };
      if (item.type !== "folder") continue;
      const inner = item.items.findIndex((entry) => tileKey(entry) === key);
      if (inner >= 0) return { list: item.items, index: inner, group, folder: item, item: item.items[inner] };
    }
  }
  return null;
}

/** Takes a tile out of the layout; a folder left with nothing goes with it */
function takeTile(layout, key) {
  const at = locate(layout, key);
  if (!at) return null;
  at.list.splice(at.index, 1);
  if (at.folder && !at.folder.items.length) at.group.items.splice(at.group.items.indexOf(at.folder), 1);
  return at.item;
}

async function saveLayout(layout) {
  state.overview.dashboard = layout;
  renderHomeBody();
  try {
    await api("PUT", "/api/dashboard", layout);
  } catch (e) {
    toast(errorText(e), "error");
    await refresh();
  }
}

/** Moves a tile next to another (`before` / `after` its key), or to the end of a group or a folder */
function moveTile(key, where) {
  const layout = layoutCopy();
  const item = takeTile(layout, key);
  if (!item) return;
  if (where.before || where.after) {
    const at = locate(layout, where.before ?? where.after);
    if (!at || (at.folder && item.type === "folder")) return;
    at.list.splice(at.index + (where.after ? 1 : 0), 0, item);
  } else if (where.folder) {
    const folder = allFolders(layout).find((f) => f.id === where.folder);
    if (!folder || item.type === "folder") return;
    folder.items.push(item);
  } else {
    const group = layout.groups.find((g) => g.id === where.group) ?? layout.groups[0];
    group.items.push(item);
  }
  return saveLayout(layout);
}

/** Two tiles become a folder where the second one was — what dropping one tile on another does; without a second, a folder of one */
function makeFolder(key, ontoKey, title = "") {
  const layout = layoutCopy();
  const own = locate(layout, key);
  if (!own || own.item.type === "folder") return;
  const folder = { type: "folder", id: newId(), title, items: [own.item] };
  if (!ontoKey) {
    if (own.folder) return;
    own.list[own.index] = folder;
    return saveLayout(layout);
  }
  takeTile(layout, key);
  const at = locate(layout, ontoKey);
  if (!at || at.folder || at.item.type === "folder") return;
  folder.items.unshift(at.item);
  at.list[at.index] = folder;
  return saveLayout(layout);
}

/** Takes a tile out of its folder and puts it right after the folder */
function outOfFolder(key) {
  const layout = layoutCopy();
  const at = locate(layout, key);
  if (!at?.folder) return;
  const after = at.group.items.indexOf(at.folder) + 1;
  at.list.splice(at.index, 1);
  at.group.items.splice(after, 0, at.item);
  if (!at.folder.items.length) at.group.items.splice(after - 1, 1);
  return saveLayout(layout);
}

function changeLayout(change) {
  const layout = layoutCopy();
  if (change(layout) === false) return;
  return saveLayout(layout);
}

const newGroupDialog = (then) =>
  nameDialog(t("home.newGroup"), "", t("files.create"), async (title) => {
    const id = newId();
    await changeLayout((layout) => void layout.groups.push({ id, title, items: [] }));
    await then?.(id);
  });

function linkDialog(link) {
  const title = h("input", { value: link?.title ?? "", maxLength: 60, autocomplete: "off" });
  const url = h("input", { type: "url", value: link?.url ?? "", required: true, maxLength: 2000, placeholder: "https://", spellcheck: false, autocomplete: "off" });
  const picture = h("input", { type: "url", value: link?.icon ?? "", maxLength: 2000, placeholder: "https://", spellcheck: false, autocomplete: "off" });
  const error = h("p", { class: "error", role: "alert" });
  const web = (value) => {
    const address = new URL(value.trim());
    if (!["http:", "https:"].includes(address.protocol)) throw new Error("not web");
    return address.href;
  };
  let dialog;
  dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          let made;
          try {
            made = { type: "link", id: link?.id ?? newId(), title: title.value.trim(), url: web(url.value), icon: picture.value.trim() ? web(picture.value) : "" };
          } catch {
            error.textContent = t("home.badLink");
            return;
          }
          dialog.close();
          await changeLayout((layout) => {
            const at = link && locate(layout, tileKey(link));
            if (at) at.list[at.index] = made;
            else layout.groups[0].items.push(made);
          });
        },
      },
      h("h2", null, t(link ? "home.editLink" : "home.addLink")),
      field(t("home.linkUrl"), url),
      field(t("home.linkTitle"), title, t("home.linkTitleHint")),
      field(t("home.linkIcon"), picture, t("home.linkIconHint")),
      error,
      h(
        "footer",
        null,
        link && button(t("home.removeLink"), { class: "ghost danger-text", onclick: () => (dialog.close(), changeLayout((layout) => void takeTile(layout, tileKey(link)))) }, "trash"),
        closeButton(() => dialog, t("common.cancel")),
        h("button", { class: "btn primary" }, t(link ? "home.saveLink" : "home.add")),
      ),
    ),
  );
  url.focus();
}

const renameFolderDialog = (folder) =>
  nameDialog(t("home.renameFolder"), folder.title || t("home.folder"), t("files.rename"), (title) =>
    changeLayout((layout) => {
      const found = allFolders(layout).find((f) => f.id === folder.id);
      if (!found) return false;
      found.title = title;
    }),
  );

/** Everything that can be done to a tile without dragging it */
function tileMenu(item) {
  const key = tileKey(item);
  const layout = state.overview.dashboard;
  const at = locate(layout, key);
  if (!at) return;
  let dialog;
  const entry = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  const groupName = (group) => group.title || t("home.apps");
  const neighbour = (step) => at.list[at.index + step];
  dialog = openDialog(
    "menu",
    h("header", null, tileIcon(item), h("div", null, h("h2", { class: "clip" }, tileTitle(item)), h("span", { class: "muted small" }, at.folder ? at.folder.title || t("home.folder") : groupName(at.group)))),
    item.type === "link" && entry(t("home.editLink"), "edit", () => linkDialog(item)),
    item.type === "folder" && entry(t("common.open"), "folder", () => openFolder(item.id)),
    item.type === "folder" && entry(t("files.rename"), "edit", () => renameFolderDialog(item)),
    neighbour(-1) && entry(t("home.moveEarlier"), "arrow", () => moveTile(key, { before: tileKey(neighbour(-1)) }), "flip"),
    neighbour(1) && entry(t("home.moveLater"), "arrow", () => moveTile(key, { after: tileKey(neighbour(1)) })),
    at.folder && entry(t("home.outOfFolder"), "signout", () => outOfFolder(key)),
    item.type !== "folder" && allFolders(layout).filter((folder) => folder !== at.folder).map((folder) => entry(t("home.intoFolder", { name: folder.title || t("home.folder") }), "folder", () => moveTile(key, { folder: folder.id }))),
    item.type !== "folder" && !at.folder && entry(t("home.newFolder"), "plus", () => nameDialog(t("home.newFolder"), "", t("files.create"), (title) => makeFolder(key, null, title))),
    layout.groups.filter((group) => group !== at.group || at.folder).map((group) => entry(t("home.toGroup", { name: groupName(group) }), "grid", () => moveTile(key, { group: group.id }))),
    entry(t("home.toNewGroup"), "plus", () => newGroupDialog((id) => moveTile(key, { group: id }))),
    item.type === "folder" && entry(t("home.ungroup"), "x", () => changeLayout((next) => void locate(next, key).list.splice(at.index, 1, ...item.items))),
    item.type === "link" && entry(t("home.removeLink"), "trash", () => changeLayout((next) => void takeTile(next, key)), "danger"),
    item.type === "files" && entry(t("files.unpin"), "pin", () => pinFolder(item.path, false)),
  );
}

function groupHead(group, index, count) {
  const layout = state.overview.dashboard;
  const first = index === 0;
  const title = group.title || t("home.apps");
  const tool = (label, iconName, action, attrs = {}) => h("button", { type: "button", class: "icon-btn " + (attrs.class ?? ""), title: label, "aria-label": `${label}: ${title}`, disabled: attrs.disabled, onclick: action }, icon(iconName));
  const tools = h(
    "div",
    { class: "group-tools" },
    isAdmin() && [
      tool(t("files.rename"), "edit", () => nameDialog(t("home.renameGroup"), title, t("files.rename"), (name) => changeLayout((next) => void (next.groups[index].title = name))), { class: "quiet" }),
      // its tiles go to the group that takes its place at the top, or to the first one
      layout.groups.length > 1 && tool(t("home.removeGroup"), "trash", () => changeLayout((next) => void next.groups[first ? 1 : 0].items.push(...next.groups.splice(index, 1)[0].items)), { class: "quiet" }),
    ],
    first && state.user.role !== "guest" && h("a", { class: "link", href: "#/store" }, t("home.store"), icon("arrow")),
  );
  return h("div", { class: "section-head" }, h("h2", null, title, first && !group.title && h("span", { class: "muted small" }, t("home.installed", { n: count }))), tools);
}

/** What can be put on the dashboard, to choose from */
function addDialog() {
  let dialog;
  const entry = (label, hint, iconName, action) => h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), action()) }, h("span", { class: "app-icon plus" }, icon(iconName)), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, label), h("span", { class: "muted small" }, hint)));
  const pinned = () => (state.overview.folders ?? []).map((folder) => folder.path);
  dialog = openDialog(
    "menu",
    h("header", null, h("h2", null, t("home.addTitle"))),
    entry(t("home.addApp"), t("home.addAppHint"), "store", () => go("#/store")),
    state.overview.importable > 0 && entry(t("home.import"), t("home.importHint", { n: state.overview.importable }), "download", () => go("#/import")),
    entry(t("home.addLinkItem"), t("home.addLinkHint"), "link", () => linkDialog()),
    entry(t("home.addGroupItem"), t("home.addGroupHint"), "grid", () => newGroupDialog()),
    entry(t("home.addFolder"), t("home.addFolderHint"), "folder", () => folderPicker({ title: t("home.addFolderTitle"), start: "", confirmLabel: t("home.addFolderHere"), allowed: (at) => !pinned().includes(at), action: (at) => pinFolder(at, true, false) })),
  );
}

function renderDashboard(box) {
  const o = state.overview;
  const admin = isAdmin();
  const groups = o.dashboard.groups;
  put(
    box,
    groups.map((group, index) => {
      const tiles = group.items.map(tile).filter(Boolean);
      // a group with nothing in it for this user is not theirs to see
      if (!tiles.length && index > 0 && !admin) return null;
      const head = groupHead(group, index, o.apps.length);
      if (admin && groups.length > 1) {
        head.classList.add("handle");
        head.addEventListener("pointerdown", (e) => dragStart(e, group.id, GROUP_DRAG, head.parentElement));
      }
      return h(
        "div",
        { class: "group", "data-group-id": group.id },
        head,
        h(
          "div",
          { class: "tiles", "data-group": group.id },
          tiles,
          index === 0 && admin && h("button", { type: "button", class: "tile add", onclick: addDialog }, h("span", { class: "tile-main" }, h("span", { class: "app-icon plus" }, icon("plus")), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, t("home.add")), h("span", { class: "tile-sub" }, t("home.addHint"))))),
          admin && !tiles.length && index > 0 && h("p", { class: "muted small drop-hint" }, t("home.emptyGroup")),
        ),
      );
    }),
  );
  renderFolder();
}

// --- A folder of tiles, opened ----------------------------------------------------------------------

function openFolder(id) {
  if (homeUi.folder) return;
  const body = h("div", { class: "tiles", "data-folder": id });
  const head = h("h2", { class: "clip grow" });
  const rename = h("button", { type: "button", class: "icon-btn", title: t("files.rename"), "aria-label": t("files.rename"), onclick: () => renameFolderDialog(homeUi.folder.item) }, icon("edit"));
  const dialog = openDialog("wide tile-folder", h("header", null, head, rename, closeX(() => dialog)), body, h("p", { class: "muted small drag-out" }, t("home.dragOut")));
  dialog.addEventListener("close", () => (homeUi.folder = null));
  // a tile that leads somewhere takes the folder off the screen
  body.addEventListener("click", (e) => e.target.closest("a") && dialog.close());
  homeUi.folder = { id, dialog, body, head, rename, item: null };
  renderFolder();
}

function renderFolder() {
  const open = homeUi.folder;
  if (!open) return;
  const item = allFolders(state.overview.dashboard).find((folder) => folder.id === open.id);
  const tiles = item?.items.map(tile).filter(Boolean) ?? [];
  if (!tiles.length) return open.dialog.close();
  open.item = item;
  open.head.textContent = item.title || t("home.folder");
  open.rename.hidden = !isAdmin();
  open.dialog.classList.toggle("movable", isAdmin());
  open.body.replaceChildren(...tiles);
}

// --- Dragging a tile (mouse, pen and finger alike) -------------------------------------------------

const DROP_CLASSES = ["drop-before", "drop-after", "drop-into", "drop-end", "drop-above", "drop-below"];

/**
 * A press on something that can be moved — a tile, a group (by its heading), a block of the dashboard:
 * a mouse drags once it moves, a finger after holding still — moving first is scrolling. `kind` says
 * where it may land (`find`) and what a drop does (`drop`).
 */
function dragStart(e, item, kind = TILE_DRAG, el = e.currentTarget) {
  if (homeUi.drag || e.button > 0 || e.target.closest(kind.ignore)) return;
  const drag = (homeUi.drag = { kind, item, key: kind === TILE_DRAG ? tileKey(item) : item, el, id: e.pointerId, x: e.clientX, y: e.clientY, active: false, moved: false, target: null, ghost: null, marked: null, timer: 0, scroll: 0 });
  const begin = () => {
    if (homeUi.drag !== drag || drag.active) return;
    drag.active = true;
    const rect = el.getBoundingClientRect();
    drag.dx = drag.x - rect.left;
    drag.dy = drag.y - rect.top;
    drag.ghost = el.cloneNode(true);
    drag.ghost.classList.add("drag-ghost");
    drag.ghost.style.width = rect.width + "px";
    drag.ghost.removeAttribute("id");
    for (const marked of drag.ghost.querySelectorAll("[id]")) marked.removeAttribute("id");
    // a modal dialog is drawn above everything else on the page
    (homeUi.folder?.dialog ?? document.body).append(drag.ghost);
    el.classList.add("dragging");
    document.documentElement.classList.add("tile-dragging", "dragging-" + kind.name);
    dragMove(drag);
    const step = () => {
      if (homeUi.drag !== drag) return;
      const edge = 70;
      const speed = drag.y < edge ? -(edge - drag.y) / 5 : drag.y > innerHeight - edge ? (drag.y - (innerHeight - edge)) / 5 : 0;
      if (speed && !homeUi.folder) {
        scrollBy(0, speed);
        dragMove(drag);
      }
      drag.scroll = requestAnimationFrame(step);
    };
    drag.scroll = requestAnimationFrame(step);
  };
  if (e.pointerType === "touch") drag.timer = setTimeout(begin, 280);
  const move = (ev) => {
    if (ev.pointerId !== drag.id) return;
    const far = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y);
    if (!drag.active) {
      if (e.pointerType === "touch") {
        if (far > 8) dragEnd(false);
        return;
      }
      if (far < 6) return;
      begin();
    }
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    drag.moved = true;
    dragMove(drag);
  };
  const up = (ev) => ev.pointerId === drag.id && dragEnd(ev.type === "pointerup");
  // while a tile is in the air the page under the finger stays put
  const still = (ev) => drag.active && ev.cancelable && ev.preventDefault();
  drag.stop = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    removeEventListener("touchmove", still);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  addEventListener("touchmove", still, { passive: false });
}

/** Above or below the block under the pointer, by which half of it the pointer is in */
function besideBlock(drag, selector, name) {
  const over = document.elementFromPoint(drag.x, drag.y)?.closest(selector);
  if (!over || over === drag.el || over.classList.contains("drag-ghost")) return null;
  const rect = over.getBoundingClientRect();
  const above = drag.y < rect.top + rect.height / 2;
  return { el: over, cls: above ? "drop-above" : "drop-below", [above ? "before" : "after"]: over.dataset[name] };
}

/** A group is moved among the groups */
const GROUP_DRAG = {
  name: "group",
  ignore: "button, a, input",
  find: (drag) => besideBlock(drag, ".group[data-group-id]", "groupId"),
  drop: (drag, target) =>
    changeLayout((layout) => {
      const [group] = layout.groups.splice(layout.groups.findIndex((g) => g.id === drag.key), 1);
      const at = layout.groups.findIndex((g) => g.id === (target.before ?? target.after));
      if (!group || at < 0) return false;
      layout.groups.splice(at + (target.after ? 1 : 0), 0, group);
    }),
};

/** A block — the system's numbers, what needs attention, the activity — is moved among the blocks and the places for them */
const WIDGET_DRAG = {
  name: "widget",
  ignore: "button, a, input",
  find: (drag) => {
    const beside = besideBlock(drag, ".widget[data-widget]", "widget");
    if (beside) return beside;
    // not over a block: the free room of a place takes the block at its end
    const under = document.elementFromPoint(drag.x, drag.y);
    const zone = under?.closest("[data-zone]");
    return zone && !under.closest(".widget") ? { el: zone, cls: "drop-end", zone: zone.dataset.zone } : null;
  },
  drop: (drag, target) =>
    changeLayout((layout) => {
      const zones = layout.widgets;
      for (const zone of Object.values(zones)) if (zone.includes(drag.key)) zone.splice(zone.indexOf(drag.key), 1);
      const beside = target.before ?? target.after;
      const zone = beside ? Object.values(zones).find((list) => list.includes(beside)) : zones[target.zone];
      if (!zone) return false;
      zone.splice(beside ? zone.indexOf(beside) + (target.after ? 1 : 0) : zone.length, 0, drag.key);
    }),
};

/** A tile is moved among the tiles, into a folder, onto another tile (which makes a folder), out of an open folder */
const TILE_DRAG = {
  name: "tile",
  ignore: ".tile-open",
  find: dropTarget,
  drop: (drag, target) => {
    if (target.out) {
      homeUi.folder?.dialog.close();
      outOfFolder(drag.key);
    } else if (target.onto) makeFolder(drag.key, target.onto);
    else moveTile(drag.key, target);
  },
};

/** Where the tile would land if it were let go here */
function dropTarget(drag) {
  const under = document.elementFromPoint(drag.x, drag.y);
  if (!under) return null;
  const open = homeUi.folder;
  // out of the open folder: onto the dimmed page around it
  if (open) {
    if (under === open.dialog) {
      const box = open.dialog.getBoundingClientRect();
      if (drag.x < box.left || drag.x > box.right || drag.y < box.top || drag.y > box.bottom) return { out: true };
    }
    if (!open.dialog.contains(under)) return null;
  }
  const over = under.closest(".tile[data-key]");
  if (over && over !== drag.el && !over.classList.contains("drag-ghost")) {
    const rect = over.getBoundingClientRect();
    const part = (drag.x - rect.left) / rect.width;
    const key = over.dataset.key;
    const mayJoin = !open && drag.item.type !== "folder";
    if (mayJoin && part > 0.28 && part < 0.72) return key.startsWith("folder:") ? { el: over, cls: "drop-into", folder: key.slice(7) } : { el: over, cls: "drop-into", onto: key };
    return part < 0.5 ? { el: over, cls: "drop-before", before: key } : { el: over, cls: "drop-after", after: key };
  }
  const list = under.closest(".tiles[data-group]");
  if (list && !over) return { el: list, cls: "drop-end", group: list.dataset.group };
  return null;
}

function dragMove(drag) {
  drag.ghost.style.transform = `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)`;
  const target = drag.kind.find(drag);
  drag.marked?.classList.remove(...DROP_CLASSES);
  homeUi.folder?.dialog.classList.toggle("drop-out", !!target?.out);
  drag.marked = target?.el ?? null;
  if (target?.el) target.el.classList.add(target.cls);
  drag.target = target;
}

function dragEnd(drop) {
  const drag = homeUi.drag;
  if (!drag) return;
  clearTimeout(drag.timer);
  cancelAnimationFrame(drag.scroll);
  drag.stop();
  drag.ghost?.remove();
  drag.marked?.classList.remove(...DROP_CLASSES);
  drag.el.classList.remove("dragging");
  document.documentElement.classList.remove("tile-dragging", "dragging-" + drag.kind.name);
  homeUi.folder?.dialog.classList.remove("drop-out");
  // the click that ends a drag is not a click on what was dragged
  if (drag.active) {
    const swallow = (e) => (e.preventDefault(), e.stopPropagation());
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, { capture: true }));
  }
  setTimeout(() => homeUi.drag === drag && (homeUi.drag = null));
  const target = drop && drag.active ? drag.target : null;
  if (!target) {
    if (homeUi.stale) setTimeout(renderHomeBody);
    return;
  }
  homeUi.drag = null;
  drag.kind.drop(drag, target);
}

const ATTENTION_ICONS = { update: "up", docker: "box", restarting: "refresh", partial: "alert", disk: "disk", memory: "memory", temperature: "temp" };

function attentionItem(item) {
  const detail = { ...item.detail, free: item.detail.free == null ? "" : bytes(item.detail.free) };
  const base = "attention." + item.code;
  return h(
    "div",
    { class: "attention-item" },
    h("span", { class: "badge-icon " + item.severity }, icon(ATTENTION_ICONS[item.code] ?? "alert")),
    h("div", { class: "grow" }, h("strong", null, t(base + ".title", detail)), h("p", { class: "muted small" }, t(base + ".text", detail).trim())),
    item.code === "update" && h("a", { class: "btn small", href: "#/settings/about" }, t("common.open")),
    item.app && h("a", { class: "btn small", href: `#/apps/${item.app}${item.code === "restarting" || item.code === "partial" ? "/logs" : ""}` }, t(item.code === "restarting" || item.code === "partial" ? "app.logs" : "common.open")),
  );
}

const ACTIVITY_ICONS = { terminal: "terminal", install: "download", update: "up", start: "play", stop: "stop", restart: "refresh", remove: "trash", apply: "code", backup: "archive", restore: "undo", snapshot: "trash", import: "download" };

function activityItem(entry) {
  const [group, kind, outcome] = entry.code.split(".");
  const failed = outcome === "failed";
  const key = "activity." + entry.code;
  const title = state.overview?.apps.find((a) => a.name === entry.app)?.title ?? entry.app ?? "";
  const meta = [ago(entry.ts), entry.user && group !== "auth" ? (entry.user === "schedule" ? t("activity.bySchedule") : entry.user === "restore" ? t("activity.byRestore") : t("activity.by", { user: entry.user })) : null, group === "auth" ? entry.detail : null].filter(Boolean).join(" · ");
  return h(
    "div",
    { class: "activity-item" },
    icon(group === "auth" ? "signin" : group === "users" ? "user" : failed ? "x" : (ACTIVITY_ICONS[kind] ?? "check"), failed ? "danger" : ""),
    h("div", { class: "grow" }, h("div", null, has(key) ? t(key, { app: title, user: entry.user ?? "", target: entry.detail ?? "" }) : entry.code), h("div", { class: "muted small" }, meta), failed && entry.detail && h("div", { class: "muted small clip" }, entry.detail)),
  );
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting = t(hour < 5 ? "home.night" : hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: state.user.name });
  const widget = (id, el) => {
    el.classList.add("widget");
    el.dataset.widget = id;
    // the numbers are dragged by any part of them; a list with text to read and select, by its heading
    el.addEventListener("pointerdown", (e) => isAdmin() && (id === "stats" || e.target.closest(".section-head")) && dragStart(e, id, WIDGET_DRAG));
    return el;
  };
  // the blocks are made once and then only moved and refilled: the numbers of the system live in one of them
  homeUi.widgets = {
    stats: widget("stats", h("section", { class: "stats card" }, statCell("cpu", "cpu", t("sys.cpu")), statCell("memory", "memory", t("sys.memory")), statCell("disk", "disk", t("sys.disk")), statCell("network", "network", t("sys.network")), h("div", { class: "stat", id: "stat-temp", hidden: true }, h("div", { class: "stat-label" }, icon("temp"), t("sys.temperature")), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, "—"), h("span", { class: "unit" })), h("div", { class: "stat-chart" })), h("div", { class: "stat-hint" }, " ")))),
    attention: widget("attention", h("section", { class: "card pad" })),
    activity: widget("activity", h("section", { class: "pad-x loose" })),
  };
  const zone = (name, tag = "div") => h(tag, { class: "zone" + (name === "side" ? " side" : ""), id: "zone-" + name, "data-zone": name });
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, greeting), h("p", { class: "meta", id: "host" }, " ")), h("div", { class: "counts", id: "counts" })),
    zone("top"),
    h("div", { class: "columns", id: "home-columns" }, h("section", { id: "home-apps" }), zone("side", "aside")),
    zone("bottom"),
  );
  renderHomeBody();
}

function renderHomeBody() {
  const o = state.overview;
  const appsBox = document.getElementById("home-apps");
  if (!o || !appsBox || !homeUi.widgets) return;
  const apps = o.apps;

  const count = (st) => apps.filter((a) => appState(a) === st).length;
  const counts = [["running", count("running")], ["restarting", count("restarting")], ["partial", count("partial")], ["stopped", count("stopped")]].filter(([, n]) => n > 0);
  document.getElementById("counts")?.replaceChildren(...counts.map(([st, n]) => h("span", { class: "count" }, h("i", { class: "dot " + st }), t("home.count." + st, { n }))));

  // a tile in the air belongs to the page as it is; the news is drawn when it lands
  if (homeUi.drag?.active) homeUi.stale = true;
  else {
    homeUi.stale = false;
    renderDashboard(appsBox);
  }

  put(homeUi.widgets.attention, h("div", { class: "section-head" }, h("h2", null, t("attention.title"), o.attention.length > 0 && h("span", { class: "pill" }, o.attention.length))), o.attention.length ? o.attention.map(attentionItem) : h("p", { class: "all-good" }, icon("check", "ok"), t("attention.none")));
  put(homeUi.widgets.activity, h("div", { class: "section-head" }, h("h2", null, t("activity.title"))), o.activity.length ? o.activity.map(activityItem) : h("p", { class: "muted small" }, t("activity.none")));
  if (!homeUi.drag?.active) placeWidgets();
  renderSystem();
}

/** Puts every block into its place; a place with nothing in it shows only while a block is in the air */
function placeWidgets() {
  for (const [name, ids] of Object.entries(state.overview.dashboard.widgets)) {
    const zone = document.getElementById("zone-" + name);
    if (!zone) continue;
    const blocks = ids.map((id) => homeUi.widgets[id]).filter(Boolean);
    // only what changed is moved: a block taken out and put back would lose its scroll and focus
    if (blocks.length !== zone.children.length || blocks.some((block, i) => zone.children[i] !== block)) zone.replaceChildren(...blocks);
    zone.classList.toggle("empty", !blocks.length);
    zone.classList.toggle("movable", isAdmin());
    zone.dataset.hint = t("home.dropBlock");
  }
  document.getElementById("home-columns")?.classList.toggle("no-side", !state.overview.dashboard.widgets.side.length);
}

// --- App page -----------------------------------------------------------------------------------

async function loadApp(quiet = false) {
  const { name } = state.route;
  try {
    const [app, activity] = await Promise.all([api("GET", `/api/apps/${name}?lang=${state.lang}`), isAdmin() ? api("GET", `/api/activity?app=${name}`) : []]);
    if (state.route.view !== "app" || state.route.name !== name) return;
    const same = state.app?.name === name ? state.app : null;
    state.app = { ...app, activity, stats: same?.stats ?? null, history: same?.history ?? { cpu: [], memory: [] } };
  } catch (e) {
    if (state.route.view !== "app" || state.route.name !== name) return;
    // removed (by us a moment ago, or by hand): there is no page to show any more
    if (e instanceof ApiError && e.status === 404) return go("#/");
    if (!quiet) toast(errorText(e), "error");
    return;
  }
  renderAppHead();
  // the compose editor and the log console keep what the user is doing in them
  if (!quiet || state.route.tab === "overview" || state.route.tab === "backups") renderAppTab();
}

function renderApp() {
  if (state.app?.name !== state.route.name) state.app = null;
  shell(h("div", { id: "app-head" }), h("div", { id: "app-tab" }));
  if (state.app) {
    renderAppHead();
    renderAppTab();
  }
}

async function startAction(app, action) {
  try {
    const res = await api("POST", `/api/apps/${app.name}/${action}`, {});
    jobDialog(res.job, action, app.title);
    void refresh();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function appMoreMenu(app) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, disabled: !!app.job, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu",
    h("header", null, appIcon(app), h("div", null, h("h2", null, app.title), stateChip(app))),
    item(t("app.update"), "up", () => startAction(app, "update")),
    item(t("app.remove"), "trash", () => removeDialog(app), "danger"),
  );
}

function renderAppHead() {
  const app = state.app;
  const head = document.getElementById("app-head");
  if (!app || !head) return;
  const url = isUp(app) ? appUrl(app) : null;
  const tab = (id, iconName) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `#/apps/${app.name}${id === "overview" ? "" : "/" + id}` }, icon(iconName), t("app.tab." + id));
  head.replaceChildren(
    h("nav", { class: "crumbs" }, h("a", { href: "#/" }, t("home.apps")), icon("chevron"), h("span", null, app.title)),
    h(
      "div",
      { class: "app-head" },
      appIcon(app, "lg"),
      h(
        "div",
        { class: "grow" },
        h("div", { class: "app-title" }, h("h1", null, app.title), stateChip(app)),
        h("p", { class: "meta" }, url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url.replace(/\/$/, ""), icon("external")) : null, url && h("span", { class: "dot-sep" }, "·"), t("app.containersCount", { n: app.containers.length }), app.store && h("span", { class: "dot-sep" }, "·"), app.store && t("app.fromStore", { store: app.store })),
      ),
      h(
        "div",
        { class: "actions" },
        !isAdmin() && url && h("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("app.open"))),
        ...(!isAdmin() ? [] : [
        app.job && button(t("status.busy"), { onclick: () => jobDialog(app.job.id, app.job.kind, app.title) }, "terminal"),
        app.update && !app.job && button(t("app.storeUpdate"), { class: "accent", onclick: () => storeUpdateDialog(app) }, "up"),
        isUp(app) && button(t("app.restart"), { disabled: !!app.job, onclick: () => startAction(app, "restart") }, "refresh"),
        isUp(app) ? button(t("app.stop"), { disabled: !!app.job, onclick: () => startAction(app, "stop") }, "stop") : button(t("app.start"), { class: url ? "" : "primary", disabled: !!app.job, onclick: () => startAction(app, "start") }, "play"),
        url && h("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("app.open"))),
        h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: () => appMoreMenu(app) }, icon("more")),
        ]),
      ),
    ),
    isAdmin() && h("div", { class: "tabs" }, tab("overview", "grid"), tab("logs", "logs"), tab("compose", "code"), tab("backups", "archive"), tab("terminal", "terminal")),
  );
}

/** What the store's newer version changes in the app's compose file, before anything happens */
async function storeUpdateDialog(app) {
  let plan;
  try {
    plan = await api("GET", `/api/apps/${app.name}/storeupdate`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const rows = (kind) => plan.changes.filter((c) => c.kind === kind && !c.path.startsWith("x-casaos")).map((c) => h("tr", null, h("td", { class: "mono small" }, c.path), h("td", { class: "mono small" }, h("div", { class: "muted clip" }, c.from || "—"), h("div", { class: "clip" }, c.to || t("update.removed")))));
  const table = (kind) => h("div", { class: "card table-wrap" }, h("table", { class: "changes" }, h("tbody", null, rows(kind))));
  const fromStore = rows("store");
  const conflicts = rows("conflict");
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("update.title", { title: app.title })), h("p", { class: "muted small" }, t("update.lead", { store: plan.store }))), closeX(() => dialog)),
    !plan.exact && h("p", { class: "banner small" }, t(plan.recorded ? "update.guessed" : "update.matched", { store: plan.store })),
    fromStore.length > 0 && h("div", { class: "stack" }, h("h3", null, t("update.changes")), table("store")),
    conflicts.length > 0 && h("div", { class: "stack" }, h("h3", null, t("update.conflicts")), h("p", { class: "muted small" }, t("update.conflictsLead")), table("conflict")),
    h("details", null, h("summary", { class: "muted small" }, t("update.file")), h("textarea", { class: "code", spellcheck: false, wrap: "off", readOnly: true, value: plan.compose, "aria-label": "compose.yml" })),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t(fromStore.length ? "update.apply" : "update.keep"), {
        class: "primary",
        onclick: async () => {
          dialog.close();
          try {
            const res = await api("POST", `/api/apps/${app.name}/storeupdate`, {});
            jobDialog(res.job, "update", app.title, () => loadApp(true));
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }, "up"),
    ),
  );
}

function renderAppTab() {
  const app = state.app;
  const box = document.getElementById("app-tab");
  if (!app || !box) return;
  leaveView();
  if (state.route.tab === "logs") return appLogsTab(app, box);
  if (state.route.tab === "compose") return appComposeTab(app, box);
  if (state.route.tab === "backups") return appBackupsTab(app, box);
  if (state.route.tab === "terminal") return appTerminalTab(app, box);
  appOverviewTab(app, box);
}

function appOverviewTab(app, box) {
  const row = (label, value, mono) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", { class: mono ? "mono" : "" }, value));
  const statsBox = h("div", { class: "stats card three" }, statCell("app-cpu", "cpu", t("sys.cpu")), statCell("app-memory", "memory", t("sys.memory")), h("div", { class: "stat" }, h("div", { class: "stat-label" }, icon("box"), t("app.containers")), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, String(app.containers.filter((c) => c.state === "running").length)), h("span", { class: "unit" }, "/ " + app.containers.length))), h("div", { class: "stat-hint" }, t("status." + app.status))));

  const containerRow = (c) => {
    const s = app.stats?.[c.name];
    return h("tr", null, h("td", null, h("div", { class: "mono" }, c.name), h("div", { class: "muted small mono clip" }, c.image)), h("td", null, h("span", { class: "state " + (c.state === "running" ? "running" : c.state === "restarting" ? "restarting" : "stopped") }, c.status)), h("td", { class: "num" }, s ? s.cpu.toFixed(1) + " %" : "—"), h("td", { class: "num" }, s ? bytes(s.memory) : "—"), h("td", { class: "mono small" }, c.ports.join(", ") || "—"));
  };

  box.replaceChildren(
    h(
      "div",
      { class: "columns" },
      h(
        "div",
        { class: "stack" },
        h("div", { class: "section-head" }, h("h2", null, t("app.resources"))),
        statsBox,
        h("div", { class: "section-head" }, h("h2", null, t("app.containers"))),
        app.containers.length
          ? h("div", { class: "card table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("app.col.container")), h("th", null, t("app.col.state")), h("th", { class: "num" }, t("sys.cpu")), h("th", { class: "num" }, t("sys.memory")), h("th", null, t("app.col.ports")))), h("tbody", { id: "containers" }, app.containers.map(containerRow))), h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} ps`))
          : h("p", { class: "card pad muted" }, t("app.noContainers")),
      ),
      h(
        "aside",
        { class: "side" },
        h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("app.glance"))), app.port && row(t("app.address"), appAddress(app), true), row(t("app.composeFile"), app.composeFile, true), app.folders.map((f, i) => row(i ? "" : t("app.folders"), f, true)), row(t("app.source"), app.store ? t("app.fromStore", { store: app.store }) : t("app.custom")), row(t("app.installed"), new Date(app.installedAt).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" }))),
        h("section", { class: "pad-x" }, h("div", { class: "section-head" }, h("h2", null, t("activity.title"))), app.activity.length ? app.activity.slice(0, 6).map(activityItem) : h("p", { class: "muted small" }, t("activity.none"))),
      ),
    ),
  );

  // per-container figures: Docker needs about a second per sample, so this is polled gently
  const history = app.history;
  let stopped = false;
  const paint = () => {
    const list = Object.values(app.stats ?? {});
    const cpu = list.reduce((sum, s) => sum + s.cpu, 0);
    const memory = list.reduce((sum, s) => sum + s.memory, 0);
    const parts = bytesParts(memory);
    setStat("app-cpu", list.length ? cpu.toFixed(1) : "—", "%", t("app.cpuHint", { n: state.overview?.system.cores ?? "" }), sparkline(history.cpu));
    setStat("app-memory", list.length ? parts.value : "—", list.length ? parts.unit : "", state.overview ? t("app.memoryHint", { total: bytes(state.overview.system.memory.total) }) : "", sparkline(history.memory));
    document.getElementById("containers")?.replaceChildren(...app.containers.map(containerRow));
  };
  const poll = async () => {
    while (!stopped) {
      if (isUp(app) && !document.hidden) {
        const stats = await api("GET", `/api/apps/${app.name}/stats`).catch(() => null);
        if (stopped) return;
        if (stats && state.app?.name === app.name) {
          state.app.stats = app.stats = stats;
          const list = Object.values(stats);
          history.cpu.push(list.reduce((sum, s) => sum + s.cpu, 0));
          history.memory.push(list.reduce((sum, s) => sum + s.memory, 0));
          if (history.cpu.length > 40) history.cpu.shift(), history.memory.shift();
          paint();
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
  cleanups.push(() => (stopped = true));
  paint();
  void poll();
}

function streamLogs(app, log, signal) {
  return (async () => {
    try {
      const res = await fetch(`/api/apps/${app.name}/logs`, { signal });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error?.code ?? "request.failed");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
        log.append(value);
        // a chatty container must not grow the page without bound
        if (log.textContent.length > 400_000) log.textContent = log.textContent.slice(-300_000);
        if (stick) log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      if (!signal.aborted) log.append("\n" + errorText(e));
    }
  })();
}

function appLogsTab(app, box) {
  const log = h("pre", { class: "console page" });
  const abort = new AbortController();
  cleanups.push(() => abort.abort());
  box.replaceChildren(h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} logs --follow --tail 200`), log);
  void streamLogs(app, log, abort.signal);
}

// --- Terminal ---------------------------------------------------------------------------------------

/** The terminal lives in a page of its own (the emulator needs a looser content policy), shown in a frame */
function terminalFrame(query = {}) {
  const params = new URLSearchParams({ ...query, lang: state.lang });
  return h("iframe", { class: "term-frame", src: "/terminal.html?" + params, title: t("terminal.title") });
}

function renderTerminal() {
  shell(h("div", { class: "page-head" }, h("div", null, h("h1", null, t("terminal.title")), h("p", { class: "meta" }, t("terminal.hostHint")))), terminalFrame());
  document.getElementById("view").classList.add("fill");
}

function appTerminalTab(app, box) {
  const running = app.containers.filter((c) => c.state === "running");
  if (!running.length) return box.replaceChildren(h("p", { class: "muted" }, t("error.terminal.notRunning")));
  const frame = h("div", { class: "term-holder" });
  const open = (name) => frame.replaceChildren(terminalFrame({ app: app.name, container: name }));
  const pick = running.length > 1 && h("select", { "aria-label": t("terminal.container"), onchange: (e) => open(e.target.value) }, running.map((c) => h("option", { value: c.name }, c.service || c.name)));
  box.replaceChildren(h("div", { class: "cmd-row" }, h("p", { class: "cmd grow" }, icon("terminal"), `docker exec -it ${running[0].name} sh`), pick), frame);
  if (pick) pick.addEventListener("change", () => (box.querySelector(".cmd").lastChild.textContent = `docker exec -it ${pick.value} sh`));
  open(running[0].name);
}

async function appComposeTab(app, box) {
  let text;
  try {
    text = (await api("GET", `/api/apps/${app.name}/compose`)).compose;
  } catch (e) {
    return box.replaceChildren(h("p", { class: "error" }, errorText(e)));
  }
  const area = h("textarea", { class: "code page", spellcheck: false, value: text, wrap: "off", "aria-label": "compose.yml" });
  const error = h("p", { class: "error", role: "alert" });
  const save = button(t("app.saveApply"), {
    class: "primary",
    disabled: true,
    onclick: async () => {
      error.textContent = "";
      try {
        const res = await api("PUT", `/api/apps/${app.name}/compose`, { compose: area.value });
        text = area.value;
        save.disabled = true;
        jobDialog(res.job, "apply", app.title);
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  area.addEventListener("input", () => (save.disabled = area.value === text));
  box.replaceChildren(h("div", { class: "editor-head" }, h("div", { class: "grow" }, h("p", { class: "mono small" }, app.composeFile), h("p", { class: "muted small" }, t("app.composeLead"))), save), area, error, h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} up -d --remove-orphans`));
}

/** Shows a running operation: its console output and how it ended */
async function jobDialog(id, kind, title, onDone) {
  const log = h("pre", { class: "console" });
  const status = h("p", { class: "job-status running" }, t("job.running"));
  let dialog;
  const close = button(t("job.hide"), { onclick: () => dialog.close() });

  const append = (line) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.append(line + "\n");
    if (stick) log.scrollTop = log.scrollHeight;
  };
  const finish = (job) => {
    status.className = "job-status " + job.status;
    status.textContent = job.status === "done" ? t("job.done") : t("job.failed");
    close.lastChild.textContent = t("common.close");
    jobListeners.delete(listener);
    if (job.status === "done") onDone?.();
  };
  // Events may arrive while the snapshot below is still loading. Lines are numbered, so the ones the
  // snapshot already holds are skipped and none is lost.
  let next = -1;
  const pending = [];
  const consume = (event) => {
    if (event.line !== undefined) {
      if (event.n >= next) {
        append(event.line);
        next = event.n + 1;
      }
    } else if (event.job.status !== "running") finish(event.job);
  };
  const listener = (event) => {
    if (event.job.id !== id) return;
    if (next < 0) pending.push(event);
    else consume(event);
  };
  jobListeners.add(listener);

  dialog = openDialog("wide", h("h2", null, t("job." + kind, { app: title })), log, h("footer", null, status, close));
  dialog.addEventListener("close", () => jobListeners.delete(listener));

  try {
    const job = await api("GET", `/api/jobs/${id}`);
    for (const line of job.log) append(line);
    next = job.lineCount;
    if (job.status !== "running") finish(job);
    else pending.forEach(consume);
  } catch (e) {
    next = 0;
    append(errorText(e));
  }
}

function removeDialog(app) {
  const path = `${state.settings?.dataRoot ?? ""}/AppData/${app.name}`.replace(/^\/\//, "/");
  const withData = h("input", { type: "checkbox" });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("app.removeTitle", { title: app.title })),
    h("p", { class: "muted" }, t("app.removeLead")),
    h("label", { class: "check" }, withData, h("span", null, t("app.removeData", { path }))),
    h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} down`),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("app.remove"), {
        class: "danger",
        onclick: async () => {
          dialog.close();
          try {
            const res = await api("DELETE", `/api/apps/${app.name}${withData.checked ? "?data=1" : ""}`);
            jobDialog(res.job, "remove", app.title, () => go("#/"));
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }),
    ),
  );
}

// --- Backups ------------------------------------------------------------------------------------

async function loadBackups() {
  try {
    state.backups = await api("GET", `/api/backups?lang=${state.lang}`);
    if (!state.settings) state.settings = await api("GET", "/api/settings");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "backups") renderBackupsBody();
}

const dateTime = (ts) => new Date(ts).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function backupNow(app) {
  try {
    const res = await api("POST", `/api/apps/${app.name}/backup`, {});
    jobDialog(res.job, "backup", app.title, () => (state.route.view === "backups" ? loadBackups() : loadApp(true)));
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function restoreDialog(app, snapshot) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("backup.restoreTitle", { title: app.title })),
    h("p", { class: "muted" }, t("backup.restoreLead", { time: dateTime(snapshot.at) })),
    h("ul", { class: "paths mono small" }, snapshot.paths.map((path) => h("li", null, path))),
    h("p", { class: "cmd" }, icon("terminal"), `tar -xzf ${snapshot.id}.tar.gz -C /`),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("backup.restore"), {
        class: "primary",
        onclick: async () => {
          dialog.close();
          document.querySelector("dialog.snapshots")?.close();
          try {
            const res = await api("POST", `/api/backups/${app.name}/${snapshot.id}/restore`, {});
            jobDialog(res.job, "restore", app.title, () => void refresh());
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }, "undo"),
    ),
  );
}

/** The snapshots of one app, newest first, each with what can be done to it */
function snapshotList(app, snapshots, reload) {
  if (!snapshots.length) return h("p", { class: "muted" }, t("backup.none"));
  return h(
    "div",
    { class: "snapshot-list" },
    snapshots.map((s) =>
      h(
        "div",
        { class: "snapshot" },
        h("div", { class: "grow" }, h("strong", null, dateTime(s.at)), h("div", { class: "muted small" }, [t("backup.reason." + s.reason), bytes(s.size), s.images[0]].filter(Boolean).join(" · "))),
        button(t("backup.restore"), { class: "small", onclick: () => restoreDialog(app, s) }, "undo"),
        h(
          "button",
          {
            type: "button",
            class: "icon-btn",
            "aria-label": t("backup.delete"),
            title: t("backup.delete"),
            onclick: async () => {
              try {
                await api("DELETE", `/api/backups/${app.name}/${s.id}`);
                reload();
              } catch (e) {
                toast(errorText(e), "error");
              }
            },
          },
          icon("trash"),
        ),
      ),
    ),
  );
}

function snapshotsDialog(app) {
  const body = h("div");
  let dialog;
  const paint = () => {
    const current = state.backups?.apps.find((a) => a.name === app.name);
    if (!current) return dialog?.close();
    body.replaceChildren(snapshotList(current, current.snapshots, async () => (await loadBackups(), paint())));
  };
  dialog = openDialog("wide snapshots", h("header", null, appIcon(app), h("div", { class: "grow" }, h("h2", null, app.title), h("p", { class: "muted small" }, t("backup.snapshotsOf", { n: app.snapshots.length }))), closeX(() => dialog)), body);
  paint();
}

async function appBackupsTab(app, box) {
  let snapshots;
  try {
    snapshots = await api("GET", `/api/apps/${app.name}/backups`);
  } catch (e) {
    return box.replaceChildren(h("p", { class: "error" }, errorText(e)));
  }
  box.replaceChildren(
    h("div", { class: "editor-head" }, h("div", { class: "grow" }, h("p", null, t("backup.appLead")), h("p", { class: "muted small" }, app.folders.join(" · "))), button(t("backup.now"), { class: "primary", disabled: !!app.job, onclick: () => backupNow(app) }, "archive")),
    h("div", { class: "card pad" }, snapshotList(app, snapshots, () => renderAppTab())),
  );
}

function renderBackups() {
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("nav.backups")), h("p", { class: "meta", id: "backup-meta" }, " ")), h("div", { class: "actions", id: "backup-actions" })),
    h("section", { class: "stats card", id: "backup-stats" }),
    h("div", { class: "columns" }, h("section", { id: "backup-apps" }), h("aside", { class: "side", id: "backup-side" })),
  );
  renderBackupsBody();
}

function renderBackupsBody() {
  const b = state.backups;
  const s = state.settings?.backup;
  const box = document.getElementById("backup-apps");
  if (!b || !s || !box) return;

  document.getElementById("backup-meta").replaceChildren(b.dir, h("span", { class: "dot-sep" }, "·"), s.enabled ? t("backup.daily", { time: s.time, keep: s.keep }) : t("backup.scheduleOff"));
  document.getElementById("backup-actions").replaceChildren(
    button(t(b.running ? "backup.running" : "backup.allNow"), {
      class: "primary",
      disabled: b.running,
      onclick: async () => {
        await api("POST", "/api/backups/run", {}).catch((e) => toast(errorText(e), "error"));
        toast(t("backup.started"));
        setTimeout(loadBackups, 500);
      },
    }, "play"),
  );

  const stat = (iconName, label, value, unit, hint, cls = "") => h("div", { class: "stat" }, h("div", { class: "stat-label" }, icon(iconName), label), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", { class: cls }, value), h("span", { class: "unit" }, unit))), h("div", { class: "stat-hint" }, hint || " "));
  const last = b.lastRun;
  const count = b.apps.reduce((n, a) => n + a.snapshots.length, 0);
  const stored = bytesParts(b.stored);
  const free = b.free == null ? null : bytesParts(b.free);
  const installed = b.apps.filter((a) => a.installed);
  document.getElementById("backup-stats").replaceChildren(
    stat(last?.failed.length ? "alert" : "check", t("backup.lastRun"), last ? ago(last.at) : "—", "", last ? (last.failed.length ? t("backup.lastFailed", { ok: last.ok, failed: last.failed.join(", ") }) : t("backup.lastOk", { ok: last.ok })) : t("backup.never"), last?.failed.length ? "warn" : ""),
    stat("refresh", t("backup.nextRun"), b.nextRun ? s.time : "—", "", b.nextRun ? `${new Date(b.nextRun).toLocaleDateString(state.lang, { weekday: "long", timeZone: b.timezone })} · ${t("backup.serverTime", { tz: b.timezone })}` : t("backup.scheduleOff")),
    stat("archive", t("backup.stored"), stored.value, stored.unit, t("backup.snapshots", { n: count })),
    stat("check", t("backup.protected"), String(installed.filter((a) => a.included).length), t("backup.ofApps", { n: installed.length }), ""),
    stat("disk", t("backup.destination"), free ? free.value : "—", free ? free.unit : "", free ? t("backup.freeAt", { path: b.dir }) : t("backup.noDir")),
  );

  const toggleInclude = async (app, included) => {
    const exclude = new Set(s.exclude);
    if (included) exclude.delete(app.name);
    else exclude.add(app.name);
    try {
      state.settings = await api("PUT", "/api/settings", { backup: { exclude: [...exclude] } });
      await loadBackups();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const row = (app) => {
    const newest = app.snapshots[0];
    const size = app.snapshots.reduce((n, x) => n + x.size, 0);
    return h(
      "tr",
      { class: app.installed ? "" : "removed" },
      h("td", null, h("div", { class: "with-icon" }, appIcon(app, "sm"), h("div", null, app.installed ? h("a", { class: "strong", href: `#/apps/${app.name}/backups` }, app.title) : h("span", { class: "strong" }, app.title), !app.installed && h("div", { class: "muted small" }, t("backup.removedApp")), app.otherFolders.length > 0 && h("div", { class: "muted small", title: app.otherFolders.join("\n") }, t("backup.notIncluded", { n: app.otherFolders.length }))))),
      h("td", null, newest ? h("div", null, ago(newest.at), h("div", { class: "muted small" }, t("backup.reason." + newest.reason))) : h("span", { class: "muted" }, t("backup.noneShort"))),
      h("td", { class: "num" }, size ? bytes(size) : "—"),
      h("td", { class: "num" }, app.snapshots.length || "—"),
      h("td", null, app.installed && h("input", { type: "checkbox", checked: app.included, "aria-label": t("backup.include", { title: app.title }), onchange: (e) => toggleInclude(app, e.target.checked) })),
      h("td", null, h("div", { class: "row-actions" }, app.snapshots.length > 0 && button(t("backup.restore"), { class: "small", onclick: () => snapshotsDialog(app) }, "undo"), app.installed && h("button", { type: "button", class: "icon-btn", title: t("backup.now"), "aria-label": `${t("backup.now")}: ${app.title}`, onclick: () => backupNow(app) }, icon("archive")))),
    );
  };
  const newest = b.server[0];
  const serverNow = button(t("backup.now"), {
    class: "small",
    onclick: async () => {
      serverNow.disabled = true;
      try {
        state.backups = await api("POST", "/api/backups/server", {});
        toast(t("backup.serverDone"));
      } catch (e) {
        toast(errorText(e), "error");
      }
      renderBackupsBody();
    },
  }, "archive");
  box.replaceChildren(
    h("div", { class: "section-head" }, h("h2", null, t("backup.server"))),
    h(
      "div",
      { class: "card pad stack" },
      h("div", { class: "setting plain" }, h("div", { class: "grow" }, h("strong", null, newest ? t("backup.serverLast", { when: ago(newest.at), size: bytes(newest.size), n: b.server.length }) : t("backup.serverNone")), h("p", { class: "muted small" }, t("backup.serverHint"))), h("div", { class: "row-actions" }, serverNow)),
      h("p", { class: "muted small" }, t("backup.serverRestore")),
      h("p", { class: "cmd" }, icon("terminal"), `sudo hata restore ${b.dir}`),
    ),
    h("div", { class: "section-head" }, h("h2", null, t("home.apps"))),
    b.apps.length
      ? h("div", { class: "card table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("backup.col.app")), h("th", null, t("backup.col.last")), h("th", { class: "num" }, t("backup.col.size")), h("th", { class: "num" }, t("backup.col.count")), h("th", null, t("backup.col.daily")), h("th"))), h("tbody", null, b.apps.map(row))))
      : h("p", { class: "card pad muted" }, t("backup.noApps")),
  );

  // the schedule form is redrawn only when it is not being edited
  const side = document.getElementById("backup-side");
  if (side.contains(document.activeElement)) return;
  const enabled = h("input", { type: "checkbox", checked: s.enabled });
  const time = h("input", { type: "time", value: s.time, class: "short mono", required: true });
  const keep = h("input", { type: "number", min: 1, max: 365, value: s.keep, class: "short mono", required: true });
  const dir = h("input", { value: s.dir, placeholder: b.dir, spellcheck: false, class: "mono" });
  const beforeUpdate = h("input", { type: "checkbox", checked: s.beforeUpdate });
  const error = h("p", { class: "error", role: "alert" });
  side.replaceChildren(
    h(
      "form",
      {
        class: "card pad stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            state.settings = await api("PUT", "/api/settings", { backup: { enabled: enabled.checked, time: time.value, keep: Number(keep.value), dir: dir.value.trim(), beforeUpdate: beforeUpdate.checked } });
            toast(t("settings.saved"));
            document.activeElement?.blur();
            await loadBackups();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("backup.schedule")),
      h("label", { class: "check" }, enabled, h("span", null, h("strong", null, t("backup.enable")), h("span", { class: "muted small block" }, t("backup.enableHint")))),
      h("div", { class: "field-row" }, field(`${t("backup.time")} · ${b.timezone}`, time), field(t("backup.keep"), keep)),
      field(t("backup.dir"), dir, t("backup.dirHint")),
      h("label", { class: "check" }, beforeUpdate, h("span", null, h("strong", null, t("backup.beforeUpdate")), h("span", { class: "muted small block" }, t("backup.beforeUpdateHint")))),
      error,
      h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
    ),
    h("p", { class: "muted small pad-x" }, t("backup.how")),
  );
}

// --- Files --------------------------------------------------------------------------------------
// The server's files. Paths are the real ones; the page opens in the data root.

const filesUi = {
  mode: localStorage.getItem("hata.files.mode") === "grid" ? "grid" : "list",
  sort: ["name", "modified", "size"].find((key) => key === localStorage.getItem("hata.files.sort")) ?? "name",
  /** Names selected in the folder on screen */
  selected: new Set(),
};

const filesHash = (path) => "#/files" + (path.split("/").filter(Boolean).map((part) => "/" + encodeURIComponent(part)).join("") || "/");
const within = (path, dir) => path === dir || path.startsWith(dir === "/" ? "/" : dir + "/");

/** Puts text on the clipboard; on plain HTTP browsers offer no clipboard API, so the old way steps in */
function copyText(text) {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    const area = h("textarea", { class: "offscreen", value: text, readOnly: true });
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(t("files.pathCopied", { path: text }));
}
const joinPath = (dir, name) => (dir === "/" ? "" : dir) + "/" + name;
const rawUrl = (path, download = false) => `/api/files/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

// What the browser can show itself; the rest is downloaded.
const FILE_KINDS = {
  image: "jpg jpeg png gif webp avif bmp svg ico",
  video: "mp4 m4v webm mov mkv ogv",
  audio: "mp3 m4a aac ogg oga opus wav flac",
  pdf: "pdf",
  text: "txt md log csv json yml yaml toml ini conf cfg env xml html css js ts sh py service properties list sql",
};
const KIND_BY_EXT = Object.fromEntries(Object.entries(FILE_KINDS).flatMap(([kind, list]) => list.split(" ").map((ext) => [ext, kind])));
const KIND_ICONS = { dir: "folder", image: "image", video: "film", audio: "music" };
/** Images up to this size are shown as their own thumbnails: there is no smaller copy of them */
const THUMB_MAX = 6 * 1024 * 1024;
const TEXT_MAX = 1024 * 1024;

function fileKind(entry) {
  if (entry.type !== "file") return entry.type;
  const dot = entry.name.lastIndexOf(".");
  return KIND_BY_EXT[dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : ""] ?? "file";
}

const fileIcon = (entry) => icon(KIND_ICONS[fileKind(entry)] ?? "file", entry.type === "dir" ? "folder-ico" : "");
const fileTime = (ts) => (new Date(ts).getFullYear() === new Date().getFullYear() ? dateTime(ts) : new Date(ts).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" }));

function sortedEntries(entries) {
  const collator = new Intl.Collator(state.lang, { numeric: true, sensitivity: "base" });
  const by = { name: () => 0, modified: (a, b) => b.modified - a.modified, size: (a, b) => b.size - a.size }[filesUi.sort];
  return [...entries].sort((a, b) => ((a.type === "dir") === (b.type === "dir") ? by(a, b) || collator.compare(a.name, b.name) : a.type === "dir" ? -1 : 1));
}

/** Puts a folder on the dashboard or takes it off */
async function pinFolder(path, pinned, quiet = true) {
  try {
    const res = await api("POST", "/api/files/pin", { path, pinned });
    if (state.files) state.files.pinned = res.pinned;
    toast(t(pinned ? "files.pinnedDone" : "files.unpinnedDone", { name: path.split("/").pop() || "/" }));
  } catch (e) {
    // a dialog shows the reason itself
    if (!quiet) throw e;
    return toast(errorText(e), "error");
  }
  await refresh();
  if (state.route.view === "files") renderFilesBody();
}

const onFiles = (path) => state.route.view === "files" && state.route.path === path;

async function loadFiles() {
  const path = state.route.path;
  let listing;
  try {
    listing = await api("GET", `/api/files?path=${encodeURIComponent(path)}`);
  } catch (e) {
    listing = { path, home: state.files?.home ?? "", entries: [], places: state.files?.places ?? [], disk: state.files?.disk ?? null, error: errorText(e) };
  }
  if (!onFiles(path)) return;
  if (path !== listing.path) {
    // the page was opened without a folder: the address becomes the data root's
    state.route.path = listing.path;
    history.replaceState(null, "", filesHash(listing.path));
  }
  const names = new Set(listing.entries.map((entry) => entry.name));
  filesUi.selected = new Set(state.files?.path === listing.path ? [...filesUi.selected].filter((name) => names.has(name)) : []);
  state.files = listing;
  renderFilesBody();
}

function renderFiles() {
  const box = h("div", { class: "files" }, h("aside", { class: "cats", id: "files-places" }), h("section", { class: "stack", id: "files-main" }));
  // files and folders dropped anywhere on the page go into the folder on screen
  let depth = 0;
  const dragging = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  box.addEventListener("dragenter", (e) => dragging(e) && (e.preventDefault(), depth++, box.classList.add("dropping")));
  box.addEventListener("dragover", (e) => dragging(e) && e.preventDefault());
  box.addEventListener("dragleave", (e) => dragging(e) && --depth <= 0 && ((depth = 0), box.classList.remove("dropping")));
  box.addEventListener("drop", async (e) => {
    if (!dragging(e)) return;
    e.preventDefault();
    depth = 0;
    box.classList.remove("dropping");
    const dir = state.route.path;
    queueUpload(dir, await droppedFiles(e.dataTransfer));
  });
  shell(box);
  renderFilesBody();
}

function renderFilesBody() {
  const main = document.getElementById("files-main");
  if (!main) return;
  const path = state.route.path;
  const listing = state.files?.path === path ? state.files : null;
  const parts = path.split("/").filter(Boolean);

  const home = state.files?.home ?? "";
  const inHome = home !== "" && within(path, home);
  const place = (label, to, iconName, active) => h("a", { class: "cat" + (active ? " active" : ""), href: filesHash(to) }, h("span", { class: "with-icon" }, icon(iconName), h("span", { class: "clip" }, label)));
  const disk = state.files?.disk;
  const used = disk ? Math.round(((disk.total - disk.free) / disk.total) * 100) : 0;
  const fill = h("i", { class: level(used) });
  fill.style.width = used + "%";
  put(
    document.getElementById("files-places"),
    h("div", { class: "cat-title" }, t("files.places")),
    home && place(t("files.home"), home, "home", path === home),
    home && (state.files?.places ?? []).map((name) => place(name, joinPath(home, name), name === "AppData" ? "box" : "folder", within(path, joinPath(home, name)))),
    place(t("files.root"), "/", "disk", path !== "" && !inHome),
    disk && h("div", { class: "cat-title" }, t("files.disk")),
    disk && h("div", { class: "files-disk" }, h("div", { class: "bar" }, fill), h("span", { class: "muted small" }, t("files.free", { free: bytes(disk.free), total: bytes(disk.total) }))),
  );

  const crumbs = h(
    "h1",
    { class: "path" },
    parts.length ? h("a", { href: filesHash("/"), title: t("files.root"), "aria-label": t("files.root") }, "/") : h("span", null, path ? t("files.root") : " "),
    parts.map((part, i) => [i > 0 && icon("chevron"), i === parts.length - 1 ? h("span", null, part) : h("a", { href: filesHash("/" + parts.slice(0, i + 1).join("/")) }, part)]),
  );
  const entries = listing ? sortedEntries(listing.entries) : [];
  const dirs = entries.filter((entry) => entry.type === "dir");
  const rest = entries.filter((entry) => entry.type !== "dir");
  const picker = h("input", { type: "file", multiple: true, hidden: true, onchange: () => (queueUpload(path, [...picker.files].map((file) => ({ file, sub: "" }))), (picker.value = "")) });
  const setMode = (mode) => {
    filesUi.mode = mode;
    localStorage.setItem("hata.files.mode", mode);
    renderFilesBody();
  };
  const modeButton = (mode, iconName) => h("button", { type: "button", class: "btn square" + (filesUi.mode === mode ? " active" : ""), title: t("files.view." + mode), "aria-label": t("files.view." + mode), "aria-pressed": String(filesUi.mode === mode), onclick: () => setMode(mode) }, icon(iconName));
  const sort = h(
    "select",
    { class: "sort", "aria-label": t("files.sort"), onchange: () => ((filesUi.sort = sort.value), localStorage.setItem("hata.files.sort", sort.value), renderFilesBody()) },
    ["name", "modified", "size"].map((key) => h("option", { value: key, selected: filesUi.sort === key }, t("files.sort." + key))),
  );

  const isPinned = (listing?.pinned ?? []).includes(path);
  const head = h(
    "div",
    { class: "page-head" },
    h(
      "div",
      null,
      crumbs,
      h("p", { class: "meta" }, path && h("button", { type: "button", class: "copy-path", title: t("files.copyPath"), "aria-label": t("files.copyPath"), onclick: () => copyText(path) }, h("span", null, path), icon("copy")), listing?.readOnly && h("span", { class: "chip warn" }, t("files.readOnly")), listing && !listing.error && h("span", { class: "dot-sep" }, "·"), listing && !listing.error && t("files.count", { dirs: dirs.length, files: rest.length }), rest.length > 0 && h("span", { class: "dot-sep" }, "·"), rest.length > 0 && bytes(rest.reduce((n, entry) => n + entry.size, 0))),
    ),
    h("div", { class: "actions" }, listing && !listing.error && h("button", { type: "button", class: "btn square" + (isPinned ? " active" : ""), title: t(isPinned ? "files.unpin" : "files.pin"), "aria-label": t(isPinned ? "files.unpin" : "files.pin"), "aria-pressed": String(isPinned), onclick: () => pinFolder(path, !isPinned) }, icon("pin")), sort, h("div", { class: "seg" }, modeButton("list", "list"), modeButton("grid", "grid")), button(t("files.newFolder"), { disabled: !listing || !!listing.error || listing.readOnly, onclick: () => newFolderDialog(path, loadFiles) }, "folder"), button(t("files.upload"), { class: "primary", disabled: !listing || !!listing.error || listing.readOnly, onclick: () => picker.click() }, "upload"), picker),
  );

  const selection = h("div", { class: "card selection", id: "files-selection", hidden: true });
  let body;
  if (!listing) body = h("p", { class: "muted" }, " ");
  else if (listing.error) body = h("p", { class: "card pad error" }, listing.error);
  else if (!entries.length) body = h("div", { class: "card empty" }, icon("folder"), h("p", null, t("files.empty")), h("p", { class: "small" }, t("files.dropHint")));
  else body = filesUi.mode === "grid" ? filesGrid(dirs, rest) : filesTable(entries);

  put(main, head, selection, body, listing?.truncated && h("p", { class: "muted small" }, t("files.truncated")), uploadBox);
  renderSelection();
}

const selectedEntries = () => (state.files?.entries ?? []).filter((entry) => filesUi.selected.has(entry.name));

function toggleSelected(entry, on) {
  if (on) filesUi.selected.add(entry.name);
  else filesUi.selected.delete(entry.name);
  for (const el of document.querySelectorAll("#files-main [data-name]")) {
    if (el.dataset.name !== entry.name) continue;
    el.classList.toggle("selected", on);
    el.querySelector("input[type=checkbox]").checked = on;
  }
  renderSelection();
}

function renderSelection() {
  const box = document.getElementById("files-selection");
  if (!box) return;
  const chosen = selectedEntries();
  box.hidden = !chosen.length;
  const all = document.getElementById("files-all");
  if (all) {
    all.checked = chosen.length > 0 && chosen.length === state.files.entries.length;
    all.indeterminate = chosen.length > 0 && !all.checked;
  }
  if (!chosen.length) return;
  put(box,
    h("strong", { class: "grow" }, t("files.selected", { n: chosen.length }), h("span", { class: "muted small" }, " · " + bytes(chosen.reduce((n, entry) => n + entry.size, 0)))),
    button(t("files.download"), { class: "small", onclick: () => downloadEntries(chosen) }, "download"),
    button(t("files.move"), { class: "small", onclick: () => transferDialog(chosen, false) }, "arrow"),
    button(t("files.copy"), { class: "small", onclick: () => transferDialog(chosen, true) }, "copy"),
    button(t("files.delete"), { class: "small", onclick: () => deleteDialog(chosen) }, "trash"),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("files.clearSelection"), title: t("files.clearSelection"), onclick: () => ((filesUi.selected = new Set()), renderFilesBody()) }, icon("x")),
  );
}

const entryCheckbox = (entry) => h("input", { type: "checkbox", checked: filesUi.selected.has(entry.name), "aria-label": entry.name, onclick: (e) => e.stopPropagation(), onchange: (e) => toggleSelected(entry, e.target.checked) });
const entryMore = (entry) => h("button", { type: "button", class: "icon-btn", "aria-label": `${t("files.actions")}: ${entry.name}`, title: t("files.actions"), onclick: (e) => (e.preventDefault(), e.stopPropagation(), entryMenu(entry)) }, icon("more"));
/** A folder is a link (so it opens in a new tab too); a file opens in place */
const entryOpener = (entry, className, ...content) =>
  entry.type === "dir"
    ? h("a", { class: className, href: filesHash(joinPath(state.files.path, entry.name)) }, content)
    : h("button", { type: "button", class: className, onclick: () => openEntry(entry) }, content);

function filesTable(entries) {
  const all = h("input", {
    type: "checkbox",
    id: "files-all",
    "aria-label": t("files.selectAll"),
    onchange: () => ((filesUi.selected = new Set(all.checked ? entries.map((entry) => entry.name) : [])), renderFilesBody()),
  });
  const row = (entry) =>
    h(
      "tr",
      { class: filesUi.selected.has(entry.name) ? "selected" : "", "data-name": entry.name },
      h("td", { class: "tick" }, entryCheckbox(entry)),
      h("td", { class: "name" }, entryOpener(entry, "file-name", fileIcon(entry), h("span", { class: "clip" }, entry.name), entry.link && icon("link", "faint"))),
      h("td", { class: "num muted" }, entry.type === "file" ? bytes(entry.size) : "—"),
      h("td", { class: "muted when" }, fileTime(entry.modified)),
      h("td", { class: "tick" }, entryMore(entry)),
    );
  return h("div", { class: "card table-wrap" }, h("table", { class: "file-table" }, h("thead", null, h("tr", null, h("th", { class: "tick" }, all), h("th", null, t("files.col.name")), h("th", { class: "num" }, t("files.col.size")), h("th", { class: "when" }, t("files.col.modified")), h("th"))), h("tbody", null, entries.map(row))));
}

function filesGrid(dirs, rest) {
  const tile = (entry) => {
    const thumb = fileKind(entry) === "image" && entry.size <= THUMB_MAX ? h("img", { src: rawUrl(joinPath(state.files.path, entry.name)), alt: "", loading: "lazy", decoding: "async" }) : fileIcon(entry);
    return h(
      "div",
      { class: "file-tile" + (entry.type === "dir" ? " dir" : "") + (filesUi.selected.has(entry.name) ? " selected" : ""), "data-name": entry.name },
      entryOpener(entry, "file-open", entry.type !== "dir" && h("span", { class: "thumb" }, thumb), entry.type === "dir" && fileIcon(entry), h("span", { class: "file-text" }, h("span", { class: "clip strong" }, entry.name), h("span", { class: "muted small clip" }, entry.type === "file" ? `${bytes(entry.size)} · ${fileTime(entry.modified)}` : fileTime(entry.modified)))),
      h("span", { class: "file-tick" }, entryCheckbox(entry)),
      h("span", { class: "file-more" }, entryMore(entry)),
    );
  };
  return h(
    "div",
    { class: "stack" },
    dirs.length > 0 && h("div", { class: "cat-title" }, t("files.folders")),
    dirs.length > 0 && h("div", { class: "file-grid dirs" }, dirs.map(tile)),
    rest.length > 0 && h("div", { class: "cat-title" }, t("files.files")),
    rest.length > 0 && h("div", { class: "file-grid" }, rest.map(tile)),
  );
}

function openEntry(entry) {
  const kind = fileKind(entry);
  const path = joinPath(state.files.path, entry.name);
  if (kind === "image" || kind === "video" || kind === "audio") return mediaDialog(entry);
  if (kind === "pdf") return void window.open(rawUrl(path), "_blank", "noopener");
  if (kind === "text" && entry.size <= TEXT_MAX) return void textDialog(path);
  entryMenu(entry);
}

/** One or several files and folders: a single file as it is, anything else as a ZIP archive */
async function downloadEntries(entries) {
  const dir = state.files.path;
  const save = (href) => h("a", { href, download: "" }).click();
  if (entries.length === 1 && entries[0].type === "file") return save(rawUrl(joinPath(dir, entries[0].name), true));
  try {
    // the archive is streamed, so its limits are checked before it starts
    const sum = await api("POST", "/api/files/summary", { paths: entries.map((entry) => joinPath(dir, entry.name)) });
    if (sum.truncated || sum.size > 3.8 * 1024 ** 3 || sum.files + sum.dirs > 60000) return toast(t("error.files.archiveTooLarge"), "error");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  save("/api/files/zip?" + entries.map((entry) => "path=" + encodeURIComponent(joinPath(dir, entry.name))).join("&"));
}

function entryMenu(entry) {
  let dialog;
  const kind = fileKind(entry);
  const path = joinPath(state.files.path, entry.name);
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu",
    h("header", null, h("span", { class: "badge-icon plain" }, fileIcon(entry)), h("div", null, h("h2", { class: "clip" }, entry.name), h("span", { class: "muted small" }, entry.type === "file" ? `${bytes(entry.size)} · ${fileTime(entry.modified)}` : fileTime(entry.modified)))),
    entry.type === "dir" && item(t("common.open"), "folder", () => go(filesHash(path))),
    ["image", "video", "audio", "pdf"].includes(kind) && item(t("common.open"), "external", () => openEntry(entry)),
    entry.type === "file" && entry.size <= TEXT_MAX && !["image", "video", "audio", "pdf"].includes(kind) && item(t("files.edit"), "edit", () => textDialog(path)),
    entry.type !== "other" && item(t(entry.type === "dir" ? "files.downloadZip" : "files.download"), "download", () => downloadEntries([entry])),
    item(t("files.copyPath"), "link", () => copyText(path)),
    entry.type === "dir" && (state.files.pinned.includes(path) ? item(t("files.unpin"), "pin", () => pinFolder(path, false)) : item(t("files.pin"), "pin", () => pinFolder(path, true))),
    item(t("files.rename"), "edit", () => renameDialog(entry)),
    item(t("files.move"), "arrow", () => transferDialog([entry], false)),
    item(t("files.copy"), "copy", () => transferDialog([entry], true)),
    item(t("files.delete"), "trash", () => deleteDialog([entry]), "danger"),
  );
}

/** Asks for one name: a new folder, a new name */
function nameDialog(title, value, confirmLabel, action) {
  const input = h("input", { value, required: true, maxLength: 255, spellcheck: false, autocomplete: "off" });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await action(input.value.trim());
            dialog.close();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, title),
      input,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, confirmLabel)),
    ),
  );
  input.focus();
  // the name without its extension is what gets retyped
  const dot = value.lastIndexOf(".");
  input.setSelectionRange(0, dot > 0 ? dot : value.length);
}

const newFolderDialog = (dir, done) =>
  nameDialog(t("files.newFolder"), "", t("files.create"), async (name) => {
    await api("POST", "/api/files/folder", { path: dir, name });
    await done();
  });

const renameDialog = (entry) =>
  nameDialog(t("files.renameTitle", { name: entry.name }), entry.name, t("files.rename"), async (name) => {
    await api("POST", "/api/files/rename", { path: joinPath(state.files.path, entry.name), name });
    await loadFiles();
  });

async function deleteDialog(entries) {
  const dir = state.files.path;
  const paths = entries.map((entry) => joinPath(dir, entry.name));
  let sum;
  try {
    sum = await api("POST", "/api/files/summary", { paths });
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, entries.length === 1 ? t("files.deleteTitle", { name: entries[0].name }) : t("files.deleteMany", { n: entries.length })),
    h("p", { class: "muted" }, t("files.deleteLead", { files: sum.truncated ? sum.files + "+" : sum.files, dirs: sum.dirs, size: bytes(sum.size) })),
    within(dir, joinPath(state.files.home, "AppData")) ? h("p", { class: "banner small" }, t("files.deleteAppData")) : null,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("files.deleteForever"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("POST", "/api/files/delete", { paths });
          } catch (err) {
            toast(errorText(err), "error");
          }
          dialog.close();
          await loadFiles();
        },
      }, "trash"),
    ),
  );
}

/** Picks the folder to move or copy into */
/** Walks the folders of the server to choose one: `allowed(at)` says whether the current one will do */
function folderPicker({ title, start, confirmLabel, action, allowed = () => true, shown = () => true }) {
  let at = start;
  let dialog;
  const crumbs = h("div", { class: "crumbs wrap" });
  const folders = h("div", { class: "picker" });
  const error = h("p", { class: "error", role: "alert" });
  const confirm = button(confirmLabel, {
    class: "primary",
    onclick: async () => {
      confirm.disabled = true;
      error.textContent = "";
      try {
        await action(at);
        dialog.close();
      } catch (e) {
        error.textContent = errorText(e);
        confirm.disabled = false;
      }
    },
  });
  const show = async (path) => {
    let listing;
    try {
      listing = await api("GET", `/api/files?path=${encodeURIComponent(path)}`);
    } catch (e) {
      return void (error.textContent = errorText(e));
    }
    at = listing.path;
    error.textContent = "";
    const parts = at.split("/").filter(Boolean);
    const crumb = (label, to) => h("button", { type: "button", class: "crumb", onclick: () => show(to) }, label);
    put(crumbs, crumb("/", "/"), parts.map((part, i) => [i > 0 && icon("chevron"), crumb(part, "/" + parts.slice(0, i + 1).join("/"))]));
    const inner = sortedEntries(listing.entries).filter((entry) => entry.type === "dir" && shown(joinPath(at, entry.name)));
    put(folders, inner.length ? inner.map((entry) => h("button", { type: "button", class: "menu-item", onclick: () => show(joinPath(at, entry.name)) }, icon("folder", "folder-ico"), h("span", { class: "clip grow" }, entry.name), icon("chevron", "faint"))) : h("p", { class: "muted small pad" }, t("files.noFolders")));
    confirm.disabled = !allowed(at);
  };
  dialog = openDialog("wide", h("h2", { class: "wrap" }, title), crumbs, folders, error, h("footer", null, button(t("files.newFolder"), { onclick: () => newFolderDialog(at, () => show(at)) }, "folder"), closeButton(() => dialog, t("common.cancel")), confirm));
  void show(at);
}

function transferDialog(entries, copy) {
  const from = state.files.path;
  const paths = entries.map((entry) => joinPath(from, entry.name));
  folderPicker({
    title: t(copy ? "files.copyTitle" : "files.moveTitle", { what: entries.length === 1 ? entries[0].name : t("files.items", { n: entries.length }) }),
    start: from,
    confirmLabel: t(copy ? "files.copyHere" : "files.moveHere"),
    allowed: (at) => copy || at !== from,
    // a folder cannot go into itself
    shown: (path) => copy || !paths.includes(path),
    action: async (to) => {
      await api("POST", copy ? "/api/files/copy" : "/api/files/move", { paths, to });
      toast(t(copy ? "files.copied" : "files.moved", { n: entries.length, to: to === "/" ? "/" : to.split("/").pop() }));
      await loadFiles();
    },
  });
}

/** A picture, a video or a sound, with the pictures of the folder one keypress apart */
function mediaDialog(entry) {
  const list = sortedEntries(state.files.entries).filter((item) => ["image", "video", "audio"].includes(fileKind(item)));
  const dir = state.files.path;
  let current = entry;
  let dialog;
  const stage = h("div", { class: "stage" });
  const title = h("h2", { class: "clip" });
  const sub = h("p", { class: "muted small" });
  const step = (by) => {
    const next = list[list.findIndex((item) => item.name === current.name) + by];
    if (next) show(next);
  };
  const prev = h("button", { type: "button", class: "icon-btn", "aria-label": t("files.previous"), title: t("files.previous"), onclick: () => step(-1) }, icon("chevron", "flip"));
  const next = h("button", { type: "button", class: "icon-btn", "aria-label": t("files.next"), title: t("files.next"), onclick: () => step(1) }, icon("chevron"));
  const show = (item) => {
    current = item;
    const src = rawUrl(joinPath(dir, item.name));
    const kind = fileKind(item);
    put(stage, kind === "image" ? h("img", { src, alt: item.name }) : kind === "video" ? h("video", { src, controls: true, autoplay: true, playsInline: true }) : h("audio", { src, controls: true, autoplay: true }));
    title.textContent = item.name;
    sub.textContent = `${bytes(item.size)} · ${fileTime(item.modified)}`;
    const index = list.findIndex((other) => other.name === item.name);
    prev.disabled = index <= 0;
    next.disabled = index >= list.length - 1;
  };
  dialog = openDialog(
    "xwide viewer",
    h("header", null, h("div", { class: "grow" }, title, sub), list.length > 1 && prev, list.length > 1 && next, h("button", { type: "button", class: "icon-btn", "aria-label": t("files.download"), title: t("files.download"), onclick: () => downloadEntries([current]) }, icon("download")), closeX(() => dialog)),
    stage,
  );
  // the keys work wherever the focus is while the viewer is open
  const keys = (e) => {
    if (e.target instanceof HTMLMediaElement) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  };
  document.addEventListener("keydown", keys);
  // a video must not keep playing behind a closed dialog
  dialog.addEventListener("close", () => (document.removeEventListener("keydown", keys), put(stage)));
  show(entry);
}

async function textDialog(path) {
  let file;
  try {
    file = await api("GET", `/api/files/text?path=${encodeURIComponent(path)}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  let dialog;
  const area = h("textarea", { class: "code", spellcheck: false, value: file.content, wrap: "off", "aria-label": path });
  const error = h("p", { class: "error", role: "alert" });
  const save = button(t("settings.save"), {
    class: "primary",
    disabled: true,
    onclick: async () => {
      error.textContent = "";
      try {
        file = await api("PUT", "/api/files/text", { path, content: area.value, modified: file.modified });
        save.disabled = true;
        toast(t("settings.saved"));
        if (onFiles(state.files?.path)) void loadFiles();
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  area.addEventListener("input", () => (save.disabled = area.value === file.content));
  dialog = openDialog("xwide", h("header", null, h("div", { class: "grow" }, h("h2", { class: "clip" }, path.split("/").pop()), h("p", { class: "muted small mono clip" }, path)), closeX(() => dialog)), area, error, h("footer", null, closeButton(() => dialog), save));
  // unsaved text is not lost to a stray click outside, the close button or Escape
  const keep = () => !save.disabled && !confirm(t("files.discard"));
  const close = dialog.close.bind(dialog);
  dialog.close = () => void (keep() || close());
  dialog.addEventListener("cancel", (e) => keep() && e.preventDefault());
}

// --- Files: upload ------------------------------------------------------------------------------
// Files go one after another, each in parts: a part is small enough for any proxy in front of Hata,
// and what has arrived is not lost when one part fails.

const UPLOAD_PART = 8 * 1024 * 1024;
const uploadBox = h("div", { class: "card upload", hidden: true });
const uploads = { queue: [], running: false, xhr: null, cancelled: false, count: 0, done: 0, bytes: 0, sent: 0, started: 0, failed: [], conflicts: [] };

/** Everything in a drop: files, and folders with what is in them */
async function droppedFiles(transfer) {
  const out = [];
  // entries must be taken before the first await: the drop's data is gone after it
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...transfer.files].map((file) => ({ file, sub: "" }));
  const walk = async (entry, sub) => {
    if (entry.isFile) out.push({ file: await new Promise((ok, no) => entry.file(ok, no)), sub });
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        // a folder is read in batches; an empty batch ends it
        const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const child of batch) await walk(child, sub ? `${sub}/${entry.name}` : entry.name);
      }
    }
  };
  for (const entry of entries) await walk(entry, "").catch(() => {});
  return out;
}

function sendPart(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    uploads.xhr = xhr;
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onerror = xhr.onabort = () => reject(new ApiError(0, "network"));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(xhr.status, payload.error?.code ?? "request.failed", payload.error?.detail));
    };
    xhr.send(blob);
  });
}

async function uploadOne({ dir, file, sub, overwrite }) {
  const id = crypto.getRandomValues(new Uint32Array(3)).reduce((text, n) => text + n.toString(36), "").padEnd(8, "0").slice(0, 24);
  const base = uploads.sent;
  let offset = 0;
  do {
    const blob = file.slice(offset, offset + UPLOAD_PART);
    const last = offset + blob.size >= file.size;
    const query = new URLSearchParams({ dir, name: file.name, sub, id, offset, last: last ? "1" : "0", overwrite: overwrite ? "1" : "0" });
    try {
      await sendPart("/api/files/upload?" + query, blob, (loaded) => ((uploads.sent = base + offset + loaded), paintUpload()));
    } catch (e) {
      if (offset > 0 || uploads.cancelled) void fetch(`/api/files/upload?${new URLSearchParams({ dir, sub, id })}`, { method: "DELETE" }).catch(() => {});
      uploads.sent = base + file.size;
      throw e;
    }
    offset += blob.size;
  } while (offset < file.size);
  uploads.sent = base + file.size;
}

function paintUpload() {
  const { count, done, bytes: total, sent, started } = uploads;
  const percent = total ? Math.min(100, Math.round((sent / total) * 100)) : 100;
  const seconds = (Date.now() - started) / 1000;
  const speed = seconds > 1 ? sent / seconds : 0;
  const fill = h("i");
  fill.style.width = percent + "%";
  put(uploadBox,
    icon("upload"),
    h("div", { class: "grow stack-s" }, h("div", { class: "upload-line" }, h("strong", { class: "grow clip" }, t("files.uploading", { done: Math.min(done + 1, count), n: count })), h("span", { class: "muted small mono" }, [percent + "%", speed && `${bytes(speed)}/s`, speed && sent < total && duration(Math.max(60, (total - sent) / speed))].filter(Boolean).join(" · "))), h("div", { class: "bar" }, fill)),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("common.cancel"), title: t("common.cancel"), onclick: () => ((uploads.cancelled = true), (uploads.queue = []), uploads.xhr?.abort()) }, icon("x")),
  );
}

function queueUpload(dir, items, overwrite = false) {
  if (!items.length) return;
  if (!uploads.running) Object.assign(uploads, { count: 0, done: 0, bytes: 0, sent: 0, started: Date.now(), failed: [], conflicts: [], cancelled: false });
  for (const item of items) {
    uploads.queue.push({ dir, overwrite, ...item });
    uploads.count++;
    uploads.bytes += item.file.size;
  }
  if (!uploads.running) void runUploads();
}

async function runUploads() {
  uploads.running = true;
  uploadBox.hidden = false;
  // leaving the page would cut the upload short
  const warn = (e) => e.preventDefault();
  window.addEventListener("beforeunload", warn);
  const touched = new Set();
  let item;
  while ((item = uploads.queue.shift())) {
    paintUpload();
    try {
      // a name that is plainly taken is not sent just to be refused
      if (!item.overwrite && !item.sub && state.files?.path === item.dir && state.files.entries.some((entry) => entry.name === item.file.name)) {
        uploads.sent += item.file.size;
        throw new ApiError(409, "files.exists");
      }
      await uploadOne(item);
      touched.add(item.dir);
    } catch (e) {
      if (uploads.cancelled) break;
      if (e.code === "files.exists" && !item.overwrite) uploads.conflicts.push(item);
      else uploads.failed.push({ item, error: errorText(e) });
    }
    uploads.done++;
  }
  window.removeEventListener("beforeunload", warn);
  uploads.running = false;
  uploadBox.hidden = true;
  const { failed, conflicts, cancelled } = uploads;
  const ok = uploads.done - failed.length - conflicts.length;
  if (cancelled) toast(t("files.uploadCancelled"));
  else if (failed.length) toast(t("files.uploadFailed", { name: failed[0].item.file.name, n: failed.length, error: failed[0].error }), "error");
  else if (ok > 0) toast(t("files.uploaded", { n: ok }));
  if (state.route.view === "files") void loadFiles();
  if (conflicts.length && !cancelled) replaceDialog(conflicts);
}

/** Files that are already there are never replaced without a question */
function replaceDialog(conflicts) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("files.replaceTitle", { n: conflicts.length })),
    h("ul", { class: "paths small" }, conflicts.slice(0, 8).map((item) => h("li", null, item.sub ? `${item.sub}/${item.file.name}` : item.file.name)), conflicts.length > 8 && h("li", null, "…")),
    h("footer", null, closeButton(() => dialog, t("files.skip")), button(t("files.replace"), { class: "danger", onclick: () => (dialog.close(), queueUpload(conflicts[0].dir, conflicts.map(({ file, sub }) => ({ file, sub })), true)) })),
  );
}

// --- Store --------------------------------------------------------------------------------------

async function loadStore() {
  try {
    state.store = await api("GET", `/api/store?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "store") renderStoreList();
}

async function syncStores() {
  toast(t("store.syncing"));
  for (const store of state.store?.stores ?? state.settings?.stores ?? []) {
    try {
      const res = await api("POST", `/api/store/${store.id}/sync`, {});
      toast(res.ok ? t("store.synced", { apps: res.apps }) : res.error, res.ok ? "info" : "error");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  await loadStore();
  if (state.route.view === "settings") renderSettings();
}

function renderStore() {
  const search = h("input", {
    type: "search",
    placeholder: t("store.search"),
    "aria-label": t("store.search"),
    value: state.storeFilter.query,
    oninput: () => {
      state.storeFilter.query = search.value;
      renderStoreList();
    },
  });
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("nav.store")), h("p", { class: "meta", id: "store-meta" }, " ")), isAdmin() && h("div", { class: "actions" }, button(t("store.sync"), { class: "ghost", onclick: syncStores }, "refresh"), h("a", { class: "btn", href: "#/import" }, icon("download"), h("span", null, t("import.open"))), button(t("store.custom"), { onclick: customDialog }, "plus"))),
    h("div", { class: "search wide" }, icon("search"), search),
    h("div", { class: "store" }, h("nav", { class: "cats", id: "cats", "aria-label": t("store.categories") }), h("div", { id: "store-list" })),
  );
  renderStoreList();
}

function renderStoreList() {
  const list = document.getElementById("store-list");
  const cats = document.getElementById("cats");
  if (!list || !state.store) return;
  const { query, category } = state.storeFilter;
  const all = state.store.apps;
  const installed = new Set((state.overview?.apps ?? []).map((a) => a.name));

  const synced = Math.max(0, ...state.store.stores.map((s) => s.syncedAt));
  document.getElementById("store-meta")?.replaceChildren(t("store.meta", { stores: state.store.stores.length, apps: all.length }), synced ? h("span", { class: "dot-sep" }, "·") : "", synced ? t("store.syncedAgo", { time: ago(synced) }) : "");

  const cat = (value, label, n) =>
    h(
      "button",
      {
        type: "button",
        class: "cat" + (category === value ? " active" : ""),
        "aria-pressed": String(category === value),
        onclick: () => {
          state.storeFilter.category = value;
          renderStoreList();
        },
      },
      h("span", null, label),
      h("span", { class: "muted small" }, n),
    );
  cats.replaceChildren(
    h("div", { class: "cat-title" }, t("store.categories")),
    cat("", t("store.all"), all.length),
    cat("*", t("store.recommended"), all.filter((a) => a.recommended).length),
    ...state.store.categories.map((c) => cat(c, c, all.filter((a) => a.category === c).length)).filter((_, i) => all.some((a) => a.category === state.store.categories[i])),
    h("div", { class: "cat-title" }, t("store.onServer")),
    cat("+", t("store.installed"), all.filter((a) => installed.has(a.name)).length),
  );

  const q = query.trim().toLowerCase();
  const inCategory = (a) => category === "" || (category === "*" ? a.recommended : category === "+" ? installed.has(a.name) : a.category === category);
  const apps = all.filter((a) => (!q || `${a.title} ${a.name} ${a.tagline}`.toLowerCase().includes(q)) && inCategory(a));
  if (!all.length) {
    const busy = state.store.stores.some((s) => s.syncing);
    return list.replaceChildren(h("div", { class: "empty" }, h("p", null, t(busy ? "store.syncing" : "store.empty")), !busy && button(t("store.sync"), { class: "primary", onclick: syncStores }, "refresh")));
  }
  if (!apps.length) return list.replaceChildren(h("p", { class: "empty" }, t("store.nothing")));
  list.replaceChildren(
    h("div", { class: "section-head" }, h("h2", null, category && category !== "*" && category !== "+" ? category : t(category === "*" ? "store.recommended" : category === "+" ? "store.installed" : "store.allApps"), h("span", { class: "muted small" }, apps.length))),
    h(
      "div",
      { class: "cards" },
      apps.map((a) =>
        h(
          "button",
          { type: "button", class: "store-card" + (a.supported ? "" : " unsupported"), onclick: () => (installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)) },
          h("span", { class: "store-card-head" }, appIcon(a), h("span", { class: "grow" }, h("span", { class: "tile-name" }, a.title), h("span", { class: "muted small" }, a.category)), installed.has(a.name) ? h("span", { class: "chip ok" }, icon("check"), t("store.installed")) : h("span", { class: "chip" }, t("store.install"))),
          h("span", { class: "tagline" }, a.tagline),
        ),
      ),
    ),
  );
}

function formSection(title, hint, rows) {
  return rows.length > 0 && h("section", { class: "form-section" }, h("div", { class: "form-head" }, h("h3", null, title), hint && h("span", { class: "muted small" }, hint)), rows);
}

async function storeDialog(entry) {
  let app;
  try {
    app = await api("GET", `/api/store/${entry.store}/apps/${entry.name}?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const supported = app.architectures.length === 0 || app.architectures.includes(state.overview?.arch);
  const inputs = { ports: [], volumes: [], envs: [] };
  const formRow = (label, control, note) => h("label", { class: "form-row" }, h("span", { class: "form-label" }, label), h("span", { class: "form-control" }, control, note && h("span", { class: "muted small" }, note)));

  const ports = app.form.ports.map((p) => {
    const input = h("input", { value: p.published, inputMode: "numeric", pattern: "[0-9]*", class: "short mono" });
    inputs.ports.push({ service: p.service, target: p.target, protocol: p.protocol, input });
    return formRow(p.description || t("store.port"), h("span", { class: "pair" }, input, h("span", { class: "muted small mono" }, `→ ${p.target}/${p.protocol}`), p.busy && h("span", { class: "chip warn" }, t("store.portBusy"))));
  });
  const volumes = app.form.volumes.map((v) => {
    const input = h("input", { value: v.source, spellcheck: false, class: "mono" });
    inputs.volumes.push({ service: v.service, target: v.target, input });
    return formRow(v.description || v.target, input, `→ ${v.target}`);
  });
  const envs = app.form.envs.map((e) => {
    const secret = /pass|secret|token|key/i.test(e.name);
    const input = h("input", { value: e.value, spellcheck: false, autocomplete: "off", class: "mono", type: secret && e.value === "" ? "password" : "text" });
    inputs.envs.push({ service: e.service, name: e.name, input });
    return formRow(h("span", { class: "mono small" }, e.name), input, e.description);
  });

  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const install = button(t(app.installed ? "store.installed" : "store.install"), {
    class: "primary",
    disabled: app.installed || !supported || !isAdmin(),
    onclick: async () => {
      install.disabled = true;
      error.textContent = "";
      const form = {
        ports: inputs.ports.map(({ input, ...p }) => ({ ...p, published: input.value })),
        volumes: inputs.volumes.map(({ input, ...v }) => ({ ...v, source: input.value })),
        envs: inputs.envs.map(({ input, ...e }) => ({ ...e, value: input.value })),
      };
      try {
        const res = await api("POST", "/api/apps", { store: app.store, name: app.name, form });
        dialog.close();
        jobDialog(res.job, "install", app.title, () => go(`#/apps/${app.name}`));
      } catch (e) {
        error.textContent = errorText(e);
        install.disabled = false;
      }
    },
  });

  const hasForm = isAdmin() && ports.length + volumes.length + envs.length > 0;
  dialog = openDialog(
    "xwide store-app",
    h("header", null, appIcon(app, "lg"), h("div", { class: "grow" }, h("h2", null, app.title), h("p", { class: "muted" }, app.tagline), h("p", { class: "muted small" }, [app.category, app.developer && t("store.by", { developer: app.developer })].filter(Boolean).join(" · "))), closeX(() => dialog)),
    !supported && h("p", { class: "banner" }, t("store.unsupported", { arch: state.overview?.arch ?? "" })),
    h(
      "div",
      { class: "store-app-body" },
      h(
        "div",
        { class: "stack" },
        app.screenshots.length > 0 && h("div", { class: "shots" }, app.screenshots.map((src) => h("img", { src, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }))),
        h("p", { class: "description" }, app.description),
        app.tips && h("div", { class: "tips" }, h("strong", null, t("store.tips")), h("p", null, app.tips)),
        app.website && h("a", { class: "link", href: app.website, target: "_blank", rel: "noopener noreferrer" }, app.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), icon("external")),
      ),
      hasForm && h("div", { class: "stack install-form" }, formSection(t("store.ports"), t("store.portsHint"), ports), formSection(t("store.volumes"), state.settings ? t("store.volumesHint", { path: state.settings.dataRoot }) : "", volumes), formSection(t("store.envs"), t("store.envsHint"), envs)),
    ),
    error,
    h("footer", null, h("p", { class: "cmd grow" }, icon("terminal"), `docker compose -p ${app.name} up -d`), closeButton(() => dialog, t("common.cancel")), install),
  );
  // the dialog would otherwise put the focus ring on its close button
  (install.disabled ? dialog : install).focus();
}

function customDialog() {
  const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono" });
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", required: true, placeholder: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - 8088:80\n" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            const res = await api("POST", "/api/apps", { name: name.value.trim(), compose: area.value });
            dialog.close();
            jobDialog(res.job, "install", name.value.trim(), () => go(`#/apps/${name.value.trim()}`));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("store.customTitle")), h("p", { class: "muted small" }, t("store.customLead"))), closeX(() => dialog)),
      field(t("store.customName"), name, t("store.customNameHint")),
      field(t("store.customCompose"), area),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("store.install"))),
    ),
  );
  name.focus();
}

// --- Import -------------------------------------------------------------------------------------
// What already runs on the machine and is not an app here yet: CasaOS's apps, compose projects started
// elsewhere, containers without a compose file.

async function loadImport() {
  try {
    state.import = await api("GET", "/api/import");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "import") renderImportBody();
}

function renderImport() {
  shell(
    h("nav", { class: "crumbs" }, h("a", { href: "#/store" }, t("nav.store")), icon("chevron"), h("span", null, t("import.title"))),
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("import.title")), h("p", { class: "muted" }, t("import.lead")))),
    h("div", { class: "stack import", id: "import-body" }),
  );
  renderImportBody();
}

const importWarnings = (warnings) => warnings.length > 0 && h("div", { class: "banner stack" }, warnings.map((code) => h("p", { class: "small" }, t("import.warn." + code))));

/** Shows the compose file an import would write; `confirm` gets the (possibly edited) text and the name */
function importDialog({ title, lead, name, compose, warnings, editable, action, steps, confirm }) {
  const nameInput = name != null && h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono", value: name });
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", required: true, readOnly: !editable, value: compose, "aria-label": "compose.yml" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await confirm(nameInput ? nameInput.value.trim() : null, area.value, () => dialog.close());
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, title), h("p", { class: "muted small" }, lead)), closeX(() => dialog)),
      importWarnings(warnings),
      nameInput && field(t("store.customName"), nameInput, t("store.customNameHint")),
      field(t("store.customCompose"), area),
      steps && h("ol", { class: "steps muted small" }, steps.map((step) => h("li", null, step))),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, action)),
    ),
  );
}

async function importProject(project) {
  let draft;
  try {
    draft = await api("GET", `/api/import/projects/${project.name}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  importDialog({
    title: t("import.projectTitle", { name: project.name }),
    lead: t("import.source." + draft.source),
    compose: draft.compose,
    warnings: draft.warnings,
    editable: false,
    action: t("import.take"),
    confirm: async (_name, _text, close) => {
      await api("POST", `/api/import/projects/${project.name}`, {});
      close();
      toast(t("import.taken", { name: project.name }));
      go(`#/apps/${project.name}`);
    },
  });
}

async function importContainer(container) {
  let draft;
  try {
    draft = await api("GET", `/api/import/containers/${container.id}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  importDialog({
    title: t("import.containerTitle", { name: draft.container }),
    lead: t("import.containerLead"),
    name: draft.name,
    compose: draft.compose,
    warnings: draft.warnings,
    editable: true,
    action: t("import.rebuild"),
    steps: [t("import.step.stop", { name: draft.container }), t("import.step.start"), t("import.step.remove"), t("import.step.undo")],
    confirm: async (name, text, close) => {
      const res = await api("POST", `/api/import/containers/${container.id}`, { name, compose: text });
      close();
      jobDialog(res.job, "import", name, () => go(`#/apps/${name}`));
    },
  });
}

function casaosCard(casaos) {
  const ready = casaos.apps.filter((app) => app.status === "ready");
  const stop = h("input", { type: "checkbox", checked: casaos.units.length > 0, disabled: casaos.units.length === 0 });
  const error = h("p", { class: "error", role: "alert" });
  const move = button(ready.length ? t("import.casaos.move", { n: ready.length }) : t("import.casaos.stopOnly"), {
    class: "primary",
    onclick: async () => {
      error.textContent = "";
      move.disabled = true;
      try {
        const result = await api("POST", "/api/import/casaos", { stop: stop.checked });
        toast(t("import.casaos.done", { n: result.moved.length }));
        if (result.stuck.length) toast(t("import.casaos.stuck", { units: result.stuck.join(", ") }), "error");
        await refresh();
      } catch (e) {
        error.textContent = errorText(e);
        move.disabled = false;
      }
    },
  }, "arrow");
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("import.casaos.title", { n: ready.length }))),
    h("p", { class: "muted" }, t("import.casaos.lead")),
    casaos.apps.length > 0 &&
      h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, casaos.apps.map((app) => h("tr", null, h("td", null, h("div", { class: "strong" }, app.title), h("div", { class: "muted small mono" }, app.source)), h("td", { class: "num" }, h("span", { class: "chip" + (app.status === "ready" ? " ok" : " warn") }, app.status === "ready" && icon("check"), t("import.casaos.status." + app.status)))))))),
    h("label", { class: "check" }, stop, h("span", null, h("strong", null, t("import.casaos.stop")), h("span", { class: "muted small block" }, casaos.units.length ? t("import.casaos.stopHint", { units: casaos.units.join(", ") }) : t("import.casaos.stopped")))),
    error,
    h("footer", { class: "section-head" }, h("p", { class: "cmd" }, icon("terminal"), "sudo hata migrate casaos --undo"), move),
  );
}

function renderImportBody() {
  const box = document.getElementById("import-body");
  const data = state.import;
  if (!box || !data) return;
  const problem = (item) => item.problem && h("span", { class: "chip warn", title: t("import.problem." + item.problem) }, t("import.problem." + item.problem));
  const table = (rows) => h("div", { class: "card table-wrap" }, h("table", null, h("tbody", null, rows)));

  const parts = [
    data.casaos && casaosCard(data.casaos),
    data.projects.length > 0 &&
      h(
        "section",
        { class: "stack" },
        h("div", { class: "section-head" }, h("h2", null, t("import.projects"), h("span", { class: "muted small" }, t("import.projectsHint")))),
        table(
          data.projects.map((p) =>
            h(
              "tr",
              null,
              h("td", null, h("div", { class: "strong" }, p.name), h("div", { class: "muted small mono clip" }, p.files.length ? p.files.join(", ") : p.images.join(", "))),
              h("td", null, h("span", { class: "state " + (p.running === 0 ? "stopped" : p.running === p.containers ? "running" : "partial") }, t("import.running", { running: p.running, n: p.containers }))),
              h("td", null, h("div", { class: "row-actions" }, problem(p) || button(t("import.take"), { class: "small", onclick: () => importProject(p) }))),
            ),
          ),
        ),
      ),
    data.containers.length > 0 &&
      h(
        "section",
        { class: "stack" },
        h("div", { class: "section-head" }, h("h2", null, t("import.containers"), h("span", { class: "muted small" }, t("import.containersHint")))),
        table(
          data.containers.map((c) =>
            h(
              "tr",
              null,
              h("td", null, h("div", { class: "strong" }, c.name), h("div", { class: "muted small mono clip" }, c.image)),
              h("td", null, h("span", { class: "state " + (c.state === "running" ? "running" : c.state === "restarting" ? "restarting" : "stopped"), title: c.status }, c.status)),
              h("td", null, h("div", { class: "row-actions" }, problem(c) || button(t("import.rebuild"), { class: "small", onclick: () => importContainer(c) }))),
            ),
          ),
        ),
      ),
    !data.casaos && !data.projects.length && !data.containers.length && h("div", { class: "card empty" }, icon("check", "ok"), h("p", null, t("import.nothing"))),
  ];
  box.replaceChildren(...parts.filter(Boolean));
}

// --- Settings -----------------------------------------------------------------------------------

async function loadSettings() {
  try {
    state.account = await api("GET", "/api/account");
    if (isAdmin()) state.settings = await api("GET", "/api/settings");
    if (isAdmin()) state.update = await api("GET", "/api/update").catch(() => null);
    if (!state.store && isAdmin()) state.store = await api("GET", `/api/store?lang=${state.lang}`).catch(() => null);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "settings") renderSettings();
}

const LANGUAGE_NAMES = { en: "English", uk: "Українська" };
const SECTIONS = [
  { id: "account", icon: "user" },
  { id: "general", icon: "sliders" },
  { id: "appearance", icon: "image", admin: true },
  { id: "apps", icon: "grid", admin: true },
  { id: "stores", icon: "store", admin: true },
  { id: "https", icon: "lock", admin: true },
  { id: "about", icon: "info" },
];
const sections = () => SECTIONS.filter((item) => !item.admin || isAdmin());

function settingRow(title, hint, control) {
  return h("div", { class: "setting" }, h("div", { class: "grow" }, h("strong", null, title), hint && h("p", { class: "muted small" }, hint)), h("div", { class: "setting-control" }, control));
}

/** Asks until the server answers with another version (the update went through) or says why it did not */
async function followUpdate(target) {
  const started = Date.now();
  while (Date.now() - started < 4 * 60_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const now = await fetch("/api/state").then((r) => (r.ok ? r.json() : null), () => null);
    // the new version brings a new UI with it
    if (now?.version === target) return location.reload();
    const status = await api("GET", "/api/update").catch(() => null);
    if (!status) continue;
    state.update = status;
    if (!status.stage && (status.error || status.last?.status === "rolledBack")) break;
  }
  if (state.route.view === "settings") renderSettings();
}

function updateRow() {
  const u = state.update;
  if (!u) return null;
  const busy = !!u.stage;
  const failed = !busy && u.last?.status === "rolledBack" && u.latest?.version === u.last.to;
  const hint = busy
    ? t("update.stage." + u.stage)
    : failed
      ? t("update.rolledBack", { version: u.last.to })
      : u.error
        ? t("update.error", { message: u.error })
        : u.available
          ? u.unsupported ? t("update.manual") : t("update.availableHint")
          : u.checkedAt ? t("update.upToDate", { time: ago(u.checkedAt) }) : t("update.notChecked");
  const check = button(t("update.check"), {
    class: "small ghost",
    disabled: busy,
    onclick: async () => {
      check.disabled = true;
      state.update = await api("POST", "/api/update/check", {}).catch(() => state.update);
      renderSettings();
    },
  }, "refresh");
  const install = u.available && !u.unsupported && button(t("update.install", { version: u.latest.version }), {
    class: "small primary",
    disabled: busy,
    onclick: async () => {
      try {
        await api("POST", "/api/update/install", {});
        state.update = { ...u, stage: "download", error: "" };
        renderSettings();
        void followUpdate(u.latest.version);
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
  }, "up");
  return settingRow(
    u.available ? t("update.available", { version: u.latest.version }) : t("update.title2"),
    hint,
    h("div", { class: "row-actions" }, u.available && u.latest.url && h("a", { class: "link small", href: u.latest.url, target: "_blank", rel: "noopener noreferrer" }, t("update.notes"), icon("external")), check, install),
  );
}

function settingsSection(section) {
  const s = state.settings;
  const d = state.overview?.docker;
  const error = h("p", { class: "error", role: "alert" });
  const save = async (patch) => {
    error.textContent = "";
    try {
      state.settings = await api("PUT", "/api/settings", patch);
      toast(t("settings.saved"));
    } catch (err) {
      error.textContent = errorText(err);
    }
  };

  if (section === "account") return accountSection();
  if (section === "appearance") return appearanceSection(error);
  if (section === "general") {
    const language = h(
      "select",
      {
        onchange: async () => {
          localStorage.setItem("hata.lang", language.value);
          await loadLanguage(language.value);
          state.store = null;
          await refresh();
          render();
          void loadSettings();
        },
      },
      state.languages.map((code) => h("option", { value: code, selected: code === state.lang }, LANGUAGE_NAMES[code] ?? code)),
    );
    const port = h("input", { type: "number", min: 1, max: 65535, class: "short mono", value: s?.port || "", placeholder: String(location.port || 80) });
    return [
      h("section", { class: "card pad" }, h("h2", null, t("settings.general")), settingRow(t("settings.language"), t("settings.languageHint"), language), isAdmin() && settingRow(t("settings.port"), t("settings.portHint"), h("span", { class: "pair" }, port, button(t("settings.save"), { onclick: () => save({ port: Number(port.value) || 0 }) }))), error),
    ];
  }
  if (section === "apps") {
    const dataRoot = h("input", { value: s.dataRoot, spellcheck: false, required: true, class: "mono" });
    const puid = h("input", { value: s.puid, type: "number", min: 0, max: 65534, class: "short mono", required: true });
    const pgid = h("input", { value: s.pgid, type: "number", min: 0, max: 65534, class: "short mono", required: true });
    const tz = h("input", { value: s.timezone, spellcheck: false, placeholder: s.systemTimezone, class: "mono" });
    return [
      h(
        "form",
        {
          class: "card pad",
          onsubmit: (e) => {
            e.preventDefault();
            void save({ dataRoot: dataRoot.value.trim(), puid: Number(puid.value), pgid: Number(pgid.value), timezone: tz.value.trim() });
          },
        },
        h("h2", null, t("settings.apps")),
        settingRow(t("settings.dataRoot"), t("settings.dataRootHint"), dataRoot),
        settingRow(t("settings.ids"), t("settings.idsHint"), h("span", { class: "pair" }, puid, pgid)),
        settingRow(t("settings.timezone"), t("settings.timezoneHint", { tz: s.systemTimezone }), tz),
        error,
        h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
      ),
    ];
  }
  if (section === "https") return httpsSection(save, error);
  if (section === "stores") {
    const stores = state.store?.stores ?? [];
    return [
      h(
        "section",
        { class: "card pad" },
        h("div", { class: "section-head" }, h("h2", null, t("settings.stores")), button(t("store.sync"), { onclick: syncStores }, "refresh")),
        stores.map((store) => settingRow(store.id, store.url, h("span", { class: "muted small" }, t("settings.storeApps", { n: store.apps }) + (store.syncedAt ? " · " + ago(store.syncedAt) : "")))),
        h("p", { class: "muted small" }, t("settings.storesHint")),
      ),
    ];
  }
  return [
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("settings.about")),
      settingRow("Hata", t("settings.aboutHint"), h("span", { class: "mono" }, state.version)),
      updateRow(),
      settingRow("Docker", d?.available ? "" : (d?.error ?? ""), h("span", { class: "mono" }, d?.available ? `${d.version} · compose ${d.compose}` : "—")),
      settingRow(t("settings.source"), "", h("a", { class: "link", href: "https://github.com/sanyadez/hata", target: "_blank", rel: "noopener noreferrer" }, "github.com/sanyadez/hata", icon("external"))),
    ),
  ];
}

const HTTPS_MODES = ["off", "proxy", "acme"];
/** Settings → HTTPS and domain: how Hata is reached */
const ACCENTS = ["#f5a524", "#ec6a5e", "#e0559a", "#9b6cf0", "#4f8ff7", "#22b8cf", "#3fbf7f", "#a3b82e"];
const BACKGROUNDS = ["#131110", "#0e1116", "#0f1a17", "#17121c", "#1a1212", "#000000", "#f6f3ef", "#eef2f6"];

function appearanceSection(error) {
  const look = state.settings.appearance;
  /** Shows the change at once and saves it; a refused one is taken back */
  const change = async (patch, redraw = true) => {
    const before = state.settings.appearance;
    state.settings.appearance = state.appearance = { ...before, ...patch };
    applyAppearance(state.appearance);
    if (redraw) renderSettings();
    try {
      state.settings = await api("PUT", "/api/settings", { appearance: patch });
      state.appearance = state.settings.appearance;
    } catch (e) {
      state.settings.appearance = state.appearance = before;
      applyAppearance(before);
      renderSettings();
      toast(errorText(e), "error");
    }
  };
  const colours = (key, presets, fallback) => {
    const current = look[key];
    const custom = h("input", { type: "color", value: current || fallback, title: t("appearance.custom"), "aria-label": t("appearance.custom"), oninput: () => applyAppearance({ ...state.appearance, [key]: custom.value }), onchange: () => change({ [key]: custom.value }) });
    return h(
      "div",
      { class: "swatches" },
      presets.map((colour, i) => {
        // the first one is Hata's own: choosing it means "no colour of mine"
        const on = i === 0 ? !current : current === colour;
        const swatch = h("button", { type: "button", class: "swatch" + (on ? " on" : ""), title: i === 0 ? t("appearance.default") : colour, "aria-label": i === 0 ? t("appearance.default") : colour, "aria-pressed": String(on), onclick: () => change({ [key]: i === 0 ? "" : colour }) });
        swatch.style.background = colour;
        return swatch;
      }),
      custom,
    );
  };
  const wall = (name, label) =>
    h("button", { type: "button", class: "wall" + (look.wallpaper === name ? " on" : ""), "aria-pressed": String(look.wallpaper === name), onclick: () => change({ wallpaper: name }) }, name && h("img", { src: wallpaperUrl(look, name), alt: "", loading: "lazy" }), h("span", null, label));
  const file = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/avif",
    hidden: true,
    onchange: async () => {
      const picture = file.files[0];
      if (!picture) return;
      error.textContent = "";
      try {
        const res = await fetch("/api/appearance/wallpaper", { method: "PUT", body: picture, headers: { "content-type": "application/octet-stream" } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "request.failed", data?.error?.detail ?? {});
        state.settings = data;
        applyAppearance((state.appearance = data.appearance));
        renderSettings();
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  const dim = h("input", { type: "range", min: 0, max: 90, step: 5, value: look.dim, "aria-label": t("appearance.dim"), oninput: () => applyAppearance({ ...state.appearance, dim: Number(dim.value) }), onchange: () => change({ dim: Number(dim.value) }, false) });
  return [
    h("section", { class: "card pad" }, h("h2", null, t("appearance.colours")), settingRow(t("appearance.accent"), t("appearance.accentHint"), colours("accent", ACCENTS, ACCENTS[0])), settingRow(t("appearance.background"), t("appearance.backgroundHint"), colours("background", BACKGROUNDS, BACKGROUNDS[0]))),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("appearance.picture")),
      h("div", { class: "walls" }, wall("", t("appearance.none")), state.wallpapers.map((name) => wall(name, t("appearance.wall." + name))), look.custom &&
          h(
            "div",
            { class: "wall-own" },
            wall("custom", t("appearance.yours")),
            h("button", {
              type: "button",
              class: "icon-btn wall-remove",
              title: t("appearance.remove"),
              "aria-label": t("appearance.remove"),
              onclick: async () => {
                try {
                  state.settings = await api("DELETE", "/api/appearance/wallpaper");
                  applyAppearance((state.appearance = state.settings.appearance));
                  renderSettings();
                } catch (e) {
                  toast(errorText(e), "error");
                }
              },
            }, icon("trash")),
          ), h("button", { type: "button", class: "wall add", onclick: () => file.click() }, h("span", null, icon("upload"), " ", t(look.custom ? "appearance.replace" : "appearance.upload"))), file),
      look.wallpaper && settingRow(t("appearance.dim"), t("appearance.dimHint"), dim),
      error,
    ),
  ];
}

function httpsSection(save, error) {
  const https = state.settings.https;
  const mode = h("select", null, HTTPS_MODES.map((id) => h("option", { value: id, selected: https.mode === id }, t("https.mode." + id))));
  const domain = h("input", { value: https.domain, placeholder: "home.example.com", spellcheck: false, autocapitalize: "none", class: "mono" });
  const email = h("input", { type: "email", value: https.email, placeholder: "you@example.com", spellcheck: false });
  const explain = h("p", { class: "muted small" });
  const emailRow = settingRow(t("https.email"), t("https.emailHint"), email);
  const domainRow = settingRow(t("https.domain"), t("https.domainHint"), domain);
  const results = h("div", { class: "stack" });
  const sync = () => {
    explain.textContent = t("https.explain." + mode.value);
    domainRow.hidden = mode.value === "off";
    emailRow.hidden = mode.value !== "acme";
  };
  mode.addEventListener("change", sync);
  sync();
  const check = button(t("https.check"), {
    onclick: async () => {
      check.disabled = true;
      results.replaceChildren(h("p", { class: "muted small" }, t("https.checking")));
      try {
        const list = await api("POST", "/api/https/check", {});
        results.replaceChildren(...list.map((r) => h("div", { class: "activity-item" }, icon(r.ok ? "check" : "x", r.ok ? "ok" : "danger"), h("div", { class: "grow" }, h("div", { class: "mono" }, r.host), !r.ok && h("div", { class: "muted small" }, r.problem)))));
      } catch (e) {
        results.replaceChildren(h("p", { class: "error" }, errorText(e)));
      }
      check.disabled = false;
    },
  });
  const here = state.overview?.site?.domain;
  // certificates are requested in the background: the card keeps asking until nothing is in progress
  const certs = h("div", { class: "stack" });
  let alive = true;
  cleanups.push(() => (alive = false));
  const paintCerts = async () => {
    const status = await api("GET", "/api/https").catch(() => null);
    if (!alive || !status) return;
    certs.replaceChildren(
      status.httpPort !== 80 && h("p", { class: "banner" }, t("https.needPort80", { port: status.httpPort })),
      status.error && h("p", { class: "error" }, status.error),
      ...status.certificates.map((c) =>
        h(
          "div",
          { class: "activity-item" },
          icon(c.working ? "refresh" : c.notAfter ? "check" : "x", c.working ? "" : c.notAfter ? "ok" : "danger"),
          h("div", { class: "grow" }, h("div", { class: "mono" }, c.name), h("div", { class: "muted small" }, c.working ? t("https.cert.working") : c.notAfter ? t("https.cert.valid", { date: new Date(c.notAfter).toLocaleDateString(state.lang, { day: "numeric", month: "long", year: "numeric" }), issuer: c.issuer }) : t("https.cert.none")), c.error && h("div", { class: "error small" }, c.error)),
        ),
      ),
    );
    if (status.certificates.some((c) => c.working)) setTimeout(paintCerts, 2000);
  };
  if (https.mode === "acme") void paintCerts();
  const retry = button(t("https.retry"), { onclick: async () => (await api("POST", "/api/https/retry", {}).catch((e) => toast(errorText(e), "error")), setTimeout(paintCerts, 800)) }, "refresh");
  return [
    h(
      "form",
      {
        class: "card pad",
        onsubmit: async (e) => {
          e.preventDefault();
          await save({ https: { mode: mode.value, domain: domain.value.trim(), email: email.value.trim() } });
          await refresh();
          render();
          void loadSettings();
        },
      },
      h("h2", null, t("settings.https")),
      settingRow(t("https.mode"), "", mode),
      explain,
      domainRow,
      emailRow,
      error,
      h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
    ),
    https.mode === "acme" && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("https.certificates")), retry), h("p", { class: "muted small" }, t("https.certificatesLead")), certs),
    here && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("https.checkTitle")), check), h("p", { class: "muted small" }, t("https.checkLead", { domain: here })), results),
    here && h("section", { class: "card pad" }, h("h2", null, t("https.addresses")), h("p", { class: "muted small" }, t("https.addressesLead")), settingRow("Hata", "", h("a", { class: "link mono", href: `https://${here}/` }, here)), (state.overview?.apps ?? []).filter((a) => a.port).map((a) => settingRow(a.title, a.protected ? t("access.protected") : "", h("a", { class: "link mono", href: `https://${a.name.replace(/_/g, "-")}.${here}/`, target: "_blank", rel: "noopener noreferrer" }, `${a.name.replace(/_/g, "-")}.${here}`)))),
  ];
}

function renderSettings() {
  const section = state.route.section;
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("nav.settings")), h("p", { class: "meta" }, `Hata ${state.version}`))),
    h(
      "div",
      { class: "settings" },
      h("nav", { class: "cats" }, sections().map((item) => h("a", { class: "cat" + (section === item.id ? " active" : ""), href: `#/settings/${item.id}` }, h("span", { class: "with-icon" }, icon(item.icon), t("settings." + item.id))))),
      h("div", { class: "stack" }, state.account && (state.settings || !isAdmin()) ? settingsSection(section) : h("p", { class: "muted" }, "…")),
    ),
  );
}

// --- Account and users --------------------------------------------------------------------------

/** The QR code of a matrix sent by the server as rows of "0" and "1" */
function qrSvg(rows) {
  const quiet = 4;
  const size = rows.length + quiet * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("shape-rendering", "crispEdges");
  const back = document.createElementNS(SVG_NS, "rect");
  back.setAttribute("width", size);
  back.setAttribute("height", size);
  back.setAttribute("fill", "#fff");
  const path = document.createElementNS(SVG_NS, "path");
  let d = "";
  rows.forEach((row, r) => [...row].forEach((cell, c) => (d += cell === "1" ? `M${c + quiet},${r + quiet}h1v1h-1z` : "")));
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(back, path);
  return svg;
}

/** A browser and system out of a User-Agent line — enough to tell one's own devices apart */
function deviceName(userAgent) {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : /curl\//.test(userAgent) ? "curl" : "";
  const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" · ") || userAgent.slice(0, 40) || "—";
}

function passwordInput(autocomplete) {
  return h("input", { type: "password", autocomplete, required: true, minLength: autocomplete === "new-password" ? 8 : 1 });
}

async function twoFactorSetup() {
  let setup;
  try {
    setup = await api("POST", "/api/account/totp/begin", {});
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const code = h("input", { inputMode: "numeric", autocomplete: "one-time-code", required: true, class: "mono", placeholder: "000000" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            const res = await api("POST", "/api/account/totp/enable", { code: code.value.trim() });
            dialog.close();
            state.user.twoFactor = true;
            recoveryDialog(res.recovery);
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("twofa.setupTitle")), h("p", { class: "muted small" }, t("twofa.setupLead"))), closeX(() => dialog)),
      h("div", { class: "qr-box" }, qrSvg(setup.qr)),
      field(t("twofa.secret"), h("input", { readOnly: true, value: setup.secret.replace(/(.{4})/g, "$1 ").trim(), class: "mono", onfocus: (e) => e.target.select() }), t("twofa.secretHint")),
      field(t("twofa.code"), code),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("twofa.turnOn"))),
    ),
  );
  code.focus();
}

function recoveryDialog(codes) {
  const dialog = openDialog(
    "",
    h("h2", null, t("twofa.recoveryTitle")),
    h("p", { class: "muted" }, t("twofa.recoveryLead")),
    h("pre", { class: "codes" }, codes.join("\n")),
    h("footer", null, button(t("twofa.copy"), { onclick: () => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast(t("twofa.copied"))) }), button(t("twofa.saved"), { class: "primary", onclick: () => dialog.close() })),
  );
}

function passwordPrompt(title, lead, confirmLabel, action, extra = null, kind = "danger") {
  const password = passwordInput("current-password");
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await action(password.value);
            dialog.close();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, title),
      h("p", { class: "muted" }, lead),
      field(t("auth.password"), password),
      extra,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn " + kind }, confirmLabel)),
    ),
  );
  password.focus();
}

function accountSection() {
  const account = state.account;
  const sessionsCard = h(
    "section",
    { class: "card pad" },
    h("div", { class: "section-head" }, h("h2", null, t("account.sessions")), account.sessions.length > 1 && state.user.role !== "guest" && button(t("account.signOutOthers"), { class: "small", onclick: async () => (await api("DELETE", "/api/account/sessions/others").catch((e) => toast(errorText(e), "error")), loadSettings()) })),
    account.sessions.map((session) =>
      settingRow(
        h("span", null, deviceName(session.userAgent), session.current && h("span", { class: "chip ok" }, t("account.thisDevice"))),
        [session.ip, t("account.lastSeen", { time: ago(session.lastSeen) })].filter(Boolean).join(" · "),
        !session.current &&
          state.user.role !== "guest" &&
          button(t("account.signOutDevice"), {
            class: "small",
            onclick: async () => {
              await api("DELETE", `/api/account/sessions/${session.id}`).catch((e) => toast(errorText(e), "error"));
              void loadSettings();
            },
          }),
      ),
    ),
  );
  // a guest account is shared: the people using it do not manage it
  if (state.user.role === "guest") return [h("section", { class: "card pad" }, h("h2", null, state.user.name), h("p", { class: "muted" }, t("account.guest"))), sessionsCard];
  const current = passwordInput("current-password");
  const next = passwordInput("new-password");
  const error = h("p", { class: "error", role: "alert" });
  const twoFactor = account.user.twoFactor;
  return [
    h(
      "form",
      {
        class: "card pad",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await api("POST", "/api/account/password", { current: current.value, password: next.value });
            current.value = next.value = "";
            toast(t("account.passwordChanged"));
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("account.password")),
      settingRow(t("account.current"), "", current),
      settingRow(t("account.new"), t("account.newHint"), next),
      error,
      h("footer", null, h("button", { class: "btn primary" }, t("account.change"))),
    ),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("twofa.title")),
      settingRow(
        twoFactor ? t("twofa.on") : t("twofa.off"),
        twoFactor ? t("twofa.onHint", { n: account.recoveryCodes }) : t("twofa.offHint"),
        twoFactor
          ? button(t("twofa.turnOff"), {
              onclick: () =>
                passwordPrompt(t("twofa.turnOffTitle"), t("twofa.turnOffLead"), t("twofa.turnOff"), async (password) => {
                  await api("POST", "/api/account/totp/disable", { password });
                  state.user.twoFactor = false;
                  toast(t("settings.saved"));
                  void loadSettings();
                }),
            })
          : button(t("twofa.setUp"), { class: "primary", onclick: twoFactorSetup }),
      ),
    ),
    passkeysCard(account),
    sessionsCard,
  ];
}

function passkeysCard(account) {
  const here = account.passkeysHere && !!window.PublicKeyCredential;
  if (!here && !account.passkeys.length) return h("section", { class: "card pad" }, h("h2", null, t("passkey.title")), h("p", { class: "muted" }, t("passkey.needDomain")));
  const add = () => {
    const name = h("input", { maxLength: 40, placeholder: deviceName(navigator.userAgent) });
    passwordPrompt(t("passkey.addTitle"), t("passkey.addLead"), t("passkey.add"), async (password) => {
      try {
        await passkeyCreate(password, name.value.trim() || deviceName(navigator.userAgent));
      } catch (e) {
        if (passkeyCancelled(e)) return;
        throw e;
      }
      toast(t("passkey.added"));
      void loadSettings();
    }, field(t("passkey.name"), name, t("passkey.nameHint")), "primary");
  };
  return h(
    "section",
    { class: "card pad" },
    h("div", { class: "section-head" }, h("h2", null, t("passkey.title")), here && button(t("passkey.add"), { class: "small primary", onclick: add }, "plus")),
    h("p", { class: "muted small" }, t(here ? "passkey.lead" : "passkey.needDomain")),
    account.passkeys.map((key) =>
      settingRow(
        key.name || t("passkey.unnamed"),
        [t("passkey.created", { date: new Date(key.createdAt).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" }) }), key.lastUsed && t("passkey.used", { time: ago(key.lastUsed) })].filter(Boolean).join(" · "),
        button(t("app.remove"), {
          class: "small",
          onclick: async () => {
            await api("DELETE", `/api/account/passkeys/${key.id}`).catch((e) => toast(errorText(e), "error"));
            void loadSettings();
          },
        }),
      ),
    ),
  );
}

async function loadUsers() {
  try {
    const [users, invites, access, signIns] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/invites"), api("GET", `/api/access?lang=${state.lang}`), api("GET", "/api/signins")]);
    Object.assign(state, { users, invites, access, signIns });
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "users") renderUsers();
}

function userDialog() {
  const name = h("input", { required: true, autocapitalize: "none", spellcheck: false, autocomplete: "off" });
  const password = passwordInput("new-password");
  const role = h("select", null, h("option", { value: "member" }, t("user.role.member")), h("option", { value: "guest" }, t("user.role.guest")), h("option", { value: "admin" }, t("user.role.admin")));
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await api("POST", "/api/users", { name: name.value.trim(), password: password.value, role: role.value });
            dialog.close();
            void loadUsers();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("users.add"))), closeX(() => dialog)),
      field(t("auth.name"), name),
      field(t("auth.password"), password, t("users.passwordHint")),
      field(t("users.role"), role, t("users.roleHint")),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("users.add"))),
    ),
  );
  name.focus();
}

function userMenuFor(user) {
  let dialog;
  const self = user.id === state.user.id;
  const change = async (patch, done) => {
    try {
      await api("PUT", `/api/users/${user.id}`, patch);
      toast(done ?? t("settings.saved"));
      void loadUsers();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu",
    h("header", null, h("span", { class: "avatar" }, user.name.slice(0, 1).toUpperCase()), h("div", null, h("h2", null, user.name), h("span", { class: "muted small" }, t("user.role." + user.role)))),
    user.role !== "member" && item(t("users.makeMember"), "user", () => change({ role: "member" })),
    user.role !== "guest" && item(t("users.makeGuest"), "user", () => change({ role: "guest" })),
    user.role !== "admin" && item(t("users.makeAdmin"), "sliders", () => change({ role: "admin" })),
    item(t("users.setPassword"), "refresh", () => {
      const password = passwordInput("new-password");
      const error = h("p", { class: "error", role: "alert" });
      const prompt = openDialog(
        "confirm",
        h(
          "form",
          {
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                await api("PUT", `/api/users/${user.id}`, { password: password.value });
                prompt.close();
                toast(t("account.passwordChanged"));
                void loadUsers();
              } catch (err) {
                error.textContent = errorText(err);
              }
            },
          },
          h("h2", null, t("users.setPasswordTitle", { name: user.name })),
          h("p", { class: "muted" }, t("users.setPasswordLead")),
          field(t("account.new"), password, t("account.newHint")),
          error,
          h("footer", null, closeButton(() => prompt, t("common.cancel")), h("button", { class: "btn primary" }, t("settings.save"))),
        ),
      );
      password.focus();
    }),
    user.twoFactor && item(t("users.resetTwoFactor"), "x", () => change({ twoFactor: false })),
    !self &&
      item(t("users.remove"), "trash", async () => {
        try {
          await api("DELETE", `/api/users/${user.id}`);
          void loadUsers();
        } catch (e) {
          toast(errorText(e), "error");
        }
      }, "danger"),
  );
}

function renderUsers() {
  const users = state.users ?? [];
  const admins = users.filter((u) => u.role === "admin").length;
  const without = users.filter((u) => !u.twoFactor).length;
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("nav.users")), h("p", { class: "meta" }, t("users.meta", { users: users.length, admins }), without > 0 && h("span", { class: "dot-sep" }, "·"), without > 0 && t("users.without2fa", { n: without }))), h("div", { class: "actions" }, button(t("users.add"), { class: "primary", onclick: userDialog }, "plus"))),
    h(
      "div",
      { class: "card table-wrap" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, h("th", null, t("users.col.user")), h("th", null, t("users.role")), h("th", null, t("twofa.short")), h("th", null, t("users.col.lastSignIn")), h("th", { class: "num" }, t("account.sessions")), h("th"))),
        h(
          "tbody",
          null,
          users.map((u) =>
            h(
              "tr",
              null,
              h("td", null, h("div", { class: "with-icon" }, h("span", { class: "avatar" }, u.name.slice(0, 1).toUpperCase()), h("span", { class: "strong" }, u.name), u.id === state.user.id && h("span", { class: "muted small" }, t("users.you")))),
              h("td", null, h("span", { class: "chip" + (u.role === "admin" ? " accent" : "") }, t("user.role." + u.role))),
              h("td", null, u.twoFactor ? h("span", { class: "chip ok" }, icon("check"), t("twofa.onShort")) : h("span", { class: "muted" }, t("twofa.offShort"))),
              h("td", null, u.lastSignIn ? ago(u.lastSignIn) : h("span", { class: "muted" }, t("users.never"))),
              h("td", { class: "num" }, u.sessions || "—"),
              h("td", null, h("div", { class: "row-actions" }, h("button", { type: "button", class: "icon-btn", "aria-label": t("users.actions", { name: u.name }), onclick: () => userMenuFor(u) }, icon("more")))),
            ),
          ),
        ),
      ),
    ),
    h("p", { class: "muted small" }, t("users.rolesHint")),
    h("div", { class: "columns" }, h("section", null, accessMatrix()), h("aside", { class: "side" }, invitesCard(), signInLog())),
  );
}

function inviteDialog() {
  const role = h("select", null, h("option", { value: "member" }, t("user.role.member")), h("option", { value: "guest" }, t("user.role.guest")));
  const note = h("input", { maxLength: 80, placeholder: t("invite.notePlaceholder") });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const res = await api("POST", "/api/invites", { role: role.value, note: note.value.trim() });
            dialog.close();
            const link = `${location.origin}/#invite=${res.token}`;
            const box = h("input", { readOnly: true, value: link, class: "mono", onfocus: (ev) => ev.target.select() });
            const shown = openDialog("", h("h2", null, t("invite.linkTitle")), h("p", { class: "muted" }, t("invite.linkLead")), box, h("footer", null, button(t("twofa.copy"), { onclick: () => navigator.clipboard?.writeText(link).then(() => toast(t("twofa.copied"))) }, "link"), button(t("common.close"), { class: "primary", onclick: () => shown.close() })));
            box.focus();
            void loadUsers();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("invite.new")), h("p", { class: "muted small" }, t("invite.newLead"))), closeX(() => dialog)),
      field(t("users.role"), role, t("users.roleHint")),
      field(t("invite.note"), note),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("invite.create"))),
    ),
  );
}

function invitesCard() {
  const invites = state.invites ?? [];
  return h(
    "section",
    { class: "card pad" },
    h("div", { class: "section-head" }, h("h2", null, t("invite.title2"), invites.length > 0 && h("span", { class: "pill" }, invites.length)), button(t("invite.new"), { class: "small", onclick: inviteDialog }, "link")),
    invites.length
      ? invites.map((invite) =>
          h(
            "div",
            { class: "snapshot" },
            h("div", { class: "grow" }, h("strong", null, invite.note || t("user.role." + invite.role)), h("div", { class: "muted small" }, `${t("user.role." + invite.role)} · ${t("invite.expires", { time: new Date(invite.exp).toLocaleDateString(state.lang, { day: "numeric", month: "short" }) })}`)),
            h("button", { type: "button", class: "icon-btn", "aria-label": t("invite.revoke"), title: t("invite.revoke"), onclick: async () => (await api("DELETE", `/api/invites/${invite.id}`).catch((e) => toast(errorText(e), "error")), loadUsers()) }, icon("trash")),
          ),
        )
      : h("p", { class: "muted small" }, t("invite.none")),
  );
}

function signInLog() {
  const list = (state.signIns ?? []).slice(0, 8);
  return h(
    "section",
    { class: "pad-x" },
    h("div", { class: "section-head" }, h("h2", null, t("signins.title"))),
    list.length
      ? list.map((entry) => h("div", { class: "activity-item" }, icon(entry.outcome === "ok" ? "signin" : "x", entry.outcome === "ok" ? "" : "danger"), h("div", { class: "grow" }, h("div", null, t("signins." + entry.outcome, { name: entry.name || "?" })), h("div", { class: "muted small" }, `${ago(entry.ts)} · ${entry.ip}`))))
      : h("p", { class: "muted small" }, t("activity.none")),
  );
}

/** Who may open what: a row per app, a column per person who is not an administrator */
function accessMatrix() {
  const access = state.access;
  if (!access) return null;
  const people = access.users.filter((u) => u.role !== "admin");
  const update = async (app, patch) => {
    try {
      const res = await api("PUT", `/api/apps/${app.name}/access`, { protect: app.protect, allowed: app.allowed, ...patch });
      if (res.job) jobDialog(res.job, "apply", app.title, () => void loadUsers());
      else void loadUsers();
    } catch (e) {
      toast(errorText(e), "error");
      void loadUsers();
    }
  };
  const row = (app) => {
    const everyone = app.allowed === "all";
    const list = everyone ? [] : app.allowed;
    const toggle = (user, on) => {
      // leaving "every member" starts from the people who could open the app until now
      const base = everyone ? people.filter((u) => u.role === "member").map((u) => u.id) : list;
      update(app, { allowed: on ? [...new Set([...base, user.id])] : base.filter((id) => id !== user.id) });
    };
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon" }, appIcon(app, "sm"), h("div", null, h("a", { class: "strong", href: `#/apps/${app.name}` }, app.title), !everyone && !app.protect && h("div", { class: "muted small" }, t("access.onlyHidden"))))),
      h("td", null, h("input", { type: "checkbox", checked: app.protect, disabled: !!app.cannotProtect, title: app.cannotProtect ? t("access.cannot." + app.cannotProtect) : "", "aria-label": t("access.protectApp", { title: app.title }), onchange: (e) => update(app, { protect: e.target.checked }) })),
      h("td", null, h("input", { type: "checkbox", checked: everyone, "aria-label": t("access.everyone"), onchange: (e) => update(app, { allowed: e.target.checked ? "all" : people.filter((u) => u.role === "member").map((u) => u.id) }) })),
      people.map((user) => h("td", null, h("input", { type: "checkbox", checked: everyone ? user.role === "member" : list.includes(user.id), "aria-label": `${user.name}: ${app.title}`, onchange: (e) => toggle(user, e.target.checked) }))),
    );
  };
  return [
    h("div", { class: "section-head" }, h("h2", null, t("access.title"))),
    access.apps.length
      ? h("div", { class: "card table-wrap" }, h("table", { class: "matrix" }, h("thead", null, h("tr", null, h("th", null, t("backup.col.app")), h("th", null, t("access.signIn")), h("th", null, t("access.everyone")), people.map((u) => h("th", null, u.name, u.role === "guest" && h("span", { class: "muted" }, ` · ${t("user.role.guest")}`))))), h("tbody", null, access.apps.map(row))))
      : h("p", { class: "card pad muted" }, t("backup.noApps")),
    h("p", { class: "muted small" }, t("access.how")),
  ];
}

// --- Start --------------------------------------------------------------------------------------

async function enter() {
  // sent here by a protected app: now that the visitor is signed in, back to it
  if (NEXT) return location.replace(NEXT);
  state.route = parseRoute();
  render();
  await refresh();
  startEvents();
  if (isAdmin()) api("GET", "/api/settings").then((s) => (state.settings = s), () => {});
  onRoute();
}

async function main() {
  let server;
  try {
    server = await api("GET", "/api/state");
  } catch {
    await loadLanguage("en");
    $app.replaceChildren(h("main", { class: "center" }, h("p", { class: "banner" }, t("error.network"))));
    return setTimeout(main, 3000);
  }
  applyAppearance((state.appearance = server.appearance ?? null));
  state.wallpapers = server.wallpapers ?? [];
  Object.assign(state, { version: server.version, setup: server.setup, user: server.user, languages: server.languages, passkeys: !!server.passkeys && !!window.PublicKeyCredential });
  await loadLanguage(pickLanguage(server));
  if (state.user) await enter();
  else render();
}

void main();
