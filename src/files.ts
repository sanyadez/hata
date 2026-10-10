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
import { chmodSync, chownSync, existsSync, lchownSync, lstatSync, mkdirSync, realpathSync, renameSync, statfsSync, statSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { lstat, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { AppError } from "./apps";
import { DATA_DIR, saveSettings, SECRETS_DIR, settings } from "./config";
import { movePath } from "./dashboard";
import { writablePath } from "./smbconf";
import { findInTrash, inTrash, KEEP_DAYS, listTrash, purgeTrash, putInTrash, sweepTrash, takeFromTrash, TRASH_DIR, type TrashItem } from "./trash";
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, type ZipSource } from "./zip";

/** A folder's listing holds at most this many entries */
const LIST_LIMIT = 5000;
/** Larger files are not opened in the editor */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Counting what a removal takes with it stops here */
const SUMMARY_LIMIT = 200_000;
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
  disk: { total: number; free: number } | null;
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
  if (["EACCES", "EPERM", "EROFS", "EBUSY"].includes(code)) return new AppError("files.denied", 403, { code });
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
  return {
    path: dir,
    readOnly: !isWritable(dir),
    home,
    pinned: settings.folders,
    shared: settings.shares.map((share) => share.path),
    entries,
    truncated: shown.length > LIST_LIMIT,
    places: top.filter((e) => e.type === "dir" && !e.name.startsWith(".")).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 40),
    disk: diskOf(dir),
  };
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

/** The folders of the dashboard; one that is gone (a disk not mounted) is still shown, marked */
export function pinnedFolders(): { path: string; name: string; missing: boolean }[] {
  return settings.folders.map((path) => ({ path, name: basename(path) || "/", missing: !existsSync(path) }));
}

/** A pinned folder that was moved or renamed (or one inside what was) stays pinned; a removed one is dropped */
function repin(from: string, to: string | null): void {
  const next = settings.folders.flatMap((path) => (!inside(path, from) ? [path] : to === null ? [] : [to + path.slice(from.length)]));
  if (next.join("\n") === settings.folders.join("\n")) return;
  settings.folders = [...new Set(next)];
  settings.dashboard = movePath(settings.dashboard, from, to);
  saveSettings();
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
 * Moves or copies entries into the folder `to`. Nothing is overwritten: a name taken there is an
 * error — except for a copy into the same folder, which gets the next free name.
 */
export async function transfer(paths: unknown, to: unknown, copy: boolean): Promise<void> {
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
  for (const { from, dest } of plan) {
    if (copy) await copyTree(from, dest);
    else {
      try {
        renameSync(from, dest);
        repin(from, dest);
        reshare(from, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw fsError(e);
        // another disk: a copy, then the original is removed
        await copyTree(from, dest);
        await rm(from, { recursive: true, force: false }).catch((e2) => {
          throw fsError(e2);
        });
        repin(from, dest);
        reshare(from, dest);
      }
    }
  }
}

/** The system's `cp -a`: owners, permissions, times and links stay as they are, which the apps depend on */
async function copyTree(from: string, dest: string): Promise<void> {
  const proc = Bun.spawn(["cp", "-a", "--", from, dest], { stdout: "ignore", stderr: "pipe" });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code === 0) return;
  if (/No space left/i.test(err)) throw new AppError("files.noSpace", 507);
  throw new AppError("files.failed", 500, { code: err.trim().split("\n").pop() || `cp exited with ${code}` });
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
        if (code === "ENOENT") throw fsError(e);
        // a disk that takes no trash (read-only, another one beneath a link): the page offers to delete for good
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
  return { items, size: items.reduce((sum, item) => sum + item.size, 0), keepDays: KEEP_DAYS };
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
  const target = join(into, validName(part.name));
  const existing = lstatOrNull(target);
  if (existing && (!part.overwrite || !existing.isFile())) throw new AppError("files.exists", 409, { name: basename(target) });

  const tmp = join(into, `.hata-upload-${part.id}`);
  const have = part.offset === 0 ? 0 : (lstatOrNull(tmp)?.size ?? -1);
  if (have !== part.offset) throw new AppError("files.uploadOrder", 409);
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
