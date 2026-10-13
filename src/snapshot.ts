/**
 * Looking inside a snapshot: its folders and files, one file taken out, a few of them put back.
 *
 * A snapshot is a `tar.gz`, which has no table of contents — to know what is inside, the whole archive
 * is read once (`tar -tv`) and the listing is kept in memory for the few snapshots looked at last.
 * A file is taken out with `tar -xO`, which reads up to it; chosen files go back to their place with
 * `tar -x`, the same way a whole restore does it, with the app stopped meanwhile.
 *
 * Pure and tested: reading the listing (`parseListing`), the names tar escapes (`unescape`).
 */
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError, appDir, dc, startJob, type Job } from "./apps";
import { archiveOf, placement, refusedPaths, snapshotOf, tarMove, type Snapshot } from "./backup";
import { listContainers, PROJECT_LABEL, run } from "./docker";
import { run as measure } from "./packages";

export interface ArchiveEntry {
  /** Absolute, as it lay on the disk; no slash at the end */
  path: string;
  dir: boolean;
  size: number;
  /** When it was last changed, ms */
  at: number;
  /** Where a link points; "" — not a link */
  link: string;
}

/** A name as `tar --quoting-style=escape` prints it: `\n`, `\\`, and bytes outside ASCII as `\320\234` */
export function unescape(name: string): string {
  if (!name.includes("\\")) return name;
  const bytes: number[] = [];
  const plain = new TextEncoder();
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, "\\": 92, " ": 32, '"': 34, "'": 39 };
  for (let i = 0; i < name.length; i++) {
    const octal = name[i] === "\\" ? /^[0-7]{3}/.exec(name.slice(i + 1)) : null;
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (name[i] === "\\" && simple[name[i + 1] ?? ""] !== undefined) bytes.push(simple[name[++i]!]!);
    else bytes.push(...plain.encode(name[i]!));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** What `tar --utc --quoting-style=escape -tvzf` printed: one entry a line, names relative to `/` */
export function parseListing(out: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const line of out.split("\n")) {
    const m = /^(\S)\S{9}\S*\s+\S+\s+([\d,]+)\s+(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)(?::\d\d)?\s(.*)$/.exec(line);
    if (!m) continue;
    const type = m[1]!;
    let name = m[8]!;
    let link = "";
    const arrow = type === "l" ? name.indexOf(" -> ") : type === "h" ? name.indexOf(" link to ") : -1;
    if (arrow >= 0) {
      link = unescape(name.slice(arrow + (type === "l" ? 4 : 9)));
      name = name.slice(0, arrow);
    }
    const path = "/" + unescape(name).replace(/^\.?\/+/, "").replace(/\/+$/, "");
    if (path === "/" || path.split("/").includes("..")) continue;
    entries.push({ path, dir: type === "d", size: type === "-" ? Number(m[2]) || 0 : 0, at: Date.UTC(Number(m[3]), Number(m[4]) - 1, Number(m[5]), Number(m[6]), Number(m[7])), link });
  }
  return entries;
}

interface Index {
  byPath: Map<string, ArchiveEntry>;
  children: Map<string, ArchiveEntry[]>;
}

/** The entries by path and by the folder they lie in */
export function indexOf(entries: ArchiveEntry[]): Index {
  const byPath = new Map<string, ArchiveEntry>();
  const children = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    if (byPath.has(entry.path)) continue;
    byPath.set(entry.path, entry);
    const parent = entry.path.slice(0, entry.path.lastIndexOf("/")) || "/";
    const list = children.get(parent);
    if (list) list.push(entry);
    else children.set(parent, [entry]);
  }
  return { byPath, children };
}

/** Listings of the snapshots looked at last: reading one means unpacking the whole archive */
const KEPT = 3;
const cache = new Map<string, Promise<Index>>();

function listing(name: string, snapshot: Snapshot): Promise<Index> {
  const key = `${name}/${snapshot.id}`;
  const had = cache.get(key);
  if (had) {
    cache.delete(key);
    cache.set(key, had);
    return had;
  }
  const reading = (async () => {
    const tar = await run(["tar", "--utc", "--quoting-style=escape", "-tvzf", archiveOf(name, snapshot.id)]);
    if (tar.code !== 0) throw new AppError("backup.damaged", 500, { message: tar.output.split("\n").slice(-1)[0] ?? "" });
    return indexOf(parseListing(tar.output));
  })();
  cache.set(key, reading);
  reading.catch(() => cache.delete(key));
  while (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  return reading;
}

const sorted = (entries: ArchiveEntry[]): ArchiveEntry[] => [...entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path));

/** The snapshot's own top (`path` empty: the folders it was made of) or what lies in one of its folders */
export async function snapshotFiles(name: string, id: string, path: string): Promise<{ path: string; roots: string[]; entries: ArchiveEntry[] }> {
  const snapshot = snapshotOf(name, id);
  const index = await listing(name, snapshot);
  if (!path) return { path: "", roots: snapshot.paths, entries: snapshot.paths.map((root) => index.byPath.get(root)).filter((e): e is ArchiveEntry => !!e) };
  if (!index.byPath.get(path)?.dir) throw new AppError("backup.noSuchFile", 404);
  return { path, roots: snapshot.paths, entries: sorted(index.children.get(path) ?? []) };
}

/** tar reads names on its command line as it prints them unless told not to; ours are the names themselves */
const member = (path: string): string => path.replace(/^\/+/, "");

/** One file out of a snapshot, as a stream: the archive is read up to it */
export async function snapshotFile(name: string, id: string, path: string): Promise<{ name: string; size: number; body: ReadableStream<Uint8Array> }> {
  const snapshot = snapshotOf(name, id);
  const entry = (await listing(name, snapshot)).byPath.get(path);
  if (!entry || entry.dir || entry.link) throw new AppError("backup.noSuchFile", 404);
  const proc = Bun.spawn({ cmd: ["tar", "--no-unquote", "--occurrence=1", "-xzOf", archiveOf(name, id), "--", member(path)], stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  return { name: path.slice(path.lastIndexOf("/") + 1), size: entry.size, body: proc.stdout };
}

/**
 * Puts chosen files and folders of a snapshot back where they were. Each replaces what is there now —
 * except inside a folder outside AppData, where the snapshot's files are unpacked over the present
 * ones and nothing is deleted. The app is stopped meanwhile, as for a snapshot, and started again.
 */
export function restoreFromSnapshot(name: string, id: string, input: unknown, user: string): Job {
  const snapshot = snapshotOf(name, id);
  const chosen = Array.isArray(input) ? [...new Set(input.filter((p): p is string => typeof p === "string"))] : [];
  if (!chosen.length || chosen.length > 200) throw new AppError("backup.noSuchFile", 400);
  return startJob(name, "restore", user, async (log) => {
    const index = await listing(name, snapshot);
    const { place, extra } = placement(snapshot, name);
    const rootOf = (path: string) => snapshot.paths.find((root) => path === root || path.startsWith(root + "/"));
    for (const path of chosen) if (!index.byPath.has(path) || !rootOf(path)) throw new Error(`Not in the snapshot: ${path}`);
    // one inside another would be unpacked twice
    const paths = chosen.filter((path) => !chosen.some((other) => other !== path && path.startsWith(other + "/")));
    const roots = [...new Set(paths.map((path) => rootOf(path)!))];
    const refused = refusedPaths(snapshot, name, roots);
    if (refused.length) throw new Error(`The snapshot holds paths a restore must not touch: ${refused.join(", ")}`);
    const target = (path: string) => place(rootOf(path)!) + path.slice(rootOf(path)!.length);

    const installed = existsSync(join(appDir(name), "compose.yml"));
    const containers = installed ? (await listContainers().catch(() => [])).filter((c) => c.Labels[PROJECT_LABEL] === name) : [];
    const wasRunning = containers.some((c) => c.State === "running" || c.State === "restarting");
    if (wasRunning) await dc(name, ["stop"], log);
    try {
      for (const path of paths) {
        if (extra.has(rootOf(path)!)) {
          log(`Unpacking over ${target(path)}`);
          continue;
        }
        log(`Replacing ${target(path)}`);
        await rm(target(path), { recursive: true, force: true });
        mkdirSync(dirname(target(path)), { recursive: true });
      }
      const moves = roots.filter((root) => place(root) !== root).map((root) => tarMove(root, place(root)));
      log(`$ tar -xzf ${archiveOf(name, id)} -C / ${paths.map(member).join(" ")}`);
      const tar = await run(["tar", "--numeric-owner", "--no-unquote", "-xzpf", archiveOf(name, id), "-C", "/", ...moves, "--", ...paths.map(member)]);
      if (tar.code !== 0) throw new Error(tar.output.split("\n").slice(-3).join("\n") || `tar exited with ${tar.code}`);
    } finally {
      // the compose file itself may be among what came back
      if (wasRunning) await dc(name, ["up", "-d", "--remove-orphans"], log).catch((e) => log(`Could not start the app again: ${e instanceof Error ? e.message : e}`));
    }
  });
}

/** How much a folder holds, bytes; null — it took too long to count, or it is not there */
export async function folderSize(path: string): Promise<number | null> {
  const du = await measure(["du", "-sk", "-x", "--", path], 15_000);
  const kb = Number(/^(\d+)\s/.exec(du.out)?.[1]);
  return du.code === 0 && Number.isFinite(kb) ? kb * 1024 : null;
}
