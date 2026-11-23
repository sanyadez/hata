// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- One machine ---

const MACHINE_TABS = ["overview", "apps", "containers", "terminal"];
const machineTab = (part) => (part === "docker" ? "containers" : MACHINE_TABS.includes(part) ? part : "overview");
/** The one address of a computer: where it lives — a container of this server, a guest of Proxmox, or by itself */
const machineBase = (m) => (m.instance ? `#/containers/i/${m.instance}` : m.pve ? `#/guest/${m.pve.host}/${m.pve.id}` : `#/machines/${m.id}`);
/** The page of a container or a guest turns into the computer's, in place, once Hata's client is on it */
function asMachine(id, base) {
  const tab = machineTab(state.route.asked ?? state.route.tab);
  state.route = { view: "machine", id, tab, base };
  render();
  void loadMachines();
  void loadContainers();
}

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
  if (!m) return put(head, pageHead({ crumbs: [{ label: t("nav.machines"), href: "#/machines" }] }), machinesUi.list && uiCard({}, uiEmpty({ size: "big", icon: "server", title: t("error.machine.notFound") })));
  // the address is where the thing lives: a container's or a guest's computer is shown at theirs
  const base = machineBase(m);
  const here = base + (state.route.tab === "overview" ? "" : "/" + (state.route.tab === "containers" ? "docker" : state.route.tab));
  if (location.hash !== here && location.hash.startsWith("#/machines/")) history.replaceState(history.state, "", here);
  state.route.base = base;
  const tab = (id) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `${base}${id === "overview" ? "" : "/" + (id === "containers" ? "docker" : id)}` }, t(id === "containers" ? "machines.tab.docker" : "machines.tab." + id));
  // the one thing at hand: bring it back when it is off, its screen when it is a running VM, else its terminal
  const main = !m.online
    ? m.pve?.power && m.pve.status !== "running"
      ? { label: t("pve.startHere", { host: m.pve.hostName }), icon: "play", primary: true, run: () => startGuestOf(m) }
      : m.instance
        ? { label: t("incus.start"), icon: "play", primary: true, run: () => startInstanceOf(m) }
        : m.info?.macs?.length > 0 && { label: t("machines.wake"), icon: "play", primary: true, run: () => wakeMachine(m) }
    : m.incusVm
      ? { label: t("incus.screen"), icon: "screen", run: () => containerScreen({ name: m.incusVm }) }
      : m.pve?.type === "qemu" && m.pve.status === "running"
        ? { label: t("pve.screen"), icon: "screen", run: () => pveConsoleDialog({ id: m.pve.host }, m.pve) }
        : { label: t("machines.tab.terminal"), icon: "terminal", href: `${base}/terminal` };
  const crumbs = [{ label: t("nav.machines"), href: "#/machines" }, m.instance && { label: t("tree.thisServer"), href: "#/machines/this" }, m.pve && { label: m.pve.hostName, href: `#/proxmox/${m.pve.host}` }, { label: m.name }].filter(Boolean);
  head.replaceChildren(
    pageHead({
      crumbs,
      icon: "server",
      title: m.name,
      state: machineChip(m),
      facts: [machineOs(m), m.ip && h("span", { class: "mono" }, m.ip), !m.online && t("machines.seen", { ago: ago(m.seen) }), hardwareWords(m.info?.hardware)],
      actions: [main, m.pve && { label: guestKind(m.pve) + " · " + m.pve.hostName, icon: "server", href: `#/proxmox/${m.pve.host}/guests` }, h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: (e) => machineMenu(m, underButton(e.currentTarget)) }, icon("more"))],
      menu: (at) => machineMenu(m, at),
      tabs: h("nav", { class: "tabs" }, tab("overview"), tab("apps"), tab("containers"), m.online && h("a", { class: "tab", href: filesHash("/", m.id) }, t("machines.files")), tab("terminal")),
    }),
    m.outdated && m.online && uiCard({}, uiNotice({ tone: "info", icon: "up", title: t("machines.update", { version: machinesUi.list.version }), action: button(t("app.update"), { class: "small", onclick: (e) => updateMachine(m, e.currentTarget) }, "up") })),
  );
}

function machineMenu(m, at = null) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "machine-icon" }, icon("server")), h("div", null, h("h2", null, m.name), machineChip(m))),
    item(t("machines.rename"), "edit", () => renameMachineDialog(m)),
    item(t("names.give") + "…", "globe", () => domainNameDialog(null, { target: { kind: "machine", id: m.id }, label: m.name })),
    item(t("ports.open") + "…", "network", () => forwardDialog(null, { target: { kind: "machine", id: m.id } })),
    !m.online && !m.instance && m.info?.macs?.length > 0 && item(t("machines.wake"), "play", () => wakeMachine(m)),
    m.online && item(t("machines.reboot"), "refresh", () => powerDialog(m, "reboot")),
    m.online && item(t("machines.poweroff"), "stop", () => powerDialog(m, "poweroff")),
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

function removeMachineDialog(m, after = () => go("#/machines")) {
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
            void after();
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
    box.replaceChildren(h("div", { class: "stack" }, h("div", { id: "machine-containers" }, h("p", { class: "muted" }, t("machines.loading"))), h("div", { id: "machine-docker", class: "stack" })));
    if (machinesUi.containers) paintMachineContainers();
    void loadMachineContainers();
    paintSpace(m.id);
    void loadSpace(m.id);
  } else if (state.route.tab === "apps") {
    box.replaceChildren(h("div", { id: "machine-apps" }, h("p", { class: "muted" }, t("machines.loading"))));
    if (machinesUi.apps?.machine === m.id) paintMachineApps();
    void loadMachineApps();
  } else if (state.route.tab === "terminal") {
    box.replaceChildren(h("div", { class: "term-holder" }, terminalFrame({ machine: m.id })));
  } else {
    machineOverview(m, box);
    paintMachineExtra();
  }
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
        m.online
          ? h("section", { class: "card ui-stats" }, statCells("m"))
          : h("p", { class: "card pad muted" }, t("machines.offlineLead", { ago: ago(m.seen) })),
        h("div", { id: "m-disks" }),
        m.online && h("div", { id: "machine-sysupdates" }, sysUpdatesCard(m.id)),
        h("div", { id: "machine-extra", class: "stack" }),
        h("div", { id: "machine-people" }, machinePeopleCard(m)),
      ),
      h(
        "aside",
        { class: "side stack" },
        h("div", { id: "machine-side", class: "stack" }),
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
      m.people && accessLink(),
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
      h("footer", null, share && button(t("machines.people.unshare"), { class: "danger", onclick: () => confirmAction({ title: t("machines.people.unshareTitle"), lead: t("machines.people.unshareLead"), label: t("machines.people.unshare"), iconName: "x", run: () => save(false) }) }), closeButton(() => dialog, t("common.cancel")), button(t("settings.save"), { type: "submit", class: "primary" })),
    ),
  );
}

/** A machine that is also an instance of this server or a guest of Proxmox: what that gives, on the same page */
function paintMachineExtra() {
  const box = document.getElementById("machine-extra");
  const m = machinesUi.current;
  if (!box || !m) return;
  if (m.instance) {
    const c = incusUi.data?.containers?.find((x) => x.name === m.instance);
    const key = c ? JSON.stringify(c) : "";
    if (c && box.dataset.shown !== key) {
      box.dataset.shown = key;
      const { main, side } = instanceCards(c);
      put(box, main);
      put(document.getElementById("machine-side"), side);
    }
  } else if (m.pve) void paintGuestParts(box, m.pve.host, m.pve.id);
}

function paintMachineOverview() {
  const box = document.getElementById("machine-tab");
  if (box && machinesUi.current) machineOverview(machinesUi.current, box);
  paintMachineExtra();
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
  Object.assign(statCell(prefix + "-temp", "temp", t("sys.temperature")), { hidden: true }),
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

// --- An app of another computer: a page of its own ---------------------------------------------------

const mappUi = { key: "", machine: null, app: null, error: "", timer: 0 };

function renderMachineApp() {
  const key = `${state.route.name}@${state.route.machine}`;
  if (mappUi.key !== key) Object.assign(mappUi, { key, machine: null, app: null, error: "" });
  shell(h("div", { id: "mapp-body", class: "stack" }, waitMark()));
  if (mappUi.app) paintMachineApp();
  void loadMachineApp();
  cleanups.push(() => clearTimeout(mappUi.timer));
}

async function loadMachineApp() {
  clearTimeout(mappUi.timer);
  const { name, machine } = state.route;
  if (state.route.view !== "mapp") return;
  try {
    const [m, list] = await Promise.all([api("GET", `/api/machines/${machine}`), api("GET", `/api/machines/${machine}/apps?lang=${state.lang}`)]);
    if (state.route.view !== "mapp" || state.route.machine !== machine || state.route.name !== name) return;
    Object.assign(mappUi, { machine: m, app: list.find((a) => a.name === name) ?? null, error: "" });
  } catch (e) {
    mappUi.error = errorText(e);
  }
  paintMachineApp();
  mappUi.timer = setTimeout(loadMachineApp, 8000);
}

function paintMachineApp() {
  const box = document.getElementById("mapp-body");
  if (!box) return;
  const { machine: m, app, error } = mappUi;
  const crumbs = (title) => [{ label: t("nav.apps"), href: "#/apps" }, { label: title }];
  if (!m || !app) return put(box, pageHead({ crumbs: crumbs(state.route.name) }), uiCard({}, error || m ? uiEmpty({ size: error ? "error" : "big", icon: "box", title: error || t("mapp.gone", { name: m.name }) }) : uiEmpty({ size: "loading" })));
  // a window of this page is open: its words are not redrawn under the person
  if (document.querySelector("dialog[open]:not(.tv-drop)")) return;
  const again = () => void loadMachineApp();
  const busy = !!app.job;
  const url = isUp(app) ? machineAppUrl(m, app) : null;
  const act = (action) => async () => {
    try {
      const res = await api("POST", `/api/machines/${m.id}/apps/${app.name}/${action}`, {});
      jobDialog(res.job, action, app.title, again);
    } catch (e) {
      toast(errorText(e), "error");
    }
    again();
  };
  const menu = (at) =>
    menuAt(at, menuHeader(app.title, m.name, "box"), [
      busy && { label: t("jobs.showLog"), icon: "logs", run: () => jobDialog(app.job.id, app.job.kind, app.title, again) },
      isUp(app) && { label: t("app.restart"), icon: "refresh", off: busy, run: act("restart") },
      { label: t("app.update"), icon: "up", off: busy, run: act("update") },
      { label: t("app.logs"), icon: "logs", run: () => machineAppLogsDialog(m, app) },
      { label: t("app.tab.compose"), icon: "code", off: busy, run: () => machineComposeDialog(m, app) },
      { label: t("machines.move"), icon: "server", off: busy, run: () => moveAppDialog(m.id, app) },
      { label: t("app.remove") + "…", icon: "trash", danger: true, off: busy, run: () => removeMachineAppDialog(m, app) },
    ]);
  put(
    box,
    pageHead({
      crumbs: crumbs(app.title),
      logo: appIcon(app, "row"),
      title: app.title,
      state: appStateBadge(app),
      facts: [h("a", { href: machineBase(m) }, m.name), app.store],
      actions: [url && { label: t("app.open"), icon: "external", href: url, newTab: true, primary: true }, isUp(app) ? { label: t("app.stop"), icon: "stop", run: () => !busy && act("stop")() } : { label: t("app.start"), icon: "play", primary: !url, run: () => !busy && act("start")() }, h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), "aria-haspopup": "menu", onclick: (e) => menu(underButton(e.currentTarget)) }, icon("more"))],
      menu,
    }),
    busy && uiCard({}, uiNotice({ tone: "info", title: t("status.busy"), action: button(t("jobs.showLog"), { class: "small", onclick: () => jobDialog(app.job.id, app.job.kind, app.title, again) }, "logs") })),
    h(
      "div",
      { class: "columns" },
      h(
        "div",
        { class: "stack" },
        uiCard(
          { title: t("app.containers"), count: app.containers.length || null, flush: true },
          app.containers.length
            ? uiTable([{ label: t("app.col.container") }, { label: t("app.col.state") }], app.containers.map((c) => ({ cells: [uiCell({ name: h("span", { class: "mono" }, c.name), sub: h("span", { class: "mono" }, c.image) }), uiState(c.state === "running" ? "ok" : c.state === "restarting" ? "warn" : "off", c.status || c.state)], sub: c.image })))
            : uiEmpty({ text: t("app.noContainers") }),
        ),
      ),
      h(
        "aside",
        { class: "side" },
        uiCard({ title: t("app.glance") }, ...uiFacts([[t("apps.col.machine"), h("a", { href: machineBase(m) }, m.name)], (url || app.port) && [t("app.address"), h("span", { class: "mono" }, url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : `${m.ip}:${app.port}`)], app.guarded && [t("access.signIn"), t("access.through", { port: app.guarded })]]), accessLink()),
        app.login && app.login.kind !== "none" && uiCard({ title: t("app.login") }, loginBlock(app.login, loginAsker(app.name, m.id))),
        app.tips && uiCard({ title: t("app.notes") }, h("div", { class: "tips prose" }, md(app.tips))),
      ),
    ),
  );
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
      h("td", null, h("div", { class: "with-icon machine-app" }, appIcon(app), h("div", { class: "stack-s" }, h("a", { class: "strong", href: `#/apps/${app.name}@${m.id}` }, app.title), h("span", { class: "muted small mono" }, app.name + (app.store ? ` · ${app.store}` : ""))))),
      h("td", null, stateChip(app)),
      h("td", { class: "mono small" }, app.guarded && h("span", { class: "lock-mark", title: t("access.protected") }, icon("lock")), url ? h("a", { class: "link", href: url, target: "_blank", rel: "noopener noreferrer" }, url.replace(/^https?:\/\//, "").replace(/\/$/, "")) : app.port ? `${m.ip}:${app.port}` : "—"),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          busy && small(t("jobs.showLog"), "logs", () => jobDialog(app.job.id, app.job.kind, app.title, () => void loadMachineApps())),
          app.login && app.login.kind !== "none" && small(t("app.login"), "key", () => loginDialog(app.title, app.login, loginAsker(app.name, m.id))),
          app.tips && small(t("app.notes"), "info", () => notesDialog(app.title, app.tips)),
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
            if (app) jobDialog(res.job, "apply", app.title, () => void loadMachineApps());
            else jobInBackground(res.job, "install", name.value.trim(), () => void loadMachineApps());
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
