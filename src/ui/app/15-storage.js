// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Disks --------------------------------------------------------------------------------------

// the colours of an app's state say the same three things about a disk
const HEALTH_STATE = { ok: "running", warn: "partial", danger: "restarting", unknown: "" };
const healthChip = (disk) => h("span", { class: "state " + HEALTH_STATE[disk.health] }, t("disks.health." + disk.health));
const diskTitle = (disk) => disk.model || disk.name;
const diskMeta = (disk) => [bytes(disk.size), disk.name, disk.transport === "nvme" ? "NVMe" : disk.transport.toUpperCase(), disk.transport !== "nvme" && t(disk.rotational ? "disks.kind.hdd" : "disks.kind.ssd"), disk.removable && t("disks.removable")].filter(Boolean).join(" · ");

function usageBar(used, total) {
  const percent = Math.round((used / total) * 100);
  const fill = h("i", { class: level(percent) });
  fill.style.width = percent + "%";
  return h("div", { class: "usage" }, h("div", { class: "usage-text" }, h("span", null, t("disks.usedOf", { used: bytes(used), total: bytes(total) })), h("span", { class: "muted" }, percent + "%")), h("div", { class: "bar" }, fill));
}

/** How long a disk has been switched on, from its count of hours */
function powerOnTime(hours) {
  const days = Math.floor(hours / 24);
  if (days < 2) return t("time.hours", { n: hours });
  if (days < 60) return t("time.days", { n: days });
  const months = Math.floor(days / 30.44);
  return [months >= 12 && t("time.years", { n: Math.floor(months / 12) }), months % 12 > 0 && t("time.months", { n: months % 12 })].filter(Boolean).join(" ");
}

const shortDate = (ts) => new Date(ts).toLocaleDateString(state.lang, { day: "numeric", month: "short", ...(new Date(ts).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });

let diskDialogPaint = null;

function setDisks(data) {
  state.disks = data;
  if (onStorageSection()) renderSettings();
  if (state.route.view === "welcome") paintWelcome();
  diskDialogPaint?.();
}

function diskDialog(name) {
  const body = h("div", { class: "stack" });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  // a hard disk may stop spinning when idle: its wait and whether it spins now
  const sleepBox = h("div", { class: "disk-sleep stack-s" });
  const paintSleep = (disk, report) => {
    const mine = report?.disks?.[disk.serial];
    if (!report) return put(sleepBox, h("h3", null, t("power.sleep.title")), waitMark());
    if (!report.tool) return put(sleepBox, h("h3", null, t("power.sleep.title")), h("p", { class: "muted small" }, t("power.sleep.lead")), packageCard({ package: "hdparm", install: report.install }, () => loadSleep(disk)));
    const select = h("select", { "aria-label": t("power.sleep.title"), onchange: async () => {
      select.disabled = true;
      try {
        paintSleep(disk, (await api("PUT", "/api/power/sleep", { serial: disk.serial, minutes: Number(select.value) })).sleep);
        toast(t("power.sleep.saved"));
      } catch (e) {
        toast(errorText(e), "error");
        select.disabled = false;
      }
    } }, SLEEP_MINUTES.map((n) => h("option", { value: n, selected: n === (mine?.minutes ?? 0) }, n ? t("power.sleep.after", { time: n >= 60 ? t("time.hours", { n: n / 60 }) : t("time.minutes", { n }) }) : t("power.sleep.never"))));
    put(
      sleepBox,
      h("h3", null, t("power.sleep.title")),
      h("p", { class: "muted small" }, t("power.sleep.lead")),
      h("div", { class: "kv" }, h("div", null, t("power.sleep.wait"), mine?.state && h("div", { class: "muted small" }, t("power.sleep.now." + mine.state))), select),
      mine?.error && h("p", { class: "error small" }, t("power.sleep.failed", { message: mine.error })),
    );
  };
  const loadSleep = async (disk) => {
    paintSleep(disk, null);
    paintSleep(disk, (await api("GET", "/api/power").catch(() => null))?.sleep ?? { tool: true, disks: {} });
  };
  const test = (type) => async (e) => {
    error.textContent = "";
    e.currentTarget.disabled = true;
    try {
      setDisks(await api("POST", `/api/disks/${name}/test`, { type }));
      toast(t("disks.test.started"));
    } catch (err) {
      error.textContent = errorText(err);
      paint();
    }
  };
  const paint = () => {
    const disk = state.disks?.disks.find((d) => d.name === name);
    if (!disk) return dialog?.close();
    const s = disk.smart;
    const value = (label, hint, shown, bad = false) => h("div", { class: "kv" }, h("div", null, label, hint && h("div", { class: "muted small" }, hint)), h("strong", { class: bad ? "bad" : "" }, shown));
    // a counter Hata saw at another value says so: "was 0 until 14 Sep"
    const moved = (key) => {
      const log = disk.log?.[key === "media" ? "mediaErrors" : key] ?? [];
      return log.length > 1 ? t("disks.value.was", { n: log.at(-2).value, date: shortDate(log.at(-1).at) }) : "";
    };
    const count = (key, n) => n != null && value(t(`disks.value.${key}`), moved(key) || t(`disks.value.${key}Hint`), String(n), n > 0 && key !== "crc");
    const last = s?.lastTest;
    put(
      body,
      h("header", null, h("span", { class: "badge-icon " + (disk.health === "ok" || disk.health === "unknown" ? "plain" : disk.health) }, icon("disk")), h("div", { class: "grow" }, h("h2", null, diskTitle(disk)), h("p", { class: "muted small" }, diskMeta(disk))), healthChip(disk), closeX(() => dialog)),
      !s && h("p", { class: "muted" }, t(state.disks.tool === "ok" ? "disks.noSmart" : `disks.tool.${state.disks.tool}Hint`)),
      s && (disk.findings.length ? disk.findings.map((f) => h("p", { class: "banner" + (f.severity === "danger" ? " danger" : "") }, t("disks.finding." + f.code, { n: f.n ?? 0 }))) : h("p", { class: "muted" }, t("disks.fine"))),
      s?.testing != null && h("p", { class: "with-icon" }, icon("refresh"), t("disks.test.running", { n: s.testing })),
      s &&
        h(
          "div",
          { class: "kv-list" },
          s.passed != null && value(t("disks.value.passed"), "", t(s.passed ? "disks.value.passedYes" : "disks.value.passedNo"), !s.passed),
          count("reallocated", s.reallocated),
          count("pending", s.pending),
          count("uncorrectable", s.uncorrectable),
          count("media", s.mediaErrors),
          count("crc", s.crc),
          s.wear != null && value(t("disks.value.wear"), t("disks.value.wearHint"), s.wear + "%", s.wear >= 90),
          s.spare && value(t("disks.value.spare"), t("disks.value.spareHint", { n: s.spare.threshold }), s.spare.left + "%", s.spare.left < s.spare.threshold),
          s.temperature != null && value(t("disks.value.temperature"), disk.hottest && disk.hottest.value > s.temperature ? t("disks.value.hottest", { n: disk.hottest.value, date: shortDate(disk.hottest.at) }) : "", s.temperature + " °C", disk.findings.some((f) => f.code === "hot")),
          s.powerOnHours != null && value(t("disks.value.powerOn"), t("disks.value.powerOnHint", { hours: s.powerOnHours, cycles: s.powerCycles ?? "—" }), powerOnTime(s.powerOnHours)),
          value(t("disks.value.lastTest"), last ? t("disks.value.testWhen", { type: has("disks.test." + last.type) ? t("disks.test." + last.type) : last.type, hours: Math.max(0, (s.powerOnHours ?? 0) - (last.hours ?? 0)) }) : "", last ? t(last.passed ? "disks.value.testPassed" : "disks.value.testFailed") : t("disks.value.testNever"), last && !last.passed),
        ),
      s && h("p", { class: "muted small" }, t("disks.test.hint")),
      disk.rotational && disk.serial && sleepBox,
      error,
      s && h("footer", null, h("span", { class: "muted small" }, disk.checkedAt ? t("disks.checked", { when: ago(disk.checkedAt) }) : ""), button(t("disks.test.runShort"), { disabled: s.testing != null, onclick: test("short") }), button(t("disks.test.runLong"), { disabled: s.testing != null, onclick: test("long") })),
      state.disks.mounting?.possible &&
        h(
          "div",
          { class: "disk-use" },
          h("h3", null, t("mounting.title")),
          disk.volumes.map((v) =>
            h(
              "div",
              { class: "kv" },
              h("div", null, h("span", { class: "mono" }, v.name), h("div", { class: "muted small" }, [bytes(v.size), v.fstype || t("mounting.noFs"), v.label].filter(Boolean).join(" · "))),
              h(
                "span",
                { class: "with-actions" },
                v.mounts.length ? h("span", { class: "mono" }, v.mounts[0]) : !state.disks.mounting.mountable.includes(v.path) && h("span", { class: "muted" }, t(v.swap ? "mounting.swap" : "disks.notMounted")),
                oneAndMore(
                  !v.mounts.length && state.disks.mounting.mountable.includes(v.path) ? button(t("mounting.connect"), { class: "small", onclick: () => (dialog.close(), connectDialog(disk, v)) }) : null,
                  [
                    canTend(disk, v) && { label: t("fsck.go"), icon: "check", run: () => (dialog.close(), checkDialog(disk, v)) },
                    canTend(disk, v) && { label: t("mounting.rename"), icon: "edit", run: () => (dialog.close(), labelDialog(disk, v)) },
                    v.kind === "part" && changeable(disk).volumes.includes(v.path) && RESIZABLE.includes(fsFamily(v.fstype)) && { label: t("resize.button"), icon: "sliders", run: () => (dialog.close(), resizeDialog(disk, v)) },
                    v.kind === "part" && disk.volumes.length > 1 && changeable(disk).volumes.includes(v.path) && { label: t("mounting.format"), icon: "disk", run: () => (dialog.close(), formatDialog(disk, v)) },
                    v.kind === "part" && changeable(disk).volumes.includes(v.path) && { label: t("partDelete.button"), icon: "trash", danger: true, run: () => (dialog.close(), deletePartDialog(disk, v)) },
                  ],
                  "small",
                ),
              ),
            ),
          ),
          (state.disks.mounting.free?.[disk.name] ?? 0) > 0 &&
            h("div", { class: "kv" }, h("div", null, h("span", null, t("mounting.unallocated")), h("div", { class: "muted small" }, bytes(state.disks.mounting.free[disk.name]))), h("span", { class: "with-actions" }, button(t("mounting.newPart"), { class: "small", onclick: () => (dialog.close(), formatDialog(disk, null, state.disks.mounting.free[disk.name])) }))),
          changeable(disk).whole ? h("footer", null, h("span", { class: "muted small" }, t("mounting.formatHint")), oneAndMore(button(t("mounting.formatDisk"), { onclick: () => (dialog.close(), formatDialog(disk)) }), [{ label: t("mounting.wipe"), icon: "trash", danger: true, run: () => (dialog.close(), wipeDialog(disk)) }])) : h("p", { class: "muted small" }, t("mounting.blocked." + (state.disks.mounting.blockers[disk.name]?.[0] ?? "mounted"))),
        ),
    );
  };
  dialog = openDialog("wide disk", body);
  diskDialogPaint = paint;
  dialog.addEventListener("close", () => (diskDialogPaint = null));
  paint();
  const disk = state.disks?.disks.find((d) => d.name === name);
  if (disk?.rotational && disk.serial) void loadSleep(disk);
}

// --- Putting a disk to use ---------------------------------------------------------------------------

const canPrepare = (disk) => state.disks?.mounting?.possible && state.disks.mounting.blockers[disk.name]?.length === 0;
const canConnect = (disk) => (state.disks?.mounting?.possible ? disk.volumes.filter((v) => state.disks.mounting.mountable.includes(v.path)) : []);
/** What of a disk may be formatted, checked or renamed — the server's word */
const changeable = (disk) => (state.disks?.mounting?.possible && state.disks.mounting.changeable?.[disk.name]) || { whole: false, volumes: [] };
const fsFamily = (fstype) => (/^ext[234]$/.test(fstype) ? "ext4" : ["exfat", "vfat", "ntfs", "btrfs", "xfs"].includes(fstype) ? fstype : null);
/** A file system Hata can check and rename */
const canTend = (disk, volume) => !!fsFamily(volume.fstype) && changeable(disk).volumes.includes(volume.path);
const FS_NAMES = { ext4: "ext4", btrfs: "btrfs", xfs: "XFS", exfat: "exFAT", vfat: "FAT32", ntfs: "NTFS" };
/** File systems with owners and permissions: for a disk that stays in the server */
const POSIX_FS = ["ext4", "btrfs", "xfs"];

/** The label as the file system will carry it — the server makes it the same way */
function fsLabel(fs, text) {
  const fit = (value, max, width) => {
    let out = "";
    let used = 0;
    for (const char of value) {
      used += width(char);
      if (used > max) break;
      out += char;
    }
    return out.trim();
  };
  const plain = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (fs === "vfat") return fit(plain.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[*?.,;:/\\|+=<>[\]"]/g, "").toUpperCase().trim(), 11, () => 1);
  if (POSIX_FS.includes(fs)) return fit(plain.replace(fs === "xfs" ? /[/\s]/g : /\//g, "-"), { ext4: 16, xfs: 12, btrfs: 255 }[fs], (char) => new TextEncoder().encode(char).length);
  return fit(plain.replace(/["*/:<>?\\|]/g, ""), fs === "exfat" ? 11 : 32, (char) => char.length);
}
const MOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const mountName = (text) => text.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+|[-._]+$/g, "").slice(0, 24).replace(/[-._]+$/, "") || "disk";

/** The reason, the command and the button for a package an action turned out to need */
function packageCard(detail, retry) {
  const error = h("p", { class: "error", role: "alert" });
  return h(
    "div",
    { class: "banner stack" },
    h("strong", null, t(`mounting.needs.${detail.package}.what`)),
    h("p", { class: "muted small" }, t(`mounting.needs.${detail.package}.why`)),
    detail.install ? h("p", { class: "cmd" }, icon("terminal"), detail.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: detail.package })),
    error,
    detail.install &&
      button(
        t("mounting.needs.install", { package: detail.package }),
        {
          class: "small",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              setDisks(await api("POST", "/api/disks/package", { package: detail.package }));
              retry();
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        },
        "download",
      ),
  );
}

/** Runs a disk action from a dialog: the button waits, an error stays in the dialog, a missing package is offered */
function diskAction(dialogOf, slot, request, done) {
  const run = async (e) => {
    const el = e?.currentTarget ?? slot.closest("dialog").querySelector("footer .btn:last-child");
    el.disabled = true;
    put(slot);
    try {
      const data = await request();
      if (!data.job) setDisks(data);
      done(data);
    } catch (err) {
      el.disabled = false;
      put(slot, err instanceof ApiError && err.detail?.package ? packageCard(err.detail, () => run()) : h("p", { class: "error", role: "alert" }, errorText(err)));
    }
  };
  return run;
}

/**
 * Erases a disk, or one partition of it, and makes a file system there: which one, under what label,
 * and whether it is connected afterwards.
 */
function formatDialog(disk, part, free = 0) {
  const removable = disk.removable || disk.transport === "usb";
  // `free` — the room no partition takes: a new partition is made there and nothing is erased
  const targets = free ? [] : part ? [part] : disk.volumes;
  const GB = 1e9;
  const room = free || disk.size;
  const size = h("input", { type: "text", inputMode: "decimal", class: "short", placeholder: (room / GB).toFixed(room < 10 * GB ? 1 : 0), "aria-label": t("mounting.size") });
  const sizeHint = h("span", { class: "hint" });
  const asked = () => Math.round(Number(size.value.trim().replace(",", ".")) * GB);
  const holds = targets.filter((v) => v.fstype);
  const leaving = targets.flatMap((v) => v.mounts);
  const old = free ? "" : ((part ?? disk.volumes.find((v) => v.label))?.label ?? "");
  const fs = h("select", null, Object.keys(FS_NAMES).map((id) => h("option", { value: id, selected: id === (removable ? "exfat" : "ext4") }, t("mounting.fs." + id))));
  const label = h("input", { type: "text", value: old || (removable || free ? "" : disk.model), maxlength: 40, spellcheck: false });
  const after = h("select", null, ["keep", "once", "no"].map((id) => h("option", { value: id, selected: id === (removable ? "once" : "keep") }, t("mounting.after." + id))));
  const name = h("input", { type: "text", maxlength: 32, spellcheck: false });
  const typed = h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: (part ?? disk).name });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const fsHint = h("span", { class: "hint" });
  const labelHint = h("span", { class: "hint" });
  const afterHint = h("span", { class: "hint" });
  const where = h("span", { class: "hint mono" });
  const folder = h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.folder")), name, where, h("span", { class: "hint" }, t("mounting.nameHint")));
  const open = h("p", { class: "banner" });
  const cmd = h("span");
  const slot = h("div");
  let dialog;
  let named = false;
  const go = button(t(free ? "mounting.newPartGo" : "mounting.formatGo"), { class: free ? "primary" : "danger", disabled: true });
  const check = () => {
    const written = fsLabel(fs.value, label.value);
    if (!named) name.value = leaving[0]?.startsWith("/mnt/") ? leaving[0].slice(5) : mountName((removable ? "usb-" : "") + (written || disk.model || "disk"));
    const connects = after.value !== "no";
    fsHint.textContent = t("mounting.fsHint." + fs.value);
    labelHint.textContent = t("mounting.labelHint." + fs.value) + (written && written !== label.value.trim() ? " " + t("mounting.labelBecomes", { label: written }) : "");
    afterHint.textContent = t("mounting.afterHint." + after.value);
    where.textContent = "/mnt/" + name.value;
    folder.hidden = !connects;
    open.hidden = !connects || POSIX_FS.includes(fs.value);
    open.textContent = t("mounting.noOwners", { fs: FS_NAMES[fs.value] });
    const sized = size.value.trim() !== "";
    const fits = !sized || (asked() >= 64 * 1024 * 1024 && asked() <= room);
    sizeHint.textContent = !fits ? t("mounting.sizeBad", { max: bytes(room) }) : t(free ? "mounting.sizeHintFree" : sized ? "mounting.sizeHintRest" : "mounting.sizeHint", { rest: bytes(Math.max(0, room - asked())), max: bytes(room) });
    cmd.textContent = [!part && `sfdisk ${free ? "--append " : ""}${disk.path}`, `mkfs.${fs.value === "vfat" ? "fat" : fs.value} ${part ? part.path : free ? "…" : disk.path + (/\d$/.test(disk.path) ? "p1" : "1")}`, after.value === "keep" && "/etc/fstab"].filter(Boolean).join("; ");
    go.disabled = (connects && !MOUNT_NAME.test(name.value)) || !fits || (!free && (typed.value.trim() !== (part ?? disk).name || !password.value));
  };
  name.addEventListener("input", () => ((named = true), check()));
  for (const input of [fs, label, after, typed, password, size]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", `/api/disks/${disk.name}/format`, { serial: disk.serial, size: disk.size, part: free ? "free" : (part?.path ?? ""), bytes: part || !size.value.trim() ? 0 : asked(), fs: fs.value, label: label.value, connect: after.value, name: name.value, password: password.value }),
    (data) => {
      dialog.close();
      const path = "/mnt/" + name.value;
      const [kind, into, how] = [fs.value, name.value, after.value];
      jobDialog(data.job, "format", part ? part.name : diskTitle(disk), async () => {
        if (free) return toast(how === "no" ? t("mounting.formatted", { fs: FS_NAMES[kind] }) : t("mounting.formattedAt", { fs: FS_NAMES[kind], path }));
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        if (how === "keep" && POSIX_FS.includes(kind)) {
          document.querySelectorAll("dialog[open]").forEach((d) => d.close());
          preparedDialog("/mnt/" + into);
        } else toast(how === "no" ? t("mounting.formatted", { fs: FS_NAMES[kind] }) : t("mounting.formattedAt", { fs: FS_NAMES[kind], path }));
      });
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, free ? t("mounting.newPartTitle", { disk: diskTitle(disk) }) : t("mounting.formatTitle", { disk: part ? `${part.name} · ${diskTitle(disk)}` : diskTitle(disk) })),
    h("p", { class: "muted small" }, part ? [part.name, bytes(part.size)].join(" · ") : diskMeta(disk)),
    free > 0 && h("p", { class: "muted" }, t("mounting.newPartLead", { free: bytes(free) })),
    !free && h(
      "p",
      { class: "banner danger" },
      t(part ? "mounting.formatPartErases" : holds.length ? "mounting.formatErases" : "mounting.formatEmpty"),
      holds.length > 0 && h("span", { class: "block mono small" }, holds.map((v) => [v.name, v.fstype, v.label, bytes(v.size)].filter(Boolean).join(" · ")).join("; ")),
      leaving.length > 0 && h("span", { class: "block" }, t("mounting.formatLeaves", { paths: leaving.join(", ") })),
    ),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.fs")), fs, fsHint),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.label")), label, labelHint),
    !part && h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.size")), size, sizeHint),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.after")), after, afterHint),
    folder,
    open,
    !free && field(t("mounting.typeName", { name: (part ?? disk).name }), typed),
    !free && field(t("account.password"), password, t("mounting.passwordHint")),
    h("p", { class: "cmd" }, icon("terminal"), cmd),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

/** Erases a disk and leaves it empty: quickly, or with every block written over — for a disk that goes to somebody else */
function wipeDialog(disk) {
  const holds = disk.volumes.filter((v) => v.fstype);
  const leaving = disk.volumes.flatMap((v) => v.mounts);
  const thorough = h("input", { type: "checkbox" });
  const typed = h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: disk.name });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const cmd = h("span");
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.wipeGo"), { class: "danger", disabled: true });
  const check = () => {
    cmd.textContent = thorough.checked ? `dd if=/dev/zero of=${disk.path} bs=4M` : `wipefs -a ${disk.path}`;
    go.disabled = typed.value.trim() !== disk.name || !password.value;
  };
  for (const input of [thorough, typed, password]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", `/api/disks/${disk.name}/wipe`, { serial: disk.serial, size: disk.size, thorough: thorough.checked, password: password.value }),
    (data) => {
      dialog.close();
      jobDialog(data.job, "wipe", diskTitle(disk), async () => {
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        toast(t("mounting.wiped"));
      });
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("mounting.wipeTitle", { disk: diskTitle(disk) })),
    h("p", { class: "muted small" }, diskMeta(disk)),
    h(
      "p",
      { class: "banner danger" },
      t(holds.length ? "mounting.formatErases" : "mounting.formatEmpty"),
      holds.length > 0 && h("span", { class: "block mono small" }, holds.map((v) => [v.name, v.fstype, v.label, bytes(v.size)].filter(Boolean).join(" · ")).join("; ")),
      leaving.length > 0 && h("span", { class: "block" }, t("mounting.formatLeaves", { paths: leaving.join(", ") })),
    ),
    h("p", { class: "muted" }, t("mounting.wipeLead")),
    h("label", { class: "check" }, thorough, h("span", null, h("strong", null, t("mounting.wipeThorough")), h("span", { class: "muted small block" }, t(disk.rotational ? "mounting.wipeThoroughHint" : "mounting.wipeThoroughFlash")))),
    field(t("mounting.typeName", { name: disk.name }), typed),
    field(t("account.password"), password, t("mounting.passwordHint")),
    h("p", { class: "cmd" }, icon("terminal"), cmd),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

/** File systems whose size Hata can change; FAT and exFAT have no tool for it */
const RESIZABLE = ["ext4", "btrfs", "xfs", "ntfs"];

/** Makes a partition larger, into the free room after it, or smaller; its files stay */
async function resizeDialog(disk, volume) {
  let dialog;
  const body = h("div", { class: "stack" }, waitMark());
  dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("resize.title", { name: volume.label || volume.name })), h("p", { class: "muted small" }, [volume.name, volume.fstype, bytes(volume.size), diskTitle(disk)].join(" · "))), closeX(() => dialog)), body);
  let info;
  try {
    info = (await api("GET", `/api/disks/${disk.name}/parts`)).parts.find((p) => p.path === volume.path);
  } catch (err) {
    return put(body, h("p", { class: "error" }, errorText(err)));
  }
  if (!info) return put(body, h("p", { class: "error" }, t("error.disk.unknown")));
  if (info.why || (!info.grow && !info.shrink)) return put(body, h("p", { class: "banner" }, info.why ? t("error." + info.why) : t("resize.cannot", { fs: FS_NAMES[info.fs] ?? volume.fstype })), h("footer", null, closeButton(() => dialog, t("common.close"))));
  // the same gigabytes as every size on the page (bytes() counts by 1024)
  const GB = 1024 ** 3;
  const low = info.shrink ? Math.max(64 * 1024 * 1024, info.min ?? 64 * 1024 * 1024) : info.size;
  const high = info.grow ? info.max : info.size;
  const start = info.grow ? high : info.size;
  const shown = (start / GB).toFixed(start % GB ? 2 : 1);
  const size = h("input", { type: "text", inputMode: "decimal", class: "short", value: shown, "aria-label": t("mounting.size") });
  const hint = h("span", { class: "hint" });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const cmd = h("span");
  const slot = h("div");
  const go = button(t("resize.go"), { class: "primary", disabled: true });
  // the number as first shown stands for the exact size it was rounded from
  const asked = () => (size.value.trim() === shown ? start : Math.round(Number(size.value.trim().replace(",", ".")) * GB));
  const fs = info.fs;
  const check = () => {
    const n = asked();
    const fits = Number.isFinite(n) && n >= low && n <= high && Math.abs(n - info.size) >= 1024 * 1024;
    const grow = n > info.size;
    hint.textContent = t("resize.range", { min: bytes(low), max: bytes(high) }) + (Number.isFinite(n) && fits ? " " + t(grow ? "resize.grows" : "resize.shrinks", { by: bytes(Math.abs(n - info.size)) }) : "");
    const part = `sfdisk -N ${info.number} ${disk.path}`;
    const own = { ext4: "resize2fs", btrfs: "btrfs filesystem resize", xfs: "xfs_growfs", ntfs: "ntfsresize" }[fs];
    cmd.textContent = (grow ? [part, own] : [own, part]).join("; ");
    go.disabled = !fits || !password.value;
  };
  for (const input of [size, password]) input.addEventListener("input", check);
  const slow = fs === "ext4" || fs === "ntfs";
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", `/api/disks/${disk.name}/resize`, { serial: disk.serial, size: disk.size, device: volume.path, bytes: asked(), password: password.value }),
    (data) => {
      dialog.close();
      jobDialog(data.job, "resize", volume.label || volume.name, async () => {
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        toast(t("resize.done"));
      });
    },
  );
  put(
    body,
    h("p", { class: "muted" }, t(info.grow && info.shrink ? "resize.lead" : info.grow ? "resize.leadGrow" : "resize.leadShrink")),
    info.grow && !info.shrink && fs === "xfs" && h("p", { class: "muted small" }, t("resize.xfs")),
    !info.grow && info.max <= info.size + 1024 * 1024 && h("p", { class: "muted small" }, t("resize.noRoomAfter")),
    slow && volume.mounts.length > 0 && h("p", { class: "banner" }, t("resize.offline", { path: volume.mounts[0] })),
    h("p", { class: "banner" }, t("resize.backup")),
    h("label", { class: "field" }, h("span", { class: "label" }, t("resize.size")), size, hint),
    field(t("account.password"), password, t("resize.passwordHint")),
    h("p", { class: "cmd" }, icon("terminal"), cmd),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
  size.focus();
}

/** Takes a partition away; its room becomes free for a new one */
function deletePartDialog(disk, volume) {
  const typed = h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: volume.name });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const slot = h("div");
  let dialog;
  const go = button(t("partDelete.go"), { class: "danger", disabled: true });
  const check = () => (go.disabled = typed.value.trim() !== volume.name || !password.value);
  for (const input of [typed, password]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", `/api/disks/${disk.name}/delete-part`, { serial: disk.serial, size: disk.size, device: volume.path, password: password.value }),
    () => {
      dialog.close();
      toast(t("partDelete.done", { name: volume.name }));
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("partDelete.title", { name: volume.label ? `${volume.name} “${volume.label}”` : volume.name })),
    h("p", { class: "muted small" }, [volume.fstype, bytes(volume.size), diskTitle(disk)].filter(Boolean).join(" · ")),
    h("p", { class: "banner danger" }, t("partDelete.lead"), volume.mounts.length > 0 && h("span", { class: "block" }, t("mounting.formatLeaves", { paths: volume.mounts.join(", ") }))),
    field(t("mounting.typeName", { name: volume.name }), typed),
    field(t("account.password"), password, t("mounting.passwordHint")),
    h("p", { class: "cmd" }, icon("terminal"), `wipefs -a ${volume.path}; sfdisk --delete ${disk.path} ${/(\d+)$/.exec(volume.name)?.[1] ?? ""}`),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
}

/** Looks a file system over without changing it; damage that is found can then be repaired */
function checkDialog(disk, volume) {
  const title = volume.label || volume.name;
  const slot = h("div");
  const result = h("div", { class: "stack" });
  let dialog;
  const go = button(t("fsck.go"), { class: "primary" });
  const start = (repair) => (e) => {
    put(result, h("p", { class: "with-icon muted" }, icon("refresh"), t(repair ? "fsck.repairing" : "fsck.running")));
    // an error is shown in its own place: the line that says "checking" goes
    return diskAction(
      () => dialog,
      slot,
      () => api("POST", "/api/disks/fsck", { device: volume.path, repair }),
      async (started) => {
        const lines = h("pre", { class: "said" });
        // a look can be ended; a repair goes to its end
        put(result, h("div", { class: "section-head" }, h("p", { class: "with-icon muted" }, icon("refresh"), t(repair ? "fsck.repairing" : "fsck.running")), !repair && stopButton(started.job)), lines);
        const job = await followJob(started.job, (line) => {
          lines.append(line + "\n");
          lines.scrollTop = lines.scrollHeight;
        });
        go.disabled = false;
        setDisks(await api("GET", "/api/disks").catch(() => state.disks));
        if (job.stopped) return put(result, h("p", { class: "banner" }, t("fsck.stopped")), job.error && job.error !== "Stopped." && h("p", { class: "error" }, job.error));
        if (job.status !== "done" || !job.result) return put(result, h("p", { class: "banner danger" }, t("fsck.verdict.failed")), h("pre", { class: "said" }, job.error || lines.textContent));
        const { verdict, output, back } = job.result;
        // btrfs is mended by a scrub while mounted, never offline
        const mend = verdict === "errors" && !repair && volume.fstype !== "btrfs";
        put(
          result,
          h("p", { class: "banner " + (verdict === "errors" || verdict === "failed" ? "danger" : "ok") }, t("fsck.verdict." + verdict)),
          back && h("p", { class: "error", role: "alert" }, t("fsck.back", { message: back })),
          output && h("details", { open: verdict !== "clean" }, h("summary", { class: "muted small" }, t("fsck.said")), h("pre", { class: "said" }, output)),
          mend && h("div", { class: "row-actions" }, button(t("fsck.repair"), { class: "primary", onclick: start(true) })),
        );
      },
    )(e).then(() => slot.firstChild && put(result));
  };
  go.onclick = start(false);
  dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("fsck.title", { name: title })), h("p", { class: "muted small" }, [volume.name, volume.fstype, bytes(volume.size)].join(" · "))), closeX(() => dialog)),
    h("p", { class: "muted" }, t("fsck.lead")),
    volume.mounts.length > 0 && h("p", { class: "banner" }, t("fsck.leadMounted", { path: volume.mounts[0] })),
    (volume.fstype === "ntfs" || volume.fstype === "btrfs" || volume.fstype === "xfs") && h("p", { class: "muted small" }, t("fsck." + volume.fstype)),
    result,
    slot,
    h("footer", null, closeButton(() => dialog, t("common.close")), go),
  );
}

/** Gives a file system another label — the name other devices show the disk under */
function labelDialog(disk, volume) {
  const fs = fsFamily(volume.fstype);
  const label = h("input", { type: "text", value: volume.label, maxlength: 40, spellcheck: false });
  const hint = h("span", { class: "hint" });
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.rename"), { class: "primary" });
  const check = () => {
    const written = fsLabel(fs, label.value);
    hint.textContent = t("mounting.labelHint." + fs) + (written && written !== label.value.trim() ? " " + t("mounting.labelBecomes", { label: written }) : "");
    go.disabled = !written || written === volume.label;
  };
  label.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/label", { device: volume.path, label: label.value }),
    () => {
      dialog.close();
      toast(t("relabel.done", { label: fsLabel(fs, label.value) }));
    },
  );
  dialog = openDialog(
    "confirm",
    h("h2", null, t("relabel.title", { name: volume.label || volume.name })),
    h("p", { class: "muted" }, t("relabel.lead")),
    volume.mounts.length > 0 && fs !== "ext4" && fs !== "btrfs" && h("p", { class: "banner" }, t("relabel.leadMounted", { path: volume.mounts[0] })),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.label")), label, hint),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

function preparedDialog(path) {
  const backups = `${path}/Backups`;
  let dialog;
  const keepCopies = button(t("mounting.useForBackups"), {
    class: "primary",
    onclick: async () => {
      try {
        state.settings = await api("PUT", "/api/settings", { backup: { dir: backups } });
        dialog.close();
        toast(t("mounting.backupsThere", { path: backups }));
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
  });
  dialog = openDialog(
    "confirm",
    h("h2", null, t("mounting.readyTitle")),
    h("p", { class: "muted" }, t("mounting.readyLead", { path })),
    h(
      "footer",
      null,
      oneAndMore(
        keepCopies,
        [
          { label: t("data.moveHere"), icon: "disk", run: () => (dialog.close(), moveDataDialog(`${path}/DATA`)) },
          { label: t("disks.fs.browse"), icon: "folder", run: () => (dialog.close(), (location.hash = filesHash(path))) },
        ],
        "primary",
      ),
      closeButton(() => dialog, t("common.close")),
    ),
  );
}

function connectDialog(disk, volume) {
  const removable = disk.removable || disk.transport === "usb";
  const name = h("input", { type: "text", value: mountName(volume.label || disk.model || "disk"), maxlength: 32, spellcheck: false });
  const keep = h("input", { type: "checkbox", checked: !removable });
  const where = h("span", { class: "hint mono" });
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.connect"), { class: "primary" });
  const check = () => {
    where.textContent = "/mnt/" + name.value;
    go.disabled = !MOUNT_NAME.test(name.value);
  };
  name.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/connect", { device: volume.path, name: name.value, keep: keep.checked }),
    () => {
      dialog.close();
      toast(t("mounting.connected", { path: "/mnt/" + name.value }));
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("mounting.connectTitle", { disk: volume.label || diskTitle(disk) })),
    h("p", { class: "muted small" }, [volume.name, volume.fstype, bytes(volume.size)].join(" · ")),
    h("p", { class: "muted" }, t("mounting.connectLead")),
    /^(vfat|exfat|ntfs)$/.test(volume.fstype) && h("p", { class: "banner" }, t("mounting.noOwners", { fs: volume.fstype })),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.name")), name, where, h("span", { class: "hint" }, t("mounting.nameHint"))),
    h("label", { class: "check" }, keep, h("span", null, h("strong", null, t("mounting.keep")), h("span", { class: "muted small block" }, t("mounting.keepHint")))),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

function mergeDialog() {
  const folders = state.disks.mounting.mergeable;
  const boxes = folders.map((path) => h("input", { type: "checkbox", checked: true, value: path }));
  const name = h("input", { type: "text", value: "storage", maxlength: 32, spellcheck: false });
  const where = h("span", { class: "hint mono" });
  const slot = h("div");
  let dialog;
  const go = button(t("mounting.mergeGo"), { class: "primary" });
  const check = () => {
    where.textContent = "/mnt/" + name.value;
    go.disabled = !MOUNT_NAME.test(name.value) || boxes.filter((b) => b.checked).length < 2;
  };
  for (const input of [name, ...boxes]) input.addEventListener("input", check);
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/merge", { folders: boxes.filter((b) => b.checked).map((b) => b.value), name: name.value }),
    () => {
      dialog.close();
      toast(t("mounting.mergedAs", { path: "/mnt/" + name.value }));
    },
  );
  dialog = openDialog(
    "wide",
    h("h2", null, t("mounting.mergeTitle")),
    h("p", { class: "muted" }, t("mounting.mergeLead")),
    boxes.map((box) => h("label", { class: "check" }, box, h("span", { class: "mono" }, box.value))),
    h("label", { class: "field" }, h("span", { class: "label" }, t("mounting.name")), name, where, h("span", { class: "hint" }, t("mounting.nameHint"))),
    h("p", { class: "banner" }, t("mounting.mergeWarn")),
    slot,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  check();
}

/**
 * Copies what a plugged-in disk holds onto the server: which of its file systems, everything or the
 * chosen folders and files, and where to. The disk is connected for it when it is not yet.
 */
function copyInDialog(disk) {
  const volumes = disk.volumes.filter((v) => v.fstype && (v.mounts.length || state.disks.mounting.mountable.includes(v.path)));
  if (!volumes.length) return toast(t("copyin.nothing"), "error");
  const HIDDEN = /^(\.hata-trash|lost\+found|System Volume Information|\$RECYCLE\.BIN|\.Trashes|\.Spotlight-V100|\.fseventsd)$/;
  const error = h("p", { class: "error", role: "alert" });
  const which = h("select", { onchange: () => open() }, volumes.map((v, i) => h("option", { value: String(i) }, [v.label || v.name, v.fstype, bytes(v.size)].join(" · "))));
  const all = h("input", { type: "checkbox", checked: true, onchange: () => paint() });
  const crumbs = h("div", { class: "crumbs wrap small" });
  const list = h("div", { class: "snapshot-files" });
  const sub = h("input", { type: "text", maxlength: 80, spellcheck: false, value: `${(volumes[0].label || disk.model || "USB").trim()} ${new Date().toISOString().slice(0, 10)}`, oninput: () => where() });
  const target = h("span", { class: "mono" });
  const go = button(t("copyin.go"), { class: "primary" }, "download");
  let mount = "";
  let at = "";
  let top = [];
  let entries = [];
  let into = "";
  const chosen = new Set();
  const full = (name, dir = at) => (dir.endsWith("/") ? dir : dir + "/") + name;
  const where = () => {
    const name = sub.value.trim().replace(/\//g, "-");
    target.textContent = name ? full(name, into) : into;
    go.disabled = !mount || !into || (!all.checked && chosen.size === 0) || (all.checked && top.length === 0);
    go.lastChild.textContent = all.checked ? t("copyin.goAll") : t("copyin.goChosen", { n: chosen.size });
  };
  const paint = () => {
    const steps = at === mount ? [] : at.slice(mount.length).split("/").filter(Boolean);
    crumbs.replaceChildren(h("button", { type: "button", class: "text-btn", onclick: () => show(mount) }, volumes[Number(which.value)].label || diskTitle(disk)), ...steps.flatMap((step, i) => [icon("chevron"), h("button", { type: "button", class: "text-btn", onclick: () => show(full(steps.slice(0, i + 1).join("/"), mount)) }, step)]));
    list.replaceChildren(
      ...(entries.length
        ? entries.map((entry) => {
            const path = full(entry.name);
            const tick = h("input", { type: "checkbox", checked: all.checked || chosen.has(path), disabled: all.checked, "aria-label": entry.name, onchange: () => ((tick.checked ? chosen.add(path) : chosen.delete(path)), where()) });
            const dir = entry.type === "dir";
            return h("div", { class: "snapshot-file" }, tick, icon(dir ? "folder" : "file"), dir ? h("button", { type: "button", class: "text-btn grow name", onclick: () => show(path) }, entry.name) : h("span", { class: "grow name" }, entry.name), h("span", { class: "muted small" }, dir ? "" : bytes(entry.size)), h("span", { class: "muted small when" }, dateTime(entry.modified)));
          })
        : [h("p", { class: "muted" }, t("backup.files.empty"))]),
    );
    where();
  };
  const show = async (path) => {
    error.textContent = "";
    try {
      const listing = await api("GET", `/api/files?path=${encodeURIComponent(path)}`);
      at = path;
      entries = listing.entries.filter((e) => !HIDDEN.test(e.name));
      if (path === mount) top = entries.map((e) => full(e.name, mount));
      paint();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  const open = async () => {
    const volume = volumes[Number(which.value)];
    chosen.clear();
    mount = "";
    list.replaceChildren(h("p", { class: "muted" }, t("copyin.opening")));
    where();
    try {
      // not connected yet: it is, until it is unplugged or ejected
      let now = state.disks.disks.flatMap((d) => d.volumes).find((v) => v.path === volume.path);
      if (!now?.mounts.length) {
        state.disks = await api("POST", "/api/disks/connect", { device: volume.path, name: mountName("usb-" + (volume.label || disk.model || "disk")), keep: false });
        now = state.disks.disks.flatMap((d) => d.volumes).find((v) => v.path === volume.path);
      }
      mount = now.mounts[0];
      if (!into) into = (await api("GET", "/api/files?path=")).home;
      await show(mount);
    } catch (err) {
      list.replaceChildren();
      error.textContent = errorText(err);
    }
  };
  go.onclick = async () => {
    go.disabled = true;
    error.textContent = "";
    try {
      const res = await api("POST", "/api/files/copy-in", { paths: all.checked ? top : [...chosen], to: target.textContent });
      const to = target.textContent;
      dialog.close();
      jobDialog(res.job, "copyin", "", () => {
        toast(t("copyin.done", { path: to }));
        if (state.route.view === "settings") void api("GET", "/api/disks").then(setDisks, () => {});
      });
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  };
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("copyin.title", { disk: diskTitle(disk) })), h("p", { class: "muted small" }, t("copyin.lead"))), closeX(() => dialog)),
    volumes.length > 1 && field(t("copyin.which"), which),
    h("label", { class: "check" }, all, h("span", null, h("strong", null, t("copyin.all")), h("span", { class: "muted small block" }, t("copyin.allHint")))),
    crumbs,
    list,
    h("h3", null, t("copyin.where")),
    h("div", { class: "kv" }, target, button(t("copyin.choose"), { class: "small", onclick: () => folderPicker({ title: t("copyin.where"), start: into, confirmLabel: t("copyin.here"), action: async (path) => ((into = path), where()), allowed: (path) => !mount || !(path === mount || path.startsWith(mount + "/")) }) }, "folder")),
    field(t("copyin.sub"), sub, t("copyin.subHint")),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
  where();
  void open();
}

function disconnectDialog(mount) {
  const removable = state.disks.disks.some((d) => d.name === mount.disk && (d.removable || d.transport === "usb"));
  const slot = h("div");
  const what = h("div", { class: "stack" }, waitMark());
  let dialog;
  const go = button(t(removable ? "mounting.eject" : "mounting.disconnect"), { class: "primary", disabled: true });
  go.onclick = diskAction(
    () => dialog,
    slot,
    () => api("POST", "/api/disks/disconnect", { path: mount.path, stop: true }),
    () => {
      dialog.close();
      toast(t(removable ? "mounting.ejected" : "mounting.disconnected", { path: mount.path }));
    },
  );
  dialog = openDialog("confirm", h("h2", null, t(removable ? "mounting.ejectTitle" : "mounting.disconnectTitle", { path: mount.path })), h("p", { class: "muted" }, t(removable ? "mounting.ejectLead" : "mounting.disconnectLead")), what, slot, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
  // what stands on the folder is said before it is taken away; what keeps files open there is stopped first
  const ICON = { app: "box", tvPlaying: "tv", musicPlaying: "music", tvFolder: "tv", pin: "folder", favorite: "star", share: "share" };
  const line = (use) => h("li", { class: "disk-uses-item" }, icon(ICON[use.kind]), h("span", { class: "grow" }, h("span", { class: "strong" }, t("disks.use." + use.kind, { name: use.name })), h("span", { class: "muted small mono wrap" }, use.path)));
  void api("GET", `/api/disks/uses?path=${encodeURIComponent(mount.path)}`).then(
    ({ holds, uses }) => {
      if (!dialog.isConnected) return;
      if (holds) return put(what, h("p", { class: "error", role: "alert" }, t("error." + holds)));
      const stopped = uses.filter((use) => use.kind === "tvPlaying" || use.kind === "musicPlaying" || (use.kind === "app" && use.running));
      const left = uses.filter((use) => !stopped.includes(use));
      put(
        what,
        stopped.length > 0 && h("div", { class: "stack" }, h("strong", null, t("disks.use.stopped")), h("ul", { class: "disk-uses" }, stopped.map(line))),
        left.length > 0 && h("div", { class: "stack" }, h("strong", null, t("disks.use.left")), h("ul", { class: "disk-uses" }, left.map(line))),
        uses.some((use) => use.kind === "app") && h("p", { class: "banner" }, t("disks.use.appsNote")),
        !uses.length && h("p", { class: "muted small" }, t("disks.use.none")),
      );
      if (stopped.length) go.lastChild.textContent = t(removable ? "disks.use.stopEject" : "disks.use.stopDisconnect");
      go.disabled = false;
    },
    (e) => {
      put(what, h("p", { class: "error", role: "alert" }, errorText(e)));
      go.disabled = false;
    },
  );
}

let disksTimer = 0;

/** Long work on a disk that runs while the page is open: what it says last, and the way back to it */
let diskWorkListener = null;
function diskWorkStrip(work) {
  // a disk by its model, a file system by its device
  const disk = state.disks?.disks.find((d) => d.name === work.target);
  const title = work.kind === "pool" ? t("pool.goal." + work.target) : disk ? diskTitle(disk) : work.target;
  const line = h("span", { class: "muted small mono clip" }, work.line);
  const stop = work.stoppable && stopButton(work.id);
  jobListeners.delete(diskWorkListener);
  diskWorkListener = (event) => {
    if (event.job.id !== work.id) return;
    if (event.line !== undefined) line.textContent = event.line;
    if (event.job.stopped && stop) stop.disabled = true;
    if (event.job.status !== "running") {
      jobListeners.delete(diskWorkListener);
      void api("GET", "/api/disks").then(setDisks, () => {});
    }
  };
  jobListeners.add(diskWorkListener);
  return h(
    "section",
    { class: "card pad" },
    h(
      "div",
      { class: "section-head" },
      h("div", { class: "with-icon grow" }, icon("refresh"), h("div", { class: "grow" }, h("div", { class: "strong" }, t("mounting.working." + work.kind), title && h("span", { class: "muted" }, " · " + title)), line)),
      h("div", { class: "row-actions" }, button(t("mounting.working.show"), { class: "small", onclick: () => jobDialog(work.id, work.kind, title, () => void api("GET", "/api/disks").then(setDisks, () => {})) }), stop && (stop.classList.add("small"), stop)),
    ),
  );
}

/** When a disk's reading is worth a word: its temperature by kind, and how worn a flash disk may be */
function smartLimitsDialog(limits) {
  const number = (key, min, max) => h("input", { type: "number", min, max, step: 1, value: limits[key], class: "short mono", required: true });
  const hotHdd = number("hotHdd", 30, 90);
  const hotFlash = number("hotFlash", 30, 110);
  const wear = number("wear", 10, 100);
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
            state.settings = await api("PUT", "/api/settings", { storage: { smart: { hotHdd: Number(hotHdd.value), hotFlash: Number(hotFlash.value), wear: Number(wear.value) } } });
            dialog.close();
            setDisks(await api("GET", "/api/disks"));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("disks.limits.title")), h("p", { class: "muted small" }, t("disks.limits.lead"))), closeX(() => dialog)),
      field(t("disks.limits.hotHdd"), h("div", { class: "with-icon" }, hotHdd, h("span", { class: "muted" }, "°C")), t("disks.limits.hotHddHint")),
      field(t("disks.limits.hotFlash"), h("div", { class: "with-icon" }, hotFlash, h("span", { class: "muted" }, "°C")), t("disks.limits.hotFlashHint")),
      field(t("disks.limits.wear"), h("div", { class: "with-icon" }, wear, h("span", { class: "muted" }, "%")), t("disks.limits.wearHint")),
      error,
      h("footer", null, button(t("disks.limits.defaults"), { class: "quiet", onclick: () => ((hotHdd.value = "55"), (hotFlash.value = "70"), (wear.value = "90")) }), h("span", { class: "grow" }), closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("settings.save"))),
    ),
  );
}

function storageSection(section = "storage") {
  const data = state.disks;
  if (!data) return [waitMark()];
  const error = h("p", { class: "error", role: "alert" });
  const busy = (label, done) => async (e) => {
    const el = e.currentTarget;
    error.textContent = "";
    el.disabled = true;
    el.lastChild.textContent = label;
    try {
      setDisks(await api("POST", done.path, {}));
      if (done.toast) toast(done.toast);
    } catch (err) {
      setDisks(state.disks);
      document.querySelector("#disks-error")?.replaceChildren(errorText(err));
    }
  };
  error.id = "disks-error";

  // while a disk tests itself or the data folder is measured, the progress is worth watching
  clearTimeout(disksTimer);
  if (data.fills?.running || data.raids?.pools.some((p) => p.work) || data.disks.some((d) => d.smart?.testing != null)) {
    disksTimer = setTimeout(
      async () => {
        if (onStorageSection()) setDisks(await api("GET", "/api/disks").catch(() => state.disks));
      },
      data.fills?.running || data.raids?.pools.some((p) => p.work) ? 3000 : 20_000,
    );
  }

  // the folders of a disk that Hata connected itself and that are no branch of a merged folder: those it can disconnect
  const ourMounts = (disk, mounts) => mounts.filter((path) => state.disks.mounting?.ours[path] && !Object.values(state.disks.mounting?.pools ?? {}).some((folders) => folders.includes(path)));
  const row = (disk) => {
    const mounted = disk.volumes.filter((v) => v.total != null);
    const total = mounted.reduce((n, v) => n + v.total, 0);
    const used = mounted.reduce((n, v) => n + v.used, 0);
    const mounts = disk.volumes.flatMap((v) => v.mounts);
    const hot = disk.findings.some((f) => f.code === "hot");
    return h(
      "tr",
      { class: "clickable", onclick: () => diskDialog(disk.name) },
      h("td", null, h("div", { class: "with-icon" }, h("span", { class: "badge-icon " + (disk.health === "ok" || disk.health === "unknown" ? "plain" : disk.health) }, icon("disk")), h("div", null, h("div", { class: "strong" }, diskTitle(disk)), h("div", { class: "muted small mono" }, diskMeta(disk))))),
      h("td", null, healthChip(disk)),
      h("td", { class: "num" + (hot ? " bad" : "") }, disk.smart?.temperature != null ? disk.smart.temperature + " °C" : "—"),
      h("td", null, total ? usageBar(used, total) : h("span", { class: "muted" }, "—")),
      h("td", null, mounts.length ? disk.volumes.flatMap((v) => v.mounts.map((m) => h("div", { class: "mount-line" }, h("span", { class: "mono clip" }, m), v.fstype && h("span", { class: "muted small" }, FS_NAMES[v.fstype] ?? v.fstype)))) : h("span", { class: "muted" }, [t("disks.notMounted"), ...new Set(disk.volumes.filter((v) => v.fstype && !v.swap).map((v) => FS_NAMES[v.fstype] ?? v.fstype))].join(" · "))),
      h("td", null, h("div", { class: "row-actions" }, foldActions([canPrepare(disk) && !mounts.length && !canConnect(disk).length && button(t("mounting.format"), { class: "small", onclick: (e) => (e.stopPropagation(), formatDialog(disk)) }), (disk.removable || disk.transport === "usb") && state.disks.mounting?.possible && disk.volumes.some((v) => v.fstype && v.mounts.length > 0) && button(t("copyin.button"), { class: "small", onclick: (e) => (e.stopPropagation(), copyInDialog(disk)) }, "download"), canConnect(disk).length > 0 && button(t("mounting.connect"), { class: "small primary", onclick: (e) => (e.stopPropagation(), connectDialog(disk, canConnect(disk)[0])) }), ...ourMounts(disk, mounts).map((path) => button(t(disk.removable || disk.transport === "usb" ? "mounting.eject" : "mounting.disconnect") + (ourMounts(disk, mounts).length > 1 ? " " + path : ""), { class: "small", onclick: (e) => (e.stopPropagation(), disconnectDialog({ path, disk: disk.name })) })), button(t("disks.details"), { class: "small", onclick: (e) => (e.stopPropagation(), diskDialog(disk.name)) })]))),
    );
  };
  const checked = Math.max(0, ...data.disks.map((d) => d.checkedAt ?? 0));
  const fsRow = (m) =>
    h(
      "tr",
      null,
      h("td", null, h("a", { class: "strong mono", href: filesHash(m.path), title: t("disks.fs.browse") }, m.path)),
      h("td", null, h("div", { class: "mono clip" }, data.mounting?.pools[m.path]?.join(" + ") ?? m.device), h("div", { class: "muted small" }, [data.mounting?.pools[m.path] ? t("mounting.merged") : m.fstype, m.network && t("disks.fs.network"), m.readOnly && t("disks.fs.readOnly")].filter(Boolean).join(" · "))),
      h("td", null, usageBar(m.used, m.total)),
      h("td", null, data.mounting?.ours[m.path] && !inPool(m.path) && h("div", { class: "row-actions" }, button(t(ejectable(m) ? "mounting.eject" : "mounting.disconnect"), { class: "small", onclick: () => disconnectDialog(m) }))),
    );
  // a folder kept in /etc/fstab whose disk is not there now: still Hata's to forget
  const absent = Object.keys(data.mounting?.ours ?? {}).filter((path) => !data.mounts.some((m) => m.path === path));
  const absentRow = (path) => h("tr", null, h("td", null, h("span", { class: "strong mono" }, path)), h("td", { class: "muted" }, t("mounting.absent")), h("td"), h("td", null, h("div", { class: "row-actions" }, button(t("mounting.disconnect"), { class: "small", onclick: () => disconnectDialog({ path, disk: "" }) }))));
  // a disk of a merged folder is taken out through the merged folder
  const inPool = (path) => Object.values(data.mounting?.pools ?? {}).some((folders) => folders.includes(path));
  const ejectable = (m) => data.disks.some((d) => d.name === m.disk && (d.removable || d.transport === "usb"));
  const automount = h("input", {
    type: "checkbox",
    checked: data.mounting?.automount,
    onchange: async (e) => {
      try {
        state.settings = await api("PUT", "/api/settings", { storage: { automount: e.target.checked } });
        setDisks(await api("GET", "/api/disks"));
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(errorText(err), "error");
      }
    },
  });
  // a disk nothing uses yet is said so at the top, until it is put to use or waved away
  const unused = (data.mounting?.unused ?? []).map((u) => u.id);
  const fresh = data.disks.filter((d) => canPrepare(d) && unused.includes(d.serial || d.name));
  // asked for on the home page: the dialog opens as soon as the disks are known
  if (state.copyInFrom) {
    const from = data.disks.find((d) => (d.serial || d.name) === state.copyInFrom);
    state.copyInFrom = null;
    if (from) setTimeout(() => copyInDialog(from), 0);
  }
  const freshCard = (disk) => {
    const holds = disk.volumes.filter((v) => v.fstype);
    const connectable = canConnect(disk);
    return h(
      "section",
      { class: "card pad new-disk" },
      h("span", { class: "badge-icon warn" }, icon("disk")),
      h("div", { class: "grow" }, h("strong", null, t("mounting.found", { disk: diskTitle(disk), size: bytes(disk.size) })), h("p", { class: "muted small" }, holds.length ? t("mounting.foundHolds", { what: holds.map((v) => [v.label, v.fstype].filter(Boolean).join(" · ")).join("; ") }) : t("mounting.foundEmpty"))),
      h(
        "div",
        { class: "row-actions" }, foldActions([
        button(t("mounting.ignore"), { class: "small quiet", onclick: async () => setDisks(await api("POST", "/api/disks/ignore", { id: disk.serial || disk.name }).catch(() => state.disks)) }),
        connectable.length > 0 && (disk.removable || disk.transport === "usb") && button(t("copyin.button"), { class: "small primary", onclick: () => copyInDialog(disk) }, "download"),
        connectable.length > 0 && button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(disk, connectable[0]) }),
        button(t("mounting.format"), { class: "small" + (connectable.length ? "" : " primary"), onclick: () => formatDialog(disk) }),])
      ),
    );
  };
  if (section === "places") return [state.places ? placesCard(state.places) : waitMark()];
  if (section === "protection") {
    return [
      data.working && diskWorkStrip(data.working),
      data.array?.on && data.mounting?.possible && data.disks.length > 1 && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("pool.open").replace(/…$/, "")), button(t("pool.open"), { class: "small", onclick: () => poolDialog() })), h("p", { class: "muted small" }, t("protection.poolLead"))),
      data.array && data.mounting?.possible && arrayCard(data, data.array),
      data.raids && (data.raids.pools.length > 0 || data.raids.lacking.length > 0) && raidCard(data),
      !data.mounting?.possible && !(data.raids?.pools.length > 0) && h("section", { class: "card pad" }, h("p", { class: "muted" }, t("protection.notHere"))),
    ].filter(Boolean);
  }
  const tab = settingsTab("storage");
  if (tab === "fills") return [data.fills ? fillsCard(data.fills, busy) : h("section", { class: "card pad" }, h("p", { class: "muted" }, t("protection.noFills")))];
  if (tab === "fs") {
    return [
      h(
        "section",
        { class: "card table-wrap" },
        h("div", { class: "pad card-head" }, h("h2", null, t("disks.fs.title")), h("p", { class: "muted small" }, t("disks.fs.lead"))),
        (data.mounts.length > 0 || absent.length > 0) && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("disks.fs.col.path")), h("th", null, t("disks.fs.col.source")), h("th", null, t("disks.col.usage")), h("th"))), h("tbody", null, data.mounts.map(fsRow), absent.map(absentRow))),
      ),
    ];
  }
  return [
    data.working && diskWorkStrip(data.working),
    fresh.map(freshCard),
    data.tool === "missing" &&
      data.disks.length > 0 &&
      h(
        "section",
        { class: "card pad" },
        h("h2", null, t("disks.tool.missing")),
        h("p", { class: "muted" }, t("disks.tool.what")),
        h("p", { class: "muted" }, t("disks.tool.why")),
        data.install ? [h("p", { class: "muted" }, t("disks.tool.how")), h("p", { class: "cmd" }, icon("terminal"), data.install)] : h("p", { class: "muted" }, t("disks.tool.byHand")),
        data.install && h("footer", null, button(t("disks.tool.install"), { class: "primary", onclick: busy(t("disks.tool.installing"), { path: "/api/disks/tool", toast: t("disks.tool.installed") }) }, "download")),
      ),
    data.tool === "denied" && data.disks.length > 0 && h("section", { class: "card pad" }, h("strong", null, t("disks.tool.denied")), h("p", { class: "muted small" }, t("disks.tool.deniedHint"))),
    h(
      "section",
      { class: "card table-wrap" },
      h(
        "div",
        { class: "pad card-head" },
        h("div", { class: "section-head" }, h("h2", null, t("disks.title"), h("span", { class: "muted" }, t("disks.connected", { n: data.disks.length }))), h("div", { class: "row-actions" }, hasModule("raid") && (data.mounting?.mergeable.length ?? 0) > 1 && button(t("mounting.merge"), { class: "small", onclick: () => mergeDialog() }), data.tool === "ok" && data.disks.length > 0 && checked > 0 && h("span", { class: "muted small" }, t("disks.checked", { when: ago(checked) })), data.tool === "ok" && data.disks.length > 0 && data.limits && button(t("disks.limits"), { class: "small", onclick: () => smartLimitsDialog(data.limits) }), data.tool === "ok" && data.disks.length > 0 && button(t("disks.checkNow"), { class: "small", onclick: busy("…", { path: "/api/disks/check" }) }, "refresh"))),
        h("p", { class: "muted small" }, t(data.disks.length ? "disks.lead" : "disks.none")),
        error,
      ),
      data.disks.length > 0 && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("disks.col.disk")), h("th", null, t("disks.col.health")), h("th", { class: "num" }, t("disks.col.temp")), h("th", null, t("disks.col.usage")), h("th", null, t("disks.col.mounted")), h("th"))), h("tbody", null, data.disks.map(row))),
    ),
    data.mounting?.possible && h("section", { class: "card pad" }, h("label", { class: "check" }, automount, h("span", null, h("strong", null, t("mounting.automount")), h("span", { class: "muted small block" }, t("mounting.automountHint"))))),
  ].filter(Boolean);
}

// --- Arrays and pools the system has: md, ZFS, btrfs ----------------------------------------------

const RAID_KINDS = { md: "Linux RAID", zfs: "ZFS", btrfs: "btrfs" };

/** Each array or pool with its state, its disks and its own check; Hata reads them and makes none */
function raidCard(data) {
  const error = h("p", { class: "error", role: "alert" });
  const askCall = (ask, path, body) => confirmAction({ ...ask, run: async () => setDisks(await api("POST", path, body)) });
  const call = (path, body) => async (e) => {
    const el = e.currentTarget;
    el.disabled = true;
    error.textContent = "";
    try {
      setDisks(await api("POST", path, body));
    } catch (err) {
      error.textContent = errorText(err);
      el.disabled = false;
    }
  };
  const diskOf = (path) => data.disks.find((d) => d.path === path || d.volumes.some((v) => v.path === path));
  const chip = (pool) => {
    const cls = { ok: "running", degraded: "partial", failed: "restarting", inactive: "restarting" }[pool.state];
    return h("span", { class: "state " + cls }, t("raid.state." + pool.state));
  };
  const workLine = (w) => h("div", { class: "muted small with-icon" }, icon("refresh"), [t("raid.work." + w.what), w.percent != null ? `${Math.floor(w.percent)}%` : t("raid.waiting"), w.left != null && t("raid.left", { n: w.left })].filter(Boolean).join(" · "));
  const lastLine = (pool) => {
    const c = pool.lastCheck;
    if (!c) return h("div", { class: "muted small" }, t(pool.kind === "md" ? "raid.neverSeen" : "raid.never"));
    const left = pool.kind === "md" ? c.errors : (c.unmended ?? 0);
    const found = pool.kind === "md" ? (c.errors ? t("raid.lastMismatch", { n: c.errors }) : t("raid.lastClean")) : left ? t("raid.lastUnmended", { n: left }) : c.mended ? t("raid.lastMendedSize", { size: c.mended }) : c.errors ? t("raid.lastMended", { n: c.errors }) : t("raid.lastClean");
    return h("div", { class: "muted small" + (left ? " bad" : "") }, t("raid.last", { when: ago(c.at), what: found }));
  };
  const member = (m) => {
    const disk = m.path && diskOf(m.path);
    return h(
      "div",
      { class: "raid-member" },
      h("span", { class: "mono" }, m.path || t("raid.gone")),
      disk && h("span", { class: "muted small" }, diskTitle(disk)),
      m.state !== "ok" && h("span", { class: "chip" + (m.state === "missing" || m.state === "faulty" ? " bad" : "") }, t("raid.member." + m.state)),
      m.errors > 0 && h("span", { class: "chip bad" }, t("raid.memberErrors", { n: m.errors })),
    );
  };
  const row = (pool) => {
    const busy = !!pool.work;
    const stoppable = busy && ["check", "repair", "scrub"].includes(pool.work.what);
    const counted = pool.errors > 0 || pool.dataErrors > 0;
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon" }, h("span", { class: "badge-icon " + (pool.state === "ok" ? (counted ? "warn" : "plain") : "danger") }, icon("disk")), h("div", null, h("div", { class: "strong" }, pool.name), h("div", { class: "muted small" }, [RAID_KINDS[pool.kind], pool.level].filter(Boolean).join(" · ")), pool.mount && h("a", { class: "mono small", href: filesHash(pool.mount) }, pool.mount)))),
      h("td", null, chip(pool), busy && workLine(pool.work), !busy && pool.state === "ok" && lastLine(pool), pool.dataErrors > 0 && h("div", { class: "small bad" }, t("raid.dataErrors", { n: pool.dataErrors }))),
      h("td", null, pool.members.map(member)),
      h("td", null, pool.used != null && pool.size ? usageBar(pool.used, pool.size) : pool.size ? h("span", { class: "muted" }, bytes(pool.size)) : h("span", { class: "muted" }, "—")),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" }, foldActions([
          !busy && pool.state === "ok" && button(t("raid.check"), { class: "small", onclick: call("/api/disks/raid/check", { id: pool.id, action: "check" }) }, "refresh"),
          stoppable && button(t("raid.stop"), { class: "small", onclick: call("/api/disks/raid/check", { id: pool.id, action: "stop" }) }),
          !busy && pool.kind === "md" && pool.state === "ok" && pool.errors > 0 && button(t("raid.repair"), { class: "small primary", onclick: () => askCall({ title: t("raid.repairTitle", { name: pool.name }), lead: t("raid.repairLead"), label: t("raid.repairGo"), iconName: "refresh" }, "/api/disks/raid/check", { id: pool.id, action: "repair" }) }),
          !busy && counted && button(t(pool.kind === "md" ? "raid.forget" : "raid.clear"), { class: "small quiet", onclick: () => askCall({ title: t(pool.kind === "md" ? "raid.forgetTitle" : "raid.clearTitle", { name: pool.name }), lead: t(pool.kind === "md" ? "raid.forgetLead" : "raid.clearLead"), label: t(pool.kind === "md" ? "raid.forget" : "raid.clear"), iconName: "x" }, "/api/disks/raid/clear", { id: pool.id }) }),])
        ),
      ),
    );
  };
  const lacking = (need) =>
    need.kind === "btrfs"
      ? packageCard({ package: need.package, install: need.install }, () => setDisks(state.disks))
      : h("div", { class: "banner stack" }, h("strong", null, t("raid.needs.zfs")), h("p", { class: "muted small" }, t("raid.needs.zfsWhy")), need.install && h("p", { class: "cmd" }, icon("terminal"), need.install));
  const pools = data.raids.pools;
  return h(
    "section",
    { class: "card table-wrap" },
    h("div", { class: "pad card-head" }, h("h2", null, t("raid.title")), h("p", { class: "muted small" }, t("raid.lead")), data.raids.lacking.map(lacking), error),
    pools.length > 0 && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("raid.col.pool")), h("th", null, t("raid.col.state")), h("th", null, t("raid.col.disks")), h("th", null, t("disks.col.usage")), h("th"))), h("tbody", null, pools.map(row))),
  );
}

// --- Network places: folders of other machines mounted here -----------------------------------------

const PLACE_KINDS = ["smb", "nfs", "sftp", "webdav", "ftp"];
const placeAddress = (p) => (p.kind === "webdav" ? p.url : p.kind === "smb" ? `//${p.host}/${p.path}` : p.kind === "nfs" ? `${p.host}:${p.path}` : `${p.kind}://${p.user ? p.user + "@" : ""}${p.host}${p.port ? ":" + p.port : ""}${p.path.startsWith("/") ? p.path : "/~/" + p.path}`);

async function reloadPlaces(list) {
  state.places = list ? { ...state.places, places: list } : await api("GET", "/api/netplaces").catch(() => state.places);
  if (onStorageSection()) renderSettings();
}

function placesCard(data) {
  const row = (p) => {
    const chip = p.mounted && !p.away ? h("span", { class: "state running" }, t("netplace.on")) : p.state === "activating" ? h("span", { class: "state partial" }, t("netplace.connecting")) : h("span", { class: "state restarting" }, t("netplace.off"));
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "with-icon" }, h("span", { class: "badge-icon plain" }, icon("globe")), h("div", null, h("a", { class: "strong", href: filesHash(p.folder) }, p.name), h("div", { class: "muted small mono clip" }, placeAddress(p))))),
      h("td", null, chip, p.readOnly && h("span", { class: "chip" }, t("netplace.readOnly"))),
      h("td", null, p.mounted && p.total ? usageBar(p.total - p.free, p.total) : h("span", { class: "muted mono small" }, p.folder)),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" }, foldActions([
          (!p.mounted || p.away) && button(t("netplace.retry"), { class: "small", onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await reloadPlaces((await api("POST", `/api/netplaces/${p.id}/retry`, {})).places);
            } catch (err) {
              toast(errorText(err), "error");
              void reloadPlaces();
            }
          } }, "refresh"),
          button(t("netplace.change"), { class: "small", onclick: () => placeDialog(p) }),
          button(t("netplace.remove"), { class: "small quiet", onclick: () => removePlaceDialog(p) }),])
        ),
      ),
    );
  };
  return h(
    "section",
    { class: "card table-wrap" },
    h(
      "div",
      { class: "pad card-head" },
      h("div", { class: "section-head" }, h("h2", null, t("netplace.title")), h("div", { class: "row-actions" }, button(t("netplace.find"), { class: "small", onclick: () => findPlacesDialog() }, "search"), button(t("netplace.connect"), { class: "small primary", onclick: () => placeDialog() }, "plus"))),
      h("p", { class: "muted small" }, t(data.places.length ? "netplace.lead" : "netplace.none")),
    ),
    data.places.length > 0 && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("netplace.col.place")), h("th", null, t("netplace.col.state")), h("th", null, t("disks.col.usage")), h("th"))), h("tbody", null, data.places.map(row))),
  );
}

/** The menu of a place in the sidebar of Files: open it, and what can be done to the disk or the network place it is */
async function sidebarMenu(at, { label, path, machine = "", volume = null, iconName = "folder" }) {
  const href = filesHash(path, machine);
  const entries = [
    { label: t("common.open"), icon: "folder", href },
    { label: t("menu.newTab"), icon: "external", href: location.pathname + location.search + href, newTab: true },
    { label: t("files.copyPath"), icon: "copy", run: () => copyText(path) },
  ];
  if (!machine && isAdmin()) {
    const pinned = (state.files?.pinned ?? state.overview?.folders?.map((folder) => folder.path) ?? []).includes(path);
    entries.push({ label: t(pinned ? "files.unpin" : "files.pin"), icon: "home", run: () => pinFolder(path, !pinned, true, label) });
  }
  if (!machine && state.favorites) entries.push({ label: t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), icon: "star", run: () => favorite(path, !isFavorite(path), label) });
  if (volume && !machine && isAdmin()) {
    if (volume.network) {
      if (!state.places) state.places = await api("GET", "/api/netplaces").catch(() => null);
      const p = state.places?.places.find((one) => one.folder === volume.path);
      if (p) {
        entries.push(
          { label: t("netplace.change"), icon: "edit", run: () => placeDialog(p) },
          (!p.mounted || p.away) && { label: t("netplace.retry"), icon: "refresh", run: () => api("POST", `/api/netplaces/${p.id}/retry`, {}).then((res) => reloadPlaces(res.places), (err) => toast(errorText(err), "error")) },
          { label: t("netplace.remove"), icon: "trash", danger: true, run: () => removePlaceDialog(p) },
        );
      }
    } else {
      if (!state.disks) state.disks = await api("GET", "/api/disks").catch(() => null);
      const data = state.disks;
      const mount = data?.mounts.find((m) => m.path === volume.path);
      const disk = mount && data.disks.find((d) => d.name === mount.disk);
      const removable = !!disk && (disk.removable || disk.transport === "usb");
      const pooled = Object.values(data?.mounting?.pools ?? {}).some((folders) => folders.includes(volume.path));
      if (removable && data.mounting?.possible) entries.push({ label: t("copyin.button"), icon: "download", run: () => copyInDialog(disk) });
      if (mount && data.mounting?.ours[mount.path] && !pooled) entries.push({ label: t(removable ? "mounting.eject" : "mounting.disconnect"), icon: "signout", run: () => disconnectDialog(mount) });
    }
    entries.push(volume.network ? { label: t("menu.inNetworkDrives"), icon: "network", href: "#/settings/places" } : { label: t("menu.inDisks"), icon: "disk", href: "#/settings/storage" });
  }
  menuAt(at, menuHeader(label, path, iconName), entries);
}

/** "+ Network place" in Files: the dialog of Settings → Storage right there, and the new place opened once it is connected */
async function addPlaceHere(e) {
  e.preventDefault();
  if (!state.places) state.places = await api("GET", "/api/netplaces").catch(() => null);
  if (!state.places) return go("#/settings/places");
  const before = new Set(state.places.places.map((p) => p.id));
  placeDialog(null, {}, (list) => {
    const made = list.find((p) => !before.has(p.id));
    if (made) go(filesHash(made.folder, ""));
  });
}

/** Connects a network place, or changes one; `seed` — a server found on the network, `after` hears the places once it is done */
function placeDialog(place = null, seed = {}, after = null) {
  let kind = place?.kind ?? seed.kind ?? "smb";
  let dialog;
  const value = (key, fallback = "") => place?.[key] ?? seed[key] ?? fallback;
  const name = h("input", { value: value("name"), maxLength: 40, required: true });
  const host = h("input", { value: value("host"), spellcheck: false, class: "mono", placeholder: "nas.local" });
  const port = h("input", { type: "number", min: 0, max: 65535, value: value("port", 0) || "", class: "mono port" });
  const url = h("input", { type: "url", value: value("url"), spellcheck: false, class: "mono", placeholder: "https://cloud.example.org/remote.php/dav/files/me" });
  const share = h("input", { value: value("path"), spellcheck: false, class: "mono" });
  const user = h("input", { value: value("user"), spellcheck: false, autocomplete: "off", class: "mono" });
  const password = h("input", { type: "password", autocomplete: "new-password", placeholder: place?.passwordSet ? t("notify.tokenSaved") : "" });
  const domain = h("input", { value: value("domain"), spellcheck: false, class: "mono", placeholder: "WORKGROUP" });
  const tls = h("input", { type: "checkbox", checked: !!value("tls", false) });
  const readOnly = h("input", { type: "checkbox", checked: !!value("readOnly", false) });
  const found = h("div", { class: "row-actions wrap" });
  const error = h("p", { class: "error", role: "alert" });
  const trust = h("div", { class: "banner stack", hidden: true });
  const needs = h("div");
  const modes = h("div", { class: "modes" });
  const fields = h("div", { class: "stack" });
  const submit = h("button", { class: "btn primary" }, t(place ? "settings.save" : "netplace.connectGo"));
  let trusted = "";
  // the server's own list, to pick from instead of typing
  const list = button(t(kind === "nfs" ? "netplace.showExports" : "netplace.showShares"), { class: "small", onclick: async () => {
    error.textContent = "";
    try {
      const names = await api("POST", "/api/netplaces/shares", { kind, host: host.value, user: user.value, password: password.value });
      put(found, names.length ? names.map((n) => button(n, { class: "small mono", onclick: () => (share.value = n) })) : h("span", { class: "muted small" }, t("netplace.noShares")));
    } catch (err) {
      showError(err);
    }
  } }, "search");
  const tools = () => state.places?.packages?.[kind] ?? { missing: [], install: "" };
  const showError = (err) => {
    error.textContent = errorText(err);
    if (err instanceof ApiError && err.code === "netplace.needsPackage") paintNeeds({ missing: err.detail.package.split(" "), install: err.detail.install }, err.detail.package === "smbclient" ? "smbclient" : kind);
  };
  const paintNeeds = (tool, forKind = kind) =>
    put(
      needs,
      tool.missing.length > 0 &&
        h(
          "div",
          { class: "banner stack" },
          h("strong", null, t(`netplace.needs.${forKind}`, { package: tool.missing.join(", ") })),
          h("p", { class: "muted small" }, t(`netplace.needs.${forKind}Why`)),
          tool.install ? h("p", { class: "cmd" }, icon("terminal"), tool.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: tool.missing.join(" ") })),
          tool.install && button(t("mounting.needs.install", { package: tool.missing.join(", ") }), { class: "small", onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            error.textContent = "";
            try {
              state.places = await api("POST", "/api/netplaces/package", { kind: forKind });
              paintNeeds(forKind === "smbclient" ? { missing: [] } : tools());
            } catch (err) {
              error.textContent = errorText(err);
              b.disabled = false;
            }
          } }, "download"),
        ),
    );
  const paint = () => {
    put(modes, PLACE_KINDS.map((k) => h("button", { type: "button", class: "mode" + (k === kind ? " active" : ""), disabled: !!place && k !== kind, onclick: () => ((kind = k), (trusted = ""), (trust.hidden = true), put(found), paint()) }, t(`netplace.kind.${k}`))));
    list.lastChild.textContent = t(kind === "nfs" ? "netplace.showExports" : "netplace.showShares");
    port.placeholder = { smb: "445", nfs: "2049", sftp: "22", ftp: "21", webdav: "" }[kind];
    share.placeholder = kind === "smb" ? "photos" : kind === "nfs" ? "/srv/media" : "/";
    host.required = kind !== "webdav";
    url.required = kind === "webdav";
    put(
      fields,
      h("p", { class: "muted small" }, t(`netplace.kind.${kind}Lead`)),
      field(t("netplace.name"), name, t("netplace.nameHint")),
      kind === "webdav" ? field(t("netplace.url"), url) : field(t("netplace.host"), h("span", { class: "pair" }, host, port), t("netplace.hostHint")),
      kind === "smb" || kind === "nfs" ? field(t(kind === "smb" ? "netplace.share" : "netplace.export"), h("span", { class: "pair" }, share, list), t(kind === "smb" ? "netplace.shareHint" : "netplace.exportHint")) : field(t("netplace.folder"), share, t("netplace.folderHint")),
      found,
      kind !== "nfs" && field(t("netplace.user"), user, t(kind === "smb" ? "netplace.userHintSmb" : "netplace.userHint")),
      kind !== "nfs" && field(t("netplace.password"), password),
      kind === "smb" && field(t("netplace.domain"), domain, t("netplace.domainHint")),
      kind === "nfs" && h("p", { class: "muted small" }, t("netplace.nfsOwners", { puid: `${state.settings?.puid ?? 1000}:${state.settings?.pgid ?? 1000}` })),
      kind === "ftp" && h("label", { class: "check" }, tls, h("span", null, h("strong", null, t("netplace.tls")), h("span", { class: "muted small block" }, t("netplace.tlsHint")))),
      h("label", { class: "check" }, readOnly, h("span", null, h("strong", null, t("netplace.readOnly")), h("span", { class: "muted small block" }, t("netplace.readOnlyHint")))),
    );
    paintNeeds(tools());
  };
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    const body = { kind, name: name.value, host: host.value, port: port.value, url: url.value, path: share.value, user: user.value, password: password.value, domain: domain.value, tls: tls.checked, readOnly: readOnly.checked, ...(trusted ? { trust: trusted } : {}) };
    submit.textContent = t("netplace.connecting");
    try {
      const res = await api(place ? "PUT" : "POST", place ? `/api/netplaces/${place.id}` : "/api/netplaces", body);
      if (res.unknownHost) {
        trusted = res.unknownHost;
        trust.hidden = false;
        put(trust, h("strong", null, t("netplace.hostKey", { host: host.value })), h("p", { class: "mono small" }, res.unknownHost), h("p", { class: "muted small" }, t("netplace.hostKeyHint")));
        submit.textContent = t("netplace.trustGo");
        submit.disabled = false;
        return;
      }
      dialog.close();
      toast(t(place ? "settings.saved" : "netplace.connected", { name: name.value }));
      await reloadPlaces(res.places);
      after?.(state.places.places);
    } catch (err) {
      showError(err);
      submit.textContent = t(place ? "settings.save" : "netplace.connectGo");
      submit.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { onsubmit: send },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t(place ? "netplace.changeTitle" : "netplace.connectTitle")), h("p", { class: "muted small" }, t("netplace.dialogLead"))), closeX(() => dialog)),
      modes,
      needs,
      fields,
      trust,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), submit),
    ),
  );
  paint();
  (place ? submit : name).focus();
}

function removePlaceDialog(p) {
  let dialog;
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("netplace.remove"), { class: "danger", onclick: async () => {
    go.disabled = true;
    try {
      const res = await api("DELETE", `/api/netplaces/${p.id}`);
      dialog.close();
      await reloadPlaces(res.places);
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  } });
  dialog = openDialog("confirm", h("h2", null, t("netplace.removeTitle", { name: p.name })), h("p", { class: "muted" }, t("netplace.removeLead", { path: p.folder })), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

/** Servers on the home network that announce a file service; each opens the dialog filled in */
async function findPlacesDialog() {
  let dialog;
  const body = h("div", { class: "stack" }, h("p", { class: "muted" }, t("netplace.finding")));
  dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("netplace.findTitle")), h("p", { class: "muted small" }, t("netplace.findLead"))), closeX(() => dialog)), body);
  let found = [];
  try {
    found = await api("GET", "/api/netplaces/discover");
  } catch (err) {
    return put(body, h("p", { class: "error" }, errorText(err)));
  }
  put(
    body,
    found.length
      ? found.map((f) => h("div", { class: "snapshot" }, h("span", { class: "badge-icon plain" }, icon("globe")), h("div", { class: "grow" }, h("strong", null, f.name), h("div", { class: "muted small mono" }, `${t("netplace.kind." + f.kind)} · ${f.host}${f.address ? " · " + f.address : ""}${f.port ? ":" + f.port : ""}`)), button(t("netplace.connect"), { class: "small primary", onclick: () => (dialog.close(), placeDialog(null, { kind: f.kind, host: f.address || f.host, name: f.name, port: [445, 2049, 22, 21, 80, 443].includes(f.port) ? 0 : f.port, url: f.kind === "webdav" ? `${f.port === 443 ? "https" : "http"}://${f.address || f.host}${[80, 443].includes(f.port) ? "" : ":" + f.port}/` : "" })) }, "plus")))
      : h("p", { class: "muted" }, t("netplace.foundNone")),
    h("p", { class: "muted small" }, t("netplace.findHint")),
  );
}

// --- Protection from a disk failure (SnapRAID) --------------------------------------------------

let arrayTimer = 0;
/** One call that changes the array; the answer is the whole storage page */
async function arrayCall(method, path, data, done) {
  try {
    setDisks(await api(method, "/api/disks/array" + path, data));
    done?.();
  } catch (err) {
    toast(errorText(err), "error");
  }
}

function arrayCard(data, array) {
  clearTimeout(arrayTimer);
  // a run moves without telling: the page looks again while one goes
  if (array.running) arrayTimer = setTimeout(async () => onStorageSection() && setDisks(await api("GET", "/api/disks").catch(() => state.disks)), 3000);
  const row = (label, value) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", null, value));
  const head = (...actions) => h("div", { class: "section-head" }, h("h2", null, t("array.title")), h("div", { class: "row-actions" }, actions));
  const lead = h("p", { class: "muted small" }, t("array.lead"));
  if (array.tool === "missing") {
    return h(
      "section",
      { class: "card pad stack" },
      head(),
      lead,
      h(
        "div",
        { class: "banner stack" },
        h("strong", null, t("array.needs.what")),
        h("p", { class: "muted small" }, t("array.needs.why")),
        array.needs.install ? h("p", { class: "cmd" }, icon("terminal"), array.needs.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: array.needs.package })),
        array.needs.install &&
          button(t("mounting.needs.install", { package: array.needs.package }), {
            class: "small",
            onclick: async (e) => {
              const el = e.currentTarget;
              el.disabled = true;
              try {
                setDisks(await api("POST", "/api/disks/package", { package: array.needs.package }));
              } catch (err) {
                el.disabled = false;
                toast(errorText(err), "error");
              }
            },
          }),
      ),
    );
  }
  if (!array.on) return h("section", { class: "card pad stack" }, head(button(t("pool.open"), { class: "small" + (array.candidates.length > 1 ? "" : " primary"), onclick: () => poolDialog() }), array.candidates.length > 1 && button(t("array.setUp"), { class: "small primary", onclick: () => arrayDialog(array) })), lead, array.candidates.length < 2 && h("p", { class: "muted small" }, t("array.needsDisks")), arrayFit(data));

  const busy = !!array.running;
  const d = array.diff;
  const waiting = d ? d.added + d.updated : 0;
  const act = (label, path, data, cls = "small") => button(label, { class: cls, disabled: busy, onclick: () => arrayCall("POST", path, data ?? {}) });
  const banners = [
    array.missing.length > 0 && h("div", { class: "banner danger stack" }, h("strong", null, t("array.missing", { disks: array.missing.join(", ") })), h("p", { class: "small" }, t("array.missingHint"))),
    array.trouble?.code === "diskEmpty" &&
      h("div", { class: "banner danger stack" }, h("strong", null, t("array.diskEmpty", { disk: array.settings.data.find((x) => x.name === array.trouble.disk)?.path ?? array.trouble.disk })), h("p", { class: "small" }, t("array.diskEmptyHint")), h("div", { class: "row-actions" }, button(t("array.recover"), { class: "small primary", disabled: busy, onclick: () => recoverDialog(array.settings.data.find((x) => x.name === array.trouble.disk)) }), act(t("array.emptyOnPurpose"), "/sync", { force: true, empty: true }))),
    array.trouble?.code === "parityLost" && h("div", { class: "banner danger stack" }, h("strong", null, t("array.parityLost", { disk: array.settings.parity })), h("p", { class: "small" }, t("array.parityLostHint")), h("div", { class: "row-actions" }, act(t("array.rebuild"), "/rebuild", {}, "small primary"))),
    array.errors > 0 && h("div", { class: "banner danger stack" }, h("strong", null, t("array.errors", { n: array.errors })), h("p", { class: "small" }, t("array.errorsHint")), h("div", { class: "row-actions" }, act(t("array.repair"), "/repair", {}, "small primary"))),
    array.held && h("div", { class: "banner stack" }, h("strong", null, t("array.held", { n: array.held.removed })), h("p", { class: "small" }, t("array.heldHint")), h("div", { class: "row-actions" }, act(t("array.bringBack"), "/fix", {}, "small primary"), button(t("array.syncAnyway"), { class: "small", disabled: busy, onclick: () => confirmAction({ title: t("array.syncTitle", { n: array.held.removed }), lead: t("array.syncLead"), label: t("array.syncGo"), iconName: "refresh", run: () => arrayCall("POST", "/sync", { force: true }) }) }))),
    !array.trouble && !array.held && array.lastSync && !array.lastSync.ok && h("p", { class: "banner small" }, t("array.failed", { message: array.lastSync.message })),
  ];
  const running =
    array.running &&
    h("div", { class: "banner stack" }, h("div", { class: "section-head" }, h("strong", null, t("array.running." + array.running.what), array.running.percent != null && ` · ${array.running.percent}%`), button(t("array.stop"), { class: "small", onclick: () => arrayCall("POST", "/stop", {}) })), h("p", { class: "muted small" }, t("array.runningHint")));
  return h(
    "section",
    { class: "card pad stack" },
    head(act(t("array.syncNow"), "/sync", {}), act(t("array.checkNow"), "/scrub", {}), button(t("array.settings"), { class: "small", disabled: busy, onclick: () => arrayDialog(array) }, "sliders")),
    lead,
    running,
    banners,
    h(
      "div",
      { class: "kv-list" },
      row(t("array.parity"), h("span", null, h("span", { class: "mono" }, array.settings.parity), array.paritySize > 0 && h("span", { class: "muted small" }, ` · ${bytes(array.paritySize)}`))),
      array.settings.parity2 && row(t("array.parity2"), h("span", null, h("span", { class: "mono" }, array.settings.parity2), array.parity2Size > 0 ? h("span", { class: "muted small" }, ` · ${bytes(array.parity2Size)}`) : h("span", { class: "muted small" }, ` · ${t("array.parity2Pending")}`))),
      array.settings.data.map((disk, i) => row(i === 0 ? t("array.data") : "", h("span", { class: "with-actions" }, h("span", { class: "mono" }, disk.path), " ", button(t("array.recover"), { class: "small quiet", disabled: busy, onclick: () => recoverDialog(disk) })))),
      row(t("array.lastSync"), array.lastSync?.ok ? ago(array.lastSync.at) : array.lastSync ? t("array.lastFailed", { when: ago(array.lastSync.at) }) : t("array.never")),
      row(t("array.waiting"), h("span", { class: "with-actions" }, !array.lastSync?.ok && !d ? "—" : waiting || d?.removed ? [waiting > 0 && t("array.waitingNew", { n: waiting }), d.removed > 0 && t("array.waitingGone", { n: d.removed })].filter(Boolean).join(" · ") : t("array.waitingNone"), array.lastSync?.ok && button(t("array.goneOne"), { class: "small quiet", disabled: busy, onclick: () => goneDialog() }))),
      row(t("array.lastScrub"), array.lastScrub ? `${ago(array.lastScrub.at)} · ${t(array.lastScrub.ok ? "array.scrubOk" : "array.scrubBad")}` : t("array.never")),
      row(t("array.schedule"), t(array.settings.scrub ? "array.scheduleScrub" : "array.scheduleSync", { time: array.settings.time })),
      array.appDataRule !== null && row("AppData", t(array.settings.appData ? "array.appDataIn" : "array.appDataOut")),
    ),
    array.log.length > 0 && h("details", null, h("summary", { class: "muted small" }, t("array.log")), h("pre", { class: "console small-console" }, array.log.join("\n"))),
  );
}

/**
 * Every disk and file system here, as the array and the merged folders see them: `step` — what it needs
 * before it can take part (format, connect, keep — connect for good, ready), null — it cannot; `why` —
 * said to the person either way.
 */
function storageRows(data) {
  const ours = data.mounting.ours;
  const pooled = Object.values(data.mounting.pools ?? {}).flat();
  const rows = [];
  const add = (row) => rows.push({ step: null, size: 0, path: "", device: "", ...row });
  for (const disk of data.disks) {
    const blocked = data.mounting.blockers[disk.name] ?? [];
    const base = { disk, title: diskTitle(disk), sub: [diskTitle(disk), disk.name, bytes(disk.size)].join(" · "), key: disk.name, size: disk.size };
    const stop = ["system", "member", "readonly"].find((b) => blocked.includes(b));
    if (stop) {
      add({ ...base, why: "array.fit." + stop });
      continue;
    }
    const volumes = disk.volumes.filter((v) => !v.swap);
    if (!volumes.some((v) => v.fstype)) {
      add({ ...base, why: "array.fit.blank", step: changeable(disk).whole ? "format" : null });
      continue;
    }
    for (const v of volumes) {
      const at = v.mounts[0];
      const row = { disk, volume: v, key: v.path, device: v.path, title: at ?? (v.label || diskTitle(disk)), sub: [diskTitle(disk), v.name, v.fstype || "—", bytes(v.size)].join(" · "), size: v.size };
      // a partition alone, or the whole disk when it is the only one
      const format = changeable(disk).volumes.includes(v.path) ? "format" : null;
      const whole = disk.volumes.length === 1;
      const ready = at && data.array.candidates.find((c) => c.path === at);
      if (ready) add({ ...row, step: "ready", path: at, size: ready.size, why: ready.merged || ready.holds ? "array.fit.dataOnly" : "array.fit.yes", pooled: pooled.includes(at), holds: !!ready.holds, parity: data.array.settings.parity === at });
      else if (!v.fstype) add({ ...row, why: "array.fit.blank", step: format, device: whole ? "" : v.path });
      else if (!/^(ext[234]|xfs|btrfs|f2fs)$/.test(v.fstype)) add({ ...row, why: "array.fit.foreign", fs: v.fstype, step: format, device: whole ? "" : v.path });
      else if (!at) add({ ...row, why: "array.fit.notConnected", step: data.mounting.mountable.includes(v.path) ? "connect" : null });
      else if (ours[at] === "temporary") add({ ...row, why: "array.fit.temporary", step: "keep", path: at });
      else if (ours[at] === "kept") add({ ...row, why: "array.fit.pool" });
      else add({ ...row, why: "array.fit.byHand", path: at });
    }
  }
  return rows;
}

const fitWhy = (r) => t(r.why, { fs: r.fs ?? "", path: r.path });

/** The disks here on the protection card: whether each can take part, and if not, why and what to do */
function arrayFit(data) {
  const rows = storageRows(data);
  if (!rows.length) return null;
  const action = (r) => {
    if (r.step === "format") return button(t("mounting.format"), { class: "small", onclick: () => formatDialog(r.disk, r.device ? r.volume : undefined) });
    if (r.step === "connect") return button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(r.disk, r.volume) });
    if (r.step === "keep") return button(t("mounting.disconnect"), { class: "small", onclick: () => disconnectDialog({ path: r.path, disk: r.disk.name }) });
    return null;
  };
  return h("div", { class: "stack" }, h("strong", { class: "small" }, t("array.fit.title")), h("div", { class: "kv-list" }, rows.map((r) => fitRow(r, r.step === "ready", action(r)))));
}

const fitRow = (r, fits, ...after) =>
  h(
    "div",
    { class: "kv" },
    h("div", { class: "fit" }, h("span", { class: r.title.startsWith("/") ? "strong mono" : "strong" }, r.title), h("div", { class: "muted small" }, r.sub), h("div", { class: "small fit-why" + (fits ? " ok" : "") }, icon(fits ? "check" : "x"), fitWhy(r))),
    after.some(Boolean) ? h("div", { class: "row-actions" }, after) : h("span"),
  );

/**
 * Several disks together, step by step: what for (one large folder, protection from a disk failure,
 * both), which disks, their folders and the schedule, then one confirmation and one job that does it all.
 */
function poolDialog() {
  const data = state.disks;
  const rows = storageRows(data);
  const arrayOn = data.array?.on;
  const plan = { goal: arrayOn ? "merge" : "both", chosen: new Set(), parity: "", names: {}, name: "storage", time: data.array?.settings.time ?? "05:00", scrub: true };
  let step = 1;
  let tools = null;
  let dialog;
  const body = h("div", { class: "stack" });
  const steps = h("ol", { class: "pool-steps" });
  const merge = () => plan.goal !== "protect";
  const protect = () => plan.goal !== "merge";
  // a branch of a merged folder can hold data of the array, but not go into another merged folder
  const usable = (r) => !!r.step && !r.parity && !(r.pooled && merge());
  const chosen = () => rows.filter((r) => plan.chosen.has(r.key));
  const parityRow = () => (protect() ? chosen().find((r) => r.key === plan.parity) : undefined);
  const dataRows = () => chosen().filter((r) => r !== parityRow());
  const folder = (r) => (r.step === "format" || r.step === "connect" ? "/mnt/" + (plan.names[r.key] ?? "") : r.path);
  const named = () => {
    let n = 0;
    for (const r of chosen()) if ((r.step === "format" || r.step === "connect") && !plan.names[r.key]) plan.names[r.key] = r === parityRow() ? "parity1" : "disk" + ++n;
  };
  // what is wrong with the choice of disks, in words; "" — nothing
  const disksTrouble = () => {
    const need = plan.goal === "both" ? 3 : 2;
    if (chosen().length < need) return t("pool.needDisks", { n: need });
    if (!protect()) return "";
    const p = parityRow();
    if (!p) return t("pool.needParity");
    if (p.pooled || p.holds) return t(p.pooled ? "array.cannot.merged" : "array.cannot.holds");
    if (p.size < Math.max(...dataRows().map((r) => r.size)) * 0.97) return t("error.array.parityTooSmall");
    return "";
  };
  const namesTrouble = () => {
    const folders = chosen().map(folder);
    if (chosen().some((r) => (r.step === "format" || r.step === "connect") && !MOUNT_NAME.test(plan.names[r.key] ?? ""))) return t("error.disk.badName");
    if (merge() && !MOUNT_NAME.test(plan.name)) return t("error.disk.badName");
    if (new Set([...folders, ...(merge() ? ["/mnt/" + plan.name] : [])]).size !== folders.length + (merge() ? 1 : 0)) return t("error.plan.sameFolder");
    return "";
  };
  const doing = (r) => (r.step === "format" ? t("pool.do.format") : r.step === "connect" ? t("pool.do.connect") : r.step === "keep" ? t("pool.do.keep") : t("pool.do.ready"));
  const paint = () => {
    put(steps, ["goal", "disks", "setup", "go"].map((id, i) => h("li", { class: i + 1 === step ? "current" : i + 1 < step ? "done" : "" }, h("span", { class: "welcome-num" }, i + 1 < step ? icon("check") : String(i + 1)), t("pool.step." + id))));
    put(body, [null, goalStep, disksStep, setupStep, goStep][step]());
  };
  const nav = (ok, next = () => ((step += 1), paint())) =>
    h("footer", null, step > 1 ? button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }) : closeButton(() => dialog, t("common.cancel")), button(t("pool.next"), { class: "primary", disabled: !ok, onclick: next }));

  const goalStep = () => {
    const option = (id) => {
      const off = arrayOn && id !== "merge";
      const input = h("input", { type: "radio", name: "pool-goal", value: id, checked: plan.goal === id, disabled: off });
      input.addEventListener("change", () => ((plan.goal = id), (plan.parity = "")));
      return h("label", { class: "check pool-goal" + (off ? " muted" : "") }, input, h("span", null, h("strong", null, t("pool.goal." + id)), h("span", { class: "muted small block" }, t("pool.goal." + id + ".what")), off && h("span", { class: "small block" }, t("pool.arrayOn"))));
    };
    return [h("p", { class: "muted" }, t("pool.lead")), option("both"), option("merge"), option("protect"), nav(true)];
  };

  const disksStep = () => {
    const trouble = h("p", { class: "muted small" });
    const next = button(t("pool.next"), { class: "primary" });
    const paritySlot = h("div");
    const check = () => {
      const why = disksTrouble();
      trouble.textContent = why;
      // too few disks yet is where everybody starts, not a mistake
      trouble.className = why && chosen().length >= (plan.goal === "both" ? 3 : 2) ? "error small" : "muted small";
      next.disabled = !!why;
    };
    const parityPick = () => {
      if (!protect()) return put(paritySlot);
      const list = chosen();
      if (!plan.parityChosen || !list.some((r) => r.key === plan.parity)) {
        // the largest disk that may hold it
        const fit = list.filter((r) => !r.pooled && !r.holds).sort((a, b) => b.size - a.size)[0];
        plan.parity = fit?.key ?? "";
      }
      const select = h("select", null, h("option", { value: "" }, "—"), list.map((r) => h("option", { value: r.key, selected: r.key === plan.parity, disabled: r.pooled || r.holds }, `${r.title} · ${bytes(r.size)}`)));
      select.addEventListener("change", () => ((plan.parity = select.value), (plan.parityChosen = true), check()));
      put(paritySlot, field(t("array.parityDisk"), select, t("pool.parityHint")));
    };
    const list = rows.map((r) => {
      const box = h("input", { type: "checkbox", checked: plan.chosen.has(r.key), disabled: !usable(r), "aria-label": r.title });
      const tag = h("span", { class: "small" });
      const mark = () => {
        tag.textContent = box.checked && r.step !== "ready" ? doing(r) : "";
        tag.className = "small " + (r.step === "format" ? "pool-erase" : "muted");
      };
      box.addEventListener("change", () => {
        if (box.checked) plan.chosen.add(r.key);
        else plan.chosen.delete(r.key);
        mark();
        parityPick();
        check();
      });
      mark();
      // what the wizard does about it is said beside, so the fact alone here
      const why = r.parity ? { ...r, why: "pool.isParity" } : r.pooled && merge() ? { ...r, why: "pool.inPool" } : r.step && r.step !== "ready" ? { ...r, why: "pool.fact." + r.why.split(".").pop() } : r;
      return h("label", { class: "kv pool-disk" + (usable(r) ? "" : " muted") }, h("div", { class: "fit" }, h("span", { class: "with-icon" }, box, h("span", { class: r.title.startsWith("/") ? "strong mono" : "strong" }, r.title)), h("div", { class: "muted small" }, r.sub), h("div", { class: "small fit-why" + (r.step === "ready" && usable(r) ? " ok" : "") }, icon(r.step === "ready" && usable(r) ? "check" : "x"), fitWhy(why))), tag);
    });
    next.onclick = () => ((step += 1), named(), paint());
    parityPick();
    check();
    return [h("p", { class: "muted" }, t("pool.disksLead." + plan.goal)), h("div", { class: "kv-list" }, list), paritySlot, trouble, h("footer", null, button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }), next)];
  };

  const setupStep = () => {
    const trouble = h("p", { class: "error small" });
    const next = button(t("pool.next"), { class: "primary" });
    const check = () => {
      trouble.textContent = namesTrouble();
      next.disabled = !!trouble.textContent || missing().length > 0;
    };
    const missing = () => (tools ? [merge() && "mergerfs", protect() && "snapraid"].filter((id) => id && tools.find((x) => x.id === id)?.state === "missing") : []);
    const nameInput = (get, set) => {
      const input = h("input", { type: "text", value: get(), maxlength: 32, spellcheck: false });
      input.addEventListener("input", () => (set(input.value), check()));
      return input;
    };
    const disks = chosen().map((r) =>
      h(
        "div",
        { class: "kv" },
        h("div", { class: "fit" }, h("span", { class: "strong" }, r.title), h("div", { class: "muted small" }, r.sub), h("div", { class: "small " + (r.step === "format" ? "pool-erase" : "muted") }, r === parityRow() ? t("pool.forParity") : t("pool.forData"), " · ", doing(r))),
        r.step === "format" || r.step === "connect" ? h("label", { class: "pool-name" }, h("span", { class: "muted mono" }, "/mnt/"), nameInput(() => plan.names[r.key], (v) => (plan.names[r.key] = v))) : h("span", { class: "mono" }, r.path),
      ),
    );
    const time = h("input", { type: "time", value: plan.time, required: true });
    time.addEventListener("input", () => (plan.time = time.value || plan.time));
    const scrub = h("input", { type: "checkbox", checked: plan.scrub });
    scrub.addEventListener("change", () => (plan.scrub = scrub.checked));
    const cards = h("div", { class: "stack" });
    const loadTools = async () => {
      tools = (await api("GET", "/api/tools").catch(() => null)) ?? tools;
      put(cards, missing().map((id) => packageCard({ package: id, install: tools.find((x) => x.id === id)?.install ?? "" }, () => void loadTools())));
      check();
    };
    void loadTools();
    next.onclick = () => ((step += 1), paint());
    check();
    return [
      cards,
      h("strong", { class: "small" }, t("pool.disksTitle")),
      h("div", { class: "kv-list" }, disks),
      merge() && field(t("pool.merged"), h("span", { class: "pool-name" }, h("span", { class: "muted mono" }, "/mnt/"), nameInput(() => plan.name, (v) => (plan.name = v))), t("pool.mergedHint")),
      protect() && field(t("array.time"), time),
      protect() && h("label", { class: "check" }, scrub, h("span", null, h("strong", null, t("array.scrub")), h("span", { class: "muted small block" }, t("array.scrubHint")))),
      trouble,
      h("footer", null, button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }), next),
    ];
  };

  const goStep = () => {
    const erased = chosen().filter((r) => r.step === "format");
    const typed = erased.map((r) => ({ r, input: h("input", { type: "text", autocomplete: "off", spellcheck: false, placeholder: r.device ? r.volume.name : r.disk.name }) }));
    const password = h("input", { type: "password", autocomplete: "current-password" });
    const slot = h("div");
    const go = button(t("pool.go"), { class: erased.length ? "danger" : "primary" });
    const check = () => (go.disabled = typed.some((x) => x.input.value.trim() !== (x.r.device ? x.r.volume.name : x.r.disk.name)) || (erased.length > 0 && !password.value));
    for (const input of [...typed.map((x) => x.input), password]) input.addEventListener("input", check);
    const todo = [
      ...chosen().filter((r) => r.step !== "ready").map((r) => t("pool.todo." + r.step, { what: r.device || r.disk.path, title: r.title, path: folder(r) })),
      merge() && t("pool.todo.merge", { disks: dataRows().map(folder).join(" + "), path: "/mnt/" + plan.name }),
      protect() && t("pool.todo.protect", { parity: folder(parityRow()), disks: dataRows().map(folder).join(", "), time: plan.time }),
    ].filter(Boolean);
    go.onclick = diskAction(
      () => dialog,
      slot,
      () =>
        api("POST", "/api/disks/plan", {
          goal: plan.goal,
          disks: chosen().map((r) => ({ disk: r.disk.name, serial: r.disk.serial, size: r.disk.size, device: r.device, step: r.step, name: plan.names[r.key] ?? "", path: r.path })),
          parity: protect() ? chosen().indexOf(parityRow()) : -1,
          name: plan.name,
          time: plan.time,
          scrub: plan.scrub,
          password: password.value,
        }),
      (started) => run(started.job),
    );
    check();
    return [
      h("p", { class: "muted" }, t("pool.goLead")),
      h("ol", { class: "steps" }, todo.map((line) => h("li", null, line))),
      erased.length > 0 && h("p", { class: "banner danger" }, t("pool.erases", { disks: erased.map((r) => r.title).join(", ") })),
      typed.map((x) => field(t("mounting.typeName", { name: x.r.device ? x.r.volume.name : x.r.disk.name }), x.input)),
      erased.length > 0 && field(t("account.password"), password, t("mounting.passwordHint")),
      slot,
      h("footer", null, button(t("pool.back"), { onclick: () => ((step -= 1), paint()) }), go),
    ];
  };

  // the work itself: its log here, then what to do next
  const run = async (id) => {
    const log = h("pre", { class: "console" });
    const status = h("p", { class: "job-status running" }, t("job.running"));
    put(body, status, log, h("footer", null, button(t("job.hide"), { onclick: () => dialog.close() })));
    const job = await followJob(id, (line) => {
      log.append(line + "\n");
      log.scrollTop = log.scrollHeight;
    });
    setDisks(await api("GET", "/api/disks").catch(() => state.disks));
    if (job.status !== "done") {
      put(body, h("p", { class: "banner danger" }, t("pool.failed")), h("pre", { class: "said" }, job.error || ""), log, h("footer", null, closeButton(() => dialog, t("common.close"))));
      return;
    }
    step = 5;
    put(steps, ["goal", "disks", "setup", "go"].map((id) => h("li", { class: "done" }, h("span", { class: "welcome-num" }, icon("check")), t("pool.step." + id))));
    const where = merge() ? "/mnt/" + plan.name : folder(dataRows()[0]);
    put(
      body,
      h("p", { class: "banner ok" }, t("pool.done." + plan.goal, { path: where })),
      protect() && h("p", { class: "muted" }, t("pool.syncHint")),
      h("details", null, h("summary", { class: "muted small" }, t("array.log")), log),
      h(
        "footer",
        null,
        closeButton(() => dialog, t("common.close")),
        h("a", { class: "btn", href: filesHash(where), onclick: () => dialog.close() }, t("disks.fs.browse")),
        protect() &&
          button(t("array.syncNow"), {
            class: "primary",
            onclick: async () => {
              try {
                setDisks(await api("POST", "/api/disks/array/sync", {}));
                dialog.close();
              } catch (e) {
                toast(errorText(e), "error");
              }
            },
          }),
      ),
    );
  };

  dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("pool.title"))), closeX(() => dialog)), steps, body);
  paint();
}

/** Which disk holds parity, which are protected, when it runs */
function arrayDialog(array) {
  const cfg = array.settings;
  const error = h("p", { class: "error", role: "alert" });
  const size = (c) => `${bytes(c.size)} · ${t("array.used", { size: bytes(c.used) })}`;
  const parity = array.candidates.map((c) => ({ c, input: h("input", { type: "radio", name: "parity", value: c.path, checked: cfg.parity === c.path, disabled: c.merged || !!c.holds }) }));
  const data = array.candidates.map((c) => ({ c, input: h("input", { type: "checkbox", value: c.path, checked: cfg.data.some((x) => x.path === c.path) }) }));
  // a second parity disk is a choice of its own; none by default
  const none = h("input", { type: "radio", name: "parity2", value: "", checked: !cfg.parity2 });
  const parity2 = array.candidates.map((c) => ({ c, input: h("input", { type: "radio", name: "parity2", value: c.path, checked: cfg.parity2 === c.path, disabled: c.merged || !!c.holds }) }));
  const appData = h("input", { type: "checkbox", checked: cfg.appData });
  const time = h("input", { type: "time", value: cfg.time, required: true });
  const scrub = h("input", { type: "checkbox", checked: cfg.scrub });
  const limit = h("input", { type: "number", min: 0, max: 1000000, value: cfg.deleteLimit, required: true });
  const anew = h("p", { class: "banner small", hidden: true }, t("array.anew"));
  const go = h("button", { class: "btn primary" }, t(array.on ? "settings.save" : "array.turnOn"));
  const check = () => {
    const chosen = parity.find((p) => p.input.checked)?.c.path ?? "";
    for (const x of parity2) {
      x.input.disabled = x.c.merged || !!x.c.holds || x.c.path === chosen;
      if (x.input.disabled && x.input.checked) none.checked = true;
    }
    const second = parity2.find((p) => p.input.checked)?.c.path ?? "";
    for (const x of data) {
      x.input.disabled = x.c.path === chosen || x.c.path === second;
      if (x.input.disabled) x.input.checked = false;
    }
    const paths = data.filter((x) => x.input.checked).map((x) => x.c.path);
    go.disabled = !chosen || !paths.length || (!!second && paths.length < 2);
    anew.hidden = !array.on || (chosen === cfg.parity && cfg.data.every((x) => paths.includes(x.path)));
  };
  for (const x of [...parity, ...parity2, ...data, { input: none }]) x.input.addEventListener("change", check);
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          try {
            setDisks(await api("PUT", "/api/disks/array", { parity: parity.find((p) => p.input.checked).c.path, parity2: parity2.find((p) => p.input.checked)?.c.path ?? "", data: data.filter((x) => x.input.checked).map((x) => x.c.path), appData: appData.checked, time: time.value, scrub: scrub.checked, deleteLimit: Number(limit.value) }));
            dialog.close();
            toast(t(array.on ? "settings.saved" : "array.turnedOn"));
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("array.title")), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("array.how")),
      h("h3", null, t("array.parityDisk")),
      h("p", { class: "muted small" }, t("array.parityDiskHint")),
      parity.map(({ c, input }) => h("label", { class: "check" }, input, h("span", null, h("strong", { class: "mono" }, c.path), h("span", { class: "muted small block" }, c.merged ? t("array.cannot.merged") : c.holds ? t("array.cannot.holds") : size(c))))),
      h("h3", null, t("array.parity2Disk")),
      h("p", { class: "muted small" }, t("array.parity2Hint")),
      h("label", { class: "check" }, none, h("span", null, h("strong", null, t("array.parity2None")))),
      parity2.map(({ c, input }) => h("label", { class: "check" }, input, h("span", null, h("strong", { class: "mono" }, c.path), h("span", { class: "muted small block" }, c.merged ? t("array.cannot.merged") : c.holds ? t("array.cannot.holds") : size(c))))),
      h("h3", null, t("array.dataDisks")),
      data.map(({ c, input }) => h("label", { class: "check" }, input, h("span", null, h("strong", { class: "mono" }, c.path), h("span", { class: "muted small block" }, size(c))))),
      h("label", { class: "check" }, appData, h("span", null, h("strong", null, t("array.appData")), h("span", { class: "muted small block" }, t("array.appDataHint")))),
      h("div", { class: "field-row" }, field(t("array.time"), time), field(t("array.limit"), limit, t("array.limitHint"))),
      h("label", { class: "check" }, scrub, h("span", null, h("strong", null, t("array.scrub")), h("span", { class: "muted small block" }, t("array.scrubHint")))),
      anew,
      error,
      h("footer", null, array.on && button(t("array.turnOff"), { class: "danger", onclick: () => (dialog.close(), arrayOffDialog()) }), closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
  check();
}

/** The files gone since the last sync: one is chosen by its name and brought back as it was then */
function goneDialog() {
  let dialog;
  const q = h("input", { type: "search", placeholder: t("array.goneSearch"), spellcheck: false });
  const list = h("div", { class: "stack" });
  const error = h("p", { class: "error", role: "alert" });
  let timer = 0;
  const load = async (look = false) => {
    try {
      const files = await api("GET", `/api/disks/array/gone?q=${encodeURIComponent(q.value)}${look ? "&look=1" : ""}`);
      put(
        list,
        files.length
          ? files.map((f) =>
              h(
                "div",
                { class: "snapshot" },
                h("span", { class: "badge-icon plain" }, icon("file")),
                h("div", { class: "grow" }, h("strong", { class: "mono clip" }, f.path.split("/").pop()), h("div", { class: "muted small mono clip" }, `${f.folder}/${f.path}`)),
                button(t("array.goneBack"), {
                  class: "small primary",
                  onclick: async (e) => {
                    e.currentTarget.disabled = true;
                    error.textContent = "";
                    try {
                      setDisks(await api("POST", "/api/disks/array/fix-file", { disk: f.disk, path: f.path }));
                      dialog.close();
                      toast(t("array.goneStarted", { name: f.path.split("/").pop() }));
                    } catch (err) {
                      error.textContent = errorText(err);
                      e.target.closest("button").disabled = false;
                    }
                  },
                }),
              ),
            )
          : h("p", { class: "muted" }, t(q.value ? "array.goneNoMatch" : "array.goneNone")),
      );
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  q.addEventListener("input", () => (clearTimeout(timer), (timer = setTimeout(() => load(), 250))));
  put(list, h("p", { class: "with-icon muted" }, icon("refresh"), t("array.goneLooking")));
  dialog = openDialog("wide", h("header", null, h("div", { class: "grow" }, h("h2", null, t("array.goneTitle")), h("p", { class: "muted small" }, t("array.goneLead"))), closeX(() => dialog)), q, error, list);
  void load(true);
  q.focus();
}

function arrayOffDialog() {
  const wipe = h("input", { type: "checkbox" });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("array.offTitle")),
    h("p", { class: "muted" }, t("array.offLead")),
    h("label", { class: "check" }, wipe, h("span", null, h("strong", null, t("array.offWipe")), h("span", { class: "muted small block" }, t("array.offWipeHint")))),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("array.turnOff"), { class: "danger", onclick: () => arrayCall("DELETE", wipe.checked ? "?wipe=1" : "", undefined, () => dialog.close()) })),
  );
}

/** A disk that was replaced, or files that are gone from one: what the parity knows comes back */
function recoverDialog(disk) {
  if (!disk) return;
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("array.recoverTitle", { disk: disk.path })),
    h("p", { class: "muted" }, t("array.recoverLead")),
    h("p", { class: "muted small" }, t("array.recoverHow", { disk: disk.path })),
    h("p", { class: "banner small" }, t("array.recoverOwners")),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("array.recoverGo"), { class: "primary", onclick: () => arrayCall("POST", "/fix", { disk: disk.name }, () => dialog.close()) }, "undo")),
  );
}

const FILLS_COLOURS = 6;
// below this share a folder is one of "the smaller ones", unless it is among the first few
const FILLS_SMALL = 0.01;
const FILLS_ALWAYS = 6;

/** "in about 3 wk": days as days, weeks or months */
const aboutDays = (days) => (days < 14 ? t("time.days", { n: Math.max(days, 1) }) : days < 70 ? t("time.weeks", { n: Math.round(days / 7) }) : t("time.months", { n: Math.round(days / 30.44) }));

function fillsCard(fills, busy) {
  const used = fills.used;
  const apps = new Map((state.overview?.apps ?? []).map((app) => [app.name, app]));
  let parts = fills.parts.filter((part) => part.kind !== "mount");
  const small = parts.filter((part, i) => part.kind !== "rest" && i >= FILLS_ALWAYS && part.size / used < FILLS_SMALL);
  if (small.length > 1) {
    const week = small.some((part) => part.week != null) ? small.reduce((sum, part) => sum + (part.week ?? 0), 0) : null;
    parts = [...parts.filter((part) => !small.includes(part)), { kind: "small", path: "", name: "", size: small.reduce((sum, part) => sum + part.size, 0), week, n: small.length }];
  }
  // what the file system holds beside the data folder: the system, Docker's images, other folders
  const outside = fills.at && used - fills.size > Math.max(used * 0.02, 1024 ** 3) ? used - fills.size : 0;
  if (outside) parts.push({ kind: "outside", path: "", name: "", size: outside, week: null });
  parts.push(...fills.parts.filter((part) => part.kind === "mount"));

  const colour = (i, part) => (part.kind === "outside" || part.kind === "small" || part.kind === "rest" || i >= FILLS_COLOURS ? "c-rest" : "c" + i);
  const share = (size) => (size / fills.total) * 100;
  const bar = h(
    "div",
    { class: "fills-bar" },
    parts.map((part, i) => {
      if (part.kind === "mount") return null;
      const seg = h("i", { class: colour(i, part), title: `${partName(part)} · ${bytes(part.size)}` });
      seg.style.width = share(part.size) + "%";
      return seg;
    }),
  );
  function partName(part) {
    if (part.kind === "app") return apps.get(part.name)?.title ?? part.name;
    if (part.kind === "trash") return t("trash.title");
    if (part.kind === "rest") return t("fills.rest");
    if (part.kind === "small") return t("fills.small", { n: part.n });
    if (part.kind === "outside") return t("fills.outside");
    return part.name;
  }
  const trend = (part) => {
    if (part.kind === "mount") return h("span", { class: "muted" }, t("fills.mount"));
    if (part.week == null) return h("span", { class: "muted" }, "—");
    // a change too small to mean anything is "steady"
    if (Math.abs(part.week) < Math.max(part.size * 0.005, 50 * 1024 ** 2)) return h("span", { class: "muted" }, t("fills.steady"));
    return h("span", { class: part.week > 0 ? "" : "muted" }, t("fills.week", { size: (part.week > 0 ? "+" : "−") + bytes(Math.abs(part.week)) }));
  };
  const row = (part, i) => {
    const href = part.kind === "app" && apps.has(part.name) ? `#/apps/${part.name}` : part.kind === "trash" ? "#/trash" : part.path ? filesHash(part.path) : "";
    const name = partName(part);
    const percent = (part.size / used) * 100;
    return h(
      "tr",
      null,
      h(
        "td",
        null,
        h(
          "div",
          { class: "with-icon" },
          h("i", { class: "dot " + (part.kind === "mount" ? "c-rest" : colour(i, part)) }),
          h(
            "div",
            null,
            href ? h("a", { class: "strong", href }, name) : h("div", { class: "strong" }, name),
            part.kind === "outside" ? h("div", { class: "muted small" }, t("fills.outsideHint")) : part.path && h("div", { class: "muted small mono clip" }, part.path),
            // how much of it has not changed for long, and which apps keep files there
            part.old > 0 && part.old >= part.size * 0.05 && h("div", { class: "muted small" }, t("fills.oldHere", { size: bytes(part.old), days: fills.oldDays })),
            part.apps?.length > 0 && h("div", { class: "muted small fills-apps" }, t("fills.usedBy"), " ", part.apps.map((app, n) => [n > 0 && ", ", h("a", { href: `#/apps/${app}` }, apps.get(app)?.title ?? app)])),
          ),
        ),
      ),
      h("td", { class: "num" }, part.kind === "mount" ? "" : bytes(part.size)),
      h("td", { class: "num muted" }, part.kind === "mount" ? "" : percent < 1 ? "<1%" : Math.round(percent) + "%"),
      h("td", null, trend(part)),
    );
  };
  const measure = busy(t("fills.measuring"), { path: "/api/disks/fills" });
  // where the files nobody touched for long lie: a hint for when the disk fills
  const oldest = fills.parts.filter((part) => part.old > 0).sort((a, b) => b.old - a.old)[0];
  const advice = fills.at && fills.oldTotal >= Math.max(1024 ** 3, fills.size * 0.1) && h("p", { class: "banner small" }, t(oldest ? "fills.oldAll" : "fills.oldAllNowhere", { size: bytes(fills.oldTotal), days: fills.oldDays, folder: oldest ? partName(oldest) : "" }));
  const ageOf = (at) => Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
  const largest =
    fills.at &&
    fills.largest?.length > 0 &&
    h(
      "details",
      { class: "pad fills-largest" },
      h("summary", { class: "muted small" }, t("fills.largest")),
      h(
        "div",
        { class: "stack" },
        fills.largest.map((file) => {
          const name = file.path.split("/").pop();
          const folder = file.path.slice(0, file.path.length - name.length - 1) || "/";
          return h(
            "div",
            { class: "snapshot" },
            h("span", { class: "badge-icon plain" }, icon("file")),
            h("div", { class: "grow" }, h("a", { class: "strong clip", href: filesHash(folder), onclick: () => (filesUi.pick = name) }, name), h("div", { class: "muted small mono clip" }, folder)),
            h("div", { class: "num" }, h("div", { class: "strong" }, bytes(file.size)), h("div", { class: "muted small" }, ageOf(file.at) ? t("fills.changedAgo", { n: ageOf(file.at) }) : t("fills.changedToday"))),
          );
        }),
      ),
    );
  return h(
    "section",
    { class: "card table-wrap fills" },
    h(
      "div",
      { class: "pad card-head" },
      h(
        "div",
        { class: "section-head" },
        h("h2", null, t("fills.title", { path: fills.root }), h("span", { class: "muted" }, t("disks.usedOf", { used: bytes(used), total: bytes(fills.total) }))),
        h("div", { class: "row-actions" }, fills.fullIn != null && h("span", { class: "chip warn" }, t("fills.fullIn", { time: aboutDays(fills.fullIn) })), fills.at && !fills.running && h("span", { class: "muted small" }, t("fills.measured", { when: ago(fills.at) })), button(t(fills.running ? "fills.measuring" : fills.at ? "fills.again" : "fills.measure"), { class: "small", disabled: fills.running, onclick: measure }, "refresh")),
      ),
      h("p", { class: "muted small" }, t(fills.at ? "fills.lead" : "fills.never")),
      fills.at && bar,
      advice,
    ),
    fills.at && h("table", { class: "disks" }, h("thead", null, h("tr", null, h("th", null, t("fills.col.folder")), h("th", { class: "num" }, t("fills.col.size")), h("th", { class: "num" }, t("fills.col.share")), h("th", null, t("fills.col.week")))), h("tbody", null, parts.map(row))),
    largest,
  );
}
