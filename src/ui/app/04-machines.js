// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Machines ---------------------------------------------------------------------------------------
// Other machines with Hata's client: their state, their containers and a terminal. The client connects
// to Hata, so whatever the page asks goes over that connection; `machine` events bring the state.

const machinesUi = { list: null, current: null, containers: null, apps: null };

async function loadMachines() {
  if (!hasModule("machines")) return;
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
  if (state.route.view !== "machine" || state.route.id !== event.id) return;
  if (event.status && state.route.tab === "overview") paintMachineStats(m);
  if (event.containers && state.route.tab === "containers") void loadMachineContainers();
}

const machineChip = (m) => uiState(m.online ? "ok" : "off", m.online ? t("machines.online") : t("machines.offline"));
const machineOs = (m) => [m.info?.os, m.info?.arch].filter(Boolean).join(" · ");

function renderMachines() {
  shell(h("div", { id: "machines-body" }, uiCard({}, uiEmpty({ size: "loading", text: t("machines.loading") }))));
  if (treeUi.data) renderMachinesBody();
  void loadTree();
  const timer = setInterval(() => void loadTree(), 10_000);
  cleanups.push(() => clearInterval(timer));
}

/** Everything the Machines page can gain, in one menu: a computer that is there, a container or a virtual machine made here, a Proxmox server, Home Assistant */
function addToMachinesMenu(at = null) {
  let dialog;
  // a row of the menu: what it adds and what it needs; one that cannot be done yet only says why
  const entry = (label, hint, iconName, action) => uiRow({ lead: { icon: iconName }, name: label, sub: hint, onclick: action ? () => (dialog.close(), action()) : null });
  const d = incusUi.data;
  // not ready yet — the page of containers says what is needed and has the button
  const here = (kind) => {
    if (!d || d.state === "blocked") return null;
    if (d.state !== "ready" || (kind === "vm" && d.vms?.state !== "ready")) return () => go("#/containers");
    return () => newContainerDialog(kind);
  };
  const hint = (kind) => {
    if (!d) return t("machines.addHere.unknown");
    if (d.state === "blocked") return t("machines.addHere.blocked");
    if (d.state === "missing") return t("machines.addHere.missing");
    if (d.state !== "ready") return t("incus.state." + d.state);
    if (kind === "vm" && d.vms?.state !== "ready") return t(d.vms?.state === "missing" ? "machines.addHere.vmMissing" : "machines.addHere.vmNo");
    return t(kind === "vm" ? "machines.addHere.vmHint" : "machines.addHere.containerHint");
  };
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("h2", null, t("machines.addWhat"))),
    h(
      "div",
      { class: "ui-rows" },
      hasModule("machines") && entry(t("machines.addExisting"), t("machines.addExistingHint"), "server", addMachineDialog),
      hasModule("containers") && entry(t("machines.addContainer"), hint("container"), "box", here("container")),
      hasModule("containers") && entry(t("machines.addVm"), hint("vm"), "box", here("vm")),
      hasModule("proxmox") && entry(t("machines.addPve"), t("machines.addPveHint"), "server", () => pveDialog()),
    ),
  );
  if (at) {
    // under the button, its right edge on the button's
    const r = at.getBoundingClientRect();
    placeAt(dialog, { x: r.right - dialog.offsetWidth, y: r.bottom + 4 });
    dialog.tabIndex = -1;
    dialog.focus();
  }
}

const treeUi = { data: null, closed: new Set(JSON.parse(localStorage.getItem("hata.tree") || "[]")), shown: "" };

async function loadTree() {
  try {
    treeUi.data = await api("GET", "/api/servers");
  } catch (e) {
    if (!treeUi.data) put(document.getElementById("machines-body"), uiCard({}, uiEmpty({ size: "error", text: errorText(e) })));
    return;
  }
  if (state.route.view === "machines") renderMachinesBody();
  paintServerMeta();
}

/** A menu opened by a button stands under it */
/** Where a menu opened by a button goes: the button itself — `placeAt` puts the menu under it, by its right edge */
const underButton = (el) => el;

const rowPage = (r) => (r.instance ? `#/containers/i/${r.instance}` : r.guest ? `#/guest/${r.guest.host}/${r.guest.id}` : r.machine ? `#/machines/${r.machine}` : r.instance ? `#/containers/i/${r.instance}` : `#/guest/${r.guest.host}/${r.guest.id}`);
const guestOfRow = (r) => ({ id: r.guest.id, type: r.guest.type, name: r.name, vmid: Number(r.guest.id.split("/")[1]), status: r.status, may: r.may });

/** How busy it is, in one line of the width of a column */
function treeLoad(cpu, memory) {
  if (cpu == null && !memory) return h("span", { class: "muted" }, "—");
  const percent = cpu != null ? Math.round(cpu) : memory?.total ? Math.round((memory.used / memory.total) * 100) : 0;
  return h("span", { class: "ui-tree-load" }, h("span", { class: "ui-tree-bar" }, uiMeter(percent, { kind: "load" })), cpu != null && h("span", { class: "mono" }, `${Math.round(cpu)}%`), memory && h("span", { class: "mono muted" }, memory.total ? `${bytes(memory.used)} / ${bytes(memory.total)}` : bytes(memory.used)));
}

/** A button of a row only where something is to be done: a stopped one is started, a sleeping one woken; the rest is in its "⋯" and on its page */
function treeAction(r) {
  const up = r.status === "running";
  const start = (run) => button(t("incus.start"), { class: "small", onclick: (e) => (e.stopPropagation(), run(e.currentTarget)) }, "play");
  if (!up) {
    if (r.instance) return start((el) => containerAct({ name: r.instance }, "start", el).then(() => loadTree()));
    if (r.guest && r.may.power) return start((el) => pvePower({ id: r.guest.host }, guestOfRow(r), r.status === "paused" ? "resume" : "start", el).then(() => loadTree()));
    if (r.machine && r.wakes && !r.guest) return button(t("machines.wake"), { class: "small", onclick: (e) => (e.stopPropagation(), wakeMachine({ id: r.machine, name: r.name }, e.currentTarget)) }, "power");
    return null;
  }
  return null;
}

/** Everything else a row can do: the menu of what it is */
function treeMenu(r, at) {
  const m = r.machine && machinesUi.list?.machines.find((x) => x.id === r.machine);
  const c = r.instance && incusUi.data?.containers?.find((x) => x.name === r.instance);
  if (c) return containerMenu(c, at);
  if (r.guest) {
    const x = { id: r.guest.host };
    const g = guestOfRow(r);
    const up = r.status === "running";
    return menuAt(at, menuHeader(r.name, r.os, r.kind === "vm" ? "server" : "box"), [
      { label: t("common.open"), icon: "arrow", href: rowPage(r) },
      r.may.power && !up && { label: t("pve.start"), icon: "play", run: () => pvePower(x, g, "start").then(() => loadTree()) },
      r.may.power && up && { label: t("pve.shutdown"), icon: "stop", run: () => pvePowerDialog(x, g, "shutdown") },
      r.may.power && up && { label: t("pve.reboot"), icon: "refresh", run: () => pvePowerDialog(x, g, "reboot") },
      m && { label: t("machines.rename"), icon: "edit", run: () => renameMachineDialog(m) },
    ]);
  }
  if (m) return machineMenu(m, at);
}

/** A row of a host's table: a computer, a container, a guest */
function treeRow(r) {
  const what = [t("tree.kind." + r.kind), r.os].filter(Boolean).join(" · ");
  const word = r.status === "away" ? t("machines.seen", { ago: ago(r.seen) }) : r.kind === "machine" ? t("machines.online") : t("pve.status." + r.status);
  const tone = r.status === "running" ? "ok" : r.status === "paused" ? "warn" : r.status === "away" ? "bad" : "off";
  const memory = r.memory && (r.memory.total ? `${bytes(r.memory.used)} / ${bytes(r.memory.total)}` : bytes(r.memory.used));
  return {
    href: rowPage(r),
    menu: (at) => treeMenu(r, at),
    cells: [
      h("span", { class: "ui-tree-name" }, h("strong", null, r.name), r.self && uiTag(t("pve.selfChip")), r.noBackup && uiTag(t("tree.noBackup"))),
      h("span", { class: "muted small" }, what),
      uiState(tone, word),
      treeLoad(r.cpu, r.memory),
      keepClick(uiLine([treeAction(r), h("button", { type: "button", class: "btn small square ui-more", "aria-label": t("app.more"), onclick: (e) => treeMenu(r, underButton(e.currentTarget)) }, icon("more"))], { end: true })),
    ],
    sub: [what, memory].filter(Boolean).join(" · "),
  };
}

/** A host — this server, a Proxmox server, the other computers — as a card with the table of what runs there */
function treeGroup(g) {
  const x = g.kind === "pve" && pveUi.list?.hosts?.find((y) => y.id === g.id);
  const page = g.kind === "here" ? "#/machines/this" : g.kind === "pve" ? `#/proxmox/${g.id}` : null;
  const head = {
    here: { chip: t("tree.thisServer"), what: [g.os, g.address, t("tree.up", { time: duration(g.uptime) })].filter(Boolean).join(" · "), state: uiState("ok", t("status.running")) },
    pve: { chip: "Proxmox", what: [g.os, g.online && t("tree.guests", { running: g.counts.running, all: g.counts.all })].filter(Boolean).join(" · "), state: uiState(g.online ? "ok" : "bad", g.online ? t("pve.online") : t("tree.noAnswer")) },
    others: { chip: "", what: t("tree.othersLead"), state: null },
  }[g.kind];
  const menu =
    g.kind === "here"
      ? (at) => menuAt(at, menuHeader(g.name, g.os, "server"), [
          { label: t("common.open"), icon: "arrow", href: "#/machines/this" },
          { label: t("terminal.title"), icon: "terminal", href: "#/terminal" },
          hasModule("containers") && { label: t("tree.containers"), icon: "box", href: "#/machines/this/containers" },
          hasModule("containers") && { label: t("tree.containersSettings"), icon: "settings", href: "#/machines/this/containers/settings" },
          { label: t("power.reboot"), icon: "refresh", run: () => serverPowerDialog("reboot") },
          { label: t("power.poweroff"), icon: "stop", danger: true, run: () => serverPowerDialog("poweroff") },
        ])
      : x
        ? (at) => pveMenu(x, at)
        : null;
  const load = g.kind !== "others" && (g.cpu != null || g.memory) && [g.cpu != null && t("tree.loadCpu", { n: Math.round(g.cpu) }), g.memory?.total && t("tree.loadMemory", { used: bytes(g.memory.used), total: bytes(g.memory.total) })].filter(Boolean).join(" · ");
  // a Proxmox server that does not answer keeps its one button: ask again
  const action = g.kind === "pve" && !g.online && button(t("tree.askAgain"), { class: "small", onclick: () => void loadPve().then(loadTree) }, "refresh");
  const title = page ? h("a", { href: page }, g.name) : t("tree.others");
  const columns = [{ label: t("tree.col.name") }, { label: t("tree.col.what") }, { label: t("tree.col.state") }, { label: t("tree.col.load") }, { label: "" }];
  return uiCard(
    {
      title,
      marks: [head.chip && uiTag(head.chip), head.state],
      lead: [head.what, load].filter(Boolean).join(" · "),
      flush: true,
      cls: "ui-tree-host",
      menu,
      actions: [action, menu && h("button", { type: "button", class: "btn small square ui-more", "aria-label": t("app.more"), onclick: (e) => menu(underButton(e.currentTarget)) }, icon("more"))].filter(Boolean),
    },
    g.rows.length ? uiTable(columns, g.rows.map(treeRow), { height: 44 }) : uiEmpty({ text: t(g.kind === "here" ? "server.containersNone" : "tree.none") }),
  );
}

async function updateClients(list, el) {
  if (el) el.disabled = true;
  for (const m of list) await updateMachine(m);
  void loadTree();
}

/** The whole page; redrawn only when something shows differently, or a hovered menu would flicker every few seconds */
function renderMachinesBody(force = false) {
  const box = document.getElementById("machines-body");
  const d = treeUi.data;
  if (!box || !d) return;
  const shown = JSON.stringify(d) + (pveUi.list ? "p" : "") + (machinesUi.list ? "m" : "") + (incusUi.data ? "c" : "");
  if (!force && shown === treeUi.shown && box.querySelector(".ui-tree")) return;
  treeUi.shown = shown;
  const meta = [t("tree.total", { total: d.total, running: d.running }), d.notAnswering > 0 && t("tree.metaNoAnswer", { n: d.notAnswering }), d.notConnected > 0 && t("tree.metaAway", { n: d.notConnected })].filter(Boolean).join(" · ");
  put(
    box,
    h(
      "div",
      { class: "stack ui-tree" },
      pageHead({ title: t("nav.machines"), facts: [meta], actions: [{ label: t("machines.addAny"), icon: "plus", primary: true, run: () => addToMachinesMenu(document.querySelector(".ui-tree .ui-head .ui-main")) }, { label: t("load.title"), icon: "chart", href: "#/machines/load" }] }),
      d.outdated.length > 0 && uiCard({}, uiNotice({ tone: "info", icon: "up", title: t("tree.outdated", { version: d.version }), text: d.outdated.map((m) => m.name).join(", "), action: button(t("tree.updateAll"), { class: "small", onclick: (e) => updateClients(d.outdated, e.currentTarget) }, "up") })),
      d.groups.map(treeGroup),
    ),
  );
}

// ---- Load: what takes the processor, the memory, the disk and the network, thing by thing

const loadUi = { data: null, sort: "cpu", all: new Set(), timer: 0 };
const LOAD_SHOWN = 12;
/** Units Hata itself puts on the system, and what a person calls them */
const LOAD_UNITS = { "hata-tv": "load.unit.tv", "hata-music": "load.unit.music", "hata-speaker": "load.unit.speaker", smbd: "load.unit.samba", nmbd: "load.unit.samba", bluetooth: "load.unit.bluetooth" };
const LOAD_NAMED = ["hata", "engine", "system", "rest"];

/** What a row is called on the page */
function loadName(row, place) {
  if (LOAD_NAMED.includes(row.kind)) return t("load.kind." + row.kind);
  if (row.kind === "sessions") return t("load.sessionsOf", { user: row.name });
  if (row.kind === "service" && LOAD_UNITS[row.name]) return t(LOAD_UNITS[row.name]);
  if (row.kind === "app" && place?.kind === "here") return state.overview?.apps?.find((a) => a.name === row.name)?.title ?? row.name;
  return row.name;
}

/** Where a row leads: the thing's own page, when it has one */
function loadHref(row, place) {
  const machine = place.kind === "machine" ? place.id.slice(8) : "";
  if (row.kind === "app") return place.kind === "here" ? (state.overview?.apps?.some((a) => a.name === row.name) ? `#/apps/${row.name}` : "") : `#/apps/${row.name}@${machine}`;
  if (row.kind === "instance" && place.kind === "here") return `#/containers/i/${row.name}`;
  if (row.kind === "guest") return `#/guest/${place.id.split(":")[1]}/${row.key.slice(6)}`;
  if (row.kind === "engine" && place.kind === "here") return "#/machines/this/docker";
  return "";
}

const rateText = (n) => (n < 1024 ? "0" : bytes(n) + "/s");
/** Both directions in one cell: "0" when nothing moves, "—" when it is not counted apart (a network shared with the host) */
const twoWays = (a, b) => (a == null ? "—" : a < 1024 && b < 1024 ? "0" : `↓ ${rateText(a)} · ↑ ${rateText(b)}`);
const ioOf = (r) => r.read + r.write;
const netOf = (r) => (r.rx ?? 0) + (r.tx ?? 0);
const LOAD_SORTS = { cpu: (r) => r.cpu, memory: (r) => r.memory, disk: ioOf, net: netOf };

/** An hour of a row in a line as wide as its cell: the processor */
function loadLine(values) {
  const W = 120, H = 26;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "ui-load-line");
  svg.setAttribute("aria-hidden", "true");
  const top = Math.max(10, ...values.filter((v) => v != null));
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) return void (pen = false);
    const x = values.length < 2 ? W : (i / (values.length - 1)) * W;
    const y = H - 2 - (v / top) * (H - 4);
    d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    pen = true;
  });
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function renderLoad() {
  shell(h("div", { id: "load-body" }, waitMark()));
  if (loadUi.data) paintLoad();
  void loadLoad();
  const timer = setInterval(() => void loadLoad(), 5000);
  cleanups.push(() => clearInterval(timer));
}

async function loadLoad() {
  try {
    loadUi.data = await api("GET", "/api/load");
  } catch (e) {
    const box = document.getElementById("load-body");
    if (box && !loadUi.data) put(box, uiCard({}, uiEmpty({ size: "error", text: errorText(e) })));
    return;
  }
  if (state.route.view === "load") paintLoad();
}

function paintLoad() {
  const box = document.getElementById("load-body");
  const d = loadUi.data;
  if (!box || !d) return;
  const at = state.route.place ?? "";
  const shown = at ? d.places.filter((p) => p.id === at) : d.places;
  const placeLabel = (p) => (p.kind === "here" ? t("load.here", { name: p.name }) : p.kind === "pve" && p.host !== p.name ? `${p.host} · ${p.name}` : p.name);
  const w = d.warn;
  const places = [{ value: "", label: t("load.all"), href: "#/machines/load" }, ...d.places.map((p) => ({ value: p.id, label: placeLabel(p), href: `#/machines/load/${p.id}` }))];
  put(
    box,
    pageHead({ crumbs: [{ label: t("nav.machines"), href: "#/machines" }, { label: t("load.title") }], title: t("load.title"), facts: [t("load.lead", { n: d.minutes })], actions: [{ label: t("load.warn.button"), icon: "bell", run: loadWarnDialog }] }),
    uiCard({}, uiNotice({ tone: w.warn ? "info" : "off", icon: "bell", text: w.warn ? t("load.warn.on", { cpu: w.cpu, minutes: w.minutes }) : t("load.warn.off") }), d.places.length > 1 && uiSegment(places, at, (v) => go(v ? `#/machines/load/${v}` : "#/machines/load"), { label: t("load.title") })),
    shown.map((p) => loadPlace(p, placeLabel(p))),
    !shown.length && uiCard({}, uiEmpty({ size: "big", icon: "chart", title: t("load.nothing") })),
  );
}

function loadPlace(p, label) {
  const sortBy = LOAD_SORTS[loadUi.sort];
  // what is left over is not somebody: it stays at the end whatever the order
  const rows = [...p.rows].sort((a, b) => Number(a.kind === "rest") - Number(b.kind === "rest") || sortBy(b) - sortBy(a));
  const all = loadUi.all.has(p.id);
  const list = all ? rows : rows.slice(0, LOAD_SHOWN);
  const memPercent = p.memory.total ? Math.round((p.memory.used / p.memory.total) * 100) : 0;
  const head = (id, text) => ({ label: text, num: true, sorted: loadUi.sort === id ? "descending" : null, sort: () => ((loadUi.sort = id), paintLoad()) });
  const old = Date.now() - p.at > 60_000;
  return uiCard(
    {
      title: label,
      count: t("load.cores", { n: p.cores }),
      flush: true,
      cls: "ui-load-place",
      actions: [h("span", { class: "ui-row-time" }, t("load.total", { cpu: p.cpu ?? "—", used: bytes(p.memory.used), total: bytes(p.memory.total), percent: memPercent })), p.power && p.power.total !== null && button(t("power.draw", { watts: p.power.total }), { class: "small", title: t("power.drawTitle"), onclick: () => drawDialog(p) }, "power")].filter(Boolean),
    },
    old && h("div", { class: "ui-inset" }, uiNotice({ tone: "warn", text: t("load.stale", { time: ago(p.at) }) })),
    !rows.length
      ? uiEmpty({ text: t(p.kind === "machine" ? "load.soonMachine" : "load.soon") })
      : uiTable([{ label: t("load.col.what") }, head("cpu", t("load.col.cpu")), head("memory", t("load.col.memory")), head("disk", t("load.col.disk")), head("net", t("load.col.net")), { label: t("load.col.hour") }], list.map((r) => loadRow(r, p)), { cls: "ui-load-table" }),
    rows.length > LOAD_SHOWN && uiEmpty({ text: " ", action: button(all ? t("load.fewer") : t("load.more", { n: rows.length - LOAD_SHOWN }), { class: "quiet small", onclick: () => (all ? loadUi.all.delete(p.id) : loadUi.all.add(p.id), paintLoad()) }) }),
  );
}

/** What the processor draws, over the hour: the kernel's counters, not the wall socket */
function drawDialog(place) {
  const p = place.power;
  let dialog;
  const now = Date.now();
  const points = p.hour.map((w, i) => ({ t: now - (60 - i) * 60_000, w }));
  dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("power.drawTitle")), h("p", { class: "muted small" }, t("power.drawLead"))), closeX(() => dialog)),
    h("div", null, uiFacts(p.zones.map((z) => [(z.top ? "" : "↳ ") + (has("power.zone." + z.name.replace(/-\d+$/, "")) ? t("power.zone." + z.name.replace(/-\d+$/, ""), { n: z.name.replace(/^\D+-?/, "") }) : z.name), h("strong", null, z.watts === null ? "—" : t("power.draw", { watts: z.watts }))]))),
    p.hour.some((w) => w !== null) ? lineChart(points, [{ cls: "ui-chart-s2", label: t("power.drawTitle"), value: (x) => x.w }], { max: null, fmt: (v) => t("power.draw", { watts: Math.round(v * 10) / 10 }), label: t("power.drawTitle"), height: 140 }) : h("p", { class: "muted small" }, t("load.soonRow")),
    h("footer", null, closeButton(() => dialog)),
  );
}

function loadRow(r, p) {
  const name = loadName(r, p);
  const app = r.kind === "app" && p.kind === "here" ? state.overview?.apps?.find((a) => a.name === r.name) : null;
  const over = loadUi.data.warn.warn && r.over > 0 && r.cpu >= loadUi.data.warn.cpu;
  const kind = [t("load.kindOf." + r.kind), r.parts?.length > 1 && t("load.parts", { n: r.parts.length })].filter(Boolean).join(" · ");
  return {
    onclick: () => loadRowDialog(r, p),
    cls: over ? "ui-tr-warn" : null,
    cells: [
      uiCell({ lead: app ? appIcon(app, "row") : { icon: LOAD_ICONS[r.kind] ?? "box" }, name, sub: kind }),
      over ? uiState("warn", `${r.cpu}%`) : `${r.cpu}%`,
      bytes(r.memory),
      h("span", { class: "small" }, twoWays(r.read, r.write)),
      h("span", { class: "small", title: r.rx == null ? t("load.hostNet") : null }, twoWays(r.rx, r.tx)),
      loadLine(r.trend.cpu.concat([r.cpu])),
    ],
    sub: [`${r.cpu}%`, bytes(r.memory)].join(" · "),
  };
}

const LOAD_ICONS = { hata: "home", app: "grid", container: "box", instance: "box", engine: "box", service: "sliders", sessions: "terminal", system: "server", machine: "box", rest: "cpu", guest: "box" };

/** One thing over the hour: the processor and the memory as lines, its containers, its page */
function loadRowDialog(r, p) {
  let dialog;
  const href = loadHref(r, p);
  const n = r.trend.cpu.length;
  const now = Date.now();
  const points = r.trend.cpu.map((cpu, i) => ({ t: now - (n - i) * MINUTE_MS, cpu, memory: r.trend.memory[i] }));
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "clip" }, loadName(r, p)), h("p", { class: "muted small" }, t("load.kindOf." + r.kind) + " · " + (p.kind === "here" ? t("load.here", { name: p.name }) : p.name))),
    n < 2 ? h("p", { class: "muted" }, t("load.soonRow")) : [
      lineChart(points, [{ cls: "ui-chart-s2", label: t("load.col.cpu"), value: (x) => x.cpu }], { max: null, fmt: (v) => Math.round(v) + "%", label: t("load.col.cpu"), height: 140 }),
      lineChart(points, [{ cls: "ui-chart-s1", label: t("load.col.memory"), value: (x) => x.memory }], { max: null, fmt: (v) => bytes(v), label: t("load.col.memory"), height: 140 }),
    ],
    r.parts?.length > 0 && uiTable([{ label: t("load.col.container") }, { label: t("load.col.cpu"), num: true }, { label: t("load.col.memory"), num: true }, { label: t("load.col.disk"), num: true }, { label: t("load.col.net"), num: true }], r.parts.map((c) => ({ cells: [c.name, `${c.cpu}%`, bytes(c.memory), twoWays(c.read, c.write), twoWays(c.rx, c.tx)], sub: `${c.cpu}% · ${bytes(c.memory)}` })), { height: 44 }),
    r.kind === "rest" && h("p", { class: "muted small" }, t("load.restHint")),
    h("footer", null, href && button(t("load.open"), { class: "primary", onclick: () => (dialog.close(), go(href)) }, "chevron"), closeButton(() => dialog)),
  );
}

/** When a thing that holds the processor is worth a word in "Needs attention" */
function loadWarnDialog() {
  let dialog;
  const w = loadUi.data?.warn ?? { warn: true, cpu: 80, minutes: 10 };
  const on = h("input", { type: "checkbox", checked: w.warn });
  const cpu = h("input", { type: "number", min: 20, max: 100, step: 1, value: w.cpu, class: "short" });
  const minutes = h("input", { type: "number", min: 2, max: 60, step: 1, value: w.minutes, class: "short" });
  const error = h("p", { class: "error", role: "alert" });
  dialog = openDialog(
    "",
    h("h2", null, t("load.warn.title")),
    h("p", { class: "muted" }, t("load.warn.lead")),
    uiCheck(t("load.warn.tick"), on),
    uiField(t("load.warn.cpu"), uiLine([cpu, h("span", { class: "muted" }, "%")]), t("load.warn.cpuHint")),
    uiField(t("load.warn.minutes"), minutes, t("load.warn.minutesHint")),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("settings.save"), {
        class: "primary",
        onclick: async () => {
          try {
            await api("PUT", "/api/settings", { load: { warn: on.checked, cpu: Number(cpu.value), minutes: Number(minutes.value) } });
            dialog.close();
            void loadLoad();
            void refresh();
          } catch (e) {
            error.textContent = errorText(e);
          }
        },
      }, "check"),
    ),
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
        paintCmd();
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
  // the line to type, copied whole; made again when the address or the code changes
  const cmd = h("div");
  const paintCmd = () => put(cmd, uiCommand(line(), { block: true }));
  paintCmd();
  const waiting = h("div", null, uiEmpty({ size: "loading", text: t("machines.addWaiting") }));
  let dialog;
  const pick =
    addresses.length > 1 &&
    uiField(t("machines.addAddress"), h("select", { onchange: (e) => ((address = e.target.value), paintCmd(), explain()) }, addresses.map((a) => h("option", { value: a }, t("machines.addVia." + kindOf(a), { address: a })))), about);
  explain();
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("machines.addTitle")), closeX(() => dialog)),
    h("p", null, t("machines.addLead")),
    pick,
    cmd,
    h("p", { class: "muted small" }, t("machines.addHint", { minutes: Math.round(invite.valid / 60000) })),
    h("p", { class: "muted small" }, t("machines.addNeeds")),
    uiCheck(t("machines.people.tick"), people, t("machines.people.tickHint")),
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
    put(waiting, uiNotice({ tone: "ok", text: t("machines.addDone", { name: fresh.name }), action: h("a", { class: "btn small primary", href: `#/machines/${fresh.id}`, onclick: () => dialog.close() }, t("common.open")) }));
    stop();
  };
  const timer = setInterval(look, 3000);
  const stop = () => clearInterval(timer);
  dialog.addEventListener("close", stop);
}

// --- Containers on this server (Incus) ---
// Incus keeps them; Hata installs it by a button, sets it up, makes containers with its client in them

const incusUi = { data: null };

async function loadContainers() {
  if (!hasModule("containers")) return;
  try {
    incusUi.data = await api("GET", "/api/containers");
  } catch (e) {
    incusUi.data = { state: "error", error: errorText(e), containers: [] };
  }
  if (state.route.view === "containers") renderContainersBody();
  if (state.route.view === "server" && state.route.tab !== "apps") renderServerBody();
  if (state.route.view === "machines") renderMachinesBody();
  if (state.route.view === "instance") renderInstanceBody();
  if (state.route.view === "machine" && state.route.tab === "overview") paintMachineExtra();
}

const incusStatus = (c) => uiState(c.status === "running" ? "ok" : c.status === "error" ? "bad" : "off", t("incus.status." + c.status));

/** A machine that is a container or a virtual machine of this server is started, not woken */
function startInstanceOf(m, el) {
  if (el) el.disabled = true;
  api("POST", `/api/containers/${m.instance}/state`, { action: "start" }).then(() => void loadMachines(), (e) => {
    if (el) el.disabled = false;
    toast(errorText(e), "error");
  });
}

function renderContainers() {
  shell(
    areaHead("server", "containers"),
    uiCard({ flush: true, cls: "ui-filters ui-incus-bar" }, h("span", { id: "incus-tabs", hidden: true }, uiSegment([{ value: "list", label: t("incus.tab.list"), href: "#/machines/this/containers" }, { value: "settings", label: t("incus.tab.settings"), href: "#/machines/this/containers/settings" }], state.route.tab === "settings" ? "settings" : "list")), h("span", { class: "muted small grow", id: "incus-meta" }, t("incus.lead")), h("div", { class: "ui-line", id: "incus-actions" })),
    h("div", { id: "incus-body", class: "stack" }),
  );
  if (incusUi.data) renderContainersBody();
}

function renderContainersBody() {
  const box = document.getElementById("incus-body");
  const actions = document.getElementById("incus-actions");
  const d = incusUi.data;
  if (!box || !d) return;
  put(actions, d.state === "ready" && button(t(d.vms?.state === "ready" ? "incus.newAny" : "incus.new"), { class: "primary", onclick: () => newContainerDialog() }, "plus"));
  if (d.state === "error") return put(box, uiCard({}, uiEmpty({ size: "error", title: t("incus.title"), text: d.error, action: button(t("ui.retry"), { onclick: () => void loadContainers() }) })));
  if (d.state === "blocked") return put(box, uiCard({}, uiEmpty({ size: "big", icon: "box", title: t("incus.blocked.title"), text: t("incus.blocked." + d.why) + " " + t("incus.blocked.how") })));
  if (d.state === "missing") {
    const install = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await api("POST", "/api/containers/install", { place: incusUi.place ?? "" });
        void jobDialog(r.job, "incus", "Incus", () => void loadContainers());
      } catch (err) {
        toast(errorText(err), "error");
      }
      e.target.closest("button").disabled = false;
    };
    return put(
      box,
      uiCard(
        { title: t("incus.missing.title"), lead: t("incus.missing.lead") },
        uiGives(["system", "docker", "machine", "snapshots"].map((k) => t("incus.gives." + k))),
        uiNeedProgram({ name: "Incus", why: t("incus.missing.what"), command: d.install, run: d.install ? install : null }),
        !d.install && uiNotice({ tone: "warn", text: t("incus.missing.byHand") }),
        d.install && installPlaceRow(),
      ),
    );
  }
  if (d.state === "setup") {
    const setup = async (e) => {
      e.currentTarget.disabled = true;
      try {
        incusUi.data = await api("POST", "/api/containers/setup");
        renderContainersBody();
      } catch (err) {
        toast(errorText(err), "error");
        e.target.closest("button").disabled = false;
      }
    };
    return put(box, uiCard({}, uiEmpty({ size: "big", icon: "box", title: t("incus.setup.title"), text: t("incus.setup.lead"), action: button(t("incus.setup.button"), { class: "primary", onclick: setup }, "check") })));
  }
  document.getElementById("incus-tabs").hidden = false;
  if (state.route.tab === "settings") return put(box, homeNetCard(d), incusPlacesCard(d), d.vms?.state === "ready" && discsCard(d), vmCard(d));
  const vmCount = d.containers.filter((c) => c.kind === "vm").length;
  document.getElementById("incus-meta").textContent = [t("incus.countN", { n: d.containers.length - vmCount }), vmCount > 0 && t("incus.vm.countN", { n: vmCount }), d.version && "Incus " + d.version, d.network && t("incus.network", { name: d.network.name, address: d.network.address })].filter(Boolean).join(" · ");
  if (!d.containers.length) return put(box, uiCard({}, uiEmpty({ size: "big", icon: "box", title: t("incus.none"), text: t("incus.noneLead"), action: button(t("incus.new"), { class: "primary", onclick: () => newContainerDialog() }, "plus") })));
  put(box, uiCard({ flush: true }, uiTable([{ label: t("incus.col.name") }, { label: t("incus.col.state") }, { label: t("incus.col.address") }, { label: t("incus.col.use") }, { label: "" }], d.containers.map((c) => containerRow(c)))));
}

/** Where new ones sit: the home network once its bridge is there, or the way to make it */
function homeNetCard(d) {
  const home = d.home;
  return uiCard({
    title: t("incus.net.title"),
    actions: home ? h("a", { class: "btn small", href: "#/settings/network" }, t("incus.net.settings")) : button(t("incus.net.make"), { class: "small", onclick: () => homeBridgeDialog(null, () => void loadContainers()) }, "box"),
    lead: home ? t("incus.net.on", { bridge: home.name, address: home.address || "—" }) : t("incus.net.off", { network: d.network?.name ?? "" }),
  });
}

/** Virtual machines: a test feature of their own, with what it needs and what it cannot do yet */
function vmCard(d) {
  const vms = d.vms;
  if (!vms || vms.state === "ready") return null;
  const head = { title: t("incus.vm.title"), marks: uiTag(t("incus.vm.test")) };
  if (vms.state !== "missing") return uiCard({ ...head, lead: t("incus.vm." + vms.state) });
  return uiCard(
    { ...head, lead: t("incus.vm.lead") },
    uiGives(["limits", "images", "screen", "space"].map((k) => t("incus.vm.limit." + k))),
    vms.install ? uiCommand(vms.install) : uiNotice({ tone: "warn", text: t("incus.missing.byHand") }),
    vms.install &&
      uiLine([
        button(
          t("incus.vm.install"),
          {
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const r = await api("POST", "/api/containers/vms/install");
                void jobDialog(r.job, "incus", "QEMU", () => void loadContainers());
              } catch (err) {
                toast(errorText(err), "error");
              }
              e.target.closest("button").disabled = false;
            },
          },
          "download",
        ),
      ]),
  );
}

/** Where Incus is to keep the containers, chosen before it is installed: the system disk unless another folder is picked */
function installPlaceRow() {
  const shown = h("span", { class: "grow mono small clip" });
  const reset = button(t("incus.place.system"), { class: "small ghost", onclick: () => ((incusUi.place = ""), paint()) });
  const paint = () => {
    shown.textContent = incusUi.place || t("incus.place.systemPath");
    reset.hidden = !incusUi.place;
  };
  paint();
  return uiSetting({
    name: t("incus.place.where"),
    explain: t("incus.place.whereHint"),
    wide: true,
    control: uiLine([icon("folder"), shown, reset, button(t("incus.place.choose"), { class: "small", onclick: () => folderPicker({ title: t("incus.place.pickTitle"), start: "/mnt", confirmLabel: t("incus.place.pickHere"), action: (path) => ((incusUi.place = path), paint()) }) }, "folder")]),
  });
}

/** The places containers live in: room, which one new ones go to, another one added */
function incusPlacesCard(d) {
  const list = d.places ?? [];
  const act = async (el, method, path, body) => {
    if (el) el.disabled = true;
    try {
      await api(method, path, body);
      await loadContainers();
    } catch (e) {
      toast(errorText(e), "error");
      if (el) el.disabled = false;
    }
  };
  const add = () =>
    folderPicker({
      title: t("incus.place.addTitle"),
      start: "/mnt",
      confirmLabel: t("incus.place.pickHere"),
      // a refusal stays in the window, where another folder can be chosen at once
      action: async (path) => {
        await api("POST", "/api/containers/places", { path });
        toast(t("incus.place.added", { path }));
        await loadContainers();
      },
    });
  return uiCard(
    { title: t("incus.place.title"), lead: t("incus.place.lead"), flush: true, actions: button(t("incus.place.add"), { class: "small", onclick: add }, "plus") },
    h(
      "div",
      { class: "ui-rows" },
      list.map((p) => {
        const percent = p.total ? Math.round((p.used / p.total) * 100) : 0;
        const room = [p.total ? t("sys.free", { free: bytes(p.total - p.used), total: bytes(p.total) }) : null, t("incus.place.instancesN", { n: p.instances })].filter(Boolean).join(" · ");
        return uiRow({
          lead: { icon: "disk", tone: p.away ? "bad" : null },
          name: [p.name, p.standard && " ", p.standard && uiTag(t("incus.place.standard"))],
          sub: [h("span", { class: "mono" }, (p.path || t("incus.place.systemPath")) + " · " + p.driver), " · ", room, p.away && h("div", null, t("incus.place.awayHint"))],
          meter: p.total > 0 && uiMeter(percent),
          state: p.away && uiState("bad", t("incus.place.away")),
          action: !p.standard && button(t("incus.place.makeStandard"), { class: "small", onclick: (e) => act(e.currentTarget, "PUT", `/api/containers/places/${p.name}`) }, "check"),
          more: !p.standard && !p.profile && !p.instances ? [{ label: t("incus.place.remove"), icon: "trash", danger: true, run: () => act(null, "DELETE", `/api/containers/places/${p.name}`) }] : null,
        });
      }),
    ),
  );
}

/** Disc images (ISO) for virtual machines installed from them: what is kept, and the ways to add one */
function discsCard(d) {
  const list = d.discs ?? [];
  return uiCard(
    {
      title: t("incus.disc.title"),
      lead: t("incus.disc.lead"),
      flush: true,
      actions: [
        button(t("incus.disc.fromLink"), { class: "small", onclick: () => discAddDialog({ how: "url" }) }, "link"),
        button(t("incus.disc.fromHere"), { class: "small", onclick: () => discAddDialog({ how: "local" }) }, "upload"),
        !list.some((x) => /^virtio-win/i.test(x.name)) && button(t("incus.win.drivers"), { class: "small", title: t("incus.win.driversHint"), onclick: (e) => addDrivers(e.currentTarget) }, "download"),
      ].filter(Boolean),
    },
    list.length === 0
      ? uiEmpty({ text: t("incus.disc.none") })
      : h(
          "div",
          { class: "ui-rows" },
          list.map((x) =>
            uiRow({
              lead: { icon: "disk" },
              name: x.name,
              sub: [x.size ? bytes(x.size) : null, (d.places ?? []).length > 1 && x.place, x.usedBy.length ? t("incus.disc.usedBy", { names: x.usedBy.join(", ") }) : null].filter(Boolean).join(" · "),
              action: button(t("incus.disc.makeVm"), { class: "small", onclick: () => newDiscVm(x) }, "plus"),
              more: [{ label: t("incus.disc.remove"), icon: "trash", danger: true, off: x.usedBy.length > 0, run: () => removeDiscDialog(x) }],
            }),
          ),
        ),
  );
}

/** Fedora's disc of virtio drivers, which Windows needs for its network: downloaded once */
async function addDrivers(el) {
  el.disabled = true;
  try {
    const r = await api("POST", "/api/containers/discs", { drivers: true });
    void jobDialog(r.job, "disc", r.name, () => void loadContainers());
  } catch (e) {
    toast(errorText(e), "error");
    el.disabled = false;
  }
}

/** The new-machine dialog with this disc chosen */
function newDiscVm(x) {
  newContainerDialog("vm");
  const image = document.querySelector("dialog[open] form select");
  if (!image) return;
  image.value = `disc:${x.place}/${x.name}`;
  image.dispatchEvent(new Event("change"));
}

/**
 * A disc image added by a link, from this computer (the browser sends the file as the body) or from a file of
 * this server (`path`); Incus keeps it in a place.
 */
async function discAddDialog({ how, path = "" }) {
  let d = incusUi.data;
  if (!d || d.state !== "ready") {
    try {
      d = incusUi.data = await api("GET", "/api/containers");
    } catch (e) {
      return toast(errorText(e), "error");
    }
  }
  if (d.state !== "ready" || d.vms?.state !== "ready") return toast(t("incus.disc.noVms"), "error");
  const places = d.places ?? [];
  const place = h("select", null, places.map((p) => h("option", { value: p.name, selected: p.standard }, `${p.name} — ${p.path || t("incus.place.systemPath")}${p.total ? " · " + t("incus.place.freeShort", { free: bytes(p.total - p.used) }) : ""}`)));
  const url = h("input", { type: "url", required: how === "url", placeholder: "https://…/debian-13-amd64-netinst.iso", class: "mono", spellcheck: false });
  const picked = h("input", { type: "file", required: how === "local", accept: ".iso" });
  const meter = h("div", null, uiMeter(0, { kind: "progress" }));
  const progress = h("div", { class: "stack-s", hidden: true }, meter, h("p", { class: "muted small" }));
  const error = h("p", { class: "error", role: "alert" });
  const stay = (e) => e.preventDefault();
  let dialog;
  const done = (name) => {
    dialog.removeEventListener("cancel", stay);
    dialog.close();
    toast(t("incus.disc.added", { name }));
    void loadContainers();
  };
  const sendLocal = (go) => {
    const f = picked.files[0];
    if (!f) return void (go.disabled = false);
    progress.hidden = false;
    const said = progress.querySelector("p");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/containers/discs/upload?${new URLSearchParams({ place: place.value, name: f.name })}`);
    xhr.upload.onprogress = (e) => {
      const percent = e.total ? Math.floor((e.loaded / e.total) * 100) : 0;
      put(meter, uiMeter(percent, { kind: "progress" }));
      said.textContent = percent < 100 ? t("pve.send.sending", { done: bytes(e.loaded), size: bytes(f.size) }) : t("incus.disc.placing");
    };
    const failed = (text) => ((error.textContent = text), (progress.hidden = true), (go.disabled = false), dialog.removeEventListener("cancel", stay));
    xhr.onerror = () => failed(t("error.network"));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status < 200 || xhr.status >= 300) return failed(errorText(new ApiError(xhr.status, payload.error?.code ?? "request.failed", payload.error?.detail)));
      done(payload.name ?? f.name);
    };
    // Escape would cut the sending off
    dialog.addEventListener("cancel", stay);
    xhr.send(f);
  };
  const submit = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const go = dialog.querySelector("button[type=submit]");
    go.disabled = true;
    if (how === "local") return sendLocal(go);
    try {
      const r = await api("POST", "/api/containers/discs", { place: place.value, ...(how === "url" ? { url: url.value.trim() } : { path }) });
      dialog.close();
      void jobDialog(r.job, "disc", r.name, () => void loadContainers());
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: submit },
      h("header", null, h("h2", { class: "grow wrap" }, how === "path" ? t("incus.disc.fileTitle", { name: path.split("/").pop() }) : t(how === "url" ? "incus.disc.linkTitle" : "incus.disc.localTitle")), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("incus.disc.addLead")),
      how === "url" && field(t("incus.disc.url"), url, t("incus.disc.urlHint")),
      how === "local" && field(t("pve.send.file"), picked),
      places.length > 1 && field(t("incus.place.label"), place),
      progress,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon(how === "url" ? "download" : "upload"), h("span", null, t("incus.disc.add")))),
    ),
  );
  (how === "url" ? url : how === "local" ? picked : dialog.querySelector("button[type=submit]")).focus();
}

function removeDiscDialog(x) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", null, t("incus.disc.removeTitle", { name: x.name })),
    h("p", { class: "muted" }, t("incus.disc.removeLead")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("incus.disc.remove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("DELETE", `/api/containers/discs/${encodeURIComponent(x.place)}/${encodeURIComponent(x.name)}`);
            dialog.close();
            void loadContainers();
          } catch (err) {
            toast(errorText(err), "error");
            e.target.closest("button").disabled = false;
          }
        },
      }, "trash"),
    ),
  );
}

/** The disc out of the drive: the machine boots from its own disk afterwards */
async function ejectDisc(c) {
  try {
    await api("POST", `/api/containers/${c.name}/eject`);
    toast(t("incus.disc.ejected", { name: c.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  void loadContainers();
}

/** Moves a container or virtual machine to another place */
function moveContainerDialog(c) {
  const d = incusUi.data;
  const others = (d.places ?? []).filter((p) => p.name !== c.place);
  const select = h("select", null, others.map((p) => h("option", { value: p.name }, `${p.name} — ${p.path || t("incus.place.systemPath")}`)));
  let dialog;
  dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow clip" }, t("incus.place.moveTitle", { name: c.name })), closeX(() => dialog)),
    h("p", { class: "muted small" }, t(c.status === "running" ? "incus.place.moveLeadRunning" : "incus.place.moveLead")),
    field(t("incus.place.to"), select),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("incus.place.move"), {
        class: "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const r = await api("POST", `/api/containers/${c.name}/move`, { place: select.value });
            dialog.close();
            void jobDialog(r.job, "container", c.name, () => void loadContainers());
          } catch (err) {
            toast(errorText(err), "error");
            e.target.closest("button").disabled = false;
          }
        },
      }, "arrow"),
    ),
  );
}

/** The name field of a renamed or copied instance: the rules of a new one */
const instanceNameInput = (value) => h("input", { required: true, value, pattern: "[a-z][a-z0-9\\-]{0,61}[a-z0-9]", autocapitalize: "none", spellcheck: false, class: "mono" });

/** Sends a rename or a copy and follows its job; a field that is not right is said under the form */
async function instanceJob(path, data, error, dialog, button) {
  button.disabled = true;
  error.textContent = "";
  try {
    const r = await api("POST", path, data);
    dialog.close();
    void jobDialog(r.job, "container", r.name, () => {
      void loadContainers();
      void loadMachines();
    });
  } catch (err) {
    error.textContent = err.code === "containers.badField" ? t("incus.bad." + err.detail.field) : errorText(err);
    button.disabled = false;
  }
}

function renameContainerDialog(c) {
  const name = instanceNameInput(c.name);
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const go = (e) => instanceJob(`/api/containers/${c.name}/rename`, { name: name.value.trim() }, error, dialog, e.currentTarget);
  dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow clip" }, t("incus.renameTitle", { name: c.name })), closeX(() => dialog)),
    h("p", { class: "muted small" }, t(c.status !== "running" ? (c.kind === "vm" ? "incus.renameLeadVmStopped" : "incus.renameLead") : "incus.renameLeadRunning", { name: c.name })),
    field(t("incus.newName"), name, t("incus.nameHint")),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("incus.rename"), { class: "primary", onclick: go }, "edit")),
  );
  name.select();
}

function cloneContainerDialog(c) {
  const d = incusUi.data;
  const name = instanceNameInput(`${c.name.slice(0, 57)}-copy`);
  const places = d?.places ?? [];
  const place = h("select", null, places.map((p) => h("option", { value: p.name }, `${p.name} — ${p.path || t("incus.place.systemPath")}`)));
  place.value = c.place;
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const go = (e) => instanceJob(`/api/containers/${c.name}/clone`, { name: name.value.trim(), place: place.value }, error, dialog, e.currentTarget);
  dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow clip" }, t("incus.cloneTitle", { name: c.name })), closeX(() => dialog)),
    h("p", { class: "muted small" }, t(c.status === "running" ? "incus.cloneLeadRunning" : "incus.cloneLead", { name: c.name })),
    c.machine && h("p", { class: "muted small" }, t("incus.cloneMachine")),
    field(t("incus.name"), name, t("incus.nameHint")),
    places.length > 1 && field(t("incus.place.label"), place),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("incus.clone"), { class: "primary", onclick: go }, "copy")),
  );
  name.select();
}

function containerRow(c) {
  const running = c.status === "running";
  const limits = [c.cores ? t("incus.cores", { n: c.cores }) : t("incus.allCores"), c.memory ? bytes(c.memory * 1024 * 1024) : t("incus.allMemory"), c.disk ? t("incus.diskOf", { size: bytes(c.disk * 1024 ** 3) }) : null].filter(Boolean).join(" · ");
  const what = [c.kind === "vm" && t("incus.vm.short"), c.os, c.network === "home" && t("incus.net.homeShort"), c.nesting && "Docker", c.snapshots.length > 0 && t("incus.snapshotsN", { n: c.snapshots.length }), c.disc && t("incus.disc.inDrive", { name: c.disc })].filter(Boolean).join(" · ");
  const use = running && c.usage ? t("incus.memoryUsed", { used: bytes(c.usage.memory) }) : "—";
  return {
    href: `#/containers/i/${c.name}`,
    menu: (at) => containerMenu(c, at),
    cells: [
      uiCell({ name: c.name, sub: what }),
      incusStatus(c),
      h("span", { class: "mono small" }, c.address || "—"),
      uiCell({ name: use, sub: limits }),
      keepClick(uiLine([
        running ? (c.kind === "vm" ? button(t("incus.screen"), { class: "small", onclick: () => containerScreen(c) }, "screen") : button(t("incus.console"), { class: "small", onclick: () => containerConsole(c) }, "terminal")) : button(t("incus.start"), { class: "small", onclick: (e) => containerAct(c, "start", e.currentTarget) }, "play"),
        h("button", { type: "button", class: "btn small square ui-more", "aria-label": t("incus.more"), onclick: (e) => containerMenu(c, underButton(e.currentTarget)) }, icon("more")),
      ], { end: true })),
    ],
    sub: [what, c.address, use !== "—" && use].filter(Boolean).join(" · "),
  };
}

async function containerAct(c, action, el) {
  if (el) el.disabled = true;
  try {
    await api("POST", `/api/containers/${c.name}/state`, { action });
    toast(t("incus.did." + action, { name: c.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
  void loadContainers();
}

/** The backups of one instance, in the dialog of the Backups page; with none kept, that page says what can be done */
async function instanceBackups(c) {
  await loadBackups();
  const entry = state.backups?.apps.find((a) => a.name === `${c.name}@incus`);
  if (entry?.snapshots.length) snapshotsDialog(entry);
  else go("#/settings/backups");
}

function containerMenu(c, at) {
  menuAt(at, menuHeader(c.name, c.os, c.kind === "vm" ? "server" : "box"), [
    c.status === "running" && { label: t("incus.stop"), icon: "stop", run: () => containerAct(c, "stop") },
    c.status === "running" && { label: t("incus.restart"), icon: "refresh", run: () => containerAct(c, "restart") },
    c.status === "running" && c.kind === "vm" && { label: t("incus.screen"), icon: "screen", run: () => containerScreen(c) },
    c.disc && { label: t("incus.disc.eject"), icon: "up", run: () => ejectDisc(c) },
    c.status === "running" && { label: t("incus.console"), icon: "terminal", run: () => containerConsole(c) },
    c.machine && { label: t("incus.openMachine"), icon: "server", href: `#/machines/${c.machine}` },
    { label: t("incus.limits") + "…", icon: "settings", run: () => containerLimitsDialog(c) },
    (incusUi.data?.home || c.network === "home") && { label: t("incus.net.move") + "…", icon: "network", run: () => containerNetworkDialog(c) },
    { label: t("names.give") + "…", icon: "globe", run: () => domainNameDialog(null, { target: { kind: "container", name: c.name }, label: c.name }) },
    { label: t("ports.open") + "…", icon: "network", run: () => forwardDialog(null, { target: { kind: "container", name: c.name } }) },
    { label: t("incus.snapshots") + "…", icon: "clock", run: () => containerSnapshotsDialog(c) },
    { label: t("incus.rename") + "…", icon: "edit", run: () => renameContainerDialog(c) },
    { label: t("incus.clone") + "…", icon: "copy", run: () => cloneContainerDialog(c) },
    (incusUi.data?.places ?? []).length > 1 && { label: t("incus.place.moveItem"), icon: "arrow", run: () => moveContainerDialog(c) },
    { label: t("incus.backupNow"), icon: "archive", run: () => backupNow({ name: `${c.name}@incus`, title: c.name, incus: { kind: c.kind } }) },
    { label: t("incus.backups"), icon: "archive", run: () => instanceBackups(c) },
    { label: t("incus.remove") + "…", icon: "trash", danger: true, run: () => removeContainerDialog(c) },
  ]);
}

/** What only an instance of this server has, on its own page and on its machine's: its screen, disc, limits and snapshots */
function instanceCards(c) {
  const running = c.status === "running";
  const screen = c.kind === "vm" && running && uiCard({ title: t("incus.screen") }, uiEmbed(h("iframe", { src: "/screen.html?" + new URLSearchParams({ incus: c.name, lang: state.lang }), title: t("incus.screen") })));
  const disc = c.disc && uiCard({ title: t("instance.disc"), actions: button(t("incus.disc.eject"), { class: "small", onclick: () => ejectDisc(c) }, "up") }, ...uiFacts([[t("instance.disc"), h("span", { class: "mono" }, c.disc)]]));
  const limits = uiCard(
    { title: t("instance.limits"), actions: button(t("instance.change") + "…", { class: "small", onclick: () => containerLimitsDialog(c) }, "sliders") },
    ...uiFacts([
      [t("instance.cores"), c.cores || t("incus.allCores")],
      [t("sys.memory"), c.memory ? bytes(c.memory * 1024 * 1024) : t("incus.allMemory")],
      c.disk > 0 && [t("sys.disk"), bytes(c.disk * 1024 ** 3)],
      [t("instance.place"), c.place],
      c.address && [t("machines.address"), h("span", { class: "mono" }, c.address)],
      [t("instance.network"), c.network === "home" ? t("incus.net.homeShort") : t("instance.ownNetwork")],
    ]),
  );
  const snapshots = uiCard(
    { title: t("incus.snapshots"), count: c.snapshots.length, flush: true, actions: button(t("incus.snapshots") + "…", { class: "small", onclick: () => containerSnapshotsDialog(c) }, "clock") },
    c.snapshots.length ? c.snapshots.slice(-5).reverse().map((sn) => uiRow({ lead: { icon: "clock" }, name: sn.name, time: new Date(sn.created).toLocaleString(state.lang), mode: "event" })) : uiEmpty({ text: t("incus.snap.none") }),
  );
  return { main: [screen, snapshots].filter(Boolean), side: [disc, limits].filter(Boolean) };
}

function renderInstance() {
  shell(h("div", { id: "instance-head" }), h("div", { id: "instance-body", class: "stack" }));
  if (incusUi.data) renderInstanceBody();
}

function renderInstanceBody() {
  const head = document.getElementById("instance-head");
  const box = document.getElementById("instance-body");
  if (!head || !box) return;
  const crumbs = (name) => [{ label: t("nav.machines"), href: "#/machines" }, { label: t("tree.thisServer"), href: "#/machines/this" }, { label: name }];
  const c = incusUi.data?.containers?.find((x) => x.name === state.route.name);
  if (!c) return put(head, pageHead({ crumbs: crumbs(state.route.name) })), put(box, uiCard({}, uiEmpty({ size: "big", icon: "box", title: t("instance.gone") })));
  // with Hata's client it is a computer: the same address, more tabs
  if (c.machine && machinesUi.list?.machines.some((m) => m.id === c.machine)) return asMachine(c.machine, `#/containers/i/${c.name}`);
  const running = c.status === "running";
  const tab = (id, label) => ({ label, active: state.route.tab === id, href: `#/containers/i/${c.name}${id === "overview" ? "" : "/" + id}` });
  put(
    head,
    pageHead({
      crumbs: crumbs(c.name),
      icon: c.kind === "vm" ? "screen" : "box",
      title: c.name,
      state: incusStatus(c),
      facts: [t("tree.kind." + c.kind), c.os, c.address && h("span", { class: "mono" }, c.address)],
      actions: [running ? { label: t("incus.stop"), icon: "stop", run: () => containerAct(c, "stop") } : { label: t("incus.start"), icon: "play", primary: true, run: () => containerAct(c, "start") }, h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: (e) => containerMenu(c, underButton(e.currentTarget)) }, icon("more"))],
      menu: (at) => containerMenu(c, at),
      tabs: uiTabs([tab("overview", t("machines.tab.overview")), running && tab("terminal", t("machines.tab.terminal"))]),
    }),
  );
  if (state.route.tab === "terminal" && running) {
    // drawn once: redrawing would cut the shell off
    if (!box.querySelector(".ui-embed")) put(box, uiEmbed(terminalFrame({ incus: c.name })));
    return;
  }
  // a redraw must not reconnect the screen for news that does not concern it
  const key = JSON.stringify(c);
  if (box.dataset.shown !== key) {
    box.dataset.shown = key;
    const { main, side } = instanceCards(c);
    put(box, uiColumns(main, side));
  }
}

function containerConsole(c) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, c.name), closeX(() => dialog)), h("p", { class: "muted small" }, t("incus.consoleHint")), uiEmbed(terminalFrame({ incus: c.name })));
}

/** A virtual machine's screen: the page of Proxmox's screens, on QEMU's own VNC socket */
function containerScreen(c) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, c.name), closeX(() => dialog)), h("p", { class: "muted small" }, t("incus.screenHint")), uiEmbed(h("iframe", { src: "/screen.html?" + new URLSearchParams({ incus: c.name, lang: state.lang }), title: t("incus.screen") })));
}

/** The fields of the limits, shared by the new-container and the limits dialogs; a virtual machine always has its memory */
function limitFields(c, vm = c?.kind === "vm") {
  const opt = (value, label) => h("option", { value }, label);
  // as many as this server has: more cannot be given
  const has = Number(state.overview?.system?.cores) || 0;
  const most = Math.max(has || 16, c?.cores ?? 0);
  const cores = h("select", null, opt("0", has ? t("incus.allCoresOf", { n: has }) : t("incus.allCores")), Array.from({ length: most }, (_, i) => i + 1).filter((n) => most <= 16 || n <= 8 || n % 2 === 0 || n === c?.cores).map((n) => opt(String(n), t("incus.cores", { n }))));
  cores.value = String(c?.cores ?? Math.min(2, most));
  if (cores.value === "") cores.value = "0";
  const memory = h("select");
  const sized = (mb) => (mb < 1024 ? `${mb} MB` : `${Math.round((mb / 1024) * 100) / 100} GB`);
  // the server's own memory, in MB: sizes above it are not offered, a typed one may be anything
  const whole = Math.floor((Number(state.overview?.system?.memory?.total) || 0) / 1024 / 1024);
  // an amount of one's own becomes an option like the others, so whoever reads the list's value reads megabytes
  const own = (mb) => {
    if (![...memory.options].some((o) => o.value === String(mb))) {
      const before = [...memory.options].find((o) => o.value === "other" || Number(o.value) > mb);
      memory.insertBefore(opt(String(mb), sized(mb)), before ?? null);
    }
    memory.value = String(mb);
  };
  const typed = h("input", { type: "number", min: 0.125, max: 256, step: "any", class: "short mono", placeholder: "1.5", "aria-label": t("incus.memoryOwn"), hidden: true });
  const unit = h("span", { class: "muted small", hidden: true }, "GB");
  const asked = (on) => {
    typed.hidden = unit.hidden = !on;
    typed.required = on;
  };
  typed.addEventListener("change", () => {
    const mb = Math.round(Number(typed.value) * 1024);
    if (!(mb >= 128 && mb <= 262144)) return;
    own(mb);
    typed.value = "";
    asked(false);
  });
  // Enter in the field takes the amount instead of sending the form with "other" chosen
  typed.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !typed.value) return;
    e.preventDefault();
    typed.dispatchEvent(new Event("change"));
  });
  memory.addEventListener("change", () => {
    asked(memory.value === "other");
    if (memory.value === "other") typed.focus();
  });
  const fillMemory = (forVm) => {
    const was = memory.value === "other" ? "" : memory.value;
    const sizes = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].filter((mb) => !whole || mb <= whole || mb <= 1024);
    memory.replaceChildren(...[!forVm && opt("0", t("incus.allMemory")), ...sizes.map((mb) => opt(String(mb), sized(mb))), opt("other", t("incus.memoryOther"))].filter(Boolean));
    asked(false);
    // a container with no limit keeps none: 0 is "all memory"; only a virtual machine always has some
    const want = Number(was || (c ? c.memory || (forVm ? 1024 : 0) : 1024));
    if (want) own(want);
    else memory.value = forVm ? "1024" : "0";
  };
  memory.value = "";
  fillMemory(vm);
  const memoryBox = uiLine([memory, typed, unit]);
  return { cores, memory, memoryBox, fillMemory };
}

/** The drivers whose places can hold a container's disk to a size */
const LIMITED_PLACES = ["btrfs", "zfs", "lvm"];
const placeLimits = (name) => LIMITED_PLACES.includes((incusUi.data?.places ?? []).find((p) => p.name === name)?.driver);

/**
 * The same, for what acts at once (no "Save" after it): a setting with a switch on the right. The switch is a
 * checkbox drawn as one, so the code that reads `checked` and listens to `change` stays as it is.
 */
const switchRow = (label, hint, checked, disabled = false) => {
  const box = h("input", { type: "checkbox", class: "ui-toggle", role: "switch", checked, disabled, "aria-label": label });
  return [box, uiSetting({ name: label, explain: hint, control: box })];
};

const tickRow = (label, hint, checked) => {
  const box = h("input", { type: "checkbox", checked });
  const row = uiCheck(label, box, hint);
  return [box, row];
};

function newContainerDialog(start = "container") {
  const d = incusUi.data;
  const vmsReady = d.vms?.state === "ready";
  let kind = vmsReady ? start : "container";
  const name = h("input", { required: true, placeholder: "docker-1", pattern: "[a-z][a-z0-9\\-]{0,61}[a-z0-9]", autocapitalize: "none", spellcheck: false, class: "mono" });
  const image = h("select", { onchange: () => shape() });
  const { cores, memory, memoryBox, fillMemory } = limitFields(null, false);
  const disk = h("input", { type: "number", min: 4, max: 4096, value: 10 });
  const diskHint = h("span");
  const diskRow = field(t("incus.vm.disk"), disk, diskHint);
  const diskLabel = diskRow.querySelector("label") ?? diskRow.firstChild;
  const [client, clientRow] = tickRow(t("incus.client"), t("incus.clientHint"), true);
  const [docker, dockerRow] = tickRow(t("incus.docker"), t("incus.dockerHint"), true);
  const [autostart, autostartRow] = tickRow(t("incus.autostart"), null, true);
  const vmNote = uiNotice({ tone: "warn", text: t("incus.vm.note") });
  const discNote = uiNotice({ tone: "warn", text: t("incus.disc.note") });
  discNote.hidden = true;
  const imageHint = h("span");
  const [windows, windowsRow] = tickRow(t("incus.win.tick"), t("incus.win.hint"), false);
  windows.addEventListener("change", () => ((windows.dataset.touched = "1"), shape()));
  let discWas = "";
  disk.addEventListener("input", () => (disk.dataset.touched = "1"));
  const placeSelect = h("select", null, (d.places ?? []).map((p) => h("option", { value: p.name, selected: p.standard }, `${p.name} — ${p.path || t("incus.place.systemPath")}${p.total ? " · " + t("incus.place.freeShort", { free: bytes(p.total - p.used) }) : ""}`)));
  const placeRow = (d.places ?? []).length > 1 && field(t("incus.place.label"), placeSelect);
  const netSelect = h("select", null, ["home", "private"].map((k) => h("option", { value: k }, t("incus.net." + k))));
  const netRow = d.home ? field(t("incus.net.label"), netSelect, t("incus.net.hint")) : h("p", { class: "muted small" }, t("incus.net.none"), " ", h("a", { href: "#", class: "link", onclick: (e) => (e.preventDefault(), dialog.close(), homeBridgeDialog(null, () => void loadContainers())) }, t("incus.net.make")));
  placeSelect.addEventListener("change", () => shape());
  const lead = h("p", { class: "muted small" });
  const title = h("h2", { class: "grow" });
  // the kinds as the system's segment, drawn again with the one chosen
  const seg = h("div");
  const paintSeg = () => put(seg, uiSegment(["container", "vm"].map((k) => ({ value: k, label: t(k === "vm" ? "incus.kind.vm" : "incus.kind.container") })), kind, (k) => ((kind = k), fillImages(), shape()), { wide: true }));
  const fillImages = () => {
    const was = image.value;
    const systems = d.images.filter((i) => (kind === "vm" ? i.vm : i.container !== false)).map((i) => h("option", { value: i.id }, i.client ? i.name : `${i.name} — ${t("incus.noClient")}`));
    // a virtual machine can also be installed from a disc image, on its screen
    const discs = kind === "vm" ? (d.discs ?? []).map((x) => h("option", { value: `disc:${x.place}/${x.name}` }, x.name)) : [];
    image.replaceChildren(...(discs.length ? [h("optgroup", { label: t("incus.disc.systems") }, systems), h("optgroup", { label: t("incus.disc.group") }, discs)] : systems));
    if ([...image.options].some((o) => o.value === was)) image.value = was;
    fillMemory(kind === "vm");
  };
  const shape = () => {
    const vm = kind === "vm";
    title.textContent = t(vm ? "incus.vm.new" : "incus.new");
    lead.textContent = t(vm ? "incus.vm.newLead" : "incus.newLead");
    dockerRow.querySelector(".ui-check-hint").textContent = t(vm ? "incus.vm.dockerHint" : "incus.dockerHint");
    clientRow.querySelector(".ui-check-hint").textContent = t(vm ? "incus.vm.clientHint" : "incus.clientHint");
    // a container's disk is held to a size only in a place that can do it; empty — no limit
    const limited = vm || placeLimits(placeSelect.value);
    diskRow.hidden = !limited;
    disk.disabled = !limited;
    disk.required = vm;
    disk.min = vm ? 4 : 1;
    if (!vm && disk.value === "10" && !disk.dataset.touched) disk.value = "";
    if (vm && !disk.value) disk.value = "10";
    diskLabel.textContent = t(vm ? "incus.vm.disk" : "incus.diskLimit");
    diskHint.textContent = t(vm ? "incus.vm.diskHint" : "incus.diskLimitHint");
    vmNote.hidden = !vm;
    paintSeg();
    const chosen = d.images.find((i) => i.id === image.value);
    const fromDisc = vm && image.value.startsWith("disc:");
    discNote.hidden = !fromDisc;
    lead.hidden = fromDisc;
    imageHint.textContent = t(fromDisc ? "incus.disc.imageHint" : "incus.imageHint");
    // a disc of Windows is told by its name; the tick can be changed
    if (fromDisc && image.value !== discWas && !windows.dataset.touched) windows.checked = /win/i.test(image.value.split("/").pop()) && !/^virtio-win/i.test(image.value.split("/").pop());
    discWas = image.value;
    windowsRow.hidden = !fromDisc;
    const win = fromDisc && windows.checked;
    const drivers = (d.discs ?? []).some((x) => /^virtio-win/i.test(x.name));
    windowsRow.querySelector(".ui-check-hint").textContent = t(drivers ? "incus.win.hint" : "incus.win.hintNoDrivers");
    vmNote.hidden = !vm || fromDisc;
    clientRow.hidden = dockerRow.hidden = fromDisc;
    // a system installed from a disc wants room: most installers ask for 10–20 GB
    if (fromDisc && !disk.dataset.touched && Number(disk.value) < 20) disk.value = "20";
    if (vm && !fromDisc && !disk.dataset.touched && !chosen?.least && disk.value === "20") disk.value = "10";
    const can = chosen?.client;
    client.disabled = !can;
    if (!can) client.checked = false;
    // Docker's own script does not know every system
    if (chosen?.docker === false) docker.checked = false;
    docker.disabled = chosen?.docker === false;
    // a desktop needs room: less is not offered; so does Windows
    const least = win ? { memory: 4096, disk: 64 } : vm ? chosen?.least : null;
    disk.min = String(least?.disk ?? (vm ? 4 : 1));
    if (least && Number(disk.value) < least.disk) disk.value = String(least.disk);
    for (const o of memory.options) o.disabled = !!least && Number(o.value) < least.memory;
    if (least && Number(memory.value) < least.memory) memory.value = String(least.memory);
  };
  client.addEventListener("change", shape);
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const n = name.value.trim().toLowerCase();
    try {
      const fromDisc = kind === "vm" && image.value.startsWith("disc:");
      const r = await api("POST", "/api/containers", { windows: fromDisc && windows.checked, kind, name: n, image: image.value, cores: Number(cores.value), memory: Number(memory.value), disk: disk.disabled ? 0 : Number(disk.value || 0), client: client.checked, docker: docker.checked, autostart: autostart.checked, place: placeSelect.value, ...(d.home ? { network: netSelect.value } : {}) });
      dialog.close();
      const machine = client.checked && !fromDisc;
      void loadContainers();
      void jobDialog(r.job, "container", n, () => {
        void loadContainers();
        // the installer waits on the machine's screen
        if (fromDisc) return containerScreen({ name: n });
        toast(t(machine ? "incus.made.machine" : "incus.made.plain", { name: n }));
        void loadMachines();
      });
    } catch (err) {
      error.textContent = err.code === "containers.badField" ? t("incus.bad." + err.detail.field) : errorText(err);
      submit.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, title, closeX(() => dialog)),
      vmsReady && seg,
      lead,
      vmNote,
      discNote,
      uiFields(field(t("incus.name"), name, t("incus.nameHint")), field(t("incus.image"), image, imageHint)),
      uiFields(field(t("incus.coresLabel"), cores), uiField(t("incus.memoryLabel"), memoryBox, null, { group: true })),
      diskRow,
      placeRow,
      netRow,
      windowsRow,
      clientRow,
      dockerRow,
      autostartRow,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("plus"), t("incus.make"))),
    ),
  );
  fillImages();
  shape();
  name.focus();
}

/** Moves an instance between the home network and Hata's own: restarted, a new address from the other network */
function containerNetworkDialog(c) {
  const d = incusUi.data;
  const to = c.network === "home" ? "private" : "home";
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("incus.net.moveTitle", { name: c.name })), closeX(() => dialog)),
    h("p", null, t("incus.net.now." + (c.network || "other")), " ", t("incus.net.to." + to)),
    h("ul", { class: "muted small" }, [c.status === "running" && t("incus.net.restarts"), t("incus.net.address"), c.machine && t("incus.net.client"), to === "home" && t("incus.net.open")].filter(Boolean).map((line) => h("li", null, line))),
    to === "home" && !d.home?.address && uiNotice({ tone: "warn", text: t("incus.net.none") }),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("incus.net.go." + to), {
        class: "primary",
        disabled: to === "home" && !d.home?.address,
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const r = await api("POST", `/api/containers/${c.name}/network`, { network: to });
            dialog.close();
            void jobDialog(r.job, "container", c.name, () => void loadContainers());
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
    ),
  );
}

function containerLimitsDialog(c) {
  const { cores, memory, memoryBox } = limitFields(c);
  const [autostart, autostartRow] = tickRow(t("incus.autostart"), null, c.autostart);
  const [nesting, nestingRow] = tickRow(t("incus.nesting"), t("incus.nestingHint"), c.nesting);
  nestingRow.hidden = c.kind === "vm";
  // a virtual machine's disk only grows; a container's is held to a size only in a place that can do it
  const vm = c.kind === "vm";
  const limited = vm || placeLimits(c.place);
  const disk = h("input", { type: "number", min: vm ? c.disk || 4 : 0, max: 4096, value: c.disk || "", placeholder: vm ? "" : t("incus.diskNone") });
  const diskRow = limited ? field(t(vm ? "incus.vm.disk" : "incus.diskLimit"), disk, t(vm ? "incus.vm.diskGrow" : "incus.diskLimitHint")) : h("p", { class: "muted small" }, t("incus.diskNotHere", { place: c.place }));
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await api("PATCH", `/api/containers/${c.name}`, { cores: Number(cores.value), memory: Number(memory.value), autostart: autostart.checked, nesting: nesting.checked, ...(limited ? { disk: Number(disk.value || 0) } : {}) });
      dialog.close();
      toast(t("incus.saved", { name: c.name }));
      void loadContainers();
    } catch (err) {
      error.textContent = err.code === "containers.badField" ? t("incus.bad." + err.detail.field) : errorText(err);
      submit.disabled = false;
    }
  };
  dialog = openDialog(
    "",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow clip" }, t("incus.limitsTitle", { name: c.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t(c.kind === "vm" ? "incus.vm.limitsLead" : "incus.limitsLead")),
      uiFields(field(t("incus.coresLabel"), cores), uiField(t("incus.memoryLabel"), memoryBox, null, { group: true })),
      diskRow,
      autostartRow,
      nestingRow,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("check"), t("incus.save"))),
    ),
  );
}

function containerSnapshotsDialog(c) {
  let dialog;
  const list = h("div", { class: "stack-s" });
  const paint = (snaps) =>
    put(
      list,
      snaps.length
        ? uiTable(
            [{ label: t("incus.snap.name") }, { label: t("incus.snap.when") }, { label: "" }],
            snaps.map((s) => ({
              cells: [
                h("span", { class: "mono small" }, s.name),
                h("span", { class: "small" }, new Date(s.created).toLocaleString(state.lang)),
                uiLine(
                  [
                    button(t("incus.snap.restore"), { class: "small", onclick: () => snapAction("POST", `/api/containers/${c.name}/snapshots/${encodeURIComponent(s.name)}/restore`, { title: t("incus.snap.restoreTitle", { name: s.name, instance: c.name }), lead: t("incus.snap.restoreLead", { instance: c.name }), label: t("incus.snap.restoreGo"), iconName: "undo" }, "incus.snap.restored") }, "undo"),
                    button("", { class: "small ghost", title: t("incus.snap.remove"), "aria-label": t("incus.snap.remove"), onclick: () => snapAction("DELETE", `/api/containers/${c.name}/snapshots/${encodeURIComponent(s.name)}`, { title: t("incus.snap.removeTitle", { name: s.name }), lead: t("incus.snap.removeLead", { instance: c.name }), label: t("incus.snap.remove") }, "incus.snap.removed") }, "trash"),
                  ],
                  { end: true },
                ),
              ],
              sub: new Date(s.created).toLocaleString(state.lang),
            })),
            { height: 44 },
          )
        : uiEmpty({ text: t("incus.snap.none") }),
    );
  const again = async () => {
    await loadContainers();
    const fresh = incusUi.data?.containers?.find((x) => x.name === c.name);
    if (fresh) paint(fresh.snapshots);
  };
  const snapAction = (method, path, ask, done) =>
    confirmAction({
      ...ask,
      run: async () => {
        await api(method, path);
        toast(t(done));
        await again();
      },
    });
  const name = h("input", { placeholder: t("incus.snap.namePlaceholder"), class: "mono", spellcheck: false, autocapitalize: "none" });
  const take = button(
    t("incus.snap.take"),
    {
      class: "primary",
      onclick: async () => {
        take.disabled = true;
        try {
          const r = await api("POST", `/api/containers/${c.name}/snapshots`, { name: name.value.trim() });
          toast(t("incus.snap.taken", { name: r.name }));
          name.value = "";
        } catch (e) {
          toast(errorText(e), "error");
        }
        take.disabled = false;
        await again();
      },
    },
    "plus",
  );
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow clip" }, t("incus.snapTitle", { name: c.name })), closeX(() => dialog)), h("p", { class: "muted small" }, t("incus.snapLead")), uiLine([name, take]), list, h("footer", null, closeButton(() => dialog)));
  paint(c.snapshots);
}

function removeContainerDialog(c) {
  const typed = h("input", { class: "mono", autocapitalize: "none", spellcheck: false, placeholder: c.name });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("incus.removeTitle", { name: c.name })),
    h("p", { class: "muted" }, t(c.machine ? "incus.removeLeadMachine" : "incus.removeLead")),
    field(t("incus.removeType", { name: c.name }), typed),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(
        t("incus.remove"),
        {
          class: "danger",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await api("DELETE", `/api/containers/${c.name}`, { confirm: typed.value.trim() });
              dialog.close();
              toast(t("incus.removed", { name: c.name }));
              void loadContainers();
              void loadMachines();
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        },
        "trash",
      ),
    ),
  );
}
