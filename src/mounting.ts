/**
 * Putting a disk to use: preparing a new one, connecting one that already holds files, taking one out.
 *
 * - **Prepare** erases a whole disk: a GPT table with one partition, ext4, mounted under /mnt and
 *   written to /etc/fstab by UUID with `nofail`, so the server starts without the disk too.
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
import { DATA_DIR, SECRETS_DIR, settings } from "./config";
import { connected, diskLabel, type Disk, type Volume } from "./disks";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { installCommand, packageManager, PATH, run } from "./packages";

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

/** The name of a mount under /mnt, and of the file system's label */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LABEL_MAX = 16;

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

/** The connected folders that can be merged: Hata's own, kept, of a file system with owners, in no merged folder yet */
export function mergeable(entries: FstabEntry[], mounted: string[]): string[] {
  const taken = new Set(Object.values(pools(entries)).flat());
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
const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
};

/** Something holds the device open from above: LVM, RAID, an encrypted volume */
const held = (name: string): boolean => {
  try {
    return readdirSync(`/sys/class/block/${name}/holders`).length > 0;
  } catch {
    return false;
  }
};

/** The kernel's own word on whether anything of the disk is in use — asked right before erasing */
function inUse(disk: Disk): boolean {
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
    result = await run(["mount", path], 60_000);
  } else {
    result = await run(["mount", "-t", type, "-o", options, volume.path, path], 60_000);
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

/**
 * Erases a disk and makes it Hata's: one partition, ext4, mounted at /mnt/<name> from now on.
 * `seen` is the disk as the person saw it when confirming — a letter that moved to another disk in
 * between must not get that disk erased.
 */
export function prepareDisk(name: string, seen: { serial: string; size: number }, label: string, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    if (!NAME_RE.test(label)) return { error: "disk.badName" };
    const path = join(MOUNT_ROOT, label);
    const disk = (await connected()).find((d) => d.name === name);
    if (!disk || !existsSync(disk.path)) return { error: "disk.unknown" };
    if (disk.serial !== seen.serial || disk.size !== seen.size) return { error: "disk.changed" };
    if (blockers(disk).length || inUse(disk)) return { error: "disk.inUse" };
    if (!freeFolder(path) || fstab().some((e) => e.path === path)) return { error: "disk.folderTaken" };
    const pkg = partitionPackage();
    if (!has("sfdisk")) return { error: "disk.noPartitionTool", needs: { package: pkg, install: installCommand(pkg) } };
    if (!has("mkfs.ext4")) return { error: "disk.noFormatTool", needs: { package: "e2fsprogs", install: installCommand("e2fsprogs") } };

    const settle = async () => {
      if (has("udevadm")) await run(["udevadm", "settle", "--timeout=10"], 15_000);
    };
    // old signatures first: a file system found again on the new partition would be mounted as it was
    for (const device of [...disk.volumes.map((v) => v.path), disk.path]) await run(["wipefs", "-a", device], 30_000);
    const table = await run(["sfdisk", "--wipe", "always", "--wipe-partitions", "always", disk.path], 60_000, {}, "label: gpt\n,,L\n");
    if (table.code !== 0) return { error: "disk.prepareFailed", message: said(table) };
    await settle();
    let part: Volume | undefined;
    for (let i = 0; i < 20 && !part; i++) {
      part = (await connected()).find((d) => d.name === name)?.volumes.find((v) => v.kind === "part" && existsSync(v.path));
      if (!part) await Bun.sleep(500);
    }
    if (!part) return { error: "disk.prepareFailed", message: "The new partition did not show up." };
    // -m 0: no blocks kept back for root on a disk that holds data, not the system
    const made = await run(["mkfs.ext4", "-F", "-q", "-m", "0", "-L", label.slice(0, LABEL_MAX), part.path], 60 * 60_000);
    if (made.code !== 0) return { error: "disk.prepareFailed", message: said(made) };
    await settle();
    const uuid = (await run(["blkid", "-s", "UUID", "-o", "value", part.path], 15_000)).out.trim();
    if (!uuid) return { error: "disk.prepareFailed", message: "The new file system has no UUID." };
    const failed = await attach({ path: part.path, uuid, fstype: "ext4" }, path, true);
    if (failed) return failed;
    // the apps' own user owns the new disk, as it owns their data: an app can write to it at once
    try {
      chownSync(path, settings.puid, settings.pgid);
      chmodSync(path, 0o775);
    } catch {}
    record("system.disk.prepare", { user, detail: `${diskLabel(disk)} → ${path}` });
    return { path };
  });
}

/** Connects a file system as it is; `keep` — from now on, also after a restart */
export function connectVolume(device: string, label: string, keep: boolean, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    if (!NAME_RE.test(label)) return { error: "disk.badName" };
    const disk = (await connected()).find((d) => d.volumes.some((v) => v.path === device));
    const volume = disk?.volumes.find((v) => v.path === device);
    if (!disk || !volume || !existsSync(volume.path)) return { error: "disk.unknown" };
    if (!mountable(volume) || held(volume.name)) return { error: "disk.inUse" };
    const path = join(MOUNT_ROOT, label);
    if (fstab().some((e) => e.path === path)) return { error: "disk.folderTaken" };
    const failed = await attach(volume, path, keep);
    if (failed) return failed;
    ejected.delete(volume.uuid || volume.path);
    record("system.disk.connect", { user, detail: `${volume.label || diskLabel(disk)} → ${path}` });
    return { path };
  });
}

/** Shows several connected folders as one, at /mnt/<name> */
export function mergeFolders(branches: unknown, label: string, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    if (!NAME_RE.test(label)) return { error: "disk.badName" };
    const lines = fstab();
    const can = mergeable(lines, [...mountedAt().keys()]);
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
    const result = await run(["mount", path], 60_000);
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

/** Unmounts a folder Hata connected and forgets it; other mounts of the system are not Hata's to end */
export function disconnect(path: string, user: string): Promise<Outcome> {
  return oneAtATime(async () => {
    const kept = fstab().find((e) => e.ours && e.path === path);
    const index = temporary.findIndex((t) => t.path === path);
    if (!kept && index < 0) return { error: "disk.notOurs" };
    if (Object.values(pools(fstab())).some((branches) => branches.includes(path))) return { error: "disk.holds.pool" };
    // a disk of the array taken away is a disk that failed, as far as the parity knows
    // (one that is gone already is let go: its replacement takes the same folder)
    if (mountedAt().has(path) && (settings.snapraid.parity === path || settings.snapraid.data.some((d) => d.path === path))) return { error: "disk.holds.array" };
    const used = holds(path, { dataRoot: settings.dataRoot, backupDir: settings.backup.dir, state: [DATA_DIR, SECRETS_DIR], shares: settings.shares.map((s) => s.path) });
    if (used) return { error: `disk.holds.${used}` };
    const device = mountedAt().get(path);
    if (device) {
      const result = await run(["umount", path], 120_000);
      if (result.code !== 0) return { error: "disk.busy", message: said(result) };
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
    if (device) {
      // taken out by hand: not to be connected again by itself while it stays plugged in
      const volume = (await connected()).flatMap((d) => d.volumes).find((v) => v.path === device);
      ejected.add(volume?.uuid || device);
      await powerDown(device);
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
  return oneAtATime(async () => {
    if (process.getuid?.() !== 0 || !existsSync(FSTAB)) return;
    const text = readText(FSTAB);
    const next = upgradeLines(text);
    if (next !== text) {
      writeFstab(next);
      await reload();
    }
    for (const entry of fstab()) if (entry.ours && existsSync(entry.path)) await seal(entry.path);
  });
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
  return oneAtATime(async () => {
    const disks = await connected();
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
    mounts = mounted;
    last = now;
    automount = settings.storage.automount;
    if (again > 0) {
      again--;
      void lookAround().catch((e) => console.error("Could not look at the disks:", e instanceof Error ? e.message : e));
    }
  }, LOOK_EVERY_MS);
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
}

export function mountingReport(disks: Disk[]): MountingReport {
  const ours: MountingReport["ours"] = {};
  const lines = fstab();
  for (const entry of lines) if (entry.ours) ours[entry.path] = "kept";
  for (const entry of temporary) ours[entry.path] = "temporary";
  return {
    possible: disks.some((d) => existsSync(d.path)),
    automount: settings.storage.automount,
    blockers: Object.fromEntries(disks.map((d) => [d.name, blockers(d)])),
    mountable: disks.flatMap((d) => d.volumes.filter(mountable).map((v) => v.path)),
    ours,
    pools: pools(lines),
    mergeable: mergeable(lines, [...mountedAt().keys()]),
  };
}
