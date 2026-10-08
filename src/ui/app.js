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

let dict = {};
let fallbackDict = {};

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
  return key in dict || key in fallbackDict ? t(key, e.detail).trim() : e.detail.message || e.code;
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

function duration(seconds) {
  const d = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${hrs}h` : hrs ? `${hrs}h ${min}m` : `${min}m`;
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

const closeButton = (dialog, label = t("common.close")) => h("button", { type: "button", class: "ghost", onclick: () => dialog().close() }, label);

// --- State --------------------------------------------------------------------------------------

const state = {
  version: "",
  setup: false,
  user: null,
  lang: "en",
  languages: ["en"],
  view: "home",
  overview: null,
  store: null,
  storeFilter: { query: "", category: "" },
  settings: null,
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
    } else if (event.type === "apps") {
      clearTimeout(appsTimer);
      appsTimer = setTimeout(refreshOverview, 150);
    } else if (event.type === "job") {
      for (const listener of jobListeners) listener(event);
    } else if (event.type === "store" && state.view === "store") {
      void loadStore();
    }
  };
  // after a reconnect anything may have changed while we were away
  source.onopen = () => void refreshOverview();
}

function stopEvents() {
  source?.close();
  source = null;
}

async function refreshOverview() {
  if (!state.user) return;
  try {
    state.overview = await api("GET", `/api/overview?lang=${state.lang}`);
  } catch {
    return;
  }
  if (state.view === "home") renderHome();
}

// --- Sign-in and setup --------------------------------------------------------------------------

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "label" }, label), input, hint && h("span", { class: "hint" }, hint));
}

function authScreen() {
  const setup = state.setup;
  const tokenFromLink = /^#setup=([0-9a-f]+)$/.exec(location.hash)?.[1] ?? "";
  const token = h("input", { name: "token", value: tokenFromLink, autocomplete: "off", required: true, spellcheck: false });
  const name = h("input", { name: "name", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: false });
  const password = h("input", { name: "password", type: "password", autocomplete: setup ? "new-password" : "current-password", required: true, minLength: setup ? 8 : 1 });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "primary" }, t(setup ? "setup.create" : "auth.signIn"));

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
          const res = setup ? await api("POST", "/api/setup", { ...data, token: token.value.trim() }) : await api("POST", "/api/login", data);
          history.replaceState(null, "", location.pathname);
          state.user = res.user;
          state.setup = false;
          await enter();
        } catch (err) {
          error.textContent = errorText(err);
          submit.disabled = false;
        }
      },
    },
    h("img", { class: "logo", src: "/logo.svg", alt: "" }),
    h("h1", null, t(setup ? "setup.title" : "auth.title")),
    setup && h("p", { class: "lead" }, t("setup.lead")),
    setup && !tokenFromLink && field(t("setup.token"), token, t("setup.tokenHint")),
    field(t("auth.name"), name),
    field(t("auth.password"), password, setup && t("auth.passwordHint")),
    error,
    submit,
  );
  $app.replaceChildren(h("main", { class: "center" }, form));
  (setup && !tokenFromLink ? token : name).focus();
}

// --- Shell --------------------------------------------------------------------------------------

const VIEWS = ["home", "store", "settings"];

function shell(content) {
  const nav = VIEWS.map((view) =>
    h("button", { type: "button", class: "tab" + (state.view === view ? " active" : ""), "aria-current": state.view === view ? "page" : null, onclick: () => go(view) }, t("nav." + view)),
  );
  $app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("a", { class: "brand", href: "/", onclick: (e) => (e.preventDefault(), go("home")) }, h("img", { src: "/logo.svg", alt: "" }), "Hata"),
      h("nav", null, nav),
      h(
        "button",
        {
          type: "button",
          class: "ghost signout",
          title: state.user.name,
          onclick: async () => {
            await api("POST", "/api/logout", {}).catch(() => {});
            state.user = null;
            stopEvents();
            render();
          },
        },
        t("nav.signOut"),
      ),
    ),
    h("main", { id: "view" }, content),
  );
}

function go(view) {
  state.view = view;
  render();
  if (view === "store") void loadStore();
  if (view === "settings") void loadSettings();
}

function render() {
  if (state.setup || !state.user) return authScreen();
  if (state.view === "store") return renderStore();
  if (state.view === "settings") return renderSettings();
  renderHome();
}

// --- Home ---------------------------------------------------------------------------------------

function meter(id, label) {
  return h(
    "section",
    { class: "meter card", id: "meter-" + id },
    h("div", { class: "meter-head" }, h("span", { class: "label" }, label), h("strong", { class: "value" }, "—")),
    h("div", { class: "bar" }, h("i")),
    h("div", { class: "hint" }, " "),
  );
}

function setMeter(id, value, percent, hint) {
  const el = document.getElementById("meter-" + id);
  if (!el) return;
  el.querySelector(".value").textContent = value;
  const bar = el.querySelector(".bar i");
  bar.style.width = percent == null ? "0" : Math.min(100, Math.max(0, percent)) + "%";
  bar.className = percent >= 90 ? "high" : percent >= 75 ? "warn" : "";
  el.querySelector(".hint").textContent = hint || " ";
}

function renderSystem() {
  const s = state.overview?.system;
  if (!s) return;
  const host = document.getElementById("host");
  if (host) host.textContent = `${s.hostname} · ${t("sys.uptime", { time: duration(s.uptime) })}`;
  const temp = s.temperature == null ? "" : ` · ${s.temperature}°C`;
  setMeter("cpu", s.cpu == null ? "—" : s.cpu + "%", s.cpu, t("sys.cores", { n: s.cores }) + " · " + t("sys.load", { load: s.load[0] }) + temp);
  const mem = s.memory;
  setMeter("memory", mem.total ? Math.round((mem.used / mem.total) * 100) + "%" : "—", mem.total ? (mem.used / mem.total) * 100 : null, t("sys.of", { used: bytes(mem.used), total: bytes(mem.total) }));
  const disk = s.disks[s.disks.length - 1];
  if (disk) setMeter("disk", Math.round((disk.used / disk.total) * 100) + "%", (disk.used / disk.total) * 100, `${disk.path} · ` + t("sys.of", { used: bytes(disk.used), total: bytes(disk.total) }));
  setMeter("network", s.net ? "↓ " + bytes(s.net.rx) + "/s" : "—", null, s.net ? "↑ " + bytes(s.net.tx) + "/s" : "");
}

function appUrl(app) {
  if (!app.port) return null;
  return `${app.scheme}://${app.hostname || location.hostname}:${app.port}${app.index}`;
}

function appIcon(app) {
  const letter = h("span", { class: "icon letter" }, (app.title || app.name).slice(0, 1).toUpperCase());
  if (!app.icon) return letter;
  return h("img", { class: "icon", src: app.icon, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onerror: (e) => e.target.replaceWith(letter) });
}

function appTile(app) {
  const url = app.status === "running" || app.status === "partial" ? appUrl(app) : null;
  const status = app.job ? "busy" : app.status;
  const body = [appIcon(app), h("span", { class: "title" }, app.title), h("span", { class: "status " + status }, t("status." + status))];
  return h(
    "div",
    { class: "tile card" },
    url ? h("a", { class: "tile-main", href: url, target: "_blank", rel: "noopener noreferrer" }, body) : h("button", { type: "button", class: "tile-main", onclick: () => appMenu(app) }, body),
    h("button", { type: "button", class: "more ghost", "aria-label": t("app.menu", { title: app.title }), onclick: () => appMenu(app) }, "⋯"),
  );
}

function renderHome() {
  const o = state.overview;
  const apps = o?.apps ?? [];
  shell([
    h("p", { class: "host", id: "host" }, " "),
    h("div", { class: "meters" }, meter("cpu", t("sys.cpu")), meter("memory", t("sys.memory")), meter("disk", t("sys.disk")), meter("network", t("sys.network"))),
    o && !o.docker.available && h("p", { class: "banner" }, t("home.noDocker"), " ", h("small", null, o.docker.error)),
    h("h2", null, t("home.apps")),
    apps.length
      ? h("div", { class: "tiles" }, apps.map(appTile))
      : o && h("div", { class: "empty" }, h("p", null, t("home.empty")), h("button", { type: "button", class: "primary", onclick: () => go("store") }, t("home.openStore"))),
  ]);
  renderSystem();
}

// --- App actions --------------------------------------------------------------------------------

function appMenu(app) {
  const url = appUrl(app);
  const running = app.status === "running" || app.status === "partial";
  let dialog;
  const item = (label, action, opts = {}) =>
    h(
      "button",
      {
        type: "button",
        class: "menu-item" + (opts.danger ? " danger" : ""),
        disabled: opts.disabled,
        onclick: () => {
          dialog.close();
          action();
        },
      },
      label,
    );
  const act = (action) => () => startAction(app, action);
  dialog = openDialog(
    "menu",
    h("header", null, appIcon(app), h("div", null, h("h2", null, app.title), h("span", { class: "status " + app.status }, t("status." + app.status)))),
    url && running && h("a", { class: "menu-item", href: url, target: "_blank", rel: "noopener noreferrer", onclick: () => dialog.close() }, t("app.open")),
    running ? item(t("app.stop"), act("stop"), { disabled: !!app.job }) : item(t("app.start"), act("start"), { disabled: !!app.job }),
    item(t("app.restart"), act("restart"), { disabled: !!app.job || !running }),
    item(t("app.update"), act("update"), { disabled: !!app.job }),
    item(t("app.logs"), () => logsDialog(app)),
    item(t("app.compose"), () => composeDialog(app)),
    item(t("app.remove"), () => removeDialog(app), { danger: true, disabled: !!app.job }),
    app.job && item(t("status.busy"), () => jobDialog(app.job.id, app.job.kind, app.title)),
    app.containers.length > 0 &&
      h("details", null, h("summary", null, t("app.containers")), h("ul", { class: "containers" }, app.containers.map((c) => h("li", null, h("code", null, c.name), " ", h("span", { class: "hint" }, `${c.image} · ${c.status}`))))),
  );
}

async function startAction(app, action) {
  try {
    const res = await api("POST", `/api/apps/${app.name}/${action}`, {});
    jobDialog(res.job, action, app.title);
    void refreshOverview();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** Shows a running operation: its console output and how it ended */
async function jobDialog(id, kind, title, onDone) {
  const log = h("pre", { class: "console" });
  const status = h("p", { class: "job-status running" }, t("job.running"));
  let dialog;
  const close = h("button", { type: "button", class: "ghost", onclick: () => dialog.close() }, t("job.hide"));

  const append = (line) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.append(line + "\n");
    if (stick) log.scrollTop = log.scrollHeight;
  };
  const finish = (job) => {
    status.className = "job-status " + job.status;
    status.textContent = job.status === "done" ? t("job.done") : t("job.failed");
    close.textContent = t("common.close");
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

  dialog = openDialog("job", h("h2", null, t("job." + kind, { app: title })), log, h("footer", null, status, close));
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

async function logsDialog(app) {
  const log = h("pre", { class: "console tall" });
  const abort = new AbortController();
  const dialog = openDialog("job", h("h2", null, `${app.title} — ${t("app.logs")}`), log, h("footer", null, h("span"), closeButton(() => dialog)));
  dialog.addEventListener("close", () => abort.abort());
  try {
    const res = await fetch(`/api/apps/${app.name}/logs`, { signal: abort.signal });
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
    if (!abort.signal.aborted) log.append("\n" + errorText(e));
  }
}

async function composeDialog(app) {
  let text;
  try {
    text = (await api("GET", `/api/apps/${app.name}/compose`)).compose;
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const area = h("textarea", { class: "code", spellcheck: false, value: text, wrap: "off" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "wide",
    h("h2", null, `${app.title} — compose.yml`),
    h("p", { class: "hint" }, t("app.composeLead")),
    area,
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      h(
        "button",
        {
          type: "button",
          class: "primary",
          onclick: async () => {
            try {
              const res = await api("PUT", `/api/apps/${app.name}/compose`, { compose: area.value });
              dialog.close();
              jobDialog(res.job, "apply", app.title);
            } catch (e) {
              error.textContent = errorText(e);
            }
          },
        },
        t("app.saveApply"),
      ),
    ),
  );
}

function removeDialog(app) {
  const path = `${state.settings?.dataRoot ?? ""}/AppData/${app.name}`.replace(/^\/\//, "/");
  const withData = h("input", { type: "checkbox" });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("app.removeTitle", { title: app.title })),
    h("p", null, t("app.removeLead")),
    h("label", { class: "check" }, withData, t("app.removeData", { path })),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      h(
        "button",
        {
          type: "button",
          class: "danger",
          onclick: async () => {
            dialog.close();
            try {
              const res = await api("DELETE", `/api/apps/${app.name}${withData.checked ? "?data=1" : ""}`);
              jobDialog(res.job, "remove", app.title);
            } catch (e) {
              toast(errorText(e), "error");
            }
          },
        },
        t("app.remove"),
      ),
    ),
  );
}

// --- Store --------------------------------------------------------------------------------------

async function loadStore() {
  try {
    state.store = await api("GET", `/api/store?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.view === "store") renderStoreList();
}

async function syncStores() {
  toast(t("store.syncing"));
  for (const store of state.store?.stores ?? []) {
    try {
      const res = await api("POST", `/api/store/${store.id}/sync`, {});
      toast(res.ok ? t("store.synced", { apps: res.apps }) : res.error, res.ok ? "info" : "error");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  await loadStore();
}

function renderStore() {
  const search = h("input", {
    type: "search",
    class: "search",
    placeholder: t("store.search"),
    "aria-label": t("store.search"),
    value: state.storeFilter.query,
    oninput: () => {
      state.storeFilter.query = search.value;
      renderStoreList();
    },
  });
  shell([
    h("div", { class: "toolbar" }, search, h("button", { type: "button", onclick: customDialog }, t("store.custom")), h("button", { type: "button", class: "ghost", onclick: syncStores }, t("store.sync"))),
    h("div", { class: "chips", id: "chips" }),
    h("div", { id: "store-list" }),
  ]);
  renderStoreList();
}

function renderStoreList() {
  const list = document.getElementById("store-list");
  const chips = document.getElementById("chips");
  if (!list || !state.store) return;
  const { query, category } = state.storeFilter;
  const installed = new Set((state.overview?.apps ?? []).map((a) => a.name));

  const chip = (value, label) =>
    h(
      "button",
      {
        type: "button",
        class: "chip" + (category === value ? " active" : ""),
        "aria-pressed": String(category === value),
        onclick: () => {
          state.storeFilter.category = value;
          renderStoreList();
        },
      },
      label,
    );
  chips.replaceChildren(chip("", t("store.all")), chip("*", t("store.recommended")), ...state.store.categories.map((c) => chip(c, c)));

  const q = query.trim().toLowerCase();
  const apps = state.store.apps.filter(
    (a) => (!q || `${a.title} ${a.name} ${a.tagline}`.toLowerCase().includes(q)) && (category === "" || (category === "*" ? a.recommended : a.category === category)),
  );
  if (!state.store.apps.length) {
    const busy = state.store.stores.some((s) => s.syncing);
    return list.replaceChildren(h("div", { class: "empty" }, h("p", null, t(busy ? "store.syncing" : "store.empty")), !busy && h("button", { type: "button", class: "primary", onclick: syncStores }, t("store.sync"))));
  }
  if (!apps.length) return list.replaceChildren(h("p", { class: "empty" }, t("store.nothing")));
  list.replaceChildren(
    h(
      "div",
      { class: "cards" },
      apps.map((a) =>
        h(
          "button",
          { type: "button", class: "store-card card" + (a.supported ? "" : " unsupported"), onclick: () => storeDialog(a) },
          appIcon(a),
          h("span", { class: "text" }, h("span", { class: "title" }, a.title, installed.has(a.name) && h("span", { class: "badge" }, t("store.installed"))), h("span", { class: "tagline" }, a.tagline)),
        ),
      ),
    ),
  );
}

function formSection(title, rows) {
  return rows.length > 0 && h("fieldset", null, h("legend", null, title), rows);
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

  const ports = app.form.ports.map((p) => {
    const input = h("input", { value: p.published, inputMode: "numeric", pattern: "[0-9]*", class: "short" });
    inputs.ports.push({ service: p.service, target: p.target, protocol: p.protocol, input });
    return field(p.description || `${p.target}/${p.protocol}`, h("span", { class: "pair" }, input, h("span", { class: "hint" }, `→ ${p.target}/${p.protocol}`), p.busy && h("span", { class: "badge warn" }, t("store.portBusy"))));
  });
  const volumes = app.form.volumes.map((v) => {
    const input = h("input", { value: v.source, spellcheck: false });
    inputs.volumes.push({ service: v.service, target: v.target, input });
    return field(v.description || v.target, input, `→ ${v.target}`);
  });
  const envs = app.form.envs.map((e) => {
    const secret = /pass|secret|token|key/i.test(e.name);
    const input = h("input", { value: e.value, spellcheck: false, autocomplete: "off", type: secret && e.value === "" ? "password" : "text" });
    inputs.envs.push({ service: e.service, name: e.name, input });
    return field(e.name, input, e.description);
  });

  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const install = h(
    "button",
    {
      type: "button",
      class: "primary",
      disabled: app.installed || !supported,
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
          jobDialog(res.job, "install", app.title, () => go("home"));
        } catch (e) {
          error.textContent = errorText(e);
          install.disabled = false;
        }
      },
    },
    t(app.installed ? "store.installed" : "store.install"),
  );

  dialog = openDialog(
    "wide store-app",
    h("header", null, appIcon(app), h("div", null, h("h2", null, app.title), h("p", { class: "tagline" }, app.tagline), h("p", { class: "hint" }, [app.category, app.developer && t("store.by", { developer: app.developer })].filter(Boolean).join(" · ")))),
    !supported && h("p", { class: "banner" }, t("store.unsupported", { arch: state.overview?.arch ?? "" })),
    app.screenshots.length > 0 && h("div", { class: "shots" }, app.screenshots.map((src) => h("img", { src, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }))),
    h("p", { class: "description" }, app.description),
    app.tips && h("div", { class: "tips" }, h("strong", null, t("store.tips")), h("p", null, app.tips)),
    (ports.length || volumes.length || envs.length) > 0 &&
      h("details", { class: "form", open: app.form.ports.some((p) => p.busy) }, h("summary", null, t("store.settings")), formSection(t("store.ports"), ports), formSection(t("store.volumes"), volumes), formSection(t("store.envs"), envs)),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), install),
  );
}

function customDialog() {
  const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_-]*", autocapitalize: "none", spellcheck: false });
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
            jobDialog(res.job, "install", name.value.trim(), () => go("home"));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("store.customTitle")),
      h("p", { class: "hint" }, t("store.customLead")),
      field(t("store.customName"), name, t("store.customNameHint")),
      field(t("store.customCompose"), area),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "primary" }, t("store.install"))),
    ),
  );
  name.focus();
}

// --- Settings -----------------------------------------------------------------------------------

async function loadSettings() {
  try {
    state.settings = await api("GET", "/api/settings");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.view === "settings") renderSettings();
}

const LANGUAGE_NAMES = { en: "English", uk: "Українська" };

function renderSettings() {
  const s = state.settings;
  const language = h(
    "select",
    {
      onchange: async () => {
        localStorage.setItem("hata.lang", language.value);
        await loadLanguage(language.value);
        await refreshOverview();
        render();
      },
    },
    state.languages.map((code) => h("option", { value: code, selected: code === state.lang }, LANGUAGE_NAMES[code] ?? code)),
  );
  if (!s) return shell(h("section", { class: "card settings" }, field(t("settings.language"), language)));

  const dataRoot = h("input", { value: s.dataRoot, spellcheck: false, required: true });
  const puid = h("input", { value: s.puid, type: "number", min: 0, max: 65534, class: "short", required: true });
  const pgid = h("input", { value: s.pgid, type: "number", min: 0, max: 65534, class: "short", required: true });
  const tz = h("input", { value: s.timezone, spellcheck: false, placeholder: s.systemTimezone });
  const error = h("p", { class: "error", role: "alert" });
  const d = state.overview?.docker;

  shell([
    h("section", { class: "card settings" }, field(t("settings.language"), language)),
    h(
      "form",
      {
        class: "card settings",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            state.settings = await api("PUT", "/api/settings", { dataRoot: dataRoot.value.trim(), puid: Number(puid.value), pgid: Number(pgid.value), timezone: tz.value.trim() });
            toast(t("settings.saved"));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("settings.apps")),
      field(t("settings.dataRoot"), dataRoot, t("settings.dataRootHint")),
      h("div", { class: "row" }, field(t("settings.puid"), puid), field(t("settings.pgid"), pgid)),
      field(t("settings.timezone"), tz, t("settings.timezoneHint", { tz: s.systemTimezone })),
      error,
      h("footer", null, h("button", { class: "primary" }, t("settings.save"))),
    ),
    h("section", { class: "card settings" }, h("h2", null, t("settings.about")), h("p", null, t("settings.version", { version: state.version })), d?.available && h("p", { class: "hint" }, t("settings.docker", d))),
  ]);
}

// --- Start --------------------------------------------------------------------------------------

async function enter() {
  state.view = "home";
  render();
  await refreshOverview();
  startEvents();
  api("GET", "/api/settings").then((s) => (state.settings = s), () => {});
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
