/**
 * Apps of a store in Hata's own format: a plain compose file, and `hata.yml` next to it with what the
 * compose file cannot say — texts in several languages, the icon, the web page, the settings asked
 * before installing (each one a variable of the app's `.env`) and the permissions explained.
 *
 * The compose file on disk stays as the store has it; Hata's view of it (`viewCompose`) is the file with
 * the `.env` filled in and an `x-casaos` block made from `hata.yml`, so the rest of Hata — the tile, the
 * gate, backups — reads it like any other app. Pure: no disk, no Docker.
 */
import { APP_NAME_RE, type Compose } from "./appform";

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** A text: plain English, or `{ en: …, uk: … }` */
export type Text = string | Record<string, string>;

export const SETTING_TYPES = ["text", "number", "port", "folder", "secret", "password", "choice", "switch", "url"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export interface Setting {
  name: string;
  type: SettingType;
  label: Text;
  hint?: Text;
  default?: string;
  required?: boolean;
  advanced?: boolean;
  options?: { value: string; label: Text }[];
  length?: number;
  /** A secret made of hexadecimal digits instead of letters and digits */
  chars?: "hex";
}

export interface HataMeta {
  title: Text;
  tagline: Text;
  description: Text;
  notes?: Text;
  /** The category's name in the store's languages */
  category: Text;
  developer: string;
  website: string;
  source: string;
  /** A data: URI */
  icon: string;
  /** Absolute addresses */
  screenshots: string[];
  web: { service: string; port: number; path: string; scheme: "http" | "https" } | null;
  settings: Setting[];
  permissions: Record<string, Text>;
  version: string;
  architectures: string[];
}

/** Variables Hata writes into the `.env` of such an app */
export const OWN_VARS = ["APP_DATA", "APP_URL", "APP_HOST", "PUID", "PGID", "TZ"] as const;

const VAR_RE = /^[A-Z][A-Z0-9_]*$/;
const FILE_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
/** Names in the app's folder that are Hata's own */
const RESERVED = new Set(["compose.yml", "hata.yml", ".env", "compose.override.yml", "compose.override.yaml", "docker-compose.override.yml"]);
const MAX_FILES = 256 * 1024;

/** The text in a language: that one, English, any */
export function textIn(value: unknown, lang: string): string {
  if (typeof value === "string") return value;
  if (!isObject(value)) return "";
  const l = lang.toLowerCase();
  const pick = (key: string) => (typeof value[key] === "string" ? value[key] : undefined);
  return pick(l) ?? pick(l.split("-")[0]!) ?? pick("en") ?? (Object.values(value).find((v) => typeof v === "string") as string | undefined) ?? "";
}

const cleanText = (v: unknown): Text | null => {
  if (typeof v === "string") return v;
  if (!isObject(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) if (/^[a-z]{2}(-[A-Z]{2})?$/.test(k) && typeof t === "string") out[k] = t;
  return Object.keys(out).length ? out : null;
};

function cleanSetting(v: unknown): Setting | null {
  if (!isObject(v) || typeof v.name !== "string" || !VAR_RE.test(v.name) || (OWN_VARS as readonly string[]).includes(v.name)) return null;
  if (!(SETTING_TYPES as readonly string[]).includes(v.type)) return null;
  const label = cleanText(v.label);
  if (!label) return null;
  const s: Setting = { name: v.name, type: v.type, label };
  const hint = cleanText(v.hint);
  if (hint) s.hint = hint;
  if (["string", "number", "boolean"].includes(typeof v.default)) s.default = String(v.default);
  if (v.required === true) s.required = true;
  if (v.advanced === true) s.advanced = true;
  if (s.type === "choice") {
    if (!Array.isArray(v.options)) return null;
    s.options = v.options.flatMap((o: unknown) => (isObject(o) && ["string", "number"].includes(typeof o.value) && cleanText(o.label) ? [{ value: String(o.value), label: cleanText(o.label)! }] : []));
    if (!s.options.length) return null;
  }
  if (s.type === "secret" && Number.isInteger(v.length) && v.length >= 12 && v.length <= 128) s.length = v.length;
  if (s.type === "secret" && v.chars === "hex") s.chars = "hex";
  return s;
}

export interface IndexApp {
  name: string;
  meta: HataMeta;
  /** The compose file as the store has it */
  compose: string;
  /** The app's other files, by their path in its folder */
  files: Record<string, string>;
}

/**
 * One app of a store's `index.json`, checked again here: the store's own checks are not ours. `base` is
 * the address screenshots are relative to. null — not an app Hata can offer.
 */
export function readIndexApp(entry: unknown, base: string, categories: Record<string, Text>): IndexApp | null {
  if (!isObject(entry) || typeof entry.id !== "string" || !APP_NAME_RE.test(entry.id) || typeof entry.compose !== "string") return null;
  const title = cleanText(entry.title);
  if (!title) return null;
  const https = (v: unknown) => (typeof v === "string" && /^https:\/\/\S+$/.test(v) ? v : "");
  let web: HataMeta["web"] = null;
  if (isObject(entry.web) && typeof entry.web.service === "string" && Number.isInteger(entry.web.port) && entry.web.port > 0 && entry.web.port < 65536) {
    const path = str(entry.web.path) || "/";
    web = { service: entry.web.service, port: entry.web.port, path: path.startsWith("/") ? path : "/" + path, scheme: entry.web.scheme === "https" ? "https" : "http" };
  }
  const files: Record<string, string> = {};
  let size = 0;
  for (const [name, text] of Object.entries(isObject(entry.files) ? entry.files : {})) {
    if (typeof text !== "string" || !FILE_RE.test(name) || name.split("/").some((p) => p === "." || p === "..") || RESERVED.has(name)) return null;
    size += text.length;
    files[name] = text;
  }
  if (size > MAX_FILES) return null;
  const permissions: Record<string, Text> = {};
  for (const [p, why] of Object.entries(isObject(entry.permissions) ? entry.permissions : {})) {
    const text = cleanText(why);
    if (text) permissions[p] = text;
  }
  const category = typeof entry.category === "string" ? entry.category : "";
  return {
    name: entry.id,
    compose: entry.compose,
    files,
    meta: {
      title,
      tagline: cleanText(entry.tagline) ?? "",
      description: cleanText(entry.description) ?? "",
      ...(cleanText(entry.notes) ? { notes: cleanText(entry.notes)! } : {}),
      category: categories[category] ?? category,
      developer: str(entry.developer),
      website: https(entry.website),
      source: https(entry.source),
      // only a picture: anything else would be a way to put markup on the page
      icon: typeof entry.icon === "string" && /^data:image\/(svg\+xml|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.icon) ? entry.icon : "",
      screenshots: (Array.isArray(entry.screenshots) ? entry.screenshots : []).filter((p: unknown) => typeof p === "string" && FILE_RE.test(p)).map((p: string) => base + p),
      web,
      settings: (Array.isArray(entry.settings) ? entry.settings : []).map(cleanSetting).filter((s): s is Setting => s !== null),
      permissions,
      version: str(entry.version),
      architectures: (Array.isArray(entry.architectures) ? entry.architectures : []).filter((a: unknown): a is string => typeof a === "string"),
    },
  };
}

// --- Variables ----------------------------------------------------------------------------------------

const USE_RE = /\$(?:\$|\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** A string with its variables filled as `docker compose` does it: `$$` is a dollar, an unknown one is "" */
export function fill(text: string, env: Record<string, string>): string {
  return text.replace(USE_RE, (all, braced?: string, op?: string, arg?: string, bare?: string) => {
    if (all === "$$") return "$";
    const set = env[(braced ?? bare)!];
    if (!op) return set ?? "";
    const present = op.startsWith(":") ? !!set : set !== undefined;
    if (op.endsWith("+")) return present ? arg! : "";
    return present ? set! : op.endsWith("-") ? arg! : "";
  });
}

/** A copy of a compose file with every value filled from the `.env` (keys stay as written) */
export function filled(compose: Compose, env: Record<string, string>): Compose {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.includes("$") ? fill(v, env) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(compose) as Compose;
}

/** The host port the app's web page is published at, in a filled compose file; 0 — it is not */
export function webPortOf(meta: HataMeta, compose: Compose): number {
  if (!meta.web) return 0;
  const service = isObject(compose.services) ? compose.services[meta.web.service] : undefined;
  if (!isObject(service)) return 0;
  if (service.network_mode === "host") return meta.web.port;
  for (const p of Array.isArray(service.ports) ? service.ports : []) {
    if (typeof p === "string" || typeof p === "number") {
      const m = /^(?:\[?[0-9a-f.:]+\]?:)?(\d+):(\d+)(?:\/tcp)?$/i.exec(String(p));
      if (m && Number(m[2]) === meta.web.port) return Number(m[1]);
    } else if (isObject(p) && Number(p.target) === meta.web.port && /^\d+$/.test(str(p.published)) && (p.protocol ?? "tcp") === "tcp") return Number(p.published);
  }
  return 0;
}

/** The `x-casaos` block the rest of Hata reads an app's tile from */
export function casaosOf(meta: HataMeta, compose: Compose): Compose {
  const port = webPortOf(meta, compose);
  const x: Compose = {
    title: meta.title,
    tagline: meta.tagline,
    description: meta.description,
    icon: meta.icon,
    category: meta.category,
    developer: meta.developer,
    screenshot_link: meta.screenshots,
    architectures: meta.architectures,
  };
  if (meta.notes) x.tips = { before_install: meta.notes };
  if (meta.website) x.website = meta.website;
  if (meta.web && port) {
    x.port_map = String(port);
    x.index = meta.web.path;
    x.scheme = meta.web.scheme;
    x.main = meta.web.service;
  }
  return x;
}

/**
 * Hata's view of such an app: the compose file filled from its `.env`, with the tile made from
 * `hata.yml`. What the person changed in the settings form lives in the file's own `x-casaos` and wins.
 */
export function viewCompose(compose: Compose, meta: HataMeta, env: Record<string, string>): Compose {
  const view = filled(compose, env);
  const own = isObject(compose["x-casaos"]) ? compose["x-casaos"] : {};
  view["x-casaos"] = { ...casaosOf(meta, view), ...own };
  return view;
}

/**
 * What the settings form changed of the tile, to be kept in the compose file: the keys that differ from
 * what `hata.yml` gives. `edited` is the `x-casaos` block after the form, `made` the one `casaosOf` gave.
 */
export function ownCasaos(edited: Compose, made: Compose): Compose | null {
  const out: Compose = {};
  for (const [key, value] of Object.entries(edited)) {
    if (JSON.stringify(value) === JSON.stringify(made[key])) continue;
    // a title typed in the form is kept as such, without the store's translations
    if (key === "title" && isObject(value) && typeof value.custom === "string") out.title = { custom: value.custom };
    else out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

// --- Settings -----------------------------------------------------------------------------------------

export interface FormSetting {
  name: string;
  type: SettingType;
  label: string;
  hint: string;
  /** What the field holds: the `.env`'s value, or the default; a secret or a password is never sent */
  value: string;
  /** A secret or a password that has a value already */
  set: boolean;
  required: boolean;
  advanced: boolean;
  options?: { value: string; label: string }[];
}

/** The settings of the app as the form shows them; `env` — the `.env` there is, or the defaults */
export function settingsForm(meta: HataMeta, env: Record<string, string>, lang: string): FormSetting[] {
  return meta.settings.map((s) => {
    const hidden = s.type === "secret" || s.type === "password";
    const value = env[s.name] ?? "";
    return {
      name: s.name,
      type: s.type,
      label: textIn(s.label, lang),
      hint: textIn(s.hint, lang),
      value: hidden ? "" : value,
      set: hidden && value !== "",
      required: s.required === true,
      advanced: s.advanced === true,
      ...(s.options ? { options: s.options.map((o) => ({ value: o.value, label: textIn(o.label, lang) })) } : {}),
    };
  });
}

/** The values a new install starts from: defaults with Hata's variables filled, secrets made */
export function startingEnv(meta: HataMeta, known: Record<string, string>, secret: (length: number, chars?: "hex") => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of meta.settings) {
    if (s.type === "secret") out[s.name] = secret(s.length ?? 32, s.chars);
    else if (s.default !== undefined) out[s.name] = fill(s.default, known);
  }
  return out;
}

const validPort = (v: string) => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535;

/**
 * The person's answers checked and turned into `.env` values. `current` — what the `.env` holds now (or
 * the starting values): a secret or a password left empty keeps it. Returns the values, or an error code
 * with the setting's name.
 */
export function answer(meta: HataMeta, input: unknown, current: Record<string, string>): { values: Record<string, string> } | { error: string; name: string } {
  const given = isObject(input) ? input : {};
  const values: Record<string, string> = {};
  for (const s of meta.settings) {
    const raw = given[s.name];
    let value = raw === undefined || raw === null ? (current[s.name] ?? "") : typeof raw === "boolean" ? String(raw) : str(raw).trim();
    const fail = (error: string) => ({ error, name: s.name });
    if ((s.type === "secret" || s.type === "password") && value === "") value = current[s.name] ?? "";
    if (/[\0\r\n']/.test(value)) return fail("form.badEnv");
    if (value === "") {
      if (s.required || s.type === "secret") return fail("form.required");
      values[s.name] = "";
      continue;
    }
    if (s.type === "port" && !validPort(value)) return fail("form.badPort");
    if (s.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return fail("form.badNumber");
    if (s.type === "folder" && (!value.startsWith("/") || value.split("/").includes(".."))) return fail("form.badPath");
    if (s.type === "url" && !/^https?:\/\/[^\s]+$/i.test(value)) return fail("form.badUrl");
    if (s.type === "switch" && value !== "true" && value !== "false") return fail("form.badEnv");
    if (s.type === "choice" && !s.options!.some((o) => o.value === value)) return fail("form.badEnv");
    values[s.name] = s.type === "folder" && value.length > 1 ? value.replace(/\/+$/, "") : value;
  }
  return { values };
}

/** A line of `.env`: quoted when compose would read the bare value otherwise */
export const envLine = (key: string, value: string): string => `${key}=${/^[A-Za-z0-9_./:@,+=-]*$/.test(value) ? value : `'${value}'`}`;

/** The ports the settings publish at, for the check that they are free: setting name → port */
export function settingPorts(meta: HataMeta, values: Record<string, string>): { name: string; port: number }[] {
  return meta.settings.filter((s) => s.type === "port" && validPort(values[s.name] ?? "")).map((s) => ({ name: s.name, port: Number(values[s.name]) }));
}

/** The folders the settings point at: made before the first start like the app's own */
export const settingFolders = (meta: HataMeta, values: Record<string, string>): string[] => meta.settings.filter((s) => s.type === "folder" && (values[s.name] ?? "").startsWith("/")).map((s) => values[s.name]!);
