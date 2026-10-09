/**
 * Paths and settings. The source of truth for settings is data/settings.json (edited through the web UI);
 * environment variables only override where the server listens.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { COMPILED } from "./version";

/**
 * State directory. A run from source keeps it in the working copy; the binary uses the system location
 * (the same one the service uses), so `hata setup-url` finds the state of the running service.
 */
function defaultDataDir(): string {
  if (!COMPILED) return join(process.cwd(), "data");
  return process.getuid?.() === 0 ? "/var/lib/hata" : join(homedir(), ".local", "share", "hata");
}

export const DATA_DIR = resolve(process.env.HATA_DATA_DIR || defaultDataDir());
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const SETTINGS_FILE = join(DATA_DIR, "settings.json");

export interface StoreSource {
  /** Short key used in URLs and on disk */
  id: string;
  /** GitHub repository URL of a CasaOS-compatible store */
  url: string;
}

export interface Settings {
  /** Port of the web UI; 0 — the default (80 as root, 8080 otherwise). Applies after a restart */
  port: number;
  /** Root for app data: store apps expect `<dataRoot>/AppData/<app>` and `<dataRoot>/Media` */
  dataRoot: string;
  /** User and group that apps run as (the `$PUID` / `$PGID` variables of store apps) */
  puid: number;
  pgid: number;
  /** `$TZ` for apps; "" — the system time zone */
  timezone: string;
  /** UI language when the browser's language is not available */
  language: string;
  stores: StoreSource[];
  backup: BackupSettings;
}

export interface BackupSettings {
  /** Back up every included app once a day */
  enabled: boolean;
  /** Local time of the daily run, HH:MM */
  time: string;
  /** How many scheduled snapshots of an app to keep */
  keep: number;
  /** Where snapshots are stored; "" — `<dataRoot>/Backups` */
  dir: string;
  /** Take a snapshot of an app before updating it, so the update can be undone */
  beforeUpdate: boolean;
  /** Apps left out of the scheduled run */
  exclude: string[];
}

const DEFAULTS: Settings = {
  port: 0,
  dataRoot: "/DATA",
  puid: 1000,
  pgid: 1000,
  timezone: "",
  language: "en",
  stores: [{ id: "casaos", url: "https://github.com/IceWhaleTech/CasaOS-AppStore" }],
  backup: { enabled: false, time: "03:00", keep: 7, dir: "", beforeUpdate: true, exclude: [] },
};

const saved = readJsonFile<Partial<Settings>>(SETTINGS_FILE, {}, isPlainObject);

export const settings: Settings = {
  ...DEFAULTS,
  ...saved,
  // a settings file written by an older version has no such section, or only part of it
  backup: { ...DEFAULTS.backup, ...(isPlainObject(saved.backup) ? saved.backup : {}) },
};

export function timezone(): string {
  return settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Validates and applies a partial update; returns an error code or null */
export function updateSettings(patch: Record<string, unknown>): string | null {
  const next = { ...settings };
  if ("dataRoot" in patch) {
    const v = patch.dataRoot;
    if (typeof v !== "string" || !/^\/[^\0]*$/.test(v) || v.split("/").includes("..")) return "settings.badDataRoot";
    next.dataRoot = v.length > 1 ? v.replace(/\/+$/, "") : v;
  }
  for (const key of ["puid", "pgid"] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 65534) return "settings.badId";
    next[key] = v;
  }
  if ("timezone" in patch) {
    const v = patch.timezone;
    if (typeof v !== "string") return "settings.badTimezone";
    if (v) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
      } catch {
        return "settings.badTimezone";
      }
    }
    next.timezone = v;
  }
  if ("port" in patch) {
    const v = patch.port;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 65535) return "settings.badPort";
    next.port = v;
  }
  if ("backup" in patch) {
    const b = patch.backup;
    if (!isPlainObject(b)) return "settings.badBackup";
    const backup = { ...next.backup };
    if ("enabled" in b) backup.enabled = b.enabled === true;
    if ("beforeUpdate" in b) backup.beforeUpdate = b.beforeUpdate === true;
    if ("time" in b) {
      if (typeof b.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) return "settings.badTime";
      backup.time = b.time;
    }
    if ("keep" in b) {
      if (typeof b.keep !== "number" || !Number.isInteger(b.keep) || b.keep < 1 || b.keep > 365) return "settings.badKeep";
      backup.keep = b.keep;
    }
    if ("dir" in b) {
      if (typeof b.dir !== "string" || (b.dir !== "" && (!/^\/[^\0]*$/.test(b.dir) || b.dir.split("/").includes("..")))) return "settings.badBackupDir";
      backup.dir = b.dir.length > 1 ? b.dir.replace(/\/+$/, "") : b.dir;
    }
    if ("exclude" in b) {
      if (!Array.isArray(b.exclude) || b.exclude.some((n) => typeof n !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(n))) return "settings.badBackup";
      backup.exclude = [...new Set(b.exclude as string[])];
    }
    next.backup = backup;
  }
  if ("language" in patch) {
    if (typeof patch.language !== "string" || !/^[a-z]{2}$/.test(patch.language)) return "settings.badLanguage";
    next.language = patch.language;
  }
  Object.assign(settings, next);
  writeJsonAtomic(SETTINGS_FILE, settings);
  return null;
}

export const DEFAULT_PORT = process.getuid?.() === 0 ? 80 : 8080;

/** Where the server listens: the environment wins over the settings, port 80 needs root */
export function listenAddress(): { port: number; hostname: string } {
  const port = Number(process.env.HATA_PORT ?? process.env.PORT ?? (settings.port || DEFAULT_PORT));
  return { port, hostname: process.env.HATA_HOST ?? "0.0.0.0" };
}
