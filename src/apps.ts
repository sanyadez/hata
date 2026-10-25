/**
 * Installed apps. An app is a directory `data/apps/<name>/` with a plain `compose.yml` and a `.env`
 * next to it — `docker compose up -d` in that directory works by hand, with or without Hata running.
 * The compose file is the user's: its tile data is the `x-casaos` block, its state is whatever Docker
 * reports for the compose project of the same name. What Hata itself knows about a store app — which
 * store, and the store's file it was installed from — lies next to it in `hata.yml`, which compose never
 * reads; a newer store version is merged into the app from there (`merge.ts`).
 *
 * An app of a store in Hata's own format (`hataapp.ts`) keeps its compose file exactly as the store has
 * it: the answers of its settings go into `.env`, and its tile comes from the `meta` its `hata.yml`
 * holds. `viewOf` is the file the way the rest of Hata reads such an app.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { APP_NAME_RE, appMeta, applyForm, appStatus, stepDone, localize, bindSources, buildForm, dumpCompose, normalize, parseCompose, parseEnv, publishedPorts, resolvePorts, type AppForm, type AppMeta, type Compose } from "./appform";
import { applyEdit, blankCompose, readEdit, type AppEdit } from "./appedit";
import { bus } from "./bus";
import { IMAGE_MIME, imageType } from "./wallpapers";
import { DATA_DIR, settings, timezone } from "./config";
import { record } from "./activity";
import { compose as runCompose, composeCmd, containerStats, imageUser, inspectContainer, listContainers, PROJECT_LABEL, SERVICE_LABEL, type ContainerInspect, type ContainerStats, type ContainerSummary } from "./docker";
import { writeTextAtomic } from "./fsutil";
import { newerImages } from "./images";
import { guessBase, merge3, same, type MergeChange } from "./merge";
import { answer, casaosOf, envLine, filled, ownCasaos, settingFolders, settingPorts, settingsForm, startingEnv, viewCompose, webPortOf, type FormSetting, type HataMeta, type IndexApp } from "./hataapp";
import { labelOf, siteDomain } from "./site";
import { findStoreApp, storeApp, type StoreApp } from "./store";

export const APPS_DIR = join(DATA_DIR, "apps");
mkdirSync(APPS_DIR, { recursive: true });

/** An error whose `code` the UI translates; `detail` fills the placeholders of the message */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export const appDir = (name: string) => join(APPS_DIR, name);
export const composeFile = (name: string) => join(appDir(name), "compose.yml");

export function assertName(name: string): void {
  if (!APP_NAME_RE.test(name)) throw new AppError("app.badName");
}

function assertInstalled(name: string): void {
  assertName(name);
  if (!existsSync(composeFile(name))) throw new AppError("app.notFound", 404);
}

// --- Jobs -------------------------------------------------------------------------------------------

export type JobKind = "install" | "update" | "start" | "stop" | "restart" | "remove" | "apply" | "backup" | "restore" | "import" | "move" | "docker" | "tailscale" | "copyin" | "transfer" | "moveapp" | "extract" | "format" | "fsck" | "wipe" | "pool" | "sysupdate" | "guest" | "client" | "template" | "clone" | "resize";

export interface Job {
  id: string;
  app: string;
  kind: JobKind;
  status: "running" | "done" | "failed";
  /** The last MAX_LOG_LINES lines of output */
  log: string[];
  /** How many lines were logged in total — the number of the next line */
  lineCount: number;
  error?: string;
  /** What the operation found, for the page that started it */
  result?: unknown;
  /** What the operation works on when that is not an app: a disk, a file system */
  target?: string;
  /** The operation can be ended before its time (`stopJob`) */
  stoppable?: boolean;
  /** It was ended so */
  stopped?: boolean;
  startedAt: number;
  finishedAt?: number;
}

const MAX_LOG_LINES = 500;
const KEEP_FINISHED_JOBS = 20;
const jobs = new Map<string, Job>();
/** app name → id of the job that currently owns it */
const busy = new Map<string, string>();

export const getJob = (id: string): Job | null => jobs.get(id) ?? null;
export const listJobs = (): Job[] => [...jobs.values()];

export type Log = (line: string) => void;

/** Resolves when the job has finished, whatever the outcome */
const finished = new WeakMap<Job, Promise<void>>();
export const jobFinished = (job: Job): Promise<void> => finished.get(job) ?? Promise.resolve();

/**
 * Starts a long operation on an app; one app runs one operation at a time. `quiet` — the operation
 * writes its own line to the activity log when it works, so only a failure is recorded here.
 */
/**
 * `label` — for an app of another machine: `app` is then only the key that keeps one operation at a
 * time, the activity log gets the app's own name and the machine's.
 */
export function startJob(app: string, kind: JobKind, user: string, work: (log: Log) => Promise<void>, quiet = false, label?: { app: string; machine: string }): Job {
  if (busy.has(app)) throw new AppError("app.busy", 409);
  const job: Job = { id: crypto.randomUUID(), app, kind, status: "running", log: [], lineCount: 0, startedAt: Date.now() };
  jobs.set(job.id, job);
  busy.set(app, job.id);
  const summary = () => ({ id: job.id, app, kind, status: job.status, error: job.error, stoppable: job.stoppable, stopped: job.stopped });
  const log: Log = (line) => {
    job.log.push(line);
    if (job.log.length > MAX_LOG_LINES) job.log.shift();
    bus.publish("job", { job: summary(), line, n: job.lineCount++ });
  };
  bus.publish("job", { job: summary() });
  const run = work(log)
    .then(() => {
      job.status = "done";
    })
    .catch((e) => {
      job.status = "failed";
      job.error = e instanceof AppError ? e.code : e instanceof Error ? e.message : String(e);
      log(job.error);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      if (!quiet || job.status === "failed") record(`app.${kind}.${job.stopped ? "stopped" : job.status}`, { app: label?.app ?? app, machine: label?.machine, user, detail: job.status === "failed" ? job.error?.trim().split("\n")[0]?.trim().slice(0, 300) : undefined });
      busy.delete(app);
      const over = [...jobs.values()].filter((j) => j.status !== "running");
      for (const old of over.slice(0, Math.max(0, over.length - KEEP_FINISHED_JOBS))) jobs.delete(old.id);
      bus.publish("job", { job: summary() });
      bus.publish("apps");
    });
  finished.set(job, run);
  return job;
}

const stoppers = new Map<string, AbortController>();

/**
 * Makes a running job one that can be stopped by `stopper` — made before the job started, since its
 * work begins at once and has to hold the signal from the first program it runs.
 */
export function stoppable(job: Job, stopper: AbortController): void {
  stoppers.set(job.id, stopper);
  job.stoppable = true;
  void jobFinished(job).then(() => stoppers.delete(job.id));
  bus.publish("job", { job: { id: job.id, app: job.app, kind: job.kind, status: job.status, stoppable: true } });
}

/** Asks a running job to stop; false when it cannot be */
export function stopJob(id: string, user: string): boolean {
  const job = jobs.get(id);
  const stopper = stoppers.get(id);
  if (!job || !stopper || job.status !== "running") return false;
  job.stopped = true;
  job.log.push(`Stopped by ${user}`);
  if (job.log.length > MAX_LOG_LINES) job.log.shift();
  bus.publish("job", { job: { id: job.id, app: job.app, kind: job.kind, status: job.status, stoppable: true, stopped: true }, line: `Stopped by ${user}`, n: job.lineCount++ });
  stopper.abort();
  return true;
}

/** Runs `docker compose …` for an app, failing the job on a non-zero exit */
type ComposeHook = (name: string) => void;
const composeHooks: { before: ComposeHook; after: ComposeHook }[] = [];

/**
 * Registers what must happen around `docker compose` reading an app's files: `before` any command (files
 * of Hata's next to the compose file are brought up to date), `after` an `up`, whether it worked or not.
 */
export function onCompose(before: ComposeHook, after: ComposeHook): void {
  composeHooks.push({ before, after });
}

export async function dc(name: string, args: string[], log: Log): Promise<void> {
  for (const hook of composeHooks) hook.before(name);
  log(`$ docker compose ${args.join(" ")}`);
  try {
    const { code, output } = await runCompose(name, appDir(name), args, log);
    if (code !== 0) throw new Error(output.split("\n").slice(-3).join("\n") || `docker compose exited with ${code}`);
  } finally {
    if (args[0] === "up") for (const hook of composeHooks) hook.after(name);
  }
}

// --- The app's own icon ---------------------------------------------------------------------------
// A picture uploaded for the app lies next to its compose file as `icon.<type>`, whatever the file was
// called, and wins over the address the compose file names.

export const ICON_MIME = { ...IMAGE_MIME, svg: "image/svg+xml" } as const;
export const MAX_ICON = 1024 * 1024;
type IconType = keyof typeof ICON_MIME;

/** What kind of picture an icon is; SVG is text, so it is told by its opening tag */
export function iconType(bytes: Uint8Array): IconType | "" {
  const known = imageType(bytes.subarray(0, 16));
  if (known) return known;
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, "").trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head) ? "svg" : "";
}

export function appIcon(name: string): { path: string; type: IconType; mtime: number } | null {
  for (const type of Object.keys(ICON_MIME) as IconType[]) {
    const path = join(appDir(name), `icon.${type}`);
    try {
      return { path, type, mtime: Math.round(statSync(path).mtimeMs) };
    } catch {}
  }
  return null;
}

/** The address of the uploaded icon for the page; it changes with the file, so a new one is not hidden by the cache */
const ownIconUrl = (name: string): string => {
  const icon = appIcon(name);
  return icon ? `/api/apps/${name}/icon?v=${icon.mtime}` : "";
};

export function removeAppIcon(name: string): void {
  assertInstalled(name);
  for (const type of Object.keys(ICON_MIME)) rmSync(join(appDir(name), `icon.${type}`), { force: true });
  parsed.delete(name);
  bus.publish("apps");
}

export function setAppIcon(name: string, bytes: Uint8Array): void {
  assertInstalled(name);
  if (bytes.length > MAX_ICON) throw new AppError("icon.tooLarge", 413, { max: MAX_ICON / 1024 / 1024 });
  const type = iconType(bytes);
  if (!type) throw new AppError("icon.notImage");
  // one icon per app: a PNG must not stay behind a new SVG
  for (const other of Object.keys(ICON_MIME)) rmSync(join(appDir(name), `icon.${other}`), { force: true });
  writeFileSync(join(appDir(name), `icon.${type}`), bytes, { mode: 0o644 });
  bus.publish("apps");
}

// --- Reading ----------------------------------------------------------------------------------------

const parsed = new Map<string, { mtime: number; compose: Compose | null }>();

export function readCompose(name: string): Compose | null {
  const file = composeFile(name);
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    parsed.delete(name);
    return null;
  }
  const hit = parsed.get(name);
  if (hit?.mtime === mtime) return hit.compose;
  let compose: Compose | null = null;
  try {
    compose = parseCompose(readFileSync(file, "utf8"));
  } catch {
    // a file broken by hand still shows up as an app, so that it can be fixed or removed from the UI
  }
  parsed.set(name, { mtime, compose });
  return compose;
}

export function installedNames(): string[] {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && APP_NAME_RE.test(e.name) && existsSync(composeFile(e.name)))
    .map((e) => e.name)
    .sort();
}

export type AppStatus = "running" | "partial" | "stopped" | "unknown";

export interface InstalledApp extends Pick<AppMeta, "title" | "icon" | "port" | "index" | "scheme" | "hostname" | "subdomain"> {
  name: string;
  status: AppStatus;
  /** Store the app came from; "" — a custom app */
  store: string;
  /** The store has a newer version of the app */
  update: boolean;
  /** Images of the app that their registry has a newer version of */
  newer: string[];
  /** Behind Hata's sign-in */
  protected: boolean;
  /** Running operation, if any */
  job: { id: string; kind: JobKind } | null;
  /** `done` — a step that ran once and ended as it should (`stepDone`) */
  containers: { id: string; name: string; service: string; image: string; state: string; status: string; ports: string[]; done: boolean }[];
}

/** The variables `docker compose` fills an app's file with: its `.env` */
export function appEnv(name: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(join(appDir(name), ".env"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * The port an app's page is opened at: the one its metadata names while the compose file still publishes
 * it (or publishes nothing — an app on the host's network), else the first published TCP port. A port
 * changed by hand in the compose file leaves `port_map` behind.
 */
function webPortIn(name: string, compose: Compose | null, named: string): string {
  if (!compose) return named;
  const copy = structuredClone(compose);
  resolvePorts(copy, appEnv(name));
  normalize(copy, settings.dataRoot);
  const tcp = publishedPorts(copy).filter((p) => p.protocol === "tcp").map((p) => String(p.port));
  return !tcp.length || tcp.includes(named) ? named : tcp[0]!;
}

function describeApp(name: string, containers: ContainerSummary[] | null, lang: string): InstalledApp {
  const compose = viewOf(name);
  const meta = appMeta(compose ?? { name }, lang);
  const own = (containers ?? []).filter((c) => c.Labels[PROJECT_LABEL] === name);
  const jobId = busy.get(name);
  const job = jobId ? jobs.get(jobId) : undefined;
  return {
    name,
    title: meta.title || name,
    icon: ownIconUrl(name) || meta.icon,
    // an app without store metadata still gets a working tile: its first published TCP port
    port: webPortIn(name, compose, meta.port),
    index: meta.index,
    scheme: meta.scheme,
    hostname: meta.hostname,
    subdomain: meta.subdomain,
    status: containers === null ? "unknown" : appStatus(own.map((c) => ({ service: c.Labels[SERVICE_LABEL] ?? "", state: c.State, status: c.Status })), compose),
    store: recordedStore(name, compose),
    update: planStoreUpdate(name) !== null,
    newer: newerImages(own),
    protected: settings.access[name]?.protect === true,
    job: job ? { id: job.id, kind: job.kind } : null,
    containers: own.map((c) => ({
      id: c.Id.slice(0, 12),
      ports: [...new Set(c.Ports.filter((p) => p.PublicPort).map((p) => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`))],
      name: (c.Names[0] ?? "").replace(/^\//, ""),
      service: c.Labels[SERVICE_LABEL] ?? "",
      image: c.Image,
      state: c.State,
      status: c.Status,
      done: stepDone(compose, c.Labels[SERVICE_LABEL] ?? "", c.State, c.Status),
    })),
  };
}

export async function listApps(lang: string): Promise<InstalledApp[]> {
  const containers = await listContainers().catch(() => null);
  return installedNames().map((name) => describeApp(name, containers, lang));
}

export interface AppDetail extends InstalledApp {
  /** Where the app's compose file lies on disk */
  composeFile: string;
  /** Host folders the app keeps data in */
  folders: string[];
  installedAt: number;
}

export async function appDetail(name: string, lang: string): Promise<AppDetail> {
  assertInstalled(name);
  const containers = await listContainers().catch(() => null);
  const compose = viewOf(name);
  let folders: string[] = [];
  if (compose) {
    const copy = structuredClone(compose);
    normalize(copy, settings.dataRoot, name);
    folders = bindSources(copy).filter((f) => !/^\/(dev|proc|sys|run|var\/run|etc)(\/|$)/.test(f));
  }
  let installedAt: number;
  try {
    installedAt = Math.round(statSync(appDir(name)).birthtimeMs);
  } catch {
    // removed while this was being put together
    throw new AppError("app.notFound", 404);
  }
  return { ...describeApp(name, containers, lang), composeFile: composeFile(name), folders, installedAt };
}

/** A stats sample of each running container of the app, keyed by container name */
export async function appStats(name: string): Promise<Record<string, ContainerStats>> {
  assertInstalled(name);
  const containers = (await listContainers().catch(() => [])).filter((c) => c.Labels[PROJECT_LABEL] === name && c.State === "running");
  const samples = await Promise.all(containers.map((c) => containerStats(c.Id)));
  const out: Record<string, ContainerStats> = {};
  containers.forEach((c, i) => {
    if (samples[i]) out[(c.Names[0] ?? "").replace(/^\//, "")] = samples[i]!;
  });
  return out;
}

export function composeText(name: string): string {
  assertInstalled(name);
  return readFileSync(composeFile(name), "utf8");
}

/**
 * The compose file the way Hata reads the app — its tile, ports, folders: for an app of Hata's format,
 * filled from its `.env`, with the tile made from its `hata.yml`; any other app's file as it is.
 */
export function viewOf(name: string): Compose | null {
  const compose = readCompose(name);
  const meta = hataMetaOf(name);
  return compose && meta ? viewCompose(compose, meta, appEnv(name)) : compose;
}

/** What `hata.yml` says of an app of Hata's format; null — the app is not one */
export const hataMetaOf = (name: string): HataMeta | null => readHataFile(name)?.meta ?? null;

// --- Store app → form -------------------------------------------------------------------------------

/** A private, normalised copy of a store app's compose file, for this server's data folder or another's */
export function storeCompose(store: string, name: string, dataRoot = settings.dataRoot): Compose {
  const app = storeApp(store, name);
  if (!app) throw new AppError("store.appNotFound", 404);
  const compose = structuredClone(app.compose);
  normalize(compose, dataRoot, name);
  return compose;
}

async function portFree(port: number, protocol: string): Promise<boolean> {
  try {
    if (protocol === "udp") (await Bun.udpSocket({ port })).close();
    else Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

export interface StoreAppDetail extends AppMeta {
  store: string;
  name: string;
  installed: boolean;
  /** "hata" — the app of a store in Hata's format: its form is `settings` */
  kind: "hata" | "casaos";
  /** What the app asks of the server beyond its folders and ports, and why */
  permissions: { id: string; why: string }[];
  version: string;
  form: AppForm & {
    ports: (AppForm["ports"][number] & { busy: boolean })[];
    /** The settings of an app of Hata's format, with a port that is taken moved to a free one (`busy` — the default was) */
    settings?: (FormSetting & { busy?: number })[];
  };
}

/** The values Hata gives every app of its format, for this server's data folder or another's */
export function ownVars(name: string, dataRoot: string): Record<string, string> {
  return { APP_DATA: join(dataRoot, "AppData", name), PUID: String(settings.puid), PGID: String(settings.pgid), TZ: timezone() };
}

/** A made-up secret: letters and digits, which every program takes, or hexadecimal digits when asked */
function newSecret(length: number, kind?: "hex"): string {
  const chars = kind === "hex" ? "0123456789abcdef" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join("");
}

/** The store app's compose file as the store wrote it (for one of Hata's format, without the tile Hata adds) */
const storeFile = (app: StoreApp): Compose => (app.hata ? parseCompose(app.hata.compose) : app.compose);

/**
 * A store app with its install form. `on` — the form for another machine: its data folder, its ports
 * that are taken and whether the app is there already.
 */
export async function storeAppDetail(store: string, name: string, lang: string, on?: { dataRoot: string; busy: (ports: { port: number; protocol: string }[]) => Promise<number[]>; installed: boolean }): Promise<StoreAppDetail> {
  const app = storeApp(store, name);
  if (!app) throw new AppError("store.appNotFound", 404);
  const installed = on ? on.installed : existsSync(composeFile(name));
  if (app.hata) {
    const { meta } = app.hata;
    const known = { ...ownVars(name, on?.dataRoot ?? settings.dataRoot), DATA_ROOT: on?.dataRoot ?? settings.dataRoot };
    const env = startingEnv(meta, known, () => "");
    const busy = async (port: number) => (on ? (await on.busy([{ port, protocol: "tcp" }])).includes(port) : !(await portFree(port, "tcp")));
    const rows = await Promise.all(
      settingsForm(meta, env, lang).map(async (row) => {
        if (row.type !== "port" || !/^\d+$/.test(row.value) || !(await busy(Number(row.value)))) return row;
        // the store's port is taken here: the next free one is offered instead
        for (let port = Number(row.value) + 1; port < Math.min(65536, Number(row.value) + 100); port++) {
          if (!(await busy(port))) return { ...row, value: String(port), busy: Number(row.value) };
        }
        return { ...row, busy: Number(row.value) };
      }),
    );
    const view = viewCompose(storeFile(app), meta, env);
    return {
      ...appMeta(view, lang),
      store,
      name,
      installed,
      kind: "hata",
      permissions: Object.entries(meta.permissions).map(([id, why]) => ({ id, why: localize(why, lang) })),
      version: meta.version,
      form: { ports: [], volumes: [], envs: [], settings: rows },
    };
  }
  const compose = storeCompose(store, name, on?.dataRoot);
  const form = buildForm(compose, lang);
  const taken = on ? new Set(await on.busy(form.ports.filter((p) => p.published !== "").map((p) => ({ port: Number(p.published), protocol: p.protocol })))) : null;
  const ports = await Promise.all(
    form.ports.map(async (p) => ({ ...p, busy: p.published !== "" && (taken ? taken.has(Number(p.published)) : !(await portFree(Number(p.published), p.protocol))) })),
  );
  return { ...appMeta(compose, lang), store, name, installed, kind: "casaos", permissions: [], version: "", form: { ...form, ports } };
}

// --- Operations -------------------------------------------------------------------------------------

const ENV_HEADER = "# Variables for compose.yml. Hata keeps AppID, PUID, PGID and TZ up to date; other lines are yours.";
const HATA_ENV_HEADER = "# Variables for compose.yml. Hata keeps AppID, APP_DATA, APP_URL, APP_HOST, PUID, PGID and TZ up to date; the settings of the app follow.";
const OWN_ENV_KEYS = new Set(["AppID", "PUID", "PGID", "TZ"]);

/**
 * The text of an app's `.env`: our variables, then whatever else the file already held, then `extra`.
 * `own` — more variables of ours, for an app of Hata's format.
 */
export function envText(name: string, previous: string, extra: Record<string, string> = {}, own: Record<string, string> | null = null): string {
  const ours = new Set([...OWN_ENV_KEYS, ...Object.keys(own ?? {})]);
  const kept = previous.split("\n").filter((line) => {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    return key ? !ours.has(key) && !(key in extra) : line.trim() !== "" && line !== ENV_HEADER && !line.startsWith("# Variables for compose.yml.");
  });
  const added = Object.entries(extra).filter(([key]) => !ours.has(key)).map(([key, value]) => (own ? envLine(key, value) : `${key}=${value}`));
  const head = own ? [HATA_ENV_HEADER, `AppID=${name}`, ...Object.entries(own).map(([key, value]) => envLine(key, value))] : [ENV_HEADER, `AppID=${name}`];
  return [...head, `PUID=${settings.puid}`, `PGID=${settings.pgid}`, `TZ=${timezone()}`, ...kept, ...added, ""].join("\n");
}

/** The server's address on the home network: the first IPv4 of a card that is not Docker's or a tunnel's */
export function homeAddress(): string {
  for (const [card, list] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo|tailscale|hata-wg|wg\d)/.test(card) || settings.network.outside.includes(card)) continue;
    const a = (list ?? []).find((x) => x.family === "IPv4" && !x.internal);
    if (a) return a.address;
  }
  return "localhost";
}

/**
 * The address an app of Hata's format is opened at, as its `.env` gives it: under Hata's domain with
 * HTTPS when there is one, else the server's address on the home network and the app's port.
 */
export function appUrlOf(name: string, meta: HataMeta, compose: Compose, env: Record<string, string>): string {
  const view = filled(compose, env);
  const own = typeof compose["x-casaos"] === "object" && compose["x-casaos"] ? compose["x-casaos"] : {};
  if (!meta.web) return "";
  if (siteDomain()) return `https://${labelOf({ name, subdomain: typeof own.subdomain === "string" ? own.subdomain : "" })}.${siteDomain()}`;
  const port = webPortOf(meta, view);
  return port ? `${meta.web.scheme}://${homeAddress()}:${port}` : "";
}

/** Hata's own variables of an app of its format, with `env` the values its `.env` will hold */
function hataOwn(name: string, meta: HataMeta, env: Record<string, string>): Record<string, string> {
  const compose = readCompose(name);
  const vars = ownVars(name, settings.dataRoot);
  const url = compose ? appUrlOf(name, meta, compose, { ...env, ...vars }) : "";
  return { APP_DATA: vars.APP_DATA!, APP_URL: url, APP_HOST: url ? new URL(url).hostname : "" };
}

/**
 * After the domain changed: every app of Hata's format whose address is not the one its `.env` holds
 * gets the new one and is recreated, if it runs, so that it reads it. Returns the jobs started.
 */
export async function refreshAppUrls(user: string): Promise<Job[]> {
  const containers = await listContainers().catch(() => []);
  const jobs: Job[] = [];
  for (const name of installedNames()) {
    const meta = hataMetaOf(name);
    if (!meta || busy.has(name)) continue;
    const env = appEnv(name);
    const own = hataOwn(name, meta, env);
    if (own.APP_URL === (env.APP_URL ?? "") && own.APP_HOST === (env.APP_HOST ?? "")) continue;
    writeEnv(name);
    if (containers.some((c) => c.Labels[PROJECT_LABEL] === name && c.State === "running")) jobs.push(startJob(name, "apply", user, (log) => dc(name, ["up", "-d", "--remove-orphans"], log)));
  }
  return jobs;
}

export function writeEnv(name: string, extra: Record<string, string> = {}): void {
  const file = join(appDir(name), ".env");
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  const meta = hataMetaOf(name);
  const own = meta ? hataOwn(name, meta, { ...parseEnv(previous), ...extra }) : null;
  writeTextAtomic(file, envText(name, previous, extra, own));
}

/**
 * Creates the app's missing bind directories — only inside the data root; devices and sockets are not
 * ours. What is made belongs to PUID:PGID, the user the apps run as: an image that does not start as
 * root could not write into a folder of root's.
 */
function createDataDirs(compose: Compose, more: string[] = []): string[] {
  const root = settings.dataRoot === "/" ? "/" : settings.dataRoot + "/";
  const made: string[] = [];
  for (const source of [...bindSources(compose), ...more]) {
    if (!source.startsWith(root) || existsSync(source)) continue;
    // the data folder and AppData themselves stay root's
    mkdirSync(source.startsWith(join(settings.dataRoot, "AppData") + "/") ? join(settings.dataRoot, "AppData") : settings.dataRoot, { recursive: true });
    const first = mkdirSync(source, { recursive: true });
    if (first && process.getuid?.() === 0) Bun.spawnSync(["chown", "-R", `${settings.puid}:${settings.pgid}`, "--", first]);
    made.push(source);
  }
  return made;
}

/**
 * The folders just made for an app, given to the user each service runs as when that is not the one apps
 * run as: an image that runs as its own user (Grafana as 472) cannot write into a folder of 1000's.
 * Only folders made by this install, still empty, are touched. Runs after the images are pulled.
 */
async function giveToImageUsers(compose: Compose, made: string[], log: Log): Promise<void> {
  if (!made.length || process.getuid?.() !== 0) return;
  for (const [service, def] of Object.entries(compose.services) as [string, Compose][]) {
    if (typeof def.image !== "string") continue;
    const mine = bindSources({ services: { [service]: def } }).filter((source) => made.includes(source));
    if (!mine.length) continue;
    const who = await imageUser(def.image, def.user == null ? "" : String(def.user)).catch(() => null);
    if (!who || (who.uid === settings.puid && who.gid === settings.pgid)) continue;
    for (const source of mine) {
      Bun.spawnSync(["chown", "-R", `${who.uid}:${who.gid}`, "--", source]);
      log(`${source} given to ${who.uid}:${who.gid}, the user ${service} runs as`);
    }
  }
}

async function assertPortsFree(compose: Compose): Promise<void> {
  for (const { port, protocol } of publishedPorts(compose)) {
    if (!(await portFree(port, protocol))) throw new AppError("app.portBusy", 409, { port });
  }
}

async function install(name: string, text: string, compose: Compose, log: Log, origin?: { store: string; base: Compose; hata?: IndexApp; env?: Record<string, string> }): Promise<void> {
  const dir = appDir(name);
  mkdirSync(dir, { recursive: true });
  try {
    writeTextAtomic(composeFile(name), text);
    if (origin) writeHataFile(name, origin.store, origin.base, origin.hata);
    if (origin?.hata) writeFiles(name, origin.hata.files, {}, log);
    writeEnv(name, origin?.env);
    await dc(name, ["config", "--quiet"], log);
    // the folders are made from the file as compose will read it, with the settings' folders too
    const view = origin?.hata ? viewOf(name)! : compose;
    if (origin?.hata) normalize(view, settings.dataRoot, name);
    const made = createDataDirs(view, origin?.hata ? settingFolders(origin.hata.meta, appEnv(name)) : []);
    await dc(name, ["pull"], log);
    await giveToImageUsers(view, made, log);
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  } catch (e) {
    // a failed install leaves nothing behind, so it can simply be tried again
    await runCompose(name, dir, ["down", "--remove-orphans"]).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

// --- An app arriving from another machine, or leaving for one (`moveapp.ts`) --------------------------

/** The files of an app as they are: what moves with it — for an app of Hata's format also the other files its store gave */
export function localAppFiles(name: string): AppFiles {
  assertInstalled(name);
  const read = (file: string) => (existsSync(join(appDir(name), file)) ? readFileSync(join(appDir(name), file), "utf8") : null);
  const others: Record<string, string> = {};
  for (const path of Object.keys(readHataFile(name)?.files ?? {})) {
    const text = read(path);
    if (text !== null) others[path] = text;
  }
  return { compose: read("compose.yml") ?? "", env: read(".env") ?? "", hata: read("hata.yml"), others };
}

/** An app's files, here or on a machine: what an app is wherever it runs */
export interface AppFiles {
  compose: string;
  env: string;
  hata: string | null;
  /** The other files `hata.yml` names, by their path in the app's folder */
  others?: Record<string, string>;
}

/** What `hata.yml` says of an app of Hata's format, from its text; null — the app is not one */
export function hataMetaIn(text: string | null): { meta: HataMeta; files: Record<string, string> } | null {
  if (!text) return null;
  try {
    const parsed = Bun.YAML.parse(text) as HataFile | null;
    return isObject(parsed) && isObject(parsed.meta) ? { meta: parsed.meta as HataMeta, files: isObject(parsed.files) ? (parsed.files as Record<string, string>) : {} } : null;
  } catch {
    return null;
  }
}

/** The compose file of an app's files the way Hata reads it (`viewOf` for files that are not here); null — broken */
export function viewOfFiles(files: AppFiles): Compose | null {
  let compose: Compose;
  try {
    compose = parseCompose(files.compose);
  } catch {
    return null;
  }
  const hata = hataMetaIn(files.hata);
  return hata ? viewCompose(compose, hata.meta, parseEnv(files.env)) : compose;
}

/** The folders an app's files need made before it starts, under `dataRoot`: its binds and the folders of its settings */
export function foldersOfFiles(files: AppFiles, dataRoot: string, name: string): string[] {
  const view = viewOfFiles(files);
  if (!view) return [];
  normalize(view, dataRoot, name);
  const hata = hataMetaIn(files.hata);
  return [...bindSources(view), ...(hata ? settingFolders(hata.meta, parseEnv(files.env)) : [])];
}

/** Which of these ports something here listens on already */
export async function busyPorts(ports: { port: number; protocol: string }[]): Promise<number[]> {
  const busy: number[] = [];
  for (const { port, protocol } of ports) if (!(await portFree(port, protocol))) busy.push(port);
  return busy;
}

/**
 * Puts an app that came from elsewhere in place and starts it: its files as they were (the compose
 * file already pointing at this data folder), `.env` with this server's own variables. A failure takes
 * the app's folder away again; its data, copied before, is the caller's.
 */
export async function adoptApp(name: string, files: AppFiles, log: Log): Promise<void> {
  assertName(name);
  if (existsSync(appDir(name))) throw new AppError("app.exists", 409);
  const dir = appDir(name);
  mkdirSync(dir, { recursive: true });
  try {
    writeTextAtomic(composeFile(name), files.compose);
    if (files.hata) writeTextAtomic(hataFile(name), files.hata);
    // only paths inside the app's folder: the files may come from another machine
    const others = Object.entries(files.others ?? {}).filter(([path]) => /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) && !path.split("/").some((p) => p === "." || p === "..") && !["compose.yml", "hata.yml", ".env"].includes(path) && !path.startsWith("compose.override."));
    writeFiles(name, Object.fromEntries(others), null, log);
    // the variables of this server go in again: an app of Hata's format has its folder in APP_DATA
    writeTextAtomic(join(dir, ".env"), files.env);
    writeEnv(name);
    await dc(name, ["config", "--quiet"], log);
    createDataDirs({ services: {} }, foldersOfFiles(localAppFiles(name), settings.dataRoot, name));
    await dc(name, ["pull"], log);
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  } catch (e) {
    await runCompose(name, dir, ["down", "--remove-orphans"]).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    parsed.delete(name);
    throw e;
  }
}

/** The app has left for another machine: its folder goes, and what other modules keep about it */
export function letGo(name: string): void {
  assertInstalled(name);
  rmSync(appDir(name), { recursive: true, force: true });
  parsed.delete(name);
  plans.delete(name);
  for (const hook of removedHooks) hook(name);
}

/** An install without Docker would only fail half-way with words nobody can act on */
function needDocker(): void {
  if (!Bun.which("docker", { PATH: `${process.env.PATH ?? ""}:/usr/bin:/usr/local/bin` })) throw new AppError("docker.missing", 409);
}

/**
 * The other files of an app of Hata's format put next to its compose file: those `previous` names (the
 * store's files of the version installed) are replaced only while the person has not changed them.
 */
function writeFiles(name: string, files: Record<string, string>, previous: Record<string, string> | null, log: Log): void {
  const dir = appDir(name);
  for (const [path, text] of Object.entries(files)) {
    const file = join(dir, path);
    const now = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (now === text) continue;
    if (previous && now !== null && now !== previous[path]) {
      log(`${path} was changed here: kept as it is, the store's new version not taken`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeTextAtomic(file, text);
  }
  // a file the store no longer has goes, unless it was changed here
  for (const [path, text] of Object.entries(previous ?? {})) {
    const file = join(dir, path);
    if (path in files || !existsSync(file)) continue;
    if (readFileSync(file, "utf8") === text) rmSync(file, { force: true });
  }
}

/**
 * The answers of the install form of an app of Hata's format, for this server's data folder or another's:
 * the `.env` values of its settings and the file as compose will read it (with Hata's variables).
 */
export function hataAnswers(app: StoreApp & { hata: IndexApp }, form: unknown, dataRoot = settings.dataRoot): { values: Record<string, string>; compose: Compose; view: Compose } {
  const { name, hata } = app;
  const known = { ...ownVars(name, dataRoot), DATA_ROOT: dataRoot };
  const result = answer(hata.meta, isObject(form) ? form.settings : undefined, startingEnv(hata.meta, known, newSecret));
  if ("error" in result) throw new AppError(result.error, 400, { name: result.name });
  const compose = parseCompose(hata.compose);
  const view = viewCompose(compose, hata.meta, { ...result.values, ...known });
  normalize(view, dataRoot, name);
  return { values: result.values, compose, view };
}

async function installHata(app: StoreApp & { hata: IndexApp }, form: unknown, user: string): Promise<Job> {
  const { name, hata } = app;
  const { values, compose, view } = hataAnswers(app, form);
  await assertPortsFree(view);
  const origin = { store: app.store, base: compose, hata, env: values };
  return startJob(name, "install", user, (log) => install(name, hata.compose, view, log, origin));
}

export async function installFromStore(store: string, name: string, form: unknown, user: string): Promise<Job> {
  needDocker();
  assertName(name);
  const app = storeApp(store, name);
  if (!app) throw new AppError("store.appNotFound", 404);
  if (existsSync(appDir(name))) throw new AppError("app.exists", 409);
  if (app.hata) return installHata(app as StoreApp & { hata: IndexApp }, form, user);
  const compose = storeCompose(store, name);
  if (existsSync(appDir(name))) throw new AppError("app.exists", 409);
  const error = applyForm(compose, form ?? {});
  if (error) throw new AppError(error);
  await assertPortsFree(compose);
  const origin = { store, base: structuredClone(storeApp(store, name)!.compose) };
  return startJob(name, "install", user, (log) => install(name, dumpCompose(compose), compose, log, origin));
}

/** Installs a compose file pasted by the user; the text is stored exactly as given */
export async function installCustom(name: unknown, text: unknown, user: string): Promise<Job> {
  needDocker();
  if (typeof text !== "string" || text.length > 512 * 1024) throw new AppError("app.badCompose");
  let compose: Compose;
  try {
    compose = parseCompose(text);
  } catch (e) {
    throw new AppError("app.badCompose", 400, { message: e instanceof Error ? e.message : String(e) });
  }
  const appName = typeof name === "string" && name ? name : typeof compose.name === "string" ? compose.name : "";
  assertName(appName);
  if (existsSync(appDir(appName))) throw new AppError("app.exists", 409);
  normalize(compose, settings.dataRoot);
  await assertPortsFree(compose);
  return startJob(appName, "install", user, (log) => install(appName, text, compose, log));
}

/** Called after an app is removed, for modules that keep something about it */
const removedHooks: ((name: string) => void)[] = [];
export function onAppRemoved(hook: (name: string) => void): void {
  removedHooks.push(hook);
}

/** Runs inside an update, before anything changes — the backup module snapshots the app here */
let beforeUpdate: ((name: string, log: Log) => Promise<void>) | null = null;
export function onBeforeUpdate(hook: (name: string, log: Log) => Promise<void>): void {
  beforeUpdate = hook;
}

/**
 * Whether a stopped container is one Docker could not start because its disk was away: it has a restart
 * policy that would have run it, Docker kept the error of the start, and a folder it mounts lies on one
 * of the disks that came back. A container somebody stopped carries no error, so it stays stopped.
 */
export function failedOnDisk(c: Pick<ContainerInspect, "State" | "HostConfig" | "Mounts">, paths: string[]): boolean {
  if (c.State.Running || !c.State.Error) return false;
  if (!["always", "unless-stopped", "on-failure"].includes(c.HostConfig?.RestartPolicy?.Name ?? "")) return false;
  return (c.Mounts ?? []).some((m) => m.Type === "bind" && paths.some((path) => m.Source === path || m.Source.startsWith(path + "/")));
}

/** A disk that was away is back: the apps that could not start without it are started */
export async function startAfterDisk(paths: string[]): Promise<string[]> {
  const names = new Set(installedNames());
  const started: string[] = [];
  const waiting = new Map<string, string[]>();
  for (const c of await listContainers().catch(() => [])) {
    const name = c.Labels[PROJECT_LABEL] ?? "";
    if (c.State !== "running" && names.has(name)) waiting.set(name, [...(waiting.get(name) ?? []), c.Id]);
  }
  for (const [name, ids] of waiting) {
    if (busy.has(name)) continue;
    const seen = await Promise.all(ids.map((id) => inspectContainer(id).catch(() => null)));
    if (!seen.some((c) => c && failedOnDisk(c, paths))) continue;
    appAction(name, "start", "disk");
    started.push(name);
  }
  return started;
}

export function appAction(name: string, action: string, user: string): Job {
  assertInstalled(name);
  switch (action) {
    case "start":
      return startJob(name, "start", user, async (log) => {
        writeEnv(name);
        await dc(name, ["up", "-d", "--remove-orphans"], log);
      });
    case "stop":
      return startJob(name, "stop", user, (log) => dc(name, ["stop"], log));
    case "restart":
      return startJob(name, "restart", user, (log) => dc(name, ["restart"], log));
    case "update":
      return startJob(name, "update", user, async (log) => {
        writeEnv(name);
        await beforeUpdate?.(name, log);
        await dc(name, ["pull"], log);
        await dc(name, ["up", "-d", "--remove-orphans"], log);
      });
    default:
      throw new AppError("app.badAction");
  }
}

// --- Where an app came from, and the store's newer version of it --------------------------------------

const hataFile = (name: string) => join(appDir(name), "hata.yml");
const HATA_FILE_HEADER = "# Written by Hata: the store this app came from and the store's compose file it was installed from.\n# compose.yml next to this file is yours to edit; this one is not, and docker compose never reads it.\n";

function writeHataFile(name: string, store: string, base: Compose, hata?: IndexApp): void {
  writeTextAtomic(hataFile(name), hataFileText(store, base, hata));
}

/**
 * The text of `hata.yml`: the store an app came from and the store's file it was installed from; for an
 * app of Hata's format also what the store said of it (`meta`) and its other files as installed.
 */
export const hataFileText = (store: string, base: Compose, hata?: IndexApp): string =>
  HATA_FILE_HEADER + dumpCompose(hata ? { store, base, meta: hata.meta, files: hata.files } : { store, base });

interface HataFile {
  store: string;
  /** The store's compose file as the store had it; null when it was not kept */
  base: Compose | null;
  /** An app of Hata's format: what its store said of it */
  meta?: HataMeta;
  /** …and its other files as the store had them */
  files?: Record<string, string>;
}

const hataFiles = new Map<string, { mtime: number; value: HataFile | null }>();

function readHataFile(name: string): HataFile | null {
  let mtime: number;
  try {
    mtime = statSync(hataFile(name)).mtimeMs;
  } catch {
    hataFiles.delete(name);
    return null;
  }
  const hit = hataFiles.get(name);
  if (hit?.mtime === mtime) return hit.value;
  let value: HataFile | null = null;
  try {
    const doc = Bun.YAML.parse(readFileSync(hataFile(name), "utf8")) as Compose | null;
    if (typeof doc?.store === "string") {
      value = { store: doc.store, base: typeof doc.base?.services === "object" && doc.base.services ? doc.base : null };
      if (isObject(doc.meta) && Array.isArray(doc.meta.settings)) value.meta = doc.meta as HataMeta;
      if (isObject(doc.files)) value.files = doc.files as Record<string, string>;
    }
  } catch {
    // a damaged file only means the app is treated as one that does not say where it came from
  }
  hataFiles.set(name, { mtime, value });
  return value;
}

/** The store written down for the app: in `hata.yml`, or in the `x-hata` block older versions put into the compose file */
function recordedStore(name: string, compose: Compose | null): string {
  return readHataFile(name)?.store ?? (typeof compose?.["x-hata"]?.store === "string" ? compose["x-hata"].store : "");
}

export interface StoreUpdate {
  store: string;
  /** An app of Hata's format: the store's version of it as a whole */
  hata?: IndexApp;
  /** False when the store was found by the app's name only (an app moved in from CasaOS) */
  recorded: boolean;
  /** False when the store file the app was installed from is not known: only the form's answers are surely kept */
  exact: boolean;
  changes: MergeChange[];
  merged: Compose;
  /** The store's file as it is today — the next base */
  base: Compose;
}

const plans = new Map<string, { compose: Compose; origin: HataFile | null; theirs: Compose; plan: StoreUpdate | null }>();

/** The store's newer version merged into the app's compose file; null when there is nothing new */
export function planStoreUpdate(name: string): StoreUpdate | null {
  const compose = readCompose(name);
  if (!compose) return null;
  const origin = readHataFile(name);
  const store = recordedStore(name, compose);
  const app = store ? storeApp(store, name) : findStoreApp(name);
  if (!app) return null;
  // parsed files are cached objects: the same three mean the same answer
  const hit = plans.get(name);
  if (hit && hit.compose === compose && hit.origin === origin && hit.theirs === app.compose) return hit.plan;
  if (app.hata) {
    const plan = hataPlan(app, compose, origin, store !== "");
    plans.set(name, { compose, origin, theirs: app.compose, plan });
    return plan;
  }

  const prepared = (source: Compose) => {
    const copy = structuredClone(source);
    normalize(copy, settings.dataRoot, name);
    return copy;
  };
  const [ours, theirs] = [prepared(compose), prepared(app.compose)];
  const images = (c: Compose) => Object.entries(c.services).map(([service, s]) => [service, (s as Compose).image]);
  let plan: StoreUpdate | null = null;
  // Without the file the app was installed from, only a new image says "newer": the rest of the
  // difference may be the user's edits, or CasaOS's.
  if (origin?.base || !same(images(ours), images(theirs))) {
    const { merged, changes } = merge3(origin?.base ? prepared(origin.base) : guessBase(ours, theirs), ours, theirs);
    // a store that only rewrote a description has no new version of the app
    if (changes.some((change) => !change.path.startsWith("x-casaos"))) {
      plan = { store: app.store, recorded: store !== "", exact: !!origin?.base, changes, merged, base: structuredClone(app.compose) };
    }
  }
  plans.set(name, { compose, origin, theirs: app.compose, plan });
  return plan;
}

/**
 * The newer version of an app of Hata's format: its compose file merged like any other (the settings
 * live in `.env`, so the file is the store's unless edited by hand), and its other files.
 */
function hataPlan(app: StoreApp, compose: Compose, origin: HataFile | null, recorded: boolean): StoreUpdate | null {
  const hata = app.hata!;
  const theirs = parseCompose(hata.compose);
  const prepared = (source: Compose) => {
    const copy = structuredClone(source);
    normalize(copy, settings.dataRoot);
    return copy;
  };
  const ours = prepared(compose);
  const { merged, changes } = merge3(origin?.base ? prepared(origin.base) : guessBase(ours, prepared(theirs)), ours, prepared(theirs));
  const filesChanged = !same(origin?.files ?? {}, hata.files);
  if (!changes.length && !filesChanged) return null;
  return { store: app.store, hata, recorded, exact: !!origin?.base, changes, merged, base: theirs };
}

/** Moves the app to the store's newer version, keeping what the user changed */
export function applyStoreUpdate(name: string, user: string): Job {
  assertInstalled(name);
  const plan = planStoreUpdate(name);
  if (!plan) throw new AppError("app.noUpdate", 409);
  return startJob(name, "update", user, async (log) => {
    await beforeUpdate?.(name, log);
    const previous = [composeFile(name), hataFile(name), join(appDir(name), ".env")].map((file) => ({ file, text: existsSync(file) ? readFileSync(file, "utf8") : null }));
    const before = readHataFile(name);
    // a file nobody edited is written as the store has it, comments and all
    writeTextAtomic(composeFile(name), plan.hata && same(readCompose(name), before?.base) ? plan.hata.compose : dumpCompose(plan.merged));
    writeHataFile(name, plan.store, plan.base, plan.hata);
    if (plan.hata) {
      writeFiles(name, plan.hata.files, before?.files ?? {}, log);
      // a setting the new version brings starts at its default, a new secret is made
      const env = appEnv(name);
      const fresh = startingEnv(plan.hata.meta, { ...ownVars(name, settings.dataRoot), DATA_ROOT: settings.dataRoot }, newSecret);
      writeEnv(name, Object.fromEntries(Object.entries(fresh).filter(([key]) => !(key in env))));
    } else writeEnv(name);
    try {
      await dc(name, ["config", "--quiet"], log);
    } catch (e) {
      for (const { file, text } of previous) text === null ? rmSync(file, { force: true }) : writeTextAtomic(file, text);
      throw e;
    }
    const view = plan.hata ? viewOf(name)! : plan.merged;
    if (plan.hata) normalize(view, settings.dataRoot, name);
    const made = createDataDirs(view, plan.hata ? settingFolders(plan.hata.meta, appEnv(name)) : []);
    await dc(name, ["pull"], log);
    await giveToImageUsers(view, made, log);
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  });
}

/** Replaces the compose file and applies it; a file that compose rejects is not kept */
export function applyCompose(name: string, text: unknown, user: string): Job {
  assertInstalled(name);
  if (typeof text !== "string" || text.length > 512 * 1024) throw new AppError("app.badCompose");
  try {
    parseCompose(text);
  } catch (e) {
    throw new AppError("app.badCompose", 400, { message: e instanceof Error ? e.message : String(e) });
  }
  return startJob(name, "apply", user, async (log) => {
    const previous = readFileSync(composeFile(name), "utf8");
    writeTextAtomic(composeFile(name), text);
    writeEnv(name);
    try {
      await dc(name, ["config", "--quiet"], log);
    } catch (e) {
      writeTextAtomic(composeFile(name), previous);
      throw e;
    }
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  });
}

/**
 * The compose file of an app of Hata's format with the tile in it as the form shows it: the one made
 * from `hata.yml` under what the file itself says. `made` — the block made, to tell the person's changes.
 */
function withTile(name: string, compose: Compose, meta: HataMeta): { compose: Compose; made: Compose } {
  const made = casaosOf(meta, filled(compose, appEnv(name)));
  const copy = structuredClone(compose);
  copy["x-casaos"] = { ...made, ...(isObject(compose["x-casaos"]) ? compose["x-casaos"] : {}) };
  return { compose: copy, made };
}

/** The app's compose file as the settings form shows it; for an app of Hata's format also its settings */
export function appSettings(name: string, lang: string): AppEdit & { ownIcon: string; storeIcon?: string; settings?: FormSetting[] } {
  assertInstalled(name);
  const compose = readCompose(name);
  if (!compose) throw new AppError("app.badCompose", 409, { message: "" });
  const meta = hataMetaOf(name);
  if (meta) {
    const { compose: shown, made } = withTile(name, compose, meta);
    const edit = readEdit(shown, lang);
    // the store's picture is shown, not put in the address field: there it would be a page of base64
    return { ...edit, icon: edit.icon === made.icon ? "" : edit.icon, storeIcon: String(made.icon ?? ""), ownIcon: ownIconUrl(name), settings: settingsForm(meta, appEnv(name), lang) };
  }
  return { ...readEdit(compose, lang), ownIcon: ownIconUrl(name) };
}

function editedCompose(compose: Compose, input: unknown, lang: string): Compose {
  const error = applyEdit(compose, input, lang);
  if (error) throw new AppError(error);
  // folders named in the form are made the way an install makes them
  const copy = structuredClone(compose);
  normalize(copy, settings.dataRoot);
  createDataDirs(copy);
  return compose;
}

/** A name under the domain belongs to one app: the one chosen here must not be another app's */
function assertLabelFree(name: string, compose: Compose): void {
  const label = appMeta(compose, "en").subdomain;
  if (!label) return;
  for (const other of installedNames()) {
    if (other === name) continue;
    const theirs = viewOf(other);
    if (((theirs && appMeta(theirs, "en").subdomain) || other.replace(/_/g, "-")) === label) throw new AppError("edit.domainTaken", 409, { app: other });
  }
}

/** Applies the settings form: the answers go into the compose file, which is then applied as if edited by hand */
export function applySettings(name: string, input: unknown, user: string, lang: string): Job {
  assertInstalled(name);
  const compose = structuredClone(readCompose(name));
  if (!compose) throw new AppError("app.badCompose", 409, { message: "" });
  const meta = hataMetaOf(name);
  if (meta) return applyHataSettings(name, compose, meta, input, user, lang);
  const edited = editedCompose(compose, input, lang);
  assertLabelFree(name, edited);
  return applyCompose(name, dumpCompose(edited), user);
}

/**
 * The settings form of an app of Hata's format: the settings go into `.env`, what was changed of the tile
 * and the services into the compose file — which is rewritten only when something there changed.
 */
function applyHataSettings(name: string, compose: Compose, meta: HataMeta, input: unknown, user: string, lang: string): Job {
  const env = appEnv(name);
  const result = answer(meta, isObject(input) ? input.env : undefined, env);
  if ("error" in result) throw new AppError(result.error, 400, { name: result.name });
  const { compose: shown, made } = withTile(name, compose, meta);
  const before = JSON.stringify(shown);
  // the form leaves the store's picture out of the address field (see appSettings): empty means it
  const edit = isObject(input) && input.icon === "" && made.icon ? { ...input, icon: made.icon } : input;
  const error = applyEdit(shown, edit, lang);
  if (error) throw new AppError(error);
  const fileChanged = JSON.stringify(shown) !== before;
  const own = ownCasaos(shown["x-casaos"] ?? {}, made);
  if (own) shown["x-casaos"] = own;
  else delete shown["x-casaos"];
  assertLabelFree(name, viewCompose(shown, meta, { ...env, ...result.values }));
  return startJob(name, "apply", user, async (log) => {
    const files = [composeFile(name), join(appDir(name), ".env")];
    const previous = files.map((file) => readFileSync(file, "utf8"));
    if (fileChanged) writeTextAtomic(composeFile(name), dumpCompose(shown));
    writeEnv(name, result.values);
    try {
      await dc(name, ["config", "--quiet"], log);
    } catch (e) {
      files.forEach((file, i) => writeTextAtomic(file, previous[i]!));
      throw e;
    }
    const view = viewOf(name)!;
    normalize(view, settings.dataRoot, name);
    createDataDirs(view, settingFolders(meta, appEnv(name)));
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  });
}

/** Installs an app described in the settings form instead of a compose file */
export async function installFromSettings(name: unknown, input: unknown, user: string, lang: string): Promise<Job> {
  assertName(typeof name === "string" ? name : "");
  if (existsSync(appDir(name as string))) throw new AppError("app.exists", 409);
  const edited = editedCompose(blankCompose(name as string), input, lang);
  assertLabelFree(name as string, edited);
  return installCustom(name, dumpCompose(edited), user);
}

/** Removes the app; `withData` also deletes its named volumes and `<dataRoot>/AppData/<name>` */
export function removeApp(name: string, withData: boolean, user: string): Job {
  assertInstalled(name);
  return startJob(name, "remove", user, async (log) => {
    await dc(name, ["down", "--remove-orphans", ...(withData ? ["--volumes"] : [])], log);
    rmSync(appDir(name), { recursive: true, force: true });
    parsed.delete(name);
    plans.delete(name);
    for (const hook of removedHooks) hook(name);
    if (withData) {
      const data = join(settings.dataRoot, "AppData", name);
      log(`Removing ${data}`);
      await rm(data, { recursive: true, force: true });
    }
  });
}

/** Follows the app's container logs: a text stream that ends when `signal` aborts */
export function appLogs(name: string, signal: AbortSignal, tail = 200): ReadableStream<Uint8Array> {
  assertInstalled(name);
  const proc = Bun.spawn({
    cmd: composeCmd(name, appDir(name), ["logs", "--no-color", "--follow", "--tail", String(tail)]),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  signal.addEventListener("abort", () => proc.kill(), { once: true });
  return proc.stdout;
}
