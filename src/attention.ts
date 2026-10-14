/**
 * "Needs attention": the short list of things on the home page that are wrong or about to be.
 * A pure function of the server's state, so every rule is covered by tests.
 */
import type { Activity } from "./activity";
import type { InstalledApp } from "./apps";
import { diskLabel, type DiskReport } from "./disks";
import type { DockerInfo } from "./docker";
import type { Trouble } from "./network";
import type { SystemStatus } from "./system";

export interface AttentionItem {
  /** Stable key of the item, for the UI's list */
  id: string;
  severity: "danger" | "warn";
  /** The UI shows `attention.<code>.title` and `.text` */
  code: string;
  detail: Record<string, string | number>;
  /** App the item is about — the UI links to its page */
  app?: string;
  /** When it happened, for an item about an event (a failed backup) rather than a state (a full disk) */
  at?: number;
}

const DISK_WARN = 85;
const DISK_DANGER = 95;
/** A disk that fills up within this many days at the pace of the last month is worth a word */
const FILLING_DAYS = 30;
const MEMORY_WARN = 92;
const TEMPERATURE_WARN = 85;
const FAILURE_WINDOW_MS = 24 * 3600 * 1000;
/** A trash smaller than this is not worth a word when its disk fills up, bytes */
const TRASH_WORTH = 100 * 1024 * 1024;

export function attention(input: { system: SystemStatus; docker: DockerInfo; apps: InstalledApp[]; activity: Activity[]; update?: string | null; offsite?: { error: string } | null; disks?: DiskReport[]; trash?: (path: string) => number; absent?: { path: string; holds: string | null }[]; internet?: Trouble[]; exposed?: { nic: string; address: string }[]; array?: { code: string; detail: Record<string, string | number> }[]; shares?: { code: string; detail: Record<string, string> }[]; unused?: { id: string; title: string; size: number; carries: boolean }[]; filling?: { path: string; days: number; percent: number } | null; now?: number }): AttentionItem[] {
  const { system, docker, apps, activity } = input;
  const now = input.now ?? Date.now();
  const items: AttentionItem[] = [];

  // not installed and not running are said as what they are: each has a button that puts it right
  if (!docker.available) items.push({ id: "docker", severity: "danger", code: docker.state === "missing" ? "docker.missing" : docker.state === "stopped" ? "docker.stopped" : "docker", detail: { message: docker.error ?? "" } });

  for (const app of apps) {
    const restarting = app.containers.filter((c) => c.state === "restarting");
    if (restarting.length) {
      items.push({ id: `restarting:${app.name}`, severity: "danger", code: "restarting", detail: { title: app.title, container: restarting[0]!.name }, app: app.name });
    } else if (app.status === "partial") {
      const down = app.containers.filter((c) => c.state !== "running");
      items.push({ id: `partial:${app.name}`, severity: "warn", code: "partial", detail: { title: app.title, container: down[0]?.name ?? "" }, app: app.name });
    }
  }

  // The latest outcome decides: a failure followed by a success is history, not a problem. Running the
  // app and backing it up are judged apart — a good start says nothing about a failed backup.
  const latest = new Map<string, Activity>();
  for (const entry of activity) {
    const m = /^app\.(install|update|apply|start|backup|restore)\.(done|failed)$/.exec(entry.code);
    if (!entry.app || !m) continue;
    const key = `${m[1] === "backup" ? "backup" : "run"}:${entry.app}`;
    if (!latest.has(key)) latest.set(key, entry);
  }
  for (const [key, entry] of latest) {
    if (!entry.code.endsWith(".failed") || now - entry.ts > FAILURE_WINDOW_MS) continue;
    const name = entry.app!;
    const app = apps.find((a) => a.name === name);
    const kind = entry.code.split(".")[1]!;
    // a failed install leaves no app behind, so there is nothing to link to
    if (!app && kind !== "install") continue;
    items.push({ id: `failed:${key}`, severity: "warn", code: `failed.${kind}`, detail: { title: app?.title ?? name, message: entry.detail ?? "" }, app: app?.name, at: entry.ts });
  }

  for (const disk of system.disks) {
    const percent = Math.round((disk.used / disk.total) * 100);
    if (percent >= DISK_WARN) {
      // what lies in the trash of this very disk is room to be had at once (`trash` is asked only now: it reads the disk)
      const trash = input.trash?.(disk.path) ?? 0;
      items.push({ id: `disk:${disk.path}`, severity: percent >= DISK_DANGER ? "danger" : "warn", code: trash >= TRASH_WORTH ? "disk.trash" : "disk", detail: { path: disk.path, percent, free: disk.total - disk.used, ...(trash >= TRASH_WORTH ? { trash } : {}) } });
    }
  }

  // not full yet, but on the way: said a month ahead, until the disk is full enough to be said as that
  const filling = input.filling;
  if (filling && filling.days <= FILLING_DAYS && filling.percent < DISK_WARN) items.push({ id: `filling:${filling.path}`, severity: "warn", code: "disk.filling", detail: { path: filling.path, days: Math.max(1, filling.days), percent: filling.percent } });

  // a disk that says it is in trouble: one line per disk, about the worst thing it reports
  for (const disk of input.disks ?? []) {
    const worst = disk.findings.find((f) => f.severity === "danger") ?? disk.findings[0];
    // a counter that grew since is news again (`at`), also when the worst thing about the disk stays the same
    if (worst) items.push({ id: `smart:${disk.serial || disk.name}`, severity: worst.severity, code: `smart.${worst.code}`, detail: { disk: diskLabel(disk), n: worst.n ?? 0 }, ...(disk.grew ? { at: disk.grew } : {}) });
  }

  // a disk Hata connected for good is not there: with the data folder on it, apps cannot start
  for (const folder of input.absent ?? []) {
    items.push({ id: `absent:${folder.path}`, severity: folder.holds === "data" ? "danger" : "warn", code: folder.holds === "data" ? "absent.data" : "absent", detail: { path: folder.path } });
  }

  // an address the whole internet reaches, on an interface still treated as the home network
  for (const nic of input.exposed ?? []) items.push({ id: `exposed:${nic.nic}`, severity: "warn", code: "network.exposed", detail: { nic: nic.nic, address: nic.address } });
  // a way to the internet that does not reach it: the server cut off, living on its spare way, or without one
  for (const way of input.internet ?? []) {
    items.push({ id: way.code === "none" ? "internet" : `internet:${way.nic}`, severity: way.code === "none" ? "danger" : "warn", code: `internet.${way.code}`, detail: { nic: way.label, other: way.other } });
  }

  // the protection from a disk failure: damage found, a disk that came up empty, a sync that waits or failed
  for (const item of input.array ?? []) {
    items.push({ id: `array.${item.code}`, severity: item.code === "held" || item.code === "failed" ? "warn" : "danger", code: `array.${item.code}`, detail: item.detail });
  }

  // shared folders that cannot be opened from the other computers
  for (const item of input.shares ?? []) {
    items.push({ id: item.code === "missing" ? `share:${item.detail.name}` : `shares.${item.code}`, severity: "warn", code: `share.${item.code}`, detail: item.detail });
  }

  // a disk nothing uses yet: a new one to put to use, or a USB stick with files to copy from
  for (const disk of input.unused ?? []) {
    items.push({ id: `newdisk:${disk.id}`, severity: "warn", code: disk.carries ? "disk.usb" : "disk.new", detail: { disk: disk.title, size: disk.size, id: disk.id } });
  }

  const memory = system.memory.total ? Math.round((system.memory.used / system.memory.total) * 100) : 0;
  if (memory >= MEMORY_WARN) items.push({ id: "memory", severity: "warn", code: "memory", detail: { percent: memory } });
  if (system.temperature !== null && system.temperature >= TEMPERATURE_WARN) {
    items.push({ id: "temperature", severity: "warn", code: "temperature", detail: { degrees: system.temperature } });
  }

  // the second copy of the backups is behind: it stays on the list until a run gets through
  if (input.offsite) items.push({ id: "offsite", severity: "warn", code: "offsite", detail: { message: input.offsite.error } });

  if (input.update) items.push({ id: "update", severity: "warn", code: "update", detail: { version: input.update } });

  return items.sort((a, b) => Number(b.severity === "danger") - Number(a.severity === "danger"));
}
