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
    // what a right click on it shows: a function of the point, or true for its own buttons (see `contextMenus`)
    else if (key === "menu") el.hataMenu = value;
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
  network: "M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4",
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
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  terminal: "M5 8l4 4-4 4M12 16h7",
  store: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  undo: "M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4",
  file: "M6 3h9l4 4v14H6zM14 3v5h5",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  film: "M4 5h16v14H4zM10 9l5 3-5 3z",
  music: "M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  key: "M8 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h9M18 12v3M21 12v2",
  chat: "M4 5h16v11h-9l-5 4v-4H4zM8 9h8M8 12h5",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  down: "M6 9l6 6 6-6",
  server: "M4 4h16v7H4zM4 13h16v7H4zM8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4",
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

/** Hata's mark, drawn in the page so that it takes the accent colour of the settings */
function logo() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "logo");
  svg.setAttribute("aria-hidden", "true");
  const plate = document.createElementNS(SVG_NS, "rect");
  for (const [name, value] of Object.entries({ width: 64, height: 64, rx: 15 })) plate.setAttribute(name, value);
  const house = document.createElementNS(SVG_NS, "path");
  house.setAttribute("d", "M32 13 11 31h6v19h11V38h8v12h11V31h6z");
  svg.append(plate, house);
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
  // the icon of the tab is the same mark in the same colour
  const mark = look?.accent ? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="${look.accent}"/><path d="M32 13 11 31h6v19h11V38h8v12h11V31h6z" fill="${lightness(look.accent) > 0.4 ? "#1a1206" : "#ffffff"}"/></svg>`)}` : "/logo.svg";
  document.querySelector('link[rel="icon"]')?.setAttribute("href", mark);
}

// --- State --------------------------------------------------------------------------------------

const state = {
  version: "",
  setup: false,
  /** A new server whose administrator has not been through the first choices yet */
  welcome: false,
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
  agents: null,
  approvals: null,
  assistant: null,
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
// The address after `#` is the view: #/ · #/store · #/import · #/files/<folders> · #/trash · #/apps/<name>/<tab> · #/settings/<section>

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "connect" && parts[1]) return { view: "connect", id: parts[1] };
  if (parts[0] === "welcome" && isAdmin()) return { view: "welcome", step: WELCOME_STEPS.includes(parts[1]) && parts[1] !== "admin" ? parts[1] : "server" };
  if (parts[0] === "store" && state.user?.role !== "guest") return { view: "store" };
  // "#/files" is the data root, wherever it is; "#/files/" is the root of the server
  // "#/files/@<machine>/<folders>" is a folder of another machine
  if (parts[0] === "files" && mayFiles() && parts[1]?.startsWith("@")) return { view: "files", machine: parts[1].slice(1), path: "/" + parts.slice(2).join("/") };
  if (parts[0] === "files" && mayFiles()) return { view: "files", machine: "", path: /^#\/?files$/.test(location.hash) ? "" : "/" + parts.slice(1).join("/") };
  if (parts[0] === "trash" && mayFiles()) return { view: "trash" };
  if (parts[0] === "hata" && mayFiles()) return { view: "myhata" };
  if (parts[0] === "activity" && isAdmin()) return { view: "activity" };
  // both live in Settings; their own old addresses still lead there
  if ((parts[0] === "backups" || (parts[0] === "settings" && parts[1] === "backups")) && isAdmin()) return { view: "backups" };
  if ((parts[0] === "users" || (parts[0] === "settings" && parts[1] === "users")) && isAdmin()) return { view: "users" };
  if (parts[0] === "import" && isAdmin()) return { view: "import" };
  if (parts[0] === "terminal" && isAdmin()) return { view: "terminal" };
  if (parts[0] === "assistant" && isAdmin()) return { view: "assistant" };
  if (parts[0] === "proxmox" && parts[1] && isAdmin()) return { view: "proxmox", id: parts[1], tab: PVE_TABS.includes(parts[2]) ? parts[2] : "overview" };
  if (parts[0] === "machines" && isAdmin()) return parts[1] ? { view: "machine", id: parts[1], tab: MACHINE_TABS.includes(parts[2]) ? parts[2] : "overview" } : { view: "machines" };
  if (parts[0] === "apps" && parts[1]) return { view: "app", name: parts[1], tab: isAdmin() && ["settings", "logs", "compose", "backups", "terminal"].includes(parts[2]) ? parts[2] : "overview" };
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
  if (state.route.view === "files") stepTrail();
  else filesUi.trail = null;
  // an install onto a machine is offered while the store is on screen
  if (state.route.view !== "store") state.installTarget = "";
  render();
  if (!state.user) return;
  if (state.route.view === "store") void loadStore();
  if (state.route.view === "settings") void loadSettings();
  if (state.route.view === "files") void loadFiles();
  if (state.route.view === "trash") void loadTrash();
  if (state.route.view === "myhata") void loadMyHata();
  if (state.route.view === "backups") void loadBackups();
  if (state.route.view === "users") void loadUsers();
  if (state.route.view === "import") void loadImport();
  if (state.route.view === "welcome") void loadWelcome();
  if (state.route.view === "app") void loadApp();
  if (state.route.view === "machines" || state.route.view === "machine" || state.route.view === "proxmox") void loadMachines();
  if (state.route.view === "machines") void loadPve();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", onRoute);
contextMenus();

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

let disksEventTimer = 0;

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
    } else if (event.type === "disks") {
      // a disk was plugged in, pulled out, connected: the pages that list disks look again
      clearTimeout(disksEventTimer);
      disksEventTimer = setTimeout(async () => {
        if (state.route.view === "settings" && state.route.section === "storage") setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        else if (state.route.view === "files") void loadFiles?.();
        else if (state.route.view === "myhata") void loadMyHata();
      }, 1200);
    } else if (event.type === "assistant") {
      assistantEvent(event);
    } else if (event.type === "machines") {
      if (state.route.view === "machines" || state.route.view === "machine") void loadMachines();
      // a machine came or went: its block on the home page says so
      else if (state.route.view === "home") void refresh();
    } else if (event.type === "machine") {
      machineEvent(event);
    } else if (event.type === "proxmox") {
      pveEvent(event);
    } else if (event.type === "approvals") {
      void loadApprovals();
    } else if (event.type === "tailscale") {
      if (state.route.view === "settings" && state.route.section === "remote") void loadRemote();
    } else if (event.type === "sysupdates") {
      sysUpdatesEvent(event.at ?? "");
    } else if (event.type === "network") {
      if (state.route.view === "settings" && state.route.section === "network") void loadNetwork();
    } else if (event.type === "store" && state.route.view === "store") {
      void loadStore();
    }
  };
  // after a reconnect anything may have changed while we were away
  source.onopen = () => {
    void refresh();
    void loadApprovals();
  };
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
  if (state.route.view === "machine" && state.route.tab === "apps") void loadMachineApps();
  if (state.route.view === "backups") void loadBackups();
  if (state.route.view === "import") void loadImport();
  if (state.route.view === "welcome" && ["existing", "apps"].includes(state.route.step)) paintWelcome();
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
    return $app.replaceChildren(h("main", { class: "center" }, h("div", { class: "auth card" }, h("div", { class: "brand big" }, logo(), "hata"), h("h1", null, t("invite.invalidTitle")), h("p", { class: "muted" }, t("invite.invalid")), h("a", { class: "btn wide", href: "/" }, t("auth.signIn")))));
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
        h("div", { class: "brand big" }, logo(), "hata"),
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
          state.welcome = setup;
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
    !setup && h("div", { class: "brand big" }, logo(), "hata"),
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
  if (setup) welcomeFrame("admin", form);
  else $app.replaceChildren(h("main", { class: "center" }, form));
  (setup && !tokenFromLink ? token : name).focus();
}

// --- Shell --------------------------------------------------------------------------------------

/** A phone: lists of sections fold to the open one, tables become cards */
const phone = matchMedia("(max-width: 760px)");
// the assistant shows its chats as a column only on a wide screen
phone.addEventListener("change", () => paintAssistant());

// a folded list opens when its open section is tapped; choosing one, or tapping elsewhere, folds it again
document.addEventListener(
  "click",
  (e) => {
    const fold = e.target.closest?.(".fold");
    for (const open of document.querySelectorAll(".fold.open")) if (open !== fold) open.classList.remove("open");
    if (!fold || !phone.matches) return;
    const item = e.target.closest(".cat");
    if (fold.classList.contains("open")) {
      if (item) fold.classList.remove("open");
    } else if (item?.classList.contains("active")) {
      e.preventDefault();
      e.stopPropagation();
      fold.classList.add("open");
    }
  },
  true,
);

/** Every cell of a table knows its column's name: a phone shows a row as a card of "name: value" lines */
function labelTables() {
  for (const table of document.querySelectorAll("table")) {
    const names = [...(table.tHead?.rows[0]?.cells ?? [])].map((cell) => cell.textContent.trim());
    if (!names.length) continue;
    for (const row of table.tBodies[0]?.rows ?? []) {
      let column = 0;
      for (const cell of row.cells) {
        const name = column > 0 ? names[column] ?? "" : "";
        if (cell.dataset.label !== name) cell.dataset.label = name;
        column += cell.colSpan || 1;
      }
    }
  }
}
let labelling = 0;
new MutationObserver(() => {
  if (!labelling) labelling = requestAnimationFrame(() => ((labelling = 0), labelTables()));
}).observe(document.documentElement, { childList: true, subtree: true });

// --- Choices: a <select> that looks the same on every system ----------------------------------------

/*
 * Every <select> is dressed as it enters the page: the native one stays, hidden, and keeps what the code
 * uses — `value`, the options, `change` events; before it a button says the chosen option and opens a
 * list of Hata's own, so a desktop, a Mac and a phone show one and the same thing.
 */
const NATIVE_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
const NATIVE_INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");

function dressSelect(select) {
  const label = h("span", { class: "select-label" });
  const keys = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") e.preventDefault(), openPick(select);
  };
  const pick = h("button", { type: "button", "aria-haspopup": "listbox", onclick: () => openPick(select), onkeydown: keys }, label, icon("down", "select-arrow"));
  select.hataPick = pick;
  // a label that names the select by its id names the button: the id goes over
  if (select.id) (pick.id = select.id), select.removeAttribute("id");
  const show = () => {
    const index = NATIVE_INDEX.get.call(select);
    // every option lies in the same cell and only the chosen one is seen: the button is as wide as the widest, like a native select
    label.replaceChildren(...[...select.options].map((o, i) => h("span", { class: i === index ? "" : "unseen" }, o.textContent)));
    pick.className = ["select-btn", ...select.classList].filter((c) => c !== "dressed").join(" ");
    pick.disabled = select.disabled;
    const name = select.getAttribute("aria-label");
    const text = select.options[index]?.textContent ?? "";
    if (name) pick.setAttribute("aria-label", text ? `${name}: ${text}` : name);
    if (select.title) pick.title = select.title;
  };
  select.hataShow = show;
  // the code sets the value too, which no event tells of
  for (const [key, native] of [["value", NATIVE_VALUE], ["selectedIndex", NATIVE_INDEX]])
    Object.defineProperty(select, key, { configurable: true, get: () => native.get.call(select), set: (v) => (native.set.call(select, v), show()) });
  select.focus = (options) => pick.focus(options);
  new MutationObserver(show).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
  select.classList.add("dressed");
  show();
  select.before(pick);
}

/** The list of a dressed select, under its button (over it when there is no room below) */
function openPick(select) {
  const pick = select.hataPick;
  if (!pick || pick.disabled) return;
  let dialog;
  const current = NATIVE_INDEX.get.call(select);
  const choose = (i) => {
    dialog.close();
    if (i === NATIVE_INDEX.get.call(select)) return;
    NATIVE_INDEX.set.call(select, i);
    select.hataShow();
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const items = [...select.options].map((o, i) =>
    h("button", { type: "button", class: "menu-item", role: "option", "aria-selected": String(i === current), disabled: o.disabled, onclick: () => choose(i) }, h("span", { class: "grow" }, o.textContent), i === current && icon("check", "on-mark")),
  );
  dialog = openDialog("menu dropdown select-list", h("div", { role: "listbox", "aria-label": select.getAttribute("aria-label") ?? "" }, items));
  pick.setAttribute("aria-expanded", "true");
  dialog.addEventListener("close", () => (pick.removeAttribute("aria-expanded"), pick.isConnected && pick.focus()));
  const box = pick.getBoundingClientRect();
  dialog.style.minWidth = Math.round(box.width) + "px";
  const below = box.bottom + 4 + dialog.offsetHeight <= document.documentElement.clientHeight - 8;
  placeAt(dialog, { x: box.left, y: below ? box.bottom + 4 : box.top - 4 - dialog.offsetHeight });
  const open = items.filter((b) => !b.disabled);
  const at = items[current] && !items[current].disabled ? items[current] : open[0];
  at?.focus();
  at?.scrollIntoView({ block: "nearest" });
  let typed = "";
  let typedAt = 0;
  dialog.addEventListener("keydown", (e) => {
    const now = open.indexOf(document.activeElement);
    const go = (i) => (e.preventDefault(), open[Math.max(0, Math.min(open.length - 1, i))]?.focus());
    if (e.key === "ArrowDown") go(now + 1);
    else if (e.key === "ArrowUp") go(now - 1);
    else if (e.key === "Home" || e.key === "PageUp") go(0);
    else if (e.key === "End" || e.key === "PageDown") go(open.length - 1);
    else if (e.key === "Tab") e.preventDefault(), dialog.close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      // letters typed jump to the option they begin
      typed = (Date.now() - typedAt < 800 ? typed : "") + e.key.toLowerCase();
      typedAt = Date.now();
      const found = open.find((b) => b.textContent.trim().toLowerCase().startsWith(typed));
      if (found) e.preventDefault(), found.focus();
    }
  });
}

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      for (const select of node.matches("select") ? [node] : node.querySelectorAll("select")) {
        if (!select.hataPick) dressSelect(select);
        // a select moved elsewhere takes its button along
        else if (select.previousElementSibling !== select.hataPick) select.before(select.hataPick);
      }
    }
    for (const node of record.removedNodes) if (node.hataPick && !node.isConnected) node.hataPick.remove();
  }
}).observe(document.documentElement, { childList: true, subtree: true });

const NAV = [
  { view: "home", hash: "#/", icon: "home" },
  { view: "store", hash: "#/store", icon: "grid", guest: false },
  { view: "files", hash: "#/files", icon: "folder", files: true },
  { view: "machines", hash: "#/machines", icon: "server", admin: true },
  { view: "assistant", hash: "#/assistant", icon: "chat", admin: true, assistant: true },
  { view: "settings", hash: "#/settings", icon: "sliders" },
];

/** Members look at the apps; everything that changes the server is an administrator's */
// an administrator the rules ask for two-factor sign-in is a member until it is on — the server says so too
const isAdmin = () => state.user?.role === "admin" && !state.user.mustTwoFactor;
/** Files are an administrator's, and theirs with whom a folder is shared — only those folders then */
const mayFiles = () => isAdmin() || !!state.user?.files;
/** The folders shared with one who is not an administrator, of this server or of a machine; null for an administrator */
function myShares(machine = state.route.view === "files" ? filesMachine() : "") {
  if (isAdmin()) return null;
  if ((state.files?.machine ?? "") === machine && state.files?.shares) return state.files.shares;
  return machine ? (state.myMachines?.find((m) => m.id === machine)?.shares ?? []) : (state.myShares ?? []);
}

/** The folders shared with them, here and on the machines, asked once for the sidebar and My Hata */
async function loadMine() {
  const mine = await api("GET", "/api/files/shares").catch(() => null);
  if (!mine) return;
  state.myShares = mine.shares;
  state.myMachines = mine.machines;
  state.favorites = mine.favorites;
}

const navCurrent = () => (state.route.view === "machine" || state.route.view === "proxmox" ? "machines" : state.route.view === "backups" || state.route.view === "users" ? "settings" : state.route.view === "app" ? "home" : state.route.view === "import" ? "store" : state.route.view === "trash" || state.route.view === "myhata" ? "files" : state.route.view);
const navItems = () => NAV.filter((item) => (!item.admin || isAdmin()) && (!item.files || mayFiles()) && (!item.assistant || !!(assistantUi.config?.ready ?? state.overview?.assistant)) && (item.guest !== false || state.user.role !== "guest"));

function navLinks(className, items = navItems()) {
  const current = navCurrent();
  return items.map((item) =>
    h("a", { class: className + (current === item.view ? " active" : ""), href: item.hash, title: t("nav." + item.view), "aria-current": current === item.view ? "page" : null }, icon(item.icon), h("span", null, t("nav." + item.view))),
  );
}

/** The bar at the bottom of a phone holds five: past that, the first four and "More" with the rest */
const BOTTOM_SLOTS = 5;

function bottomLinks() {
  const items = navItems();
  if (items.length <= BOTTOM_SLOTS) return navLinks("bottom-link", items);
  const rest = items.slice(BOTTOM_SLOTS - 1);
  const here = rest.some((item) => item.view === navCurrent());
  const more = h("button", { type: "button", class: "bottom-link" + (here ? " active" : ""), "aria-haspopup": "menu", onclick: (e) => moreMenu(e.currentTarget, rest) }, icon("more"), h("span", null, t("nav.more")));
  return [...navLinks("bottom-link", items.slice(0, BOTTOM_SLOTS - 1)), more];
}

function moreMenu(anchor, items) {
  let dialog;
  const current = navCurrent();
  dialog = openDialog(
    "menu dropdown nav-more",
    items.map((item) => h("a", { class: "menu-item" + (current === item.view ? " active" : ""), href: item.hash, onclick: () => dialog.close() }, icon(item.icon), t("nav." + item.view))),
  );
  // it stands over the bar, by the button's right edge
  const at = anchor.getBoundingClientRect();
  dialog.style.top = "auto";
  dialog.style.bottom = document.documentElement.clientHeight - at.top + 8 + "px";
  dialog.style.right = Math.max(8, document.documentElement.clientWidth - at.right) + "px";
  // a finger opened it: no item is chosen yet
  dialog.focus();
}

async function signOut() {
  await api("POST", "/api/logout", {}).catch(() => {});
  state.user = null;
  closeAssistant();
  assistantUi.fab?.remove();
  assistantUi.fab = null;
  assistantUi.chat = null;
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
    isAdmin() && h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), serverPowerDialog("reboot")) }, icon("refresh"), t("power.reboot")),
    isAdmin() && h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), serverPowerDialog("poweroff")) }, icon("stop"), t("power.poweroff")),
    h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), signOut()) }, icon("signout"), t("nav.signOut")),
  );  // it hangs under the button it was opened from, by its right edge
  dialog.style.top = anchor.bottom + 8 + "px";
  dialog.style.right = Math.max(8, document.documentElement.clientWidth - anchor.right) + "px";
}

/** The search field of the header: installed apps first, then the store; for an administrator the data folder's files too */
function globalSearch() {
  const results = h("div", { class: "search-results", hidden: true });
  const withFiles = isAdmin();
  const input = h("input", { type: "search", placeholder: t(withFiles ? "search.placeholderFiles" : "search.placeholder"), "aria-label": t(withFiles ? "search.placeholderFiles" : "search.placeholder"), autocomplete: "off", spellcheck: false });
  let hits = [];
  // what the data folder gave for the query typed: { query, under, found, more } — found null while asked
  let files = null;
  let timer = 0;
  const done = () => {
    input.value = "";
    results.hidden = true;
    input.blur();
  };
  const openHit = (hit) => {
    done();
    if (hit.file) {
      const parent = hit.path.slice(0, hit.path.lastIndexOf("/")) || "/";
      filesUi.find = null;
      if (hit.type === "dir") return go(filesHash(hit.path));
      filesUi.pick = hit.path.split("/").pop();
      return go(filesHash(parent));
    }
    if (hit.installed) go(`#/apps/${hit.name}`);
    else {
      go("#/store");
      void storeDialog(hit);
    }
  };
  // everything found, in Files: the search of the data folder with these results
  const allFiles = () => {
    const { query, under, found, more } = files;
    done();
    filesUi.find = { under, query, found, more };
    go(filesHash(under));
  };
  const paint = () => {
    const q = input.value.trim();
    const shown = files?.query === q ? files : null;
    const fileHits = (shown?.found ?? []).slice(0, 6).map((item) => ({ ...item, file: true }));
    const all = [...hits, ...fileHits];
    const fileRow = (hit) => {
      const name = hit.path.split("/").pop();
      return h("button", { type: "button", class: "search-hit", onmousedown: (e) => (e.preventDefault(), openHit(hit)) }, fileIcon({ name, type: hit.type }), h("span", { class: "grow clip" }, name, h("span", { class: "muted small block clip mono" }, hit.path.slice(0, hit.path.lastIndexOf("/")) || "/")));
    };
    put(
      results,
      ...(hits.length ? hits.map((hit) => h("button", { type: "button", class: "search-hit", onmousedown: (e) => (e.preventDefault(), openHit(hit)) }, appIcon(hit, "sm"), h("span", { class: "grow" }, hit.title), h("span", { class: "muted small" }, t(hit.installed ? "search.installed" : "search.store")))) : []),
      ...(withFiles && q.length >= 2
        ? [
            h("div", { class: "search-head muted small" }, t("search.files")),
            ...(!shown || !shown.found ? [h("p", { class: "muted small pad-s" }, t("files.finding"))] : fileHits.length ? fileHits.map(fileRow) : [h("p", { class: "muted small pad-s" }, t("search.noFiles"))]),
            shown?.found && shown.found.length > fileHits.length && h("button", { type: "button", class: "search-hit more", onmousedown: (e) => (e.preventDefault(), allFiles()) }, icon("search"), h("span", { class: "grow" }, t("search.allFiles", { n: shown.found.length + (shown.more ? "+" : "") }))),
          ]
        : []),
      ...(!all.length && !(withFiles && q.length >= 2) ? [h("p", { class: "muted small pad" }, t("store.nothing"))] : []),
    );
    results.hidden = false;
  };
  const askFiles = async (q) => {
    files = { query: q, under: "", found: null, more: false };
    paint();
    try {
      const res = await api("GET", `/api/files/find?path=&q=${encodeURIComponent(q)}`);
      // typed on meanwhile: this answer is for an older question
      if (files?.query === q) files = { query: q, ...res };
    } catch {
      if (files?.query === q) files = { query: q, under: "", found: [], more: false };
    }
    if (input.value.trim() === q && document.activeElement === input) paint();
  };
  const update = async () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(timer);
    if (!q) return void (results.hidden = true);
    if (!state.store && state.user.role !== "guest") state.store = await api("GET", `/api/store?lang=${state.lang}`).catch(() => null);
    const match = (a) => `${a.title} ${a.name}`.toLowerCase().includes(q);
    const installed = (state.overview?.apps ?? []).filter(match).map((a) => ({ ...a, installed: true }));
    const names = new Set(installed.map((a) => a.name));
    hits = [...installed, ...(state.store?.apps ?? []).filter((a) => match(a) && !names.has(a.name))].slice(0, withFiles ? 5 : 7);
    paint();
    const typed = input.value.trim();
    if (withFiles && typed.length >= 2 && files?.query !== typed) timer = setTimeout(() => void askFiles(typed), 400);
  };
  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => (results.hidden = true));
  input.addEventListener("keydown", (e) => {
    const first = hits[0] ?? (files?.query === input.value.trim() && files.found?.[0] ? { ...files.found[0], file: true } : null);
    if (e.key === "Enter" && first) openHit(first);
    if (e.key === "Escape") input.blur();
  });
  // in Files "/" starts a path
  return h("div", { class: "search" }, icon("search"), input, state.route.view !== "files" && h("kbd", null, "/"), results);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || state.route.view === "files") return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.querySelector("dialog[open]")) return;
  const input = document.querySelector(".top .search input");
  if (input) {
    e.preventDefault();
    input.focus();
  }
});

function shell(...content) {
  assistantFab();
  $app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("a", { class: "brand", href: "#/" }, logo(), "hata"),
      h("nav", { class: "nav" }, navLinks("nav-link")),
      h("div", { class: "top-right" }, globalSearch(), isAdmin() && h("a", { class: "icon-btn top-tool" + (state.route.view === "terminal" ? " active" : ""), href: "#/terminal", title: t("terminal.title"), "aria-label": t("terminal.title") }, icon("terminal")), h("button", { type: "button", class: "user", onclick: userMenu }, h("span", { class: "avatar" }, state.user.name.slice(0, 1).toUpperCase()), h("span", { class: "user-name" }, state.user.name))),
    ),
    h("main", { id: "view" }, state.user.mustTwoFactor && h("p", { class: "banner" }, t("twofa.mustLead"), " ", h("a", { class: "link", href: "#/settings/account" }, t("twofa.mustGo"))), content),
    h("nav", { class: "bottom-bar" }, bottomLinks()),
  );
}

function render() {
  if (state.setup || !state.user) return authScreen();
  const view = state.route.view;
  if (view === "connect") return renderConnect();
  if (view === "welcome") return renderWelcome();
  if (view === "store") return renderStore();
  if (view === "settings") return renderSettings();
  if (view === "files") return renderFiles();
  if (view === "trash") return renderTrash();
  if (view === "myhata") return renderMyHata();
  if (view === "activity") return renderActivity();
  if (view === "backups") return renderBackups();
  if (view === "users") return renderUsers();
  if (view === "import") return renderImport();
  if (view === "terminal") return renderTerminal();
  if (view === "assistant") return renderAssistant();
  if (view === "machines") return renderMachines();
  if (view === "machine") return renderMachine();
  if (view === "proxmox") return renderPve();
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

/** The app's own name under the domain (the one that is set, or the local one), when Hata itself is opened by that domain; otherwise null */
function appDomain(app) {
  const site = state.overview?.site;
  const domain = [site?.domain, site?.local].find((name) => name && location.hostname === name);
  return domain && !app.hostname ? `${app.subdomain || app.name.replace(/_/g, "-")}.${domain}` : null;
}

function appUrl(app) {
  if (!app.port) return null;
  const host = appDomain(app);
  if (host) return `${location.protocol}//${host}${location.port ? ":" + location.port : ""}${app.index}`;
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
  const own = document.getElementById("own-name");
  if (own) own.textContent = s.hostname;
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
/** The "Add" tile: a doorway, which is moved about but never put into a folder */
const isAddTile = (item) => item.type === "builtin" && item.id === "add";
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
  // `<name>@<machine>` — an app of another machine
  if (item.type === "app") return item.name.includes("@") ? ((o.machineApps ?? []).find((app) => app.key === item.name) ?? null) : (o.apps.find((app) => app.name === item.name) ?? null);
  if (item.type === "files") return (o.folders ?? []).find((folder) => folder.path === item.path) ?? null;
  return item;
}

const tileTitle = (item) => {
  const target = tileTarget(item);
  if (item.type === "builtin") return t(item.id === "store" ? "home.store" : "home.add");
  return item.type === "app" ? (target?.title ?? item.name) : item.type === "files" ? (target?.name ?? item.path) : item.title || (item.type === "folder" ? t("home.folder") : linkHost(item.url));
};

function tileIcon(item, size = "") {
  const target = tileTarget(item);
  if (item.type === "app") return appIcon(target ?? { name: item.name }, size);
  if (item.type === "link") return appIcon({ name: item.id, title: tileTitle(item), icon: linkIcon(item) }, size);
  if (item.type === "files") return h("span", { class: `app-icon plus ${size}` }, icon(tileTarget(item)?.disk ? (tileTarget(item).disk.network ? "globe" : "disk") : "folder"));
  if (item.type === "builtin") return h("span", { class: `app-icon plus ${size}` }, icon(item.id === "store" ? "store" : "plus"));
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
  if (item.type === "app" && target.machine) {
    // an app of another machine: opened at the machine's address, managed on the machine's page
    const app = target;
    const st = (cls = target.machine.online ? appState(app) : "stopped");
    const url = isUp(app) ? machineAppUrl(target.machine, app) : null;
    href = url ?? `#/machines/${target.machine.id}/apps`;
    external = !!url;
    sub = [h("i", { class: "dot " + st }), target.machine.online ? (st === "running" && (app.guarded || app.port) ? (app.guarded ? `${location.hostname}:${app.guarded}` : `${target.machine.ip}:${app.port}`) : t("status." + st)) : t("machines.offline")];
    badges = [app.guarded && h("span", { class: "lock", title: t("access.protected") }, icon("lock")), h("span", { class: "lock", title: target.machine.name }, icon("server"))];
    side = admin && h("a", { class: "tile-open", href: `#/machines/${target.machine.id}/apps`, title: target.machine.name, "aria-label": `${target.machine.name}: ${title}` }, icon("sliders"));
  } else if (item.type === "app") {
    const app = target;
    const st = (cls = appState(app));
    const url = isUp(app) ? appUrl(app) : null;
    // the tile opens the app; while it has no page to open, its own page here
    href = url ?? `#/apps/${app.name}`;
    external = !!url;
    sub = [h("i", { class: "dot " + st }), st === "running" && appAddress(app) ? appAddress(app) : t("status." + st)];
    badges = [app.protected && h("span", { class: "lock", title: t("access.protected") }, icon("lock")), (app.update || app.newer?.length > 0) && isAdmin() && h("span", { class: "lock", title: t(app.update ? "app.storeUpdate" : "app.newer") }, icon("up"))];
    // an administrator gets what can be done to the app right there; a member, the app's page
    side = admin
      ? h("button", { type: "button", class: "tile-open", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${title}`, onclick: (e) => appTileMenu(app, e.currentTarget) }, icon("more"))
      : h("a", { class: "tile-open", href: `#/apps/${app.name}`, title: t("home.manage"), "aria-label": `${t("home.manage")}: ${title}` }, icon("sliders"));
  } else if (item.type === "link") {
    href = item.url;
    external = true;
    sub = linkHost(item.url);
    side = isAdmin() && h("button", { type: "button", class: "tile-open", title: t("home.editLink"), "aria-label": `${t("home.editLink")}: ${title}`, onclick: () => linkDialog(item) }, icon("sliders"));
  } else if (item.type === "builtin") {
    // Hata's own tiles: the store opens like an app, "Add" asks what to add
    href = "#/store";
    cls = item.id === "add" ? "add" : "";
    sub = t(item.id === "store" ? "home.storeHint" : "home.addHint");
  } else if (item.type === "files") {
    cls = target.missing ? "stopped" : "";
    href = filesHash(item.path);
    sub = h("span", { class: "mono clip", title: item.path }, target.missing ? t("home.folderMissing") : item.path);
    if (target.disk?.total && !target.missing) sub = diskRoom(target.disk, true);
  } else {
    const shown = item.items.filter(tileTarget).length;
    if (!shown) return null;
    sub = t("home.items", { n: shown });
  }
  // what has no page of its own to manage it gets a menu: where to move it, how to take it off
  if (admin && !side && !isAddTile(item)) side = h("button", { type: "button", class: "tile-open", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${title}`, onclick: () => tileMenu(item) }, icon("more"));
  const content = [tileIcon(item), h("span", { class: "tile-text" }, h("span", { class: "tile-top" }, h("span", { class: "tile-name" }, title), badges), h("span", { class: "tile-sub" }, sub))];
  const key = tileKey(item);
  const main =
    item.type === "folder" || isAddTile(item)
      ? h("button", { type: "button", class: "tile-main", onclick: () => homeUi.drag?.moved || (isAddTile(item) ? addDialog() : openFolder(item.id)) }, content)
      : h("a", { class: "tile-main", href, draggable: false, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, content);
  if (!admin) return h("div", { class: `tile kind-${item.type} ${cls}`, "data-key": key }, main, side);
  // an administrator moves tiles by dragging them; a long press of a finger is the start of that, not a menu
  return h("div", { class: `tile kind-${item.type} ${cls} movable`, "data-key": key, onpointerdown: (e) => dragStart(e, item), oncontextmenu: (e) => {
        if (homeUi.drag?.active) return e.preventDefault();
        // a right click on an app is the same menu as its button, where the pointer is
        if (e.pointerType === "touch") return;
        e.preventDefault();
        // "Add" offers what it adds, where the pointer is
        if (isAddTile(item)) addDialog({ x: e.clientX, y: e.clientY });
        else if (item.type === "app" && !target.machine) appTileMenu(target, null, { x: e.clientX, y: e.clientY });
        else tileMenu(item, { x: e.clientX, y: e.clientY });
      }, ondragstart: (e) => e.preventDefault() }, main, side);
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
    if (!at || (at.folder && (item.type === "folder" || isAddTile(item)))) return;
    at.list.splice(at.index + (where.after ? 1 : 0), 0, item);
  } else if (where.folder) {
    const folder = allFolders(layout).find((f) => f.id === where.folder);
    if (!folder || item.type === "folder" || isAddTile(item)) return;
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
  if (!own || own.item.type === "folder" || isAddTile(own.item)) return;
  const folder = { type: "folder", id: newId(), title, items: [own.item] };
  if (!ontoKey) {
    if (own.folder) return;
    own.list[own.index] = folder;
    return saveLayout(layout);
  }
  takeTile(layout, key);
  const at = locate(layout, ontoKey);
  if (!at || at.folder || at.item.type === "folder" || isAddTile(at.item)) return;
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
function tileMenu(item, point = null) {
  const key = tileKey(item);
  const layout = state.overview.dashboard;
  const at = locate(layout, key);
  if (!at) return;
  let dialog;
  const entry = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  const groupName = (group) => group.title || t("home.apps");
  const neighbour = (step) => at.list[at.index + step];
  dialog = openDialog(
    point ? "menu dropdown" : "menu",
    h("header", null, tileIcon(item), h("div", null, h("h2", { class: "clip" }, tileTitle(item)), h("span", { class: "muted small" }, at.folder ? at.folder.title || t("home.folder") : groupName(at.group)))),
    item.type === "link" && entry(t("home.editLink"), "edit", () => linkDialog(item)),
    item.type === "folder" && entry(t("common.open"), "folder", () => openFolder(item.id)),
    item.type === "folder" && entry(t("files.rename"), "edit", () => renameFolderDialog(item)),
    neighbour(-1) && entry(t("home.moveEarlier"), "arrow", () => moveTile(key, { before: tileKey(neighbour(-1)) }), "flip"),
    neighbour(1) && entry(t("home.moveLater"), "arrow", () => moveTile(key, { after: tileKey(neighbour(1)) })),
    at.folder && entry(t("home.outOfFolder"), "signout", () => outOfFolder(key)),
    item.type !== "folder" && !isAddTile(item) && allFolders(layout).filter((folder) => folder !== at.folder).map((folder) => entry(t("home.intoFolder", { name: folder.title || t("home.folder") }), "folder", () => moveTile(key, { folder: folder.id }))),
    item.type !== "folder" && !isAddTile(item) && !at.folder && entry(t("home.newFolder"), "plus", () => nameDialog(t("home.newFolder"), "", t("files.create"), (title) => makeFolder(key, null, title))),
    layout.groups.filter((group) => group !== at.group || at.folder).map((group) => entry(t("home.toGroup", { name: groupName(group) }), "grid", () => moveTile(key, { group: group.id }))),
    entry(t("home.toNewGroup"), "plus", () => newGroupDialog((id) => moveTile(key, { group: id }))),
    item.type === "folder" && entry(t("home.ungroup"), "x", () => changeLayout((next) => void locate(next, key).list.splice(at.index, 1, ...item.items))),
    item.type === "link" && entry(t("home.removeLink"), "trash", () => changeLayout((next) => void takeTile(next, key)), "danger"),
    item.type === "files" && entry(t("files.unpin"), "home", () => pinFolder(item.path, false)),
  );
  if (point) placeAt(dialog, point);
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
  );
  return h("div", { class: "section-head" }, h("h2", null, title, first && !group.title && h("span", { class: "muted small" }, t("home.installed", { n: count }))), tools);
}

/** What can be put on the dashboard, to choose from */
function addDialog(at = null) {
  let dialog;
  const entry = (label, hint, iconName, action) => h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), action()) }, h("span", { class: "app-icon plus" }, icon(iconName)), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, label), h("span", { class: "muted small" }, hint)));
  const pinned = () => (state.overview.folders ?? []).map((folder) => folder.path);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("h2", null, t("home.addTitle"))),
    entry(t("home.addApp"), t("home.addAppHint"), "store", () => go("#/store")),
    state.overview.importable > 0 && entry(t("home.import"), t("home.importHint", { n: state.overview.importable }), "download", () => go("#/import")),
    entry(t("home.addLinkItem"), t("home.addLinkHint"), "link", () => linkDialog()),
    entry(t("home.addGroupItem"), t("home.addGroupHint"), "grid", () => newGroupDialog()),
    state.overview.dashboard.widgets.hidden.map((id) =>
      entry(blockTitle(id), t("home.addBlockHint"), BLOCKS[id].icon, () =>
        changeLayout((layout) => {
          layout.widgets.hidden = layout.widgets.hidden.filter((block) => block !== id);
          layout.widgets[BLOCKS[id].zone].push(id);
        }),
      ),
    ),
    (state.overview.machines ?? []).filter((m) => !ZONES.some((name) => state.overview.dashboard.widgets[name].includes("machine:" + m.id))).map((m) =>
      entry(t("home.machineBlock", { name: m.name }), t("home.machineBlockHint"), "server", () => changeLayout((layout) => layout.widgets.top.push("machine:" + m.id))),
    ),
    entry(t("home.addDisk"), t("home.addDiskHint"), "disk", () => diskPickDialog(pinned())),
    entry(t("home.addFolder"), t("home.addFolderHint"), "folder", () => folderPicker({ title: t("home.addFolderTitle"), start: "", confirmLabel: t("home.addFolderHere"), allowed: (at) => !pinned().includes(at), action: (at) => pinFolder(at, true, false) })),
  );
  if (at) {
    placeAt(dialog, at);
    dialog.tabIndex = -1;
    dialog.focus();
  }
}

/** The disks and network places of the server, to put one on the dashboard: its tile says how full it is */
async function diskPickDialog(pinned) {
  let disks;
  try {
    disks = (await api("GET", "/api/files?path=")).disks ?? [];
  } catch (e) {
    return toast(errorText(e), "error");
  }
  let dialog;
  const row = (d) => {
    const on = pinned.includes(d.path);
    return h(
      "button",
      { type: "button", class: "menu-item disk-pick", disabled: on, onclick: async () => {
        dialog.close();
        await pinFolder(d.path, true, true, volumeName(d));
      } },
      h("span", { class: "app-icon plus" }, icon(d.network ? "globe" : "disk")),
      h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, volumeName(d)), on ? h("span", { class: "muted small" }, t("home.diskThere")) : d.total ? diskRoom(d) : h("span", { class: "muted small mono" }, d.path)),
    );
  };
  dialog = openDialog(
    "menu",
    h("header", null, h("h2", null, t("home.addDiskTitle"))),
    disks.length ? disks.map(row) : h("p", { class: "muted" }, t("home.noDisks")),
    h("footer", null, closeButton(() => dialog)),
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
      if (!tiles.length && !admin) return null;
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
          admin && !tiles.length && h("p", { class: "muted small drop-hint" }, t("home.emptyGroup")),
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

const DROP_CLASSES = ["drop-into"];

/**
 * A press on something that can be moved — a tile, a group (by its heading), a block of the dashboard:
 * a mouse drags once it moves, a finger after holding still — moving first is scrolling. `kind` says
 * where it may land (`find`) and what a drop does (`drop`). What is dragged stays in the page as its own
 * outline and moves there as the pointer goes, the others making room: the page shows how it will be.
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
    drag.home = { parent: el.parentNode, next: el.nextSibling };
    for (const marked of drag.ghost.querySelectorAll("[id]")) marked.removeAttribute("id");
    // a modal dialog is drawn above everything else on the page
    // inside the page, so it keeps the looks the page gives it
    (homeUi.folder?.dialog ?? document.getElementById("view") ?? document.body).append(drag.ghost);
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
  // Escape puts it back where it was
  const key = (ev) => ev.key === "Escape" && drag.active && (ev.preventDefault(), dragEnd(false));
  // while a tile is in the air the page under the finger stays put
  const still = (ev) => drag.active && ev.cancelable && ev.preventDefault();
  drag.stop = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    removeEventListener("touchmove", still);
    removeEventListener("keydown", key, true);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  addEventListener("touchmove", still, { passive: false });
  addEventListener("keydown", key, true);
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
  sibling: ".group[data-group-id]",
  key: "groupId",
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
  sibling: ".widget[data-widget]",
  key: "widget",
  end: (zone) => ({ zone: zone.dataset.zone }),
  ignore: "button, a, input",
  find: (drag) => {
    const beside = besideBlock(drag, ".widget[data-widget]", "widget");
    if (beside) return beside;
    // not over a block: the free room of a place below its blocks takes the block at its end
    const under = document.elementFromPoint(drag.x, drag.y);
    const zone = under?.closest("[data-zone]");
    if (!zone || under.closest(".widget")) return null;
    const last = [...zone.querySelectorAll(":scope > .widget")].filter((w) => w !== drag.el).at(-1);
    return !last || drag.y > last.getBoundingClientRect().bottom ? { el: zone, cls: "drop-end", zone: zone.dataset.zone } : null;
  },
  drop: (drag, target) =>
    changeLayout((layout) => {
      const zones = Object.fromEntries(ZONES.map((name) => [name, layout.widgets[name]]));
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
  sibling: ".tile[data-key]",
  key: "key",
  end: (list) => ({ group: list.dataset.group }),
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
    const mayJoin = !open && drag.item.type !== "folder" && !isAddTile(drag.item) && key !== "builtin:add";
    if (mayJoin && part > 0.28 && part < 0.72) return key.startsWith("folder:") ? { el: over, cls: "drop-into", folder: key.slice(7) } : { el: over, cls: "drop-into", onto: key };
    return part < 0.5 ? { el: over, cls: "drop-before", before: key } : { el: over, cls: "drop-after", after: key };
  }
  // the room after the last tile of a group; a gap between two tiles is not the end
  const list = under.closest(".tiles[data-group]");
  if (!list || over) return null;
  const last = [...list.querySelectorAll(":scope > .tile[data-key]")].filter((tile) => tile !== drag.el).at(-1)?.getBoundingClientRect();
  return !last || drag.y > last.bottom || (drag.y >= last.top && drag.x > last.right) ? { el: list, cls: "drop-end", group: list.dataset.group } : null;
}

function dragMove(drag) {
  drag.ghost.style.transform = `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)`;
  let target = drag.kind.find(drag);
  // over its own outline, or between two things: it stays where it is shown
  if (!target && drag.target && !drag.target.out && drag.target.cls !== "drop-into") target = drag.target;
  drag.marked?.classList.remove(...DROP_CLASSES);
  homeUi.folder?.dialog.classList.toggle("drop-out", !!target?.out);
  drag.marked = null;
  if (target?.cls === "drop-into") (drag.marked = target.el).classList.add("drop-into");
  else if (target?.el && target !== drag.target) makeRoom(drag, target);
  drag.target = target;
}

/** The outline of what is dragged goes where it would land, and the others move aside */
function makeRoom(drag, target) {
  const { el } = drag;
  const before = target.cls === "drop-before" || target.cls === "drop-above";
  const after = target.cls === "drop-after" || target.cls === "drop-below";
  if (before && target.el.previousElementSibling !== el) target.el.before(el);
  else if (after && target.el.nextElementSibling !== el) target.el.after(el);
  else if (target.cls === "drop-end" && target.el.lastElementChild !== el) target.el.append(el);
  else return;
  drag.shifted = true;
  if (drag.kind === WIDGET_DRAG) markEmptyZones();
}

const markEmptyZones = () => document.querySelectorAll(".zone[data-zone]").forEach((zone) => zone.classList.toggle("empty", !zone.querySelector(":scope > .widget")));

/** Where the outline stands, said as the drop of the kind takes it: after the one before it, before the one after it, or at the end */
function landing(drag) {
  const { el, kind } = drag;
  const near = (step) => {
    let at = el[step];
    while (at && !(at.matches(kind.sibling) && !at.classList.contains("drag-ghost"))) at = at[step];
    return at;
  };
  const prev = near("previousElementSibling");
  if (prev) return { after: prev.dataset[kind.key] };
  const next = near("nextElementSibling");
  if (next) return { before: next.dataset[kind.key] };
  return kind.end?.(el.parentElement) ?? null;
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
  const last = drop && drag.active ? drag.target : null;
  const target = last?.out || last?.cls === "drop-into" ? last : drop && drag.shifted ? landing(drag) : null;
  if (!target) {
    // let go somewhere else: it goes back where it was
    if (drag.shifted && drag.home.parent.isConnected) drag.home.parent.insertBefore(drag.el, drag.home.next?.parentNode === drag.home.parent ? drag.home.next : null);
    if (drag.kind === WIDGET_DRAG) markEmptyZones();
    if (homeUi.stale) setTimeout(renderHomeBody);
    return;
  }
  homeUi.drag = null;
  drag.kind.drop(drag, target);
}

const ATTENTION_ICONS = { update: "up", docker: "box", restarting: "refresh", partial: "alert", disk: "disk", smart: "disk", memory: "memory", temperature: "temp", internet: "network", network: "network", array: "disk", share: "share", netplace: "globe", machine: "server", pve: "server", absent: "disk" };

function attentionItem(item) {
  const detail = { ...item.detail, free: item.detail.free == null ? "" : bytes(item.detail.free), trash: item.detail.trash == null ? "" : bytes(item.detail.trash), size: item.detail.size == null ? "" : bytes(item.detail.size) };
  const base = "attention." + item.code;
  const open = (href, label = t("common.open")) => h("a", { class: "btn small", href }, label);
  // every button sits under the words, the one that does the thing first: beside them it leaves the words a narrow column
  const below = [
    item.app && isAdmin() && assistantReady() && button(t("assistant.askWhy"), { class: "small", onclick: () => openAssistant({ ask: t("assistant.whyDown", { title: item.detail.title || item.app, app: item.app }) }) }, "chat"),
    item.code === "docker.missing" && isAdmin() && button(t("docker.install"), { class: "small primary", onclick: () => dockerDialog() }, "download"),
    item.code === "docker.stopped" && isAdmin() && dockerStartButton(),
    item.code === "disk.usb" && isAdmin() && button(t("copyin.button"), { class: "small primary", onclick: () => ((state.copyInFrom = item.detail.id), go("#/settings/storage")) }, "download"),
    (item.code === "disk.new" || item.code.startsWith("absent")) && isAdmin() && open("#/settings/storage", t("attention.disk.open")),
    item.code === "update" && open("#/settings/about"),
    item.code === "disk.trash" && open("#/trash", t("trash.title")),
    (item.code.startsWith("smart.") || item.code === "disk.filling" || item.code.startsWith("array.")) && open("#/settings/storage"),
    (item.code.startsWith("internet.") || item.code === "network.exposed") && open("#/settings/network"),
    item.code.startsWith("share.") && open("#/settings/shares"),
    item.code === "netplace.down" && open("#/settings/storage"),
    item.code === "machine.away" && open(`#/machines/${item.detail.id}`),
    item.code.startsWith("pve.") && state.route.view !== "proxmox" && open(`#/proxmox/${item.detail.host}${item.code === "pve.guestDown" ? "/guests" : item.code === "pve.backupFailed" ? "/tasks" : ""}`),
    (item.code === "machine.restarting" || item.code === "machine.partial") && open(`#/machines/${item.detail.id}/apps`),
    item.app && open(`#/apps/${item.app}${item.code === "restarting" || item.code === "partial" ? "/logs" : ""}`, t(item.code === "restarting" || item.code === "partial" ? "app.logs" : "common.open")),
    (item.code === "disk.new" || item.code === "disk.usb") && isAdmin() && button(t("mounting.ignore"), { class: "small quiet", onclick: () => void api("POST", "/api/disks/ignore", { id: item.detail.id }).then(refresh, (e) => toast(errorText(e), "error")) }),
    isAdmin() && button(t("attention.later", { n: SNOOZE_DAYS }), { class: "small quiet", title: t("attention.laterHint"), onclick: () => snoozeItem(item) }, "clock"),
  ].filter(Boolean);
  return h(
    "div",
    { class: "attention-item" },
    h("span", { class: "badge-icon " + item.severity }, icon(ATTENTION_ICONS[item.code.split(".")[0]] ?? "alert")),
    h("div", { class: "grow" }, h("strong", null, t(base + ".title", detail)), h("p", { class: "muted small" }, t(base + ".text", detail).trim()), below.length > 0 && h("div", { class: "row-actions under" }, below)),
  );
}

/** How long "remind me later" puts an item off; it comes back sooner if it gets worse */
const SNOOZE_DAYS = 3;

async function snoozeItem(item) {
  try {
    await api("POST", "/api/attention/snooze", { id: item.id, severity: item.severity, ...(item.at ? { at: item.at } : {}), days: SNOOZE_DAYS });
    toast(t("attention.snoozed", { date: shortDate(Date.now() + SNOOZE_DAYS * 86_400_000) }));
    await refresh();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function dockerStartButton() {
  return button(t("docker.start"), {
    class: "small primary",
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      try {
        await api("POST", "/api/docker/start", {});
        toast(t("docker.started"));
      } catch (err) {
        toast(errorText(err), "error");
      }
      void refresh();
    },
  });
}

/** Docker is what the apps run in: what it is, the command that installs it, and the button */
async function dockerDialog() {
  const info = await api("GET", "/api/docker").catch(() => ({ install: "" }));
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("docker.title")), closeX(() => dialog)),
    h("p", null, t("docker.what")),
    h("p", { class: "muted small" }, t("docker.why")),
    h("p", { class: "cmd" }, icon("terminal"), info.install),
    h("p", { class: "muted small" }, t("docker.how")),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("docker.install"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const res = await api("POST", "/api/docker/install", {});
            dialog.close();
            jobDialog(res.job, "docker", "", () => void refresh());
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }, "download"),
    ),
  );
}

const ACTIVITY_ICONS = { rename: "edit", move: "arrow", copy: "copy", delete: "trash", deleteForever: "trash", purge: "trash", extract: "archive", terminal: "terminal", install: "download", update: "up", start: "play", stop: "stop", restart: "refresh", remove: "trash", apply: "code", backup: "archive", restore: "undo", snapshot: "trash", import: "download", packages: "up" };

function activityItem(entry, when) {
  const [group, kind, outcome] = entry.code.split(".");
  const failed = outcome === "failed";
  const key = "activity." + entry.code;
  const title = state.overview?.apps.find((a) => a.name === entry.app)?.title ?? entry.app ?? "";
  const meta = [typeof when === "string" ? when : ago(entry.ts), entry.machine && t("activity.onMachine", { name: entry.machine }), entry.user && group !== "auth" ? (entry.user === "schedule" ? t("activity.bySchedule") : entry.user === "restore" ? t("activity.byRestore") : entry.user === "console" ? t("activity.byConsole") : entry.user === "disk" ? t("activity.byDisk") : entry.user.startsWith("agent:") ? t("activity.byAgent", { name: entry.user.slice(6) }) : entry.user.startsWith("assistant:") ? t("activity.byAssistant", { user: entry.user.slice(10) }) : t("activity.by", { user: entry.user })) : null, group === "auth" ? entry.detail : null].filter(Boolean).join(" · ");
  return h(
    "div",
    { class: "activity-item" },
    icon(group === "auth" ? "signin" : group === "users" ? "user" : failed ? "x" : (ACTIVITY_ICONS[kind] ?? "check"), failed ? "danger" : ""),
    h("div", { class: "grow" }, h("div", null, has(key) ? t(key, { app: title, user: entry.user ?? "", target: entry.detail ?? "" }) : entry.code), h("div", { class: "muted small" }, meta), failed && entry.detail && h("div", { class: "muted small clip" }, entry.detail)),
    entry.code === "app.update.done" && !entry.machine && isAdmin() && Date.now() - entry.ts < UNDO_DAYS * 86400_000 && button(t("activity.undo"), { class: "small ghost", onclick: () => undoUpdate(entry) }, "undo"),
  );
}

/** How long after an update its "Undo" is offered: pre-update snapshots are few and get replaced */
const UNDO_DAYS = 7;

/** An update undone: the snapshot taken right before it, restored the usual way */
async function undoUpdate(entry) {
  let overview;
  try {
    overview = await api("GET", `/api/backups?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const app = overview.apps.find((a) => a.name === entry.app);
  // the snapshot is taken inside the update job, so within the minutes before it was done
  const before = (app?.snapshots ?? []).filter((s) => s.reason === "pre-update" && s.at <= entry.ts && entry.ts - s.at < 3 * 3600_000).sort((a, b) => b.at - a.at)[0];
  if (!before) return toast(t("activity.undoNone"), "error");
  restoreDialog(app, before);
}

// --- The whole history ----------------------------------------------------------------------------

const historyUi = { entries: [], more: false, loaded: false, filter: "", quiet: false };

async function loadHistory(older = false) {
  const before = older && historyUi.entries.length ? historyUi.entries[historyUi.entries.length - 1].ts : Date.now() + 60_000;
  try {
    const page = await api("GET", `/api/activity?before=${before}`);
    historyUi.entries = older ? [...historyUi.entries, ...page.entries] : page.entries;
    historyUi.more = page.more;
    historyUi.loaded = true;
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (state.route.view === "activity") paintHistory();
}

function paintHistory() {
  const box = document.getElementById("history");
  if (!box) return;
  if (!historyUi.loaded) return box.replaceChildren(h("p", { class: "muted" }, "…"));
  // each entry is worded first: the filter looks at what the person reads, in their language
  const words = historyUi.filter.trim().toLowerCase();
  const days = new Map();
  for (const entry of historyUi.entries) {
    if (historyUi.quiet && entry.code.startsWith("auth.signin")) continue;
    const row = activityItem(entry, new Date(entry.ts).toLocaleTimeString(state.lang, { hour: "2-digit", minute: "2-digit" }));
    if (words && !row.textContent.toLowerCase().includes(words)) continue;
    const day = new Date(entry.ts).toLocaleDateString(state.lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(row);
  }
  put(
    box,
    days.size ? [...days].map(([day, rows]) => h("section", { class: "card pad history-day" }, h("h3", null, day), rows)) : h("p", { class: "card pad muted" }, t(words ? "activity.noMatch" : "activity.none")),
    historyUi.more && h("div", { class: "center-row" }, button(t("activity.older"), { onclick: (e) => ((e.currentTarget.disabled = true), loadHistory(true)) })),
    !historyUi.more && days.size > 0 && h("p", { class: "muted small center-row" }, t("activity.start")),
  );
}

function renderActivity() {
  const search = h("input", { type: "search", placeholder: t("activity.search"), value: historyUi.filter, oninput: () => ((historyUi.filter = search.value), paintHistory()) });
  const quiet = h("input", { type: "checkbox", checked: historyUi.quiet, onchange: () => ((historyUi.quiet = quiet.checked), paintHistory()) });
  shell(h("div", { class: "page-head" }, h("div", null, h("h1", null, t("activity.history")), h("p", { class: "meta" }, t("activity.historyLead"))), h("div", { class: "actions" }, h("label", { class: "check inline" }, quiet, h("span", null, t("activity.noSignins"))), search)), h("div", { id: "history", class: "stack" }));
  paintHistory();
  void loadHistory();
}

function widget(id, el) {
  el.classList.add("widget");
  el.dataset.widget = id;
  // the numbers are dragged by any part of them, save a link; a list with text to read and select, by its heading
  el.addEventListener("pointerdown", (e) => isAdmin() && ((isNumbers(id) && !e.target.closest("a")) || e.target.closest(".section-head")) && dragStart(e, id, WIDGET_DRAG));
  return el;
}

const isNumbers = (id) => id === "stats" || id.startsWith("machine:");
const machineOfBlock = (id) => (state.overview?.machines ?? []).find((m) => "machine:" + m.id === id);

/** The block of another machine's numbers: made when it is first on the page, refilled as its numbers come */
function machineBlock(id) {
  const m = machineOfBlock(id);
  if (!m) return null;
  const prefix = "mb-" + m.id;
  let el = homeUi.widgets[id];
  if (!el) {
    el = widget(id, h("section", { class: "card machine-block" }, h("div", { class: "block-head" }), h("div", { class: "stats" }, statCells(prefix)), h("p", { class: "pad muted", hidden: true }), blockRemover(id)));
    homeUi.widgets[id] = el;
  }
  const [head, cells, away] = el.children;
  put(head, h("h2", null, h("a", { href: `#/machines/${m.id}` }, icon("server"), m.name)), machineChip(m), h("span", { class: "muted small grow" }, m.os));
  cells.hidden = !m.online || !m.status;
  away.hidden = !cells.hidden;
  away.textContent = m.online ? "…" : t("machines.offlineLead", { ago: ago(m.seen) });
  if (!cells.hidden) paintStats(prefix, m.status);
  return el;
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting = t(hour < 5 ? "home.night" : hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: state.user.name });
  // the blocks are made once and then only moved and refilled: the numbers of the system live in one of them
  homeUi.widgets = {
    stats: widget("stats", h("section", { class: "card machine-block" }, h("div", { class: "block-head" }, h("h2", null, icon("server"), h("span", { id: "own-name" }, state.overview?.system?.hostname ?? "…")), h("span", { class: "muted small grow" }, t("home.thisServer"))), h("div", { class: "stats" }, statCell("cpu", "cpu", t("sys.cpu")), statCell("memory", "memory", t("sys.memory")), statCell("disk", "disk", t("sys.disk")), statCell("network", "network", t("sys.network")), h("div", { class: "stat", id: "stat-temp", hidden: true }, h("div", { class: "stat-label" }, icon("temp"), t("sys.temperature")), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, "—"), h("span", { class: "unit" })), h("div", { class: "stat-chart" })), h("div", { class: "stat-hint" }, " "))), blockRemover("stats"))),
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

  put(homeUi.widgets.attention, blockRemover("attention"), h("div", { class: "section-head" }, h("h2", null, t("attention.title"), o.attention.length > 0 && h("span", { class: "pill" }, o.attention.length))), o.attention.length ? o.attention.map(attentionItem) : h("p", { class: "all-good" }, icon("check", "ok"), t("attention.none")));
  put(homeUi.widgets.activity, blockRemover("activity"), h("div", { class: "section-head" }, h("h2", null, t("activity.title"))), o.activity.length ? o.activity.map(activityItem) : h("p", { class: "muted small" }, t("activity.none")), isAdmin() && o.activity.length > 0 && h("a", { class: "link small all-activity", href: "#/activity" }, t("activity.all"), icon("chevron")));
  for (const name of ZONES) for (const id of o.dashboard.widgets[name]) if (id.startsWith("machine:")) machineBlock(id);
  if (!homeUi.drag?.active) placeWidgets();
  renderSystem();
}

const ZONES = ["top", "side", "bottom"];
/** Hata's own blocks: the picture of one in the "Add" menu and where it goes when it is put back */
const BLOCKS = { stats: { icon: "cpu", zone: "top" }, attention: { icon: "alert", zone: "side" }, activity: { icon: "list", zone: "side" } };
const blockTitle = (id) => (id.startsWith("machine:") ? t("home.machineBlock", { name: machineOfBlock(id)?.name ?? id.slice(8) }) : t(id === "stats" ? "home.statsBlock" : id + ".title"));

/** The small button that takes one of Hata's own blocks off the dashboard; the "Add" menu brings it back */
function blockRemover(id) {
  if (!isAdmin()) return null;
  return h("button", {
    type: "button",
    class: "icon-btn quiet block-remove",
    title: t("home.removeBlock"),
    "aria-label": `${t("home.removeBlock")}: ${blockTitle(id)}`,
    onclick: () =>
      changeLayout((layout) => {
        for (const name of ZONES) layout.widgets[name] = layout.widgets[name].filter((block) => block !== id);
        // a machine's block is offered again by the machine itself
        if (!id.startsWith("machine:")) layout.widgets.hidden.push(id);
      }),
  }, icon("x"));
}

function layoutTextDialog() {
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", "aria-label": t("home.layoutText"), disabled: true });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const save = button(t("home.saveLayout"), {
    class: "primary",
    disabled: true,
    onclick: async () => {
      error.textContent = "";
      try {
        await api("PUT", "/api/dashboard/text", { text: area.value });
        dialog.close();
        await refresh();
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  dialog = openDialog("xwide", h("header", null, h("div", null, h("h2", null, t("home.layoutText")), h("p", { class: "muted small" }, t("home.layoutTextLead")))), area, error, h("footer", null, closeButton(() => dialog, t("common.cancel")), save));
  api("GET", "/api/dashboard/text").then(
    ({ text }) => {
      area.value = text;
      area.disabled = false;
      area.addEventListener("input", () => (save.disabled = area.value === text));
    },
    (e) => (error.textContent = errorText(e)),
  );
}

/** Puts every block into its place; a place with nothing in it shows only while a block is in the air */
function placeWidgets() {
  for (const name of ZONES) {
    const ids = state.overview.dashboard.widgets[name];
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

/** What can be done to an app from its tile: open it, start or stop it, go to its settings, logs and the rest */
function appTileMenu(app, anchor, at) {
  let dialog;
  const url = isUp(app) ? appUrl(app) : null;
  const busy = !!app.job;
  const item = (label, iconName, action, cls = "", off = false) => h("button", { type: "button", class: "menu-item " + cls, disabled: off, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  const page = (label, iconName, tab) => h("a", { class: "menu-item", href: `#/apps/${app.name}${tab ? "/" + tab : ""}`, onclick: () => dialog.close() }, icon(iconName), label);
  dialog = openDialog(
    "menu dropdown",
    h("header", null, appIcon(app), h("div", null, h("h2", { class: "clip" }, app.title), stateChip(app))),
    url && h("a", { class: "menu-item", href: url, target: "_blank", rel: "noopener noreferrer", onclick: () => dialog.close() }, icon("external"), t("app.open")),
    busy && item(t("status.busy"), "terminal", () => jobDialog(app.job.id, app.job.kind, app.title)),
    isUp(app) ? item(t("app.stop"), "stop", () => startAction(app, "stop"), "", busy) : item(t("app.start"), "play", () => startAction(app, "start"), "", busy),
    isUp(app) && item(t("app.restart"), "refresh", () => startAction(app, "restart"), "", busy),
    app.update && item(t("app.storeUpdate"), "up", () => storeUpdateDialog(app), "", busy),
    !app.update && app.newer?.length > 0 && item(t("app.update"), "up", () => startAction(app, "update"), "", busy),
    page(t("app.tab.settings"), "sliders", "settings"),
    page(t("app.logs"), "logs", "logs"),
    page(t("app.tab.terminal"), "terminal", "terminal"),
    page(t("app.tab.backups"), "archive", "backups"),
    assistantReady() && item(t("assistant.ask"), "chat", () => openAssistant({ draft: t("assistant.aboutApp", { title: app.title, app: app.name }) })),
    page(t("home.manage"), "grid", ""),
    item(t("app.remove"), "trash", () => removeDialog(app), "danger", busy),
  );
  if (at) return placeAt(dialog, at);
  // it hangs under the button it was opened from, by the button's right edge — or above it, when there is no room below
  const box = anchor.getBoundingClientRect();
  const below = box.bottom + 6 + dialog.offsetHeight <= document.documentElement.clientHeight - 8;
  placeAt(dialog, { x: box.right - dialog.offsetWidth, y: below || box.top - 6 - dialog.offsetHeight < 8 ? box.bottom + 6 : box.top - 6 - dialog.offsetHeight });
}

function appMoreMenu(app, at = null) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, disabled: !!app.job, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, appIcon(app), h("div", null, h("h2", null, app.title), stateChip(app))),
    assistantReady() && h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), openAssistant({ draft: t("assistant.aboutApp", { title: app.title, app: app.name }) })) }, icon("chat"), t("assistant.ask")),
    item(t("app.update"), "up", () => startAction(app, "update")),
    item(t("machines.move"), "server", () => moveAppDialog("", app)),
    item(t("app.remove"), "trash", () => removeDialog(app), "danger"),
  );
  if (at) placeAt(dialog, at);
}

function renderAppHead() {
  const app = state.app;
  const head = document.getElementById("app-head");
  if (!app || !head) return;
  const url = isUp(app) ? appUrl(app) : null;
  const tab = (id, iconName) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `#/apps/${app.name}${id === "overview" ? "" : "/" + id}` }, icon(iconName), t("app.tab." + id));
  put(head,
    h("nav", { class: "crumbs" }, h("a", { href: "#/" }, t("home.apps")), icon("chevron"), h("span", null, app.title)),
    h(
      "div",
      { class: "app-head", menu: isAdmin() && ((at) => appTileMenu(app, null, at)) },
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
        !app.update && app.newer?.length > 0 && !app.job && button(t("app.update"), { class: "accent", title: `${t("app.newer")}: ${app.newer.join(", ")}`, onclick: () => startAction(app, "update") }, "up"),
        (app.status === "partial" || app.status === "restarting") && assistantReady() && button(t("assistant.askWhy"), { onclick: () => openAssistant({ ask: t("assistant.whyDown", { title: app.title, app: app.name }) }) }, "chat"),
        isUp(app) && button(t("app.restart"), { disabled: !!app.job, onclick: () => startAction(app, "restart") }, "refresh"),
        isUp(app) ? button(t("app.stop"), { disabled: !!app.job, onclick: () => startAction(app, "stop") }, "stop") : button(t("app.start"), { class: url ? "" : "primary", disabled: !!app.job, onclick: () => startAction(app, "start") }, "play"),
        url && h("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("app.open"))),
        h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: () => appMoreMenu(app) }, icon("more")),
        ]),
      ),
    ),
    isAdmin() && h("div", { class: "tabs" }, tab("overview", "grid"), tab("settings", "sliders"), tab("logs", "logs"), tab("compose", "code"), tab("backups", "archive"), tab("terminal", "terminal")),
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
  if (state.route.tab === "settings") return appSettingsTab(app, box);
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
    const menu = (at) =>
      menuAt(at, menuHeader(c.name, c.image, "box"), [
        { label: t("app.logs"), icon: "logs", href: `#/apps/${app.name}/logs` },
        isAdmin() && { label: t("app.tab.terminal"), icon: "terminal", href: `#/apps/${app.name}/terminal` },
        { label: t("menu.copyName"), icon: "copy", run: () => copyText(c.name) },
        { label: t("menu.copyImage"), icon: "copy", run: () => copyText(c.image) },
      ]);
    return h("tr", { menu }, h("td", null, h("div", { class: "mono" }, c.name), h("div", { class: "muted small mono clip" }, c.image), app.newer?.includes(c.image) && h("div", { class: "small accent-text" }, t("app.newerImage"))), h("td", null, h("span", { class: "state " + (c.state === "running" ? "running" : c.state === "restarting" ? "restarting" : "stopped") }, c.status)), h("td", { class: "num" }, s ? s.cpu.toFixed(1) + " %" : "—"), h("td", { class: "num" }, s ? bytes(s.memory) : "—"), h("td", { class: "mono small" }, c.ports.join(", ") || "—"));
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

const streamLogs = (app, log, signal) => followText(`/api/apps/${app.name}/logs`, log, signal);

/** A text stream into a <pre>, kept scrolled to the end while the reader is there */
function followText(url, log, signal) {
  return (async () => {
    try {
      const res = await fetch(url, { signal });
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

// --- Machines ---------------------------------------------------------------------------------------
// Other machines with Hata's client: their state, their containers and a terminal. The client connects
// to Hata, so whatever the page asks goes over that connection; `machine` events bring the state.

const machinesUi = { list: null, current: null, containers: null, apps: null };

async function loadMachines() {
  try {
    machinesUi.list = await api("GET", "/api/machines");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "machines") renderMachinesBody();
  if (state.route.view === "machine") {
    machinesUi.current = machinesUi.list.machines.find((m) => m.id === state.route.id) ?? null;
    renderMachineHead();
    // opened straight from an address, the tab is drawn once the machine is known
    if (!document.getElementById("machine-tab")?.hasChildNodes()) renderMachineTab();
    else if (state.route.tab === "overview") paintMachineOverview();
  }
}

/** A machine's news: its state every few seconds, or its containers changed */
function machineEvent(event) {
  // its block on the home page
  const shown = event.status && state.route.view === "home" && machineOfBlock("machine:" + event.id);
  if (shown) {
    shown.status = event.status;
    if (homeUi.widgets?.["machine:" + event.id]) machineBlock("machine:" + event.id);
  }
  const m = machinesUi.list?.machines.find((x) => x.id === event.id);
  if (!m) return;
  if (event.status) m.status = event.status;
  if (state.route.view === "machines" && event.status) paintMachineCard(m);
  if (state.route.view !== "machine" || state.route.id !== event.id) return;
  if (event.status && state.route.tab === "overview") paintMachineStats(m);
  if (event.containers && state.route.tab === "containers") void loadMachineContainers();
}

const machineChip = (m) => h("span", { class: "state " + (m.online ? "running" : "") }, m.online ? t("machines.online") : t("machines.offline"));
const machineOs = (m) => [m.info?.os, m.info?.arch].filter(Boolean).join(" · ");

function renderMachines() {
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("nav.machines")), h("p", { class: "meta", id: "machines-meta" }, t("machines.lead"))), h("div", { class: "actions" }, button(t("pve.add"), { onclick: () => pveDialog() }, "plus"), button(t("machines.add"), { class: "primary", onclick: addMachineDialog }, "plus"))),
    h("div", { id: "machines-body" }),
    h("div", { id: "pve-list", class: "stack" }),
  );
  if (machinesUi.list) renderMachinesBody();
  if (pveUi.list) paintPveList();
}

function renderMachinesBody() {
  const box = document.getElementById("machines-body");
  if (!box) return;
  const list = machinesUi.list.machines;
  document.getElementById("machines-meta").textContent = list.length ? t("machines.count", { n: list.length, online: list.filter((m) => m.online).length }) : t("machines.lead");
  if (!list.length) {
    return box.replaceChildren(h("div", { class: "card empty" }, icon("server"), h("h2", null, t("machines.none")), h("p", null, t("machines.noneLead")), button(t("machines.add"), { class: "primary", onclick: addMachineDialog }, "plus")));
  }
  box.replaceChildren(h("div", { class: "cards" }, list.map((m) => h("a", { class: "card pad machine-card", href: `#/machines/${m.id}`, id: "machine-" + m.id, menu: (at) => machineMenu(m, at) }))));
  for (const m of list) paintMachineCard(m);
}

/** The card of a machine in the list: who it is, and its numbers while it is connected */
function paintMachineCard(m) {
  const card = document.getElementById("machine-" + m.id);
  if (!card) return;
  const s = m.status;
  const mem = s?.memory.total ? Math.round((s.memory.used / s.memory.total) * 100) : null;
  const disk = s?.disks[0];
  const diskPercent = disk ? Math.round((disk.used / disk.total) * 100) : null;
  const meter = (label, percent, hint) => {
    const fill = h("i", { class: level(percent ?? 0) });
    fill.style.width = (percent ?? 0) + "%";
    return h("div", { class: "machine-meter" }, h("div", { class: "kv" }, h("span", { class: "muted small" }, label), h("span", { class: "small" }, percent == null ? "—" : `${percent}%`, hint && h("span", { class: "muted" }, " · " + hint))), h("div", { class: "bar" }, fill));
  };
  put(
    card,
    h("div", { class: "machine-title" }, icon("server"), h("strong", { class: "clip grow" }, m.name), machineChip(m)),
    h("p", { class: "muted small clip" }, machineOs(m) || "—"),
    m.pve && h("p", { class: "muted small clip" }, t("pve.guestOn", { guest: guestKind(m.pve), host: m.pve.hostName })),
    m.online && s
      ? [meter(t("sys.cpu"), s.cpu, t("sys.cores", { n: s.cores })), meter(t("sys.memory"), mem, bytes(s.memory.total)), disk && meter(t("sys.disk"), diskPercent, t("sys.free", { free: bytes(disk.total - disk.used), total: bytes(disk.total) }))]
      : h("p", { class: "muted small" }, m.online ? t("machines.waiting") : t("machines.seen", { ago: ago(m.seen) })),
    m.outdated && m.online && h("p", { class: "small accent-text" }, t("machines.outdated", { version: m.info.version })),
    !m.online && m.pve?.power && m.pve.status !== "running" && h("div", { class: "row-actions" }, button(t("pve.startHere", { host: m.pve.hostName }), { class: "small", onclick: (e) => (e.preventDefault(), e.stopPropagation(), startGuestOf(m, e.currentTarget)) }, "play")),
    !m.online && !m.pve && m.info?.macs?.length > 0 && h("div", { class: "row-actions" }, button(t("machines.wake"), { class: "small", onclick: (e) => (e.preventDefault(), e.stopPropagation(), wakeMachine(m, e.currentTarget)) }, "play")),
  );
}

/** The install line for a new machine, and the wait for it to connect */
async function addMachineDialog() {
  let invite;
  try {
    invite = await api("POST", "/api/machines/invite", {});
  } catch (e) {
    return toast(errorText(e), "error");
  }
  // whether the machine is let to the other users: a line of its own, so another code is asked for
  const people = h("input", {
    type: "checkbox",
    onchange: async () => {
      people.disabled = true;
      try {
        invite = { ...invite, ...(await api("POST", "/api/machines/invite", { people: people.checked })) };
        cmd.textContent = line();
      } catch (e) {
        people.checked = !people.checked;
        toast(errorText(e), "error");
      }
      people.disabled = false;
    },
  });
  const known = new Set((machinesUi.list?.machines ?? []).map((m) => m.id));
  const addresses = [...new Set([location.origin, invite.lan, invite.local].filter(Boolean).map((a) => a.replace(/\/$/, "")))];
  let address = addresses[0];
  // what kind of address it is: by the domain, the server's number on the home network, or its .local name
  const kindOf = (url) => {
    const host = new URL(url).hostname;
    if (invite.local && host === new URL(invite.local).hostname) return "local";
    return /^[\d.]+$|^\[/.test(host) ? "lan" : "domain";
  };
  const about = h("p", { class: "muted small" });
  const explain = () => (about.textContent = t("machines.addVia." + kindOf(address) + "Hint"));
  const line = () => `curl -fsSL ${address}/client/${invite.code} | sudo sh`;
  const cmd = h("span", { class: "grow mono machine-line" }, line());
  const waiting = h("p", { class: "machine-wait" }, h("span", { class: "machine-pulse" }), t("machines.addWaiting"));
  let dialog;
  const pick =
    addresses.length > 1 &&
    h(
      "div",
      { class: "stack-s" },
      h("label", { for: "machine-address", class: "strong" }, t("machines.addAddress")),
      h("select", { id: "machine-address", onchange: (e) => ((address = e.target.value), (cmd.textContent = line()), explain()) }, addresses.map((a) => h("option", { value: a }, t("machines.addVia." + kindOf(a), { address: a })))),
      about,
    );
  explain();
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("machines.addTitle")), closeX(() => dialog)),
    h("p", null, t("machines.addLead")),
    pick,
    h("p", { class: "cmd" }, cmd, h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(line()) }, icon("copy"))),
    h("p", { class: "muted small" }, t("machines.addHint", { minutes: Math.round(invite.valid / 60000) })),
    h("p", { class: "muted small" }, t("machines.addNeeds")),
    h("label", { class: "check" }, people, h("span", null, h("strong", null, t("machines.people.tick")), h("span", { class: "muted small block" }, t("machines.people.tickHint")))),
    waiting,
    h("footer", null, closeButton(() => dialog)),
  );
  // the new machine shows itself in the list: the dialog says so and leads to it
  const look = async () => {
    const list = await api("GET", "/api/machines").catch(() => null);
    const fresh = list?.machines.find((m) => !known.has(m.id));
    if (!fresh) return;
    machinesUi.list = list;
    if (state.route.view === "machines") renderMachinesBody();
    waiting.replaceChildren(icon("check"), h("span", null, t("machines.addDone", { name: fresh.name })), h("a", { class: "btn small primary", href: `#/machines/${fresh.id}`, onclick: () => dialog.close() }, t("common.open")));
    waiting.classList.add("done");
    stop();
  };
  const timer = setInterval(look, 3000);
  const stop = () => clearInterval(timer);
  dialog.addEventListener("close", stop);
}

// --- Proxmox servers ---
// Looked after through their API with a token: the list on the Machines page, a page of each

const PVE_TABS = ["overview", "guests", "templates", "tasks"];
const pveUi = { list: null, host: null, timer: null };

async function loadPve() {
  try {
    if (state.route.view === "proxmox") {
      pveUi.host = await api("GET", `/api/proxmox/${state.route.id}`);
      return renderPveBody();
    }
    pveUi.list = await api("GET", "/api/proxmox");
  } catch (e) {
    if (state.route.view === "proxmox") {
      pveUi.host = null;
      const box = document.getElementById("pve-body");
      if (box) put(box, h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines"))), h("p", { class: "card pad muted" }, errorText(e)));
      return;
    }
    return toast(errorText(e), "error");
  }
  if (state.route.view === "machines") paintPveList();
}

/** A Proxmox server said something new: the page that shows it asks again, at most every few seconds */
function pveEvent(event) {
  if (state.route.view === "proxmox" && state.route.id !== event.id) return;
  if (state.route.view !== "proxmox" && state.route.view !== "machines") return;
  clearTimeout(pveUi.timer);
  pveUi.timer = setTimeout(() => {
    void loadPve();
    if (state.route.view === "machines") void loadMachines();
  }, 800);
}

const pveChip = (x) => h("span", { class: "state " + (x.online ? "running" : "") }, x.online ? t("pve.online") : t("pve.offline"));
const guestChip = (g) => h("span", { class: "state " + (g.status === "running" ? "running" : g.status === "paused" ? "restarting" : "") }, t("pve.status." + (["running", "stopped", "paused"].includes(g.status) ? g.status : "unknown")));
const guestKind = (g) => (g.type === "lxc" ? "CT" : "VM") + " " + g.vmid;
/** Why a server does not answer, in the words of its error */
const pveError = (x) => (has("error." + x.error.code) ? t("error." + x.error.code, { name: x.name, message: "" }).replace(/[:\s]+$/, "") : x.error.code);
const pct = (used, total) => (total ? Math.round((used / total) * 100) : null);

function meterRow(label, percent, hint) {
  const fill = h("i", { class: level(percent ?? 0) });
  fill.style.width = (percent ?? 0) + "%";
  return h("div", { class: "machine-meter" }, h("div", { class: "kv" }, h("span", { class: "muted small" }, label), h("span", { class: "small" }, percent == null ? "—" : `${percent}%`, hint && h("span", { class: "muted" }, " · " + hint))), h("div", { class: "bar" }, fill));
}

/** The Proxmox servers under the machines */
function paintPveList() {
  const box = document.getElementById("pve-list");
  if (!box) return;
  const list = pveUi.list?.hosts ?? [];
  if (!list.length) return box.replaceChildren();
  box.replaceChildren(
    h("div", { class: "section-head" }, h("h2", null, t("pve.title"))),
    h(
      "div",
      { class: "cards" },
      list.map((x) => {
        const node = x.nodes[0];
        return h(
          "a",
          { class: "card pad machine-card", href: `#/proxmox/${x.id}`, menu: (at) => pveMenu(x, at) },
          h("div", { class: "machine-title" }, icon("server"), h("strong", { class: "clip grow" }, x.name), pveChip(x)),
          h("p", { class: "muted small clip" }, ["Proxmox VE " + (x.version || ""), x.nodes.length > 1 ? t("pve.nodes", { n: x.nodes.length }) : node?.name].filter(Boolean).join(" · ")),
          x.self && h("p", { class: "small" }, icon("home"), " ", t("pve.selfShort", { guest: x.self.replace("lxc/", "CT ").replace("qemu/", "VM ") })),
          x.online
            ? [
                h("p", { class: "small" }, t("pve.guestsRunning", { n: x.counts.running, total: x.counts.guests })),
                ...x.nodes.slice(0, 3).flatMap((n) => [meterRow(x.nodes.length > 1 ? `${n.name} · ${t("sys.cpu")}` : t("sys.cpu"), n.online ? Math.round(n.cpu * 100) : null, t("sys.cores", { n: n.cores })), meterRow(t("sys.memory"), n.online ? pct(n.memory.used, n.memory.total) : null, bytes(n.memory.total))]),
              ]
            : h("p", { class: "muted small" }, x.error ? pveError(x) : t("pve.asking")),
        );
      }),
    ),
  );
}

/** Adding a server, or changing its token: the certificate is shown to be confirmed the first time */
function pveDialog(old = null) {
  const name = h("input", { value: old?.name ?? "", placeholder: t("pve.namePlaceholder"), maxLength: 40 });
  const url = h("input", { value: old?.url ?? "", placeholder: "192.168.1.10", required: true, autocapitalize: "none", spellcheck: false, class: "mono" });
  // not the browser's saved sign-in to Hata: these are Proxmox's, and a password field invites it
  const token = h("input", { value: old?.token ?? "", placeholder: "hata@pve!panel", required: true, autocapitalize: "none", spellcheck: false, autocomplete: "off", name: "pve-token-id", class: "mono" });
  const secret = h("input", { type: "password", placeholder: old ? t("pve.secretKeep") : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", autocomplete: "new-password", name: "pve-token-secret", class: "mono", required: !old });
  // a new server: by a person's sign-in (Hata makes its own token there) or by a token made by hand
  let mode = old ? "token" : "login";
  const user = h("input", { value: "root@pam", required: true, autocapitalize: "none", spellcheck: false, autocomplete: "off", name: "pve-user", class: "mono" });
  const password = h("input", { type: "password", autocomplete: "new-password", name: "pve-password", required: true });
  const otp = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxLength: 8, class: "mono" });
  const otpRow = field(t("pve.otp"), otp, t("pve.otpHint"));
  otpRow.hidden = true;
  const level = h("select", null, ["manage", "pool", "read"].map((l) => h("option", { value: l }, t("pve.level." + l))));
  const levelHint = h("span", { class: "hint" }, t("pve.levelHint.manage"));
  level.addEventListener("change", () => (levelHint.textContent = t("pve.levelHint." + level.value)));
  const loginPart = h("div", { class: "stack" }, h("div", { class: "form-pair" }, field(t("pve.user"), user), field(t("pve.password"), password)), otpRow, h("label", { class: "field" }, h("span", { class: "label" }, t("pve.level")), level, levelHint), h("p", { class: "muted small" }, t("pve.loginLead")));
  const idsFrom = h("input", { type: "number", min: 100, value: old?.ids?.from ?? "", placeholder: "100" });
  const idsTo = h("input", { type: "number", min: 100, value: old?.ids?.to ?? "", placeholder: "999" });
  const cert = h("div");
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const tokenPart = h(
    "div",
    { class: "stack" },
    field(t("pve.token"), token, t("pve.tokenHint")),
    field(t("pve.secret"), secret, old ? t("pve.secretKeepHint") : null),
    !old && h("details", { class: "small" }, h("summary", null, t("pve.howTitle")), h("ol", { class: "stack-s" }, ["1", "2", "3", "4"].map((n) => h("li", null, t("pve.how." + n)))), h("p", { class: "muted" }, t("pve.howRights"))),
  );
  const modeTab = (m) => h("button", { type: "button", class: "btn" + (mode === m ? " active" : ""), "data-mode": m, onclick: () => setMode(m) }, t("pve.mode." + m));
  const setMode = (m) => {
    mode = m;
    loginPart.hidden = m !== "login";
    tokenPart.hidden = m !== "token";
    user.required = password.required = m === "login";
    token.required = m === "token";
    secret.required = m === "token" && !old;
    dialog?.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    error.textContent = "";
  };
  setMode(mode);
  let fingerprint = null;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const ids = idsFrom.value && idsTo.value ? { from: Number(idsFrom.value), to: Number(idsTo.value) } : null;
    const data =
      mode === "login"
        ? { ids, name: name.value, url: url.value, user: user.value, password: password.value, level: level.value, ...(otp.value ? { otp: otp.value } : {}), ...(fingerprint ? { fingerprint } : {}) }
        : { ids, name: name.value, url: url.value, token: token.value, ...(secret.value ? { secret: secret.value } : {}), ...(fingerprint ? { fingerprint } : {}) };
    try {
      const saved = old ? await api("PATCH", `/api/proxmox/${old.id}`, data) : await api("POST", "/api/proxmox", data);
      dialog.close();
      toast(t(old ? "pve.changed" : "pve.added", { name: saved.name }));
      if (old) void loadPve();
      else go(`#/proxmox/${saved.id}`);
    } catch (err) {
      if (err.code === "pve.confirmCert") {
        // the server's own certificate: the person compares it with what Proxmox shows, then it is kept
        put(
          cert,
          h(
            "div",
            { class: "card pad stack-s warn-box" },
            h("strong", null, t("pve.certTitle")),
            h("p", { class: "small" }, t("pve.certLead", { subject: err.detail.subject || "—", issuer: err.detail.issuer || "—" })),
            h("p", { class: "mono small wrap" }, err.detail.fingerprint),
            h("p", { class: "muted small" }, t("pve.certWhere")),
          ),
        );
        fingerprint = err.detail.fingerprint;
        submit.querySelector("span").textContent = t("pve.certTrust");
      } else if (err.code === "pve.needOtp") {
        otpRow.hidden = false;
        otp.focus();
      } else error.textContent = errorText(err);
    }
    submit.disabled = false;
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, old ? t("pve.changeTitle", { name: old.name }) : t("pve.addTitle")), closeX(() => dialog)),
      !old && h("p", null, t("pve.addLead")),
      !old && h("div", { class: "seg" }, modeTab("login"), modeTab("token")),
      field(t("pve.url"), url, t("pve.urlHint")),
      loginPart,
      tokenPart,
      field(t("pve.name"), name, t("pve.nameHint")),
      h("div", { class: "field" }, h("span", { class: "label" }, t("pve.ids")), h("div", { class: "form-pair" }, idsFrom, idsTo), h("span", { class: "hint" }, t("pve.idsHint"))),
      cert,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, h("span", null, old ? t("pve.save") : t("pve.add")))),
    ),
  );
}

function pveMenu(x, at = null) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "machine-icon" }, icon("server")), h("div", null, h("h2", null, x.name), pveChip(x))),
    item(t("pve.refresh"), "refresh", () => refreshPve(x)),
    item(t("pve.openWeb"), "external", () => window.open(x.url, "_blank", "noopener")),
    item(t("pve.change"), "edit", () => pveDialog(x)),
    item(t("pve.remove"), "trash", () => removePveDialog(x), "danger"),
  );
  if (at) placeAt(dialog, at);
}

async function refreshPve(x, el) {
  if (el) el.disabled = true;
  try {
    const fresh = await api("POST", `/api/proxmox/${x.id}/refresh`, {});
    if (state.route.view === "proxmox") (pveUi.host = fresh), renderPveBody();
    else void loadPve();
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
}

function removePveDialog(x) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("pve.removeTitle", { name: x.name })),
    h("p", { class: "muted" }, t("pve.removeLead")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("pve.remove"), {
        class: "danger",
        onclick: async () => {
          try {
            await api("DELETE", `/api/proxmox/${x.id}`);
            dialog.close();
            go("#/machines");
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }, "trash"),
    ),
  );
}

/** A new container on the server, with Hata's client in it: it becomes one of the machines */
async function pveNewDialog(x) {
  let o;
  try {
    o = await api("GET", `/api/proxmox/${x.id}/new`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (!o.offer) return toast(t("pve.new.denied", { name: x.name }), "error");
  const opt = (value, label = value) => h("option", { value }, label);
  const node = h("select", { onchange: () => fill() }, o.nodes.map((n) => opt(n)));
  const template = h("select");
  const storage = h("select");
  const bridge = h("select");
  const fill = () => {
    const n = node.value;
    const list = o.templates[n] ?? [];
    template.replaceChildren(...list.map((v) => opt(v, v.split("/").pop() + (/(^|\/)(debian|ubuntu|fedora|rockylinux|almalinux|centos)-/.test(v) ? "" : " — " + t("pve.new.noClientHere")))));
    const debian = list.find((v) => /\/debian-/.test(v));
    if (debian) template.value = debian;
    storage.replaceChildren(...(o.storages[n] ?? []).map((v) => opt(v)));
    bridge.replaceChildren(...(o.bridges[n] ?? []).map((v) => opt(v)));
  };
  fill();
  const hostname = h("input", { required: true, placeholder: "docker-1", pattern: "[a-z0-9]([a-z0-9\\-]{0,61}[a-z0-9])?", autocapitalize: "none", spellcheck: false, class: "mono" });
  const vmid = h("input", { type: "number", required: true, min: o.ids?.from ?? 100, max: o.ids?.to ?? 999999999, value: o.next ?? "" });
  const disk = h("input", { type: "number", required: true, min: 2, max: 4096, value: 8 });
  const cores = h("input", { type: "number", required: true, min: 1, max: 128, value: 2 });
  const memory = h("select", null, [512, 1024, 2048, 4096, 8192, 16384].map((mb) => opt(String(mb), mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`)));
  memory.value = "2048";
  const how = h("select", { onchange: () => (fixed.hidden = how.value !== "fixed") }, opt("dhcp", t("pve.new.dhcp")), opt("fixed", t("pve.new.fixed")));
  const address = h("input", { placeholder: "192.168.1.50/24", class: "mono" });
  const gateway = h("input", { placeholder: "192.168.1.1", class: "mono" });
  const fixed = h("div", { class: "stack-s", hidden: true }, field(t("pve.new.address"), address), field(t("pve.new.gateway"), gateway));
  const pool = h("select", null, o.free && opt("", t("pve.new.noPool")), o.pools.map((p) => opt(p)));
  const tick = (label, hint, checked = true) => {
    const box = h("input", { type: "checkbox", checked });
    return [box, h("label", { class: "check" }, box, h("span", null, h("strong", null, label), hint && h("span", { class: "muted small block" }, hint)))];
  };
  const [client, clientRow] = tick(t("pve.new.client"), t("pve.new.clientHint"));
  const [docker, dockerRow] = tick(t("pve.new.docker"), t("pve.new.dockerHint"));
  const [onboot, onbootRow] = tick(t("pve.onboot"), null);
  client.addEventListener("change", () => ((docker.disabled = !client.checked), !client.checked && (docker.checked = false)));
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const r = await api("POST", `/api/proxmox/${x.id}/guests`, {
        node: node.value,
        vmid: Number(vmid.value),
        hostname: hostname.value.trim().toLowerCase(),
        template: template.value,
        storage: storage.value,
        disk: Number(disk.value),
        cores: Number(cores.value),
        memory: Number(memory.value),
        bridge: bridge.value,
        address: how.value === "fixed" ? address.value.trim() : "dhcp",
        gateway: gateway.value.trim(),
        pool: pool.value,
        client: client.checked,
        docker: docker.checked,
        onboot: onboot.checked,
      });
      dialog.close();
      void jobDialog(r.job, "guest", hostname.value, () => {
        toast(t(client.checked ? "pve.new.doneMachine" : "pve.new.done", { name: hostname.value }));
        void loadPve();
        void loadMachines();
      });
    } catch (err) {
      error.textContent = err.code === "pve.badField" ? t("pve.new.bad." + err.detail.field) : errorText(err);
      submit.disabled = false;
    }
  };
  const pair = (...items) => h("div", { class: "form-pair" }, ...items);
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t("pve.new.title", { name: x.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("pve.new.lead")),
      pair(field(t("pve.new.hostname"), hostname, t("pve.new.hostnameHint")), field("ID", vmid, o.ids ? t("pve.new.idsHint", o.ids) : null)),
      o.nodes.length > 1 && field(t("pve.col.node"), node),
      field(t("pve.new.template"), template, (o.templates[node.value] ?? []).length ? null : t("pve.new.noTemplates")),
      pair(field(t("pve.new.storage"), storage), field(t("pve.new.disk"), disk)),
      pair(field(t("pve.new.cores"), cores), field(t("pve.new.memory"), memory)),
      pair(field(t("pve.new.bridge"), bridge), field(t("pve.new.how"), how)),
      fixed,
      (o.pools.length > 0 || !o.free) && field(t("pve.pool"), pool, o.free ? null : t("pve.new.poolHint")),
      clientRow,
      dockerRow,
      onbootRow,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("plus"), h("span", null, t("pve.new.create")))),
    ),
  );
}

// --- One Proxmox server ---

function renderPve() {
  if (pveUi.host?.id !== state.route.id) pveUi.host = null;
  shell(h("div", { id: "pve-body", class: "stack" }));
  if (pveUi.host) renderPveBody();
  void loadPve();
}

function renderPveBody() {
  const box = document.getElementById("pve-body");
  const x = pveUi.host;
  if (!box || !x) return;
  const tab = (id, iconName) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `#/proxmox/${x.id}${id === "overview" ? "" : "/" + id}` }, icon(iconName), t("pve.tab." + id));
  const body = state.route.tab === "guests" ? pveGuests(x) : state.route.tab === "tasks" ? pveTasks(x) : state.route.tab === "templates" ? pveTemplates(x) : pveOverview(x);
  put(
    box,
    // the head as the machine's: on a wallpaper it gets a panel of its own, or its words are lost
    h(
      "div",
      { id: "pve-head" },
      h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines")), icon("chevron"), h("span", null, x.name)),
      h(
      "div",
      { class: "app-head", menu: (at) => pveMenu(x, at) },
      h("span", { class: "machine-icon" }, icon("server")),
      h("div", { class: "grow" }, h("div", { class: "app-title" }, h("h1", null, x.name), pveChip(x)), h("p", { class: "meta" }, ["Proxmox VE " + (x.version || ""), x.url, x.at ? t("pve.askedAgo", { ago: ago(x.at) }) : null].filter(Boolean).flatMap((part, i) => (i ? [h("span", { class: "dot-sep" }, "·"), part] : [part])))),
      h("div", { class: "actions" }, x.online && button(t("pve.new.button"), { class: "primary", onclick: async (e) => ((e.currentTarget.disabled = true), await pveNewDialog(x), (e.target.closest("button").disabled = false)) }, "plus"), button(t("pve.refresh"), { onclick: (e) => refreshPve(x, e.currentTarget) }, "refresh"), h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: () => pveMenu(x) }, icon("more"))),
    ),
      h("div", { class: "tabs" }, tab("overview", "grid"), tab("guests", "box"), tab("templates", "archive"), tab("tasks", "logs")),
    ),
    x.error && h("p", { class: "card pad warn-box" }, pveError(x), " ", t("pve.since", { ago: ago(x.error.since) })),
    body,
  );
}

// --- Templates of containers ---

/** The templates tab: drawn from what was read last, read again when older than five minutes or after a change */
function pveTemplates(x) {
  const box = h("div", { class: "stack" });
  const data = pveUi.templates?.id === x.id ? pveUi.templates : null;
  if (data) paintPveTemplates(x, box, data);
  else box.append(h("p", { class: "muted" }, t("machines.loading")));
  if (!data || Date.now() - data.at > 5 * 60_000) void loadPveTemplates(x);
  return box;
}

async function loadPveTemplates(x) {
  try {
    pveUi.templates = { id: x.id, at: Date.now(), ...(await api("GET", `/api/proxmox/${x.id}/templates`)) };
  } catch (e) {
    pveUi.templates = { id: x.id, at: Date.now(), error: errorText(e), nodes: [], offered: [], have: [], storages: [] };
  }
  if (state.route.view === "proxmox" && state.route.tab === "templates") renderPveBody();
}

function paintPveTemplates(x, box, d) {
  const where = h("select", null, d.storages.map((s) => h("option", { value: `${s.node}/${s.storage}` }, d.nodes.length > 1 ? `${s.storage} (${s.node})` : s.storage)));
  if (pveUi.templateWhere && d.storages.some((s) => `${s.node}/${s.storage}` === pveUi.templateWhere)) where.value = pveUi.templateWhere;
  where.addEventListener("change", () => (pveUi.templateWhere = where.value));
  const find = h("input", { type: "search", placeholder: t("pve.tpl.find"), value: pveUi.templateFind ?? "", oninput: () => ((pveUi.templateFind = find.value), filter()) });
  const haveNames = new Set(d.have.map((v) => v.name));
  const may = d.storages.length > 0;
  const rows = d.offered.map((o) => ({
    o,
    row: h(
      "tr",
      null,
      h("td", null, h("div", { class: "strong" }, o.headline || o.template), h("div", { class: "muted small mono wrap" }, o.template)),
      h("td", { class: "small" }, o.section === "turnkeylinux" ? "TurnKey" : o.section === "system" ? t("pve.tpl.system") : o.section, o.client && h("div", null, h("span", { class: "chip ok" }, t("pve.tpl.client")))),
      h("td", { class: "small muted" }, o.description),
      h(
        "td",
        null,
        haveNames.has(o.template)
          ? h("span", { class: "chip" }, t("pve.tpl.have"))
          : may &&
              button(t("pve.tpl.download"), {
                class: "small",
                onclick: async (e) => {
                  const el = e.currentTarget;
                  el.disabled = true;
                  const [node, storage] = where.value.split("/");
                  try {
                    const r = await api("POST", `/api/proxmox/${x.id}/templates`, { node, storage, template: o.template });
                    void jobDialog(r.job, "template", o.template, () => {
                      pveUi.templates = null;
                      renderPveBody();
                    });
                  } catch (err) {
                    toast(errorText(err), "error");
                    el.disabled = false;
                  }
                },
              }, "download"),
      ),
    ),
  }));
  const filter = () => {
    const q = find.value.trim().toLowerCase();
    for (const { o, row } of rows) row.hidden = !!q && !`${o.headline} ${o.template} ${o.os} ${o.description}`.toLowerCase().includes(q);
  };
  filter();
  put(
    box,
    d.error && h("p", { class: "card pad warn-box" }, d.error),
    pveSection(
      t("pve.tpl.haveTitle"),
      d.have.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, h("th", null, t("pve.tpl.col.name")), h("th", null, t("pve.col.storage")), h("th", null, t("pve.tpl.col.size")), h("th"))),
              h(
                "tbody",
                null,
                d.have.map((v) =>
                  h(
                    "tr",
                    null,
                    h("td", { class: "mono small wrap" }, v.name),
                    h("td", { class: "small" }, v.storage, d.nodes.length > 1 && h("span", { class: "muted" }, ` · ${v.node}`)),
                    h("td", { class: "small" }, bytes(v.size)),
                    h("td", null, d.removable.includes(v.storage) && button("", { class: "small ghost", title: t("pve.tpl.remove"), "aria-label": t("pve.tpl.remove"), onclick: () => pveTemplateRemove(x, v) }, "trash")),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "muted pve-note first" }, t("pve.tpl.none")),
    ),
    pveSection(
      t("pve.tpl.offeredTitle"),
      h("div", { class: "pve-note first stack-s" }, !may && h("p", { class: "banner small" }, t("pve.tpl.noRight")), h("div", { class: "form-pair" }, field(t("pve.tpl.find"), find), may && field(t("pve.tpl.where"), where))),
      h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.tpl.col.name")), h("th", null, t("pve.tpl.col.kind")), h("th", null, t("pve.tpl.col.about")), h("th"))), h("tbody", null, rows.map((r) => r.row)))),
    ),
  );
}

function pveTemplateRemove(x, v) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("pve.tpl.removeTitle", { name: v.name })),
    h("p", { class: "muted" }, t("pve.tpl.removeLead", { storage: v.storage })),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("pve.tpl.remove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("DELETE", `/api/proxmox/${x.id}/templates`, { node: v.node, volid: v.volid });
            toast(t("pve.tpl.removed", { name: v.name }));
          } catch (err) {
            toast(errorText(err), "error");
          }
          dialog.close();
          pveUi.templates = null;
          renderPveBody();
        },
      }, "trash"),
    ),
  );
}

/** A part of the server's page: its title and what it shows in one card */
const pveSection = (title, ...body) => h("section", { class: "card pve-section" }, h("header", { class: "pve-section-head" }, h("h2", null, title)), ...body);

function pveOverview(x) {
  const storages = x.storages;
  const self = x.guests.find((g) => g.id === x.self);
  return h(
    "div",
    { class: "stack" },
    self && h("p", { class: "card pve-self" }, icon("home"), h("span", null, t("pve.selfHere", { guest: `${guestKind(self)} ${self.name}`, node: self.node }))),
    x.trouble.length > 0 && h("section", { class: "card pve-trouble" }, x.trouble.map(attentionItem)),
    pveSection(
      t("pve.nodesTitle"),
      h(
        "div",
        { class: "pve-nodes" },
        x.nodes.map((n) =>
          h(
            "div",
            { class: "pve-node" },
            h("div", { class: "machine-title" }, icon("server"), h("strong", { class: "clip grow" }, n.name), pveChip(n)),
            h("p", { class: "muted small" }, n.online ? t("pve.up", { time: duration(n.uptime) }) : "—"),
            meterRow(t("sys.cpu"), n.online ? Math.round(n.cpu * 100) : null, t("sys.cores", { n: n.cores })),
            meterRow(t("sys.memory"), n.online ? pct(n.memory.used, n.memory.total) : null, bytes(n.memory.total)),
            meterRow(t("pve.rootDisk"), n.online ? pct(n.disk.used, n.disk.total) : null, t("sys.free", { free: bytes(n.disk.total - n.disk.used), total: bytes(n.disk.total) })),
          ),
        ),
      ),
    ),
    pveSection(
      t("pve.storagesTitle"),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("pve.col.storage")), h("th", null, t("pve.col.type")), h("th", null, t("pve.col.content")), h("th", null, t("pve.col.use")))),
          h(
            "tbody",
            null,
            storages.map((s) => {
              const p = pct(s.used, s.total);
              const fill = h("i", { class: level(p ?? 0) });
              fill.style.width = (p ?? 0) + "%";
              return h(
                "tr",
                null,
                h("td", null, h("div", { class: "strong" }, s.name), x.nodes.length > 1 && h("div", { class: "muted small" }, s.node)),
                h("td", { class: "small" }, s.type, s.shared && h("span", { class: "muted" }, " · " + t("pve.shared"))),
                h("td", { class: "small muted" }, s.content.map((c) => t("pve.content." + c)).join(", ")),
                h("td", null, s.active ? [h("div", { class: "small" }, `${p ?? 0}% · ${t("sys.free", { free: bytes(s.total - s.used), total: bytes(s.total) })}`), h("div", { class: "bar" }, fill)] : h("span", { class: "chip warn" }, t("pve.inactive"))),
              );
            }),
          ),
        ),
      ),
    ),
    x.disks.length > 0 &&
      pveSection(
        t("pve.disksTitle"),
        h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.col.disk")), h("th", null, t("pve.col.node")), h("th", null, t("pve.col.health")))), h("tbody", null, x.disks.map((d) => h("tr", null, h("td", null, h("div", null, d.model || d.device), h("div", { class: "muted small mono" }, d.device)), h("td", { class: "small" }, d.node), h("td", null, h("span", { class: "chip " + (/^(PASSED|OK)$/i.test(d.health) ? "ok" : /^UNKNOWN$/i.test(d.health) || !d.health ? "" : "danger") }, d.health || "—"))))))),
      ),
    pveSection(t("pve.jobsTitle"), h("div", { id: "pve-jobs" }, h("p", { class: "muted pve-note first" }, t("machines.loading")))),
    loadPveJobs(x),
    pveSection(t("pve.sched.title"), pveScheduleBody(x)),
  );
}

/** Hata's own schedule of backups: what it does, how it last went, and its buttons */
function pveScheduleBody(x) {
  const s = x.schedule;
  const who = (sc) => (sc.guests === "all" ? t("pve.sched.all") : sc.guests.map((id) => x.guests.find((g) => g.vmid === id)?.name ?? id).join(", "));
  const last = x.last && h("p", { class: "small " + (x.last.ok ? "muted" : "error") }, t("pve.sched.last", { when: dateTime(x.last.at), result: x.last.ok ? t("pve.sched.lastOk", { n: x.last.guests, pruned: x.last.pruned }) : t("pve.sched.lastFailed", { message: x.last.message }) }));
  return h(
    "div",
    { class: "stack-s pve-note first" },
    h("p", { class: "muted small" }, t("pve.sched.lead")),
    h("p", null, s?.on ? t("pve.sched.on", { time: s.time, guests: who(s), storage: s.storage, keep: s.keep }) : t("pve.sched.off")),
    last,
    h(
      "div",
      { class: "row-actions" },
      button(t("pve.sched.edit"), { class: "small", onclick: () => pveScheduleDialog(x) }, "sliders"),
      s?.storage && button(t("pve.sched.run"), {
        class: "small",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const r = await api("POST", `/api/proxmox/${x.id}/schedule/run`, {});
            void jobDialog(r.job, "backup", x.name, () => void loadPve());
          } catch (err) {
            toast(errorText(err), "error");
          }
          el.disabled = false;
        },
      }, "play"),
    ),
  );
}

function pveScheduleDialog(x) {
  const s = x.schedule ?? { on: false, time: "03:30", storage: x.scheduleStorages[0] ?? "", keep: 3, guests: "all" };
  const on = h("input", { type: "checkbox", checked: s.on || !x.schedule });
  const time = h("input", { type: "time", required: true, value: s.time });
  const opt = (value) => h("option", { value }, value);
  const storage = h("select", null, x.scheduleStorages.map((v) => opt(v)));
  storage.value = x.scheduleStorages.includes(s.storage) ? s.storage : (x.scheduleStorages[0] ?? "");
  const keep = h("input", { type: "number", required: true, min: 1, max: 30, value: s.keep });
  const radio = (value, checked) => h("input", { type: "radio", name: "pve-sched", value, checked, onchange: () => (list.hidden = all.checked) });
  const all = radio("all", s.guests === "all");
  const chosen = radio("chosen", s.guests !== "all");
  const mine = x.guests.filter((g) => !g.template && g.may.backup);
  const boxes = mine.map((g) => ({ g, box: h("input", { type: "checkbox", checked: s.guests !== "all" && s.guests.includes(g.vmid) }) }));
  const list = h("div", { class: "stack-s pve-pick", hidden: s.guests === "all" }, boxes.map(({ g, box }) => h("label", { class: "check" }, box, h("span", null, `${g.name} (${g.vmid})`))));
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    try {
      await api("PUT", `/api/proxmox/${x.id}/schedule`, { on: on.checked, time: time.value, storage: storage.value, keep: Number(keep.value), guests: all.checked ? "all" : boxes.filter(({ box }) => box.checked).map(({ g }) => g.vmid) });
      dialog.close();
      toast(t("pve.sched.saved"));
      void loadPve();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t("pve.sched.dialog", { name: x.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("pve.sched.lead")),
      !x.scheduleStorages.length && h("p", { class: "banner small" }, t("pve.sched.noStorage")),
      h("label", { class: "check" }, on, h("span", null, h("strong", null, t("pve.sched.enable")))),
      h("div", { class: "form-pair" }, field(t("pve.sched.time"), time), field(t("pve.sched.storage"), storage)),
      field(t("pve.sched.keep"), keep),
      h("div", { class: "stack-s" }, h("span", { class: "label" }, t("pve.sched.guests")), h("label", { class: "check" }, all, h("span", null, t("pve.sched.guestsAll"))), h("label", { class: "check" }, chosen, h("span", null, t("pve.sched.guestsChosen"))), list),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("check"), h("span", null, t("settings.save")))),
    ),
  );
}

/** The backup jobs come with a request of their own, after the page is drawn */
function loadPveJobs(x) {
  queueMicrotask(async () => {
    const box = document.getElementById("pve-jobs");
    if (!box) return;
    try {
      const { jobs } = await api("GET", `/api/proxmox/${x.id}/jobs`);
      // the guests no job covers close the same card: a line of their own would stand on the wallpaper
      const left = x.unprotected?.length > 0 && h("p", { class: "muted small pve-note" }, t("pve.unprotected", { guests: x.unprotected.map((g) => `${g.name || g.vmid} (${g.vmid})`).join(", ") }));
      const who = (j) => (j.guests === "all" ? t("pve.jobAll") : j.guests.startsWith("pool:") ? t("pve.jobPool", { pool: j.guests.slice(5) }) : j.guests.split(",").map((id) => x.guests.find((g) => String(g.vmid) === id)?.name ?? id).join(", "));
      box.replaceChildren(
        jobs.length
          ? h("div", null, h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.col.schedule")), h("th", null, t("pve.col.guests")), h("th", null, t("pve.col.storage")), h("th", null, t("pve.col.next")))), h("tbody", null, jobs.map((j) => h("tr", null, h("td", null, h("div", { class: "mono" }, j.schedule), !j.enabled && h("span", { class: "chip" }, t("pve.jobOff")), j.comment && h("div", { class: "muted small" }, j.comment)), h("td", { class: "small" }, who(j), j.exclude && h("div", { class: "muted small" }, t("pve.jobExclude", { list: j.exclude }))), h("td", { class: "small" }, j.storage), h("td", { class: "small" }, j.enabled && j.next ? dateTime(j.next) : "—")))))), left)
          : h("div", null, h("p", { class: "muted pve-note first" }, t("pve.noJobs")), left),
      );
    } catch (e) {
      box.replaceChildren(h("p", { class: "muted pve-note first" }, errorText(e)));
    }
  });
  return null;
}

function pveGuests(x) {
  const guests = x.guests.filter((g) => !g.template);
  const templates = x.guests.filter((g) => g.template);
  const note = templates.length > 0 && h("p", { class: "muted small pve-note" }, t("pve.templates", { list: templates.map((g) => `${g.name} (${g.vmid})`).join(", ") }));
  const small = (label, iconName, onclick, off) => h("button", { type: "button", class: "icon-btn", title: label, "aria-label": label, disabled: off, onclick: (e) => (e.stopPropagation(), onclick(e.currentTarget)) }, icon(iconName));
  const machineOf = (g) => machinesUi.list?.machines.find((m) => m.pve?.host === x.id && m.pve?.id === g.id);
  const row = (g) => {
    const up = g.status === "running";
    const m = machineOf(g);
    return h(
      "tr",
      { class: "clickable", onclick: () => pveGuestDialog(x, g) },
      h("td", { class: "mono" }, g.vmid),
      h("td", null, h("div", { class: "strong" }, g.name, g.id === x.self && h("span", { class: "chip accent pve-here" }, t("pve.selfChip"))), h("div", { class: "muted small" }, [g.type === "lxc" ? t("pve.container") : t("pve.vm"), x.nodes.length > 1 ? g.node : null, g.config?.addresses[0], g.lock ? t("pve.locked", { lock: g.lock }) : null].filter(Boolean).join(" · ")), m && h("a", { class: "link small", href: `#/machines/${m.id}`, onclick: (e) => e.stopPropagation() }, icon("server"), " ", t("pve.isMachine", { name: m.name }))),
      h("td", null, guestChip(g)),
      h("td", { class: "small" }, up ? `${Math.round(g.cpu * 100)}% · ${bytes(g.memory.used)} / ${bytes(g.memory.total)}` : `${t("sys.cores", { n: g.cores })} · ${bytes(g.memory.total)}`),
      h("td", { class: "small muted" }, up ? duration(g.uptime) : "—"),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          g.may.power && !up && small(t("pve.start"), "play", (el) => pvePower(x, g, g.status === "paused" ? "resume" : "start", el)),
          g.may.power && up && small(t("pve.shutdown"), "stop", () => pvePowerDialog(x, g, "shutdown")),
          g.may.power && up && small(t("pve.reboot"), "refresh", () => pvePowerDialog(x, g, "reboot")),
          up && g.type === "lxc" && g.may.console && small(t("pve.console"), "terminal", () => pveConsoleDialog(x, g)),
          !m && g.id !== x.self && small(t("pve.client.button"), "download", () => pveClientDialog(x, g)),
          small(t("app.more"), "more", () => pveGuestDialog(x, g)),
        ),
      ),
    );
  };
  return h(
    "div",
    { class: "stack" },
    guests.length
      ? h("section", { class: "card" }, h("div", { class: "table-wrap" }, h("table", { class: "pve-guests" }, h("thead", null, h("tr", null, h("th", null, "ID"), h("th", null, t("pve.col.name")), h("th", null, t("app.col.state")), h("th", null, t("pve.col.load")), h("th", null, t("pve.col.uptime")), h("th"))), h("tbody", null, guests.map(row)))), note)
      : h("section", { class: "card" }, h("p", { class: "muted pve-note first" }, t("pve.noGuests")), note),
  );
}

async function pvePower(x, g, action, el) {
  if (el) el.disabled = true;
  try {
    const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/power`, { action });
    toast(t(r.done ? "pve.done." + action : "pve.going", { name: g.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
  void loadPve();
}

/** Shutting down, restarting or pulling the plug: asked first, the hard stop said for what it is */
function pvePowerDialog(x, g, action, then) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(`pve.${action}Title`, { name: g.name })),
    h("p", { class: "muted" }, t(`pve.${action}Lead`)),
    // the guest Hata itself runs in: the page goes with it
    g.id === x.self && h("p", { class: "card pad warn-box" }, t(action === "reboot" ? "pve.selfReboot" : "pve.selfDown")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("pve." + action), {
        class: action === "stop" ? "danger" : "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          dialog.close();
          await pvePower(x, g, action);
          then?.();
        },
      }, action === "reboot" ? "refresh" : "stop"),
    ),
  );
}

/** The commands that put Hata's client on a guest of this system, typed in its console as root; null — it cannot have it */
function clientLineFor(os, address, code) {
  const line = `curl -fsSL ${address}/client/${code} | sh`;
  if (/^(debian|ubuntu)$/.test(os)) return `apt-get update && apt-get install -y curl ca-certificates && ${line}`;
  if (/^(fedora|centos|rocky|alma)/.test(os)) return `dnf install -y curl && ${line}`;
  // a virtual machine says only "l26"; the line works wherever curl is
  if (!os || os === "l26") return line;
  return null;
}

/** A container's console from Proxmox, in Hata's own terminal */
function pveConsoleDialog(x, g) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, `${g.name} · ${guestKind(g)}`), closeX(() => dialog)), h("p", { class: "muted small" }, t("pve.consoleHint")), h("div", { class: "term-holder" }, terminalFrame({ pve: x.id, guest: g.id })));
}

/**
 * Hata's client put on a guest that is there already: Proxmox runs no command inside one for a token,
 * so the person pastes a line into its console — opened in Proxmox's own page — and Hata waits for it.
 */
async function pveClientDialog(x, g) {
  let invite;
  try {
    invite = await api("POST", "/api/machines/invite", {});
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const os = g.config?.os ?? "";
  // a running container whose console and options the token may use: Hata types the line itself
  const auto = g.type === "lxc" && g.status === "running" && g.may.console;
  const rootPassword = h("input", { type: "password", autocomplete: "new-password", name: "pve-root-password", placeholder: t("pve.client.rootPassword") });
  const known = new Set((machinesUi.list?.machines ?? []).map((m) => m.id));
  // the guest is on the home network: the server's own number reaches it first
  const addresses = [...new Set([invite.lan, location.origin, invite.local].filter(Boolean).map((a) => a.replace(/\/$/, "")))];
  let address = addresses[0];
  const line = () => clientLineFor(os, address, invite.code);
  const cmd = h("span", { class: "grow mono machine-line" }, line() ?? "");
  const waiting = h("p", { class: "machine-wait" }, h("span", { class: "machine-pulse" }), t("pve.client.waiting"));
  const consoleUrl = `${x.url}/?console=${g.type === "lxc" ? "lxc" : "kvm"}&${g.type === "lxc" ? "xtermjs=1&" : "novnc=1&"}vmid=${g.vmid}&vmname=${encodeURIComponent(g.name)}&node=${encodeURIComponent(g.node)}`;
  let dialog;
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("pve.client.title", { name: g.name })), closeX(() => dialog)),
    h("p", null, t("pve.client.lead")),
    h("ul", { class: "stack-s small pve-gives" }, ["apps", "files", "terminal", "backups", "power"].map((k) => h("li", null, t("pve.client.gives." + k)))),
    line() === null
      ? h("p", { class: "card pad warn-box" }, t("pve.client.unsupported", { os }))
      : [
          auto &&
            h(
              "div",
              { class: "card pad pve-offer" },
              h("div", { class: "grow stack-s" }, h("strong", null, t("pve.client.auto")), h("p", { class: "muted small" }, t("pve.client.autoLead")), rootPassword),
              button(t("pve.client.autoButton"), {
                class: "primary",
                onclick: async (e) => {
                  if (!rootPassword.value) return rootPassword.focus();
                  const el = e.currentTarget;
                  el.disabled = true;
                  try {
                    const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/client`, { password: rootPassword.value });
                    dialog.close();
                    void jobDialog(r.job, "client", g.name, () => {
                      toast(t("pve.client.done", { name: g.name }));
                      void loadPve();
                      void loadMachines();
                    });
                  } catch (err) {
                    toast(errorText(err), "error");
                    el.disabled = false;
                  }
                },
              }, "download"),
            ),
          h("p", { class: "strong" }, t(auto ? "pve.client.howHand" : "pve.client.how")),
          h("ol", { class: "stack-s small" }, h("li", null, t("pve.client.step1"), " ", h("a", { class: "link", href: consoleUrl, target: "_blank", rel: "noopener noreferrer" }, t("pve.client.openConsole"))), h("li", null, t("pve.client.step2")), h("li", null, t(g.status === "running" ? "pve.client.step3" : "pve.client.step3stopped"))),
          addresses.length > 1 && h("select", { onchange: (e) => ((address = e.target.value), (cmd.textContent = line())) }, addresses.map((a) => h("option", { value: a }, a))),
          h("p", { class: "cmd whole" }, cmd, h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(line()) }, icon("copy"))),
          h("p", { class: "muted small" }, t("machines.addHint", { minutes: Math.round(invite.valid / 60000) })),
          waiting,
        ],
    h("footer", null, closeButton(() => dialog)),
  );
  const look = async () => {
    const list = await api("GET", "/api/machines").catch(() => null);
    const fresh = list?.machines.find((m) => !known.has(m.id));
    if (!fresh) return;
    machinesUi.list = list;
    waiting.replaceChildren(icon("check"), h("span", null, t("machines.addDone", { name: fresh.name })), h("a", { class: "btn small primary", href: `#/machines/${fresh.id}`, onclick: () => dialog.close() }, t("common.open")));
    waiting.classList.add("done");
    clearInterval(timer);
    void loadPve();
  };
  const timer = setInterval(look, 3000);
  dialog.addEventListener("close", () => clearInterval(timer));
}

/** One guest: what it is, its power, its snapshots and backups */
function pveGuestDialog(x, g) {
  const up = g.status === "running";
  const c = g.config;
  const row = (label, value, mono) => value && h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", { class: mono ? "mono" : "" }, value));
  const m = machinesUi.list?.machines.find((mm) => mm.pve?.host === x.id && mm.pve?.id === g.id);
  const snaps = h("div", { class: "stack-s" }, h("p", { class: "muted small" }, t("machines.loading")));
  const backs = h("div", { class: "stack-s" }, h("p", { class: "muted small" }, t("machines.loading")));
  let dialog;
  const again = () => (dialog.close(), pveGuestDialog(x, pveUi.host?.guests.find((y) => y.id === g.id) ?? g));
  const act = (label, iconName, action, cls = "") => g.may.power && button(label, { class: "small " + cls, onclick: async (e) => (action === "start" || action === "resume" ? (await pvePower(x, g, action, e.currentTarget), again()) : (dialog.close(), pvePowerDialog(x, g, action))) }, iconName);
  dialog = openDialog(
    "wide",
    h("header", null, h("span", { class: "machine-icon" }, icon(g.type === "lxc" ? "box" : "server")), h("div", { class: "grow" }, h("h2", null, g.name), h("p", { class: "muted small" }, guestKind(g), " · ", guestChip(g))), closeX(() => dialog)),
    h(
      "div",
      { class: "row-actions" },
      !up && act(t("pve.start"), "play", g.status === "paused" ? "resume" : "start", "primary"),
      up && act(t("pve.shutdown"), "stop", "shutdown"),
      up && act(t("pve.reboot"), "refresh", "reboot"),
      up && g.type === "qemu" && act(t("pve.suspend"), "clock", "suspend"),
      up && act(t("pve.stop"), "x", "stop", "danger"),
      up && g.type === "lxc" && g.may.console && button(t("pve.console"), { class: "small", onclick: () => (dialog.close(), pveConsoleDialog(x, g)) }, "terminal"),
      !g.may.power && h("span", { class: "muted small" }, t("pve.noPower")),
      (g.may.configure || g.may.cpu || g.may.memory || g.may.disk) && button(t("pve.edit.button"), { class: "small", onclick: () => (dialog.close(), pveEditDialog(x, g)) }, "sliders"),
      g.id === x.self && h("span", { class: "chip accent" }, t("pve.selfChip")),
      g.may.remove && g.status === "stopped" && g.id !== x.self && button(t("pve.guestRemove"), { class: "small danger", onclick: () => (dialog.close(), pveRemoveDialog(x, g)) }, "trash"),
    ),
    h(
      "section",
      { class: "stack-s" },
      row(t("pve.kind"), g.type === "lxc" ? t("pve.container") + (c?.unprivileged ? " · " + t("pve.unprivileged") : "") : t("pve.vm")),
      row(t("pve.col.node"), g.node),
      row(t("machines.os"), c?.os),
      row(t("machines.address"), c?.addresses.join(", "), true),
      row(t("pve.onboot"), c ? t(c.onboot ? "pve.yes" : "pve.no") : ""),
      row(t("pve.resources"), `${t("sys.cores", { n: g.cores })} · ${bytes(g.memory.total)}${g.disk.total ? " · " + bytes(g.disk.total) : ""}`),
      row(t("pve.pool"), g.pool),
      row(t("pve.tags"), g.tags.join(", ")),
      m && h("div", { class: "kv" }, h("span", { class: "muted" }, t("nav.machines")), h("a", { class: "link", href: `#/machines/${m.id}`, onclick: () => dialog.close() }, m.name)),
      !m && g.id !== x.self && h("div", { class: "card pad pve-offer" }, h("div", { class: "grow" }, h("strong", null, t("pve.client.offer")), h("p", { class: "muted small" }, t("pve.client.offerLead"))), button(t("pve.client.button"), { class: "small", onclick: () => (dialog.close(), pveClientDialog(x, g)) }, "download")),
      c?.description && h("p", { class: "muted small wrap" }, c.description),
    ),
    h("div", { class: "section-head" }, h("h3", null, t("pve.snapshots")), g.may.snapshot && button(t("pve.snapshotTake"), { class: "small", onclick: () => (dialog.close(), pveSnapshotDialog(x, g)) }, "plus")),
    snaps,
    h("div", { class: "section-head" }, h("h3", null, t("pve.backups")), g.may.backup && x.storages.some((st) => st.node === g.node && st.active && st.backup) && button(t("pve.backupTake"), { class: "small", onclick: (e) => pveBackupNow(x, g, e.currentTarget) }, "plus")),
    backs,
    h("footer", null, closeButton(() => dialog)),
  );
  void (async () => {
    try {
      const { snapshots } = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/snapshots`);
      put(
        snaps,
        snapshots.length
          ? snapshots.map((s) =>
              h(
                "div",
                { class: "pve-row" },
                h("div", { class: "grow" }, h("div", null, h("span", { class: "mono strong" }, s.name), s.memory && h("span", { class: "chip" }, t("pve.withMemory"))), h("div", { class: "muted small" }, [s.at ? dateTime(s.at) : "", s.description].filter(Boolean).join(" · "))),
                h("div", { class: "row-actions" }, g.may.rollback && button(t("pve.rollback"), { class: "small", onclick: () => (dialog.close(), pveSnapshotAct(x, g, s, "rollback")) }, "undo"), g.may.snapshot && button("", { class: "small ghost", title: t("pve.snapshotRemove"), "aria-label": t("pve.snapshotRemove"), onclick: () => (dialog.close(), pveSnapshotAct(x, g, s, "delete")) }, "trash")),
              ),
            )
          : h("p", { class: "muted small" }, t("pve.noSnapshots")),
      );
    } catch (e) {
      snaps.replaceChildren(h("p", { class: "muted small" }, errorText(e)));
    }
    try {
      const r = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/backups`);
      put(
        backs,
        r.backups.length ? r.backups.slice(0, 10).map((b) => h("div", { class: "pve-row" }, h("div", { class: "grow" }, h("div", null, dateTime(b.at), b.protected && h("span", { class: "chip" }, t("pve.protected"))), b.notes && h("div", { class: "muted small" }, b.notes)), h("span", { class: "muted small" }, `${b.storage} · ${bytes(b.size)}`), g.may.remove && button(t("pve.restore.button"), { class: "small", onclick: () => (dialog.close(), pveRestoreDialog(x, g, b)) }, "undo"))) : h("p", { class: "muted small" }, r.storages.length ? t("pve.noBackups") : t("pve.noBackupStorages")),
        r.backups.length > 10 && h("p", { class: "muted small" }, t("pve.moreBackups", { n: r.backups.length - 10 })),
        r.unreachable.length > 0 && h("p", { class: "muted small" }, t("pve.storagesUnreachable", { list: r.unreachable.join(", ") })),
      );
    } catch (e) {
      backs.replaceChildren(h("p", { class: "muted small" }, errorText(e)));
    }
  })();
}

/** A guest's settings: name, processor, memory, disks made larger, start with the server, tags and notes */
async function pveEditDialog(x, g) {
  let r;
  try {
    r = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/settings`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const s = r.settings;
  const lxc = g.type === "lxc";
  const num = (value, min, max, may) => h("input", { type: "number", required: true, min, max, value, disabled: !may });
  const name = h("input", { required: true, value: s.name, pattern: lxc ? "[A-Za-z0-9]([A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?" : "[A-Za-z0-9]([A-Za-z0-9.\\-]{0,61}[A-Za-z0-9])?", autocapitalize: "none", spellcheck: false, class: "mono", disabled: !r.may.configure });
  const cores = num(s.cores, 1, 512, r.may.cpu);
  const memory = num(s.memory, 64, 4194304, r.may.memory);
  const swap = lxc && num(s.swap, 0, 4194304, r.may.memory);
  const disks = s.disks.map((d) => ({ d, input: num(Math.ceil(d.size - 0.001), Math.ceil(d.size - 0.001), 65536, r.may.disk) }));
  const onboot = h("input", { type: "checkbox", checked: s.onboot, disabled: !r.may.configure });
  const tags = h("input", { value: s.tags.join(" "), placeholder: "web media", autocapitalize: "none", spellcheck: false, class: "mono", disabled: !r.may.configure });
  const notes = h("textarea", { rows: 4, maxLength: 8000, disabled: !r.may.configure });
  notes.value = s.description;
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const grow = Object.fromEntries(disks.filter(({ d, input }) => Number(input.value) > Math.ceil(d.size - 0.001)).map(({ d, input }) => [d.key, Number(input.value)]));
    try {
      const done = await api("PUT", `/api/proxmox/${x.id}/guests/${g.id}/settings`, {
        ...(r.may.configure ? { name: name.value.trim(), onboot: onboot.checked, tags: tags.value.split(/[\s,;]+/).filter(Boolean), description: notes.value } : {}),
        ...(r.may.cpu ? { cores: Number(cores.value) } : {}),
        ...(r.may.memory ? { memory: Number(memory.value), ...(lxc ? { swap: Number(swap.value) } : {}) } : {}),
        ...(Object.keys(grow).length ? { disks: grow } : {}),
      });
      dialog.close();
      toast(!done.changed.length ? t("pve.edit.nothing") : done.pending.length ? t("pve.edit.pending", { name: g.name, list: done.pending.join(", ") }) : t("pve.edit.done", { name: g.name }));
      await loadPve();
      pveGuestDialog(x, pveUi.host?.guests.find((y) => y.id === g.id) ?? g);
    } catch (err) {
      error.textContent = errorText(err);
      submit.disabled = false;
    }
  };
  const pair = (...items) => h("div", { class: "form-pair" }, ...items);
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t("pve.edit.title", { name: g.name })), closeX(() => dialog)),
      r.pending.length > 0 && h("p", { class: "banner small" }, t("pve.edit.waiting", { list: r.pending.join(", ") })),
      field(t(lxc ? "pve.new.hostname" : "pve.edit.name"), name),
      pair(field(t("pve.new.cores"), cores), field(t("pve.edit.memory"), memory, r.running && !lxc ? t("pve.edit.vmRestart") : null)),
      lxc && field(t("pve.edit.swap"), swap),
      disks.map(({ d, input }) => field(t("pve.edit.disk", { disk: d.key, storage: d.storage }), input, t("pve.edit.diskHint"))),
      h("label", { class: "check" }, onboot, h("span", null, h("strong", null, t("pve.onboot")))),
      field(t("pve.tags"), tags, t("pve.edit.tagsHint")),
      field(t("pve.edit.notes"), notes),
      !(r.may.configure && r.may.cpu && r.may.memory && r.may.disk) && h("p", { class: "muted small" }, t("pve.edit.someRefused")),
      error,
      h("footer", null, closeButton(() => (dialog.close(), pveGuestDialog(x, g), dialog), t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("check"), h("span", null, t("settings.save")))),
    ),
  );
}

/** A backup put back: as a new guest beside the old one, or instead of it (stopped, its name typed) */
async function pveRestoreDialog(x, g, b) {
  let o;
  try {
    o = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/restore`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const stopped = g.status === "stopped";
  const radio = (value, checked, disabled) => h("input", { type: "radio", name: "pve-restore", value, checked, disabled, onchange: () => paint() });
  const asNew = radio("new", true, false);
  const instead = radio("replace", false, o.self || !stopped);
  const opt = (value, label = value) => h("option", { value }, label);
  const vmid = h("input", { type: "number", required: true, min: o.ids?.from ?? 100, max: o.ids?.to ?? 999999999, value: o.next ?? "" });
  const storage = h("select", null, g.type === "qemu" && opt("", t("pve.restore.storageAsBackup")), o.storages.map((v) => opt(v)));
  storage.value = g.type === "qemu" ? "" : o.storage;
  const pool = h("select", null, o.free && opt("", t("pve.new.noPool")), o.pools.map((p) => opt(p)));
  pool.value = o.pools.includes(o.pool) ? o.pool : (pool.options[0]?.value ?? "");
  const start = h("input", { type: "checkbox" });
  const typed = h("input", { autocomplete: "off", spellcheck: false, class: "mono", oninput: () => paint() });
  const newPart = h("div", { class: "stack-s" }, h("div", { class: "form-pair" }, field("ID", vmid, o.ids ? t("pve.new.idsHint", o.ids) : null), (o.pools.length > 0 || !o.free) && field(t("pve.pool"), pool)));
  const replacePart = h("div", { class: "stack-s", hidden: true }, field(t("pve.typeName", { name: g.name }), typed));
  const error = h("p", { class: "error", role: "alert" });
  const go = h("button", { type: "submit", class: "btn primary" }, icon("undo"), h("span", null, t("pve.restore.go")));
  const paint = () => {
    newPart.hidden = !asNew.checked;
    replacePart.hidden = asNew.checked;
    go.className = "btn " + (asNew.checked ? "primary" : "danger");
    go.disabled = !asNew.checked && typed.value !== g.name;
  };
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    go.disabled = true;
    try {
      const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/restore`, { volid: b.volid, replace: instead.checked, name: typed.value, vmid: Number(vmid.value), storage: storage.value, pool: pool.value, start: start.checked });
      dialog.close();
      void jobDialog(r.job, "restore", g.name, () => {
        toast(t("pve.restore.done", { name: g.name }));
        void loadPve();
      });
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  };
  const choice = (input, title, hint) => h("label", { class: "check" }, input, h("span", null, h("strong", null, title), h("span", { class: "muted small block" }, hint)));
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow wrap" }, t("pve.restore.title", { name: g.name, when: dateTime(b.at) })), closeX(() => dialog)),
      h("p", { class: "muted small mono" }, `${b.volid} · ${bytes(b.size)}`),
      choice(asNew, t("pve.restore.new"), t("pve.restore.newHint")),
      newPart,
      choice(instead, t("pve.restore.replace", { name: g.name }), o.self ? t("pve.restore.selfNo") : !stopped ? t("pve.restore.stopFirst", { name: g.name }) : t("pve.restore.replaceHint", { name: g.name })),
      replacePart,
      field(t("pve.restore.storage"), storage),
      h("label", { class: "check" }, start, h("span", null, h("strong", null, t("pve.restore.start")))),
      error,
      h("footer", null, closeButton(() => (dialog.close(), pveGuestDialog(x, g), dialog), t("common.cancel")), go),
    ),
  );
  paint();
}

function pveSnapshotDialog(x, g) {
  const name = h("input", { placeholder: t("pve.snapshotNameAuto"), pattern: "[A-Za-z][A-Za-z0-9_\\-]{1,39}", maxLength: 40, class: "mono" });
  const about = h("input", { maxLength: 500 });
  let dialog;
  dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          const submit = dialog.querySelector("button[type=submit]");
          submit.disabled = true;
          try {
            const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/snapshots`, { name: name.value, description: about.value });
            dialog.close();
            toast(t(r.done ? "pve.snapshotDone" : "pve.going", { name: g.name }));
            pveGuestDialog(x, g);
          } catch (err) {
            toast(errorText(err), "error");
            submit.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("pve.snapshotTitle", { name: g.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("pve.snapshotLead")),
      field(t("pve.snapshotName"), name, t("pve.snapshotNameHint")),
      field(t("pve.snapshotAbout"), about),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("plus"), h("span", null, t("pve.snapshotTake")))),
    ),
  );
}

function pveSnapshotAct(x, g, s, action) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(action === "rollback" ? "pve.rollbackTitle" : "pve.snapshotRemoveTitle", { name: g.name, snapshot: s.name })),
    h("p", { class: "muted" }, t(action === "rollback" ? "pve.rollbackLead" : "pve.snapshotRemoveLead", { snapshot: s.name })),
    h(
      "footer",
      null,
      closeButton(() => (dialog.close(), pveGuestDialog(x, g), dialog), t("common.cancel")),
      button(t(action === "rollback" ? "pve.rollback" : "pve.snapshotRemove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const r = await api(action === "rollback" ? "POST" : "DELETE", `/api/proxmox/${x.id}/guests/${g.id}/snapshots/${encodeURIComponent(s.name)}`, action === "rollback" ? {} : undefined);
            toast(t(r.done ? (action === "rollback" ? "pve.rollbackDone" : "pve.snapshotRemoved") : "pve.going", { name: g.name, snapshot: s.name }));
          } catch (err) {
            toast(errorText(err), "error");
          }
          dialog.close();
          pveGuestDialog(x, g);
        },
      }, action === "rollback" ? "undo" : "trash"),
    ),
  );
}

/** Deleting a guest with its disks: its name typed first */
function pveRemoveDialog(x, g) {
  const typed = h("input", { autocomplete: "off", spellcheck: false, class: "mono", oninput: () => (go.disabled = typed.value !== g.name) });
  let dialog;
  const go = button(t("pve.guestRemove"), {
    class: "danger",
    disabled: true,
    onclick: async () => {
      go.disabled = true;
      try {
        const r = await api("DELETE", `/api/proxmox/${x.id}/guests/${g.id}`, { name: typed.value });
        dialog.close();
        toast(t(r.done ? "pve.guestRemoved" : "pve.going", { name: g.name }));
        void loadPve();
      } catch (e) {
        toast(errorText(e), "error");
        go.disabled = false;
      }
    },
  }, "trash");
  dialog = openDialog("confirm", h("h2", { class: "wrap" }, t("pve.guestRemoveTitle", { name: g.name })), h("p", { class: "muted" }, t("pve.guestRemoveLead", { kind: guestKind(g), name: x.name })), field(t("pve.typeName", { name: g.name }), typed), h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

async function pveBackupNow(x, g, el) {
  el.disabled = true;
  try {
    await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/backups`, {});
    toast(t("pve.backupStarted", { name: g.name }));
  } catch (e) {
    toast(errorText(e), "error");
    el.disabled = false;
  }
}

function pveTasks(x) {
  const name = (task) => {
    const g = x.guests.find((y) => String(y.vmid) === task.id);
    // a task of the node itself (its shell, its updates) is about no guest
    return g ? `${g.name} (${g.vmid})` : task.id || task.node;
  };
  return x.tasks.length
    ? h(
        "div",
        { class: "table-wrap card" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("pve.col.when")), h("th", null, t("pve.col.task")), h("th", null, t("pve.col.target")), h("th", null, t("pve.col.user")), h("th", null, t("app.col.state")))),
          h(
            "tbody",
            null,
            x.tasks.map((task) =>
              h(
                "tr",
                { class: "clickable", onclick: () => pveTaskDialog(x, task, name(task)) },
                h("td", { class: "small" }, dateTime(task.start * 1000)),
                h("td", null, has("pve.task." + task.type) ? t("pve.task." + task.type) : h("span", { class: "mono" }, task.type)),
                h("td", { class: "small" }, name(task), x.nodes.length > 1 && h("span", { class: "muted" }, " · " + task.node)),
                h("td", { class: "small muted mono" }, task.user),
                h("td", null, task.end === null ? h("span", { class: "state restarting" }, t("pve.taskRunning")) : task.failed ? h("span", { class: "chip danger clip" }, task.status) : h("span", { class: "chip ok" }, task.status === "OK" ? "OK" : task.status)),
              ),
            ),
          ),
        ),
      )
    : h("p", { class: "card pad muted" }, t("pve.noTasks"));
}

async function pveTaskDialog(x, task, target) {
  const log = h("pre", { class: "log" }, t("machines.loading"));
  let dialog;
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow" }, (has("pve.task." + task.type) ? t("pve.task." + task.type) : task.type) + (target ? " · " + target : "")), closeX(() => dialog)), h("p", { class: "muted small" }, dateTime(task.start * 1000), " · ", task.user, " · ", task.end === null ? t("pve.taskRunning") : task.status), log, h("footer", null, closeButton(() => dialog)));
  try {
    const { lines } = await api("GET", `/api/proxmox/${x.id}/tasks/log?upid=${encodeURIComponent(task.upid)}`);
    log.textContent = lines.join("\n") || "—";
  } catch (e) {
    log.textContent = errorText(e);
  }
}

// --- One machine ---

const MACHINE_TABS = ["overview", "apps", "containers", "docker", "terminal"];

function renderMachine() {
  if (machinesUi.current?.id !== state.route.id) {
    machinesUi.current = machinesUi.list?.machines.find((m) => m.id === state.route.id) ?? null;
    machinesUi.containers = null;
  }
  shell(h("div", { id: "machine-head" }), h("div", { id: "machine-tab" }));
  if (machinesUi.current) renderMachineHead();
  renderMachineTab();
}

function renderMachineHead() {
  const m = machinesUi.current;
  const head = document.getElementById("machine-head");
  if (!head) return;
  if (!m) return put(head, h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines"))), machinesUi.list && h("p", { class: "card pad muted" }, t("error.machine.notFound")));
  const tab = (id, iconName) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `#/machines/${m.id}${id === "overview" ? "" : "/" + id}` }, icon(iconName), t("machines.tab." + id));
  head.replaceChildren(
    h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines")), icon("chevron"), h("span", null, m.name)),
    h(
      "div",
      { class: "app-head", menu: (at) => machineMenu(m, at) },
      h("span", { class: "machine-icon" }, icon("server")),
      h("div", { class: "grow" }, h("div", { class: "app-title" }, h("h1", null, m.name), machineChip(m)), h("p", { class: "meta" }, [machineOs(m), m.ip, m.online ? null : t("machines.seen", { ago: ago(m.seen) })].filter(Boolean).flatMap((part, i) => (i ? [h("span", { class: "dot-sep" }, "·"), part] : [part])))),
      h(
        "div",
        { class: "actions" },
        m.outdated && m.online && button(t("machines.update", { version: machinesUi.list.version }), { class: "accent", onclick: (e) => updateMachine(m, e.currentTarget) }, "up"),
        m.online && h("a", { class: "btn", href: filesHash("/", m.id) }, icon("folder"), h("span", null, t("machines.files"))),
        !m.online && m.pve?.power && m.pve.status !== "running" && button(t("pve.startHere", { host: m.pve.hostName }), { class: "primary", onclick: (e) => startGuestOf(m, e.currentTarget) }, "play"),
        !m.online && !(m.pve?.power && m.pve.status !== "running") && m.info?.macs?.length > 0 && button(t("machines.wake"), { class: "primary", onclick: (e) => wakeMachine(m, e.currentTarget) }, "play"),
        m.pve && h("a", { class: "btn", href: `#/proxmox/${m.pve.host}/guests` }, icon("server"), h("span", null, guestKind(m.pve) + " · " + m.pve.hostName)),
        h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: () => machineMenu(m) }, icon("more")),
      ),
    ),
    h("div", { class: "tabs" }, tab("overview", "grid"), tab("apps", "store"), tab("containers", "box"), tab("docker", "disk"), tab("terminal", "terminal")),
  );
}

function machineMenu(m, at = null) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "machine-icon" }, icon("server")), h("div", null, h("h2", null, m.name), machineChip(m))),
    item(t("machines.rename"), "edit", () => renameMachineDialog(m)),
    !m.online && m.info?.macs?.length > 0 && item(t("machines.wake"), "play", () => wakeMachine(m)),
    m.online && item(t("machines.reboot"), "refresh", () => powerDialog(m, "reboot")),
    m.online && item(t("machines.poweroff"), "stop", () => powerDialog(m, "poweroff")),
    m.online && item(t("machines.updateAgain"), "up", () => updateMachine(m)),
    item(t("machines.remove"), "trash", () => removeMachineDialog(m), "danger"),
  );
  if (at) placeAt(dialog, at);
}

/** A machine that is a guest of Proxmox is started there, not woken */
async function startGuestOf(m, el) {
  if (el) el.disabled = true;
  try {
    const r = await api("POST", `/api/proxmox/${m.pve.host}/guests/${m.pve.id}/power`, { action: m.pve.status === "paused" ? "resume" : "start" });
    toast(t(r.done ? "pve.done.start" : "pve.going", { name: m.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) setTimeout(() => (el.disabled = false), 5000);
}

/** The magic packet to the machine's cards: it wakes when its BIOS and card allow it */
async function wakeMachine(m, el) {
  if (el) el.disabled = true;
  try {
    await api("POST", `/api/machines/${m.id}/wake`, {});
    toast(t("machines.wakeSent", { name: m.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) setTimeout(() => (el.disabled = false), 5000);
}

function powerDialog(m, action) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(`machines.${action}Title`, { name: m.name })),
    h("p", { class: "muted" }, t(`machines.${action}Lead`)),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t(`machines.${action}`), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("POST", `/api/machines/${m.id}/power`, { action });
            dialog.close();
            toast(t(`machines.${action}Done`, { name: m.name }));
          } catch (err) {
            toast(errorText(err), "error");
          }
        },
      }, action === "reboot" ? "refresh" : "stop"),
    ),
  );
}

/** Restarts or shuts down the server Hata runs on; after a restart the page waits for it and reloads */
function serverPowerDialog(action) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(`power.${action}Title`)),
    h("p", { class: "muted" }, t(`power.${action}Lead`)),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t(`power.${action}`), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("POST", "/api/system/power", { action });
            dialog.close();
            toast(t(`power.${action}Done`));
            if (action === "reboot") void waitForReturn();
          } catch (err) {
            toast(errorText(err), "error");
          }
        },
      }, action === "reboot" ? "refresh" : "stop"),
    ),
  );
}

/** Waits for the server to go away and to answer again, then reloads the page */
async function waitForReturn() {
  const answers = () => fetch("/api/state", { cache: "no-store" }).then((r) => r.ok, () => false);
  const started = Date.now();
  let gone = false;
  while (Date.now() - started < 15 * 60_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const up = await answers();
    if (!up) gone = true;
    else if (gone) return location.reload();
  }
}

async function updateMachine(m, el) {
  if (el) el.disabled = true;
  try {
    await api("POST", `/api/machines/${m.id}/update`, {});
    toast(t("machines.updated", { name: m.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
  // the client restarts into the new version and connects again
  setTimeout(loadMachines, 4000);
}

function renameMachineDialog(m) {
  let dialog;
  const field = h("input", { type: "text", value: m.name, maxlength: 40, required: true });
  dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api("PATCH", `/api/machines/${m.id}`, { name: field.value });
            dialog.close();
            await loadMachines();
          } catch (err) {
            toast(errorText(err), "error");
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("machines.rename")), closeX(() => dialog)),
      h("label", { class: "field" }, h("span", null, t("machines.name")), field),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("settings.save"), { type: "submit", class: "primary" })),
    ),
  );
  field.select();
}

function removeMachineDialog(m) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("machines.removeTitle", { name: m.name })),
    h("p", { class: "muted" }, t(m.online ? "machines.removeLead" : "machines.removeOffline")),
    !m.online && h("p", { class: "cmd" }, icon("terminal"), "sudo hata-client uninstall"),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("machines.remove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("DELETE", `/api/machines/${m.id}`);
            dialog.close();
            go("#/machines");
          } catch (err) {
            toast(errorText(err), "error");
          }
        },
      }, "trash"),
    ),
  );
}

function renderMachineTab() {
  const box = document.getElementById("machine-tab");
  const m = machinesUi.current;
  if (!box || !m) return;
  if (!m.online && state.route.tab !== "overview") return box.replaceChildren(h("p", { class: "card pad muted" }, t("error.machine.offline", { name: m.name })));
  if (state.route.tab === "containers") {
    box.replaceChildren(h("div", { id: "machine-containers" }, h("p", { class: "muted" }, t("machines.loading"))));
    if (machinesUi.containers) paintMachineContainers();
    void loadMachineContainers();
  } else if (state.route.tab === "apps") {
    box.replaceChildren(h("div", { id: "machine-apps" }, h("p", { class: "muted" }, t("machines.loading"))));
    if (machinesUi.apps?.machine === m.id) paintMachineApps();
    void loadMachineApps();
  } else if (state.route.tab === "docker") {
    box.replaceChildren(h("div", { id: "machine-docker", class: "stack" }));
    paintSpace(m.id);
    void loadSpace(m.id);
  } else if (state.route.tab === "terminal") {
    box.replaceChildren(h("div", { class: "term-holder" }, terminalFrame({ machine: m.id })));
  } else machineOverview(m, box);
}

function machineOverview(m, box) {
  const row = (label, value, mono) => value && h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", { class: mono ? "mono" : "" }, value));
  const i = m.info ?? {};
  box.replaceChildren(
    h(
      "div",
      { class: "columns" },
      h(
        "div",
        { class: "stack" },
        h("div", { class: "section-head" }, h("h2", null, t("app.resources"))),
        m.online
          ? h("section", { class: "stats card" }, statCells("m"))
          : h("p", { class: "card pad muted" }, t("machines.offlineLead", { ago: ago(m.seen) })),
        h("div", { id: "m-disks" }),
        m.online && h("div", { id: "machine-sysupdates" }, sysUpdatesCard(m.id)),
        h("div", { id: "machine-people" }, machinePeopleCard(m)),
      ),
      h(
        "aside",
        { class: "side" },
        h(
          "section",
          { class: "card pad" },
          h("div", { class: "section-head" }, h("h2", null, t("app.glance"))),
          row(t("machines.hostname"), i.hostname, true),
          row(t("machines.os"), i.os),
          row(t("machines.kernel"), i.kernel, true),
          row(t("sys.cpu"), i.cpu && `${i.cpu} · ${t("sys.cores", { n: i.cores })}`),
          row(t("sys.memory"), i.memory && bytes(i.memory)),
          row("Docker", i.docker ? (i.docker.available ? `${i.docker.version} · compose ${i.docker.compose}` : t("machines.noDocker")) : ""),
          row(t("machines.address"), m.ip, true),
          row(t("machines.client"), i.version),
          row(t("machines.added"), new Date(m.added).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" })),
        ),
      ),
    ),
  );
  paintMachineStats(m);
  if (m.online && !sysUpdates[m.id]) void loadSysUpdates(m.id);
}

/** Who else may use the machine: its accounts for the users of Hata, and its folders shared with them */
const machinePeople = {};

async function loadMachinePeople(id) {
  try {
    const [shares, users] = await Promise.all([api("GET", `/api/machines/${id}/shares`), api("GET", "/api/users")]);
    machinePeople[id] = { shares: shares.shares, users };
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const box = document.getElementById("machine-people");
  if (box && machinesUi.current?.id === id) box.replaceChildren(machinePeopleCard(machinesUi.current));
}

function machinePeopleCard(m) {
  const data = machinePeople[m.id];
  if (m.people && !data) void loadMachinePeople(m.id);
  const others = (data?.users ?? []).filter((user) => user.role !== "admin");
  const who = (share) =>
    Object.entries(share.users)
      .map(([id, access]) => `${(data?.users ?? []).find((user) => user.id === id)?.name ?? "?"} — ${t("shares.access." + access).toLowerCase()}`)
      .join(", ");
  const row = (share) =>
    h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon strong" }, icon("share"), h("span", { class: "clip" }, share.name)), h("div", { class: "muted small mono clip" }, share.path)),
      h("td", { class: "muted small" }, who(share)),
      h("td", null, h("div", { class: "row-actions" }, button(t("machines.people.change"), { class: "small", onclick: () => machineShareDialog(m, share.path) }), h("a", { class: "btn small", href: filesHash(share.path, m.id) }, icon("folder"), h("span", null, t("common.open"))))),
    );
  return h(
    "section",
    { class: "card table-wrap" },
    h(
      "div",
      { class: "pad card-head stack-s" },
      h("div", { class: "section-head" }, h("h2", null, t("machines.people.title")), m.people ? h("div", { class: "row-actions" }, button(t("machines.people.share"), { class: "small primary", disabled: !m.online, onclick: () => folderPicker({ title: t("machines.people.pick", { name: m.name }), start: "/", machine: m.id, confirmLabel: t("machines.people.pickHere"), allowed: (at) => at !== "/", action: async (at) => machineShareDialog(m, at) }) }, "share"), button(t("machines.people.off"), { class: "small", onclick: () => letMachineDialog(m, false) })) : button(t("machines.people.on"), { class: "small primary", onclick: () => letMachineDialog(m, true) })),
      h("p", { class: "muted small" }, t(m.people ? "machines.people.onLead" : "machines.people.offLead")),
      m.people && data && !others.length && h("p", { class: "muted small" }, t("machines.people.nobody")),
    ),
    m.people && data?.shares.length > 0 && h("table", null, h("thead", null, h("tr", null, h("th", null, t("machines.people.col.folder")), h("th", null, t("shares.who")), h("th"))), h("tbody", null, data.shares.map(row))),
  );
}

/** Lets the machine to the other users of Hata, or takes it back — what that does is said first */
function letMachineDialog(m, on) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(on ? "machines.people.onTitle" : "machines.people.offTitle", { name: m.name })),
    h("p", { class: "muted" }, t(on ? "machines.people.onWhat" : "machines.people.offWhat")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t(on ? "machines.people.on" : "machines.people.off"), {
        class: on ? "primary" : "danger",
        onclick: async (e) => {
          const pressed = e.currentTarget;
          pressed.disabled = true;
          try {
            const answer = await api("PUT", `/api/machines/${m.id}/people`, { on });
            machinesUi.current = { ...machinesUi.current, people: answer.people };
            delete machinePeople[m.id];
            dialog.close();
            paintMachineOverview();
          } catch (err) {
            toast(errorText(err), "error");
            pressed.disabled = false;
          }
        },
      }),
    ),
  );
}

/** The machine, when an administrator is in its files and it is let to the other users of Hata */
const machineLet = (id) => (id && isAdmin() && machinesUi.list?.machines.find((m) => m.id === id && m.people)) || null;

/** A folder of the machine shared with users of Hata: its name and who may do what; nobody — not shared */
async function machineShareDialog(m, path) {
  if (!machinePeople[m.id]) await loadMachinePeople(m.id);
  const data = machinePeople[m.id];
  if (!data) return;
  const share = data.shares.find((one) => one.path === path);
  const folder = path.split("/").pop() || "/";
  const name = h("input", { value: share?.name ?? "", placeholder: folder, maxLength: 40, spellcheck: false, autocomplete: "off" });
  const users = data.users
    .filter((user) => user.role !== "admin")
    .map((user) => ({ user, select: h("select", null, ["none", "read", "write"].map((access) => h("option", { value: access, selected: access === (share?.users[user.id] ?? "none") }, t("shares.access." + access)))) }));
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const save = async (all) => {
    error.textContent = "";
    try {
      const answer = await api("PUT", `/api/machines/${m.id}/shares`, { path, name: name.value.trim(), users: all ? Object.fromEntries(users.filter(({ select }) => select.value !== "none").map(({ user, select }) => [user.id, select.value])) : {} });
      data.shares = answer.shares;
      dialog.close();
      toast(t(answer.shares.some((one) => one.path === path) ? "shares.saved" : "machines.people.unshared", { name: folder }));
      const box = document.getElementById("machine-people");
      if (box && machinesUi.current?.id === m.id) box.replaceChildren(machinePeopleCard(machinesUi.current));
    } catch (e) {
      error.textContent = errorText(e);
    }
  };
  dialog = openDialog(
    "confirm",
    h(
      "form",
      { onsubmit: (e) => (e.preventDefault(), save(true)) },
      h("header", null, h("span", { class: "badge-icon plain" }, icon("share")), h("div", null, h("h2", null, t(share ? "machines.people.dialogEdit" : "machines.people.dialogNew", { name: folder })), h("span", { class: "muted small mono clip" }, `${m.name}:${path}`))),
      h("p", { class: "muted small" }, t("machines.people.shareLead")),
      field(t("machines.people.name"), name, t("machines.people.nameHint")),
      h("div", { class: "field" }, h("span", { class: "label" }, t("shares.who")), users.length ? h("div", { class: "share-access" }, users.map(({ user, select }) => h("label", null, h("span", { class: "grow" }, h("strong", null, user.name), user.role === "guest" && h("span", { class: "muted small block" }, t("user.role.guest"))), select))) : h("p", { class: "muted small" }, t("machines.people.nobody"))),
      error,
      h("footer", null, share && button(t("machines.people.unshare"), { class: "danger", onclick: () => save(false) }), closeButton(() => dialog, t("common.cancel")), button(t("settings.save"), { type: "submit", class: "primary" })),
    ),
  );
}

function paintMachineOverview() {
  const box = document.getElementById("machine-tab");
  if (box && machinesUi.current) machineOverview(machinesUi.current, box);
}

function paintMachineStats(m) {
  if (m.status) paintStats("m", m.status);
}

/** The cells of a machine's numbers, their ids starting with `prefix` */
const statCells = (prefix) => [
  statCell(prefix + "-cpu", "cpu", t("sys.cpu")),
  statCell(prefix + "-memory", "memory", t("sys.memory")),
  statCell(prefix + "-disk", "disk", t("sys.disk")),
  statCell(prefix + "-network", "network", t("sys.network")),
  h("div", { class: "stat", id: `stat-${prefix}-temp`, hidden: true }, h("div", { class: "stat-label" }, icon("temp"), t("sys.temperature")), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, "—"), h("span", { class: "unit" })), h("div", { class: "stat-chart" })), h("div", { class: "stat-hint" }, " ")),
];

/** A machine's numbers into the cells of `statCells(prefix)` */
function paintStats(prefix, s) {
  setStat(prefix + "-cpu", s.cpu == null ? "—" : String(s.cpu), "%", t("sys.cores", { n: s.cores }) + " · " + t("sys.load", { load: s.load[0] }), sparkline(s.history.cpu, 100));
  const mem = s.memory;
  const memPercent = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
  const used = bytesParts(mem.used);
  setStat(prefix + "-memory", used.value, used.unit, t("sys.ofPercent", { total: bytes(mem.total), percent: memPercent }), sparkline(s.history.memory, 100), level(memPercent));
  const disk = s.disks[0];
  if (disk) {
    const percent = Math.round((disk.used / disk.total) * 100);
    const fill = h("i", { class: level(percent) });
    fill.style.width = percent + "%";
    setStat(prefix + "-disk", String(percent), "%", t("sys.free", { free: bytes(disk.total - disk.used), total: bytes(disk.total) }), h("div", { class: "bar" }, fill), level(percent));
  }
  const net = s.net ? bytesParts(s.net.rx + s.net.tx) : null;
  setStat(prefix + "-network", net ? net.value : "—", net ? net.unit + "/s" : "", s.net ? `↓ ${bytes(s.net.rx)}/s · ↑ ${bytes(s.net.tx)}/s` : "", sparkline(s.history.net));
  const temp = document.getElementById(`stat-${prefix}-temp`);
  if (temp) temp.hidden = s.temperature == null;
  if (s.temperature != null) setStat(prefix + "-temp", String(s.temperature), "°C", t("sys.cpu"), null, s.temperature >= 85 ? "warn" : "");
}

// --- A machine's apps ---

async function loadMachineApps() {
  const id = state.route.id;
  try {
    const list = await api("GET", `/api/machines/${id}/apps?lang=${state.lang}`);
    if (state.route.view !== "machine" || state.route.id !== id) return;
    machinesUi.apps = { machine: id, list };
  } catch (e) {
    const box = document.getElementById("machine-apps");
    return box ? box.replaceChildren(h("p", { class: "card pad muted" }, errorText(e))) : toast(errorText(e), "error");
  }
  paintMachineApps();
}

/** Where a machine's app answers: the machine's address and the app's port */
function machineAppUrl(m, app) {
  // behind Hata's sign-in it opens through this server, on a port of its own
  if (app.guarded) return `http://${location.hostname}:${app.guarded}${app.index || "/"}`;
  if (!app.port || !m.ip) return null;
  return `${app.scheme || "http"}://${m.ip.includes(":") ? `[${m.ip}]` : m.ip}:${app.port}${app.index || "/"}`;
}

function paintMachineApps() {
  const box = document.getElementById("machine-apps");
  const m = machinesUi.current;
  const list = machinesUi.apps?.list;
  if (!box || !m || !list) return;
  const head = h(
    "div",
    { class: list.length ? "project-head" : "section-head" },
    h("h2", null, t("machines.apps"), h("span", { class: "muted" }, String(list.length))),
    h(
      "div",
      { class: "row-actions" },
      button(t("machines.customApp"), { class: "small", onclick: () => machineComposeDialog(m, null) }, "code"),
      button(t("machines.fromStore"), { class: "small primary", onclick: () => ((state.installTarget = m.id), go("#/store")) }, "store"),
    ),
  );
  if (!m.info?.docker?.available) return box.replaceChildren(h("div", { class: "card pad" }, h("h2", null, t("machines.noDocker")), h("p", { class: "muted" }, t("machines.noDockerLead"))));
  const act = (app, action) => async (e) => {
    e.currentTarget.disabled = true;
    try {
      const res = await api("POST", `/api/machines/${m.id}/apps/${app.name}/${action}`, {});
      jobDialog(res.job, action, app.title, () => void loadMachineApps());
    } catch (err) {
      toast(errorText(err), "error");
    }
    void loadMachineApps();
  };
  const small = (label, iconName, onclick, off) => h("button", { type: "button", class: "icon-btn", title: label, "aria-label": label, disabled: off, onclick }, icon(iconName));
  const row = (app) => {
    const url = isUp(app) ? machineAppUrl(m, app) : null;
    const busy = !!app.job;
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon machine-app" }, appIcon(app), h("div", { class: "stack-s" }, h("strong", null, app.title), h("span", { class: "muted small mono" }, app.name + (app.store ? ` · ${app.store}` : ""))))),
      h("td", null, stateChip(app)),
      h("td", { class: "mono small" }, app.guarded && h("span", { class: "lock-mark", title: t("access.protected") }, icon("lock")), url ? h("a", { class: "link", href: url, target: "_blank", rel: "noopener noreferrer" }, url.replace(/^https?:\/\//, "").replace(/\/$/, "")) : app.port ? `${m.ip}:${app.port}` : "—"),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          busy && small(t("status.busy"), "terminal", () => jobDialog(app.job.id, app.job.kind, app.title, () => void loadMachineApps())),
          isUp(app) ? small(t("app.stop"), "stop", act(app, "stop"), busy) : small(t("app.start"), "play", act(app, "start"), busy),
          small(t("app.restart"), "refresh", act(app, "restart"), busy || !isUp(app)),
          small(t("app.update"), "up", act(app, "update"), busy),
          small(t("app.logs"), "logs", () => machineAppLogsDialog(m, app)),
          small(t("app.tab.compose"), "code", () => machineComposeDialog(m, app), busy),
          small(t("machines.move"), "server", () => moveAppDialog(m.id, app), busy),
          small(t("app.remove"), "trash", () => removeMachineAppDialog(m, app), busy),
        ),
      ),
    );
  };
  box.replaceChildren(
    h(
      "div",
      { class: "stack" },
      list.length
        ? h("section", { class: "card machine-project" }, head, h("div", { class: "table-wrap" }, h("table", { class: "machine-apps" }, h("thead", null, h("tr", null, h("th", null, t("machines.app")), h("th", null, t("app.col.state")), h("th", null, t("app.address")), h("th"))), h("tbody", null, list.map(row)))))
        : head,
      !list.length &&
        h("div", { class: "card empty" }, icon("store"), h("p", null, t("machines.noApps")), button(t("machines.fromStore"), { class: "primary", onclick: () => ((state.installTarget = m.id), go("#/store")) }, "store")),
    ),
  );
}

function machineAppLogsDialog(m, app) {
  let dialog;
  const log = h("pre", { class: "console page" });
  const abort = new AbortController();
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, `${m.name}: ${app.title}`), closeX(() => dialog)), h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} logs --follow --tail 200`), log);
  dialog.addEventListener("close", () => abort.abort());
  void followText(`/api/machines/${m.id}/apps/${app.name}/logs`, log, abort.signal);
}

/** The compose file of a machine's app, edited and applied; `app` null — a new app from a pasted file */
async function machineComposeDialog(m, app) {
  let current = { text: "", file: "" };
  if (app) {
    try {
      current = await api("GET", `/api/machines/${m.id}/apps/${app.name}/compose`);
    } catch (e) {
      return toast(errorText(e), "error");
    }
  }
  let dialog;
  const name = !app && h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono" });
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", required: true, value: current.text, placeholder: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - 8088:80\n" });
  const error = h("p", { class: "error", role: "alert" });
  dialog = openDialog(
    "xwide",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            const res = app ? await api("PUT", `/api/machines/${m.id}/apps/${app.name}/compose`, { compose: area.value }) : await api("POST", `/api/machines/${m.id}/apps`, { name: name.value.trim(), compose: area.value });
            dialog.close();
            jobDialog(res.job, app ? "apply" : "install", app ? app.title : name.value.trim(), () => void loadMachineApps());
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, app ? `${m.name}: ${app.title}` : t("machines.customTitle", { name: m.name })), app && h("p", { class: "muted small mono" }, current.file)), closeX(() => dialog)),
      name && field(t("store.customName"), name),
      area,
      error,
      h("footer", null, h("p", { class: "cmd grow" }, icon("terminal"), `docker compose -p ${app ? app.name : "…"} up -d --remove-orphans`), closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t(app ? "settings.save" : "store.install"))),
    ),
  );
  (name || area).focus();
}

function removeMachineAppDialog(m, app) {
  let dialog;
  const data = h("input", { type: "checkbox" });
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("machines.removeApp", { title: app.title, name: m.name })),
    h("p", { class: "muted" }, t("machines.removeAppLead")),
    h("label", { class: "check" }, data, h("span", null, t("machines.removeAppData", { path: `${(machinesUi.current?.dataRoot ?? "/DATA")}/AppData/${app.name}` }))),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("app.remove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const res = await api("DELETE", `/api/machines/${m.id}/apps/${app.name}${data.checked ? "?data=1" : ""}`);
            dialog.close();
            jobDialog(res.job, "remove", app.title, () => void loadMachineApps());
          } catch (err) {
            toast(errorText(err), "error");
          }
        },
      }, "trash"),
    ),
  );
}

/** An app moved to another machine: `from` — the machine it is on, "" for this server */
async function moveAppDialog(from, app) {
  if (!machinesUi.list) machinesUi.list = await api("GET", "/api/machines").catch(() => null);
  let check;
  try {
    check = await api("GET", `/api/moveapp/check?from=${from}&name=${app.name}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const places = [...(from ? [{ id: "", name: state.overview?.system.hostname ?? "Hata" }] : []), ...(machinesUi.list?.machines ?? []).filter((m) => m.id !== from && m.online && m.info?.docker?.available)];
  const to = h("select", null, places.map((p) => h("option", { value: p.id }, p.name)));
  const drop = h("input", { type: "checkbox" });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const go_ = button(t("moveapp.go"), {
    class: "primary",
    disabled: !places.length,
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      error.textContent = "";
      try {
        const res = await api("POST", "/api/moveapp", { from, to: to.value, name: app.name, dropOld: drop.checked });
        dialog.close();
        const target = to.value;
        jobDialog(res.job, "moveapp", app.title, () => go(target ? `#/machines/${target}/apps` : `#/apps/${app.name}`));
      } catch (err) {
        error.textContent = errorText(err);
        el.disabled = false;
      }
    },
  }, "server");
  dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("moveapp.title", { title: app.title })), closeX(() => dialog)),
    h("p", { class: "muted" }, t("moveapp.lead", { path: check.own })),
    places.length ? h("div", { class: "kv" }, h("span", { class: "muted" }, t("moveapp.to")), to) : h("p", { class: "banner small" }, t("moveapp.none")),
    check.outside.length > 0 && h("div", { class: "banner small stack-s" }, h("span", null, t("moveapp.outside")), check.outside.map((p) => h("span", { class: "mono" }, p))),
    check.volumes.length > 0 && h("div", { class: "banner small stack-s" }, h("span", null, t("moveapp.volumes")), h("span", { class: "mono" }, check.volumes.join(", "))),
    h("label", { class: "check" }, drop, h("span", null, t("moveapp.dropOld"))),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go_),
  );
}

// --- A machine's containers ---

async function loadMachineContainers() {
  const id = state.route.id;
  try {
    const data = await api("GET", `/api/machines/${id}/containers`);
    if (state.route.view !== "machine" || state.route.id !== id) return;
    machinesUi.containers = data;
  } catch (e) {
    const box = document.getElementById("machine-containers");
    return box ? box.replaceChildren(h("p", { class: "card pad muted" }, errorText(e))) : toast(errorText(e), "error");
  }
  paintMachineContainers();
}

function paintMachineContainers() {
  const box = document.getElementById("machine-containers");
  const m = machinesUi.current;
  const data = machinesUi.containers;
  if (!box || !m || !data) return;
  if (!data.docker.available && !data.containers.length) return box.replaceChildren(h("div", { class: "card pad" }, h("h2", null, t("machines.noDocker")), h("p", { class: "muted" }, t("machines.noDockerLead"))));
  if (!data.containers.length) return box.replaceChildren(h("p", { class: "card pad muted" }, t("machines.noContainers")));
  // compose projects first, by name; containers started on their own after them
  const groups = new Map();
  for (const c of data.containers) {
    if (!groups.has(c.project)) groups.set(c.project, []);
    groups.get(c.project).push(c);
  }
  const names = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
  const act = (path, action) => async (e) => {
    const el = e.currentTarget;
    el.disabled = true;
    try {
      await api("POST", `/api/machines/${m.id}/${path}`, { action });
    } catch (err) {
      toast(errorText(err), "error");
    }
    el.disabled = false;
    await loadMachineContainers();
  };
  const ports = (c) => [...new Set(c.ports.filter((p) => p.public).map((p) => `${p.public}→${p.private}`))].join(", ");
  const small = (label, iconName, onclick, off) => h("button", { type: "button", class: "icon-btn", title: label, "aria-label": label, disabled: off, onclick }, icon(iconName));
  const row = (c) => {
    const up = c.state === "running";
    const link = c.ports.find((p) => p.public && p.type === "tcp");
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "mono" }, c.service || c.name), h("div", { class: "muted small mono clip" }, c.image)),
      h("td", null, h("span", { class: "state " + (up ? "running" : c.state === "restarting" ? "restarting" : "") }, c.status)),
      h("td", { class: "mono small" }, link && m.ip ? h("a", { class: "link", href: `http://${m.ip.includes(":") ? `[${m.ip}]` : m.ip}:${link.public}`, target: "_blank", rel: "noopener noreferrer" }, ports(c)) : ports(c) || "—"),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          up ? small(t("app.stop"), "stop", act(`containers/${c.id}`, "stop")) : small(t("app.start"), "play", act(`containers/${c.id}`, "start")),
          small(t("app.restart"), "refresh", act(`containers/${c.id}`, "restart"), !up),
          small(t("app.logs"), "logs", () => machineLogsDialog(m, c)),
          small(t("app.tab.terminal"), "terminal", () => machineTerminalDialog(m, c), !up),
        ),
      ),
    );
  };
  box.replaceChildren(
    h("div", { class: "stack" }, names.map((name) => {
      const list = groups.get(name);
      const running = list.filter((c) => c.state === "running").length;
      return h(
        "section",
        { class: "card machine-project" },
        h(
          "div",
          { class: "project-head" },
          h("h2", null, name || t("machines.loose"), h("span", { class: "muted" }, t("machines.running", { n: running, total: list.length }))),
          name &&
            h(
              "div",
              { class: "row-actions" },
              running ? button(t("app.stop"), { class: "small", onclick: act(`projects/${encodeURIComponent(name)}`, "stop") }, "stop") : button(t("app.start"), { class: "small", onclick: act(`projects/${encodeURIComponent(name)}`, "start") }, "play"),
              running > 0 && button(t("app.restart"), { class: "small", onclick: act(`projects/${encodeURIComponent(name)}`, "restart") }, "refresh"),
            ),
        ),
        h("div", { class: "table-wrap" }, h("table", { class: "machine-containers" }, h("thead", null, h("tr", null, h("th", null, t("app.col.container")), h("th", null, t("app.col.state")), h("th", null, t("app.col.ports")), h("th"))), h("tbody", null, list.map(row)))),
      );
    })),
  );
}

function machineLogsDialog(m, c) {
  let dialog;
  const log = h("pre", { class: "console page" });
  const abort = new AbortController();
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, `${m.name}: ${c.name}`), closeX(() => dialog)), h("p", { class: "cmd" }, icon("terminal"), `docker logs --follow --tail 200 ${c.name}`), log);
  dialog.addEventListener("close", () => abort.abort());
  void followText(`/api/machines/${m.id}/logs?container=${c.id}`, log, abort.signal);
}

function machineTerminalDialog(m, c) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, `${m.name}: ${c.name}`), closeX(() => dialog)), h("p", { class: "cmd" }, icon("terminal"), `docker exec -it ${c.name} sh`), h("div", { class: "term-holder" }, terminalFrame({ machine: m.id, container: c.id })));
}

// --- The settings form of an app ---------------------------------------------------------------
// The compose file as fields. The server reads the file into rows and puts
// the answers back; a row carries `from` — the entry of the file it shows — so what is not touched stays.

const formRow = (label, control, note) => h("label", { class: "form-row" }, h("span", { class: "form-label" }, label), h("span", { class: "form-control" }, control, note && h("span", { class: "muted small" }, note)));

/** A select that also offers the value the file has when it is not one of the usual ones */
function choice(value, options, label) {
  const all = options.some(([v]) => v === value) ? options : [...options, [value, value]];
  return h("select", { "aria-label": label }, all.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
}

/** A list of the form: rows of inputs, each with a button to take it out, and a button to add one */
function rowList(title, hint, items, cells) {
  const rows = [];
  const box = h("div", { class: "edit-rows" });
  const add = (item, focus) => {
    const row = {};
    const remove = h("button", { type: "button", class: "icon-btn", "aria-label": t("app.remove"), title: t("app.remove"), onclick: () => (rows.splice(rows.indexOf(row), 1), row.el.remove()) }, icon("trash"));
    if (item.raw !== undefined) {
      row.el = h("div", { class: "edit-row" }, h("span", { class: "mono small grow raw", title: t("edit.rawHint") }, item.raw), remove);
      row.value = () => item;
    } else {
      const inputs = cells.map((c) => (c.options ? choice(item[c.key], c.options, c.label) : h("input", { value: item[c.key] ?? "", placeholder: c.label, "aria-label": c.label, class: "mono " + (c.class ?? ""), spellcheck: false, autocapitalize: "none", autocomplete: "off" })));
      // a folder of the server can be chosen instead of typed: the disks are offered there too
      const cellsOf = inputs.map((input, i) =>
        cells[i].pick
          ? h(
              "span",
              { class: "with-pick" },
              input,
              h("button", {
                type: "button",
                class: "icon-btn",
                title: t("edit.pickFolder"),
                "aria-label": t("edit.pickFolder"),
                onclick: () => folderPicker({ title: t("edit.pickFolder"), start: input.value.startsWith("/") ? input.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void (input.value = path) }),
              }, icon("folder")),
            )
          : input,
      );
      row.el = h("div", { class: "edit-row" }, cellsOf, remove);
      row.value = () => ({ ...(item.from === undefined ? {} : { from: item.from }), ...Object.fromEntries(cells.map((c, i) => [c.key, inputs[i].value])) });
      // a row added and left empty was not meant
      row.empty = () => item.from === undefined && inputs.every((input) => input.tagName === "SELECT" || input.value.trim() === "");
      if (focus) setTimeout(() => inputs[0].focus());
    }
    rows.push(row);
    box.append(row.el);
  };
  items.forEach((item) => add(item));
  const blank = Object.fromEntries(cells.map((c) => [c.key, c.options ? c.options[0][0] : ""]));
  return {
    el: h("div", { class: "form-row" }, h("span", { class: "form-label" }, title), h("div", { class: "form-control" }, box, h("div", null, button(t("edit.add"), { class: "small", onclick: () => add(blank, true) }, "plus")), hint && h("span", { class: "muted small" }, hint))),
    value: () => rows.filter((row) => !row.empty?.()).map((row) => row.value()),
  };
}

const CAPABILITIES = "AUDIT_CONTROL AUDIT_WRITE BLOCK_SUSPEND CHOWN DAC_OVERRIDE DAC_READ_SEARCH FOWNER FSETID IPC_LOCK IPC_OWNER KILL LEASE LINUX_IMMUTABLE MAC_ADMIN MAC_OVERRIDE MKNOD NET_ADMIN NET_BIND_SERVICE NET_BROADCAST NET_RAW SETFCAP SETGID SETPCAP SETUID SYSLOG SYS_ADMIN SYS_BOOT SYS_CHROOT SYS_MODULE SYS_NICE SYS_PACCT SYS_PTRACE SYS_RAWIO SYS_RESOURCE SYS_TIME SYS_TTY_CONFIG WAKE_ALARM".split(" ");

function serviceForm(service, memoryTotal) {
  const text = (value, attrs = {}) => h("input", { value, spellcheck: false, autocapitalize: "none", autocomplete: "off", class: "mono", ...attrs });
  const image = text(service.image, { placeholder: "nginx:alpine" });
  const network = choice(service.network, [["", t("edit.networkOwn")], ["bridge", "bridge"], ["host", "host"], ["none", "none"]], t("edit.network"));
  const ports = rowList(t("edit.ports"), "", service.ports, [
    { key: "host", label: t("edit.host") },
    { key: "container", label: t("edit.container") },
    { key: "protocol", label: t("edit.protocol"), options: [["tcp", "TCP"], ["udp", "UDP"], ["both", "TCP + UDP"]] },
  ]);
  const pair = [
    { key: "host", label: t("edit.host") },
    { key: "container", label: t("edit.container") },
  ];
  const volumes = rowList(t("edit.volumes"), t("edit.volumesHint"), service.volumes, [{ ...pair[0], pick: true }, pair[1]]);
  const envs = rowList(t("edit.envs"), "", service.envs, [
    { key: "name", label: t("edit.key") },
    { key: "value", label: t("edit.value") },
  ]);
  const devices = rowList(t("edit.devices"), "", service.devices, pair);
  const command = rowList(t("edit.command"), t("edit.commandHint"), service.command.map((value) => ({ value })), [{ key: "value", label: t("edit.argument") }]);
  const privileged = h("input", { type: "checkbox", checked: service.privileged });

  const max = Math.max(memoryTotal, service.memory);
  const memory = h("input", { type: "number", min: 0, max, step: 1, value: service.memory || "", placeholder: "0", class: "short mono", "aria-label": t("edit.memory") });
  const slider = h("input", { type: "range", min: 0, max, step: 64, value: service.memory, "aria-label": t("edit.memory"), oninput: () => (memory.value = Number(slider.value) || "") });
  memory.addEventListener("input", () => (slider.value = Number(memory.value) || 0));

  const cpu = choice(String(service.cpuShares), [["0", t("edit.notSet")], ["10", t("edit.cpuLow")], ["50", t("edit.cpuMedium")], ["90", t("edit.cpuHigh")]], t("edit.cpuShares"));
  const restart = choice(service.restart, [["", t("edit.notSet")], ["no", "no"], ["on-failure", "on-failure"], ["always", "always"], ["unless-stopped", "unless-stopped"]], t("edit.restart"));
  const caps = text(service.capAdd.join(", "), { placeholder: "NET_ADMIN, SYS_TIME", list: "capabilities" });
  const hostname = text(service.hostname);

  return {
    el: h(
      "div",
      { class: "stack edit-service" },
      formRow(t("edit.image"), image),
      formRow(t("edit.network"), network),
      ports.el,
      volumes.el,
      envs.el,
      devices.el,
      command.el,
      formRow(t("edit.privileged"), h("span", null, privileged), t("edit.privilegedHint")),
      formRow(t("edit.memory"), h("span", { class: "pair" }, slider, memory, h("span", { class: "muted small" }, "MB")), t("edit.memoryHint", { total: bytes(memoryTotal * 1024 * 1024) })),
      formRow(t("edit.cpuShares"), cpu),
      formRow(t("edit.restart"), restart),
      formRow(t("edit.capAdd"), caps, t("edit.capAddHint")),
      formRow(t("edit.hostname"), hostname),
    ),
    value: () => ({
      image: image.value,
      network: network.value,
      ports: ports.value(),
      volumes: volumes.value(),
      envs: envs.value(),
      devices: devices.value(),
      command: command.value().map((row) => row.value),
      privileged: privileged.checked,
      memory: Math.max(0, Math.round(Number(memory.value) || 0)),
      cpuShares: Number(cpu.value),
      restart: restart.value,
      capAdd: caps.value.split(/[\s,]+/).filter(Boolean),
      hostname: hostname.value,
    }),
  };
}

const blankService = (name) => ({ name, image: "", network: "", ports: [], volumes: [], envs: [], devices: [], command: [], privileged: false, memory: 0, cpuShares: 0, restart: "unless-stopped", capAdd: [], hostname: "" });

/** Sends a picture as the app's own icon; returns its address */
async function uploadAppIcon(name, picture) {
  const res = await fetch(`/api/apps/${name}/icon`, { method: "PUT", body: picture, headers: { "content-type": "application/octet-stream" } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "request.failed", data?.error?.detail ?? {});
  return data.icon;
}

/**
 * The icon of the form: an address, or a picture of one's own, which wins. For an installed app (`app`)
 * the picture is saved at once; for an app that is not there yet it waits in `picked` until it is.
 */
function iconField(model, app) {
  const url = h("input", { value: model.icon, type: "url", spellcheck: false, class: "mono", placeholder: "https://…", "aria-label": t("edit.iconUrl"), oninput: () => paint() });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/avif,image/svg+xml", hidden: true });
  const preview = h("span", { class: "icon-preview" });
  const actions = h("span", { class: "pair" });
  const note = h("span", { class: "muted small" });
  const field = { el: null, url, picked: null };
  let own = model.ownIcon ?? "";
  const paint = () => {
    const src = own || url.value.trim() || model.storeIcon || "";
    put(preview, src ? h("img", { src, alt: "", referrerPolicy: "no-referrer", onerror: (e) => e.target.remove() }) : icon("image"));
    put(actions, button(t(own ? "edit.iconReplace" : "edit.iconUpload"), { class: "small", onclick: () => file.click() }, "upload"), own && button(t("edit.iconRemove"), { class: "small ghost", onclick: remove }, "trash"));
    note.textContent = t(own ? "edit.iconOwn" : "edit.iconHint");
    note.classList.remove("error");
  };
  const fail = (e) => {
    note.textContent = errorText(e);
    note.classList.add("error");
  };
  const remove = async () => {
    try {
      if (app) await api("DELETE", `/api/apps/${app}/icon`);
      field.picked = null;
      own = "";
      paint();
      if (app) void loadApp(true);
    } catch (e) {
      fail(e);
    }
  };
  file.addEventListener("change", async () => {
    const picture = file.files[0];
    file.value = "";
    if (!picture) return;
    try {
      if (app) {
        own = await uploadAppIcon(app, picture);
        void loadApp(true);
      } else {
        if (picture.size > 1024 * 1024) throw new ApiError(413, "icon.tooLarge", { max: 1 });
        field.picked = picture;
        // shown from memory until there is an app to keep it
        own = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new ApiError(400, "icon.notImage"));
          reader.readAsDataURL(picture);
        });
      }
      paint();
    } catch (e) {
      fail(e);
    }
  });
  paint();
  field.el = h("div", { class: "form-row" }, h("span", { class: "form-label" }, t("edit.icon")), h("div", { class: "form-control" }, h("div", { class: "icon-field" }, preview, url, actions, file), note));
  return field;
}

function appSettingsForm(model, memoryTotal, app, installed) {
  const title = h("input", { value: model.title, maxLength: 80 });
  const iconField_ = iconField(model, app);
  const iconUrl = iconField_.url;
  const scheme = choice(model.web.scheme, [["http", "http://"], ["https", "https://"]], t("edit.webUi"));
  const host = h("input", { value: model.web.host, spellcheck: false, autocapitalize: "none", class: "mono", placeholder: t("edit.webHostHere"), "aria-label": t("edit.webHost") });
  const port = h("input", { value: model.web.port, inputMode: "numeric", class: "short mono", placeholder: t("edit.port"), "aria-label": t("edit.port") });
  const path = h("input", { value: model.web.path, spellcheck: false, autocapitalize: "none", class: "mono", placeholder: "/", "aria-label": t("edit.webPath") });
  // under Hata's domain and its name on the home network the app has a name of its own, which can be chosen
  const domains = [state.overview?.site?.domain, state.overview?.site?.local].filter(Boolean);
  const usual = (app ?? "").replace(/_/g, "-");
  const domain = h("input", { value: model.web.domain ?? "", spellcheck: false, autocapitalize: "none", class: "mono", maxLength: 63, placeholder: usual || t("edit.webDomainUsual"), "aria-label": t("edit.webDomain") });
  const domainHint = h("span", { class: "muted small" });
  const sayDomain = () => {
    const label = domain.value.trim().toLowerCase() || usual;
    const names = domains.map((name) => `${label || "…"}.${name}`).join(", ");
    domainHint.textContent = t(installed?.hostname || host.value.trim() ? "edit.webDomainElsewhere" : "edit.webDomainHint", { names });
  };
  domain.addEventListener("input", sayDomain);
  host.addEventListener("input", sayDomain);
  sayDomain();
  // the services are tabs: one is added by name, the one shown can be taken out
  const services = model.services.map((service) => ({ name: service.name, form: serviceForm(service, memoryTotal) }));
  let shown = 0;
  const tabs = h("div", { class: "modes" });
  const body = h("div", null, services.map((service) => service.form.el));
  const paint = () => {
    put(
      tabs,
      services.map((service, i) => {
        const label = service.name || t("edit.mainService");
        return h(
          "span",
          { class: "mode tab-mode" + (i === shown ? " active" : "") },
          h("button", { type: "button", class: "mode-name", onclick: () => ((shown = i), paint()) }, label),
          // the last service stays: an app without one is removed as a whole
          services.length > 1 && h("button", { type: "button", class: "mode-x", title: t("edit.removeService"), "aria-label": `${t("edit.removeService")}: ${label}`, onclick: () => confirmRemove(i, label) }, icon("x")),
        );
      }),
      button(t("edit.addService"), { class: "small ghost", onclick: addService }, "plus"),
    );
    services.forEach((service, i) => (service.form.el.hidden = i !== shown));
  };
  const addService = () =>
    nameDialog(t("edit.addService"), "", t("edit.add"), (name) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) || services.some((service) => service.name === name)) throw new ApiError(400, "edit.badService");
      const service = { name, form: serviceForm(blankService(name), memoryTotal) };
      services.push(service);
      body.append(service.form.el);
      shown = services.length - 1;
      paint();
    });
  const confirmRemove = (index, label) => {
    const dialog = openDialog(
      "confirm",
      h("h2", null, t("edit.removeServiceTitle", { name: label })),
      h("p", { class: "muted" }, t("edit.removeServiceLead")),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("app.remove"), { class: "danger", onclick: () => (dialog.close(), removeService(index)) })),
    );
  };
  const removeService = (index) => {
    services.splice(index, 1)[0].form.el.remove();
    shown = Math.min(index < shown ? shown - 1 : shown, services.length - 1);
    paint();
  };
  paint();
  return {
    el: h(
      "div",
      { class: "stack edit-form" },
      h("datalist", { id: "capabilities" }, CAPABILITIES.map((cap) => h("option", { value: cap }))),
      formRow(t("edit.title"), title),
      iconField_.el,
      formRow(t("edit.webUi"), h("span", { class: "web-address" }, scheme, host, h("span", { class: "muted" }, ":"), port, path), t("edit.webUiHint")),
      domains.length > 0 && h("label", { class: "form-row" }, h("span", { class: "form-label" }, t("edit.webDomain")), h("span", { class: "form-control" }, h("span", { class: "web-address" }, domain, h("span", { class: "muted mono" }, "." + domains[0])), domainHint)),
      h("div", { class: "form-row services-row" }, h("span", { class: "form-label" }, t("edit.services")), tabs),
      body,
    ),
    pickedIcon: () => iconField_.picked,
    value: () => ({ title: title.value, icon: iconUrl.value, web: { scheme: scheme.value, host: host.value, port: port.value, path: path.value, domain: domain.value.trim().toLowerCase() === usual ? "" : domain.value.trim() }, services: services.map((service) => ({ name: service.name, ...service.form.value() })) }),
  };
}

async function appSettingsTab(app, box) {
  let model;
  try {
    model = await api("GET", `/api/apps/${app.name}/settings?lang=${state.lang}`);
  } catch (e) {
    return box.replaceChildren(h("p", { class: "error" }, e.code === "app.badCompose" ? t("edit.broken") : errorText(e)));
  }
  const form = appSettingsForm(model, model.memoryTotal, app.name, app);
  // an app of Hata's format: its own settings, kept in .env, come first
  const env = model.settings ? settingFields(model.settings, false) : null;
  const error = h("p", { class: "error", role: "alert" });
  box.replaceChildren(
    h(
      "form",
      {
        class: "card pad stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            const res = await api("PUT", `/api/apps/${app.name}/settings?lang=${state.lang}`, env ? { ...form.value(), env: env.value() } : form.value());
            jobDialog(res.job, "apply", app.title, () => (loadApp(true), state.route.tab === "settings" && appSettingsTab(app, box)));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("p", { class: "muted small" }, t("edit.lead")),
      env && env.rows.length > 0 && h("div", { class: "stack edit-form" }, formSection(t("store.settings"), t("edit.envHint"), env.rows), env.more),
      env && env.rows.length === 0 && env.more,
      form.el,
      error,
      h("footer", { class: "pair" }, h("p", { class: "cmd grow" }, icon("terminal"), `docker compose -p ${app.name} up -d --remove-orphans`), h("button", { class: "btn primary" }, t("app.saveApply"))),
    ),
  );
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

/** Ends a running operation that can be ended before its time */
function stopButton(id) {
  return button(t("job.stopIt"), {
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      try {
        await api("POST", `/api/jobs/${id}/stop`);
      } catch (err) {
        el.disabled = false;
        toast(errorText(err), "error");
      }
    },
  }, "x");
}

/** Follows a running operation without a dialog of its own: every line as it comes, then the job as it ended */
function followJob(id, onLine) {
  return new Promise((resolve) => {
    let next = -1;
    const pending = [];
    const end = async () => {
      jobListeners.delete(listener);
      resolve(await api("GET", `/api/jobs/${id}`).catch((e) => ({ status: "failed", error: errorText(e) })));
    };
    const consume = (event) => {
      if (event.line !== undefined) {
        if (event.n >= next) (onLine(event.line), (next = event.n + 1));
      } else if (event.job.status !== "running") void end();
    };
    const listener = (event) => event.job.id === id && (next < 0 ? pending.push(event) : consume(event));
    jobListeners.add(listener);
    api("GET", `/api/jobs/${id}`).then(
      (job) => {
        job.log.forEach(onLine);
        next = job.lineCount;
        if (job.status !== "running") void end();
        else pending.forEach(consume);
      },
      () => void end(),
    );
  });
}

/** Shows a running operation: its console output and how it ended */
async function jobDialog(id, kind, title, onDone) {
  const log = h("pre", { class: "console" });
  const status = h("p", { class: "job-status running" }, t("job.running"));
  let dialog;
  const close = button(t("job.hide"), { onclick: () => dialog.close() });
  const stop = stopButton(id);
  stop.hidden = true;

  const append = (line) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.append(line + "\n");
    if (stick) log.scrollTop = log.scrollHeight;
  };
  const finish = (job) => {
    status.className = "job-status " + (job.stopped ? "stopped" : job.status);
    status.textContent = job.status === "done" ? t("job.done") : job.stopped ? t("job.stopped") : t("job.failed");
    close.lastChild.textContent = t("common.close");
    stop.hidden = true;
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
    else if (event.job.stoppable && !event.job.stopped) stop.hidden = false;
  };
  const listener = (event) => {
    if (event.job.id !== id) return;
    if (next < 0) pending.push(event);
    else consume(event);
  };
  jobListeners.add(listener);

  dialog = openDialog("wide", h("h2", null, t("job." + kind, { app: title })), log, h("footer", null, status, stop, close));
  dialog.addEventListener("close", () => jobListeners.delete(listener));

  try {
    const job = await api("GET", `/api/jobs/${id}`);
    for (const line of job.log) append(line);
    next = job.lineCount;
    if (job.status !== "running") finish(job);
    else {
      stop.hidden = !job.stoppable || !!job.stopped;
      pending.forEach(consume);
    }
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
    // an app of another machine: its snapshot is taken there and kept here
    const res = await api("POST", app.machine ? `/api/backups/${app.name}/take` : `/api/apps/${app.name}/backup`, {});
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
        button(t("backup.files"), { class: "small", onclick: () => snapshotFilesDialog(app, s) }, "folder"),
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

/** What a snapshot holds: its folders walked like a disk, a file taken out, chosen ones put back */
function snapshotFilesDialog(app, snapshot) {
  const base = `/api/backups/${app.name}/${snapshot.id}`;
  const chosen = new Set();
  const crumbs = h("div", { class: "crumbs wrap small" });
  const list = h("div", { class: "snapshot-files" }, h("p", { class: "muted" }, t("backup.files.reading")));
  const error = h("p", { class: "error", role: "alert" });
  const restore = button(t("backup.files.restore", { n: 0 }), { class: "primary", disabled: true, onclick: () => confirmRestore() }, "undo");
  const count = () => {
    restore.disabled = chosen.size === 0;
    restore.lastChild.textContent = t("backup.files.restore", { n: chosen.size });
  };
  const open = async (path) => {
    error.textContent = "";
    let data;
    try {
      data = await api("GET", `${base}/files?path=${encodeURIComponent(path)}`);
    } catch (e) {
      list.replaceChildren();
      error.textContent = errorText(e);
      return;
    }
    // inside a folder the way back is shown from the snapshot's own folder it lies in
    const root = data.roots.find((r) => path === r || path.startsWith(r + "/"));
    const steps = root ? path.slice(root.length).split("/").filter(Boolean) : [];
    put(crumbs,
      h("button", { type: "button", class: "text-btn", onclick: () => open("") }, t("backup.files.top")),
      root && icon("chevron"),
      root && h("button", { type: "button", class: "text-btn mono", onclick: () => open(root) }, root),
      ...steps.flatMap((step, i) => [icon("chevron"), h("button", { type: "button", class: "text-btn mono", onclick: () => open(root + "/" + steps.slice(0, i + 1).join("/")) }, step)]),
    );
    list.replaceChildren(
      ...(data.entries.length
        ? data.entries.map((entry) => {
            const name = path ? entry.path.slice(entry.path.lastIndexOf("/") + 1) : entry.path;
            const tick = h("input", { type: "checkbox", checked: chosen.has(entry.path), "aria-label": name, onchange: () => ((tick.checked ? chosen.add(entry.path) : chosen.delete(entry.path)), count()) });
            return h(
              "div",
              { class: "snapshot-file" },
              // single files are put back on this server only
              !app.machine && tick,
              icon(entry.dir ? "folder" : "file"),
              entry.dir ? h("button", { type: "button", class: "text-btn grow name" + (path ? "" : " mono"), onclick: () => open(entry.path) }, name) : h("span", { class: "grow name" }, name, entry.link && h("span", { class: "muted small" }, " → " + entry.link)),
              h("span", { class: "muted small" }, entry.dir || entry.link ? "" : bytes(entry.size)),
              h("span", { class: "muted small when" }, dateTime(entry.at)),
              entry.dir || entry.link ? h("span", { class: "icon-btn ghost" }) : h("a", { class: "icon-btn", href: `${base}/file?path=${encodeURIComponent(entry.path)}`, download: name, title: t("files.download"), "aria-label": `${t("files.download")}: ${name}` }, icon("download")),
            );
          })
        : [h("p", { class: "muted" }, t("backup.files.empty"))]),
    );
  };
  const confirmRestore = () => {
    const paths = [...chosen].sort();
    const sure = openDialog(
      "confirm",
      h("h2", null, t("backup.files.sureTitle", { n: paths.length })),
      h("p", { class: "muted" }, t("backup.files.sureLead", { time: dateTime(snapshot.at), title: app.title })),
      h("ul", { class: "paths mono small" }, paths.slice(0, 12).map((path) => h("li", null, path)), paths.length > 12 && h("li", null, "…")),
      h(
        "footer",
        null,
        closeButton(() => sure, t("common.cancel")),
        button(t("backup.restore"), {
          class: "primary",
          onclick: async () => {
            sure.close();
            dialog.close();
            document.querySelector("dialog.snapshots")?.close();
            try {
              const res = await api("POST", `${base}/restore-files`, { paths });
              jobDialog(res.job, "restore", app.title, () => void refresh());
            } catch (e) {
              toast(errorText(e), "error");
            }
          },
        }, "undo"),
      ),
    );
  };
  const dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("backup.files.title", { title: app.title })), h("p", { class: "muted small" }, `${dateTime(snapshot.at)} · ${bytes(snapshot.size)}`)), closeX(() => dialog)), crumbs, list, error, h("footer", null, closeButton(() => dialog), !app.machine && restore));
  void open("");
}

/** Which folders of an app go into its snapshots: those in AppData always, the rest by choice */
async function backupFoldersDialog(app, done) {
  let data;
  try {
    data = await api("GET", `/api/backups/${app.name}/folders`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const error = h("p", { class: "error", role: "alert" });
  const ticks = data.folders.map((folder) => ({ folder, input: h("input", { type: "checkbox", checked: folder.included, disabled: !folder.allowed }) }));
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await api("PUT", `/api/backups/${app.name}/folders`, { folders: ticks.filter((x) => x.input.checked).map((x) => x.folder.path) });
            dialog.close();
            toast(t("settings.saved"));
            done?.();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("backup.folders.title", { title: app.title })), closeX(() => dialog)),
      h("h3", null, t("backup.folders.always")),
      h("p", { class: "muted small" }, t("backup.folders.alwaysHint")),
      data.always.length > 0 && h("ul", { class: "paths mono small" }, data.always.map((path) => h("li", null, path))),
      h("h3", null, t("backup.folders.other")),
      ticks.length
        ? [
            h("p", { class: "muted small" }, t("backup.folders.otherHint")),
            ...ticks.map(({ folder, input }) => h("label", { class: "check" }, input, h("span", null, h("strong", { class: "mono" }, folder.path), h("span", { class: "muted small block" }, folder.allowed ? (folder.size === null ? t("backup.folders.unknown") : bytes(folder.size)) : t("backup.folders.never"))))),
          ]
        : h("p", { class: "muted small" }, t("backup.folders.none")),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), ticks.some((x) => x.folder.allowed) && h("button", { class: "btn primary" }, t("settings.save"))),
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
    h("div", { class: "editor-head" }, h("div", { class: "grow" }, h("p", null, t("backup.appLead")), h("p", { class: "muted small" }, app.folders.join(" · "))), button(t("backup.folders.button"), { onclick: () => backupFoldersDialog(app) }, "folder"), button(t("backup.now"), { class: "primary", disabled: !!app.job, onclick: () => backupNow(app) }, "archive")),
    h("div", { class: "card pad" }, snapshotList(app, snapshots, () => renderAppTab())),
  );
}

function renderBackups() {
  shell(
    ...settingsFrame(
      "backups",
      h("div", { class: "page-head section-page" }, h("div", null, h("h2", null, t("nav.backups")), h("p", { class: "meta", id: "backup-meta" }, " ")), h("div", { class: "actions", id: "backup-actions" })),
      h("section", { class: "stats card", id: "backup-stats" }),
      h("div", { class: "columns" }, h("section", { id: "backup-apps" }), h("aside", { class: "side", id: "backup-side" })),
    ),
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
      h("td", null, h("div", { class: "with-icon" }, appIcon(app, "sm"), h("div", { class: "stack-s backup-name" }, app.installed ? h("a", { class: "strong", href: app.machine ? `#/machines/${app.machine.id}/apps` : `#/apps/${app.name}/backups` }, app.title) : h("span", { class: "strong" }, app.title), app.machine && h("div", { class: "muted small with-icon" }, icon("server"), app.machine.name), !app.installed && h("div", { class: "muted small" }, t("backup.removedApp")), app.otherFolders.length > 0 && h("button", { type: "button", class: "text-btn muted small", title: app.otherFolders.join("\n"), onclick: () => backupFoldersDialog(app, loadBackups) }, t("backup.folders.row", { n: app.otherFolders.length, m: app.extraFolders.length }))))),
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
    offsiteCard(b.offsite),
    h("p", { class: "muted small pad-x" }, t("backup.how")),
  );
  // a run of the copy shows no job: look again until it ends
  clearTimeout(offsiteTimer);
  if (b.offsite.running) offsiteTimer = setTimeout(() => state.route.view === "backups" && loadBackups(), 3000);
}

let offsiteTimer = 0;

/** Connects to the other machine; seen for the first time, its key is shown and has to be confirmed */
async function offsiteCheck(trust) {
  const result = await api("POST", "/api/backups/offsite/check", trust ? { trust } : {});
  if (result.status !== "unknownHost") return result;
  return new Promise((resolve) => {
    let answered = false;
    const dialog = openDialog(
      "confirm",
      h("h2", null, t("offsite.hostTitle")),
      h("p", { class: "muted" }, t("offsite.hostLead")),
      h("p", { class: "cmd whole" }, icon("lock"), `${result.keyType} ${result.fingerprint}`),
      h("p", { class: "muted small" }, t("offsite.hostHint")),
      h("p", { class: "cmd whole" }, icon("terminal"), "for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf $f; done"),
      h(
        "footer",
        null,
        closeButton(() => dialog, t("common.cancel")),
        button(t("offsite.hostTrust"), {
          class: "primary",
          onclick: () => {
            answered = true;
            dialog.close();
            resolve(offsiteCheck(result.fingerprint));
          },
        }),
      ),
    );
    dialog.addEventListener("close", () => answered || resolve({ status: "cancelled" }));
  });
}

function offsiteCard(o) {
  const enabled = h("input", { type: "checkbox", checked: o.enabled });
  // the kind looked at survives the page being drawn anew, until it is saved
  const shown = offsiteCard.kind ?? o.kind;
  // only this card is drawn anew: the column it stands in is left alone while something in it has focus
  const switchKind = () => {
    if (kind.value === shown) return;
    offsiteCard.kind = kind.value;
    const next = offsiteCard(o);
    document.getElementById("offsite-form")?.replaceWith(next);
    next.querySelector("select")?.focus();
  };
  const kind = h("select", { onchange: switchKind }, ["sftp", "s3", "place"].map((id) => h("option", { value: id, selected: id === shown }, t("offsite.kind." + id))));
  const s3 = shown === "s3";
  const inPlace = shown === "place";
  const sftp = !s3 && !inPlace;
  const placeChoice = h(
    "select",
    { required: inPlace },
    o.places.map((p) => h("option", { value: p.id, selected: p.id === o.place.id, disabled: p.readOnly }, `${p.name} · ${t("netplace.kind." + p.kind)}${p.readOnly ? ` · ${t("offsite.placeReadOnly")}` : p.ready ? "" : ` · ${t("offsite.placeAway")}`}`)),
  );
  const placePath = h("input", { value: o.place.path, spellcheck: false, class: "mono", required: inPlace });
  const endpoint = h("input", { value: o.s3.endpoint, placeholder: "https://s3.eu-central-003.backblazeb2.com", spellcheck: false, autocapitalize: "off", class: "mono" });
  const region = h("input", { value: o.s3.region, placeholder: "us-east-1", spellcheck: false, autocapitalize: "off", class: "mono" });
  const bucket = h("input", { value: o.s3.bucket, spellcheck: false, autocapitalize: "off", class: "mono", required: s3 });
  const prefix = h("input", { value: o.s3.prefix, spellcheck: false, class: "mono" });
  const accessKey = h("input", { value: o.s3.accessKey, spellcheck: false, autocapitalize: "off", autocomplete: "off", class: "mono", required: s3 });
  const secret = h("input", { type: "password", autocomplete: "new-password", placeholder: o.s3.secretSet ? t("offsite.secretKept") : "", class: "mono", required: s3 && !o.s3.secretSet });
  const host = h("input", { value: o.host, placeholder: "nas.lan", spellcheck: false, autocapitalize: "off", class: "mono", required: true });
  const port = h("input", { type: "number", min: 1, max: 65535, value: o.port, class: "short mono", required: true });
  const user = h("input", { value: o.user, placeholder: "backup", spellcheck: false, autocapitalize: "off", class: "mono", required: true });
  const path = h("input", { value: o.path, spellcheck: false, class: "mono", required: true });
  const seal = h("input", { type: "checkbox", checked: o.sealed });
  const passphrase = h("input", { type: "password", autocomplete: "new-password", minlength: 8, placeholder: o.sealed ? t("offsite.passphraseKept") : "", class: "mono" });
  const error = h("p", { class: "error", role: "alert" });
  const last = o.last;
  const status = !o.available && sftp
    ? h("p", { class: "error" }, t("offsite.noSftp"))
    : o.running
      ? h("p", { class: "muted small" }, t("offsite.running"))
      : last && o.enabled && shown === o.kind && h("p", { class: last.error ? "error" : "muted small" }, last.error ? t("offsite.failed", { when: ago(last.at), message: last.error }) : t("offsite.inStep", { when: ago(last.at) }));
  const save = async (e) => {
    e.preventDefault();
    error.textContent = "";
    if (seal.checked && !o.sealed && !passphrase.value) return void (error.textContent = t("error.offsite.badPassphrase"));
    const data = s3
      ? { kind: "s3", enabled: enabled.checked, endpoint: endpoint.value.trim(), region: region.value.trim(), bucket: bucket.value.trim(), prefix: prefix.value.trim(), accessKey: accessKey.value.trim(), secret: secret.value }
      : inPlace
        ? { kind: "place", enabled: enabled.checked, place: placeChoice.value, path: placePath.value.trim() }
        : { kind: "sftp", enabled: enabled.checked, host: host.value.trim(), port: Number(port.value), user: user.value.trim(), path: path.value.trim() };
    if (!seal.checked) data.passphrase = "";
    else if (passphrase.value) data.passphrase = passphrase.value;
    try {
      state.backups = await api("PUT", "/api/backups/offsite", data);
      offsiteCard.kind = undefined;
      document.activeElement?.blur();
      const result = await offsiteCheck();
      if (result.status === "ok") {
        toast(t(s3 ? "offsite.connectedS3" : inPlace ? "offsite.connectedPlace" : "offsite.connected"));
        if (enabled.checked) await api("POST", "/api/backups/offsite/sync", {});
      }
      await loadBackups();
      // after the page is drawn anew: the message belongs to the form that is there now
      const said = document.querySelector("#offsite-form .error[role=alert]");
      if (said && result.status === "denied") said.textContent = t("offsite.denied");
      if (said && result.status === "failed") said.textContent = result.message;
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  return h(
    "form",
    { class: "card pad stack", id: "offsite-form", onsubmit: save },
    h("h2", null, t("offsite.title")),
    h("label", { class: "check" }, enabled, h("span", null, h("strong", null, t("offsite.enable")), h("span", { class: "muted small block" }, t("offsite.enableHint")))),
    field(t("offsite.kind"), kind, t("offsite.kindHint." + shown)),
    s3 && [
      field(t("offsite.endpoint"), endpoint, t("offsite.endpointHint")),
      h("div", { class: "field-row" }, field(t("offsite.bucket"), bucket), field(t("offsite.region"), region)),
      field(t("offsite.prefix"), prefix, t("offsite.prefixHint")),
      field(t("offsite.accessKey"), accessKey),
      field(t("offsite.secret"), secret, t("offsite.secretHint")),
    ],
    inPlace &&
      (o.places.length
        ? [field(t("offsite.place"), placeChoice), field(t("offsite.placePath"), placePath, t("offsite.placePathHint"))]
        : h("p", { class: "muted" }, t("offsite.noPlaces"), " ", h("a", { href: "#/settings/storage" }, t("offsite.addPlace")))),
    sftp && h("div", { class: "field-row" }, field(t("offsite.host"), host), field(t("offsite.port"), port)),
    sftp && field(t("offsite.user"), user),
    sftp && field(t("offsite.path"), path, t("offsite.pathHint")),
    sftp &&
      o.publicKey &&
      h(
        "div",
        { class: "field" },
        h("span", { class: "label" }, t("offsite.key")),
        h("p", { class: "cmd" }, h("span", { class: "grow clip" }, o.publicKey), h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(o.publicKey) }, icon("copy"))),
        h("span", { class: "hint" }, t("offsite.keyHint", { user: o.user || "backup" })),
      ),
    h("label", { class: "check" }, seal, h("span", null, h("strong", null, t("offsite.seal")), h("span", { class: "muted small block" }, t("offsite.sealHint")))),
    field(t("offsite.passphrase"), passphrase, t("offsite.passphraseHint")),
    sftp && o.fingerprint && h("p", { class: "muted small" }, t("offsite.hostKnown", { fingerprint: o.fingerprint })),
    status,
    error,
    h("footer", null, h("button", { class: "btn primary", disabled: (!o.available && sftp) || (inPlace && !o.places.length) }, t("offsite.save"))),
  );
}

// --- Files --------------------------------------------------------------------------------------
// The server's files. Paths are the real ones; the page opens in the data root.

const filesUi = {
  mode: localStorage.getItem("hata.files.mode") === "grid" ? "grid" : "list",
  sort: ["name", "modified", "size"].find((key) => key === localStorage.getItem("hata.files.sort")) ?? "name",
  /** Names selected in the folder on screen */
  selected: new Set(),
  /** A search under the folder on screen: what was asked, and what was found — null while it runs */
  find: null,
  /** A name to choose once the folder is listed */
  pick: null,
  /** The entry the keys act on: a name in the folder on screen */
  cursor: null,
  /** The name the cursor goes to once the folder is listed (the folder one came up from) */
  cursorNext: null,
  /** The address being typed: `{ value, caret, select }`, null while the crumbs are shown */
  edit: null,
  /** Where back and forward lead: the browser's own entries, numbered as Files opens them (`filesStep`) */
  trail: null,
};

/** The address of a folder; `machine` — of another machine, by default the one on screen */
const filesHash = (path, machine = filesMachine()) => "#/files" + (machine ? "/@" + machine : "") + (path.split("/").filter(Boolean).map((part) => "/" + encodeURIComponent(part)).join("") || "/");
/** The machine whose files are on screen; "" — this server */
const filesMachine = () => (state.route.view === "files" ? state.route.machine || "" : "");
/** Where the file manager's calls go: this server's files or a machine's */
const filesApi = (sub = "", machine = filesMachine()) => (machine ? `/api/machines/${machine}/files` : "/api/files") + sub;
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
const rawUrl = (path, download = false) => `${filesApi("/raw")}?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

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
/** The colour of a tile with no picture, by what the file is */
const TINT_BY_EXT = Object.fromEntries(
  Object.entries({
    archive: "zip tar gz tgz xz bz2 zst 7z rar iso deb rpm",
    doc: "pdf doc docx odt rtf xls xlsx ods csv ppt pptx odp epub",
    video: FILE_KINDS.video + " avi wmv flv ts",
    audio: FILE_KINDS.audio + " wma",
    image: FILE_KINDS.image + " heic tif tiff raw cr2 nef psd",
    text: FILE_KINDS.text,
  }).flatMap(([tint, list]) => list.split(" ").map((ext) => [ext, tint])),
);
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

const isFavorite = (path) => (state.favorites ?? []).some((one) => one.path === path);

/** Marks a folder or a file as a favourite of the person, or takes the mark off */
async function favorite(path, on, name = path.split("/").pop() || "/") {
  try {
    state.favorites = (await api("POST", "/api/files/favorite", { path, on })).favorites;
    toast(t(on ? "files.favoriteDone" : "files.unfavoriteDone", { name }));
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "files") renderFilesBody();
  else if (state.route.view === "trash") filesPlaces(null);
  else if (state.route.view === "myhata") renderMyHata();
}

/** Puts a folder on the dashboard or takes it off */
async function pinFolder(path, pinned, quiet = true, name = path.split("/").pop() || "/") {
  try {
    const res = await api("POST", "/api/files/pin", { path, pinned });
    if (state.files) state.files.pinned = res.pinned;
    toast(t(pinned ? "files.pinnedDone" : "files.unpinnedDone", { name }));
  } catch (e) {
    // a dialog shows the reason itself
    if (!quiet) throw e;
    return toast(errorText(e), "error");
  }
  await refresh();
  if (state.route.view === "files") renderFilesBody();
}

const onFiles = (path) => state.route.view === "files" && state.route.path === path;
/** The listing on screen, when it is of the folder and machine the address names */
const filesListing = () => (state.files?.path === state.route.path && (state.files.machine ?? "") === filesMachine() ? state.files : null);

async function loadFiles() {
  const path = state.route.path;
  const machine = filesMachine();
  // theirs with whom folders are shared start from those folders
  if (!isAdmin() && !path) return go("#/hata");
  if (!isAdmin() && !state.myMachines) await loadMine();
  // the other machines are places of the sidebar
  if (!machinesUi.list && isAdmin()) machinesUi.list = await api("GET", "/api/machines").catch(() => null);
  let listing;
  try {
    listing = await api("GET", `${filesApi()}?path=${encodeURIComponent(path)}`);
  } catch (e) {
    listing = { path, home: machine ? "/" : (state.files?.home ?? ""), entries: [], places: machine ? [] : (state.files?.places ?? []), pinned: [], shared: [], disk: machine ? null : (state.files?.disk ?? null), error: errorText(e) };
  }
  listing.machine = machine;
  if (!onFiles(path) || filesMachine() !== machine) return;
  if (path !== listing.path) {
    // the page was opened without a folder: the address becomes the data root's
    state.route.path = listing.path;
    history.replaceState(history.state, "", filesHash(listing.path));
  }
  if (state.files?.path !== listing.path || (state.files?.machine ?? "") !== machine) {
    filesUi.cursor = filesUi.cursorNext;
    filesUi.cursorNext = null;
  }
  const names = new Set(listing.entries.map((entry) => entry.name));
  filesUi.selected = new Set(state.files?.path === listing.path ? [...filesUi.selected].filter((name) => names.has(name)) : []);
  if (filesUi.find && filesUi.find.under !== listing.path) filesUi.find = null;
  // a file found by a search is shown chosen in its folder
  if (filesUi.pick && names.has(filesUi.pick)) filesUi.selected = new Set([filesUi.pick]);
  filesUi.pick = null;
  state.files = listing;
  if (listing.favorites) state.favorites = listing.favorites;
  renderFilesBody();
}

function renderFiles() {
  const box = h("div", { class: "files" }, h("aside", { class: "files-side fold", id: "files-places" }), h("section", { class: "stack", id: "files-main" }));
  box.addEventListener("contextmenu", filesContext);
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

/** The places on the left of Files and of the trash; `path` — the folder on screen, null in the trash */
function filesPlaces(path) {
  const places = document.getElementById("files-places");
  if (!places) return;
  const trash = path === null;
  const machine = trash ? "" : filesMachine();
  const listing = trash ? null : state.files;
  const home = machine ? "" : (state.files?.home ?? "");
  const inHome = !trash && path !== "#hata" && home !== "" && within(path, home);
  const inside = (folder) => !trash && path !== "#hata" && within(path, folder);
  const place = (label, to, iconName, active, on = machine) =>
    h(
      "a",
      { class: "cat" + (active ? " active" : ""), href: filesHash(to, on), menu: (at) => sidebarMenu(at, { label, path: to, machine: on, iconName }) },
      h("span", { class: "with-icon" }, icon(iconName), h("span", { class: "clip" }, label)),
    );
  // a favourite file opens its folder with the file chosen
  const favorites = state.favorites ?? [];
  const favoriteRow = (one) => {
    const name = one.path.split("/").pop() || "/";
    if (one.dir) return place(name, one.path, "star", !trash && path === one.path, "");
    const parent = one.path.slice(0, one.path.lastIndexOf("/")) || "/";
    const show = (e) => {
      e.preventDefault();
      filesUi.pick = name;
      if (path === parent && !filesMachine()) loadFiles();
      else go(filesHash(parent));
    };
    return h(
      "a",
      { class: "cat", href: filesHash(parent), title: one.path, onclick: show, menu: (at) => menuAt(at, menuHeader(name, one.path, "file"), [{ label: t("common.open"), icon: "folder", run: () => show(new Event("click")) }, { label: t("files.copyPath"), icon: "copy", run: () => copyText(one.path) }, { label: t("files.unfavorite"), icon: "star", run: () => favorite(one.path, false, name) }]) },
      h("span", { class: "with-icon" }, icon("star"), h("span", { class: "clip" }, name)),
    );
  };
  const others = machinesUi.list?.machines ?? [];
  const machinesList = others.length > 0 && [h("div", { class: "cat-title" }, t("nav.machines")), others.map((m) => h("a", { class: "cat" + (machine === m.id ? " active" : "") + (m.online ? "" : " muted"), href: filesHash("/", m.id), title: m.online ? "" : t("machines.offline"), menu: (at) => menuAt(at, menuHeader(m.name, machineOs(m), "server"), [{ label: t("machines.files"), icon: "folder", href: filesHash("/", m.id) }, { label: t("menu.machinePage"), icon: "server", href: `#/machines/${m.id}` }, isAdmin() && { label: t("app.more"), icon: "more", run: () => machineMenu(m, at) }]) }, h("span", { class: "with-icon" }, icon("server"), h("span", { class: "clip" }, m.name))))];
  const shares = myShares();
  if (shares) {
    return put(
      places,
      h(
        "nav",
        { class: "cats" },
        h("div", { class: "cat-title" }, t("files.places")),
        h("a", { class: "cat" + (path === "#hata" ? " active" : ""), href: "#/hata" }, h("span", { class: "with-icon" }, icon("home"), h("span", { class: "clip" }, t("myhata.title")))),
        h("a", { class: "cat" + (trash ? " active" : ""), href: "#/trash" }, h("span", { class: "with-icon" }, icon("trash"), h("span", { class: "clip" }, t("trash.title")))),
        (state.myShares ?? []).length > 0 && [h("div", { class: "cat-title" }, t("myhata.shared")), state.myShares.map((share) => place(share.name, share.path, "share", !machine && inside(share.path), ""))],
        (state.myMachines ?? []).map((m) => [h("div", { class: "cat-title" }, m.name), m.shares.map((share) => place(share.name, share.path, "share", machine === m.id && inside(share.path), m.id))]),
        favorites.length > 0 && [h("div", { class: "cat-title" }, t("files.favorites")), favorites.map(favoriteRow)],
      ),
    );
  }
  if (machine) {
    const m = others.find((x) => x.id === machine);
    const volumes = listing?.disks ?? [];
    return put(
      places,
      h(
        "nav",
        { class: "cats" },
        h("div", { class: "cat-title" }, t("files.places")),
        h("a", { class: "cat", href: "#/hata" }, h("span", { class: "with-icon" }, icon("home"), h("span", { class: "clip" }, t("myhata.title")))),
        h("a", { class: "cat", href: "#/files" }, h("span", { class: "with-icon" }, icon("folder"), h("span", { class: "clip" }, t("files.home")))),
        machinesList,
        volumes.length > 0 && h("div", { class: "cat-title" }, m?.name ?? t("files.disks")),
        volumes.length > 0 && place(t("files.root"), "/", "disk", !volumes.some((d) => within(path, d.path))),
        volumes.map((d) => place(volumeName(d), d.path, d.network ? "globe" : "disk", inside(d.path), machine)),
      ),
    );
  }
  // the disks are tiles of their own under the places, as on the top of the data folder
  put(
    places,
    h(
      "nav",
      { class: "cats" },
      h("div", { class: "cat-title" }, t("files.places")),
      h("a", { class: "cat" + (path === "#hata" ? " active" : ""), href: "#/hata" }, h("span", { class: "with-icon" }, icon("home"), h("span", { class: "clip" }, t("myhata.title")))),
      home && place(t("files.home"), home, "folder", inHome),
      place(t("files.root"), "/", "disk", !trash && path !== "#hata" && path !== "" && !inHome),
      h("a", { class: "cat" + (trash ? " active" : ""), href: "#/trash" }, h("span", { class: "with-icon" }, icon("trash"), h("span", { class: "clip" }, t("trash.title")))),
      favorites.length > 0 && [h("div", { class: "cat-title" }, t("files.favorites")), favorites.map(favoriteRow)],
      machinesList,
    ),
  );
}

function renderFilesBody() {
  const main = document.getElementById("files-main");
  if (!main) return;
  const path = state.route.path;
  const listing = filesListing();
  const parts = path.split("/").filter(Boolean);
  const machine = filesMachine();
  const machineName = machine && (machinesUi.list?.machines.find((m) => m.id === machine)?.name ?? machine);

  filesPlaces(path);
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
  const isShared = (listing?.shared ?? []).includes(listing?.path);
  const trail = filesUi.trail;
  const navButton = (label, iconName, off, run, cls = "") => h("button", { type: "button", class: "btn square", title: label, "aria-label": label, disabled: off, onclick: run }, icon(iconName, cls));
  const head = h(
    "div",
    { class: "page-head files-head" },
    h(
      "div",
      { class: "files-bar" },
      h(
        "div",
        { class: "files-nav" },
        navButton(t("files.back"), "arrow", !(trail && trail.at > trail.first), () => history.back(), "flip"),
        navButton(t("files.forward"), "arrow", !(trail && trail.at < trail.last), () => history.forward()),
        navButton(t("files.up"), "up", !!filesMachine() && path === "/", goUp),
      ),
      filesUi.edit ? addressEditor() : filesAddress(path),
    ),
    h(
      "div",
      { class: "files-tools" },
      listing && !listing.error && !machine && findBox(path),
      h("span", { class: "grow" }),
      listing && !listing.error && !machine && h("button", { type: "button", class: "btn square" + (isFavorite(path) ? " active" : ""), title: t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), "aria-label": t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), "aria-pressed": String(isFavorite(path)), onclick: () => favorite(path, !isFavorite(path)) }, icon("star")),
      listing && !listing.error && !machine && isAdmin() && h("button", { type: "button", class: "btn square" + (isPinned ? " active" : ""), title: t(isPinned ? "files.unpin" : "files.pin"), "aria-label": t(isPinned ? "files.unpin" : "files.pin"), "aria-pressed": String(isPinned), onclick: () => pinFolder(path, !isPinned) }, icon("home")),
      listing && !listing.error && !machine && isAdmin() && h("button", { type: "button", class: "btn square" + (isShared ? " active" : ""), title: t(isShared ? "files.shareSettings" : "files.share"), "aria-label": t(isShared ? "files.shareSettings" : "files.share"), onclick: () => shareDialog(path) }, icon("share")),
      sort,
      h("div", { class: "seg" }, modeButton("list", "list"), modeButton("grid", "grid")),
      button(t("files.new"), { disabled: !listing || !!listing.error || listing.readOnly, onclick: (e) => newMenu(path, e.currentTarget) }, "plus"),
      button(t("files.upload"), { class: "primary", disabled: !listing || !!listing.error || listing.readOnly, onclick: () => picker.click() }, "upload"),
      picker,
    ),
  );
  // what the folder holds, and the room of its disk: under the list, where the files end
  const status =
    listing &&
    !listing.error &&
    h(
      "div",
      { class: "files-status" },
      h("span", null, listing.readOnly && h("span", { class: "chip warn" }, t("files.readOnly")), t("files.count", { dirs: dirs.length, files: rest.length }), rest.length > 0 && h("span", { class: "dot-sep" }, "·"), rest.length > 0 && bytes(rest.reduce((n, entry) => n + entry.size, 0))),
      listing.disk && h("span", null, t("files.free", { free: bytes(listing.disk.free), total: bytes(listing.disk.total) })),
    );

  const selection = h("div", { class: "card selection", id: "files-selection", hidden: true });
  let body;
  if (!listing) body = h("p", { class: "muted" }, " ");
  else if (listing.error) body = h("p", { class: "card pad error" }, listing.error);
  else if (!entries.length)
    body = h(
      "div",
      { class: "card empty-folder" + (listing.readOnly ? " read-only" : "") },
      icon("folder"),
      h("div", { class: "grow" }, h("p", { class: "strong" }, t("files.empty")), !listing.readOnly && h("p", { class: "muted small" }, t("files.dropHint"))),
      !listing.readOnly && h("div", { class: "row-actions" }, button(t("files.uploadFiles"), { class: "primary", onclick: () => picker.click() }, "upload"), button(t("files.newFolder"), { onclick: () => newFolderDialog(path, loadFiles) }, "plus")),
    );
  else body = filesUi.mode === "grid" ? filesGrid(dirs, rest) : filesTable(entries);
  const finding = filesUi.find && filesUi.find.under === path;
  if (finding) body = foundList(filesUi.find);
  // in a list the line closes its card; under tiles or an empty folder it is a card of its own
  const inCard = !finding && status && body.classList.contains("table-wrap");
  if (inCard) body.append(status);

  put(main, head, selection, body, listing?.truncated && h("p", { class: "muted small" }, t("files.truncated")), !finding && !inCard && status && h("div", { class: "card" }, status), uploadBox);
  renderSelection();
  if (filesUi.edit) {
    const input = main.querySelector(".address-input");
    input.focus();
    if (filesUi.edit.select) input.select();
    else input.setSelectionRange(filesUi.edit.caret ?? input.value.length, filesUi.edit.caret ?? input.value.length);
    filesUi.edit.select = false;
  } else fitCrumbs();
}

// --- The address: back, forward, up, the path as crumbs, or typed ------------------------------------

/** Numbers the browser's entry Files is on, so that back and forward know whether there is somewhere to go */
function stepTrail() {
  const step = history.state?.filesStep;
  const trail = filesUi.trail;
  if (typeof step !== "number") {
    // a folder opened anew: what lay ahead of the current one is gone, as in the browser
    const next = trail ? trail.at + 1 : 1;
    history.replaceState({ ...(history.state ?? {}), filesStep: next }, "");
    filesUi.trail = { first: trail?.first ?? next, at: next, last: next };
  } else if (!trail) filesUi.trail = { first: step, at: step, last: step };
  else Object.assign(trail, { at: step, first: Math.min(trail.first, step), last: Math.max(trail.last, step) });
}

/** One level up; the folder left is the one the keys stand on there */
function goUp() {
  const path = state.route.path;
  // above the data folder and the whole server is My Hata, where every place is
  if ((!filesMachine() && (!path || path === "/" || path === state.files?.home)) || myShares()?.some((share) => share.path === path)) return go("#/hata");
  if (!path || path === "/") return;
  filesUi.cursorNext = path.split("/").pop();
  go(filesHash(path.slice(0, path.lastIndexOf("/")) || "/"));
}

/** Where a path lies, for its first crumb: the data folder, a disk or a network place by name, else the root */
function pathAnchor(path) {
  const machine = filesMachine();
  const files = state.files;
  const named = [
    ...(myShares() ?? []).map((share) => ({ path: share.path, label: share.name, icon: "share" })),
    !machine && files?.home && { path: files.home, label: t("files.home"), icon: "folder" },
    ...((files?.machine ?? "") === machine ? (files?.disks ?? []) : []).map((d) => ({ path: d.path, label: volumeName(d), icon: d.network ? "globe" : "disk" })),
  ].filter((place) => place && within(path, place.path));
  const root = machine ? { path: "/", label: machinesUi.list?.machines.find((m) => m.id === machine)?.name ?? machine, icon: "server" } : { path: "/", label: t("files.root"), icon: "disk" };
  return named.sort((a, b) => b.path.length - a.path.length)[0] ?? root;
}

/** The path as crumbs: each opens its folder, the arrow after it the folders inside; a click beside them types a path */
function filesAddress(path) {
  const anchor = pathAnchor(path);
  const parts = path.slice(anchor.path === "/" ? 1 : anchor.path.length + 1).split("/").filter(Boolean);
  const steps = [anchor, ...parts.map((name, i) => ({ label: name, path: (anchor.path === "/" ? "" : anchor.path) + "/" + parts.slice(0, i + 1).join("/") }))];
  const crumbs = h(
    "h1",
    { class: "crumbs" },
    steps.map((step, i) => [
      h("a", { class: "crumb" + (i === steps.length - 1 ? " here" : ""), href: filesHash(step.path), "data-step": String(i) }, step.icon && icon(step.icon), h("span", { class: "clip" }, step.label)),
      h("button", { type: "button", class: "sep", "data-step": String(i), title: t("files.inside", { name: step.label }), "aria-label": t("files.inside", { name: step.label }), onclick: (e) => folderList(e.currentTarget, step.path, steps[i + 1]?.label) }, icon("chevron")),
    ]),
  );
  crumbs.steps = steps;
  const address = h(
    "div",
    { class: "address", onclick: (e) => (e.target === address || e.target === crumbs) && editAddress() },
    crumbs,
    h(
      "span",
      { class: "address-tail" },
      h("button", { type: "button", class: "icon-btn", title: t("files.copyPath"), "aria-label": t("files.copyPath"), onclick: () => copyText(path) }, icon("copy")),
      h("button", { type: "button", class: "icon-btn", title: t("files.typePath"), "aria-label": t("files.typePath"), onclick: () => editAddress() }, icon("edit")),
    ),
  );
  return address;
}

/** A long path keeps its last crumbs; the ones before fold into "…", which lists them */
function fitCrumbs() {
  const crumbs = document.querySelector("#files-main .crumbs");
  if (!crumbs?.steps) return;
  const steps = crumbs.steps;
  const hidden = [];
  for (let i = 0; i < steps.length - 1 && crumbs.scrollWidth > crumbs.clientWidth; i++) {
    for (const el of crumbs.querySelectorAll(`[data-step="${i}"]`)) el.hidden = true;
    hidden.push(steps[i]);
  }
  if (!hidden.length) return;
  const more = h("button", { type: "button", class: "crumb", title: t("files.earlier"), "aria-label": t("files.earlier"), onclick: (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    menuAt({ x: box.left, y: box.bottom + 6 }, null, hidden.map((step) => ({ label: step.label, icon: step.icon ?? "folder", href: filesHash(step.path) })));
  } }, "…");
  crumbs.prepend(more, h("span", { class: "sep still" }, icon("chevron")));
}

/** The folders inside one of the path: the arrow after a crumb */
async function folderList(anchor, path, here) {
  const box = anchor.getBoundingClientRect();
  let listing = state.files?.path === path && (state.files.machine ?? "") === filesMachine() ? state.files : null;
  try {
    listing ??= await api("GET", `${filesApi()}?path=${encodeURIComponent(path)}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const collator = new Intl.Collator(state.lang, { numeric: true, sensitivity: "base" });
  const dirs = listing.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name).sort(collator.compare);
  menuAt(
    { x: box.left - 8, y: box.bottom + 6 },
    null,
    dirs.length ? dirs.map((name) => ({ label: name, icon: "folder", href: filesHash(joinPath(path, name)), on: name === here })) : [{ label: t("files.noFolders"), icon: "folder", off: true, run: () => {} }],
  );
}

/** Turns the crumbs into a field with the path; `text` — what to start with instead of the folder's path */
function editAddress(text) {
  filesUi.edit = text === undefined ? { value: state.route.path, select: true } : { value: text, caret: text.length };
  renderFilesBody();
}

/** "a/../b/./c" as the folder it means; relative to the folder on screen, "~" — the data folder */
function resolvePath(raw) {
  let text = raw.trim();
  if (text === "~" || text.startsWith("~/")) text = (filesMachine() ? "/" : state.files?.home || "/") + text.slice(1);
  if (!text.startsWith("/")) text = joinPath(state.route.path || "/", text);
  const out = [];
  for (const part of text.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/** The path typed: folders offered as in a terminal, Enter goes there, Esc leaves it */
function addressEditor() {
  const edit = filesUi.edit;
  const input = h("input", { class: "address-input mono", value: edit.value, spellcheck: false, autocomplete: "off", autocapitalize: "off", "aria-label": t("files.typePath") });
  const pop = h("div", { class: "address-pop", hidden: true });
  const listings = new Map();
  const listOf = (dir) => {
    if (!listings.has(dir)) listings.set(dir, api("GET", `${filesApi()}?path=${encodeURIComponent(dir)}`).catch((e) => ({ error: errorText(e), entries: [] })));
    return listings.get(dir);
  };
  const collator = new Intl.Collator(state.lang, { numeric: true, sensitivity: "base" });
  const kbd = (key, what) => [h("kbd", null, key), " ", what];
  let hits = [];
  let at = -1;
  let asked = 0;
  let leaving = false;
  const paint = (message = "") => {
    put(
      pop,
      message && h("p", { class: "address-error" }, message),
      hits.map((path, i) => h("button", { type: "button", class: "address-hit" + (i === at ? " on" : ""), onpointerdown: (e) => e.preventDefault(), onclick: () => travel(path) }, icon("folder"), h("span", { class: "clip" }, path))),
      h("p", { class: "address-keys" }, kbd("↑↓", t("files.keys.choose")), " · ", kbd("Tab", t("files.keys.complete")), " · ", kbd("Enter", t("files.keys.go")), " · ", kbd("Esc", t("files.keys.cancel"))),
    );
    pop.hidden = false;
  };
  const suggest = async () => {
    edit.value = input.value;
    edit.caret = input.selectionStart;
    const cut = input.value.lastIndexOf("/");
    if (cut < 0) return void ((hits = []), (at = -1), paint());
    const dir = resolvePath(input.value.slice(0, cut + 1) || "/");
    const typed = input.value.slice(cut + 1).toLowerCase();
    const mine = ++asked;
    const listing = await listOf(dir);
    if (mine !== asked) return;
    const names = listing.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name).sort(collator.compare);
    const starting = names.filter((name) => name.toLowerCase().startsWith(typed));
    hits = [...starting, ...names.filter((name) => !starting.includes(name) && name.toLowerCase().includes(typed))].slice(0, 12).map((name) => joinPath(dir, name));
    at = typed && hits.length ? 0 : -1;
    paint(listing.error);
  };
  const close = () => {
    filesUi.edit = null;
    renderFilesBody();
  };
  const travel = async (raw) => {
    const path = resolvePath(raw);
    leaving = true;
    try {
      await api("GET", `${filesApi()}?path=${encodeURIComponent(path)}`);
      filesUi.edit = null;
      return go(filesHash(path));
    } catch (e) {
      // a file: its folder opens with it chosen
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      const name = path.split("/").pop();
      const there = await listOf(parent);
      if (!there.error && there.entries.some((entry) => entry.name === name && entry.type !== "dir")) {
        filesUi.edit = null;
        filesUi.pick = name;
        filesUi.cursorNext = name;
        return go(filesHash(parent));
      }
      leaving = false;
      hits = [];
      at = -1;
      paint(e instanceof ApiError && e.code === "files.notFound" ? t("files.noSuchFolder", { path }) : errorText(e));
      input.focus();
    }
  };
  input.addEventListener("input", () => void suggest());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      return paint();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (!hits.length) return;
      input.value = hits[Math.max(at, 0)] + "/";
      return void suggest();
    }
    // the field's keys are its own: the list under it must not hear them too
    if (e.key === "Enter") return (e.preventDefault(), e.stopPropagation(), void travel(at >= 0 ? hits[at] : input.value));
    if (e.key === "Escape") return (e.preventDefault(), e.stopPropagation(), close());
  });
  // a click elsewhere puts the crumbs back
  input.addEventListener("blur", () => setTimeout(() => !leaving && filesUi.edit === edit && document.activeElement !== input && close(), 0));
  input.addEventListener("focus", () => pop.hidden && paint());
  return h("div", { class: "address editing" }, input, pop);
}

/** The keys of Files: the cursor moves with the arrows, Enter opens, Space chooses; the path by Ctrl+L or "/" */
const typedName = { text: "", at: 0 };
function filesKeys(e) {
  if (state.route.view !== "files" || document.querySelector("dialog[open]")) return;
  const active = document.activeElement;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName ?? "") || active?.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && e.key.toLowerCase() === "l") return (e.preventDefault(), editAddress());
  if (typing) return;
  if (e.key === "/" && !mod && !e.altKey) return (e.preventDefault(), editAddress("/"));
  if ((e.altKey && e.key === "ArrowUp") || (e.key === "Backspace" && !mod && !e.altKey)) return (e.preventDefault(), goUp());
  if (e.altKey || filesUi.find || !filesListing() || filesListing().error) return;
  const els = [...document.querySelectorAll("#files-main [data-name]")];
  const entryOf = (name) => state.files.entries.find((entry) => entry.name === name);
  const current = els.findIndex((el) => el.dataset.name === filesUi.cursor);
  const cursorEntry = current >= 0 ? entryOf(filesUi.cursor) : null;
  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    filesUi.selected = new Set(state.files.entries.map((entry) => entry.name));
    return renderFilesBody();
  }
  if (mod) return;
  const moves = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
  if (e.key in moves && els.length) {
    e.preventDefault();
    let next;
    if (current < 0) next = e.key === "End" ? els.length - 1 : 0;
    else if (e.key === "Home" || e.key === "End") next = e.key === "Home" ? 0 : els.length - 1;
    else if (filesUi.mode === "grid" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // in tiles up and down go to the nearest tile of the row above or below
      const from = els[current].getBoundingClientRect();
      const down = e.key === "ArrowDown";
      const rows = els.map((el, i) => ({ i, box: el.getBoundingClientRect() })).filter(({ box }) => (down ? box.top > from.top + 4 : box.top < from.top - 4));
      if (!rows.length) return;
      const rowTop = down ? Math.min(...rows.map(({ box }) => box.top)) : Math.max(...rows.map(({ box }) => box.top));
      next = rows.filter(({ box }) => Math.abs(box.top - rowTop) < 4).sort((a, b) => Math.abs(a.box.left - from.left) - Math.abs(b.box.left - from.left))[0].i;
    } else if (filesUi.mode !== "grid" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    else next = Math.min(els.length - 1, Math.max(0, current + moves[e.key]));
    return setCursor(els[next].dataset.name);
  }
  if (e.key === "Enter" && cursorEntry) {
    e.preventDefault();
    return cursorEntry.type === "dir" ? go(filesHash(joinPath(state.files.path, cursorEntry.name))) : openEntry(cursorEntry);
  }
  if (e.key === " " && cursorEntry) return (e.preventDefault(), toggleSelected(cursorEntry, !filesUi.selected.has(cursorEntry.name)));
  if (e.key === "Delete") {
    const chosen = selectedEntries();
    if (chosen.length || cursorEntry) (e.preventDefault(), deleteDialog(chosen.length ? chosen : [cursorEntry]));
    return;
  }
  if (e.key === "F2" && cursorEntry) return (e.preventDefault(), renameDialog(cursorEntry));
  if (e.key === "Escape") {
    filesUi.selected = new Set();
    filesUi.cursor = null;
    return renderFilesBody();
  }
  // letters typed one after another find the name that starts with them
  if (e.key.length === 1 && e.key !== " ") {
    const now = Date.now();
    typedName.text = (now - typedName.at < 900 ? typedName.text : "") + e.key.toLowerCase();
    typedName.at = now;
    const found = els.find((el) => el.dataset.name.toLowerCase().startsWith(typedName.text));
    if (found) setCursor(found.dataset.name);
  }
}
document.addEventListener("keydown", filesKeys);

function setCursor(name) {
  filesUi.cursor = name;
  for (const el of document.querySelectorAll("#files-main [data-name]")) {
    const on = el.dataset.name === name;
    el.classList.toggle("cursor", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  }
}

/** How full a disk is: a thin bar and "free X of Y" — on a narrow tile only "X free", the rest on hover */
function diskRoom(volume, short = false) {
  const used = Math.round(((volume.total - volume.free) / volume.total) * 100);
  const fill = h("i", { class: level(used) });
  fill.style.width = used + "%";
  const whole = t("files.free", { free: bytes(volume.free), total: bytes(volume.total) });
  return h("span", { class: "tile-room", title: short ? whole : "" }, h("span", { class: "bar" }, fill), h("span", { class: "muted small clip" }, short ? t("home.diskFree", { free: bytes(volume.free) }) : whole));
}

/** What a disk is called: its label, or the folder it is mounted at */
const volumeName = (volume) => volume.label || volume.path.split("/").pop() || volume.path;
/** The disks that are not inside the data folder already, where people look for them */
const outerVolumes = (listing) => (listing?.disks ?? []).filter((d) => !(d.path + "/").startsWith((listing.home || "\0") + "/"));

/**
 * My Hata: everything Files can open, in one page — this server's places, its disks, the network
 * places, the favourites and the machines — like "This PC" of a desktop
 */
async function loadMyHata() {
  if (!isAdmin()) {
    await loadMine();
    if (state.route.view === "myhata") renderMyHata();
    return;
  }
  const [data, root] = await Promise.all([api("GET", "/api/files?path=").catch(() => null), api("GET", "/api/files?path=" + encodeURIComponent("/")).catch(() => null)]);
  if (data) {
    state.files = data;
    if (data.favorites) state.favorites = data.favorites;
  }
  myHataUi.root = root?.disk ?? null;
  if (!machinesUi.list) await loadMachines().catch(() => {});
  if (state.route.view === "myhata") renderMyHata();
}

const myHataUi = { root: null };

/** A tile of My Hata: what it is, where, and how full when it is a file system */
function hataTile({ href, onclick, iconName, title, sub, room, menu, cls = "", words = false }) {
  let bar = null;
  if (room?.total) {
    const used = Math.round(((room.total - room.free) / room.total) * 100);
    const fill = h("i", { class: level(used) });
    fill.style.width = used + "%";
    bar = [h("span", { class: "bar" }, fill), h("span", { class: "muted small" }, t("files.free", { free: bytes(room.free), total: bytes(room.total) }))];
  }
  return h(
    "a",
    { class: "disk-tile " + cls, href: href ?? "#", onclick, menu },
    h("span", { class: "badge-icon plain" }, icon(iconName)),
    h("span", { class: "disk-text" }, h("span", { class: "clip strong" }, title), sub && h("span", { class: "muted small clip" + (words ? "" : " mono") }, sub), bar),
  );
}

function renderMyHata() {
  if (!isAdmin()) return renderMySharedFolders();
  const listing = state.files;
  const home = listing?.home ?? "";
  const disks = listing?.disks ?? [];
  const volumeTile = (volume) => hataTile({ href: filesHash(volume.path, ""), iconName: volume.network ? "globe" : "disk", title: volumeName(volume), sub: volume.path, room: volume, menu: (at) => sidebarMenu(at, { label: volumeName(volume), path: volume.path, volume, iconName: volume.network ? "globe" : "disk" }) });
  const favoriteTile = (one) => {
    const name = one.path.split("/").pop() || "/";
    const parent = one.path.slice(0, one.path.lastIndexOf("/")) || "/";
    return hataTile({ href: filesHash(one.dir ? one.path : parent, ""), onclick: one.dir ? null : () => (filesUi.pick = name), iconName: one.dir ? "folder" : "file", title: name, sub: one.path, menu: (at) => menuAt(at, menuHeader(name, one.path, one.dir ? "folder" : "file"), [{ label: t("files.copyPath"), icon: "copy", run: () => copyText(one.path) }, { label: t("files.unfavorite"), icon: "star", run: () => favorite(one.path, false, name) }]) });
  };
  const machineTile = (m) => hataTile({ href: m.online ? filesHash("/", m.id) : `#/machines/${m.id}`, iconName: "server", title: m.name, sub: m.online ? machineOs(m) : t("machines.offline"), cls: m.online ? "" : "away" });
  const section = (title, tiles, extra) => h("section", { class: "card pad stack my-hata" }, h("div", { class: "section-head" }, h("h2", null, title), extra), h("div", { class: "disk-strip hata-grid" }, tiles));
  const local = disks.filter((d) => !d.network);
  const network = disks.filter((d) => d.network);
  const machines = machinesUi.list?.machines ?? [];
  const favorites = state.favorites ?? [];
  shell(
    h(
      "div",
      { class: "files" },
      h("aside", { class: "files-side fold", id: "files-places" }),
      h(
        "section",
        { class: "stack", id: "files-main" },
        h("div", { class: "page-head card pad" }, h("div", null, h("h1", null, t("myhata.title")), h("p", { class: "muted" }, t("myhata.lead")))),
        !listing
          ? h("p", { class: "card pad muted" }, "…")
          : [
              section(t("myhata.server"), [
                home && hataTile({ href: filesHash(home, ""), iconName: "folder", title: t("files.home"), sub: home, room: listing.disk }),
                hataTile({ href: filesHash("/", ""), iconName: "disk", title: t("files.root"), sub: "/", room: myHataUi.root }),
                hataTile({ href: "#/trash", iconName: "trash", title: t("trash.title"), sub: t("myhata.trash") }),
              ]),
              section(t("files.disks"), local.length ? local.map(volumeTile) : h("p", { class: "muted small" }, t("myhata.noDisks")), h("a", { class: "link small", href: "#/settings/storage" }, t("myhata.storage"))),
              section(t("myhata.network"), [
                ...network.map(volumeTile),
                hataTile({ onclick: (e) => (e.preventDefault(), findPlacesDialog()), iconName: "search", title: t("myhata.browse"), sub: t("myhata.browseLead"), cls: "add" }),
                hataTile({ onclick: addPlaceHere, iconName: "plus", title: t("netplace.sidebar"), sub: t("myhata.addPlace"), cls: "add" }),
              ]),
              favorites.length > 0 && section(t("files.favorites"), favorites.map(favoriteTile)),
              section(t("nav.machines"), machines.length ? machines.map(machineTile) : hataTile({ href: "#/machines", iconName: "plus", title: t("myhata.addMachine"), sub: t("myhata.addMachineLead"), cls: "add" }), machines.length > 0 && h("a", { class: "link small", href: "#/machines" }, t("myhata.allMachines"))),
            ],
      ),
    ),
  );
  filesPlaces("#hata");
}

/** My Hata of one who is not an administrator: the folders shared with them, and their favourites */
function renderMySharedFolders() {
  const shares = state.myShares;
  const favorites = state.favorites ?? [];
  const section = (title, tiles) => h("section", { class: "card pad stack my-hata" }, h("div", { class: "section-head" }, h("h2", null, title)), h("div", { class: "disk-strip hata-grid" }, tiles));
  // a machine that is away keeps its tiles, greyed: its folders open once it is back
  const shareTile = (share, m) => hataTile({ href: filesHash(share.path, m ? m.id : ""), iconName: "share", title: share.name, sub: m && !m.online ? t("machines.offline") : t(share.access === "write" ? "myhata.mayWrite" : "myhata.mayRead"), words: true, cls: m && !m.online ? "away" : "", menu: (at) => sidebarMenu(at, { label: share.name, path: share.path, machine: m ? m.id : "", iconName: "share" }) });
  const favoriteTile = (one) => {
    const name = one.path.split("/").pop() || "/";
    const parent = one.path.slice(0, one.path.lastIndexOf("/")) || "/";
    return hataTile({ href: filesHash(one.dir ? one.path : parent, ""), onclick: one.dir ? null : () => (filesUi.pick = name), iconName: one.dir ? "folder" : "file", title: name, sub: one.path, menu: (at) => menuAt(at, menuHeader(name, one.path, one.dir ? "folder" : "file"), [{ label: t("files.unfavorite"), icon: "star", run: () => favorite(one.path, false, name) }]) });
  };
  shell(
    h(
      "div",
      { class: "files" },
      h("aside", { class: "files-side fold", id: "files-places" }),
      h(
        "section",
        { class: "stack", id: "files-main" },
        h("div", { class: "page-head card pad" }, h("div", null, h("h1", null, t("myhata.title")), h("p", { class: "muted" }, t("myhata.sharedLead")))),
        !shares
          ? h("p", { class: "card pad muted" }, "…")
          : [
              (shares.length > 0 || !(state.myMachines ?? []).length) && section(t("myhata.shared"), shares.length ? shares.map((share) => shareTile(share, "")) : h("p", { class: "muted small" }, t("myhata.nothingShared"))),
              (state.myMachines ?? []).map((m) => section(t("myhata.onMachine", { name: m.name }), m.shares.map((share) => shareTile(share, m)))),
              favorites.length > 0 && section(t("files.favorites"), favorites.map(favoriteTile)),
            ],
      ),
    ),
  );
  filesPlaces("#hata");
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
    !state.files.readOnly && button(t("files.move"), { class: "small", onclick: () => transferDialog(chosen, false) }, "arrow"),
    button(t("files.copy"), { class: "small", onclick: () => transferDialog(chosen, true) }, "copy"),
    !state.files.readOnly && button(t("files.delete"), { class: "small", onclick: () => deleteDialog(chosen) }, "trash"),
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

/** Small signs after a name: a favourite, a folder on the dashboard, a folder shared over the network */
const entryMarks = (entry) => {
  const path = joinPath(state.files.path, entry.name);
  const mark = (iconName, title) => h("span", { class: "shared-mark", title }, icon(iconName));
  const here = !filesMachine();
  return [
    here && entry.type !== "other" && isFavorite(path) && mark("star", t("files.favoriteMark")),
    here && entry.type === "dir" && (state.files.pinned ?? []).includes(path) && mark("home", t("files.pinnedMark")),
    entry.type === "dir" && (state.files.shared ?? []).includes(path) && mark("share", t("files.sharedMark")),
  ];
};

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
      { class: (filesUi.selected.has(entry.name) ? "selected" : "") + (filesUi.cursor === entry.name ? " cursor" : ""), "data-name": entry.name },
      h("td", { class: "tick" }, entryCheckbox(entry)),
      h("td", { class: "name" }, entryOpener(entry, "file-name", fileIcon(entry), h("span", { class: "clip" }, entry.name), entry.link && icon("link", "faint"), entryMarks(entry))),
      h("td", { class: "num muted" }, entry.type === "file" ? bytes(entry.size) : "—"),
      h("td", { class: "muted when" }, fileTime(entry.modified)),
      h("td", { class: "tick" }, entryMore(entry)),
    );
  return h("div", { class: "card table-wrap" }, h("table", { class: "file-table" }, h("thead", null, h("tr", null, h("th", { class: "tick" }, all), h("th", null, t("files.col.name")), h("th", { class: "num" }, t("files.col.size")), h("th", { class: "when" }, t("files.col.modified")), h("th"))), h("tbody", null, entries.map(row))));
}

/** A file without a picture: its extension and what it is, on the colour of its kind */
function extBadge(entry) {
  const dot = entry.name.lastIndexOf(".");
  const ext = dot > 0 ? entry.name.slice(dot + 1) : "";
  const tint = TINT_BY_EXT[ext.toLowerCase()] ?? "other";
  return h("span", { class: "ext tint-" + tint }, ext && ext.length <= 5 ? h("b", null, ext.toUpperCase()) : fileIcon(entry), h("small", null, t("files.kind." + tint)));
}

/** The first lines of text files, by path and time, so a new drawing of the folder does not ask again */
const peeks = new Map();
const PEEK_BYTES = 2048;

/** The thumbnail of a text file: its first lines, read when the tile comes into view */
function textPeek(entry, path, badge) {
  const key = `${filesMachine()}:${path}:${entry.modified}`;
  const box = h("span", { class: "thumb" }, peeks.get(key) ?? badge);
  if (peeks.has(key)) return box;
  const seen = new IntersectionObserver(async ([view]) => {
    if (!view.isIntersecting) return;
    seen.disconnect();
    try {
      const res = await fetch(rawUrl(path), { headers: { range: `bytes=0-${PEEK_BYTES - 1}` } });
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      // a NUL means it is not text after all
      if (bytes.includes(0)) return;
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
      if (bytes.length >= PEEK_BYTES) lines.pop();
      const text = lines.slice(0, 16).join("\n");
      if (!text.trim()) return;
      if (peeks.size > 300) peeks.delete(peeks.keys().next().value);
      peeks.set(key, h("pre", { class: "peek" }, text));
      box.replaceChildren(peeks.get(key));
    } catch {}
  });
  seen.observe(box);
  return box;
}

function filesGrid(dirs, rest) {
  const tile = (entry) => {
    const path = joinPath(state.files.path, entry.name);
    const kind = fileKind(entry);
    let thumb = null;
    if (entry.type !== "dir") {
      const badge = extBadge(entry);
      if (kind === "image" && entry.size <= THUMB_MAX) thumb = h("span", { class: "thumb" }, h("img", { src: rawUrl(path), alt: "", loading: "lazy", decoding: "async", onerror: (e) => e.currentTarget.replaceWith(badge) }));
      else if (kind === "text" && entry.size > 0 && entry.size <= TEXT_MAX) thumb = textPeek(entry, path, badge);
      else thumb = h("span", { class: "thumb" }, badge);
    }
    return h(
      "div",
      { class: "file-tile" + (entry.type === "dir" ? " dir" : "") + (filesUi.selected.has(entry.name) ? " selected" : "") + (filesUi.cursor === entry.name ? " cursor" : ""), "data-name": entry.name },
      entryOpener(entry, "file-open", thumb, entry.type === "dir" && fileIcon(entry), h("span", { class: "file-text" }, h("span", { class: "clip strong" }, entry.name, entryMarks(entry)), h("span", { class: "muted small clip" }, entry.type === "file" ? `${bytes(entry.size)} · ${fileTime(entry.modified)}` : fileTime(entry.modified)))),
      h("span", { class: "file-tick" }, entryCheckbox(entry)),
      h("span", { class: "file-more" }, entryMore(entry)),
    );
  };
  // the boxes to tick show on the tile under the pointer, and on all of them once something is chosen
  return h(
    "div",
    { class: "stack files-tiles" + (filesUi.selected.size ? " choosing" : "") },
    dirs.length > 0 && h("div", { class: "file-grid dirs" }, dirs.map(tile)),
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
    const sum = await api("POST", filesApi("/summary"), { paths: entries.map((entry) => joinPath(dir, entry.name)) });
    if (sum.truncated || sum.size > 3.8 * 1024 ** 3 || sum.files + sum.dirs > 60000) return toast(t("error.files.archiveTooLarge"), "error");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  save(filesApi("/zip") + "?" + entries.map((entry) => "path=" + encodeURIComponent(joinPath(dir, entry.name))).join("&"));
}

/** Puts a menu where the pointer is, inside the window; a right click beside it moves it there */
function placeAt(dialog, at) {
  const page = document.documentElement;
  dialog.style.right = "auto";
  dialog.style.left = Math.max(8, Math.min(at.x, page.clientWidth - dialog.offsetWidth - 8)) + "px";
  dialog.style.top = Math.max(8, Math.min(at.y, page.clientHeight - dialog.offsetHeight - 8)) + "px";
  dialog.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (e.target !== dialog) return;
    dialog.close();
    document.elementFromPoint(e.clientX, e.clientY)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
  });
}

/**
 * A menu at the pointer. Entries are `{ label, icon, run }` or `{ label, icon, href, newTab }`, with
 * `danger` and `off`; false ones are skipped. `header` is what the menu is about.
 */
function menuAt(at, header, entries) {
  let dialog;
  const one = (e) =>
    e.href
      ? h("a", { class: "menu-item", href: e.href, ...(e.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {}), onclick: () => dialog.close() }, e.iconEl ?? icon(e.icon), e.label)
      : h("button", { type: "button", class: "menu-item" + (e.danger ? " danger" : ""), disabled: !!e.off, onclick: () => (dialog.close(), e.run()) }, e.iconEl ?? icon(e.icon), e.label);
  const marked = (e, el) => (e.on && el.append(icon("check", "on-mark")), el);
  dialog = openDialog("menu dropdown", header, entries.filter(Boolean).map((e) => marked(e, one(e))));
  placeAt(dialog, at);
  // opened by the pointer: the first entry is not chosen by itself (the dialog takes the focus instead)
  dialog.tabIndex = -1;
  dialog.focus();
  return dialog;
}

const menuHeader = (title, sub, iconName) => h("header", null, iconName && h("span", { class: "badge-icon plain" }, icon(iconName)), h("div", null, h("h2", { class: "clip" }, title), sub && h("span", { class: "muted small clip" }, sub)));

/** A card of the store: install it, or go to it once it is installed */
const storeCardMenu = (a, isIn, at) =>
  menuAt(at, menuHeader(a.title ?? a.name, a.category ?? ""), [
    isIn ? { label: t("common.open"), icon: "grid", href: `#/apps/${a.name}` } : { label: t("store.install") + "…", icon: "download", run: () => storeDialog(a) },
    isIn && { label: t("menu.newTab"), icon: "external", href: location.pathname + `#/apps/${a.name}`, newTab: true },
  ]);

/** Whether the element or one around it has a menu of its own */
const hasOwnMenu = (el) => {
  for (; el && el !== document.body; el = el.parentElement) if (el.hataMenu) return true;
  return false;
};

/** The rows a right click finds the actions of by themselves: what their buttons and their link do */
const MENU_ROWS = "tr, .snapshot, .machine-card, .attention-item, .tool";

/** The menu of a row made of its own buttons — the same actions, where the pointer is; false — it has none */
function rowMenu(row, at) {
  const shown = (el) => el.getClientRects().length > 0 && !el.closest("dialog:not([open])");
  const buttons = [...row.querySelectorAll("button, a.btn")].filter((b) => shown(b) && !b.closest(".menu-item") && !b.classList.contains("select-btn") && b.type !== "submit");
  // the name, without the chips that sit inside it ("test" of "test · Everything")
  const named = row.querySelector("h2 .with-icon") ?? row.querySelector("strong, h2, h3, .strong, .name");
  const title = (named && ([...named.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim() || named.textContent.trim())) || "";
  // "Back up now: Adminer" says the name for a screen reader; under a header with that name it is said once
  const labelOf = (b) => {
    const text = (b.textContent.trim() || b.getAttribute("aria-label") || b.title || "").replace(/\s+/g, " ");
    return title && text.endsWith(": " + title) ? text.slice(0, -title.length - 2) : text;
  };
  const actions = buttons.filter((b) => labelOf(b));
  // the row's own link, not one in the words under it (`.link`)
  const link = [...row.querySelectorAll("a[href]:not(.btn):not(.link)")].find((a) => shown(a) && a.getAttribute("href") !== "#");
  if (!actions.length && !link) return false;
  // a row with a "⋯" button: that menu is the row's (only that one is clicked for the person — never a delete)
  const more = actions.find((b) => b.querySelector("path")?.getAttribute("d") === ICONS.more);
  if (more) {
    more.click();
    return true;
  }
  const svgOf = (b) => b.querySelector("svg")?.cloneNode(true) ?? icon("chevron");
  // the same thing twice (a copy button by each of two lines) is said once
  const seen = new Set();
  const once = actions.filter((b) => !seen.has(labelOf(b)) && seen.add(labelOf(b)));
  menuAt(at, title && menuHeader(title), [
    link && { label: t("common.open"), icon: "folder", href: link.getAttribute("href"), ...(link.target === "_blank" ? { newTab: true } : {}) },
    link && link.target !== "_blank" && { label: t("menu.newTab"), icon: "external", href: link.href, newTab: true },
    ...once.map((b) => ({ label: labelOf(b), iconEl: svgOf(b), off: b.disabled, danger: b.classList.contains("danger"), run: () => b.click() })),
  ]);
  return true;
}

/**
 * The right click, everywhere: the menu of the thing under the pointer — one given to it (`menu` in h()),
 * or one made of a row's buttons. Text being selected, fields, frames and Shift keep the browser's own.
 */
function contextMenus() {
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented || e.shiftKey || !(e.target instanceof Element)) return;
    if (e.target.closest("input, textarea, select, .select-btn, [contenteditable], iframe, dialog.menu")) return;
    const picked = getSelection();
    if (picked && !picked.isCollapsed && picked.containsNode(e.target, true)) return;
    const at = { x: e.clientX, y: e.clientY };
    for (let el = e.target; el && el !== document.body; el = el.parentElement) {
      // `menu: true` — the element's own buttons are its menu, as in a row
      if (el.hataMenu === true && rowMenu(el, at)) return void e.preventDefault();
      if (typeof el.hataMenu === "function") {
        e.preventDefault();
        return void el.hataMenu(at);
      }
      if (el.matches(MENU_ROWS) && !el.closest("thead") && rowMenu(el, at)) return void e.preventDefault();
    }
    // nothing of its own under the pointer: the page's menu — but a link, a picture or a dialog keep the browser's
    if (e.target.closest("a[href], img, video, audio, canvas, dialog")) return;
    e.preventDefault();
    pageMenu(at);
  });
}

/** Changes the look from anywhere (a right click on the page): shown at once, saved, taken back when refused */
async function changeLook(patch) {
  const before = state.appearance;
  applyAppearance((state.appearance = { ...before, ...patch }));
  try {
    const saved = await api("PUT", "/api/settings", { appearance: patch });
    state.appearance = saved.appearance;
    if (state.settings) state.settings = saved;
  } catch (e) {
    applyAppearance((state.appearance = before));
    toast(errorText(e), "error");
  }
}

/** The menu of the page itself: the look, Hata's own places, and what the page on screen can add */
function pageMenu(at) {
  const admin = isAdmin();
  const look = state.appearance ?? {};
  const theme = !look.background ? "system" : lightness(look.background) > 0.35 ? "light" : "dark";
  // the built-in pictures and one's own, in turn; after the last — none
  const walls = ["", ...(state.wallpapers ?? []), ...(look.custom ? ["custom"] : [])];
  const nextWall = walls[(walls.indexOf(look.wallpaper ?? "") + 1) % walls.length];
  menuAt(at, menuHeader("Hata", state.version, "home"), [
    admin && state.route.view === "home" && state.overview && { label: t("menu.addHere"), icon: "plus", run: () => addDialog() },
    admin && state.route.view === "home" && state.overview && { label: t("menu.dashboardConfig"), icon: "code", run: layoutTextDialog },
    admin && { label: t("menu.themeLight"), icon: "sun", on: theme === "light", run: () => changeLook({ background: BACKGROUNDS[6] }) },
    admin && { label: t("menu.themeDark"), icon: "moon", on: theme === "dark", run: () => changeLook({ background: BACKGROUNDS[0] }) },
    admin && { label: t("menu.themeSystem"), icon: "sliders", on: theme === "system", run: () => changeLook({ background: "" }) },
    admin && walls.length > 1 && { label: t("menu.nextWallpaper"), icon: "image", run: () => changeLook({ wallpaper: nextWall }) },
    admin && { label: t("menu.appearance"), icon: "image", href: "#/settings/appearance" },
    { label: t("menu.reload"), icon: "refresh", run: () => location.reload() },
    { label: t("nav.settings"), icon: "sliders", href: "#/settings" },
    { label: t("menu.about"), icon: "info", href: "#/settings/about" },
  ]);
}

/** The right click in Files: the menu of the file, of everything selected, or of the folder on screen */
function filesContext(e) {
  // Shift leaves the browser's own menu, and so does a field with text in it
  if (e.shiftKey || e.target.closest?.("input, textarea, select") || !e.target.closest?.("#files-main") || hasOwnMenu(e.target)) return;
  const listing = filesListing();
  if (!listing || listing.error) return;
  e.preventDefault();
  const at = { x: e.clientX, y: e.clientY };
  const name = e.target.closest("[data-name]")?.dataset.name;
  const entry = name !== undefined && listing.entries.find((one) => one.name === name);
  if (!entry) return folderMenu(at);
  const chosen = selectedEntries();
  if (chosen.length > 1 && chosen.includes(entry)) return selectionMenu(chosen, at);
  entryMenu(entry, at);
}

function selectionMenu(chosen, at) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu dropdown",
    h("header", null, h("div", null, h("h2", null, t("files.selected", { n: chosen.length })), h("span", { class: "muted small" }, bytes(chosen.reduce((n, entry) => n + entry.size, 0))))),
    item(t("files.downloadZip"), "download", () => downloadEntries(chosen)),
    !state.files.readOnly && item(t("files.move"), "arrow", () => transferDialog(chosen, false)),
    item(t("files.copy"), "copy", () => transferDialog(chosen, true)),
    item(t("files.clearSelection"), "x", () => ((filesUi.selected = new Set()), renderFilesBody())),
    !state.files.readOnly && item(t("files.delete"), "trash", () => deleteDialog(chosen), "danger"),
  );
  placeAt(dialog, at);
}

function folderMenu(at) {
  let dialog;
  const listing = state.files;
  const path = listing.path;
  const item = (label, iconName, action, off) => h("button", { type: "button", class: "menu-item", disabled: !!off, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu dropdown",
    h("header", null, h("span", { class: "badge-icon plain" }, icon("folder")), h("div", null, h("h2", { class: "clip" }, path.split("/").pop() || "/"))),
    item(t("files.newFolder"), "folder", () => newFolderDialog(path, loadFiles), listing.readOnly),
    item(t("files.newFile"), "file", () => newFileDialog(path), listing.readOnly),
    item(t("files.upload"), "upload", () => document.querySelector("#files-main .page-head input[type=file]")?.click(), listing.readOnly),
    listing.entries.length > 0 && item(t("files.selectAll"), "check", () => ((filesUi.selected = new Set(listing.entries.map((entry) => entry.name))), renderFilesBody())),
    listing.entries.length > 0 && item(t("files.downloadZip"), "download", () => downloadEntries(listing.entries.filter((entry) => entry.type !== "other"))),
    item(t("files.copyPath"), "link", () => copyText(path)),
    !listing.machine && item(t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), "star", () => favorite(path, !isFavorite(path))),
    !listing.machine && isAdmin() && item(t(listing.pinned.includes(path) ? "files.unpin" : "files.pin"), "home", () => pinFolder(path, !listing.pinned.includes(path))),
    !listing.machine && isAdmin() && item(t(listing.shared.includes(path) ? "files.shareSettings" : "files.share"), "share", () => shareDialog(path)),
    machineLet(listing.machine) && path !== "/" && item(t("machines.people.shareHere"), "share", () => machineShareDialog(machineLet(listing.machine), path)),
  );
  placeAt(dialog, at);
}

function entryMenu(entry, at) {
  let dialog;
  const kind = fileKind(entry);
  const path = joinPath(state.files.path, entry.name);
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "badge-icon plain" }, fileIcon(entry)), h("div", null, h("h2", { class: "clip" }, entry.name), h("span", { class: "muted small" }, entry.type === "file" ? `${bytes(entry.size)} · ${fileTime(entry.modified)}` : fileTime(entry.modified)))),
    entry.type === "dir" && item(t("common.open"), "folder", () => go(filesHash(path))),
    entry.type === "dir" && at && item(t("files.openTab"), "external", () => window.open(filesHash(path), "_blank", "noopener")),
    ["image", "video", "audio", "pdf"].includes(kind) && item(t("common.open"), "external", () => openEntry(entry)),
    entry.type === "file" && entry.size <= TEXT_MAX && !["image", "video", "audio", "pdf"].includes(kind) && item(t("files.edit"), "edit", () => textDialog(path)),
    entry.type !== "other" && item(t(entry.type === "dir" ? "files.downloadZip" : "files.download"), "download", () => downloadEntries([entry])),
    entry.type === "file" && ARCHIVE_RE.test(entry.name) && !state.files.readOnly && !filesMachine() && isAdmin() && item(t("files.extract"), "archive", () => extractArchive(path)),
    item(t("files.copyPath"), "link", () => copyText(path)),
    entry.type !== "other" && !filesMachine() && item(t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), "star", () => favorite(path, !isFavorite(path), entry.name)),
    entry.type === "dir" && !filesMachine() && isAdmin() && (state.files.pinned.includes(path) ? item(t("files.unpin"), "home", () => pinFolder(path, false)) : item(t("files.pin"), "home", () => pinFolder(path, true))),
    entry.type === "dir" && !filesMachine() && isAdmin() && item(t(state.files.shared.includes(path) ? "files.shareSettings" : "files.share"), "share", () => shareDialog(path)),
    entry.type === "dir" && machineLet(filesMachine()) && item(t("machines.people.shareHere"), "share", () => machineShareDialog(machineLet(filesMachine()), path)),
    !state.files.readOnly && item(t("files.rename"), "edit", () => renameDialog(entry)),
    !state.files.readOnly && item(t("files.move"), "arrow", () => transferDialog([entry], false)),
    item(t("files.copy"), "copy", () => transferDialog([entry], true)),
    !state.files.readOnly && item(t("files.delete"), "trash", () => deleteDialog([entry]), "danger"),
  );
  if (at) placeAt(dialog, at);
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

/** The names Hata unpacks: ZIP, and tar with or without compression — as `archiveKind` in files.ts */
const ARCHIVE_RE = /\.(zip|tar|tar\.(gz|bz2|xz|zst)|tgz|tbz2?|txz)$/i;

/** Unpacked into a new folder next to the archive, as a job */
async function extractArchive(path) {
  try {
    const res = await api("POST", "/api/files/extract", { path });
    jobDialog(res.job, "extract", path.split("/").pop(), () => void loadFiles());
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** What can be made in a folder */
function newMenu(path, anchor) {
  let dialog;
  const item = (label, iconName, action) => h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog("menu dropdown", item(t("files.newFolder"), "folder", () => newFolderDialog(path, loadFiles)), item(t("files.newFile"), "file", () => newFileDialog(path)));
  const box = anchor.getBoundingClientRect();
  placeAt(dialog, { x: box.right - dialog.offsetWidth, y: box.bottom + 4 });
}

/** A new empty text file, opened in the editor at once */
const newFileDialog = (dir) =>
  nameDialog(t("files.newFile"), "", t("files.create"), async (name) => {
    const res = await api("POST", filesApi("/file"), { path: dir, name });
    await loadFiles();
    void textDialog(res.path);
  });

/** The search field of the folder on screen: names under it, found by the server */
function findBox(path) {
  const input = h("input", { type: "search", class: "find", placeholder: t("files.find"), "aria-label": t("files.find"), value: filesUi.find?.under === path ? filesUi.find.query : "", spellcheck: false });
  let timer;
  const run = async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      if (filesUi.find) (filesUi.find = null), renderFilesBody(), document.querySelector("#files-main input.find")?.focus();
      return;
    }
    filesUi.find = { under: path, query, found: null, more: false };
    try {
      const res = await api("GET", `/api/files/find?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`);
      // another search, or another folder, may have started meanwhile
      if (filesUi.find?.query !== query || filesUi.find.under !== path) return;
      Object.assign(filesUi.find, res);
    } catch (e) {
      if (filesUi.find?.query === query) filesUi.find.error = errorText(e);
    }
    const caret = input.selectionStart;
    renderFilesBody();
    const again = document.querySelector("#files-main input.find");
    if (again) (again.focus(), again.setSelectionRange(caret, caret));
  };
  input.addEventListener("input", () => (clearTimeout(timer), (timer = setTimeout(run, 400))));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (clearTimeout(timer), void run());
    if (e.key === "Escape") ((input.value = ""), clearTimeout(timer), void run());
  });
  // it searches by itself as one types; the button is for whoever does not know that
  return h("div", { class: "find-box" }, input, h("button", { type: "button", class: "find-go", title: t("files.findGo"), "aria-label": t("files.findGo"), onclick: () => (clearTimeout(timer), void run(), input.focus()) }, icon("search")));
}

/** What a search found: each with the folder it lies in; a folder opens, a file opens its folder with it chosen */
function foundList(find) {
  if (find.error) return h("p", { class: "card pad error" }, find.error);
  if (!find.found) return h("p", { class: "muted" }, t("files.finding"));
  if (!find.found.length) return h("div", { class: "card empty" }, icon("search"), h("p", null, t("files.nothingFound", { query: find.query })));
  const show = (item) => {
    const parent = item.path.slice(0, item.path.lastIndexOf("/")) || "/";
    if (item.type === "dir") return go(filesHash(item.path));
    filesUi.find = null;
    filesUi.pick = item.path.split("/").pop();
    go(filesHash(parent));
  };
  const row = (item) => {
    const name = item.path.split("/").pop();
    const parent = item.path.slice(0, item.path.lastIndexOf("/")) || "/";
    return h(
      "tr",
      null,
      h("td", { class: "name" }, h("button", { type: "button", class: "file-name", onclick: () => show(item) }, fileIcon({ name, type: item.type }), h("span", { class: "clip" }, name)), h("div", { class: "muted small clip mono" }, parent)),
      h("td", { class: "num muted" }, item.type === "file" ? bytes(item.size) : "—"),
      h("td", { class: "muted when" }, item.modified ? fileTime(item.modified) : ""),
    );
  };
  return h(
    "div",
    { class: "stack" },
    h("p", { class: "muted small" }, t(find.more ? "files.foundMore" : "files.found", { n: find.found.length, query: find.query })),
    h("div", { class: "card table-wrap" }, h("table", { class: "file-table" }, h("thead", null, h("tr", null, h("th", null, t("files.col.name")), h("th", { class: "num" }, t("files.col.size")), h("th", { class: "when" }, t("files.col.modified")))), h("tbody", null, find.found.map(row)))),
  );
}

const newFolderDialog = (dir, done, machine = filesMachine()) =>
  nameDialog(t("files.newFolder"), "", t("files.create"), async (name) => {
    await api("POST", filesApi("/folder", machine), { path: dir, name });
    await done();
  });

const renameDialog = (entry) =>
  nameDialog(t("files.renameTitle", { name: entry.name }), entry.name, t("files.rename"), async (name) => {
    await api("POST", filesApi("/rename"), { path: joinPath(state.files.path, entry.name), name });
    await loadFiles();
  });

async function deleteDialog(entries) {
  const dir = state.files.path;
  const paths = entries.map((entry) => joinPath(dir, entry.name));
  // a machine keeps no trash: what is deleted there is gone
  const machine = filesMachine();
  let sum;
  try {
    sum = await api("POST", filesApi("/summary"), { paths });
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const note = h("p", { class: "muted" }, t(machine ? "files.machineDeleteLead" : "files.deleteLead", { files: sum.truncated ? sum.files + "+" : sum.files, dirs: sum.dirs, size: bytes(sum.size) }));
  const run = async (e, forever) => {
    const pressed = e.currentTarget;
    pressed.disabled = true;
    try {
      await api("POST", filesApi("/delete"), { paths, forever });
      toast(t(forever ? "files.deletedForever" : "files.trashed", { n: paths.length }));
    } catch (err) {
      // a disk that keeps no trash: what is left is to delete for good, and the dialog says so
      if (err.code === "files.noTrash" && !forever) {
        pressed.hidden = true;
        note.className = "banner small";
        note.textContent = errorText(err);
        return void loadFiles();
      }
      toast(errorText(err), "error");
    }
    dialog.close();
    await loadFiles();
  };
  const dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, entries.length === 1 ? t("files.deleteTitle", { name: entries[0].name }) : t("files.deleteMany", { n: entries.length })),
    note,
    !machine && within(dir, joinPath(state.files.home, "AppData")) ? h("p", { class: "banner small" }, t("files.deleteAppData")) : null,
    machine && h("p", { class: "banner small" }, t("files.machineNoTrash")),
    machine
      ? h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("files.deleteForever"), { class: "danger", onclick: (e) => run(e, true) }, "trash"))
      : h("footer", null, button(t("files.deleteForever"), { class: "ghost danger-text small", onclick: (e) => run(e, true) }), closeButton(() => dialog, t("common.cancel")), button(t("files.toTrash"), { class: "primary", autofocus: true, onclick: (e) => run(e, false) }, "trash")),
  );
}

// --- The trash: what was deleted in Files, to be put back or removed for good ---

async function loadTrash() {
  try {
    state.trash = await api("GET", "/api/files/trash");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  // opened straight from a link: the places on the left come with a listing of Files
  if (!state.files && isAdmin()) state.files = await api("GET", "/api/files?path=").catch(() => null);
  if (!isAdmin() && !state.myShares) await loadMine();
  if (state.files?.favorites) state.favorites = state.files.favorites;
  if (state.route.view === "trash") renderTrash();
}

/** The entries of the trash chosen with their boxes, by id; what is no longer there drops out on every drawing */
const trashChosen = new Set();
const TRASH_DAYS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const trashDaysText = (n) => (n === 1 ? t("trash.day") : t("trash.days", { n }));

/** A shorter time for the trash: what has lain there longer goes at once, so that is asked first */
function trashDaysChange(days, select) {
  const items = state.trash?.items ?? [];
  const going = items.filter((item) => Date.now() - item.at > days * 86_400_000);
  const save = async () => {
    try {
      const answer = await api("PUT", "/api/files/trash/days", { days });
      if (answer.removed) toast(t("trash.daysRemoved", { n: answer.removed }));
    } catch (e) {
      toast(errorText(e), "error");
    }
    await loadTrash();
  };
  if (!going.length) return void save();
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("trash.daysTitle", { days: trashDaysText(days) })),
    h("p", { class: "muted" }, t("trash.daysLead", { n: going.length, size: bytes(going.reduce((sum, item) => sum + item.size, 0)) })),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("files.deleteForever"), { class: "danger", onclick: () => (dialog.close(), save()) }, "trash")),
  );
  // cancelled: the list shows the time that is still kept
  dialog.addEventListener("close", () => (select.value = String(state.trash.keepDays)));
}

function renderTrash() {
  const data = state.trash;
  const items = data?.items ?? [];
  for (const id of [...trashChosen]) if (!items.some((item) => item.id === id)) trashChosen.delete(id);
  const chosen = items.filter((item) => trashChosen.has(item.id));
  const act = async (el, work) => {
    el.disabled = true;
    try {
      await work();
    } catch (e) {
      toast(errorText(e), "error");
    }
    await loadTrash();
  };
  const back = (list) => (e) =>
    act(e.currentTarget, async () => {
      const { restored } = await api("POST", "/api/files/trash/restore", { ids: list.map((item) => item.id) });
      list.forEach((item) => trashChosen.delete(item.id));
      toast(restored.length === 1 ? t("trash.restored", { path: restored[0].path }) : t("trash.restoredMany", { n: restored.length }));
    });
  const forever = (ids, title, lead) => {
    const dialog = openDialog(
      "confirm",
      h("h2", { class: "wrap" }, title),
      h("p", { class: "muted" }, lead),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("files.deleteForever"), { class: "danger", onclick: (e) => act(e.currentTarget, () => api("POST", "/api/files/trash/delete", ids ? { ids } : {})).then(() => dialog.close()) }, "trash")),
    );
  };
  const folderOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
  const tick = (item) =>
    h("input", {
      type: "checkbox",
      checked: trashChosen.has(item.id),
      "aria-label": item.name,
      onchange: (e) => (e.target.checked ? trashChosen.add(item.id) : trashChosen.delete(item.id), renderTrash()),
    });
  const all = h("input", {
    type: "checkbox",
    checked: items.length > 0 && chosen.length === items.length,
    "aria-label": t("trash.chooseAll"),
    onchange: (e) => (items.forEach((item) => (e.target.checked ? trashChosen.add(item.id) : trashChosen.delete(item.id))), renderTrash()),
  });
  all.indeterminate = chosen.length > 0 && chosen.length < items.length;
  const row = (item) =>
    h(
      "tr",
      { class: trashChosen.has(item.id) ? "chosen" : "" },
      h("td", { class: "tick" }, tick(item)),
      h("td", null, h("div", { class: "with-icon strong" }, icon(item.type === "dir" ? "folder" : "file"), h("span", { class: "clip" }, item.name))),
      h("td", null, h("a", { class: "muted small mono clip block", href: filesHash(folderOf(item.from)) }, folderOf(item.from))),
      h("td", null, h("div", null, ago(item.at)), item.by && h("div", { class: "muted small" }, item.by)),
      h("td", { class: "num" }, bytes(item.size), item.type === "dir" && h("div", { class: "muted small" }, t("trash.files", { n: item.files }))),
      h("td", null, h("div", { class: "row-actions" }, button(t("trash.restore"), { class: "small", onclick: back([item]) }, "undo"), isAdmin() && button("", { class: "small icon-btn", title: t("files.deleteForever"), "aria-label": t("files.deleteForever"), onclick: () => forever([item.id], t("trash.deleteTitle", { name: item.name }), t("trash.deleteLead")) }, "trash"))),
    );
  const keep = data?.keepDays ?? 30;
  const days = h(
    "select",
    { class: "short", "aria-label": t("trash.keep"), onchange: (e) => trashDaysChange(Number(e.target.value), e.target) },
    [...new Set([...TRASH_DAYS, keep])].sort((a, b) => a - b).map((n) => h("option", { value: String(n), selected: n === keep }, trashDaysText(n))),
  );
  const chosenSize = chosen.reduce((sum, item) => sum + item.size, 0);
  shell(h("div", { class: "files" }, h("aside", { class: "files-side fold", id: "files-places" }), h("section", { class: "stack" },
    h(
      "div",
      { class: "page-head" },
      h("div", null, h("h1", null, t("trash.title")), h("p", { class: "meta" }, h("a", { href: "#/files" }, t("nav.files")), h("span", { class: "dot-sep" }, "·"), t("trash.meta", { n: items.length, size: bytes(data?.size ?? 0) }))),
      h(
        "div",
        { class: "actions" },
        chosen.length > 0 && button(t("trash.restoreChosen", { n: chosen.length }), { onclick: back(chosen) }, "undo"),
        chosen.length > 0 && isAdmin() && button(t("trash.deleteChosen", { n: chosen.length }), { class: "danger", onclick: () => forever(chosen.map((item) => item.id), t("trash.deleteChosenTitle", { n: chosen.length }), t("trash.emptyLead", { n: chosen.length, size: bytes(chosenSize) })) }, "trash"),
        chosen.length === 0 && items.length > 0 && isAdmin() && button(t("trash.empty"), { class: "danger", onclick: () => forever(null, t("trash.emptyTitle"), t("trash.emptyLead", { n: items.length, size: bytes(data.size) })) }, "trash"),
      ),
    ),
    h(
      "div",
      { class: "card table-wrap" },
      h("div", { class: "pad trash-keep" }, h("p", { class: "muted small grow" }, t("trash.lead", { days: trashDaysText(keep) })), data && isAdmin() && h("label", { class: "with-icon small" }, h("span", null, t("trash.keep")), days)),
      !data
        ? null
        : items.length === 0
          ? h("p", { class: "empty" }, t("trash.nothing"))
          : h("table", { class: "disks trash" }, h("thead", null, h("tr", null, h("th", { class: "tick" }, all), h("th", null, t("files.col.name")), h("th", null, t("trash.col.from")), h("th", null, t("trash.col.deleted")), h("th", { class: "num" }, t("files.col.size")), h("th"))), h("tbody", null, items.map(row))),
    ),
  )));
  filesPlaces(null);
}

/** Picks the folder to move or copy into */
/**
 * Walks the folders of the server to choose one: `allowed(at, machine)` says whether the current one
 * will do. With `machines` the other machines are a press away too, and `action` gets the machine
 * ("" — this server) after the folder.
 */
function folderPicker({ title, start, confirmLabel, action, allowed = () => true, shown = () => true, machine = "", machines = false }) {
  let at = start;
  let on = machine;
  let home = "";
  let dialog;
  const crumbs = h("div", { class: "crumbs wrap" });
  const quick = h("div", { class: "picker-quick" });
  const folders = h("div", { class: "picker" });
  const error = h("p", { class: "error", role: "alert" });
  const confirm = button(confirmLabel, {
    class: "primary",
    onclick: async () => {
      confirm.disabled = true;
      error.textContent = "";
      try {
        await action(at, on);
        dialog.close();
      } catch (e) {
        error.textContent = errorText(e);
        confirm.disabled = false;
      }
    },
  });
  const show = async (path, where = on) => {
    let listing;
    try {
      listing = await api("GET", `${filesApi("", where)}?path=${encodeURIComponent(path)}`);
    } catch (e) {
      // a starting folder that is not there yet opens at the nearest one that is
      if (path === start && where === machine && path.lastIndexOf("/") > 0) return show((start = path.slice(0, path.lastIndexOf("/"))), where);
      return void (error.textContent = errorText(e));
    }
    on = where;
    if (!on) home = listing.home;
    // opened on a machine: this server's data folder is a press away as well
    else if (machines && !home) home = (await api("GET", "/api/files?path=").catch(() => null))?.home ?? "";
    at = listing.path;
    error.textContent = "";
    // one who is not an administrator walks the folders shared with them, from the folder down
    const mine = isAdmin() ? null : (listing.shares ?? []);
    const share = mine?.filter((one) => within(at, one.path)).sort((a, b) => b.path.length - a.path.length)[0];
    const base = share ? share.path : "/";
    const parts = at.slice(base.length).split("/").filter(Boolean);
    const crumb = (label, to) => h("button", { type: "button", class: "crumb", onclick: () => show(to) }, label);
    const other = on && machinesUi.list?.machines.find((m) => m.id === on);
    put(crumbs, other && h("span", { class: "with-icon strong" }, icon("server"), other.name), crumb(share ? share.name : "/", base), parts.map((part, i) => [(i > 0 || share) && icon("chevron"), crumb(part, (base === "/" ? "" : base) + "/" + parts.slice(0, i + 1).join("/"))]));
    // the data folder and the disks, one press away wherever the picker is; with `machines` the other machines too
    const jump = (label, to, iconName, target = on) => h("button", { type: "button", class: "chip-btn" + (target === on && (at === to || at.startsWith(to + "/")) ? " active" : ""), onclick: () => show(to, target) }, icon(iconName), h("span", { class: "clip" }, label));
    const volumes = on ? [] : outerVolumes(listing);
    const others = machines ? (machinesUi.list?.machines ?? []).filter((m) => m.online) : [];
    if (mine) put(quick, mine.map((one) => jump(one.name, one.path, "share")));
    else put(quick, (on ? home : listing.home) && jump(t("files.home"), on ? home : listing.home, "home", ""), volumes.map((d) => jump(volumeName(d), d.path, d.network ? "globe" : "disk")), others.map((m) => h("button", { type: "button", class: "chip-btn" + (on === m.id ? " active" : ""), onclick: () => show("/", m.id) }, icon("server"), h("span", { class: "clip" }, m.name))));
    quick.hidden = mine ? mine.length < 2 : !volumes.length && !others.length && !on;
    const inner = sortedEntries(listing.entries).filter((entry) => entry.type === "dir" && shown(joinPath(at, entry.name), on));
    put(folders, inner.length ? inner.map((entry) => h("button", { type: "button", class: "menu-item", onclick: () => show(joinPath(at, entry.name)) }, icon("folder", "folder-ico"), h("span", { class: "clip grow" }, entry.name), icon("chevron", "faint"))) : h("p", { class: "muted small pad" }, t("files.noFolders")));
    confirm.disabled = !allowed(at, on) || (!!mine && listing.readOnly);
    newFolder.disabled = !!mine && listing.readOnly;
  };
  const newFolder = button(t("files.newFolder"), { onclick: () => newFolderDialog(at, () => show(at), on) }, "folder");
  dialog = openDialog("wide", h("h2", { class: "wrap" }, title), quick, crumbs, folders, error, h("footer", null, newFolder, closeButton(() => dialog, t("common.cancel")), confirm));
  void show(at);
}

function transferDialog(entries, copy) {
  const from = state.files.path;
  const source = filesMachine();
  const paths = entries.map((entry) => joinPath(from, entry.name));
  const what = entries.length === 1 ? entries[0].name : t("files.items", { n: entries.length });
  folderPicker({
    title: t(copy ? "files.copyTitle" : "files.moveTitle", { what }),
    start: from,
    machine: source,
    machines: true,
    confirmLabel: t(copy ? "files.copyHere" : "files.moveHere"),
    allowed: (at, on) => copy || on !== source || at !== from,
    // a folder cannot go into itself
    shown: (path, on) => copy || on !== source || !paths.includes(path),
    action: async (to, on) => {
      if (on !== source) {
        // to another machine: a job that sends the files over
        const res = await api("POST", "/api/files/transfer", { from: { machine: source, paths }, to: { machine: on, dir: to }, copy });
        return jobDialog(res.job, "transfer", what, () => void loadFiles());
      }
      await api("POST", filesApi(copy ? "/copy" : "/move", source), { paths, to });
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
  const machine = filesMachine();
  let file;
  try {
    file = await api("GET", `${filesApi("/text", machine)}?path=${encodeURIComponent(path)}`);
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
        file = await api("PUT", filesApi("/text", machine), { path, content: area.value, modified: file.modified });
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

/** Waits between the tries of a part cut off on the way: the network may be back in a few seconds */
const UPLOAD_RETRIES = [1000, 3000, 8000, 15000, 30000];

/**
 * One part, tried again when the connection broke. The server keeps nothing of a part it did not get
 * whole; when the answer was what got lost, its "not in order" says how much it has — a part that
 * arrived counts as sent, and a last part whose file is already in place means the file is done.
 */
async function sendPartAgain(url, blob, offset, last, onProgress) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendPart(url, blob, onProgress);
    } catch (e) {
      const cut = e instanceof ApiError && e.status === 0;
      if (attempt > 0 && e instanceof ApiError && e.code === "files.uploadOrder" && e.detail?.have === offset + blob.size) return {};
      if (attempt > 0 && last && e instanceof ApiError && (e.code === "files.exists" || (e.code === "files.uploadOrder" && e.detail?.have === -1))) return {};
      if (!cut || uploads.cancelled || attempt >= UPLOAD_RETRIES.length) throw e;
      uploads.retrying = true;
      paintUpload();
      // a press of "Cancel" during the wait is heard at once
      for (let waited = 0; waited < UPLOAD_RETRIES[attempt] && !uploads.cancelled; waited += 250) await new Promise((ok) => setTimeout(ok, 250));
      uploads.retrying = false;
      if (uploads.cancelled) throw e;
    }
  }
}

async function uploadOne({ dir, file, sub, overwrite, machine }) {
  const id = crypto.getRandomValues(new Uint32Array(3)).reduce((text, n) => text + n.toString(36), "").padEnd(8, "0").slice(0, 24);
  const base = uploads.sent;
  let offset = 0;
  do {
    const blob = file.slice(offset, offset + UPLOAD_PART);
    const last = offset + blob.size >= file.size;
    const query = new URLSearchParams({ dir, name: file.name, sub, id, offset, last: last ? "1" : "0", overwrite: overwrite ? "1" : "0" });
    try {
      await sendPartAgain(filesApi("/upload", machine) + "?" + query, blob, offset, last, (loaded) => ((uploads.sent = base + offset + loaded), paintUpload()));
    } catch (e) {
      if (offset > 0 || uploads.cancelled) void fetch(`${filesApi("/upload", machine)}?${new URLSearchParams({ dir, sub, id })}`, { method: "DELETE" }).catch(() => {});
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
    h("div", { class: "grow stack-s" }, h("div", { class: "upload-line" }, h("strong", { class: "grow clip" }, t("files.uploading", { done: Math.min(done + 1, count), n: count })), h("span", { class: "muted small mono" }, uploads.retrying ? t("files.uploadRetrying") : [percent + "%", speed && `${bytes(speed)}/s`, speed && sent < total && duration(Math.max(60, (total - sent) / speed))].filter(Boolean).join(" · "))), h("div", { class: "bar" }, fill)),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("common.cancel"), title: t("common.cancel"), onclick: () => ((uploads.cancelled = true), (uploads.queue = []), uploads.xhr?.abort()) }, icon("x")),
  );
}

const queueUpload = (dir, items, overwrite = false) => queueUploadOn(filesMachine(), dir, items, overwrite);

function queueUploadOn(machine, dir, items, overwrite = false) {
  if (!items.length) return;
  if (!uploads.running) Object.assign(uploads, { count: 0, done: 0, bytes: 0, sent: 0, started: Date.now(), failed: [], conflicts: [], cancelled: false });
  for (const item of items) {
    uploads.queue.push({ dir, overwrite, machine, ...item });
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
      if (!item.overwrite && !item.sub && state.files?.path === item.dir && (state.files.machine ?? "") === item.machine && state.files.entries.some((entry) => entry.name === item.file.name)) {
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
    h("footer", null, closeButton(() => dialog, t("files.skip")), button(t("files.replace"), { class: "danger", onclick: () => (dialog.close(), queueUploadOn(conflicts[0].machine, conflicts[0].dir, conflicts.map(({ file, sub }) => ({ file, sub })), true)) })),
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

/** A store added by its address: the repository is read first, and one with no app Hata can read is refused */
function addStoreForm() {
  const input = h("input", { type: "url", class: "mono grow", placeholder: "https://github.com/…", "aria-label": t("store.address"), spellcheck: false, required: true });
  const error = h("p", { class: "error", role: "alert" });
  const go = h("button", { class: "btn" }, icon("plus"), h("span", null, t("store.add")));
  return h(
    "form",
    {
      class: "stack-s add-store",
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        go.disabled = true;
        go.lastChild.textContent = t("store.adding");
        try {
          const res = await api("POST", "/api/stores", { url: input.value });
          toast(t("store.added", { apps: res.apps }));
          await loadStore();
          renderSettings();
        } catch (err) {
          error.textContent = errorText(err);
          go.disabled = false;
          go.lastChild.textContent = t("store.add");
        }
      },
    },
    h("span", { class: "form-label" }, t("store.address")),
    h("div", { class: "row-actions" }, input, go),
    h("span", { class: "muted small" }, t("store.addHint")),
    error,
  );
}

function removeStoreDialog(store) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("store.removeTitle", { id: store.id })),
    h("p", { class: "muted" }, t("store.removeText")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("store.remove"), {
        class: "danger",
        onclick: async () => {
          dialog.close();
          await api("DELETE", `/api/stores/${store.id}`).catch((e) => toast(errorText(e), "error"));
          await loadStore();
          renderSettings();
        },
      }),
    ),
  );
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
    h("div", { class: "store" }, h("nav", { class: "cats fold", id: "cats", "aria-label": t("store.categories") }), h("div", { id: "store-list" })),
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

  // the same app in two stores: each card says whose it is
  const twice = new Set(all.filter((a, i) => all.findIndex((b) => b.name === a.name) !== i).map((a) => a.name));
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
          { type: "button", class: "store-card" + (a.supported ? "" : " unsupported"), onclick: () => (installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)), menu: (at) => storeCardMenu(a, installed.has(a.name), at) },
          h("span", { class: "store-card-head" }, appIcon(a), h("span", { class: "grow" }, h("span", { class: "tile-name" }, a.title), h("span", { class: "muted small" }, twice.has(a.name) ? `${a.category} · ${a.storeName}` : a.category)), installed.has(a.name) ? h("span", { class: "chip ok" }, icon("check"), t("store.installed")) : h("span", { class: "chip" }, t("store.install"))),
          h("span", { class: "tagline" }, a.tagline),
        ),
      ),
    ),
  );
}

function formSection(title, hint, rows) {
  return rows.length > 0 && h("section", { class: "form-section" }, h("div", { class: "form-head" }, h("h3", null, title), hint && h("span", { class: "muted small" }, hint)), rows);
}

/**
 * The settings of an app of Hata's format: each one a variable of the app's `.env`. On install a secret
 * is made by Hata and not shown; afterwards a secret or a password is left as it is unless typed anew.
 * Returns the rows, the advanced ones under "More", and the answers by name.
 */
function settingFields(settings, installing) {
  const inputs = [];
  const rowOf = (s) => {
    if (s.type === "secret" && installing) return null;
    let input;
    if (s.type === "switch") input = h("input", { type: "checkbox", checked: s.value === "true" });
    else if (s.type === "choice") input = choice(s.value, s.options.map((o) => [o.value, o.label]), s.label);
    else {
      const hidden = s.type === "secret" || s.type === "password";
      input = h("input", {
        value: s.value,
        type: hidden ? "password" : s.type === "url" ? "url" : "text",
        inputMode: s.type === "port" || s.type === "number" ? "numeric" : undefined,
        class: "mono" + (s.type === "port" ? " short" : ""),
        spellcheck: false,
        autocapitalize: "none",
        autocomplete: hidden ? "new-password" : "off",
        required: s.required && !s.set,
        placeholder: hidden && s.set ? t("store.settingKept") : "",
      });
    }
    inputs.push({ name: s.name, type: s.type, input });
    const control =
      s.type === "folder"
        ? h("span", { class: "with-pick" }, input, h("button", { type: "button", class: "icon-btn", title: t("edit.pickFolder"), "aria-label": t("edit.pickFolder"), onclick: () => folderPicker({ title: t("edit.pickFolder"), start: input.value.startsWith("/") ? input.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void (input.value = path) }) }, icon("folder")))
        : s.type === "port"
          ? h("span", { class: "pair" }, input, s.busy && h("span", { class: "chip warn" }, t("store.portMoved", { port: s.busy })))
          : input;
    return formRow(s.label, control, s.hint);
  };
  const rows = settings.filter((s) => !s.advanced).map(rowOf).filter(Boolean);
  const more = settings.filter((s) => s.advanced).map(rowOf).filter(Boolean);
  return {
    rows,
    more: more.length > 0 && h("details", { class: "form-more" }, h("summary", null, t("store.more")), more),
    value: () => Object.fromEntries(inputs.map(({ name, type, input }) => [name, type === "switch" ? input.checked : input.value])),
  };
}

/** `target` — the machine to install on; "" — this server */
async function storeDialog(entry, target = state.installTarget ?? "") {
  // the machines an app can go to: connected, with Docker
  if (isAdmin() && !machinesUi.list) machinesUi.list = await api("GET", "/api/machines").catch(() => null);
  const targets = isAdmin() ? (machinesUi.list?.machines ?? []).filter((m) => m.online && m.info?.docker?.available) : [];
  if (target && !targets.some((m) => m.id === target)) target = "";
  let app;
  try {
    app = await api("GET", `/api/store/${entry.store}/apps/${entry.name}?lang=${state.lang}${target ? "&machine=" + target : ""}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const arch = target ? (targets.find((m) => m.id === target)?.info.arch === "arm64" ? "arm64" : "amd64") : state.overview?.arch;
  const supported = app.architectures.length === 0 || app.architectures.includes(arch);
  const settingsForm = app.form.settings ? settingFields(app.form.settings, true) : null;
  const inputs = { ports: [], volumes: [], envs: [] };
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
      const form = settingsForm
        ? { settings: settingsForm.value() }
        : {
            ports: inputs.ports.map(({ input, ...p }) => ({ ...p, published: input.value })),
            volumes: inputs.volumes.map(({ input, ...v }) => ({ ...v, source: input.value })),
            envs: inputs.envs.map(({ input, ...e }) => ({ ...e, value: input.value })),
          };
      try {
        const res = await api("POST", target ? `/api/machines/${target}/apps` : "/api/apps", { store: app.store, name: app.name, form });
        dialog.close();
        state.installTarget = "";
        jobDialog(res.job, "install", app.title, () => go(target ? `#/machines/${target}/apps` : `#/apps/${app.name}`));
      } catch (e) {
        error.textContent = errorText(e);
        install.disabled = false;
      }
    },
  });

  // where it goes, next to the button that puts it there; with no machine ready, the way to connect one
  const here = t("store.whereHere", { name: state.overview?.system.hostname ?? "Hata" });
  const where =
    isAdmin() &&
    h(
      "div",
      { class: "store-where grow" },
      h("label", { for: "store-target" }, t("store.where")),
      targets.length > 0
        ? h("select", { id: "store-target", onchange: (e) => (dialog.close(), void storeDialog(entry, e.target.value)) }, h("option", { value: "", selected: !target }, here), targets.map((m) => h("option", { value: m.id, selected: m.id === target }, t("store.whereMachine", { name: m.name }))))
        : h("span", null, here),
      targets.length === 0 && h("a", { class: "link small", href: "#/machines", title: t(machinesUi.list?.machines?.length ? "store.whereNoneReady" : "store.whereNone"), onclick: () => dialog.close() }, t("store.whereOther")),
    );
  const hasForm = isAdmin() && (settingsForm ? settingsForm.rows.length > 0 || settingsForm.more : ports.length + volumes.length + envs.length > 0);
  // what the app asks of the server beyond its folders and ports, said before it is installed
  const permissions = app.permissions.length > 0 && h("div", { class: "tips prose" }, h("strong", null, t("store.permissions")), h("ul", null, app.permissions.map((p) => h("li", null, h("strong", null, t(`store.permission.${p.id}`)), " — ", p.why))));
  dialog = openDialog(
    "xwide store-app",
    h("header", null, appIcon(app, "lg"), h("div", { class: "grow" }, h("h2", null, app.title), h("p", { class: "muted" }, app.tagline), h("p", { class: "muted small" }, [app.category, app.developer && t("store.by", { developer: app.developer }), app.version && t("store.version", { version: app.version })].filter(Boolean).join(" · "))), closeX(() => dialog)),
    !supported && h("p", { class: "banner" }, t("store.unsupported", { arch: arch ?? "" })),
    app.screenshots.length > 0 && shotsView(app.screenshots),
    h(
      "div",
      { class: "store-app-body" },
      h(
        "div",
        { class: "stack" },
        h("div", { class: "description prose" }, md(app.description)),
        app.tips && h("div", { class: "tips prose" }, h("strong", null, t("store.tips")), md(app.tips)),
        permissions,
        app.website && h("a", { class: "link", href: app.website, target: "_blank", rel: "noopener noreferrer" }, app.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), icon("external")),
        h("p", { class: "cmd small" }, icon("terminal"), `docker compose -p ${app.name} up -d`),
      ),
      hasForm && settingsForm && h("div", { class: "stack install-form" }, formSection(t("store.settings"), t("store.settingsHint"), settingsForm.rows), settingsForm.more),
      hasForm && !settingsForm && h("div", { class: "stack install-form" }, formSection(t("store.ports"), target ? t("store.portsOn", { name: targets.find((m) => m.id === target)?.name ?? "" }) : t("store.portsHint"), ports), formSection(t("store.volumes"), target ? t("store.volumesHint", { path: app.form.volumes[0]?.source.split("/AppData/")[0] || "/DATA" }) : state.settings ? t("store.volumesHint", { path: state.settings.dataRoot }) : "", volumes), formSection(t("store.envs"), t("store.envsHint"), envs)),
    ),
    error,
    h("footer", null, where, closeButton(() => dialog, t("common.cancel")), install),
  );
  // the dialog would otherwise put the focus ring on its close button
  (install.disabled ? dialog : install).focus();
}

/** An app's screenshots one at a time across the whole width: arrows, a swipe, the arrow keys */
function shotsView(list) {
  let shots = list.map((src) => h("a", { href: src, target: "_blank", rel: "noopener noreferrer", draggable: "false" }, h("img", { src, alt: "", referrerPolicy: "no-referrer", draggable: "false" })));
  let at = 0;
  const stage = h("div", { class: "shot-stage", tabindex: "0", "aria-roledescription": "carousel" });
  const count = h("span", { class: "shot-count" });
  const step = (by) => show(at + by);
  const prev = h("button", { type: "button", class: "icon-btn shot-prev", "aria-label": t("store.shotPrev"), onclick: () => step(-1) }, icon("chevron", "flip"));
  const next = h("button", { type: "button", class: "icon-btn shot-next", "aria-label": t("store.shotNext"), onclick: () => step(1) }, icon("chevron"));
  const view = h("div", { class: "shot-view" }, stage, prev, next, count);
  const show = (i) => {
    if (!shots.length) return view.remove();
    at = (i + shots.length) % shots.length;
    stage.replaceChildren(shots[at]);
    count.textContent = `${at + 1} / ${shots.length}`;
    prev.hidden = next.hidden = count.hidden = shots.length < 2;
  };
  // a picture that does not load leaves the row
  for (const a of shots) a.firstChild.addEventListener("error", () => ((shots = shots.filter((x) => x !== a)), show(Math.min(at, shots.length - 1))));
  stage.addEventListener("keydown", (e) => (e.key === "ArrowLeft" || e.key === "ArrowRight") && (e.preventDefault(), step(e.key === "ArrowLeft" ? -1 : 1)));
  let from = null;
  let swiped = false;
  stage.addEventListener("pointerdown", (e) => ((from = e.clientX), (swiped = false)));
  stage.addEventListener("pointerup", (e) => {
    const moved = from === null ? 0 : e.clientX - from;
    from = null;
    if (Math.abs(moved) > 40 && shots.length > 1) ((swiped = true), step(moved < 0 ? 1 : -1));
  });
  // a swipe is not a click on the picture, which opens it whole
  stage.addEventListener("click", (e) => swiped && e.preventDefault(), true);
  show(0);
  return view;
}

function customDialog() {
  const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono" });
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", required: true, placeholder: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - 8088:80\n" });
  const memoryTotal = Math.round((state.overview?.system.memory.total ?? 0) / 1024 / 1024);
  // the first service of a new app has no name of its own: it takes the app's
  let form = appSettingsForm({ title: "", icon: "", web: { scheme: "http", host: "", port: "", path: "/" }, services: [blankService("")] }, memoryTotal);
  const holder = h("div", null, form.el);
  const error = h("p", { class: "error", role: "alert" });
  const lead = h("p", { class: "muted small" });
  const modes = h("div", { class: "modes" });
  const notice = h("div", { class: "banner stack", hidden: true });
  const file = field(t("store.customCompose"), area);
  // the third way in: a command from an app's instructions, read into the form
  const command = h("textarea", { class: "code", spellcheck: false, placeholder: "docker run -d --name whoami -p 8088:80 traefik/whoami" });
  const run = h("div", { class: "stack" }, field(t("run.command"), command));
  const submit = h("button", { class: "btn primary" }, t("store.install"));
  /** form | file | run */
  let current = "form";
  const fromRun = (read) => {
    form = appSettingsForm({ ...read.edit, services: read.edit.services.map((service) => ({ ...service, name: "" })) }, memoryTotal);
    holder.replaceChildren(form.el);
    if (!name.value.trim()) name.value = read.name;
    put(notice, read.ignored.length > 0 && [h("p", { class: "small" }, t("run.ignored")), read.ignored.map((option) => h("p", { class: "mono small" }, option))]);
  };
  const mode = (next) => {
    current = next;
    put(modes, ["form", "file", "run"].map((value) => h("button", { type: "button", class: "mode" + (value === next ? " active" : ""), onclick: () => mode(value) }, t(`store.custom.${value}`))));
    lead.textContent = t(`store.custom.${next}Lead`);
    holder.hidden = next !== "form";
    notice.hidden = next !== "form" || !notice.hasChildNodes();
    file.hidden = next !== "file";
    run.hidden = next !== "run";
    // a hidden field must not hold the form back
    area.required = next === "file";
    command.required = next === "run";
    name.required = next !== "run";
    submit.textContent = t(next === "run" ? "run.read" : "store.install");
  };
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          const app = name.value.trim();
          try {
            if (current === "run") {
              fromRun(await api("POST", "/api/dockerrun", { command: command.value }));
              return mode("form");
            }
            const asForm = current === "form";
            const settings = form.value();
            for (const service of settings.services) service.name ||= app;
            const res = await api("POST", `/api/apps?lang=${state.lang}`, asForm ? { name: app, settings } : { name: app, compose: area.value });
            dialog.close();
            const picture = asForm ? form.pickedIcon() : null;
            jobDialog(res.job, "install", (asForm && settings.title) || app, async () => {
              if (picture) await uploadAppIcon(app, picture).catch((err) => toast(errorText(err), "error"));
              go(`#/apps/${app}`);
            });
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("store.customTitle")), lead), closeX(() => dialog)),
      modes,
      notice,
      field(t("store.customName"), name, t("store.customNameHint")),
      holder,
      file,
      run,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), submit),
    ),
  );
  mode("form");
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
  if (state.route.view === "welcome") paintWelcome();
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
  if (!box || !state.import) return;
  box.replaceChildren(...importParts(state.import, h("div", { class: "card empty" }, icon("check", "ok"), h("p", null, t("import.nothing")))));
}

/** What runs on this machine and is not an app here yet; `nothing` stands in when there is none */
function importParts(data, nothing) {
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
    !data.casaos && !data.projects.length && !data.containers.length && nothing,
  ];
  return parts.filter(Boolean);
}

// --- First run ----------------------------------------------------------------------------------
// The walk through a new server: every step only opens what the pages have anyway, so nothing here
// is the one place a thing can be done.

const WELCOME_STEPS = ["admin", "server", "existing", "data", "backups", "apps"];

/** The language of this browser; `then` — what to load again in it */
function languageSelect(then) {
  const select = h(
    "select",
    {
      "aria-label": t("settings.language"),
      onchange: async () => {
        localStorage.setItem("hata.lang", select.value);
        await loadLanguage(select.value);
        state.store = null;
        await refresh();
        render();
        then?.();
      },
    },
    state.languages.map((code) => h("option", { value: code, selected: code === state.lang }, LANGUAGE_NAMES[code] ?? code)),
  );
  return select;
}

async function endWelcome() {
  if (state.welcome) state.settings = await api("PUT", "/api/settings", { welcome: false });
  state.welcome = false;
}

function welcomeFrame(step, ...content) {
  const at = WELCOME_STEPS.indexOf(step);
  const item = (id, i) => {
    const inner = [h("span", { class: "welcome-num" }, i < at ? icon("check") : String(i + 1)), h("span", { class: "grow" }, h("strong", null, t(`welcome.step.${id}`)), h("span", { class: "muted small block" }, id === "admin" && state.user ? state.user.name : t(`welcome.step.${id}.hint`)))];
    // the administrator is made once; the other steps can be visited in any order
    return h("li", { class: i === at ? "current" : i < at ? "done" : "" }, state.user && id !== "admin" ? h("a", { href: `#/welcome/${id}`, "aria-current": i === at ? "step" : null }, inner) : h("span", null, inner));
  };
  $app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("span", { class: "brand" }, logo(), "hata"),
      h("span", { class: "muted welcome-label" }, t("welcome.title")),
      h(
        "div",
        { class: "top-right" },
        languageSelect(() => state.user && void loadWelcome()),
        state.user &&
          button(t("welcome.leave"), {
            class: "quiet",
            onclick: async () => {
              await endWelcome().catch((e) => toast(errorText(e), "error"));
              go("#/");
            },
          }),
      ),
    ),
    h("div", { class: "welcome" }, h("ol", { class: "welcome-steps" }, WELCOME_STEPS.map(item)), h("main", { class: "welcome-main stack" }, h("p", { class: "eyebrow" }, t("welcome.stepOf", { n: at + 1, of: WELCOME_STEPS.length })), content)),
  );
}

function renderWelcome() {
  welcomeFrame(state.route.step, h("div", { class: "stack", id: "welcome-body" }));
  paintWelcome();
}

async function loadWelcome() {
  const step = state.route.step;
  const quiet = (path) => api("GET", path).catch(() => null);
  const [settings, local, found, disks, store] = await Promise.all([
    quiet("/api/settings"),
    step === "server" ? quiet("/api/local") : state.local,
    step === "existing" ? quiet("/api/import") : state.import,
    step === "data" || step === "backups" ? quiet("/api/disks") : state.disks,
    step === "apps" ? quiet(`/api/store?lang=${state.lang}`) : state.store,
  ]);
  Object.assign(state, { settings: settings ?? state.settings, local, import: found, disks, store });
  if (state.route.view === "welcome" && state.route.step === step) paintWelcome();
}

/** The file system a folder lies on: the deepest mount point above it */
const placeOf = (folder, mounts) => mounts.filter((m) => m.path === "/" || folder === m.path || folder.startsWith(m.path + "/")).sort((a, b) => b.path.length - a.path.length)[0] ?? null;

function welcomeFoot(step, save) {
  const at = WELCOME_STEPS.indexOf(step);
  const last = at === WELCOME_STEPS.length - 1;
  const error = h("p", { class: "error", role: "alert" });
  const next = button(t(last ? "welcome.finish" : "welcome.next"), {
    class: "primary",
    onclick: async () => {
      next.disabled = true;
      error.textContent = "";
      try {
        await save?.();
        if (last) await endWelcome();
        go(last ? "#/" : `#/welcome/${WELCOME_STEPS[at + 1]}`);
      } catch (e) {
        error.textContent = errorText(e);
        next.disabled = false;
      }
    },
  });
  return [error, h("footer", { class: "welcome-foot" }, at > 1 ? h("a", { class: "btn", href: `#/welcome/${WELCOME_STEPS[at - 1]}` }, t("welcome.back")) : h("span"), next)];
}

/** Docker in one card: there and running, or what is missing with the button that brings it */
function welcomeDocker() {
  const d = state.overview?.docker;
  if (!d) return null;
  if (d.available) return h("section", { class: "card pad welcome-fact" }, h("span", { class: "badge-icon ok" }, icon("check")), h("div", { class: "grow" }, h("strong", null, t("welcome.docker.ok")), h("p", { class: "muted small" }, [d.version && `Docker ${d.version}`, d.compose && `Compose ${d.compose}`].filter(Boolean).join(" · "))));
  const stopped = d.state === "stopped";
  return h(
    "section",
    { class: "card pad welcome-fact" },
    h("span", { class: "badge-icon warn" }, icon("alert")),
    h("div", { class: "grow" }, h("strong", null, t(stopped ? "attention.docker.stopped.title" : "attention.docker.missing.title")), h("p", { class: "muted small" }, t(stopped ? "welcome.docker.stopped" : "docker.why"))),
    stopped ? dockerStartButton() : button(t("docker.install"), { class: "small primary", onclick: dockerDialog }, "download"),
  );
}

function paintWelcome() {
  const box = document.getElementById("welcome-body");
  const step = state.route.step;
  const s = state.settings;
  if (!box) return;
  const head = [h("h1", null, t(`welcome.${step}.title`)), h("p", { class: "muted welcome-lead" }, t(`welcome.${step}.lead`))];
  const waiting = h("p", { class: "muted" }, "…");

  if (step === "server") {
    if (!s) return put(box, ...head, waiting);
    const name = h("input", { value: s.local.name, maxLength: 253, placeholder: "hata.local", spellcheck: false, autocapitalize: "none", class: "mono", required: true });
    const tz = h("input", { value: s.timezone, spellcheck: false, placeholder: s.systemTimezone, class: "mono" });
    const port = state.local && state.local.port !== 80 ? ":" + state.local.port : "";
    return put(
      box,
      ...head,
      h(
        "section",
        { class: "card pad" },
        settingRow(t("welcome.server.name"), t("local.nameHint"), name),
        settingRow(t("settings.timezone"), t("settings.timezoneHint", { tz: s.systemTimezone }), tz),
        state.local?.addresses.length > 0 && settingRow(t("welcome.server.address"), t("welcome.server.addressHint"), h("span", { class: "mono" }, state.local.addresses.map((a) => `http://${a}${port}`).join(", "))),
      ),
      ...welcomeFoot(step, async () => {
        const patch = { timezone: tz.value.trim(), language: state.lang };
        if (name.value.trim().toLowerCase() !== s.local.name) patch.local = { name: name.value };
        state.settings = await api("PUT", "/api/settings", patch);
      }),
    );
  }

  if (step === "existing") {
    const found = state.import;
    return put(box, ...head, welcomeDocker() ?? waiting, ...(found ? importParts(found, h("section", { class: "card pad welcome-fact" }, h("span", { class: "badge-icon ok" }, icon("check")), h("div", { class: "grow" }, h("strong", null, t("welcome.existing.nothing")), h("p", { class: "muted small" }, t("welcome.existing.nothingHint"))))) : []), ...welcomeFoot(step));
  }

  if (step === "data") {
    if (!s) return put(box, ...head, waiting);
    const disks = state.disks;
    const place = disks && placeOf(s.dataRoot, disks.mounts);
    const unused = (disks?.mounting?.unused ?? []).map((u) => u.id);
    const fresh = (disks?.disks ?? []).filter((d) => unused.includes(d.serial || d.name) && (canPrepare(d) || canConnect(d).length > 0));
    const diskRow = (disk) => {
      const holds = disk.volumes.filter((v) => v.fstype);
      const connectable = canConnect(disk);
      return h(
        "section",
        { class: "card pad welcome-fact" },
        h("span", { class: "badge-icon" }, icon("disk")),
        h("div", { class: "grow" }, h("strong", null, diskTitle(disk)), h("p", { class: "muted small" }, diskMeta(disk)), h("p", { class: "muted small" }, holds.length ? t("mounting.foundHolds", { what: holds.map((v) => [v.label, v.fstype].filter(Boolean).join(" · ")).join("; ") }) : t("mounting.foundEmpty"))),
        h("div", { class: "row-actions" }, connectable.length > 0 && button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(disk, connectable[0]) }), canPrepare(disk) && button(t("mounting.format"), { class: "small", onclick: () => formatDialog(disk) })),
      );
    };
    return put(
      box,
      ...head,
      h(
        "section",
        { class: "card pad welcome-fact" },
        h("span", { class: "badge-icon" }, icon("folder")),
        h(
          "div",
          { class: "grow" },
          h("strong", { class: "mono" }, s.dataRoot),
          h("p", { class: "muted small" }, place ? t("welcome.data.on", { device: place.device, path: place.path, free: bytes(Math.max(0, place.total - place.used)), total: bytes(place.total) }) : t("welcome.data.unknown")),
          place?.path === "/" && h("p", { class: "muted small" }, t("welcome.data.system")),
        ),
        h("div", { class: "row-actions" }, button(t("data.choose"), { class: "small", onclick: () => pickDataRoot() }, "folder")),
      ),
      h("div", { class: "section-head" }, h("h2", null, t("welcome.data.disks")), h("a", { class: "link small", href: "#/settings/storage" }, t("welcome.data.all"))),
      !disks ? waiting : fresh.length ? fresh.map(diskRow) : h("p", { class: "muted" }, t("welcome.data.noDisks")),
      fresh.length > 0 && h("p", { class: "muted small" }, t("welcome.data.how")),
      ...welcomeFoot(step),
    );
  }

  if (step === "backups") {
    if (!s) return put(box, ...head, waiting);
    const b = s.backup;
    const mounts = state.disks?.mounts ?? [];
    // offered switched on: the step is here to be answered, and the answer is saved only by "Continue"
    const enabled = h("input", { type: "checkbox", checked: b.enabled || state.welcome });
    const time = h("input", { type: "time", value: b.time, required: true });
    const keep = h("input", { type: "number", min: 1, max: 365, value: b.keep, required: true, class: "short" });
    const dir = h("input", { value: b.dir, spellcheck: false, placeholder: `${s.dataRoot}/Backups`, class: "mono" });
    const same = h("p", { class: "banner" }, t("welcome.backups.sameDisk"));
    const check = () => {
      const [data, copy] = [placeOf(s.dataRoot, mounts), placeOf(dir.value.trim() || `${s.dataRoot}/Backups`, mounts)];
      same.hidden = !data || !copy || data.path !== copy.path;
    };
    dir.addEventListener("input", check);
    check();
    const places = Object.keys(state.disks?.mounting?.ours ?? {}).filter((path) => !(s.dataRoot + "/").startsWith(path + "/"));
    return put(
      box,
      ...head,
      h(
        "section",
        { class: "card pad stack" },
        h("label", { class: "check" }, enabled, h("span", null, h("strong", null, t("backup.enable")), h("span", { class: "muted small block" }, t("backup.enableHint")))),
        h("div", { class: "field-row" }, field(`${t("backup.time")} · ${s.timezone || s.systemTimezone}`, time), field(t("backup.keep"), keep)),
        field(t("backup.dir"), dir, t("backup.dirHint")),
        places.length > 0 && h("div", { class: "row-actions wrap" }, places.map((path) => button(`${path}/Backups`, { class: "small mono", onclick: () => ((dir.value = `${path}/Backups`), check()) }))),
        same,
      ),
      h("p", { class: "muted small" }, t("welcome.backups.more"), " ", h("a", { class: "link", href: "#/settings/backups" }, t("nav.backups"))),
      ...welcomeFoot(step, async () => {
        state.settings = await api("PUT", "/api/settings", { backup: { enabled: enabled.checked, time: time.value, keep: Number(keep.value), dir: dir.value.trim() } });
      }),
    );
  }

  // the last step: whoever got here has seen the choices, the server stops opening with them
  if (state.welcome) void endWelcome().catch(() => {});
  const store = state.store;
  const docker = state.overview?.docker;
  const installed = new Set((state.overview?.apps ?? []).map((a) => a.name));
  const offered = (store?.apps ?? []).filter((a) => a.recommended && a.supported).slice(0, 9);
  const busy = store?.stores.some((x) => x.syncing);
  put(
    box,
    ...head,
    docker && !docker.available && welcomeDocker(),
    !store
      ? waiting
      : offered.length
        ? h(
            "div",
            { class: "cards" },
            offered.map((a) =>
              h(
                "button",
                { type: "button", class: "store-card", onclick: () => (installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)), menu: (at) => storeCardMenu(a, installed.has(a.name), at) },
                h("span", { class: "store-card-head" }, appIcon(a), h("span", { class: "grow" }, h("span", { class: "tile-name" }, a.title), h("span", { class: "muted small" }, twice.has(a.name) ? `${a.category} · ${a.storeName}` : a.category)), installed.has(a.name) ? h("span", { class: "chip ok" }, icon("check"), t("store.installed")) : h("span", { class: "chip" }, t("store.install"))),
                h("span", { class: "tagline" }, a.tagline),
              ),
            ),
          )
        : h("div", { class: "card empty" }, h("p", null, t(busy ? "store.syncing" : "store.empty")), !busy && button(t("store.sync"), { class: "primary", onclick: async () => (await syncStores(), loadWelcome()) }, "refresh")),
    h("p", { class: "muted small" }, t("welcome.apps.more"), " ", h("a", { class: "link", href: "#/store" }, t("nav.store"))),
    ...welcomeFoot(step),
  );
}

// --- Settings -----------------------------------------------------------------------------------

async function loadSettings() {
  try {
    state.account = await api("GET", "/api/account");
    if (isAdmin()) state.settings = await api("GET", "/api/settings");
    if (isAdmin()) state.update = await api("GET", "/api/update").catch(() => null);
    if (isAdmin()) state.notify = await api("GET", "/api/notify").catch(() => null);
    if (isAdmin() && state.route.section === "apps") state.images = await api("GET", "/api/images").catch(() => null);
    if (isAdmin() && state.route.section === "network") state.network = await api("GET", "/api/network").catch(() => null);
    if (isAdmin() && state.route.section === "remote") [state.remote, state.wireguard] = await Promise.all([api("GET", "/api/tailscale").catch(() => null), api("GET", "/api/wireguard").catch(() => null)]);
    if (isAdmin() && state.route.section === "tools") [state.tools, sysUpdates[""]] = await Promise.all([api("GET", "/api/tools").catch(() => null), api("GET", "/api/system/updates").catch((e) => ({ error: errorText(e) }))]);
    // counting the volumes takes a while: the page is shown first
    if (isAdmin() && state.route.section === "docker") void loadSpace();
    if (isAdmin() && state.route.section === "storage") [state.disks, state.places] = await Promise.all([api("GET", "/api/disks").catch(() => null), api("GET", "/api/netplaces").catch(() => null)]);
    if (isAdmin() && state.route.section === "shares") state.shares = await api("GET", "/api/shares").catch(() => null);
    if (isAdmin() && state.route.section === "agents") state.agents = await api("GET", "/api/agents").catch(() => null);
    if (isAdmin() && state.route.section === "assistant") state.assistant = await api("GET", "/api/assistant").catch(() => null);
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
  { id: "users", icon: "user", admin: true, label: "nav.users" },
  { id: "backups", icon: "archive", admin: true, label: "nav.backups" },
  { id: "appearance", icon: "image", admin: true },
  { id: "apps", icon: "grid", admin: true },
  { id: "docker", icon: "box", admin: true },
  { id: "stores", icon: "store", admin: true },
  { id: "storage", icon: "disk", admin: true },
  { id: "shares", icon: "share", admin: true },
  { id: "network", icon: "network", admin: true },
  { id: "remote", icon: "globe", admin: true },
  { id: "https", icon: "lock", admin: true },
  { id: "notifications", icon: "bell", admin: true },
  { id: "agents", icon: "key", admin: true },
  { id: "assistant", icon: "chat", admin: true },
  { id: "tools", icon: "terminal", admin: true },
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
  const back = u.previous && !u.unsupported && button(t("update.back", { version: u.previous }), { class: "small ghost", disabled: busy, onclick: () => rollbackDialog(u) });
  return settingRow(
    u.available ? t("update.available", { version: u.latest.version }) : t("update.title2"),
    hint,
    h("div", { class: "row-actions" }, u.available && u.latest.url && h("a", { class: "link small", href: u.latest.url, target: "_blank", rel: "noopener noreferrer" }, t("update.notes"), icon("external")), back, check, install),
  );
}

/** Which releases are offered: stable ones, or pre-releases too; the check runs again at once */
function channelRow() {
  if (!state.update || !state.settings) return null;
  const channel = state.settings.update?.channel ?? "stable";
  const pick = h(
    "select",
    {
      "aria-label": t("update.channel"),
      onchange: async () => {
        pick.disabled = true;
        try {
          state.settings = await api("PUT", "/api/settings", { update: { channel: pick.value } });
          state.update = await api("POST", "/api/update/check", {}).catch(() => state.update);
        } catch (e) {
          toast(errorText(e), "error");
        }
        renderSettings();
      },
    },
    ["stable", "beta"].map((value) => h("option", { value, selected: value === channel }, t("update.channel." + value))),
  );
  return settingRow(t("update.channel"), t(channel === "beta" ? "update.channelBetaHint" : "update.channelHint"), pick);
}

/** The daily install of the version offered; off unless turned on, and only where Hata can replace itself */
function autoUpdateRow() {
  if (!state.update || !state.settings || state.update.unsupported) return null;
  const u = state.settings.update;
  const save = async (patch) => {
    try {
      state.settings = await api("PUT", "/api/settings", { update: patch });
    } catch (e) {
      toast(errorText(e), "error");
    }
    renderSettings();
  };
  const auto = h("input", { type: "checkbox", checked: u.auto, "aria-label": t("update.auto"), onchange: () => save({ auto: auto.checked }) });
  const time = h("input", { type: "time", value: u.time, class: "short mono", required: true, "aria-label": t("update.autoTime"), hidden: !u.auto, onchange: () => time.value && save({ time: time.value }) });
  return settingRow(t("update.auto"), t(u.auto ? "update.autoOnHint" : "update.autoHint", { zone: state.settings.systemTimezone }), h("div", { class: "row-actions" }, time, auto));
}

/** Going back to the version that ran before: the same watched restart as an update */
function rollbackDialog(u) {
  let dialog;
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("update.backGo", { version: u.previous }), {
    class: "primary",
    onclick: async () => {
      go.disabled = true;
      try {
        await api("POST", "/api/update/rollback", {});
        dialog.close();
        state.update = { ...u, stage: "restart", error: "" };
        renderSettings();
        void followUpdate(u.previous);
      } catch (e) {
        error.textContent = errorText(e);
        go.disabled = false;
      }
    },
  });
  dialog = openDialog("", h("h2", null, t("update.backTitle", { version: u.previous })), h("p", { class: "muted" }, t("update.backLead", { from: u.current, version: u.previous })), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

/** The configuration folder: where it is, and moving it — which restarts Hata in the new place */
/** What the server answered a move with: a job to follow, or the folder simply chosen (nothing was there to move) */
function dataRootMoved(res, done) {
  if (!res.job) {
    toast(t("data.chosen", { path: res.path }));
    return void done();
  }
  jobDialog(res.job, "move", "", done);
}

async function afterDataRoot() {
  state.settings = await api("GET", "/api/settings");
  if (state.route.view === "settings") renderSettings();
  if (state.route.view === "welcome") void loadWelcome();
}

/** The data folder chosen with the folder picker; a folder that holds data already is moved there */
function pickDataRoot() {
  const current = state.settings.dataRoot;
  folderPicker({
    title: t("data.chooseTitle"),
    start: current.split("/").slice(0, -1).join("/") || "/",
    confirmLabel: t("data.chooseHere"),
    allowed: (at) => at !== "/" && at !== current,
    action: async (path) => dataRootMoved(await api("POST", "/api/data-root/move", { path }), afterDataRoot),
  });
}

/** Moves the data folder with everything in it; `suggested` — a folder to offer (a disk just formatted) */
async function moveDataDialog(suggested = "") {
  const s = state.settings;
  const target = h("input", { type: "text", value: suggested, spellcheck: false, class: "mono", placeholder: "/mnt/disk/DATA" });
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("data.moveGo"), { class: "primary", disabled: !suggested });
  target.addEventListener("input", () => (go.disabled = !target.value.trim().startsWith("/")));
  // the disks Hata connected are where the folder usually goes
  const disks = await api("GET", "/api/disks").catch(() => null);
  const branches = Object.values(disks?.mounting?.pools ?? {}).flat();
  const places = Object.keys(disks?.mounting?.ours ?? {}).filter((path) => !(s.dataRoot + "/").startsWith(path + "/") && !branches.includes(path));
  let dialog;
  go.onclick = async () => {
    error.textContent = "";
    go.disabled = true;
    try {
      const res = await api("POST", "/api/data-root/move", { path: target.value.trim() });
      dialog.close();
      dataRootMoved(res, afterDataRoot);
    } catch (e) {
      error.textContent = errorText(e);
      go.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h("h2", null, t("data.moveTitle")),
    h("p", { class: "muted" }, t("data.moveLead", { from: s.dataRoot })),
    field(t("data.target"), h("span", { class: "pair" }, target, button(t("data.choose"), { onclick: () => folderPicker({ title: t("data.chooseTitle"), start: target.value.startsWith("/") ? target.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void ((target.value = path), (go.disabled = false)) }) }, "folder")), t("data.targetHint")),
    places.length > 0 && h("div", { class: "row-actions wrap" }, places.map((path) => button(`${path}/DATA`, { class: "small mono", onclick: () => ((target.value = `${path}/DATA`), (go.disabled = false)) }))),
    h("p", { class: "banner" }, t("data.moveWarn")),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
}

function stateDirCard() {
  const s = state.settings;
  const path = h("input", { value: s.stateDir, spellcheck: false, required: true, class: "mono", "aria-label": t("state.title") });
  const error = h("p", { class: "error", role: "alert" });
  const move = button(t("state.move"), { disabled: true, onclick: () => confirmMove() });
  path.addEventListener("input", () => (move.disabled = !s.stateMovable || path.value.trim().replace(/\/+$/, "") === s.stateDir));
  const confirmMove = () => {
    const target = path.value.trim().replace(/\/+$/, "");
    const inData = target === s.dataRoot || target.startsWith(s.dataRoot.replace(/\/$/, "") + "/");
    const dialog = openDialog(
      "confirm",
      h("h2", null, t("state.moveTitle")),
      h("p", { class: "muted" }, t("state.moveLead", { from: s.stateDir, to: target })),
      inData && h("p", { class: "banner" }, t("state.inDataRoot", { path: s.dataRoot })),
      h(
        "footer",
        null,
        closeButton(() => dialog, t("common.cancel")),
        button(t("state.moveConfirm"), {
          class: "primary",
          onclick: async () => {
            dialog.close();
            error.textContent = "";
            try {
              await api("POST", "/api/state-dir", { path: target });
            } catch (e) {
              return (error.textContent = errorText(e));
            }
            move.disabled = path.disabled = true;
            toast(t("state.moving"));
            // the service is back when it answers from the new folder
            for (let i = 0; i < 60; i++) {
              await new Promise((r) => setTimeout(r, 1500));
              const now = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null), () => null);
              if (now?.stateDir === target) {
                toast(t("state.moved", { path: target }));
                return location.reload();
              }
            }
            error.textContent = t("state.notBack");
          },
        }),
      ),
    );
  };
  return h(
    "section",
    { class: "card pad" },
    h("h2", null, t("state.title")),
    h("p", { class: "muted small" }, t("state.lead")),
    settingRow(t("state.folder"), t(s.stateMovable ? "state.folderHint" : "state.notMovable"), h("span", { class: "pair" }, path, move)),
    error,
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
    const language = languageSelect(() => void loadSettings());
    const port = h("input", { type: "number", min: 1, max: 65535, class: "short mono", value: s?.port || "", placeholder: String(location.port || 80) });
    return [
      h("section", { class: "card pad" }, h("h2", null, t("settings.general")), settingRow(t("settings.language"), t("settings.languageHint"), language), isAdmin() && settingRow(t("settings.port"), t("settings.portHint"), h("span", { class: "pair" }, port, button(t("settings.save"), { onclick: () => save({ port: Number(port.value) || 0 }) }))), isAdmin() && settingRow(t("welcome.again"), t("welcome.againHint"), h("a", { class: "btn", href: "#/welcome" }, t("common.open"))), error),
      isAdmin() && h("section", { class: "card pad" }, h("h2", null, t("power.title")), settingRow(t("power.reboot"), t("power.rebootHint"), button(t("power.reboot"), { onclick: () => serverPowerDialog("reboot") }, "refresh")), settingRow(t("power.poweroff"), t("power.poweroffHint"), button(t("power.poweroff"), { onclick: () => serverPowerDialog("poweroff") }, "stop"))),
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
        settingRow(t("settings.dataRoot"), t("settings.dataRootHint"), h("span", { class: "pair" }, dataRoot, button(t("data.move"), { onclick: () => moveDataDialog() }))),
        settingRow(t("settings.ids"), t("settings.idsHint"), h("span", { class: "pair" }, puid, pgid)),
        settingRow(t("settings.timezone"), t("settings.timezoneHint", { tz: s.systemTimezone }), tz),
        error,
        h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
      ),
      imagesCard(),
      stateDirCard(),
    ];
  }
  if (section === "https") return httpsSection(save, error);
  if (section === "notifications") return notificationsSection();
  if (section === "storage") return storageSection();
  if (section === "shares") return sharesSection();
  if (section === "network") return networkSection();
  if (section === "tools") return toolsSection();
  if (section === "docker") return dockerSection();
  if (section === "remote") return remoteSection();
  if (section === "agents") return agentsSection();
  if (section === "assistant") return assistantSection();
  if (section === "stores") {
    const stores = state.store?.stores ?? [];
    return [
      h(
        "section",
        { class: "card pad" },
        h("div", { class: "section-head" }, h("h2", null, t("settings.stores")), button(t("store.sync"), { onclick: syncStores }, "refresh")),
        stores.map((store) =>
          settingRow(
            store.id,
            store.url,
            h("span", { class: "store-meta" }, h("span", { class: "muted small" }, t("settings.storeApps", { n: store.apps }) + (store.syncedAt ? " · " + ago(store.syncedAt) : "")), h("button", { type: "button", class: "icon-btn", title: t("store.remove"), "aria-label": `${t("store.remove")}: ${store.id}`, onclick: () => removeStoreDialog(store) }, icon("trash"))),
          ),
        ),
        addStoreForm(),
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
      channelRow(),
      autoUpdateRow(),
      settingRow("Docker", d?.available ? "" : (d?.error ?? ""), h("span", { class: "mono" }, d?.available ? `${d.version} · compose ${d.compose}` : "—")),
      settingRow(t("settings.source"), "", h("a", { class: "link", href: "https://github.com/sanyadez/hata", target: "_blank", rel: "noopener noreferrer" }, "github.com/sanyadez/hata", icon("external"))),
    ),
  ];
}

// --- Settings → Network: the interfaces of the server ---------------------------------------------

async function loadNetwork() {
  state.network = await api("GET", "/api/network").catch(() => state.network);
  if (state.route.view === "settings" && state.route.section === "network") renderSettings();
}

/**
 * A change of the network is on trial: this page keeps it as soon as it reaches the server again. When
 * the address itself changed the page cannot follow it — the link with the token does, opened by hand.
 */
function trialDialog(pending) {
  let over = false;
  const left = h("strong", null, "");
  const note = h("p", { class: "muted small" }, t("network.trial.checking"));
  const moved = pending.address && pending.address !== location.hostname && /^[\d.]+$/.test(location.hostname);
  const link = moved && `http://${pending.address}${location.port ? ":" + location.port : ""}/network/confirm?token=${pending.token}`;
  const finish = (message, kind) => {
    over = true;
    dialog.close();
    toast(message, kind);
    void loadNetwork();
  };
  const dialog = openDialog(
    "",
    h("header", null, h("h2", null, t("network.trial.title", { nic: pending.nic }))),
    h("p", null, t("network.trial.lead"), " ", left),
    note,
    link && h("div", { class: "banner stack" }, h("p", null, t("network.trial.moved", { address: pending.address })), h("a", { class: "link", href: link }, link.replace(/\?.*/, ""), icon("external"))),
    h(
      "footer",
      null,
      button(t("network.trial.revert"), {
        onclick: async () => {
          await api("POST", "/api/network/revert", {}).catch(() => {});
          finish(t("network.trial.reverted"));
        },
      }),
    ),
  );
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  const tick = async () => {
    if (over) return;
    const seconds = Math.round((pending.until - Date.now()) / 1000);
    left.textContent = t("network.trial.left", { n: Math.max(0, seconds) });
    // a few seconds for the change to take hold, so that what answers is the new state and not the old
    if (pending.until - Date.now() < (state.network.trial - 8) * 1000 && seconds % 3 === 0) {
      const now = await fetch("/api/network").then((r) => (r.ok ? r.json() : null), () => null);
      if (over) return;
      if (now?.pending?.token === pending.token) {
        const kept = await api("POST", "/api/network/confirm", {}).catch(() => null);
        if (kept) return finish(t("network.trial.kept"));
      } else if (now && !now.pending) return finish(t(seconds > 0 ? "network.trial.kept" : "network.trial.back"), seconds > 0 ? undefined : "error");
    }
    if (seconds < -15) return finish(t("network.trial.back"), "error");
    setTimeout(tick, 1000);
  };
  void tick();
}

function nicDialog(nic) {
  const auto = h("input", { type: "radio", name: "method", value: "auto", checked: nic.dynamic && !nic.shares });
  const manual = h("input", { type: "radio", name: "method", value: "manual", checked: !nic.dynamic && !nic.shares });
  const shared = h("input", { type: "radio", name: "method", value: "shared", checked: !!nic.shares });
  const canShare = !nic.wifi && nic.internet !== "main";
  const needs = h("div");
  const address = h("input", { class: "mono", value: nic.addresses[0] ?? "", placeholder: "192.168.1.10/24", spellcheck: false });
  const gateway = h("input", { class: "mono", value: nic.gateway, placeholder: "192.168.1.1", spellcheck: false });
  const dns = h("input", { class: "mono", value: nic.dynamic ? "" : nic.dns.join(", "), placeholder: "192.168.1.1, 1.1.1.1", spellcheck: false });
  const fixed = h("div", { class: "stack", hidden: !manual.checked }, field(t("network.address"), address, t("network.addressHint")), field(t("network.gateway"), gateway));
  const dnsField = field(t("network.dns"), dns, t("network.dnsHint"));
  dnsField.hidden = shared.checked;
  const own = h("input", { class: "mono", value: nic.shares ? (nic.addresses[0] ?? "") : "", placeholder: "10.42.0.1/24", spellcheck: false });
  const ownField = field(t("network.shareAddress"), own, t("network.shareAddressHint"));
  ownField.hidden = !shared.checked;
  // IPv6 is sent only when the profile has a setting this form knows, or the person chose one
  let touched6 = nic.v6.method !== "";
  const method6 = h("select", { onchange: () => ((touched6 = true), show6()) }, ["auto", "manual", "off"].map((m) => h("option", { value: m, selected: (nic.v6.method || "auto") === m }, t("network.v6." + m))));
  const address6 = h("input", { class: "mono", value: nic.v6.address, placeholder: "2001:db8::10/64", spellcheck: false });
  const gateway6 = h("input", { class: "mono", value: nic.v6.gateway, placeholder: "fe80::1", spellcheck: false });
  const dns6 = h("input", { class: "mono", value: nic.v6.dns.join(", "), placeholder: "2606:4700:4700::1111", spellcheck: false });
  const fixed6 = h("div", { class: "stack" }, field(t("network.address"), address6, t("network.address6Hint")), field(t("network.gateway"), gateway6));
  const dns6Field = field(t("network.dns"), dns6, t("network.dns6Hint"));
  const six = h("div", { class: "stack" }, field("IPv6", method6), fixed6, dns6Field);
  const show6 = () => {
    six.hidden = shared.checked;
    fixed6.hidden = method6.value !== "manual";
    dns6Field.hidden = method6.value === "off";
  };
  show6();
  auto.onchange = manual.onchange = shared.onchange = () => {
    fixed.hidden = !manual.checked;
    dnsField.hidden = shared.checked;
    ownField.hidden = !shared.checked;
    show6();
  };
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            needs.replaceChildren();
            const pending = await api("PUT", `/api/network/${nic.name}`, { method: shared.checked ? "shared" : auto.checked ? "auto" : "manual", address: shared.checked ? own.value : address.value, gateway: gateway.value, dns: dns.value, ...(touched6 && !shared.checked ? { v6: { method: method6.value, address: address6.value, gateway: gateway6.value, dns: dns6.value } } : {}) });
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            if (err.code === "network.needsPackage") needs.replaceChildren(hotspotNeeds(err.detail, error));
            else error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("network.change.title", { nic: nic.name })), closeX(() => dialog)),
      h("label", { class: "check" }, auto, h("span", null, h("strong", null, t("network.auto")), h("span", { class: "muted small block" }, t("network.autoHint")))),
      h("label", { class: "check" }, manual, h("span", null, h("strong", null, t("network.manual")), h("span", { class: "muted small block" }, t("network.manualHint")))),
      fixed,
      canShare && h("label", { class: "check" }, shared, h("span", null, h("strong", null, t("network.share")), h("span", { class: "muted small block" }, t("network.shareHint")))),
      ownField,
      dnsField,
      six,
      needs,
      h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("network.apply"))),
    ),
  );
}

function handOverDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("network.handover.title", { nic: nic.name })), closeX(() => dialog)),
    h("p", null, t("network.handover.lead")),
    h("p", { class: "muted small" }, t(nic.manager === "ifupdown" ? "network.handover.howIfupdown" : "network.handover.how", { nic: nic.name })),
    h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("network.handover.go"), {
        class: "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const pending = await api("POST", `/api/network/${nic.name}/handover`, {});
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            error.textContent = errorText(err);
            e.target.closest("button").disabled = false;
          }
        },
      }),
    ),
  );
}

/** Marks an interface as the side the internet comes in on: what stops answering there, and the firewall it takes */
function outsideDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const needs = state.network.firewall;
  const go = button(t("outside.go"), {
    class: "primary",
    disabled: !!needs,
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      error.textContent = "";
      try {
        state.network = await api("PUT", `/api/network/${nic.name}/side`, { side: "outside" });
        dialog.close();
        renderSettings();
      } catch (err) {
        error.textContent = errorText(err);
        e.target.closest("button").disabled = false;
      }
    },
  });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("outside.title", { nic: nic.name })), closeX(() => dialog)),
    h("p", null, t("outside.lead")),
    h("ul", { class: "muted small" }, ["pages", "folders", "announce", "remote"].map((key) => h("li", null, t("outside.what." + key)))),
    h("p", { class: "muted small" }, t("outside.still")),
    needs &&
      h(
        "div",
        { class: "banner stack" },
        h("strong", null, t("outside.needs.what")),
        h("p", { class: "muted small" }, t("outside.needs.why")),
        needs.install ? h("p", { class: "cmd" }, icon("terminal"), needs.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: needs.package })),
        needs.install &&
          button(t("mounting.needs.install", { package: needs.package }), {
            class: "small",
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              error.textContent = "";
              try {
                state.network = await api("POST", "/api/network/package", { package: needs.package });
                dialog.close();
                outsideDialog(nic);
              } catch (err) {
                error.textContent = errorText(err);
                e.target.closest("button").disabled = false;
              }
            },
          }),
      ),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
}

/** Gives an interface handed over to NetworkManager back to the service that had it */
function handBackDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("network.handback.title", { nic: nic.name })), closeX(() => dialog)),
    h("p", null, t("network.handback.lead", { service: t("network.by." + nic.handed) })),
    h("p", { class: "muted small" }, t(nic.handed === "ifupdown" ? "network.handback.howIfupdown" : "network.handback.how", { nic: nic.name })),
    h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("network.handback.go"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const pending = await api("POST", `/api/network/${nic.name}/handback`, {});
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
    ),
  );
}

/** The Wi-Fi networks in reach of an interface: pick one, type its password */
function wifiDialog(nic) {
  const list = h("div", { class: "stack" }, h("p", { class: "muted" }, t("wifi.looking")));
  const error = h("p", { class: "error", role: "alert" });
  const bars = (signal) => h("span", { class: "muted small mono" }, `${signal}%`);
  const join = (net, row) => {
    const password = h("input", { type: "password", autocomplete: "off", minLength: 8, maxLength: 63, required: true, placeholder: t("wifi.password") });
    const needs = net.secure && !net.known;
    const go = button(t("wifi.connect"), { class: "primary small", type: "submit" });
    const form = h(
      "form",
      {
        class: "pair",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          go.lastChild.textContent = t("wifi.connecting");
          try {
            state.network = await api("POST", `/api/network/${nic.name}/wifi`, { ssid: net.ssid, ...(needs ? { password: password.value } : {}) });
            dialog.close();
            toast(t("wifi.connected", { ssid: net.ssid }));
            renderSettings();
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
            go.lastChild.textContent = t("wifi.connect");
          }
        },
      },
      needs && password,
      go,
    );
    row.after(form);
    if (needs) password.focus();
  };
  const paint = (networks) => {
    list.replaceChildren(
      ...(networks.length
        ? networks.map((net) => {
            const row = h(
              "button",
              { type: "button", class: "menu-item", disabled: net.active, onclick: () => (list.querySelector("form")?.remove(), join(net, row)) },
              icon(net.secure ? "lock" : "network"),
              h("span", { class: "grow" }, net.ssid, net.active && h("span", { class: "muted small" }, " · " + t("wifi.active")), !net.active && net.known && h("span", { class: "muted small" }, " · " + t("wifi.known"))),
              h("span", { class: "muted small" }, `${net.band} GHz`),
              bars(net.signal),
            );
            return row;
          })
        : [h("p", { class: "muted" }, t("wifi.none"))]),
    );
  };
  const other = () => {
    const name = h("input", { maxLength: 32, required: true, placeholder: t("hotspot.name"), spellcheck: false });
    const password = h("input", { type: "password", autocomplete: "off", minLength: 8, maxLength: 63, placeholder: t("wifi.password") });
    const go = button(t("wifi.connect"), { class: "primary small", type: "submit" });
    list.replaceChildren(
      h(
        "form",
        {
          class: "stack",
          onsubmit: async (e) => {
            e.preventDefault();
            error.textContent = "";
            go.disabled = true;
            go.lastChild.textContent = t("wifi.connecting");
            try {
              state.network = await api("POST", `/api/network/${nic.name}/wifi`, { ssid: name.value, hidden: true, ...(password.value ? { password: password.value } : {}) });
              dialog.close();
              toast(t("wifi.connected", { ssid: name.value }));
              renderSettings();
            } catch (err) {
              error.textContent = errorText(err);
              go.disabled = false;
              go.lastChild.textContent = t("wifi.connect");
            }
          },
        },
        h("p", { class: "muted small" }, t("wifi.otherLead")),
        field(t("hotspot.name"), name),
        field(t("wifi.password"), password, t("wifi.otherPasswordHint")),
        h("div", null, go),
      ),
    );
    name.focus();
  };
  const look = async () => {
    error.textContent = "";
    try {
      paint((await api("GET", `/api/network/${nic.name}/wifi`)).networks);
    } catch (err) {
      list.replaceChildren();
      error.textContent = errorText(err);
    }
  };
  const dialog = openDialog("", h("header", null, h("h2", { class: "grow" }, t("wifi.title", { nic: nic.name })), closeX(() => dialog)), nic.wifi.hotspot && h("p", { class: "banner small" }, t("wifi.endsHotspot", { ssid: nic.wifi.hotspot.ssid })), list, error, h("footer", null, button(t("wifi.again"), { onclick: () => (list.replaceChildren(h("p", { class: "muted" }, t("wifi.looking"))), look()) }, "refresh"), button(t("wifi.other"), { onclick: other }), closeButton(() => dialog)));
  void look();
}

/** The server's own Wi-Fi network: its name and password, or — when it is on — how to join it and who has */
function hotspotDialog(nic, settings = false) {
  const on = nic.wifi.hotspot;
  const spot = settings ? null : on;
  const error = h("p", { class: "error", role: "alert" });
  const done = (data, message) => {
    state.network = data;
    dialog.close();
    toast(message);
    renderSettings();
  };
  let dialog;
  if (spot) {
    const code = h("div", { class: "qr-box" });
    void api("GET", `/api/network/${nic.name}/hotspot`).then((res) => code.replaceChildren(qrSvg(res.qr)), () => {});
    dialog = openDialog(
      "",
      h("header", null, h("h2", { class: "grow" }, t("hotspot.title")), closeX(() => dialog)),
      code,
      h("p", { class: "muted small" }, t("hotspot.scan")),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("hotspot.name")), h("span", null, spot.ssid)),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("wifi.password")), h("span", { class: "mono" }, spot.password)),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("hotspot.address")), h("span", { class: "mono" }, `http://${(nic.addresses[0] ?? "").split("/")[0]}${location.port ? ":" + location.port : ""}`)),
      h("h3", null, t("hotspot.clients", { n: spot.clients.length })),
      spot.clients.length ? spot.clients.map((c) => h("div", { class: "kv" }, h("span", null, c.name || c.mac), h("span", { class: "mono muted small" }, c.ip))) : h("p", { class: "muted small" }, t("hotspot.nobody")),
      error,
      h(
        "footer",
        null,
        button(t("hotspot.settings"), { onclick: () => (dialog.close(), hotspotDialog(nic, true)) }, "sliders"),
        button(t("hotspot.off"), {
          class: "danger",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              done(await api("DELETE", `/api/network/${nic.name}/hotspot`), t("hotspot.stopped"));
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        }),
        closeButton(() => dialog),
      ),
    );
    return;
  }
  const ssid = h("input", { value: on?.ssid ?? "Hata", maxLength: 32, required: true });
  const password = h("input", { class: "mono", value: on?.password ?? "", minLength: 8, maxLength: 63, required: true, autocomplete: "off", spellcheck: false });
  const band = h("select", { onchange: () => channels(0) }, h("option", { value: "2.4" }, t("hotspot.band24")), h("option", { value: "5", selected: on?.band === "5" }, t("hotspot.band5")));
  const channel = h("select");
  const channels = (chosen) => channel.replaceChildren(h("option", { value: "0" }, t("hotspot.channelAuto")), ...state.network.channels[band.value].map((n) => h("option", { value: String(n), selected: n === chosen }, String(n))));
  channels(on?.channel ?? 0);
  const address = h("input", { class: "mono", value: on?.address ?? "", placeholder: "10.42.0.1/24", spellcheck: false });
  const go = h("button", { class: "btn primary" }, t(on ? "network.apply" : "hotspot.on"));
  const needs = h("div");
  dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          needs.replaceChildren();
          go.disabled = true;
          try {
            done(await api("PUT", `/api/network/${nic.name}/hotspot`, { ssid: ssid.value, password: password.value, band: band.value, channel: Number(channel.value), address: address.value }), t("hotspot.started", { ssid: ssid.value.trim() }));
          } catch (err) {
            if (err.code === "network.needsPackage") needs.replaceChildren(hotspotNeeds(err.detail, error));
            else error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("hotspot.title")), closeX(() => dialog)),
      !on && h("p", { class: "muted small" }, t("hotspot.lead")),
      on && h("p", { class: "banner small" }, t("hotspot.restarts")),
      nic.wifi.ssid && h("p", { class: "banner small" }, t("hotspot.leaves", { ssid: nic.wifi.ssid })),
      field(t("hotspot.name"), ssid),
      field(t("wifi.password"), password, t("hotspot.passwordHint")),
      field(t("hotspot.band"), band, t("hotspot.bandHint")),
      field(t("hotspot.channel"), channel, t("hotspot.channelHint")),
      field(t("hotspot.ownAddress"), address, t("hotspot.ownAddressHint")),
      needs,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
}

/** What the access point lacks, with the button that installs it */
function hotspotNeeds(detail, error) {
  return h(
    "div",
    { class: "banner stack" },
    h("strong", null, t("hotspot.needs.what")),
    h("p", { class: "muted small" }, t("hotspot.needs.why")),
    detail.install ? h("p", { class: "cmd" }, icon("terminal"), detail.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: detail.package })),
    detail.install &&
      button(t("mounting.needs.install", { package: detail.package }), {
        class: "small",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            state.network = await api("POST", "/api/network/package", { package: detail.package });
            el.closest(".banner").replaceChildren(h("p", null, t("hotspot.needs.done")));
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
  );
}

function networkSection() {
  const data = state.network;
  if (!data) return [h("p", { class: "muted" }, "…")];
  const error = h("p", { class: "error", role: "alert" });
  const row = (label, value, mono = true) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", { class: mono ? "mono" : "" }, value || "—"));
  const card = (nic) =>
    h(
      "section",
      { class: "card pad", menu: true },
      h(
        "div",
        { class: "section-head" },
        h("h2", null, h("span", { class: "with-icon" }, icon("network"), nic.kind === "modem" ? nic.product || t("network.modem") : nic.name), " ", nic.kind === "modem" && h("span", { class: "muted small mono" }, nic.name + " "), h("span", { class: "state " + (nic.up ? "running" : "stopped") }, t(nic.up ? "network.up" : "network.down")), nic.outside && h("span", { class: "state" }, t("outside.chip")), nic.online === false && h("span", { class: "state restarting" }, t("network.offline")), nic.online === true && h("span", { class: "state running" }, t("network.online"))),
        h(
          "div",
          { class: "actions" },
          nic.wifi?.ready && nic.wifi.ap && button(t(nic.wifi.hotspot ? "hotspot.show" : "hotspot.make"), { class: nic.wifi.hotspot ? "accent" : "", onclick: () => hotspotDialog(nic) }, "share"),
          nic.wifi?.ready && button(t("wifi.networks"), { onclick: () => wifiDialog(nic) }, "search"),
          nic.wifi?.ssid &&
            button(t("wifi.forget"), {
              onclick: async () => {
                try {
                  state.network = await api("DELETE", `/api/network/${nic.name}/wifi`);
                } catch (err) {
                  toast(errorText(err), "error");
                }
                renderSettings();
              },
            }),
          nic.manager === "nm" && !data.pending && (!nic.wifi || nic.wifi.ssid) && !nic.wifi?.hotspot && button(t("network.change"), { onclick: () => nicDialog(nic) }, "sliders"),
          (nic.manager === "networkd" || nic.manager === "ifupdown") && data.tool === "ok" && !data.pending && button(t("network.handover"), { onclick: () => handOverDialog(nic) }),
          nic.handed && !data.pending && button(t("network.handback"), { onclick: () => handBackDialog(nic) }, "undo"),
        ),
      ),
      nic.wifi && row("Wi-Fi", nic.wifi.hotspot ? t("hotspot.state", { ssid: nic.wifi.hotspot.ssid, n: nic.wifi.hotspot.clients.length }) : nic.wifi.ssid ? `${nic.wifi.ssid} · ${nic.wifi.signal}%` : t(nic.wifi.ready ? "wifi.notConnected" : "wifi.notReady"), false),
      nic.wifi?.needs && data.tool === "ok" && needsCard(nic.wifi.needs, "wifi.needs"),
      row(t("network.address"), nic.addresses.join(", ") + (nic.addresses.length ? ` · ${t(nic.dynamic ? "network.byRouter" : "network.fixed")}` : "")),
      !nic.wifi?.hotspot && row(t("network.gateway"), nic.gateway),
      nic.shares && row(t("network.internet"), t("network.sharing", { n: nic.shares.length }), false),
      !nic.shares && !nic.wifi?.hotspot && (nic.internet !== "none" || (several && nic.addresses.length > 0)) && h("div", { class: "kv" }, h("span", { class: "muted" }, t("network.internet")), nic.manager === "nm" && several ? roleSelect(nic) : h("span", null, t("network.role." + (nic.internet === "none" ? "off" : nic.internet)))),
      !nic.wifi?.hotspot && row(t("network.dns"), nic.dns.join(", ")),
      !nic.wifi?.hotspot && (nic.addresses6.length > 0 || nic.v6.method === "off") && row("IPv6", nic.v6.method === "off" ? t("network.v6.off") : nic.addresses6.join(", ") + (nic.v6.method ? ` · ${t(nic.v6.method === "manual" ? "network.fixed" : "network.byRouter")}` : ""), nic.v6.method !== "off"),
      row(t("network.mac"), nic.mac + (nic.speed ? ` · ${nic.speed >= 1000 ? nic.speed / 1000 + " Gbit/s" : nic.speed + " Mbit/s"}` : "")),
      row(t("network.manager"), t("network.by." + (nic.manager || "none")), false),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("outside.side")), sideSelect(nic)),
      nic.public && !nic.outside && h("p", { class: "banner small" }, t("outside.exposed", { address: nic.public })),
      nic.kind === "modem" && h("p", { class: "muted small" }, t("network.modemHint", { gateway: nic.gateway || "192.168.0.1" })),
      nic.manager !== "nm" && h("p", { class: "muted small" }, t(nic.manager === "networkd" || nic.manager === "ifupdown" ? (data.tool === "ok" ? "network.handoverHint" : "network.needsTool") : "network.readOnly")),
    );
  const several = data.nics.filter((n) => n.internet !== "none").length > 1 || data.nics.some((n) => n.kind === "modem");
  const roleSelect = (nic) => {
    const select = h(
      "select",
      {
        "aria-label": t("network.internet"),
        onchange: async () => {
          error.textContent = "";
          select.disabled = true;
          try {
            state.network = await api("PUT", `/api/network/${nic.name}/role`, { role: select.value });
          } catch (err) {
            error.textContent = errorText(err);
          }
          renderSettings();
        },
      },
      ["main", "backup", "off"].map((role) => h("option", { value: role, selected: (nic.internet === "none" ? "off" : nic.internet) === role }, t("network.role." + role))),
    );
    return select;
  };
  const sideSelect = (nic) => {
    const select = h(
      "select",
      {
        "aria-label": t("outside.side"),
        onchange: async () => {
          error.textContent = "";
          if (select.value === "outside") {
            select.value = "home";
            return outsideDialog(nic);
          }
          select.disabled = true;
          try {
            state.network = await api("PUT", `/api/network/${nic.name}/side`, { side: "home" });
          } catch (err) {
            error.textContent = errorText(err);
          }
          renderSettings();
        },
      },
      ["home", "outside"].map((side) => h("option", { value: side, selected: (nic.outside ? "outside" : "home") === side }, t("outside.side." + side))),
    );
    return select;
  };
  const checkBox = h("input", {
    type: "checkbox",
    checked: data.check.on,
    onchange: async () => {
      error.textContent = "";
      checkBox.disabled = true;
      try {
        state.network = await api("PUT", "/api/network/check", { on: checkBox.checked });
      } catch (err) {
        error.textContent = errorText(err);
      }
      renderSettings();
    },
  });
  const needsCard = (needs, key) =>
    h(
      "div",
      { class: "banner stack" },
      h("strong", null, t(key + ".what")),
      h("p", { class: "muted small" }, t(key + ".why")),
      needs.install ? h("p", { class: "cmd" }, icon("terminal"), needs.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: needs.package })),
      needs.install &&
        button(t("mounting.needs.install", { package: needs.package }), {
          class: "small",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            error.textContent = "";
            try {
              state.network = await api("POST", "/api/network/package", { package: needs.package });
              renderSettings();
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        }),
    );
  const needs = data.needs && needsCard(data.needs, "network.needs");
  return [
    h("section", { class: "card pad stack" }, h("h2", null, t("settings.network")), h("p", { class: "muted small" }, t("network.lead")), data.tool === "stopped" && h("p", { class: "banner small" }, t("network.stopped")), needs, data.tool === "ok" && h("label", { class: "check" }, checkBox, h("span", null, h("strong", null, t("network.check")), h("span", { class: "muted small block" }, t("network.checkHint", { url: data.check.url.replace(/^https?:\/\//, "").replace(/\/.*/, "") })))), error, data.pending && h("div", { class: "banner" }, t("network.trial.title", { nic: data.pending.nic }), " ", button(t("network.trial.show"), { class: "small", onclick: () => trialDialog(data.pending) }))),
    ...data.nics.map(card),
    !data.nics.length && h("p", { class: "card pad muted" }, t("network.none")),
  ];
}

/** Takes a system program away: what happens, the command, and for Docker the password */
function toolRemoveDialog(tool) {
  const error = h("p", { class: "error", role: "alert" });
  const password = tool.id === "docker" ? h("input", { type: "password", autocomplete: "current-password", required: true }) : null;
  const go = h("button", { class: "btn danger" }, t("tools.removeGo", { name: tool.name }));
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          go.textContent = t("tools.removing");
          try {
            state.tools = await api("POST", `/api/tools/${tool.id}/remove`, password ? { password: password.value } : {});
            dialog.close();
            toast(t("tools.removed", { name: tool.name }));
            renderSettings();
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
            go.textContent = t("tools.removeGo", { name: tool.name });
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("tools.removeTitle", { name: tool.name })), closeX(() => dialog)),
      h("p", null, t("tools.removeLead")),
      tool.id === "docker" && h("p", { class: "banner" }, t("tools.removeDocker")),
      h("p", { class: "cmd whole" }, icon("terminal"), tool.remove),
      password && field(t("auth.password"), password),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
}

async function loadRemote() {
  state.remote = await api("GET", "/api/tailscale").catch(() => state.remote);
  if (state.route.view === "settings" && state.route.section === "remote") renderSettings();
}

/** Settings → Remote access: Tailscale, then WireGuard in and out */
const remoteSection = () => [...tailscaleCards(), ...wireguardCards()];

/** A device that agreed on keys within the last three minutes is connected: WireGuard renews them every two */
const wgConnected = (handshake) => handshake > 0 && Date.now() - handshake < 180_000;

async function wgDeviceDialog(id) {
  let file;
  try {
    file = await api("GET", `/api/wireguard/devices/${id}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const w = state.wireguard;
  const web = `http://${w.server.address}${w.web === 80 ? "" : ":" + w.web}`;
  const dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("wg.deviceTitle", { name: file.name })), closeX(() => dialog)),
    h("p", { class: "muted" }, t("wg.deviceLead")),
    h("div", { class: "qr-box" }, qrSvg(file.qr)),
    h("p", { class: "muted small" }, t("wg.devicePhone")),
    h("pre", { class: "cmd whole wg-conf" }, file.conf),
    h("p", { class: "muted small" }, t("wg.deviceComputer")),
    h("p", { class: "banner" }, t("wg.deviceSecret")),
    h("p", { class: "muted small" }, t("wg.deviceThen", { address: web })),
    h("footer", null, h("a", { class: "btn", href: `/api/wireguard/devices/${id}?download=1`, download: "" }, icon("download"), h("span", null, t("wg.deviceFile"))), closeButton(() => dialog)),
  );
}

function wgAddDialog() {
  const w = state.wireguard;
  const name = h("input", { maxLength: 40, required: true, placeholder: t("wg.namePlaceholder") });
  const lan = h("input", { type: "checkbox", disabled: !w.server.firewall || !w.server.networks.length });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  dialog = openDialog(
    "",
    h("h2", null, t("wg.add")),
    field(t("wg.name"), name),
    h("label", { class: "check" }, lan, h("span", null, h("strong", null, t("wg.lan")), h("span", { class: "muted small block" }, !w.server.firewall ? t("wg.lanNoFirewall") : w.server.networks.length ? t("wg.lanHint", { networks: w.server.networks.join(", ") }) : t("remote.networksNone")))),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("wg.addGo"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            state.wireguard = await api("POST", "/api/wireguard/devices", { name: name.value, lan: lan.checked });
            dialog.close();
            renderSettings();
            void wgDeviceDialog(state.wireguard.added);
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
    ),
  );
  name.focus();
}

function wireguardCards() {
  const w = state.wireguard;
  if (!w) return [];
  const error = h("p", { class: "error", role: "alert" });
  const send = async (method, path, data, el, said = error) => {
    if (el) el.disabled = true;
    said.textContent = "";
    try {
      state.wireguard = await api(method, `/api/wireguard/${path}`, data);
      renderSettings();
      return state.wireguard;
    } catch (err) {
      said.textContent = errorText(err);
      if (el) el.disabled = false;
      return null;
    }
  };

  if (w.tool === "missing")
    return [
      h(
        "section",
        { class: "card pad stack" },
        h("h2", null, "WireGuard"),
        h("p", { class: "muted" }, t("wg.lead")),
        h("p", null, t("wg.what")),
        h("p", { class: "muted small" }, t("wg.why")),
        w.install ? h("p", { class: "cmd" }, icon("terminal"), w.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: w.package })),
        error,
        w.install &&
          h(
            "footer",
            null,
            button(t("mounting.needs.install", { package: "WireGuard" }), {
              class: "primary",
              onclick: async (e) => {
                const el = e.currentTarget;
                el.disabled = true;
                el.lastChild.textContent = t("tools.installing");
                try {
                  await api("POST", "/api/tools/wireguard-tools/install", {});
                  state.wireguard = await api("GET", "/api/wireguard");
                  renderSettings();
                } catch (err) {
                  error.textContent = errorText(err);
                  el.disabled = false;
                }
              },
            }, "download"),
          ),
      ),
    ];

  const s = w.server;
  const endpoint = h("input", { value: s.endpoint || s.suggested, placeholder: "home.example.com", spellcheck: false, autocapitalize: "off", class: "mono", required: true });
  const port = h("input", { type: "number", min: 1, max: 65535, value: s.port, class: "short mono", required: true });
  const typed = () => ({ endpoint: endpoint.value.trim(), port: Number(port.value) });
  const up = s.enabled && s.running;
  const deviceRow = (d) =>
    h(
      "tr",
      null,
      h("td", null, h("div", { class: "strong" }, d.name), h("div", { class: "muted small mono" }, d.address)),
      h("td", null, h("label", { class: "check small" }, h("input", { type: "checkbox", checked: d.lan, disabled: !s.firewall, onchange: (e) => send("PUT", `devices/${d.id}`, { lan: e.target.checked }, e.target) }), h("span", null, t("wg.lanShort")))),
      h("td", null, h("span", { class: "state " + (wgConnected(d.handshake) ? "running" : "stopped") }, wgConnected(d.handshake) ? t("wg.connected") : d.handshake ? t("remote.seen", { when: ago(d.handshake) }) : t("wg.never"))),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          button(t("wg.show"), { class: "small", onclick: () => wgDeviceDialog(d.id) }),
          h("button", {
            type: "button",
            class: "icon-btn",
            title: t("wg.remove"),
            "aria-label": t("wg.remove"),
            onclick: () => {
              const dialog = openDialog("confirm", h("h2", null, t("wg.removeTitle", { name: d.name })), h("p", { class: "muted" }, t("wg.removeLead")), h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("wg.remove"), { class: "danger", onclick: (e) => (dialog.close(), send("DELETE", `devices/${d.id}`, undefined, e.currentTarget)) })));
            },
          }, icon("trash")),
        ),
      ),
    );
  const inCard = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("wg.in.title"), h("span", { class: "state " + (up ? "running" : s.enabled ? "partial" : "stopped") }, t(up ? "wg.state.on" : s.enabled ? "remote.state.stopped" : "remote.state.off"))), h("span", { class: "muted small" }, "WireGuard")),
    h("p", { class: "muted" }, t("wg.in.lead")),
    settingRow(t("wg.endpoint"), t("wg.endpointHint"), endpoint),
    settingRow(t("wg.port"), t("wg.portHint", { port: s.port }), port),
    !s.firewall && h("p", { class: "banner" }, t("wg.noFirewall")),
    error,
    h("footer", null, h("div", { class: "row-actions" }, s.enabled && button(t("remote.turnOff"), { onclick: (e) => send("PUT", "server", { enabled: false }, e.currentTarget) }), button(t(s.enabled ? "settings.save" : "remote.turnOn"), { class: "primary", onclick: (e) => send("PUT", "server", { ...typed(), enabled: true }, e.currentTarget) }))),
  );
  const devices =
    s.address &&
    h(
      "section",
      { class: "card pad stack" },
      h("div", { class: "section-head" }, h("h2", null, t("wg.devices"), h("span", { class: "muted small" }, s.devices.length)), button(t("wg.add"), { class: "small primary", disabled: !s.endpoint, onclick: wgAddDialog }, "plus")),
      s.devices.length ? h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, s.devices.map(deviceRow)))) : h("p", { class: "muted" }, t("wg.devicesNone")),
      h("p", { class: "muted small" }, t("wg.devicesHint", { address: s.address })),
    );

  const c = w.client;
  const outError = h("p", { class: "error", role: "alert" });
  const conf = h("textarea", { rows: 8, spellcheck: false, class: "mono", placeholder: "[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …\nAllowedIPs = …" });
  const pick = h("input", { type: "file", accept: ".conf,text/plain", class: "offscreen", onchange: async () => pick.files[0] && (conf.value = await pick.files[0].text()) });
  const join = async (e) => {
    const done = await send("PUT", "client", { conf: conf.value, enabled: true }, e.currentTarget, outError);
    if (done?.dropped?.length) toast(t("wg.out.dropped", { lines: done.dropped.join(", ") }));
  };
  const outUp = c.enabled && c.running;
  const outCard = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("wg.out.title"), c.set && h("span", { class: "state " + (outUp ? "running" : c.enabled ? "partial" : "stopped") }, t(outUp ? (wgConnected(c.handshake) ? "wg.connected" : "wg.out.waiting") : c.enabled ? "remote.state.stopped" : "remote.state.off"))), h("span", { class: "muted small" }, "WireGuard")),
    h("p", { class: "muted" }, t("wg.out.lead")),
    c.set
      ? [
          settingRow(t("wg.out.server"), c.handshake ? t("wg.out.spoke", { when: ago(c.handshake) }) : "", h("span", { class: "mono" }, c.endpoint)),
          settingRow(t("wg.out.address"), "", h("span", { class: "mono" }, c.address)),
          settingRow(t("wg.out.through"), t(c.everything ? "wg.out.everything" : "wg.out.some"), h("span", { class: "mono" }, c.allowed.join(", "))),
        ]
      : [field(t("wg.out.conf"), conf, t("wg.out.confHint")), pick],
    outError,
    h(
      "footer",
      null,
      h(
        "div",
        { class: "row-actions" },
        c.set
          ? [button(t("wg.out.forget"), { class: "quiet", onclick: (e) => send("DELETE", "client", undefined, e.currentTarget, outError) }), c.enabled ? button(t("remote.turnOff"), { onclick: (e) => send("PUT", "client", { enabled: false }, e.currentTarget, outError) }) : button(t("remote.turnOn"), { class: "primary", onclick: (e) => send("PUT", "client", { enabled: true }, e.currentTarget, outError) })]
          : [button(t("wg.out.file"), { onclick: () => pick.click() }), button(t("wg.out.join"), { class: "primary", onclick: join })],
      ),
    ),
  );
  return [inCard, devices, outCard].filter(Boolean);
}

function tailscaleCards() {
  const r = state.remote;
  if (!r) return [h("p", { class: "muted" }, "…")];
  const error = h("p", { class: "error", role: "alert" });
  const act = (what, data = {}, said) => async (e) => {
    const el = e.currentTarget;
    el.disabled = true;
    error.textContent = "";
    try {
      state.remote = await api("POST", `/api/tailscale/${what}`, data);
      if (said) toast(said);
      renderSettings();
    } catch (err) {
      error.textContent = errorText(err);
      el.disabled = false;
    }
  };
  const lead = h("p", { class: "muted" }, t("remote.lead"));
  const title = "Tailscale";

  if (r.state === "missing")
    return [
      h(
        "section",
        { class: "card pad stack" },
        h("h2", null, title),
        lead,
        h("p", null, t("remote.what")),
        h("p", { class: "muted small" }, t("remote.why")),
        h("p", { class: "cmd" }, icon("terminal"), r.install),
        h("p", { class: "muted small" }, t("remote.how")),
        error,
        h(
          "footer",
          null,
          button(t("mounting.needs.install", { package: "Tailscale" }), {
            class: "primary",
            onclick: async (e) => {
              const el = e.currentTarget;
              el.disabled = true;
              try {
                const res = await api("POST", "/api/tailscale/install", {});
                jobDialog(res.job, "tailscale", "", loadRemote);
              } catch (err) {
                error.textContent = errorText(err);
                el.disabled = false;
              }
            },
          }, "download"),
        ),
      ),
    ];

  const head = (chip, cls) => h("div", { class: "section-head" }, h("h2", null, title, h("span", { class: "state " + cls }, chip)), h("span", { class: "muted small mono" }, r.version));
  if (r.state === "stopped") return [h("section", { class: "card pad stack" }, head(t("remote.state.stopped"), "stopped"), h("p", { class: "muted" }, t("remote.stopped")), error, h("footer", null, button(t("remote.start"), { class: "primary", onclick: act("start") }))) ];

  // waiting for the person to let the server in: the page looks again by itself until it is done
  if (r.state === "starting") {
    const timer = setTimeout(loadRemote, 3000);
    cleanups.push(() => clearTimeout(timer));
  }
  const port = r.port === 80 ? "" : ":" + r.port;
  const address = (host) => h("a", { class: "link mono", href: `http://${host}${port}/` }, host + port);

  if (r.state === "needsLogin" || r.state === "starting") {
    const own = h("input", { value: r.server ?? "", placeholder: "https://headscale.example.com", spellcheck: false, autocapitalize: "off", class: "mono" });
    return [
      h(
        "section",
        { class: "card pad stack" },
        head(t(r.authUrl ? "remote.state.waiting" : "remote.state.signedOut"), r.authUrl ? "partial" : "stopped"),
        lead,
        r.authUrl
          ? [h("p", null, t("remote.openLink")), h("p", { class: "cmd" }, h("a", { class: "link grow clip", href: r.authUrl, target: "_blank", rel: "noopener noreferrer" }, r.authUrl), h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(r.authUrl) }, icon("copy"))), h("p", { class: "muted small" }, t("remote.openLinkHint"))]
          : [h("p", { class: "muted small" }, t("remote.signInHint")), h("details", null, h("summary", { class: "muted small" }, t("remote.ownServer")), field(t("remote.ownServerAddress"), own, t("remote.ownServerHint")))],
        error,
        h("footer", null, r.authUrl ? button(t("common.cancel"), { onclick: act("disconnect") }) : button(t("remote.signIn"), { class: "primary", onclick: (e) => act("connect", { server: own.value.trim() })(e) }, "arrow")),
      ),
    ];
  }

  const on = r.state === "running";
  const offered = r.offered.length > 0;
  // a network a router of the private network already carries is reached through it: nothing waits there
  const carried = r.offered.filter((net) => !r.approved.includes(net) && r.carried?.[net]);
  const waiting = r.offered.filter((net) => !r.approved.includes(net) && !r.carried?.[net]);
  const share = h("input", { type: "checkbox", checked: offered, disabled: !on || (!offered && !r.networks.length), onchange: (e) => act("networks", { on: e.target.checked })(e) });
  return [
    h(
      "section",
      { class: "card pad stack" },
      head(t(on ? "remote.state.on" : "remote.state.off"), on ? "running" : "stopped"),
      lead,
      settingRow(t("remote.name"), t("remote.nameHint"), h("span", { class: "stack-s end" }, r.name && address(r.name), r.addresses.filter((a) => !a.includes(":")).map(address))),
      settingRow(t("remote.account"), r.server ? t("remote.accountOwn", { server: r.server }) : r.expires ? t("remote.expires", { date: shortDate(r.expires) }) : "", h("span", null, r.tailnet || "—")),
      r.health.length > 0 && h("div", { class: "banner stack" }, r.health.map((line) => h("p", { class: "small" }, line))),
      error,
      h("footer", null, h("div", { class: "row-actions" }, button(t("remote.signOut"), { class: "quiet", onclick: act("signout") }), on ? button(t("remote.turnOff"), { onclick: act("disconnect") }) : button(t("remote.turnOn"), { class: "primary", onclick: act("connect") }))),
    ),
    h(
      "section",
      { class: "card pad stack" },
      h("h2", null, t("remote.networks")),
      h("label", { class: "check" }, share, h("span", null, h("strong", null, t("remote.networksOn")), h("span", { class: "muted small block" }, r.networks.length || offered ? t("remote.networksHint", { networks: (offered ? r.offered : r.networks).join(", ") }) : t("remote.networksNone")))),
      carried.length > 0 && h("p", { class: "muted small" }, carried.map((net) => t("remote.networksCarried", { network: net, device: r.carried[net] })).join(" ")),
      waiting.length > 0 && h("p", { class: "banner" }, t(r.server ? "remote.networksApproveOwn" : "remote.networksApprove", { networks: waiting.join(", ") }), !r.server && [" ", h("a", { class: "link", href: r.admin, target: "_blank", rel: "noopener noreferrer" }, "login.tailscale.com")]),
    ),
    h(
      "section",
      { class: "card pad stack" },
      h("div", { class: "section-head" }, h("h2", null, t("remote.devices"), h("span", { class: "muted small" }, r.devices.length))),
      r.devices.length
        ? h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, r.devices.map((d) => h("tr", null, h("td", null, h("div", { class: "strong" }, d.name), h("div", { class: "muted small" }, d.os)), h("td", { class: "mono small" }, d.addresses.filter((a) => !a.includes(":")).join(", ")), h("td", { class: "num" }, h("span", { class: "state " + (d.online ? "running" : "stopped") }, d.online ? t("remote.online") : d.lastSeen ? t("remote.seen", { when: ago(d.lastSeen) }) : t("remote.offline"))))))))
        : h("p", { class: "muted" }, t("remote.devicesNone")),
      h("p", { class: "muted small" }, t("remote.devicesHint")),
    ),
  ];
}

/** Settings → System programs: everything of the system Hata relies on, installed or not */
function toolsSection() {
  const tools = state.tools;
  if (!tools) return [h("p", { class: "muted" }, "…")];
  const error = h("p", { class: "error", role: "alert" });
  const again = async () => {
    state.tools = await api("GET", "/api/tools").catch(() => state.tools);
    if (state.route.view === "settings" && state.route.section === "tools") renderSettings();
  };
  const install = (tool) =>
    button(t("mounting.needs.install", { package: tool.name }), {
      class: "small primary",
      onclick: async (e) => {
        const el = e.currentTarget;
        el.disabled = true;
        el.lastChild.textContent = t("tools.installing");
        error.textContent = "";
        try {
          const res = await api("POST", `/api/tools/${tool.id}/install`, {});
          if (res.job) return jobDialog(res.job, tool.id === "tailscale" ? "tailscale" : "docker", "", again);
          state.tools = res;
          toast(t("tools.installed", { name: tool.name }));
        } catch (err) {
          error.textContent = errorText(err);
        }
        renderSettings();
      },
    }, "download");
  const row = (tool) =>
    h(
      "div",
      { class: "tool" },
      h(
        "div",
        { class: "grow" },
        h("div", { class: "tool-head" }, h("strong", null, tool.name), h("span", { class: "state " + (tool.state === "installed" ? "running" : "stopped") }, t("tools.state." + tool.state)), tool.used && h("span", { class: "state running" }, t("tools.used")), tool.version && h("span", { class: "muted small mono" }, tool.version), tool.newer && h("span", { class: "state partial" }, t("tools.newer", { version: tool.newer }))),
        h("p", { class: "muted small" }, t(`tools.${tool.id}.what`), " ", h("a", { class: "link", href: tool.page }, t(`tools.${tool.id}.where`))),
        tool.builtIn && h("p", { class: "muted small" }, t(`tools.${tool.id}.builtIn`)),
        tool.state === "installed" && tool.holds && h("p", { class: "muted small" }, t("tools.holds." + tool.holds)),
        tool.state !== "installed" && (tool.install ? h("p", { class: "cmd" }, icon("terminal"), tool.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: tool.package }))),
      ),
      tool.state !== "installed" && tool.install && install(tool),
      tool.state === "installed" && tool.upgrade?.length > 0 && button(t("tools.update"), { class: "small accent", onclick: () => sysUpgradeDialog("", tool.upgrade, tool.name) }, "up"),
      tool.state === "installed" && !tool.holds && tool.remove && button(t("tools.remove"), { class: "small", onclick: () => toolRemoveDialog(tool) }, "trash"),
    );
  const here = tools.filter((tool) => tool.state === "installed");
  const absent = tools.filter((tool) => tool.state !== "installed");
  return [
    h("section", { class: "card pad stack" }, h("h2", null, t("settings.tools")), h("p", { class: "muted small" }, t("tools.lead")), error),
    h("div", { id: "sysupdates" }, sysUpdatesCard("")),
    absent.length > 0 && h("section", { class: "card pad" }, h("h2", null, t("tools.absent"), h("span", { class: "muted" }, " " + absent.length)), absent.map(row)),
    here.length > 0 && h("section", { class: "card pad" }, h("h2", null, t("tools.present"), h("span", { class: "muted" }, " " + here.length)), here.map(row)),
  ];
}

/** Newer versions of the system's packages as last checked: "" — this server, else a machine's id */
const sysUpdates = {};
const sysUpdatesApi = (at) => (at ? `/api/machines/${at}/system/updates` : "/api/system/updates");
/** The packages ticked in the list, per place */
const sysChosen = {};

async function loadSysUpdates(at = "") {
  try {
    sysUpdates[at] = await api("GET", sysUpdatesApi(at));
  } catch (e) {
    sysUpdates[at] = { error: errorText(e) };
  }
  paintSysUpdates(at);
}

function paintSysUpdates(at) {
  const box = document.getElementById(at ? "machine-sysupdates" : "sysupdates");
  if (box && (at ? state.route.view === "machine" && state.route.id === at : state.route.view === "settings")) box.replaceChildren(sysUpdatesCard(at));
}

/** A check began or ended somewhere: the page that shows that place looks again */
async function sysUpdatesEvent(at) {
  if (!at && state.route.view === "settings" && state.route.section === "tools") {
    // the rows of the programs carry their newer versions too
    state.tools = await api("GET", "/api/tools").catch(() => state.tools);
    sysUpdates[""] = await api("GET", "/api/system/updates").catch(() => sysUpdates[""]);
    renderSettings();
  } else if (at && state.route.view === "machine" && state.route.id === at) void loadSysUpdates(at);
}

/** Newer versions of the system's packages: how many, which, and the buttons that install them */
function sysUpdatesCard(at) {
  const info = sysUpdates[at];
  const list = info?.list ?? [];
  const chosen = (sysChosen[at] ??= new Set());
  for (const name of [...chosen]) if (!list.some((p) => p.name === name)) chosen.delete(name);
  const check = button(info?.checking ? t("sysupdates.checking") : t("sysupdates.check"), {
    class: "small",
    disabled: !!info?.checking,
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      el.lastChild.textContent = t("sysupdates.checking");
      try {
        sysUpdates[at] = await api("POST", `${sysUpdatesApi(at)}/check`, {});
      } catch (err) {
        toast(errorText(err), "error");
      }
      paintSysUpdates(at);
      if (!at) void sysUpdatesEvent("");
    },
  }, "refresh");
  const head = h("div", { class: "section-head" }, h("h2", null, t("sysupdates.title")), check);
  if (!info) return h("section", { class: "card pad stack" }, head, h("p", { class: "muted" }, "…"));
  if (info.error && !info.at) return h("section", { class: "card pad stack" }, head, h("p", { class: "error" }, info.error));
  if (info.at && !info.manager) return h("section", { class: "card pad stack" }, head, h("p", { class: "muted small" }, t("sysupdates.noManager")));
  const security = list.filter((p) => p.security).length;
  const when = info.at ? t("sysupdates.checked", { ago: ago(info.at) }) : "";
  const status = !info.at
    ? h("p", { class: "muted" }, t("sysupdates.never"))
    : list.length
      ? h("p", { class: "sys-status" }, h("span", { class: "state partial" }, t("sysupdates.count", { n: list.length })), security > 0 && h("span", { class: "state restarting" }, t("sysupdates.security", { n: security })), h("span", { class: "muted small" }, when))
      : h("p", { class: "with-icon" }, icon("check"), t("sysupdates.none"), h("span", { class: "muted small" }, " · " + when));
  const chooseButton = button(t("sysupdates.updateChosen", { n: chosen.size }), { class: "small", onclick: () => sysUpgradeDialog(at, [...chosen]) }, "up");
  chooseButton.hidden = !chosen.size;
  const row = (p) => {
    const box = h("input", { type: "checkbox", checked: chosen.has(p.name) });
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(p.name);
      else chosen.delete(p.name);
      chooseButton.hidden = !chosen.size;
      chooseButton.lastChild.textContent = t("sysupdates.updateChosen", { n: chosen.size });
    });
    return h("label", { class: "check sys-package" }, box, h("span", { class: "mono grow clip" }, p.name), h("span", { class: "muted small mono" }, p.from ? `${p.from} → ${p.to}` : t("sysupdates.new", { version: p.to })), p.security && h("span", { class: "state restarting" }, t("sysupdates.securityOne")));
  };
  // security updates first, then by name
  const sorted = [...list].sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name));
  return h(
    "section",
    { class: "card pad stack" },
    head,
    h("p", { class: "muted small" }, t("sysupdates.lead")),
    status,
    info.error && h("p", { class: "error small" }, t("sysupdates.lastError", { message: info.error })),
    info.reboot && h("p", { class: "banner" }, t(at ? "sysupdates.rebootMachine" : "sysupdates.reboot")),
    list.length > 0 && h("p", { class: "cmd" }, icon("terminal"), info.command),
    list.length > 0 && h("div", { class: "actions" }, button(t("sysupdates.updateAll"), { class: "accent", onclick: () => sysUpgradeDialog(at, []) }, "up"), chooseButton),
    list.length > 0 && h("details", { open: chosen.size > 0 }, h("summary", null, t("sysupdates.show", { n: list.length })), h("div", { class: "sys-packages" }, sorted.map(row))),
  );
}

/** Asks before newer versions are installed: of every package (`packages` empty) or the ones named */
function sysUpgradeDialog(at, packages, name = "") {
  const list = sysUpdates[at]?.list ?? [];
  const count = packages.length || list.length;
  const docker = (packages.length ? packages : list.map((p) => p.name)).some((p) => /^(docker|containerd)/.test(p));
  const manager = sysUpdates[at]?.manager;
  const command = packages.length ? (manager === "dnf" ? `dnf upgrade ${packages.join(" ")}` : `apt-get install --only-upgrade ${packages.join(" ")}`) : sysUpdates[at]?.command;
  let dialog;
  dialog = openDialog(
    "confirm",
    h("header", null, h("h2", { class: "grow" }, name ? t("sysupdates.updateTitle", { name }) : t("sysupdates.updateMany", { n: count })), closeX(() => dialog)),
    h("p", null, t(at ? "sysupdates.updateLeadMachine" : "sysupdates.updateLead")),
    docker && h("p", { class: "banner" }, t("sysupdates.docker")),
    command && h("p", { class: "cmd whole" }, icon("terminal"), command),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("sysupdates.go"), {
        class: "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const res = await api("POST", `${sysUpdatesApi(at)}/upgrade`, { packages });
            dialog.close();
            sysChosen[at]?.clear();
            jobDialog(res.job, "sysupdate", "", () => sysUpdatesEvent(at));
          } catch (err) {
            dialog.close();
            toast(errorText(err), "error");
          }
        },
      }, "up"),
    ),
  );
}

/** Images and volumes as last counted: "" — this server, else a machine's id */
const spaces = {};
const spaceApi = (at) => (at ? `/api/machines/${at}/docker` : "/api/docker");

async function loadSpace(at = "") {
  try {
    spaces[at] = await api("GET", `${spaceApi(at)}/space`);
  } catch (e) {
    spaces[at] = { error: errorText(e) };
  }
  paintSpace(at);
}

/** Shows what was counted where it is looked at: Settings → Docker, or the machine's tab */
function paintSpace(at) {
  if (!at && state.route.view === "settings" && state.route.section === "docker") renderSettings();
  const box = document.getElementById("machine-docker");
  if (at && box && state.route.view === "machine" && state.route.id === at) box.replaceChildren(...dockerSection(at).filter(Boolean));
}

/** Asks before something of Docker's is taken away; `password` — for what takes data with it in bulk */
function dockerDropDialog({ at, title, lead, warn, command, password: ask, go: label, run }) {
  const error = h("p", { class: "error", role: "alert" });
  const password = ask ? h("input", { type: "password", autocomplete: "current-password", required: true }) : null;
  const go = h("button", { class: "btn danger" }, label);
  const dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          try {
            const done = await run(password?.value);
            dialog.close();
            toast(done);
            await loadSpace(at);
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, title), closeX(() => dialog)),
      h("p", null, lead),
      warn && h("p", { class: "banner danger" }, warn),
      h("p", { class: "cmd whole" }, icon("terminal"), command),
      password && field(t("account.password"), password, t("docker.passwordHint")),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
}

/**
 * Images and volumes, who uses them, and taking away what nothing uses: of this server (Settings →
 * Docker) or of a machine (`at`, its tab "Docker")
 */
function dockerSection(at = "") {
  const space = spaces[at];
  const base = spaceApi(at);
  if (!space) return [h("section", { class: "card pad" }, h("p", { class: "with-icon muted" }, icon("refresh"), t("docker.counting")))];
  if (space.error) return [h("section", { class: "card pad" }, h("p", { class: "error" }, space.error))];
  const sum = (list) => list.reduce((n, one) => n + Math.max(0, one.size), 0);
  // an app of this server opens its page; a machine's apps are on the machine's tab
  const appLink = (name) => (at ? h("a", { class: "link", href: `#/machines/${at}/apps` }, name) : (state.overview?.apps ?? []).some((a) => a.name === name) ? h("a", { class: "link", href: `#/apps/${name}` }, name) : h("span", null, name));
  // who uses it: the app when it is one, else the container
  const users = (one) =>
    one.used.length
      ? one.used.map((u) => h("div", { class: "small" }, u.app ? appLink(u.app) : h("span", { class: "mono" }, u.container), !u.running && h("span", { class: "muted" }, " · " + t("docker.stopped"))))
      : h("span", { class: "state stopped" }, t("docker.unused"));

  const images = space.images;
  const idle = images.filter((i) => !i.used.length);
  const wanted = idle.filter((i) => i.wanted.length);
  const imageName = (i) => (i.name ? h("div", { class: "strong mono clip" }, i.name) : h("div", null, h("span", { class: "strong" }, t("docker.noName")), h("span", { class: "muted small mono" }, " " + i.id.slice(7, 19))));
  const dropImage = (i) =>
    dockerDropDialog({
      at,
      title: t("docker.image.dropTitle"),
      lead: i.name || i.id.slice(7, 19),
      warn: i.wanted.length ? t("docker.image.wanted", { apps: i.wanted.join(", ") }) : "",
      command: `docker image rm ${i.name || i.id.slice(7, 19)}`,
      go: t("docker.drop"),
      run: async () => (await api("DELETE", `${base}/images/${i.id}`), t("docker.image.dropped")),
    });
  const imageRow = (i) =>
    h(
      "tr",
      null,
      h("td", null, imageName(i), i.more.length > 0 && h("div", { class: "muted small mono clip" }, i.more.join(", "))),
      h("td", { class: "num" }, bytes(i.size)),
      h("td", { class: "muted" }, shortDate(i.created * 1000)),
      h("td", null, users(i), i.wanted.length > 0 && h("div", { class: "muted small" }, t("docker.image.wantedShort", { apps: i.wanted.join(", ") }))),
      h("td", null, !i.used.length && h("div", { class: "row-actions" }, button(t("docker.drop"), { class: "small", onclick: () => dropImage(i) }, "trash"))),
    );
  const pruneImages = () =>
    dockerDropDialog({
      at,
      title: t("docker.image.pruneTitle"),
      lead: t("docker.image.pruneLead", { n: idle.length, size: bytes(sum(idle)) }),
      warn: wanted.length ? t("docker.image.wanted", { apps: [...new Set(wanted.flatMap((i) => i.wanted))].join(", ") }) : "",
      command: "docker image prune -a",
      go: t("docker.pruneGo"),
      run: async () => t("docker.freed", { size: bytes((await api("POST", `${base}/images/prune`, {})).freed) }),
    });

  const volumes = space.volumes;
  const spare = volumes.filter((v) => !v.used.length);
  const volumeName = (v) => h("div", null, h("div", { class: "strong mono clip" }, v.anonymous ? v.name.slice(0, 12) + "…" : v.name), h("div", { class: "muted small" }, v.anonymous ? t("docker.volume.anonymous") : v.project ? t("docker.volume.of", { app: v.project }) : t("docker.volume.byHand")));
  const dropVolume = (v) =>
    dockerDropDialog({
      at,
      title: t("docker.volume.dropTitle"),
      lead: v.name,
      warn: t("docker.volume.dataGoes"),
      command: `docker volume rm ${v.name}`,
      go: t("docker.drop"),
      run: async () => (await api("DELETE", `${base}/volumes/${encodeURIComponent(v.name)}`), t("docker.volume.dropped")),
    });
  const volumeRow = (v) =>
    h(
      "tr",
      null,
      h("td", null, volumeName(v)),
      h("td", { class: "num" }, v.size >= 0 ? bytes(v.size) : "—"),
      h("td", { class: "muted" }, v.created ? shortDate(Date.parse(v.created)) : "—"),
      h("td", null, users(v)),
      h("td", null, !v.used.length && h("div", { class: "row-actions" }, button(t("docker.drop"), { class: "small", onclick: () => dropVolume(v) }, "trash"))),
    );
  const pruneVolumes = () =>
    dockerDropDialog({
      at,
      title: t("docker.volume.pruneTitle"),
      lead: t("docker.volume.pruneLead", { n: spare.length, size: bytes(sum(spare)), names: spare.map((v) => (v.anonymous ? v.name.slice(0, 12) + "…" : v.name)).join(", ") }),
      warn: t("docker.volume.dataGoesAll"),
      command: "docker volume prune -a",
      password: true,
      go: t("docker.pruneGo"),
      run: async (password) => {
        const done = await api("POST", `${base}/volumes/prune`, { password });
        return t("docker.volume.pruned", { n: done.count, size: bytes(done.freed) });
      },
    });
  const pruneCache = () =>
    dockerDropDialog({
      at,
      title: t("docker.cache.title"),
      lead: t("docker.cache.lead", { size: bytes(space.cache) }),
      command: "docker builder prune -a",
      go: t("docker.pruneGo"),
      run: async () => t("docker.freed", { size: bytes((await api("POST", `${base}/cache/prune`, {})).freed) }),
    });

  const head = (title, list, unused, prune) =>
    h(
      "div",
      { class: "section-head pad" },
      h("div", { class: "grow" }, h("h2", null, title, h("span", { class: "muted" }, " " + list.length)), h("p", { class: "muted small" }, unused.length ? t("docker.unusedSum", { n: unused.length, size: bytes(sum(unused)) }) : t("docker.allUsed"))),
      unused.length > 0 && button(t("docker.prune"), { class: "small", onclick: prune }, "trash"),
    );
  const table = (columns, rows) => h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, columns.map((c) => h("th", null, c)))), h("tbody", null, rows)));
  const columns = (first) => [first, t("docker.size"), t("docker.created"), t("docker.usedBy"), ""];
  return [
    h(
      "section",
      { class: "card pad stack" },
      h("div", { class: "section-head" }, h("h2", { class: "grow" }, at ? t("docker.onMachine") : t("settings.docker")), button(t("docker.recount"), { class: "small", onclick: () => (delete spaces[at], paintSpace(at), loadSpace(at)) }, "refresh")),
      h("p", { class: "muted small" }, t(at ? "docker.leadMachine" : "docker.lead")),
      space.cache > 0 && h("div", { class: "section-head" }, h("p", { class: "muted small grow" }, t("docker.cache.line", { size: bytes(space.cache) })), button(t("docker.cache.clear"), { class: "small", onclick: pruneCache })),
    ),
    h("section", { class: "card" }, head(t("docker.images"), images, idle, pruneImages), images.length ? table(columns(t("docker.image")), images.map(imageRow)) : h("p", { class: "muted pad" }, t("docker.none"))),
    h("section", { class: "card" }, head(t("docker.volumes"), volumes, spare, pruneVolumes), volumes.length ? table(columns(t("docker.volume")), volumes.map(volumeRow)) : h("p", { class: "muted pad" }, t("docker.noVolumes"))),
  ];
}

let imagesTimer;
/** Settings → Apps: newer images in the registries, and the apps updating by themselves */
function imagesCard() {
  const s = state.settings.images;
  const st = state.images;
  if (!st) return null;
  const apps = state.overview?.apps ?? [];
  const check = h("input", { type: "checkbox", checked: s.check });
  const auto = h("input", { type: "checkbox", checked: s.auto, disabled: !s.check });
  const time = h("input", { type: "time", value: s.time, class: "short mono", required: true });
  const included = apps.map((app) => ({ name: app.name, box: h("input", { type: "checkbox", checked: !s.exclude.includes(app.name) }), title: app.title }));
  const whenAuto = h("div", { class: "stack", hidden: !s.auto }, field(`${t("images.time")} · ${state.settings.systemTimezone}`, time), included.length > 0 && h("div", { class: "stack" }, h("strong", null, t("images.apps")), included.map((a) => h("label", { class: "check" }, a.box, h("span", null, a.title)))));
  check.onchange = () => {
    auto.disabled = !check.checked;
    if (!check.checked) auto.checked = false;
    whenAuto.hidden = !auto.checked;
  };
  auto.onchange = () => (whenAuto.hidden = !auto.checked);
  const error = h("p", { class: "error", role: "alert" });
  const again = async (path, method = "GET") => {
    state.images = await api(method, path, method === "GET" ? undefined : {}).catch(() => state.images);
    // the marks on the apps come with the list of apps
    if (!state.images.running) await refresh();
    if (state.route.view === "settings" && state.route.section === "apps") renderSettings();
  };
  clearTimeout(imagesTimer);
  if (st.running) imagesTimer = setTimeout(() => state.route.view === "settings" && again("/api/images"), 3000);
  const status = st.running ? t("images.running") : st.at ? t("images.status", { when: ago(st.at), asked: st.asked, newer: st.newer }) : t("images.never");
  return h(
    "form",
    {
      class: "card pad stack",
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        try {
          state.settings = await api("PUT", "/api/settings", { images: { check: check.checked, auto: auto.checked, time: time.value, exclude: included.filter((a) => !a.box.checked).map((a) => a.name) } });
          toast(t("settings.saved"));
          await refresh();
          renderSettings();
        } catch (err) {
          error.textContent = errorText(err);
        }
      },
    },
    h("h2", null, t("images.title")),
    h("label", { class: "check" }, check, h("span", null, h("strong", null, t("images.check")), h("span", { class: "muted small block" }, t("images.checkHint")))),
    s.check && settingRow(status, "", button(t("images.checkNow"), { disabled: st.running, onclick: () => again("/api/images/check", "POST") }, "refresh")),
    s.check && st.failed.length > 0 && !st.running && h("details", null, h("summary", { class: "muted small" }, t("images.failed", { n: st.failed.length })), st.failed.map((f) => h("p", { class: "small" }, h("span", { class: "mono" }, f.image), " — ", h("span", { class: "muted" }, f.message)))),
    h("label", { class: "check" }, auto, h("span", null, h("strong", null, t("images.auto")), h("span", { class: "muted small block" }, t("images.autoHint")))),
    whenAuto,
    error,
    h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
  );
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

/** Settings → HTTPS and domain: the name on the home network, which needs no domain and no setting up */
function localNameCard() {
  const local = state.settings.local;
  const enabled = h("input", { type: "checkbox", checked: local.enabled });
  const name = h("input", { value: local.name, maxLength: 253, placeholder: "hata.local", spellcheck: false, autocapitalize: "none", class: "mono", required: true, "aria-label": t("local.name") });
  const error = h("p", { class: "error", role: "alert" });
  const status = h("div", { class: "stack" });
  let alive = true;
  cleanups.push(() => (alive = false));
  const paint = async () => {
    const s = await api("GET", "/api/local").catch(() => null);
    if (!alive || !s) return;
    const port = s.port === 80 ? "" : ":" + s.port;
    const address = (host) => h("a", { class: "link mono", href: `http://${host}${port}/` }, host + port);
    status.replaceChildren(
      ...(!s.enabled
        ? []
        : !s.own
          ? [
              h("p", { class: "muted small" }, t("local.otherLead", { domain: s.domain, address: s.addresses[0] ?? "—" })),
              ...s.checks.map((c) => h("div", { class: "activity-item" }, icon(c.ok ? "check" : "x", c.ok ? "ok" : "danger"), h("div", { class: "grow" }, h("div", null, c.ok ? address(c.host) : h("span", { class: "mono" }, c.host)), h("div", { class: "muted small" }, c.ok ? t("local.leadsHere") : c.found.length ? t("local.leadsElsewhere", { addresses: c.found.join(", ") }) : t("local.unknown"))))),
            ]
          : !s.listening
            ? [h("p", { class: "error" }, t("local.failed", { message: s.error || "…" }))]
            : [
              h("div", { class: "activity-item" }, icon("check", "ok"), h("div", { class: "grow" }, h("div", null, address(s.domain)), h("div", { class: "muted small" }, t("local.answers", { addresses: s.addresses.join(", ") || "—" })))),
                (state.overview?.apps ?? []).some((a) => a.port) && h("p", { class: "muted small" }, t("local.apps", { example: `${(state.overview.apps.find((a) => a.port).name).replace(/_/g, "-")}.${s.domain}${port}` })),
              ]),
    );
  };
  void paint();
  return h(
    "form",
    {
      class: "card pad",
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        try {
          state.settings = await api("PUT", "/api/settings", { local: { enabled: enabled.checked, name: name.value } });
          toast(t("settings.saved"));
          await refresh();
          // the responder takes a moment to start listening
          setTimeout(paint, 600);
        } catch (err) {
          error.textContent = errorText(err);
        }
      },
    },
    h("h2", null, t("local.title")),
    h("p", { class: "muted small" }, t("local.lead")),
    settingRow(t("local.enabled"), t("local.enabledHint"), enabled),
    settingRow(t("local.name"), t("local.nameHint"), name),
    status,
    error,
    h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
  );
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
    put(certs,
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
    localNameCard(),
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

// --- Notifications ------------------------------------------------------------------------------

/** Browsers offer notifications only to a page opened over HTTPS */
const pushSupported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const keyBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function pushSubscribe(key) {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("denied");
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  // a subscription made for another server key (Hata was set up anew) cannot be carried over
  const old = await registration.pushManager.getSubscription();
  if (old) await old.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api("POST", `/api/notify/push?lang=${state.lang}`, { subscription: subscription.toJSON(), label: deviceName(navigator.userAgent) });
  localStorage.setItem("hata.push", subscription.endpoint);
}

/**
 * The browser replaced this device's subscription without telling the service worker which one it was:
 * the new one is told to Hata when the page is opened, in place of the old. A device removed from the
 * list on purpose keeps its old subscription here, so it is left alone.
 */
async function pushResync() {
  const known = localStorage.getItem("hata.push");
  if (!isAdmin() || !pushSupported() || Notification.permission !== "granted") return;
  const local = await pushSubscription().catch(() => null);
  if (!local || local.endpoint === known) return;
  const info = await api("GET", "/api/notify/push").catch(() => null);
  // subscribed before this was remembered: remembered now
  if (!known) return void (info?.devices.some((d) => d.endpoint === local.endpoint) && localStorage.setItem("hata.push", local.endpoint));
  if (!info || info.devices.some((d) => d.endpoint === local.endpoint)) return localStorage.setItem("hata.push", local.endpoint);
  if (!info.devices.some((d) => d.endpoint === known)) return;
  try {
    await api("POST", "/api/notify/push/renew", { old: known, subscription: local.toJSON() });
    localStorage.setItem("hata.push", local.endpoint);
  } catch {}
}

function devicesCard() {
  const box = h("div", { class: "stack" });
  const error = h("p", { class: "error", role: "alert" });
  let alive = true;
  cleanups.push(() => (alive = false));
  const attempt = async (action) => {
    error.textContent = "";
    try {
      await action();
    } catch (e) {
      error.textContent = e instanceof ApiError ? errorText(e) : t(e.message === "denied" ? "notify.denied" : "notify.pushFailed", { message: e.message });
    }
    void paint();
  };
  const paint = async () => {
    if (!pushSupported()) return put(box, h("p", { class: "muted" }, t(window.isSecureContext ? "notify.pushUnsupported" : "notify.pushNeedsHttps")));
    const [info, sub] = await Promise.all([api("GET", "/api/notify/push").catch(() => null), pushSubscription().catch(() => null)]);
    if (!alive || !info) return;
    const here = sub && info.devices.some((d) => d.endpoint === sub.endpoint);
    put(
      box,
      info.devices.map((device) => {
        const own = sub?.endpoint === device.endpoint;
        return settingRow(
          device.label + (own ? ` · ${t("account.thisDevice")}` : ""),
          `${device.service} · ${dateTime(device.createdAt)}`,
          h(
            "span",
            { class: "row-actions" },
            button(t("notify.test"), { class: "small", onclick: () => attempt(async () => (await api("POST", "/api/notify/test", { channel: "push", device: device.id }), toast(t("notify.testSent")))) }),
            button(t("app.remove"), { class: "small", onclick: () => attempt(async () => (own && (await sub.unsubscribe().catch(() => {}), localStorage.removeItem("hata.push")), await api("DELETE", `/api/notify/push?id=${device.id}`))) }),
          ),
        );
      }),
      !here && h("div", null, button(t("notify.pushHere"), { class: "primary", onclick: () => attempt(() => pushSubscribe(info.key)) }, "bell")),
    );
  };
  void paint();
  return h("section", { class: "card pad" }, h("h2", null, t("notify.push.title")), h("p", { class: "muted small" }, t("notify.push.lead")), box, error);
}

function channelCard(channel, rows, values) {
  const config = state.notify.config[channel];
  const last = state.notify.last[channel];
  const enabled = h("input", { type: "checkbox", checked: config.enabled });
  const error = h("p", { class: "error", role: "alert" });
  const attempt = async (test) => {
    error.textContent = "";
    try {
      state.notify = await api("PUT", "/api/notify", { [channel]: { enabled: enabled.checked, ...values() } });
      if (test) state.notify = await api("POST", "/api/notify/test", { channel });
      toast(t(test ? "notify.testSent" : "settings.saved"));
      renderSettings();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  return h(
    "form",
    { class: "card pad", onsubmit: (e) => (e.preventDefault(), void attempt(false)) },
    h("h2", null, t(`notify.${channel}.title`)),
    h("p", { class: "muted small" }, t(`notify.${channel}.lead`)),
    settingRow(t("notify.enabled"), "", enabled),
    rows,
    last?.error && h("p", { class: "error" }, t("notify.lastError", { time: ago(last.at), message: last.error })),
    error,
    h("footer", { class: "pair" }, button(t("notify.test"), { onclick: () => attempt(true) }), h("button", { class: "btn primary" }, t("settings.save"))),
  );
}

/** A saved token never comes back to the page: only one typed anew is sent, an empty field keeps what is saved */
const typedToken = (input) => (input.value.trim() ? { token: input.value } : {});

function telegramCard() {
  const config = state.notify.config.telegram;
  const token = h("input", { type: "password", autocomplete: "off", spellcheck: false, class: "mono", placeholder: config.saved ? t("notify.tokenSaved") : "123456789:AA…" });
  const chat = h("input", { value: config.chat, spellcheck: false, class: "mono", placeholder: "123456789" });
  const found = h("div", { class: "pair" });
  const find = async () => {
    try {
      const chats = await api("POST", "/api/notify/telegram/chats", { token: token.value.trim() });
      if (chats.length === 1) chat.value = chats[0].id;
      put(found, chats.length === 0 ? h("p", { class: "muted small" }, t("notify.telegram.noChats")) : chats.length > 1 && chats.map((c) => button(c.title, { class: "small", onclick: () => (chat.value = c.id) })));
    } catch (e) {
      put(found, h("p", { class: "error" }, errorText(e)));
    }
  };
  return channelCard(
    "telegram",
    [settingRow(t("notify.telegram.token"), t("notify.telegram.tokenHint"), token), settingRow(t("notify.telegram.chat"), t("notify.telegram.chatHint"), h("span", { class: "pair" }, chat, button(t("notify.telegram.find"), { class: "small", onclick: find }, "search"))), found],
    () => ({ ...typedToken(token), chat: chat.value }),
  );
}

/** Mail through an SMTP server: the provider's one (with an app password) or a relay of your own */
function emailCard() {
  const config = state.notify.config.email;
  const host = h("input", { value: config.host, spellcheck: false, class: "mono", placeholder: "smtp.gmail.com" });
  const port = h("input", { type: "number", min: 1, max: 65535, value: config.port, class: "mono port" });
  const security = h("select", null, ["starttls", "tls", "none"].map((value) => h("option", { value, selected: config.security === value }, t("notify.email.security." + value))));
  // the usual port follows the choice, unless one of one's own was typed
  security.addEventListener("change", () => {
    if (["", "25", "465", "587"].includes(port.value)) port.value = security.value === "tls" ? "465" : security.value === "starttls" ? "587" : "25";
  });
  const user = h("input", { value: config.user, spellcheck: false, autocomplete: "off", class: "mono" });
  const password = h("input", { type: "password", autocomplete: "new-password", spellcheck: false, class: "mono", placeholder: config.saved ? t("notify.tokenSaved") : "" });
  const forget = config.saved && button(t("notify.tokenForget"), { class: "small", onclick: async () => {
    try {
      state.notify = await api("PUT", "/api/notify", { email: { password: "" } });
      renderSettings();
    } catch (err) {
      toast(errorText(err), "error");
    }
  } });
  const from = h("input", { type: "email", value: config.from, spellcheck: false, class: "mono", placeholder: "hata@example.org" });
  const to = h("input", { value: config.to.join(", "), spellcheck: false, class: "mono", placeholder: "me@example.org" });
  return channelCard(
    "email",
    [
      settingRow(t("notify.email.host"), t("notify.email.hostHint"), h("span", { class: "pair" }, host, port)),
      settingRow(t("notify.email.securityTitle"), t("notify.email.securityHint"), security),
      settingRow(t("notify.email.user"), t("notify.email.userHint"), user),
      settingRow(t("notify.email.password"), t("notify.email.passwordHint"), forget ? h("span", { class: "pair" }, password, forget) : password),
      settingRow(t("notify.email.from"), t("notify.email.fromHint"), from),
      settingRow(t("notify.email.to"), t("notify.email.toHint"), to),
    ],
    () => ({ host: host.value, port: Number(port.value), security: security.value, user: user.value, from: from.value, to: to.value, ...(password.value ? { password: password.value } : {}) }),
  );
}

function notificationsSection() {
  const n = state.notify;
  if (!n) return [h("p", { class: "muted" }, "…")];
  const error = h("p", { class: "error", role: "alert" });
  const toggle = (key) => {
    const box = h("input", {
      type: "checkbox",
      checked: n.config[key],
      onchange: async () => {
        error.textContent = "";
        try {
          state.notify = await api("PUT", "/api/notify", { [key]: box.checked });
          toast(t("settings.saved"));
        } catch (err) {
          box.checked = !box.checked;
          error.textContent = errorText(err);
        }
      },
    });
    return box;
  };
  const ntfyUrl = h("input", { type: "url", value: n.config.ntfy.url, spellcheck: false, class: "mono", placeholder: "https://ntfy.sh/my-topic" });
  const ntfyToken = h("input", { type: "password", autocomplete: "off", spellcheck: false, class: "mono", placeholder: n.config.ntfy.saved ? t("notify.tokenSaved") : "" });
  const forget = n.config.ntfy.saved && button(t("notify.tokenForget"), { class: "small", onclick: () => attemptForget() });
  const attemptForget = async () => {
    try {
      state.notify = await api("PUT", "/api/notify", { ntfy: { token: "" } });
      renderSettings();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };
  const hook = h("input", { type: "url", value: n.config.webhook.url, spellcheck: false, class: "mono", placeholder: "https://…" });
  return [
    h("section", { class: "card pad" }, h("h2", null, t("settings.notifications")), h("p", { class: "muted small" }, t("notify.lead")), settingRow(t("notify.problems"), t("notify.problemsHint"), toggle("problems")), settingRow(t("notify.resolved"), t("notify.resolvedHint"), toggle("resolved")), settingRow(t("notify.backups"), t("notify.backupsHint"), toggle("backups")), error),
    devicesCard(),
    telegramCard(),
    channelCard("ntfy", [settingRow(t("notify.ntfy.url"), t("notify.ntfy.urlHint"), ntfyUrl), settingRow(t("notify.ntfy.token"), t("notify.ntfy.tokenHint"), forget ? h("span", { class: "pair" }, ntfyToken, forget) : ntfyToken)], () => ({ url: ntfyUrl.value, ...typedToken(ntfyToken) })),
    emailCard(),
    channelCard("webhook", [settingRow(t("notify.webhook.url"), t("notify.webhook.urlHint"), hook)], () => ({ url: hook.value })),
  ];
}

// --- Disks --------------------------------------------------------------------------------------

// the colours of an app's state say the same three things about a disk
const HEALTH_STATE = { ok: "running", warn: "partial", danger: "restarting", unknown: "" };
const healthChip = (disk) => h("span", { class: "state " + HEALTH_STATE[disk.health] }, t("disks.health." + disk.health));
const diskTitle = (disk) => disk.model || disk.name;
const diskMeta = (disk) => [bytes(disk.size), disk.name, disk.transport === "nvme" ? "NVMe" : disk.transport.toUpperCase(), disk.transport !== "nvme" && t(disk.rotational ? "disks.kind.hdd" : "disks.kind.ssd"), disk.removable && t("disks.removable")].filter(Boolean).join(" · ");

function usageBar(used, total) {
  const percent = Math.round((used / total) * 100);
  const fill = h("i", { class: level(percent) });
  fill.style.width = percent + "%";
  return h("div", { class: "usage" }, h("div", { class: "usage-text" }, h("span", null, t("disks.usedOf", { used: bytes(used), total: bytes(total) })), h("span", { class: "muted" }, percent + "%")), h("div", { class: "bar" }, fill));
}

/** How long a disk has been switched on, from its count of hours */
function powerOnTime(hours) {
  const days = Math.floor(hours / 24);
  if (days < 2) return t("time.hours", { n: hours });
  if (days < 60) return t("time.days", { n: days });
  const months = Math.floor(days / 30.44);
  return [months >= 12 && t("time.years", { n: Math.floor(months / 12) }), months % 12 > 0 && t("time.months", { n: months % 12 })].filter(Boolean).join(" ");
}

const shortDate = (ts) => new Date(ts).toLocaleDateString(state.lang, { day: "numeric", month: "short", ...(new Date(ts).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });

let diskDialogPaint = null;

function setDisks(data) {
  state.disks = data;
  if (state.route.view === "settings" && state.route.section === "storage") renderSettings();
  if (state.route.view === "welcome") paintWelcome();
  diskDialogPaint?.();
}

function diskDialog(name) {
  const body = h("div", { class: "stack" });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const test = (type) => async (e) => {
    error.textContent = "";
    e.currentTarget.disabled = true;
    try {
      setDisks(await api("POST", `/api/disks/${name}/test`, { type }));
      toast(t("disks.test.started"));
    } catch (err) {
      error.textContent = errorText(err);
      paint();
    }
  };
  const paint = () => {
    const disk = state.disks?.disks.find((d) => d.name === name);
    if (!disk) return dialog?.close();
    const s = disk.smart;
    const value = (label, hint, shown, bad = false) => h("div", { class: "kv" }, h("div", null, label, hint && h("div", { class: "muted small" }, hint)), h("strong", { class: bad ? "bad" : "" }, shown));
    // a counter Hata saw at another value says so: "was 0 until 14 Sep"
    const moved = (key) => {
      const log = disk.log?.[key === "media" ? "mediaErrors" : key] ?? [];
      return log.length > 1 ? t("disks.value.was", { n: log.at(-2).value, date: shortDate(log.at(-1).at) }) : "";
    };
    const count = (key, n) => n != null && value(t(`disks.value.${key}`), moved(key) || t(`disks.value.${key}Hint`), String(n), n > 0 && key !== "crc");
    const last = s?.lastTest;
    put(
      body,
      h("header", null, h("span", { class: "badge-icon " + (disk.health === "ok" || disk.health === "unknown" ? "plain" : disk.health) }, icon("disk")), h("div", { class: "grow" }, h("h2", null, diskTitle(disk)), h("p", { class: "muted small" }, diskMeta(disk))), healthChip(disk), closeX(() => dialog)),
      !s && h("p", { class: "muted" }, t(state.disks.tool === "ok" ? "disks.noSmart" : `disks.tool.${state.disks.tool}Hint`)),
      s && (disk.findings.length ? disk.findings.map((f) => h("p", { class: "banner" + (f.severity === "danger" ? " danger" : "") }, t("disks.finding." + f.code, { n: f.n ?? 0 }))) : h("p", { class: "muted" }, t("disks.fine"))),
      s?.testing != null && h("p", { class: "with-icon" }, icon("refresh"), t("disks.test.running", { n: s.testing })),
      s &&
        h(
          "div",
          { class: "kv-list" },
          s.passed != null && value(t("disks.value.passed"), "", t(s.passed ? "disks.value.passedYes" : "disks.value.passedNo"), !s.passed),
          count("reallocated", s.reallocated),
          count("pending", s.pending),
          count("uncorrectable", s.uncorrectable),
          count("media", s.mediaErrors),
          count("crc", s.crc),
          s.wear != null && value(t("disks.value.wear"), t("disks.value.wearHint"), s.wear + "%", s.wear >= 90),
          s.spare && value(t("disks.value.spare"), t("disks.value.spareHint", { n: s.spare.threshold }), s.spare.left + "%", s.spare.left < s.spare.threshold),
          s.temperature != null && value(t("disks.value.temperature"), disk.hottest && disk.hottest.value > s.temperature ? t("disks.value.hottest", { n: disk.hottest.value, date: shortDate(disk.hottest.at) }) : "", s.temperature + " °C", disk.findings.some((f) => f.code === "hot")),
          s.powerOnHours != null && value(t("disks.value.powerOn"), t("disks.value.powerOnHint", { hours: s.powerOnHours, cycles: s.powerCycles ?? "—" }), powerOnTime(s.powerOnHours)),
          value(t("disks.value.lastTest"), last ? t("disks.value.testWhen", { type: has("disks.test." + last.type) ? t("disks.test." + last.type) : last.type, hours: Math.max(0, (s.powerOnHours ?? 0) - (last.hours ?? 0)) }) : "", last ? t(last.passed ? "disks.value.testPassed" : "disks.value.testFailed") : t("disks.value.testNever"), last && !last.passed),
        ),
      s && h("p", { class: "muted small" }, t("disks.test.hint")),
      error,
      s && h("footer", null, h("span", { class: "muted small" }, disk.checkedAt ? t("disks.checked", { when: ago(disk.checkedAt) }) : ""), button(t("disks.test.runShort"), { disabled: s.testing != null, onclick: test("short") }), button(t("disks.test.runLong"), { disabled: s.testing != null, onclick: test("long") })),
      state.disks.mounting?.possible &&
        h(
          "div",
          { class: "disk-use" },
          h("h3", null, t("mounting.title")),
          disk.volumes.map((v) =>
            h(
              "div",
              { class: "kv" },
              h("div", null, h("span", { class: "mono" }, v.name), h("div", { class: "muted small" }, [bytes(v.size), v.fstype || t("mounting.noFs"), v.label].filter(Boolean).join(" · "))),
              h(
                "span",
                { class: "with-actions" },
                v.mounts.length ? h("span", { class: "mono" }, v.mounts[0]) : state.disks.mounting.mountable.includes(v.path) ? button(t("mounting.connect"), { class: "small", onclick: () => (dialog.close(), connectDialog(disk, v)) }) : h("span", { class: "muted" }, t(v.swap ? "mounting.swap" : "disks.notMounted")),
                canTend(disk, v) && button(t("fsck.go"), { class: "small quiet", onclick: () => (dialog.close(), checkDialog(disk, v)) }),
                canTend(disk, v) && button(t("mounting.rename"), { class: "small quiet", onclick: () => (dialog.close(), labelDialog(disk, v)) }),
                v.kind === "part" && disk.volumes.length > 1 && changeable(disk).volumes.includes(v.path) && button(t("mounting.format"), { class: "small quiet", onclick: () => (dialog.close(), formatDialog(disk, v)) }),
              ),
            ),
          ),
          (state.disks.mounting.free?.[disk.name] ?? 0) > 0 &&
            h("div", { class: "kv" }, h("div", null, h("span", null, t("mounting.unallocated")), h("div", { class: "muted small" }, bytes(state.disks.mounting.free[disk.name]))), h("span", { class: "with-actions" }, button(t("mounting.newPart"), { class: "small", onclick: () => (dialog.close(), formatDialog(disk, null, state.disks.mounting.free[disk.name])) }))),
          changeable(disk).whole ? h("footer", null, h("span", { class: "muted small" }, t("mounting.formatHint")), button(t("mounting.wipe"), { class: "quiet", onclick: () => (dialog.close(), wipeDialog(disk)) }), button(t("mounting.formatDisk"), { onclick: () => (dialog.close(), formatDialog(disk)) })) : h("p", { class: "muted small" }, t("mounting.blocked." + (state.disks.mounting.blockers[disk.name]?.[0] ?? "mounted"))),
        ),
    );
  };
  dialog = openDialog("wide disk", body);
  diskDialogPaint = paint;
  dialog.addEventListener("close", () => (diskDialogPaint = null));
  paint();
}

// --- Putting a disk to use ---------------------------------------------------------------------------

const canPrepare = (disk) => state.disks?.mounting?.possible && state.disks.mounting.blockers[disk.name]?.length === 0;
const canConnect = (disk) => (state.disks?.mounting?.possible ? disk.volumes.filter((v) => state.disks.mounting.mountable.includes(v.path)) : []);
/** What of a disk may be formatted, checked or renamed — the server's word */
const changeable = (disk) => (state.disks?.mounting?.possible && state.disks.mounting.changeable?.[disk.name]) || { whole: false, volumes: [] };
const fsFamily = (fstype) => (/^ext[234]$/.test(fstype) ? "ext4" : ["exfat", "vfat", "ntfs"].includes(fstype) ? fstype : null);
/** A file system Hata can check and rename */
const canTend = (disk, volume) => !!fsFamily(volume.fstype) && changeable(disk).volumes.includes(volume.path);
const FS_NAMES = { ext4: "ext4", exfat: "exFAT", vfat: "FAT32", ntfs: "NTFS" };

/** The label as the file system will carry it — the server makes it the same way */
function fsLabel(fs, text) {
  const fit = (value, max, width) => {
    let out = "";
    let used = 0;
    for (const char of value) {
      used += width(char);
      if (used > max) break;
      out += char;
    }
    return out.trim();
  };
  const plain = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (fs === "vfat") return fit(plain.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[*?.,;:/\\|+=<>[\]"]/g, "").toUpperCase().trim(), 11, () => 1);
  if (fs === "ext4") return fit(plain.replace(/\//g, "-"), 16, (char) => new TextEncoder().encode(char).length);
  return fit(plain.replace(/["*/:<>?\\|]/g, ""), fs === "exfat" ? 11 : 32, (char) => char.length);
}
const MOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const mountName = (text) => text.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+|[-._]+$/g, "").slice(0, 24).replace(/[-._]+$/, "") || "disk";

/** The reason, the command and the button for a package an action turned out to need */
function packageCard(detail, retry) {
  const error = h("p", { class: "error", role: "alert" });
  return h(
    "div",
    { class: "banner stack" },
    h("strong", null, t(`mounting.needs.${detail.package}.what`)),
    h("p", { class: "muted small" }, t(`mounting.needs.${detail.package}.why`)),
    detail.install ? h("p", { class: "cmd" }, icon("terminal"), detail.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: detail.package })),
    error,
    detail.install &&
      button(
        t("mounting.needs.install", { package: detail.package }),
        {
          class: "small",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              setDisks(await api("POST", "/api/disks/package", { package: detail.package }));
              retry();
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        },
        "download",
      ),
  );
}

/** Runs a disk action from a dialog: the button waits, an error stays in the dialog, a missing package is offered */
function diskAction(dialogOf, slot, request, done) {
  const run = async (e) => {
    const el = e?.currentTarget ?? slot.closest("dialog").querySelector("footer .btn:last-child");
    el.disabled = true;
    put(slot);
    try {
      const data = await request();
      if (!data.job) setDisks(data);
      done(data);
    } catch (err) {
      el.disabled = false;
      put(slot, err instanceof ApiError && err.detail?.package ? packageCard(err.detail, () => run()) : h("p", { class: "error", role: "alert" }, errorText(err)));
    }
  };
  return run;
}

/**
 * Erases a disk, or one partition of it, and makes a file system there: which one, under what label,
 * and whether it is connected afterwards.
 */
function formatDialog(disk, part, free = 0) {
  const removable = disk.removable || disk.transport === "usb";
  // `free` — the room no partition takes: a new partition is made there and nothing is erased
  const targets = free ? [] : part ? [part] : disk.volumes;
  const GB = 1e9;
  const room = free || disk.size;
  const size = h("input", { type: "text", inputMode: "decimal", class: "short", placeholder: (room / GB).toFixed(room < 10 * GB ? 1 : 0), "aria-label": t("mounting.size") });
  const sizeHint = h("span", { class: "hint" });
  const asked = () => Math.round(Number(size.value.trim().replace(",", ".")) * GB);
  const holds = targets.filter((v) => v.fstype);
  const leaving = targets.flatMap((v) => v.mounts);
  const old = free ? "" : ((part ?? disk.volumes.find((v) => v.label))?.label ?? "");
  const fs = h("select", null, Object.keys(FS_NAMES).map((id) => h("option", { value: id, selected: id === (removable ? "exfat" : "ext4") }, t("mounting.fs." + id))));
  const label = h("input", { type: "text", value: old || (removable || free ? "" : disk.model), maxlength: 40, spellcheck: false });
  const after = h("select", null, ["keep", "once", "no"].map((id) => h("option", { value: id, selected: id === (removable ? "once" : "keep") }, t("mounting.after." + id))));
  const name = h("input", { type: "text", maxlength: 32, spellcheck: false });
  const typed = h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: (part ?? disk).name });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const fsHint = h("span", { class: "hint" });
  const labelHint = h("span", { class: "hint" });
  const afterHint = h("span", { class: "hint" });
  const where = h("span", { class: "hint mono" });
  const folder = h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.folder")), name, where, h("span", { class: "hint" }, t("mounting.nameHint")));
  const open = h("p", { class: "banner" });
  const cmd = h("span");
  const slot = h("div");
  let dialog;
  let named = false;
  const go = button(t(free ? "mounting.newPartGo" : "mounting.formatGo"), { class: free ? "primary" : "danger", disabled: true });
  const check = () => {
    const written = fsLabel(fs.value, label.value);
    if (!named) name.value = leaving[0]?.startsWith("/mnt/") ? leaving[0].slice(5) : mountName((removable ? "usb-" : "") + (written || disk.model || "disk"));
    const connects = after.value !== "no";
    fsHint.textContent = t("mounting.fsHint." + fs.value);
    labelHint.textContent = t("mounting.labelHint." + fs.value) + (written && written !== label.value.trim() ? " " + t("mounting.labelBecomes", { label: written }) : "");
    afterHint.textContent = t("mounting.afterHint." + after.value);
    where.textContent = "/mnt/" + name.value;
    folder.hidden = !connects;
    open.hidden = !connects || fs.value === "ext4";
    open.textContent = t("mounting.noOwners", { fs: FS_NAMES[fs.value] });
    const sized = size.value.trim() !== "";
    const fits = !sized || (asked() >= 64 * 1024 * 1024 && asked() <= room);
    sizeHint.textContent = !fits ? t("mounting.sizeBad", { max: bytes(room) }) : t(free ? "mounting.sizeHintFree" : sized ? "mounting.sizeHintRest" : "mounting.sizeHint", { rest: bytes(Math.max(0, room - asked())), max: bytes(room) });
    cmd.textContent = [!part && `sfdisk ${free ? "--append " : ""}${disk.path}`, `mkfs.${fs.value === "vfat" ? "fat" : fs.value} ${part ? part.path : free ? "…" : disk.path + (/\d$/.test(disk.path) ? "p1" : "1")}`, after.value === "keep" && "/etc/fstab"].filter(Boolean).join("; ");
    go.disabled = (connects && !MOUNT_NAME.test(name.value)) || !fits || (!free && (typed.value.trim() !== (part ?? disk).name || !password.value));
  };
  name.addEventListener("input", () => ((named = true), check()));
  for (const input of [fs, label, after, typed, password, size]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", `/api/disks/${disk.name}/format`, { serial: disk.serial, size: disk.size, part: free ? "free" : (part?.path ?? ""), bytes: part || !size.value.trim() ? 0 : asked(), fs: fs.value, label: label.value, connect: after.value, name: name.value, password: password.value }),
    (data) => {
      dialog.close();
      const path = "/mnt/" + name.value;
      const [kind, into, how] = [fs.value, name.value, after.value];
      jobDialog(data.job, "format", part ? part.name : diskTitle(disk), async () => {
        if (free) return toast(how === "no" ? t("mounting.formatted", { fs: FS_NAMES[kind] }) : t("mounting.formattedAt", { fs: FS_NAMES[kind], path }));
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        if (how === "keep" && kind === "ext4") {
          document.querySelectorAll("dialog[open]").forEach((d) => d.close());
          preparedDialog("/mnt/" + into);
        } else toast(how === "no" ? t("mounting.formatted", { fs: FS_NAMES[kind] }) : t("mounting.formattedAt", { fs: FS_NAMES[kind], path }));
      });
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, free ? t("mounting.newPartTitle", { disk: diskTitle(disk) }) : t("mounting.formatTitle", { disk: part ? `${part.name} · ${diskTitle(disk)}` : diskTitle(disk) })),
    h("p", { class: "muted small" }, part ? [part.name, bytes(part.size)].join(" · ") : diskMeta(disk)),
    free > 0 && h("p", { class: "muted" }, t("mounting.newPartLead", { free: bytes(free) })),
    !free && h(
      "p",
      { class: "banner danger" },
      t(part ? "mounting.formatPartErases" : holds.length ? "mounting.formatErases" : "mounting.formatEmpty"),
      holds.length > 0 && h("span", { class: "block mono small" }, holds.map((v) => [v.name, v.fstype, v.label, bytes(v.size)].filter(Boolean).join(" · ")).join("; ")),
      leaving.length > 0 && h("span", { class: "block" }, t("mounting.formatLeaves", { paths: leaving.join(", ") })),
    ),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.fs")), fs, fsHint),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.label")), label, labelHint),
    !part && h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.size")), size, sizeHint),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.after")), after, afterHint),
    folder,
    open,
    !free && field(t("mounting.typeName", { name: (part ?? disk).name }), typed),
    !free && field(t("account.password"), password, t("mounting.passwordHint")),
    h("p", { class: "cmd" }, icon("terminal"), cmd),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

/** Erases a disk and leaves it empty: quickly, or with every block written over — for a disk that goes to somebody else */
function wipeDialog(disk) {
  const holds = disk.volumes.filter((v) => v.fstype);
  const leaving = disk.volumes.flatMap((v) => v.mounts);
  const thorough = h("input", { type: "checkbox" });
  const typed = h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: disk.name });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const cmd = h("span");
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.wipeGo"), { class: "danger", disabled: true });
  const check = () => {
    cmd.textContent = thorough.checked ? `dd if=/dev/zero of=${disk.path} bs=4M` : `wipefs -a ${disk.path}`;
    go.disabled = typed.value.trim() !== disk.name || !password.value;
  };
  for (const input of [thorough, typed, password]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", `/api/disks/${disk.name}/wipe`, { serial: disk.serial, size: disk.size, thorough: thorough.checked, password: password.value }),
    (data) => {
      dialog.close();
      jobDialog(data.job, "wipe", diskTitle(disk), async () => {
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        toast(t("mounting.wiped"));
      });
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("mounting.wipeTitle", { disk: diskTitle(disk) })),
    h("p", { class: "muted small" }, diskMeta(disk)),
    h(
      "p",
      { class: "banner danger" },
      t(holds.length ? "mounting.formatErases" : "mounting.formatEmpty"),
      holds.length > 0 && h("span", { class: "block mono small" }, holds.map((v) => [v.name, v.fstype, v.label, bytes(v.size)].filter(Boolean).join(" · ")).join("; ")),
      leaving.length > 0 && h("span", { class: "block" }, t("mounting.formatLeaves", { paths: leaving.join(", ") })),
    ),
    h("p", { class: "muted" }, t("mounting.wipeLead")),
    h("label", { class: "check" }, thorough, h("span", null, h("strong", null, t("mounting.wipeThorough")), h("span", { class: "muted small block" }, t(disk.rotational ? "mounting.wipeThoroughHint" : "mounting.wipeThoroughFlash")))),
    field(t("mounting.typeName", { name: disk.name }), typed),
    field(t("account.password"), password, t("mounting.passwordHint")),
    h("p", { class: "cmd" }, icon("terminal"), cmd),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

/** Looks a file system over without changing it; damage that is found can then be repaired */
function checkDialog(disk, volume) {
  const title = volume.label || volume.name;
  const slot = h("div");
  const result = h("div", { class: "stack" });
  let dialog;
  const go = button(t("fsck.go"), { class: "primary" });
  const start = (repair) => (e) => {
    put(result, h("p", { class: "with-icon muted" }, icon("refresh"), t(repair ? "fsck.repairing" : "fsck.running")));
    // an error is shown in its own place: the line that says "checking" goes
    return diskAction(
      () => dialog,
      slot,
      () => api("POST", "/api/disks/fsck", { device: volume.path, repair }),
      async (started) => {
        const lines = h("pre", { class: "said" });
        // a look can be ended; a repair goes to its end
        put(result, h("div", { class: "section-head" }, h("p", { class: "with-icon muted" }, icon("refresh"), t(repair ? "fsck.repairing" : "fsck.running")), !repair && stopButton(started.job)), lines);
        const job = await followJob(started.job, (line) => {
          lines.append(line + "\n");
          lines.scrollTop = lines.scrollHeight;
        });
        go.disabled = false;
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        if (job.stopped) return put(result, h("p", { class: "banner" }, t("fsck.stopped")), job.error && job.error !== "Stopped." && h("p", { class: "error" }, job.error));
        if (job.status !== "done" || !job.result) return put(result, h("p", { class: "banner danger" }, t("fsck.verdict.failed")), h("pre", { class: "said" }, job.error || lines.textContent));
        const { verdict, output, back } = job.result;
        const mend = verdict === "errors" && !repair;
        put(
          result,
          h("p", { class: "banner " + (verdict === "errors" || verdict === "failed" ? "danger" : "ok") }, t("fsck.verdict." + verdict)),
          back && h("p", { class: "error", role: "alert" }, t("fsck.back", { message: back })),
          output && h("details", { open: verdict !== "clean" }, h("summary", { class: "muted small" }, t("fsck.said")), h("pre", { class: "said" }, output)),
          mend && h("div", { class: "row-actions" }, button(t("fsck.repair"), { class: "primary", onclick: start(true) })),
        );
      },
    )(e).then(() => slot.firstChild && put(result));
  };
  go.onclick = start(false);
  dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("fsck.title", { name: title })), h("p", { class: "muted small" }, [volume.name, volume.fstype, bytes(volume.size)].join(" · "))), closeX(() => dialog)),
    h("p", { class: "muted" }, t("fsck.lead")),
    volume.mounts.length > 0 && h("p", { class: "banner" }, t("fsck.leadMounted", { path: volume.mounts[0] })),
    volume.fstype === "ntfs" && h("p", { class: "muted small" }, t("fsck.ntfs")),
    result,
    slot,
    h("footer", null, closeButton(() => dialog, t("common.close")), go),
  );
}

/** Gives a file system another label — the name other devices show the disk under */
function labelDialog(disk, volume) {
  const fs = fsFamily(volume.fstype);
  const label = h("input", { type: "text", value: volume.label, maxlength: 40, spellcheck: false });
  const hint = h("span", { class: "hint" });
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.rename"), { class: "primary" });
  const check = () => {
    const written = fsLabel(fs, label.value);
    hint.textContent = t("mounting.labelHint." + fs) + (written && written !== label.value.trim() ? " " + t("mounting.labelBecomes", { label: written }) : "");
    go.disabled = !written || written === volume.label;
  };
  label.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/label", { device: volume.path, label: label.value }),
    () => {
      dialog.close();
      toast(t("relabel.done", { label: fsLabel(fs, label.value) }));
    },
  );
  dialog = openDialog(
    "confirm",
    h("h2", null, t("relabel.title", { name: volume.label || volume.name })),
    h("p", { class: "muted" }, t("relabel.lead")),
    volume.mounts.length > 0 && fs !== "ext4" && h("p", { class: "banner" }, t("relabel.leadMounted", { path: volume.mounts[0] })),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.label")), label, hint),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

function preparedDialog(path) {
  const backups = `${path}/Backups`;
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", null, t("mounting.readyTitle")),
    h("p", { class: "muted" }, t("mounting.readyLead", { path })),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.close")),
      h("a", { class: "btn", href: filesHash(path), onclick: () => dialog.close() }, t("disks.fs.browse")),
      button(t("data.moveHere"), { onclick: () => (dialog.close(), moveDataDialog(`${path}/DATA`)) }),
      button(t("mounting.useForBackups"), {
        class: "primary",
        onclick: async () => {
          try {
            state.settings = await api("PUT", "/api/settings", { backup: { dir: backups } });
            dialog.close();
            toast(t("mounting.backupsThere", { path: backups }));
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }),
    ),
  );
}

function connectDialog(disk, volume) {
  const removable = disk.removable || disk.transport === "usb";
  const name = h("input", { type: "text", value: mountName(volume.label || disk.model || "disk"), maxlength: 32, spellcheck: false });
  const keep = h("input", { type: "checkbox", checked: !removable });
  const where = h("span", { class: "hint mono" });
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.connect"), { class: "primary" });
  const check = () => {
    where.textContent = "/mnt/" + name.value;
    go.disabled = !MOUNT_NAME.test(name.value);
  };
  name.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/connect", { device: volume.path, name: name.value, keep: keep.checked }),
    () => {
      dialog.close();
      toast(t("mounting.connected", { path: "/mnt/" + name.value }));
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("mounting.connectTitle", { disk: volume.label || diskTitle(disk) })),
    h("p", { class: "muted small" }, [volume.name, volume.fstype, bytes(volume.size)].join(" · ")),
    h("p", { class: "muted" }, t("mounting.connectLead")),
    /^(vfat|exfat|ntfs)$/.test(volume.fstype) && h("p", { class: "banner" }, t("mounting.noOwners", { fs: volume.fstype })),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.name")), name, where, h("span", { class: "hint" }, t("mounting.nameHint"))),
    h("label", { class: "check" }, keep, h("span", null, h("strong", null, t("mounting.keep")), h("span", { class: "muted small block" }, t("mounting.keepHint")))),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

function mergeDialog() {
  const folders = state.disks.mounting.mergeable;
  const boxes = folders.map((path) => h("input", { type: "checkbox", checked: true, value: path }));
  const name = h("input", { type: "text", value: "storage", maxlength: 32, spellcheck: false });
  const where = h("span", { class: "hint mono" });
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.mergeGo"), { class: "primary" });
  const check = () => {
    where.textContent = "/mnt/" + name.value;
    go.disabled = !MOUNT_NAME.test(name.value) || boxes.filter((b) => b.checked).length < 2;
  };
  for (const input of [name, ...boxes]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/merge", { folders: boxes.filter((b) => b.checked).map((b) => b.value), name: name.value }),
    () => {
      dialog.close();
      toast(t("mounting.mergedAs", { path: "/mnt/" + name.value }));
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("mounting.mergeTitle")),
    h("p", { class: "muted" }, t("mounting.mergeLead")),
    boxes.map((box) => h("label", { class: "check" }, box, h("span", { class: "mono" }, box.value))),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.name")), name, where, h("span", { class: "hint" }, t("mounting.nameHint"))),
    h("p", { class: "banner" }, t("mounting.mergeWarn")),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

/**
 * Copies what a plugged-in disk holds onto the server: which of its file systems, everything or the
 * chosen folders and files, and where to. The disk is connected for it when it is not yet.
 */
function copyInDialog(disk) {
  const volumes = disk.volumes.filter((v) => v.fstype && (v.mounts.length || state.disks.mounting.mountable.includes(v.path)));
  if (!volumes.length) return toast(t("copyin.nothing"), "error");
  const HIDDEN = /^(\.hata-trash|lost\+found|System Volume Information|\$RECYCLE\.BIN|\.Trashes|\.Spotlight-V100|\.fseventsd)$/;
  const error = h("p", { class: "error", role: "alert" });
  const which = h("select", { onchange: () => open() }, volumes.map((v, i) => h("option", { value: String(i) }, [v.label || v.name, v.fstype, bytes(v.size)].join(" · "))));
  const all = h("input", { type: "checkbox", checked: true, onchange: () => paint() });
  const crumbs = h("div", { class: "crumbs wrap small" });
  const list = h("div", { class: "snapshot-files" });
  const sub = h("input", { type: "text", maxlength: 80, spellcheck: false, value: `${(volumes[0].label || disk.model || "USB").trim()} ${new Date().toISOString().slice(0, 10)}`, oninput: () => where() });
  const target = h("span", { class: "mono" });
  const go = button(t("copyin.go"), { class: "primary" }, "download");
  let mount = "";
  let at = "";
  let top = [];
  let entries = [];
  let into = "";
  const chosen = new Set();
  const full = (name, dir = at) => (dir.endsWith("/") ? dir : dir + "/") + name;
  const where = () => {
    const name = sub.value.trim().replace(/\//g, "-");
    target.textContent = name ? full(name, into) : into;
    go.disabled = !mount || !into || (!all.checked && chosen.size === 0) || (all.checked && top.length === 0);
    go.lastChild.textContent = all.checked ? t("copyin.goAll") : t("copyin.goChosen", { n: chosen.size });
  };
  const paint = () => {
    const steps = at === mount ? [] : at.slice(mount.length).split("/").filter(Boolean);
    crumbs.replaceChildren(h("button", { type: "button", class: "text-btn", onclick: () => show(mount) }, volumes[Number(which.value)].label || diskTitle(disk)), ...steps.flatMap((step, i) => [icon("chevron"), h("button", { type: "button", class: "text-btn", onclick: () => show(full(steps.slice(0, i + 1).join("/"), mount)) }, step)]));
    list.replaceChildren(
      ...(entries.length
        ? entries.map((entry) => {
            const path = full(entry.name);
            const tick = h("input", { type: "checkbox", checked: all.checked || chosen.has(path), disabled: all.checked, "aria-label": entry.name, onchange: () => ((tick.checked ? chosen.add(path) : chosen.delete(path)), where()) });
            const dir = entry.type === "dir";
            return h("div", { class: "snapshot-file" }, tick, icon(dir ? "folder" : "file"), dir ? h("button", { type: "button", class: "text-btn grow name", onclick: () => show(path) }, entry.name) : h("span", { class: "grow name" }, entry.name), h("span", { class: "muted small" }, dir ? "" : bytes(entry.size)), h("span", { class: "muted small when" }, dateTime(entry.modified)));
          })
        : [h("p", { class: "muted" }, t("backup.files.empty"))]),
    );
    where();
  };
  const show = async (path) => {
    error.textContent = "";
    try {
      const listing = await api("GET", `/api/files?path=${encodeURIComponent(path)}`);
      at = path;
      entries = listing.entries.filter((e) => !HIDDEN.test(e.name));
      if (path === mount) top = entries.map((e) => full(e.name, mount));
      paint();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  const open = async () => {
    const volume = volumes[Number(which.value)];
    chosen.clear();
    mount = "";
    list.replaceChildren(h("p", { class: "muted" }, t("copyin.opening")));
    where();
    try {
      // not connected yet: it is, until it is unplugged or ejected
      let now = state.disks.disks.flatMap((d) => d.volumes).find((v) => v.path === volume.path);
      if (!now?.mounts.length) {
        state.disks = await api("POST", "/api/disks/connect", { device: volume.path, name: mountName("usb-" + (volume.label || disk.model || "disk")), keep: false });
        now = state.disks.disks.flatMap((d) => d.volumes).find((v) => v.path === volume.path);
      }
      mount = now.mounts[0];
      if (!into) into = (await api("GET", "/api/files?path=")).home;
      await show(mount);
    } catch (err) {
      list.replaceChildren();
      error.textContent = errorText(err);
    }
  };
  go.onclick = async () => {
    go.disabled = true;
    error.textContent = "";
    try {
      const res = await api("POST", "/api/files/copy-in", { paths: all.checked ? top : [...chosen], to: target.textContent });
      const to = target.textContent;
      dialog.close();
      jobDialog(res.job, "copyin", "", () => {
        toast(t("copyin.done", { path: to }));
        if (state.route.view === "settings") void api("GET", "/api/disks").then(setDisks, () => {});
      });
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  };
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("copyin.title", { disk: diskTitle(disk) })), h("p", { class: "muted small" }, t("copyin.lead"))), closeX(() => dialog)),
    volumes.length > 1 && field(t("copyin.which"), which),
    h("label", { class: "check" }, all, h("span", null, h("strong", null, t("copyin.all")), h("span", { class: "muted small block" }, t("copyin.allHint")))),
    crumbs,
    list,
    h("h3", null, t("copyin.where")),
    h("div", { class: "kv" }, target, button(t("copyin.choose"), { class: "small", onclick: () => folderPicker({ title: t("copyin.where"), start: into, confirmLabel: t("copyin.here"), action: async (path) => ((into = path), where()), allowed: (path) => !mount || !(path === mount || path.startsWith(mount + "/")) }) }, "folder")),
    field(t("copyin.sub"), sub, t("copyin.subHint")),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  where();
  void open();
}

function disconnectDialog(mount) {
  const removable = state.disks.disks.some((d) => d.name === mount.disk && (d.removable || d.transport === "usb"));
  const slot = h("div");
  let dialog;
  const go = button(t(removable ? "mounting.eject" : "mounting.disconnect"), { class: "primary" });
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/disconnect", { path: mount.path }),
    () => {
      dialog.close();
      toast(t(removable ? "mounting.ejected" : "mounting.disconnected", { path: mount.path }));
    },
  );
  dialog = openDialog("confirm", h("h2", null, t(removable ? "mounting.ejectTitle" : "mounting.disconnectTitle", { path: mount.path })), h("p", { class: "muted" }, t(removable ? "mounting.ejectLead" : "mounting.disconnectLead")), slot, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

let disksTimer = 0;

/** Long work on a disk that runs while the page is open: what it says last, and the way back to it */
let diskWorkListener = null;
function diskWorkStrip(work) {
  // a disk by its model, a file system by its device
  const disk = state.disks?.disks.find((d) => d.name === work.target);
  const title = work.kind === "pool" ? t("pool.goal." + work.target) : disk ? diskTitle(disk) : work.target;
  const line = h("span", { class: "muted small mono clip" }, work.line);
  const stop = work.stoppable && stopButton(work.id);
  jobListeners.delete(diskWorkListener);
  diskWorkListener = (event) => {
    if (event.job.id !== work.id) return;
    if (event.line !== undefined) line.textContent = event.line;
    if (event.job.stopped && stop) stop.disabled = true;
    if (event.job.status !== "running") {
      jobListeners.delete(diskWorkListener);
      void api("GET", "/api/disks").then(setDisks, () => {});
    }
  };
  jobListeners.add(diskWorkListener);
  return h(
    "section",
    { class: "card pad" },
    h(
      "div",
      { class: "section-head" },
      h("div", { class: "with-icon grow" }, icon("refresh"), h("div", { class: "grow" }, h("div", { class: "strong" }, t("mounting.working." + work.kind), title && h("span", { class: "muted" }, " · " + title)), line)),
      h("div", { class: "row-actions" }, button(t("mounting.working.show"), { class: "small", onclick: () => jobDialog(work.id, work.kind, title, () => void api("GET", "/api/disks").then(setDisks, () => {})) }), stop && (stop.classList.add("small"), stop)),
    ),
  );
}

/** When a disk's reading is worth a word: its temperature by kind, and how worn a flash disk may be */
function smartLimitsDialog(limits) {
  const number = (key, min, max) => h("input", { type: "number", min, max, step: 1, value: limits[key], class: "short mono", required: true });
  const hotHdd = number("hotHdd", 30, 90);
  const hotFlash = number("hotFlash", 30, 110);
  const wear = number("wear", 10, 100);
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
            state.settings = await api("PUT", "/api/settings", { storage: { smart: { hotHdd: Number(hotHdd.value), hotFlash: Number(hotFlash.value), wear: Number(wear.value) } } });
            dialog.close();
            setDisks(await api("GET", "/api/disks"));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("disks.limits.title")), h("p", { class: "muted small" }, t("disks.limits.lead"))), closeX(() => dialog)),
      field(t("disks.limits.hotHdd"), h("div", { class: "with-icon" }, hotHdd, h("span", { class: "muted" }, "°C")), t("disks.limits.hotHddHint")),
      field(t("disks.limits.hotFlash"), h("div", { class: "with-icon" }, hotFlash, h("span", { class: "muted" }, "°C")), t("disks.limits.hotFlashHint")),
      field(t("disks.limits.wear"), h("div", { class: "with-icon" }, wear, h("span", { class: "muted" }, "%")), t("disks.limits.wearHint")),
      error,
      h("footer", null, button(t("disks.limits.defaults"), { class: "quiet", onclick: () => ((hotHdd.value = "55"), (hotFlash.value = "70"), (wear.value = "90")) }), h("span", { class: "grow" }), closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("settings.save"))),
    ),
  );
}

function storageSection() {
  const data = state.disks;
  if (!data) return [h("p", { class: "muted" }, "…")];
  const error = h("p", { class: "error", role: "alert" });
  const busy = (label, done) => async (e) => {
    const el = e.currentTarget;
    error.textContent = "";
    el.disabled = true;
    el.lastChild.textContent = label;
    try {
      setDisks(await api("POST", done.path, {}));
      if (done.toast) toast(done.toast);
    } catch (err) {
      setDisks(state.disks);
      document.querySelector("#disks-error")?.replaceChildren(errorText(err));
    }
  };
  error.id = "disks-error";

  // while a disk tests itself or the data folder is measured, the progress is worth watching
  clearTimeout(disksTimer);
  if (data.fills?.running || data.disks.some((d) => d.smart?.testing != null)) {
    disksTimer = setTimeout(
      async () => {
        if (state.route.view === "settings" && state.route.section === "storage") setDisks(await api("GET", "/api/disks").catch(() => state.disks));
      },
      data.fills?.running ? 3000 : 20_000,
    );
  }

  const row = (disk) => {
    const mounted = disk.volumes.filter((v) => v.total != null);
    const total = mounted.reduce((n, v) => n + v.total, 0);
    const used = mounted.reduce((n, v) => n + v.used, 0);
    const mounts = disk.volumes.flatMap((v) => v.mounts);
    const hot = disk.findings.some((f) => f.code === "hot");
    return h(
      "tr",
      { class: "clickable", onclick: () => diskDialog(disk.name) },
      h("td", null, h("div", { class: "with-icon" }, h("span", { class: "badge-icon " + (disk.health === "ok" || disk.health === "unknown" ? "plain" : disk.health) }, icon("disk")), h("div", null, h("div", { class: "strong" }, diskTitle(disk)), h("div", { class: "muted small mono" }, diskMeta(disk))))),
      h("td", null, healthChip(disk)),
      h("td", { class: "num" + (hot ? " bad" : "") }, disk.smart?.temperature != null ? disk.smart.temperature + " °C" : "—"),
      h("td", null, total ? usageBar(used, total) : h("span", { class: "muted" }, "—")),
      h("td", { class: "mono" }, mounts.length ? mounts.map((m) => h("div", { class: "clip" }, m)) : h("span", { class: "muted" }, t("disks.notMounted"))),
      h("td", null, h("div", { class: "row-actions" }, canPrepare(disk) && !mounts.length && !canConnect(disk).length && button(t("mounting.format"), { class: "small primary", onclick: (e) => (e.stopPropagation(), formatDialog(disk)) }), (disk.removable || disk.transport === "usb") && state.disks.mounting?.possible && disk.volumes.some((v) => v.fstype && v.mounts.length > 0) && button(t("copyin.button"), { class: "small", onclick: (e) => (e.stopPropagation(), copyInDialog(disk)) }, "download"), canConnect(disk).length > 0 && button(t("mounting.connect"), { class: "small primary", onclick: (e) => (e.stopPropagation(), connectDialog(disk, canConnect(disk)[0])) }), button(t("disks.details"), { class: "small", onclick: (e) => (e.stopPropagation(), diskDialog(disk.name)) }))),
    );
  };
  const checked = Math.max(0, ...data.disks.map((d) => d.checkedAt ?? 0));
  const fsRow = (m) =>
    h(
      "tr",
      null,
      h("td", null, h("a", { class: "strong mono", href: filesHash(m.path), title: t("disks.fs.browse") }, m.path)),
      h("td", null, h("div", { class: "mono clip" }, data.mounting?.pools[m.path]?.join(" + ") ?? m.device), h("div", { class: "muted small" }, [data.mounting?.pools[m.path] ? t("mounting.merged") : m.fstype, m.network && t("disks.fs.network"), m.readOnly && t("disks.fs.readOnly")].filter(Boolean).join(" · "))),
      h("td", null, usageBar(m.used, m.total)),
      h("td", null, data.mounting?.ours[m.path] && !inPool(m.path) && h("div", { class: "row-actions" }, button(t(ejectable(m) ? "mounting.eject" : "mounting.disconnect"), { class: "small", onclick: () => disconnectDialog(m) }))),
    );
  // a folder kept in /etc/fstab whose disk is not there now: still Hata's to forget
  const absent = Object.keys(data.mounting?.ours ?? {}).filter((path) => !data.mounts.some((m) => m.path === path));
  const absentRow = (path) => h("tr", null, h("td", null, h("span", { class: "strong mono" }, path)), h("td", { class: "muted" }, t("mounting.absent")), h("td"), h("td", null, h("div", { class: "row-actions" }, button(t("mounting.disconnect"), { class: "small", onclick: () => disconnectDialog({ path, disk: "" }) }))));
  // a disk of a merged folder is taken out through the merged folder
  const inPool = (path) => Object.values(data.mounting?.pools ?? {}).some((folders) => folders.includes(path));
  const ejectable = (m) => data.disks.some((d) => d.name === m.disk && (d.removable || d.transport === "usb"));
  const automount = h("input", {
    type: "checkbox",
    checked: data.mounting?.automount,
    onchange: async (e) => {
      try {
        state.settings = await api("PUT", "/api/settings", { storage: { automount: e.target.checked } });
        setDisks(await api("GET", "/api/disks"));
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(errorText(err), "error");
      }
    },
  });
  // a disk nothing uses yet is said so at the top, until it is put to use or waved away
  const unused = (data.mounting?.unused ?? []).map((u) => u.id);
  const fresh = data.disks.filter((d) => canPrepare(d) && unused.includes(d.serial || d.name));
  // asked for on the home page: the dialog opens as soon as the disks are known
  if (state.copyInFrom) {
    const from = data.disks.find((d) => (d.serial || d.name) === state.copyInFrom);
    state.copyInFrom = null;
    if (from) setTimeout(() => copyInDialog(from), 0);
  }
  const freshCard = (disk) => {
    const holds = disk.volumes.filter((v) => v.fstype);
    const connectable = canConnect(disk);
    return h(
      "section",
      { class: "card pad new-disk" },
      h("span", { class: "badge-icon warn" }, icon("disk")),
      h("div", { class: "grow" }, h("strong", null, t("mounting.found", { disk: diskTitle(disk), size: bytes(disk.size) })), h("p", { class: "muted small" }, holds.length ? t("mounting.foundHolds", { what: holds.map((v) => [v.label, v.fstype].filter(Boolean).join(" · ")).join("; ") }) : t("mounting.foundEmpty"))),
      h(
        "div",
        { class: "row-actions" },
        button(t("mounting.ignore"), { class: "small quiet", onclick: async () => setDisks(await api("POST", "/api/disks/ignore", { id: disk.serial || disk.name }).catch(() => state.disks)) }),
        connectable.length > 0 && (disk.removable || disk.transport === "usb") && button(t("copyin.button"), { class: "small primary", onclick: () => copyInDialog(disk) }, "download"),
        connectable.length > 0 && button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(disk, connectable[0]) }),
        button(t("mounting.format"), { class: "small" + (connectable.length ? "" : " primary"), onclick: () => formatDialog(disk) }),
      ),
    );
  };
  return [
    data.working && diskWorkStrip(data.working),
    fresh.map(freshCard),
    data.tool === "missing" &&
      data.disks.length > 0 &&
      h(
        "section",
        { class: "card pad" },
        h("h2", null, t("disks.tool.missing")),
        h("p", { class: "muted" }, t("disks.tool.what")),
        h("p", { class: "muted" }, t("disks.tool.why")),
        data.install ? [h("p", { class: "muted" }, t("disks.tool.how")), h("p", { class: "cmd" }, icon("terminal"), data.install)] : h("p", { class: "muted" }, t("disks.tool.byHand")),
        data.install && h("footer", null, button(t("disks.tool.install"), { class: "primary", onclick: busy(t("disks.tool.installing"), { path: "/api/disks/tool", toast: t("disks.tool.installed") }) }, "download")),
      ),
    data.tool === "denied" && data.disks.length > 0 && h("section", { class: "card pad" }, h("strong", null, t("disks.tool.denied")), h("p", { class: "muted small" }, t("disks.tool.deniedHint"))),
    h(
      "section",
      { class: "card table-wrap" },
      h(
        "div",
        { class: "pad card-head" },
        h("div", { class: "section-head" }, h("h2", null, t("disks.title"), h("span", { class: "muted" }, t("disks.connected", { n: data.disks.length }))), h("div", { class: "row-actions" }, data.mounting?.possible && data.array && data.disks.length > 1 && button(t("pool.open"), { class: "small", onclick: () => poolDialog() }), (data.mounting?.mergeable.length ?? 0) > 1 && button(t("mounting.merge"), { class: "small", onclick: () => mergeDialog() }), data.tool === "ok" && data.disks.length > 0 && checked > 0 && h("span", { class: "muted small" }, t("disks.checked", { when: ago(checked) })), data.tool === "ok" && data.disks.length > 0 && data.limits && button(t("disks.limits"), { class: "small", onclick: () => smartLimitsDialog(data.limits) }), data.tool === "ok" && data.disks.length > 0 && button(t("disks.checkNow"), { class: "small", onclick: busy("…", { path: "/api/disks/check" }) }, "refresh"))),
        h("p", { class: "muted small" }, t(data.disks.length ? "disks.lead" : "disks.none")),
        error,
      ),
      data.disks.length > 0 && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("disks.col.disk")), h("th", null, t("disks.col.health")), h("th", { class: "num" }, t("disks.col.temp")), h("th", null, t("disks.col.usage")), h("th", null, t("disks.col.mounted")), h("th"))), h("tbody", null, data.disks.map(row))),
    ),
    (data.mounts.length > 0 || absent.length > 0) &&
      h(
        "section",
        { class: "card table-wrap" },
        h("div", { class: "pad card-head" }, h("h2", null, t("disks.fs.title")), h("p", { class: "muted small" }, t("disks.fs.lead"))),
        h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("disks.fs.col.path")), h("th", null, t("disks.fs.col.source")), h("th", null, t("disks.col.usage")), h("th"))), h("tbody", null, data.mounts.map(fsRow), absent.map(absentRow))),
      ),
    data.mounting?.possible && h("section", { class: "card pad" }, h("label", { class: "check" }, automount, h("span", null, h("strong", null, t("mounting.automount")), h("span", { class: "muted small block" }, t("mounting.automountHint"))))),
    state.places && placesCard(state.places),
    data.array && data.mounting?.possible && arrayCard(data, data.array),
    data.fills && fillsCard(data.fills, busy),
  ].filter(Boolean);
}

// --- Network places: folders of other machines mounted here -----------------------------------------

const PLACE_KINDS = ["smb", "nfs", "sftp", "webdav", "ftp"];
const placeAddress = (p) => (p.kind === "webdav" ? p.url : p.kind === "smb" ? `//${p.host}/${p.path}` : p.kind === "nfs" ? `${p.host}:${p.path}` : `${p.kind}://${p.user ? p.user + "@" : ""}${p.host}${p.port ? ":" + p.port : ""}${p.path.startsWith("/") ? p.path : "/~/" + p.path}`);

async function reloadPlaces(list) {
  state.places = list ? { ...state.places, places: list } : await api("GET", "/api/netplaces").catch(() => state.places);
  if (state.route.view === "settings" && state.route.section === "storage") renderSettings();
}

function placesCard(data) {
  const row = (p) => {
    const chip = p.mounted && !p.away ? h("span", { class: "state running" }, t("netplace.on")) : p.state === "activating" ? h("span", { class: "state partial" }, t("netplace.connecting")) : h("span", { class: "state restarting" }, t("netplace.off"));
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon" }, h("span", { class: "badge-icon plain" }, icon("globe")), h("div", null, h("a", { class: "strong", href: filesHash(p.folder) }, p.name), h("div", { class: "muted small mono clip" }, placeAddress(p))))),
      h("td", null, chip, p.readOnly && h("span", { class: "chip" }, t("netplace.readOnly"))),
      h("td", null, p.mounted && p.total ? usageBar(p.total - p.free, p.total) : h("span", { class: "muted mono small" }, p.folder)),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          (!p.mounted || p.away) && button(t("netplace.retry"), { class: "small", onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await reloadPlaces((await api("POST", `/api/netplaces/${p.id}/retry`, {})).places);
            } catch (err) {
              toast(errorText(err), "error");
              void reloadPlaces();
            }
          } }, "refresh"),
          button(t("netplace.change"), { class: "small", onclick: () => placeDialog(p) }),
          button(t("netplace.remove"), { class: "small quiet", onclick: () => removePlaceDialog(p) }),
        ),
      ),
    );
  };
  return h(
    "section",
    { class: "card table-wrap" },
    h(
      "div",
      { class: "pad card-head" },
      h("div", { class: "section-head" }, h("h2", null, t("netplace.title")), h("div", { class: "row-actions" }, button(t("netplace.find"), { class: "small", onclick: () => findPlacesDialog() }, "search"), button(t("netplace.connect"), { class: "small primary", onclick: () => placeDialog() }, "plus"))),
      h("p", { class: "muted small" }, t(data.places.length ? "netplace.lead" : "netplace.none")),
    ),
    data.places.length > 0 && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("netplace.col.place")), h("th", null, t("netplace.col.state")), h("th", null, t("disks.col.usage")), h("th"))), h("tbody", null, data.places.map(row))),
  );
}

/** The menu of a place in the sidebar of Files: open it, and what can be done to the disk or the network place it is */
async function sidebarMenu(at, { label, path, machine = "", volume = null, iconName = "folder" }) {
  const href = filesHash(path, machine);
  const entries = [
    { label: t("common.open"), icon: "folder", href },
    { label: t("menu.newTab"), icon: "external", href: location.pathname + location.search + href, newTab: true },
    { label: t("files.copyPath"), icon: "copy", run: () => copyText(path) },
  ];
  if (!machine && isAdmin()) {
    const pinned = (state.files?.pinned ?? state.overview?.folders?.map((folder) => folder.path) ?? []).includes(path);
    entries.push({ label: t(pinned ? "files.unpin" : "files.pin"), icon: "home", run: () => pinFolder(path, !pinned, true, label) });
  }
  if (!machine && state.favorites) entries.push({ label: t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), icon: "star", run: () => favorite(path, !isFavorite(path), label) });
  if (volume && !machine && isAdmin()) {
    if (volume.network) {
      if (!state.places) state.places = await api("GET", "/api/netplaces").catch(() => null);
      const p = state.places?.places.find((one) => one.folder === volume.path);
      if (p) {
        entries.push(
          { label: t("netplace.change"), icon: "edit", run: () => placeDialog(p) },
          (!p.mounted || p.away) && { label: t("netplace.retry"), icon: "refresh", run: () => api("POST", `/api/netplaces/${p.id}/retry`, {}).then((res) => reloadPlaces(res.places), (err) => toast(errorText(err), "error")) },
          { label: t("netplace.remove"), icon: "trash", danger: true, run: () => removePlaceDialog(p) },
        );
      }
    } else {
      if (!state.disks) state.disks = await api("GET", "/api/disks").catch(() => null);
      const data = state.disks;
      const mount = data?.mounts.find((m) => m.path === volume.path);
      const disk = mount && data.disks.find((d) => d.name === mount.disk);
      const removable = !!disk && (disk.removable || disk.transport === "usb");
      const pooled = Object.values(data?.mounting?.pools ?? {}).some((folders) => folders.includes(volume.path));
      if (removable && data.mounting?.possible) entries.push({ label: t("copyin.button"), icon: "download", run: () => copyInDialog(disk) });
      if (mount && data.mounting?.ours[mount.path] && !pooled) entries.push({ label: t(removable ? "mounting.eject" : "mounting.disconnect"), icon: "signout", run: () => disconnectDialog(mount) });
    }
    entries.push({ label: t("menu.inStorage"), icon: "disk", href: "#/settings/storage" });
  }
  menuAt(at, menuHeader(label, path, iconName), entries);
}

/** "+ Network place" in Files: the dialog of Settings → Storage right there, and the new place opened once it is connected */
async function addPlaceHere(e) {
  e.preventDefault();
  if (!state.places) state.places = await api("GET", "/api/netplaces").catch(() => null);
  if (!state.places) return go("#/settings/storage");
  const before = new Set(state.places.places.map((p) => p.id));
  placeDialog(null, {}, (list) => {
    const made = list.find((p) => !before.has(p.id));
    if (made) go(filesHash(made.folder, ""));
  });
}

/** Connects a network place, or changes one; `seed` — a server found on the network, `after` hears the places once it is done */
function placeDialog(place = null, seed = {}, after = null) {
  let kind = place?.kind ?? seed.kind ?? "smb";
  let dialog;
  const value = (key, fallback = "") => place?.[key] ?? seed[key] ?? fallback;
  const name = h("input", { value: value("name"), maxLength: 40, required: true });
  const host = h("input", { value: value("host"), spellcheck: false, class: "mono", placeholder: "nas.local" });
  const port = h("input", { type: "number", min: 0, max: 65535, value: value("port", 0) || "", class: "mono port" });
  const url = h("input", { type: "url", value: value("url"), spellcheck: false, class: "mono", placeholder: "https://cloud.example.org/remote.php/dav/files/me" });
  const share = h("input", { value: value("path"), spellcheck: false, class: "mono" });
  const user = h("input", { value: value("user"), spellcheck: false, autocomplete: "off", class: "mono" });
  const password = h("input", { type: "password", autocomplete: "new-password", placeholder: place?.passwordSet ? t("notify.tokenSaved") : "" });
  const domain = h("input", { value: value("domain"), spellcheck: false, class: "mono", placeholder: "WORKGROUP" });
  const tls = h("input", { type: "checkbox", checked: !!value("tls", false) });
  const readOnly = h("input", { type: "checkbox", checked: !!value("readOnly", false) });
  const found = h("div", { class: "row-actions wrap" });
  const error = h("p", { class: "error", role: "alert" });
  const trust = h("div", { class: "banner stack", hidden: true });
  const needs = h("div");
  const modes = h("div", { class: "modes" });
  const fields = h("div", { class: "stack" });
  const submit = h("button", { class: "btn primary" }, t(place ? "settings.save" : "netplace.connectGo"));
  let trusted = "";
  // the server's own list, to pick from instead of typing
  const list = button(t(kind === "nfs" ? "netplace.showExports" : "netplace.showShares"), { class: "small", onclick: async () => {
    error.textContent = "";
    try {
      const names = await api("POST", "/api/netplaces/shares", { kind, host: host.value, user: user.value, password: password.value });
      put(found, names.length ? names.map((n) => button(n, { class: "small mono", onclick: () => (share.value = n) })) : h("span", { class: "muted small" }, t("netplace.noShares")));
    } catch (err) {
      showError(err);
    }
  } }, "search");
  const tools = () => state.places?.packages?.[kind] ?? { missing: [], install: "" };
  const showError = (err) => {
    error.textContent = errorText(err);
    if (err instanceof ApiError && err.code === "netplace.needsPackage") paintNeeds({ missing: err.detail.package.split(" "), install: err.detail.install }, err.detail.package === "smbclient" ? "smbclient" : kind);
  };
  const paintNeeds = (tool, forKind = kind) =>
    put(
      needs,
      tool.missing.length > 0 &&
        h(
          "div",
          { class: "banner stack" },
          h("strong", null, t(`netplace.needs.${forKind}`, { package: tool.missing.join(", ") })),
          h("p", { class: "muted small" }, t(`netplace.needs.${forKind}Why`)),
          tool.install ? h("p", { class: "cmd" }, icon("terminal"), tool.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: tool.missing.join(" ") })),
          tool.install && button(t("mounting.needs.install", { package: tool.missing.join(", ") }), { class: "small", onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            error.textContent = "";
            try {
              state.places = await api("POST", "/api/netplaces/package", { kind: forKind });
              paintNeeds(forKind === "smbclient" ? { missing: [] } : tools());
            } catch (err) {
              error.textContent = errorText(err);
              b.disabled = false;
            }
          } }, "download"),
        ),
    );
  const paint = () => {
    put(modes, PLACE_KINDS.map((k) => h("button", { type: "button", class: "mode" + (k === kind ? " active" : ""), disabled: !!place && k !== kind, onclick: () => ((kind = k), (trusted = ""), (trust.hidden = true), put(found), paint()) }, t(`netplace.kind.${k}`))));
    list.lastChild.textContent = t(kind === "nfs" ? "netplace.showExports" : "netplace.showShares");
    port.placeholder = { smb: "445", nfs: "2049", sftp: "22", ftp: "21", webdav: "" }[kind];
    share.placeholder = kind === "smb" ? "photos" : kind === "nfs" ? "/srv/media" : "/";
    host.required = kind !== "webdav";
    url.required = kind === "webdav";
    put(
      fields,
      h("p", { class: "muted small" }, t(`netplace.kind.${kind}Lead`)),
      field(t("netplace.name"), name, t("netplace.nameHint")),
      kind === "webdav" ? field(t("netplace.url"), url) : field(t("netplace.host"), h("span", { class: "pair" }, host, port), t("netplace.hostHint")),
      kind === "smb" || kind === "nfs" ? field(t(kind === "smb" ? "netplace.share" : "netplace.export"), h("span", { class: "pair" }, share, list), t(kind === "smb" ? "netplace.shareHint" : "netplace.exportHint")) : field(t("netplace.folder"), share, t("netplace.folderHint")),
      found,
      kind !== "nfs" && field(t("netplace.user"), user, t(kind === "smb" ? "netplace.userHintSmb" : "netplace.userHint")),
      kind !== "nfs" && field(t("netplace.password"), password),
      kind === "smb" && field(t("netplace.domain"), domain, t("netplace.domainHint")),
      kind === "nfs" && h("p", { class: "muted small" }, t("netplace.nfsOwners", { puid: `${state.settings?.puid ?? 1000}:${state.settings?.pgid ?? 1000}` })),
      kind === "ftp" && h("label", { class: "check" }, tls, h("span", null, h("strong", null, t("netplace.tls")), h("span", { class: "muted small block" }, t("netplace.tlsHint")))),
      h("label", { class: "check" }, readOnly, h("span", null, h("strong", null, t("netplace.readOnly")), h("span", { class: "muted small block" }, t("netplace.readOnlyHint")))),
    );
    paintNeeds(tools());
  };
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    const body = { kind, name: name.value, host: host.value, port: port.value, url: url.value, path: share.value, user: user.value, password: password.value, domain: domain.value, tls: tls.checked, readOnly: readOnly.checked, ...(trusted ? { trust: trusted } : {}) };
    submit.textContent = t("netplace.connecting");
    try {
      const res = await api(place ? "PUT" : "POST", place ? `/api/netplaces/${place.id}` : "/api/netplaces", body);
      if (res.unknownHost) {
        trusted = res.unknownHost;
        trust.hidden = false;
        put(trust, h("strong", null, t("netplace.hostKey", { host: host.value })), h("p", { class: "mono small" }, res.unknownHost), h("p", { class: "muted small" }, t("netplace.hostKeyHint")));
        submit.textContent = t("netplace.trustGo");
        submit.disabled = false;
        return;
      }
      dialog.close();
      toast(t(place ? "settings.saved" : "netplace.connected", { name: name.value }));
      await reloadPlaces(res.places);
      after?.(state.places.places);
    } catch (err) {
      showError(err);
      submit.textContent = t(place ? "settings.save" : "netplace.connectGo");
      submit.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { onsubmit: send },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t(place ? "netplace.changeTitle" : "netplace.connectTitle")), h("p", { class: "muted small" }, t("netplace.dialogLead"))), closeX(() => dialog)),
      modes,
      needs,
      fields,
      trust,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), submit),
    ),
  );
  paint();
  (place ? submit : name).focus();
}

function removePlaceDialog(p) {
  let dialog;
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("netplace.remove"), { class: "danger", onclick: async () => {
    go.disabled = true;
    try {
      const res = await api("DELETE", `/api/netplaces/${p.id}`);
      dialog.close();
      await reloadPlaces(res.places);
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  } });
  dialog = openDialog("confirm", h("h2", null, t("netplace.removeTitle", { name: p.name })), h("p", { class: "muted" }, t("netplace.removeLead", { path: p.folder })), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

/** Servers on the home network that announce a file service; each opens the dialog filled in */
async function findPlacesDialog() {
  let dialog;
  const body = h("div", { class: "stack" }, h("p", { class: "muted" }, t("netplace.finding")));
  dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("netplace.findTitle")), h("p", { class: "muted small" }, t("netplace.findLead"))), closeX(() => dialog)), body);
  let found = [];
  try {
    found = await api("GET", "/api/netplaces/discover");
  } catch (err) {
    return put(body, h("p", { class: "error" }, errorText(err)));
  }
  put(
    body,
    found.length
      ? found.map((f) => h("div", { class: "snapshot" }, h("span", { class: "badge-icon plain" }, icon("globe")), h("div", { class: "grow" }, h("strong", null, f.name), h("div", { class: "muted small mono" }, `${t("netplace.kind." + f.kind)} · ${f.host}${f.address ? " · " + f.address : ""}${f.port ? ":" + f.port : ""}`)), button(t("netplace.connect"), { class: "small primary", onclick: () => (dialog.close(), placeDialog(null, { kind: f.kind, host: f.address || f.host, name: f.name, port: [445, 2049, 22, 21, 80, 443].includes(f.port) ? 0 : f.port, url: f.kind === "webdav" ? `${f.port === 443 ? "https" : "http"}://${f.address || f.host}${[80, 443].includes(f.port) ? "" : ":" + f.port}/` : "" })) }, "plus")))
      : h("p", { class: "muted" }, t("netplace.foundNone")),
    h("p", { class: "muted small" }, t("netplace.findHint")),
  );
}

// --- Protection from a disk failure (SnapRAID) --------------------------------------------------

let arrayTimer = 0;
/** One call that changes the array; the answer is the whole storage page */
async function arrayCall(method, path, data, done) {
  try {
    setDisks(await api(method, "/api/disks/array" + path, data));
    done?.();
  } catch (err) {
    toast(errorText(err), "error");
  }
}

function arrayCard(data, array) {
  clearTimeout(arrayTimer);
  // a run moves without telling: the page looks again while one goes
  if (array.running) arrayTimer = setTimeout(async () => state.route.view === "settings" && state.route.section === "storage" && setDisks(await api("GET", "/api/disks").catch(() => state.disks)), 3000);
  const row = (label, value) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", null, value));
  const head = (...actions) => h("div", { class: "section-head" }, h("h2", null, t("array.title")), h("div", { class: "row-actions" }, actions));
  const lead = h("p", { class: "muted small" }, t("array.lead"));
  if (array.tool === "missing") {
    return h(
      "section",
      { class: "card pad stack" },
      head(),
      lead,
      h(
        "div",
        { class: "banner stack" },
        h("strong", null, t("array.needs.what")),
        h("p", { class: "muted small" }, t("array.needs.why")),
        array.needs.install ? h("p", { class: "cmd" }, icon("terminal"), array.needs.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: array.needs.package })),
        array.needs.install &&
          button(t("mounting.needs.install", { package: array.needs.package }), {
            class: "small",
            onclick: async (e) => {
              const el = e.currentTarget;
              el.disabled = true;
              try {
                setDisks(await api("POST", "/api/disks/package", { package: array.needs.package }));
              } catch (err) {
                el.disabled = false;
                toast(errorText(err), "error");
              }
            },
          }),
      ),
    );
  }
  if (!array.on) return h("section", { class: "card pad stack" }, head(button(t("pool.open"), { class: "small" + (array.candidates.length > 1 ? "" : " primary"), onclick: () => poolDialog() }), array.candidates.length > 1 && button(t("array.setUp"), { class: "small primary", onclick: () => arrayDialog(array) })), lead, array.candidates.length < 2 && h("p", { class: "muted small" }, t("array.needsDisks")), arrayFit(data));

  const busy = !!array.running;
  const d = array.diff;
  const waiting = d ? d.added + d.updated : 0;
  const act = (label, path, data, cls = "small") => button(label, { class: cls, disabled: busy, onclick: () => arrayCall("POST", path, data ?? {}) });
  const banners = [
    array.missing.length > 0 && h("div", { class: "banner danger stack" }, h("strong", null, t("array.missing", { disks: array.missing.join(", ") })), h("p", { class: "small" }, t("array.missingHint"))),
    array.trouble?.code === "diskEmpty" &&
      h("div", { class: "banner danger stack" }, h("strong", null, t("array.diskEmpty", { disk: array.settings.data.find((x) => x.name === array.trouble.disk)?.path ?? array.trouble.disk })), h("p", { class: "small" }, t("array.diskEmptyHint")), h("div", { class: "row-actions" }, button(t("array.recover"), { class: "small primary", disabled: busy, onclick: () => recoverDialog(array.settings.data.find((x) => x.name === array.trouble.disk)) }), act(t("array.emptyOnPurpose"), "/sync", { force: true, empty: true }))),
    array.trouble?.code === "parityLost" && h("div", { class: "banner danger stack" }, h("strong", null, t("array.parityLost", { disk: array.settings.parity })), h("p", { class: "small" }, t("array.parityLostHint")), h("div", { class: "row-actions" }, act(t("array.rebuild"), "/rebuild", {}, "small primary"))),
    array.errors > 0 && h("div", { class: "banner danger stack" }, h("strong", null, t("array.errors", { n: array.errors })), h("p", { class: "small" }, t("array.errorsHint")), h("div", { class: "row-actions" }, act(t("array.repair"), "/repair", {}, "small primary"))),
    array.held && h("div", { class: "banner stack" }, h("strong", null, t("array.held", { n: array.held.removed })), h("p", { class: "small" }, t("array.heldHint")), h("div", { class: "row-actions" }, act(t("array.bringBack"), "/fix", {}, "small primary"), act(t("array.syncAnyway"), "/sync", { force: true }))),
    !array.trouble && !array.held && array.lastSync && !array.lastSync.ok && h("p", { class: "banner small" }, t("array.failed", { message: array.lastSync.message })),
  ];
  const running =
    array.running &&
    h("div", { class: "banner stack" }, h("div", { class: "section-head" }, h("strong", null, t("array.running." + array.running.what), array.running.percent != null && ` · ${array.running.percent}%`), button(t("array.stop"), { class: "small", onclick: () => arrayCall("POST", "/stop", {}) })), h("p", { class: "muted small" }, t("array.runningHint")));
  return h(
    "section",
    { class: "card pad stack" },
    head(act(t("array.syncNow"), "/sync", {}), act(t("array.checkNow"), "/scrub", {}), button(t("array.settings"), { class: "small", disabled: busy, onclick: () => arrayDialog(array) }, "sliders")),
    lead,
    running,
    banners,
    h(
      "div",
      { class: "kv-list" },
      row(t("array.parity"), h("span", null, h("span", { class: "mono" }, array.settings.parity), array.paritySize > 0 && h("span", { class: "muted small" }, ` · ${bytes(array.paritySize)}`))),
      array.settings.data.map((disk, i) => row(i === 0 ? t("array.data") : "", h("span", { class: "with-actions" }, h("span", { class: "mono" }, disk.path), " ", button(t("array.recover"), { class: "small quiet", disabled: busy, onclick: () => recoverDialog(disk) })))),
      row(t("array.lastSync"), array.lastSync?.ok ? ago(array.lastSync.at) : array.lastSync ? t("array.lastFailed", { when: ago(array.lastSync.at) }) : t("array.never")),
      row(t("array.waiting"), !array.lastSync?.ok && !d ? "—" : waiting || d?.removed ? [waiting > 0 && t("array.waitingNew", { n: waiting }), d.removed > 0 && t("array.waitingGone", { n: d.removed })].filter(Boolean).join(" · ") : t("array.waitingNone")),
      row(t("array.lastScrub"), array.lastScrub ? `${ago(array.lastScrub.at)} · ${t(array.lastScrub.ok ? "array.scrubOk" : "array.scrubBad")}` : t("array.never")),
      row(t("array.schedule"), t(array.settings.scrub ? "array.scheduleScrub" : "array.scheduleSync", { time: array.settings.time })),
      array.appDataRule !== null && row("AppData", t(array.settings.appData ? "array.appDataIn" : "array.appDataOut")),
    ),
    array.log.length > 0 && h("details", null, h("summary", { class: "muted small" }, t("array.log")), h("pre", { class: "console small-console" }, array.log.join("\n"))),
  );
}

/**
 * Every disk and file system here, as the array and the merged folders see them: `step` — what it needs
 * before it can take part (format, connect, keep — connect for good, ready), null — it cannot; `why` —
 * said to the person either way.
 */
function storageRows(data) {
  const ours = data.mounting.ours;
  const pooled = Object.values(data.mounting.pools ?? {}).flat();
  const rows = [];
  const add = (row) => rows.push({ step: null, size: 0, path: "", device: "", ...row });
  for (const disk of data.disks) {
    const blocked = data.mounting.blockers[disk.name] ?? [];
    const base = { disk, title: diskTitle(disk), sub: [diskTitle(disk), disk.name, bytes(disk.size)].join(" · "), key: disk.name, size: disk.size };
    const stop = ["system", "member", "readonly"].find((b) => blocked.includes(b));
    if (stop) {
      add({ ...base, why: "array.fit." + stop });
      continue;
    }
    const volumes = disk.volumes.filter((v) => !v.swap);
    if (!volumes.some((v) => v.fstype)) {
      add({ ...base, why: "array.fit.blank", step: changeable(disk).whole ? "format" : null });
      continue;
    }
    for (const v of volumes) {
      const at = v.mounts[0];
      const row = { disk, volume: v, key: v.path, device: v.path, title: at ?? (v.label || diskTitle(disk)), sub: [diskTitle(disk), v.name, v.fstype || "—", bytes(v.size)].join(" · "), size: v.size };
      // a partition alone, or the whole disk when it is the only one
      const format = changeable(disk).volumes.includes(v.path) ? "format" : null;
      const whole = disk.volumes.length === 1;
      const ready = at && data.array.candidates.find((c) => c.path === at);
      if (ready) add({ ...row, step: "ready", path: at, size: ready.size, why: ready.merged || ready.holds ? "array.fit.dataOnly" : "array.fit.yes", pooled: pooled.includes(at), holds: !!ready.holds, parity: data.array.settings.parity === at });
      else if (!v.fstype) add({ ...row, why: "array.fit.blank", step: format, device: whole ? "" : v.path });
      else if (!/^(ext[234]|xfs|btrfs|f2fs)$/.test(v.fstype)) add({ ...row, why: "array.fit.foreign", fs: v.fstype, step: format, device: whole ? "" : v.path });
      else if (!at) add({ ...row, why: "array.fit.notConnected", step: data.mounting.mountable.includes(v.path) ? "connect" : null });
      else if (ours[at] === "temporary") add({ ...row, why: "array.fit.temporary", step: "keep", path: at });
      else if (ours[at] === "kept") add({ ...row, why: "array.fit.pool" });
      else add({ ...row, why: "array.fit.byHand", path: at });
    }
  }
  return rows;
}

const fitWhy = (r) => t(r.why, { fs: r.fs ?? "", path: r.path });

/** The disks here on the protection card: whether each can take part, and if not, why and what to do */
function arrayFit(data) {
  const rows = storageRows(data);
  if (!rows.length) return null;
  const action = (r) => {
    if (r.step === "format") return button(t("mounting.format"), { class: "small", onclick: () => formatDialog(r.disk, r.device ? r.volume : undefined) });
    if (r.step === "connect") return button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(r.disk, r.volume) });
    if (r.step === "keep") return button(t("mounting.disconnect"), { class: "small", onclick: () => disconnectDialog({ path: r.path, disk: r.disk.name }) });
    return null;
  };
  return h("div", { class: "stack" }, h("strong", { class: "small" }, t("array.fit.title")), h("div", { class: "kv-list" }, rows.map((r) => fitRow(r, r.step === "ready", action(r)))));
}

const fitRow = (r, fits, ...after) =>
  h(
    "div",
    { class: "kv" },
    h("div", { class: "fit" }, h("span", { class: r.title.startsWith("/") ? "strong mono" : "strong" }, r.title), h("div", { class: "muted small" }, r.sub), h("div", { class: "small fit-why" + (fits ? " ok" : "") }, icon(fits ? "check" : "x"), fitWhy(r))),
    after.some(Boolean) ? h("div", { class: "row-actions" }, after) : h("span"),
  );

/**
 * Several disks together, step by step: what for (one large folder, protection from a disk failure,
 * both), which disks, their folders and the schedule, then one confirmation and one job that does it all.
 */
function poolDialog() {
  const data = state.disks;
  const rows = storageRows(data);
  const arrayOn = data.array?.on;
  const plan = { goal: arrayOn ? "merge" : "both", chosen: new Set(), parity: "", names: {}, name: "storage", time: data.array?.settings.time ?? "05:00", scrub: true };
  let step = 1;
  let tools = null;
  let dialog;
  const body = h("div", { class: "stack" });
  const steps = h("ol", { class: "pool-steps" });
  const merge = () => plan.goal !== "protect";
  const protect = () => plan.goal !== "merge";
  // a branch of a merged folder can hold data of the array, but not go into another merged folder
  const usable = (r) => !!r.step && !r.parity && !(r.pooled && merge());
  const chosen = () => rows.filter((r) => plan.chosen.has(r.key));
  const parityRow = () => (protect() ? chosen().find((r) => r.key === plan.parity) : undefined);
  const dataRows = () => chosen().filter((r) => r !== parityRow());
  const folder = (r) => (r.step === "format" || r.step === "connect" ? "/mnt/" + (plan.names[r.key] ?? "") : r.path);
  const named = () => {
    let n = 0;
    for (const r of chosen()) if ((r.step === "format" || r.step === "connect") && !plan.names[r.key]) plan.names[r.key] = r === parityRow() ? "parity1" : "disk" + ++n;
  };
  // what is wrong with the choice of disks, in words; "" — nothing
  const disksTrouble = () => {
    const need = plan.goal === "both" ? 3 : 2;
    if (chosen().length < need) return t("pool.needDisks", { n: need });
    if (!protect()) return "";
    const p = parityRow();
    if (!p) return t("pool.needParity");
    if (p.pooled || p.holds) return t(p.pooled ? "array.cannot.merged" : "array.cannot.holds");
    if (p.size < Math.max(...dataRows().map((r) => r.size)) * 0.97) return t("error.array.parityTooSmall");
    return "";
  };
  const namesTrouble = () => {
    const folders = chosen().map(folder);
    if (chosen().some((r) => (r.step === "format" || r.step === "connect") && !MOUNT_NAME.test(plan.names[r.key] ?? ""))) return t("error.disk.badName");
    if (merge() && !MOUNT_NAME.test(plan.name)) return t("error.disk.badName");
    if (new Set([...folders, ...(merge() ? ["/mnt/" + plan.name] : [])]).size !== folders.length + (merge() ? 1 : 0)) return t("error.plan.sameFolder");
    return "";
  };
  const doing = (r) => (r.step === "format" ? t("pool.do.format") : r.step === "connect" ? t("pool.do.connect") : r.step === "keep" ? t("pool.do.keep") : t("pool.do.ready"));
  const paint = () => {
    put(steps, ["goal", "disks", "setup", "go"].map((id, i) => h("li", { class: i + 1 === step ? "current" : i + 1 < step ? "done" : "" }, h("span", { class: "welcome-num" }, i + 1 < step ? icon("check") : String(i + 1)), t("pool.step." + id))));
    put(body, [null, goalStep, disksStep, setupStep, goStep][step]());
  };
  const nav = (ok, next = () => ((step += 1), paint())) =>
    h("footer", null, step > 1 ? button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }) : closeButton(() => dialog, t("common.cancel")), button(t("pool.next"), { class: "primary", disabled: !ok, onclick: next }));

  const goalStep = () => {
    const option = (id) => {
      const off = arrayOn && id !== "merge";
      const input = h("input", { type: "radio", name: "pool-goal", value: id, checked: plan.goal === id, disabled: off });
      input.addEventListener("change", () => ((plan.goal = id), (plan.parity = "")));
      return h("label", { class: "check pool-goal" + (off ? " muted" : "") }, input, h("span", null, h("strong", null, t("pool.goal." + id)), h("span", { class: "muted small block" }, t("pool.goal." + id + ".what")), off && h("span", { class: "small block" }, t("pool.arrayOn"))));
    };
    return [h("p", { class: "muted" }, t("pool.lead")), option("both"), option("merge"), option("protect"), nav(true)];
  };

  const disksStep = () => {
    const trouble = h("p", { class: "muted small" });
    const next = button(t("pool.next"), { class: "primary" });
    const paritySlot = h("div");
    const check = () => {
      const why = disksTrouble();
      trouble.textContent = why;
      // too few disks yet is where everybody starts, not a mistake
      trouble.className = why && chosen().length >= (plan.goal === "both" ? 3 : 2) ? "error small" : "muted small";
      next.disabled = !!why;
    };
    const parityPick = () => {
      if (!protect()) return put(paritySlot);
      const list = chosen();
      if (!plan.parityChosen || !list.some((r) => r.key === plan.parity)) {
        // the largest disk that may hold it
        const fit = list.filter((r) => !r.pooled && !r.holds).sort((a, b) => b.size - a.size)[0];
        plan.parity = fit?.key ?? "";
      }
      const select = h("select", null, h("option", { value: "" }, "—"), list.map((r) => h("option", { value: r.key, selected: r.key === plan.parity, disabled: r.pooled || r.holds }, `${r.title} · ${bytes(r.size)}`)));
      select.addEventListener("change", () => ((plan.parity = select.value), (plan.parityChosen = true), check()));
      put(paritySlot, field(t("array.parityDisk"), select, t("pool.parityHint")));
    };
    const list = rows.map((r) => {
      const box = h("input", { type: "checkbox", checked: plan.chosen.has(r.key), disabled: !usable(r), "aria-label": r.title });
      const tag = h("span", { class: "small" });
      const mark = () => {
        tag.textContent = box.checked && r.step !== "ready" ? doing(r) : "";
        tag.className = "small " + (r.step === "format" ? "pool-erase" : "muted");
      };
      box.addEventListener("change", () => {
        if (box.checked) plan.chosen.add(r.key);
        else plan.chosen.delete(r.key);
        mark();
        parityPick();
        check();
      });
      mark();
      // what the wizard does about it is said beside, so the fact alone here
      const why = r.parity ? { ...r, why: "pool.isParity" } : r.pooled && merge() ? { ...r, why: "pool.inPool" } : r.step && r.step !== "ready" ? { ...r, why: "pool.fact." + r.why.split(".").pop() } : r;
      return h("label", { class: "kv pool-disk" + (usable(r) ? "" : " muted") }, h("div", { class: "fit" }, h("span", { class: "with-icon" }, box, h("span", { class: r.title.startsWith("/") ? "strong mono" : "strong" }, r.title)), h("div", { class: "muted small" }, r.sub), h("div", { class: "small fit-why" + (r.step === "ready" && usable(r) ? " ok" : "") }, icon(r.step === "ready" && usable(r) ? "check" : "x"), fitWhy(why))), tag);
    });
    next.onclick = () => ((step += 1), named(), paint());
    parityPick();
    check();
    return [h("p", { class: "muted" }, t("pool.disksLead." + plan.goal)), h("div", { class: "kv-list" }, list), paritySlot, trouble, h("footer", null, button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }), next)];
  };

  const setupStep = () => {
    const trouble = h("p", { class: "error small" });
    const next = button(t("pool.next"), { class: "primary" });
    const check = () => {
      trouble.textContent = namesTrouble();
      next.disabled = !!trouble.textContent || missing().length > 0;
    };
    const missing = () => (tools ? [merge() && "mergerfs", protect() && "snapraid"].filter((id) => id && tools.find((x) => x.id === id)?.state === "missing") : []);
    const nameInput = (get, set) => {
      const input = h("input", { type: "text", value: get(), maxlength: 32, spellcheck: false });
      input.addEventListener("input", () => (set(input.value), check()));
      return input;
    };
    const disks = chosen().map((r) =>
      h(
        "div",
        { class: "kv" },
        h("div", { class: "fit" }, h("span", { class: "strong" }, r.title), h("div", { class: "muted small" }, r.sub), h("div", { class: "small " + (r.step === "format" ? "pool-erase" : "muted") }, r === parityRow() ? t("pool.forParity") : t("pool.forData"), " · ", doing(r))),
        r.step === "format" || r.step === "connect" ? h("label", { class: "pool-name" }, h("span", { class: "muted mono" }, "/mnt/"), nameInput(() => plan.names[r.key], (v) => (plan.names[r.key] = v))) : h("span", { class: "mono" }, r.path),
      ),
    );
    const time = h("input", { type: "time", value: plan.time, required: true });
    time.addEventListener("input", () => (plan.time = time.value || plan.time));
    const scrub = h("input", { type: "checkbox", checked: plan.scrub });
    scrub.addEventListener("change", () => (plan.scrub = scrub.checked));
    const cards = h("div", { class: "stack" });
    const loadTools = async () => {
      tools = (await api("GET", "/api/tools").catch(() => null)) ?? tools;
      put(cards, missing().map((id) => packageCard({ package: id, install: tools.find((x) => x.id === id)?.install ?? "" }, () => void loadTools())));
      check();
    };
    void loadTools();
    next.onclick = () => ((step += 1), paint());
    check();
    return [
      cards,
      h("strong", { class: "small" }, t("pool.disksTitle")),
      h("div", { class: "kv-list" }, disks),
      merge() && field(t("pool.merged"), h("span", { class: "pool-name" }, h("span", { class: "muted mono" }, "/mnt/"), nameInput(() => plan.name, (v) => (plan.name = v))), t("pool.mergedHint")),
      protect() && field(t("array.time"), time),
      protect() && h("label", { class: "check" }, scrub, h("span", null, h("strong", null, t("array.scrub")), h("span", { class: "muted small block" }, t("array.scrubHint")))),
      trouble,
      h("footer", null, button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }), next),
    ];
  };

  const goStep = () => {
    const erased = chosen().filter((r) => r.step === "format");
    const typed = erased.map((r) => ({ r, input: h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: r.device ? r.volume.name : r.disk.name }) }));
    const password = h("input", { type: "password", autocomplete: "current-password" });
    const slot = h("div");
    const go = button(t("pool.go"), { class: erased.length ? "danger" : "primary" });
    const check = () => (go.disabled = typed.some((x) => x.input.value.trim() !== (x.r.device ? x.r.volume.name : x.r.disk.name)) || (erased.length > 0 && !password.value));
    for (const input of [...typed.map((x) => x.input), password]) input.addEventListener("input", check);
    const todo = [
      ...chosen().filter((r) => r.step !== "ready").map((r) => t("pool.todo." + r.step, { what: r.device || r.disk.path, title: r.title, path: folder(r) })),
      merge() && t("pool.todo.merge", { disks: dataRows().map(folder).join(" + "), path: "/mnt/" + plan.name }),
      protect() && t("pool.todo.protect", { parity: folder(parityRow()), disks: dataRows().map(folder).join(", "), time: plan.time }),
    ].filter(Boolean);
    go.onclick = diskAction(
      () => dialog,
      slot,
      () =>
        api("POST", "/api/disks/plan", {
          goal: plan.goal,
          disks: chosen().map((r) => ({ disk: r.disk.name, serial: r.disk.serial, size: r.disk.size, device: r.device, step: r.step, name: plan.names[r.key] ?? "", path: r.path })),
          parity: protect() ? chosen().indexOf(parityRow()) : -1,
          name: plan.name,
          time: plan.time,
          scrub: plan.scrub,
          password: password.value,
        }),
      (started) => run(started.job),
    );
    check();
    return [
      h("p", { class: "muted" }, t("pool.goLead")),
      h("ol", { class: "steps" }, todo.map((line) => h("li", null, line))),
      erased.length > 0 && h("p", { class: "banner danger" }, t("pool.erases", { disks: erased.map((r) => r.title).join(", ") })),
      typed.map((x) => field(t("mounting.typeName", { name: x.r.device ? x.r.volume.name : x.r.disk.name }), x.input)),
      erased.length > 0 && field(t("account.password"), password, t("mounting.passwordHint")),
      slot,
      h("footer", null, button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }), go),
    ];
  };

  // the work itself: its log here, then what to do next
  const run = async (id) => {
    const log = h("pre", { class: "console" });
    const status = h("p", { class: "job-status running" }, t("job.running"));
    put(body, status, log, h("footer", null, button(t("job.hide"), { onclick: () => dialog.close() })));
    const job = await followJob(id, (line) => {
      log.append(line + "\n");
      log.scrollTop = log.scrollHeight;
    });
    setDisks(await api("GET", "/api/disks").catch(() => state.disks));
    if (job.status !== "done") {
      put(body, h("p", { class: "banner danger" }, t("pool.failed")), h("pre", { class: "said" }, job.error || ""), log, h("footer", null, closeButton(() => dialog, t("common.close"))));
      return;
    }
    step = 5;
    put(steps, ["goal", "disks", "setup", "go"].map((id) => h("li", { class: "done" }, h("span", { class: "welcome-num" }, icon("check")), t("pool.step." + id))));
    const where = merge() ? "/mnt/" + plan.name : folder(dataRows()[0]);
    put(
      body,
      h("p", { class: "banner ok" }, t("pool.done." + plan.goal, { path: where })),
      protect() && h("p", { class: "muted" }, t("pool.syncHint")),
      h("details", null, h("summary", { class: "muted small" }, t("array.log")), log),
      h(
        "footer",
        null,
        closeButton(() => dialog, t("common.close")),
        h("a", { class: "btn", href: filesHash(where), onclick: () => dialog.close() }, t("disks.fs.browse")),
        protect() &&
          button(t("array.syncNow"), {
            class: "primary",
            onclick: async () => {
              try {
                setDisks(await api("POST", "/api/disks/array/sync", {}));
                dialog.close();
              } catch (e) {
                toast(errorText(e), "error");
              }
            },
          }),
      ),
    );
  };

  dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("pool.title"))), closeX(() => dialog)), steps, body);
  paint();
}

/** Which disk holds parity, which are protected, when it runs */
function arrayDialog(array) {
  const cfg = array.settings;
  const error = h("p", { class: "error", role: "alert" });
  const size = (c) => `${bytes(c.size)} · ${t("array.used", { size: bytes(c.used) })}`;
  const parity = array.candidates.map((c) => ({ c, input: h("input", { type: "radio", name: "parity", value: c.path, checked: cfg.parity === c.path, disabled: c.merged || !!c.holds }) }));
  const data = array.candidates.map((c) => ({ c, input: h("input", { type: "checkbox", value: c.path, checked: cfg.data.some((x) => x.path === c.path) }) }));
  const appData = h("input", { type: "checkbox", checked: cfg.appData });
  const time = h("input", { type: "time", value: cfg.time, required: true });
  const scrub = h("input", { type: "checkbox", checked: cfg.scrub });
  const limit = h("input", { type: "number", min: 0, max: 1000000, value: cfg.deleteLimit, required: true });
  const anew = h("p", { class: "banner small", hidden: true }, t("array.anew"));
  const go = h("button", { class: "btn primary" }, t(array.on ? "settings.save" : "array.turnOn"));
  const check = () => {
    const chosen = parity.find((p) => p.input.checked)?.c.path ?? "";
    for (const x of data) {
      x.input.disabled = x.c.path === chosen;
      if (x.input.disabled) x.input.checked = false;
    }
    const paths = data.filter((x) => x.input.checked).map((x) => x.c.path);
    go.disabled = !chosen || !paths.length;
    anew.hidden = !array.on || (chosen === cfg.parity && cfg.data.every((x) => paths.includes(x.path)));
  };
  for (const x of [...parity, ...data]) x.input.addEventListener("change", check);
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          try {
            setDisks(await api("PUT", "/api/disks/array", { parity: parity.find((p) => p.input.checked).c.path, data: data.filter((x) => x.input.checked).map((x) => x.c.path), appData: appData.checked, time: time.value, scrub: scrub.checked, deleteLimit: Number(limit.value) }));
            dialog.close();
            toast(t(array.on ? "settings.saved" : "array.turnedOn"));
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("array.title")), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("array.how")),
      h("h3", null, t("array.parityDisk")),
      h("p", { class: "muted small" }, t("array.parityDiskHint")),
      parity.map(({ c, input }) => h("label", { class: "check" }, input, h("span", null, h("strong", { class: "mono" }, c.path), h("span", { class: "muted small block" }, c.merged ? t("array.cannot.merged") : c.holds ? t("array.cannot.holds") : size(c))))),
      h("h3", null, t("array.dataDisks")),
      data.map(({ c, input }) => h("label", { class: "check" }, input, h("span", null, h("strong", { class: "mono" }, c.path), h("span", { class: "muted small block" }, size(c))))),
      h("label", { class: "check" }, appData, h("span", null, h("strong", null, t("array.appData")), h("span", { class: "muted small block" }, t("array.appDataHint")))),
      h("div", { class: "field-row" }, field(t("array.time"), time), field(t("array.limit"), limit, t("array.limitHint"))),
      h("label", { class: "check" }, scrub, h("span", null, h("strong", null, t("array.scrub")), h("span", { class: "muted small block" }, t("array.scrubHint")))),
      anew,
      error,
      h("footer", null, array.on && button(t("array.turnOff"), { class: "danger", onclick: () => (dialog.close(), arrayOffDialog()) }), closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
  check();
}

function arrayOffDialog() {
  const wipe = h("input", { type: "checkbox" });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("array.offTitle")),
    h("p", { class: "muted" }, t("array.offLead")),
    h("label", { class: "check" }, wipe, h("span", null, h("strong", null, t("array.offWipe")), h("span", { class: "muted small block" }, t("array.offWipeHint")))),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("array.turnOff"), { class: "danger", onclick: () => arrayCall("DELETE", wipe.checked ? "?wipe=1" : "", undefined, () => dialog.close()) })),
  );
}

/** A disk that was replaced, or files that are gone from one: what the parity knows comes back */
function recoverDialog(disk) {
  if (!disk) return;
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("array.recoverTitle", { disk: disk.path })),
    h("p", { class: "muted" }, t("array.recoverLead")),
    h("p", { class: "muted small" }, t("array.recoverHow", { disk: disk.path })),
    h("p", { class: "banner small" }, t("array.recoverOwners")),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("array.recoverGo"), { class: "primary", onclick: () => arrayCall("POST", "/fix", { disk: disk.name }, () => dialog.close()) }, "undo")),
  );
}

const FILLS_COLOURS = 6;
// below this share a folder is one of "the smaller ones", unless it is among the first few
const FILLS_SMALL = 0.01;
const FILLS_ALWAYS = 6;

/** "in about 3 wk": days as days, weeks or months */
const aboutDays = (days) => (days < 14 ? t("time.days", { n: Math.max(days, 1) }) : days < 70 ? t("time.weeks", { n: Math.round(days / 7) }) : t("time.months", { n: Math.round(days / 30.44) }));

function fillsCard(fills, busy) {
  const used = fills.used;
  const apps = new Map((state.overview?.apps ?? []).map((app) => [app.name, app]));
  let parts = fills.parts.filter((part) => part.kind !== "mount");
  const small = parts.filter((part, i) => part.kind !== "rest" && i >= FILLS_ALWAYS && part.size / used < FILLS_SMALL);
  if (small.length > 1) {
    const week = small.some((part) => part.week != null) ? small.reduce((sum, part) => sum + (part.week ?? 0), 0) : null;
    parts = [...parts.filter((part) => !small.includes(part)), { kind: "small", path: "", name: "", size: small.reduce((sum, part) => sum + part.size, 0), week, n: small.length }];
  }
  // what the file system holds beside the data folder: the system, Docker's images, other folders
  const outside = fills.at && used - fills.size > Math.max(used * 0.02, 1024 ** 3) ? used - fills.size : 0;
  if (outside) parts.push({ kind: "outside", path: "", name: "", size: outside, week: null });
  parts.push(...fills.parts.filter((part) => part.kind === "mount"));

  const colour = (i, part) => (part.kind === "outside" || part.kind === "small" || part.kind === "rest" || i >= FILLS_COLOURS ? "c-rest" : "c" + i);
  const share = (size) => (size / fills.total) * 100;
  const bar = h(
    "div",
    { class: "fills-bar" },
    parts.map((part, i) => {
      if (part.kind === "mount") return null;
      const seg = h("i", { class: colour(i, part), title: `${partName(part)} · ${bytes(part.size)}` });
      seg.style.width = share(part.size) + "%";
      return seg;
    }),
  );
  function partName(part) {
    if (part.kind === "app") return apps.get(part.name)?.title ?? part.name;
    if (part.kind === "trash") return t("trash.title");
    if (part.kind === "rest") return t("fills.rest");
    if (part.kind === "small") return t("fills.small", { n: part.n });
    if (part.kind === "outside") return t("fills.outside");
    return part.name;
  }
  const trend = (part) => {
    if (part.kind === "mount") return h("span", { class: "muted" }, t("fills.mount"));
    if (part.week == null) return h("span", { class: "muted" }, "—");
    // a change too small to mean anything is "steady"
    if (Math.abs(part.week) < Math.max(part.size * 0.005, 50 * 1024 ** 2)) return h("span", { class: "muted" }, t("fills.steady"));
    return h("span", { class: part.week > 0 ? "" : "muted" }, t("fills.week", { size: (part.week > 0 ? "+" : "−") + bytes(Math.abs(part.week)) }));
  };
  const row = (part, i) => {
    const href = part.kind === "app" && apps.has(part.name) ? `#/apps/${part.name}` : part.kind === "trash" ? "#/trash" : part.path ? filesHash(part.path) : "";
    const name = partName(part);
    const percent = (part.size / used) * 100;
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon" }, h("i", { class: "dot " + (part.kind === "mount" ? "c-rest" : colour(i, part)) }), h("div", null, href ? h("a", { class: "strong", href }, name) : h("div", { class: "strong" }, name), part.kind === "outside" ? h("div", { class: "muted small" }, t("fills.outsideHint")) : part.path && h("div", { class: "muted small mono clip" }, part.path)))),
      h("td", { class: "num" }, part.kind === "mount" ? "" : bytes(part.size)),
      h("td", { class: "num muted" }, part.kind === "mount" ? "" : percent < 1 ? "<1%" : Math.round(percent) + "%"),
      h("td", null, trend(part)),
    );
  };
  const measure = busy(t("fills.measuring"), { path: "/api/disks/fills" });
  return h(
    "section",
    { class: "card table-wrap fills" },
    h(
      "div",
      { class: "pad card-head" },
      h(
        "div",
        { class: "section-head" },
        h("h2", null, t("fills.title", { path: fills.root }), h("span", { class: "muted" }, t("disks.usedOf", { used: bytes(used), total: bytes(fills.total) }))),
        h("div", { class: "row-actions" }, fills.fullIn != null && h("span", { class: "chip warn" }, t("fills.fullIn", { time: aboutDays(fills.fullIn) })), fills.at && !fills.running && h("span", { class: "muted small" }, t("fills.measured", { when: ago(fills.at) })), button(t(fills.running ? "fills.measuring" : fills.at ? "fills.again" : "fills.measure"), { class: "small", disabled: fills.running, onclick: measure }, "refresh")),
      ),
      h("p", { class: "muted small" }, t(fills.at ? "fills.lead" : "fills.never")),
      fills.at && bar,
    ),
    fills.at && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("fills.col.folder")), h("th", { class: "num" }, t("fills.col.size")), h("th", { class: "num" }, t("fills.col.share")), h("th", null, t("fills.col.week")))), h("tbody", null, parts.map(row))),
  );
}

// --- Folders shared over the network ----------------------------------------------------------------

function setShares(data) {
  state.shares = data;
  if (state.files) state.files.shared = data.shares.map((share) => share.path);
  if (state.route.view === "settings" && state.route.section === "shares") renderSettings();
  if (state.route.view === "files") renderFilesBody();
}

/** The two ways a shared folder is written: for Explorer, and for everything else */
const shareAddresses = (host, name = "") => ({ windows: `\\\\${host}${name && "\\" + name}`, url: `smb://${host}${name && "/" + name.replaceAll(" ", "%20")}` });

const copyLine = (text) => h("div", { class: "copy-line" }, h("span", { class: "mono clip" }, text), h("button", { type: "button", class: "icon-btn", title: t("files.copyPath"), "aria-label": t("files.copyPath"), onclick: () => copyText(text) }, icon("copy")));

/** Sharing of one folder: turning it on, how it is shared, turning it off */
async function shareDialog(path) {
  let data;
  try {
    data = state.shares = await api("GET", "/api/shares");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const share = data.shares.find((one) => one.path === path);
  const folder = path.split("/").pop() || "/";
  let dialog;
  if (data.tool === "missing") {
    // what, why, the command and the button right here; once installed, the dialog of the folder itself
    dialog = openDialog(
      "confirm",
      h("h2", null, t("shares.dialog.new", { name: folder })),
      h("p", { class: "muted" }, t("shares.tool.note")),
      sambaCard(
        () => {
          dialog.close();
          void shareDialog(path);
        },
        closeButton(() => dialog, t("common.cancel")),
      ),
    );
    return;
  }
  const name = h("input", { value: share?.name ?? "", placeholder: folder, maxLength: 40, spellcheck: false, autocomplete: "off" });
  const choice = (value) => h("select", null, ["none", "read", "write"].map((access) => h("option", { value: access, selected: access === value }, t("shares.access." + access))));
  // a folder shared for the first time is open to whoever shares it
  const users = data.users.map((user) => {
    const select = choice(share ? (share.users[user.id] ?? "none") : user.id === state.user.id && user.allowed !== false ? "write" : "none");
    // kept out by an administrator: what was chosen stays, and counts again once let back in
    select.disabled = user.allowed === false;
    return { user, select };
  });
  const guest = choice(share?.guest ?? "none");
  // Macs back up here with Time Machine; the limit keeps them from filling the disk
  const tm = h("input", { type: "checkbox", checked: !!share?.timeMachine });
  const limit = h("input", { type: "number", min: 0, step: 1, inputmode: "numeric", value: share?.timeMachine?.limit || "", placeholder: t("shares.tm.noLimit") });
  const limitField = field(t("shares.tm.limit"), limit, t("shares.tm.limitHint"));
  const showLimit = () => (limitField.hidden = !tm.checked);
  tm.addEventListener("change", showLimit);
  showLimit();
  const error = h("p", { class: "error", role: "alert" });
  const send = async (method, url, body, done) => {
    error.textContent = "";
    try {
      setShares(await api(method, url, body));
      dialog.close();
      toast(done);
    } catch (e) {
      error.textContent = errorText(e);
    }
  };
  const settings = () => ({ name: name.value.trim(), guest: guest.value, users: Object.fromEntries(users.map(({ user, select }) => [user.id, select.value])), timeMachine: tm.checked ? { limit: Math.max(0, Math.floor(Number(limit.value) || 0)) } : null });
  const address = share && data.hosts[0] && shareAddresses(data.hosts[0], share.name);
  dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: (e) => {
          e.preventDefault();
          if (share) return send("PUT", `/api/shares/${encodeURIComponent(share.name)}`, settings(), t("shares.saved"));
          return send("POST", "/api/shares", { path, ...settings() }, t("shares.sharedDone", { name: folder }));
        },
      },
      h("header", null, h("span", { class: "badge-icon plain" }, icon("share")), h("div", null, h("h2", null, t(share ? "shares.dialog.edit" : "shares.dialog.new", { name: folder })), h("span", { class: "muted small mono clip" }, path))),
      address && h("div", { class: "stack-s" }, copyLine(address.windows), copyLine(address.url)),
      field(t("shares.name"), name, t("shares.nameHint")),
      h(
        "div",
        { class: "field" },
        h("span", { class: "label" }, t("shares.who")),
        h(
          "div",
          { class: "share-access" },
          users.map(({ user, select }) => h("label", null, h("span", { class: "grow" }, h("strong", null, user.name), user.allowed === false ? h("span", { class: "muted small block" }, t("shares.deniedHint")) : !user.ready && h("span", { class: "muted small block" }, t("shares.notReadyHint"))), select)),
          h("label", null, h("span", { class: "grow" }, h("strong", null, t("shares.guest")), h("span", { class: "muted small block" }, t("shares.guestHint"))), guest),
        ),
      ),
      h("label", { class: "check" }, tm, h("span", null, h("strong", null, t("shares.tm.title")), h("span", { class: "muted small block" }, t("shares.tm.hint")))),
      limitField,
      error,
      h("footer", null, share ? button(t("shares.stop"), { class: "danger", onclick: () => send("DELETE", `/api/shares/${encodeURIComponent(share.name)}`, undefined, t("shares.stoppedDone", { name: share.name })) }) : h("span"), closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t(share ? "shares.save" : "shares.share"))),
    ),
  );
}

/** What Samba is, what for, the command and the button that installs it (next to a dialog's "Cancel") */
function sambaCard(done, cancel) {
  const data = state.shares;
  const error = h("p", { class: "error", role: "alert" });
  const install = async (e) => {
    const el = e.currentTarget;
    error.textContent = "";
    el.disabled = true;
    el.lastChild.textContent = t("shares.tool.installing");
    try {
      setShares(await api("POST", "/api/shares/tool", {}));
      toast(t("shares.tool.installed"));
      done?.();
    } catch (err) {
      el.disabled = false;
      el.lastChild.textContent = t("shares.tool.install");
      error.textContent = errorText(err);
    }
  };
  return [
    h("p", { class: "muted" }, t("shares.tool.what")),
    h("p", { class: "muted" }, t("shares.tool.why")),
    data.install ? [h("p", { class: "muted" }, t("shares.tool.how")), h("p", { class: "cmd whole" }, icon("terminal"), data.install)] : h("p", { class: "muted" }, t("shares.tool.byHand")),
    error,
    (cancel || data.install) && h("footer", null, cancel, data.install && button(t("shares.tool.install"), { class: "primary", onclick: install }, "download")),
  ];
}

function sharesSection() {
  const data = state.shares;
  if (!data) return [h("p", { class: "muted" }, "…")];
  const error = h("p", { class: "error", role: "alert" });
  if (data.tool === "missing") return [h("section", { class: "card pad" }, h("h2", null, t("shares.tool.missing")), h("p", { class: "muted" }, t("shares.lead")), sambaCard())];
  const host = data.hosts[0] ?? location.hostname;
  const taken = data.shares.map((share) => share.path);
  const add = () => folderPicker({ title: t("shares.addTitle"), start: "", confirmLabel: t("shares.addHere"), allowed: (at) => !taken.includes(at), action: (at) => void setTimeout(() => shareDialog(at)) });
  const line = (label, access) => h("div", null, label, h("span", { class: "muted small" }, " · " + t("shares.access." + access)));
  const who = (share) => {
    const named = data.users.filter((user) => share.users[user.id]).map((user) => line(user.name, share.users[user.id]));
    if (share.guest !== "none") named.push(line(t("shares.guest"), share.guest));
    return named.length ? named : h("span", { class: "muted" }, t("shares.nobody"));
  };
  const row = (share) => {
    const address = shareAddresses(host, share.name);
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "strong" }, share.name), share.timeMachine && h("div", { class: "muted small" }, share.timeMachine.limit ? t("shares.tm.tagLimit", { limit: share.timeMachine.limit }) : t("shares.tm.tag")), share.missing ? h("div", { class: "small danger-text" }, t("shares.missing")) : h("a", { class: "muted small mono clip block", href: filesHash(share.path) }, share.path)),
      h("td", null, who(share)),
      h("td", null, copyLine(address.windows), copyLine(address.url)),
      h("td", null, h("div", { class: "row-actions" }, button(t("shares.settings"), { class: "small", onclick: () => shareDialog(share.path) }))),
    );
  };
  const all = shareAddresses(host);
  // where the server shows up by itself, so that no address has to be typed
  const found = data.announced.browse && data.announced.windows ? "both" : data.announced.windows ? "windows" : data.announced.browse ? "browse" : "";
  return [
    h(
      "section",
      { class: "card table-wrap" },
      h(
        "div",
        { class: "pad card-head" },
        h("div", { class: "section-head" }, h("h2", null, t("shares.title"), data.shares.length > 0 && h("span", { class: "state " + (data.running ? "running" : "restarting") }, t(data.running ? "shares.running" : "shares.stopped"))), button(t("shares.add"), { class: "small primary", onclick: add }, "plus")),
        h("p", { class: "muted small" }, t(data.shares.length ? "shares.lead" : "shares.none")),
        data.error && h("p", { class: "banner danger" }, t("shares.error", { message: data.error })),
      ),
      data.shares.length > 0 && h("table", { class: "disks shares" }, h("thead", null, h("tr", null, h("th", null, t("shares.col.name")), h("th", null, t("shares.col.access")), h("th", null, t("shares.col.address")), h("th"))), h("tbody", null, data.shares.map(row))),
    ),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("shares.users.title")),
      h("p", { class: "muted" }, t("shares.users.lead")),
      h("p", { class: "muted small" }, t("shares.users.note")),
      data.users.map((user) => settingRow(user.name, t("shares.users.folders", { n: data.shares.filter((share) => share.users[user.id]).length }), user.allowed === false ? h("span", { class: "state" }, t("shares.users.denied")) : h("span", { class: user.ready ? "state running" : "state" }, t(user.ready ? "shares.users.ready" : "shares.users.notReady")))),
    ),
    h("section", { class: "card pad stack-s" }, h("h2", null, t("shares.how.title")), found && h("p", null, t("shares.found." + found, { name: data.announced.name })), data.announced.error && data.shares.length > 0 && h("p", { class: "muted small" }, t("shares.found.error", { message: data.announced.error })), h("p", { class: "muted" }, t("shares.how.windows", { address: all.windows })), h("p", { class: "muted" }, t("shares.how.mac", { address: all.url })), h("p", { class: "muted" }, t("shares.how.phone"))),
  ];
}

// --- Access keys of agents (the MCP server) ---------------------------------------------------------

const AGENT_LEVELS = ["read", "operate", "full"];
const mcpAddress = () => `${location.origin}/mcp`;

/** A line of text to take away: shown whole, with a button that copies it */
function copyBox(text, rows = 1) {
  const box = rows > 1 ? h("textarea", { readOnly: true, rows, class: "mono", value: text }) : h("input", { readOnly: true, class: "mono", value: text });
  box.addEventListener("focus", () => box.select());
  const copy = () => {
    try {
      void navigator.clipboard.writeText(text);
    } catch {
      // plain HTTP has no clipboard API
      box.select();
      document.execCommand("copy");
    }
    toast(t("twofa.copied"));
  };
  return h("div", { class: "copy-box" }, box, h("button", { type: "button", class: "icon-btn", "aria-label": t("twofa.copy"), title: t("twofa.copy"), onclick: copy }, icon("copy")));
}

/** The key, shown the only time it can be, with what to paste into the agent */
function agentKeyDialog(made) {
  const url = mcpAddress();
  const command = `claude mcp add --transport http hata ${url} --header "Authorization: Bearer ${made.key}"`;
  const config = JSON.stringify({ mcpServers: { hata: { type: "http", url, headers: { Authorization: `Bearer ${made.key}` } } } }, null, 2);
  // Claude Desktop runs only programs from its file: the bridge mcp-remote speaks HTTP for it. The header
  // comes from a variable, because a space inside an argument is split on Windows
  const bridge = ["-y", "mcp-remote", url, "--header", "Authorization:${HATA_AUTH}", ...(location.protocol === "http:" ? ["--allow-http"] : [])];
  const desktop = JSON.stringify({ mcpServers: { hata: { command: "npx", args: bridge, env: { HATA_AUTH: `Bearer ${made.key}` } } } }, null, 2);
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("agents.made.title", { name: made.info.name })), h("p", { class: "muted small" }, t("agents.made.lead"))), closeX(() => dialog)),
    field(t("agents.made.key"), copyBox(made.key)),
    field(t("agents.made.claude"), copyBox(command, 3), t("agents.made.claudeHint")),
    field(t("agents.made.desktop"), copyBox(desktop, 8), t("agents.made.desktopHint")),
    field(t("agents.made.config"), copyBox(config, 11), t("agents.made.configHint")),
    h("footer", null, button(t("agents.made.done"), { class: "primary", onclick: () => dialog.close() })),
  );
}

// --- The assistant: a chat with a model that works with Hata's tools --------------------------------

const assistantUi = { open: false, panel: null, fab: null, config: null, chats: [], chat: null, timer: 0 };
/** Whether the window was open and how big, kept across pages and reloads */
const ASSISTANT_KEY = "hata.assistant";
const assistantReady = () => !!state.overview?.assistant;

/** A model's answer as elements: paragraphs, lists, code, bold — built from text, never as markup */
function mdInline(text) {
  const out = [];
  // code, bold, and a link — only to a web address, opened apart
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let at = 0;
  for (let m; (m = pattern.exec(text)); at = pattern.lastIndex) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? h("code", null, m[1]) : m[2] !== undefined ? h("strong", null, m[2]) : h("a", { class: "link", href: m[4], target: "_blank", rel: "noopener noreferrer" }, m[3]));
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function md(text) {
  const out = [];
  String(text).split(/```/).forEach((part, i) => {
    // every second part lies between code fences; its first line names the language
    if (i % 2) return out.push(h("pre", { class: "md-code" }, part.replace(/^[\w-]*\n/, "").replace(/\n$/, "")));
    let list = null;
    let para = [];
    const flush = () => {
      if (para.length) out.push(h("p", null, para.flatMap((line, n) => (n ? [h("br"), ...mdInline(line)] : mdInline(line)))));
      para = [];
    };
    for (const line of part.split("\n")) {
      const item = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (item) {
        flush();
        const tag = item[1] ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== tag) out.push((list = h(tag)));
        list.append(h("li", null, mdInline(item[2])));
        continue;
      }
      list = null;
      if (heading) {
        flush();
        out.push(h("p", null, h("strong", null, mdInline(heading[1]))));
      } else if (!line.trim()) flush();
      else para.push(line);
    }
    flush();
  });
  return out;
}

/** What a call of the assistant does, in the page's words */
function toolWords(call) {
  const key = `assistant.tool.${call.name}${call.name === "app_remove" && call.args.deleteData === true ? ".data" : ""}`;
  const a = call.args ?? {};
  return has(key) ? t(key, { app: String(a.app ?? a.name ?? ""), query: String(a.query ?? ""), snapshot: String(a.snapshot ?? "") }) : call.name;
}

async function assistantCall(path, data = {}) {
  try {
    const chat = await api("POST", path, data);
    if (chat?.turns) assistantUi.chat = chat;
  } catch (e) {
    toast(errorText(e), "error");
  }
  paintAssistant();
}

async function sendToAssistant(text, fresh = false) {
  const words = text.trim();
  if (!words) return;
  const chat = fresh ? null : assistantUi.chat;
  await assistantCall(chat ? `/api/assistant/chats/${chat.id}` : "/api/assistant/chats", { text: words });
  void loadAssistant(true);
}

function assistantBody() {
  const chat = assistantUi.chat;
  if (!assistantUi.config) return [h("p", { class: "muted" }, "…")];
  if (!assistantUi.config.ready) {
    return [h("div", { class: "assistant-empty" }, h("p", null, t("assistant.notSet")), h("p", { class: "muted small" }, t("assistant.notSetHint")), h("a", { class: "btn primary", href: "#/settings/assistant", onclick: () => innerWidth < 900 && closeAssistant() }, t("assistant.setUp")))];
  }
  if (!chat) {
    const ask = (key) => button(t(key), { class: "small", onclick: () => sendToAssistant(t(key), true) });
    return [h("div", { class: "assistant-empty" }, h("p", null, t("assistant.hello")), h("p", { class: "muted small" }, t("assistant.helloHint")), h("div", { class: "assistant-starts" }, ask("assistant.start.health"), ask("assistant.start.updates"), ask("assistant.start.space")))];
  }
  const results = new Map(chat.turns.filter((turn) => turn.role === "tool").map((turn) => [turn.id, turn]));
  const callRow = (call) => {
    const result = results.get(call.id);
    if (call.state === "asking") {
      const detail = typeof call.args.compose === "string" ? call.args.compose : Object.keys(call.args).some((k) => !["app", "name", "deleteData", "snapshot"].includes(k)) ? JSON.stringify(call.args, null, 1) : "";
      return h(
        "div",
        { class: "assistant-ask" },
        h("strong", null, t("assistant.wants", { what: toolWords(call) })),
        detail && h("pre", { class: "md-code" }, detail),
        h("div", { class: "row-actions" }, button(t("approvals.decline"), { class: "small", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}/calls/${call.id}`, { run: false }) }), button(t("assistant.run"), { class: "small primary", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}/calls/${call.id}`, { run: true }) }, "play")),
      );
    }
    const mark = !result ? icon("refresh", "spin") : icon(result.error ? "x" : "check", result.error ? "danger" : "");
    // what the tool answered is there to look at: nothing the assistant saw is hidden from the person
    return h("details", { class: "assistant-call" }, h("summary", null, mark, h("span", null, result?.declined || call.state === "declined" ? t("assistant.declined", { what: toolWords(call) }) : toolWords(call))), result && !result.declined && h("pre", { class: "md-code" }, result.text));
  };
  const rows = chat.turns.flatMap((turn) => {
    if (turn.role === "user") return [h("div", { class: "msg user" }, turn.text)];
    if (turn.role === "assistant") return [turn.text && h("div", { class: "msg bot" }, md(turn.text)), ...turn.calls.map(callRow)];
    return [];
  });
  if (chat.status === "thinking") rows.push(h("div", { class: "assistant-status" }, icon("refresh", "spin"), h("span", { class: "grow muted" }, t("assistant.thinking")), button(t("assistant.stop"), { class: "small", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}/stop`) })));
  if (chat.status === "error") {
    const key = "error.assistant." + chat.error?.code;
    rows.push(h("div", { class: "banner danger stack" }, h("div", null, has(key) ? t(key) : "", h("span", { class: "block muted small" }, chat.error?.message ?? "")), button(t("assistant.retry"), { class: "small", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}`, { retry: true }) }, "refresh")));
  }
  return rows;
}

function paintAssistant() {
  const panel = assistantUi.panel;
  if (!panel) return;
  const { chat, chats } = assistantUi;
  const pick = h(
    "select",
    { "aria-label": t("assistant.chats"), onchange: (e) => (e.target.value ? void loadAssistantChat(e.target.value) : ((assistantUi.chat = null), paintAssistant())) },
    h("option", { value: "", selected: !chat }, t("assistant.newChat")),
    chats.map((c) => h("option", { value: c.id, selected: c.id === chat?.id }, c.title)),
  );
  // the chat on the screen comes back after a reload
  if (chat) localStorage.setItem(ASSISTANT_KEY + ".chat", chat.id);
  else localStorage.removeItem(ASSISTANT_KEY + ".chat");
  const wide = panel.classList.contains("wide");
  const tool = (label, name, onclick, cls = "") => h("button", { type: "button", class: "icon-btn " + cls, title: label, "aria-label": label, onclick }, icon(name));
  const fresh = () => ((assistantUi.chat = null), paintAssistant(), panel.querySelector("textarea").focus());
  // wide, the chats are a column on the left; narrow, a list in the head
  const paged = panel.classList.contains("paged");
  const listed = !phone.matches && (paged || chats.length > 0);
  panel.classList.toggle("listed", listed);
  put(
    panel.querySelector(".assistant-list"),
    listed && [
      button(t("assistant.newChat"), { class: "small" + (chat ? "" : " primary"), onclick: fresh }, "plus"),
      h(
        "div",
        { class: "assistant-chats" },
        chats.map((c) =>
          h(
            "button",
            { type: "button", class: "assistant-chat" + (c.id === chat?.id ? " active" : ""), "aria-current": c.id === chat?.id ? "true" : null, onclick: () => void loadAssistantChat(c.id) },
            h("span", { class: "title" }, c.title),
            h("span", { class: "muted small" }, c.status === "asking" ? h("span", { class: "dot partial" }) : null, ago(c.updatedAt)),
          ),
        ),
      ),
    ],
  );
  const title = chats.find((c) => c.id === chat?.id)?.title ?? (chat ? "" : t("assistant.newChat"));
  put(
    panel.querySelector(".assistant-head"),
    // with chats to choose from the list names the one on the screen; otherwise the window says what it is
    listed ? h("strong", { class: "grow ellipsis" }, title) : chats.length > 0 ? h("span", { class: "grow pick" }, pick) : h("strong", { class: "grow" }, t("assistant.title")),
    chat && !listed && tool(t("assistant.newChat"), "plus", fresh),
    chat && tool(t("assistant.forget"), "trash", forgetAssistantChat),
    !paged && tool(t("assistant.asPage"), "external", () => go("#/assistant"), "wide-only"),
    !paged && tool(t(wide ? "assistant.narrow" : "assistant.wide"), wide ? "shrink" : "expand", () => (panel.classList.toggle("wide"), rememberAssistant(), paintAssistant()), "wide-only"),
    !paged && tool(t("assistant.hide"), "down", closeAssistant),
  );
  const body = panel.querySelector(".assistant-body");
  // new words are followed down the panel unless the person has scrolled up to read
  const follow = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  put(body, assistantBody());
  if (follow) body.scrollTop = body.scrollHeight;
  const busy = chat?.status === "thinking" || chat?.status === "asking";
  panel.querySelector(".assistant-form").hidden = !assistantUi.config?.ready;
  panel.querySelector(".assistant-form button").disabled = busy;
}

async function loadAssistantChat(id) {
  assistantUi.chat = await api("GET", `/api/assistant/chats/${id}`).catch(() => null);
  // the list keeps up with the chat on the screen, for the dot on the button
  const listed = assistantUi.chats.find((c) => c.id === id);
  if (listed && assistantUi.chat) listed.status = assistantUi.chat.status;
  markAssistantFab();
  paintAssistant();
}

async function loadAssistant(keep = false) {
  try {
    const data = await api("GET", "/api/assistant");
    assistantUi.config = data.config;
    assistantUi.chats = data.chats;
    if (state.overview) state.overview.assistant = data.config.ready;
  } catch {}
  markAssistantFab();
  if (!keep && assistantUi.chat) return loadAssistantChat(assistantUi.chat.id);
  paintAssistant();
}

async function forgetAssistantChat() {
  const { chat } = assistantUi;
  if (!chat) return;
  await api("DELETE", `/api/assistant/chats/${chat.id}`).catch((e) => toast(errorText(e), "error"));
  assistantUi.chat = null;
  void loadAssistant();
}

/** The round button in the corner of every page: opens the window, and shows when a change waits for a word */
function assistantFab() {
  if (!isAdmin()) return;
  leaveAssistantPage();
  if (!assistantUi.fab) {
    assistantUi.fab = h("button", { type: "button", class: "assistant-fab", title: t("assistant.title"), "aria-label": t("assistant.title"), onclick: () => (assistantUi.open ? closeAssistant() : openAssistant()) }, icon("chat"), h("span", { class: "fab-dot", hidden: true }));
    document.body.append(assistantUi.fab);
    // a window left open stays open after a reload; otherwise only the list of chats is asked for, for the dot
    if (localStorage.getItem(ASSISTANT_KEY) && state.route.view !== "assistant") {
      const last = localStorage.getItem(ASSISTANT_KEY + ".chat");
      if (last) assistantUi.chat = { id: last };
      openAssistant({ restore: true });
    }
    else void loadAssistant(true);
  }
}

/** The dot on the button: some chat of this person waits for a yes or no */
function markAssistantFab() {
  const dot = assistantUi.fab?.querySelector(".fab-dot");
  if (!dot) return;
  dot.hidden = !assistantUi.chats.some((c) => c.status === "asking");
  assistantUi.fab.classList.toggle("open", assistantUi.open);
}

const rememberAssistant = () => assistantUi.panel?.classList.contains("paged") || (assistantUi.open ? localStorage.setItem(ASSISTANT_KEY, assistantUi.panel?.classList.contains("wide") ? "wide" : "open") : localStorage.removeItem(ASSISTANT_KEY));

/** The window of the assistant, made once: floating over the pages, or the whole page #/assistant */
function assistantPanel() {
  if (!assistantUi.panel) {
    const input = h("textarea", { rows: 2, maxLength: 20000, placeholder: t("assistant.placeholder"), "aria-label": t("assistant.placeholder") });
    const submit = () => {
      const text = input.value;
      if (!text.trim() || form.querySelector("button").disabled) return;
      input.value = "";
      void sendToAssistant(text);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    const form = h("form", { class: "assistant-form", onsubmit: (e) => (e.preventDefault(), submit()) }, input, h("button", { class: "btn primary square", "aria-label": t("assistant.send"), title: t("assistant.send") }, icon("arrow")));
    assistantUi.panel = h("aside", { class: "assistant" + (localStorage.getItem(ASSISTANT_KEY) === "wide" ? " wide" : ""), "aria-label": t("assistant.title") }, h("nav", { class: "assistant-list", "aria-label": t("assistant.chats") }), h("div", { class: "assistant-head" }), h("div", { class: "assistant-body" }), form);
  }
  return assistantUi.panel;
}

/** Opens the window; `ask` is sent as the first words of a new chat, `draft` is put into the field */
function openAssistant({ ask, draft, restore } = {}) {
  const panel = assistantPanel();
  // on its own page the window is the page; elsewhere it floats
  if (state.route.view !== "assistant" && (panel.classList.contains("paged") || panel.parentElement !== document.body)) {
    panel.classList.remove("paged");
    document.body.append(panel);
  }
  assistantUi.open = true;
  assistantUi.panel.hidden = false;
  rememberAssistant();
  markAssistantFab();
  const input = assistantUi.panel.querySelector("textarea");
  if (ask) assistantUi.chat = null;
  if (draft) input.value = draft;
  paintAssistant();
  void loadAssistant().then(() => ask && assistantUi.config?.ready && sendToAssistant(ask, true));
  // a window put back after a reload does not take the keyboard from the page
  if (!restore) input.focus();
}

/** The assistant as a page of its own: the same window, with the chats on the left */
function renderAssistant() {
  const holder = h("div", { class: "assistant-page" });
  shell(holder);
  document.getElementById("view").classList.add("fill");
  const panel = assistantPanel();
  panel.classList.add("paged");
  holder.append(panel);
  panel.hidden = false;
  assistantUi.open = true;
  markAssistantFab();
  paintAssistant();
  void loadAssistant();
}

/** Leaving the page of the assistant: its window goes back to floating, closed */
function leaveAssistantPage() {
  const panel = assistantUi.panel;
  if (!panel?.classList.contains("paged") || state.route.view === "assistant") return;
  panel.classList.remove("paged");
  panel.hidden = true;
  document.body.append(panel);
  assistantUi.open = false;
  rememberAssistant();
  markAssistantFab();
}

function closeAssistant() {
  assistantUi.open = false;
  if (assistantUi.panel) assistantUi.panel.hidden = true;
  rememberAssistant();
  markAssistantFab();
}

/** The server says a chat moved on: the one on the screen is read again */
function assistantEvent(event) {
  if (event.owner !== state.user?.id) return;
  // with the window hidden, only the dot on the button follows
  if (!assistantUi.open) {
    clearTimeout(assistantUi.timer);
    assistantUi.timer = setTimeout(() => void loadAssistant(true), 300);
    return;
  }
  clearTimeout(assistantUi.timer);
  assistantUi.timer = setTimeout(() => {
    if (assistantUi.chat?.id === event.chat) void loadAssistantChat(event.chat);
    else if (!assistantUi.chat) void loadAssistant(true);
  }, 120);
}

function assistantSection() {
  const config = state.assistant?.config;
  if (!config) return h("p", { class: "muted" }, "…");
  const provider = h("select", null, ["anthropic", "openai"].map((id) => h("option", { value: id, selected: id === config.provider }, t("assistant.provider." + id))));
  const url = h("input", { type: "url", class: "mono", value: config.url, spellcheck: false });
  const urlHint = h("span", { class: "hint" });
  const key = h("input", { type: "password", autocomplete: "off", class: "mono", placeholder: config.saved ? t("assistant.keySaved") : "" });
  const models = h("datalist", { id: "assistant-models" });
  const model = h("input", { class: "mono", value: config.model, spellcheck: false, required: true });
  model.setAttribute("list", "assistant-models");
  const level = h("select", null, AGENT_LEVELS.map((id) => h("option", { value: id, selected: id === config.level }, t("agents.level." + id))));
  const levelHint = h("span", { class: "hint" });
  const error = h("p", { class: "error", role: "alert" });
  const paint = () => {
    url.placeholder = config.defaults[provider.value];
    urlHint.textContent = t(`assistant.url.${provider.value}`);
    levelHint.textContent = `${t(`agents.level.${level.value}.hint`)} ${t(level.value === "full" ? "assistant.level.full" : "assistant.level.asks")}`;
  };
  provider.addEventListener("change", paint);
  level.addEventListener("change", paint);
  paint();
  const draft = () => ({ provider: provider.value, url: url.value.trim(), key: key.value.trim(), model: model.value.trim(), level: level.value });
  const find = button(t("assistant.findModels"), {
    class: "small",
    onclick: async () => {
      error.textContent = "";
      find.disabled = true;
      try {
        const { models: names } = await api("POST", "/api/assistant/models", draft());
        put(models, names.map((name) => h("option", { value: name })));
        toast(t("assistant.modelsFound", { n: names.length }));
        model.focus();
      } catch (e) {
        error.textContent = [errorText(e), e.detail?.message].filter(Boolean).join(" — ");
      }
      find.disabled = false;
    },
  });
  return [
    h(
      "section",
      { class: "card pad" },
      h(
        "form",
        {
          class: "stack",
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              state.assistant = { ...state.assistant, ...(await api("PUT", "/api/assistant/config", draft())) };
              if (state.overview) state.overview.assistant = state.assistant.config.ready;
              assistantUi.config = state.assistant.config;
              toast(t("settings.saved"));
              renderSettings();
            } catch (err) {
              error.textContent = errorText(err);
            }
          },
        },
        h("div", { class: "section-head" }, h("h2", null, t("assistant.title")), config.ready && button(t("assistant.open"), { class: "small", onclick: () => openAssistant() }, "chat")),
        h("p", { class: "muted" }, t("assistant.lead")),
        h("label", { class: "field" }, h("span", { class: "label" }, t("assistant.provider")), provider),
        h("label", { class: "field" }, h("span", { class: "label" }, t("assistant.url")), url, urlHint),
        field(t("assistant.key"), key, t("assistant.keyHint")),
        h("label", { class: "field" }, h("span", { class: "label" }, t("assistant.model")), h("div", { class: "pair" }, model, find), models, h("span", { class: "hint" }, t("assistant.modelHint"))),
        h("label", { class: "field" }, h("span", { class: "label" }, t("agents.new.level")), level, levelHint),
        error,
        h("p", { class: "muted small" }, t("assistant.privacy")),
        h("div", { class: "row-actions" }, h("button", { class: "btn primary" }, t("settings.save"))),
      ),
    ),
  ];
}

// --- A connector that signs in: the administrator's answer ------------------------------------------

/** Where the connector is sent back to, in words a person can judge */
function connectWhere(redirect) {
  try {
    const url = new URL(redirect);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return t("connect.where.local");
    return /^https?:$/.test(url.protocol) ? url.host : t("connect.where.app", { scheme: url.protocol.slice(0, -1) });
  } catch {
    return redirect;
  }
}

function renderConnect() {
  const { id } = state.route;
  const box = h("section", { class: "card pad stack-s connect" }, h("p", { class: "muted" }, "…"));
  shell(box);
  const say = (text) => put(box, h("p", null, text), h("p", null, h("a", { class: "btn", href: "#/settings/agents" }, t("settings.agents"))));
  if (!isAdmin()) return put(box, h("p", null, t("connect.adminOnly")));
  const leave = async (answer, error) => {
    try {
      const { redirect } = await api("POST", `/api/oauth/requests/${id}`, answer);
      say(t(answer.allow ? "connect.done" : "connect.declined"));
      if (redirect) location.href = redirect;
    } catch (e) {
      if (e.code === "oauth.gone") say(t("error.oauth.gone"));
      else error.textContent = errorText(e);
    }
  };
  api("GET", `/api/oauth/requests/${id}`).then(
    (q) => {
      const level = h("select", null, AGENT_LEVELS.map((value) => h("option", { value, selected: value === (q.level || "read") }, t("agents.level." + value))));
      const hint = h("span", { class: "hint" });
      const confirm = h("input", { type: "checkbox", checked: true });
      const asks = h("label", { class: "check" }, confirm, h("span", null, t("agents.confirm")));
      const paint = () => {
        hint.textContent = t(`agents.level.${level.value}.hint`);
        asks.hidden = level.value !== "full";
      };
      level.addEventListener("change", paint);
      paint();
      const password = h("input", { type: "password", autocomplete: "current-password", required: true });
      const name = h("input", { type: "text", maxlength: 40, value: q.name.slice(0, 40), autocomplete: "off" });
      const error = h("p", { class: "error", role: "alert" });
      put(
        box,
        h(
          "form",
          {
            class: "stack-s",
            onsubmit: (e) => {
              e.preventDefault();
              void leave({ allow: true, name: name.value, level: level.value, confirm: level.value === "full" && confirm.checked, password: password.value }, error);
            },
          },
          h("h2", null, t("connect.asks", { name: q.name })),
          h("p", null, t("connect.lead")),
          field(t("connect.where"), h("div", { class: "connect-where" }, connectWhere(q.redirect)), t("connect.whereHint")),
          h("p", { class: "muted small" }, t("connect.warn")),
          field(t("connect.name"), name, t("connect.nameHint")),
          h("label", { class: "field" }, h("span", { class: "label" }, t("agents.new.level")), level, hint),
          asks,
          field(t("connect.password"), password, t("connect.passwordHint")),
          error,
          h("footer", null, button(t("approvals.decline"), { onclick: () => leave({ allow: false }, error) }), h("button", { class: "btn primary" }, t("connect.allow"))),
        ),
      );
    },
    (e) => say(e.code === "oauth.gone" ? t("error.oauth.gone") : errorText(e)),
  );
}

// --- Calls of agents that wait for an administrator's word ------------------------------------------

let askDialog = null;
/** Requests already shown in a dialog: one put off with "Later" waits in Settings → Agents */
const asksShown = new Set();

function askedWhat(ask) {
  const key = `approvals.what.${ask.tool}${ask.tool === "app_remove" && ask.args.deleteData === true ? ".data" : ""}`;
  return has(key) ? t(key, { app: String(ask.args.app ?? ""), snapshot: String(ask.args.snapshot ?? "") }) : ask.title;
}

async function answerAsk(ask, allow) {
  try {
    await api("POST", `/api/approvals/${ask.id}`, { allow });
  } catch (e) {
    toast(errorText(e), "error");
  }
  void loadApprovals();
}

async function loadApprovals() {
  if (!isAdmin()) return;
  state.approvals = await api("GET", "/api/approvals").catch(() => state.approvals ?? []);
  // answered on another device, or lapsed
  if (askDialog && !state.approvals.some((ask) => ask.id === askDialog.ask)) askDialog.close();
  const next = state.approvals.find((ask) => !asksShown.has(ask.id));
  if (next && !askDialog) approvalDialog(next);
  if (state.route.view === "settings" && state.route.section === "agents") renderSettings();
}

function approvalDialog(ask) {
  asksShown.add(ask.id);
  const answer = (allow) =>
    button(t(allow ? "approvals.allow" : "approvals.decline"), {
      class: allow ? "danger" : "",
      onclick: () => {
        dialog.close();
        void answerAsk(ask, allow);
      },
    });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("approvals.title", { agent: ask.agent })),
    h("p", null, t("approvals.text", { what: askedWhat(ask) })),
    typeof ask.args.compose === "string" && h("pre", { class: "ask-file" }, ask.args.compose),
    h("p", { class: "muted small" }, t("approvals.hint")),
    h("footer", null, closeButton(() => dialog, t("approvals.later")), answer(false), answer(true)),
  );
  dialog.ask = ask.id;
  askDialog = dialog;
  dialog.addEventListener("close", () => {
    askDialog = null;
    const next = (state.approvals ?? []).find((other) => !asksShown.has(other.id));
    if (next) approvalDialog(next);
  });
}

function agentDialog() {
  const name = h("input", { maxLength: 40, required: true, placeholder: t("agents.new.namePlaceholder") });
  const level = h("select", null, AGENT_LEVELS.map((id) => h("option", { value: id }, t("agents.level." + id))));
  const hint = h("span", { class: "hint" }, t("agents.level.read.hint"));
  const confirm = h("input", { type: "checkbox", checked: true });
  const asks = h("label", { class: "check", hidden: true }, confirm, h("span", null, t("agents.confirm")));
  level.addEventListener("change", () => {
    hint.textContent = t(`agents.level.${level.value}.hint`);
    asks.hidden = level.value !== "full";
  });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const made = await api("POST", "/api/agents", { name: name.value.trim(), level: level.value, confirm: level.value === "full" && confirm.checked });
            dialog.close();
            agentKeyDialog(made);
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("agents.new")), h("p", { class: "muted small" }, t("agents.new.lead"))), closeX(() => dialog)),
      field(t("agents.new.name"), name, t("agents.new.nameHint")),
      h("label", { class: "field" }, h("span", { class: "label" }, t("agents.new.level")), level, hint),
      asks,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("agents.new.create"))),
    ),
  );
  name.focus();
}

function renameAgentKey(key) {
  const input = h("input", { value: key.name, required: true, maxLength: 40, spellcheck: false, autocomplete: "off" });
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
            await api("PATCH", `/api/agents/${key.id}`, { name: input.value.trim() });
            dialog.close();
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("agents.rename.title", { name: key.name })),
      h("p", { class: "muted" }, t("agents.rename.lead")),
      input,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("agents.rename"))),
    ),
  );
  input.focus();
  input.select();
}

function removeAgentKey(key) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("agents.remove.title", { name: key.name })),
    h("p", { class: "muted" }, t("agents.remove.lead")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("agents.remove"), {
        class: "danger",
        onclick: async () => {
          await api("DELETE", `/api/agents/${key.id}`).catch((e) => toast(errorText(e), "error"));
          dialog.close();
          void loadSettings();
        },
      }),
    ),
  );
}

function agentsSection() {
  const keys = state.agents;
  if (!keys) return h("p", { class: "muted" }, "…");
  const row = (key) =>
    h(
      "div",
      { class: "snapshot" },
      h(
        "div",
        { class: "grow" },
        h("strong", null, key.name, h("span", { class: "state agent-level " + key.level }, t("agents.level." + key.level))),
        h("div", { class: "muted small" }, [key.via ? t("agents.via", { client: key.via }) : `hata_…${key.hint}`, t("agents.createdBy", { user: key.createdBy, when: ago(key.createdAt) }), key.lastUsed ? t("agents.lastUsed", { when: ago(key.lastUsed), ip: key.lastIp }) : t("agents.neverUsed")].join(" · ")),
      ),
      key.level === "full" &&
        h(
          "label",
          { class: "check small", title: t("agents.confirm") },
          h("input", {
            type: "checkbox",
            checked: key.confirm,
            onchange: async (e) => {
              await api("PATCH", `/api/agents/${key.id}`, { confirm: e.target.checked }).catch((err) => toast(errorText(err), "error"));
              void loadSettings();
            },
          }),
          h("span", null, t("agents.confirm.short")),
        ),
      h("button", { type: "button", class: "icon-btn", "aria-label": t("agents.rename"), title: t("agents.rename"), onclick: () => renameAgentKey(key) }, icon("edit")),
      h("button", { type: "button", class: "icon-btn", "aria-label": t("agents.remove"), title: t("agents.remove"), onclick: () => removeAgentKey(key) }, icon("trash")),
    );
  const waiting = state.approvals ?? [];
  return [
    waiting.length > 0 &&
      h(
        "section",
        { class: "card pad" },
        h("h2", null, t("approvals.waiting")),
        h("p", { class: "muted" }, t("approvals.hint")),
        h(
          "div",
          { class: "snapshot-list agent-keys" },
          waiting.map((ask) =>
            h(
              "div",
              { class: "snapshot" },
              h("div", { class: "grow" }, h("strong", null, ask.agent), h("div", { class: "muted small" }, [t("approvals.text", { what: askedWhat(ask) }), ago(ask.at)].join(" · "))),
              typeof ask.args.compose === "string" && button(t("approvals.look"), { class: "small", onclick: () => approvalDialog(ask) }),
              button(t("approvals.decline"), { class: "small", onclick: () => answerAsk(ask, false) }),
              button(t("approvals.allow"), { class: "small danger", onclick: () => answerAsk(ask, true) }),
            ),
          ),
        ),
      ),
    h(
      "section",
      { class: "card pad" },
      h("div", { class: "section-head" }, h("h2", null, t("agents.title")), button(t("agents.new"), { class: "small primary", onclick: agentDialog }, "plus")),
      h("p", { class: "muted" }, t("agents.lead")),
      keys.length ? h("div", { class: "snapshot-list agent-keys" }, keys.map(row)) : h("p", { class: "muted small" }, t("agents.none")),
    ),
    h(
      "section",
      { class: "card pad stack-s" },
      h("h2", null, t("agents.how.title")),
      h("p", { class: "muted" }, t("agents.how.address")),
      copyBox(mcpAddress()),
      location.protocol === "http:" && h("p", { class: "muted small" }, t("agents.how.plain")),
      h("p", { class: "muted" }, t("agents.how.signin")),
    ),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("agents.levels.title")),
      AGENT_LEVELS.map((id) => h("div", { class: "setting" }, h("div", { class: "grow" }, h("strong", null, t("agents.level." + id)), h("p", { class: "muted small" }, t(`agents.level.${id}.hint`))))),
      h("p", { class: "muted small agent-never" }, t("agents.never")),
    ),
  ];
}

function renderSettings() {
  const section = state.route.section;
  shell(...settingsFrame(section, state.account && (state.settings || !isAdmin()) ? settingsSection(section) : h("p", { class: "muted" }, "…")));
}

/** The head and the list of sections of Settings around what one section shows */
function settingsFrame(section, ...content) {
  return [
    h("div", { class: "page-head" }, h("div", null, h("h1", null, t("nav.settings")), h("p", { class: "meta" }, `Hata ${state.version}`))),
    h(
      "div",
      { class: "settings" },
      h("nav", { class: "cats fold" }, sections().map((item) => h("a", { class: "cat" + (section === item.id ? " active" : ""), href: `#/settings/${item.id}` }, h("span", { class: "with-icon" }, icon(item.icon), t(item.label ?? "settings." + item.id))))),
      h("div", { class: "stack" }, content),
    ),
  ];
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
            // what the administrator could not do until now opens once the codes are put away
            if (state.user.mustTwoFactor) return recoveryDialog(res.recovery, () => location.reload());
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

function recoveryDialog(codes, done = () => {}) {
  const dialog = openDialog(
    "",
    h("h2", null, t("twofa.recoveryTitle")),
    h("p", { class: "muted" }, t("twofa.recoveryLead")),
    h("pre", { class: "codes" }, codes.join("\n")),
    h("footer", null, button(t("twofa.copy"), { onclick: () => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast(t("twofa.copied"))) }), button(t("twofa.saved"), { class: "primary", onclick: () => (dialog.close(), done()) })),
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
    if (!state.settings) state.settings = await api("GET", "/api/settings");
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

function userMenuFor(user, at = null) {
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
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "avatar" }, user.name.slice(0, 1).toUpperCase()), h("div", null, h("h2", null, user.name), h("span", { class: "muted small" }, t("user.role." + user.role)))),
    user.role !== "member" && item(t("users.makeMember"), "user", () => change({ role: "member" })),
    user.role !== "guest" && item(t("users.makeGuest"), "user", () => change({ role: "guest" })),
    user.role !== "admin" && item(t("users.makeAdmin"), "sliders", () => change({ role: "admin" })),
    item(t(user.shares === false ? "users.sharesAllow" : "users.sharesDeny"), "share", () => change({ shares: user.shares === false }, t(user.shares === false ? "users.sharesAllowed" : "users.sharesDenied"))),
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
  if (at) placeAt(dialog, at);
}

function renderUsers() {
  const users = state.users ?? [];
  const admins = users.filter((u) => u.role === "admin").length;
  const without = users.filter((u) => !u.twoFactor).length;
  shell(
    ...settingsFrame(
    "users",
    h("div", { class: "page-head section-page" }, h("div", null, h("h2", null, t("nav.users")), h("p", { class: "meta" }, t("users.meta", { users: users.length, admins }), without > 0 && h("span", { class: "dot-sep" }, "·"), without > 0 && t("users.without2fa", { n: without }))), h("div", { class: "actions" }, button(t("users.add"), { class: "primary", onclick: userDialog }, "plus"))),
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
              { menu: (at) => userMenuFor(u, at) },
              h("td", null, h("div", { class: "with-icon" }, h("span", { class: "avatar" }, u.name.slice(0, 1).toUpperCase()), h("div", null, h("span", { class: "strong" }, u.name), u.id === state.user.id && h("span", { class: "muted small" }, " ", t("users.you")), userShares(u)))),
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
    requireTwoFactorRow(),
    h("div", { class: "columns" }, h("section", null, accessMatrix()), h("aside", { class: "side" }, invitesCard(), signInLog())),
    ),
  );
}

/** The network folders a user may open, and how — under the name in the list of users */
function userShares(user) {
  if (user.shares === false) return h("div", { class: "muted small" }, t("users.sharesDenied"));
  const shares = (state.settings?.shares ?? []).filter((share) => share.users?.[user.id]);
  if (!shares.length) return null;
  return h("div", { class: "muted small" }, t("users.shares"), " ", shares.map((share, i) => [i > 0 && ", ", h("a", { class: "link", href: "#/settings/shares" }, share.name), ` (${t("shares.access." + share.users[user.id])})`]));
}

/** The rule that every administrator signs in with a second factor */
function requireTwoFactorRow() {
  const on = !!state.settings?.security?.adminTwoFactor;
  const box = h("input", {
    type: "checkbox",
    checked: on,
    onchange: async () => {
      try {
        state.settings = await api("PUT", "/api/settings", { security: { adminTwoFactor: box.checked } });
      } catch (e) {
        box.checked = on;
        toast(errorText(e), "error");
      }
    },
  });
  return h("section", { class: "card pad" }, h("label", { class: "check" }, box, h("span", null, h("strong", null, t("users.require2fa")), h("span", { class: "muted small block" }, t("users.require2faHint")))));
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
      const res = await api("PUT", app.machine ? `/api/machines/${app.machine.id}/apps/${app.app}/access` : `/api/apps/${app.name}/access`, { protect: app.protect, allowed: app.allowed, ...patch });
      if (res.job) jobDialog(res.job, "apply", app.title, () => void loadUsers());
      else void loadUsers();
    } catch (e) {
      toast(errorText(e), "error");
      void loadUsers();
    }
  };
  // sign-in stands in front of the web port; the app's other ports are listed so that nobody takes them for closed
  const otherPorts = (app) =>
    h(
      "div",
      { class: "muted small other-ports" },
      t("access.others"),
      app.others.map((o) =>
        h(
          "label",
          null,
          h("input", { type: "checkbox", checked: o.guarded, onchange: (e) => update(app, { ports: app.others.filter((x) => (x.port === o.port ? e.target.checked : x.guarded)).map((x) => x.port) }) }),
          String(o.port),
        ),
      ),
    );
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
      h("td", null, h("div", { class: "with-icon" }, appIcon(app, "sm"), h("div", { class: "stack-s backup-name" }, h("a", { class: "strong", href: app.machine ? `#/machines/${app.machine.id}/apps` : `#/apps/${app.name}` }, app.title), app.machine && h("div", { class: "muted small with-icon" }, icon("server"), app.machine.name, app.protect && app.listen ? ` · ${t("access.through", { port: app.listen })}` : ""), app.cannotProtect === "hostNetwork" && h("div", { class: "muted small" }, t("access.hostOpen")), !everyone && !app.protect && h("div", { class: "muted small" }, t("access.onlyHidden")), app.protect && app.others.length > 0 && otherPorts(app)))),
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
  // a new server opens with the walk through its first choices; any other address is left alone
  if (state.welcome && isAdmin() && !/^#\/./.test(location.hash)) history.replaceState(null, "", location.pathname + "#/welcome");
  state.route = parseRoute();
  render();
  await refresh();
  startEvents();
  if (isAdmin() && state.route.view !== "welcome") api("GET", "/api/settings").then((s) => (state.settings = s), () => {});
  void pushResync();
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
  Object.assign(state, { version: server.version, setup: server.setup, welcome: !!server.welcome, user: server.user, languages: server.languages, passkeys: !!server.passkeys && !!window.PublicKeyCredential });
  await loadLanguage(pickLanguage(server));
  if (state.user) await enter();
  else render();
}

void main();
