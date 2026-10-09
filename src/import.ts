/**
 * Bringing in what already runs on the machine but is not an app of Hata yet.
 *
 * - A compose project started elsewhere (by hand, by another dashboard) is taken over the way a CasaOS app
 *   is: its compose file is copied into Hata's apps directory under the same project name, and Docker then
 *   treats Hata's `docker compose` as the owner of the very same containers. Nothing is recreated.
 * - A container that has no compose file (`docker run`, CasaOS's "legacy" apps) is rebuilt: a compose file
 *   is written from what `docker inspect` says, the old container is stopped and parked under another
 *   name, and the app is started from the file — on the same volumes and folders. If that fails, the old
 *   container is put back; if it works, the old one is removed.
 *
 * Writing the compose file is pure and sits at the top; the rest talks to Docker.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { APP_NAME_RE, dumpCompose, parseCompose, type Compose } from "./appform";
import { AppError, APPS_DIR, appDir, dc, envText, installedNames, startJob, writeEnv, type Job } from "./apps";
import { bus } from "./bus";
import {
  compose as runCompose,
  imageConfig,
  inspectContainer,
  listContainers,
  PROJECT_LABEL,
  removeContainer,
  renameContainer,
  SERVICE_LABEL,
  startContainer,
  stopContainer,
  type ContainerInspect,
  type ContainerSummary,
} from "./docker";
import { writeTextAtomic } from "./fsutil";
import { casaosAppsPath, casaosUnits, moveCasaos, parseEnvFile, planCasaos, type MoveResult, type PlannedApp } from "./migrate";

// --- A compose file out of running containers (pure) ------------------------------------------------

type ImageConfig = ContainerInspect["Config"] | null;

/** Something of the container that a compose file cannot carry; the UI explains `import.warn.<code>` */
export type ImportWarning = "links" | "volumesFrom" | "sharedNetwork";

const FILES_LABEL = "com.docker.compose.project.config_files";
const WORKDIR_LABEL = "com.docker.compose.project.working_dir";
const DEFAULT_SHM = 64 * 1024 * 1024;

/** In a compose file `$` starts a variable; a literal one is written `$$` */
const lit = (text: string): string => text.replace(/\$/g, "$$$$");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const filled = (list: unknown): list is unknown[] => Array.isArray(list) && list.length > 0;

/** Nanoseconds, as Docker stores durations, in compose's notation */
const span = (ns: number): string => (ns % 1e9 === 0 ? `${ns / 1e9}s` : `${Math.round(ns / 1e6)}ms`);

/** A name that can be a compose project, a directory and a part of a URL */
export function safeName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "").slice(0, 63);
  return cleaned || "app";
}

/** `name`, or `name-2`, `name-3`… — the first that is not taken */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, 60)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function ports(bindings: Record<string, { HostIp?: string; HostPort?: string }[] | null>): string[] {
  const out = new Set<string>();
  for (const [key, list] of Object.entries(bindings)) {
    const [target, protocol = "tcp"] = key.split("/");
    for (const { HostIp: ip = "", HostPort: port = "" } of list ?? []) {
      const host = !ip || ip === "0.0.0.0" || ip === "::" ? "" : ip.includes(":") ? `[${ip}]:` : `${ip}:`;
      // an address needs the port's place kept even when Docker picks the port
      out.add(`${host}${port || host ? port + ":" : ""}${target}${protocol === "tcp" ? "" : "/" + protocol}`);
    }
  }
  return [...out];
}

function healthcheck(check: NonNullable<ContainerInspect["Config"]["Healthcheck"]>): Compose | null {
  if (!filled(check.Test)) return null;
  if (check.Test[0] === "NONE") return { disable: true };
  const out: Compose = { test: check.Test.map((part) => lit(String(part))) };
  if (check.Interval) out.interval = span(check.Interval);
  if (check.Timeout) out.timeout = span(check.Timeout);
  if (check.StartPeriod) out.start_period = span(check.StartPeriod);
  if (check.Retries) out.retries = check.Retries;
  return out;
}

export interface ServiceDraft {
  service: Compose;
  /** Volumes and networks the service uses — they exist already and are declared `external` */
  volumes: string[];
  networks: string[];
  warnings: ImportWarning[];
}

/**
 * One container as a compose service. `image` is the configuration of the container's image: what the
 * container merely inherited from it (PATH, the default command, labels) is left out of the file, so a
 * newer image can still change it.
 */
export function serviceFromContainer(c: ContainerInspect, image: ImageConfig): ServiceDraft {
  const cfg = c.Config;
  const host = c.HostConfig;
  const labels = cfg.Labels ?? {};
  const name = c.Name.replace(/^\//, "");
  const project = labels[PROJECT_LABEL];
  const service: Compose = { image: cfg.Image };
  const draft: ServiceDraft = { service, volumes: [], networks: [], warnings: [] };

  // compose names its containers itself; a name of that shape was not chosen by anyone
  const generated = project !== undefined && new RegExp(`^${project}[-_].+[-_]\\d+$`).test(name);
  if (!generated) service.container_name = name;

  const restart = host.RestartPolicy?.Name;
  if (restart && restart !== "no") service.restart = restart === "on-failure" && host.RestartPolicy.MaximumRetryCount > 0 ? `on-failure:${host.RestartPolicy.MaximumRetryCount}` : restart;

  if (!same(cfg.Entrypoint, image?.Entrypoint) && filled(cfg.Entrypoint)) service.entrypoint = cfg.Entrypoint.map(lit);
  if (!same(cfg.Cmd, image?.Cmd) && filled(cfg.Cmd)) service.command = cfg.Cmd.map(lit);
  if (cfg.User && cfg.User !== (image?.User ?? "")) service.user = cfg.User;
  if (cfg.WorkingDir && cfg.WorkingDir !== (image?.WorkingDir ?? "")) service.working_dir = cfg.WorkingDir;

  const inherited = new Set(image?.Env ?? []);
  const environment: Record<string, string> = {};
  for (const entry of cfg.Env ?? []) {
    if (inherited.has(entry)) continue;
    const eq = entry.indexOf("=");
    environment[eq < 0 ? entry : entry.slice(0, eq)] = eq < 0 ? "" : lit(entry.slice(eq + 1));
  }
  if (Object.keys(environment).length) service.environment = environment;

  const published = ports(host.PortBindings ?? {});
  if (published.length) service.ports = published;

  const volumes: string[] = [];
  const tmpfs: string[] = Object.entries((host.Tmpfs ?? {}) as Record<string, string>).map(([path, options]) => (options ? `${path}:${options}` : path));
  for (const mount of c.Mounts ?? []) {
    const mode = mount.RW ? "" : ":ro";
    if (mount.Type === "bind") volumes.push(`${lit(mount.Source)}:${lit(mount.Destination)}${mode}`);
    else if (mount.Type === "volume" && mount.Name) {
      volumes.push(`${mount.Name}:${lit(mount.Destination)}${mode}`);
      draft.volumes.push(mount.Name);
    } else if (mount.Type === "tmpfs" && !(mount.Destination in (host.Tmpfs ?? {}))) tmpfs.push(mount.Destination);
  }
  if (volumes.length) service.volumes = volumes;
  if (tmpfs.length) service.tmpfs = tmpfs;

  const mode: string = host.NetworkMode ?? "";
  const attached = Object.entries(c.NetworkSettings?.Networks ?? {}).filter(([network]) => !["bridge", "host", "none"].includes(network));
  if (mode === "host" || mode === "none") service.network_mode = mode;
  else if (mode.startsWith("container:")) draft.warnings.push("sharedNetwork");
  else if (!attached.length) {
    // where `docker run` puts a container; a compose file would otherwise give the app a network of its own
    service.network_mode = "bridge";
  } else {
    const own = new Set([name, c.Id.slice(0, 12), labels[SERVICE_LABEL] ?? ""]);
    const networks: Record<string, Compose> = {};
    for (const [network, settings] of attached) {
      const entry: Compose = {};
      const aliases = (settings.Aliases ?? []).filter((alias) => !own.has(alias));
      if (aliases.length) entry.aliases = aliases;
      if (settings.IPAMConfig?.IPv4Address) entry.ipv4_address = settings.IPAMConfig.IPv4Address;
      networks[network] = entry;
      draft.networks.push(network);
    }
    service.networks = Object.values(networks).some((entry) => Object.keys(entry).length) ? networks : Object.keys(networks);
  }
  // Docker's default host name is the container's id, which the new container will not share
  if (cfg.Hostname && !c.Id.startsWith(cfg.Hostname) && mode !== "host") service.hostname = cfg.Hostname;
  if (cfg.Domainname) service.domainname = cfg.Domainname;

  const inheritedLabels = image?.Labels ?? {};
  const own = Object.entries(labels).filter(([key, value]) => !key.startsWith("com.docker.compose.") && inheritedLabels[key] !== value);
  if (own.length) service.labels = Object.fromEntries(own.map(([key, value]) => [key, lit(value)]));

  if (host.Privileged) service.privileged = true;
  if (filled(host.CapAdd)) service.cap_add = host.CapAdd;
  if (filled(host.CapDrop)) service.cap_drop = host.CapDrop;
  if (filled(host.Devices)) {
    service.devices = host.Devices.map((d: Compose) => `${d.PathOnHost}:${d.PathInContainer}${d.CgroupPermissions && d.CgroupPermissions !== "rwm" ? ":" + d.CgroupPermissions : ""}`);
  }
  if (filled(host.DeviceRequests)) {
    const devices = host.DeviceRequests.map((d: Compose) => ({
      ...(d.Driver ? { driver: d.Driver } : {}),
      ...(filled(d.DeviceIDs) ? { device_ids: d.DeviceIDs } : { count: d.Count === -1 ? "all" : d.Count }),
      capabilities: filled(d.Capabilities) ? d.Capabilities.flat() : ["gpu"],
    }));
    service.deploy = { resources: { reservations: { devices } } };
  }
  if (filled(host.GroupAdd)) service.group_add = host.GroupAdd;
  if (filled(host.ExtraHosts)) service.extra_hosts = host.ExtraHosts;
  if (filled(host.Dns)) service.dns = host.Dns;
  if (filled(host.DnsSearch)) service.dns_search = host.DnsSearch;
  if (filled(host.SecurityOpt)) service.security_opt = host.SecurityOpt;
  if (host.Sysctls && Object.keys(host.Sysctls).length) service.sysctls = host.Sysctls;
  if (filled(host.Ulimits)) service.ulimits = Object.fromEntries(host.Ulimits.map((u: Compose) => [u.Name, u.Soft === u.Hard ? u.Soft : { soft: u.Soft, hard: u.Hard }]));
  if (host.PidMode === "host") service.pid = "host";
  if (host.IpcMode === "host") service.ipc = "host";
  if (host.UTSMode === "host") service.uts = "host";
  if (host.ShmSize && host.ShmSize !== DEFAULT_SHM) service.shm_size = host.ShmSize;
  if (host.Memory > 0) service.mem_limit = host.Memory;
  if (host.NanoCpus > 0) service.cpus = host.NanoCpus / 1e9;
  if (host.CpuShares > 0) service.cpu_shares = host.CpuShares;
  if (host.Runtime && host.Runtime !== "runc") service.runtime = host.Runtime;
  if (host.Init) service.init = true;
  if (host.ReadonlyRootfs) service.read_only = true;
  if (cfg.Tty) service.tty = true;
  if (cfg.OpenStdin) service.stdin_open = true;
  if (cfg.StopSignal && cfg.StopSignal !== (image?.StopSignal ?? "")) service.stop_signal = cfg.StopSignal;
  if (cfg.StopTimeout) service.stop_grace_period = `${cfg.StopTimeout}s`;
  if (cfg.Healthcheck && !same(cfg.Healthcheck, image?.Healthcheck)) {
    const check = healthcheck(cfg.Healthcheck);
    if (check) service.healthcheck = check;
  }

  if (filled(host.Links)) draft.warnings.push("links");
  if (filled(host.VolumesFrom)) draft.warnings.push("volumesFrom");
  return draft;
}

/** What CasaOS wrote on the containers of its old, pre-compose apps: enough for a proper tile */
function legacyTile(labels: Record<string, string>, service: string): Compose | null {
  if (labels.casaos === undefined && labels.origin === undefined) return null;
  const x: Compose = { main: service };
  if (labels.name) x.title = { en_us: labels.name };
  if (/^https?:\/\//i.test(labels.icon ?? "")) x.icon = labels.icon;
  if (/^\d+$/.test(labels.web ?? "")) x.port_map = labels.web;
  if (labels.index) x.index = labels.index;
  if (labels.protocol === "https") x.scheme = "https";
  return Object.keys(x).length > 1 ? x : null;
}

/**
 * The compose file of an app made of these containers: one service each. Volumes and networks are
 * declared `external` — the new containers get the data of the old ones, and removing the app with
 * `down --volumes` cannot delete it.
 */
export function composeFromContainers(name: string, containers: { inspect: ContainerInspect; image: ImageConfig }[]): { compose: Compose; warnings: ImportWarning[] } {
  const services: Record<string, Compose> = {};
  const volumes = new Set<string>();
  const networks = new Set<string>();
  const warnings = new Set<ImportWarning>();
  let tile: Compose | null = null;
  for (const { inspect, image } of containers) {
    const labels = inspect.Config.Labels ?? {};
    const key = freeName(labels[SERVICE_LABEL] ?? safeName(inspect.Name.replace(/^\//, "")), Object.keys(services));
    const draft = serviceFromContainer(inspect, image);
    services[key] = draft.service;
    for (const volume of draft.volumes) volumes.add(volume);
    for (const network of draft.networks) networks.add(network);
    for (const warning of draft.warnings) warnings.add(warning);
    tile ??= legacyTile(labels, key);
  }
  const compose: Compose = { name, services };
  if (volumes.size) compose.volumes = Object.fromEntries([...volumes].map((volume) => [volume, { external: true }]));
  if (networks.size) compose.networks = Object.fromEntries([...networks].map((network) => [network, { external: true }]));
  if (tile) compose["x-casaos"] = tile;
  return { compose, warnings: [...warnings] };
}

export interface ForeignProject {
  name: string;
  containers: ContainerSummary[];
  /** The compose files the project was started from, as Docker remembers them */
  files: string[];
  workingDir: string;
}

/** Containers that no app of Hata owns: compose projects started elsewhere, and containers on their own */
export function foreign(containers: ContainerSummary[], installed: Iterable<string>): { projects: ForeignProject[]; single: ContainerSummary[] } {
  const ours = new Set(installed);
  const projects = new Map<string, ForeignProject>();
  const single: ContainerSummary[] = [];
  for (const c of containers) {
    const project = c.Labels[PROJECT_LABEL];
    if (project === undefined) single.push(c);
    else if (!ours.has(project)) {
      const entry = projects.get(project) ?? { name: project, containers: [], files: (c.Labels[FILES_LABEL] ?? "").split(",").filter(Boolean), workingDir: c.Labels[WORKDIR_LABEL] ?? "" };
      entry.containers.push(c);
      projects.set(project, entry);
    }
  }
  return { projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)), single };
}

// --- What is there ----------------------------------------------------------------------------------

const title = (c: { Names: string[] }) => (c.Names[0] ?? "").replace(/^\//, "");

async function draftOf(ids: string[]): Promise<{ inspect: ContainerInspect; image: ImageConfig }[]> {
  return Promise.all(
    ids.map(async (id) => {
      const inspect = await inspectContainer(id).catch(() => {
        throw new AppError("import.notFound", 404);
      });
      return { inspect, image: await imageConfig(inspect.Image) };
    }),
  );
}

export type ImportProblem = "badName" | "exists" | "autoRemove";

export interface ImportList {
  /** `files` — the project's compose files that are still on disk */
  projects: { name: string; containers: number; running: number; images: string[]; files: string[]; problem: ImportProblem | null }[];
  containers: { id: string; name: string; image: string; state: string; status: string; problem: ImportProblem | null }[];
}

/** Projects that CasaOS still holds are its own section of the page: moved together, with CasaOS stopped */
function underCasaos(project: ForeignProject): boolean {
  const root = casaosAppsPath() + "/";
  return project.files.some((file) => file.startsWith(root));
}

export async function importList(): Promise<ImportList> {
  const containers = await listContainers().catch(() => []);
  const { projects, single } = foreign(containers, installedNames());
  const inspected = await Promise.all(single.map((c) => inspectContainer(c.Id).catch(() => null)));
  return {
    projects: projects
      .filter((p) => !underCasaos(p))
      .map((p) => ({
        name: p.name,
        containers: p.containers.length,
        running: p.containers.filter((c) => c.State === "running").length,
        images: [...new Set(p.containers.map((c) => c.Image))],
        files: p.files.filter((file) => existsSync(file)),
        problem: !APP_NAME_RE.test(p.name) ? "badName" : existsSync(appDir(p.name)) ? "exists" : null,
      })),
    containers: single.map((c, i) => ({
      id: c.Id.slice(0, 12),
      name: title(c),
      image: c.Image,
      state: c.State,
      status: c.Status,
      // a container started with --rm disappears when stopped: there is nothing to keep
      problem: inspected[i]?.HostConfig.AutoRemove ? "autoRemove" : null,
    })),
  };
}

/** How many things the import page would offer — for the hint on the home page */
export function importCount(containers: ContainerSummary[]): number {
  const { projects, single } = foreign(containers, installedNames());
  return projects.length + single.length;
}

// --- A compose project started elsewhere ------------------------------------------------------------

export interface ProjectDraft {
  compose: string;
  /**
   * Where the text comes from: the project's own file as it is; that file written out by compose with
   * paths and variables resolved (it relied on where it lay); or the running containers (no file found)
   */
  source: "file" | "resolved" | "containers";
  /** Variables of the project's own `.env`, kept for the copied file */
  env: Record<string, string>;
  warnings: ImportWarning[];
}

async function findProject(name: string): Promise<ForeignProject> {
  const project = foreign(await listContainers(), installedNames()).projects.find((p) => p.name === name);
  if (!project) throw new AppError("import.notFound", 404);
  return project;
}

/** `docker compose config` for files that are not an app of ours; null when compose rejects them */
async function resolved(name: string, dir: string, files: string[]): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: ["docker", "compose", "-p", name, "--project-directory", dir, ...files.flatMap((file) => ["-f", file]), "config"],
    cwd: existsSync(dir) ? dir : undefined,
    stdin: "ignore",
    stdout: "pipe",
    // warnings go there; the file is what stdout holds
    stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? text : null;
}

export async function projectDraft(name: string): Promise<ProjectDraft> {
  const project = await findProject(name);
  const dir = project.workingDir;
  if (project.files.length && project.files.every((file) => existsSync(file))) {
    const full = await resolved(name, dir, project.files);
    if (full !== null) {
      const envFile = join(dir, ".env");
      const env = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, "utf8")) : {};
      if (project.files.length === 1) {
        // The file is kept as written — comments and all — when it means the same in our directory with
        // our `.env`; a file with relative paths, or one that reads PUID or TZ differently, does not.
        const text = readFileSync(project.files[0]!, "utf8");
        const probe = join(APPS_DIR, `.probe-${crypto.randomUUID()}`);
        mkdirSync(probe);
        try {
          writeTextAtomic(join(probe, "compose.yml"), text);
          writeTextAtomic(join(probe, ".env"), envText(name, "", env));
          if ((await resolved(name, probe, [join(probe, "compose.yml")])) === full) return { compose: text, source: "file", env, warnings: [] };
        } finally {
          rmSync(probe, { recursive: true, force: true });
        }
      }
      return { compose: full, source: "resolved", env: {}, warnings: [] };
    }
  }
  const { compose, warnings } = composeFromContainers(name, await draftOf(project.containers.map((c) => c.Id)));
  return { compose: dumpCompose(compose), source: "containers", env: {}, warnings };
}

/** Takes a compose project over: its file becomes an app; the containers are not touched */
export async function adoptProject(name: string, user: string): Promise<void> {
  if (!APP_NAME_RE.test(name)) throw new AppError("app.badName");
  if (existsSync(appDir(name))) throw new AppError("app.exists", 409);
  const draft = await projectDraft(name);
  const dir = appDir(name);
  mkdirSync(dir, { recursive: true });
  writeTextAtomic(join(dir, "compose.yml"), draft.compose);
  writeEnv(name, draft.env);
  const check = await runCompose(name, dir, ["config", "--quiet"]);
  if (check.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new AppError("app.badCompose", 400, { message: check.output.split("\n").slice(-3).join("\n") });
  }
  record("app.import.done", { app: name, user });
  bus.publish("apps");
}

// --- A container without a compose file -------------------------------------------------------------

export interface ContainerDraft {
  /** A free app name made of the container's */
  name: string;
  container: string;
  compose: string;
  warnings: ImportWarning[];
}

async function findContainer(id: string): Promise<ContainerInspect> {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new AppError("import.notFound", 404);
  const [{ inspect }] = (await draftOf([id])) as [{ inspect: ContainerInspect }];
  if ((inspect.Config.Labels ?? {})[PROJECT_LABEL] !== undefined) throw new AppError("import.notFound", 404);
  if (inspect.HostConfig.AutoRemove) throw new AppError("import.autoRemove", 409);
  return inspect;
}

export async function containerDraft(id: string): Promise<ContainerDraft> {
  const inspect = await findContainer(id);
  const container = inspect.Name.replace(/^\//, "");
  const name = freeName(safeName(container), installedNames());
  const { compose, warnings } = composeFromContainers(name, [{ inspect, image: await imageConfig(inspect.Image) }]);
  return { name, container, compose: dumpCompose(compose), warnings };
}

/** The old container waits under this name until the app that replaces it is up */
const parkedName = (name: string) => `${name}-before-hata`;

/** Rebuilds a container into an app from the given compose file (the draft, possibly edited) */
export async function rebuildContainer(id: string, name: unknown, text: unknown, user: string): Promise<Job> {
  if (typeof name !== "string" || !APP_NAME_RE.test(name)) throw new AppError("app.badName");
  if (typeof text !== "string" || text.length > 512 * 1024) throw new AppError("app.badCompose");
  try {
    parseCompose(text);
  } catch (e) {
    throw new AppError("app.badCompose", 400, { message: e instanceof Error ? e.message : String(e) });
  }
  if (existsSync(appDir(name))) throw new AppError("app.exists", 409);
  const old = await findContainer(id);
  const oldName = old.Name.replace(/^\//, "");
  const dir = appDir(name);

  return startJob(name, "import", user, async (log) => {
    mkdirSync(dir, { recursive: true });
    let stopped = false;
    let parked = false;
    try {
      writeTextAtomic(join(dir, "compose.yml"), text);
      writeEnv(name);
      await dc(name, ["config", "--quiet"], log);
      if (old.State.Running) {
        log(`Stopping container ${oldName}`);
        await stopContainer(old.Id);
        stopped = true;
      }
      // its name and its ports are needed by the container that replaces it
      await renameContainer(old.Id, parkedName(oldName));
      parked = true;
      // a container that was not running is rebuilt, not started
      await dc(name, old.State.Running ? ["up", "-d"] : ["create"], log);
    } catch (e) {
      await runCompose(name, dir, ["down", "--remove-orphans"]).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      if (parked) {
        log(`Putting container ${oldName} back`);
        await renameContainer(old.Id, oldName).catch((err) => log(String(err)));
      }
      if (stopped) await startContainer(old.Id).catch((err) => log(String(err)));
      throw e;
    }
    log(`Removing the old container (${parkedName(oldName)}); its volumes stay`);
    await removeContainer(old.Id).catch((err) => log(String(err)));
  });
}

// --- CasaOS on this machine -------------------------------------------------------------------------

export interface CasaosState {
  appsPath: string;
  /** Its apps that Hata does not have yet */
  apps: PlannedApp[];
  /** Its services that are running or start at boot */
  units: string[];
}

/** What is left of a CasaOS install to take over; null when there is none or nothing is left */
export function casaosState(): CasaosState | null {
  const appsPath = casaosAppsPath();
  if (!existsSync(appsPath)) return null;
  const apps = planCasaos(appsPath, APPS_DIR).filter((app) => app.status !== "exists");
  const units = casaosUnits();
  return apps.some((app) => app.status === "ready") || units.length ? { appsPath, apps, units } : null;
}

/** The same move as `hata migrate casaos`, from the web UI */
export async function moveInCasaos(stop: boolean, user: string): Promise<MoveResult> {
  const state = casaosState();
  if (!state) throw new AppError("import.notFound", 404);
  const result = await moveCasaos(state.apps, stop ? state.units : []);
  for (const app of result.moved) record("app.import.done", { app, user });
  bus.publish("apps");
  return result;
}
