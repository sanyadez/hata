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

const machineChip = (m) => h("span", { class: "state " + (m.online ? "running" : "") }, m.online ? t("machines.online") : t("machines.offline"));
const machineOs = (m) => [m.info?.os, m.info?.arch].filter(Boolean).join(" · ");

function renderMachines() {
  shell(h("div", { id: "machines-body" }, h("section", { class: "card pad" }, h("p", { class: "muted" }, t("machines.loading")))));
  if (treeUi.data) renderMachinesBody();
  void loadTree();
  const timer = setInterval(() => void loadTree(), 10_000);
  cleanups.push(() => clearInterval(timer));
}

/** Everything the Machines page can gain, in one menu: a computer that is there, a container or a virtual machine made here, a Proxmox server, Home Assistant */
function addToMachinesMenu(at = null) {
  let dialog;
  const entry = (label, hint, iconName, action) => h("button", { type: "button", class: "menu-item", disabled: !action, onclick: () => (dialog.close(), action()) }, h("span", { class: "app-icon plus" }, icon(iconName)), h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, label), h("span", { class: "muted small" }, hint)));
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
    hasModule("machines") && entry(t("machines.addExisting"), t("machines.addExistingHint"), "server", addMachineDialog),
    hasModule("containers") && entry(t("machines.addContainer"), hint("container"), "box", here("container")),
    hasModule("containers") && entry(t("machines.addVm"), hint("vm"), "box", here("vm")),
    hasModule("proxmox") && entry(t("machines.addPve"), t("machines.addPveHint"), "server", () => pveDialog()),
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
    if (!treeUi.data) put(document.getElementById("machines-body"), h("section", { class: "card pad" }, h("p", { class: "error" }, errorText(e))));
    return;
  }
  if (state.route.view === "machines") renderMachinesBody();
  paintServerMeta();
}

/** A menu opened by a button stands under it */
const underButton = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};

const rowPage = (r) => (r.instance ? `#/containers/i/${r.instance}` : r.guest ? `#/guest/${r.guest.host}/${r.guest.id}` : r.machine ? `#/machines/${r.machine}` : r.instance ? `#/containers/i/${r.instance}` : `#/guest/${r.guest.host}/${r.guest.id}`);
const guestOfRow = (r) => ({ id: r.guest.id, type: r.guest.type, name: r.name, vmid: Number(r.guest.id.split("/")[1]), status: r.status, may: r.may });

/** How busy it is, in one line of the width of a column */
function treeLoad(cpu, memory) {
  if (cpu == null && !memory) return h("span", { class: "muted" }, "—");
  const percent = cpu != null ? Math.round(cpu) : memory?.total ? Math.round((memory.used / memory.total) * 100) : 0;
  return h("span", { class: "tree-load" }, h("span", { class: "tree-bar" }, uiMeter(percent, { kind: "load" })), cpu != null && h("span", { class: "mono" }, `${Math.round(cpu)}%`), memory && h("span", { class: "mono muted" }, memory.total ? `${bytes(memory.used)} / ${bytes(memory.total)}` : bytes(memory.used)));
}

/** The one thing a row offers: what is first wanted of it in the state it is in */
function treeAction(r) {
  const up = r.status === "running";
  const start = (run) => button(t("incus.start"), { class: "small", onclick: (e) => (e.stopPropagation(), run(e.currentTarget)) }, "play");
  const on = (label, iconName, run) => button(label, { class: "small", onclick: (e) => (e.stopPropagation(), run()) }, iconName);
  const open = () => h("a", { class: "btn small", href: rowPage(r), onclick: (e) => e.stopPropagation() }, icon("arrow"), h("span", null, t("common.open")));
  if (!up) {
    if (r.instance) return start((el) => containerAct({ name: r.instance }, "start", el).then(() => loadTree()));
    if (r.guest && r.may.power) return start((el) => pvePower({ id: r.guest.host }, guestOfRow(r), r.status === "paused" ? "resume" : "start", el).then(() => loadTree()));
    if (r.machine && r.wakes && !r.guest) return button(t("machines.wake"), { class: "small", onclick: (e) => (e.stopPropagation(), wakeMachine({ id: r.machine, name: r.name }, e.currentTarget)) }, "power");
    return open();
  }
  if (r.kind === "vm" && r.instance) return on(t("incus.screen"), "screen", () => containerScreen({ name: r.instance }));
  if (r.kind === "vm" && r.guest && r.may.console) return on(t("pve.screen"), "screen", () => pveConsoleDialog({ id: r.guest.host }, guestOfRow(r)));
  if (r.machine && r.connected) return h("a", { class: "btn small", href: `#/machines/${r.machine}/terminal`, onclick: (e) => e.stopPropagation() }, icon("terminal"), h("span", null, t("machines.tab.terminal")));
  if (r.instance) return on(t("machines.tab.terminal"), "terminal", () => containerConsole({ name: r.instance }));
  if (r.guest && r.may.console) return on(t("machines.tab.terminal"), "terminal", () => pveConsoleDialog({ id: r.guest.host }, guestOfRow(r)));
  return open();
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
      h("span", { class: "tree-name" }, h("strong", null, r.name), r.self && uiTag(t("pve.selfChip")), r.noBackup && uiTag(t("tree.noBackup"))),
      h("span", { class: "muted small" }, what),
      uiState(tone, word),
      treeLoad(r.cpu, r.memory),
      h("div", { class: "row-actions end", onclick: (e) => e.stopPropagation() }, treeAction(r), h("button", { type: "button", class: "btn small square ui-more", "aria-label": t("app.more"), onclick: (e) => treeMenu(r, underButton(e.currentTarget)) }, icon("more"))),
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
          { label: t("power.reboot"), icon: "refresh", run: () => serverPowerDialog("reboot") },
          { label: t("power.poweroff"), icon: "stop", danger: true, run: () => serverPowerDialog("poweroff") },
        ])
      : x
        ? (at) => pveMenu(x, at)
        : null;
  const load = g.kind !== "others" && (g.cpu != null || g.memory) && h("span", { class: "ui-row-time" }, [g.cpu != null && t("tree.loadCpu", { n: Math.round(g.cpu) }), g.memory?.total && t("tree.loadMemory", { used: bytes(g.memory.used), total: bytes(g.memory.total) })].filter(Boolean).join(" · "));
  const action =
    g.kind === "here"
      ? h("a", { class: "btn small", href: "#/terminal" }, icon("terminal"), h("span", null, t("machines.tab.terminal")))
      : g.kind === "pve"
        ? g.online
          ? x?.url && h("a", { class: "btn small", href: x.url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("tree.openProxmox")))
          : button(t("tree.askAgain"), { class: "small", onclick: () => void loadPve().then(loadTree) }, "refresh")
        : null;
  const title = page ? h("a", { href: page }, g.name) : t("tree.others");
  const columns = [{ label: t("tree.col.name") }, { label: t("tree.col.what") }, { label: t("tree.col.state") }, { label: t("tree.col.load") }, { label: "" }];
  return uiCard(
    {
      title,
      marks: [head.chip && uiTag(head.chip), head.state],
      lead: head.what,
      flush: true,
      cls: "tree-host",
      menu,
      actions: [load, action, menu && h("button", { type: "button", class: "btn small square ui-more", "aria-label": t("app.more"), onclick: (e) => menu(underButton(e.currentTarget)) }, icon("more")), g.kind === "here" && hasModule("containers") && h("a", { class: "ui-link", href: "#/machines/this/containers/settings" }, t("tree.containersSettings"), icon("chevron"))].filter(Boolean),
    },
    g.rows.length ? uiTable(columns, g.rows.map(treeRow), { height: 44 }) : uiEmpty({ text: t(g.kind === "here" ? "tree.hereNone" : "tree.none"), action: g.kind === "here" && button(t("machines.addAny"), { class: "quiet small", onclick: (e) => addToMachinesMenu(e.currentTarget) }, "plus") }),
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
  if (!force && shown === treeUi.shown && box.querySelector(".server-tree")) return;
  treeUi.shown = shown;
  const meta = [t("tree.total", { total: d.total, running: d.running }), d.notAnswering > 0 && t("tree.metaNoAnswer", { n: d.notAnswering }), d.notConnected > 0 && t("tree.metaAway", { n: d.notConnected })].filter(Boolean).join(" · ");
  put(
    box,
    h(
      "div",
      { class: "stack server-tree" },
      pageHead({ title: t("nav.machines"), facts: [meta], actions: [{ label: t("machines.addAny"), icon: "plus", primary: true, run: () => addToMachinesMenu(document.querySelector(".server-tree .ui-head .ui-main")) }, { label: t("load.title"), icon: "chart", href: "#/machines/load" }] }),
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
  svg.setAttribute("class", "load-line");
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
    if (box && !loadUi.data) put(box, h("section", { class: "card pad" }, h("p", { class: "error" }, errorText(e))));
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
  const pill = (id, label) => h("a", { class: "seg-pill" + (at === id ? " active" : ""), href: id ? `#/machines/load/${id}` : "#/machines/load" }, label);
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
  const head = (id, text) => h("th", { class: "num" }, h("button", { type: "button", class: "th-sort" + (loadUi.sort === id ? " active" : ""), "aria-pressed": String(loadUi.sort === id), onclick: () => ((loadUi.sort = id), paintLoad()) }, text, loadUi.sort === id && icon("down")));
  const old = Date.now() - p.at > 60_000;
  return uiCard(
    {
      title: label,
      count: t("load.cores", { n: p.cores }),
      flush: true,
      cls: "load-place",
      actions: [h("span", { class: "ui-row-time" }, t("load.total", { cpu: p.cpu ?? "—", used: bytes(p.memory.used), total: bytes(p.memory.total), percent: memPercent })), p.power && p.power.total !== null && button(t("power.draw", { watts: p.power.total }), { class: "small", title: t("power.drawTitle"), onclick: () => drawDialog(p) }, "power")].filter(Boolean),
    },
    old && h("div", { class: "ui-inset" }, uiNotice({ tone: "warn", text: t("load.stale", { time: ago(p.at) }) })),
    !rows.length
      ? uiEmpty({ text: t(p.kind === "machine" ? "load.soonMachine" : "load.soon") })
      : h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "load-table" },
            h("thead", null, h("tr", null, h("th", null, t("load.col.what")), head("cpu", t("load.col.cpu")), head("memory", t("load.col.memory")), head("disk", t("load.col.disk")), head("net", t("load.col.net")), h("th", null, t("load.col.hour")))),
            h("tbody", null, list.map((r) => loadRow(r, p))),
          ),
        ),
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
    h("div", { class: "kv-list" }, p.zones.map((z) => h("div", { class: "kv" + (z.top ? "" : " sub") }, h("span", null, has("power.zone." + z.name.replace(/-\d+$/, "")) ? t("power.zone." + z.name.replace(/-\d+$/, ""), { n: z.name.replace(/^\D+-?/, "") }) : z.name), h("strong", null, z.watts === null ? "—" : t("power.draw", { watts: z.watts }))))),
    p.hour.some((w) => w !== null) ? lineChart(points, [{ cls: "s2", label: t("power.drawTitle"), value: (x) => x.w }], { max: null, fmt: (v) => t("power.draw", { watts: Math.round(v * 10) / 10 }), label: t("power.drawTitle"), height: 140 }) : h("p", { class: "muted small" }, t("load.soonRow")),
    h("footer", null, closeButton(() => dialog)),
  );
}

function loadRow(r, p) {
  const name = loadName(r, p);
  const app = r.kind === "app" && p.kind === "here" ? state.overview?.apps?.find((a) => a.name === r.name) : null;
  const over = loadUi.data.warn.warn && r.over > 0 && r.cpu >= loadUi.data.warn.cpu;
  return h(
    "tr",
    { class: "clickable" + (over ? " warn-row" : ""), onclick: () => loadRowDialog(r, p) },
    h("td", null, h("div", { class: "load-what" }, app ? appIcon(app, "small") : h("span", { class: "load-kind" }, icon(LOAD_ICONS[r.kind] ?? "box")), h("div", { class: "clip" }, h("strong", null, name), h("div", { class: "muted small" }, t("load.kindOf." + r.kind), r.parts?.length > 1 && " · " + t("load.parts", { n: r.parts.length }))))),
    h("td", { class: "num" + (over ? " warn-text" : "") }, `${r.cpu}%`),
    h("td", { class: "num" }, bytes(r.memory)),
    h("td", { class: "num small" }, twoWays(r.read, r.write)),
    h("td", { class: "num small", ...(r.rx == null ? { title: t("load.hostNet") } : {}) }, twoWays(r.rx, r.tx)),
    h("td", null, loadLine(r.trend.cpu.concat([r.cpu]))),
  );
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
      lineChart(points, [{ cls: "s2", label: t("load.col.cpu"), value: (x) => x.cpu }], { max: null, fmt: (v) => Math.round(v) + "%", label: t("load.col.cpu"), height: 140 }),
      lineChart(points, [{ cls: "s1", label: t("load.col.memory"), value: (x) => x.memory }], { max: null, fmt: (v) => bytes(v), label: t("load.col.memory"), height: 140 }),
    ],
    r.parts?.length > 0 && h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("load.col.container")), h("th", { class: "num" }, t("load.col.cpu")), h("th", { class: "num" }, t("load.col.memory")), h("th", { class: "num" }, t("load.col.disk")), h("th", { class: "num" }, t("load.col.net")))), h("tbody", null, r.parts.map((c) => h("tr", null, h("td", null, c.name), h("td", { class: "num" }, `${c.cpu}%`), h("td", { class: "num" }, bytes(c.memory)), h("td", { class: "num small" }, twoWays(c.read, c.write)), h("td", { class: "num small" }, twoWays(c.rx, c.tx))))))),
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
    h("label", { class: "check" }, on, h("span", null, h("strong", null, t("load.warn.tick")))),
    h("div", { class: "form-row" }, h("label", null, t("load.warn.cpu")), h("div", null, cpu, " %", h("p", { class: "muted small" }, t("load.warn.cpuHint")))),
    h("div", { class: "form-row" }, h("label", null, t("load.warn.minutes")), h("div", null, minutes, h("p", { class: "muted small" }, t("load.warn.minutesHint")))),
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
    h("p", { class: "cmd whole" }, cmd, h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(line()) }, icon("copy"))),
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

const incusStatus = (c) => h("span", { class: "state " + (c.status === "running" ? "running" : c.status === "error" ? "failed" : "") }, t("incus.status." + c.status));

/** A machine that is a container or a virtual machine of this server is started, not woken */
function startInstanceOf(m, el) {
  if (el) el.disabled = true;
  api("POST", `/api/containers/${m.instance}/state`, { action: "start" }).then(() => void loadMachines(), (e) => {
    if (el) el.disabled = false;
    toast(errorText(e), "error");
  });
}

function renderContainers() {
  const part = (id, label) => h("a", { class: "seg-pill" + (state.route.tab === id ? " active" : ""), href: id === "list" ? "#/machines/this/containers" : "#/machines/this/containers/settings" }, label);
  shell(
    areaHead("server", "containers"),
    h("div", { class: "card filter-bar" }, h("div", { class: "seg-pills", id: "incus-tabs", hidden: true }, part("list", t("incus.tab.list")), part("settings", t("incus.tab.settings"))), h("p", { class: "muted small grow", id: "incus-meta" }, t("incus.lead")), h("div", { class: "actions", id: "incus-actions" })),
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
  if (d.state === "error") return put(box, h("p", { class: "card pad warn-box" }, d.error));
  if (d.state === "blocked") return put(box, h("div", { class: "card pad stack" }, h("h2", null, t("incus.blocked.title")), h("p", null, t("incus.blocked." + d.why)), h("p", { class: "muted small" }, t("incus.blocked.how"))));
  if (d.state === "missing") {
    return put(
      box,
      h(
        "div",
        { class: "card pad stack" },
        h("h2", null, t("incus.missing.title")),
        h("p", null, t("incus.missing.lead")),
        h("ul", { class: "stack-s small pve-gives" }, ["system", "docker", "machine", "snapshots"].map((k) => h("li", null, t("incus.gives." + k)))),
        h("p", { class: "muted small" }, t("incus.missing.what")),
        d.install ? h("p", { class: "cmd" }, icon("terminal"), d.install) : h("p", { class: "banner small" }, t("incus.missing.byHand")),
        d.install && installPlaceRow(),
        d.install &&
          h(
            "div",
            { class: "actions" },
            button(
              t("incus.missing.install"),
              {
                class: "primary",
                onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  try {
                    const r = await api("POST", "/api/containers/install", { place: incusUi.place ?? "" });
                    void jobDialog(r.job, "incus", "Incus", () => void loadContainers());
                  } catch (err) {
                    toast(errorText(err), "error");
                  }
                  e.target.closest("button").disabled = false;
                },
              },
              "download",
            ),
          ),
      ),
    );
  }
  if (d.state === "setup") {
    return put(
      box,
      h(
        "div",
        { class: "card pad stack" },
        h("h2", null, t("incus.setup.title")),
        h("p", null, t("incus.setup.lead")),
        h(
          "div",
          { class: "actions" },
          button(
            t("incus.setup.button"),
            {
              class: "primary",
              onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  incusUi.data = await api("POST", "/api/containers/setup");
                  renderContainersBody();
                } catch (err) {
                  toast(errorText(err), "error");
                  e.target.closest("button").disabled = false;
                }
              },
            },
            "check",
          ),
        ),
      ),
    );
  }
  document.getElementById("incus-tabs").hidden = false;
  if (state.route.tab === "settings") return put(box, homeNetCard(d), incusPlacesCard(d), d.vms?.state === "ready" && discsCard(d), vmCard(d));
  const vmCount = d.containers.filter((c) => c.kind === "vm").length;
  document.getElementById("incus-meta").textContent = [t("incus.countN", { n: d.containers.length - vmCount }), vmCount > 0 && t("incus.vm.countN", { n: vmCount }), d.version && "Incus " + d.version, d.network && t("incus.network", { name: d.network.name, address: d.network.address })].filter(Boolean).join(" · ");
  if (!d.containers.length) {
    return put(box, h("div", { class: "card empty" }, icon("box"), h("h2", null, t("incus.none")), h("p", null, t("incus.noneLead")), button(t("incus.new"), { class: "primary", onclick: () => newContainerDialog() }, "plus")));
  }
  put(
    box,
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("incus.col.name")), h("th", null, t("incus.col.state")), h("th", null, t("incus.col.address")), h("th", null, t("incus.col.use")), h("th"))),
          h("tbody", null, d.containers.map((c) => containerRow(c))),
        ),
      ),
    ),
  );
}

/** Where new ones sit: the home network once its bridge is there, or the way to make it */
function homeNetCard(d) {
  const home = d.home;
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("incus.net.title")), h("div", { class: "actions" }, home ? h("a", { class: "btn small", href: "#/settings/network" }, t("incus.net.settings")) : button(t("incus.net.make"), { class: "small", onclick: () => homeBridgeDialog(null, () => void loadContainers()) }, "box"))),
    h("p", { class: "muted small" }, home ? t("incus.net.on", { bridge: home.name, address: home.address || "—" }) : t("incus.net.off", { network: d.network?.name ?? "" })),
  );
}

/** Virtual machines: a test feature of their own, with what it needs and what it cannot do yet */
function vmCard(d) {
  const vms = d.vms;
  if (!vms || vms.state === "ready") return null;
  const head = h("h2", null, t("incus.vm.title"), " ", h("span", { class: "chip" }, t("incus.vm.test")));
  if (vms.state !== "missing") return h("section", { class: "card pad stack" }, head, h("p", null, t("incus.vm." + vms.state)));
  return h(
    "section",
    { class: "card pad stack" },
    head,
    h("p", null, t("incus.vm.lead")),
    h("ul", { class: "stack-s small pve-gives" }, ["limits", "images", "screen", "space"].map((k) => h("li", null, t("incus.vm.limit." + k)))),
    vms.install ? h("p", { class: "cmd" }, icon("terminal"), vms.install) : h("p", { class: "banner small" }, t("incus.missing.byHand")),
    vms.install &&
      h(
        "div",
        { class: "actions" },
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
      ),
  );
}

/** Where Incus is to keep the containers, chosen before it is installed: the system disk unless another folder is picked */
function installPlaceRow() {
  const shown = h("span", { class: "grow mono small" });
  const reset = button(t("incus.place.system"), { class: "small ghost", onclick: () => ((incusUi.place = ""), paint()) });
  const paint = () => {
    shown.textContent = incusUi.place || t("incus.place.systemPath");
    reset.hidden = !incusUi.place;
  };
  paint();
  return h(
    "div",
    { class: "stack-s" },
    h("strong", null, t("incus.place.where")),
    h("p", { class: "muted small" }, t("incus.place.whereHint")),
    h("div", { class: "row-actions" }, icon("folder"), shown, reset, button(t("incus.place.choose"), { class: "small", onclick: () => folderPicker({ title: t("incus.place.pickTitle"), start: "/mnt", confirmLabel: t("incus.place.pickHere"), action: (path) => ((incusUi.place = path), paint()) }) }, "folder")),
  );
}

/** The places containers live in: room, which one new ones go to, another one added */
function incusPlacesCard(d) {
  const list = d.places ?? [];
  const act = async (el, method, path, body) => {
    el.disabled = true;
    try {
      await api(method, path, body);
      await loadContainers();
    } catch (e) {
      toast(errorText(e), "error");
      el.disabled = false;
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
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, t("incus.place.title")), button(t("incus.place.add"), { class: "small", onclick: add }, "plus")),
    h("p", { class: "muted small" }, t("incus.place.lead")),
    list.map((p) => {
      const percent = p.total ? Math.round((p.used / p.total) * 100) : 0;
      const fill = h("i", { class: level(percent) });
      fill.style.width = percent + "%";
      return h(
        "div",
        { class: "stack-s", menu: true },
        h(
          "div",
          { class: "row" },
          h("div", { class: "grow" }, h("strong", null, p.name), " ", p.standard && h("span", { class: "chip" }, t("incus.place.standard")), " ", p.away && h("span", { class: "state restarting" }, t("incus.place.away")), h("div", { class: "muted small mono" }, (p.path || t("incus.place.systemPath")) + " · " + p.driver)),
          h(
            "div",
            { class: "row-actions" },
            !p.standard && button(t("incus.place.makeStandard"), { class: "small", onclick: (e) => act(e.currentTarget, "PUT", `/api/containers/places/${p.name}`) }, "check"),
            !p.standard && !p.profile && !p.instances && button("", { class: "small ghost", title: t("incus.place.remove"), "aria-label": t("incus.place.remove"), onclick: (e) => act(e.currentTarget, "DELETE", `/api/containers/places/${p.name}`) }, "trash"),
          ),
        ),
        p.total > 0 && h("div", { class: "bar" }, fill),
        h("p", { class: "muted small" }, [p.total ? t("sys.free", { free: bytes(p.total - p.used), total: bytes(p.total) }) : null, t("incus.place.instancesN", { n: p.instances })].filter(Boolean).join(" · ")),
        p.away && h("p", { class: "small" }, t("incus.place.awayHint")),
      );
    }),
  );
}

/** Disc images (ISO) for virtual machines installed from them: what is kept, and the ways to add one */
function discsCard(d) {
  const list = d.discs ?? [];
  return h(
    "section",
    { class: "card pad stack" },
    h(
      "div",
      { class: "row wrap" },
      h("h2", { class: "grow" }, t("incus.disc.title")),
      button(t("incus.disc.fromLink"), { class: "small", onclick: () => discAddDialog({ how: "url" }) }, "link"),
      button(t("incus.disc.fromHere"), { class: "small", onclick: () => discAddDialog({ how: "local" }) }, "upload"),
      !list.some((x) => /^virtio-win/i.test(x.name)) && button(t("incus.win.drivers"), { class: "small", title: t("incus.win.driversHint"), onclick: (e) => addDrivers(e.currentTarget) }, "download"),
    ),
    h("p", { class: "muted small" }, t("incus.disc.lead")),
    list.length === 0
      ? h("p", { class: "muted small" }, t("incus.disc.none"))
      : list.map((x) =>
          h(
            "div",
            { class: "row", menu: true },
            h("span", { class: "app-icon plus small" }, icon("disk")),
            h("div", { class: "grow" }, h("div", { class: "strong clip" }, x.name), h("div", { class: "muted small" }, [x.size ? bytes(x.size) : null, (d.places ?? []).length > 1 && x.place, x.usedBy.length ? t("incus.disc.usedBy", { names: x.usedBy.join(", ") }) : null].filter(Boolean).join(" · "))),
            h(
              "div",
              { class: "row-actions" },
              button(t("incus.disc.makeVm"), { class: "small", onclick: () => newDiscVm(x) }, "plus"),
              button("", { class: "small ghost", title: t("incus.disc.remove"), "aria-label": `${t("incus.disc.remove")}: ${x.name}`, disabled: x.usedBy.length > 0, onclick: () => removeDiscDialog(x) }, "trash"),
            ),
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
  const fill = h("i");
  const progress = h("div", { class: "stack-s", hidden: true }, h("div", { class: "bar" }, fill), h("p", { class: "muted small" }));
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
      fill.style.width = percent + "%";
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
  return h(
    "tr",
    { menu: (at) => containerMenu(c, at) },
    h(
      "td",
      null,
      h("a", { class: "strong", href: `#/containers/i/${c.name}` }, c.name),
      h("div", { class: "muted small" }, [c.kind === "vm" && t("incus.vm.short"), c.os, c.network === "home" && t("incus.net.homeShort"), c.nesting && "Docker", c.snapshots.length > 0 && t("incus.snapshotsN", { n: c.snapshots.length }), c.disc && t("incus.disc.inDrive", { name: c.disc })].filter(Boolean).join(" · ")),
    ),
    h("td", null, incusStatus(c)),
    h("td", { class: "mono small" }, c.address || "—"),
    h("td", { class: "small" }, running && c.usage ? t("incus.memoryUsed", { used: bytes(c.usage.memory) }) : "—", h("div", { class: "muted small" }, limits)),
    h(
      "td",
      null,
      h(
        "div",
        { class: "row-actions" },
        running
          ? button(t("incus.stop"), { class: "small", onclick: (e) => containerAct(c, "stop", e.currentTarget) }, "stop")
          : button(t("incus.start"), { class: "small", onclick: (e) => containerAct(c, "start", e.currentTarget) }, "play"),
        running && c.kind === "vm" && button(t("incus.screen"), { class: "small", onclick: () => containerScreen(c) }, "screen"),
        running && button(t("incus.console"), { class: "small", onclick: () => containerConsole(c) }, "terminal"),
        button("", { class: "small ghost", title: t("incus.more"), "aria-label": t("incus.more"), onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          containerMenu(c, { x: r.left, y: r.bottom + 4 });
        } }, "more"),
      ),
    ),
  );
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
  const fact = (label, value) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", null, value));
  const screen = c.kind === "vm" && running && h("section", { class: "card pad stack-s" }, h("h2", null, t("incus.screen")), h("div", { class: "term-holder instance-screen" }, h("iframe", { class: "term-frame", src: "/screen.html?" + new URLSearchParams({ incus: c.name, lang: state.lang }), title: t("incus.screen") })));
  const disc = c.disc && h("section", { class: "card pad stack-s" }, h("div", { class: "section-head" }, h("h2", null, t("instance.disc")), button(t("incus.disc.eject"), { class: "small", onclick: () => ejectDisc(c) }, "up")), h("p", { class: "mono small" }, c.disc));
  const limits = h(
      "section",
      { class: "card pad stack-s" },
      h("div", { class: "section-head" }, h("h2", null, t("instance.limits")), button(t("instance.change"), { class: "small", onclick: () => containerLimitsDialog(c) }, "sliders")),
      fact(t("instance.cores"), c.cores || t("incus.allCores")),
      fact(t("sys.memory"), c.memory ? bytes(c.memory * 1024 * 1024) : t("incus.allMemory")),
      c.disk > 0 && fact(t("sys.disk"), bytes(c.disk * 1024 ** 3)),
      fact(t("instance.place"), c.place),
      c.address && fact(t("machines.address"), c.address),
      fact(t("instance.network"), c.network === "home" ? t("incus.net.homeShort") : t("instance.ownNetwork")),
    );
  const snapshots = h(
      "section",
      { class: "card pad stack-s" },
      h("div", { class: "section-head" }, h("h2", null, t("incus.snapshots"), " ", h("span", { class: "muted" }, c.snapshots.length)), button(t("incus.snapshots") + "…", { class: "small", onclick: () => containerSnapshotsDialog(c) }, "clock")),
      c.snapshots.length ? c.snapshots.slice(-5).reverse().map((s) => fact(s.name, new Date(s.created).toLocaleString(state.lang))) : h("p", { class: "muted small" }, t("incus.snap.none")),
    );
  return { main: [screen, snapshots].filter(Boolean), side: [disc, limits].filter(Boolean) };
}

function renderInstance() {
  shell(h("div", { id: "instance-head", class: "card pad thing-head" }), h("div", { id: "instance-body", class: "stack" }));
  if (incusUi.data) renderInstanceBody();
}

function renderInstanceBody() {
  const head = document.getElementById("instance-head");
  const box = document.getElementById("instance-body");
  if (!head || !box) return;
  const crumbs = (name) => h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines")), icon("chevron"), h("a", { href: "#/machines/this" }, t("tree.thisServer")), icon("chevron"), h("span", null, name));
  const c = incusUi.data?.containers?.find((x) => x.name === state.route.name);
  if (!c) return put(head, crumbs(state.route.name)), put(box, h("p", { class: "card pad muted" }, t("instance.gone")));
  // with Hata's client it is a computer: the same address, more tabs
  if (c.machine && machinesUi.list?.machines.some((m) => m.id === c.machine)) return asMachine(c.machine, `#/containers/i/${c.name}`);
  const running = c.status === "running";
  const tab = (id, iconName, label) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `#/containers/i/${c.name}${id === "overview" ? "" : "/" + id}` }, icon(iconName), label);
  put(
    head,
    crumbs(c.name),
    h(
      "div",
      { class: "app-head", menu: (at) => containerMenu(c, at) },
      h("span", { class: "machine-icon" }, icon(c.kind === "vm" ? "screen" : "box")),
      h("div", { class: "grow" }, h("div", { class: "app-title" }, h("h1", null, c.name), incusStatus(c)), h("p", { class: "meta" }, [t("tree.kind." + c.kind), c.os, c.address].filter(Boolean).join(" · "))),
      h("div", { class: "actions" }, running ? button(t("incus.stop"), { onclick: (e) => containerAct(c, "stop", e.currentTarget) }, "stop") : button(t("incus.start"), { class: "primary", onclick: (e) => containerAct(c, "start", e.currentTarget) }, "play"), h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: (e) => containerMenu(c, underButton(e.currentTarget)) }, icon("more"))),
    ),
    h("div", { class: "tabs" }, tab("overview", "grid", t("machines.tab.overview")), running && tab("terminal", "terminal", t("machines.tab.terminal"))),
  );
  if (state.route.tab === "terminal" && running) {
    // drawn once: redrawing would cut the shell off
    if (!box.querySelector(".term-holder")) put(box, h("div", { class: "term-holder" }, terminalFrame({ incus: c.name })));
    return;
  }
  // a redraw must not reconnect the screen for news that does not concern it
  const key = JSON.stringify(c);
  if (box.dataset.shown !== key) {
    box.dataset.shown = key;
    const { main, side } = instanceCards(c);
    put(box, h("div", { class: "columns" }, h("div", { class: "stack" }, main), h("aside", { class: "side stack" }, side)));
  }
}

function containerConsole(c) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, c.name), closeX(() => dialog)), h("p", { class: "muted small" }, t("incus.consoleHint")), h("div", { class: "term-holder" }, terminalFrame({ incus: c.name })));
}

/** A virtual machine's screen: the page of Proxmox's screens, on QEMU's own VNC socket */
function containerScreen(c) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, c.name), closeX(() => dialog)), h("p", { class: "muted small" }, t("incus.screenHint")), h("div", { class: "term-holder" }, h("iframe", { class: "term-frame", src: "/screen.html?" + new URLSearchParams({ incus: c.name, lang: state.lang }), title: t("incus.screen") })));
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
  const memoryBox = h("span", { class: "memory-pick" }, memory, typed, unit);
  return { cores, memory, memoryBox, fillMemory };
}

/** The drivers whose places can hold a container's disk to a size */
const LIMITED_PLACES = ["btrfs", "zfs", "lvm"];
const placeLimits = (name) => LIMITED_PLACES.includes((incusUi.data?.places ?? []).find((p) => p.name === name)?.driver);

const tickRow = (label, hint, checked) => {
  const box = h("input", { type: "checkbox", checked });
  return [box, h("label", { class: "check" }, box, h("span", null, h("strong", null, label), hint && h("span", { class: "muted small block" }, hint)))];
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
  const vmNote = h("p", { class: "banner small" }, t("incus.vm.note"));
  const discNote = h("p", { class: "banner small", hidden: true }, t("incus.disc.note"));
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
  const seg = h(
    "div",
    { class: "seg" },
    ["container", "vm"].map((k) => h("button", { type: "button", class: "btn", "data-kind": k, onclick: () => ((kind = k), fillImages(), shape()) }, t(k === "vm" ? "incus.kind.vm" : "incus.kind.container"))),
  );
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
    dockerRow.querySelector(".block").textContent = t(vm ? "incus.vm.dockerHint" : "incus.dockerHint");
    clientRow.querySelector(".block").textContent = t(vm ? "incus.vm.clientHint" : "incus.clientHint");
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
    for (const b of seg.children) b.classList.toggle("active", b.dataset.kind === kind);
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
    windowsRow.querySelector(".block").textContent = t(drivers ? "incus.win.hint" : "incus.win.hintNoDrivers");
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
      h("div", { class: "form-pair" }, field(t("incus.name"), name, t("incus.nameHint")), field(t("incus.image"), image, imageHint)),
      h("div", { class: "form-pair" }, field(t("incus.coresLabel"), cores), field(t("incus.memoryLabel"), memoryBox)),
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
    to === "home" && !d.home?.address && h("p", { class: "banner small" }, t("incus.net.none")),
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
      h("div", { class: "form-pair" }, field(t("incus.coresLabel"), cores), field(t("incus.memoryLabel"), memoryBox)),
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
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, h("th", null, t("incus.snap.name")), h("th", null, t("incus.snap.when")), h("th"))),
              h(
                "tbody",
                null,
                snaps.map((s) =>
                  h(
                    "tr",
                    null,
                    h("td", { class: "mono small" }, s.name),
                    h("td", { class: "small" }, new Date(s.created).toLocaleString(state.lang)),
                    h(
                      "td",
                      null,
                      h(
                        "div",
                        { class: "row-actions" },
                        button(t("incus.snap.restore"), { class: "small", onclick: () => snapAction("POST", `/api/containers/${c.name}/snapshots/${encodeURIComponent(s.name)}/restore`, { title: t("incus.snap.restoreTitle", { name: s.name, instance: c.name }), lead: t("incus.snap.restoreLead", { instance: c.name }), label: t("incus.snap.restoreGo"), iconName: "undo" }, "incus.snap.restored") }, "undo"),
                        button("", { class: "small ghost", title: t("incus.snap.remove"), "aria-label": t("incus.snap.remove"), onclick: () => snapAction("DELETE", `/api/containers/${c.name}/snapshots/${encodeURIComponent(s.name)}`, { title: t("incus.snap.removeTitle", { name: s.name }), lead: t("incus.snap.removeLead", { instance: c.name }), label: t("incus.snap.remove") }, "incus.snap.removed") }, "trash"),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "muted small" }, t("incus.snap.none")),
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
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow clip" }, t("incus.snapTitle", { name: c.name })), closeX(() => dialog)), h("p", { class: "muted small" }, t("incus.snapLead")), h("div", { class: "actions" }, name, take), list, h("footer", null, closeButton(() => dialog)));
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
