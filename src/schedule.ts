/**
 * The page "What runs when": what Hata starts at a time of the person's (`Timed`) and what comes round on
 * its own (`Repeating`), gathered from the parts that keep them, with the clashes of `timetable.ts`. A
 * time is changed here by the same setters the pages of those parts use.
 */
import { record } from "./activity";
import { AppError } from "./apps";
import { lastBackupRun } from "./backup";
import { settings, updateSettings } from "./config";
import { imagesStatus } from "./images";
import { moduleOn } from "./moduleruns";
import { scheduledHosts, setSchedule } from "./proxmox";
import { packageUpdates } from "./sysupdates";
import { arrayReport, ArrayError, setArrayTime } from "./snapraid";
import { byClock, clashes, freeTime, nextAt, TIME_RE, type Clash, type Repeating, type Timed } from "./timetable";
import { updateStatus } from "./update";

const H = 3600_000;

export interface ScheduleView {
  timed: (Timed & { next: number | null; free: string | null })[];
  repeating: Repeating[];
  clashes: Clash[];
  timezone: string;
}

function timedNow(): Timed[] {
  const list: Timed[] = [];
  const last = lastBackupRun();
  list.push({ id: "backups", kind: "backups", time: settings.backup.time, on: settings.backup.enabled, last: last ? { at: last.at, ok: last.failed.length === 0 } : null, href: "#/backups/schedule", touches: ["apps", "disks"] });
  // a server Hata cannot replace itself on has no update by itself to schedule
  if (!updateStatus().unsupported) list.push({ id: "update", kind: "update", time: settings.update.time, on: settings.update.auto, href: "#/settings/about", touches: ["hata"] });
  list.push({ id: "images", kind: "images", time: settings.images.time, on: settings.images.check && settings.images.auto, href: "#/apps-options", touches: ["apps"] });
  if (moduleOn("raid") && settings.snapraid.parity && settings.snapraid.data.length) {
    const sync = arrayReport().lastSync;
    list.push({ id: "snapraid", kind: "snapraid", time: settings.snapraid.time, on: true, scrub: settings.snapraid.scrub, last: sync ? { at: sync.at, ok: sync.ok } : null, href: "#/storage/raid", touches: ["disks"] });
  }
  if (moduleOn("proxmox")) for (const h of scheduledHosts()) list.push({ id: `pve:${h.id}`, kind: "proxmox", name: h.name, time: h.schedule.time, on: h.schedule.on, last: h.last, href: `#/proxmox/${h.id}`, touches: ["elsewhere"] });
  return list;
}

export async function scheduleView(): Promise<ScheduleView> {
  const timed = timedNow();
  const now = new Date();
  const images = await imagesStatus().catch(() => null);
  const repeating: Repeating[] = [
    { id: "hataCheck", every: 12 * H, on: true, last: updateStatus().checkedAt || null, href: "#/settings/about" },
    { id: "imagesCheck", every: 24 * H, on: settings.images.check, last: images?.at ?? null, href: "#/apps-options" },
    { id: "packages", every: 24 * H, on: true, last: packageUpdates("").at || null, href: "#/machines/this/system" },
    { id: "stores", every: 12 * H, on: true, href: "#/store" },
    { id: "smart", every: 0.5 * H, on: true, href: "#/storage" },
    { id: "fills", every: 24 * H, on: true, href: "#/storage/fills" },
    { id: "trash", every: 6 * H, on: true, href: "#/trash" },
    ...(moduleOn("adblock") ? [{ id: "adblock", every: 24 * H, on: settings.dnsBlock.enabled, href: "#/network/adblock" }] : []),
    ...(settings.https.mode === "acme" ? [{ id: "certificates", every: H / 6, on: true, href: "#/network/addresses" }] : []),
  ];
  return {
    timed: byClock(timed).map((one) => ({ ...one, next: one.on ? nextAt(one, now) : null, free: null })).map((one, _, all) => ({ ...one, free: clashes(all).some((c) => c.id === one.id) ? freeTime(all, one.id) : null })),
    repeating,
    clashes: clashes(timed),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

/** Another time for one piece of work, through the setter of its own page */
export function moveTime(id: string, time: unknown, by: string): void {
  if (typeof time !== "string" || !TIME_RE.test(time)) throw new AppError("settings.badTime");
  const entry = timedNow().find((one) => one.id === id);
  if (!entry) throw new AppError("schedule.notFound", 404);
  if (entry.kind === "proxmox") {
    const host = scheduledHosts().find((h) => `pve:${h.id}` === id)!;
    setSchedule(host.id, { ...host.schedule, time }, by);
    return;
  }
  if (entry.kind === "snapraid") {
    try {
      setArrayTime(time, by);
    } catch (e) {
      if (e instanceof ArrayError) throw new AppError(e.code, 400, e.detail);
      throw e;
    }
    return;
  }
  const key = entry.kind === "backups" ? "backup" : entry.kind;
  const error = updateSettings({ [key]: { time } });
  if (error) throw new AppError(error);
  record("schedule.moved", { user: by, detail: `${id} ${time}` });
}
