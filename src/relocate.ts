/**
 * Moving the configuration folder: everything in the state directory is copied to the new place, the
 * pointer and the service unit are told about it, and the service restarts there. The apps are not
 * touched — their containers keep running, only the compose files they were started from change place.
 * The old folder is kept as `<old>.moved-<date>` by the server that starts in the new one.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listJobs } from "./apps";
import { DATA_DIR, saveSettings, settings } from "./config";
import { writeJsonAtomic } from "./fsutil";
import { rewriteUnit } from "./service";
import { checkTarget, DEFAULT_STATE_DIR, MOVED_MARK, POINTER_FILE } from "./statedir";
import { COMPILED } from "./version";

/** Why the folder cannot be moved on this machine at all: only the installed service knows how to come back */
export function cannotMove(): string | null {
  if (!COMPILED || process.getuid?.() !== 0 || !process.env.INVOCATION_ID || !Bun.which("systemctl")) return "state.notService";
  return null;
}

/** Copies the state to `target` and restarts the service there; returns an error code or null */
export function moveState(target: unknown): { error: string; detail?: Record<string, string> } | null {
  const blocked = cannotMove();
  if (blocked) return { error: blocked };
  const checked = checkTarget(target, DATA_DIR);
  if ("error" in checked) return { error: checked.error };
  const { path } = checked;
  if (listJobs().some((job) => job.status === "running")) return { error: "state.busy" };
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (readdirSync(path).length > 0) return { error: "state.notEmpty" };
    // a backup folder kept inside the state moves along with it
    const backups = settings.backup.dir;
    const inside = backups === DATA_DIR || backups.startsWith(DATA_DIR + "/");
    if (inside) {
      settings.backup.dir = path + backups.slice(DATA_DIR.length);
      saveSettings();
    }
    // one blocking copy: nothing of ours writes to the folder while it runs
    const copy = Bun.spawnSync({ cmd: ["cp", "-a", DATA_DIR + "/.", path + "/"], stderr: "pipe" });
    if (inside) {
      settings.backup.dir = backups;
      saveSettings();
    }
    if (copy.exitCode !== 0) {
      rmSync(path, { recursive: true, force: true });
      return { error: "state.copyFailed", detail: { message: copy.stderr.toString().trim().split("\n")[0] ?? "" } };
    }
    writeJsonAtomic(join(path, MOVED_MARK), { from: DATA_DIR, at: Date.now() });
    mkdirSync(dirname(POINTER_FILE), { recursive: true });
    if (path === DEFAULT_STATE_DIR) rmSync(POINTER_FILE, { force: true });
    else writeFileSync(POINTER_FILE, path + "\n");
    rewriteUnit(path);
  } catch (e) {
    return { error: "state.copyFailed", detail: { message: e instanceof Error ? e.message : String(e) } };
  }
  // the answer goes out first; the restart is asked of systemd, which outlives this process
  setTimeout(() => Bun.spawn({ cmd: ["systemd-run", "--collect", "--quiet", "systemctl", "restart", "hata.service"], stdout: "ignore", stderr: "ignore" }), 400);
  return null;
}

/** On start in a folder the state was moved to: the folder it came from is put aside, once */
export function finishMove(): string | null {
  const mark = join(DATA_DIR, MOVED_MARK);
  try {
    const { from, done } = JSON.parse(readFileSync(mark, "utf8")) as { from?: string; done?: boolean };
    if (done || typeof from !== "string" || from === DATA_DIR || !existsSync(from)) return null;
    const aside = `${from}.moved-${new Date().toISOString().slice(0, 10)}`;
    rmSync(aside, { recursive: true, force: true });
    renameSync(from, aside);
    writeJsonAtomic(mark, { from, done: true });
    return aside;
  } catch {
    return null;
  }
}
