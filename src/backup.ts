/**
 * Backups of app data.
 *
 * A snapshot of an app is one `tar.gz` with everything needed to bring the app back: its compose
 * directory, its folders under `<dataRoot>/AppData/`, and its named Docker volumes. Next to the archive
 * lies a small JSON file describing it. Snapshots are plain files in `<backup dir>/<app>/`, so they can
 * be copied away, inspected and restored by hand with `tar`.
 *
 * The app is stopped while its data is copied — a database copied mid-write is not a backup — and
 * started again whatever happens. `tar` does the work: it keeps owners and permissions, which the apps
 * depend on.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME_RE, appMeta, bindSources, normalize } from "./appform";
import { AppError, appAction, appDir, dc, installedNames, jobFinished, onBeforeUpdate, readCompose, startJob, type Job, type Log } from "./apps";
import { record } from "./activity";
import { DATA_DIR, SECRET_NAMES, SECRETS_DIR, settings } from "./config";
import { listContainers, PROJECT_LABEL, run } from "./docker";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { listServerSnapshots, RESTORE_MARK, SERVER_DIR, stateExcludes, type ServerSnapshot } from "./restore";
import { VERSION } from "./version";

export type SnapshotReason = "manual" | "schedule" | "pre-update";

export interface Snapshot {
  /** Also the file name: local time, `20261009-031400` */
  id: string;
  app: string;
  at: number;
  reason: SnapshotReason;
  /** Size of the archive, bytes */
  size: number;
  /** What the archive holds, absolute paths */
  paths: string[];
  /** Images the app was running, for the record */
  images: string[];
}

const KEEP_PRE_UPDATE = 3;
const SNAPSHOT_ID_RE = /^\d{8}-\d{6}$/;

export const backupDir = (): string => settings.backup.dir || join(settings.dataRoot, "Backups");
const appBackupDir = (name: string) => join(backupDir(), name);

function snapshotId(at: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

// --- What belongs to an app -------------------------------------------------------------------------

/** The app's folders: those under `<dataRoot>/AppData/` are backed up, the rest are only reported */
export function appFolders(name: string): { included: string[]; other: string[] } {
  const compose = readCompose(name);
  if (!compose) return { included: [], other: [] };
  const copy = structuredClone(compose);
  normalize(copy, settings.dataRoot, name);
  const root = (settings.dataRoot === "/" ? "" : settings.dataRoot) + "/AppData/";
  const included: string[] = [];
  const other: string[] = [];
  for (const folder of bindSources(copy)) {
    if (/^\/(dev|proc|sys|run|var\/run|etc)(\/|$)/.test(folder)) continue;
    (folder.startsWith(root) ? included : other).push(folder);
  }
  return { included, other };
}

/** Where Docker keeps the named volumes of the app's compose project */
async function volumePaths(name: string): Promise<string[]> {
  const filter = `label=${PROJECT_LABEL}=${name}`;
  const out = await run(["docker", "volume", "ls", "--filter", filter, "--format", "{{.Mountpoint}}"]);
  return out.code === 0 ? out.output.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")) : [];
}

/** Drops paths that lie inside another path of the list: tar would store them twice */
export function withoutNested(paths: string[]): string[] {
  const unique = [...new Set(paths)].sort();
  return unique.filter((path) => !unique.some((other) => other !== path && path.startsWith(other + "/")));
}

/** May a restore delete and rewrite this path? Only the app's own directory, AppData and Docker volumes */
export function restorable(path: string, name: string, dataRoot = settings.dataRoot): boolean {
  if (path.includes("\0") || path.split("/").includes("..")) return false;
  if (path === appDir(name)) return true;
  const appData = (dataRoot === "/" ? "" : dataRoot) + "/AppData/";
  if (path.startsWith(appData) && path.length > appData.length) return true;
  return /^\/var\/lib\/docker\/volumes\/[A-Za-z0-9][A-Za-z0-9_.-]*\/_data$/.test(path);
}

// --- Snapshots on disk ------------------------------------------------------------------------------

export function listSnapshots(name: string): Snapshot[] {
  if (!APP_NAME_RE.test(name)) return [];
  let files: string[];
  try {
    files = readdirSync(appBackupDir(name));
  } catch {
    return [];
  }
  const out: Snapshot[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !SNAPSHOT_ID_RE.test(id)) continue;
    const meta = readJsonFile<Snapshot | null>(join(appBackupDir(name), file), null);
    if (meta && existsSync(join(appBackupDir(name), id + ".tar.gz"))) out.push({ ...meta, id, app: name });
  }
  return out.sort((a, b) => b.at - a.at);
}

function deleteFiles(name: string, id: string): void {
  rmSync(join(appBackupDir(name), id + ".tar.gz"), { force: true });
  rmSync(join(appBackupDir(name), id + ".json"), { force: true });
}

export function deleteSnapshot(name: string, id: string): void {
  if (!APP_NAME_RE.test(name) || !SNAPSHOT_ID_RE.test(id)) throw new AppError("backup.notFound", 404);
  if (!listSnapshots(name).some((s) => s.id === id)) throw new AppError("backup.notFound", 404);
  deleteFiles(name, id);
}

/** Which snapshots to delete after a new one: scheduled ones beyond `keep`, pre-update ones beyond three */
export function expired(snapshots: Snapshot[], keep: number): Snapshot[] {
  const newestFirst = [...snapshots].sort((a, b) => b.at - a.at);
  const beyond = (reason: SnapshotReason, limit: number) => newestFirst.filter((s) => s.reason === reason).slice(limit);
  // manual snapshots are the user's: only the user deletes them
  return [...beyond("schedule", keep), ...beyond("pre-update", KEEP_PRE_UPDATE)];
}

// --- Taking and restoring ---------------------------------------------------------------------------

const tarPath = (path: string) => path.replace(/^\/+/, "");

/** Snapshots an app. Runs inside a job that already owns the app. */
export async function takeSnapshot(name: string, reason: SnapshotReason, log: Log): Promise<Snapshot> {
  const dir = appBackupDir(name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = new Date();
  const id = snapshotId(at);
  const { included, other } = appFolders(name);
  const paths = withoutNested([appDir(name), ...included, ...(await volumePaths(name))]).filter((p) => existsSync(p));
  for (const folder of other) log(`Not included (outside AppData): ${folder}`);

  const containers = (await listContainers().catch(() => [])).filter((c) => c.Labels[PROJECT_LABEL] === name);
  const wasRunning = containers.some((c) => c.State === "running" || c.State === "restarting");
  const archive = join(dir, id + ".tar.gz");
  const partial = archive + ".partial";
  if (wasRunning) await dc(name, ["stop"], log);
  try {
    log(`$ tar -czf ${archive} ${paths.join(" ")}`);
    const tar = await run(["tar", "--numeric-owner", "-czf", partial, "-C", "/", ...paths.map(tarPath)]);
    // 1 is "a file changed while it was read": the archive is complete
    if (tar.code > 1) throw new Error(tar.output.split("\n").slice(-3).join("\n") || `tar exited with ${tar.code}`);
    renameSync(partial, archive);
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  } finally {
    if (wasRunning) await dc(name, ["start"], log).catch((e) => log(`Could not start the app again: ${e instanceof Error ? e.message : e}`));
  }

  const snapshot: Snapshot = { id, app: name, at: at.getTime(), reason, size: statSync(archive).size, paths, images: [...new Set(containers.map((c) => c.Image))] };
  writeJsonAtomic(join(dir, id + ".json"), snapshot);
  log(`Snapshot ${id}: ${(snapshot.size / 1024 / 1024).toFixed(1)} MB`);
  for (const old of expired(listSnapshots(name), settings.backup.keep)) {
    deleteFiles(name, old.id);
    log(`Removed old snapshot ${old.id}`);
  }
  return snapshot;
}

export function backupApp(name: string, user: string, reason: SnapshotReason = "manual"): Job {
  if (!APP_NAME_RE.test(name) || !existsSync(join(appDir(name), "compose.yml"))) throw new AppError("app.notFound", 404);
  return startJob(name, "backup", user, async (log) => {
    await takeSnapshot(name, reason, log);
  });
}

/**
 * Puts an app back to a snapshot: its folders are replaced by the archive's content and the app is
 * started from the compose file of that moment. Works for a removed app too.
 */
export function restoreSnapshot(name: string, id: string, user: string): Job {
  if (!APP_NAME_RE.test(name) || !SNAPSHOT_ID_RE.test(id)) throw new AppError("backup.notFound", 404);
  const snapshot = listSnapshots(name).find((s) => s.id === id);
  if (!snapshot) throw new AppError("backup.notFound", 404);
  const archive = join(appBackupDir(name), id + ".tar.gz");
  return startJob(name, "restore", user, async (log) => {
    const refused = snapshot.paths.filter((p) => !restorable(p, name));
    if (refused.length) throw new Error(`The snapshot holds paths a restore must not touch: ${refused.join(", ")}`);
    // the archive is ours, but it has been lying on a disk: check it holds what its description says
    const listing = await run(["tar", "-tzf", archive]);
    if (listing.code !== 0) throw new Error("The archive is damaged: " + listing.output.split("\n").slice(-1)[0]);
    const allowed = snapshot.paths.map(tarPath);
    const stray = listing.output.split("\n").filter((m) => m && !allowed.some((a) => m === a || m === a + "/" || m.startsWith(a + "/")));
    if (stray.length) throw new Error(`The archive holds files outside the app: ${stray[0]}`);

    if (existsSync(join(appDir(name), "compose.yml"))) await dc(name, ["stop"], log);
    for (const path of snapshot.paths) {
      log(`Replacing ${path}`);
      rmSync(path, { recursive: true, force: true });
    }
    log(`$ tar -xzf ${archive} -C /`);
    const tar = await run(["tar", "--numeric-owner", "-xzpf", archive, "-C", "/"]);
    if (tar.code !== 0) throw new Error(tar.output.split("\n").slice(-3).join("\n") || `tar exited with ${tar.code}`);
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  });
}

// --- The server itself ------------------------------------------------------------------------------

/**
 * Snapshots Hata's own state: settings, users, the apps' compose files, certificates. With the apps'
 * snapshots next to it, this is what `hata restore` rebuilds a server from. It holds password hashes
 * and keys, so it is as private as the state directory itself.
 */
/** The secrets lie apart from the state on an installed service; in the archive they sit with the rest */
function secretsForArchive(): string[] {
  if (SECRETS_DIR === DATA_DIR) return [];
  const names = SECRET_NAMES.filter((name) => name !== "sessions.json" && name !== "setup-token" && existsSync(join(SECRETS_DIR, name)));
  return names.length ? ["-C", SECRETS_DIR, ...names.map((name) => "./" + name)] : [];
}

export async function takeServerSnapshot(reason: ServerSnapshot["reason"]): Promise<ServerSnapshot> {
  const dir = join(backupDir(), SERVER_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = new Date();
  const id = snapshotId(at);
  const archive = join(dir, id + ".tar.gz");
  const partial = archive + ".partial";
  try {
    const tar = await run(["tar", "--numeric-owner", "-czf", partial, ...stateExcludes(DATA_DIR, backupDir()).map((path) => "--exclude=" + path), "-C", DATA_DIR, ".", ...secretsForArchive()]);
    // 1 is "a file changed while it was read": the state is written atomically, the archive is whole
    if (tar.code > 1) throw new Error(tar.output.split("\n").slice(-3).join("\n") || `tar exited with ${tar.code}`);
    // password hashes and keys are inside
    chmodSync(partial, 0o600);
    renameSync(partial, archive);
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
  const snapshot: ServerSnapshot = { id, at: at.getTime(), reason, size: statSync(archive).size, version: VERSION, apps: installedNames() };
  writeJsonAtomic(join(dir, id + ".json"), snapshot);
  // the same rule as for apps: scheduled ones beyond `keep` go, manual ones are the user's
  const old = listServerSnapshots(backupDir()).filter((s) => s.reason === "schedule").slice(settings.backup.keep);
  for (const { id: gone } of old) {
    rmSync(join(dir, gone + ".tar.gz"), { force: true });
    rmSync(join(dir, gone + ".json"), { force: true });
  }
  return snapshot;
}

/**
 * Finishes what `hata restore` began: the state is back, now every app comes back from its latest
 * snapshot — or, having none, is at least started from its compose file.
 */
export async function resumeRestore(): Promise<void> {
  const mark = join(DATA_DIR, RESTORE_MARK);
  if (!existsSync(mark)) return;
  // taken away first: a restore that fails must not start over at every start of the server
  rmSync(mark, { force: true });
  const failed: string[] = [];
  const names = installedNames();
  for (const name of names) {
    try {
      const latest = listSnapshots(name)[0];
      const job = latest ? restoreSnapshot(name, latest.id, "restore") : appAction(name, "start", "restore");
      await jobFinished(job);
      if (job.status !== "done") failed.push(name);
    } catch (e) {
      console.error(`Could not restore ${name}:`, e instanceof Error ? e.message : e);
      failed.push(name);
    }
  }
  record(failed.length ? "system.restore.failed" : "system.restore.done", { detail: failed.length ? failed.join(", ") : String(names.length) });
}

// a snapshot before every update is what makes an update undoable
onBeforeUpdate(async (name, log) => {
  if (!settings.backup.beforeUpdate) return;
  log("Snapshot before the update");
  await takeSnapshot(name, "pre-update", log);
});

// --- Overview ---------------------------------------------------------------------------------------

export interface BackupApp {
  name: string;
  title: string;
  icon: string;
  installed: boolean;
  /** Part of the scheduled run */
  included: boolean;
  snapshots: Snapshot[];
  /** Folders of the app that are not backed up, because they are outside AppData */
  otherFolders: string[];
}

export interface BackupOverview {
  dir: string;
  /** Free bytes where snapshots are stored; null — the place does not exist yet */
  free: number | null;
  stored: number;
  lastRun: { at: number; ok: number; failed: string[] } | null;
  /** Next scheduled run, ms since epoch; null — the schedule is off */
  nextRun: number | null;
  running: boolean;
  /** Snapshots of Hata's own state, the newest first */
  server: ServerSnapshot[];
  /** The server's time zone: the schedule's time is in it, not in the browser's */
  timezone: string;
  apps: BackupApp[];
}

const STATE_FILE = join(DATA_DIR, "backup-state.json");
interface State {
  lastRun: BackupOverview["lastRun"];
}
const state: State = readJsonFile<State>(STATE_FILE, { lastRun: null });
let running = false;

/** The next moment the daily run is due, given its HH:MM */
export function nextRun(time: string, now: Date): Date {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function backupOverview(lang: string): BackupOverview {
  const dir = backupDir();
  const installed = installedNames();
  let stored: string[] = [];
  try {
    stored = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && APP_NAME_RE.test(e.name)).map((e) => e.name);
  } catch {}
  const apps: BackupApp[] = [...new Set([...installed, ...stored])].sort().map((name) => {
    const meta = appMeta(readCompose(name) ?? { name }, lang);
    return {
      name,
      title: meta.title || name,
      icon: meta.icon,
      installed: installed.includes(name),
      included: !settings.backup.exclude.includes(name),
      snapshots: listSnapshots(name),
      otherFolders: installed.includes(name) ? appFolders(name).other : [],
    };
  });
  let free: number | null = null;
  try {
    const s = statfsSync(dir);
    free = s.bavail * s.bsize;
  } catch {}
  return {
    dir,
    free,
    stored: apps.reduce((sum, app) => sum + app.snapshots.reduce((n, s) => n + s.size, 0), 0),
    lastRun: state.lastRun,
    nextRun: settings.backup.enabled ? nextRun(settings.backup.time, new Date()).getTime() : null,
    running,
    server: listServerSnapshots(dir),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    // a removed app with no snapshots left has nothing to show
    apps: apps.filter((app) => app.installed || app.snapshots.length > 0),
  };
}

// --- The daily run ----------------------------------------------------------------------------------

/** Backs up every included app, one after another. Returns false if a run is already going. */
export async function runBackups(user: string, reason: SnapshotReason = "schedule"): Promise<boolean> {
  if (running) return false;
  running = true;
  const failed: string[] = [];
  let ok = 0;
  try {
    for (const name of installedNames()) {
      if (settings.backup.exclude.includes(name)) continue;
      try {
        const job = backupApp(name, user, reason);
        await jobFinished(job);
        if (job.status === "done") ok++;
        else failed.push(name);
      } catch {
        // busy with something else right now: it is reported as not backed up
        failed.push(name);
      }
    }
    // the server's own state last: it is small, and the run is whole only with it
    await takeServerSnapshot(reason === "manual" ? "manual" : "schedule").catch((e) => {
      console.error("Could not back up the server's state:", e instanceof Error ? e.message : e);
      failed.push("Hata");
    });
  } finally {
    running = false;
    state.lastRun = { at: Date.now(), ok, failed };
    writeJsonAtomic(STATE_FILE, state);
  }
  return true;
}

/** Starts the daily run when its minute comes */
export function scheduleBackups(): void {
  let lastDay = "";
  setInterval(() => {
    if (!settings.backup.enabled) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const day = now.toDateString();
    if (time !== settings.backup.time || lastDay === day) return;
    lastDay = day;
    void runBackups("schedule");
  }, 20_000);
}
