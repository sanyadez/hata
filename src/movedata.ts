/**
 * Moving the data folder to another place — a new disk, usually.
 *
 * The apps are stopped, everything in the folder is copied (`cp -a`, on the folder's own file system),
 * the compose files and `.env` of the apps are pointed at the new place, so are the settings that name
 * folders inside (backups, shared folders, folders on the dashboard), and the apps that ran are started
 * again. The old folder is not deleted: it is put aside as `<old>.moved-<date>`, for the person to
 * remove once everything is seen to work. A copy that fails changes nothing.
 *
 * Rewriting a compose file (`rebaseCompose`) is a pure function: only the host side of a bind mount
 * changes, and the file keeps its comments and layout whenever its volumes are written plainly.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statfsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError, appDir, composeFile, dc, installedNames, listApps, listJobs, startJob, writeEnv, type Job, type Log } from "./apps";
import { record } from "./activity";
import { bus } from "./bus";
import { DATA_DIR, saveSettings, SECRETS_DIR, settings } from "./config";
import { folderMoved } from "./files";
import { writeTextAtomic } from "./fsutil";
import { PATH } from "./packages";
import { rebaseCompose, rebaseEnv, rebasePath } from "./rebase";
import { checkTarget } from "./statedir";

const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith("/") ? root : root + "/");

/** Why the data folder cannot be moved to `target` — judged without touching anything; null — it can */
export function cannotMoveData(target: unknown, current: string, state: string[], mounts: string[]): { error: string; detail?: Record<string, string> } | { path: string } {
  if (current === "/") return { error: "data.isRoot" };
  const checked = checkTarget(target, current);
  if ("error" in checked) return { error: checked.error.replace(/^state\./, "data.") };
  if (state.some((dir) => within(checked.path, dir) || within(dir, checked.path))) return { error: "data.badPath" };
  // what another disk holds inside the folder would be left behind, and the apps pointed away from it
  const inside = mounts.filter((mount) => mount !== current && within(mount, current));
  if (inside.length) return { error: "data.hasMounts", detail: { paths: inside.join(", ") } };
  return checked;
}

/**
 * The file system `path` would lie on, when it is one that keeps no owners and permissions (FAT, exFAT,
 * NTFS): apps' data cannot live there — a database refuses its files, everything is open to everyone.
 */
export function ownerless(path: string, mounts: { path: string; fstype: string }[]): string | null {
  const holder = mounts.filter((mount) => within(path, mount.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (!holder) return null;
  if (/^(vfat|msdos|exfat|ntfs3?)$/.test(holder.fstype)) return holder.fstype;
  // ntfs-3g and exfat-fuse
  return holder.fstype === "fuseblk" ? "ntfs" : null;
}

const mountTable = (): { path: string; fstype: string }[] => {
  try {
    return readFileSync("/proc/mounts", "utf8")
      .split("\n")
      .map((line) => line.split(" "))
      .filter((fields) => fields[1])
      .map((fields) => ({ path: fields[1]!.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))), fstype: fields[2] ?? "" }));
  } catch {
    return [];
  }
};
const mountPoints = (): string[] => mountTable().map((mount) => mount.path);

/** `<path>.moved-<date>`, or the first of `…-2`, `…-3` that is free: an older copy put aside is the person's to delete */
function asideName(path: string): string {
  const base = `${path}.moved-${date()}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(name)) return name;
  }
}

async function sh(cmd: string[], log: Log): Promise<{ code: number; out: string; err: string }> {
  log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, PATH, LC_ALL: "C" } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  for (const line of err.trim().split("\n").filter(Boolean).slice(-5)) log(line);
  return { code, out, err: err.trim() };
}

/** Free room where a folder that may not exist yet would lie */
function freeAt(path: string): number {
  let dir = path;
  while (!existsSync(dir) && dir !== "/") dir = dirname(dir);
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
}

const TRASH = ".hata-trash";
const date = () => new Date().toISOString().slice(0, 10);

/** Whether the data folder holds nothing to carry over: no app installed, and nothing in it but the disk's own folders */
function nothingToMove(from: string): boolean {
  if (installedNames().length) return false;
  return !existsSync(from) || readdirSync(from).every((name) => name === TRASH || name === "lost+found");
}

/**
 * Starts the move as a job: its log is what the dialog shows. While there is nothing to move (a fresh
 * server) the folder is simply chosen instead — it may be one that already holds files — and no job runs.
 */
export function moveData(target: unknown, user: string): Job | null {
  const from = settings.dataRoot;
  const checked = cannotMoveData(target, from, [DATA_DIR, SECRETS_DIR], mountPoints());
  if ("error" in checked) throw new AppError(checked.error, 400, checked.detail);
  const to = checked.path;
  const foreign = ownerless(to, mountTable());
  if (foreign) throw new AppError("data.ownerless", 400, { fstype: foreign });
  if (listJobs().some((job) => job.status === "running")) throw new AppError("data.busy", 409);
  if (nothingToMove(from)) {
    settings.dataRoot = to;
    const backups = rebasePath(settings.backup.dir, from, to);
    if (backups !== null) settings.backup.dir = backups;
    saveSettings();
    folderMoved(from, to);
    record("system.data.chosen", { user, detail: to });
    return null;
  }
  if (existsSync(to) && readdirSync(to).some((name) => name !== "lost+found")) throw new AppError("data.notEmpty", 409);

  return startJob("", "move", user, async (log) => {
    const names = installedNames();
    // what each app's files will say, worked out before anything is stopped
    const files: { path: string; text: string }[] = [];
    for (const name of names) {
      for (const path of [composeFile(name), join(appDir(name), ".env")]) {
        if (!existsSync(path)) continue;
        const text = readFileSync(path, "utf8");
        const next = path.endsWith(".env") ? rebaseEnv(text, from, to) : rebaseCompose(text, from, to);
        if (next !== text) files.push({ path, text: next });
      }
    }

    if (existsSync(from)) {
      const measured = await sh(["du", "-sxk", from], () => {});
      const size = Number(/^(\d+)/.exec(measured.out)?.[1] ?? 0) * 1024;
      const free = freeAt(to);
      log(`${from}: ${Math.ceil(size / 1024 ** 2)} MB; free at ${to}: ${Math.floor(free / 1024 ** 2)} MB`);
      if (size > free * 0.97) throw new AppError("data.noSpace", 400);
    }

    const running = (await listApps("en").catch(() => [])).filter((app) => app.status === "running" || app.status === "partial").map((app) => app.name);
    const start = async (): Promise<string[]> => {
      const failed: string[] = [];
      for (const name of running) {
        try {
          writeEnv(name);
          await dc(name, ["up", "-d", "--remove-orphans"], log);
        } catch (e) {
          failed.push(name);
          log(`${name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      return failed;
    };
    for (const name of running) await dc(name, ["stop"], log);

    const made = !existsSync(to);
    const copied: string[] = [];
    try {
      mkdirSync(to, { recursive: true });
      // the trash stays with the old folder: what lies in it was deleted from there; lost+found is the disk's own
      for (const entry of existsSync(from) ? readdirSync(from).filter((name) => name !== TRASH && name !== "lost+found") : []) {
        copied.push(entry);
        const copy = await sh(["cp", "-ax", join(from, entry), to + "/"], log);
        if (copy.code !== 0) throw new Error(copy.err.split("\n")[0] || `cp exited with ${copy.code}`);
      }
    } catch (e) {
      // nothing was changed yet: the copy is taken away and the apps go on where they were
      for (const entry of copied) await rm(join(to, entry), { recursive: true, force: true }).catch(() => {});
      if (made) {
        try {
          rmdirSync(to);
        } catch {}
      }
      await start();
      throw e;
    }

    for (const file of files) writeTextAtomic(file.path, file.text);
    settings.dataRoot = to;
    const backups = rebasePath(settings.backup.dir, from, to);
    if (backups !== null) settings.backup.dir = backups;
    saveSettings();
    folderMoved(from, to);
    log(`The data folder is now ${to}.`);

    if (existsSync(from)) {
      if (mountPoints().includes(from)) log(`${from} is a disk of its own, so the old files stay on it as they are.`);
      else {
        const aside = asideName(from);
        try {
          renameSync(from, aside);
          log(`The old folder is kept as ${aside}. Delete it once everything works.`);
        } catch (e) {
          log(`The old folder stays at ${from}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    bus.publish("apps");
    const failed = await start();
    if (failed.length) throw new Error(`The data folder is moved, but these apps did not start: ${failed.join(", ")}`);
  });
}
