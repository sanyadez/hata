/**
 * JSON state files (data/*.json).
 *
 * - Writes are atomic: temp file + rename, so a crash mid-write never leaves an empty or truncated file.
 * - Reads do not swallow errors silently: a damaged file is moved aside to `<file>.corrupt-<stamp>` and
 *   logged, and the fallback is returned. Otherwise the next save would overwrite it without a trace.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function writeJsonAtomic(path: string, data: unknown, mode = 0o600): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  renameSync(tmp, path);
}

export function writeTextAtomic(path: string, text: string, mode = 0o644): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, path);
}

export function readJsonFile<T>(path: string, fallback: T, validate?: (v: unknown) => boolean): T {
  if (!existsSync(path)) return fallback;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (validate && !validate(parsed)) throw new Error("unexpected shape");
    return parsed as T;
  } catch (e) {
    const backup = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      renameSync(path, backup);
    } catch {}
    console.error(`State file ${path} is damaged (${e instanceof Error ? e.message : e}); moved to ${backup}`);
    return fallback;
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
