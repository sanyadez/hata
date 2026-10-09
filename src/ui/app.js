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
  // a click on the backdrop (the dialog element itself, outside its content box) closes it
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

const button = (label, attrs = {}, iconName) => h("button", { type: "button", ...attrs, class: "btn " + (attrs.class ?? "") }, iconName && icon(iconName), label && h("span", null, label));
const closeButton = (dialog, label = t("common.close")) => button(label, { onclick: () => dialog().close() });
const closeX = (dialog) => h("button", { type: "button", class: "icon-btn", "aria-label": t("common.close"), onclick: () => dialog().close() }, icon("x"));

// --- State --------------------------------------------------------------------------------------

const state = {
  version: "",
  setup: false,
  user: null,
  lang: "en",
  languages: ["en"],
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
  import: null,
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
// The address after `#` is the view: #/ · #/store · #/import · #/apps/<name>/<tab> · #/settings/<section>

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "store" && state.user?.role !== "guest") return { view: "store" };
  if (parts[0] === "backups" && isAdmin()) return { view: "backups" };
  if (parts[0] === "users" && isAdmin()) return { view: "users" };
  if (parts[0] === "import" && isAdmin()) return { view: "import" };
  if (parts[0] === "apps" && parts[1]) return { view: "app", name: parts[1], tab: isAdmin() && ["logs", "compose", "backups"].includes(parts[2]) ? parts[2] : "overview" };
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
  );
  $app.replaceChildren(h("main", { class: "center" }, form));
  (setup && !tokenFromLink ? token : name).focus();
}

// --- Shell --------------------------------------------------------------------------------------

const NAV = [
  { view: "home", hash: "#/", icon: "home" },
  { view: "store", hash: "#/store", icon: "grid", guest: false },
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

function userMenu() {
  let dialog;
  dialog = openDialog(
    "menu",
    h("header", null, h("span", { class: "avatar" }, state.user.name.slice(0, 1).toUpperCase()), h("div", null, h("h2", null, state.user.name), h("span", { class: "muted small" }, t("user.role." + state.user.role)))),
    h("a", { class: "menu-item", href: "#/settings/account", onclick: () => dialog.close() }, icon("user"), t("settings.account")),
    h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), signOut()) }, icon("signout"), t("nav.signOut")),
  );
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
      h("div", { class: "top-right" }, globalSearch(), h("button", { type: "button", class: "user", onclick: userMenu }, h("span", { class: "avatar" }, state.user.name.slice(0, 1).toUpperCase()), h("span", { class: "user-name" }, state.user.name))),
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
  if (view === "backups") return renderBackups();
  if (view === "users") return renderUsers();
  if (view === "import") return renderImport();
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

function appTile(app) {
  const url = isUp(app) ? appUrl(app) : null;
  const st = appState(app);
  const sub = st === "running" && appAddress(app) ? appAddress(app) : t("status." + st);
  return h(
    "div",
    { class: "tile " + st },
    h("a", { class: "tile-main", href: `#/apps/${app.name}` }, appIcon(app), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, app.title), h("span", { class: "tile-sub" }, h("i", { class: "dot " + st }), sub, app.protected && h("span", { class: "lock", title: t("access.protected") }, icon("lock"))))),
    url && h("a", { class: "tile-open", href: url, target: "_blank", rel: "noopener noreferrer", title: t("app.open"), "aria-label": `${t("app.open")}: ${app.title}` }, icon("external")),
  );
}

const ATTENTION_ICONS = { docker: "box", restarting: "refresh", partial: "alert", disk: "disk", memory: "memory", temperature: "temp" };

function attentionItem(item) {
  const detail = { ...item.detail, free: item.detail.free == null ? "" : bytes(item.detail.free) };
  const base = "attention." + item.code;
  return h(
    "div",
    { class: "attention-item" },
    h("span", { class: "badge-icon " + item.severity }, icon(ATTENTION_ICONS[item.code] ?? "alert")),
    h("div", { class: "grow" }, h("strong", null, t(base + ".title", detail)), h("p", { class: "muted small" }, t(base + ".text", detail).trim())),
    item.app && h("a", { class: "btn small", href: `#/apps/${item.app}${item.code === "restarting" || item.code === "partial" ? "/logs" : ""}` }, t(item.code === "restarting" || item.code === "partial" ? "app.logs" : "common.open")),
  );
}

const ACTIVITY_ICONS = { install: "download", update: "up", start: "play", stop: "stop", restart: "refresh", remove: "trash", apply: "code", backup: "archive", restore: "undo", import: "download" };

function activityItem(entry) {
  const [group, kind, outcome] = entry.code.split(".");
  const failed = outcome === "failed";
  const key = "activity." + entry.code;
  const title = state.overview?.apps.find((a) => a.name === entry.app)?.title ?? entry.app ?? "";
  const meta = [ago(entry.ts), entry.user && group !== "auth" ? (entry.user === "schedule" ? t("activity.bySchedule") : t("activity.by", { user: entry.user })) : null, group === "auth" ? entry.detail : null].filter(Boolean).join(" · ");
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
  shell(
    h("div", { class: "page-head" }, h("div", null, h("h1", null, greeting), h("p", { class: "meta", id: "host" }, " ")), h("div", { class: "counts", id: "counts" })),
    h("section", { class: "stats card" }, statCell("cpu", "cpu", t("sys.cpu")), statCell("memory", "memory", t("sys.memory")), statCell("disk", "disk", t("sys.disk")), statCell("network", "network", t("sys.network")), h("div", { class: "stat", id: "stat-temp", hidden: true }, h("div", { class: "stat-label" }, icon("temp"), t("sys.temperature")), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, "—"), h("span", { class: "unit" })), h("div", { class: "stat-chart" })), h("div", { class: "stat-hint" }, " "))),
    h("div", { class: "columns" }, h("section", { id: "home-apps" }), h("aside", { class: "side", id: "home-side" })),
  );
  renderHomeBody();
}

function renderHomeBody() {
  const o = state.overview;
  const appsBox = document.getElementById("home-apps");
  const side = document.getElementById("home-side");
  if (!o || !appsBox || !side) return;
  const apps = o.apps;

  const count = (st) => apps.filter((a) => appState(a) === st).length;
  const counts = [["running", count("running")], ["restarting", count("restarting")], ["partial", count("partial")], ["stopped", count("stopped")]].filter(([, n]) => n > 0);
  document.getElementById("counts")?.replaceChildren(...counts.map(([st, n]) => h("span", { class: "count" }, h("i", { class: "dot " + st }), t("home.count." + st, { n }))));

  appsBox.replaceChildren(
    h("div", { class: "section-head" }, h("h2", null, t("home.apps"), h("span", { class: "muted small" }, t("home.installed", { n: apps.length }))), state.user.role !== "guest" && h("a", { class: "link", href: "#/store" }, t("home.store"), icon("arrow"))),
    h("div", { class: "tiles" }, apps.map(appTile), isAdmin() && h("a", { class: "tile add", href: "#/store" }, h("span", { class: "tile-main" }, h("span", { class: "app-icon plus" }, icon("plus")), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, t("home.addApp")), h("span", { class: "tile-sub" }, t("home.addAppHint"))))),
      isAdmin() && o.importable > 0 && h("a", { class: "tile add", href: "#/import" }, h("span", { class: "tile-main" }, h("span", { class: "app-icon plus" }, icon("download")), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, t("home.import")), h("span", { class: "tile-sub" }, t("home.importHint", { n: o.importable }))))),
    ),
  );

  side.replaceChildren(
    h(
      "section",
      { class: "card pad" },
      h("div", { class: "section-head" }, h("h2", null, t("attention.title"), o.attention.length > 0 && h("span", { class: "pill" }, o.attention.length))),
      o.attention.length ? o.attention.map(attentionItem) : h("p", { class: "all-good" }, icon("check", "ok"), t("attention.none")),
    ),
    h("section", { class: "pad-x" }, h("div", { class: "section-head" }, h("h2", null, t("activity.title"))), o.activity.length ? o.activity.map(activityItem) : h("p", { class: "muted small" }, t("activity.none"))),
  );
  renderSystem();
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
        isUp(app) && button(t("app.restart"), { disabled: !!app.job, onclick: () => startAction(app, "restart") }, "refresh"),
        isUp(app) ? button(t("app.stop"), { disabled: !!app.job, onclick: () => startAction(app, "stop") }, "stop") : button(t("app.start"), { class: url ? "" : "primary", disabled: !!app.job, onclick: () => startAction(app, "start") }, "play"),
        url && h("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("app.open"))),
        h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: () => appMoreMenu(app) }, icon("more")),
        ]),
      ),
    ),
    isAdmin() && h("div", { class: "tabs" }, tab("overview", "grid"), tab("logs", "logs"), tab("compose", "code"), tab("backups", "archive")),
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
      disabled: b.running || !b.apps.some((a) => a.installed && a.included),
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
  box.replaceChildren(
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
  { id: "apps", icon: "grid", admin: true },
  { id: "stores", icon: "store", admin: true },
  { id: "https", icon: "lock", admin: true },
  { id: "about", icon: "info" },
];
const sections = () => SECTIONS.filter((item) => !item.admin || isAdmin());

function settingRow(title, hint, control) {
  return h("div", { class: "setting" }, h("div", { class: "grow" }, h("strong", null, title), hint && h("p", { class: "muted small" }, hint)), h("div", { class: "setting-control" }, control));
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
      settingRow("Docker", d?.available ? "" : (d?.error ?? ""), h("span", { class: "mono" }, d?.available ? `${d.version} · compose ${d.compose}` : "—")),
      settingRow(t("settings.source"), "", h("a", { class: "link", href: "https://github.com/sanyadez/hata", target: "_blank", rel: "noopener noreferrer" }, "github.com/sanyadez/hata", icon("external"))),
    ),
  ];
}

const HTTPS_MODES = ["off", "proxy", "acme"];
/** Settings → HTTPS and domain: how Hata is reached */
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

function passwordPrompt(title, lead, confirmLabel, action) {
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
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn danger" }, confirmLabel)),
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
    sessionsCard,
  ];
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
  Object.assign(state, { version: server.version, setup: server.setup, user: server.user, languages: server.languages });
  await loadLanguage(pickLanguage(server));
  if (state.user) await enter();
  else render();
}

void main();
