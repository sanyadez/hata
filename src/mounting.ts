/**
 * Putting a disk to use: preparing a new one, connecting one that already holds files, taking one out.
 *
 * - **Format** erases a whole disk (a new partition table with one partition) or one partition of it
 *   and makes a file system there: ext4 for a disk that stays — mounted under /mnt and written to
 *   /etc/fstab by UUID with `nofail`, so the server starts without the disk too — or exFAT, FAT32,
 *   NTFS for one that goes to other devices. A folder Hata connected is disconnected for it.
 * - **Check** looks a file system over and mends it; **rename** gives it another label.
 * - **Connect** mounts a file system as it is, without changing it — kept in /etc/fstab, or until the
 *   disk is unplugged (a USB disk).
 * - **Disconnect** unmounts what Hata itself connected and takes its line out of /etc/fstab; a
 *   removable disk is also powered down, safe to pull out.
 * - A USB disk plugged in is connected by itself when the setting is on.
 * - **Merge** shows several connected disks as one folder (mergerfs): a new file goes to the disk with
 *   the most free room, the files stay plain files on their own disks, and there is no second copy.
 *
 * Which disks may never be touched (`blockers`), the lines of /etc/fstab and the mount options are pure
 * functions. Hata's lines in /etc/fstab carry a comment above them; no other line is ever changed.
 */
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { record } from "./activity";
import { bus } from "./bus";
import { DATA_DIR, SECRETS_DIR, saveSettings, settings } from "./config";
import { connected, diskLabel, type Disk, type Volume } from "./disks";
import { parseBtrfsShow } from "./raid";
import { CHECKERS, checkCommand, checkVerdict, cleanLabel, familyOf, FAT_MAX, FORMATS, FS_NAMES, isFs, isPosix, labelCommand, LABELLERS, labelsInUse, mendable, fsResizeCommand, mkfsCommand, nested, parseSfdisk, partLine, PART_MIN, partType, passProgress, MIB, RESIZE, resizeScript, roomFor, TABLE_ROOM, tableFor, tableScript, unallocated, type Fs, type Table, type Verdict } from "./format";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { installCommand, packageManager, PATH, run, runLogged } from "./packages";

// ---- which disks may be touched ----

/**
 * Why a disk may not be erased: system — the system runs from it; mounted — one of its file systems
 * is in use; swap; member — part of an array, a volume group or an encrypted volume; readonly.
 */
export type Blocker = "system" | "mounted" | "swap" | "member" | "readonly";

const SYSTEM_MOUNT = /^\/($|boot(\/|$)|usr(\/|$)|var(\/|$)|etc(\/|$)|home$)/;
const MEMBER_FS = /^(LVM2_member|linux_raid_member|crypto_LUKS|zfs_member|bcache|ddf_raid_member|isw_raid_member|ceph_bluestore)$/;

export function blockers(disk: Disk): Blocker[] {
  const out = new Set<Blocker>();
  const mounts = disk.volumes.flatMap((v) => v.mounts);
  if (mounts.some((m) => SYSTEM_MOUNT.test(m))) out.add("system");
  else if (mounts.length) out.add("mounted");
  if (disk.volumes.some((v) => v.swap)) out.add("swap");
  // what is stacked on a partition (LVM, LUKS, RAID) has a type of its own
  if (disk.volumes.some((v) => (v.kind !== "part" && v.kind !== "disk") || MEMBER_FS.test(v.fstype))) out.add("member");
  if (disk.readOnly) out.add("readonly");
  return [...out];
}

const POSIX_FS = /^(ext[234]|xfs|btrfs|f2fs)$/;
const FOREIGN_FS = /^(vfat|exfat|ntfs)$/;

/** A file system Hata can connect as it is: one it knows, not in use, not a piece of something larger */
export const mountable = (volume: Volume): boolean => (volume.kind === "part" || volume.kind === "disk") && (POSIX_FS.test(volume.fstype) || FOREIGN_FS.test(volume.fstype)) && !volume.mounts.length && !volume.swap;

/**
 * What of a disk Hata may change: `whole` — format it whole; `volumes` — the file systems that may be
 * formatted, checked or renamed one by one. A mounted one counts only when Hata itself connected it
 * (`ours` — those folders): it is disconnected for the work.
 */
export function changeable(disk: Disk, ours: string[]): { whole: boolean; volumes: string[] } {
  if (blockers(disk).some((b) => b !== "mounted")) return { whole: false, volumes: [] };
  const free = (v: Volume) => v.mounts.every((m) => ours.includes(m));
  return { whole: disk.volumes.every(free), volumes: disk.volumes.filter(free).map((v) => v.path) };
}

/** The name of a mount under /mnt */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** A name for a disk nobody named: from its label, or its model */
export function suggestName(text: string, fallback = "disk"): string {
  const name = text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[-._]+$/g, "")
    .slice(0, 24)
    .replace(/[-._]+$/, "");
  return name || fallback;
}

// ---- /etc/fstab ----

export interface FstabEntry {
  /** What is mounted: `UUID=…`, a device, a network address */
  spec: string;
  path: string;
  fstype: string;
  options: string;
  /** A line Hata wrote */
  ours: boolean;
}

const MARK = "# Hata:";
const MARK_LINE = `${MARK} connected by Hata (Settings, Storage). Disconnect it there, or delete this line and the next one.`;
const unescapeField = (s: string) => s.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
const escapeField = (s: string) => s.replace(/[\s\\]/g, (c) => "\\" + c.charCodeAt(0).toString(8).padStart(3, "0"));

export function parseFstab(text: string): FstabEntry[] {
  const out: FstabEntry[] = [];
  let marked = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || !line) {
      marked = line.startsWith(MARK);
      continue;
    }
    const [spec, path, fstype, options] = line.split(/\s+/);
    if (spec && path && fstype) out.push({ spec, path: unescapeField(path), fstype, options: options ?? "defaults", ours: marked });
    marked = false;
  }
  return out;
}

/** /etc/fstab without Hata's line for this folder; lines of anybody else stay, whatever they say */
export function withoutMount(text: string, path: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1]?.trim().split(/\s+/);
    if (lines[i]!.trim().startsWith(MARK) && next && next.length >= 3 && unescapeField(next[1]!) === path) {
      i++;
      continue;
    }
    out.push(lines[i]!);
  }
  return out.join("\n");
}

/** /etc/fstab with a line of Hata's for this folder, in place of an older one */
export function withMount(text: string, entry: Omit<FstabEntry, "ours">): string {
  const base = withoutMount(text, entry.path).replace(/\n*$/, "\n");
  // the last field: checked after the system's own file system, where there is something to check
  const pass = POSIX_FS.test(entry.fstype) && entry.fstype !== "btrfs" && entry.fstype !== "xfs" ? 2 : 0;
  return `${base}${MARK_LINE}\n${entry.spec} ${escapeField(entry.path)} ${entry.fstype} ${entry.options} 0 ${pass}\n`;
}

/**
 * Mount options. A line kept in /etc/fstab must not hold up the start of a server whose disk is gone.
 * FAT, exFAT and NTFS know no owners: everything on them is open to every user, apps included.
 */
export function optionsFor(fstype: string, keep: boolean): string {
  const own = POSIX_FS.test(fstype) ? ["defaults", "noatime"] : ["rw", "umask=000", ...(fstype === "vfat" ? ["utf8"] : [])];
  return [...own, ...(keep ? ["nofail", "x-systemd.device-timeout=10s", BEFORE_DOCKER] : [])].join(",");
}

/**
 * `nofail` takes a disk out of the order of the start, and Docker may then start an app before the disk
 * with its data is mounted — the app would make its folders anew, on the system's disk. With this the
 * mount is tried first (for as long as the device timeout allows) and Docker starts after it.
 */
export const BEFORE_DOCKER = "x-systemd.before=docker.service";

/** /etc/fstab with Hata's own lines brought up to what Hata writes today; other lines stay as they are */
export function upgradeLines(text: string): string {
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i - 1]!.trim().startsWith(MARK)) continue;
    const fields = lines[i]!.trim().split(/\s+/);
    if (fields.length < 4 || fields[3]!.split(",").includes(BEFORE_DOCKER) || !fields[3]!.split(",").includes("nofail")) continue;
    fields[3] += "," + BEFORE_DOCKER;
    lines[i] = fields.join(" ");
  }
  return lines.join("\n");
}

// ---- several disks as one folder ----

export const POOL_FS = "fuse.mergerfs";

/** The merged folders Hata made, with the folders each is made of */
export const pools = (entries: FstabEntry[]): Record<string, string[]> => Object.fromEntries(entries.filter((e) => e.ours && e.fstype === POOL_FS).map((e) => [e.path, e.spec.split(":")]));

/**
 * The options of a merged folder: a new file goes to the disk with the most free room, and one that
 * outgrows its disk moves to another. It waits for every disk it is made of — merged without one, new
 * files would land on the system's disk, in the empty folder the missing one leaves.
 */
export function poolOptions(name: string, branches: string[]): string {
  return ["cache.files=off", "category.create=mfs", "moveonenospc=true", "minfreespace=1G", "allow_other", `fsname=${name}`, "nofail", BEFORE_DOCKER, ...branches.map((b) => `x-systemd.requires-mounts-for=${b}`)].join(",");
}

/**
 * The connected folders that can be merged: Hata's own, kept, of a file system with owners, in no merged
 * folder yet, and not the parity of the protection — new files would land in the room the parity needs
 */
export function mergeable(entries: FstabEntry[], mounted: string[], parity: string | string[] = ""): string[] {
  const taken = new Set([...Object.values(pools(entries)).flat(), ...[parity].flat().filter(Boolean)]);
  return entries.filter((e) => e.ours && POSIX_FS.test(e.fstype) && mounted.includes(e.path) && !taken.has(e.path)).map((e) => e.path);
}

// ---- the running part ----

const FSTAB = process.env.HATA_FSTAB || "/etc/fstab";
const MOUNT_ROOT = "/mnt";
const FILE = join(DATA_DIR, "mounts.json");

/** What went wrong, as an error code of the API; `needs` — a package that would mend it */
export interface Failure {
  error: string;
  message?: string;
  needs?: { package: string; install: string };
}
export type Outcome = { path: string } | Failure;

interface Temporary {
  path: string;
  uuid: string;
  device: string;
}
const saved = readJsonFile<{ temporary?: Temporary[]; sealed?: string[] }>(FILE, {}, isPlainObject);
/** File systems connected until their disk is unplugged — they are in no /etc/fstab */
const temporary: Temporary[] = Array.isArray(saved.temporary) ? saved.temporary.filter((t) => typeof t?.path === "string" && typeof t.device === "string") : [];
/** Kept folders whose own directory was closed for writing (`seal`), or where that was tried */
const sealed: string[] = Array.isArray(saved.sealed) ? saved.sealed.filter((p) => typeof p === "string") : [];
/** Disconnected by hand: not to be connected again by itself while it stays plugged in */
const ejected = new Set<string>();

const save = () => {
  try {
    writeJsonAtomic(FILE, { temporary, sealed });
  } catch (e) {
    console.error("Could not save the list of connected disks:", e instanceof Error ? e.message : e);
  }
};

const readText = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const fstab = (): FstabEntry[] => parseFstab(readText(FSTAB));
const mountedAt = (): Map<string, string> => new Map(readText("/proc/mounts").split("\n").map((line) => line.split(" ")).filter((f) => f.length > 2).map((f) => [unescapeField(f[1]!), unescapeField(f[0]!)]));
const has = (program: string): string | null => Bun.which(program, { PATH });

/**
 * A mount command run in a scope of its own: a FUSE file system (mergerfs, ntfs-3g, exfat-fuse) is a
 * process that would otherwise stay in Hata's service and be killed with it at every restart or update.
 */
const outside = (command: string[]): string[] => (process.getuid?.() === 0 && has("systemd-run") ? ["systemd-run", "--scope", "--collect", "--quiet", "--", ...command] : command);
const said = (result: { out: string; err: string; code: number }): string => (result.err.trim() || result.out.trim()).split("\n").slice(-2).join(" ") || `exit code ${result.code}`;

function writeFstab(text: string): void {
  // what the file said before Hata first wrote to it
  if (existsSync(FSTAB) && !existsSync(FSTAB + ".before-hata")) copyFileSync(FSTAB, FSTAB + ".before-hata");
  writeTextAtomic(FSTAB, text);
}

/** systemd makes its mount units from /etc/fstab and has to be told that it changed */
const reload = async (): Promise<void> => {
  if (has("systemctl")) await run(["systemctl", "daemon-reload"], 30_000);
};

/**
 * Closes the directory a kept disk is mounted at: with the disk absent, nothing can be written into the
 * empty folder it leaves. Without this Docker makes an app's missing folders there — on the system's
 * disk — and the app starts empty; with it the app does not start until its disk is back. The mark is
 * on the directory underneath: a mounted disk covers it and is not affected.
 */
async function seal(path: string): Promise<void> {
  if (!has("chattr") || sealed.includes(path)) return;
  sealed.push(path);
  save();
  if (!mountedAt().has(path)) {
    await run(["chattr", "+i", path], 10_000);
    return;
  }
  // mounted already: the directory underneath is reached through a second view of the folder it lies in
  const parent = dirname(path);
  let view = "";
  try {
    view = mkdtempSync("/run/hata-under-");
    if ((await run(["mount", "--bind", parent, view], 10_000)).code !== 0) return;
    await run(["chattr", "+i", join(view, basename(path))], 10_000);
    await run(["umount", view], 10_000);
  } catch {
  } finally {
    try {
      if (view) rmdirSync(view);
    } catch {}
  }
}

/** For other kinds of mounts Hata makes (network places): the same closed directory */
export const sealFolder = (path: string): Promise<void> => seal(path);
export const openFolder = (path: string): Promise<void> => removeFolder(path);

/** Opens such a directory again and, unless it was there before Hata, removes it when empty */
async function removeFolder(path: string, ours = true): Promise<void> {
  const at = sealed.indexOf(path);
  if (at >= 0) {
    if (has("chattr")) await run(["chattr", "-i", path], 10_000);
    sealed.splice(at, 1);
    save();
  }
  if (!ours) return;
  try {
    rmdirSync(path);
  } catch {}
}

// one change of the disks at a time
let queue: Promise<unknown> = Promise.resolve();
/** Long work (a format, a check, an erasing) is under way: what a person asks meanwhile is refused at once instead of waiting behind it */
let long = 0;
const oneAtATime = <T>(work: () => Promise<T>, kind: "asked" | "long" | "own" = "asked"): Promise<T> => {
  if (kind !== "own" && long > 0) return Promise.resolve({ error: "disk.working" } as T);
  if (kind === "long") long++;
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return kind === "long" ? next.finally(() => long--) : next;
};

const ownTurn = <T>(work: () => Promise<T>): Promise<T> => oneAtATime(work, "own");

/** Something holds the device open from above: LVM, RAID, an encrypted volume */
const held = (name: string): boolean => {
  try {
    return readdirSync(`/sys/class/block/${name}/holders`).length > 0;
  } catch {
    return false;
  }
};

/** The kernel's own word on whether anything of the disk is in use — asked right before erasing */
function inUse(disk: { name: string; path: string; volumes: { name: string; path: string }[] }): boolean {
  const devices = [disk.path, ...disk.volumes.map((v) => v.path)];
  const busy = [...mountedAt().values(), ...readText("/proc/swaps").split("\n").slice(1).map((line) => line.split(/\s+/)[0] ?? "")];
  return busy.some((device) => devices.includes(device)) || [disk.name, ...disk.volumes.map((v) => v.name)].some(held);
}

function freeFolder(path: string): boolean {
  if (mountedAt().has(path)) return false;
  try {
    return readdirSync(path).length === 0;
  } catch {
    return !existsSync(path);
  }
}

/** The type to mount a file system with, when this system can; NTFS has two drivers */
async function driver(fstype: string): Promise<string | Failure> {
  if (fstype !== "ntfs" && fstype !== "exfat") return fstype;
  const kernel = fstype === "ntfs" ? "ntfs3" : "exfat";
  const known = readText("/proc/filesystems").split("\n").some((line) => line.trim().split(/\s+/).pop() === kernel);
  if (known || (has("modprobe") && (await run(["modprobe", "-n", kernel], 10_000)).code === 0)) return kernel;
  if (fstype === "exfat") return has("mount.exfat-fuse") || has("mount.exfat") ? "exfat" : { error: "disk.noExfat" };
  if (has("ntfs-3g")) return "ntfs-3g";
  return { error: "disk.noNtfs", needs: { package: "ntfs-3g", install: installCommand("ntfs-3g") } };
}

/** Mounts a file system at a folder under /mnt: through /etc/fstab when it is to stay, plainly otherwise */
async function attach(volume: { path: string; uuid: string; fstype: string }, path: string, keep: boolean): Promise<Failure | null> {
  const type = await driver(volume.fstype);
  if (typeof type !== "string") return type;
  if (!freeFolder(path)) return { error: "disk.folderTaken" };
  const made = !existsSync(path);
  mkdirSync(path, { recursive: true });
  const options = optionsFor(volume.fstype, keep);
  const before = readText(FSTAB);
  let result;
  if (keep) {
    await seal(path);
    writeFstab(withMount(before, { spec: volume.uuid ? `UUID=${volume.uuid}` : volume.path, path, fstype: type, options }));
    await reload();
    result = await run(outside(["mount", path]), 60_000);
  } else {
    result = await run(outside(["mount", "-t", type, "-o", options, volume.path, path]), 60_000);
  }
  if (result.code !== 0) {
    if (keep) {
      writeFstab(before);
      await reload();
    }
    await removeFolder(path, made);
    return { error: "disk.mountFailed", message: said(result) };
  }
  if (!keep) {
    temporary.push({ path, uuid: volume.uuid, device: volume.path });
    save();
  }
  return null;
}

const partitionPackage = (): string => ({ "apt-get": "fdisk", apk: "sfdisk" })[packageManager()] ?? "util-linux";

const settle = async (): Promise<void> => {
  if (has("udevadm")) await run(["udevadm", "settle", "--timeout=10"], 15_000);
};
// a label in any language reaches the programs as UTF-8
const UTF8 = { LC_ALL: "C.UTF-8" };
const usb = (disk: Disk): boolean => disk.removable || disk.transport === "usb";
const lacks = (error: string, pkg: string): Failure => ({ error, needs: { package: pkg, install: installCommand(pkg) } });

export interface FormatAsk {
  /** A partition to format alone; "" — the whole disk, under a new partition table; "free" — a new partition in the room no partition takes */
  part: string;
  /** How large the new partition is, bytes; 0 — all the room there is */
  size: number;
  fs: string;
  label: string;
  /** Afterwards: keep — connected from now on; once — until it is unplugged; no — left as it is */
  connect: string;
  /** The folder under /mnt, when it is connected */
  name: string;
}

/** Tells the partition table what the partition holds now: Windows goes by that, not by the contents */
async function retype(disk: Disk, part: Volume, fs: Fs): Promise<void> {
  if (!has("sfdisk")) return;
  const table = (await run(["blkid", "-p", "-s", "PTTYPE", "-o", "value", disk.path], 15_000)).out.trim();
  const number = readText(`/sys/class/block/${part.name}/partition`).trim();
  if ((table !== "gpt" && table !== "dos") || !number) return;
  await run(["sfdisk", "--no-reread", "--part-type", disk.path, number, partType(table, fs)], 30_000);
}

/**
 * Erases a disk — or one partition of it — and makes a file system there. `seen` is the disk as the
 * person saw it when confirming — a letter that moved to another disk in between must not get that
 * disk erased. What Hata had connected of it is disconnected first; what anything else uses is refused.
 * `dry` — only says whether it may be done: nothing is touched. `log` hears how it goes.
 */
export function formatDisk(name: string, seen: { serial: string; size: number }, ask: FormatAsk, user: string, log: (line: string) => void = () => {}, dry = false): Promise<Outcome> {
  return oneAtATime(async () => {
    if (!isFs(ask.fs)) return { error: "disk.badFs" };
    const fs = ask.fs;
    const path = ask.connect === "no" ? "" : join(MOUNT_ROOT, ask.name);
    if (path && !NAME_RE.test(ask.name)) return { error: "disk.badName" };
    const label = cleanLabel(fs, ask.label);
    const disk = (await connected()).find((d) => d.name === name);
    if (!disk || !existsSync(disk.path)) return { error: "disk.unknown" };
    if (disk.serial !== seen.serial || disk.size !== seen.size) return { error: "disk.changed" };
    const fresh = ask.part === "free";
    const part = ask.part && !fresh ? disk.volumes.find((v) => v.path === ask.part && v.kind === "part") : undefined;
    if (ask.part && !fresh && !part) return { error: "disk.unknown" };
    const can = changeable(disk, Object.keys(oursNow()));
    // a new partition leaves the others as they are: they may be in anybody's use
    if (fresh ? blockers(disk).some((b) => b !== "mounted") : part ? !can.volumes.includes(part.path) : !can.whole) return { error: "disk.inUse" };
    const room = fresh ? unallocated(disk) : disk.size - TABLE_ROOM;
    const size = part ? 0 : Number.isFinite(ask.size) && ask.size > 0 ? Math.floor(ask.size) : 0;
    if (fresh && !room) return { error: "disk.noRoom" };
    if (size && (size < PART_MIN || size > room)) return { error: "disk.badSize" };
    if (fs === "vfat" && (part?.size ?? (size || room)) > FAT_MAX) return { error: "disk.tooBigForFat" };
    const pkg = partitionPackage();
    if (!part && !has("sfdisk")) return lacks("disk.noPartitionTool", pkg);
    if (!has(FORMATS[fs].tool)) return lacks("disk.noFormatTool", FORMATS[fs].package);

    // what Hata connected of it goes first — unless something of Hata's own lives there
    const leaving = (fresh ? [] : part ? [part] : disk.volumes).flatMap((v) => v.mounts);
    for (const folder of leaving) {
      const why = keeps(folder);
      if (why) return { error: why };
    }
    if (path && !leaving.includes(path) && (!freeFolder(path) || fstab().some((e) => e.path === path))) return { error: "disk.folderTaken" };
    if (dry) return { path };
    for (const folder of leaving) {
      log(`Disconnecting ${folder}`);
      const gone = await release(folder);
      if ("error" in gone) return gone;
    }
    if (!fresh && inUse(part ? { name: part.name, path: part.path, volumes: [] } : disk)) return { error: "disk.inUse" };

    let target = part;
    if (fresh) {
      const table = (await run(["blkid", "-p", "-s", "PTTYPE", "-o", "value", disk.path], 15_000)).out.trim();
      if (table !== "gpt" && table !== "dos") return { error: "disk.formatFailed", message: "The disk has no partition table Hata knows." };
      const before = new Set(disk.volumes.map((v) => v.path));
      log(`Adding a partition to ${disk.path}`);
      // the kernel is told apart: with a partition of the disk in use it would not read the whole table again
      const added = await run(["sfdisk", "--append", "--no-reread", disk.path], 60_000, {}, partLine(table, fs, size));
      if (added.code !== 0) return { error: "disk.formatFailed", message: said(added) };
      await run(["partx", "-u", disk.path], 30_000);
      await settle();
      for (let i = 0; i < 20 && !target; i++) {
        target = (await connected()).find((d) => d.name === name)?.volumes.find((v) => v.kind === "part" && !before.has(v.path) && existsSync(v.path));
        if (!target) await Bun.sleep(500);
      }
      if (!target) return { error: "disk.formatFailed", message: "The new partition did not show up." };
      await run(["wipefs", "-a", target.path], 30_000);
    } else if (target) {
      log(`Clearing ${target.path}`);
      await run(["wipefs", "-a", target.path], 30_000);
      await retype(disk, target, fs);
    } else {
      // old signatures first: a file system found again on the new partition would be mounted as it was
      for (const device of [...disk.volumes.map((v) => v.path), disk.path]) await run(["wipefs", "-a", device], 30_000);
      log(`Writing a new partition table to ${disk.path} (${tableFor(fs, disk.size, usb(disk))})`);
      const table = await run(["sfdisk", "--wipe", "always", "--wipe-partitions", "always", disk.path], 60_000, {}, tableScript(tableFor(fs, disk.size, usb(disk)), fs, size));
      if (table.code !== 0) return { error: "disk.formatFailed", message: said(table) };
      await settle();
      for (let i = 0; i < 20 && !target; i++) {
        target = (await connected()).find((d) => d.name === name)?.volumes.find((v) => v.kind === "part" && existsSync(v.path));
        if (!target) await Bun.sleep(500);
      }
      if (!target) return { error: "disk.formatFailed", message: "The new partition did not show up." };
    }
    const legacy = fs === "exfat" && !/exfatprogs/.test(Object.values(await run(["mkfs.exfat", "-V"], 10_000)).join(" "));
    const command = mkfsCommand(fs, label, target.path, { size: target.size, legacy });
    log(`Making the file system: ${command.join(" ")}`);
    const made = await runLogged(command, log, 6 * 60 * 60_000, UTF8);
    if (made.code !== 0) return { error: "disk.formatFailed", message: said(made) };
    log("Finishing the writing");
    await run(["sync"], 120_000);
    await settle();
    const uuid = (await run(["blkid", "-s", "UUID", "-o", "value", target.path], 15_000)).out.trim();
    const what = `${part || fresh ? target.name + ", " : ""}${diskLabel(disk)} → ${FS_NAMES[fs]}${label ? ` “${label}”` : ""}`;
    if (!path) {
      // left as it is: not to be connected by itself the moment it is ready
      ejected.add(uuid || target.path);
      record("system.disk.format", { user, detail: what });
      return { path: "" };
    }
    if (!uuid) return { error: "disk.formatFailed", message: "The new file system has no UUID." };
    log(`Connecting it as ${path}`);
    const failed = await attach({ path: target.path, uuid, fstype: fs }, path, ask.connect === "keep");
    if (failed) return failed;
    // the apps' own user owns the new disk, as it owns their data: an app can write to it at once
    if (isPosix(fs)) {
      try {
        chownSync(path, settings.puid, settings.pgid);
        chmodSync(path, 0o775);
      } catch {}
    }
    record("system.disk.format", { user, detail: `${what} → ${path}` });
    return { path };
  }, dry ? "asked" : "long");
}

/**
 * Erases a disk and leaves it empty, without a partition table. `thorough` — every block is written
 * over with zeros first, so what was there cannot be read back with ordinary tools (hours for a large
 * disk; a flash disk may keep spare blocks that are not reached). `stop` ends the writing over where it
 * is: the disk is erased by then, only not all of it written over.
 */
export function wipeDisk(name: string, seen: { serial: string; size: number }, thorough: boolean, user: string, log: (line: string) => void = () => {}, dry = false, stop?: AbortSignal): Promise<Outcome> {
  return oneAtATime(async () => {
    const disk = (await connected()).find((d) => d.name === name);
    if (!disk || !existsSync(disk.path)) return { error: "disk.unknown" };
    if (disk.serial !== seen.serial || disk.size !== seen.size) return { error: "disk.changed" };
    if (!changeable(disk, Object.keys(oursNow())).whole) return { error: "disk.inUse" };
    const leaving = disk.volumes.flatMap((v) => v.mounts);
    for (const folder of leaving) {
      const why = keeps(folder);
      if (why) return { error: why };
    }
    if (dry) return { path: "" };
    for (const folder of leaving) {
      log(`Disconnecting ${folder}`);
      const gone = await release(folder);
      if ("error" in gone) return gone;
    }
    if (inUse(disk)) return { error: "disk.inUse" };
    for (const device of [...disk.volumes.map((v) => v.path), disk.path]) await run(["wipefs", "-a", device], 30_000);
    if (thorough) {
      log(`Writing zeros over ${disk.path}: ${Math.round(disk.size / 1e9)} GB`);
      const started = Date.now();
      let whole = false;
      let written = 0;
      const zeros = await runLogged(["dd", "if=/dev/zero", `of=${disk.path}`, "bs=4M", "oflag=direct", "status=progress"], log, 7 * 24 * 60 * 60_000, {}, (line) => {
        // dd stops at the end of the disk with "No space left": that is the whole of it written
        if (/No space left/i.test(line)) whole = true;
        if (/No space left|records (in|out)$/i.test(line)) return null;
        const m = /^(\d+) bytes .* copied/.exec(line);
        if (m) written = Math.max(written, Number(m[1]));
        return m ? `${Math.min(100, Math.floor((Number(m[1]) / disk.size) * 100))}% · ${Math.round(Number(m[1]) / 1e9)} of ${Math.round(disk.size / 1e9)} GB · ${Math.round((Date.now() - started) / 60_000)} min` : line;
      }, stop);
      await run(["sync"], 120_000);
      if (stop?.aborted && !whole) {
        await run(["partx", "-d", disk.path], 30_000);
        await settle();
        const part = `${Math.min(99, Math.floor((written / disk.size) * 100))}%, ${Math.round(written / 1e9)} of ${Math.round(disk.size / 1e9)} GB`;
        return { error: "disk.stopped", message: `${diskLabel(disk)} written over up to ${part}. The disk is erased all the same: no partitions are left, but what was not written over can still be read with special tools.` };
      }
      if (zeros.code !== 0 && !whole) return { error: "disk.wipeFailed", message: said(zeros) };
    }
    await run(["partx", "-d", disk.path], 30_000);
    await settle();
    record("system.disk.wipe", { user, detail: `${diskLabel(disk)}${thorough ? ", written over" : ""}` });
    return { path: "" };
  }, dry ? "asked" : "long");
}

/** A file system Hata may check or rename, with the disk it is on */
async function volumeAt(device: string): Promise<{ volume: Volume; fs: Fs } | Failure> {
  const disk = (await connected()).find((d) => d.volumes.some((v) => v.path === device));
  const volume = disk?.volumes.find((v) => v.path === device);
  if (!disk || !volume || !existsSync(volume.path)) return { error: "disk.unknown" };
  if (!changeable(disk, Object.keys(oursNow())).volumes.includes(volume.path) || held(volume.name)) return { error: "disk.inUse" };
  const fs = familyOf(volume.fstype);
  return fs ? { volume, fs } : { error: "disk.badFs" };
}

/**
 * Does something to a file system that must not be mounted meanwhile: a folder Hata connected is taken
 * down for it and put back as it was. `back` — why it could not be put back.
 */
async function paused<T>(volume: Volume, work: () => Promise<T>): Promise<{ done: T; back: string } | Failure> {
  const folder = volume.mounts[0];
  if (!folder) return { done: await work(), back: "" };
  if (volume.mounts.length > 1) return { error: "disk.inUse" };
  const why = keeps(folder);
  if (why) return { error: why };
  const kept = fstab().some((e) => e.ours && e.path === folder);
  const down = await run(["umount", folder], 120_000);
  if (down.code !== 0) return { error: "disk.busy", message: said(down) };
  endStale(folder);
  const done = await work();
  const type = kept ? "" : await driver(volume.fstype);
  if (typeof type !== "string") return { done, back: type.error };
  const up = await run(outside(kept ? ["mount", folder] : ["mount", "-t", type, "-o", optionsFor(volume.fstype, false), volume.path, folder]), 60_000);
  return { done, back: up.code === 0 ? "" : said(up) };
}

export interface Checked {
  device: string;
  verdict: Verdict;
  /** The last lines of what the program said */
  output: string;
  repaired: boolean;
  /** The folder was disconnected for the check and could not be connected again: why */
  back: string;
}

/**
 * Looks a file system over; `repair` — and mends what it finds. `dry` — only says whether it may be done.
 * `stop` ends a look (never a repair: one cut half-way may leave more to mend than it found).
 */
export function checkVolume(device: string, repair: boolean, user: string, log: (line: string) => void = () => {}, dry = false, stop?: AbortSignal): Promise<Checked | Failure> {
  return oneAtATime(async () => {
    const found = await volumeAt(device);
    if ("error" in found) return found;
    const { volume, fs } = found;
    if (!has(CHECKERS[fs])) return lacks("disk.noCheckTool", FORMATS[fs].package);
    if (repair && !mendable(fs)) return { error: "disk.noRepair" };
    const folder = volume.mounts[0];
    if (folder && (volume.mounts.length > 1 || keeps(folder))) return { error: volume.mounts.length > 1 ? "disk.inUse" : keeps(folder)! };
    if (dry) return { device, verdict: "clean", output: "", repaired: repair, back: "" };
    const look = async () => {
      const command = checkCommand(fs, repair, volume.path);
      log(command.join(" "));
      // a large disk takes hours
      const said = await runLogged(command, log, 12 * 60 * 60_000, {}, (line) => passProgress(line) ?? line, repair ? undefined : stop);
      if (fs !== "ntfs" || repair || said.code !== 0 || !has("ntfsinfo")) return said;
      // ntfsfix does not tell that the volume was not closed properly; ntfsinfo refuses to open such a one
      const opened = await run(["ntfsinfo", "-m", volume.path], 60_000);
      return opened.code === 0 ? said : { code: 1, out: said.out, err: (opened.err.trim() || opened.out.trim()).split("\n")[0] ?? "" };
    };
    if (folder) log(`Disconnecting ${folder} for the check`);
    const ran = await paused(volume, look);
    if ("error" in ran) return ran;
    if (folder) log(ran.back ? `Could not connect ${folder} again: ${ran.back}` : `${folder} is connected again`);
    if (stop?.aborted && !repair) return { error: "disk.stopped", message: ran.back ? `Could not connect ${folder} again: ${ran.back}` : "" };
    const verdict = checkVerdict(fs, repair, ran.done.code);
    const output = `${ran.done.out}\n${ran.done.err}`.split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(-14).join("\n").slice(-3000);
    if (repair) record("system.disk.repair", { user, detail: volume.label || volume.path });
    return { device, verdict, output, repaired: repair, back: ran.back };
  }, dry ? "asked" : "long");
}

/** Gives a file system another label; the files are not touched */
export function relabel(device: string, text: string, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    const found = await volumeAt(device);
    if ("error" in found) return found;
    const { volume, fs } = found;
    const label = cleanLabel(fs, text);
    if (!label) return { error: "disk.badLabel" };
    if (!has(LABELLERS[fs])) return lacks("disk.noLabelTool", FORMATS[fs].package);
    const name = () => run(labelCommand(fs, volume.path, label), 60_000, UTF8);
    // ext4 and btrfs take a new label while in use; the others have to be let go of
    const ran = labelsInUse(fs) && volume.mounts[0] ? { done: await run(labelCommand(fs, fs === "btrfs" ? volume.mounts[0] : volume.path, label), 60_000, UTF8), back: "" } : await paused(volume, name);
    if ("error" in ran) return ran;
    if (ran.done.code !== 0) return { error: "disk.labelFailed", message: said(ran.done) };
    // a file system in use is not looked at again by itself: lsblk would go on showing the old label
    if (has("udevadm")) await run(["udevadm", "trigger", "--action=change", volume.path], 15_000);
    await settle();
    record("system.disk.label", { user, detail: `${volume.label || volume.name} → ${label}` });
    if (ran.back) return { error: "disk.mountFailed", message: ran.back };
    return { path: volume.mounts[0] ?? "" };
  });
}

// ---- one partition made larger or smaller, or taken away ----

/** A partition as the size dialog sees it */
export interface PartInfo {
  path: string;
  number: number;
  size: number;
  /** As large as it may grow: up to the next partition or the end of the disk */
  max: number;
  /** As small as it may sensibly be made: what its files take and some room; null — not known */
  min: number | null;
  fs: Fs | null;
  grow: boolean;
  shrink: boolean;
  removable: boolean;
  /** Why nothing can be done to it, as an error code; "" — something can */
  why: string;
}

async function tableOf(disk: Disk): Promise<Table | null> {
  if (!has("sfdisk")) return null;
  const ran = await run(["sfdisk", "-J", disk.path], 15_000);
  try {
    return parseSfdisk(JSON.parse(ran.out), disk.size);
  } catch {
    return null;
  }
}

/** Bytes the files of an ext4 that is not mounted take, from its superblock */
async function usedOffline(volume: Volume, fs: Fs | null): Promise<number | null> {
  if (fs !== "ext4" || !has("dumpe2fs")) return null;
  const head = (await run(["dumpe2fs", "-h", volume.path], 15_000)).out;
  const n = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(head)?.[1] ?? NaN);
  const used = (n("Block count") - n("Free blocks")) * n("Block size");
  return Number.isFinite(used) ? used : null;
}

/** The partitions of a disk with what may be done to each one's size */
export async function partsOf(name: string): Promise<{ table: string; parts: PartInfo[] } | Failure> {
  const disk = (await connected()).find((d) => d.name === name);
  if (!disk || !existsSync(disk.path)) return { error: "disk.unknown" };
  if (!has("sfdisk")) return lacks("disk.noPartitionTool", partitionPackage());
  const table = await tableOf(disk);
  if (!table) return { error: "disk.noTable" };
  const may = changeable(disk, Object.keys(oursNow()));
  const out: PartInfo[] = [];
  for (const volume of disk.volumes.filter((v) => v.kind === "part")) {
    const entry = table.parts.find((p) => p.node === volume.path);
    if (!entry) continue;
    const fs = familyOf(volume.fstype);
    const can = fs ? RESIZE[fs] : null;
    const used = volume.used ?? (await usedOffline(volume, fs));
    const min = used === null ? null : Math.min(volume.size, Math.ceil((used * 1.1 + 256 * MIB) / MIB) * MIB);
    const max = roomFor(table, entry);
    // a folder something of Hata's stands on (the data, the backups, a share, a pool, the array) stays as it is
    const kept = volume.mounts.map(keeps).find(Boolean);
    const why = nested(table, entry) ? "disk.nested" : !may.volumes.includes(volume.path) || held(volume.name) ? "disk.inUse" : kept ?? "";
    out.push({ path: volume.path, number: entry.number, size: volume.size, max, min, fs, grow: !why && !!can?.grow && max > volume.size + MIB, shrink: !why && !!can?.shrink, removable: !why || (why === "disk.nested" && entry.number > 4 && may.volumes.includes(volume.path) && !kept), why });
  }
  return { table: table.label, parts: out };
}

/** Mounts a file system for a moment where nothing sees it, and lets it go afterwards */
async function mountedFor<T>(volume: Volume, work: (place: string) => Promise<T>): Promise<T | Failure> {
  if (volume.mounts[0]) return work(volume.mounts[0]);
  let dir = "";
  try {
    dir = mkdtempSync("/run/hata-resize-");
    const up = await run(["mount", "-t", volume.fstype, volume.path, dir], 60_000);
    if (up.code !== 0) return { error: "disk.mountFailed", message: said(up) };
    try {
      return await work(dir);
    } finally {
      await run(["umount", dir], 120_000);
    }
  } finally {
    try {
      if (dir) rmdirSync(dir);
    } catch {}
  }
}

/**
 * Makes a partition larger or smaller, its files kept: the file system grows after the partition, or
 * shrinks before it, so it never reaches past its partition. ext4 and NTFS are changed while not
 * mounted (a folder Hata connected is let go for it and connected back), btrfs and XFS while mounted.
 * XFS cannot shrink, FAT and exFAT cannot change at all. `seen` — the disk as the person saw it.
 */
export function resizePart(name: string, seen: { serial: string; size: number }, device: string, bytes: number, user: string, log: (line: string) => void = () => {}, dry = false): Promise<Outcome> {
  return oneAtATime(async () => {
    const disk = (await connected()).find((d) => d.name === name);
    if (!disk || !existsSync(disk.path)) return { error: "disk.unknown" };
    if (disk.serial !== seen.serial || disk.size !== seen.size) return { error: "disk.changed" };
    const listed = await partsOf(name);
    if ("error" in listed) return listed;
    const info = listed.parts.find((p) => p.path === device);
    const volume = disk.volumes.find((v) => v.path === device);
    if (!info || !volume) return { error: "disk.unknown" };
    if (info.why) return { error: info.why };
    if (!info.fs || (!info.grow && !info.shrink)) return { error: "disk.cantResize" };
    const fs = info.fs;
    const target = Math.floor(bytes / MIB) * MIB;
    if (!Number.isFinite(target) || target < PART_MIN || target > info.max) return { error: "disk.badSize" };
    if (Math.abs(target - info.size) < MIB) return { error: "disk.sameSize" };
    const grow = target > info.size;
    if (grow ? !info.grow : !info.shrink) return { error: grow ? "disk.cantResize" : "disk.cantShrink" };
    if (!grow && info.min !== null && target < info.min) return { error: "disk.tooSmall", message: `${Math.ceil(info.min / 1e9)} GB` };
    const can = RESIZE[fs];
    if (!has(can.tool)) return lacks("disk.noResizeTool", can.package);
    if (fs === "ext4" && !has("e2fsck")) return lacks("disk.noCheckTool", "e2fsprogs");
    if (!has("partx")) return lacks("disk.noPartitionTool", "util-linux");
    // let go of while it changes: then nothing of Hata's may stand on it
    const folder = volume.mounts[0];
    if (!can.mounted && folder && keeps(folder)) return { error: keeps(folder)! };
    if (dry) return { path: folder ?? "" };

    const table = (await tableOf(disk))!;
    const sectors = Math.floor(target / table.sectorSize);
    const repartition = async (): Promise<Failure | null> => {
      log(`Setting partition ${info.number} of ${disk.path} to ${Math.round(target / MIB)} MiB`);
      const ran = await run(["sfdisk", "--no-reread", "-N", String(info.number), disk.path], 60_000, {}, resizeScript(sectors));
      if (ran.code !== 0) return { error: "disk.resizeFailed", message: said(ran) };
      // the kernel takes the new size of a partition in use from partx, not from a reread of the whole table
      await run(["partx", "-u", "--nr", String(info.number), disk.path], 30_000);
      await settle();
      return null;
    };
    const step = async (command: string[]): Promise<Failure | null> => {
      log(command.join(" "));
      const ran = await runLogged(command, log, 6 * 60 * 60_000);
      return ran.code === 0 ? null : { error: "disk.resizeFailed", message: said(ran) };
    };
    const ntfs = async (command: string[]): Promise<Failure | null> => {
      log(command.join(" "));
      const ran = await run(command, 6 * 60 * 60_000, {}, "y\n");
      for (const line of `${ran.out}\n${ran.err}`.split("\n").filter((l) => l.trim()).slice(-8)) log(line);
      if (ran.code !== 0) return { error: "disk.resizeFailed", message: said(ran) };
      // ntfsresize marks the volume for a check by Windows, and the kernel's driver then refuses to mount it
      const clean = await run(["ntfsfix", "-d", volume.path], 10 * 60_000);
      log(clean.code === 0 ? "The mark “to be checked by Windows” taken off" : `ntfsfix: ${said(clean)}`);
      return null;
    };

    let failed: Failure | null = null;
    if (can.mounted) {
      // btrfs and XFS change while mounted
      const devid = async (place: string): Promise<number> => {
        const shown = parseBtrfsShow((await run(["btrfs", "filesystem", "show", "--raw", place], 15_000)).out)[0];
        return shown?.devices.find((d) => d.path === device)?.id || 1;
      };
      const done = await mountedFor(volume, async (place) => {
        if (grow) {
          const cut = await repartition();
          if (cut) return cut;
          return step(fsResizeCommand(fs, place, "max", fs === "btrfs" ? await devid(place) : 1));
        }
        const shrunk = await step(fsResizeCommand(fs, place, target, await devid(place)));
        return shrunk ?? (await repartition());
      });
      failed = done && "error" in done ? done : null;
    } else {
      if (folder) log(`Disconnecting ${folder} for the change`);
      const ran = await paused(volume, async (): Promise<Failure | null> => {
        if (fs === "ext4") {
          // resize2fs works only on a file system checked just before
          const checked = await runLogged(["e2fsck", "-f", "-y", "-C", "1", volume.path], log, 12 * 60 * 60_000, {}, (line) => passProgress(line) ?? line);
          if (checked.code >= 4) return { error: "disk.resizeFailed", message: "The file system has damage the check could not mend." };
          if (grow) return (await repartition()) ?? (await step(fsResizeCommand(fs, volume.path, "max")));
          return (await step(fsResizeCommand(fs, volume.path, target))) ?? (await repartition());
        }
        if (grow) return (await repartition()) ?? (await ntfs(fsResizeCommand(fs, volume.path, "max")));
        return (await ntfs(fsResizeCommand(fs, volume.path, target))) ?? (await repartition());
      });
      if ("error" in ran) return ran;
      if (folder) log(ran.back ? `Could not connect ${folder} again: ${ran.back}` : `${folder} is connected again`);
      failed = ran.done ?? (ran.back ? { error: "disk.mountFailed", message: `The size is changed, but ${folder} could not be connected again: ${ran.back}` } : null);
    }
    if (failed) return failed;
    record("system.disk.resize", { user, detail: `${volume.label || volume.name}: ${Math.round(info.size / 1e9)} → ${Math.round(target / 1e9)} GB` });
    return { path: folder ?? "" };
  }, dry ? "asked" : "long");
}

/** Takes a partition away: its file system is erased, the room left becomes free for a new one */
export function deletePart(name: string, seen: { serial: string; size: number }, device: string, user: string, dry = false): Promise<Outcome> {
  return oneAtATime(async () => {
    const disk = (await connected()).find((d) => d.name === name);
    if (!disk || !existsSync(disk.path)) return { error: "disk.unknown" };
    if (disk.serial !== seen.serial || disk.size !== seen.size) return { error: "disk.changed" };
    const listed = await partsOf(name);
    if ("error" in listed) return listed;
    const info = listed.parts.find((p) => p.path === device);
    const volume = disk.volumes.find((v) => v.path === device);
    if (!info || !volume) return { error: "disk.unknown" };
    if (!info.removable) return { error: info.why || "disk.inUse" };
    for (const folder of volume.mounts) {
      const why = keeps(folder);
      if (why) return { error: why };
    }
    if (dry) return { path: "" };
    for (const folder of volume.mounts) {
      const gone = await release(folder);
      if ("error" in gone) return gone;
    }
    if (inUse({ name: volume.name, path: volume.path, volumes: [] })) return { error: "disk.inUse" };
    await run(["wipefs", "-a", volume.path], 30_000);
    const ran = await run(["sfdisk", "--no-reread", "--delete", disk.path, String(info.number)], 60_000);
    if (ran.code !== 0) return { error: "disk.resizeFailed", message: said(ran) };
    await run(["partx", "-d", "--nr", String(info.number), disk.path], 30_000);
    await settle();
    record("system.disk.partDelete", { user, detail: `${volume.name}${volume.label ? ` “${volume.label}”` : ""} · ${diskLabel(disk)}` });
    return { path: "" };
  });
}

/** Connects a file system as it is; `keep` — from now on, also after a restart */
export function connectVolume(device: string, label: string, keep: boolean, user: string, dry = false): Promise<Outcome> {
  return oneAtATime(async () => {
    if (!NAME_RE.test(label)) return { error: "disk.badName" };
    const disk = (await connected()).find((d) => d.volumes.some((v) => v.path === device));
    const volume = disk?.volumes.find((v) => v.path === device);
    if (!disk || !volume || !existsSync(volume.path)) return { error: "disk.unknown" };
    if (!mountable(volume) || held(volume.name)) return { error: "disk.inUse" };
    const path = join(MOUNT_ROOT, label);
    if (fstab().some((e) => e.path === path)) return { error: "disk.folderTaken" };
    if (dry) return freeFolder(path) ? { path } : { error: "disk.folderTaken" };
    const failed = await attach(volume, path, keep);
    if (failed) return failed;
    ejected.delete(volume.uuid || volume.path);
    record("system.disk.connect", { user, detail: `${volume.label || diskLabel(disk)} → ${path}` });
    return { path };
  });
}

/** A folder connected until its disk is unplugged, connected for good instead: in /etc/fstab from now on */
export function keepConnected(path: string, user: string, dry = false): Promise<Outcome> {
  return oneAtATime(async () => {
    const was = temporary.find((t) => t.path === path);
    if (!was) return { error: "disk.notOurs" };
    const volume = (await connected()).flatMap((d) => d.volumes).find((v) => v.path === was.device);
    if (!volume || !volume.uuid) return { error: "disk.unknown" };
    if (dry) return { path };
    const gone = await release(path);
    if ("error" in gone) return gone;
    const failed = await attach(volume, path, true);
    if (failed) return failed;
    record("system.disk.connect", { user, detail: `${volume.label || volume.name} → ${path}` });
    return { path };
  });
}

/** Shows several connected folders as one, at /mnt/<name> */
export function mergeFolders(branches: unknown, label: string, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    if (!NAME_RE.test(label)) return { error: "disk.badName" };
    const lines = fstab();
    const can = mergeable(lines, [...mountedAt().keys()], [settings.snapraid.parity, settings.snapraid.parity2]);
    const chosen = Array.isArray(branches) ? [...new Set(branches.filter((b): b is string => typeof b === "string"))] : [];
    if (chosen.length < 2 || chosen.some((b) => !can.includes(b))) return { error: "disk.badMerge" };
    if (!has("mergerfs")) return { error: "disk.noMergeTool", needs: { package: "mergerfs", install: installCommand("mergerfs") } };
    const path = join(MOUNT_ROOT, label);
    if (!freeFolder(path) || lines.some((e) => e.path === path)) return { error: "disk.folderTaken" };
    const made = !existsSync(path);
    mkdirSync(path, { recursive: true });
    const before = readText(FSTAB);
    await seal(path);
    writeFstab(withMount(before, { spec: chosen.join(":"), path, fstype: POOL_FS, options: poolOptions(label, chosen) }));
    await reload();
    const result = await run(outside(["mount", path]), 60_000);
    if (result.code !== 0) {
      writeFstab(before);
      await reload();
      await removeFolder(path, made);
      return { error: "disk.mountFailed", message: said(result) };
    }
    record("system.disk.merge", { user, detail: `${chosen.join(" + ")} → ${path}` });
    return { path };
  });
}

const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith("/") ? root : root + "/");

/** What of Hata lives on a mounted folder — it cannot be taken away from under it */
export function holds(path: string, uses: { dataRoot: string; backupDir: string; state: string[]; shares: string[] }): "data" | "backups" | "state" | "share" | null {
  if (uses.state.some((dir) => within(dir, path))) return "state";
  if (within(uses.dataRoot, path)) return "data";
  if (uses.backupDir && within(uses.backupDir, path)) return "backups";
  if (uses.shares.some((share) => within(share, path))) return "share";
  return null;
}

/** Powers a removable disk down once nothing of it is mounted: it disappears and can be pulled out */
async function powerDown(device: string): Promise<void> {
  const disk = (await connected()).find((d) => d.volumes.some((v) => v.path === device) || d.path === device);
  if (!disk || !(disk.removable || disk.transport === "usb") || disk.volumes.some((v) => v.mounts.length || v.swap)) return;
  await run(["sync"], 60_000);
  try {
    writeFileSync(`/sys/block/${disk.name}/device/delete`, "1");
  } catch {}
}

/** The folders the containers' storage pools are in, told by `containers.ts` (it imports this module) */
let containerPlaces: () => string[] = () => [];
export const onContainerPlaces = (list: () => string[]): void => void (containerPlaces = list);

/** Why a folder cannot be taken away now: what of Hata's stands on it, as an error code; null — nothing */
function keeps(path: string): string | null {
  if (containerPlaces().some((place) => place === path || place.startsWith(path.replace(/\/$/, "") + "/"))) return "disk.holds.containers";
  if (Object.values(pools(fstab())).some((branches) => branches.includes(path))) return "disk.holds.pool";
  // a disk of the array taken away is a disk that failed, as far as the parity knows
  // (one that is gone already is let go: its replacement takes the same folder)
  if (mountedAt().has(path) && (settings.snapraid.parity === path || (settings.snapraid.parity2 !== "" && settings.snapraid.parity2 === path) || settings.snapraid.data.some((d) => d.path === path))) return "disk.holds.array";
  const used = holds(path, { dataRoot: settings.dataRoot, backupDir: settings.backup.dir, state: [DATA_DIR, SECRETS_DIR], shares: settings.shares.map((s) => s.path) });
  return used ? `disk.holds.${used}` : null;
}

/** Unmounts a folder Hata connected and forgets it; `device` — what was mounted there, if anything was */
async function release(path: string): Promise<{ device: string | undefined } | Failure> {
  const kept = fstab().find((e) => e.ours && e.path === path);
  const index = temporary.findIndex((t) => t.path === path);
  if (!kept && index < 0) return { error: "disk.notOurs" };
  const why = keeps(path);
  if (why) return { error: why };
  const device = mountedAt().get(path);
  if (device) {
    const result = await run(["umount", path], 120_000);
    if (result.code !== 0) return { error: "disk.busy", message: said(result) };
    endStale(path);
  }
  if (kept) {
    writeFstab(withoutMount(readText(FSTAB), path));
    await reload();
  }
  if (index >= 0) {
    temporary.splice(index, 1);
    save();
  }
  await removeFolder(path);
  return { device };
}

/** Disconnects a folder Hata connected; other mounts of the system are not Hata's to end */
export function disconnect(path: string, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    const gone = await release(path);
    if ("error" in gone) return gone;
    if (gone.device) {
      // taken out by hand: not to be connected again by itself while it stays plugged in
      const volume = (await connected()).flatMap((d) => d.volumes).find((v) => v.path === gone.device);
      ejected.add(volume?.uuid || gone.device);
      await powerDown(gone.device);
    }
    record("system.disk.disconnect", { user, detail: path });
    return { path };
  });
}

/**
 * Folders of kept disks that are not connected now — the disk is unplugged, off or broken — with what of
 * Hata's lies there.
 */
export function absent(): { path: string; holds: ReturnType<typeof holds> }[] {
  const mounted = mountedAt();
  if (!mounted.size) return [];
  const uses = { dataRoot: settings.dataRoot, backupDir: settings.backup.dir, state: [DATA_DIR, SECRETS_DIR], shares: settings.shares.map((s) => s.path) };
  return fstab().filter((e) => e.ours && !mounted.has(e.path)).map((e) => ({ path: e.path, holds: holds(e.path, uses) }));
}

/** Brings what older versions wrote up to date: the order of the start, the closed directories */
function upgradeKept(): Promise<void> {
  return ownTurn(async () => {
    if (process.getuid?.() !== 0 || !existsSync(FSTAB)) return;
    const text = readText(FSTAB);
    const next = upgradeLines(text);
    if (next !== text) {
      writeFstab(next);
      await reload();
    }
    for (const entry of fstab()) if (entry.ours && existsSync(entry.path)) await seal(entry.path);
    await mountLeftOut();
  });
}

const FUSE_DAEMONS = new Set(["mergerfs", "ntfs-3g", "mount.exfat-fuse", "exfat-fuse"]);

/**
 * Ends the FUSE program of a folder just unmounted: mergerfs mounted at boot was seen to stay asleep
 * after its folder went, and a second one would then serve the same folder next to it.
 */
function endStale(path: string): void {
  if (mountedAt().has(path)) return;
  let pids: string[] = [];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return;
  }
  for (const pid of pids) {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (FUSE_DAEMONS.has(basename(args[0] ?? "")) && args.includes(path)) process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
}

/**
 * Kept folders whose disk is here but which are not mounted — a FUSE file system an older version
 * mounted died with it — are mounted again; told as a return, so the apps that failed on them start.
 */
async function mountLeftOut(): Promise<void> {
  lookForReturns();
  for (const entry of fstab()) {
    if (!entry.ours || mountedAt().has(entry.path)) continue;
    const mounted = mountedAt();
    const here = entry.fstype === POOL_FS ? entry.spec.split(":").every((branch) => mounted.has(branch)) : existsSync(entry.spec.startsWith("UUID=") ? `/dev/disk/by-uuid/${entry.spec.slice(5)}` : entry.spec);
    if (!here) continue;
    const result = await run(outside(["mount", entry.path]), 60_000);
    if (result.code !== 0) console.error(`Could not mount ${entry.path} again:`, said(result));
  }
}

// ---- USB disks that connect by themselves ----

function usbFolder(volume: Volume, taken: Set<string>): string {
  const base = join(MOUNT_ROOT, "usb-" + suggestName(volume.label || volume.uuid.slice(0, 8) || volume.name));
  for (let n = 1; ; n++) {
    const path = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(path) && freeFolder(path)) return path;
  }
}

/** Clears away what an unplugged disk left behind, and connects what was plugged in when that is on */
function lookAround(): Promise<void> {
  return ownTurn(async () => {
    const disks = await connected();
    note(disks);
    const volumes = disks.flatMap((d) => d.volumes);
    const mounted = mountedAt();
    for (const entry of [...temporary]) {
      if (volumes.some((v) => v.path === entry.device && v.mounts.includes(entry.path))) continue;
      // pulled out while connected: the folder still points at a disk that is not there
      if (mounted.has(entry.path) && !volumes.some((v) => v.path === entry.device)) await run(["umount", "-l", entry.path], 30_000);
      else if (mounted.has(entry.path)) continue;
      try {
        rmdirSync(entry.path);
      } catch {}
      temporary.splice(temporary.indexOf(entry), 1);
      save();
    }
    for (const id of [...ejected]) if (!volumes.some((v) => (v.uuid || v.path) === id)) ejected.delete(id);
    if (!settings.storage.automount) return;
    const lines = fstab();
    const taken = new Set([...lines.map((e) => e.path), ...mounted.keys()]);
    for (const disk of disks) {
      if (!(disk.transport === "usb" || disk.removable) || blockers(disk).some((b) => b !== "mounted")) continue;
      for (const volume of disk.volumes) {
        if (!mountable(volume) || held(volume.name) || ejected.has(volume.uuid || volume.path) || !existsSync(volume.path)) continue;
        // a disk with a line of its own in /etc/fstab is somebody's business already
        if (lines.some((e) => e.spec === volume.path || (volume.uuid && e.spec === `UUID=${volume.uuid}`) || (volume.label && e.spec === `LABEL=${volume.label}`))) continue;
        const path = usbFolder(volume, taken);
        const failed = await attach(volume, path, false);
        if (failed) {
          // not asked again at every look: once per plugging in
          ejected.add(volume.uuid || volume.path);
          console.error(`Could not connect ${volume.path}:`, failed.message ?? failed.error);
        } else {
          taken.add(path);
          record("system.disk.connect", { detail: `${volume.label || diskLabel(disk)} → ${path}` });
        }
      }
    }
  });
}

/** Told the folders of kept disks that were away and are connected again */
let backHooks: ((paths: string[]) => void)[] = [];
export const onDiskBack = (hook: (paths: string[]) => void): void => void backHooks.push(hook);

/** The kept folders whose disk is away; the ones that left the list since the last look are told on */
let away: Set<string> | null = null;
function lookForReturns(): void {
  const now = new Set(absent().map((a) => a.path));
  const back = away ? [...away].filter((path) => !now.has(path)) : [];
  away = now;
  if (back.length) for (const hook of backHooks) hook(back);
}

const LOOK_EVERY_MS = 3000;
// a disk just plugged in is listed before its file system is recognised
const LOOK_AGAIN = 4;
const SLOW_LOOK = 10;

/** Watches the kernel's list of partitions — cheap to read — and looks closer when it changes */
export function startMounting(): void {
  void upgradeKept().catch((e) => console.error("Could not bring /etc/fstab up to date:", e instanceof Error ? e.message : e));
  let last = "";
  let mounts = "";
  let again = 1;
  let ticks = 0;
  let automount = settings.storage.automount;
  setInterval(() => {
    const now = readText("/proc/partitions");
    // a file system made on a disk that is already plugged in changes no partition: seen at the slow look
    if (now !== last || automount !== settings.storage.automount || (settings.storage.automount && ++ticks % SLOW_LOOK === 0)) again = Math.max(again, now !== last ? LOOK_AGAIN : 1);
    // the page shows the disks and where they are mounted: it is told when either changed
    const mounted = readText("/proc/mounts");
    if ((last && now !== last) || (mounts && mounted !== mounts)) bus.publish("disks");
    if (mounted !== mounts) lookForReturns();
    mounts = mounted;
    last = now;
    automount = settings.storage.automount;
    if (again > 0) {
      again--;
      void lookAround().catch((e) => console.error("Could not look at the disks:", e instanceof Error ? e.message : e));
    }
  }, LOOK_EVERY_MS);
}

// ---- disks nothing uses yet ----

export interface UnusedDisk {
  /** The serial number, or the name when the disk has none */
  id: string;
  title: string;
  size: number;
  /** A USB stick or disk with files on it: something to copy from rather than to put to use */
  carries: boolean;
}

let unused: UnusedDisk[] = [];

/**
 * A disk that could be prepared and that nothing uses, unless the person said to leave it be. A USB
 * disk Hata connected only until it is unplugged (`passing` — those folders) is still one to copy from.
 */
export function unusedOf(disks: Disk[], ignored: string[], present: (path: string) => boolean = existsSync, passing: string[] = []): UnusedDisk[] {
  const usb = (d: Disk) => d.removable || d.transport === "usb";
  const visiting = (d: Disk) => usb(d) && blockers(d).join() === "mounted" && d.volumes.every((v) => v.mounts.every((path) => passing.includes(path)));
  return disks
    .filter((d) => present(d.path) && (blockers(d).length === 0 || visiting(d)) && !ignored.includes(d.serial || d.name))
    .map((d) => ({ id: d.serial || d.name, title: diskLabel(d), size: d.size, carries: usb(d) && d.volumes.some((v) => mountable(v) || v.mounts.length > 0) }));
}

function note(disks: Disk[]): void {
  const now = unusedOf(disks, settings.storage.ignored, existsSync, temporary.map((entry) => entry.path));
  const changed = JSON.stringify(now) !== JSON.stringify(unused);
  unused = now;
  if (changed) bus.publish("apps");
}

/** What the last look at the disks found unused: for the "needs attention" list */
export const unusedDisks = (): UnusedDisk[] => unused;

/** Not to be mentioned again: the banner and the home page leave this disk out */
export function ignoreDisk(id: unknown): void {
  if (typeof id !== "string" || !id || id.length > 200) return;
  settings.storage.ignored = [...settings.storage.ignored.filter((other) => other !== id), id].slice(-100);
  saveSettings();
  unused = unused.filter((d) => d.id !== id);
  bus.publish("apps");
}

// ---- for the page ----

export interface MountingReport {
  /** The disks can be opened from here at all (not in a container) */
  possible: boolean;
  automount: boolean;
  /** Per disk, why it may not be erased; an empty list — it may */
  blockers: Record<string, Blocker[]>;
  /** The file systems that can be connected as they are, by device */
  mountable: string[];
  /** The folders Hata connected: kept in /etc/fstab, or until the disk is unplugged */
  ours: Record<string, "kept" | "temporary">;
  /** The merged folders, with the folders each is made of */
  pools: Record<string, string[]>;
  /** The connected folders that can be merged into one */
  mergeable: string[];
  /** The disks nothing uses that are said so on top of the page */
  unused: UnusedDisk[];
  /** Per disk, the room no partition takes, bytes — where another partition can be made */
  free: Record<string, number>;
  /** Per disk, what may be formatted, checked or renamed (`changeable`) */
  changeable: Record<string, { whole: boolean; volumes: string[] }>;
}

/** The connected folders that can be merged into one now */
export const mergeableNow = (): string[] => mergeable(fstab(), [...mountedAt().keys()], [settings.snapraid.parity, settings.snapraid.parity2]);

/** The folders Hata connected */
function oursNow(): MountingReport["ours"] {
  const ours: MountingReport["ours"] = {};
  for (const entry of fstab()) if (entry.ours) ours[entry.path] = "kept";
  for (const entry of temporary) ours[entry.path] = "temporary";
  return ours;
}

export function mountingReport(disks: Disk[]): MountingReport {
  note(disks);
  const ours = oursNow();
  const lines = fstab();
  return {
    possible: disks.some((d) => existsSync(d.path)),
    automount: settings.storage.automount,
    blockers: Object.fromEntries(disks.map((d) => [d.name, blockers(d)])),
    mountable: disks.flatMap((d) => d.volumes.filter(mountable).map((v) => v.path)),
    ours,
    pools: pools(lines),
    mergeable: mergeable(lines, [...mountedAt().keys()], [settings.snapraid.parity, settings.snapraid.parity2]),
    unused,
    free: Object.fromEntries(disks.map((d) => [d.name, blockers(d).some((b) => b !== "mounted") ? 0 : unallocated(d)])),
    changeable: Object.fromEntries(disks.map((d) => [d.name, changeable(d, Object.keys(ours))])),
  };
}
