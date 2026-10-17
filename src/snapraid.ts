/**
 * Protection from a disk failure with SnapRAID (Settings → Storage).
 *
 * One of the disks Hata connected holds parity, the others data; when any one of them dies, what it
 * held is computed back from the rest. The disks stay plain file systems. The parity is as old as the
 * last sync — what changed since is not protected — so it suits what changes slowly (media, the
 * backups) and not what an app writes all day: AppData is left out unless asked for.
 *
 * `/etc/snapraid.conf` is Hata's whole (one found there is kept as `snapraid.conf.before-hata`). Every
 * night: `diff`, then `sync` — unless more files have disappeared than the limit, which is what a wrong
 * `rm` or a disk that came up empty looks like; then nothing is written and the person decides: bring
 * the files back, or sync anyway. Once a week a part of the array is read and compared (`scrub`).
 *
 * SnapRAID keeps no owners and no permissions: a file it brings back is root's, mode 0600. Hata gives
 * such files the owner of the disk's top folder and makes them readable.
 *
 * Pure and tested: the config file, reading `diff` and `status`, why a sync was refused, the names of
 * the disks, the rule that leaves AppData out.
 */
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { record } from "./activity";
import { bus } from "./bus";
import { DATA_DIR, SECRETS_DIR, saveSettings, settings } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { holds, parseFstab, pools, POOL_FS } from "./mounting";
import { installCommand, PATH } from "./packages";

export const PACKAGE = "snapraid";
export const CONF = "/etc/snapraid.conf";
export const CONF_BEFORE = CONF + ".before-hata";
const MARK = "# Written by Hata";
/** The list of what the array holds: one copy on the system disk, one on every data disk */
const CONTENT_DIR = "/var/lib/snapraid";
const CONTENT = "snapraid.content";
const PARITY = "snapraid.parity";
const POSIX = /^(ext[234]|xfs|btrfs|f2fs)$/;

export const isOurs = (conf: string): boolean => conf.startsWith(MARK);

export interface ArraySettings {
  /** The folder of the disk that holds parity; "" — protection is off */
  parity: string;
  /** The disks that are protected: the name SnapRAID knows each by, and its folder */
  data: { name: string; path: string }[];
  /** Protect AppData too; off by default: it changes all day, and its owners would not come back */
  appData: boolean;
  /** HH:MM of the nightly sync */
  time: string;
  /** Read and compare a part of the array once a week */
  scrub: boolean;
  /** More files gone than this since the last sync, and the sync waits for a word; 0 — never waits */
  deleteLimit: number;
}

// --- Pure -------------------------------------------------------------------------------------------

/** The name SnapRAID keeps a disk under, from its folder: letters and digits, not one that is taken */
export function diskName(path: string, taken: string[]): string {
  const base = (path.split("/").filter(Boolean).pop() ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "") || "disk";
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = base + n;
  return name;
}

/**
 * The rule that leaves AppData out, as a path inside a data disk: the data folder lies on one of the
 * disks, or on a folder merged of them — where every disk has the same folders inside. Null — the
 * data folder is not in the array at all.
 */
export function appDataRule(dataRoot: string, disks: string[], merged: Record<string, string[]>): string | null {
  const inside = (root: string): string | null => (dataRoot === root ? "" : dataRoot.startsWith(root + "/") ? dataRoot.slice(root.length) : null);
  for (const disk of disks) {
    const rel = inside(disk);
    if (rel !== null) return `${rel}/AppData/`;
  }
  for (const [pool, branches] of Object.entries(merged)) {
    const rel = inside(pool);
    if (rel !== null && branches.some((branch) => disks.includes(branch))) return `${rel}/AppData/`;
  }
  return null;
}

/** `/etc/snapraid.conf`, whole */
export function snapraidConf(array: Pick<ArraySettings, "parity" | "data">, exclude: string[]): string {
  return [
    `${MARK}: Settings → Storage, "Protection from a disk failure". Changes made here are overwritten.`,
    `parity ${join(array.parity, PARITY)}`,
    `content ${join(CONTENT_DIR, CONTENT)}`,
    ...array.data.map((disk) => `content ${join(disk.path, CONTENT)}`),
    ...array.data.map((disk) => `data ${disk.name} ${disk.path}/`),
    "exclude /lost+found/",
    "exclude /.hata-trash/",
    "exclude .hata-upload-*",
    "exclude .hata-upload-*/",
    "exclude *.partial",
    "exclude *.unrecoverable",
    ...exclude.map((rule) => `exclude ${rule}`),
    "autosave 100",
    "",
  ].join("\n");
}

export interface Diff {
  equal: number;
  added: number;
  removed: number;
  updated: number;
  moved: number;
  copied: number;
  restored: number;
}

/** The summary `snapraid diff` ends with; null — it did not get that far */
export function parseDiff(out: string): Diff | null {
  const found: Record<string, number> = {};
  for (const m of out.matchAll(/^\s*(\d+) (equal|added|removed|updated|moved|copied|restored)\s*$/gm)) found[m[2]!] = Number(m[1]);
  if (found.equal === undefined || found.removed === undefined) return null;
  return { equal: found.equal, added: found.added ?? 0, removed: found.removed, updated: found.updated ?? 0, moved: found.moved ?? 0, copied: found.copied ?? 0, restored: found.restored ?? 0 };
}

/** How many files are not protected yet as they are: new ones and changed ones */
export const unprotected = (diff: Diff | null): number => (diff ? diff.added + diff.updated : 0);

/** What `snapraid status` says in its last lines: damaged blocks found, a sync that was cut short */
export function parseStatus(out: string): { errors: number; unfinished: boolean } {
  const errors = /In the array there (?:are|is) (\d+) errors?/.exec(out);
  return { errors: errors ? Number(errors[1]) : 0, unfinished: /sync (is )?in progress/.test(out) && !/No sync is in progress/.test(out) };
}

export type Refusal = { code: "diskEmpty"; disk: string } | { code: "parityLost"; disk: "" } | null;

/** Why SnapRAID would not sync, when it is one of the two things a person has to decide about */
export function refusal(out: string): Refusal {
  const empty = /All the files previously present in disk '([^']+)'/.exec(out);
  if (empty) return { code: "diskEmpty", disk: empty[1]! };
  if (/parity files? (?:is|are) smaller than expected|has only \d+ blocks instead of/.test(out)) return { code: "parityLost", disk: "" };
  return null;
}

/** `12%, 340 MB` — how far a long run has got; null — the line is not about that */
export const progressOf = (line: string): number | null => {
  const m = /^\s*(\d{1,3})%(?:,| completed)/.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
};

/** What a `fix` brought back, and how much it could not; names as SnapRAID prints them, inside a disk */
export function fixed(out: string): { recovered: string[]; unrecoverable: number } {
  const unrecoverable = /^\s*(\d+) unrecoverable errors?/m.exec(out);
  return { recovered: [...out.matchAll(/^recovered (.+)$/gm)].map((m) => m[1]!.replace(/\\(.)/g, "$1")), unrecoverable: unrecoverable ? Number(unrecoverable[1]) : 0 };
}

// --- State ------------------------------------------------------------------------------------------

type What = "diff" | "sync" | "scrub" | "fix" | "repair" | "rebuild";

interface State {
  lastSync: { at: number; ok: boolean; message: string } | null;
  lastScrub: { at: number; ok: boolean } | null;
  diff: (Diff & { at: number }) | null;
  /** The sync is waiting for a word: too many files are gone */
  held: { removed: number; at: number } | null;
  /** Damaged blocks the last check found */
  errors: number;
  /** What the person has to decide about before a sync can go on */
  trouble: Refusal;
}

const STATE_FILE = join(DATA_DIR, "snapraid.json");
const state: State = { lastSync: null, lastScrub: null, diff: null, held: null, errors: 0, trouble: null, ...readJsonFile<Partial<State>>(STATE_FILE, {}) };
const save = () => {
  writeJsonAtomic(STATE_FILE, state);
  bus.publish("disks");
};

let current: { what: What; since: number; percent: number | null; log: string[]; proc: ReturnType<typeof Bun.spawn> | null; stopped: boolean } | null = null;
let lastLog: string[] = [];

export const installed = (): boolean => !!Bun.which("snapraid", { PATH });
const isOn = (): boolean => settings.snapraid.parity !== "" && settings.snapraid.data.length > 0;

const readText = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

const mounted = (): Map<string, string> => new Map(readText("/proc/mounts").split("\n").map((line) => line.split(" ")).filter((f) => f.length > 2).map((f) => [f[1]!.replace(/\\040/g, " "), f[2]!]));

/** One run of `snapraid`, its lines kept for the page; a second one never starts next to it */
async function snap(what: What, args: string[]): Promise<{ code: number; out: string }> {
  const run = { what, since: Date.now(), percent: null as number | null, log: [] as string[], proc: null as ReturnType<typeof Bun.spawn> | null, stopped: false };
  current = run;
  bus.publish("disks");
  const lines: string[] = [];
  let code = -1;
  try {
    const proc = Bun.spawn({ cmd: ["snapraid", ...args], stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, PATH, LC_ALL: "C" } });
    run.proc = proc;
    const pump = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of stream) {
        // the progress is rewritten in place, with carriage returns
        const parts = (rest + decoder.decode(chunk, { stream: true })).split(/[\r\n]/);
        rest = parts.pop() ?? "";
        for (const line of parts) {
          const percent = progressOf(line);
          if (percent !== null) run.percent = percent;
          else if (line.trim()) {
            lines.push(line);
            run.log.push(line);
            if (run.log.length > 400) run.log.shift();
          }
        }
      }
      if (rest.trim()) lines.push(rest);
    };
    await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]);
    code = await proc.exited;
  } catch (e) {
    lines.push(e instanceof Error ? e.message : String(e));
  }
  lastLog = [`$ snapraid ${args.join(" ")}`, ...run.log.slice(-60)];
  if (current === run) current = null;
  return { code: run.stopped ? -2 : code, out: lines.join("\n") };
}

const lastLine = (out: string): string => out.split("\n").filter((line) => line.trim() && !/^(Saving|Verif|Loading|Using|Scann|Self test|Initializing|Selecting|Resizing)/.test(line)).slice(-2).join(" ").slice(0, 300);

/** The disks of the array that are not connected right now */
function missing(): string[] {
  const now = mounted();
  return [settings.snapraid.parity, ...settings.snapraid.data.map((d) => d.path)].filter((path) => !now.has(path));
}

/** Nothing of a person's lies on the disk: only what a new file system and the array itself put there */
function bare(path: string): boolean {
  try {
    return readdirSync(path).every((name) => name === "lost+found" || name.startsWith(CONTENT) || name === ".hata-trash");
  } catch {
    return false;
  }
}

async function refreshDiff(): Promise<Diff | null> {
  const diff = parseDiff((await snap("diff", ["diff"])).out);
  state.diff = diff && { ...diff, at: Date.now() };
  return diff;
}

async function refreshStatus(): Promise<void> {
  state.errors = parseStatus((await snap("diff", ["status"])).out).errors;
}

/** SnapRAID brings a file back as root's own, closed to everybody else: give it to whose disk it is */
function giveBack(disk: string, names: string[]): void {
  let top;
  try {
    top = statSync(disk);
  } catch {
    return;
  }
  const done = new Set<string>();
  for (const name of names) {
    let path = join(disk, name);
    if (!path.startsWith(disk + "/")) continue;
    try {
      if (!lstatSync(path).isSymbolicLink()) chmodSync(path, lstatSync(path).isDirectory() ? 0o755 : 0o644);
    } catch {}
    // the folders it had to make on the way are root's too
    for (; path !== disk && path.startsWith(disk + "/") && !done.has(path); path = dirname(path)) {
      done.add(path);
      try {
        if (lstatSync(path).uid === 0 && top.uid !== 0) chownSync(path, top.uid, top.gid);
      } catch {}
    }
  }
}

// --- What the page shows ----------------------------------------------------------------------------

export interface ArrayDisk {
  path: string;
  /** Bytes */
  size: number;
  used: number;
  /** It is part of a merged folder: fine for data, not for parity */
  merged: boolean;
  /** What of Hata lies on it, which parity cannot share a disk with */
  holds: ReturnType<typeof holds>;
}

export interface ArrayReport {
  tool: "ok" | "missing";
  needs: { package: string; install: string } | null;
  on: boolean;
  settings: ArraySettings;
  /** The disks Hata connected for good that can take part */
  candidates: ArrayDisk[];
  /** Of the array's disks, the folders that are not connected now */
  missing: string[];
  /** Bytes the parity file takes */
  paritySize: number;
  /** The rule that leaves AppData out; null — the data folder is not in the array */
  appDataRule: string | null;
  lastSync: State["lastSync"];
  lastScrub: State["lastScrub"];
  diff: State["diff"];
  held: State["held"];
  errors: number;
  trouble: Refusal;
  running: { what: What; since: number; percent: number | null } | null;
  /** The last lines of the last run */
  log: string[];
}

function fstab() {
  return parseFstab(readText("/etc/fstab"));
}

export function candidates(): ArrayDisk[] {
  const lines = fstab();
  const now = mounted();
  const branches = Object.values(pools(lines)).flat();
  const uses = { dataRoot: settings.dataRoot, backupDir: settings.backup.dir || join(settings.dataRoot, "Backups"), state: [DATA_DIR, SECRETS_DIR], shares: settings.shares.map((s) => s.path) };
  return lines
    .filter((e) => e.ours && e.fstype !== POOL_FS && POSIX.test(e.fstype) && now.has(e.path))
    .map((e) => {
      const fs = statfsSync(e.path);
      return { path: e.path, size: fs.blocks * fs.bsize, used: (fs.blocks - fs.bfree) * fs.bsize, merged: branches.includes(e.path), holds: holds(e.path, uses) };
    });
}

const rule = (): string | null => appDataRule(settings.dataRoot, settings.snapraid.data.map((d) => d.path), pools(fstab()));

export function arrayReport(): ArrayReport {
  let paritySize = 0;
  try {
    if (isOn()) paritySize = statSync(join(settings.snapraid.parity, PARITY)).size;
  } catch {}
  return {
    tool: installed() ? "ok" : "missing",
    needs: installed() ? null : { package: PACKAGE, install: installCommand(PACKAGE) },
    on: isOn(),
    settings: settings.snapraid,
    candidates: candidates(),
    missing: isOn() ? missing() : [],
    paritySize,
    appDataRule: rule(),
    lastSync: state.lastSync,
    lastScrub: state.lastScrub,
    diff: state.diff,
    held: state.held,
    errors: state.errors,
    trouble: state.trouble,
    running: current && { what: current.what, since: current.since, percent: current.percent },
    log: current ? current.log.slice(-60) : lastLog,
  };
}

/** For the "needs attention" list */
export function arrayTrouble(): { code: string; detail: Record<string, string | number> }[] {
  if (!isOn()) return [];
  const items: { code: string; detail: Record<string, string | number> }[] = [];
  if (state.errors) items.push({ code: "errors", detail: { n: state.errors } });
  if (state.trouble?.code === "diskEmpty") items.push({ code: "diskEmpty", detail: { disk: settings.snapraid.data.find((d) => d.name === state.trouble!.disk)?.path ?? state.trouble.disk } });
  else if (state.trouble?.code === "parityLost") items.push({ code: "parityLost", detail: { disk: settings.snapraid.parity } });
  else if (state.held) items.push({ code: "held", detail: { n: state.held.removed } });
  else if (state.lastSync && !state.lastSync.ok) items.push({ code: "failed", detail: { message: state.lastSync.message } });
  return items;
}

// --- Setting up -------------------------------------------------------------------------------------

export class ArrayError extends Error {
  constructor(
    readonly code: string,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

const idle = () => {
  if (current) throw new ArrayError("array.busy");
};

function writeConf(): void {
  const found = readText(CONF);
  if (found && !isOurs(found) && !existsSync(CONF_BEFORE)) writeFileSync(CONF_BEFORE, found);
  const leaveOut = settings.snapraid.appData ? null : rule();
  writeFileSync(CONF, snapraidConf(settings.snapraid, leaveOut ? [leaveOut] : []));
  mkdirSync(CONTENT_DIR, { recursive: true });
}

/** Forgets what the array knew: with other disks in it, the parity it has is of no use */
function startAfresh(old: ArraySettings): void {
  if (old.parity) rmSync(join(old.parity, PARITY), { force: true });
  rmSync(join(CONTENT_DIR, CONTENT), { force: true });
  for (const disk of old.data) rmSync(join(disk.path, CONTENT), { force: true });
  Object.assign(state, { lastSync: null, lastScrub: null, diff: null, held: null, errors: 0, trouble: null });
}

/** Turns the protection on, or changes it. Adding a data disk keeps the parity; any other change of disks starts it anew */
export function setUp(input: Record<string, unknown>, user: string): void {
  idle();
  if (!installed()) throw new ArrayError("array.noTool");
  const old = settings.snapraid;
  const found = candidates();
  const parity = typeof input.parity === "string" ? input.parity : "";
  const paths = Array.isArray(input.data) ? [...new Set(input.data.filter((p): p is string => typeof p === "string"))] : [];
  const disk = (path: string) => found.find((c) => c.path === path);
  const parityDisk = disk(parity);
  if (!parityDisk || !paths.length || paths.includes(parity) || paths.some((p) => !disk(p))) throw new ArrayError("array.badDisks");
  if (parityDisk.merged) throw new ArrayError("array.parityMerged");
  if (parityDisk.holds) throw new ArrayError("array.parityHolds");
  const largest = Math.max(...paths.map((p) => disk(p)!.size));
  // the same model of disk comes out a few megabytes apart
  if (parityDisk.size < largest * 0.99) throw new ArrayError("array.parityTooSmall");
  const time = typeof input.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : old.time;
  const limit = Number.isInteger(input.deleteLimit) && (input.deleteLimit as number) >= 0 && (input.deleteLimit as number) <= 1_000_000 ? (input.deleteLimit as number) : old.deleteLimit;
  const names: string[] = [];
  const data = paths.map((path) => {
    const name = old.data.find((d) => d.path === path)?.name ?? diskName(path, [...names, ...old.data.map((d) => d.name)]);
    names.push(name);
    return { name, path };
  });
  const kept = old.parity === parity && old.data.every((d) => paths.includes(d.path));
  if (!kept) startAfresh(old);
  const was = isOn();
  settings.snapraid = { parity, data, appData: input.appData === true, time, scrub: input.scrub !== false, deleteLimit: limit };
  saveSettings();
  writeConf();
  save();
  record(was ? "array.changed" : "array.on", { user, detail: String(data.length) });
  // what there is to protect, for the page; the first sync is the person's to start
  void refreshDiff().then(save, () => {});
}

/** Turns the protection off; `wipe` also removes the parity and the lists, which only take room without it */
export function turnOff(wipe: boolean, user: string): void {
  idle();
  if (!isOn()) return;
  const old = settings.snapraid;
  if (wipe) startAfresh(old);
  else Object.assign(state, { held: null, trouble: null, errors: 0 });
  settings.snapraid = { ...old, parity: "", data: [] };
  saveSettings();
  if (isOurs(readText(CONF))) {
    if (existsSync(CONF_BEFORE)) renameSync(CONF_BEFORE, CONF);
    else rmSync(CONF, { force: true });
  }
  save();
  record("array.off", { user });
}

// --- Running ----------------------------------------------------------------------------------------

const must = () => {
  idle();
  if (!isOn()) throw new ArrayError("array.off");
  if (!installed()) throw new ArrayError("array.noTool");
};

const background = (work: () => Promise<void>): void => {
  void work()
    .catch((e) => console.error("snapraid:", e instanceof Error ? e.message : e))
    .finally(save);
};

async function syncNow(force: boolean, user: string, args: string[] = []): Promise<void> {
  const gone = missing();
  if (gone.length) {
    state.lastSync = { at: Date.now(), ok: false, message: `Not connected: ${gone.join(", ")}` };
    return;
  }
  writeConf();
  const diff = await refreshDiff();
  if (!diff) {
    state.lastSync = { at: Date.now(), ok: false, message: "The disks could not be read" };
    return;
  }
  // a disk with nothing on it that had files: a new one in the place of a dead one, said as what it is
  const emptied = diff.removed > 0 && !args.includes("--force-empty") ? settings.snapraid.data.find((disk) => bare(disk.path)) : undefined;
  if (emptied) {
    if (state.trouble?.code !== "diskEmpty") record("array.diskEmpty", { user, detail: emptied.path });
    state.trouble = { code: "diskEmpty", disk: emptied.name };
    state.held = null;
    return;
  }
  const limit = settings.snapraid.deleteLimit;
  if (!force && limit > 0 && diff.removed > limit) {
    if (!state.held) record("array.held", { user, detail: String(diff.removed) });
    state.held = { removed: diff.removed, at: Date.now() };
    return;
  }
  const result = await snap(args.includes("--force-full") ? "rebuild" : "sync", [...args, "sync"]);
  if (result.code === -2) return;
  if (result.code !== 0) {
    state.trouble = refusal(result.out);
    state.lastSync = { at: Date.now(), ok: false, message: lastLine(result.out) };
    record("array.sync.failed", { user, detail: state.lastSync.message });
    return;
  }
  state.held = null;
  state.trouble = null;
  state.lastSync = { at: Date.now(), ok: true, message: "" };
  state.diff = { equal: diff.equal + diff.added + diff.updated + diff.moved + diff.copied + diff.restored, added: 0, removed: 0, updated: 0, moved: 0, copied: 0, restored: 0, at: Date.now() };
  record("array.sync.done", { user, detail: String(diff.added + diff.updated) });
}

/**
 * Brings the parity up to date. `force` — also when more files are gone than the limit; `empty` —
 * also when a disk has lost everything it had, which the person says was meant.
 */
export function sync(force: boolean, user: string, empty = false): void {
  must();
  background(() => syncNow(force, user, empty ? ["--force-empty"] : []));
}

/** Computes the whole parity anew: for a parity disk that was replaced */
export function rebuild(user: string): void {
  must();
  background(() => syncNow(true, user, ["--force-full"]));
}

async function scrubNow(user: string, part = "12", older = "10"): Promise<void> {
  if (missing().length) return;
  const result = await snap("scrub", ["scrub", "-p", part, "-o", older]);
  if (result.code === -2) return;
  await refreshStatus();
  state.lastScrub = { at: Date.now(), ok: state.errors === 0 };
  if (state.errors) record("array.errors", { user, detail: String(state.errors) });
}

/** Reads a part of the array and compares it with what it should be; `whole` — all of it */
export function scrub(whole: boolean, user: string): void {
  must();
  background(() => scrubNow(user, whole ? "100" : "12", whole ? "0" : "10"));
}

/** Repairs the blocks a check found damaged, then checks them again */
export function repair(user: string): void {
  must();
  background(async () => {
    const result = await snap("repair", ["-e", "fix"]);
    if (result.code === -2) return;
    const done = fixed(result.out);
    for (const disk of settings.snapraid.data) giveBack(disk.path, done.recovered);
    await snap("repair", ["-p", "bad", "scrub"]);
    await refreshStatus();
    state.lastScrub = { at: Date.now(), ok: state.errors === 0 };
    record(state.errors ? "array.repair.failed" : "array.repair.done", { user, detail: String(done.recovered.length) });
  });
}

/**
 * Brings back the files that are gone since the last sync — all of them, or those of one disk (a disk
 * that was replaced comes back whole this way). Files that are there are never touched.
 */
export function bringBack(name: unknown, user: string): void {
  must();
  const disk = typeof name === "string" && name ? settings.snapraid.data.find((d) => d.name === name) : undefined;
  if (name && !disk) throw new ArrayError("array.badDisks");
  if (missing().length) throw new ArrayError("array.missing", { disks: missing().join(", ") });
  background(async () => {
    const result = await snap("fix", [...(disk ? ["-d", disk.name] : []), "fix", "-m"]);
    if (result.code === -2) return;
    const done = fixed(result.out);
    for (const d of disk ? [disk] : settings.snapraid.data) giveBack(d.path, done.recovered);
    state.held = null;
    if (state.trouble?.code === "diskEmpty") state.trouble = null;
    record(done.unrecoverable || result.code !== 0 ? "array.fix.failed" : "array.fix.done", { user, detail: done.unrecoverable ? `${done.recovered.length} / ${done.unrecoverable}` : String(done.recovered.length) });
    await refreshDiff();
  });
}

/** Stops the run that is going; SnapRAID saves how far it got */
export function stop(): void {
  if (!current?.proc) return;
  current.stopped = true;
  current.proc.kill("SIGINT");
}

/** The nightly sync, the weekly check, and a look at what is not protected yet when the server starts */
export function startSnapraid(): void {
  let lastDay = "";
  setInterval(() => {
    if (!isOn() || !installed() || current) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const day = now.toDateString();
    if (time !== settings.snapraid.time || lastDay === day) return;
    lastDay = day;
    background(async () => {
      await syncNow(false, "schedule");
      // on Sundays, and only on top of a parity that is up to date
      if (settings.snapraid.scrub && now.getDay() === 0 && state.lastSync?.ok && !state.held) await scrubNow("schedule");
    });
  }, 20_000);
  setTimeout(() => {
    if (isOn() && installed() && !current) background(async () => void (await refreshDiff()));
  }, 90_000);
}
