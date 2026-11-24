// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- The whole history ----------------------------------------------------------------------------

const historyUi = { entries: [], more: false, loaded: false, filter: "", quiet: false, error: null, folded: new Set() };

async function loadHistory(older = false) {
  const before = older && historyUi.entries.length ? historyUi.entries[historyUi.entries.length - 1].ts : Date.now() + 60_000;
  try {
    const page = await api("GET", `/api/activity?before=${before}`);
    historyUi.entries = older ? [...historyUi.entries, ...page.entries] : page.entries;
    historyUi.more = page.more;
    historyUi.loaded = true;
    historyUi.error = null;
  } catch (e) {
    if (historyUi.loaded) toast(errorText(e), "error");
    else historyUi.error = errorText(e);
  }
  if (state.route.view === "activity") paintHistory();
}

function paintHistory() {
  const box = document.getElementById("history");
  if (!box) return;
  const segment = uiSegment([{ value: "all", label: t("activity.all2") }, { value: "quiet", label: t("activity.noSignins") }], historyUi.quiet ? "quiet" : "all", (v) => ((historyUi.quiet = v === "quiet"), paintHistory()), { label: t("activity.history") });
  const card = (...body) => put(box, uiCard({ flush: true, actions: segment, title: t("activity.events") }, ...body));
  if (historyUi.error && !historyUi.loaded) return card(uiEmpty({ size: "error", title: t("activity.failed"), text: historyUi.error, action: button(t("ui.retry"), { onclick: () => ((historyUi.error = null), paintHistory(), loadHistory()) }) }));
  if (!historyUi.loaded) return card(uiEmpty({ size: "loading" }));
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
  if (!days.size) return card(words ? uiEmpty({ text: t("activity.noMatch") }) : uiEmpty({ size: "big", icon: "clock", title: t("activity.none") }));
  card(
    [...days].map(([day, rows]) => uiGroup({ name: day, count: rows.length, open: !historyUi.folded.has(day), onToggle: (open) => (open ? historyUi.folded.delete(day) : historyUi.folded.add(day), paintHistory()) }, ...rows)),
    historyUi.more ? uiEmpty({ text: t("activity.olderLead"), action: button(t("activity.older"), { class: "quiet small", onclick: (e) => ((e.currentTarget.disabled = true), loadHistory(true)) }) }) : uiEmpty({ text: t("activity.start") }),
  );
}

function renderActivity() {
  const search = h("input", { type: "search", class: "ui-search", placeholder: t("activity.search"), "aria-label": t("activity.search"), value: historyUi.filter, oninput: () => ((historyUi.filter = search.value), paintHistory()) });
  shell(pageHead({ title: t("activity.history"), facts: [t("activity.historyLead")], search }), h("div", { id: "history" }));
  paintHistory();
  void loadHistory();
}

function widget(id, el) {
  el.classList.add("ui-home-block");
  el.dataset.widget = id;
  return el;
}

const machineOfBlock = (id) => (state.overview?.machines ?? []).find((m) => "machine:" + m.id === id);

/** The numbers of a machine as rows of the block: a meter or a little chart and the value, one metric to a row */
function machineMeters(s) {
  const mem = s.memory;
  const memPercent = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
  const disk = s.disks[0];
  const diskPercent = disk ? Math.round((disk.used / disk.total) * 100) : 0;
  return uiMeterFacts([
    s.cpu != null && { icon: "cpu", label: t("sys.cpu"), value: s.cpu, text: s.cpu + "%" },
    { icon: "memory", label: t("sys.memory"), value: memPercent, text: bytes(mem.used) },
    disk && { icon: "disk", label: t("sys.disk"), value: diskPercent, kind: "capacity", text: diskPercent + "%" },
    s.net && { icon: "network", label: t("sys.network"), spark: sparkline(s.history.net), text: bytes(s.net.rx + s.net.tx) + "/s" },
    s.temperature != null && { icon: "temp", label: t("sys.temperature"), value: s.temperature, text: s.temperature + " °C" },
  ]);
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

/** The block of another machine's numbers: who it is and its state, then its numbers or why there are none */
function machineBlock(id) {
  const m = machineOfBlock(id);
  if (!m) return null;
  let el = homeUi.widgets[id];
  if (!el) {
    el = widget(id, uiCard({ cls: "ui-home-machine" }));
    homeUi.widgets[id] = el;
  }
  const waiting = m.online && !m.status;
  el.classList.toggle("ui-away", !m.online);
  el.oncontextmenu = null;
  const head = uiBlockHead({ title: [h("a", { href: `#/machines/${m.id}`, class: "clip" }, m.name), uiState(m.online ? "ok" : "off", t(m.online ? "machines.online" : "machines.offline"))], actions: m.os && h("span", { class: "ui-row-time" }, m.os) });
  let body;
  if (!m.online) {
    const { buttons, openMore } = machineBack(m);
    body = uiEmpty({ text: t("machines.offlineLead", { ago: ago(m.seen) }), action: uiLine(buttons) });
    if (openMore) el.oncontextmenu = (e) => (e.preventDefault(), openMore({ x: e.clientX, y: e.clientY }));
  } else body = waiting ? uiEmpty({ size: "loading", text: t("home.machineWaiting") }) : h("div", { class: "ui-mfacts" }, machineMeters(m.status));
  put(el, head, body);
  return el;
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting = t(hour < 5 ? "home.night" : hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening", { name: state.user.name });
  // the blocks are made once and then only moved and refilled: the numbers of the system live in one of them
  // what needs attention and what happened are the administrators': a member's page has no such blocks
  homeUi.widgets = {
    stats: statsBlock(),
    attention: isAdmin() ? widget("attention", uiCard({ flush: true, cls: "ui-home-attention" })) : null,
    activity: isAdmin() ? widget("activity", uiCard({ flush: true, cls: "ui-home-activity" })) : null,
    adblock: isAdmin() ? widget("adblock", uiCard({ cls: "ui-home-adblock" })) : null,
    tv: isAdmin() && hasModule("tv") ? widget("tv", uiCard({ cls: "ui-home-tv" })) : null,
  };
  shell(
    h("div", { id: "grid-bar" }),
    pageHead({ id: "home-head", title: greeting, state: h("span", { id: "counts" }), facts: [h("span", { id: "host" }, " "), h("span", { id: "counts-rest" })], search: h("span", { id: "grid-edit-slot" }) }),
    // the grid draws itself into it (its classes are the grid's, set by paintGrid)
    h("div", { id: "pg" }),
  );
  Object.assign(gridUi, { arranging: false, undo: [], entry: null, drag: null });
  renderHomeBody();
}

const activityBody = (o) => [
  uiBlockHead({ title: t("activity.title"), pad: true, actions: isAdmin() && o.activity.length > 0 && h("a", { class: "ui-link", href: "#/activity" }, t("activity.all"), icon("chevron")) }),
  o.activity.length ? h("div", { class: "ui-rows ui-fits" }, o.activity.map((e) => activityItem(e))) : uiEmpty({ text: t("activity.none") }),
];

function attentionDialog(list) {
  openDialog("wide", h("h2", null, t("attention.title")), h("div", { class: "ui-rows ui-attention-list" }, list.map((item) => attentionItem(item))));
}

function attentionBlock(list) {
  const hidden = state.overview?.attentionHidden > 0 && h("a", { class: "ui-link", href: "#/settings/notifications/hidden" }, t("attention.hiddenLink", { n: state.overview.attentionHidden }), icon("chevron"));
  const more = uiEmpty({ text: " ", action: button(t("attention.showAll"), { class: "quiet small", onclick: () => attentionDialog(state.overview.attention) }) });
  more.classList.add("ui-fits-more");
  more.hidden = true;
  return [
    uiBlockHead({ title: [t("attention.title"), uiCount(list.length)], pad: true, actions: hidden }),
    list.length ? h("div", { class: "ui-rows ui-attention-list ui-fits" }, list.map((item) => attentionItem(item))) : uiEmpty({ icon: "check", tone: "ok", text: t("attention.none") }),
    more,
  ];
}

function renderHomeBody() {
  const o = state.overview;
  if (!o || !document.getElementById("pg") || !homeUi.widgets) return;
  const apps = o.apps;

  const count = (st) => apps.filter((a) => appState(a) === st).length;
  const counts = [["running", count("running")], ["restarting", count("restarting")], ["partial", count("partial")], ["stopped", count("stopped")]].filter(([, n]) => n > 0);
  // the worst of them is the state by the greeting; the others are said in words in the line under it
  const worst = counts.find(([st]) => st === "restarting") ?? counts.find(([st]) => st === "partial") ?? counts.find(([st]) => st === "running") ?? counts[0];
  const tone = { running: "ok", restarting: "bad", partial: "warn", stopped: "off" };
  document.getElementById("counts")?.replaceChildren(...(worst ? [uiState(tone[worst[0]], t("home.count." + worst[0], { n: worst[1] }))] : []));
  const rest = counts.filter((c) => c !== worst).map(([st, n]) => t("home.count." + st, { n })).join(" · ");
  const restBox = document.getElementById("counts-rest");
  if (restBox) {
    restBox.textContent = rest;
    restBox.hidden = !rest;
    const sep = restBox.previousElementSibling;
    if (sep?.classList.contains("ui-dot-sep")) sep.hidden = !rest;
  }

  paintGrid();
  renderFolder();
}

/** The picture of each of Hata's own blocks */
const BLOCKS = { stats: "cpu", attention: "alert", activity: "list", adblock: "shield", tv: "tv" };
const blockTitle = (id) => (id.startsWith("machine:") ? t("home.machineBlock", { name: machineOfBlock(id)?.name ?? id.slice(8) }) : t(id === "stats" ? "home.statsBlock" : id + ".title"));
const removeBlock = (id) => changeLayout((layout) => void takeTile(layout, "block:" + id));

function layoutTextDialog() {
  const area = uiCodeArea({ label: t("home.layoutText"), disabled: true });
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
  shell(h("div", { id: "app-head-box" }, h("div", { id: "app-head" })), h("div", { id: "app-tab" }));
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
  if (login.kind === "first-visit" || login.kind === "none") return h("p", { class: "muted small" }, t(`app.login.${login.kind}`));
  const box = h("div", { class: "stack-s" });
  const row = (label, value) => uiFacts([[label, uiCommand(value, { label })]]);
  const paint = () => {
    const given = loginSeen.get(ask.key);
    const seen = { ...login, ...(given ?? {}) };
    const waits = !given && login.ask?.length;
    const hiddenRow = (label) => uiFacts([[label, h("span", { class: "mono muted" }, "••••••••")]]);
    const missing = (label, words) => uiFacts([[label, h("span", { class: "muted small" }, words)]]);
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
      given?.line && h("p", { class: "muted small mono wrap" }, given.line),
      h("p", { class: "muted small" }, t(`app.login.${login.kind}`)),
      showButton && uiLine([showButton]),
    ].flat().filter(Boolean));
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
  dialog = openDialog("confirm", h("h2", null, t("app.notesOf", { title })), uiProse(md(tips), { soft: true }), h("footer", null, closeButton(() => dialog, t("common.close"))));
}

/** What can be done to an app from its tile: open it, start or stop it, go to its settings, logs and the rest */
function appTileMenu(app, anchor, at) {
  if (app.failedJob || app.job?.kind === "install") {
    const box = anchor?.getBoundingClientRect();
    return jobTileMenu(app, at ?? { x: box.left, y: box.bottom + 6 });
  }
  const url = isUp(app) ? appUrl(app) : null;
  const busy = !!app.job;
  const item = (label, iconName, run, cls = "", off = false) => ({ label, icon: iconName, run, danger: cls === "danger", off });
  const page = (label, iconName, tab) => ({ label, icon: iconName, href: `#/apps/${app.name}${tab ? "/" + tab : ""}` });
  // it hangs under the button it was opened from, by the button's right edge — or above it, when there is no room below
  menuAt(at ?? anchor, h("header", null, appIcon(app), h("div", null, h("h2", { class: "clip" }, app.title), stateChip(app))), [
    url && { label: t("app.open"), icon: "external", href: url, newTab: true },
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
  ]);
}

/** What the head of an app's page keeps in its "⋯" */
const appMoreEntries = (app) =>
  [
    isAdmin() && { label: t("assistant.ask"), icon: "chat", run: () => openAssistant({ draft: t("assistant.aboutApp", { title: app.title, app: app.name }) }) },
    isUp(app) && { label: t("app.restart"), icon: "refresh", off: !!app.job, run: () => startAction(app, "restart") },
    { label: t("app.update"), icon: "up", off: !!app.job, run: () => startAction(app, "update") },
    { label: t("machines.move"), icon: "server", off: !!app.job, run: () => moveAppDialog("", app) },
    { label: t("app.remove") + "…", icon: "trash", danger: true, off: !!app.job, run: () => removeDialog(app) },
  ].filter(Boolean);
function appMoreMenu(app, at = null) {
  menuAt(at ?? { x: innerWidth / 2, y: 120 }, menuHeader(app.title, t("status." + appState(app)), "box"), appMoreEntries(app));
}

function renderAppHead() {
  const app = state.app;
  const head = document.getElementById("app-head");
  if (!app || !head) return;
  const url = isUp(app) ? appUrl(app) : null;
  const tab = (id) => ({ label: t("app.tab." + id), href: `#/apps/${app.name}${id === "overview" ? "" : "/" + id}`, active: state.route.tab === id });
  const admin = isAdmin();
  const open = url && { label: t("app.open"), icon: "external", href: url, newTab: true, primary: true };
  const power = admin && (isUp(app) ? { label: t("app.stop"), icon: "stop", run: () => !app.job && startAction(app, "stop") } : { label: t("app.start"), icon: "play", primary: !url, run: () => !app.job && startAction(app, "start") });
  const made = pageHead({
    id: "app-head",
    crumbs: [{ label: t("home.apps"), href: "#/apps" }, { label: app.title }],
    logo: appIcon(app, "row"),
    title: app.title,
    state: appStateBadge(app),
    facts: [url && h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url.replace(/\/$/, ""), icon("external")), t("app.containersCount", { n: app.containers.length }), app.store && t("app.fromStore", { store: app.store })],
    actions: [open, power],
    more: admin ? () => appMoreEntries(app) : null,
    menu: admin && ((at) => appTileMenu(app, null, at)),
    tabs: admin && uiTabs(["overview", "settings", "logs", "compose", "backups", "terminal"].map(tab)),
  });
  // what waits for the person stands under the head: work going on, a newer version, a part that does not run
  const notices = admin && [
    app.job && uiNotice({ tone: "info", title: t("status.busy"), action: button(t("jobs.showLog"), { class: "small", onclick: () => jobDialog(app.job.id, app.job.kind, app.title) }, "logs") }),
    !app.job && app.update && uiNotice({ tone: "info", title: t("app.storeUpdateGo"), action: button(t("app.update") + "…", { class: "small", onclick: () => storeUpdateDialog(app) }, "up") }),
    !app.job && !app.update && app.newer?.length > 0 && uiNotice({ tone: "info", title: t("app.newer"), text: app.newer.join(", "), action: button(t("app.update"), { class: "small", onclick: () => startAction(app, "update") }, "up") }),
    (app.status === "partial" || app.status === "restarting") && uiNotice({ tone: "warn", title: t("status." + appState(app)), action: button(t("assistant.askWhy"), { class: "small", onclick: () => openAssistant({ ask: t("assistant.whyDown", { title: app.title, app: app.name }) }) }, "chat") }),
  ].filter(Boolean);
  const box = h("div", { class: "stack", id: "app-head-box" }, made, notices?.length > 0 && uiCard({}, notices));
  (document.getElementById("app-head-box") ?? head).replaceWith(box);
}

/** What the store's newer version changes in the app's compose file, before anything happens */
async function storeUpdateDialog(app) {
  let plan;
  try {
    plan = await api("GET", `/api/apps/${app.name}/storeupdate?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const rows = (kind) => plan.changes.filter((c) => c.kind === kind && !c.path.startsWith("x-casaos")).map((c) => ({ cells: [h("span", { class: "mono small", title: c.path }, c.path), h("div", { class: "mono small" }, h("div", { class: "muted clip" }, c.from || "—"), h("div", { class: "clip" }, c.to || t("update.removed")))], sub: `${c.from || "—"} → ${c.to || t("update.removed")}` }));
  const table = (kind) => uiCard({ flush: true }, uiTable([{ label: t("update.col.line") }, { label: t("update.col.change") }], rows(kind)));
  const fromStore = rows("store");
  const conflicts = rows("conflict");
  // in words first: which version becomes which, what is added; the lines of the file are for whoever asks
  const words = plan.words ?? [];
  const versions = words.filter((w) => w.code === "version");
  const several = new Set(words.map((w) => w.service).filter(Boolean)).size > 1;
  const WORD_ICONS = { image: "refresh", added: "plus", addedFirst: "plus", removed: "trash", envAdded: "sliders", envChanged: "sliders", envRemoved: "sliders", ports: "network", volumes: "folder", other: "code", files: "file" };
  const word = (w) => uiRow({ lead: { icon: WORD_ICONS[w.code] ?? "code" }, name: t("update.word." + w.code, w), sub: several && w.service && !["added", "addedFirst", "removed"].includes(w.code) ? t("update.word.in", w) : null });
  const others = words.filter((w) => w.code !== "version");
  const lead = versions.length ? "update.leadVersion" : plan.staying ? "update.leadSame" : "update.leadSetup";
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("update.title", { title: app.title })), h("p", { class: "muted small" }, t(lead, { store: plan.store, version: plan.staying }))), closeX(() => dialog)),
    !plan.exact && uiNotice({ tone: "warn", text: t(plan.recorded ? "update.guessed" : "update.matched", { store: plan.store }) }),
    plan.notes && uiProse(md(plan.notes), { soft: true, title: t("update.before") }),
    // the store's own words on why it changed the app's files: what the lines below cannot say
    plan.why && uiProse(h("p", null, plan.why), { soft: true, title: t("update.why", { store: plan.store }) }),
    versions.length > 0 && h("div", { class: "stack-s" }, versions.map((w) => uiVersionChange({ name: versions.length > 1 || w.name.replace(/[-_]/g, "") !== app.name.replace(/[-_]/g, "") ? w.name : t("update.version"), from: w.from, to: w.to }))),
    others.length > 0 && h("div", { class: "stack" }, uiSubhead({ title: t(versions.length ? "update.also" : "update.what") }), h("div", { class: "ui-rows" }, others.map(word))),
    words.length === 0 && fromStore.length > 0 && h("p", { class: "muted small" }, t("update.small")),
    conflicts.length > 0 && h("div", { class: "stack" }, uiSubhead({ title: t("update.conflicts"), lead: t("update.conflictsLead") }), table("conflict")),
    h("p", { class: "muted small" }, t(state.settings?.backup?.beforeUpdate ? "update.safe" : "update.safeNoCopy")),
    fromStore.length > 0 && h("details", null, h("summary", { class: "muted small" }, t("update.lines")), table("store")),
    h("details", null, h("summary", { class: "muted small" }, t("update.file")), uiCodeArea({ value: plan.compose, readOnly: true, label: "compose.yml" })),
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
  const box = h("div");
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
      uiCard(
        { title: t("app.access"), actions: h("a", { class: "ui-link", href: "#/settings/users/access" }, t("users.part.access"), icon("chevron")) },
        ...uiFacts([[t("app.accessWho"), who]]),
        a && uiSetting({ name: t("access.signIn"), explain: a.cannotProtect ? t("access.cannot." + a.cannotProtect) : a.protect ? t("app.accessGuarded") : t("access.onlyHidden"), control: uiSwitch({ on: a.protect, label: t("access.signIn"), disabled: !!a.cannotProtect, onchange: (on) => save({ protect: on }) }) }),
        // sign-in stands in front of the web port; the app's other ports are listed so that nobody takes them for closed
        a?.protect && a.others.length > 0 && uiField(t("access.others"), uiLine(a.others.map((o) => uiCheck(h("span", { class: "mono" }, String(o.port)), h("input", { type: "checkbox", checked: o.guarded, onchange: (e) => save({ ports: a.others.filter((x) => (x.port === o.port ? e.target.checked : x.guarded)).map((x) => x.port) }) })))), null, { group: true }),
      ),
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
  const running = app.containers.filter((c) => c.state === "running").length;
  const statsBox = h("div", { class: "ui-stats" }, statCell("app-cpu", "cpu", t("sys.cpu")), statCell("app-memory", "memory", t("sys.memory")), uiStat({ icon: "box", label: t("app.containers"), value: String(running), unit: "/ " + app.containers.length, hint: t("status." + app.status) }));

  const containerRow = (c) => {
    const s = app.stats?.[c.name];
    const menuEntries = [
      { label: t("app.logs"), icon: "logs", href: `#/apps/${app.name}/logs` },
      isAdmin() && { label: t("app.tab.terminal"), icon: "terminal", href: `#/apps/${app.name}/terminal` },
      { label: t("menu.copyName"), icon: "copy", run: () => copyText(c.name) },
      { label: t("menu.copyImage"), icon: "copy", run: () => copyText(c.image) },
    ].filter(Boolean);
    const menu = (at) => menuAt(at, menuHeader(c.name, c.image, "box"), menuEntries);
    const tone = c.state === "running" ? (app.newer?.includes(c.image) ? "warn" : "ok") : c.state === "restarting" ? "warn" : "off";
    return {
      menu,
      cells: [
        uiCell({ name: h("span", { class: "mono" }, c.name), sub: h("span", { class: "mono", title: c.image }, c.image) }),
        uiState(tone, app.newer?.includes(c.image) ? t("app.newerImage") : c.status),
        s ? s.cpu.toFixed(1) + " %" : "—",
        s ? bytes(s.memory) : "—",
        h("span", { class: "mono small" }, c.ports.join(", ") || "—"),
        uiMore(() => menuEntries, { size: "s" }),
      ],
      sub: [c.status, s && `${s.cpu.toFixed(1)} %`, s && bytes(s.memory)].filter(Boolean).join(" · "),
    };
  };

  const containersTable = () => uiTable([{ label: t("app.col.container") }, { label: t("app.col.state") }, { label: t("sys.cpu"), num: true }, { label: t("sys.memory"), num: true }, { label: t("app.col.ports") }, { label: "" }], app.containers.map(containerRow));
  put(box,
    appServiceCard(app),
    uiColumns(
      [
        uiCard({ title: t("app.resources"), flush: true }, statsBox),
        uiCard(
          { title: t("app.containers"), count: app.containers.length || null, flush: true },
          app.containers.length ? h("div", { id: "containers" }, containersTable()) : uiEmpty({ text: t("app.noContainers") }),
          app.containers.length > 0 && h("div", { class: "ui-inset" }, uiCommand(`docker compose -p ${app.name} ps`)),
        ),
      ],
      [
        uiCard({ title: t("app.glance") }, ...uiFacts([app.port && [t("app.address"), h("span", { class: "mono" }, appAddress(app))], [t("app.composeFile"), h("span", { class: "mono", title: app.composeFile }, app.composeFile)], ...app.folders.map((f, i) => [i ? "" : t("app.folders"), h("span", { class: "mono" }, f)]), [t("app.source"), app.store ? t("app.fromStore", { store: app.store }) : t("app.custom")], [t("app.installed"), new Date(app.installedAt).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" })]])),
        appAccessCard(app),
        app.login && uiCard({ title: t("app.login") }, loginBlock(app.login, loginAsker(app.name))),
        app.tips && uiCard({ title: t("app.notes") }, uiProse(md(app.tips), { soft: true })),
        uiCard({ title: t("activity.title"), flush: true }, app.activity.length ? app.activity.slice(0, 6).map((e) => activityItem(e)) : uiEmpty({ text: t("activity.none") })),
      ],
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
    document.getElementById("containers")?.replaceChildren(containersTable());
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
  const log = uiConsole({ page: true });
  const abort = new AbortController();
  cleanups.push(() => abort.abort());
  box.replaceChildren(uiConsoleFrame(`docker compose -p ${app.name} logs --follow --tail 200`, log));
  void streamLogs(app, log, abort.signal);
}

// --- Terminal ---------------------------------------------------------------------------------------

/** The terminal lives in a page of its own (the emulator needs a looser content policy), shown in a frame */
function terminalFrame(query = {}) {
  const params = new URLSearchParams({ ...query, lang: state.lang });
  return h("iframe", { class: "ui-term-frame", src: "/terminal.html?" + params, title: t("terminal.title") });
}

function renderTerminal() {
  shell(pageHead({ title: t("terminal.title"), facts: [t("terminal.hostHint")] }), terminalFrame());
  document.getElementById("view").classList.add("fill");
}

function appTerminalTab(app, box) {
  const running = app.containers.filter((c) => c.state === "running");
  if (!running.length) return box.replaceChildren(h("p", { class: "muted" }, t("error.terminal.notRunning")));
  const frame = h("div", { class: "ui-term-holder" });
  const open = (name) => frame.replaceChildren(terminalFrame({ app: app.name, container: name }));
  const pick = running.length > 1 && h("select", { "aria-label": t("terminal.container"), onchange: (e) => open(e.target.value) }, running.map((c) => h("option", { value: c.name }, c.service || c.name)));
  const line = uiConsoleFrame(`docker exec -it ${running[0].name} sh`, frame, pick);
  box.replaceChildren(line);
  if (pick) pick.addEventListener("change", () => (line.querySelector(".ui-console-cmd").lastChild.textContent = `docker exec -it ${pick.value} sh`));
  open(running[0].name);
}
