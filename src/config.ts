/**
 * Paths and settings. The source of truth for settings is data/settings.json (edited through the web UI);
 * environment variables only override where the server listens.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cleanLayout, type Layout } from "./dashboard";
import { changeAppearance, cleanAppearance, DEFAULT_APPEARANCE, type Appearance } from "./wallpapers";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { POINTER_FILE, serviceStateDir, stateIsMissing } from "./statedir";
import { COMPILED } from "./version";

/**
 * State directory. A run from source keeps it in the working copy; the binary uses the system location
 * (the same one the service uses), so `hata setup-url` finds the state of the running service.
 */
function defaultDataDir(): string {
  if (!COMPILED) return join(process.cwd(), "data");
  return process.getuid?.() === 0 ? serviceStateDir() : join(homedir(), ".local", "share", "hata");
}

export const DATA_DIR = resolve(process.env.HATA_DATA_DIR || defaultDataDir());
if (stateIsMissing(DATA_DIR)) {
  console.error(`The configuration folder ${DATA_DIR} is not there — is its disk mounted?\nHata will not start with an empty one. To begin anew on purpose, remove ${POINTER_FILE}.`);
  process.exit(1);
}
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
  /** Who may open which app, and which apps are behind Hata's sign-in; an app not listed is open to members */
  access: Record<string, AppAccess>;
  https: HttpsSettings;
  /**
   * The name on the home network, and `<app>.<name>` for every app. One ending in `.local` Hata answers
   * for itself over multicast DNS; any other (`hata.lan`) the home's own DNS has to point here.
   */
  local: { enabled: boolean; name: string };
  /** Folders put on the dashboard from the file manager, absolute paths */
  folders: string[];
  /** How the dashboard is arranged: groups, links, folders of tiles */
  dashboard: Layout;
  /** Colours and the background picture of the UI */
  appearance: Appearance;
}

export interface HttpsSettings {
  /**
   * off — plain HTTP, reached by address and port;
   * proxy — a reverse proxy of the user's (nginx, Caddy, Traefik) holds the certificate and passes
   *   requests on to Hata over HTTP;
   * acme — Hata gets certificates from Let's Encrypt and serves HTTPS itself
   */
  mode: "off" | "proxy" | "acme";
  /** The name Hata is reached by; apps are at `<app>.<domain>` */
  domain: string;
  /** Contact for the certificate authority (acme) */
  email: string;
}

export interface AppAccess {
  /** "all" — every member; a list — only these users (ids). Administrators may always. */
  allowed: "all" | string[];
  /** Hata listens on the app's port and lets only signed-in, allowed users through */
  protect: boolean;
  /** With `protect`: the port people open, and the local port the app really listens on */
  port?: number;
  upstream?: number;
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
  access: {},
  https: { mode: "off", domain: "", email: "" },
  local: { enabled: true, name: "hata.local" },
  folders: [],
  dashboard: cleanLayout(null),
  appearance: DEFAULT_APPEARANCE,
};

/** A host name with at least two labels: letters, digits and hyphens */
export const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The name on the home network as it is kept: a whole host name; a single word means `<word>.local` */
export function localName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase().replace(/\.$/, "");
  const whole = name.includes(".") ? name : name + ".local";
  return DOMAIN_RE.test(whole) ? whole : null;
}

const saved = readJsonFile<Partial<Settings>>(SETTINGS_FILE, {}, isPlainObject);

export const settings: Settings = {
  ...DEFAULTS,
  ...saved,
  // a settings file written by an older version has no such section, or only part of it
  backup: { ...DEFAULTS.backup, ...(isPlainObject(saved.backup) ? saved.backup : {}) },
  access: isPlainObject(saved.access) ? (saved.access as Record<string, AppAccess>) : {},
  folders: Array.isArray(saved.folders) ? saved.folders.filter((path): path is string => typeof path === "string") : [],
  dashboard: cleanLayout(saved.dashboard),
  appearance: cleanAppearance(saved.appearance),
  https: { ...DEFAULTS.https, ...(isPlainObject(saved.https) ? saved.https : {}) },
  local: { ...DEFAULTS.local, ...(isPlainObject(saved.local) ? saved.local : {}) },
};
settings.local.name = localName(settings.local.name) ?? DEFAULTS.local.name;

/** Writes the settings after a change made in place (the access rules are edited that way) */
export function saveSettings(): void {
  writeJsonAtomic(SETTINGS_FILE, settings);
}

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
  if ("https" in patch) {
    const h = patch.https;
    if (!isPlainObject(h)) return "settings.badHttps";
    const https = { ...next.https };
    if ("mode" in h) {
      if (h.mode !== "off" && h.mode !== "proxy" && h.mode !== "acme") return "settings.badHttps";
      https.mode = h.mode;
    }
    if ("domain" in h) {
      const domain = typeof h.domain === "string" ? h.domain.trim().toLowerCase() : null;
      if (domain === null || (domain !== "" && !DOMAIN_RE.test(domain))) return "settings.badDomain";
      https.domain = domain;
    }
    if ("email" in h) {
      if (typeof h.email !== "string" || (h.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h.email))) return "settings.badEmail";
      https.email = h.email.trim();
    }
    if (https.mode !== "off" && !https.domain) return "settings.needDomain";
    next.https = https;
  }
  if ("local" in patch) {
    const l = patch.local;
    if (!isPlainObject(l)) return "settings.badLocalName";
    const local = { ...next.local };
    if ("enabled" in l) local.enabled = l.enabled === true;
    if ("name" in l) {
      const name = localName(l.name);
      if (!name) return "settings.badLocalName";
      local.name = name;
    }
    next.local = local;
  }
  if ("appearance" in patch) {
    const appearance = isPlainObject(patch.appearance) ? changeAppearance(next.appearance, patch.appearance) : null;
    if (!appearance) return "settings.badAppearance";
    next.appearance = appearance;
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
