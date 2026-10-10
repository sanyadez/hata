/**
 * The compose file of an app as data: reading the `x-casaos` metadata, building the settings form
 * (ports, folders, variables) and applying the user's answers back.
 *
 * Everything here is pure — no disk, no Docker — so it is covered by tests directly.
 */

// A compose file is free-form YAML: every access below checks what it actually got.
export type Compose = Record<string, any>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Compose project name rules — also what we allow as a directory name and in URLs */
export const APP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export class ComposeError extends Error {}

export function parseCompose(text: string): Compose {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(text);
  } catch (e) {
    throw new ComposeError(`Not valid YAML: ${e instanceof Error ? e.message : e}`);
  }
  if (!isObject(doc) || !isObject(doc.services) || Object.keys(doc.services).length === 0) {
    throw new ComposeError("A compose file needs a `services` section");
  }
  for (const [name, service] of Object.entries(doc.services)) {
    if (!isObject(service)) throw new ComposeError(`Service \`${name}\` is not a mapping`);
  }
  return doc;
}

export function dumpCompose(compose: Compose): string {
  // Bun leaves a space after the colon of a nested mapping; strings with real trailing spaces are quoted,
  // so trimming line ends cannot change a value
  return Bun.YAML.stringify(compose, null, 2).replace(/[ \t]+$/gm, "") + "\n";
}

/** Picks a translation out of an `{ en_US: … }` map: `custom`, the requested language, then English, then any */
export function localize(value: unknown, lang: string): string {
  if (typeof value === "string") return value;
  if (!isObject(value)) return "";
  // what the user typed over the store's words, the way CasaOS keeps it
  if (typeof value.custom === "string" && value.custom) return value.custom;
  const entries = Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string");
  const find = (prefix: string) => entries.find(([k]) => k.toLowerCase().startsWith(prefix))?.[1];
  return find(lang.toLowerCase() + "_") ?? find("en_us") ?? find("en_") ?? entries[0]?.[1] ?? "";
}

// --- Normalisation ----------------------------------------------------------------------------------

const SHORT_PORT_RE = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(?:(\d+):)?(\d+)(?:\/(tcp|udp))?$/;

function normalizePort(port: unknown): unknown {
  if (typeof port === "number") port = String(port);
  if (typeof port !== "string") return port;
  const m = SHORT_PORT_RE.exec(port);
  // ranges, variables and IPv6 addresses stay as written — they are not offered in the form
  if (!m) return port;
  const long: Record<string, unknown> = { target: Number(m[3]) };
  if (m[2]) long.published = m[2];
  long.protocol = m[4] ?? "tcp";
  if (m[1]) long.host_ip = m[1];
  return long;
}

function normalizeVolume(volume: unknown): unknown {
  if (typeof volume !== "string") return volume;
  const parts = volume.split(":");
  const [source, target, mode] = parts;
  // only absolute host paths become editable binds; named volumes and relative paths stay as written
  if (parts.length < 2 || parts.length > 3 || !source?.startsWith("/") || !target?.startsWith("/")) return volume;
  if (mode !== undefined && mode !== "ro" && mode !== "rw") return volume;
  const long: Record<string, unknown> = { type: "bind", source, target };
  if (mode === "ro") long.read_only = true;
  return long;
}

function normalizeEnvironment(env: unknown): unknown {
  if (!Array.isArray(env)) return env;
  const map: Record<string, unknown> = {};
  for (const item of env) {
    if (typeof item !== "string") continue;
    const eq = item.indexOf("=");
    if (eq < 0) map[item] = null;
    else map[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return map;
}

/** The directory store apps were written for; their binds are moved under the configured data root */
const CASAOS_ROOT = "/DATA";

function rebase(path: string, dataRoot: string): string {
  if (dataRoot === CASAOS_ROOT) return path;
  if (path === CASAOS_ROOT) return dataRoot;
  if (path.startsWith(CASAOS_ROOT + "/")) return (dataRoot === "/" ? "" : dataRoot) + path.slice(CASAOS_ROOT.length);
  return path;
}

/**
 * Rewrites ports, volumes and environment into the long compose syntax (in place), so that the form has
 * one shape to work with, and moves `/DATA/…` binds under `dataRoot`.
 *
 * With `appId`, the `$AppID` variable in bind sources is replaced by it: these are the folders shown in
 * the form and created before the first start, so they have to be real paths.
 */
export function normalize(compose: Compose, dataRoot: string, appId?: string): void {
  for (const service of Object.values(compose.services) as Compose[]) {
    if (Array.isArray(service.ports)) service.ports = service.ports.map(normalizePort);
    if (Array.isArray(service.volumes)) {
      service.volumes = service.volumes.map(normalizeVolume);
      for (const v of service.volumes) {
        if (!isObject(v) || v.type !== "bind" || typeof v.source !== "string") continue;
        v.source = rebase(v.source, dataRoot);
        if (appId) v.source = (v.source as string).replace(/\$\{AppID\}|\$AppID(?![A-Za-z0-9_])/g, appId);
      }
    }
    if (service.environment !== undefined) service.environment = normalizeEnvironment(service.environment);
  }
}

// --- Metadata ---------------------------------------------------------------------------------------

export interface AppMeta {
  title: string;
  tagline: string;
  description: string;
  icon: string;
  thumbnail: string;
  screenshots: string[];
  category: string;
  developer: string;
  author: string;
  architectures: string[];
  /** Published port of the app's web UI; "" — the app has no web UI */
  port: string;
  /** Path of the web UI, starts with `/` */
  index: string;
  scheme: string;
  /** Host of the web UI when it is not this machine */
  hostname: string;
  /** Text the store asks to show before installing (markdown) */
  tips: string;
  website: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const httpUrl = (v: unknown): string => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : "");

export function appMeta(compose: Compose, lang: string): AppMeta {
  const x: Compose = isObject(compose["x-casaos"]) ? compose["x-casaos"] : {};
  const index = str(x.index) || "/";
  return {
    title: localize(x.title, lang) || str(compose.name),
    tagline: localize(x.tagline, lang),
    description: localize(x.description, lang),
    icon: httpUrl(x.icon),
    thumbnail: httpUrl(x.thumbnail),
    screenshots: Array.isArray(x.screenshot_link) ? x.screenshot_link.map(httpUrl).filter(Boolean) : [],
    category: str(x.category),
    developer: str(x.developer),
    author: str(x.author),
    architectures: Array.isArray(x.architectures) ? x.architectures.map(str).filter(Boolean) : [],
    port: /^\d+$/.test(str(x.port_map)) ? str(x.port_map) : "",
    index: index.startsWith("/") ? index : "/" + index,
    scheme: str(x.scheme) === "https" ? "https" : "http",
    hostname: /^[a-z0-9.-]+$/i.test(str(x.hostname)) ? str(x.hostname) : "",
    tips: localize(isObject(x.tips) ? x.tips.before_install : undefined, lang),
    website: httpUrl(x.website),
  };
}

// --- Form -------------------------------------------------------------------------------------------

export interface FormPort {
  service: string;
  target: string;
  protocol: string;
  published: string;
  description: string;
}

export interface FormVolume {
  service: string;
  target: string;
  source: string;
  description: string;
}

export interface FormEnv {
  service: string;
  name: string;
  value: string;
  description: string;
}

export interface AppForm {
  ports: FormPort[];
  volumes: FormVolume[];
  envs: FormEnv[];
}

/** Description of a port/volume/variable from the service's own `x-casaos` block */
function describe(service: Compose, kind: "ports" | "volumes" | "envs", container: string, lang: string): string {
  const list = isObject(service["x-casaos"]) ? service["x-casaos"][kind] : undefined;
  if (!Array.isArray(list)) return "";
  const hit = list.find((item) => isObject(item) && str(item.container) === container);
  return hit ? localize((hit as Compose).description, lang) : "";
}

/** A value that is exactly one of the variables Hata provides in the app's `.env` */
const SYSTEM_VARIABLE_RE = /^\$\{?(PUID|PGID|TZ|AppID)\}?$/;

const isFormPort = (p: unknown): p is Compose => isObject(p) && /^\d+$/.test(str(p.target));
const isFormVolume = (v: unknown): v is Compose => isObject(v) && v.type === "bind" && typeof v.source === "string" && typeof v.target === "string";

/** The settings form of a normalised compose file */
export function buildForm(compose: Compose, lang: string): AppForm {
  const form: AppForm = { ports: [], volumes: [], envs: [] };
  for (const [name, service] of Object.entries(compose.services) as [string, Compose][]) {
    for (const p of Array.isArray(service.ports) ? service.ports : []) {
      if (!isFormPort(p)) continue;
      const target = str(p.target);
      form.ports.push({ service: name, target, protocol: str(p.protocol) || "tcp", published: str(p.published), description: describe(service, "ports", target, lang) });
    }
    for (const v of Array.isArray(service.volumes) ? service.volumes : []) {
      if (!isFormVolume(v)) continue;
      form.volumes.push({ service: name, target: v.target, source: v.source, description: describe(service, "volumes", v.target, lang) });
    }
    if (isObject(service.environment)) {
      for (const [key, value] of Object.entries(service.environment)) {
        // set for all apps at once in the settings, not per app
        if (typeof value === "string" && SYSTEM_VARIABLE_RE.test(value)) continue;
        form.envs.push({ service: name, name: key, value: value == null ? "" : String(value), description: describe(service, "envs", key, lang) });
      }
    }
  }
  return form;
}

const validPort = (v: string): boolean => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535;
const validHostPath = (v: string): boolean => v.startsWith("/") && !v.includes("\0") && !v.split("/").includes("..");

/**
 * Applies the user's answers to a normalised compose file (in place). Only entries that already exist
 * can be changed — the form cannot add ports, binds or variables. Returns an error code or null.
 */
export function applyForm(compose: Compose, input: unknown): string | null {
  if (!isObject(input)) return "form.invalid";
  const list = (key: string): Compose[] => (Array.isArray(input[key]) ? (input[key] as unknown[]).filter(isObject) : []);
  const service = (name: unknown): Compose | undefined => (typeof name === "string" && Object.hasOwn(compose.services, name) ? compose.services[name] : undefined);

  const x: Compose | undefined = isObject(compose["x-casaos"]) ? compose["x-casaos"] : undefined;
  const webPort = x ? str(x.port_map) : "";

  for (const item of list("ports")) {
    const ports = service(item.service)?.ports;
    const port = (Array.isArray(ports) ? ports : []).find(
      (p) => isFormPort(p) && str(p.target) === str(item.target) && (str(p.protocol) || "tcp") === (str(item.protocol) || "tcp"),
    ) as Compose | undefined;
    if (!port) return "form.unknownPort";
    const published = str(item.published).trim();
    if (published === "") {
      delete port.published;
      continue;
    }
    if (!validPort(published)) return "form.badPort";
    // the tile of the app opens `port_map`: keep it pointing at the same port after a change
    if (x && webPort && str(port.published) === webPort && (str(port.protocol) || "tcp") === "tcp") x.port_map = published;
    port.published = published;
  }

  for (const item of list("volumes")) {
    const volumes = service(item.service)?.volumes;
    const volume = (Array.isArray(volumes) ? volumes : []).find((v) => isFormVolume(v) && v.target === item.target) as Compose | undefined;
    if (!volume) return "form.unknownVolume";
    const source = str(item.source).trim();
    if (!validHostPath(source)) return "form.badPath";
    volume.source = source.length > 1 ? source.replace(/\/+$/, "") : source;
  }

  for (const item of list("envs")) {
    const env = service(item.service)?.environment;
    if (!isObject(env) || typeof item.name !== "string" || !Object.hasOwn(env, item.name)) return "form.unknownEnv";
    if (typeof item.value !== "string" || item.value.includes("\0")) return "form.badEnv";
    const current = env[item.name] == null ? "" : String(env[item.name]);
    // a value typed by the user is literal: `$` must not start a compose variable
    if (item.value !== current) env[item.name] = item.value.replace(/\$/g, "$$$$");
  }
  return null;
}

/** Host directories the app binds — to create them before the first start */
export function bindSources(compose: Compose): string[] {
  const out = new Set<string>();
  for (const service of Object.values(compose.services) as Compose[]) {
    for (const v of Array.isArray(service.volumes) ? service.volumes : []) {
      // a path that still holds a variable is not a path yet
      if (isFormVolume(v) && !v.source.includes("$")) out.add(v.source);
    }
  }
  return [...out];
}

/** Published TCP/UDP ports of the app, as numbers */
export function publishedPorts(compose: Compose): { port: number; protocol: string }[] {
  const out: { port: number; protocol: string }[] = [];
  for (const service of Object.values(compose.services) as Compose[]) {
    for (const p of Array.isArray(service.ports) ? service.ports : []) {
      if (isFormPort(p) && validPort(str(p.published))) out.push({ port: Number(p.published), protocol: str(p.protocol) || "tcp" });
    }
  }
  return out;
}
