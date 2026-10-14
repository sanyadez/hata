/**
 * Apps on the machines Hata looks after. Hata makes the compose file — from a store's form, with the
 * same code as for its own apps (`storeCompose`, `applyForm`, `envText`) — and the machine's client
 * keeps the files and runs `docker compose` (`clientapps.ts`). What an app is on a machine is what it is
 * here: a folder with `compose.yml`, `.env` and `hata.yml`, the tile's data in `x-casaos`, its state the
 * containers of the compose project of the same name.
 *
 * An operation is a job like any app's, kept one at a time per app and machine (`<name>@<machine>`);
 * the activity log names the app and the machine.
 */
import { appMeta, applyForm, bindSources, dumpCompose, normalize, parseCompose, parseEnv, publishedPorts, resolvePorts, type Compose } from "./appform";
import { AppError, assertName, envText, hataFileText, listJobs, startJob, storeAppDetail, storeCompose, type Job, type JobKind, type Log } from "./apps";
import type { MachineContainer } from "./client";
import { call, containersOf, machine, machineDataRoot, open } from "./machines";
import { MuxError } from "./mux";
import { settings } from "./config";
import { storeApp } from "./store";

interface Files {
  name: string;
  compose: string;
  env: string;
  hata: string | null;
  override: string | null;
}

/** Runs before `docker compose` reads a machine's app: the sign-in's override is brought in step (`machinegate.ts`) */
let beforeUp: (id: string, name: string) => Promise<void> = async () => {};
export const beforeMachineUp = (hook: typeof beforeUp): void => void (beforeUp = hook);

const key = (id: string, name: string) => `${name}@${id}`;

/** What the page shows of a machine's app: as `InstalledApp`, without what only this server has */
export interface MachineApp {
  name: string;
  title: string;
  icon: string;
  port: string;
  index: string;
  scheme: string;
  status: "running" | "partial" | "stopped" | "unknown";
  store: string;
  /** Behind Hata's sign-in: the port of this server it opens on */
  guarded: number | null;
  job: { id: string; kind: JobKind } | null;
  containers: { id: string; name: string; service: string; image: string; state: string; status: string; ports: string[] }[];
}

/** The machine's error, worded as Hata's */
const asApp = (e: unknown): never => {
  if (e instanceof MuxError) throw new AppError(e.code, 400, e.detail);
  throw e;
};

function jobOf(id: string, name: string): MachineApp["job"] {
  const job = listJobs().find((j) => j.app === key(id, name) && j.status === "running");
  return job ? { id: job.id, kind: job.kind } : null;
}

function describe(id: string, files: Files, containers: MachineContainer[] | null, lang: string): MachineApp {
  let compose: Compose | null = null;
  try {
    compose = parseCompose(files.compose);
  } catch {
    // a file broken by hand still shows, so that it can be fixed or removed
  }
  const meta = appMeta(compose ?? { name: files.name }, lang);
  let port = meta.port;
  if (!port && compose) {
    const copy = structuredClone(compose);
    resolvePorts(copy, parseEnv(files.env));
    normalize(copy, "/");
    port = String(publishedPorts(copy).find((p) => p.protocol === "tcp")?.port ?? "");
  }
  const own = (containers ?? []).filter((c) => c.project === files.name);
  const running = own.filter((c) => c.state === "running").length;
  let store = "";
  try {
    store = files.hata ? String((Bun.YAML.parse(files.hata) as { store?: unknown } | null)?.store ?? "") : "";
  } catch {}
  return {
    name: files.name,
    title: meta.title || files.name,
    icon: meta.icon,
    port,
    index: meta.index,
    scheme: meta.scheme,
    status: containers === null ? "unknown" : running === 0 ? "stopped" : running === own.length ? "running" : "partial",
    store,
    guarded: (() => {
      const access = settings.access[key(id, files.name)];
      return access?.protect && access.listen ? access.listen : null;
    })(),
    job: jobOf(id, files.name),
    containers: own.map((c) => ({ id: c.id.slice(0, 12), name: c.name, service: c.service, image: c.image, state: c.state, status: c.status, ports: [...new Set(c.ports.filter((p) => p.public).map((p) => `${p.public}:${p.private}/${p.type}`))] })),
  };
}

const filesOf = (id: string) => call<Files[]>(id, "apps.list").catch(asApp);

/** What each machine said last about its apps: tiles of a machine that is away stay where they are */
const lastSeen = new Map<string, MachineApp[]>();

export async function machineApps(id: string, lang: string): Promise<MachineApp[]> {
  const [files, containers] = await Promise.all([filesOf(id), containersOf(id).then((c) => c.containers).catch(() => null)]);
  const apps = files.map((f) => describe(id, f, containers, lang));
  lastSeen.set(id, apps);
  return apps;
}

/** A machine's app on the home page: its tile is `<name>@<machine>` in the layout */
export interface MachineTile extends MachineApp {
  key: string;
  machine: { id: string; name: string; ip: string; online: boolean };
}

/** The apps of every machine, for the home page; a machine that does not answer soon gives what it said last */
export async function machineTiles(list: { id: string; name: string; ip: string; online: boolean }[], lang: string): Promise<MachineTile[]> {
  const each = await Promise.all(
    list.map(async (m) => {
      let apps = lastSeen.get(m.id) ?? [];
      if (m.online) apps = await Promise.race([machineApps(m.id, lang).catch(() => apps), Bun.sleep(3000).then(() => apps)]);
      return apps.map((app) => ({ ...app, ...(m.online ? {} : { status: "unknown" as const }), key: key(m.id, app.name), machine: m }));
    }),
  );
  return each.flat();
}

export async function filesOfMachineApp(id: string, name: string): Promise<Files> {
  return filesOfApp(id, name);
}

async function filesOfApp(id: string, name: string): Promise<Files> {
  assertName(name);
  const found = (await filesOf(id)).find((f) => f.name === name);
  if (!found) throw new AppError("app.notFound", 404);
  return found;
}

/** Runs one compose command on the machine, its output into the job's log */
async function dcOn(id: string, name: string, command: string, log: Log): Promise<void> {
  if (command === "config" || command === "up") await beforeUp(id, name);
  const channel = open(id, "apps.compose", { name, command });
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
      rest += decoder.decode(chunk, { stream: true });
      const lines = rest.split(/\r\n|\n|\r/);
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) log(line);
    }
    if (rest.trim()) log(rest);
    await channel.result;
  } catch (e) {
    // compose's own words are what the log and the activity line should say
    if (e instanceof MuxError && e.code === "machine.composeFailed") throw new Error(String(e.detail.message ?? e.message));
    asApp(e);
  }
}

export const runOnMachine = (id: string, name: string, command: string, log: Log): Promise<void> => dcOn(id, name, command, log);
export const jobOnMachine = (id: string, name: string, kind: JobKind, user: string, work: (log: Log) => Promise<void>): Job => jobOn(id, name, kind, user, work);

function jobOn(id: string, name: string, kind: JobKind, user: string, work: (log: Log) => Promise<void>): Job {
  return startJob(key(id, name), kind, user, work, false, { app: name, machine: machine(id).name });
}

/** The store's form for a machine: its data folder, its ports that are taken, the app there already */
export async function storeAppFor(id: string, store: string, name: string, lang: string) {
  const m = machine(id);
  if (!m.online) throw new AppError("machine.offline", 409, { name: m.name });
  const installed = (await filesOf(id)).some((f) => f.name === name);
  return storeAppDetail(store, name, lang, { dataRoot: machineDataRoot(id), installed, busy: async (ports) => (await call<{ busy: number[] }>(id, "apps.ports", { ports })).busy });
}

async function install(id: string, name: string, compose: Compose, text: string, hata: string | null, log: Log): Promise<void> {
  try {
    await call(id, "apps.write", { name, fresh: true, files: { "compose.yml": text, ".env": envText(name, ""), ...(hata ? { "hata.yml": hata } : {}) } }).catch(asApp);
    await dcOn(id, name, "config", log);
    await call(id, "apps.folders", { paths: bindSources(compose), root: machineDataRoot(id), owner: `${settings.puid}:${settings.pgid}` }).catch(asApp);
    await dcOn(id, name, "pull", log);
    await dcOn(id, name, "up", log);
  } catch (e) {
    // a failed install leaves nothing behind, so it can simply be tried again
    await dcOn(id, name, "down", () => {}).catch(() => {});
    await call(id, "apps.remove", { name }).catch(() => {});
    throw e;
  }
}

async function assertFree(id: string, compose: Compose): Promise<void> {
  const ports = publishedPorts(compose);
  if (!ports.length) return;
  const { busy } = await call<{ busy: number[] }>(id, "apps.ports", { ports }).catch(asApp);
  if (busy.length) throw new AppError("app.portBusy", 409, { port: busy[0]! });
}

export async function installOnMachine(id: string, store: string, name: string, form: unknown, user: string): Promise<Job> {
  assertName(name);
  const m = machine(id);
  if (!m.online) throw new AppError("machine.offline", 409, { name: m.name });
  if (!m.info?.docker.available) throw new AppError("machine.noDocker", 409, { name: m.name });
  if ((await filesOf(id)).some((f) => f.name === name)) throw new AppError("app.exists", 409);
  const compose = storeCompose(store, name, machineDataRoot(id));
  const error = applyForm(compose, form ?? {});
  if (error) throw new AppError(error);
  await assertFree(id, compose);
  const base = structuredClone(storeApp(store, name)!.compose);
  return jobOn(id, name, "install", user, (log) => install(id, name, compose, dumpCompose(compose), hataFileText(store, base), log));
}

/** A compose file pasted by hand, kept exactly as given */
export async function installComposeOnMachine(id: string, name: unknown, text: unknown, user: string): Promise<Job> {
  if (typeof text !== "string" || text.length > 512 * 1024) throw new AppError("app.badCompose");
  let compose: Compose;
  try {
    compose = parseCompose(text);
  } catch (e) {
    throw new AppError("app.badCompose", 400, { message: e instanceof Error ? e.message : String(e) });
  }
  const appName = typeof name === "string" && name ? name : typeof compose.name === "string" ? compose.name : "";
  assertName(appName);
  if ((await filesOf(id)).some((f) => f.name === appName)) throw new AppError("app.exists", 409);
  normalize(compose, machineDataRoot(id));
  await assertFree(id, compose);
  return jobOn(id, appName, "install", user, (log) => install(id, appName, compose, text, null, log));
}

export async function machineAppAction(id: string, name: string, action: string, user: string): Promise<Job> {
  const files = await filesOfApp(id, name);
  const env = () => call(id, "apps.write", { name, files: { ".env": envText(name, files.env) } }).catch(asApp);
  switch (action) {
    case "start":
      return jobOn(id, name, "start", user, async (log) => {
        await env();
        await dcOn(id, name, "up", log);
      });
    case "stop":
      return jobOn(id, name, "stop", user, (log) => dcOn(id, name, "stop", log));
    case "restart":
      return jobOn(id, name, "restart", user, (log) => dcOn(id, name, "restart", log));
    case "update":
      return jobOn(id, name, "update", user, async (log) => {
        await env();
        await dcOn(id, name, "pull", log);
        await dcOn(id, name, "up", log);
      });
    default:
      throw new AppError("app.badAction");
  }
}

export async function machineCompose(id: string, name: string): Promise<{ text: string; file: string }> {
  const files = await filesOfApp(id, name);
  return { text: files.compose, file: `/var/lib/hata-client/apps/${name}/compose.yml` };
}

/** A changed compose file: checked by compose itself on the machine and applied; a bad one is put back */
export async function applyMachineCompose(id: string, name: string, text: unknown, user: string): Promise<Job> {
  const files = await filesOfApp(id, name);
  if (typeof text !== "string" || text.length > 512 * 1024) throw new AppError("app.badCompose");
  let compose: Compose;
  try {
    compose = parseCompose(text);
  } catch (e) {
    throw new AppError("app.badCompose", 400, { message: e instanceof Error ? e.message : String(e) });
  }
  return jobOn(id, name, "apply", user, async (log) => {
    await call(id, "apps.write", { name, files: { "compose.yml": text } }).catch(asApp);
    try {
      await dcOn(id, name, "config", log);
    } catch (e) {
      await call(id, "apps.write", { name, files: { "compose.yml": files.compose } }).catch(() => {});
      throw e;
    }
    normalize(compose, machineDataRoot(id));
    await call(id, "apps.folders", { paths: bindSources(compose), root: machineDataRoot(id), owner: `${settings.puid}:${settings.pgid}` }).catch(asApp);
    await dcOn(id, name, "up", log);
  });
}

/** Called when an app of a machine is gone (removed, moved away) */
let goneHook: (id: string, name: string) => void = () => {};
export const onMachineAppGone = (hook: typeof goneHook): void => void (goneHook = hook);
export const machineAppGone = (id: string, name: string): void => goneHook(id, name);

export async function removeMachineApp(id: string, name: string, withData: boolean, user: string): Promise<Job> {
  await filesOfApp(id, name);
  return jobOn(id, name, "remove", user, async (log) => {
    goneHook(id, name);
    await dcOn(id, name, withData ? "downVolumes" : "down", log);
    const data = `${machineDataRoot(id).replace(/\/+$/, "")}/AppData/${name}`;
    if (withData) log(`Removing ${data}`);
    await call(id, "apps.remove", { name, ...(withData ? { data, root: machineDataRoot(id) } : {}) }).catch(asApp);
  });
}

export function machineAppLogs(id: string, name: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  assertName(name);
  const channel = open(id, "apps.logs", { name, tail: 200 });
  signal.addEventListener("abort", () => channel.cancel(), { once: true });
  return channel.readable();
}
