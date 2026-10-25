/**
 * What fills the data folder.
 *
 * Once a day (and when asked) the data folder is measured with `du`, on its own file system only: its
 * folders, every app's folder under `AppData`, the trash. Each measurement leaves a sample, and the
 * samples say how a folder grew over the week and when the disk will be full at this pace.
 *
 * Reading `du`, splitting the folder into parts (`breakdown`), the pace (`weekly`) and the forecast
 * (`fullIn`) are pure functions. Nothing here changes a file.
 *
 * The same measurement walks the files once more (`find`, outside AppData and the trash, which are the
 * apps' and Hata's own): how much of each folder has not changed for `OLD_DAYS`, and the largest files —
 * what a person may want to look at when the disk fills. Which apps use a folder is said by `whoUses`.
 */
import { statfsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DATA_DIR, settings } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { PATH, run } from "./packages";

const APP_DATA = "AppData";
const TRASH = ".hata-trash";

export interface Row {
  path: string;
  size: number;
}

/** `du -k` output into bytes per folder; a line that is not one (a name with a line break in it) is skipped */
export function parseDu(out: string): Row[] {
  const rows: Row[] = [];
  for (const line of out.split("\n")) {
    const m = /^(\d+)\t(\/.*)$/.exec(line);
    if (m) rows.push({ path: m[2]!, size: Number(m[1]) * 1024 });
  }
  return rows;
}

export interface Part {
  /**
   * folder — a folder of the data folder; app — an app's folder under AppData; trash — Hata's trash;
   * mount — a folder that is another disk, not counted; rest — files lying in the data folder itself
   */
  kind: "folder" | "app" | "trash" | "mount" | "rest";
  path: string;
  name: string;
  size: number;
}

/**
 * The data folder as parts, largest first: its own folders, with `AppData` opened into one part per
 * app. `rows` is `du` of the folder two levels deep; `elsewhere` are the folders on another file system.
 */
export function breakdown(rows: Row[], root: string, elsewhere: Set<string> = new Set()): { total: number; parts: Part[] } {
  const total = rows.find((row) => row.path === root)?.size ?? 0;
  const apps = join(root, APP_DATA);
  const parts: Part[] = [];
  for (const row of rows) {
    const parent = dirname(row.path);
    if (row.path === root || row.path === apps || (parent !== root && parent !== apps)) continue;
    const name = basename(row.path);
    if (elsewhere.has(row.path)) parts.push({ kind: "mount", path: row.path, name, size: 0 });
    else if (row.size > 0) parts.push({ kind: parent === apps ? "app" : name === TRASH ? "trash" : "folder", path: row.path, name, size: row.size });
  }
  parts.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  const rest = total - parts.reduce((sum, part) => sum + part.size, 0);
  // a few blocks of the folders themselves are not worth a line
  if (rest >= 1024 * 1024) parts.push({ kind: "rest", path: root, name: "", size: rest });
  return { total, parts };
}

export interface Sample {
  at: number;
  /** The file system the data folder lies on */
  used: number;
  total: number;
  /** Size of every part, by path */
  parts: Record<string, number>;
}

const DAY_MS = 24 * 3600_000;
const KEEP_DAYS = 90;

/** One sample a day: a second measurement of the same day replaces the first */
export function addSample(samples: Sample[], sample: Sample): Sample[] {
  const day = (at: number) => Math.floor(at / DAY_MS);
  return [...samples.filter((s) => day(s.at) !== day(sample.at) && sample.at - s.at < KEEP_DAYS * DAY_MS), sample];
}

/** How much a part grew over the last week, bytes; null when there is no sample about a week old */
export function weekly(samples: Sample[], path: string, now: number): number | null {
  const latest = samples.at(-1);
  if (!latest) return null;
  const old = samples.filter((s) => now - s.at >= 5 * DAY_MS && now - s.at <= 10 * DAY_MS).sort((a, b) => Math.abs(now - a.at - 7 * DAY_MS) - Math.abs(now - b.at - 7 * DAY_MS))[0];
  if (!old) return null;
  return Math.round((((latest.parts[path] ?? 0) - (old.parts[path] ?? 0)) / (latest.at - old.at)) * 7 * DAY_MS);
}

const FORECAST_DAYS = 30;
const FORECAST_FAR = 365;

/**
 * Days until the file system is full at the pace of the last month (a straight line through the
 * samples); null when it does not grow, when a year is not enough, or when three days of samples are
 * not there yet.
 */
export function fullIn(samples: Sample[], now: number): number | null {
  const latest = samples.at(-1);
  if (!latest) return null;
  // a file system of another size is another disk
  const recent = samples.filter((s) => now - s.at <= FORECAST_DAYS * DAY_MS && s.total === latest.total);
  if (recent.length < 3 || latest.at - recent[0]!.at < 3 * DAY_MS) return null;
  const meanAt = recent.reduce((sum, s) => sum + s.at, 0) / recent.length;
  const meanUsed = recent.reduce((sum, s) => sum + s.used, 0) / recent.length;
  const pace = recent.reduce((sum, s) => sum + (s.at - meanAt) * (s.used - meanUsed), 0) / recent.reduce((sum, s) => sum + (s.at - meanAt) ** 2, 0);
  if (!(pace > 0)) return null;
  const days = Math.ceil((latest.total - latest.used) / pace / DAY_MS);
  return days <= FORECAST_FAR ? Math.max(days, 0) : null;
}

// ---- how old the files are ----

/** Files not changed for this many days are "old" */
export const OLD_DAYS = 90;
const LARGEST_KEPT = 10;

export interface BigFile {
  path: string;
  size: number;
  /** When it was last changed, ms */
  at: number;
}

/**
 * Adds files up as they come from `find`: the bytes not changed for `OLD_DAYS` per part of the data
 * folder (a folder of its own, or the folder itself for the files lying in it), and the largest files.
 */
export class Ages {
  old: Record<string, number> = {};
  oldTotal = 0;
  largest: BigFile[] = [];
  constructor(
    readonly root: string,
    readonly now: number,
  ) {}
  /** `rel` — the path inside the data folder; `mtime` — seconds */
  add(size: number, mtime: number, rel: string): void {
    if (!rel || !Number.isFinite(size)) return;
    const at = mtime * 1000;
    if (this.now - at >= OLD_DAYS * DAY_MS) {
      const slash = rel.indexOf("/");
      const part = slash < 0 ? this.root : join(this.root, rel.slice(0, slash));
      this.old[part] = (this.old[part] ?? 0) + size;
      this.oldTotal += size;
    }
    if (this.largest.length < LARGEST_KEPT || size > this.largest.at(-1)!.size) {
      this.largest.push({ path: join(this.root, rel), size, at });
      this.largest.sort((a, b) => b.size - a.size);
      if (this.largest.length > LARGEST_KEPT) this.largest.pop();
    }
  }
  /** One record of `find -printf "%s\t%T@\t%P\0"` */
  line(record: string): void {
    const [size, mtime, ...rel] = record.split("\t");
    this.add(Number(size), Number(mtime), rel.join("\t"));
  }
}

/** The apps that use a folder: one of an app's folders is the folder, lies inside it, or holds it */
export function whoUses(path: string, apps: { name: string; folders: string[] }[]): string[] {
  const near = (a: string, b: string) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
  return apps.filter((app) => app.folders.some((folder) => near(folder, path))).map((app) => app.name);
}

/** Walks the data folder's files, its own file system only, without the apps' data and the trash */
async function ages(root: string, gently: string[]): Promise<Ages | null> {
  const found = new Ages(root, Date.now());
  const skip = [join(root, APP_DATA), join(root, TRASH)];
  try {
    const proc = Bun.spawn({ cmd: [...gently, "find", root, "-xdev", "(", "-path", skip[0]!, "-o", "-path", skip[1]!, ")", "-prune", "-o", "-type", "f", "-printf", "%s\\t%T@\\t%P\\0"], stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: MEASURE_TIMEOUT_MS, env: { ...process.env, PATH, LC_ALL: "C" } });
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      const records = (rest + decoder.decode(chunk, { stream: true })).split("\0");
      rest = records.pop() ?? "";
      for (const record of records) found.line(record);
    }
    await proc.exited;
    return found;
  } catch {
    return null;
  }
}

// ---- the running part ----

interface State {
  root: string;
  /** When the folder was last measured, and how long it took, ms */
  at: number;
  took: number;
  total: number;
  parts: Part[];
  samples: Sample[];
  /** Bytes not changed for OLD_DAYS, per part, and in all */
  old?: Record<string, number>;
  oldTotal?: number;
  largest?: BigFile[];
}

const FILE = join(DATA_DIR, "fills.json");
const MEASURE_EVERY_MS = DAY_MS;
// a folder of millions of files on a slow disk takes its time
const MEASURE_TIMEOUT_MS = 2 * 3600_000;

let state = readJsonFile<State | null>(FILE, null, isPlainObject);
let running: Promise<void> | null = null;

function fileSystem(path: string): { used: number; total: number } | null {
  try {
    const s = statfsSync(path);
    const total = s.blocks * s.bsize;
    return total > 0 ? { total, used: total - s.bavail * s.bsize } : null;
  } catch {
    return null;
  }
}

const deviceOf = (path: string): number | null => {
  try {
    return statSync(path).dev;
  } catch {
    return null;
  }
};

async function measure(): Promise<void> {
  const root = settings.dataRoot;
  const device = deviceOf(root);
  const fs = fileSystem(root);
  if (device === null || !fs) return;
  const started = Date.now();
  // at the lowest priority, where the system knows how: the apps come first
  const gently = [Bun.which("ionice", { PATH }) ? ["ionice", "-c", "3"] : [], Bun.which("nice", { PATH }) ? ["nice", "-n", "19"] : []].flat();
  const result = await run([...gently, "du", "-x", "-k", "-d", "2", root], MEASURE_TIMEOUT_MS);
  const rows = parseDu(result.out);
  // a folder that may not be read makes du complain and still count the rest
  if (!rows.some((row) => row.path === root)) throw new Error(result.err.trim().split("\n").pop() || `du exited with ${result.code}`);
  const elsewhere = new Set(rows.map((row) => row.path).filter((path) => path !== root && deviceOf(path) !== device));
  const { total, parts } = breakdown(rows, root, elsewhere);
  const at = Date.now();
  const sample: Sample = { at, ...fs, parts: Object.fromEntries(parts.filter((part) => part.kind !== "mount").map((part) => [part.path, part.size])) };
  const aged = await ages(root, gently);
  state = { root, at, took: Date.now() - started, total, parts, samples: addSample(state?.root === root ? state.samples : [], sample), ...(aged ? { old: aged.old, oldTotal: aged.oldTotal, largest: aged.largest } : {}) };
  writeJsonAtomic(FILE, state);
}

/** Measures the data folder, one measurement at a time; the answer is in `fills()` when it is done */
export function measureFills(): Promise<void> {
  running ??= measure()
    .catch((e) => console.error("Could not measure the data folder:", e instanceof Error ? e.message : e))
    .finally(() => (running = null));
  return running;
}

export interface FillsReport {
  root: string;
  running: boolean;
  /** When it was last measured; null — never */
  at: number | null;
  /** The file system the folder lies on, as it is now */
  used: number;
  total: number;
  /** What the data folder itself holds */
  size: number;
  parts: (Part & { week: number | null; old: number | null; apps: string[] })[];
  /** Bytes of files not changed for `oldDays`, outside AppData and the trash; null — not counted yet */
  oldTotal: number | null;
  oldDays: number;
  largest: BigFile[];
  /** Days until the file system is full at the pace of the last month */
  fullIn: number | null;
}

/** `apps` — every installed app with its folders outside AppData, to say which ones use a folder */
export function fills(apps: { name: string; folders: string[] }[] = []): FillsReport | null {
  const root = settings.dataRoot;
  const fs = fileSystem(root);
  if (!fs) return null;
  const measured = state?.root === root ? state : null;
  const now = Date.now();
  return {
    root,
    running: running !== null,
    at: measured?.at ?? null,
    ...fs,
    size: measured?.total ?? 0,
    parts: (measured?.parts ?? []).map((part) => ({
      ...part,
      week: part.kind === "mount" ? null : weekly(measured!.samples, part.path, now),
      old: measured?.old && (part.kind === "folder" || part.kind === "rest") ? (measured.old[part.path] ?? 0) : null,
      apps: part.kind === "folder" || part.kind === "mount" ? whoUses(part.path, apps) : [],
    })),
    oldTotal: measured?.oldTotal ?? null,
    oldDays: OLD_DAYS,
    largest: measured?.largest ?? [],
    fullIn: measured ? fullIn(measured.samples, now) : null,
  };
}

/** Measures the folder a few minutes after the start, when it was not measured today, and then daily */
export function startFills(): void {
  const due = () => {
    if (!state || state.root !== settings.dataRoot || Date.now() - state.at >= MEASURE_EVERY_MS) void measureFills();
  };
  setTimeout(due, 3 * 60_000);
  setInterval(due, 3600_000);
}
