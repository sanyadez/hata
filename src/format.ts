/**
 * Formatting: the file systems Hata makes, and what each needs said to the programs that make, check
 * and name them. Everything here is a pure function — the running part is in `mounting.ts`.
 *
 * - ext4 is for a disk that stays in the server: it keeps owners and permissions, which apps need.
 * - exFAT is for a disk or a stick that travels: every computer, phone and television of today reads it.
 * - FAT32 is for old devices (car stereos, printers, cameras); no file over 4 GB.
 * - NTFS is for a disk that goes to Windows.
 * - btrfs keeps a checksum of every block, so damage is found, and takes snapshots; for a disk that stays.
 * - XFS is quick with large files and many of them; for a disk that stays. It can grow, never shrink.
 */

export type Fs = "ext4" | "exfat" | "vfat" | "ntfs" | "btrfs" | "xfs";

/** The program that makes a file system, and the system package it comes in */
export const FORMATS: Record<Fs, { tool: string; package: string }> = {
  ext4: { tool: "mkfs.ext4", package: "e2fsprogs" },
  exfat: { tool: "mkfs.exfat", package: "exfatprogs" },
  vfat: { tool: "mkfs.fat", package: "dosfstools" },
  ntfs: { tool: "mkfs.ntfs", package: "ntfs-3g" },
  btrfs: { tool: "mkfs.btrfs", package: "btrfs-progs" },
  xfs: { tool: "mkfs.xfs", package: "xfsprogs" },
};

/** File systems that keep owners and permissions, as apps need: a disk that stays in the server */
export const POSIX: Fs[] = ["ext4", "btrfs", "xfs"];
export const isPosix = (fs: Fs): boolean => POSIX.includes(fs);

export const isFs = (v: unknown): v is Fs => typeof v === "string" && Object.hasOwn(FORMATS, v);

/** lsblk's name of a file system as one of ours; null — not one Hata checks or names */
export const familyOf = (fstype: string): Fs | null => (/^ext[234]$/.test(fstype) ? "ext4" : ["exfat", "vfat", "ntfs", "btrfs", "xfs"].includes(fstype) ? (fstype as Fs) : null);

const TIB = 1024 ** 4;
/** FAT32 and a partition table of the old kind both end at 2 TiB */
export const FAT_MAX = 2 * TIB;

/** As much of a text as fits: `width` says how much room a character takes */
function fit(text: string, max: number, width: (char: string) => number): string {
  let out = "";
  let used = 0;
  for (const char of text) {
    used += width(char);
    if (used > max) break;
    out += char;
  }
  return out.trim();
}

/**
 * A label the file system can carry, made of what the person typed. FAT32 takes eleven capital Latin
 * letters and digits, exFAT eleven characters of any language, NTFS thirty-two, ext4 sixteen bytes,
 * XFS twelve bytes without spaces, btrfs 255.
 */
export function cleanLabel(fs: Fs, text: string): string {
  const plain = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (fs === "vfat") {
    const ascii = plain.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[*?.,;:/\\|+=<>[\]"]/g, "").toUpperCase().trim();
    return fit(ascii, 11, () => 1);
  }
  if (fs === "ext4") return fit(plain.replace(/\//g, "-"), 16, (char) => Buffer.byteLength(char));
  // XFS's own tools take a new label as one word: a space would split it
  if (fs === "xfs") return fit(plain.replace(/[/\s]/g, "-"), 12, (char) => Buffer.byteLength(char));
  if (fs === "btrfs") return fit(plain.replace(/\//g, "-"), 255, (char) => Buffer.byteLength(char));
  return fit(plain.replace(/["*/:<>?\\|]/g, ""), fs === "exfat" ? 11 : 32, (char) => char.length);
}

/**
 * The partition table for a disk formatted whole: the old kind for a removable disk with a file system
 * of other devices — that is what televisions, stereos and cameras expect — GPT for everything else.
 */
export const tableFor = (fs: Fs, size: number, removable: boolean): "gpt" | "dos" => (!isPosix(fs) && removable && size <= FAT_MAX ? "dos" : "gpt");

/** The type of a partition that holds this file system: Windows opens only one it takes for its own */
export function partType(table: "gpt" | "dos", fs: Fs): string {
  if (table === "gpt") return isPosix(fs) ? "0FC63DAF-8483-4772-8E79-3D69D8477DE4" : "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7";
  return isPosix(fs) ? "83" : fs === "vfat" ? "c" : "7";
}

export const MIB = 1024 * 1024;
/** The smallest partition worth making, and the room a partition table takes for itself */
export const PART_MIN = 64 * MIB;
export const TABLE_ROOM = 8 * MIB;

/** One partition as sfdisk reads it: `size` bytes, or 0 for all the room there is */
export const partLine = (table: "gpt" | "dos", fs: Fs, size = 0): string => `,${size ? Math.floor(size / MIB) + "MiB" : ""},${partType(table, fs)}\n`;

/** What sfdisk reads to make a new table with one partition: over the whole disk, or of `size` bytes */
export const tableScript = (table: "gpt" | "dos", fs: Fs, size = 0): string => `label: ${table}\n${partLine(table, fs, size)}`;

/**
 * The room of a disk no partition takes, bytes — by the sizes alone, less what the table needs; 0 for
 * a disk without a partition table. Good for saying "there is room for another partition".
 */
export function unallocated(disk: { size: number; volumes: { kind: string; size: number }[] }): number {
  const parts = disk.volumes.filter((v) => v.kind === "part");
  if (!parts.length || parts.length !== disk.volumes.length) return 0;
  const left = disk.size - parts.reduce((sum, v) => sum + v.size, 0) - TABLE_ROOM;
  return left >= PART_MIN ? left : 0;
}

/**
 * The command that makes the file system. `legacy` — mkfs.exfat is the one of exfat-utils, which names
 * the label differently.
 */
export function mkfsCommand(fs: Fs, label: string, device: string, about: { size: number; legacy?: boolean }): string[] {
  const named = (flag: string) => (label ? [flag, label] : []);
  // -m 0: no blocks kept back for root on a disk that holds data, not the system
  if (fs === "ext4") return ["mkfs.ext4", "-F", "-m", "0", ...named("-L"), device];
  // a small one is left to choose FAT16 by itself: FAT32 needs some room
  if (fs === "vfat") return ["mkfs.fat", ...(about.size >= 512 * 1024 * 1024 ? ["-F", "32"] : []), ...named("-n"), device];
  if (fs === "exfat") return ["mkfs.exfat", ...named(about.legacy ? "-n" : "-L"), device];
  // -f: over whatever was there before (wipefs has cleared it anyway)
  if (fs === "btrfs") return ["mkfs.btrfs", "-f", ...named("-L"), device];
  if (fs === "xfs") return ["mkfs.xfs", "-f", ...named("-L"), device];
  // -Q: without writing zeros over the whole partition
  return ["mkfs.ntfs", "-Q", ...named("-L"), device];
}

/** The program that checks a file system — it comes in the package that makes it */
export const CHECKERS: Record<Fs, string> = { ext4: "e2fsck", exfat: "fsck.exfat", vfat: "fsck.fat", ntfs: "ntfsfix", btrfs: "btrfs", xfs: "xfs_repair" };

/**
 * btrfs is not mended offline: `btrfs check --repair` is known to make things worse, and its own
 * advice is a scrub while mounted, which mends from the checksums. Hata looks only.
 */
export const mendable = (fs: Fs): boolean => fs !== "btrfs";

/** Looking for damage (`repair` false: nothing is written) or mending it */
export function checkCommand(fs: Fs, repair: boolean, device: string): string[] {
  // -C 1: how far it is, as lines among the rest (`passProgress` reads them)
  if (fs === "ext4") return ["e2fsck", "-f", "-C", "1", repair ? "-y" : "-n", device];
  if (fs === "vfat") return ["fsck.fat", repair ? "-a" : "-n", device];
  if (fs === "exfat") return ["fsck.exfat", repair ? "-y" : "-n", device];
  if (fs === "btrfs") return ["btrfs", "check", "--readonly", device];
  if (fs === "xfs") return ["xfs_repair", ...(repair ? [] : ["-n"]), device];
  // -d also takes off the mark "not closed properly", with which the kernel refuses to open the volume
  return ["ntfsfix", repair ? "-d" : "-n", device];
}

/** A line of e2fsck's own count ("2 150 3727 /dev/sdb1") in words; null — the line is something else */
export function passProgress(line: string): string | null {
  const m = /^(\d) (\d+) (\d+) \S+$/.exec(line.trim());
  if (!m) return null;
  const share = Number(m[3]) > 0 ? Math.min(100, Math.round((Number(m[2]) / Number(m[3])) * 100)) : 0;
  return `pass ${m[1]} of 5: ${share}%`;
}

/** clean — nothing wrong; fixed — it was and is mended; errors — damage that is still there; failed — the check itself could not run */
export type Verdict = "clean" | "fixed" | "errors" | "failed";

/** What the exit code of a check says */
export function checkVerdict(fs: Fs, repair: boolean, code: number): Verdict {
  // ntfsfix and xfs_repair do not say whether there was anything to mend
  if (code === 0) return (fs === "ntfs" || fs === "xfs") && repair ? "fixed" : "clean";
  if (code < 0) return "failed";
  if (fs === "ntfs") return repair ? "failed" : "errors";
  if (fs === "btrfs") return "errors";
  // xfs_repair: 1 — damage found by a look; 2 — its log must be replayed by mounting it first
  if (fs === "xfs") return code === 1 && !repair ? "errors" : "failed";
  if (fs === "vfat") return code === 1 ? (repair ? "fixed" : "errors") : "failed";
  // fsck's own code: 1 and 2 — errors corrected, 4 — errors left, 8 and above — could not work
  if (code >= 8) return "failed";
  if (code & 4) return "errors";
  return repair ? "fixed" : "errors";
}

/** The program that names a file system */
export const LABELLERS: Record<Fs, string> = { ext4: "e2label", exfat: "exfatlabel", vfat: "fatlabel", ntfs: "ntfslabel", btrfs: "btrfs", xfs: "xfs_admin" };

export function labelCommand(fs: Fs, device: string, label: string): string[] {
  if (fs === "btrfs") return ["btrfs", "filesystem", "label", device, label];
  if (fs === "xfs") return ["xfs_admin", "-L", label, device];
  return [LABELLERS[fs], device, label];
}

/** A label that can be given while the file system is mounted: ext4 and btrfs take it in use */
export const labelsInUse = (fs: Fs): boolean => fs === "ext4" || fs === "btrfs";

/** The file system as people call it */
export const FS_NAMES: Record<Fs, string> = { ext4: "ext4", exfat: "exFAT", vfat: "FAT32", ntfs: "NTFS", btrfs: "btrfs", xfs: "XFS" };

// ---- one partition made larger or smaller, or taken away ----

export interface TablePart {
  node: string;
  /** The partition's number on the disk, as sfdisk and /sys count it */
  number: number;
  start: number;
  /** Sectors */
  size: number;
  type: string;
}

export interface Table {
  label: "gpt" | "dos" | string;
  sectorSize: number;
  /** The first sector no partition may reach */
  end: number;
  parts: TablePart[];
}

/** `sfdisk -J <disk>` into the table; `diskBytes` bounds it when sfdisk does not say where it ends (MBR) */
export function parseSfdisk(json: unknown, diskBytes: number): Table | null {
  const t = (json as { partitiontable?: Record<string, unknown> } | null)?.partitiontable;
  if (!t || typeof t !== "object") return null;
  const sectorSize = typeof t.sectorsize === "number" && t.sectorsize > 0 ? t.sectorsize : 512;
  const parts = (Array.isArray(t.partitions) ? t.partitions : [])
    .map((p: Record<string, unknown>) => ({ node: String(p.node ?? ""), number: Number(/(\d+)$/.exec(String(p.node ?? ""))?.[1] ?? 0), start: Number(p.start), size: Number(p.size), type: String(p.type ?? "") }))
    .filter((p) => p.node && Number.isFinite(p.start) && Number.isFinite(p.size));
  const last = typeof t.lastlba === "number" ? t.lastlba + 1 : Math.floor(diskBytes / sectorSize);
  return { label: String(t.label ?? ""), sectorSize, end: Math.min(last, Math.floor(diskBytes / sectorSize)), parts };
}

/** An MBR partition that holds others (an extended one), or one inside it */
const EXTENDED = /^(5|f|85)$/i;
export const nested = (table: Table, part: TablePart): boolean => table.label === "dos" && (EXTENDED.test(part.type) || part.number > 4);

/** How large a partition may grow, bytes: up to the next partition or the end of the disk, in whole MiB */
export function roomFor(table: Table, part: TablePart): number {
  const next = Math.min(table.end, ...table.parts.filter((p) => p.start > part.start).map((p) => p.start));
  const sectors = next - part.start;
  return Math.floor((sectors * table.sectorSize) / MIB) * MIB;
}

/** What each file system lets be done to its size, and whether it must be mounted for that */
export const RESIZE: Record<Fs, { grow: boolean; shrink: boolean; mounted: boolean; tool: string; package: string }> = {
  ext4: { grow: true, shrink: true, mounted: false, tool: "resize2fs", package: "e2fsprogs" },
  btrfs: { grow: true, shrink: true, mounted: true, tool: "btrfs", package: "btrfs-progs" },
  xfs: { grow: true, shrink: false, mounted: true, tool: "xfs_growfs", package: "xfsprogs" },
  ntfs: { grow: true, shrink: true, mounted: false, tool: "ntfsresize", package: "ntfs-3g" },
  exfat: { grow: false, shrink: false, mounted: false, tool: "", package: "" },
  vfat: { grow: false, shrink: false, mounted: false, tool: "", package: "" },
};

/** What sfdisk reads to give partition `n` a new size, keeping where it starts */
export const resizeScript = (sectors: number): string => `,${sectors}\n`;

/**
 * The commands that change the file system itself; the partition is changed before them when it
 * grows and after them when it shrinks. `place` — the mount point for those changed while mounted,
 * the device for the rest; `devid` — btrfs's number of this device in its file system.
 */
export function fsResizeCommand(fs: Fs, place: string, bytes: number | "max", devid = 1): string[] {
  const kib = bytes === "max" ? "" : String(Math.floor(bytes / 1024));
  if (fs === "ext4") return ["resize2fs", place, ...(kib ? [`${kib}K`] : [])];
  if (fs === "btrfs") return ["btrfs", "filesystem", "resize", `${devid}:${bytes === "max" ? "max" : `${kib}k`}`, place];
  if (fs === "xfs") return ["xfs_growfs", place];
  // ntfsresize asks to be sure — it is answered on its input; a bare number is bytes (its "k" is 1000)
  return ["ntfsresize", "--force", ...(bytes === "max" ? [] : ["--size", String(Math.floor(bytes))]), place];
}
