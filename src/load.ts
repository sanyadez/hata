/**
 * The load of everything Hata sees, thing by thing, over the last hour: this server (sampled here from its
 * control groups), the machines with Hata's client (each samples itself and sends its rows with its status),
 * and the guests of Proxmox servers (from what Proxmox says of them every 20 s). Memory only: an hour is what
 * the page shows, and a restart of Hata starts it anew.
 */
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { AttentionItem } from "./attention";
import { LoadHistory, LoadSampler, minutesOver, type ContainerName, type LoadRow } from "./cgload";
import { settings } from "./config";
import { listContainers, PROJECT_LABEL, SERVICE_LABEL } from "./docker";
import type { Guest, Node } from "./pve";
import { parseCpu, parseMemory, type CpuTimes } from "./system";
import { powerNow, samplePower, type PowerNow } from "./powering";

const EVERY_MS = 5000;

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

interface Place {
  id: string;
  kind: "here" | "machine" | "pve";
  name: string;
  /** For a Proxmox node: its server's name */
  host?: string;
  cores: number;
  cpu: number | null;
  memory: { used: number; total: number };
  history: LoadHistory;
}

const places = new Map<string, Place>();
const cores = navigator.hardwareConcurrency || 1;

function placeOf(id: string, make: () => Omit<Place, "history">): Place {
  let p = places.get(id);
  if (!p) places.set(id, (p = { ...make(), history: new LoadHistory() }));
  return p;
}

// ---- this server

let names = new Map<string, ContainerName>();
let namesAt = 0;
let asking = false;

/** Who the containers are; asked again when one is not known yet, at most every 10 s, and every minute anyway */
function refreshNames(ids: string[]): void {
  const now = Date.now();
  const unknown = ids.some((id) => !names.has(id));
  if (asking || now - namesAt < (unknown ? 10_000 : 60_000)) return;
  asking = true;
  namesAt = now;
  listContainers()
    .then((list) => {
      names = new Map(list.map((c) => [c.Id, { project: c.Labels[PROJECT_LABEL], service: c.Labels[SERVICE_LABEL], name: (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, "") }]));
    })
    .catch(() => {})
    .finally(() => (asking = false));
}

export function startLoad(): void {
  const sampler = new LoadSampler(cores);
  let cpuBefore: CpuTimes | null = parseCpu(read("/proc/stat"));
  const here = placeOf("here", () => ({ id: "here", kind: "here", name: hostname(), cores, cpu: null, memory: { used: 0, total: 0 } }));
  const step = () => {
    const times = parseCpu(read("/proc/stat"));
    const cpu = times && cpuBefore && times.total > cpuBefore.total ? Math.min(100, Math.max(0, (1 - (times.idle - cpuBefore.idle) / (times.total - cpuBefore.total)) * 100)) : null;
    cpuBefore = times;
    const memory = parseMemory(read("/proc/meminfo"));
    const rows = sampler.step(names, { cpu, memory: memory.used });
    refreshNames(sampler.dockerIds());
    here.name = hostname();
    here.cpu = cpu === null ? null : Math.round(cpu);
    here.memory = { used: memory.used, total: memory.total };
    if (rows.length) here.history.record(rows);
    samplePower();
  };
  step();
  setInterval(step, EVERY_MS);
}

// ---- the machines with the client

/** What a machine's client said of itself */
export function noteMachine(id: string, name: string, status: { cpu: number | null; cores: number; memory: { used: number; total: number }; usage?: LoadRow[] }): void {
  if (!Array.isArray(status.usage)) return;
  const p = placeOf(`machine:${id}`, () => ({ id: `machine:${id}`, kind: "machine", name, cores: status.cores, cpu: null, memory: status.memory }));
  p.name = name;
  p.cores = status.cores;
  p.cpu = status.cpu;
  p.memory = { used: status.memory.used, total: status.memory.total };
  p.history.record(status.usage);
}

/** A machine removed: its rows go with it */
export const forgetMachine = (id: string): void => void places.delete(`machine:${id}`);

// ---- the guests of Proxmox

const guestCounters = new Map<string, { at: number; read: number; write: number; rx: number; tx: number }>();

/** What one look at a Proxmox server found: a place per node, a row per running guest */
export function notePve(hostId: string, hostName: string, nodes: Node[], guests: Guest[], now = Date.now()): void {
  for (const node of nodes) {
    const id = `pve:${hostId}:${node.name}`;
    if (!node.online) {
      places.delete(id);
      continue;
    }
    const p = placeOf(id, () => ({ id, kind: "pve", name: node.name, host: hostName, cores: node.cores, cpu: null, memory: node.memory }));
    p.host = hostName;
    p.cores = node.cores;
    p.cpu = Math.round(node.cpu * 100);
    p.memory = node.memory;
    const rows: LoadRow[] = [];
    for (const g of guests) {
      if (g.node !== node.name || g.status !== "running" || g.template) continue;
      const key = `${hostId}/${g.id}`;
      const before = guestCounters.get(key);
      const c = g.counters;
      guestCounters.set(key, { at: now, ...c });
      const seconds = before ? (now - before.at) / 1000 : 0;
      const rate = (a: number, b: number | undefined) => (seconds > 0 && b !== undefined ? Math.max(0, Math.round((a - b) / seconds)) : 0);
      rows.push({
        key: `guest:${g.id}`,
        kind: "guest",
        name: `${g.vmid} ${g.name}`,
        // Proxmox gives a guest's load as a share of its own cores; here it is a share of the node
        cpu: Math.round(((g.cpu * g.cores) / Math.max(1, node.cores)) * 1000) / 10,
        memory: g.memory.used,
        read: rate(c.read, before?.read),
        write: rate(c.write, before?.write),
        rx: rate(c.rx, before?.rx),
        tx: rate(c.tx, before?.tx),
      });
    }
    p.history.record(rows.sort((a, b) => b.cpu - a.cpu || b.memory - a.memory), now);
  }
  // nodes this server no longer has
  for (const id of places.keys()) if (id.startsWith(`pve:${hostId}:`) && !nodes.some((n) => id === `pve:${hostId}:${n.name}`)) places.delete(id);
}

/** A Proxmox server removed */
export function forgetPve(hostId: string): void {
  for (const id of places.keys()) if (id.startsWith(`pve:${hostId}:`)) places.delete(id);
}

// ---- what the page and the attention list get

export interface LoadRowView extends LoadRow {
  /** The last hour by minutes: percent of the machine, bytes */
  trend: { cpu: (number | null)[]; memory: (number | null)[] };
  /** Whole minutes it has held the processor over the warning's limit, without a break */
  over: number;
}

export interface LoadPlace {
  id: string;
  kind: Place["kind"];
  name: string;
  host?: string;
  cores: number;
  cpu: number | null;
  memory: { used: number; total: number };
  /** When the rows were sampled; a machine that stopped sending keeps its last ones */
  at: number;
  rows: LoadRowView[];
  /** This server: what its processor draws, where the kernel counts it */
  power?: PowerNow;
}

/** Every place, this server first */
export function loadReport(): { places: LoadPlace[]; warn: typeof settings.load; minutes: number } {
  const order = { here: 0, machine: 1, pve: 2 };
  const list = [...places.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  return {
    warn: settings.load,
    minutes: 60,
    places: list.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      ...(p.host ? { host: p.host } : {}),
      cores: p.cores,
      cpu: p.cpu,
      memory: p.memory,
      at: p.history.at,
      ...(p.kind === "here" && powerNow() ? { power: powerNow()! } : {}),
      rows: p.history.latest.map((r) => {
        const h = p.history.of(r.key);
        return { ...r, trend: { cpu: h?.cpu ?? [], memory: h?.memory ?? [] }, over: minutesOver(h, settings.load.cpu) };
      }),
    })),
  };
}

/** What has held the processor over the limit long enough: a line per thing */
export function loadTrouble(now = Date.now()): AttentionItem[] {
  const warn = settings.load;
  if (!warn.warn) return [];
  const items: AttentionItem[] = [];
  for (const p of places.values()) {
    // rows a machine sent long ago are no news of now
    if (now - p.history.at > 5 * 60_000) continue;
    for (const r of p.history.latest) {
      const h = p.history.of(r.key);
      const over = minutesOver(h, warn.cpu);
      if (over < warn.minutes) continue;
      const last = h!.cpu.slice(-over) as number[];
      const percent = Math.round(last.reduce((s, v) => s + v, 0) / last.length);
      items.push({ id: `load:${p.id}:${r.key}`, severity: "warn", code: "load.cpu", detail: { name: r.name, kind: r.kind, place: p.kind === "pve" && p.host !== p.name ? `${p.host} · ${p.name}` : p.name, placeId: p.id, here: p.kind === "here" ? 1 : 0, percent, minutes: over } });
    }
  }
  return items;
}
