// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

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
  if (!historyUi.loaded) return box.replaceChildren(waitMark());
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
    !historyUi.more && days.size > 0 && h("p", { class: "card pad muted small center-row" }, t("activity.start")),
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
  return el;
}

const machineOfBlock = (id) => (state.overview?.machines ?? []).find((m) => "machine:" + m.id === id);

/** One number of a machine's row: label and value on a line, a bar or a little chart, a line under it; empty when not known */
function meter(label, value, gauge, hint, cls = "") {
  if (value == null) return h("div", { class: "meter empty" });
  return h("div", { class: "meter" }, h("div", { class: "meter-top" }, h("span", { class: "clip" }, label), h("strong", { class: cls }, value)), gauge, h("span", { class: "meter-hint" }, hint || " "));
}

/** The numbers of a machine as one row of cells, so the rows of several machines line up */
function machineMeters(s) {
  const mem = s.memory;
  const memPercent = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
  const disk = s.disks[0];
  const diskPercent = disk ? Math.round((disk.used / disk.total) * 100) : 0;
  return [
    meter(t("sys.cpu"), s.cpu == null ? null : s.cpu + "%", meterBar(s.cpu ?? 0), t("sys.cores", { n: s.cores }), level(s.cpu ?? 0)),
    meter(t("sys.memory"), bytes(mem.used), meterBar(memPercent), t("sys.ofPercent", { total: bytes(mem.total), percent: memPercent }), level(memPercent)),
    meter(t("sys.disk"), disk ? diskPercent + "%" : null, meterBar(diskPercent), disk && t("sys.free", { free: bytes(disk.total - disk.used), total: bytes(disk.total) }), level(diskPercent)),
    meter(t("sys.network"), s.net ? bytes(s.net.rx + s.net.tx) + "/s" : null, sparkline(s.history.net), s.net && `↓ ${bytes(s.net.rx)}/s · ↑ ${bytes(s.net.tx)}/s`),
    meter(t("sys.temperature"), s.temperature == null ? null : s.temperature + " °C", meterBar(s.temperature ?? 0, s.temperature >= 85 ? "warn" : ""), t("sys.cpu"), s.temperature >= 85 ? "warn" : ""),
  ];
}

/** What brings a machine that is away back, as the buttons of its row */
function machineBack(m) {
  return splitActions(
    [
      m.pve && isAdmin() && button(t("pve.startHere", { host: m.pve.hostName }), { class: "small", onclick: (e) => startGuestOf({ ...m, pve: { host: m.pve.host, id: m.pve.guest, status: m.pve.status } }, e.currentTarget) }, "play"),
      m.instance && isAdmin() && button(t("incus.start"), { class: "small", onclick: (e) => ((e.currentTarget.disabled = true), api("POST", `/api/containers/${m.instance}/state`, { action: "start" }).then(refresh, (err) => toast(errorText(err), "error"))) }, "play"),
      m.wake === "lan" && isAdmin() && button(t("machines.wake"), { class: "small", onclick: (e) => wakeMachine(m, e.currentTarget) }, "play"),
      { href: `#/machines/${m.id}`, label: t("common.open"), icon: "server" },
    ],
    menuHeader(m.name, null, "server"),
  );
}

/** The block of another machine's numbers: one row — who it is, then its numbers or why there are none */
function machineBlock(id) {
  const m = machineOfBlock(id);
  if (!m) return null;
  let el = homeUi.widgets[id];
  if (!el) {
    el = widget(id, h("section", { class: "card machine-row" }));
    homeUi.widgets[id] = el;
  }
  const waiting = m.online && !m.status;
  const who = h(
    "div",
    { class: "mrow-who" },
    h("a", { class: "mrow-name", href: `#/machines/${m.id}` }, h("i", { class: "dot " + (m.online ? "running" : "stopped") }), h("span", { class: "clamp2" }, m.name)),
    h("span", { class: "muted small" }, !m.online ? t("home.machineAway", { ago: ago(m.seen) }) : waiting ? t("home.machineWaiting") : t("machines.online")),
    m.os && h("span", { class: "muted small clip" }, m.os),
  );
  let body;
  el.classList.toggle("away", !m.online);
  el.oncontextmenu = null;
  if (!m.online) {
    const { buttons, openMore } = machineBack(m);
    body = [h("p", { class: "mrow-away muted small" }, t("machines.offlineLead", { ago: ago(m.seen) })), h("div", { class: "row-actions" }, buttons)];
    if (openMore) el.oncontextmenu = (e) => (e.preventDefault(), openMore({ x: e.clientX, y: e.clientY }));
  } else body = h("div", { class: "meters" + (waiting ? " waiting" : "") }, waiting ? Array.from({ length: 5 }, () => h("div", { class: "meter skeleton" }, h("i"), h("i"), h("i"))) : machineMeters(m.status));
  put(el, who, body);
  return el;
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting = t(hour < 5 ? "home.night" : hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: state.user.name });
  // the blocks are made once and then only moved and refilled: the numbers of the system live in one of them
  // what needs attention and what happened are the administrators': a member's page has no such blocks
  homeUi.widgets = {
    stats: statsBlock(),
    attention: isAdmin() ? widget("attention", h("section", { class: "card pad attention-block" })) : null,
    activity: isAdmin() ? widget("activity", h("section", { class: "card pad activity-block" })) : null,
    adblock: isAdmin() ? widget("adblock", h("section", { class: "card pad adblock-block" })) : null,
    tv: isAdmin() && hasModule("tv") ? widget("tv", h("section", { class: "card pad tv-block" })) : null,
  };
  shell(
    h("div", { id: "grid-bar" }),
    h("div", { class: "card page-head home-head", id: "home-head" }, h("div", null, h("h1", null, greeting), h("p", { class: "meta", id: "host" }, " ")), h("div", { class: "home-head-side" }, h("div", { class: "counts", id: "counts" }), h("span", { id: "grid-edit-slot" }))),
    h("div", { class: "pg", id: "pg" }),
  );
  Object.assign(gridUi, { arranging: false, undo: [], entry: null, drag: null });
  renderHomeBody();
}

const activityBody = (o) => [h("div", { class: "section-head" }, h("h2", null, t("activity.title"))), o.activity.length ? h("div", { class: "timeline fits" }, o.activity.map(activityItem)) : h("p", { class: "muted small" }, t("activity.none")), isAdmin() && o.activity.length > 0 && h("a", { class: "link small all-activity block-foot", href: "#/activity" }, t("activity.all"), icon("chevron"))];

function attentionDialog(list) {
  let dialog;
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow" }, t("attention.title")), closeX(() => dialog)), h("div", { class: "attention-list" }, list.map(attentionItem)));
}

function attentionBlock(list) {
  return [
    h("div", { class: "section-head" }, h("h2", null, t("attention.title"), list.length > 0 && h("span", { class: "pill" }, list.length))),
    list.length ? h("div", { class: "attention-list fits" }, list.map(attentionItem)) : h("p", { class: "all-good" }, icon("check", "ok"), t("attention.none")),
    h(
      "div",
      { class: "block-foot" },
      h("button", { type: "button", class: "link small more-items fits-more", hidden: true, onclick: () => attentionDialog(state.overview.attention) }, h("span"), icon("chevron")),
      state.overview?.attentionHidden > 0 && h("a", { class: "link small more-items", href: "#/settings/notifications/hidden" }, t("attention.hiddenLink", { n: state.overview.attentionHidden }), icon("chevron")),
    ),
  ];
}

function renderHomeBody() {
  const o = state.overview;
  if (!o || !document.getElementById("pg") || !homeUi.widgets) return;
  const apps = o.apps;

  const count = (st) => apps.filter((a) => appState(a) === st).length;
  const counts = [["running", count("running")], ["restarting", count("restarting")], ["partial", count("partial")], ["stopped", count("stopped")]].filter(([, n]) => n > 0);
  document.getElementById("counts")?.replaceChildren(...(counts.length ? [h("span", { class: "status-pill" }, counts.flatMap(([st, n], i) => [i > 0 && h("span", { class: "dot-sep" }, "·"), h("span", { class: "count" }, h("i", { class: "dot " + st }), t("home.count." + st, { n }))]))] : []));

  paintGrid();
  renderFolder();
}

/** The picture of each of Hata's own blocks */
const BLOCKS = { stats: "cpu", attention: "alert", activity: "list", adblock: "shield", tv: "tv" };
const blockTitle = (id) => (id.startsWith("machine:") ? t("home.machineBlock", { name: machineOfBlock(id)?.name ?? id.slice(8) }) : t(id === "stats" ? "home.statsBlock" : id + ".title"));
const removeBlock = (id) => changeLayout((layout) => void takeTile(layout, "block:" + id));

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
    if (action === "update") jobInBackground(res.job, action, app.title);
    else jobDialog(res.job, action, app.title);
    void refresh();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** What the store says to know of an app once it is there: how to sign in, what to do first */
async function appNotesDialog(name, title) {
  try {
    const { tips } = await api("GET", `/api/apps/${name}?lang=${state.lang}`);
    notesDialog(title, tips);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** Where "Show" asks for the values of an app's login: this server's or a machine's */
const loginAsker = (name, machine) => Object.assign(() => api("POST", machine ? `/api/machines/${machine}/apps/${name}/login` : `/api/apps/${name}/login`), { key: `${name}@${machine ?? ""}` });

/** What "Show" gave, for a while: the page is redrawn by every event, and asking made one. It is not kept any longer than this */
const loginSeen = new Map();
const LOGIN_SEEN_MS = 5 * 60_000;

/** How to sign in to an app: one line, or the user name and the password apart, each to copy. A value the page does not hold yet comes by a button */
function loginBlock(login, ask) {
  if (login.kind === "first-visit" || login.kind === "none") return h("p", { class: "login-line muted small" }, t(`app.login.${login.kind}`));
  const box = h("div", { class: "login-block" });
  const copyButton = (label, value) => h("button", { type: "button", class: "icon-btn", title: `${t("twofa.copy")}: ${label}`, "aria-label": `${t("twofa.copy")}: ${label}`, onclick: () => copyQuietly(value) }, icon("copy"));
  const row = (label, value) => h("div", { class: "login-row" }, h("span", { class: "muted small" }, label), h("span", { class: "mono login-value" }, value), copyButton(label, value));
  const paint = () => {
    const given = loginSeen.get(ask.key);
    const seen = { ...login, ...(given ?? {}) };
    const waits = !given && login.ask?.length;
    const hiddenRow = (label) => h("div", { class: "login-row" }, h("span", { class: "muted small" }, label), h("span", { class: "mono login-value muted" }, "••••••••"));
    const missing = (label, words) => h("div", { class: "login-row" }, h("span", { class: "muted small" }, label), h("span", { class: "muted small login-value" }, words));
    const part = (field, label) => {
      if (waits && login.ask.includes(field)) return hiddenRow(label);
      if (seen[field]) return row(label, seen[field]);
      return given && login.ask?.includes(field) ? missing(label, t(login.kind === "log" ? "app.login.notFound" : "app.login.empty")) : null;
    };
    const show = async (button) => {
      button.disabled = true;
      try {
        loginSeen.set(ask.key, await ask());
        setTimeout(() => loginSeen.delete(ask.key), LOGIN_SEEN_MS);
        paint();
      } catch (e) {
        button.disabled = false;
        toast(errorText(e), "error");
      }
    };
    const showButton = (login.ask?.length && (waits || (login.kind === "log" && !seen.password))) ? button(t(login.kind === "log" ? "app.login.find" : "app.login.show"), { class: "small", onclick: (e) => void show(e.currentTarget) }, login.kind === "log" ? "search" : "key") : null;
    box.replaceChildren(...[
      part("user", t("app.login.user")),
      part("password", t("auth.password")),
      given?.line && h("p", { class: "muted small mono login-source" }, given.line),
      h("p", { class: "muted small" }, t(`app.login.${login.kind}`)),
      showButton && h("div", { class: "login-actions" }, showButton),
    ].filter(Boolean));
  };
  paint();
  return box;
}

function loginDialog(title, login, ask) {
  let dialog;
  dialog = openDialog("confirm", h("h2", null, t("app.loginOf", { title })), loginBlock(login, ask), h("footer", null, closeButton(() => dialog, t("common.close"))));
}

async function appLoginDialog(name, title) {
  try {
    const { login } = await api("GET", `/api/apps/${name}?lang=${state.lang}`);
    if (login) loginDialog(title, login, loginAsker(name));
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function notesDialog(title, tips) {
  let dialog;
  dialog = openDialog("confirm", h("h2", null, t("app.notesOf", { title })), h("div", { class: "tips prose" }, md(tips)), h("footer", null, closeButton(() => dialog, t("common.close"))));
}

/** What can be done to an app from its tile: open it, start or stop it, go to its settings, logs and the rest */
function appTileMenu(app, anchor, at) {
  if (app.failedJob || app.job?.kind === "install") {
    const box = anchor?.getBoundingClientRect();
    return jobTileMenu(app, at ?? { x: box.left, y: box.bottom + 6 });
  }
  let dialog;
  const url = isUp(app) ? appUrl(app) : null;
  const busy = !!app.job;
  const item = (label, iconName, action, cls = "", off = false) => h("button", { type: "button", class: "menu-item " + cls, disabled: off, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  const page = (label, iconName, tab) => h("a", { class: "menu-item", href: `#/apps/${app.name}${tab ? "/" + tab : ""}`, onclick: () => dialog.close() }, icon(iconName), label);
  dialog = openDialog(
    "menu dropdown",
    h("header", null, appIcon(app), h("div", null, h("h2", { class: "clip" }, app.title), stateChip(app))),
    url && h("a", { class: "menu-item", href: url, target: "_blank", rel: "noopener noreferrer", onclick: () => dialog.close() }, icon("external"), t("app.open")),
    busy && item(t("jobs.showLog"), "logs", () => jobDialog(app.job.id, app.job.kind, app.title)),
    isUp(app) ? item(t("app.stop"), "stop", () => startAction(app, "stop"), "", busy) : item(t("app.start"), "play", () => startAction(app, "start"), "", busy),
    isUp(app) && item(t("app.restart"), "refresh", () => startAction(app, "restart"), "", busy),
    app.update && item(t("app.storeUpdateGo"), "up", () => storeUpdateDialog(app), "", busy),
    !app.update && app.newer?.length > 0 && item(t("app.update"), "up", () => startAction(app, "update"), "", busy),
    app.login && app.login !== "none" && isAdmin() && item(t("app.login"), "key", () => appLoginDialog(app.name, app.title)),
    app.notes && isAdmin() && item(t("app.notes"), "info", () => appNotesDialog(app.name, app.title)),
    page(t("app.tab.settings"), "sliders", "settings"),
    page(t("app.logs"), "logs", "logs"),
    page(t("app.tab.terminal"), "terminal", "terminal"),
    page(t("app.tab.backups"), "archive", "backups"),
    isAdmin() && item(t("assistant.ask"), "chat", () => openAssistant({ draft: t("assistant.aboutApp", { title: app.title, app: app.name }) })),
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
    isAdmin() && h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), openAssistant({ draft: t("assistant.aboutApp", { title: app.title, app: app.name }) })) }, icon("chat"), t("assistant.ask")),
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
        app.job && button(t("jobs.showLog"), { onclick: () => jobDialog(app.job.id, app.job.kind, app.title) }, "logs"),
        app.update && !app.job && button(t("app.storeUpdateGo"), { class: "accent", onclick: () => storeUpdateDialog(app) }, "up"),
        !app.update && app.newer?.length > 0 && !app.job && button(t("app.update"), { class: "accent", title: `${t("app.newer")}: ${app.newer.join(", ")}`, onclick: () => startAction(app, "update") }, "up"),
        (app.status === "partial" || app.status === "restarting") && isAdmin() && button(t("assistant.askWhy"), { onclick: () => openAssistant({ ask: t("assistant.whyDown", { title: app.title, app: app.name }) }) }, "chat"),
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
    plan = await api("GET", `/api/apps/${app.name}/storeupdate?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const rows = (kind) => plan.changes.filter((c) => c.kind === kind && !c.path.startsWith("x-casaos")).map((c) => h("tr", null, h("td", { class: "mono small" }, c.path), h("td", { class: "mono small" }, h("div", { class: "muted clip" }, c.from || "—"), h("div", { class: "clip" }, c.to || t("update.removed")))));
  const table = (kind) => h("div", { class: "card table-wrap" }, h("table", { class: "changes" }, h("tbody", null, rows(kind))));
  const fromStore = rows("store");
  const conflicts = rows("conflict");
  // in words first: which version becomes which, what is added; the lines of the file are for whoever asks
  const words = plan.words ?? [];
  const versions = words.filter((w) => w.code === "version");
  const several = new Set(words.map((w) => w.service).filter(Boolean)).size > 1;
  const WORD_ICONS = { image: "refresh", added: "plus", addedFirst: "plus", removed: "trash", envAdded: "sliders", envChanged: "sliders", envRemoved: "sliders", ports: "network", volumes: "folder", other: "code", files: "file" };
  const word = (w) => h("li", null, icon(WORD_ICONS[w.code] ?? "code"), h("div", { class: "grow" }, h("div", null, t("update.word." + w.code, w)), several && w.service && !["added", "addedFirst", "removed"].includes(w.code) && h("div", { class: "muted small" }, t("update.word.in", w))));
  const others = words.filter((w) => w.code !== "version");
  const lead = versions.length ? "update.leadVersion" : plan.staying ? "update.leadSame" : "update.leadSetup";
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("update.title", { title: app.title })), h("p", { class: "muted small" }, t(lead, { store: plan.store, version: plan.staying }))), closeX(() => dialog)),
    !plan.exact && h("p", { class: "banner small" }, t(plan.recorded ? "update.guessed" : "update.matched", { store: plan.store })),
    plan.notes && h("div", { class: "tips prose" }, h("strong", null, t("update.before")), md(plan.notes)),
    // the store's own words on why it changed the app's files: what the lines below cannot say
    plan.why && h("div", { class: "tips prose" }, h("strong", null, t("update.why", { store: plan.store })), h("p", null, plan.why)),
    versions.length > 0 && h("div", { class: "update-versions" }, versions.map((w) => h("div", { class: "update-version" }, h("span", { class: "muted" }, versions.length > 1 || w.name.replace(/[-_]/g, "") !== app.name.replace(/[-_]/g, "") ? w.name : t("update.version")), h("span", { class: "mono" }, w.from), icon("arrow"), h("strong", { class: "mono" }, w.to)))),
    others.length > 0 && h("div", { class: "stack" }, h("h3", null, t(versions.length ? "update.also" : "update.what")), h("ul", { class: "update-words" }, others.map(word))),
    words.length === 0 && fromStore.length > 0 && h("p", { class: "muted small" }, t("update.small")),
    conflicts.length > 0 && h("div", { class: "stack" }, h("h3", null, t("update.conflicts")), h("p", { class: "muted small" }, t("update.conflictsLead")), table("conflict")),
    h("p", { class: "muted small" }, t(state.settings?.backup?.beforeUpdate ? "update.safe" : "update.safeNoCopy")),
    fromStore.length > 0 && h("details", null, h("summary", { class: "muted small" }, t("update.lines")), table("store")),
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
            jobInBackground(res.job, "update", app.title, () => loadApp(true));
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

/** A line that leads to the one table of access, for the places that show or change a part of it */
const accessLink = () => h("p", { class: "muted small" }, t("access.givenAt"), " ", h("a", { class: "link", href: "#/settings/users/access", onclick: (e) => e.currentTarget.closest("dialog")?.close() }, `${t("area.settings.users")} → ${t("users.part.access")}`));

/** Who opens the app and whether Hata's sign-in stands in front of it: said here, given in the one table of access */
const appAccess = { name: "", at: 0, data: null };
function appAccessCard(app) {
  if (!isAdmin()) return null;
  const box = h("section", { class: "card pad stack-s" });
  const paint = () => {
    const a = appAccess.data;
    const users = a?.users ?? [];
    const save = (patch) =>
      api("PUT", `/api/apps/${app.name}/access`, { protect: a.protect, allowed: a.allowed, ...patch }).then(
        (res) => ((appAccess.at = 0), res.job ? jobDialog(res.job, "apply", app.title, ask) : ask()),
        (e) => (toast(errorText(e), "error"), (appAccess.at = 0), ask()),
      );
    const who = !a ? "…" : a.allowed === "all" ? t("access.everyone") : users.filter((u) => a.allowed.includes(u.id)).map((u) => u.name).join(", ") || t("app.accessAdmins");
    put(
      box,
      h("div", { class: "section-head" }, h("h2", null, t("app.access")), h("a", { class: "link small", href: "#/settings/users/access" }, t("users.part.access"), " →")),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("app.accessWho")), h("span", null, who)),
      a && h("label", { class: "check" }, h("input", { type: "checkbox", checked: a.protect, disabled: !!a.cannotProtect, onchange: (e) => save({ protect: e.target.checked }) }), h("span", null, h("strong", null, t("access.signIn")), h("span", { class: "muted small block" }, a.cannotProtect ? t("access.cannot." + a.cannotProtect) : a.protect ? t("app.accessGuarded") : t("access.onlyHidden")))),
      // sign-in stands in front of the web port; the app's other ports are listed so that nobody takes them for closed
      a?.protect && a.others.length > 0 && h("div", { class: "muted small other-ports" }, t("access.others"), a.others.map((o) => h("label", null, h("input", { type: "checkbox", checked: o.guarded, onchange: (e) => save({ ports: a.others.filter((x) => (x.port === o.port ? e.target.checked : x.guarded)).map((x) => x.port) }) }), String(o.port)))),
    );
  };
  const ask = async () => {
    const all = await api("GET", `/api/access?lang=${state.lang}`).catch(() => null);
    const mine = all?.apps.find((x) => x.name === app.name && !x.machine);
    Object.assign(appAccess, { name: app.name, at: Date.now(), data: mine ? { ...mine, users: all.users } : null });
    if (box.isConnected) paint();
  };
  // the page is redrawn with every tick of the numbers: what was asked a moment ago is shown as it is
  if (appAccess.name !== app.name) Object.assign(appAccess, { name: app.name, at: 0, data: null });
  paint();
  if (Date.now() - appAccess.at > 15_000) void ask();
  return box;
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
    appServiceCard(app),
    h(
      "div",
      { class: "columns" },
      h(
        "div",
        { class: "stack" },
        h("section", { class: "card head-in" }, h("div", { class: "section-head pad-head" }, h("h2", null, t("app.resources"))), statsBox),
        app.containers.length
          ? h("div", { class: "card table-wrap" }, h("div", { class: "section-head pad-head" }, h("h2", null, t("app.containers"))), h("table", null, h("thead", null, h("tr", null, h("th", null, t("app.col.container")), h("th", null, t("app.col.state")), h("th", { class: "num" }, t("sys.cpu")), h("th", { class: "num" }, t("sys.memory")), h("th", null, t("app.col.ports")))), h("tbody", { id: "containers" }, app.containers.map(containerRow))), h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} ps`))
          : h("section", { class: "card pad stack-s" }, h("div", { class: "section-head" }, h("h2", null, t("app.containers"))), h("p", { class: "muted" }, t("app.noContainers"))),
      ),
      h(
        "aside",
        { class: "side" },
        h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("app.glance"))), app.port && row(t("app.address"), appAddress(app), true), row(t("app.composeFile"), app.composeFile, true), app.folders.map((f, i) => row(i ? "" : t("app.folders"), f, true)), row(t("app.source"), app.store ? t("app.fromStore", { store: app.store }) : t("app.custom")), row(t("app.installed"), new Date(app.installedAt).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" }))),
        appAccessCard(app),
        app.login && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("app.login"))), loginBlock(app.login, loginAsker(app.name))),
        app.tips && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("app.notes"))), h("div", { class: "tips prose" }, md(app.tips))),
        h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("activity.title"))), app.activity.length ? app.activity.slice(0, 6).map(activityItem) : h("p", { class: "muted small" }, t("activity.none"))),
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
  box.replaceChildren(h("div", { class: "console-frame" }, h("p", { class: "cmd" }, icon("terminal"), `docker compose -p ${app.name} logs --follow --tail 200`), log));
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
  box.replaceChildren(h("div", { class: "console-frame" }, h("div", { class: "cmd-row" }, h("p", { class: "cmd grow" }, icon("terminal"), `docker exec -it ${running[0].name} sh`), pick), frame));
  if (pick) pick.addEventListener("change", () => (box.querySelector(".cmd").lastChild.textContent = `docker exec -it ${pick.value} sh`));
  open(running[0].name);
}
