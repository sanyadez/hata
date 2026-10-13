/**
 * Formatting: the file systems Hata makes, and what each needs said to the programs that make, check
 * and name them. Everything here is a pure function — the running part is in `mounting.ts`.
 *
 * - ext4 is for a disk that stays in the server: it keeps owners and permissions, which apps need.
 * - exFAT is for a disk or a stick that travels: every computer, phone and television of today reads it.
 * - FAT32 is for old devices (car stereos, printers, cameras); no file over 4 GB.
 * - NTFS is for a disk that goes to Windows.
 */

export type Fs = "ext4" | "exfat" | "vfat" | "ntfs";

/** The program that makes a file system, and the system package it comes in */
export const FORMATS: Record<Fs, { tool: string; package: string }> = {
  ext4: { tool: "mkfs.ext4", package: "e2fsprogs" },
  exfat: { tool: "mkfs.exfat", package: "exfatprogs" },
  vfat: { tool: "mkfs.fat", package: "dosfstools" },
  ntfs: { tool: "mkfs.ntfs", package: "ntfs-3g" },
};

export const isFs = (v: unknown): v is Fs => typeof v === "string" && Object.hasOwn(FORMATS, v);

/** lsblk's name of a file system as one of ours; null — not one Hata checks or names */
export const familyOf = (fstype: string): Fs | null => (/^ext[234]$/.test(fstype) ? "ext4" : fstype === "exfat" || fstype === "vfat" || fstype === "ntfs" ? fstype : null);

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
 * letters and digits, exFAT eleven characters of any language, NTFS thirty-two, ext4 sixteen bytes.
 */
export function cleanLabel(fs: Fs, text: string): string {
  const plain = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (fs === "vfat") {
    const ascii = plain.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[*?.,;:/\\|+=<>[\]"]/g, "").toUpperCase().trim();
    return fit(ascii, 11, () => 1);
  }
  if (fs === "ext4") return fit(plain.replace(/\//g, "-"), 16, (char) => Buffer.byteLength(char));
  return fit(plain.replace(/["*/:<>?\\|]/g, ""), fs === "exfat" ? 11 : 32, (char) => char.length);
}

/**
 * The partition table for a disk formatted whole: the old kind for a removable disk with a file system
 * of other devices — that is what televisions, stereos and cameras expect — GPT for everything else.
 */
export const tableFor = (fs: Fs, size: number, removable: boolean): "gpt" | "dos" => (fs !== "ext4" && removable && size <= FAT_MAX ? "dos" : "gpt");

/** The type of a partition that holds this file system: Windows opens only one it takes for its own */
export function partType(table: "gpt" | "dos", fs: Fs): string {
  if (table === "gpt") return fs === "ext4" ? "0FC63DAF-8483-4772-8E79-3D69D8477DE4" : "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7";
  return fs === "ext4" ? "83" : fs === "vfat" ? "c" : "7";
}

/** What sfdisk reads to make one partition over the whole disk */
export const tableScript = (table: "gpt" | "dos", fs: Fs): string => `label: ${table}\n,,${partType(table, fs)}\n`;

/**
 * The command that makes the file system. `legacy` — mkfs.exfat is the one of exfat-utils, which names
 * the label differently.
 */
export function mkfsCommand(fs: Fs, label: string, device: string, about: { size: number; legacy?: boolean }): string[] {
  const named = (flag: string) => (label ? [flag, label] : []);
  // -m 0: no blocks kept back for root on a disk that holds data, not the system
  if (fs === "ext4") return ["mkfs.ext4", "-F", "-q", "-m", "0", ...named("-L"), device];
  // a small one is left to choose FAT16 by itself: FAT32 needs some room
  if (fs === "vfat") return ["mkfs.fat", ...(about.size >= 512 * 1024 * 1024 ? ["-F", "32"] : []), ...named("-n"), device];
  if (fs === "exfat") return ["mkfs.exfat", ...named(about.legacy ? "-n" : "-L"), device];
  // -Q: without writing zeros over the whole partition
  return ["mkfs.ntfs", "-Q", "-q", ...named("-L"), device];
}

/** The program that checks a file system — it comes in the package that makes it */
export const CHECKERS: Record<Fs, string> = { ext4: "e2fsck", exfat: "fsck.exfat", vfat: "fsck.fat", ntfs: "ntfsfix" };

/** Looking for damage (`repair` false: nothing is written) or mending it */
export function checkCommand(fs: Fs, repair: boolean, device: string): string[] {
  if (fs === "ext4") return ["e2fsck", "-f", repair ? "-y" : "-n", device];
  if (fs === "vfat") return ["fsck.fat", repair ? "-a" : "-n", device];
  if (fs === "exfat") return ["fsck.exfat", repair ? "-y" : "-n", device];
  // -d also takes off the mark "not closed properly", with which the kernel refuses to open the volume
  return ["ntfsfix", repair ? "-d" : "-n", device];
}

/** clean — nothing wrong; fixed — it was and is mended; errors — damage that is still there; failed — the check itself could not run */
export type Verdict = "clean" | "fixed" | "errors" | "failed";

/** What the exit code of a check says */
export function checkVerdict(fs: Fs, repair: boolean, code: number): Verdict {
  if (code === 0) return fs === "ntfs" && repair ? "fixed" : "clean";
  if (code < 0) return "failed";
  if (fs === "ntfs") return repair ? "failed" : "errors";
  if (fs === "vfat") return code === 1 ? (repair ? "fixed" : "errors") : "failed";
  // fsck's own code: 1 and 2 — errors corrected, 4 — errors left, 8 and above — could not work
  if (code >= 8) return "failed";
  if (code & 4) return "errors";
  return repair ? "fixed" : "errors";
}

/** The program that names a file system */
export const LABELLERS: Record<Fs, string> = { ext4: "e2label", exfat: "exfatlabel", vfat: "fatlabel", ntfs: "ntfslabel" };

export const labelCommand = (fs: Fs, device: string, label: string): string[] => [LABELLERS[fs], device, label];

/** The file system as people call it */
export const FS_NAMES: Record<Fs, string> = { ext4: "ext4", exfat: "exFAT", vfat: "FAT32", ntfs: "NTFS" };
