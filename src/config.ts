/**
 * Paths and settings. The source of truth for settings is data/settings.json (edited through the web UI);
 * environment variables only override where the server listens.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cleanLayout, type Layout } from "./dashboard";
import { cleanShares, type Share } from "./smbconf";
import { changeAppearance, cleanAppearance, DEFAULT_APPEARANCE, type Appearance } from "./wallpapers";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { POINTER_FILE, serviceStateDir, stateIsMissing, SYSTEM_SECRETS_DIR } from "./statedir";
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

/** What must not be read by anyone but Hata: password hashes, sessions, keys, tokens */
export const SECRET_NAMES = ["users.json", "sessions.json", "setup-token", "invites.json", "notify.json", "certs", "backup-remote.json", "backup-key", "backup-key.pub", "backup-known-hosts", "agents.json", "oauth.json", "assistant.json", "assistant-chats.json", "wireguard.json"];

/**
 * Where the secrets lie. For the installed service that is `/etc/hata`, whatever the configuration
 * folder is: that one can be moved to a disk apps are given, this one never leaves the system. A run
 * from source or by a plain user keeps everything in one place.
 */
export const SECRETS_DIR = resolve(process.env.HATA_SECRETS_DIR || (COMPILED && process.getuid?.() === 0 ? SYSTEM_SECRETS_DIR : DATA_DIR));
mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
if (SECRETS_DIR !== DATA_DIR) {
  chmodSync(SECRETS_DIR, 0o700);
  // a version that kept them with the rest left them there: taken over, not yet removed —
  // the version before this one must still find them if this one is rolled back
  for (const name of SECRET_NAMES) {
    const old = join(DATA_DIR, name);
    if (existsSync(old) && !existsSync(join(SECRETS_DIR, name))) cpSync(old, join(SECRETS_DIR, name), { recursive: true, preserveTimestamps: true });
  }
}

/** Once this version is known to run: the copies of the secrets left in the configuration folder go */
export function dropOldSecrets(): void {
  if (SECRETS_DIR === DATA_DIR) return;
  for (const name of SECRET_NAMES) rmSync(join(DATA_DIR, name), { recursive: true, force: true });
}

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
  /** Newer images in the registries: looking for them, and updating the apps by itself */
  images: ImageSettings;
  /** Disks: whether a USB disk that is plugged in is mounted by itself */
  /** `ignored` — disks nothing uses that the person said not to mention again, by serial number */
  storage: { automount: boolean; ignored: string[] };
  /** Protection from a disk failure: which disk holds parity and which are protected (`snapraid.ts`) */
  snapraid: { parity: string; data: { name: string; path: string }[]; appData: boolean; time: string; scrub: boolean; deleteLimit: number };
  /** Folders put on the dashboard from the file manager, absolute paths */
  folders: string[];
  /** Folders shared over the network (SMB) */
  shares: Share[];
  /** How the dashboard is arranged: groups, links, folders of tiles */
  dashboard: Layout;
  /** Colours and the background picture of the UI */
  appearance: Appearance;
  /** The walk through a new server is still ahead: set when the first administrator is created */
  welcome: boolean;
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
  /** Other ports of the app guarded the same way */
  extra?: { port: number; upstream: number }[];
}

export interface ImageSettings {
  /** Ask the registries once a day whether the apps' images have newer versions */
  check: boolean;
  /** Update the running apps that have newer images, once a day */
  auto: boolean;
  /** Local time of that update, HH:MM */
  time: string;
  /** Apps never updated by themselves */
  exclude: string[];
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
  /** App → its folders outside AppData that go into its snapshots too (media, documents); none by default */
  folders: Record<string, string[]>;
}

const DEFAULTS: Settings = {
  port: 0,
  dataRoot: "/DATA",
  puid: 1000,
  pgid: 1000,
  timezone: "",
  language: "en",
  stores: [{ id: "casaos", url: "https://github.com/IceWhaleTech/CasaOS-AppStore" }],
  backup: { enabled: false, time: "03:00", keep: 7, dir: "", beforeUpdate: true, exclude: [], folders: {} },
  access: {},
  images: { check: true, auto: false, time: "04:30", exclude: [] },
  https: { mode: "off", domain: "", email: "" },
  local: { enabled: true, name: "hata.local" },
  storage: { automount: false, ignored: [] },
  snapraid: { parity: "", data: [], appData: false, time: "05:00", scrub: true, deleteLimit: 50 },
  folders: [],
  shares: [],
  dashboard: cleanLayout(null),
  appearance: DEFAULT_APPEARANCE,
  welcome: false,
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
  images: { ...DEFAULTS.images, ...(isPlainObject(saved.images) ? saved.images : {}) },
  snapraid: { ...DEFAULTS.snapraid, ...(isPlainObject(saved.snapraid) ? saved.snapraid : {}) },
  access: isPlainObject(saved.access) ? (saved.access as Record<string, AppAccess>) : {},
  folders: Array.isArray(saved.folders) ? saved.folders.filter((path): path is string => typeof path === "string") : [],
  shares: cleanShares(saved.shares),
  dashboard: cleanLayout(saved.dashboard),
  appearance: cleanAppearance(saved.appearance),
  https: { ...DEFAULTS.https, ...(isPlainObject(saved.https) ? saved.https : {}) },
  local: { ...DEFAULTS.local, ...(isPlainObject(saved.local) ? saved.local : {}) },
  welcome: saved.welcome === true,
  storage: { automount: isPlainObject(saved.storage) && saved.storage.automount === true, ignored: isPlainObject(saved.storage) && Array.isArray(saved.storage.ignored) ? saved.storage.ignored.filter((id): id is string => typeof id === "string") : [] },
};
settings.local.name = localName(settings.local.name) ?? DEFAULTS.local.name;

/** Writes the settings after a change made in place (the access rules are edited that way) */
export function saveSettings(): void {
  writeJsonAtomic(SETTINGS_FILE, settings);
}

export function timezone(): string {
  return settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
      if (typeof b.time !== "string" || !TIME_RE.test(b.time)) return "settings.badTime";
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
    if ("folders" in b) {
      // per app: the folders given replace the ones it had, an empty list takes the app out
      if (!isPlainObject(b.folders)) return "settings.badBackup";
      const folders = { ...backup.folders };
      for (const [app, list] of Object.entries(b.folders)) {
        if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(app) || !Array.isArray(list) || list.some((p) => typeof p !== "string" || !/^\/[^\0]+$/.test(p) || p.split("/").includes(".."))) return "settings.badBackup";
        if (list.length) folders[app] = [...new Set(list as string[])];
        else delete folders[app];
      }
      backup.folders = folders;
    }
    next.backup = backup;
  }
  if ("images" in patch) {
    const i = patch.images;
    if (!isPlainObject(i)) return "settings.badImages";
    const images = { ...next.images };
    if ("check" in i) images.check = i.check === true;
    if ("auto" in i) images.auto = i.auto === true;
    if ("time" in i) {
      if (typeof i.time !== "string" || !TIME_RE.test(i.time)) return "settings.badTime";
      images.time = i.time;
    }
    if ("exclude" in i) {
      if (!Array.isArray(i.exclude) || i.exclude.some((n) => typeof n !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(n))) return "settings.badImages";
      images.exclude = [...new Set(i.exclude as string[])];
    }
    // nothing is updated on the word of a check that no longer runs
    if (!images.check) images.auto = false;
    next.images = images;
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
  if ("storage" in patch) {
    if (!isPlainObject(patch.storage)) return "settings.badStorage";
    next.storage = { ...next.storage, ...("automount" in patch.storage ? { automount: patch.storage.automount === true } : {}) };
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
  if ("welcome" in patch) next.welcome = patch.welcome === true;
  Object.assign(settings, next);
  writeJsonAtomic(SETTINGS_FILE, settings);
  return null;
}

export const DEFAULT_PORT = process.getuid?.() === 0 ? 80 : 8080;

/** Where the server listens: the environment wins over the settings, port 80 needs root */
export function listenAddress(): { port: number; hostname: string } {
  const port = Number(process.env.HATA_PORT ?? process.env.PORT ?? (settings.port || DEFAULT_PORT));
  return { port, hostname: process.env.HATA_HOST ?? anyAddress() };
}

let any: string | undefined;

/**
 * The address that means "every address of this machine": `::` where one socket takes IPv4 and IPv6
 * together (Docker publishes an app's port on both, so must whoever stands in front of it), otherwise
 * `0.0.0.0` — a kernel without IPv6, or one told to keep the two apart.
 */
export function anyAddress(): string {
  if (any === undefined) {
    try {
      any = existsSync("/proc/net/if_inet6") && readFileSync("/proc/sys/net/ipv6/bindv6only", "utf8").trim() === "0" ? "::" : "0.0.0.0";
    } catch {
      any = "0.0.0.0";
    }
  }
  return any;
}
