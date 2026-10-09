/**
 * Docker access.
 *
 * - State, events and anything read-only goes to the Engine API over the unix socket.
 * - Everything that changes a compose project goes through the `docker compose` CLI plugin: it is the
 *   reference implementation of the compose format, so an app behaves here exactly as it does by hand.
 *
 * The socket is never exposed to the browser: only the specific calls below exist.
 */
import { bus } from "./bus";

export const DOCKER_SOCK = process.env.HATA_DOCKER_SOCK ?? "/var/run/docker.sock";

export class DockerError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`http://docker${path}`, { ...init, unix: DOCKER_SOCK } as RequestInit);
  } catch (e) {
    throw new DockerError(`Docker is not reachable at ${DOCKER_SOCK}: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      message = JSON.parse(body).message ?? body;
    } catch {}
    throw new DockerError(message || `Docker answered ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export interface DockerInfo {
  available: boolean;
  version?: string;
  compose?: string;
  error?: string;
}

let composeVersion: string | undefined;

export async function dockerInfo(): Promise<DockerInfo> {
  try {
    const v = await api<{ Version: string }>("/version");
    if (composeVersion === undefined) {
      const r = await run(["docker", "compose", "version", "--short"]).catch(() => null);
      composeVersion = r && r.code === 0 ? r.output.trim() : "";
    }
    if (!composeVersion) return { available: false, version: v.Version, error: "The `docker compose` plugin is not installed" };
    return { available: true, version: v.Version, compose: composeVersion };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
  Ports: { IP?: string; PrivatePort: number; PublicPort?: number; Type: string }[];
}

export const PROJECT_LABEL = "com.docker.compose.project";
export const SERVICE_LABEL = "com.docker.compose.service";

export function listContainers(): Promise<ContainerSummary[]> {
  return api<ContainerSummary[]>("/containers/json?all=1");
}

export interface ContainerStats {
  /** Share of one core, percent: 250 means two and a half cores busy */
  cpu: number;
  memory: number;
  memoryLimit: number;
}

interface RawStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number; total_inactive_file?: number } };
}

/** CPU and memory out of a Docker stats sample, the way `docker stats` computes them */
export function parseStats(raw: RawStats): ContainerStats {
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (raw.cpu_stats.system_cpu_usage ?? 0) - (raw.precpu_stats.system_cpu_usage ?? 0);
  const cpu = cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * (raw.cpu_stats.online_cpus ?? 1) * 100 : 0;
  // page cache that can be dropped is not memory the container needs
  const cache = raw.memory_stats.stats?.inactive_file ?? raw.memory_stats.stats?.total_inactive_file ?? 0;
  return { cpu: Math.round(cpu * 10) / 10, memory: Math.max(0, (raw.memory_stats.usage ?? 0) - cache), memoryLimit: raw.memory_stats.limit ?? 0 };
}

/** One stats sample of a running container; Docker takes about a second to produce it */
export async function containerStats(id: string): Promise<ContainerStats | null> {
  try {
    return parseStats(await api<RawStats>(`/containers/${id}/stats?stream=false`));
  } catch {
    return null;
  }
}

/**
 * Follows Docker's container events and announces `apps` on the bus (debounced: one `up` produces
 * a burst of events). Reconnects forever: Docker may be restarted or installed later.
 */
export async function watchEvents(): Promise<never> {
  let timer: Timer | null = null;
  const announce = () => {
    timer ??= setTimeout(() => {
      timer = null;
      bus.publish("apps");
    }, 300);
  };
  const filters = encodeURIComponent(JSON.stringify({ type: ["container"] }));
  for (;;) {
    try {
      const res = await fetch(`http://docker/events?filters=${filters}`, { unix: DOCKER_SOCK } as RequestInit);
      if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
      announce();
      for await (const _ of res.body) announce();
    } catch {
      // not reachable right now — try again below
    }
    await Bun.sleep(5000);
  }
}

// --- CLI --------------------------------------------------------------------------------------------

export interface RunResult {
  code: number;
  output: string;
}

async function pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    rest += decoder.decode(chunk, { stream: true });
    // progress output redraws a line with \r — each redraw is a line of its own for us
    const lines = rest.split(/\r\n|\n|\r/);
    rest = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onLine(line);
  }
  if (rest.trim()) onLine(rest);
}

/** Runs a command, calling `onLine` for every line of stdout and stderr */
export async function run(cmd: string[], opts: { cwd?: string; onLine?: (line: string) => void; stdin?: string } = {}): Promise<RunResult> {
  const lines: string[] = [];
  const onLine = (line: string) => {
    lines.push(line);
    opts.onLine?.(line);
  };
  let proc;
  try {
    proc = Bun.spawn({
      cmd,
      cwd: opts.cwd,
      stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
  } catch (e) {
    return { code: 127, output: e instanceof Error ? e.message : String(e) };
  }
  await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine)]);
  return { code: await proc.exited, output: lines.join("\n") };
}

/** The `docker compose` command line for a project directory holding `compose.yml` */
export function composeCmd(project: string, dir: string, args: string[]): string[] {
  return ["docker", "compose", "--ansi", "never", "--progress", "plain", "-p", project, "--project-directory", dir, "-f", `${dir}/compose.yml`, ...args];
}

export function compose(project: string, dir: string, args: string[], onLine?: (line: string) => void): Promise<RunResult> {
  return run(composeCmd(project, dir, args), { cwd: dir, onLine });
}
