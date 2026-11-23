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
          h("ul", { class: "paths mono small" }, snapshot.paths.map((path) => h("li", null, path))),
          h("p", { class: "cmd" }, icon("terminal"), `tar -xzf ${snapshot.id}.tar.gz -C /`),
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
  if (!snapshots.length) return h("p", { class: "muted" }, t("backup.none"));
  return h(
    "div",
    { class: "snapshot-list" },
    snapshots.map((s) =>
      h(
        "div",
        { class: "snapshot" },
        h("div", { class: "grow" }, h("strong", null, dateTime(s.at)), h("div", { class: "muted small" }, [t("backup.reason." + s.reason), bytes(s.size), s.images[0]].filter(Boolean).join(" · "))),
        !app.incus && button(t("backup.files"), { class: "small", onclick: () => snapshotFilesDialog(app, s) }, "folder"),
        button(t("backup.restore"), { class: "small", onclick: () => restoreDialog(app, s) }, "undo"),
        h(
          "button",
          {
            type: "button",
            class: "icon-btn",
            "aria-label": t("backup.delete"),
            title: t("backup.delete"),
            onclick: () =>
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
  const tab = state.route.tab ?? "overview";
  shell(...settingsFrame("backups", tab === "overview" && h("section", { class: "stats card", id: "backup-stats" }), h("div", { class: "stack", id: "backup-body" }, waitMark())));
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
  if (tab === "history") {
    const list = backupHistory.entries;
    return put(box, uiCard({ title: t("area.backups.history"), lead: t("backup.historyLead"), flush: true }, !list ? uiEmpty({ size: "loading" }) : list.length ? list.map((e) => activityItem(e, new Date(e.ts).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))) : uiEmpty({ text: t("activity.none") })));
  }
  if (tab === "offsite") return put(box, offsiteCard(b.offsite)), void (clearTimeout(offsiteTimer), b.offsite.running && (offsiteTimer = setTimeout(() => state.route.view === "backups" && loadBackups(), 3000)));
  if (tab === "schedule") return box.contains(document.activeElement) ? undefined : put(box, backupScheduleForm(b, s), backupServerHow(b), h("p", { class: "card pad muted small" }, t("backup.how")));

  const stat = (iconName, label, value, unit, hint, cls = "") => h("div", { class: "stat" }, h("div", { class: "stat-label" }, icon(iconName), label), h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", { class: cls }, value), h("span", { class: "unit" }, unit))), h("div", { class: "stat-hint" }, hint || " "));
  const last = b.lastRun;
  const count = b.apps.reduce((n, a) => n + a.snapshots.length, 0);
  const stored = bytesParts(b.stored);
  const free = b.free == null ? null : bytesParts(b.free);
  const installed = b.apps.filter((a) => a.installed);
  document.getElementById("backup-stats")?.replaceChildren(
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
  const daily = s.enabled ? t("backup.everyDay", { time: s.time }) : t("backup.byHand");
  const group = (title, lead) => h("tr", { class: "group-row" }, h("td", { colSpan: 6 }, h("strong", null, title), lead && h("span", { class: "muted small" }, " · ", lead)));
  const when = (at, note) => (at ? h("div", { class: "with-dot" }, h("i", { class: "dot running" }), h("div", null, ago(at), note && h("div", { class: "muted small" }, note))) : h("span", { class: "muted" }, t("backup.noneShort")));
  const more = (entries) => (e) => menuAt(underButton(e.currentTarget), null, entries);
  const dots = (entries) => h("button", { type: "button", class: "btn small square", "aria-label": t("app.more"), "aria-haspopup": "menu", onclick: more(entries) }, icon("more"));
  const row = (app) => {
    const newest = app.snapshots[0];
    const size = app.snapshots.reduce((n, x) => n + x.size, 0);
    const page = app.incus ? `#/containers/i/${app.name.replace(/@incus$/, "")}` : app.machine ? `#/machines/${app.machine.id}/apps` : `#/apps/${app.name}/backups`;
    const kind = app.incus?.kind ? t(app.incus.kind === "vm" ? "incus.kind.vm" : "incus.kind.container") : app.machine ? app.machine.name : "";
    return h(
      "tr",
      { class: app.installed ? "" : "removed" },
      h("td", null, h("div", { class: "with-icon" }, app.incus ? h("span", { class: "app-icon sm plus" }, icon(app.incus.kind === "vm" ? "screen" : "box")) : appIcon(app, "sm"), h("div", { class: "stack-s backup-name" }, app.installed ? h("a", { class: "strong", href: page }, app.title) : h("span", { class: "strong" }, app.title), kind && h("div", { class: "muted small" }, kind), !app.installed && h("div", { class: "muted small" }, t("backup.removedApp")), app.otherFolders.length > 0 && h("button", { type: "button", class: "text-btn muted small", title: app.otherFolders.join("\n"), onclick: () => backupFoldersDialog(app, loadBackups) }, t("backup.folders.row", { n: app.otherFolders.length, m: app.extraFolders.length }))))),
      h("td", { class: app.installed && !app.included ? "warn-text" : "muted" }, !app.installed ? "—" : app.included ? daily : t("backup.notDaily")),
      h("td", null, when(newest?.at, newest && t("backup.reason." + newest.reason))),
      h("td", { class: "num" }, size ? bytes(size) : "—"),
      h("td", { class: "muted" }, app.snapshots.length ? t("backup.copies", { n: app.snapshots.length }) : "—"),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          app.installed && !app.included && s.enabled ? button(t("backup.turnOn"), { class: "small primary", onclick: () => toggleInclude(app, true) }, "play") : app.snapshots.length > 0 ? button(t("backup.restore"), { class: "small", onclick: () => snapshotsDialog(app) }, "undo") : app.installed && button(t("backup.nowShort"), { class: "small", onclick: () => backupNow(app) }, "archive"),
          dots([
            app.installed && { label: t("backup.now"), icon: "archive", run: () => backupNow(app) },
            app.snapshots.length > 0 && { label: t("backup.restore") + "…", icon: "undo", run: () => snapshotsDialog(app) },
            app.installed && !app.incus && !app.machine && { label: t("backup.folders.open"), icon: "folder", run: () => backupFoldersDialog(app, loadBackups) },
            app.installed && { label: t(app.included ? "backup.dailyOff" : "backup.dailyOn"), icon: app.included ? "x" : "check", run: () => toggleInclude(app, !app.included) },
            app.installed && { label: t("common.open"), icon: "arrow", href: page },
          ]),
        ),
      ),
    );
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
  const serverRow = h(
    "tr",
    null,
    h("td", null, h("div", { class: "with-icon" }, h("span", { class: "app-icon sm plus" }, icon("server")), h("div", { class: "stack-s backup-name" }, h("a", { class: "strong", href: "#/machines/this" }, state.overview?.system?.hostname ?? t("tree.thisServer")), h("div", { class: "muted small" }, t("backup.serverWhat"))))),
    h("td", { class: "muted" }, t("backup.withEveryRun")),
    h("td", null, when(newest?.at)),
    h("td", { class: "num" }, newest ? bytes(newest.size) : "—"),
    h("td", { class: "muted" }, b.server.length ? t("backup.copies", { n: b.server.length }) : "—"),
    h("td", null, h("div", { class: "row-actions" }, button(t("backup.nowShort"), { class: "small", onclick: serverNow }, "archive"), dots([{ label: t("backup.now"), icon: "archive", run: serverNow }, { label: t("backup.serverHowOpen"), icon: "info", href: "#/backups/schedule" }]))),
  );
  const moreData = state.backupsMore;
  // a Proxmox server and, under it, each of its guests: whether something backs it up — the copies themselves are Proxmox's
  const pveRow = (x) => {
    const left = x.unprotected ?? [];
    const sch = x.schedule;
    const often = sch?.on ? t("backup.everyDay", { time: sch.time }) : t("backup.pveOwn");
    const guests = (x.guests ?? []).filter((g) => !g.template);
    return [
      h(
        "tr",
        null,
        h("td", null, h("div", { class: "with-icon" }, h("span", { class: "app-icon sm plus" }, icon("server")), h("div", { class: "stack-s backup-name" }, h("a", { class: "strong", href: `#/proxmox/${x.id}` }, x.name), h("div", { class: "muted small" }, t("backup.pveWhat", { n: guests.length }))))),
        h("td", { class: "muted" }, often),
        h("td", null, x.unprotected == null ? h("span", { class: "muted" }, "—") : left.length ? h("span", { class: "with-dot warn-text" }, h("i", { class: "dot partial" }), t("backup.pveLeft", { n: left.length })) : h("span", { class: "with-dot" }, h("i", { class: "dot running" }), t("backup.pveAll"))),
        h("td", { class: "num" }, "—"),
        h("td", { class: "muted" }, sch?.on ? t("backup.copies", { n: sch.keep }) : "—"),
        h("td", null, h("div", { class: "row-actions" }, h("a", { class: "btn small", href: `#/proxmox/${x.id}` }, icon("arrow"), h("span", null, t("common.open"))))),
      ),
      ...guests.map((g) => {
        const bare = left.some((y) => y.vmid === g.vmid);
        return h(
          "tr",
          { class: "sub-row" },
          h("td", null, h("div", { class: "with-icon" }, h("span", { class: "app-icon sm plus" }, icon(g.type === "lxc" ? "box" : "screen")), h("div", { class: "stack-s backup-name" }, h("a", { class: "strong", href: `#/guest/${x.id}/${g.id}` }, g.name || String(g.vmid)), h("div", { class: "muted small" }, guestKind(g))))),
          h("td", { class: bare ? "warn-text" : "muted" }, x.unprotected == null ? "—" : bare ? t("backup.notBacked") : often),
          h("td", null, x.unprotected == null ? h("span", { class: "muted" }, "—") : bare ? h("span", { class: "with-dot warn-text" }, h("i", { class: "dot partial" }), t("tree.noBackup")) : h("span", { class: "with-dot muted" }, h("i", { class: "dot running" }), t("backup.pveKept"))),
          h("td", { class: "num" }, "—"),
          h("td", { class: "muted" }, "—"),
          h("td", null, h("div", { class: "row-actions" }, h("a", { class: "btn small", href: `#/guest/${x.id}/${g.id}` }, icon("arrow"), h("span", null, t("common.open"))))),
        );
      }),
    ];
  };
  const haRow = (x) => {
    const list = x.backups ?? [];
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon" }, h("span", { class: "app-icon sm plus" }, icon("bulb")), h("div", { class: "stack-s backup-name" }, h("a", { class: "strong", href: `#/house/ha/${x.id}` }, x.name), h("div", { class: "muted small" }, t("backup.haWhat"))))),
      h("td", { class: "muted" }, t("backup.haOwn")),
      h("td", null, when(list[0] && Date.parse(list[0].date), list[0]?.automatic ? t("backup.haAuto") : "")),
      h("td", { class: "num" }, list[0]?.size ? bytes(list[0].size) : "—"),
      h("td", { class: "muted" }, list.length ? t("backup.copies", { n: list.length }) : "—"),
      h("td", null, h("div", { class: "row-actions" }, h("a", { class: "btn small", href: `#/house/ha/${x.id}` }, icon("arrow"), h("span", null, t("common.open"))))),
    );
  };
  const own = b.apps.filter((a) => !a.incus && !a.machine);
  const others = b.apps.filter((a) => a.incus || a.machine);
  put(
    box,
    h(
      "div",
      { class: "card table-wrap" },
      h(
        "table",
        { class: "backups-table" },
        h("thead", null, h("tr", null, h("th", null, t("backup.col.what")), h("th", null, t("backup.col.often")), h("th", null, t("backup.col.last")), h("th", { class: "num" }, t("backup.col.size")), h("th", null, t("backup.col.keeps")), h("th"))),
        h(
          "tbody",
          null,
          group(t("backup.group.server")),
          serverRow,
          group(t("nav.apps"), own.length ? "" : t("backup.noApps")),
          own.map(row),
          (others.length > 0 || moreData?.pve.length > 0) && group(t("nav.machines"), t("backup.machinesLead")),
          others.map(row),
          (moreData?.pve ?? []).map(pveRow),
          moreData?.ha.length > 0 && group("Home Assistant", t("backup.haLead")),
          (moreData?.ha ?? []).map(haRow),
        ),
      ),
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
  return h(
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
  );
}

/** How the server itself is brought back on a new computer */
const backupServerHow = (b) => h("section", { class: "card pad stack-s" }, h("h2", null, t("backup.server")), h("p", { class: "muted small" }, t("backup.serverHint")), h("p", { class: "muted small" }, t("backup.serverRestore")), h("p", { class: "cmd" }, icon("terminal"), `sudo hata restore ${b.dir}`));

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
        : h("p", { class: "muted" }, t("offsite.noPlaces"), " ", h("a", { href: "#/settings/places" }, t("offsite.addPlace")))),
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
