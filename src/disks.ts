/**
 * Disks and their health.
 *
 * What is connected comes from `lsblk`, what is mounted from /proc/mounts, and what a disk says about
 * itself (SMART) from `smartctl` of smartmontools — when it is installed. Reading their output and
 * judging a disk (`verdict`) are pure functions; the rest keeps the latest reading of every disk and
 * refreshes it every half an hour without waking a disk that sleeps. The readings and how the
 * counters moved (`remember`) are kept in `disks.json`, by serial number, so they outlive a restart.
 *
 * Nothing here changes a disk: no formatting, no mounting. The one thing that can be started is the
 * disk's own self-test.
 */
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { NETWORK_FS, roomOf } from "./netroom";
import { join } from "node:path";
import { DATA_DIR, DEFAULT_SMART, settings, type SmartLimits } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { installCommand, installPackage, PATH, run } from "./packages";

// ---- what is connected (lsblk) ----

export interface Volume {
  name: string;
  path: string;
  /** lsblk's type: part, lvm, crypt, raid1… or "disk" for a file system on the whole disk */
  kind: string;
  size: number;
  fstype: string;
  label: string;
  /** The file system's own id — what /etc/fstab names it by */
  uuid: string;
  mounts: string[];
  /** In use as swap space */
  swap: boolean;
  /** Size and use of the file system, when it is mounted */
  total: number | null;
  used: number | null;
}

export interface Disk {
  name: string;
  path: string;
  model: string;
  serial: string;
  size: number;
  /** sata, nvme, usb, virtio…; empty when the kernel does not say */
  transport: string;
  rotational: boolean;
  removable: boolean;
  readOnly: boolean;
  volumes: Volume[];
}

type Row = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
// older versions of lsblk print numbers and flags as strings
const flag = (v: unknown): boolean => v === true || v === 1 || v === "1";
const amount = (v: unknown): number | null => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** Where programs mount a disk again for themselves (Docker, Incus's pools and devices): not a place of the person's */
const PROGRAMS = /^\/(snap|var\/lib\/(docker|containers|incus))(\/|$)/;

function mountsOf(row: Row): string[] {
  const list = Array.isArray(row.mountpoints) ? row.mountpoints : [row.mountpoint];
  return [...new Set(list.map(text).filter((m) => m.startsWith("/") && !PROGRAMS.test(m)))];
}

function volume(row: Row, kind: string): Volume {
  const places = Array.isArray(row.mountpoints) ? row.mountpoints : [row.mountpoint];
  return { name: text(row.name), path: text(row.path) || "/dev/" + text(row.name), kind, size: amount(row.size) ?? 0, fstype: text(row.fstype), label: text(row.label), uuid: text(row.uuid), mounts: mountsOf(row), swap: places.some((m) => text(m) === "[SWAP]"), total: amount(row.fssize), used: amount(row.fsused) };
}

/** `lsblk -J -b` into disks; partitions and what is stacked on them (LVM, LUKS, RAID) become one flat list */
export function parseLsblk(json: unknown): Disk[] {
  const rows = (json as { blockdevices?: Row[] } | null)?.blockdevices;
  if (!Array.isArray(rows)) return [];
  const disks: Disk[] = [];
  for (const row of rows) {
    const name = text(row.name);
    // compressed memory and network block devices are disks only by type
    if (text(row.type) !== "disk" || !amount(row.size) || /^(zram|ram|nbd|loop)/.test(name)) continue;
    const volumes: Volume[] = [];
    const seen = new Set<string>();
    const walk = (children: unknown) => {
      for (const child of Array.isArray(children) ? (children as Row[]) : []) {
        const v = volume(child, text(child.type) || "part");
        if (!seen.has(v.path)) volumes.push(v);
        seen.add(v.path);
        walk(child.children);
      }
    };
    if (text(row.fstype) && !Array.isArray(row.children)) volumes.push(volume(row, "disk"));
    walk(row.children);
    disks.push({
      name,
      path: text(row.path) || "/dev/" + name,
      model: text(row.model),
      serial: text(row.serial),
      size: amount(row.size) ?? 0,
      transport: text(row.tran),
      rotational: flag(row.rota),
      removable: flag(row.rm) || flag(row.hotplug),
      readOnly: flag(row.ro),
      volumes,
    });
  }
  return disks;
}

// ---- what is mounted (/proc/mounts) ----

export interface Mount {
  device: string;
  path: string;
  fstype: string;
  readOnly: boolean;
  /** Lives on another machine: NFS, SMB, SSHFS… */
  network: boolean;
}

const LOCAL_FS = /^(ext[234]|xfs|btrfs|zfs|vfat|exfat|ntfs3?|fuseblk|f2fs|jfs|reiserfs|bcachefs|virtiofs|fuse\.mergerfs)$/;
const unescapeMount = (s: string) => s.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

/**
 * The file systems that hold files: no /proc, tmpfs or container layers, no boot partitions. A file
 * system mounted at several places (bind mounts, subvolumes) is listed once, at the first of them.
 */
export function parseMounts(mounts: string): Mount[] {
  const out: Mount[] = [];
  const seen = new Set<string>();
  for (const line of mounts.split("\n")) {
    const [device, rawPath, fstype, options] = line.split(" ");
    if (!device || !rawPath || !fstype) continue;
    const network = NETWORK_FS.test(fstype);
    if (!network && !LOCAL_FS.test(fstype)) continue;
    const path = unescapeMount(rawPath);
    if (/^\/(boot|run)(\/|$)/.test(path) || PROGRAMS.test(path)) continue;
    const key = unescapeMount(device);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ device: key, path, fstype: fstype.replace(/^fuse\./, ""), readOnly: (options ?? "").split(",").includes("ro"), network });
  }
  return out;
}

// ---- what a disk says about itself (smartctl) ----

export interface SelfTest {
  /** "short", "long" or what the disk calls it */
  type: string;
  passed: boolean;
  /** Power-on hours of the disk when the test ran */
  hours: number | null;
}

export interface Smart {
  /** The disk's own overall verdict; null when it gives none */
  passed: boolean | null;
  temperature: number | null;
  powerOnHours: number | null;
  powerCycles: number | null;
  /** Sectors moved to the spare area, sectors waiting to be moved, sectors that could not be read */
  reallocated: number | null;
  pending: number | null;
  uncorrectable: number | null;
  /** Errors on the way between the disk and the board — a cable, not the disk */
  crc: number | null;
  /** NVMe: data the drive could not give back */
  mediaErrors: number | null;
  /** Share of the rated life used up, percent (SSD and NVMe) */
  wear: number | null;
  /** NVMe: spare blocks left and the level the drive itself calls too low, percent */
  spare: { left: number; threshold: number } | null;
  /** NVMe: the drive raised one of its critical flags */
  critical: boolean;
  lastTest: SelfTest | null;
  /** A self-test is running: percent still to go */
  testing: number | null;
}

type Json = Record<string, any>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// attributes whose normalised value is the life left, under the names smartctl's drive database gives them
const LIFE_LEFT = /^(SSD_Life_Left|Media_Wearout_Indicator|Wear_Leveling_Count|Percent_Lifetime_Remain|Remaining_Lifetime_Perc|Percent_Life_Remaining|Drive_Life_Remaining|Lifetime_Remaining)/;

const testType = (name: string): string => (/short/i.test(name) ? "short" : /extended|long/i.test(name) ? "long" : name);

/** `smartctl -j -a` into what Hata shows; null when the output holds no SMART data (a virtual disk, an unknown USB bridge) */
export function parseSmart(json: unknown): Smart | null {
  const j = json as Json | null;
  if (!j || typeof j !== "object") return null;
  const nvme = j.nvme_smart_health_information_log as Json | undefined;
  const table: Json[] = Array.isArray(j.ata_smart_attributes?.table) ? j.ata_smart_attributes.table : [];
  if (!nvme && !table.length && typeof j.smart_status?.passed !== "boolean") return null;

  const attribute = (id: number): number | null => num(table.find((a) => a.id === id)?.raw?.value);
  const smart: Smart = {
    passed: typeof j.smart_status?.passed === "boolean" ? j.smart_status.passed : null,
    temperature: num(j.temperature?.current),
    powerOnHours: num(j.power_on_time?.hours),
    powerCycles: num(j.power_cycle_count),
    reallocated: attribute(5),
    pending: attribute(197),
    uncorrectable: attribute(198),
    crc: attribute(199),
    mediaErrors: null,
    wear: num(j.endurance_used?.current_percent),
    spare: null,
    critical: false,
    lastTest: null,
    testing: null,
  };

  if (nvme) {
    smart.mediaErrors = num(nvme.media_errors);
    smart.wear = num(nvme.percentage_used);
    smart.critical = (num(nvme.critical_warning) ?? 0) !== 0;
    const left = num(nvme.available_spare);
    if (left !== null) smart.spare = { left, threshold: num(nvme.available_spare_threshold) ?? 0 };
    smart.temperature ??= num(nvme.temperature);
    smart.powerOnHours ??= num(nvme.power_on_hours);
    smart.powerCycles ??= num(nvme.power_cycles);
    const last = j.nvme_self_test_log?.table?.[0] as Json | undefined;
    if (last) smart.lastTest = { type: testType(String(last.self_test_code?.string ?? "")), passed: last.self_test_result?.value === 0, hours: num(last.power_on_hours) };
    if ((num(j.nvme_self_test_log?.current_self_test_operation?.value) ?? 0) !== 0) smart.testing = 100 - (num(j.nvme_self_test_log?.current_self_test_completion_percent) ?? 0);
  } else {
    if (smart.wear === null && j.rotation_rate === 0) {
      const life = table.find((a) => LIFE_LEFT.test(String(a.name)));
      const left = num(life?.value);
      if (left !== null && left <= 100) smart.wear = 100 - left;
    }
    const last = j.ata_smart_self_test_log?.standard?.table?.[0] as Json | undefined;
    // an entry "in progress" or "aborted by host" is not an outcome
    if (last && typeof last.status?.passed === "boolean" && !("remaining_percent" in last.status && last.status.remaining_percent > 0)) {
      smart.lastTest = { type: testType(String(last.type?.string ?? "")), passed: last.status.passed, hours: num(last.lifetime_hours) };
    }
    const running = j.ata_smart_data?.self_test?.status as Json | undefined;
    if (running && num(running.remaining_percent) !== null && (num(running.value) ?? 0) >> 4 === 15) smart.testing = running.remaining_percent;
  }
  return smart;
}

export type Health = "ok" | "warn" | "danger" | "unknown";

export interface Finding {
  code: "failing" | "critical" | "spare" | "test" | "reallocated" | "pending" | "uncorrectable" | "media" | "worn" | "hot";
  severity: "warn" | "danger";
  /** The number behind it: sectors, errors, percent, degrees */
  n?: number;
}

/**
 * What is wrong with a disk, worst first. Any moved, waiting or unreadable sector counts: on disks that
 * went on to fail these counters were the ones that had left zero.
 */
export function verdict(smart: Smart, rotational: boolean, limits: SmartLimits = DEFAULT_SMART): Finding[] {
  const out: Finding[] = [];
  if (smart.passed === false) out.push({ code: "failing", severity: "danger" });
  if (smart.critical) out.push({ code: "critical", severity: "danger" });
  if (smart.spare && smart.spare.left < smart.spare.threshold) out.push({ code: "spare", severity: "danger", n: smart.spare.left });
  if (smart.lastTest && !smart.lastTest.passed) out.push({ code: "test", severity: "danger" });
  if (smart.reallocated) out.push({ code: "reallocated", severity: "warn", n: smart.reallocated });
  if (smart.pending) out.push({ code: "pending", severity: "warn", n: smart.pending });
  if (smart.uncorrectable) out.push({ code: "uncorrectable", severity: "warn", n: smart.uncorrectable });
  if (smart.mediaErrors) out.push({ code: "media", severity: "warn", n: smart.mediaErrors });
  if (smart.wear !== null && smart.wear >= limits.wear) out.push({ code: "worn", severity: "warn", n: smart.wear });
  if (smart.temperature !== null && smart.temperature >= (rotational ? limits.hotHdd : limits.hotFlash)) out.push({ code: "hot", severity: "warn", n: smart.temperature });
  return out;
}

export const healthOf = (findings: Finding[] | null): Health => (!findings ? "unknown" : findings.some((f) => f.severity === "danger") ? "danger" : findings.length ? "warn" : "ok");

/** The name a person knows a disk by: its model, or the device when it has none */
export const diskLabel = (disk: Pick<Disk, "model" | "name">): string => disk.model || disk.name;

// ---- how the counters moved ----

/** The counters worth a history: they stand still on a healthy disk */
export type Counter = "reallocated" | "pending" | "uncorrectable" | "mediaErrors" | "crc";
const COUNTERS: Counter[] = ["reallocated", "pending", "uncorrectable", "mediaErrors", "crc"];

export interface Change {
  at: number;
  value: number;
}

/** What is kept about a disk between readings */
export interface DiskRecord {
  smart: Smart | null;
  at: number;
  /** Per counter: its value when first seen and at every change since, oldest first */
  log: Partial<Record<Counter, Change[]>>;
  /** When a counter last grew — the news of the "needs attention" item */
  grew?: number;
  hottest?: Change;
}

const LOG_KEEPS = 40;
const DAY_MS = 24 * 3600_000;

/**
 * A new reading added to what is known about a disk. A growing counter is news, but at most once a
 * day: a dying disk moves its counters with every reading. Connection errors are a cable — logged, no news.
 */
export function remember(old: DiskRecord | undefined, smart: Smart | null, now: number): DiskRecord {
  const record: DiskRecord = { smart, at: now, log: { ...old?.log }, ...(old?.grew ? { grew: old.grew } : {}), ...(old?.hottest ? { hottest: old.hottest } : {}) };
  if (!smart) return record;
  for (const counter of COUNTERS) {
    const value = smart[counter];
    if (value === null) continue;
    const log = record.log[counter] ?? [];
    const last = log.at(-1);
    if (last && last.value === value) continue;
    if (last && value > last.value && counter !== "crc" && (!record.grew || now - record.grew >= DAY_MS)) record.grew = now;
    // the first entry says what the disk came with, so it stays
    record.log[counter] = [...log.slice(0, 1), ...log.slice(1).slice(-(LOG_KEEPS - 2)), { at: now, value }];
  }
  if (smart.temperature !== null && (!record.hottest || smart.temperature > record.hottest.value)) record.hottest = { at: now, value: smart.temperature };
  return record;
}

// ---- the running part ----

export interface DiskReport extends Disk {
  smart: Smart | null;
  health: Health;
  findings: Finding[];
  /** When SMART was last read */
  checkedAt: number | null;
  log: Partial<Record<Counter, Change[]>>;
  grew: number | null;
  hottest: Change | null;
}

export interface MountReport extends Mount {
  total: number;
  used: number;
  /** The disk it lies on, when it is one of the listed ones */
  disk: string;
}

/** ok — SMART can be read; missing — smartmontools is not installed; denied — the server may not open the disks */
export type ToolState = "ok" | "missing" | "denied";

const CHECK_EVERY_MS = 30 * 60_000;
const TEST_POLL_MS = 60_000;
const PACKAGE = "smartmontools";

const FILE = join(DATA_DIR, "disks.json");
// a disk that was not seen for this long is forgotten
const FORGET_MS = 400 * DAY_MS;
/** By serial number, so a disk keeps its history when its letter changes; by name when it has none */
const records = readJsonFile<Record<string, DiskRecord>>(FILE, {}, isPlainObject);
const idOf = (disk: Pick<Disk, "serial" | "name">): string => disk.serial || disk.name;
let known: Disk[] = [];
let tool: ToolState = "ok";

const COLUMNS = "NAME,PATH,TYPE,SIZE,MODEL,SERIAL,TRAN,ROTA,RM,HOTPLUG,RO,FSTYPE,LABEL,UUID,FSSIZE,FSUSED";

/** The disks as they are this very moment */
export async function connected(): Promise<Disk[]> {
  // MOUNTPOINTS (every place a file system is mounted at) came with util-linux 2.37
  for (const mounts of ["MOUNTPOINTS", "MOUNTPOINT"]) {
    const result = await run(["lsblk", "-J", "-b", "-o", `${COLUMNS},${mounts}`], 10_000);
    if (result.code !== 0) continue;
    try {
      return parseLsblk(JSON.parse(result.out));
    } catch {}
  }
  return [];
}

const smartctl = (): string | null => Bun.which("smartctl", { PATH });

/** In a container the host's disks are listed, but their devices are not there to be opened */
const outOfReach = (disks: Disk[]): boolean => disks.length > 0 && !disks.some((d) => existsSync(d.path));

type Outcome = { smart: Smart | null } | "asleep" | "denied";

async function readSmart(bin: string, disk: Disk, wake: boolean): Promise<Outcome> {
  // `-n standby`: a disk that has spun down is left alone, and smartctl says so instead of reading it
  const base = [bin, "-j", "-a", ...(wake ? [] : ["-n", "standby"])];
  let last: Outcome = { smart: null };
  // a USB case smartctl does not know by name usually still passes ATA commands through
  for (const type of [[], ["-d", "sat"]]) {
    const result = await run([...base, ...type, disk.path]);
    let json: Json | null = null;
    try {
      json = JSON.parse(result.out);
    } catch {}
    const said = [result.err, ...((json?.smartctl?.messages as Json[] | undefined) ?? []).map((m) => String(m.string))].join("\n");
    if (/permission denied|operation not permitted|no such device|no such file/i.test(said)) return "denied";
    if (/STANDBY|SLEEP/.test(said) && !json?.smart_status) return "asleep";
    const smart = parseSmart(json);
    if (smart) return { smart };
    last = { smart: null };
    if (disk.transport !== "usb") break;
  }
  return last;
}

let queue: Promise<void> = Promise.resolve();

async function check(wake: boolean, only?: (disk: Disk) => boolean): Promise<void> {
  known = await connected();
  if (outOfReach(known)) {
    tool = "denied";
    return;
  }
  const bin = smartctl();
  if (!bin) {
    tool = "missing";
    return;
  }
  let denied = false;
  for (const disk of known) {
    if (only && !only(disk)) continue;
    const outcome = await readSmart(bin, disk, wake);
    if (outcome === "denied") denied = true;
    // a sleeping disk keeps what it said when it was last awake
    else if (outcome !== "asleep") records[idOf(disk)] = remember(records[idOf(disk)], outcome.smart, Date.now());
  }
  for (const [id, record] of Object.entries(records)) if (Date.now() - record.at > FORGET_MS && !known.some((d) => idOf(d) === id)) delete records[id];
  try {
    writeJsonAtomic(FILE, records);
  } catch (e) {
    console.error("Could not save the disks' readings:", e instanceof Error ? e.message : e);
  }
  tool = denied ? "denied" : "ok";
}

/** Reads SMART of every disk, one check at a time. `wake` also asks the disks that sleep — only when a person asked for it */
export function checkDisks(wake = false, only?: (disk: Disk) => boolean): Promise<void> {
  queue = queue.then(() => check(wake, only)).catch((e) => console.error("Could not check the disks:", e instanceof Error ? e.message : e));
  return queue;
}

function usage(path: string): { total: number; used: number } | null {
  try {
    const s = statfsSync(path);
    const total = s.blocks * s.bsize;
    return total > 0 ? { total, used: total - s.bavail * s.bsize } : null;
  } catch {
    return null;
  }
}

const report = (disk: Disk): DiskReport => {
  const reading = records[idOf(disk)];
  const findings = reading?.smart ? verdict(reading.smart, disk.rotational, settings.storage.smart) : null;
  return { ...disk, smart: reading?.smart ?? null, health: healthOf(findings), findings: findings ?? [], checkedAt: reading?.at ?? null, log: reading?.log ?? {}, grew: reading?.grew ?? null, hottest: reading?.hottest ?? null };
};

/** The disks as last seen, with their health — for the "needs attention" list */
export const diskHealth = (): DiskReport[] => known.map(report);

export async function listDisks(): Promise<{ disks: DiskReport[]; mounts: MountReport[]; tool: ToolState; install: string; limits: SmartLimits }> {
  // what is plugged in and mounted is cheap to ask and changes under our feet; SMART is the cached part
  const now = await connected();
  if (now.length || !known.length) known = now;
  // smartmontools installed behind our back: read the disks without waiting for the next round
  if (tool === "missing" && smartctl()) void checkDisks();
  let mounted = "";
  try {
    mounted = readFileSync("/proc/mounts", "utf8");
  } catch {}
  const mounts: MountReport[] = [];
  for (const mount of parseMounts(mounted)) {
    // a network file system is measured apart: a server that does not answer would block statfs
    const room = mount.network ? roomOf(mount.path) : null;
    const size = mount.network ? room && { total: room.total, used: room.total - room.free } : usage(mount.path);
    if (!size) continue;
    const disk = known.find((d) => d.path === mount.device || d.volumes.some((v) => v.path === mount.device || v.mounts.includes(mount.path)));
    mounts.push({ ...mount, ...size, disk: disk?.name ?? "" });
  }
  // the same count as everywhere else in Hata: used is what is not free to an ordinary program
  const disks = known.map(report).map((disk) => ({ ...disk, volumes: disk.volumes.map((v) => ({ ...v, ...((v.mounts[0] && usage(v.mounts[0])) || {}) })) }));
  const state: ToolState = outOfReach(known) ? "denied" : smartctl() ? (tool === "missing" ? "ok" : tool) : "missing";
  return { disks, mounts, tool: state, install: state === "missing" ? installCommand(PACKAGE) : "", limits: settings.storage.smart };
}

/** Starts the disk's own self-test; the outcome shows up in its SMART data when it is done */
export async function startSelfTest(name: string, type: "short" | "long"): Promise<string | null> {
  const disk = known.find((d) => d.name === name);
  if (!disk) return "disk.unknown";
  const bin = smartctl();
  if (!bin) return "disk.noTool";
  if (!records[idOf(disk)]?.smart) return "disk.noSmart";
  let result = await run([bin, "-t", type, disk.path]);
  if (result.code !== 0 && disk.transport === "usb") result = await run([bin, "-d", "sat", "-t", type, disk.path]);
  if (result.code !== 0) return "disk.testFailed";
  await checkDisks(true, (d) => d.name === name);
  return null;
}

/**
 * Installs smartmontools with the system's package manager; returns what went wrong, or null.
 * Only ever called for the button: Hata installs nothing on its own.
 */
export async function installTool(): Promise<string | null> {
  if (!smartctl()) {
    const failed = await installPackage(PACKAGE);
    if (failed || !smartctl()) return failed ?? `${PACKAGE} is installed, but smartctl is not there`;
  }
  await checkDisks(true);
  return null;
}

/** Reads the disks now and every half an hour; while a self-test runs, that disk is looked at every minute */
export function startDisks(): void {
  void checkDisks();
  setInterval(() => void checkDisks(), CHECK_EVERY_MS);
  setInterval(() => {
    const testing = (disk: Disk) => records[idOf(disk)]?.smart?.testing != null;
    if (known.some(testing)) void checkDisks(true, testing);
  }, TEST_POLL_MS);
}
