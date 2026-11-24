// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

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
    const res = await api("POST", app.machine || app.incus ? `/api/backups/${app.name}/take` : `/api/apps/${app.name}/backup`, {});
    jobDialog(res.job, "backup", app.title, () => (state.route.view === "backups" ? loadBackups() : state.route.view === "containers" ? loadContainers() : loadApp(true)));
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function restoreDialog(app, snapshot) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("backup.restoreTitle", { title: app.title })),
    app.incus
      ? h("p", { class: "muted" }, t("backup.incus.restoreLead", { time: dateTime(snapshot.at), name: app.title }))
      : [
          h("p", { class: "muted" }, t("backup.restoreLead", { time: dateTime(snapshot.at) })),
          uiList(snapshot.paths),
          uiCommand(`tar -xzf ${snapshot.id}.tar.gz -C /`),
        ],
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
  if (!snapshots.length) return uiEmpty({ text: t("backup.none") });
  return uiRows(snapshots.map((s) => {
      const entries = [
        !app.incus && { label: t("backup.files"), icon: "folder", run: () => snapshotFilesDialog(app, s) },
        {
          label: t("backup.delete") + "…",
          icon: "trash",
          danger: true,
          run: () =>
            confirmAction({
              title: t("backup.deleteTitle", { time: dateTime(s.at) }),
              lead: t("backup.deleteLead"),
              label: t("backup.delete"),
              run: async () => {
                await api("DELETE", `/api/backups/${app.name}/${s.id}`);
                reload();
              },
            }),
        },
      ].filter(Boolean);
      return uiRow({
        lead: { icon: "archive" },
        name: dateTime(s.at),
        sub: [t("backup.reason." + s.reason), bytes(s.size), s.images[0]].filter(Boolean).join(" · "),
        action: button(t("backup.restore"), { class: "small", onclick: () => restoreDialog(app, s) }, "undo"),
        more: entries,
        menu: (at) => menuAt(at, null, entries),
      });
    }));
}

/** What a snapshot holds: its folders walked like a disk, a file taken out, chosen ones put back */
function snapshotFilesDialog(app, snapshot) {
  const base = `/api/backups/${app.name}/${snapshot.id}`;
  const chosen = new Set();
  const crumbs = h("div");
  const list = h("div", null, uiEmpty({ size: "loading", text: t("backup.files.reading") }));
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
    put(crumbs, uiCrumbs([{ label: t("backup.files.top"), onclick: () => open("") }, root && { label: root, mono: true, onclick: () => open(root) }, ...steps.map((step, i) => ({ label: step, mono: true, onclick: () => open(root + "/" + steps.slice(0, i + 1).join("/")) }))]));
    put(list, data.entries.length ? snapshotEntries(data.entries, { base, path, chosen, count, open, ticks: !app.machine }) : uiEmpty({ text: t("backup.files.empty") }));
  };
  const confirmRestore = () => {
    const paths = [...chosen].sort();
    const sure = openDialog(
      "confirm",
      h("h2", null, t("backup.files.sureTitle", { n: paths.length })),
      h("p", { class: "muted" }, t("backup.files.sureLead", { time: dateTime(snapshot.at), title: app.title })),
      uiList([...paths.slice(0, 12), paths.length > 12 && "…"]),
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

/** The entries of a folder of a snapshot, to walk, tick and take out one by one */
function snapshotEntries(entries, { base, path, chosen, count, open, ticks }) {
  return uiFileList(
    entries.map((entry) => {
      const name = path ? entry.path.slice(entry.path.lastIndexOf("/") + 1) : entry.path;
      const tick = ticks && h("input", { type: "checkbox", checked: chosen.has(entry.path), "aria-label": name, onchange: () => ((tick.checked ? chosen.add(entry.path) : chosen.delete(entry.path)), count()) });
      return { name, dir: entry.dir, mono: !path, note: entry.link ? "→ " + entry.link : null, size: entry.dir || entry.link ? null : entry.size, at: entry.at, tick, open: () => open(entry.path), download: entry.dir || entry.link ? null : `${base}/file?path=${encodeURIComponent(entry.path)}` };
    }),
  );
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
      data.always.length > 0 && uiList(data.always),
      h("h3", null, t("backup.folders.other")),
      ticks.length
        ? [
            h("p", { class: "muted small" }, t("backup.folders.otherHint")),
            ...ticks.map(({ folder, input }) => uiCheck(h("strong", { class: "mono" }, folder.path), input, folder.allowed ? (folder.size === null ? t("backup.folders.unknown") : bytes(folder.size)) : t("backup.folders.never"))),
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
  put(
    box,
    uiCard(
      { title: t("backup.appLead"), lead: app.folders.join(" · "), flush: true, actions: [button(t("backup.folders.button"), { onclick: () => backupFoldersDialog(app) }, "folder"), button(t("backup.now"), { class: "primary", disabled: !!app.job, onclick: () => backupNow(app) }, "archive")] },
      snapshotList(app, snapshots, () => renderAppTab()),
    ),
  );
}

function renderBackups() {
  const tab = state.route.tab ?? "overview";
  shell(...settingsFrame("backups", tab === "overview" && uiCard({ flush: true }, uiStats([], { id: "backup-stats" })), h("div", { class: "stack", id: "backup-body" }, uiCard({ flush: true }, uiEmpty({ size: "loading" })))));
  renderBackupsBody();
  if (tab === "overview") void loadBackupsMore();
  if (tab === "history") void loadBackupHistory();
}

/** What is backed up but not by Hata's own folder: the guests of Proxmox and Home Assistant — a row each in the one table */
async function loadBackupsMore() {
  const pve = hasModule("proxmox") ? await api("GET", "/api/proxmox").then((r) => Promise.all((r.hosts ?? []).map((x) => api("GET", `/api/proxmox/${x.id}`).catch(() => x))), () => []) : [];
  const ha = hasModule("integrations") ? await api("GET", "/api/ha").then((r) => Promise.all((r.servers ?? []).map((x) => api("GET", `/api/ha/${x.id}`).catch(() => x))), () => []) : [];
  state.backupsMore = { pve, ha };
  if (state.route.view === "backups") renderBackupsBody();
}

/** The history of backups is the activity log's lines about them: there is no other record of the runs */
const backupHistory = { entries: null };
/** Proxmox servers whose backed-up guests are shown too, not only the ones without a copy */
const backupUi = { pveAll: new Set() };
async function loadBackupHistory() {
  const found = [];
  let before = Date.now() + 60_000;
  for (let i = 0; i < 4; i++) {
    const page = await api("GET", `/api/activity?before=${before}`).catch(() => null);
    if (!page) break;
    found.push(...page.entries.filter((e) => /backup|restor|snapshot/i.test(e.code)));
    if (!page.more || !page.entries.length) break;
    before = page.entries[page.entries.length - 1].ts;
  }
  backupHistory.entries = found;
  if (state.route.view === "backups") renderBackupsBody();
}

function renderBackupsBody() {
  const b = state.backups;
  const s = state.settings?.backup;
  const box = document.getElementById("backup-body");
  if (!b || !s || !box) return;
  const tab = state.route.tab ?? "overview";

  document.getElementById("backup-meta").replaceChildren(b.dir, h("span", { class: "ui-dot-sep" }, " · "), s.enabled ? t("backup.daily", { time: s.time, keep: s.keep }) : t("backup.scheduleOff"));
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
  if (tab === "history") {
    const list = backupHistory.entries;
    return put(box, uiCard({ title: t("area.backups.history"), lead: t("backup.historyLead"), flush: true }, !list ? uiEmpty({ size: "loading" }) : list.length ? list.map((e) => activityItem(e, new Date(e.ts).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))) : uiEmpty({ text: t("activity.none") })));
  }
  if (tab === "offsite") return put(box, offsiteCard(b.offsite)), void (clearTimeout(offsiteTimer), b.offsite.running && (offsiteTimer = setTimeout(() => state.route.view === "backups" && loadBackups(), 3000)));
  if (tab === "schedule") return box.contains(document.activeElement) ? undefined : put(box, backupScheduleForm(b, s), backupServerHow(b), uiCard({}, uiNotice({ tone: "info", text: t("backup.how") })));

  const last = b.lastRun;
  const count = b.apps.reduce((n, a) => n + a.snapshots.length, 0);
  const stored = bytesParts(b.stored);
  const free = b.free == null ? null : bytesParts(b.free);
  const installed = b.apps.filter((a) => a.installed);
  document.getElementById("backup-stats")?.replaceChildren(
    uiStat({ icon: last?.failed.length ? "alert" : "check", label: t("backup.lastRun"), value: last ? ago(last.at) : "—", tone: last?.failed.length ? "warn" : null, hint: last ? (last.failed.length ? t("backup.lastFailed", { ok: last.ok, failed: last.failed.join(", ") }) : t("backup.lastOk", { ok: last.ok })) : t("backup.never") }),
    uiStat({ icon: "refresh", label: t("backup.nextRun"), value: b.nextRun ? s.time : "—", hint: b.nextRun ? `${new Date(b.nextRun).toLocaleDateString(state.lang, { weekday: "long", timeZone: b.timezone })} · ${t("backup.serverTime", { tz: b.timezone })}` : t("backup.scheduleOff") }),
    uiStat({ icon: "archive", label: t("backup.stored"), value: stored.value, unit: stored.unit, hint: t("backup.snapshots", { n: count }) }),
    uiStat({ icon: "check", label: t("backup.protected"), value: String(installed.filter((a) => a.included).length), hint: t("backup.ofApps", { n: installed.length }) }),
    uiStat({ icon: "disk", label: t("backup.destination"), value: free ? free.value : "—", unit: free ? free.unit : null, hint: free ? t("backup.freeAt", { path: b.dir }) : t("backup.noDir") }),
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
  const daily = s.enabled ? t("backup.everyDay", { time: s.time }) : t("backup.byHand");
  const group = (title, lead) => ({ group: h("span", null, title, lead && h("span", { class: "muted" }, " · " + lead)) });
  const when = (at, note) => (at ? uiCell({ name: h("span", { class: "small" }, ago(at)), sub: note || null }) : h("span", { class: "muted" }, t("backup.noneShort")));
  const lead = (iconName) => ({ icon: iconName });
  const row = (app) => {
    const newest = app.snapshots[0];
    const size = app.snapshots.reduce((n, x) => n + x.size, 0);
    const page = app.incus ? `#/containers/i/${app.name.replace(/@incus$/, "")}` : app.machine ? `#/machines/${app.machine.id}/apps` : `#/apps/${app.name}/backups`;
    const kind = app.incus?.kind ? t(app.incus.kind === "vm" ? "incus.kind.vm" : "incus.kind.container") : app.machine ? app.machine.name : "";
    const off = app.installed && !app.included;
    const entries = [
      app.installed && { label: t("backup.now"), icon: "archive", run: () => backupNow(app) },
      app.snapshots.length > 0 && { label: t("backup.restore") + "…", icon: "undo", run: () => snapshotsDialog(app) },
      app.installed && !app.incus && !app.machine && { label: t("backup.folders.open"), icon: "folder", run: () => backupFoldersDialog(app, loadBackups) },
      app.installed && { label: t(app.included ? "backup.dailyOff" : "backup.dailyOn"), icon: app.included ? "x" : "check", run: () => toggleInclude(app, !app.included) },
      app.installed && { label: t("common.open"), icon: "arrow", href: page },
    ].filter(Boolean);
    const action = off && s.enabled ? button(t("backup.turnOn"), { class: "small primary", onclick: () => toggleInclude(app, true) }, "play") : app.snapshots.length > 0 ? button(t("backup.restore") + "…", { class: "small", onclick: () => snapshotsDialog(app) }, "undo") : app.installed ? button(t("backup.nowShort"), { class: "small", onclick: () => backupNow(app) }, "archive") : null;
    const subs = [kind, !app.installed && t("backup.removedApp"), app.otherFolders.length > 0 && t("backup.folders.row", { n: app.otherFolders.length, m: app.extraFolders.length })].filter(Boolean).join(" · ");
    return uiTableRow({
      menu: (at) => menuAt(at, null, entries),
      cells: [
        uiCell({ lead: app.incus ? lead(app.incus.kind === "vm" ? "screen" : "box") : { logo: appIcon(app, "row") }, name: app.installed ? h("a", { href: page }, app.title) : app.title, sub: subs || null }),
        !app.installed ? h("span", { class: "muted" }, "—") : off ? uiState("warn", t("backup.notDaily")) : h("span", { class: "muted" }, daily),
        when(newest?.at, newest && t("backup.reason." + newest.reason)),
        size ? bytes(size) : "—",
        h("span", { class: "muted" }, app.snapshots.length ? t("backup.copies", { n: app.snapshots.length }) : "—"),
        uiLine([action, uiMore(entries, { size: "s" })], { end: true }),
      ],
      sub: [off ? null : app.installed ? daily : null, newest ? ago(newest.at) : null, size ? bytes(size) : null].filter(Boolean).join(" · "),
    }, { gone: !app.installed });
  };
  const newest = b.server[0];
  const serverNow = async () => {
    try {
      state.backups = await api("POST", "/api/backups/server", {});
      toast(t("backup.serverDone"));
    } catch (e) {
      toast(errorText(e), "error");
    }
    renderBackupsBody();
  };
  const serverEntries = [{ label: t("backup.now"), icon: "archive", run: serverNow }, { label: t("backup.serverHowOpen"), icon: "info", href: "#/backups/schedule" }];
  const serverRow = {
    menu: (at) => menuAt(at, null, serverEntries),
    cells: [
      uiCell({ lead: lead("server"), name: h("a", { href: "#/machines/this" }, state.overview?.system?.hostname ?? t("tree.thisServer")), sub: t("backup.serverWhat") }),
      h("span", { class: "muted" }, t("backup.withEveryRun")),
      when(newest?.at),
      newest ? bytes(newest.size) : "—",
      h("span", { class: "muted" }, b.server.length ? t("backup.copies", { n: b.server.length }) : "—"),
      uiLine([button(t("backup.nowShort"), { class: "small", onclick: serverNow }, "archive"), uiMore(serverEntries, { size: "s" })], { end: true }),
    ],
    sub: [t("backup.withEveryRun"), newest ? ago(newest.at) : null].filter(Boolean).join(" · "),
  };
  const moreData = state.backupsMore;
  const open = (href) => h("a", { class: "btn small", href }, icon("arrow"), h("span", null, t("common.open")));
  // a Proxmox server and, under it, the guests nothing backs up; the rest folded into one row
  const pveRow = (x) => {
    const left = x.unprotected ?? [];
    const sch = x.schedule;
    const often = sch?.on ? t("backup.everyDay", { time: sch.time }) : t("backup.pveOwn");
    const guests = (x.guests ?? []).filter((g) => !g.template);
    const bare = (g) => left.some((y) => y.vmid === g.vmid);
    const all = backupUi.pveAll.has(x.id);
    const shown = all ? guests : guests.filter(bare);
    const kept = guests.length - guests.filter(bare).length;
    const state2 = x.unprotected == null ? h("span", { class: "muted" }, "—") : left.length ? uiState("warn", t("backup.pveLeft", { n: left.length })) : uiState("ok", t("backup.pveAll"));
    return [
      {
        cells: [uiCell({ lead: lead("server"), name: h("a", { href: `#/proxmox/${x.id}` }, x.name), sub: t("backup.pveWhat", { n: guests.length }) }), h("span", { class: "muted" }, often), state2, "—", h("span", { class: "muted" }, sch?.on ? t("backup.copies", { n: sch.keep }) : "—"), open(`#/proxmox/${x.id}`)],
        sub: often,
      },
      ...shown.map((g) => uiTableRow({
        href: `#/guest/${x.id}/${g.id}`,
        cells: [
          uiCell({ lead: lead(g.type === "lxc" ? "box" : "screen"), name: g.name || String(g.vmid), sub: guestKind(g) }),
          x.unprotected == null ? "—" : bare(g) ? uiState("warn", t("backup.notBacked")) : h("span", { class: "muted" }, often),
          x.unprotected == null ? "—" : bare(g) ? uiState("warn", t("tree.noBackup")) : h("span", { class: "muted small" }, t("backup.pveKept")),
          "—",
          "—",
          "",
        ],
        sub: x.unprotected != null && bare(g) ? t("tree.noBackup") : null,
      }, { under: true })),
      kept > 0 && x.unprotected != null && uiTableRow({
        whole: uiEmpty({ text: all ? t("backup.guestsLess") : t("backup.guestsMore", { n: kept }), action: button(all ? t("backup.guestsLess") : t("ui.showMore"), { class: "small quiet", onclick: () => (all ? backupUi.pveAll.delete(x.id) : backupUi.pveAll.add(x.id), renderBackupsBody()) }, all ? "up" : "down") }),
      }, { under: true }),
    ].filter(Boolean);
  };
  const haRow = (x) => {
    const list = x.backups ?? [];
    return {
      cells: [
        uiCell({ lead: lead("bulb"), name: h("a", { href: `#/house/ha/${x.id}` }, x.name), sub: t("backup.haWhat") }),
        h("span", { class: "muted" }, t("backup.haOwn")),
        when(list[0] && Date.parse(list[0].date), list[0]?.automatic ? t("backup.haAuto") : ""),
        list[0]?.size ? bytes(list[0].size) : "—",
        h("span", { class: "muted" }, list.length ? t("backup.copies", { n: list.length }) : "—"),
        open(`#/house/ha/${x.id}`),
      ],
      sub: t("backup.haOwn"),
    };
  };
  const own = b.apps.filter((a) => !a.incus && !a.machine);
  const others = b.apps.filter((a) => a.incus || a.machine);
  const rows = [
    group(t("backup.group.server")),
    serverRow,
    group(t("nav.apps"), own.length ? "" : t("backup.noApps")),
    ...own.map(row),
    (others.length > 0 || moreData?.pve.length > 0) && group(t("nav.machines"), t("backup.machinesLead")),
    ...others.map(row),
    ...(moreData?.pve ?? []).flatMap(pveRow),
    moreData?.ha.length > 0 && group("Home Assistant", t("backup.haLead")),
    ...(moreData?.ha ?? []).map(haRow),
  ].filter(Boolean);
  put(
    box,
    uiCard(
      { flush: true },
      uiTable([{ label: t("backup.col.what") }, { label: t("backup.col.often") }, { label: t("backup.col.last") }, { label: t("backup.col.size"), num: true }, { label: t("backup.col.keeps") }, { label: "" }], rows),
      !moreData && uiEmpty({ size: "loading" }),
    ),
  );
}

/** When and where the daily run copies: the form of the tab "Schedule and place" */
function backupScheduleForm(b, s) {
  const enabled = h("input", { type: "checkbox", checked: s.enabled });
  const time = h("input", { type: "time", value: s.time, class: "short mono", required: true });
  const keep = h("input", { type: "number", min: 1, max: 365, value: s.keep, class: "short mono", required: true });
  const dir = h("input", { value: s.dir, placeholder: b.dir, spellcheck: false, class: "mono" });
  const beforeUpdate = h("input", { type: "checkbox", checked: s.beforeUpdate });
  const error = h("p", { class: "error", role: "alert" });
  return uiCard(
    { title: t("backup.schedule") },
    h(
    "form",
    {
      class: "stack",
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
    uiSetting({ name: t("backup.enable"), explain: t("backup.enableHint"), control: enabled }),
    uiSetting({ name: t("backup.time"), explain: b.timezone, control: time }),
    uiSetting({ name: t("backup.keep"), control: keep }),
    uiSetting({ name: t("backup.dir"), explain: t("backup.dirHint"), control: dir }),
    uiSetting({ name: t("backup.beforeUpdate"), explain: t("backup.beforeUpdateHint"), control: beforeUpdate }),
    error,
    uiFoot(h("button", { class: "btn primary" }, t("settings.save"))),
    ),
  );
}

/** How the server itself is brought back on a new computer */
const backupServerHow = (b) => uiCard({ title: t("backup.server"), lead: t("backup.serverHint") }, h("p", { class: "muted small" }, t("backup.serverRestore")), uiCommand(`sudo hata restore ${b.dir}`));

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
      uiCommand(`${result.keyType} ${result.fingerprint}`, { block: true }),
      h("p", { class: "muted small" }, t("offsite.hostHint")),
      uiCommand("for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf $f; done"),
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
  // the state in the card's head; what went wrong as a notice under it
  const mark = o.running ? uiState("info", t("offsite.running")) : last?.error && o.enabled && shown === o.kind ? uiState("bad", t("offsite.stateFailed")) : o.enabled ? uiState("ok", t("offsite.stateOn")) : uiState("off", t("offsite.stateOff"));
  const status = !o.available && sftp
    ? uiNotice({ tone: "info", text: t("offsite.noSftp") })
    : last && o.enabled && shown === o.kind && !o.running && (last.error ? uiNotice({ tone: "bad", text: t("offsite.failed", { when: ago(last.at), message: last.error }) }) : h("p", { class: "muted small" }, t("offsite.inStep", { when: ago(last.at) })));
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
  return uiCard(
    { title: t("offsite.title"), marks: mark, id: "offsite-form" },
    h(
    "form",
    { class: "stack", onsubmit: save },
    status,
    uiSetting({ name: t("offsite.enable"), explain: t("offsite.enableHint"), control: enabled }),
    uiSetting({ name: t("offsite.kind"), explain: t("offsite.kindHint." + shown), control: kind }),
    s3 && [
      uiSetting({ name: t("offsite.endpoint"), explain: t("offsite.endpointHint"), control: endpoint }),
      uiSetting({ name: t("offsite.bucket"), explain: null, control: bucket }),
      uiSetting({ name: t("offsite.region"), explain: null, control: region }),
      uiSetting({ name: t("offsite.prefix"), explain: t("offsite.prefixHint"), control: prefix }),
      uiSetting({ name: t("offsite.accessKey"), explain: null, control: accessKey }),
      uiSetting({ name: t("offsite.secret"), explain: t("offsite.secretHint"), control: secret }),
    ],
    inPlace &&
      (o.places.length
        ? [uiSetting({ name: t("offsite.place"), explain: null, control: placeChoice }), uiSetting({ name: t("offsite.placePath"), explain: t("offsite.placePathHint"), control: placePath })]
        : uiNotice({ tone: "info", text: t("offsite.noPlaces"), action: h("a", { class: "btn small", href: "#/storage/places" }, t("offsite.addPlace")) })),
    sftp && uiSetting({ name: t("offsite.host"), explain: null, control: host }),
    sftp && uiSetting({ name: t("offsite.port"), explain: null, control: port }),
    sftp && uiSetting({ name: t("offsite.user"), explain: null, control: user }),
    sftp && uiSetting({ name: t("offsite.path"), explain: t("offsite.pathHint"), control: path }),
    sftp && o.publicKey && uiSetting({ name: t("offsite.key"), explain: t("offsite.keyHint", { user: o.user || "backup" }), control: uiCommand(o.publicKey), wide: true }),
    uiSetting({ name: t("offsite.seal"), explain: t("offsite.sealHint"), control: seal }),
    uiSetting({ name: t("offsite.passphrase"), explain: t("offsite.passphraseHint"), control: passphrase }),
    sftp && o.fingerprint && h("p", { class: "muted small" }, t("offsite.hostKnown", { fingerprint: o.fingerprint })),
    error,
    uiFoot(h("button", { class: "btn primary", disabled: (!o.available && sftp) || (inPlace && !o.places.length) }, t("offsite.save"))),
    ),
  );
}
