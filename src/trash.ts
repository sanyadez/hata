/**
 * The trash of the file manager: what is deleted there is put aside, and can be put back.
 *
 * Every file system has a trash of its own — the folder `.hata-trash` at its top — so that deleting is
 * a rename, done at once whatever the size, and never a copy to another disk. The data folder counts as
 * a top as well: what is deleted in it stays in it, not at the root of the system. An entry is a folder
 * `<trash>/<id>/` with `meta.json` (where it lay, when it was deleted, by whom) and `item`, the deleted
 * thing itself. There is no list kept apart: the trash is what lies in those folders. An entry is
 * removed for good `KEEP_DAYS` after it was deleted.
 *
 * Nothing here knows the rules of the file manager (what may be deleted, where one may write): that is
 * `files.ts`, which calls this.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { DATA_DIR, settings } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";

export const TRASH_DIR = ".hata-trash";
/** How long a deleted thing is kept */
export const KEEP_DAYS = 30;

const ITEM = "item";
const META = "meta.json";
const ID_RE = /^[a-z0-9]{10,40}$/;

export interface TrashItem {
  id: string;
  /** What it was called */
  name: string;
  /** Where it lay, the whole path */
  from: string;
  type: "dir" | "file" | "other";
  /** Bytes: the file, or everything in the folder */
  size: number;
  /** How many files a folder held */
  files: number;
  /** When it was deleted, ms */
  at: number;
  /** Who deleted it */
  by: string;
}

/** Whether a path leads into a trash (or is one) */
export const inTrash = (path: string): boolean => path.split(sep).includes(TRASH_DIR);

/** The mount points of `/proc/self/mounts` */
export const mountPoints = (mounts: string): string[] => [...new Set(mounts.split("\n").flatMap((line) => (line.split(" ")[1] ? [line.split(" ")[1]!.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))] : [])))];

/**
 * The top of the file system a folder is on: the folder to go up to before something else begins —
 * a mount point, or a place where the device changes (a subvolume). A rename works anywhere below it.
 * `dev` gives the device of a path, null when it cannot be told.
 */
export function topOf(dir: string, dev: (path: string) => number | null, mounts: string[]): string {
  const device = dev(dir);
  for (let at = dir; ; ) {
    const up = dirname(at);
    if (up === at || mounts.includes(at) || dev(up) !== device) return at;
    at = up;
  }
}

/** The entry described by a `meta.json`; null for what is not one */
export function readMeta(text: string, id: string): TrashItem | null {
  try {
    const m = JSON.parse(text) as Partial<TrashItem>;
    if (typeof m.name !== "string" || typeof m.from !== "string" || !m.from.startsWith("/") || typeof m.at !== "number") return null;
    return { id, name: m.name, from: m.from, type: m.type === "dir" || m.type === "file" ? m.type : "other", size: Number(m.size) || 0, files: Number(m.files) || 0, at: m.at, by: typeof m.by === "string" ? m.by : "" };
  } catch {
    return null;
  }
}

export const expired = (item: TrashItem, now: number): boolean => now - item.at > KEEP_DAYS * 86_400_000;

const newId = (now: number): string => now.toString(36).padStart(9, "0") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

// --- On disk ----------------------------------------------------------------------------------------

const deviceOf = (path: string): number | null => {
  try {
    return lstatSync(path).dev;
  } catch {
    return null;
  }
};

/**
 * Where trashes are looked for. `mounts` — the mount points of the system. `remembered` — the trashes
 * that were used: those at mount points are found without it, but one at the top of a subvolume, which
 * is no mount point, would be lost from sight. Tests put their own world in.
 */
const ROOTS_FILE = join(DATA_DIR, "trash.json");
export const world = {
  mounts: (): string[] => {
    try {
      return mountPoints(readFileSync("/proc/self/mounts", "utf8"));
    } catch {
      return ["/"];
    }
  },
  remembered: new Set(readJsonFile<string[]>(ROOTS_FILE, [], (v) => Array.isArray(v) && v.every((one) => typeof one === "string"))),
};

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Where a trash is kept besides the tops of file systems: the data folder */
const dataTop = (): string => real(settings.dataRoot);

/** The trash that takes what lies in `dir` */
export const trashFor = (dir: string): string => join(topOf(realpathSync(dir), deviceOf, [...world.mounts(), dataTop()]), TRASH_DIR);

const isDir = (path: string): boolean => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Every trash there is: at the mount points, and the remembered ones */
function roots(): string[] {
  const kernel = /^\/(proc|sys|dev|run)(\/|$)/;
  const found = [...[dataTop(), ...world.mounts().filter((path) => !kernel.test(path))].map((path) => join(path, TRASH_DIR)), ...world.remembered].filter(isDir);
  // one trash reached by two paths (a disk mounted twice) is one trash
  const seen = new Set<string>();
  return found.filter((root) => {
    const st = lstatSync(root);
    const key = `${st.dev}:${st.ino}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

function entries(): { root: string; item: TrashItem }[] {
  const out: { root: string; item: TrashItem }[] = [];
  for (const root of roots()) {
    let ids: string[] = [];
    try {
      ids = readdirSync(root);
    } catch {
      continue;
    }
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      try {
        const item = readMeta(readFileSync(join(root, id, META), "utf8"), id);
        // the thing itself may be a link that leads nowhere: it is there all the same
        if (item && lstatSync(join(root, id, ITEM))) out.push({ root, item });
      } catch {
        // half an entry: not shown, swept away with the expired ones
      }
    }
  }
  return out.sort((a, b) => b.item.at - a.item.at || b.item.id.localeCompare(a.item.id));
}

/** What is in the trash, the latest deleted first */
export const listTrash = (): TrashItem[] => entries().map((entry) => entry.item);

/**
 * Puts `path` into the trash of its file system. Throws what the file system said when no trash can be
 * kept there (read-only, no room for a folder) — the caller then offers to delete for good.
 */
export function putInTrash(path: string, info: Pick<TrashItem, "type" | "size" | "files">, by: string, now = Date.now()): TrashItem {
  const root = trashFor(dirname(path));
  // deleted things are nobody's to look at: not the apps', not of those who connect over the network
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const item: TrashItem = { id: newId(now), name: basename(path), from: path, ...info, at: now, by };
  const dir = join(root, item.id);
  mkdirSync(dir, { mode: 0o700 });
  try {
    writeFileSync(join(dir, META), JSON.stringify(item, null, 2));
    renameSync(path, join(dir, ITEM));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  if (!world.remembered.has(root)) {
    world.remembered.add(root);
    writeJsonAtomic(ROOTS_FILE, [...world.remembered]);
  }
  return item;
}

export const findInTrash = (id: string): TrashItem | null => entries().find((entry) => entry.item.id === id)?.item ?? null;

/** Moves an entry out of the trash to `to`, where nothing may lie; false when there is no such entry */
export function takeFromTrash(id: string, to: string): boolean {
  const entry = entries().find((one) => one.item.id === id);
  if (!entry) return false;
  renameSync(join(entry.root, id, ITEM), to);
  rmSync(join(entry.root, id), { recursive: true, force: true });
  return true;
}

/** Removes entries for good: the ones named, or all of them; says how many */
export async function purgeTrash(ids: string[] | null): Promise<number> {
  const gone = entries().filter((entry) => ids === null || ids.includes(entry.item.id));
  for (const entry of gone) await rm(join(entry.root, entry.item.id), { recursive: true, force: true });
  return gone.length;
}

/** Removes what has been in the trash for longer than it is kept, and what is left of broken entries */
export async function sweepTrash(now = Date.now()): Promise<void> {
  const whole = new Set(entries().map((entry) => join(entry.root, entry.item.id)));
  for (const entry of entries()) if (expired(entry.item, now)) await rm(join(entry.root, entry.item.id), { recursive: true, force: true }).catch(() => {});
  for (const root of roots()) {
    for (const id of readdirSync(root)) {
      const dir = join(root, id);
      // a folder that never became an entry, left by a crash long ago
      if (ID_RE.test(id) && !whole.has(dir) && now - (lstatSync(dir).mtimeMs || now) > 86_400_000) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
