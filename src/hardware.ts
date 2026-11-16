/**
 * What the computer is made of: the processor, its cores and threads, the memory modules. Read from /proc/cpuinfo
 * and the firmware's own table (/sys/firmware/dmi/tables/DMI, root only) — nothing is installed to know it.
 * No side effects: the client of another computer reads its own the same way.
 */
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";

export interface MemoryModule {
  /** Bytes */
  size: number;
  /** "DDR4", "" when the firmware does not say (a virtual machine) */
  type: string;
  /** MHz, 0 when not said */
  speed: number;
}

export interface Hardware {
  cpu: string;
  cores: number;
  threads: number;
  /** Bytes the system sees */
  memory: number;
  /** The modules that are in, [] when the firmware's table cannot be read */
  modules: MemoryModule[];
  /** Memory slots of the board, 0 when not known */
  slots: number;
}

/** The processor's name and how many cores and threads the system has, from /proc/cpuinfo */
export function parseCpuInfo(cpuinfo: string): { cpu: string; cores: number; threads: number } {
  const blocks = cpuinfo.split(/\n\s*\n/).filter((b) => /^processor\s*:/m.test(b));
  const field = (block: string, name: string) => new RegExp(`^${name}\\s*:\\s*(.*)$`, "m").exec(block)?.[1]?.trim() ?? "";
  const first = blocks[0] ?? cpuinfo;
  const cpu = (field(first, "model name") || field(cpuinfo, "Model") || field(first, "Hardware")).replace(/\((R|TM)\)/gi, "").replace(/\s+CPU\b/, "").replace(/\s+/g, " ").trim();
  // a core is told by its socket and its number there; a system that names neither (ARM) has a core per thread
  const seen = new Set<string>();
  for (const block of blocks) {
    const core = field(block, "core id");
    if (core) seen.add(field(block, "physical id") + ":" + core);
  }
  const threads = blocks.length;
  return { cpu, cores: seen.size || threads, threads };
}

const MEMORY_TYPES: Record<number, string> = { 0x12: "DDR", 0x13: "DDR2", 0x18: "DDR3", 0x1a: "DDR4", 0x1b: "LPDDR", 0x1c: "LPDDR2", 0x1d: "LPDDR3", 0x1e: "LPDDR4", 0x22: "DDR5", 0x23: "LPDDR5" };

/** The memory devices (type 17) of an SMBIOS table: the modules that are in and how many slots there are */
export function parseDmiMemory(table: Uint8Array): { modules: MemoryModule[]; slots: number } {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const modules: MemoryModule[] = [];
  let slots = 0;
  let at = 0;
  while (at + 4 <= table.length) {
    const type = table[at]!;
    const length = table[at + 1]!;
    if (length < 4 || at + length > table.length) break;
    if (type === 17 && length >= 0x15) {
      slots++;
      const raw = view.getUint16(at + 0x0c, true);
      let size = 0;
      if (raw === 0x7fff && length >= 0x20) size = (view.getUint32(at + 0x1c, true) & 0x7fffffff) * 1024 ** 2;
      else if (raw !== 0 && raw !== 0xffff) size = raw & 0x8000 ? (raw & 0x7fff) * 1024 : raw * 1024 ** 2;
      if (size > 0) {
        const configured = length >= 0x22 ? view.getUint16(at + 0x20, true) : 0;
        const stated = length >= 0x17 ? view.getUint16(at + 0x15, true) : 0;
        const speed = [configured, stated].find((n) => n > 0 && n !== 0xffff) ?? 0;
        modules.push({ size, type: MEMORY_TYPES[table[at + 0x12]!] ?? "", speed });
      }
    }
    if (type === 127) break;
    // the strings after the structure end with two zero bytes
    let end = at + length;
    while (end + 1 < table.length && (table[end] !== 0 || table[end + 1] !== 0)) end++;
    at = end + 2;
  }
  return { modules, slots };
}

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

let known: Hardware | null = null;

/** Read once: none of it changes while the system runs */
export function hardware(): Hardware {
  if (known) return known;
  let memory: { modules: MemoryModule[]; slots: number } = { modules: [], slots: 0 };
  try {
    memory = parseDmiMemory(new Uint8Array(readFileSync("/sys/firmware/dmi/tables/DMI")));
  } catch {
    // not root, a container, a board without the table: the total alone is said
  }
  return (known = { ...parseCpuInfo(read("/proc/cpuinfo")), memory: totalmem(), ...memory });
}
