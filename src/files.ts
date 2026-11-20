/**
 * The file manager: the server's files in the browser, for administrators.
 *
 * Paths are the real ones ("/DATA/Media", "/etc/hosts"); the page opens in the data root
 * (`settings.dataRoot`). An administrator of Hata already runs containers as root, so nothing is hidden —
 * the limits here are against a slip of the hand, not against the administrator:
 * - `/`, the folders right under it (`/etc`, `/usr`, …), the data root with its `AppData`, and Hata's
 *   own binary cannot be removed, renamed or moved;
 * - Hata's state directory can be looked at but not changed: the server holds that state in memory and
 *   would write over an edit;
 * - `/proc`, `/sys` and `/dev` are listed and that is all — reading some of those files never ends.
 * What is deleted goes to the trash (`trash.ts`) unless told otherwise, and can be put back from there.
 * Every check is made on the path as written and on the real one (`realpath`), so a symbolic link does
 * not get around them. Hata runs as root while apps run as `PUID:PGID`, so whatever is created here takes
 * the owner of the folder it is created in — otherwise an app could not touch a file uploaded into its
 * own folder.
 */
import { chmodSync, chownSync, existsSync, readdirSync, lchownSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { lstat, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { record } from "./activity";
import { AppError, startJob, stoppable, type Job } from "./apps";
import { DATA_DIR, saveSettings, SECRETS_DIR, settings, trashDays, type Favorite } from "./config";
import { COMPILED } from "./version";
import { movePath } from "./dashboard";
import { parseMounts } from "./disks";
import { answered, networkMounts, roomOf } from "./netroom";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { writablePath } from "./smbconf";
import { findInTrash, inTrash, keepDays, listTrash, purgeTrash, putInTrash, sweepTrash, takeFromTrash, TRASH_DIR, type TrashItem } from "./trash";
import { openZip } from "./unzip";
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, type ZipSource } from "./zip";

/** A folder's listing holds at most this many entries */
const LIST_LIMIT = 5000;
/** Larger files are not opened in the editor */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Counting what a removal takes with it stops here */
const SUMMARY_LIMIT = 200_000;
/** How long counting a folder's size may take */
const SIZE_LIMIT_MS = 120_000;
/** A file that is being uploaded, in the folder it will land in; not listed */
const PART_RE = /^\.hata-upload-[a-z0-9]{8,32}$/;
const PART_MAX_AGE = 24 * 3600_000;

export type EntryType = "dir" | "file" | "other";

export interface Entry {
  name: string;
  /** "other" — a device, a socket, or a link that leads nowhere */
  type: EntryType;
  /** Bytes; 0 for folders */
  size: number;
  modified: number;
  /** A symbolic link (type and size are its target's) */
  link?: true;
}

export interface Listing {
  path: string;
  /** Nothing can be created or changed in this folder */
  readOnly: boolean;
  /** The data root: where the page opens */
  home: string;
  entries: Entry[];
  /** There is more in the folder than `entries` holds */
  truncated: boolean;
  /** Folders that are on the dashboard */
  pinned: string[];
  /** Folders shared over the network */
  shared: string[];
  /** Folders at the top of the data root: the places of the sidebar */
  places: string[];
  /** The other file systems of the server — disks and network folders — by the folder they are mounted at */
  disks: Volume[];
  disk: { total: number; free: number } | null;
}

/** A file system mounted somewhere: what the file manager shows as a disk */
export interface Volume {
  path: string;
  /** The label of the file system; "" — it has none, the folder's name is shown */
  label: string;
  /** Bytes; 0 — not known */
  total: number;
  free: number;
  network: boolean;
  readOnly: boolean;
}

export interface Summary {
  files: number;
  dirs: number;
  size: number;
  /** Counting stopped at the limit: there is more */
  truncated: boolean;
}

const root = () => settings.dataRoot;

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** The real path; for something that does not exist yet — the real path of its nearest existing parent plus the rest */
function realish(path: string): string {
  let head = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return rest.length ? join(realpathSync(head), ...rest.reverse()) : realpathSync(head);
    } catch {
      const up = dirname(head);
      if (up === head) return path;
      rest.push(basename(head));
      head = up;
    }
  }
}

export { realish as realPath, inside as within };

/** A path of the API → the absolute path on disk, tidied ("/a/../b" is "/b") */
export function locate(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new AppError("files.badPath");
  return resolve(path);
}

const VIRTUAL = ["/proc", "/sys", "/dev"];

/** The kernel's own file systems: listed, never read or written */
function isVirtual(abs: string): boolean {
  const real = realish(abs);
  return VIRTUAL.some((dir) => inside(abs, dir) || inside(real, dir));
}

/** May something be created, changed or removed at this path? */
function isWritable(abs: string): boolean {
  return !isVirtual(abs) && ![DATA_DIR, SECRETS_DIR].some((dir) => inside(abs, dir) || inside(realish(abs), realish(dir)));
}

function mustWrite(abs: string): void {
  if (isVirtual(abs)) throw new AppError("files.virtual", 403);
  if (!isWritable(abs)) throw new AppError("files.protected", 403);
}

/** What the server stands on: Hata's state and binary, the apps' folders */
const keystones = () => [DATA_DIR, join(root(), "AppData"), process.execPath, "/usr/local/bin/hata"];

/** Folders every Linux has right under `/` */
const SYSTEM_DIRS = new Set("bin boot dev etc home lib lib32 lib64 libx32 media mnt opt proc root run sbin srv sys tmp usr var".split(" ").map((name) => "/" + name));

/** `/`, the system's folders under it and whatever holds a keystone stay where they are */
function mustBeMovable(abs: string): void {
  mustWrite(abs);
  const real = join(realish(dirname(abs)), basename(abs));
  if (abs === "/" || basename(abs) === TRASH_DIR || SYSTEM_DIRS.has(abs) || SYSTEM_DIRS.has(real) || keystones().some((key) => inside(key, abs) || inside(realish(key), real))) throw new AppError("files.protected", 403);
}

/** What is the system's own all the way down: nothing in there is a folder to hand out */
const CLOSED = "bin boot etc lib lib32 lib64 libx32 run sbin usr".split(" ").map((name) => "/" + name);

/** A folder that may go out to the network: not `/`, not the system's, nothing that holds Hata's state or lies in it */
export function mustBeSharable(abs: string): void {
  mustBeDir(abs);
  const real = realish(abs);
  const state = [DATA_DIR, SECRETS_DIR].map(realish);
  if (real === "/" || SYSTEM_DIRS.has(real) || isVirtual(abs) || CLOSED.some((dir) => inside(real, dir)) || state.some((dir) => inside(dir, real) || inside(real, dir))) throw new AppError("shares.protected", 403);
}

/**
 * What a link for somebody without an account may give or take files into: a file or a folder that is
 * not the system's, not Hata's state and not in a trash. Says whether it is a folder.
 */
export function mustBeLinkable(abs: string): boolean {
  let st: Stats;
  try {
    st = statSync(abs);
  } catch (e) {
    throw fsError(e);
  }
  const real = realish(abs);
  const state = [DATA_DIR, SECRETS_DIR].map(realish);
  const closed = real === "/" || isVirtual(abs) || CLOSED.some((dir) => inside(real, dir)) || state.some((dir) => inside(dir, real) || inside(real, dir)) || real.split(sep).includes(TRASH_DIR) || (st.isDirectory() && SYSTEM_DIRS.has(real));
  if (closed) throw new AppError("links.protected", 403);
  if (!st.isDirectory() && !st.isFile()) throw new AppError("files.notFile");
  return st.isDirectory();
}

/** A name for a new file or folder: one path segment */
export function validName(name: unknown): string {
  const text = typeof name === "string" ? name.trim() : "";
  if (!text || text === "." || text === ".." || /[/\0]/.test(text) || Buffer.byteLength(text) > 255) throw new AppError("files.badName");
  return text;
}

function fsError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = (e as NodeJS.ErrnoException).code ?? "";
  if (code === "ENOENT") return new AppError("files.notFound", 404);
  if (code === "EEXIST" || code === "ENOTEMPTY" || code === "ERR_FS_CP_EEXIST") return new AppError("files.exists", 409, { name: "" });
  if (code === "ENOTDIR") return new AppError("files.notDir");
  if (code === "ENOSPC" || code === "EDQUOT") return new AppError("files.noSpace", 507);
  if (code === "EROFS") return new AppError("files.readOnlyDisk", 403);
  if (["EACCES", "EPERM", "EBUSY"].includes(code)) return new AppError("files.denied", 403, { code });
  return new AppError("files.failed", 500, { code: code || (e instanceof Error ? e.message : String(e)) });
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function mustBeDir(abs: string): void {
  let st: Stats;
  try {
    st = statSync(abs);
  } catch (e) {
    throw fsError(e);
  }
  if (!st.isDirectory()) throw new AppError("files.notDir");
}

/** What is created here belongs to whoever owns the folder it is created in */
function inheritOwner(path: string): void {
  if (process.getuid?.() !== 0) return;
  try {
    const parent = statSync(dirname(path));
    lchownSync(path, parent.uid, parent.gid);
  } catch {}
}

async function entryOf(dir: string, name: string): Promise<Entry | null> {
  const abs = join(dir, name);
  // a network place whose server is silent (or not heard of yet) is shown as a folder without a look inside
  if (networkMounts().includes(abs) && answered(abs) !== true) return { name, type: "dir", size: 0, modified: 0 };
  const own = await lstat(abs).catch(() => null);
  if (!own) return null;
  let st = own;
  let type: EntryType | null = null;
  if (own.isSymbolicLink()) {
    const target = await stat(abs).catch(() => null);
    if (!target) type = "other";
    else st = target;
  }
  type ??= st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
  return { name, type, size: type === "file" ? st.size : 0, modified: Math.round(st.mtimeMs), ...(own.isSymbolicLink() ? { link: true as const } : {}) };
}

export async function list(path: unknown): Promise<Listing> {
  // without a path — the data root; a fresh machine has none until the first app is installed
  if (path === "" && !existsSync(root())) mkdirSync(root(), { recursive: true });
  const dir = path === "" ? resolve(root()) : locate(path);
  mustBeDir(dir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    throw fsError(e);
  }
  const shown: string[] = [];
  for (const name of names) {
    // the trash has a page of its own
    if (name === TRASH_DIR) continue;
    if (!PART_RE.test(name)) shown.push(name);
    // an upload abandoned a day ago will not be continued
    else if (Date.now() - (lstatOrNull(join(dir, name))?.mtimeMs ?? Date.now()) > PART_MAX_AGE) rm(join(dir, name), { force: true }).catch(() => {});
  }
  const entries = (await Promise.all(shown.slice(0, LIST_LIMIT).map((name) => entryOf(dir, name)))).filter((e): e is Entry => e !== null);
  const home = resolve(root());
  const top = dir === home ? entries : (await Promise.all((await readdir(home).catch(() => [])).slice(0, LIST_LIMIT).map((name) => entryOf(home, name)))).filter((e): e is Entry => e !== null);
  const disks = otherDisks(home);
  // inside a network place the room is what `df` told, never statfs here: a made-up petabyte, or a wait for a silent server
  const on = disks.filter((d) => dir === d.path || dir.startsWith(d.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];
  return {
    path: dir,
    readOnly: !isWritable(dir),
    home,
    pinned: settings.folders,
    shared: settings.shares.map((share) => share.path),
    entries,
    truncated: shown.length > LIST_LIMIT,
    places: top.filter((e) => e.type === "dir" && !e.name.startsWith(".")).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 40),
    disks,
    disk: on?.network ? (on.total ? { total: on.total, free: on.free } : null) : diskOf(dir),
  };
}

function otherDisks(home: string): Volume[] {
  let mounts: ReturnType<typeof parseMounts> = [];
  try {
    mounts = parseMounts(readFileSync("/proc/mounts", "utf8")).filter((mount) => mount.path !== "/" && mount.path !== home).slice(0, 20);
  } catch {}
  const labels = labelsByDevice();
  // a network place is called by the name it was given (read here, not imported: no side effects)
  const saved = readJsonFile<{ places?: unknown }>(join(SECRETS_DIR, "netplaces.json"), {}).places;
  const named = new Map<string, string>((Array.isArray(saved) ? saved : []).filter((p) => typeof p?.slug === "string" && typeof p?.name === "string").map((p) => [`/mnt/net/${p.slug}`, p.name as string] as const));
  return mounts.map((mount) => {
    // a server that does not answer would stop this process in statfs
    const room = mount.network ? roomOf(mount.path) : diskOf(mount.path);
    return { path: mount.path, label: named.get(mount.path) ?? labels.get(realOrSame(mount.device)) ?? "", total: room?.total ?? 0, free: room?.free ?? 0, network: mount.network, readOnly: mount.readOnly };
  });
}

const realOrSame = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** A name as udev writes it into a link: unsafe bytes as `\\xNN`, the rest UTF-8 */
export function udevName(name: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < name.length; ) {
    const escaped = /^\\x([0-9a-f]{2})/i.exec(name.slice(i, i + 4));
    if (escaped) {
      bytes.push(parseInt(escaped[1]!, 16));
      i += 4;
    } else {
      const char = String.fromCodePoint(name.codePointAt(i)!);
      bytes.push(...new TextEncoder().encode(char));
      i += char.length;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Device → the label of its file system, from udev's links (`/dev/disk/by-label/My\x20Disk`) */
function labelsByDevice(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = "/dev/disk/by-label";
  try {
    for (const name of readdirSync(dir)) out.set(realOrSame(join(dir, name)), udevName(name));
  } catch {}
  return out;
}

// --- Folders on the dashboard -----------------------------------------------------------------------

const MAX_PINNED = 24;

/** Puts a folder on the dashboard or takes it off */
export function pinFolder(path: unknown, on: boolean): void {
  const dir = locate(path);
  if (on) {
    mustBeDir(dir);
    if (settings.folders.includes(dir)) return;
    if (settings.folders.length >= MAX_PINNED) throw new AppError("files.tooManyPinned", 409, { max: MAX_PINNED });
    settings.folders = [...settings.folders, dir];
  } else settings.folders = settings.folders.filter((pinned) => pinned !== dir);
  saveSettings();
}

/**
 * The folders of the dashboard; one that is gone (a disk not mounted) is still shown, marked. A folder
 * that is a disk or a network place is called by its name and says how full it is.
 */
export function pinnedFolders(): { path: string; name: string; missing: boolean; disk?: Volume }[] {
  const disks = settings.folders.length ? otherDisks(resolve(root())) : [];
  return settings.folders.map((path) => {
    const disk = disks.find((volume) => volume.path === path);
    // a folder on a network place is not looked at while its server is silent: that look would stop the whole server
    const missing = answered(path) === false || (answered(path) === true && !existsSync(path));
    return { path, name: disk?.label || basename(path) || "/", missing, ...(disk ? { disk } : {}) };
  });
}

// --- Favourites ---------------------------------------------------------------------------------------

const MAX_FAVORITES = 40;

/** Marks a folder or a file as a favourite of one user, or takes the mark off */
export function setFavorite(userId: string, path: unknown, on: boolean): Favorite[] {
  const abs = locate(path);
  const mine = settings.favorites[userId] ?? [];
  if (on) {
    const stat = lstatOrNull(abs);
    if (!stat) throw new AppError("files.notFound", 404);
    if (mine.some((one) => one.path === abs)) return mine;
    if (mine.length >= MAX_FAVORITES) throw new AppError("files.tooManyFavorites", 409, { max: MAX_FAVORITES });
    settings.favorites = { ...settings.favorites, [userId]: [...mine, { path: abs, dir: stat.isDirectory() }] };
  } else settings.favorites = { ...settings.favorites, [userId]: mine.filter((one) => one.path !== abs) };
  if (!settings.favorites[userId]!.length) delete settings.favorites[userId];
  saveSettings();
  return favoritesOf(userId);
}

export function favoritesOf(userId: string): Favorite[] {
  return settings.favorites[userId] ?? [];
}

/** A user who is removed takes the favourites along */
export function dropFavorites(userId: string): void {
  if (!settings.favorites[userId]) return;
  delete settings.favorites[userId];
  saveSettings();
}

/** A pinned folder that was moved or renamed (or one inside what was) stays pinned; a removed one is dropped */
function repin(from: string, to: string | null): void {
  for (const listener of pathListeners) listener(from, to);
  const moved = (path: string) => (!inside(path, from) ? [path] : to === null ? [] : [to + path.slice(from.length)]);
  const follow = (paths: string[]) => [...new Set(paths.flatMap(moved))];
  const favorites = Object.fromEntries(Object.entries(settings.favorites).map(([id, list]) => [id, list.flatMap((one) => moved(one.path).map((path) => ({ ...one, path })))]));
  const next = follow(settings.folders);
  if (next.join("\n") === settings.folders.join("\n") && JSON.stringify(favorites) === JSON.stringify(settings.favorites)) return;
  settings.favorites = favorites;
  settings.folders = next;
  settings.dashboard = movePath(settings.dashboard, from, to);
  saveSettings();
}

/** A folder that was moved by something other than the file manager: what pointed into it follows */
export function folderMoved(from: string, to: string): void {
  repin(from, to);
  reshare(from, to);
}

const pathListeners: ((from: string, to: string | null) => void)[] = [];

/** Told of every path the file manager moved, renamed or removed (`to` null), and of a moved data folder */
export function onPathMoved(listener: (from: string, to: string | null) => void): void {
  pathListeners.push(listener);
}

let sharesMoved: () => void = () => {};

/** Called when a shared folder was moved, renamed or removed and the list of shares changed with it */
export function onSharesMoved(listener: () => void): void {
  sharesMoved = listener;
}

/** A shared folder that was moved or renamed (or one inside what was) stays shared; a removed one is not any more */
function reshare(from: string, to: string | null): void {
  const next = settings.shares.flatMap((share) => (!inside(share.path, from) ? [share] : to === null ? [] : [{ ...share, path: to + share.path.slice(from.length) }])).filter((share) => writablePath(share.path));
  if (next.map((share) => share.path).join("\n") === settings.shares.map((share) => share.path).join("\n")) return;
  settings.shares = next;
  saveSettings();
  sharesMoved();
}

function diskOf(path: string): Listing["disk"] {
  try {
    const s = statfsSync(path);
    const total = s.blocks * s.bsize;
    return total > 0 ? { total, free: s.bavail * s.bsize } : null;
  } catch {
    return null;
  }
}

function pathList(paths: unknown): string[] {
  if (!Array.isArray(paths) || !paths.length || paths.length > 1000) throw new AppError("files.badPath");
  return paths as string[];
}

/** How much a removal would take with it (links are counted, not followed) */
export async function summary(paths: unknown): Promise<Summary> {
  const out: Summary = { files: 0, dirs: 0, size: 0, truncated: false };
  let seen = 0;
  const walk = async (abs: string): Promise<void> => {
    if (out.truncated) return;
    if (++seen > SUMMARY_LIMIT) return void (out.truncated = true);
    const st = await lstat(abs).catch(() => null);
    if (!st) return;
    if (!st.isDirectory()) {
      out.files++;
      if (st.isFile()) out.size += st.size;
      return;
    }
    out.dirs++;
    for (const name of await readdir(abs).catch(() => [] as string[])) await walk(join(abs, name));
  };
  for (const path of pathList(paths)) await walk(locate(path));
  return out;
}

/** How much room a folder or file takes on its disk: `du` in a child, so a folder of a million files does not hold the server */
export async function sizeOf(path: unknown): Promise<{ size: number }> {
  const abs = locate(path);
  if (!lstatOrNull(abs)) throw new AppError("files.notFound", 404);
  const du = Bun.spawn(["du", "-sk", "--", abs], { stdout: "pipe", stderr: "ignore", signal: AbortSignal.timeout(SIZE_LIMIT_MS) });
  const said = await new Response(du.stdout).text();
  await du.exited;
  // folders it may not read make du fail, yet the number it gives is still what it could count
  const kb = Number(/^(\d+)\s/.exec(said)?.[1]);
  if (!Number.isFinite(kb)) throw new AppError("files.sizeTooLong", 504);
  return { size: kb * 1024 };
}

export function makeFolder(dir: unknown, name: unknown): string {
  const parent = locate(dir);
  mustBeDir(parent);
  mustWrite(parent);
  const target = join(parent, validName(name));
  if (lstatOrNull(target)) throw new AppError("files.exists", 409, { name: basename(target) });
  try {
    mkdirSync(target);
  } catch (e) {
    throw fsError(e);
  }
  inheritOwner(target);
  return target;
}

/** A new empty file, for the editor to fill */
export function makeFile(dir: unknown, name: unknown): string {
  const parent = locate(dir);
  mustBeDir(parent);
  mustWrite(parent);
  const target = join(parent, validName(name));
  if (lstatOrNull(target)) throw new AppError("files.exists", 409, { name: basename(target) });
  try {
    writeFileSync(target, "", { flag: "wx", mode: 0o644 });
  } catch (e) {
    throw fsError(e);
  }
  inheritOwner(target);
  return target;
}

export function rename(path: unknown, name: unknown): string {
  const from = locate(path);
  if (!lstatOrNull(from)) throw new AppError("files.notFound", 404);
  mustBeMovable(from);
  const to = join(dirname(from), validName(name));
  if (to === from) return to;
  // a change of letter case only is the same entry on a case-insensitive disk
  if (lstatOrNull(to) && to.toLowerCase() !== from.toLowerCase()) throw new AppError("files.exists", 409, { name: basename(to) });
  try {
    renameSync(from, to);
  } catch (e) {
    throw fsError(e);
  }
  repin(from, to);
  reshare(from, to);
  return to;
}

/** "photo.jpg" → "photo (2).jpg", the first that is free in `dir` */
export function freeName(dir: string, name: string, taken = (candidate: string) => lstatOrNull(join(dir, candidate)) !== null): string {
  if (!taken(name)) return name;
  const ext = name.startsWith(".") ? "" : extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * A copy of files, or a move to another disk, goes on apart from Hata: `cp` runs in a unit of its own
 * (systemd), so a restart of Hata — an update of it among them — does not end it. What each such job is
 * doing is kept on the disk; at the next start Hata takes the job up again under the same id: the card on
 * the page goes on. Where there is no systemd to ask (or Hata is not root) `cp` is Hata's own child as
 * before, and what a restart cut is removed at the next start — half a file under the right name and of
 * nearly the right size is worse than none. The original is whole in every case.
 */
const COPYING = join(DATA_DIR, "file-jobs.json");
interface CopyItem {
  from: string;
  dest: string;
  /** The copy is complete (the mark of its unit was seen, or `cp` ended well) */
  whole: boolean;
  /** Everything about it is over: for a move the original is gone too */
  done: boolean;
  /** The unit copying it, when it runs apart from Hata */
  unit?: string;
}
interface CopyJob {
  id: string;
  key: string;
  copy: boolean;
  user: string;
  target: string;
  named: string;
  items: CopyItem[];
  /** Bytes there are to copy, and the free room of the target when it began: the percent goes on from them */
  total?: number;
  before?: number;
}
let copying: CopyJob[] = [];
const keepCopying = () => {
  try {
    writeJsonAtomic(COPYING, copying);
  } catch {
    // a state folder that cannot be written: the copy goes on all the same
  }
};

/** Whether `cp` can run apart from Hata: systemd that leaves the names of files alone (254 and later) */
let apartKnown: boolean | null = null;
function canRunApart(): boolean {
  if (apartKnown !== null) return apartKnown;
  apartKnown = false;
  // the installed service only: a run from source and the tests keep `cp` as their own child
  if (!COMPILED || process.getuid?.() !== 0 || !existsSync("/run/systemd/system") || !Bun.which("systemd-run")) return false;
  const said = Bun.spawnSync({ cmd: ["systemd-run", "--version"], stdout: "pipe", stderr: "ignore" }).stdout.toString();
  apartKnown = Number(/^systemd (\d+)/.exec(said)?.[1] ?? 0) >= 254;
  return apartKnown;
}

/** The mark a unit leaves when its copy ended well; in /run, so a restart of the whole server takes it away */
const markOf = (unit: string) => `/run/${unit}.ok`;

/** The state of a copy's unit: still at it, ended well (its mark is there), or not */
async function unitState(unit: string): Promise<"running" | "ok" | "failed"> {
  if (existsSync(markOf(unit))) return "ok";
  const proc = Bun.spawn(["systemctl", "show", `${unit}.service`, "-p", "ActiveState"], { stdout: "pipe", stderr: "ignore" });
  const state = /ActiveState=(\S+)/.exec(await new Response(proc.stdout).text())?.[1] ?? "";
  if (state === "active" || state === "activating" || state === "deactivating") return "running";
  // it may have ended between the two looks
  return existsSync(markOf(unit)) ? "ok" : "failed";
}

/** Why a unit's copy failed: the last thing `cp` said */
async function unitWords(unit: string): Promise<string> {
  const proc = Bun.spawn(["journalctl", "-u", `${unit}.service`, "-n", "5", "--no-pager", "-o", "cat"], { stdout: "pipe", stderr: "ignore" });
  const lines = (await new Response(proc.stdout).text()).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("cp:"));
  return lines.pop() ?? "";
}

const forgetUnit = (unit: string) => {
  rmSync(markOf(unit), { force: true });
  Bun.spawnSync({ cmd: ["systemctl", "reset-failed", `${unit}.service`], stdout: "ignore", stderr: "ignore" });
};

/** One entry copied, apart from Hata where that can be; an entry already being copied by its unit is waited for */
async function copyItem(item: CopyItem, stop: AbortSignal): Promise<void> {
  const failed = async (words: string): Promise<never> => {
    // half a copy is of no use to anybody; the original is still whole
    await rm(item.dest, { recursive: true, force: true }).catch(() => {});
    if (stop.aborted) throw new Error("Stopped: what was copied so far is removed, the original is untouched");
    throw new Error(/No space left/i.test(words) ? "The disk is full" : words || "The copy did not end well");
  };
  if (!item.unit && !canRunApart()) {
    const cp = Bun.spawn(["cp", "-a", "--", item.from, item.dest], { stdout: "ignore", stderr: "pipe", signal: stop });
    const [code, err] = await Promise.all([cp.exited, new Response(cp.stderr).text()]);
    if (code !== 0) await failed(err.trim().split("\n").pop() ?? "");
    return;
  }
  if (!item.unit) {
    const unit = `hata-copy-${crypto.randomUUID().slice(0, 12)}`;
    const started = Bun.spawnSync({
      // the names go as arguments, and systemd is told to leave "$" in them alone
      cmd: ["systemd-run", "--unit", unit, "--quiet", "--no-block", "--expand-environment=no", "/bin/sh", "-c", 'cp -a -- "$1" "$2" && : > "$3"', "sh", item.from, item.dest, markOf(unit)],
      stdout: "ignore",
      stderr: "pipe",
    });
    if (started.exitCode !== 0) await failed(started.stderr.toString().trim().split("\n").pop() ?? "");
    item.unit = unit;
    keepCopying();
  }
  const unit = item.unit!;
  const onStop = () => void Bun.spawn(["systemctl", "stop", `${unit}.service`], { stdout: "ignore", stderr: "ignore" });
  stop.addEventListener("abort", onStop);
  try {
    for (;;) {
      const state = await unitState(unit);
      if (state === "ok") break;
      if (state === "failed" || stop.aborted) {
        // a unit asked to stop takes a moment to let the files go
        if (stop.aborted) await Bun.spawn(["systemctl", "stop", `${unit}.service`], { stdout: "ignore", stderr: "ignore" }).exited;
        const words = await unitWords(unit);
        forgetUnit(unit);
        delete item.unit;
        await failed(words.replace(/^cp:\s*/, ""));
      }
      await Bun.sleep(1000);
    }
  } finally {
    stop.removeEventListener("abort", onStop);
  }
  forgetUnit(unit);
  delete item.unit;
}

/** A copy job's work, from wherever it stands: also what goes on after a restart of Hata */
function runCopy(state: CopyJob, taken: boolean): Job {
  const stopper = new AbortController();
  const said = () => record(state.copy ? "files.copy" : "files.move", { user: state.user, detail: `${state.named} → ${state.target}` });
  const job = startJob(state.key, state.copy ? "filecopy" : "filemove", state.user, async (log) => {
    try {
      const left = state.items.filter((item) => !item.done);
      if (taken) log("Hata was restarted meanwhile: the copy went on by itself");
      if (state.total === undefined) {
        const du = Bun.spawn(["du", "-skxc", "--", ...left.map((one) => one.from)], { stdout: "pipe", stderr: "ignore", signal: stopper.signal });
        state.total = (Number(/^(\d+)\s+total$/m.exec(await new Response(du.stdout).text())?.[1]) || 0) * 1024;
        const room = statfsSync(state.target);
        if (state.total > room.bavail * room.bsize) throw new AppError("files.noSpace", 507);
        state.before = room.bfree * room.bsize;
        keepCopying();
      }
      const total = state.total;
      log(`${state.copy ? "Copying" : "Moving"} ${megabytes(total)} to ${state.target}`);
      const tick = setInterval(() => {
        const now = statfsSync(state.target);
        log(`  ${megabytes(Math.min(total, Math.max(0, (state.before ?? 0) - now.bfree * now.bsize)))} of ${megabytes(total)}`);
      }, 3000);
      try {
        for (const item of left) {
          if (!item.whole) {
            log(`${item.from} → ${item.dest}`);
            await copyItem(item, stopper.signal);
            // from here on the copy is whole: nothing may take it away
            item.whole = true;
            keepCopying();
          }
          if (!state.copy) {
            await rm(item.from, { recursive: true, force: true });
            repin(item.from, item.dest);
            reshare(item.from, item.dest);
          }
          item.done = true;
          keepCopying();
        }
      } finally {
        clearInterval(tick);
      }
      log(`Done: ${state.items.length} ${state.copy ? "copied" : "moved"} to ${state.target}`);
      said();
    } finally {
      copying = copying.filter((one) => one !== state);
      keepCopying();
    }
  }, true, { app: state.named, machine: "", id: state.id });
  state.id = job.id;
  keepCopying();
  stoppable(job, stopper);
  return job;
}

/**
 * At the start: the copies an earlier Hata left are taken up again where their units still copy or have
 * ended; what was Hata's own child died with it — that half is removed and said in the activity log.
 */
export async function resumeCopies(): Promise<void> {
  const left = readJsonFile<CopyJob[]>(COPYING, []);
  copying = [];
  if (!Array.isArray(left)) return;
  for (const state of left) {
    if (!state || !Array.isArray(state.items) || typeof state.target !== "string") continue;
    const now = state.items.find((item) => !item.done && !item.whole);
    // nothing of it runs apart from Hata: it was cut
    if (now && !now.unit) {
      await rm(now.dest, { recursive: true, force: true }).catch(() => {});
      record(state.copy ? "files.copyCut" : "files.moveCut", { user: state.user, detail: `${state.named} → ${state.target}` });
      continue;
    }
    copying.push(state);
    runCopy(state, true);
  }
  keepCopying();
}

/**
 * Moves or copies entries into the folder `to`. Nothing is overwritten: a name taken there is an
 * error — except for a copy into the same folder, which gets the next free name.
 *
 * What can be done at once is: a move within one disk is a rename. A copy, and a move to another
 * disk, take as long as the files are large — those go on as a job the page shows the progress of
 * and can stop; the answer is that job, or null when everything is done already.
 */
export function transfer(paths: unknown, to: unknown, copy: boolean, user: string): Job | null {
  const target = locate(to);
  mustBeDir(target);
  mustWrite(target);
  const plan = pathList(paths).map((path) => {
    const from = locate(path);
    const st = lstatOrNull(from);
    if (!st) throw new AppError("files.notFound", 404);
    if (!copy) mustBeMovable(from);
    else if (isVirtual(from)) throw new AppError("files.virtual", 403);
    const same = dirname(from) === target;
    if (same && !copy) throw new AppError("files.samePlace");
    const dest = join(target, same ? freeName(target, basename(from)) : basename(from));
    if (lstatOrNull(dest)) throw new AppError("files.exists", 409, { name: basename(dest) });
    if (st.isDirectory() && inside(realish(dest), realish(from))) throw new AppError("files.intoItself");
    return { from, dest };
  });
  const named = plan.length === 1 ? basename(plan[0]!.from) : `${basename(plan[0]?.from ?? "")} +${plan.length - 1}`;
  let long = plan;
  if (!copy) {
    long = [];
    for (const one of plan) {
      try {
        renameSync(one.from, one.dest);
        repin(one.from, one.dest);
        reshare(one.from, one.dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw fsError(e);
        // another disk: a copy, then the original is removed
        long.push(one);
      }
    }
  }
  if (!long.length) {
    if (plan.length) record(copy ? "files.copy" : "files.move", { user, detail: `${named} → ${target}` });
    return null;
  }
  // every such job has a name of its own: two copies may run side by side
  const state: CopyJob = { id: "", key: `files:${crypto.randomUUID().slice(0, 8)}`, copy, user, target, named, items: long.map((one) => ({ ...one, whole: false, done: false })) };
  copying.push(state);
  return runCopy(state, false);
}

/** Entries that are to be sent to another machine: they lie in one folder, which tar is run in */
export function packable(paths: unknown): { dir: string; names: string[] } {
  const all = pathList(paths).map(locate);
  const dir = dirname(all[0]!);
  for (const abs of all) {
    if (dirname(abs) !== dir || abs === "/") throw new AppError("files.badPath");
    if (isVirtual(abs)) throw new AppError("files.virtual", 403);
    if (!lstatOrNull(abs)) throw new AppError("files.notFound", 404);
  }
  return { dir, names: all.map((abs) => basename(abs)) };
}

/** A folder that is to receive entries from another machine, and which of their names it has already */
export function receiving(to: unknown, names: string[]): { dir: string; taken: string[] } {
  const dir = locate(to);
  mustBeDir(dir);
  mustWrite(dir);
  return { dir, taken: names.map(validName).filter((name) => lstatOrNull(join(dir, name)) !== null) };
}

/** File systems that keep no owners and no permissions: what comes from them is everybody's and "executable" */
const OWNERLESS = /^(vfat|msdos|exfat|ntfs|ntfs3|fuseblk|iso9660|udf|hfsplus)$/;

function fstypeAt(path: string): string {
  let best = { path: "", fstype: "" };
  for (const line of readFileSync("/proc/mounts", "utf8").split("\n")) {
    const [, at, fstype] = line.split(" ");
    const mount = (at ?? "").replace(/\\040/g, " ");
    if (mount && fstype && inside(path, mount) && mount.length >= best.path.length) best = { path: mount, fstype };
  }
  return best.fstype;
}

const megabytes = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(n / 1024 ** 2)} MB`);

/**
 * Copies what a plugged-in disk holds — everything chosen, folders and files — into a folder of the
 * server, as a job with a log. The folder is made when it is not there; a name that is taken gets
 * "(2)". From a file system without owners (FAT, exFAT, NTFS) the copies take the owner of the folder
 * they land in and ordinary permissions; from one with owners they stay as they were.
 */
export function copyIn(paths: unknown, to: unknown, user: string): Job {
  const target = locate(to);
  const sources = pathList(paths).map((path) => {
    const from = locate(path);
    if (!lstatOrNull(from)) throw new AppError("files.notFound", 404);
    if (isVirtual(from)) throw new AppError("files.virtual", 403);
    if (inside(realish(target), realish(from))) throw new AppError("files.intoItself");
    return from;
  });
  // the first folder of the way that is there says whether writing is allowed here at all
  let there = target;
  while (!lstatOrNull(there)) there = dirname(there);
  mustBeDir(there);
  mustWrite(target);
  // made before the job: the work spawns its first program at once
  const stopper = new AbortController();
  const job = startJob("", "copyin", user, async (log) => {
    const du = Bun.spawn(["du", "-skxc", "--", ...sources], { stdout: "pipe", stderr: "ignore", signal: stopper.signal });
    const total = (Number(/^(\d+)\s+total$/m.exec(await new Response(du.stdout).text())?.[1]) || 0) * 1024;
    makeFolders(target);
    const room = statfsSync(target);
    if (total > room.bavail * room.bsize) throw new Error(`Not enough room in ${target}: ${megabytes(total)} to copy, ${megabytes(room.bavail * room.bsize)} free`);
    log(`Copying ${megabytes(total)} to ${target}`);
    const before = room.bfree * room.bsize;
    const tick = setInterval(() => {
      const now = statfsSync(target);
      log(`  ${megabytes(Math.max(0, before - now.bfree * now.bsize))} of ${megabytes(total)}`);
    }, 5000);
    try {
      const owner = statSync(target);
      for (const from of sources) {
        const dest = join(target, freeName(target, basename(from)));
        log(`${from} → ${dest}`);
        const plain = OWNERLESS.test(fstypeAt(from));
        if (stopper.signal.aborted) throw new Error("Stopped");
        const cp = Bun.spawn(plain ? ["cp", "-r", "--preserve=timestamps", "--", from, dest] : ["cp", "-a", "--", from, dest], { stdout: "ignore", stderr: "pipe", signal: stopper.signal });
        const [code, err] = await Promise.all([cp.exited, new Response(cp.stderr).text()]);
        if (stopper.signal.aborted) {
          // the one cut half-way goes; what was copied whole before it stays, the disk's own files are untouched
          await rm(dest, { recursive: true, force: true }).catch(() => {});
          log(`Removed the unfinished ${dest}`);
          throw new Error("Stopped");
        }
        if (code !== 0) throw new Error(/No space left/i.test(err) ? "The disk is full" : err.trim().split("\n").pop() || `cp exited with ${code}`);
        if (plain && process.getuid?.() === 0) {
          await Bun.spawn(["chown", "-R", "-h", `${owner.uid}:${owner.gid}`, "--", dest], { stdout: "ignore", stderr: "ignore" }).exited;
          await Bun.spawn(["chmod", "-R", "u=rwX,go=rX", "--", dest], { stdout: "ignore", stderr: "ignore" }).exited;
          await Bun.spawn(["find", dest, "-type", "f", "-exec", "chmod", "644", "{}", "+"], { stdout: "ignore", stderr: "ignore" }).exited;
        }
      }
    } finally {
      clearInterval(tick);
    }
    log(`Done: ${sources.length} copied to ${target}`);
  });
  stoppable(job, stopper);
  return job;
}

/**
 * Deletes files, links (the link, not its target) and folders with everything in them. They go to the
 * trash of their disk; `forever` — or lying in a trash already — removes them for good.
 */
export async function remove(paths: unknown, forever = false, by = ""): Promise<void> {
  const all = pathList(paths).map((path) => {
    const abs = locate(path);
    mustBeMovable(abs);
    return abs;
  });
  for (const abs of all) {
    const st = lstatOrNull(abs);
    if (!st) throw new AppError("files.notFound", 404);
    if (forever || inTrash(abs)) {
      try {
        await rm(abs, { recursive: true, force: false });
      } catch (e) {
        throw fsError(e);
      }
    } else {
      const sum = await summary([abs]);
      try {
        putInTrash(abs, { type: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other", size: sum.size, files: sum.files }, by);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? "";
        // from a read-only disk nothing can be deleted for good either
        if (code === "ENOENT" || code === "EROFS") throw fsError(e);
        // a place that takes no trash: the page offers to delete for good
        throw new AppError("files.noTrash", 409, { name: basename(abs), code });
      }
    }
    repin(abs, null);
    reshare(abs, null);
  }
}

// --- The trash --------------------------------------------------------------------------------------

export interface Trash {
  items: TrashItem[];
  /** Bytes in all of it */
  size: number;
  /** Days a deleted thing is kept */
  keepDays: number;
}

export function trash(): Trash {
  const items = listTrash();
  return { items, size: items.reduce((sum, item) => sum + item.size, 0), keepDays: keepDays() };
}

const idList = (ids: unknown): string[] => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some((id) => typeof id !== "string")) throw new AppError("files.badPath");
  return ids as string[];
};

/** Makes the folders of a path that are not there, each owned as the folder it is made in */
function makeFolders(dir: string): void {
  if (lstatOrNull(dir)) return;
  makeFolders(dirname(dir));
  mkdirSync(dir);
  inheritOwner(dir);
}

/**
 * Puts deleted things back where they lay. A folder that is gone is made again; where the name has been
 * taken since, the thing comes back under the next free one. Returns where each one is now.
 */
export function restore(ids: unknown): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  for (const id of idList(ids)) {
    const item = findInTrash(id);
    if (!item) throw new AppError("files.notFound", 404);
    const dir = dirname(item.from);
    mustWrite(dir);
    try {
      makeFolders(dir);
      const path = join(dir, freeName(dir, item.name));
      takeFromTrash(id, path);
      out.push({ id, path });
    } catch (e) {
      throw fsError(e);
    }
  }
  return out;
}

/** Removes from the trash for good: the entries named, or everything */
export const emptyTrash = (ids: unknown): Promise<number> => purgeTrash(ids === undefined || ids === null ? null : idList(ids));

/** How long the trash keeps things from now on; what has lain there longer goes at once. Says how many went. */
export async function setTrashDays(days: unknown): Promise<number> {
  const kept = trashDays(days);
  if (kept === null) throw new AppError("trash.badDays");
  const before = listTrash().length;
  settings.trash = { days: kept };
  saveSettings();
  await sweepTrash();
  return before - listTrash().length;
}

/** On start and a few times a day: what was deleted long enough ago goes for good */
export function startTrash(): void {
  const sweep = () => void sweepTrash().catch((e) => console.error("Could not tidy the trash:", e instanceof Error ? e.message : e));
  sweep();
  setInterval(sweep, 6 * 3600_000).unref();
}

// --- Upload -----------------------------------------------------------------------------------------

export interface UploadPart {
  dir: unknown;
  name: unknown;
  /** A folder inside `dir` ("trip/day 1") when a whole folder is uploaded; created as needed */
  sub: string;
  /** Names the upload: its parts are appended to one temporary file */
  id: string;
  /** Where in the file this part starts */
  offset: number;
  last: boolean;
  overwrite: boolean;
  /** A name taken already gets "(2)" when the file is put in place, instead of a refusal */
  rename?: boolean;
}

function uploadFolder(dir: unknown, sub: string): string {
  const base = locate(dir);
  mustBeDir(base);
  mustWrite(base);
  const parts = sub.split("/").filter(Boolean);
  if (parts.length > 32) throw new AppError("files.badPath");
  let into = base;
  for (const part of parts) {
    into = join(into, validName(part));
    if (!existsSync(into)) {
      try {
        mkdirSync(into);
      } catch (e) {
        throw fsError(e);
      }
      inheritOwner(into);
    } else mustBeDir(into);
  }
  // a folder on the way may be a link into a place that is not to be written
  mustWrite(into);
  return into;
}

/**
 * Takes one part of a file sent by the browser. A file goes in parts so that neither a proxy's body
 * limit nor a dropped connection gets in the way; parts come in order and the last one puts the file in
 * place. A part that broke off is cut away, so it can be sent again.
 */
export async function upload(part: UploadPart, body: ReadableStream<Uint8Array> | null): Promise<{ received: number; path: string | null }> {
  if (!/^[a-z0-9]{8,32}$/.test(part.id) || !Number.isSafeInteger(part.offset) || part.offset < 0) throw new AppError("files.badUpload");
  const into = uploadFolder(part.dir, part.sub);
  const asked = validName(part.name);
  if (part.rename && PART_RE.test(asked)) throw new AppError("files.badName");
  const target = join(into, part.rename ? freeName(into, asked) : asked);
  const existing = part.rename ? null : lstatOrNull(target);
  if (existing && (!part.overwrite || !existing.isFile())) throw new AppError("files.exists", 409, { name: basename(target) });

  const tmp = join(into, `.hata-upload-${part.id}`);
  const have = part.offset === 0 ? 0 : (lstatOrNull(tmp)?.size ?? -1);
  // `have` lets a page whose part was cut off on the way see whether it arrived after all
  if (have !== part.offset) throw new AppError("files.uploadOrder", 409, { have });
  let received = part.offset;
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(tmp, part.offset === 0 ? "w" : "r+");
    if (body) {
      for await (const chunk of body) {
        await file.write(chunk, 0, chunk.length, received);
        received += chunk.length;
      }
    }
    await file.close();
    file = null;
    if (!part.last) return { received, path: null };
    if (existing) {
      chmodSync(tmp, existing.mode & 0o7777);
      if (process.getuid?.() === 0) chownSync(tmp, existing.uid, existing.gid);
    } else {
      chmodSync(tmp, 0o644);
      inheritOwner(tmp);
    }
    renameSync(tmp, target);
    return { received, path: target };
  } catch (e) {
    await file?.close().catch(() => {});
    try {
      if (part.offset > 0) await open(tmp, "r+").then((f) => f.truncate(part.offset).finally(() => f.close()));
      else unlinkSync(tmp);
    } catch {}
    throw fsError(e);
  }
}

/** Drops what an upload that was cancelled has left */
export function abortUpload(dir: unknown, sub: string, id: string): void {
  if (!/^[a-z0-9]{8,32}$/.test(id)) throw new AppError("files.badUpload");
  const into = join(locate(dir), ...sub.split("/").filter(Boolean).map(validName));
  mustWrite(into);
  try {
    unlinkSync(join(into, `.hata-upload-${id}`));
  } catch {}
}

// --- Reading ----------------------------------------------------------------------------------------

/** What the browser may show in place; everything else is only ever downloaded */
const INLINE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".ogv": "video/ogg",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
  ".pdf": "application/pdf",
};

export interface Readable {
  /** The real path of the file */
  file: string;
  name: string;
  size: number;
  modified: number;
  /** The type to show it in place with; "" — download only */
  inline: string;
}

export function readable(path: unknown): Readable {
  const abs = locate(path);
  if (isVirtual(abs)) throw new AppError("files.virtual", 403);
  let st: Stats;
  let file: string;
  try {
    file = realpathSync(abs);
    st = statSync(file);
  } catch (e) {
    throw fsError(e);
  }
  if (!st.isFile()) throw new AppError("files.notFile");
  return { file, name: basename(abs), size: st.size, modified: Math.round(st.mtimeMs), inline: INLINE_TYPES[extname(abs).toLowerCase()] ?? "" };
}

export interface TextFile {
  path: string;
  content: string;
  /** Given back on save, so that a change made meanwhile by someone else is noticed */
  modified: number;
}

export async function readText(path: unknown): Promise<TextFile> {
  const { file, size, modified } = readable(path);
  if (size > MAX_TEXT_BYTES) throw new AppError("files.tooLargeToEdit", 413, { max: MAX_TEXT_BYTES / 1024 / 1024 });
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
  } catch (e) {
    throw e instanceof TypeError ? new AppError("files.notText", 415) : fsError(e);
  }
  if (content.includes("\0")) throw new AppError("files.notText", 415);
  return { path: locate(path), content, modified };
}

export async function writeText(path: unknown, content: unknown, modified: unknown): Promise<TextFile> {
  if (typeof content !== "string" || content.includes("\0")) throw new AppError("files.notText", 415);
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new AppError("files.tooLargeToEdit", 413, { max: MAX_TEXT_BYTES / 1024 / 1024 });
  const current = readable(path);
  mustWrite(current.file);
  if (typeof modified === "number" && modified !== current.modified) throw new AppError("files.changed", 409);
  // written next to the file and moved into place: a write that breaks off leaves the old file whole
  const tmp = `${current.file}.${process.pid}.tmp`;
  try {
    const st = statSync(current.file);
    writeFileSync(tmp, content);
    chmodSync(tmp, st.mode & 0o7777);
    if (process.getuid?.() === 0) chownSync(tmp, st.uid, st.gid);
    renameSync(tmp, current.file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw fsError(e);
  }
  return readText(path);
}

// --- Download as an archive -------------------------------------------------------------------------

export interface ArchivePlan {
  name: string;
  sources: ZipSource[];
}

/** What goes into the archive: the entries with everything in them. Links are left out. */
export async function archivePlan(paths: unknown): Promise<ArchivePlan> {
  const all = pathList(paths).map((path) => locate(path));
  const sources: ZipSource[] = [];
  let size = 0;
  const add = (source: ZipSource, bytes: number) => {
    size += bytes + source.name.length * 2 + 100;
    if (sources.push(source) > ZIP_MAX_ENTRIES - 1 || size > ZIP_MAX_BYTES * 0.95) throw new AppError("files.archiveTooLarge", 413);
  };
  const walk = async (abs: string, name: string): Promise<void> => {
    const st = await lstat(abs).catch(() => null);
    if (!st || st.isSymbolicLink()) return;
    if (st.isFile()) add({ name, file: abs, mode: st.mode & 0o7777, mtime: st.mtime }, st.size);
    else if (st.isDirectory()) {
      add({ name: name + "/", mode: st.mode & 0o7777, mtime: st.mtime }, 0);
      for (const child of (await readdir(abs).catch(() => [] as string[])).sort()) {
        if (!PART_RE.test(child) && child !== TRASH_DIR) await walk(join(abs, child), `${name}/${child}`);
      }
    }
  };
  const names = new Set<string>();
  for (const abs of all) {
    if (!lstatOrNull(abs)) throw new AppError("files.notFound", 404);
    if (isVirtual(abs)) throw new AppError("files.virtual", 403);
    const name = basename(abs) || "files";
    if (names.has(name)) throw new AppError("files.badPath");
    names.add(name);
    await walk(abs, name);
  }
  const one = all.length === 1 ? [...names][0]! : basename(dirname(all[0]!)) || "files";
  return { name: one + ".zip", sources };
}

// --- Unpacking an archive ---------------------------------------------------------------------------

/** The kind of archive a name says, and the name it would unpack under; null — not one Hata unpacks */
export function archiveKind(name: string): { kind: "zip" | "tar"; stem: string } | null {
  const zip = /^(.+)\.zip$/i.exec(name);
  if (zip) return { kind: "zip", stem: zip[1]! };
  const tar = /^(.+?)(\.tar(\.(gz|bz2|xz|zst))?|\.tgz|\.tbz2?|\.txz)$/i.exec(name);
  return tar ? { kind: "tar", stem: tar[1]! } : null;
}

/**
 * Unpacks a ZIP or tar archive into a new folder next to it, named after it — never over what is there.
 * What is unpacked takes the owner of the folder, like everything made here; a ZIP's links are left
 * out. A failure takes the half-made folder away.
 */
export function extract(path: unknown, user: string): Job {
  const file = locate(path);
  const st = lstatOrNull(file);
  if (!st?.isFile()) throw new AppError("files.notFound", 404);
  const kind = archiveKind(basename(file));
  if (!kind) throw new AppError("files.notArchive", 415);
  const dir = dirname(file);
  mustWrite(dir);
  if (isVirtual(file)) throw new AppError("files.virtual", 403);
  // what can be told before the job: a ZIP that cannot be read, or one with a password
  let zip: ReturnType<typeof openZip> | null = null;
  if (kind.kind === "zip") {
    try {
      zip = openZip(file);
    } catch (e) {
      throw new AppError("files.badArchive", 415, { message: e instanceof Error ? e.message : String(e) });
    }
    const odd = zip.entries.find((e) => e.encrypted || (!e.dir && e.method !== 0 && e.method !== 8));
    if (odd) {
      zip.close();
      throw new AppError(odd.encrypted ? "files.archiveLocked" : "files.badArchive", 415, { message: `compression method ${odd.method}` });
    }
  }
  const target = join(dir, freeName(dir, kind.stem));
  return startJob("", "extract", user, async (log) => {
    const owner = statSync(dir);
    try {
      mkdirSync(target);
      if (zip) {
        const total = zip.entries.reduce((sum, e) => sum + e.size, 0);
        const room = statfsSync(dir);
        if (total > room.bavail * room.bsize) throw new Error(`Not enough room: ${megabytes(total)} to unpack, ${megabytes(room.bavail * room.bsize)} free`);
        log(`Unpacking ${zip.entries.length} entries (${megabytes(total)}) into ${target}`);
        let skipped = 0;
        for (const entry of zip.entries) {
          const dest = join(target, entry.name);
          if (!inside(dest, target)) continue;
          if (entry.link) {
            skipped++;
            continue;
          }
          if (entry.dir) {
            mkdirSync(dest, { recursive: true });
            continue;
          }
          mkdirSync(dirname(dest), { recursive: true });
          // a name met twice keeps the later one, as unzip does
          await zip.extract(entry, dest);
          if (entry.mode) chmodSync(dest, entry.mode | 0o600);
        }
        if (skipped) log(`${skipped} symbolic links left out`);
      } else {
        log(`$ tar -xf ${file} -C ${target}`);
        // GNU tar refuses members that would land outside the folder
        const tar = Bun.spawn(["tar", "-xf", file, "-C", target, "--no-same-owner", "--no-same-permissions"], { stdout: "ignore", stderr: "pipe" });
        const [code, err] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
        for (const line of err.trim().split("\n").filter(Boolean).slice(-5)) log(line);
        if (code !== 0) throw new Error(/No space left/i.test(err) ? "The disk is full" : err.trim().split("\n").pop() || `tar exited with ${code}`);
      }
      if (process.getuid?.() === 0) await Bun.spawn(["chown", "-R", "-h", `${owner.uid}:${owner.gid}`, "--", target], { stdout: "ignore", stderr: "ignore" }).exited;
      log(`Done: ${target}`);
      record("files.extract", { user, detail: `${basename(file)} → ${target}` });
    } catch (e) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw e;
    } finally {
      zip?.close();
    }
  }, true);
}

// --- Finding files ----------------------------------------------------------------------------------

export interface Found {
  path: string;
  type: EntryType;
  size: number;
  modified: number;
}

const FIND_LIMIT = 200;
const FIND_MS = 5000;

/**
 * Files and folders under `path` whose names hold `query` (any case), nearest first. The walk does not
 * follow links, leaves the kernel's folders and the trashes out, and stops after `FIND_LIMIT` finds or
 * `FIND_MS` — then `more` says the list is not whole.
 */
export async function find(path: unknown, query: unknown): Promise<{ found: Found[]; more: boolean }> {
  const root = locate(path);
  mustBeDir(root);
  if (typeof query !== "string" || !query.trim() || query.length > 200) throw new AppError("files.badQuery");
  const needle = query.trim().toLocaleLowerCase();
  const found: Found[] = [];
  const queue = [root];
  const until = Date.now() + FIND_MS;
  while (queue.length) {
    if (found.length >= FIND_LIMIT || Date.now() > until) return { found, more: true };
    const dir = queue.shift()!;
    if (dir !== root && isVirtual(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === TRASH_DIR || entry.name.startsWith(".hata-upload-")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) queue.push(abs);
      if (!entry.name.toLocaleLowerCase().includes(needle)) continue;
      const st = await stat(abs).catch(() => null);
      found.push({ path: abs, type: entry.isDirectory() ? "dir" : st?.isFile() ? "file" : "other", size: st?.isFile() ? st.size : 0, modified: st ? Math.round(st.mtimeMs) : 0 });
      if (found.length >= FIND_LIMIT) break;
    }
  }
  return { found, more: false };
}
