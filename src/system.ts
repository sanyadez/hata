/**
 * System status read straight from /proc and /sys: CPU, memory, disks, network, temperature.
 * Rates (CPU load, network speed) are differences between two consecutive samples.
 */
import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { hostname, loadavg } from "node:os";
import { bus } from "./bus";
import { settings } from "./config";

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

export interface CpuTimes {
  idle: number;
  total: number;
}

/** The aggregate `cpu` line of /proc/stat */
export function parseCpu(stat: string): CpuTimes | null {
  const line = stat.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 5 || n.some(Number.isNaN)) return null;
  // idle + iowait; guest time is already included in user/nice
  return { idle: n[3]! + n[4]!, total: n.slice(0, 8).reduce((a, b) => a + b, 0) };
}

export interface Memory {
  total: number;
  used: number;
  swapTotal: number;
  swapUsed: number;
}

/** /proc/meminfo, bytes. "Used" is what is not available to new programs (caches do not count) */
export function parseMemory(meminfo: string): Memory {
  const kb: Record<string, number> = {};
  for (const line of meminfo.split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kb[m[1]!] = Number(m[2]) * 1024;
  }
  const total = kb.MemTotal ?? 0;
  const available = kb.MemAvailable ?? (kb.MemFree ?? 0) + (kb.Buffers ?? 0) + (kb.Cached ?? 0);
  return { total, used: Math.max(0, total - available), swapTotal: kb.SwapTotal ?? 0, swapUsed: Math.max(0, (kb.SwapTotal ?? 0) - (kb.SwapFree ?? 0)) };
}

export interface NetTotals {
  rx: number;
  tx: number;
}

/** Sum of /proc/net/dev over physical-looking interfaces: loopback and container plumbing would double count */
export function parseNet(dev: string): NetTotals {
  let rx = 0;
  let tx = 0;
  for (const line of dev.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!name || !rest) continue;
    if (/^(lo|docker\d*|br-|veth|virbr|tun|tap|wg|tailscale|zt)/.test(name.trim())) continue;
    const n = rest.trim().split(/\s+/).map(Number);
    rx += n[0] ?? 0;
    tx += n[8] ?? 0;
  }
  return { rx, tx };
}

export interface Disk {
  path: string;
  total: number;
  used: number;
}

function disk(path: string): Disk | null {
  try {
    const s = statfsSync(path);
    const total = s.blocks * s.bsize;
    // `bavail` is what an unprivileged process can still write — what the user thinks of as free
    return total > 0 ? { path, total, used: total - s.bavail * s.bsize } : null;
  } catch {
    return null;
  }
}

/** The root filesystem and, when it is a different filesystem, the data root */
function disks(): Disk[] {
  const root = disk("/");
  const data = settings.dataRoot === "/" ? null : disk(settings.dataRoot);
  const out = root ? [root] : [];
  if (data && (!root || data.total !== root.total || data.used !== root.used)) out.push(data);
  return out;
}

/** The hottest thermal zone, °C; null when the machine exposes none (most VMs) */
function temperature(): number | null {
  let max: number | null = null;
  let zones: string[] = [];
  try {
    zones = readdirSync("/sys/class/thermal").filter((z) => z.startsWith("thermal_zone"));
  } catch {}
  for (const zone of zones) {
    const milli = Number(read(`/sys/class/thermal/${zone}/temp`));
    if (milli > 0 && milli < 150_000) max = Math.max(max ?? 0, milli / 1000);
  }
  return max === null ? null : Math.round(max);
}

export interface SystemStatus {
  hostname: string;
  uptime: number;
  cores: number;
  load: number[];
  /** CPU load since the previous sample, 0–100; null on the first sample */
  cpu: number | null;
  memory: Memory;
  disks: Disk[];
  /** Bytes per second since the previous sample; null on the first sample */
  net: { rx: number; tx: number } | null;
  temperature: number | null;
  /** The last minute or so of samples, oldest first, for the sparklines: percentages and bytes per second */
  history: { cpu: number[]; memory: number[]; net: number[] };
}

const HISTORY = 40;
const history: SystemStatus["history"] = { cpu: [], memory: [], net: [] };

function remember(list: number[], value: number): void {
  list.push(value);
  if (list.length > HISTORY) list.shift();
}

let prev: { at: number; cpu: CpuTimes | null; net: NetTotals } | null = null;
let last: SystemStatus | null = null;

export function sample(): SystemStatus {
  const now = Date.now();
  const cpuTimes = parseCpu(read("/proc/stat"));
  const netTotals = parseNet(read("/proc/net/dev"));
  let cpu: number | null = null;
  let net: SystemStatus["net"] = null;
  if (prev && now > prev.at) {
    if (cpuTimes && prev.cpu && cpuTimes.total > prev.cpu.total) {
      cpu = Math.round((1 - (cpuTimes.idle - prev.cpu.idle) / (cpuTimes.total - prev.cpu.total)) * 100);
      cpu = Math.min(100, Math.max(0, cpu));
    }
    const seconds = (now - prev.at) / 1000;
    net = { rx: Math.max(0, Math.round((netTotals.rx - prev.net.rx) / seconds)), tx: Math.max(0, Math.round((netTotals.tx - prev.net.tx) / seconds)) };
  }
  prev = { at: now, cpu: cpuTimes, net: netTotals };
  const memory = parseMemory(read("/proc/meminfo"));
  if (cpu !== null) remember(history.cpu, cpu);
  if (net) remember(history.net, net.rx + net.tx);
  remember(history.memory, memory.total ? Math.round((memory.used / memory.total) * 100) : 0);
  last = {
    hostname: hostname(),
    uptime: Math.floor(Number(read("/proc/uptime").split(" ")[0]) || 0),
    cores: navigator.hardwareConcurrency,
    load: loadavg().map((l) => Math.round(l * 100) / 100),
    cpu,
    memory,
    disks: disks(),
    net,
    temperature: temperature(),
    history,
  };
  return last;
}

/** The latest sample, taking one if the sampler is not running yet */
export const systemStatus = (): SystemStatus => last ?? sample();

const SAMPLE_EVERY_MS = 2000;

/** Samples continuously (rates need a steady baseline) but publishes only while someone is watching */
export function startSampler(): void {
  sample();
  setInterval(() => {
    const status = sample();
    if (bus.subscriberCount > 0) bus.publish("system", { system: status });
  }, SAMPLE_EVERY_MS);
}
