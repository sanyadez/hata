/**
 * The files of a machine, as its client hands them to Hata's file manager. The answers have the shapes
 * of `files.ts` (a listing, a summary, a text file) and the errors its codes, so the page shows a
 * machine's folder the way it shows the server's.
 *
 * This is a smaller cousin of `files.ts`, which leans on Hata's settings and cannot come here: there is
 * no trash (deleting is for good, and the page says so), no pins and no shares. The same guards against
 * a slip of the hand: `/` and the system's folders under it stay where they are, `/proc`, `/sys` and
 * `/dev` are listed only, and the client's own program and state are not touched. New files take the
 * owner of their folder.
 *
 * Between a machine and Hata (or another machine) files travel as a tar stream: `pack` on the side
 * that gives, `unpack` on the side that takes.
 */
import { chmodSync, chownSync, existsSync, lchownSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statfsSync, statSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { lstat, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { MuxError, type Channel } from "./mux";
import { zipChunks, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, type ZipSource } from "./zip";

const LIST_LIMIT = 5000;
const SUMMARY_LIMIT = 200_000;
const MAX_TEXT_BYTES = 1024 * 1024;
const PART_RE = /^\.hata-upload-[a-z0-9]{8,32}$/;

/** The client's own: its program and its state */
const KEYSTONES = ["/usr/local/bin/hata-client", "/var/lib/hata-client", process.execPath];
const VIRTUAL = ["/proc", "/sys", "/dev"];
const SYSTEM_DIRS = new Set("bin boot dev etc home lib lib32 lib64 libx32 media mnt opt proc root run sbin srv sys tmp usr var".split(" ").map((name) => "/" + name));

const fail = (code: string, detail: Record<string, string | number> = {}): never => {
  throw new MuxError(code, code, detail);
};

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

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

function locate(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) fail("files.badPath");
  return resolve(path as string);
}

const isVirtual = (abs: string): boolean => VIRTUAL.some((dir) => inside(abs, dir) || inside(realish(abs), dir));

function mustWrite(abs: string): void {
  if (isVirtual(abs)) fail("files.virtual");
  if (KEYSTONES.some((key) => inside(abs, key) || inside(realish(abs), key))) fail("files.protected");
}

function mustBeMovable(abs: string): void {
  mustWrite(abs);
  const real = join(realish(dirname(abs)), basename(abs));
  if (abs === "/" || SYSTEM_DIRS.has(abs) || SYSTEM_DIRS.has(real) || KEYSTONES.some((key) => inside(key, abs) || inside(key, real))) fail("files.protected");
}

function validName(name: unknown): string {
  const text = typeof name === "string" ? name.trim() : "";
  if (!text || text === "." || text === ".." || /[/\0]/.test(text) || Buffer.byteLength(text) > 255) fail("files.badName");
  return text;
}

function fsError(e: unknown): MuxError {
  if (e instanceof MuxError) return e;
  const code = (e as NodeJS.ErrnoException).code ?? "";
  if (code === "ENOENT") return new MuxError("files.notFound");
  if (code === "EEXIST" || code === "ENOTEMPTY") return new MuxError("files.exists", "files.exists", { name: "" });
  if (code === "ENOTDIR") return new MuxError("files.notDir");
  if (code === "ENOSPC" || code === "EDQUOT") return new MuxError("files.noSpace");
  if (code === "EROFS") return new MuxError("files.readOnlyDisk");
  if (["EACCES", "EPERM", "EBUSY"].includes(code)) return new MuxError("files.denied", "files.denied", { code });
  return new MuxError("files.failed", "files.failed", { code: code || (e instanceof Error ? e.message : String(e)) });
}

const lstatOrNull = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

function mustBeDir(abs: string): void {
  let st: Stats;
  try {
    st = statSync(abs);
  } catch (e) {
    throw fsError(e);
  }
  if (!st.isDirectory()) fail("files.notDir");
}

function inheritOwner(path: string): void {
  if (process.getuid?.() !== 0) return;
  try {
    const parent = statSync(dirname(path));
    lchownSync(path, parent.uid, parent.gid);
  } catch {}
}

function pathList(paths: unknown): string[] {
  if (!Array.isArray(paths) || !paths.length || paths.length > 1000) fail("files.badPath");
  return (paths as unknown[]).map(locate);
}

// --- Looking ----------------------------------------------------------------------------------------

async function entryOf(dir: string, name: string) {
  const abs = join(dir, name);
  const own = await lstat(abs).catch(() => null);
  if (!own) return null;
  let st = own;
  let type: "dir" | "file" | "other" | null = null;
  if (own.isSymbolicLink()) {
    const target = await stat(abs).catch(() => null);
    if (!target) type = "other";
    else st = target;
  }
  type ??= st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
  return { name, type, size: type === "file" ? st.size : 0, modified: Math.round(st.mtimeMs), ...(own.isSymbolicLink() ? { link: true as const } : {}) };
}

const room = (path: string): { total: number; free: number } | null => {
  try {
    const s = statfsSync(path);
    return s.blocks > 0 ? { total: s.blocks * s.bsize, free: s.bavail * s.bsize } : null;
  } catch {
    return null;
  }
};

/** The file systems of disks, shown in the sidebar: what /proc/mounts holds, without the kernel's own */
const PSEUDO = /^(proc|sysfs|devtmpfs|devpts|tmpfs|cgroup2?|securityfs|pstore|bpf|debugfs|tracefs|mqueue|hugetlbfs|configfs|fusectl|autofs|binfmt_misc|overlay|nsfs|squashfs|efivarfs|rpc_pipefs|ramfs|fuse\.lxcfs|nfsd)$/;

function volumes(): { path: string; label: string; total: number; free: number; network: boolean; readOnly: boolean }[] {
  let text = "";
  try {
    text = readFileSync("/proc/mounts", "utf8");
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const [device, at, fstype, options] = line.split(" ");
    if (!device || !at || !fstype || PSEUDO.test(fstype)) continue;
    const path = at.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    if (path === "/" || seen.has(path) || /^\/(boot|snap|var\/lib\/docker|run|proc|sys|dev)(\/|$)/.test(path)) continue;
    seen.add(path);
    const network = /^(nfs4?|cifs|smb3|fuse\.(rclone|sshfs))$/.test(fstype);
    // a server that is away would stop the client in statfs
    const r = network ? null : room(path);
    out.push({ path, label: "", total: r?.total ?? 0, free: r?.free ?? 0, network, readOnly: (options ?? "").split(",").includes("ro") });
    if (out.length >= 20) break;
  }
  return out;
}

export async function list(args: { path?: unknown }) {
  const dir = args.path === "" || args.path === undefined ? "/" : locate(args.path);
  mustBeDir(dir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    throw fsError(e);
  }
  const shown = names.filter((name) => !PART_RE.test(name));
  const entries = (await Promise.all(shown.slice(0, LIST_LIMIT).map((name) => entryOf(dir, name)))).filter((e) => e !== null);
  let readOnly = isVirtual(dir);
  try {
    readOnly ||= KEYSTONES.some((key) => inside(dir, key));
  } catch {}
  return { path: dir, readOnly, home: "/", pinned: [], shared: [], entries, truncated: shown.length > LIST_LIMIT, places: [], disks: volumes(), disk: room(dir) };
}

export async function summary(args: { paths?: unknown }) {
  const out = { files: 0, dirs: 0, size: 0, truncated: false };
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
  for (const abs of pathList(args.paths)) await walk(abs);
  return out;
}

const INLINE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".ogv": "video/ogg",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
  ".pdf": "application/pdf",
};

function readable(path: unknown) {
  const abs = locate(path);
  if (isVirtual(abs)) fail("files.virtual");
  let st: Stats;
  let file: string;
  try {
    file = realpathSync(abs);
    st = statSync(file);
  } catch (e) {
    throw fsError(e);
  }
  if (!st.isFile()) fail("files.notFile");
  return { file, name: basename(abs), size: st.size, modified: Math.round(st.mtimeMs), inline: INLINE_TYPES[extname(abs).toLowerCase()] ?? "" };
}

/** What a file is, before its bytes are asked for: the page needs the size for a range of a video */
export const fileInfo = (args: { path?: unknown }) => {
  const { name, size, modified, inline } = readable(args.path);
  return { name, size, modified, inline };
};

/** The bytes of a file, from `start` to `end` (inclusive) */
export async function read(args: { path?: unknown; start?: unknown; end?: unknown }, channel: Channel): Promise<void> {
  const { file, size } = readable(args.path);
  const start = Math.max(0, Number(args.start) || 0);
  const end = Math.min(size - 1, args.end === undefined ? size - 1 : Number(args.end));
  if (end < start) return;
  const stream = Bun.file(file).slice(start, end + 1).stream();
  for await (const chunk of stream) {
    if (channel.signal.aborted) break;
    await channel.send(chunk);
  }
}

export async function readText(args: { path?: unknown }) {
  const { file, size, modified } = readable(args.path);
  if (size > MAX_TEXT_BYTES) fail("files.tooLargeToEdit", { max: MAX_TEXT_BYTES / 1024 / 1024 });
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
  } catch (e) {
    throw e instanceof TypeError ? new MuxError("files.notText") : fsError(e);
  }
  if (content.includes("\0")) fail("files.notText");
  return { path: locate(args.path), content, modified };
}

export async function writeText(args: { path?: unknown; content?: unknown; modified?: unknown }) {
  const content = args.content;
  if (typeof content !== "string" || content.includes("\0")) fail("files.notText");
  if (Buffer.byteLength(content as string) > MAX_TEXT_BYTES) fail("files.tooLargeToEdit", { max: MAX_TEXT_BYTES / 1024 / 1024 });
  const current = readable(args.path);
  mustWrite(current.file);
  if (typeof args.modified === "number" && args.modified !== current.modified) fail("files.changed");
  const tmp = `${current.file}.${process.pid}.tmp`;
  try {
    const st = statSync(current.file);
    writeFileSync(tmp, content as string);
    chmodSync(tmp, st.mode & 0o7777);
    if (process.getuid?.() === 0) chownSync(tmp, st.uid, st.gid);
    renameSync(tmp, current.file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw fsError(e);
  }
  return readText(args);
}

/** Folders and files as one ZIP stream; links are left out */
export async function zip(args: { paths?: unknown }, channel: Channel): Promise<void> {
  const all = pathList(args.paths);
  const sources: ZipSource[] = [];
  let size = 0;
  const add = (source: ZipSource, bytes: number) => {
    size += bytes + source.name.length * 2 + 100;
    if (sources.push(source) > ZIP_MAX_ENTRIES - 1 || size > ZIP_MAX_BYTES * 0.95) fail("files.archiveTooLarge");
  };
  const walk = async (abs: string, name: string): Promise<void> => {
    const st = await lstat(abs).catch(() => null);
    if (!st || st.isSymbolicLink()) return;
    if (st.isFile()) add({ name, file: abs, mode: st.mode & 0o7777, mtime: st.mtime }, st.size);
    else if (st.isDirectory()) {
      add({ name: name + "/", mode: st.mode & 0o7777, mtime: st.mtime }, 0);
      for (const child of (await readdir(abs).catch(() => [] as string[])).sort()) if (!PART_RE.test(child)) await walk(join(abs, child), `${name}/${child}`);
    }
  };
  for (const abs of all) {
    if (isVirtual(abs)) fail("files.virtual");
    await walk(abs, basename(abs) || "files");
  }
  for await (const chunk of zipChunks(sources)) {
    if (channel.signal.aborted) break;
    await channel.send(chunk);
  }
}

// --- Changing ---------------------------------------------------------------------------------------

function make(args: { path?: unknown; name?: unknown }, folder: boolean): string {
  const parent = locate(args.path);
  mustBeDir(parent);
  mustWrite(parent);
  const target = join(parent, validName(args.name));
  if (lstatOrNull(target)) fail("files.exists", { name: basename(target) });
  try {
    if (folder) mkdirSync(target);
    else writeFileSync(target, "", { flag: "wx", mode: 0o644 });
  } catch (e) {
    throw fsError(e);
  }
  inheritOwner(target);
  return target;
}

export const makeFolder = (args: { path?: unknown; name?: unknown }) => ({ path: make(args, true) });
export const makeFile = (args: { path?: unknown; name?: unknown }) => ({ path: make(args, false) });

export function rename(args: { path?: unknown; name?: unknown }) {
  const from = locate(args.path);
  if (!lstatOrNull(from)) fail("files.notFound");
  mustBeMovable(from);
  const to = join(dirname(from), validName(args.name));
  if (to === from) return { path: to };
  if (lstatOrNull(to) && to.toLowerCase() !== from.toLowerCase()) fail("files.exists", { name: basename(to) });
  try {
    renameSync(from, to);
  } catch (e) {
    throw fsError(e);
  }
  return { path: to };
}

/** For good: a machine has no trash */
export async function remove(args: { paths?: unknown }): Promise<void> {
  const all = pathList(args.paths);
  for (const abs of all) mustBeMovable(abs);
  for (const abs of all) {
    if (!lstatOrNull(abs)) fail("files.notFound");
    try {
      await rm(abs, { recursive: true, force: false });
    } catch (e) {
      throw fsError(e);
    }
  }
}

function freeName(dir: string, name: string): string {
  if (!lstatOrNull(join(dir, name))) return name;
  const ext = name.startsWith(".") ? "" : extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 2; ; n++) if (!lstatOrNull(join(dir, `${stem} (${n})${ext}`))) return `${stem} (${n})${ext}`;
}

async function copyTree(from: string, dest: string): Promise<void> {
  const proc = Bun.spawn(["cp", "-a", "--", from, dest], { stdout: "ignore", stderr: "pipe" });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code === 0) return;
  if (/No space left/i.test(err)) fail("files.noSpace");
  fail("files.failed", { code: err.trim().split("\n").pop() || `cp exited with ${code}` });
}

/** Within the machine: as in `files.ts`, nothing is overwritten, a copy into the same folder gets a free name */
export async function transfer(args: { paths?: unknown; to?: unknown; copy?: unknown }): Promise<void> {
  const copy = args.copy === true;
  const target = locate(args.to);
  mustBeDir(target);
  mustWrite(target);
  const plan = pathList(args.paths).map((from) => {
    const st = lstatOrNull(from);
    if (!st) fail("files.notFound");
    if (!copy) mustBeMovable(from);
    else if (isVirtual(from)) fail("files.virtual");
    const same = dirname(from) === target;
    if (same && !copy) fail("files.samePlace");
    const dest = join(target, same ? freeName(target, basename(from)) : basename(from));
    if (lstatOrNull(dest)) fail("files.exists", { name: basename(dest) });
    if (st!.isDirectory() && inside(realish(dest), realish(from))) fail("files.intoItself");
    return { from, dest };
  });
  for (const { from, dest } of plan) {
    if (copy) await copyTree(from, dest);
    else {
      try {
        renameSync(from, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw fsError(e);
        await copyTree(from, dest);
        await rm(from, { recursive: true, force: false }).catch((e2) => {
          throw fsError(e2);
        });
      }
    }
  }
}

// --- Uploads, in parts as from the browser ----------------------------------------------------------

function uploadFolder(dir: unknown, sub: string): string {
  const base = locate(dir);
  mustBeDir(base);
  mustWrite(base);
  const parts = String(sub ?? "").split("/").filter(Boolean);
  if (parts.length > 32) fail("files.badPath");
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
  mustWrite(into);
  return into;
}

export async function upload(args: { dir?: unknown; name?: unknown; sub?: unknown; id?: unknown; offset?: unknown; last?: unknown; overwrite?: unknown }, channel: Channel) {
  const id = String(args.id ?? "");
  const offset = Number(args.offset);
  if (!/^[a-z0-9]{8,32}$/.test(id) || !Number.isSafeInteger(offset) || offset < 0) fail("files.badUpload");
  const into = uploadFolder(args.dir, String(args.sub ?? ""));
  const target = join(into, validName(args.name));
  const existing = lstatOrNull(target);
  if (existing && (args.overwrite !== true || !existing.isFile())) fail("files.exists", { name: basename(target) });
  const tmp = join(into, `.hata-upload-${id}`);
  const have = offset === 0 ? 0 : (lstatOrNull(tmp)?.size ?? -1);
  if (have !== offset) fail("files.uploadOrder");
  let received = offset;
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(tmp, offset === 0 ? "w" : "r+");
    for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
      await file.write(chunk, 0, chunk.length, received);
      received += chunk.length;
    }
    await file.close();
    file = null;
    if (args.last !== true) return { received, path: null };
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
      if (offset > 0) await open(tmp, "r+").then((f) => f.truncate(offset).finally(() => f.close()));
      else unlinkSync(tmp);
    } catch {}
    throw fsError(e);
  }
}

export function abortUpload(args: { dir?: unknown; sub?: unknown; id?: unknown }): void {
  const id = String(args.id ?? "");
  if (!/^[a-z0-9]{8,32}$/.test(id)) fail("files.badUpload");
  const into = join(locate(args.dir), ...String(args.sub ?? "").split("/").filter(Boolean).map(validName));
  mustWrite(into);
  try {
    unlinkSync(join(into, `.hata-upload-${id}`));
  } catch {}
}

// --- Between machines: tar ----------------------------------------------------------------------------

/** The entries to send: they must all lie in one folder, which tar is run in */
export function packPlan(paths: unknown): { dir: string; names: string[] } {
  const all = pathList(paths);
  const dir = dirname(all[0]!);
  for (const abs of all) {
    if (dirname(abs) !== dir || abs === "/") fail("files.badPath");
    if (isVirtual(abs)) fail("files.virtual");
    if (!lstatOrNull(abs)) fail("files.notFound");
  }
  return { dir, names: all.map((abs) => basename(abs)) };
}

/** Which of these names are taken in a folder that is to receive them */
export function taken(args: { dir?: unknown; names?: unknown }): { taken: string[] } {
  const dir = locate(args.dir);
  mustBeDir(dir);
  mustWrite(dir);
  const names = Array.isArray(args.names) ? args.names.map(validName) : [];
  return { taken: names.filter((name) => lstatOrNull(join(dir, name)) !== null) };
}

/** The tar stream of entries of one folder */
export async function pack(args: { paths?: unknown }, channel: Channel): Promise<void> {
  const { dir, names } = packPlan(args.paths);
  const proc = Bun.spawn(["tar", "-cf", "-", "-C", dir, "--", ...names], { stdout: "pipe", stderr: "pipe" });
  channel.signal.addEventListener("abort", () => proc.kill());
  const errors = new Response(proc.stderr).text();
  for await (const chunk of proc.stdout) await channel.send(chunk).catch(() => proc.kill());
  const code = await proc.exited;
  if (code !== 0 && !channel.signal.aborted) fail("files.failed", { code: (await errors).trim().split("\n").pop() || `tar exited with ${code}` });
}

/**
 * A tar stream unpacked into a folder: the files take the owner of that folder, as everything made in
 * the file manager does. `names` are what the stream holds at its top; none of them may be there yet.
 */
export async function unpack(args: { to?: unknown; names?: unknown }, channel: Channel): Promise<void> {
  const dir = locate(args.to);
  const names = Array.isArray(args.names) ? args.names.map(validName) : [];
  if (taken({ dir, names }).taken.length) fail("files.exists", { name: taken({ dir, names }).taken[0]! });
  const proc = Bun.spawn(["tar", "-xf", "-", "-C", dir, "--no-same-owner"], { stdin: "pipe", stdout: "ignore", stderr: "pipe" });
  const errors = new Response(proc.stderr).text();
  try {
    for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
      proc.stdin.write(chunk);
      await proc.stdin.flush();
    }
  } finally {
    await proc.stdin.end();
  }
  const code = await proc.exited;
  if (code !== 0) {
    const said = (await errors).trim();
    if (/No space left/i.test(said)) fail("files.noSpace");
    fail("files.failed", { code: said.split("\n").pop() || `tar exited with ${code}` });
  }
  if (process.getuid?.() === 0) {
    const owner = statSync(dir);
    for (const name of names) Bun.spawnSync(["chown", "-R", "-h", `${owner.uid}:${owner.gid}`, "--", join(dir, name)]);
  }
}
