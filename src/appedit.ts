/**
 * The compose file of an app as the form people know from CasaOS: image, title and icon, the web UI's
 * address, network, ports, volumes, variables, devices, command, privileges, limits, restart policy,
 * capabilities, host name — per service; services are added and taken out.
 *
 * `readEdit` shows a compose file that way and `applyEdit` puts the answers back (in place). The file is
 * richer than the form, so the rule is: what the user did not change stays exactly as written. A list
 * row remembers which entry it came from (`from`); an entry the form cannot show (a port range, a
 * `tmpfs` mount) travels as `raw` text and can only be kept or taken out. Pure and tested.
 */
import { localize, type Compose } from "./appform";

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface Row {
  /** Index of the entry of the file this row shows; absent — a row added in the form */
  from?: number;
  /** An entry the form has no fields for, as text */
  raw?: string;
}
export interface PortRow extends Row {
  host: string;
  container: string;
  /** "both" exists only on the way in: it becomes a TCP and a UDP entry */
  protocol: "tcp" | "udp" | "both";
}
export interface PairRow extends Row {
  host: string;
  container: string;
}
export interface EnvRow extends Row {
  name: string;
  value: string;
}

export interface ServiceEdit {
  name: string;
  image: string;
  /** `network_mode`; "" — the app's own network */
  network: string;
  ports: PortRow[];
  volumes: PairRow[];
  envs: EnvRow[];
  devices: PairRow[];
  command: string[];
  privileged: boolean;
  /** Megabytes; 0 — no limit */
  memory: number;
  /** `cpu_shares`; 0 — not set */
  cpuShares: number;
  restart: string;
  capAdd: string[];
  hostname: string;
}

export interface AppEdit {
  title: string;
  icon: string;
  /** Where the tile of the app leads; `port` "" — the app has no page */
  web: { scheme: string; host: string; port: string; path: string };
  services: ServiceEdit[];
}

// --- Reading ------------------------------------------------------------------------------------

const SHORT_PORT_RE = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(?:(\d+):)?(\d+)(?:\/(tcp|udp))?$/;

/** A port entry as a long-syntax object, or null when it is not a single published port */
function longPort(entry: unknown): Record<string, any> | null {
  if (isObject(entry)) return /^\d+$/.test(str(entry.target)) && /^\d*$/.test(str(entry.published)) && ["", "tcp", "udp"].includes(str(entry.protocol)) ? entry : null;
  const m = SHORT_PORT_RE.exec(str(entry));
  if (!m) return null;
  return { target: Number(m[3]), ...(m[2] ? { published: m[2] } : {}), protocol: m[4] ?? "tcp", ...(m[1] ? { host_ip: m[1] } : {}) };
}

const rawText = (entry: unknown): string => (typeof entry === "string" ? entry : JSON.stringify(entry));

function portRow(entry: unknown, from: number): PortRow {
  const long = longPort(entry);
  if (!long) return { from, raw: rawText(entry), host: "", container: "", protocol: "tcp" };
  return { from, host: str(long.published), container: str(long.target), protocol: str(long.protocol) === "udp" ? "udp" : "tcp" };
}

/** `source:target[:mode]`; a Windows path or anything stranger is left to the text editor */
function splitPair(entry: string): { host: string; container: string; rest: string } | null {
  const parts = entry.split(":");
  if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) return null;
  return { host: parts[0], container: parts[1], rest: parts[2] ?? "" };
}

function volumeRow(entry: unknown, from: number): PairRow {
  if (isObject(entry) && (entry.type === "bind" || entry.type === "volume") && typeof entry.source === "string" && entry.source && typeof entry.target === "string") {
    return { from, host: entry.source, container: entry.target };
  }
  const pair = typeof entry === "string" ? splitPair(entry) : null;
  return pair ? { from, host: pair.host, container: pair.container } : { from, raw: rawText(entry), host: "", container: "" };
}

function deviceRow(entry: unknown, from: number): PairRow {
  const pair = typeof entry === "string" ? splitPair(entry) : null;
  return pair ? { from, host: pair.host, container: pair.container } : { from, raw: rawText(entry), host: "", container: "" };
}

/** The variables of a service in the order of the file, whichever of the two forms it uses */
function envEntries(environment: unknown): [string, unknown][] {
  if (isObject(environment)) return Object.entries(environment);
  return list(environment).map((item): [string, unknown] => {
    const text = str(item);
    const eq = text.indexOf("=");
    return eq < 0 ? [text, null] : [text.slice(0, eq), text.slice(eq + 1)];
  });
}

/** A value with no reference to a variable is shown as what the container gets: `$$` is one dollar */
const refers = (value: string): boolean => /\$(?!\$)/.test(value.replace(/\$\$/g, ""));
const shown = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return refers(text) ? text : text.replace(/\$\$/g, "$");
};

const UNITS: Record<string, number> = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

/** A compose byte value (`512m`, `1gb`, a number of bytes) in megabytes */
export function megabytes(value: unknown): number {
  if (typeof value === "number") return Math.round(value / UNITS.m!);
  const m = /^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i.exec(str(value).trim());
  return m ? Math.round((Number(m[1]) * UNITS[(m[2] ?? "b").toLowerCase()]!) / UNITS.m!) : 0;
}

export function readService(name: string, service: Compose): ServiceEdit {
  const command = service.command;
  return {
    name,
    image: str(service.image),
    network: str(service.network_mode),
    ports: list(service.ports).map(portRow),
    volumes: list(service.volumes).map(volumeRow),
    envs: envEntries(service.environment).map(([key, value], from) => ({ from, name: key, value: shown(value) })),
    devices: list(service.devices).map(deviceRow),
    command: Array.isArray(command) ? command.map(str) : str(command) ? [str(command)] : [],
    privileged: service.privileged === true,
    memory: megabytes(service.deploy?.resources?.limits?.memory ?? service.mem_limit),
    cpuShares: Number(service.cpu_shares) > 0 ? Number(service.cpu_shares) : 0,
    restart: str(service.restart),
    capAdd: list(service.cap_add).map(str).filter(Boolean),
    hostname: str(service.hostname),
  };
}

function readWeb(x: Compose): AppEdit["web"] {
  const path = str(x.index) || "/";
  return { scheme: str(x.scheme) === "https" ? "https" : "http", host: str(x.hostname), port: str(x.port_map), path: path.startsWith("/") ? path : "/" + path };
}

export function readEdit(compose: Compose, lang: string): AppEdit {
  const x: Compose = isObject(compose["x-casaos"]) ? compose["x-casaos"] : {};
  return {
    title: localize(x.title, lang),
    icon: str(x.icon),
    web: readWeb(x),
    services: Object.entries(compose.services as Record<string, Compose>).map(([name, service]) => readService(name, service)),
  };
}

// --- Applying -----------------------------------------------------------------------------------

const validPort = (v: string): boolean => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535;
const cleanText = (v: unknown): string | null => (typeof v === "string" && !/[\0\r\n]/.test(v) ? v.trim() : null);
const SERVICE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;
const VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const hostPath = (v: string): boolean => v.startsWith("/") && !v.split("/").includes("..");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Rebuilds a list of the file from the rows of the form: a row equal to what its entry reads as keeps
 * the entry untouched, a changed one is written by `write` (which gets the old entry, when there is one).
 * Returns the new list, or an error code.
 */
function rebuild<R extends Row>(entries: unknown[], rows: unknown, read: (entry: unknown, from: number) => R, write: (row: Record<string, any>, old: unknown) => unknown[] | string): unknown[] | string {
  if (!Array.isArray(rows)) return "edit.invalid";
  const out: unknown[] = [];
  for (const row of rows) {
    if (!isObject(row)) return "edit.invalid";
    const from = Number.isInteger(row.from) && row.from >= 0 && row.from < entries.length ? (row.from as number) : undefined;
    const old = from === undefined ? undefined : entries[from];
    if (from !== undefined) {
      const { from: _, ...before } = read(old, from);
      const { from: __, ...now } = row;
      // `raw` rows cannot be edited: they are either still here or not
      if (before.raw !== undefined || same(before, { ...before, ...now })) {
        out.push(old);
        continue;
      }
    } else if (row.raw !== undefined) return "edit.invalid";
    const written = write(row, old);
    if (typeof written === "string") return written;
    out.push(...written);
  }
  return out;
}

function writePort(row: Record<string, any>, old: unknown): unknown[] | string {
  const host = cleanText(row.host);
  const container = cleanText(row.container);
  if (host === null || container === null || !validPort(container) || (host !== "" && !validPort(host))) return "edit.badPort";
  const protocols = row.protocol === "both" ? ["tcp", "udp"] : [row.protocol === "udp" ? "udp" : "tcp"];
  const long = longPort(old);
  return protocols.map((protocol) => {
    // an entry that carried more than the form shows (an address to listen on) keeps it
    if (long && (isObject(old) || long.host_ip)) {
      const { published: _, ...rest } = long;
      return { ...rest, target: Number(container), ...(host ? { published: host } : {}), protocol };
    }
    return (host ? host + ":" : "") + container + (protocol === "udp" ? "/udp" : "");
  });
}

function writeVolume(row: Record<string, any>, old: unknown): unknown[] | string {
  const host = cleanText(row.host);
  const container = cleanText(row.container);
  if (!host || !container || !container.startsWith("/") || container.includes(":")) return "edit.badVolume";
  if (!(hostPath(host) || VOLUME_NAME_RE.test(host))) return "edit.badVolume";
  if (isObject(old)) return [{ ...old, type: host.startsWith("/") ? "bind" : "volume", source: host, target: container }];
  const mode = typeof old === "string" ? (splitPair(old)?.rest ?? "") : "";
  return [`${host}:${container}${mode ? ":" + mode : ""}`];
}

function writeDevice(row: Record<string, any>, old: unknown): unknown[] | string {
  const host = cleanText(row.host);
  const container = cleanText(row.container);
  if (!host || !host.startsWith("/") || host.includes(":") || (container !== "" && (!container?.startsWith("/") || container.includes(":")))) return "edit.badDevice";
  const mode = typeof old === "string" ? (splitPair(old)?.rest ?? "") : "";
  return [`${host}:${container || host}${mode ? ":" + mode : ""}`];
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** The variables keep the form they have in the file — a mapping or a list of `NAME=value` */
function applyEnvs(service: Compose, rows: unknown): string | null {
  const entries = envEntries(service.environment);
  const asList = Array.isArray(service.environment);
  const seen = new Set<string>();
  const out: [string, unknown][] = [];
  const result = rebuild<EnvRow>(
    entries,
    rows,
    ([key, value]: any, from) => ({ from, name: key, value: shown(value) }),
    (row, old) => {
      const name = cleanText(row.name);
      if (!name || !ENV_NAME_RE.test(name) || typeof row.value !== "string" || row.value.includes("\0")) return "edit.badEnv";
      const before = isObject(old) || Array.isArray(old) ? (old as [string, unknown])[1] : undefined;
      // only the name changed: the value stays as written, references and all
      if (before !== undefined && shown(before) === row.value) return [[name, before]];
      // what is typed is literal, unless the value it replaces was a reference to a variable
      const literal = !(typeof before === "string" && refers(before));
      return [[name, literal ? row.value.replace(/\$/g, "$$$$") : row.value]];
    },
  );
  if (typeof result === "string") return result;
  for (const [key, value] of result as [string, unknown][]) {
    if (seen.has(key)) return "edit.sameEnv";
    seen.add(key);
    out.push([key, value]);
  }
  if (out.length === 0) delete service.environment;
  else service.environment = asList ? out.map(([key, value]) => (value === null ? key : `${key}=${value}`)) : Object.fromEntries(out);
  return null;
}

function setOrDelete(target: Compose, key: string, value: unknown): void {
  if (value === "" || value === false || value === 0 || (Array.isArray(value) && value.length === 0)) delete target[key];
  else target[key] = value;
}

function setMemory(service: Compose, megabytes: number): void {
  const limits = service.deploy?.resources?.limits;
  if (megabytes > 0) {
    if (service.mem_limit !== undefined && !isObject(limits)) service.mem_limit = megabytes + "M";
    else {
      service.deploy = isObject(service.deploy) ? service.deploy : {};
      service.deploy.resources = isObject(service.deploy.resources) ? service.deploy.resources : {};
      service.deploy.resources.limits = { ...(isObject(limits) ? limits : {}), memory: megabytes + "M" };
    }
    return;
  }
  delete service.mem_limit;
  if (!isObject(limits)) return;
  delete limits.memory;
  // what was only there to hold the limit goes with it
  if (Object.keys(limits).length === 0) delete service.deploy.resources.limits;
  if (Object.keys(service.deploy.resources).length === 0) delete service.deploy.resources;
  if (Object.keys(service.deploy).length === 0) delete service.deploy;
}

function applyService(compose: Compose, service: Compose, input: Record<string, any>, before: ServiceEdit): string | null {
  const image = cleanText(input.image);
  if (!image || /\s/.test(image)) return "edit.badImage";
  if (image !== before.image) service.image = image;

  for (const [field, key] of [["network", "network_mode"], ["restart", "restart"], ["hostname", "hostname"]] as const) {
    const value = cleanText(input[field]);
    if (value === null || /\s/.test(value)) return "edit.invalid";
    if (value !== before[field]) setOrDelete(service, key, value);
  }

  const ports = rebuild(list(service.ports), input.ports, portRow, writePort);
  if (typeof ports === "string") return ports;
  const volumes = rebuild(list(service.volumes), input.volumes, volumeRow, writeVolume);
  if (typeof volumes === "string") return volumes;
  const devices = rebuild(list(service.devices), input.devices, deviceRow, writeDevice);
  if (typeof devices === "string") return devices;
  setOrDelete(service, "ports", ports);
  setOrDelete(service, "volumes", volumes);
  setOrDelete(service, "devices", devices);
  // a volume used by name has to be declared at the top of the file
  for (const entry of volumes) {
    const row = volumeRow(entry, 0);
    if (row.raw !== undefined || !VOLUME_NAME_RE.test(row.host)) continue;
    compose.volumes = isObject(compose.volumes) ? compose.volumes : {};
    if (!Object.hasOwn(compose.volumes, row.host)) compose.volumes[row.host] = {};
  }

  const envError = applyEnvs(service, input.envs);
  if (envError) return envError;

  if (!Array.isArray(input.command) || input.command.some((part) => typeof part !== "string" || part.includes("\0"))) return "edit.invalid";
  const command = (input.command as string[]).filter((part) => part !== "");
  if (!same(command, before.command)) setOrDelete(service, "command", typeof service.command === "string" && command.length === 1 ? command[0] : command);

  if (!Array.isArray(input.capAdd) || input.capAdd.some((cap) => typeof cap !== "string" || !/^[A-Za-z_]+$/.test(cap))) return "edit.badCapability";
  const caps = [...new Set((input.capAdd as string[]).map((cap) => cap.toUpperCase().replace(/^CAP_/, "")))];
  if (!same(caps, before.capAdd)) setOrDelete(service, "cap_add", caps);

  if ((input.privileged === true) !== before.privileged) setOrDelete(service, "privileged", input.privileged === true);
  for (const field of ["memory", "cpuShares"] as const) {
    if (typeof input[field] !== "number" || !Number.isInteger(input[field]) || input[field] < 0 || input[field] > 1024 ** 3) return "edit.invalid";
  }
  if (input.memory !== before.memory) setMemory(service, input.memory);
  if (input.cpuShares !== before.cpuShares) setOrDelete(service, "cpu_shares", input.cpuShares);
  return null;
}

/**
 * Applies the form to the compose file (in place — on an error the file is left half changed, so give
 * it a copy). Returns an error code or null.
 */
export function applyEdit(compose: Compose, input: unknown, lang: string): string | null {
  if (!isObject(input) || !Array.isArray(input.services) || !isObject(input.web)) return "edit.invalid";
  const before = readEdit(compose, lang);

  const title = cleanText(input.title);
  const icon = cleanText(input.icon);
  if (title === null || icon === null || (icon !== "" && !/^https?:\/\/\S+$/i.test(icon))) return "edit.badIcon";
  const web = { scheme: input.web.scheme === "https" ? "https" : "http", host: cleanText(input.web.host), port: cleanText(input.web.port), path: cleanText(input.web.path) };
  if (web.host === null || web.port === null || web.path === null || !/^[a-z0-9.-]*$/i.test(web.host) || (web.port !== "" && !validPort(web.port)) || /\s/.test(web.path)) return "edit.badWeb";
  web.path = web.path.startsWith("/") ? web.path : "/" + web.path;

  const changed = title !== before.title || icon !== before.icon || !same(web, before.web);
  if (changed) {
    const x: Compose = isObject(compose["x-casaos"]) ? compose["x-casaos"] : (compose["x-casaos"] = {});
    // a title typed here is the title in every language, the way CasaOS keeps it
    if (title !== before.title) x.title = { ...(isObject(x.title) ? x.title : {}), custom: title };
    if (icon !== before.icon) setOrDelete(x, "icon", icon);
    if (web.scheme !== before.web.scheme) x.scheme = web.scheme;
    if (web.host !== before.web.host) setOrDelete(x, "hostname", web.host);
    if (web.port !== before.web.port) setOrDelete(x, "port_map", web.port);
    if (web.path !== before.web.path) x.index = web.path;
  }

  // the services of the form are the services of the app: one that is not listed is taken out, a new one is made
  const names: string[] = [];
  for (const item of input.services) {
    if (!isObject(item) || typeof item.name !== "string" || !SERVICE_NAME_RE.test(item.name) || names.includes(item.name)) return "edit.badService";
    names.push(item.name);
  }
  if (names.length === 0) return "edit.badService";
  for (const name of Object.keys(compose.services)) {
    if (names.includes(name)) continue;
    delete compose.services[name];
    for (const other of Object.values(compose.services) as Compose[]) {
      // nothing can wait for a service that is no more
      if (Array.isArray(other.depends_on)) setOrDelete(other, "depends_on", other.depends_on.filter((d: unknown) => d !== name));
      else if (isObject(other.depends_on)) {
        delete other.depends_on[name];
        if (Object.keys(other.depends_on).length === 0) delete other.depends_on;
      }
    }
    const x = compose["x-casaos"];
    if (isObject(x) && x.main === name) x.main = names[0];
  }
  for (const item of input.services) {
    const service: Compose = Object.hasOwn(compose.services, item.name) ? compose.services[item.name] : (compose.services[item.name] = {});
    const error = applyService(compose, service, item, before.services.find((s) => s.name === item.name) ?? readService(item.name, {}));
    if (error) return error;
  }
  return null;
}

/** A compose file to start the form from when there is none yet: one service named after the app */
export const blankCompose = (name: string): Compose => ({ name, services: { [name]: { image: "", restart: "unless-stopped" } } });
