// Hata web UI. No build step and no framework: the DOM is built with h() below, which only ever sets
// text and attributes — store content (titles, descriptions) never reaches the page as markup.
//
// The script is in parts, src/ui/app/NN-<part>.js: plain scripts the page loads in this order, sharing one
// scope (a name of one part is seen by all). What runs while a part loads may use only what the parts before
// it declare; the page starts in the last one, once all are there. A slip shows as an exception on load,
// which `bun run smoke` fails on; tests/ui.test.ts checks the parts are listed in order and parse.
"use strict";

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
  modules: "M4 4h6v6H4zM4 14h6v6H4zM14 14h6v6h-6zM17 4v6M14 7h6",
  chart: "M4 4v16h16M7 15l4-5 3 3 5-6",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
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
  tv: "M3 5h18v12H3zM8 21h8M12 17v4",
  back30: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  fwd30: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  volume: "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  volumeOff: "M11 5 6 9H3v6h3l5 4zM16 9.5l5 5M21 9.5l-5 5",
  lines: "M4 6h16M4 12h16M4 18h16",
  pause: "M8 5v14M16 5v14",
  stop: "M6 6h12v12H6z",
  play: "M7 5l12 7-12 7z",
  menu: "M4 6h16M4 12h16M4 18h16",
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
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  terminal: "M5 8l4 4-4 4M12 16h7",
  store: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  undo: "M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2",
  keys: "M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4",
  "bell-off": "M6 17V11a6 6 0 0 1 9-5.2M18 11v6l2 2H4M10 21h4M4 4l16 16",
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
  screen: "M3 4h18v12H3zM8 20h8M12 16v4",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.2a4 4 0 0 1 0 7.6M18 14.2a6 6 0 0 1 4 5.8v1",
  plug: "M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5",
  signpost: "M12 3v18M5 6h12l3 3-3 3H5V6zM8 21h8",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ban: "M12 3l7 3v5c0 4.6-2.9 8.3-7 10-4.1-1.7-7-5.4-7-10V6l7-3zM8.5 8.5l7 7",
  shield: "M12 3l7 3v5c0 4.6-2.9 8.3-7 10-4.1-1.7-7-5.4-7-10V6l7-3z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z",
  power: "M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0",
  fan: "M12 12h.01M12 10c-1-3 0-6 3-6s3 4-1 7M14 12c3-1 6 0 6 3s-4 3-7-1M12 14c1 3 0 6-3 6s-3-4 1-7M10 12c-3 1-6 0-6-3s4-3 7 1",
  blinds: "M4 3h16M5 3v18M19 3v18M5 7h14M5 11h14M5 15h14M12 15v3",
  droplet: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  door: "M6 21V3h12v18M3 21h18M14.5 12h.01",
  speaker: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10",
  battery: "M3 8h15v8H3zM21 11v2M6 11v2M9 11v2",
  bluetooth: "M7 7l10 10-5 5V2l5 5L7 17",
  next: "M5 5l10 7-10 7zM19 5v14",
  previous: "M19 5L9 12l10 7zM5 5v14",
  shuffle: "M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  mouse: "M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5zM12 7v3",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.5 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2",
  headphones: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z",
  gamepad: "M6 8h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5.2 2L15 14H9l-1.8 2A3 3 0 0 1 2 14v-2a4 4 0 0 1 4-4zM7 11v2M6 12h2M16 12h.01",
  remote: "M8 2h8v20H8zM12 6h.01M12 10h.01M12 14h.01",
  phone: "M7 2h10v20H7zM11 18h2",
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
/** "{n} cores" with one of them, in English; Ukrainian's strings are written so that they need no such thing */
const oneOf = (text, vars, lang) => (Number(vars.n) === 1 && lang === "en" ? text.replace(/\{n\} ((?:[a-z]+ )?)([a-z]+?)(ie)?s\b/, (_, word, stem, ie) => `{n} ${word}${stem}${ie ? "y" : ""}`) : text);

function t(key, vars = {}) {
  const text = oneOf(dict[key] ?? fallbackDict[key] ?? key, vars, state.lang);
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
  frameDialog(dialog);
  dialog.showModal();
  // the browser gives the focus to the first button there is — the cross — and draws its ring: a window starts
  // on its first field instead (not on a touch screen, where that brings the keyboard up), else on itself
  if (document.activeElement?.classList?.contains("dlg-x") || document.activeElement?.closest?.(".dlg-head")) {
    const field = !matchMedia("(pointer: coarse)").matches && dialog.querySelector(".dlg-body :is(input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea):not(:disabled)");
    if (field) field.focus();
    else {
      dialog.tabIndex = -1;
      dialog.focus({ preventScroll: true });
    }
  }
  return dialog;
}

/** Windows that keep a layout of their own: menus, the lists of a select, sheets, the viewer of files */
const UNFRAMED_RE = /(^|\s)(menu|dropdown|nav-sheet|add-dialog|viewer)(\s|$)/;

/**
 * Every window is built the same way, whatever its maker handed over: a head (the title, a line of
 * explanation under it, the cross — always), a body that alone scrolls, and the foot with the buttons,
 * which stays in sight. The makers go on writing `h2, …, footer`; this puts the parts where they
 * belong, and again when a window's content is replaced or added to.
 */
function frameDialog(dialog) {
  if (UNFRAMED_RE.test(dialog.className)) return;
  dialog.classList.add("framed");
  const only = dialog.children.length === 1 && dialog.firstElementChild.tagName === "FORM" ? dialog.firstElementChild : null;
  const root = only ?? dialog;
  const frame = () => {
    const kids = [...root.childNodes].filter((node) => node.nodeType === 1 || node.textContent.trim());
    const framed = (cls) => kids.find((node) => node.classList?.contains(cls));
    let body = framed("dlg-body");
    if (framed("dlg-head") && body) {
      // something was added to a window that stands: it belongs to the body, a footer to the foot's place
      for (const node of kids) if (!node.classList?.contains("dlg-head") && node !== body && node.tagName !== "FOOTER") body.append(node);
      return;
    }
    const title = kids.find((node) => node.tagName === "HEADER") ?? kids.find((node) => node.tagName === "H2");
    const after = title?.tagName === "H2" ? kids[kids.indexOf(title) + 1] : null;
    const lead = after?.tagName === "P" && after.classList.contains("muted") && !after.classList.contains("error") ? after : null;
    const foot = kids.findLast((node) => node.tagName === "FOOTER");
    // a window that draws its own head inside its body (the disk's) brings its own cross: never a second one
    const cross = root.querySelector(`.icon-btn[aria-label="${CSS.escape(t("common.close"))}"]`) ? null : h("button", { type: "button", class: "icon-btn dlg-x", "aria-label": t("common.close"), onclick: () => dialog.close() }, icon("x"));
    const head = h("div", { class: "dlg-head" }, h("div", { class: "dlg-title" }, title, lead), cross);
    body = h("div", { class: "dlg-body" }, kids.filter((node) => node !== title && node !== lead && node !== foot));
    root.replaceChildren(head, body, ...(foot ? [foot] : []));
  };
  frame();
  new MutationObserver(() => {
    const stray = [...root.children].some((node) => !node.classList.contains("dlg-head") && !node.classList.contains("dlg-body") && node.tagName !== "FOOTER");
    if (stray || !root.querySelector(":scope > .dlg-head")) frame();
  }).observe(root, { childList: true });
}

/**
 * A window that comes up from the bottom of a phone is closed by pulling it down: by the bar on its
 * top from anywhere, by the rest of it while it is not scrolled. Pulled a little it springs back;
 * pulled far, or flicked, it goes. A slider under the finger is the slider's.
 */
function pullToClose(dialog) {
  let pull = null;
  const settle = (to, then) => {
    dialog.style.transition = "transform 0.18s ease-out";
    dialog.style.transform = to;
    setTimeout(() => ((dialog.style.transition = ""), then?.()), 190);
  };
  dialog.addEventListener("touchstart", (e) => {
    pull = null;
    if (!phone.matches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const top = touch.clientY - dialog.getBoundingClientRect().top < 64;
    if (!top && (dialog.scrollTop > 0 || e.target.closest?.("input[type=range], select, textarea"))) return;
    pull = { x: touch.clientX, y: touch.clientY, at: performance.now(), by: 0, on: false };
  }, { passive: true });
  dialog.addEventListener("touchmove", (e) => {
    if (!pull) return;
    const [dx, dy] = [e.touches[0].clientX - pull.x, e.touches[0].clientY - pull.y];
    if (!pull.on) {
      // sideways or upwards it is something else: a slider's neighbour, the window's own scroll
      if (Math.abs(dx) > 10 || dy < -6) return void (pull = null);
      if (dy < 10) return;
      pull.on = true;
      dialog.classList.add("pulled");
    }
    if (e.cancelable) e.preventDefault();
    pull.by = Math.max(0, dy);
    dialog.style.transform = `translateY(${pull.by}px)`;
  }, { passive: false });
  const end = (e) => {
    const was = pull;
    pull = null;
    if (!was?.on) return;
    // the finger let go over a button: that is not a press of it
    const swallow = (click) => (click.stopPropagation(), click.preventDefault());
    dialog.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => (dialog.removeEventListener("click", swallow, { capture: true }), dialog.classList.remove("pulled")), 400);
    const fast = was.by / Math.max(1, performance.now() - was.at) > 0.6 && was.by > 40;
    if (e.type === "touchend" && (fast || was.by > Math.min(160, dialog.offsetHeight / 3))) settle("translateY(100%)", () => dialog.close());
    else settle("");
  };
  dialog.addEventListener("touchend", end);
  dialog.addEventListener("touchcancel", end);
}

/** Replaces what an element holds; like h(), it takes arrays and skips what is false or missing */
const put = (el, ...children) => el.replaceChildren(...h("div", null, children).childNodes);

const button = (label, attrs = {}, iconName) => h("button", { type: "button", ...attrs, class: "btn " + (attrs.class ?? "") }, iconName && icon(iconName), label && h("span", null, label));

/*
 * The building blocks of a page (their spacing is "The building blocks" at the end of app.css). A new page is made
 * of these and nothing of its own: a card with a head, the line that explains it and its blocks; facts in rows.
 */
/**
 * A card: `title` (with `count` and `marks` beside it, `actions` on the right), the line `lead` under it, then the
 * blocks in `body`, 16 px apart. `flush` — the body (a table, a list of rows) reaches the card's edges.
 */
function uiCard({ title = null, count = null, marks = null, actions = null, lead = null, id = null, cls = "", flush = false, menu = undefined } = {}, ...body) {
  const head =
    title != null &&
    h(
      "div",
      { class: "section-head" + (flush ? " pad" : "") },
      h("h2", null, title, count != null && h("span", { class: "muted" }, String(count)), marks),
      actions && h("div", { class: "actions" }, actions),
    );
  const explain = lead && h("p", { class: "muted small" + (flush ? " pad" : "") }, lead);
  return h("section", { class: `card${flush ? "" : " pad"}${cls ? " " + cls : ""}`, id, menu }, head, explain, ...body);
}
/** Facts in rows, a label on the left and its value on the right: `[label, value]` pairs, empty ones left out */
const uiFacts = (rows) => rows.filter(Boolean).map(([label, value]) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", null, value)));

/*
 * The blocks of the design system (its SYSTEM.md: 21 blocks, a closed set). A page is made of these, never of
 * markup of its own: a head, cards, rows, settings, facts, tables, tiles, states, numbers, meters, notices,
 * empties, commands, steps. Their look is the block "Blocks" at the end of app.css (classes `ui-…`). The sheet
 * `#/blocks` shows every block in every form; `tests/blocks.test.ts` keeps pages from making their own.
 */

/** The rest of the actions: one "⋯" of the size given, opening a menu of `entries` (or of what `entries()` gives) */
function uiMore(entries, { size = "m", header = null, label = t("app.more") } = {}) {
  const b = h("button", { type: "button", class: `btn ui-more ${size === "s" ? "small square" : "square"}`, "aria-label": label, title: label }, icon("more"));
  b.onclick = (e) => {
    e.stopPropagation();
    const list = typeof entries === "function" ? entries() : entries;
    menuAt(b, typeof header === "function" ? header() : header, list);
  };
  return b;
}

/** A state: a pill with a dot, in one of five tones — ok, warn, bad, info, off */
const uiState = (tone, text, attrs = {}) => h("span", { class: `ui-state ${tone}`, ...attrs }, text);
/** A tag: a small grey label without a frame */
const uiTag = (text) => h("span", { class: "ui-tag" }, text);
/** The count of what needs attention, by a section's name or on a tile of the menu */
const uiCount = (n) => (n > 0 ? h("b", { class: "ui-count" }, String(n)) : null);

/**
 * A meter: a bar of 4 px. `kind` — capacity (ok < 80, warn to 94, bad from 95), progress (the accent) or load
 * (faint); `label` above it. `parts` instead of a value draws a bar of several colours.
 */
function uiMeter(value, { kind = "capacity", label = null, parts = null } = {}) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = kind === "progress" ? "progress" : kind === "load" ? "load" : v >= 95 ? "bad" : v >= 80 ? "warn" : "ok";
  const bar = parts
    ? h("div", { class: "ui-meter multi" }, parts.map((p) => h("i", { class: "c-" + (p.colour ?? "1"), style: null, "data-w": p.value })))
    : h("div", { class: `ui-meter ${tone}`, role: "meter", "aria-valuenow": Math.round(v), "aria-valuemin": 0, "aria-valuemax": 100 }, h("i"));
  if (parts) bar.querySelectorAll("i").forEach((i) => i.style.setProperty("width", i.dataset.w + "%"));
  else bar.firstChild.style.setProperty("width", v + "%");
  return label ? h("div", { class: "ui-meter-wrap" }, h("span", { class: "ui-meter-label" }, label), bar) : bar;
}

/** A meter of steps: what is done in the accent, the current one moving */
function uiSteps(done, total, { running = true } = {}) {
  return h("div", { class: "ui-steps", "aria-label": t("ui.stepOf", { n: Math.min(done + 1, total), of: total }) }, Array.from({ length: total }, (_, i) => h("i", { class: i < done ? "done" : i === done && running ? "now" : "" })));
}

/** A switch that acts at once: 36 × 20, on the right of what it switches */
function uiSwitch({ on = false, label, onchange = null, disabled = false, busy = false } = {}) {
  const b = h("button", { type: "button", class: "ui-switch" + (busy ? " busy" : ""), role: "switch", "aria-checked": String(on), "aria-label": label, disabled, "aria-busy": busy ? "true" : null }, h("i"));
  b.onclick = async () => {
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    if (!onchange) return;
    b.setAttribute("aria-busy", "true");
    try {
      await onchange(next);
    } catch (e) {
      b.setAttribute("aria-checked", String(!next));
      toast(errorText(e), "error");
    } finally {
      b.removeAttribute("aria-busy");
    }
  };
  return b;
}

/** A segment of up to four choices; more than four become a choice from a list */
function uiSegment(items, value, onchange, { wide = false, label = null } = {}) {
  if (items.length > 4) {
    const sel = h("select", { "aria-label": label, onchange: () => onchange(sel.value) }, items.map((x) => h("option", { value: x.value, selected: x.value === value }, x.count != null ? `${x.label} · ${x.count}` : x.label)));
    return sel;
  }
  return h(
    "div",
    { class: "ui-segment" + (wide ? " wide" : ""), role: "tablist", "aria-label": label },
    items.map((x) =>
      h(
        x.href ? "a" : "button",
        { type: x.href ? null : "button", href: x.href, class: "ui-seg" + (x.value === value ? " active" : ""), role: "tab", "aria-selected": String(x.value === value), disabled: x.off, title: x.why, onclick: x.href ? null : () => onchange?.(x.value) },
        x.icon && icon(x.icon),
        x.label,
        x.count != null && h("span", { class: "ui-seg-count" }, String(x.count)),
      ),
    ),
  );
}

/** A leading part of a row: an icon in a frame, an icon in a tone, a picture, a person, a tick, a colour */
function uiLead(lead) {
  if (!lead) return null;
  if (lead instanceof Node) return lead;
  if (lead.check) return lead.check;
  if (lead.avatar) return lead.avatar;
  if (lead.colour) return h("span", { class: "ui-lead colour" }, h("i", { class: "c-" + lead.colour }));
  if (lead.img) return h("span", { class: "ui-lead thumb" }, lead.img);
  if (lead.logo) return h("span", { class: "ui-lead" }, lead.logo);
  return h("span", { class: "ui-lead" + (lead.tone ? " tone " + lead.tone : "") }, icon(lead.icon ?? "box"));
}

/**
 * A row: `[lead] — [name + sub] — [tail]`. Tail from the left: `value` (or `time`), `state`, one `action` (a small
 * button), `more` (entries of "⋯"). `href` / `onclick` make the whole row a way somewhere (then a chevron, no "⋯").
 * `mode` — "event" (time in mono on the right), "group" (a grey band), "task" (a meter under the text).
 */
function uiRow({ lead = null, name, sub = null, value = null, time = null, state = null, action = null, more = null, href = null, onclick = null, mode = "thing", meter = null, title = null, cls = "", menu = undefined, id = null } = {}) {
  const goes = !!(href || onclick);
  const text = h("div", { class: "ui-row-text" }, h("div", { class: "ui-row-name", title: title ?? (typeof name === "string" ? name : null) }, name), sub && h("div", { class: "ui-row-sub", title: typeof sub === "string" ? sub : null }, sub), action && time != null && h("div", { class: "ui-row-when mono" }, time), meter);
  const tail = h(
    "div",
    { class: "ui-row-tail" },
    value != null && h("span", { class: "ui-row-value" }, value),
    time != null && h("span", { class: "ui-row-time mono" }, time),
    state,
    action,
    more && uiMore(more, { size: "s" }),
    goes && !more && !action && icon("chevron", "ui-row-go"),
  );
  return h(href ? "a" : "div", { class: `ui-row ${mode}${goes ? " goes" : ""}${action ? " acts" : ""}${cls ? " " + cls : ""}`, href, onclick, id, menu, role: onclick && !href ? "button" : null, tabindex: onclick && !href ? 0 : null }, uiLead(lead), text, tail);
}

/** A group of rows: a grey band with a chevron, a name, a count and its own tail; rows under it */
function uiGroup({ name, count = null, state = null, action = null, more = null, open = true, onToggle = null }, ...rows) {
  const band = h(
    "div",
    { class: "ui-row group" + (open ? " open" : "") },
    h("button", { type: "button", class: "ui-group-fold", "aria-expanded": String(open), onclick: () => onToggle?.(!open) }, icon("chevron"), h("span", null, name), count != null && h("span", { class: "ui-row-count" }, String(count))),
    h("div", { class: "ui-row-tail" }, state, action, more && uiMore(more, { size: "s" })),
  );
  return h("div", { class: "ui-group" }, band, open && rows);
}

/** A setting: its name and what it does on the left, the control on the right (under it on a phone) */
const uiSetting = ({ name, explain = null, control, wide = false, id = null }) =>
  h("div", { class: "ui-setting" + (wide ? " wide" : ""), id }, h("div", { class: "ui-setting-text" }, h("div", { class: "ui-setting-name" }, name), explain && h("div", { class: "ui-setting-explain" }, explain)), h("div", { class: "ui-setting-control" }, control));

/** Facts with a meter: an icon, a label, the meter (or a sparkline) and the value — one metric to a row */
const uiMeterFacts = (rows) =>
  rows.filter(Boolean).map((r) => h("div", { class: "ui-mfact" }, h("span", { class: "ui-mfact-label" }, r.icon && icon(r.icon), r.label), h("span", { class: "ui-mfact-bar" }, r.spark ?? uiMeter(r.value, { kind: r.kind ?? "load" })), h("span", { class: "ui-mfact-value mono" }, r.text)));

/** A number of the strip: a label, the value with its unit, room for a meter, a hint — always the same height */
const uiStat = ({ icon: iconName = null, label, value, unit = null, tone = null, meter = null, hint = null, href = null }) =>
  h(href ? "a" : "div", { class: "ui-stat", href }, h("span", { class: "ui-stat-label" }, iconName && icon(iconName), label), h("span", { class: "ui-stat-value" }, h("strong", { class: tone }, value), unit && h("span", null, unit)), h("span", { class: "ui-stat-chart" }, meter), h("span", { class: "ui-stat-hint" }, hint ?? ""));

/**
 * A table: `columns` [{ label, num, sort }], `rows` [{ cells, sub, menu, onclick, href, group }]. The first cell is
 * the name. On a phone (its own width under 640) each row becomes a row of the list: the name and its `sub`.
 */
function uiTable(columns, rows, { cls = "", height = 56 } = {}) {
  const head = h("thead", null, h("tr", null, columns.map((c) => h("th", { class: c.num ? "num" : null, "aria-sort": c.sorted ?? null }, c.sort ? h("button", { type: "button", class: "ui-th-sort", onclick: c.sort }, c.label, c.sorted && icon(c.sorted === "ascending" ? "up" : "down")) : c.label))));
  const body = h(
    "tbody",
    null,
    rows.map((r) =>
      r.group != null
        ? h("tr", { class: "ui-tr-group" }, h("td", { colspan: columns.length }, r.group))
        : h(
            "tr",
            { class: r.onclick || r.href ? "goes" : null, onclick: r.onclick ?? (r.href ? () => (location.hash = r.href.replace(/^#/, "")) : null), menu: r.menu },
            r.cells.map((cell, i) => h("td", { class: columns[i]?.num ? "num" : null }, i === 0 && r.sub ? [cell, h("div", { class: "ui-td-sub" }, r.sub)] : cell)),
          ),
    ),
  );
  return h("div", { class: `ui-table-wrap h${height}${cls ? " " + cls : ""}` }, h("table", { class: "ui-table" }, head, body));
}

/** The name cell of a table: a lead (an icon in its frame, a tick), the name and a line under it */
const uiCell = ({ lead = null, tick = null, name, sub = null }) =>
  h("div", { class: "ui-cell" }, tick, uiLead(lead), h("div", { class: "ui-cell-text" }, h("div", { class: "ui-cell-name", title: typeof name === "string" ? name : null }, name), sub && h("div", { class: "ui-cell-sub" }, sub)));

/**
 * A tile: an icon, a name, a sub line and a state above; one line below — a value, a meter or a warning (which
 * takes the value's place). `tone` warn / bad gives the frame of a thing that needs attention. `desc` makes the
 * tile of 128 with two lines of description (the store, the modules). `kind` small / media / add.
 */
function uiTile({ icon: iconName = "box", logo = null, name, sub = null, state = null, foot = null, warn = null, tone = null, desc = null, href = null, onclick = null, more = null, kind = "", tail = null, menu = undefined, selected = false, id = null, picture = null } = {}) {
  const head = h(
    "div",
    { class: "ui-tile-top" },
    kind === "media" ? null : logo ? h("span", { class: "ui-tile-icon" }, logo) : h("span", { class: "ui-tile-icon" }, icon(iconName)),
    h("div", { class: "ui-tile-names" }, h("div", { class: "ui-tile-name", title: typeof name === "string" ? name : null }, name), sub && h("div", { class: "ui-tile-sub", title: typeof sub === "string" ? sub : null }, sub)),
    state,
    tail,
    more && uiMore(more, { size: "s" }),
  );
  const low = warn ? h("div", { class: `ui-tile-foot warn ${tone ?? "warn"}` }, icon("alert"), h("span", null, warn)) : foot && h("div", { class: "ui-tile-foot" }, foot);
  const description = desc && h("div", { class: "ui-tile-desc" }, desc);
  const media = kind === "media" && h("div", { class: "ui-tile-picture" }, picture ?? icon(iconName));
  return h(
    href ? "a" : onclick ? "button" : "div",
    { class: `ui-tile${kind ? " " + kind : ""}${desc ? " described" : ""}${tone ? " " + tone : ""}${selected ? " selected" : ""}`, href, type: onclick && !href ? "button" : null, onclick, menu, id },
    media,
    head,
    description,
    low,
  );
}
/** The tile that adds: a dashed frame with a plus */
const uiAddTile = (label, onclick) => h("button", { type: "button", class: "ui-tile add", onclick }, icon("plus"), h("span", null, label));

/** A notice: a box in a soft tone with an icon, a title, a text, an optional command and up to two buttons */
const uiNotice = ({ tone = "info", icon: iconName = null, title = null, text = null, command = null, action = null, second = null, foot = null }) =>
  h(
    "div",
    { class: `ui-notice ${tone}`, role: tone === "bad" ? "alert" : "status" },
    icon(iconName ?? { info: "info", ok: "check", warn: "alert", bad: "alert" }[tone] ?? "info"),
    h("div", { class: "ui-notice-text" }, title && h("strong", null, title), text && h("div", null, text), command, foot),
    (action || second) && h("div", { class: "ui-notice-actions" }, second, action),
  );

/**
 * "A program is needed": what it is, why, the exact command and the button — nothing is installed until it is
 * pressed (the rule of Hata). `optional` softens it; `run` absent means it has to be installed by hand.
 */
function uiNeedProgram({ name, why, command, run = null, optional = false, busy = false, why2 = null }) {
  const press = run && button(t(busy ? "ui.installing" : "ui.install"), { class: "primary small", disabled: busy, "aria-busy": busy ? "true" : null, onclick: run });
  return uiNotice({ tone: "info", icon: "package", title: t(optional ? "ui.needOptional" : "ui.needProgram", { name }), text: why, command: command && uiCommand(command), action: press, foot: why2 });
}

/**
 * An empty place: `big` (an icon, a title, a text, one button), `small` (a line, perhaps a quiet button),
 * `loading` (the ring, in a room of three rows) or `error` (big, in the bad tone, with "Try again").
 */
function uiEmpty({ size = "small", icon: iconName = null, title = null, text = null, action = null, tone = null } = {}) {
  if (size === "loading") return h("div", { class: "ui-empty loading", role: "status", "aria-label": t("common.loading") }, h("span", { class: "wait-ring" }), text && h("span", null, text));
  if (size === "small") return h("div", { class: "ui-empty small" + (tone ? " " + tone : "") }, iconName && icon(iconName), h("span", null, text ?? title), action);
  return h("div", { class: "ui-empty big" + (size === "error" ? " bad" : "") }, h("span", { class: "ui-empty-icon" }, icon(iconName ?? (size === "error" ? "alert" : "box"))), title && h("strong", null, title), text && h("p", null, text), action);
}

/** A command, a key, an address to copy: one line (or a `block`), copied whole; a `secret` is dotted until shown */
function uiCommand(text, { block = false, secret = false, label = null } = {}) {
  let shown = !secret;
  const words = h(block ? "pre" : "span", { class: "ui-command-text" }, shown ? text : "••••••••••••");
  const copy = h("button", { type: "button", class: "icon-btn ui-command-copy", "aria-label": t("ui.copy"), title: t("ui.copy") }, icon("copy"));
  copy.onclick = () => {
    copyQuietly(text);
    copy.replaceChildren(icon("check"));
    toast(t("ui.copied"));
    setTimeout(() => copy.replaceChildren(icon("copy")), 2000);
  };
  const eye = secret && h("button", { type: "button", class: "icon-btn ui-command-copy", "aria-label": t("ui.show"), title: t("ui.show") }, icon("eye"));
  if (eye) eye.onclick = () => ((shown = !shown), (words.textContent = shown ? text : "••••••••••••"), eye.setAttribute("aria-label", t(shown ? "ui.hide" : "ui.show")));
  return h("div", { class: "ui-command" + (block ? " block" : ""), "aria-label": label }, words, h("span", { class: "ui-command-tools" }, eye, copy));
}

/**
 * The head of a page: crumbs, the thing's icon, the title with its state, the facts under it (joined by " · "), on
 * the right up to two buttons (`actions`: { label, icon, run | href, primary }) and a "⋯" of `more` (or a `search`),
 * the tabs under all. On a phone the main button stands under the title across; the other one goes into the "⋯".
 */
function pageHead({ crumbs = null, icon: iconName = null, logo = null, title = null, state = null, facts = null, factsId = null, actions = [], actionsId = null, more = null, search = null, tabs = null, id = null, cls = "", menu = undefined } = {}) {
  const trail = crumbs && h("nav", { class: "ui-crumbs", "aria-label": t("ui.crumbs") }, crumbs.map((c, i) => [i > 0 && icon("chevron", "ui-crumb-sep"), c.href && i < crumbs.length - 1 ? h("a", { href: c.href }, c.label) : h("span", { "aria-current": i === crumbs.length - 1 ? "page" : null }, c.label)]));
  const shown = (facts ?? []).filter(Boolean);
  const line = (shown.length > 0 || factsId) && h("div", { class: "ui-head-facts", id: factsId }, shown.flatMap((f, i) => (i ? [h("span", { class: "ui-dot-sep" }, " · "), f] : [f])));
  // an action is a spec ({ label, icon, run | href, primary, danger }) or a node of the page's own (a link, a menu button)
  const all = (actions ?? []).filter(Boolean);
  const nodes = all.filter((a) => a instanceof Node);
  const list = all.filter((a) => !(a instanceof Node)).slice(0, 2);
  const main = list.find((a) => a.primary) ?? list[0];
  const make = (a) => (a.href ? h("a", { class: "btn ui-spec" + (a.primary ? " primary" : "") + (a === main ? " ui-main" : ""), href: a.href, target: a.newTab ? "_blank" : null, rel: a.newTab ? "noopener noreferrer" : null }, a.icon && icon(a.icon), h("span", null, a.label)) : button(a.label, { class: "ui-spec " + (a.primary ? "primary" : a.danger ? "danger-text" : "") + (a === main ? " ui-main" : ""), onclick: a.run }, a.icon));
  const phone = () => matchMedia("(max-width: 640px)").matches;
  const entries = () => [...(phone() ? list.filter((a) => a !== main).map((a) => ({ label: a.label, icon: a.icon ?? "next", run: a.run, href: a.href, danger: a.danger })) : []), ...((typeof more === "function" ? more() : more) ?? [])];
  const hasMore = !!more || list.length > 1;
  const right = (list.length || nodes.length || hasMore || search || actionsId) && h("div", { class: "ui-head-actions" + (more ? "" : " only-phone-more"), id: actionsId }, search, nodes, list.map(make), hasMore && uiMore(entries));
  return h(
    "section",
    { class: "card ui-head" + (cls ? " " + cls : ""), id },
    trail,
    (title != null || line || right) && h("div", { class: "ui-head-main", menu }, (iconName || logo) && h("span", { class: "ui-tile-icon" }, logo ?? icon(iconName)), h("div", { class: "ui-head-names" }, title != null && h("div", { class: "ui-head-title" }, h("h1", null, title), state), line), right),
    tabs,
  );
}

/** The sheet of the blocks (`#/blocks`): every block in its forms, with made-up words, as the drawings have them */
function renderBlocks() {
  const say = (x) => () => toast(x);
  const items = [{ label: "Open", icon: "external", run: say("open") }, { label: "Restart", icon: "refresh", run: say("restart") }, { label: "Remove…", icon: "trash", danger: true, run: say("remove") }];
  const sec = (title, ...body) => uiCard({ title }, ...body);
  shell(
    pageHead({ crumbs: [{ label: "Integrations", href: "#/house" }, { label: "qBittorrent" }], icon: "download", title: "qBittorrent", state: uiState("ok", "Online"), facts: [h("span", { class: "mono" }, "192.168.1.128:8181"), "↓ 2.1 MB/s", "active 3"], actions: [{ label: "Open", icon: "external", href: "#/blocks" }, { label: "Add torrents…", icon: "plus", primary: true, run: say("add") }], more: items }),
    sec(
      "States, tags, counts",
      h("div", { class: "ui-line" }, uiState("ok", "Running"), uiState("warn", "May update"), uiState("bad", "Failed"), uiState("info", "In use"), uiState("off", "Stopped"), uiTag("+2"), uiCount(3)),
    ),
    sec(
      "Buttons",
      h("div", { class: "ui-line" }, button("Save", { class: "primary" }), button("Open"), button("Show 23 more", { class: "quiet" }), button("Delete", { class: "danger" }), button("Disabled", { disabled: true }), uiMore(items), button("Small", { class: "small" }), uiMore(items, { size: "s" })),
    ),
    sec(
      "Switches and segments",
      h("div", { class: "ui-line" }, uiSwitch({ on: true, label: "On" }), uiSwitch({ on: false, label: "Off" }), uiSwitch({ on: true, label: "Disabled", disabled: true }), uiSegment([{ value: "all", label: "All", count: 12 }, { value: "run", label: "Running", count: 9 }, { value: "off", label: "Stopped", count: 3 }], "all", say("seg"))),
      uiSegment([{ value: "a", label: "Container" }, { value: "b", label: "Virtual machine" }], "a", say("seg"), { wide: true }),
    ),
    sec(
      "Meters and steps",
      uiMeter(42, { label: "Capacity 42 %" }),
      uiMeter(86, { label: "Capacity 86 %" }),
      uiMeter(97, { label: "Capacity 97 %" }),
      uiMeter(60, { kind: "progress", label: "Progress" }),
      uiMeter(30, { kind: "load", label: "Load" }),
      uiMeter(0, { parts: [{ value: 40, colour: 1 }, { value: 20, colour: 2 }, { value: 10, colour: 3 }] }),
      uiSteps(2, 5),
    ),
    h("section", { class: "card ui-stats" }, uiStat({ icon: "cpu", label: "Processor", value: "12", unit: "%", meter: uiMeter(12, { kind: "load" }), hint: "2 cores" }), uiStat({ icon: "memory", label: "Memory", value: "3.1", unit: "GB", meter: uiMeter(41, { kind: "load" }), hint: "of 7.6 GB" }), uiStat({ icon: "disk", label: "Disk", value: "81", unit: "%", tone: "warn", meter: uiMeter(81), hint: "5.4 GB free" }), uiStat({ icon: "temp", label: "Temperature", value: "42", unit: "°C" })),
    uiCard(
      { title: "Rows", count: 4, flush: true, actions: button("Add…", { class: "small" }, "plus") },
      uiRow({ lead: { icon: "app" }, name: "Adminer", sub: "adminer:latest · 8080", state: uiState("ok", "Running"), action: button("Open", { class: "small" }), more: items }),
      uiRow({ lead: { icon: "alert", tone: "warn" }, name: "Security updates for this server: 8", sub: "There are security fixes for system packages", action: button("Look", { class: "small primary" }), more: items }),
      uiRow({ lead: { icon: "signin" }, name: "tester: signed in", sub: "192.168.1.196", time: "20:41", mode: "event" }),
      uiRow({ lead: { icon: "folder" }, name: "A whole row is a way somewhere", sub: "with a chevron and nothing else", href: "#/blocks" }),
      uiGroup({ name: "i5 — Proxmox", count: 3, state: uiState("ok", "Online"), more: items }, uiRow({ lead: { icon: "server" }, name: "Gitea", sub: "CT 212 · 192.168.1.212", state: uiState("ok", "Running"), more: items })),
      uiRow({ lead: { icon: "download", tone: "info" }, name: "Installing Immich", sub: "Pulling images · step 2 of 3", meter: uiSteps(1, 3), mode: "task", action: button("Log", { class: "small" }) }),
    ),
    uiCard(
      { title: "Settings" },
      uiSetting({ name: "Install new versions by itself", explain: "Once a day at the time below. A version you went back from is skipped.", control: uiSwitch({ on: true, label: "Install by itself" }) }),
      uiSetting({ name: "Time", explain: "Local time of the server.", control: h("input", { type: "time", class: "short", value: "05:00" }) }),
      uiSetting({ name: "Versions offered", explain: "Betas come before a release.", control: h("select", null, h("option", null, "Stable"), h("option", null, "Beta")) }),
    ),
    uiCard({ title: "Facts" }, ...uiFacts([["Version", h("span", { class: "mono" }, "0.34.0")], ["Address", h("span", { class: "mono" }, "192.168.1.128")], ["State", uiState("ok", "Healthy")]])),
    uiCard({ title: "This server" }, ...uiMeterFacts([{ icon: "cpu", label: "Processor", value: 12, text: "12 %" }, { icon: "memory", label: "Memory", value: 41, text: "3.1 GB" }, { icon: "disk", label: "Disk", value: 81, kind: "capacity", text: "81 %" }, { icon: "temp", label: "Temperature", value: 42, text: "42 °C" }])),
    uiCard(
      { title: "Table", flush: true },
      uiTable(
        [{ label: "Name" }, { label: "Image" }, { label: "Size", num: true }, { label: "" }],
        [
          { group: "This server" },
          { cells: [h("strong", null, "Home Assistant"), h("span", { class: "mono" }, "ghcr.io/home-…:2026.11"), "1.6 GB", uiMore(items, { size: "s" })], sub: "1.6 GB · running", href: "#/blocks" },
          { cells: [h("strong", null, "Adminer"), h("span", { class: "mono" }, "adminer:latest"), "118 MB", uiMore(items, { size: "s" })], sub: "118 MB · running" },
        ],
      ),
    ),
    uiCard(
      { title: "Tiles" },
      h("div", { class: "ui-tiles" }, uiTile({ icon: "download", name: "qBittorrent", sub: "192.168.1.128:8181", state: uiState("ok", "Online"), foot: "↓ 2.1 MB/s · ↑ 340 KB/s", href: "#/blocks" }), uiTile({ icon: "camera", name: "Frigate", sub: "192.168.1.240:8971", state: uiState("bad", "Silent"), warn: "Not answering for 7 min", tone: "bad", href: "#/blocks" }), uiTile({ icon: "disk", name: "Data · 500", sub: "ext4 · /mnt/500", foot: uiMeter(86), tone: null, href: "#/blocks" }), uiAddTile("Connect…", say("add"))),
      h("div", { class: "ui-tiles described" }, uiTile({ icon: "app", name: "Uptime Kuma", sub: "Monitoring", state: uiState("ok", "Installed"), desc: "A self-hosted monitoring tool: watch sites, ports and services and be told when they go down.", href: "#/blocks" }), uiTile({ icon: "modules", name: "Network folders", sub: "Sharing", tail: uiSwitch({ on: true, label: "Network folders" }), desc: "Folders of this server for Windows, macOS and phones over SMB, with the users of Hata." })),
      h("div", { class: "ui-tiles small" }, uiTile({ kind: "small", icon: "globe", name: "UAKino", sub: "uakino.best", more: items }), uiTile({ kind: "small", icon: "globe", name: "YouTube", sub: "youtube.com", more: items, selected: true })),
      h("div", { class: "ui-tiles" }, uiTile({ kind: "media", icon: "camera", name: "outdoor", sub: "5.1 fps", href: "#/blocks" })),
    ),
    uiCard(
      { title: "Notices" },
      uiNotice({ tone: "info", title: "Kept until you change it", text: "What is said here is a state that lasts." }),
      uiNotice({ tone: "warn", title: "Little room left", text: "The disk is 86 % full.", action: button("Look", { class: "small" }) }),
      uiNotice({ tone: "bad", title: "Could not reach the server", text: "connect ECONNREFUSED 192.168.1.240:8971" }),
      uiNeedProgram({ name: "smartmontools", why: "Reads the health of the disks (SMART) and runs their self-tests.", command: "apt-get install -y smartmontools", run: say("install") }),
    ),
    uiCard({ title: "Empty places" }, uiEmpty({ size: "big", icon: "download", title: "Nothing connected yet", text: "Connect a service and its state will be here.", action: button("Connect…", { class: "primary" }) }), uiEmpty({ text: "The queue is empty" }), uiEmpty({ icon: "check", tone: "ok", text: "All good" }), uiEmpty({ text: "46 more", action: button("Show", { class: "small quiet" }) }), uiEmpty({ size: "loading", text: "Loading" }), uiEmpty({ size: "error", title: "Could not load", text: "The server did not answer.", action: button("Try again") })),
    uiCard({ title: "Commands" }, uiCommand("curl -fsSL http://192.168.1.128/client/abc123 | sudo sh"), uiCommand("hata_9f2c4e1b7a0d", { secret: true }), uiCommand("[Interface]\nPrivateKey = …\nAddress = 10.77.0.2/32\n\n[Peer]\nPublicKey = …\nEndpoint = example.org:51820\nAllowedIPs = 10.77.0.1/32", { block: true })),
  );
}

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
  if (parts[0] === "apps" && !parts[1] && state.user?.role !== "guest") return { view: "apps" };
  if (parts[0] === "apps-options" && isAdmin()) return areaRoute("apps", "options");
  // "#/files" is the data root, wherever it is; "#/files/" is the root of the server
  // "#/files/@<machine>/<folders>" is a folder of another machine
  if (parts[0] === "files" && mayFiles() && parts[1]?.startsWith("@")) return { view: "files", machine: parts[1].slice(1), path: "/" + parts.slice(2).join("/") };
  if (parts[0] === "files" && mayFiles()) return { view: "files", machine: "", path: /^#\/?files$/.test(location.hash) ? "" : "/" + parts.slice(1).join("/") };
  if (parts[0] === "trash" && mayFiles()) return { view: "trash" };
  if (parts[0] === "links" && mayLink()) return { view: "links" };
  if (parts[0] === "hata" && mayFiles()) return { view: "myhata" };
  if (parts[0] === "activity" && isAdmin()) return { view: "activity" };
  // the sheet of the design system's blocks, every one in every form: to compare with the drawings
  if (parts[0] === "blocks" && isAdmin()) return { view: "blocks" };
  if (parts[0] === "tv" && isAdmin()) return { view: "tv", hash: "#/house/tv" };
  // Bluetooth lived among this server's tabs at first
  if (parts[0] === "machines" && parts[1] === "this" && parts[2] === "bluetooth" && isAdmin()) return areaRoute("house", "bluetooth");
  // Hata the house: Home Assistant, every kind of connected service, the TV — each a tab
  if ((parts[0] === "house" || parts[0] === "integrations" || (parts[0] === "ha" && !parts[1]) || (parts[0] === "settings" && parts[1] === "integrations")) && isAdmin()) {
    const was = { cameras: "x-frigate", torrents: "x-qbittorrent" }[parts[1]] ?? parts[1];
    // a service's tab is known once the overview is: until then the address says which
    if (parts[0] === "house" && /^x-[a-z0-9-]+$/.test(was ?? "") && !areaTabs("house").some((x) => x.id === was)) return { view: "service", kind: was.slice(2), id: parts[2] ?? "", house: true, hash: `#/house/${was}${parts[2] ? "/" + parts[2] : ""}` };
    const tab = (parts[0] === "house" && areaTabs("house").find((x) => x.id === was)) || areaTabs("house")[0];
    if (!tab) return { view: "ha", id: "", hash: "#/house" };
    const id = parts[0] === "house" ? (parts[2] ?? "") : "";
    if (tab.view === "music") return { view: "music", hash: "#/house/music" };
    if (tab.sections) return areaRoute("house", tab.id);
    if (tab.view === "service") return { view: "service", kind: tab.kind, id, house: true, hash: tab.hash + (id ? "/" + id : "") };
    return tab.view === "tv" ? { view: "tv", hash: "#/house/tv" } : { view: tab.view, id, house: true, hash: tab.hash + (id ? "/" + id : "") };
  }
  // both live in Settings; their own old addresses still lead there
  if ((parts[0] === "backups" || (parts[0] === "settings" && parts[1] === "backups")) && isAdmin()) return areaRoute("backups", parts[0] === "backups" ? parts[1] : parts[2]);
  if ((parts[0] === "users" || (parts[0] === "settings" && parts[1] === "users")) && isAdmin()) return areaRoute("settings", "users", parts[0] === "users" ? parts[1] : parts[2]);
  if (parts[0] === "import" && isAdmin()) return { view: "import" };
  if (parts[0] === "terminal" && isAdmin()) return { view: "terminal" };
  // the assistant is a window over any page, not a page: its old address opens it over Home
  if (parts[0] === "assistant" && isAdmin()) return { view: "home", hash: "#/", assistant: true };
  if (parts[0] === "ha" && parts[1] && isAdmin()) return { view: "ha", id: parts[1], hash: `#/house/ha/${parts[1]}` };
  // a connected service's page; qBittorrent and Frigate had pages of their own before descriptions
  if ((parts[0] === "service" || parts[0] === "qbit" || parts[0] === "frigate") && parts[1] && isAdmin()) return { view: "service", id: parts[1], hash: `#/service/${parts[1]}` };
  if ((parts[0] === "storage" || parts[0] === "network") && isAdmin()) return areaRoute(parts[0], parts[1], parts[2]);
  if (parts[0] === "machines" && parts[1] === "this" && isAdmin()) return areaRoute("server", parts[2], parts[3]);
  if (parts[0] === "machines" && parts[1] === "load" && isAdmin()) return { view: "load", place: parts[2] ? decodeURIComponent(parts[2]) : "" };
  // a container, a virtual machine or a guest keeps its address when Hata's client is put on it: the client only adds tabs
  if (parts[0] === "guest" && parts[3] && isAdmin()) {
    const base = `#/guest/${parts[1]}/${parts[2]}/${parts[3]}`;
    const m = machinesUi.list?.machines.find((y) => y.pve?.host === parts[1] && y.pve?.id === `${parts[2]}/${parts[3]}`);
    return m ? { view: "machine", id: m.id, tab: machineTab(parts[4]), base } : { view: "guest", host: parts[1], guest: `${parts[2]}/${parts[3]}`, tab: parts[4] };
  }
  if (parts[0] === "containers" && parts[1] === "i" && parts[2] && isAdmin()) {
    const base = `#/containers/i/${parts[2]}`;
    const id = incusUi.data?.containers?.find((c) => c.name === parts[2])?.machine;
    return id && machinesUi.list?.machines.some((y) => y.id === id) ? { view: "machine", id, tab: machineTab(parts[3]), base } : { view: "instance", name: parts[2], tab: parts[3] === "terminal" ? "terminal" : "overview", asked: parts[3] };
  }
  if (parts[0] === "containers" && isAdmin()) return areaRoute("server", "containers", parts[1]);
  if (parts[0] === "proxmox" && parts[1] && isAdmin()) return { view: "proxmox", id: parts[1], tab: PVE_TABS.includes(parts[2]) ? parts[2] : "overview" };
  if (parts[0] === "machines" && isAdmin()) return parts[1] ? { view: "machine", id: parts[1], tab: machineTab(parts[2]) } : { view: "machines" };
  // an app of another computer: its own page, like any app's
  if (parts[0] === "apps" && parts[1]?.includes("@") && isAdmin()) return { view: "mapp", name: parts[1].split("@")[0], machine: parts[1].split("@")[1] };
  if (parts[0] === "apps" && parts[1]) return { view: "app", name: parts[1], tab: isAdmin() && ["settings", "logs", "compose", "backups", "terminal"].includes(parts[2]) ? parts[2] : "overview" };
  if (parts[0] === "settings") {
    // a section that moved out of Settings is found where it lives now: its old address still leads to it
    const moved = Object.keys(AREAS).find((area) => area !== "settings" && AREAS[area].some((tab) => tab.sections?.includes(parts[1]) && tabAllowed(tab)));
    if (moved && !AREAS.settings.some((tab) => tab.id === parts[1])) {
      const tabs = AREAS[moved].filter((tab) => tab.sections?.includes(parts[1]));
      return areaRoute(moved, (tabs.find((tab) => tab.tab === parts[2]) ?? tabs[0]).id, parts[2]);
    }
    return areaRoute("settings", parts[1] === "agents" ? "assistant" : parts[1], parts[2]);
  }
  return { view: "home" };
}

/** The sections of the page and the tabs in the head of each. A tab shows sections of the settings (the first names it for the
 * rest of the page) or is a view of its own; `tab` is the part of a long section it opens */
const AREAS = {
  apps: [
    { id: "installed", hash: "#/apps", view: "apps" },
    { id: "store", hash: "#/store", view: "store" },
    { id: "import", hash: "#/import", view: "import", admin: true },
    { id: "options", hash: "#/apps-options", sections: ["apps", "stores"] },
  ],
  storage: [
    { id: "disks", sections: ["storage"], tab: "disks" },
    { id: "fs", sections: ["storage"], tab: "fs" },
    { id: "fills", sections: ["storage"], tab: "fills" },
    { id: "raid", sections: ["protection"] },
    { id: "shares", sections: ["shares"] },
    { id: "places", sections: ["places"] },
  ],
  backups: [
    { id: "overview", hash: "#/backups", view: "backups", admin: true },
    { id: "history", view: "backups", admin: true },
    { id: "schedule", view: "backups", admin: true },
    { id: "offsite", view: "backups", admin: true, module: "offsite" },
  ],
  house: [
    { id: "overview", hash: "#/house", view: "house" },
    { id: "ha", hash: "#/house/ha", view: "ha", module: "integrations" },
    { id: "tv", hash: "#/house/tv", view: "tv", module: "tv" },
    { id: "music", hash: "#/house/music", view: "music", module: "music" },
    { id: "bluetooth", sections: ["bluetooth"] },
  ],
  network: [
    { id: "connections", sections: ["network"] },
    { id: "remote", sections: ["remote"] },
    { id: "addresses", sections: ["https", "ports"] },
    { id: "dns", sections: ["dns"] },
    { id: "adblock", sections: ["adblock"] },
  ],
  server: [
    { id: "overview", hash: "#/machines/this", view: "server" },
    { id: "apps", view: "server" },
    { id: "docker", sections: ["docker"] },
    { id: "containers", view: "containers", module: "containers" },
    { id: "system", sections: ["tools"] },
    { id: "load", hash: "#/machines/load/here", link: true },
  ],
  settings: [
    { id: "account", sections: ["account"] },
    { id: "users", hash: "#/settings/users", view: "users", admin: true },
    { id: "general", sections: ["general"] },
    { id: "schedule", sections: ["schedule"] },
    { id: "appearance", sections: ["appearance"] },
    { id: "notifications", sections: ["notifications"] },
    { id: "modules", sections: ["modules"] },
    { id: "assistant", sections: ["assistant", "agents"] },
    { id: "about", sections: ["about"] },
  ],
};
const AREA_BASE = { house: "#/house", backups: "#/backups", storage: "#/storage", network: "#/network", server: "#/machines/this", settings: "#/settings" };
const tabHash = (area, tab) => tab.hash ?? `${AREA_BASE[area]}/${tab.id}`;
/** Whether this person may open the tab at all, and whether it stands among the tabs: one of a module that is off does not */
const tabAllowed = (tab) => (tab.sections ? SECTIONS.some((item) => item.id === tab.sections[0] && (!item.admin || isAdmin())) : (!tab.admin || isAdmin()) && state.user?.role !== "guest");
const tabShown = (tab) => tabAllowed(tab) && (!tab.module || hasModule(tab.module)) && (!tab.when || tab.when()) && (!tab.sections || tab.sections.some((id) => !SECTION_MODULE[id] || hasModule(SECTION_MODULE[id])));
const areaTabs = (area) => {
  const tabs = AREAS[area].filter(tabShown);
  // a connected service's kind is a tab of Services, after Home Assistant
  if (area === "house" && hasModule("integrations") && isAdmin()) tabs.splice(tabs.findIndex((x) => x.id === "ha") + 1, 0, ...serviceTabs());
  return tabs;
};
/** The tab of a section of the settings, wherever it lives now */
const sectionArea = (section) => Object.keys(AREAS).find((area) => AREAS[area].some((x) => x.sections?.includes(section))) ?? "settings";
function sectionHash(section) {
  for (const area of Object.keys(AREAS)) {
    const tab = AREAS[area].find((x) => x.sections?.includes(section));
    if (tab) return tabHash(area, tab);
  }
  return "#/settings";
}

function areaRoute(area, id, rest) {
  if (area === "storage" && id === "protection") id = "raid"; // the tab was called Protection until 0.32
  const tab = AREAS[area].find((x) => x.id === id && !x.link && (x.sections ? tabAllowed(x) : tabShown(x))) ?? areaTabs(area)[0];
  if (!tab) return { view: "home" };
  // the containers of this server keep their own two parts: the list and what they stand on
  if (tab.view === "containers") return { view: "containers", tab: rest === "settings" ? "settings" : "list", hash: tabHash(area, tab) + (rest === "settings" ? "/settings" : "") };
  // people and what they may open: four parts under one head
  if (tab.view === "users") return ((part) => ({ view: "users", tab: tab.id, part, hash: tabHash(area, tab) + (part === "people" ? "" : "/" + part) }))(USER_PARTS.includes(rest) ? rest : "people");
  if (tab.view) return { view: tab.view, tab: tab.id, hash: tabHash(area, tab) };
  return { view: "settings", area, at: tab.id, section: tab.sections[0], sections: tab.sections, tab: tab.tab ?? rest, hash: tabHash(area, tab) + (!tab.tab && rest ? "/" + rest : "") };
}
/** Whether the page shows this section of the settings: a tab may hold two */
const showsSection = (id) => state.route.view === "settings" && state.route.sections.includes(id);
/** The section of the page a view belongs to: what the menu marks */
function areaOf(route = state.route) {
  const view = route.view;
  if (view === "settings") return route.area === "server" ? "machines" : route.area;
  if (["apps", "store", "import", "app", "mapp"].includes(view)) return "apps";
  if (["files", "trash", "myhata", "links"].includes(view)) return "files";
  if (["machines", "machine", "server", "proxmox", "containers", "instance", "guest", "terminal", "load"].includes(view)) return "machines";
  if (view === "service") return route.house || !serviceApp(route.id) ? "house" : "apps";
  if (["house", "integrations", "ha", "tv", "music"].includes(view)) return "house";
  if (view === "backups") return "backups";
  if (view === "users") return "settings";
  return view === "home" || view === "activity" ? "home" : "";
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
  // an older address of a section: the bar shows where it lives now
  if (state.route.hash && state.user && location.hash !== state.route.hash) history.replaceState(history.state, "", state.route.hash);
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
  if (state.route.view === "links") void loadLinksPage();
  if (state.route.view === "myhata") void loadMyHata();
  if (state.route.view === "backups") void loadBackups();
  if (state.route.view === "users") void loadUsers();
  if (state.route.view === "import") void loadImport();
  if (state.route.view === "welcome") void loadWelcome();
  if (state.route.view === "tv") void loadTv();
  if (state.route.view === "music") void loadMusic();
  if (state.route.view === "app") void loadApp();
  if (["machines", "machine", "proxmox", "guest", "instance", "containers"].includes(state.route.view)) void loadMachines();
  if (state.route.view === "machines") void loadPve();
  if (["machines", "containers", "machine", "instance", "server"].includes(state.route.view) || state.route.area === "server") void loadContainers();
  if (state.route.view === "guest") void loadContainers();
  if (["server", "containers"].includes(state.route.view) || state.route.area === "server") void loadTree();
  if (state.route.view !== "settings") settingsUi.find = "";
  if (state.route.assistant && hasModule("assistant")) openAssistant();
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
      takeJob(event.job, event.line);
    } else if (event.type === "disks") {
      // a disk was plugged in, pulled out, connected: the pages that list disks look again
      clearTimeout(disksEventTimer);
      disksEventTimer = setTimeout(async () => {
        if (onStorageSection()) setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        else if (state.route.view === "files") void loadFiles?.();
        else if (state.route.view === "myhata") void loadMyHata();
      }, 1200);
    } else if (event.type === "tv") {
      if ("playing" in event) {
        state.tvNow = { on: !!event.on, screen: !!event.screen, streams: !!event.streams, playing: event.playing };
        paintTvNow();
      }
      if (state.route.view === "tv") void loadTv();
    } else if (event.type === "modules") {
      void loadModules().then(render);
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
    } else if (event.type === "containers") {
      if (state.route.view === "machines" || state.route.view === "containers") void loadContainers();
    } else if (event.type === "ha") {
      haEvent(event);
    } else if (event.type === "approvals") {
      void loadApprovals();
    } else if (event.type === "tailscale") {
      if (state.route.view === "settings" && showsSection("remote")) void loadRemote();
    } else if (event.type === "music") {
      state.musicNow = event.playing ?? null;
      paintMusicNow();
      if (state.route.view === "music") void loadMusic();
    } else if (event.type === "bluetooth") {
      if (state.route.view === "settings" && showsSection("bluetooth")) void loadBluetooth();
    } else if (event.type === "sysupdates") {
      sysUpdatesEvent(event.at ?? "");
    } else if (event.type === "network") {
      if (state.route.view === "settings" && showsSection("network")) void loadNetwork();
    } else if (event.type === "store" && state.route.view === "store") {
      void loadStore();
    }
  };
  // after a reconnect anything may have changed while we were away
  source.onerror = () => {
    jobsUi.lost = true;
    paintJobs();
  };
  source.onopen = () => {
    jobsUi.lost = false;
    paintJobs();
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
  state.tvNow = state.overview.tv ?? null;
  state.musicNow = state.overview.music ?? null;
  paintMusicNow();
  paintTvNow();
  seedJobs(state.overview.jobs ?? []);
  failedTiles(state.overview);
  // the numbers by the sections follow what needs attention now, and so does the section's own list
  document.querySelector(".top .nav")?.replaceChildren(...navLinks("nav-link"));
  paintAttentionHere();
  if (state.route.view === "home") renderHomeBody();
  if (state.route.view === "store") renderStoreList();
  if (state.route.view === "apps") renderAppsBody();
  if (state.route.view === "server") state.route.tab === "apps" ? renderAppsBody() : renderServerBody();
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

/** Something is being asked for: a turning mark, in a card of its own where it stands outside one — never a bare "…" */
function waitMark() {
  return h("p", { class: "waiting", role: "status", "aria-label": t("common.loading") }, h("span", { class: "wait-ring" }));
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
  // the options of a group follow its name
  const shown = items.flatMap((b, i) => {
    const group = select.options[i].parentElement;
    return group?.tagName === "OPTGROUP" && group.firstElementChild === select.options[i] ? [h("div", { class: "select-group muted small", role: "presentation" }, group.label), b] : [b];
  });
  dialog = openDialog("menu dropdown select-list", h("div", { role: "listbox", "aria-label": select.getAttribute("aria-label") ?? "" }, shown));
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
  { view: "apps", hash: "#/apps", icon: "grid", guest: false },
  { view: "files", hash: "#/files", icon: "folder", files: true },
  { view: "machines", hash: "#/machines", icon: "server", admin: true },
  { view: "house", hash: "#/house", icon: "bulb", admin: true, modules: ["integrations", "tv", "music", "bluetooth"] },
  { view: "storage", hash: "#/storage", icon: "disk", admin: true },
  { view: "backups", hash: "#/backups", icon: "archive", admin: true },
  { view: "network", hash: "#/network", icon: "network", admin: true },
];

/** Members look at the apps; everything that changes the server is an administrator's */
// an administrator the rules ask for two-factor sign-in is a member until it is on — the server says so too
const isAdmin = () => state.user?.role === "admin" && !state.user.mustTwoFactor;
/** Links for somebody without an account: anybody with an account of their own (a guest's is shared) */
const mayLink = () => !!state.user && state.user.role !== "guest";
/** Whether a module is on: the page shows only the parts of those that are (`#/settings/modules`) */
const hasModule = (id) => !state.modules || state.modules[id] === true;
/** The sections of Settings and the pages that are a module's */
const SECTION_MODULE = { bluetooth: "bluetooth", protection: "raid", places: "netplaces", shares: "shares", remote: "remote", ports: "domains", dns: "dns", adblock: "adblock", integrations: "integrations", agents: "assistant", assistant: "assistant" };
const VIEW_MODULES = { mapp: ["machines"], machine: ["machines"], proxmox: ["proxmox"], guest: ["proxmox"], containers: ["containers"], instance: ["containers"], integrations: ["integrations"], ha: ["integrations"], service: ["integrations"], assistant: ["assistant"], connect: ["assistant"], tv: ["tv"], music: ["music"] };
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

const navCurrent = () => areaOf();
const navItems = () => NAV.filter((item) => (!item.admin || isAdmin()) && (!item.modules || item.modules.some(hasModule)) && (!item.files || mayFiles()) && (item.guest !== false || state.user.role !== "guest"));

/** Which section of the page an item of "Needs attention" is about, by its code */
const ATTENTION_AREAS = [
  [/^(machine|pve|containers|docker|memory|temperature|load|system)\b/, "machines"],
  [/^(ha|integration)\b/, "house"],
  [/^(disk|smart|absent|array|raid|share|netplace)\b/, "storage"],
  [/^(offsite|failed\.backup|backup)\b/, "backups"],
  [/^(network|internet|dns|https)\b/, "network"],
];
const attentionArea = (item) => ATTENTION_AREAS.find(([re]) => re.test(item.code))?.[1] ?? (item.app || /^(restarting|partial|update|failed)\b/.test(item.code) ? "apps" : "");
/**
 * What the number by a section's name counts, said in the section itself: a card under its head with the very
 * items of Home's list. Kept up from outside the pages (they redraw themselves in many ways): put in when it is
 * missing, built anew only when the items differ, so a button under the pointer stays.
 */
const attentionHere = { sig: "" };
function paintAttentionHere() {
  const view = document.getElementById("view");
  if (!view || !state.user) return;
  const area = navCurrent();
  const head = view.querySelector(".area-head");
  // the top pages of a section: those with its head, and the lists of Computers and Apps
  const top = head || ["machines", "apps"].includes(state.route.view);
  const list = isAdmin() && area && area !== "home" && top ? (state.overview?.attention ?? []).filter((item) => attentionArea(item) === area) : [];
  const was = document.getElementById("area-attention");
  if (!list.length) return void was?.remove();
  const sig = area + JSON.stringify(list.map((item) => [item.id, item.code, item.severity, item.at, item.detail]));
  if (was && was.isConnected && sig === attentionHere.sig) return;
  attentionHere.sig = sig;
  const card = uiCard({ title: t("attention.title"), marks: uiCount(list.length), flush: true, id: "area-attention", cls: "area-attention" }, h("div", { class: "ui-rows attention-list" }, list.map((item) => attentionItem(item))));
  if (was) return void was.replaceWith(card);
  if (head) head.after(card);
  else view.prepend(card);
}
setInterval(paintAttentionHere, 1500);

/** How many things need attention in a section: the number by its name in the menu */
function navCount(view) {
  if (!isAdmin() || view === "home") return 0;
  return (state.overview?.attention ?? []).filter((item) => attentionArea(item) === view).length;
}

function navLinks(className, items = navItems()) {
  const current = navCurrent();
  return items.map((item) => {
    const n = navCount(item.view);
    return h("a", { class: className + (current === item.view ? " active" : ""), href: item.hash, title: t("nav." + item.view), "aria-current": current === item.view ? "page" : null }, icon(item.icon), h("span", null, t("nav." + item.view)), n > 0 && h("b", { class: "nav-count", title: t("nav.needs", { n }) }, String(n)));
  });
}

/** The bar at the bottom of a phone: the first four sections and "Menu" with everything */
function bottomLinks() {
  const items = navItems();
  const here = !items.slice(0, 4).some((item) => item.view === navCurrent()) && navCurrent() !== "";
  const more = h("button", { type: "button", class: "bottom-link" + (here ? " active" : ""), "aria-haspopup": "dialog", onclick: () => navSheet() }, icon("menu"), h("span", null, t("nav.menu")));
  return [...navLinks("bottom-link", items.slice(0, 4)), more];
}

/** "Menu" of a phone: the search, every section, the terminal, Settings and the person */
function navSheet(search = false) {
  let dialog;
  const current = navCurrent();
  const tile = (hash, iconName, label, active, n = 0) => h("a", { class: "sheet-tile" + (active ? " active" : ""), href: hash, onclick: () => dialog.close() }, icon(iconName), h("span", null, label), n > 0 && h("b", { class: "nav-count" }, String(n)));
  const field = globalSearch(() => dialog.close());
  dialog = openDialog(
    "nav-sheet",
    h("div", { class: "sheet-bar" }),
    field,
    h(
      "div",
      { class: "sheet-tiles" },
      navItems().map((item) => tile(item.hash, item.icon, t("nav." + item.view), current === item.view, navCount(item.view))),
      isAdmin() && tile("#/terminal", "terminal", t("terminal.title"), state.route.view === "terminal"),
      tile("#/settings", "gear", t("nav.settings"), current === "settings"),
    ),
    h("button", { type: "button", class: "sheet-user", onclick: (e) => userMenu(e, true) }, avatarOf(state.user), h("span", { class: "grow" }, h("strong", null, state.user.name), h("span", { class: "muted small block" }, t("user.role." + state.user.role))), icon("chevron")),
  );
  pullToClose(dialog);
  if (search) field.querySelector("input").focus();
  else dialog.focus();
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

/** A person's circle: their picture when they put one, else the first letter of their name */
function avatarOf(user, cls = "avatar") {
  const letter = (user?.name ?? "?").slice(0, 1).toUpperCase();
  if (!user?.avatar) return h("span", { class: cls }, letter);
  const img = h("img", { src: `/api/avatars/${user.id}?v=${user.avatar}`, alt: "", draggable: "false" });
  // a picture that cannot be had (removed meanwhile) falls back to the letter
  img.onerror = () => img.replaceWith(letter);
  return h("span", { class: cls + " has-picture" }, img);
}

function userMenu(e, above = false) {
  let dialog;
  const anchor = e.currentTarget.getBoundingClientRect();
  dialog = openDialog(
    "menu dropdown",
    h("header", null, avatarOf(state.user), h("div", null, h("h2", null, state.user.name), h("span", { class: "muted small" }, t("user.role." + state.user.role)))),
    h("a", { class: "menu-item", href: "#/settings/account", onclick: () => (dialog.close(), document.querySelector("dialog.nav-sheet")?.close()) }, icon("user"), t("settings.account")),
    isAdmin() && h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), serverPowerDialog("reboot")) }, icon("refresh"), t("power.reboot")),
    isAdmin() && h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), serverPowerDialog("poweroff")) }, icon("stop"), t("power.poweroff")),
    h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), signOut()) }, icon("signout"), t("nav.signOut")),
  );
  // it hangs under the button it was opened from, by its right edge; over it at the bottom of a phone's menu
  if (above) dialog.style.bottom = document.documentElement.clientHeight - anchor.top + 8 + "px";
  dialog.style.top = above ? "auto" : anchor.bottom + 8 + "px";
  dialog.style.right = Math.max(8, document.documentElement.clientWidth - anchor.right) + "px";
}

/** The search field of the header: installed apps first, then the store; for an administrator the data folder's files too */
function globalSearch(after = () => {}) {
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
    after();
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
      h("a", { class: "brand", href: "#/" }, logo(), h("span", null, "hata")),
      h("strong", { class: "top-title" }, areaOf() ? t("nav." + areaOf()) : state.route.view === "terminal" ? t("terminal.title") : "hata"),
      h("nav", { class: "nav" }, navLinks("nav-link")),
      h(
        "div",
        { class: "top-right" },
        globalSearch(),
        h("button", { type: "button", class: "top-btn top-find", title: t("search.placeholder"), "aria-label": t("search.placeholder"), onclick: () => navSheet(true) }, icon("search")),
        isAdmin() && h("a", { class: "top-btn top-term" + (state.route.view === "terminal" ? " active" : ""), href: "#/terminal", title: t("terminal.title"), "aria-label": t("terminal.title") }, icon("terminal")),
        h("span", { id: "music-now", class: "tv-now", hidden: true }),
        h("span", { id: "tv-now", class: "tv-now", hidden: true }),
        h("a", { class: "top-btn top-gear" + (areaOf() === "settings" ? " active" : ""), href: "#/settings", title: t("nav.settings"), "aria-label": t("nav.settings") }, icon("gear")),
        h("button", { type: "button", class: "top-btn top-user" + (state.user.avatar ? " has-picture" : ""), title: state.user.name, "aria-label": state.user.name, "aria-haspopup": "menu", onclick: userMenu }, state.user.avatar ? avatarOf(state.user, "top-picture") : state.user.name.slice(0, 1).toUpperCase()),
      ),
    ),
    h("main", { id: "view" }, state.user.mustTwoFactor && h("p", { class: "banner" }, t("twofa.mustLead"), " ", h("a", { class: "link", href: "#/settings/account" }, t("twofa.mustGo"))), content),
    h("nav", { class: "bottom-bar" }, bottomLinks()),
  );
  paintMusicNow();
  paintTvNow();
  queueMicrotask(paintAttentionHere);
}

function render() {
  if (state.setup || !state.user) return authScreen();
  const view = state.route.view;
  // a page of a module that is off: it says so and offers to turn it on
  if (VIEW_MODULES[view] && !VIEW_MODULES[view].some(hasModule)) return shell(h("div", { class: "stack" }, VIEW_MODULES[view].map(moduleOffCard)));
  if (view === "connect") return renderConnect();
  if (view === "welcome") return renderWelcome();
  if (view === "store") return renderStore();
  if (view === "apps") return renderApps();
  if (view === "server") return renderServer();
  if (view === "mapp") return renderMachineApp();
  if (view === "settings") return renderSettings();
  if (view === "files") return renderFiles();
  if (view === "trash") return renderTrash();
  if (view === "links") return renderLinks();
  if (view === "myhata") return renderMyHata();
  if (view === "activity") return renderActivity();
  if (view === "blocks") return renderBlocks();
  if (view === "backups") return renderBackups();
  if (view === "users") return renderUsers();
  if (view === "import") return renderImport();
  if (view === "terminal") return renderTerminal();
  if (view === "tv") return renderTv();
  if (view === "music") return renderMusic();
  if (view === "machines") return renderMachines();
  if (view === "load") return renderLoad();
  if (view === "machine") return renderMachine();
  if (view === "proxmox") return renderPve();
  if (view === "containers") return renderContainers();
  if (view === "ha") return renderHa();
  if (view === "house") return renderHouse();
  if (view === "service") return renderService();
  if (view === "instance") return renderInstance();
  if (view === "guest") return renderGuest();
  if (view === "app") return renderApp();
  renderHome();
}
