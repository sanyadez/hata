/**
 * Installed apps. An app is a directory `data/apps/<name>/` with a plain `compose.yml` and a `.env`
 * next to it — `docker compose up -d` in that directory works by hand, with or without Hata running.
 * Nothing about an app is stored anywhere else: its tile data is the `x-casaos` block of the file, its
 * state is whatever Docker reports for the compose project of the same name.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME_RE, appMeta, applyForm, bindSources, buildForm, dumpCompose, normalize, parseCompose, publishedPorts, type AppForm, type AppMeta, type Compose } from "./appform";
import { bus } from "./bus";
import { DATA_DIR, settings, timezone } from "./config";
import { record } from "./activity";
import { compose as runCompose, composeCmd, containerStats, listContainers, PROJECT_LABEL, SERVICE_LABEL, type ContainerStats, type ContainerSummary } from "./docker";
import { writeTextAtomic } from "./fsutil";
import { storeApp } from "./store";

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

const appDir = (name: string) => join(APPS_DIR, name);
const composeFile = (name: string) => join(appDir(name), "compose.yml");

function assertName(name: string): void {
  if (!APP_NAME_RE.test(name)) throw new AppError("app.badName");
}

function assertInstalled(name: string): void {
  assertName(name);
  if (!existsSync(composeFile(name))) throw new AppError("app.notFound", 404);
}

// --- Jobs -------------------------------------------------------------------------------------------

export type JobKind = "install" | "update" | "start" | "stop" | "restart" | "remove" | "apply";

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

type Log = (line: string) => void;

/** Starts a long operation on an app; one app runs one operation at a time */
function startJob(app: string, kind: JobKind, user: string, work: (log: Log) => Promise<void>): Job {
  if (busy.has(app)) throw new AppError("app.busy", 409);
  const job: Job = { id: crypto.randomUUID(), app, kind, status: "running", log: [], lineCount: 0, startedAt: Date.now() };
  jobs.set(job.id, job);
  busy.set(app, job.id);
  const summary = () => ({ id: job.id, app, kind, status: job.status, error: job.error });
  const log: Log = (line) => {
    job.log.push(line);
    if (job.log.length > MAX_LOG_LINES) job.log.shift();
    bus.publish("job", { job: summary(), line, n: job.lineCount++ });
  };
  bus.publish("job", { job: summary() });
  void work(log)
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
      record(`app.${kind}.${job.status}`, { app, user, detail: job.status === "failed" ? job.error?.trim().split("\n")[0]?.trim().slice(0, 300) : undefined });
      busy.delete(app);
      const finished = [...jobs.values()].filter((j) => j.status !== "running");
      for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED_JOBS))) jobs.delete(old.id);
      bus.publish("job", { job: summary() });
      bus.publish("apps");
    });
  return job;
}

/** Runs `docker compose …` for an app, failing the job on a non-zero exit */
async function dc(name: string, args: string[], log: Log): Promise<void> {
  log(`$ docker compose ${args.join(" ")}`);
  const { code, output } = await runCompose(name, appDir(name), args, log);
  if (code !== 0) throw new Error(output.split("\n").slice(-3).join("\n") || `docker compose exited with ${code}`);
}

// --- Reading ----------------------------------------------------------------------------------------

const parsed = new Map<string, { mtime: number; compose: Compose | null }>();

function readCompose(name: string): Compose | null {
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

function installedNames(): string[] {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && APP_NAME_RE.test(e.name) && existsSync(composeFile(e.name)))
    .map((e) => e.name)
    .sort();
}

export type AppStatus = "running" | "partial" | "stopped" | "unknown";

export interface InstalledApp extends Pick<AppMeta, "title" | "icon" | "port" | "index" | "scheme" | "hostname"> {
  name: string;
  status: AppStatus;
  /** Store the app came from; "" — a custom app */
  store: string;
  /** Running operation, if any */
  job: { id: string; kind: JobKind } | null;
  containers: { id: string; name: string; service: string; image: string; state: string; status: string; ports: string[] }[];
}

function firstPublishedPort(compose: Compose | null): string {
  if (!compose) return "";
  const copy = structuredClone(compose);
  normalize(copy, settings.dataRoot);
  const port = publishedPorts(copy).find((p) => p.protocol === "tcp");
  return port ? String(port.port) : "";
}

function describeApp(name: string, containers: ContainerSummary[] | null, lang: string): InstalledApp {
  const compose = readCompose(name);
  const meta = appMeta(compose ?? { name }, lang);
  const own = (containers ?? []).filter((c) => c.Labels[PROJECT_LABEL] === name);
  const running = own.filter((c) => c.State === "running").length;
  const jobId = busy.get(name);
  const job = jobId ? jobs.get(jobId) : undefined;
  return {
    name,
    title: meta.title || name,
    icon: meta.icon,
    // an app without store metadata still gets a working tile: its first published TCP port
    port: meta.port || firstPublishedPort(compose),
    index: meta.index,
    scheme: meta.scheme,
    hostname: meta.hostname,
    status: containers === null ? "unknown" : running === 0 ? "stopped" : running === own.length ? "running" : "partial",
    store: typeof compose?.["x-hata"]?.store === "string" ? compose["x-hata"].store : "",
    job: job ? { id: job.id, kind: job.kind } : null,
    containers: own.map((c) => ({
      id: c.Id.slice(0, 12),
      ports: [...new Set(c.Ports.filter((p) => p.PublicPort).map((p) => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`))],
      name: (c.Names[0] ?? "").replace(/^\//, ""),
      service: c.Labels[SERVICE_LABEL] ?? "",
      image: c.Image,
      state: c.State,
      status: c.Status,
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
  const compose = readCompose(name);
  let folders: string[] = [];
  if (compose) {
    const copy = structuredClone(compose);
    normalize(copy, settings.dataRoot, name);
    folders = bindSources(copy).filter((f) => !/^\/(dev|proc|sys|run|var\/run|etc)(\/|$)/.test(f));
  }
  return { ...describeApp(name, containers, lang), composeFile: composeFile(name), folders, installedAt: Math.round(statSync(appDir(name)).birthtimeMs) };
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

// --- Store app → form -------------------------------------------------------------------------------

/** A private, normalised copy of a store app's compose file */
function storeCompose(store: string, name: string): Compose {
  const app = storeApp(store, name);
  if (!app) throw new AppError("store.appNotFound", 404);
  const compose = structuredClone(app.compose);
  normalize(compose, settings.dataRoot, name);
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
  form: AppForm & { ports: (AppForm["ports"][number] & { busy: boolean })[] };
}

export async function storeAppDetail(store: string, name: string, lang: string): Promise<StoreAppDetail> {
  const compose = storeCompose(store, name);
  const form = buildForm(compose, lang);
  const ports = await Promise.all(
    form.ports.map(async (p) => ({ ...p, busy: p.published !== "" && !(await portFree(Number(p.published), p.protocol)) })),
  );
  return { ...appMeta(compose, lang), store, name, installed: existsSync(composeFile(name)), form: { ...form, ports } };
}

// --- Operations -------------------------------------------------------------------------------------

const ENV_HEADER = "# Variables for compose.yml. Hata keeps AppID, PUID, PGID and TZ up to date; other lines are yours.";
const OWN_ENV_KEYS = new Set(["AppID", "PUID", "PGID", "TZ"]);

/** The text of an app's `.env`: our variables, then whatever else the file already held */
export function envText(name: string, previous: string, extra: Record<string, string> = {}): string {
  const kept = previous.split("\n").filter((line) => {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    return key ? !OWN_ENV_KEYS.has(key) && !(key in extra) : line.trim() !== "" && line !== ENV_HEADER && !line.startsWith("# Variables for compose.yml.");
  });
  const added = Object.entries(extra).filter(([key]) => !OWN_ENV_KEYS.has(key)).map(([key, value]) => `${key}=${value}`);
  return [ENV_HEADER, `AppID=${name}`, `PUID=${settings.puid}`, `PGID=${settings.pgid}`, `TZ=${timezone()}`, ...kept, ...added, ""].join("\n");
}

export function writeEnv(name: string, extra: Record<string, string> = {}): void {
  const file = join(appDir(name), ".env");
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeTextAtomic(file, envText(name, previous, extra));
}

/** Creates the app's missing bind directories — only inside the data root; devices and sockets are not ours */
function createDataDirs(compose: Compose): void {
  const root = settings.dataRoot === "/" ? "/" : settings.dataRoot + "/";
  for (const source of bindSources(compose)) {
    if (source.startsWith(root) && !existsSync(source)) mkdirSync(source, { recursive: true });
  }
}

async function assertPortsFree(compose: Compose): Promise<void> {
  for (const { port, protocol } of publishedPorts(compose)) {
    if (!(await portFree(port, protocol))) throw new AppError("app.portBusy", 409, { port });
  }
}

async function install(name: string, text: string, compose: Compose, log: Log): Promise<void> {
  const dir = appDir(name);
  mkdirSync(dir, { recursive: true });
  try {
    writeTextAtomic(composeFile(name), text);
    writeEnv(name);
    await dc(name, ["config", "--quiet"], log);
    createDataDirs(compose);
    await dc(name, ["pull"], log);
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  } catch (e) {
    // a failed install leaves nothing behind, so it can simply be tried again
    await runCompose(name, dir, ["down", "--remove-orphans"]).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export async function installFromStore(store: string, name: string, form: unknown, user: string): Promise<Job> {
  assertName(name);
  const compose = storeCompose(store, name);
  if (existsSync(appDir(name))) throw new AppError("app.exists", 409);
  const error = applyForm(compose, form ?? {});
  if (error) throw new AppError(error);
  await assertPortsFree(compose);
  compose["x-hata"] = { store };
  return startJob(name, "install", user, (log) => install(name, dumpCompose(compose), compose, log));
}

/** Installs a compose file pasted by the user; the text is stored exactly as given */
export async function installCustom(name: unknown, text: unknown, user: string): Promise<Job> {
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
        await dc(name, ["pull"], log);
        await dc(name, ["up", "-d", "--remove-orphans"], log);
      });
    default:
      throw new AppError("app.badAction");
  }
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

/** Removes the app; `withData` also deletes its named volumes and `<dataRoot>/AppData/<name>` */
export function removeApp(name: string, withData: boolean, user: string): Job {
  assertInstalled(name);
  return startJob(name, "remove", user, async (log) => {
    await dc(name, ["down", "--remove-orphans", ...(withData ? ["--volumes"] : [])], log);
    rmSync(appDir(name), { recursive: true, force: true });
    parsed.delete(name);
    if (withData) {
      const data = join(settings.dataRoot, "AppData", name);
      log(`Removing ${data}`);
      rmSync(data, { recursive: true, force: true });
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
