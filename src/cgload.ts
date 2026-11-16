/**
 * What takes the processor, the memory, the disk and the network, thing by thing: read from the kernel's
 * control groups (cgroup v2), where every Docker container, every Incus instance, every systemd service and
 * Hata itself has a group of its own. One walk of /sys/fs/cgroup every few seconds costs next to nothing —
 * unlike `docker stats`, which keeps the engine busy.
 *
 * No side effects at import: the client of a machine runs it too. The parsing and the arithmetic are pure.
 */
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

/** What a row of the load is */
export type LoadKind = "hata" | "app" | "container" | "instance" | "engine" | "service" | "sessions" | "system" | "machine" | "rest" | "guest";

/** One thing and what it takes now: the processor as a share of the whole machine, the rest per second */
export interface LoadRow {
  /** Stable while the thing lives: `app:<project>`, `docker:<id>`, `svc:<unit>`, `incus:<name>`, `hata`, … */
  key: string;
  kind: LoadKind;
  /** The project, unit, instance or container name; the page words it */
  name: string;
  /** Percent of the whole machine (100 = every core busy) */
  cpu: number;
  /** Bytes in use, the page cache that could be dropped left out */
  memory: number;
  /** Bytes per second read from and written to disks */
  read: number;
  write: number;
  /** Bytes per second through its own network; null when it shares the host's (then it is in the host's line) */
  rx: number | null;
  tx: number | null;
  /** The Docker containers of an app */
  parts?: LoadRow[];
}

/** The counters of one group, as the kernel keeps them (they only grow) */
export interface GroupCounters {
  /** The group's path under the cgroup root */
  path: string;
  cpu: number;
  memory: number;
  read: number;
  write: number;
  rx: number | null;
  tx: number | null;
}

/** `usage_usec` of cpu.stat */
export function parseCpuStat(text: string): number | null {
  const m = /^usage_usec (\d+)$/m.exec(text);
  return m ? Number(m[1]) : null;
}

/** memory.current minus what the kernel can drop at once — the way `docker stats` and `free` count */
export function memoryInUse(current: string, stat: string): number {
  const total = Number(current.trim());
  if (!Number.isFinite(total)) return 0;
  const inactive = Number(/^inactive_file (\d+)$/m.exec(stat)?.[1] ?? 0);
  return Math.max(0, total - inactive);
}

/** io.stat: bytes read and written, summed over the devices */
export function parseIoStat(text: string): { read: number; write: number } {
  let read = 0;
  let write = 0;
  for (const line of text.split("\n")) {
    read += Number(/\brbytes=(\d+)/.exec(line)?.[1] ?? 0);
    write += Number(/\bwbytes=(\d+)/.exec(line)?.[1] ?? 0);
  }
  return { read, write };
}

/** /proc/<pid>/net/dev of a network of its own, loopback left out */
export function parseNetDev(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || name!.trim() === "lo") continue;
    const n = rest.trim().split(/\s+/).map(Number);
    rx += n[0] || 0;
    tx += n[8] || 0;
  }
  return { rx, tx };
}

const DOCKER_ID = /^[0-9a-f]{64}$/;

/** What a group is, by its path; null for what is not a thing of its own (mounts, swap, sockets, slices) */
export function classify(path: string): { key: string; kind: LoadKind; name: string } | null {
  const parts = path.split("/");
  if (parts.length === 1) {
    const top = parts[0]!;
    if (top === "user.slice") return { key: "sessions", kind: "sessions", name: "user.slice" };
    if (top === "init.scope") return { key: "system", kind: "system", name: "systemd" };
    if (top.startsWith("lxc.payload.")) return { key: `incus:${top.slice(12)}`, kind: "instance", name: top.slice(12) };
    return null;
  }
  const [parent, child] = [parts[0]!, parts[1]!];
  if (parts.length !== 2) return null;
  if (parent === "docker" && DOCKER_ID.test(child)) return { key: `docker:${child}`, kind: "container", name: child };
  if (parent === "machine.slice") return { key: `machine:${child}`, kind: "machine", name: child.replace(/\.(scope|service)$/, "") };
  if (parent !== "system.slice") return null;
  const docker = /^docker-([0-9a-f]{64})\.scope$/.exec(child);
  if (docker) return { key: `docker:${docker[1]}`, kind: "container", name: docker[1]! };
  if (child === "hata.service" || /^hata-copy-[0-9a-f]+\.service$/.test(child)) return { key: "hata", kind: "hata", name: "hata" };
  if (child === "docker.service" || child === "containerd.service") return { key: "engine", kind: "engine", name: "docker" };
  const unit = /^(.+)\.(service|scope)$/.exec(child);
  if (unit) return { key: `svc:${unit[1]}`, kind: "service", name: unit[1]! };
  return null;
}

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

const dirsOf = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
};

/** A process of the group or of a group under it, to look into its network */
function pidIn(dir: string, depth = 3): string | null {
  const pid = read(`${dir}/cgroup.procs`).split("\n")[0]?.trim();
  if (pid) return pid;
  if (depth === 0) return null;
  for (const sub of dirsOf(dir)) {
    const found = pidIn(`${dir}/${sub}`, depth - 1);
    if (found) return found;
  }
  return null;
}

function readCounters(root: string, path: string, hostNet: string, own: boolean): GroupCounters | null {
  const dir = `${root}/${path}`;
  const cpu = parseCpuStat(read(`${dir}/cpu.stat`));
  if (cpu === null) return null;
  const io = parseIoStat(read(`${dir}/io.stat`));
  let rx: number | null = null;
  let tx: number | null = null;
  if (own) {
    // a container on the host's network would only repeat the host's numbers
    const pid = pidIn(dir);
    let ns = "";
    try {
      if (pid) ns = readlinkSync(`/proc/${pid}/ns/net`);
    } catch {}
    if (pid && ns && ns !== hostNet) ({ rx, tx } = parseNetDev(read(`/proc/${pid}/net/dev`)));
  }
  return { path, cpu, memory: memoryInUse(read(`${dir}/memory.current`), read(`${dir}/memory.stat`)), read: io.read, write: io.write, rx, tx };
}

/** Every group worth a row, with its counters now */
export function readGroups(root = "/sys/fs/cgroup"): GroupCounters[] {
  let hostNet = "";
  try {
    hostNet = readlinkSync("/proc/1/ns/net");
  } catch {}
  const paths: string[] = [];
  for (const top of dirsOf(root)) {
    if (top === "system.slice" || top === "docker" || top === "machine.slice") for (const child of dirsOf(`${root}/${top}`)) paths.push(`${top}/${child}`);
    else paths.push(top);
  }
  const out: GroupCounters[] = [];
  for (const path of paths) {
    const what = classify(path);
    if (!what) continue;
    const c = readCounters(root, path, hostNet, what.kind === "container" || what.kind === "instance" || what.kind === "machine");
    if (c) out.push(c);
  }
  return out;
}

/** Who a Docker container is: its compose project and service, its name */
export interface ContainerName {
  project?: string;
  service?: string;
  name: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The rows out of two walks `ms` apart. A group the first walk did not see has no rate yet and waits for the
 * next one. `machineCpu` is the whole machine's busy percent over the same time; what the groups do not explain
 * (the kernel's own threads, what runs outside any group) is the row `rest`.
 */
export function rowsOf(before: GroupCounters[], now: GroupCounters[], ms: number, cores: number, names: Map<string, ContainerName>, machine: { cpu: number | null; memory: number } | null = null): LoadRow[] {
  if (ms <= 0 || cores <= 0) return [];
  const old = new Map(before.map((g) => [g.path, g]));
  const seconds = ms / 1000;
  const rate = (a: number, b: number) => Math.max(0, Math.round((a - b) / seconds));
  const byKey = new Map<string, LoadRow>();
  const containers: { project: string; row: LoadRow }[] = [];
  for (const g of now) {
    const what = classify(g.path);
    const prev = old.get(g.path);
    if (!what || !prev) continue;
    const row: LoadRow = {
      key: what.key,
      kind: what.kind,
      name: what.name,
      cpu: Math.min(100, Math.max(0, ((g.cpu - prev.cpu) / (ms * 1000 * cores)) * 100)),
      memory: g.memory,
      read: rate(g.read, prev.read),
      write: rate(g.write, prev.write),
      rx: g.rx === null || prev.rx === null ? null : rate(g.rx, prev.rx),
      tx: g.tx === null || prev.tx === null ? null : rate(g.tx, prev.tx),
    };
    if (what.kind === "container") {
      const who = names.get(what.name);
      if (who) row.name = who.name;
      if (who?.project) {
        containers.push({ project: who.project, row: { ...row, name: who.service ?? who.name } });
        continue;
      }
    }
    const same = byKey.get(row.key);
    byKey.set(row.key, same ? add(same, row) : row);
  }
  // the containers of one compose project are one app
  for (const { project, row } of containers) {
    const key = `app:${project}`;
    const app: LoadRow = byKey.get(key) ?? { key, kind: "app", name: project, cpu: 0, memory: 0, read: 0, write: 0, rx: null, tx: null, parts: [] };
    byKey.set(key, { ...add(app, row), parts: [...(app.parts ?? []), row] });
  }
  const rows = [...byKey.values()];
  if (machine) {
    const cpu = rows.reduce((s, r) => s + r.cpu, 0);
    const memory = rows.reduce((s, r) => s + r.memory, 0);
    rows.push({ key: "rest", kind: "rest", name: "rest", cpu: Math.max(0, (machine.cpu ?? 0) - cpu), memory: Math.max(0, machine.memory - memory), read: 0, write: 0, rx: null, tx: null });
  }
  return rows.map(rounded).sort((a, b) => b.cpu - a.cpu || b.memory - a.memory);
}

const add = (a: LoadRow, b: LoadRow): LoadRow => ({
  ...a,
  cpu: a.cpu + b.cpu,
  memory: a.memory + b.memory,
  read: a.read + b.read,
  write: a.write + b.write,
  rx: a.rx === null && b.rx === null ? null : (a.rx ?? 0) + (b.rx ?? 0),
  tx: a.tx === null && b.tx === null ? null : (a.tx ?? 0) + (b.tx ?? 0),
});

const rounded = (r: LoadRow): LoadRow => ({ ...r, cpu: round1(r.cpu), ...(r.parts ? { parts: r.parts.map(rounded).sort((a, b) => b.cpu - a.cpu) } : {}) });

/** A walk after a walk: keeps the previous one and gives the rows of the time between */
export class LoadSampler {
  private prev: { at: number; groups: GroupCounters[] } | null = null;
  rows: LoadRow[] = [];

  constructor(
    private readonly cores: number,
    private readonly root = "/sys/fs/cgroup",
  ) {}

  /** `names` says who the Docker containers are; `machine` is the whole machine over the same few seconds */
  step(names: Map<string, ContainerName>, machine: { cpu: number | null; memory: number } | null, now = Date.now()): LoadRow[] {
    const groups = readGroups(this.root);
    if (this.prev) this.rows = rowsOf(this.prev.groups, groups, now - this.prev.at, this.cores, names, machine);
    this.prev = { at: now, groups };
    return this.rows;
  }

  /** The Docker ids among the groups, to know whom to ask about */
  dockerIds(): string[] {
    return (this.prev?.groups ?? []).map((g) => classify(g.path)).filter((w) => w?.kind === "container").map((w) => w!.name);
  }
}

// ---- the last hour of every row

export const HISTORY_MINUTES = 60;
const MINUTE = 60_000;

/** One row's minutes: the average of each, a gap where it was not there */
export interface RowHistory {
  /** The start of the last minute that is over */
  at: number;
  cpu: (number | null)[];
  memory: (number | null)[];
  open: { at: number; cpu: number; memory: number; n: number };
  seen: number;
}

/** Adds a sample of a row to its open minute; a minute that is over becomes a point (the gaps between are null) */
export function addSample(h: RowHistory | undefined, now: number, cpu: number, memory: number): RowHistory {
  const start = now - (now % MINUTE);
  const out: RowHistory = h ? { ...h, cpu: [...h.cpu], memory: [...h.memory], open: { ...h.open } } : { at: 0, cpu: [], memory: [], open: { at: start, cpu: 0, memory: 0, n: 0 }, seen: now };
  if (start > out.open.at) {
    if (out.open.n) {
      out.cpu.push(round1(out.open.cpu / out.open.n));
      out.memory.push(Math.round(out.open.memory / out.open.n));
      out.at = out.open.at;
    }
    // the minutes it was not there: gaps, not zeros
    for (let at = out.open.at + MINUTE; at < start && out.cpu.length && start - at <= HISTORY_MINUTES * MINUTE; at += MINUTE) {
      out.cpu.push(null);
      out.memory.push(null);
      out.at = at;
    }
    while (out.cpu.length > HISTORY_MINUTES) out.cpu.shift();
    while (out.memory.length > HISTORY_MINUTES) out.memory.shift();
    out.open = { at: start, cpu: 0, memory: 0, n: 0 };
  }
  out.open.cpu += cpu;
  out.open.memory += memory;
  out.open.n++;
  out.seen = now;
  return out;
}

/** How many of the last whole minutes the row held the processor at `percent` or more, without a break */
export function minutesOver(h: RowHistory | undefined, percent: number): number {
  if (!h) return 0;
  let n = 0;
  for (let i = h.cpu.length - 1; i >= 0; i--) {
    const v = h.cpu[i];
    if (v === null || v === undefined || v < percent) break;
    n++;
  }
  return n;
}

/** The rows of one place over the last hour */
export class LoadHistory {
  private rows = new Map<string, RowHistory>();
  latest: LoadRow[] = [];
  at = 0;

  record(rows: LoadRow[], now = Date.now()): void {
    this.latest = rows;
    this.at = now;
    for (const r of rows) this.rows.set(r.key, addSample(this.rows.get(r.key), now, r.cpu, r.memory));
    // what has been gone for an hour has nothing left to show
    for (const [key, h] of this.rows) if (now - h.seen > HISTORY_MINUTES * MINUTE) this.rows.delete(key);
  }

  of(key: string): RowHistory | undefined {
    return this.rows.get(key);
  }
}

// ---- when a thing is worth a word

/** `cpu` percent of the whole machine held for `minutes` whole minutes */
export interface LoadWarn {
  warn: boolean;
  cpu: number;
  minutes: number;
}

export const LOAD_DEFAULTS: LoadWarn = { warn: true, cpu: 80, minutes: 10 };
const LOAD_RANGE = { cpu: [20, 100], minutes: [2, HISTORY_MINUTES] } as const;

/** The parts of a change given, checked; null — one is not what it should be */
export function loadWarn(value: unknown): Partial<LoadWarn> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: Partial<LoadWarn> = {};
  if ("warn" in v) {
    if (typeof v.warn !== "boolean") return null;
    out.warn = v.warn;
  }
  for (const key of ["cpu", "minutes"] as const) {
    if (!(key in v)) continue;
    const n = v[key];
    if (!Number.isInteger(n) || (n as number) < LOAD_RANGE[key][0] || (n as number) > LOAD_RANGE[key][1]) return null;
    out[key] = n as number;
  }
  return out;
}
