/**
 * Where the service keeps its state — the configuration folder: settings, users, the compose files of
 * the apps. It is `/var/lib/hata` unless it was moved; then one line in `/etc/hata/state-dir` says where,
 * because the settings themselves lie in that folder. Imports nothing with side effects: the CLI asks
 * this before there is any state.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const DEFAULT_STATE_DIR = "/var/lib/hata";
export const POINTER_FILE = "/etc/hata/state-dir";
/** Lies in a folder the state was moved to: `{ from }`, the folder it came from */
export const MOVED_MARK = ".hata-state";

/** The folder named by the pointer file, or null when the state was never moved */
export function movedStateDir(pointer = POINTER_FILE): string | null {
  try {
    const path = readFileSync(pointer, "utf8").trim();
    return isAbsolute(path) && path !== "/" ? resolve(path) : null;
  } catch {
    return null;
  }
}

export const serviceStateDir = (): string => movedStateDir() ?? DEFAULT_STATE_DIR;

/**
 * A moved folder that is not there — its disk is not mounted, say — must not be taken for a fresh
 * install: an empty state would greet whoever comes with "create the administrator".
 */
export const stateIsMissing = (dir: string): boolean => movedStateDir() === resolve(dir) && !existsSync(join(dir, MOVED_MARK));

const within = (path: string, dir: string): boolean => {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Folders of the system no state belongs in */
const FORBIDDEN = ["/proc", "/sys", "/dev", "/run", "/tmp", "/boot", "/bin", "/sbin", "/lib", "/lib64", "/usr", "/etc"];

/** Whether the state may be moved from `current` to `target`; returns the cleaned path or an error code */
export function checkTarget(target: unknown, current: string): { path: string } | { error: string } {
  if (typeof target !== "string" || !isAbsolute(target.trim()) || /[\0\n\r]/.test(target) || target.split("/").includes("..")) return { error: "state.badPath" };
  const path = resolve(target.trim());
  if (path === "/" || FORBIDDEN.some((dir) => within(path, dir))) return { error: "state.badPath" };
  if (path === resolve(current)) return { error: "state.samePath" };
  // a folder cannot be copied into itself, and the old one is put aside afterwards
  if (within(path, current) || within(current, path)) return { error: "state.nested" };
  return { path };
}
