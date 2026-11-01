/**
 * The Servers page as one tree of what runs where: this server with its containers and virtual machines, each
 * Proxmox server with its guests, and the other computers. A thing that is several at once (a container with
 * Hata's client is an instance and a machine) is one row. Pure: the server hands in what it knows.
 */

export interface TreeRow {
  /** Unique on the page, and what remembers a folded branch */
  key: string;
  name: string;
  kind: "container" | "vm" | "machine";
  os: string;
  status: "running" | "stopped" | "paused" | "away";
  address: string;
  /** 0–100; null — not known */
  cpu: number | null;
  /** Bytes; total 0 — no limit known */
  memory: { used: number; total: number } | null;
  uptime: number;
  /** The machine it is, when Hata's client is there */
  machine: string;
  /** Its client answers */
  connected: boolean;
  seen: number;
  /** Its card can be woken over the network */
  wakes: boolean;
  /** The instance of this server it is */
  instance: string;
  /** The guest of a Proxmox server it is */
  guest: { host: string; id: string; type: "lxc" | "qemu" } | null;
  may: { power: boolean; console: boolean };
  noBackup: boolean;
  /** Hata itself runs in it */
  self: boolean;
}

export interface TreeGroup {
  key: string;
  kind: "here" | "pve" | "others";
  name: string;
  os: string;
  /** Whether it answers; for the other computers always true */
  online: boolean;
  /** Proxmox's server id */
  id: string;
  address: string;
  cpu: number | null;
  memory: { used: number; total: number } | null;
  uptime: number;
  counts: { running: number; all: number };
  error: string;
  rows: TreeRow[];
}

export interface Tree {
  groups: TreeGroup[];
  total: number;
  running: number;
  notAnswering: number;
  notConnected: number;
  /** Names of the machines whose client is older than this Hata */
  outdated: { id: string; name: string }[];
  version: string;
}

interface InstanceIn {
  name: string;
  kind: string;
  status: string;
  os: string;
  address: string;
  memory: number;
  usage: { memory: number } | null;
}
interface GuestIn {
  id: string;
  type: "lxc" | "qemu";
  name: string;
  status: string;
  template: boolean;
  vmid: number;
  cpu: number;
  uptime: number;
  memory: { used: number; total: number };
  config?: { os?: string; addresses?: string[] } | null;
  may: { power?: boolean; console?: boolean };
}
interface HostIn {
  id: string;
  name: string;
  version: string;
  online: boolean;
  error?: { code: string } | null;
  self?: string | null;
  nodes: { cpu: number; memory?: { used: number; total: number } }[];
  guests: GuestIn[];
  unprotected: { vmid: number }[] | null;
}
export interface MachineIn {
  id: string;
  name: string;
  online: boolean;
  seen: number;
  outdated: boolean;
  ip: string;
  info: { os?: string; arch?: string; macs?: unknown[] } | null;
  status: { cpu: number | null; memory: { used: number; total: number }; uptime: number } | null;
  /** The instance of this server it is; "" — none */
  instance: string;
  /** The guest it is */
  guest: { host: string; id: string } | null;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const percent = (share: number): number => Math.round(share * 100);

function machineFacts(m: MachineIn | undefined) {
  return {
    machine: m?.id ?? "",
    connected: !!m?.online,
    seen: m?.seen ?? 0,
    wakes: !!m?.info?.macs?.length,
  };
}

export function serverTree(input: {
  here: { name: string; os: string; address: string; cpu: number | null; memory: { used: number; total: number }; uptime: number };
  instances: InstanceIn[];
  hosts: HostIn[];
  machines: MachineIn[];
  version: string;
}): Tree {
  const taken = new Set<string>();
  const machineOfInstance = (name: string) => {
    const m = input.machines.find((x) => x.instance === name);
    if (m) taken.add(m.id);
    return m;
  };
  const machineOfGuest = (host: string, id: string) => {
    const m = input.machines.find((x) => x.guest?.host === host && x.guest.id === id);
    if (m) taken.add(m.id);
    return m;
  };
  const counted = (rows: TreeRow[]) => ({ running: rows.filter((r) => r.status === "running").length, all: rows.length });

  const hereRows = input.instances
    .map((c): TreeRow => {
      const m = machineOfInstance(c.name);
      const up = c.status === "running";
      const live = up && m?.online ? m.status : null;
      return {
        key: "instance:" + c.name,
        name: c.name,
        kind: c.kind === "vm" ? "vm" : "container",
        os: c.os,
        status: up ? "running" : c.status === "frozen" ? "paused" : "stopped",
        address: c.address,
        cpu: live?.cpu ?? null,
        memory: live ? live.memory : up && c.usage ? { used: c.usage.memory, total: c.memory * 1024 * 1024 } : null,
        uptime: live?.uptime ?? 0,
        ...machineFacts(m),
        instance: c.name,
        guest: null,
        may: { power: true, console: true },
        noBackup: false,
        self: false,
      };
    })
    .sort(byName);

  const groups: TreeGroup[] = [
    { key: "here", kind: "here", name: input.here.name, os: input.here.os, online: true, id: "", address: input.here.address, cpu: input.here.cpu, memory: input.here.memory, uptime: input.here.uptime, counts: counted(hereRows), error: "", rows: hereRows },
  ];

  for (const x of input.hosts) {
    const bare = new Set((x.unprotected ?? []).map((g) => g.vmid));
    const rows = x.guests
      .filter((g) => !g.template)
      .map((g): TreeRow => {
        const m = machineOfGuest(x.id, g.id);
        const up = g.status === "running";
        return {
          key: `guest:${x.id}:${g.id}`,
          name: g.name,
          kind: g.type === "lxc" ? "container" : "vm",
          os: g.config?.os ?? "",
          status: up ? "running" : g.status === "paused" || g.status === "suspended" ? "paused" : "stopped",
          address: g.config?.addresses?.[0] ?? "",
          cpu: up ? percent(g.cpu) : null,
          memory: up ? g.memory : null,
          uptime: up ? g.uptime : 0,
          ...machineFacts(m),
          instance: "",
          guest: { host: x.id, id: g.id, type: g.type },
          may: { power: !!g.may.power, console: !!g.may.console },
          noBackup: bare.has(g.vmid),
          self: g.id === x.self,
        };
      })
      .sort(byName);
    const node = x.nodes[0];
    groups.push({ key: "pve:" + x.id, kind: "pve", name: x.name, os: x.version ? "Proxmox VE " + x.version : "Proxmox VE", online: x.online, id: x.id, address: "", cpu: node ? percent(node.cpu) : null, memory: node?.memory ?? null, uptime: 0, counts: counted(rows), error: x.error?.code ?? "", rows });
  }

  const others = input.machines
    .filter((m) => !taken.has(m.id))
    .map((m): TreeRow => ({
      key: "machine:" + m.id,
      name: m.name,
      kind: "machine",
      os: [m.info?.os, m.info?.arch].filter(Boolean).join(" · "),
      status: m.online ? "running" : "away",
      address: m.ip.replace(/^::ffff:/, ""),
      cpu: m.online ? (m.status?.cpu ?? null) : null,
      memory: m.online ? (m.status?.memory ?? null) : null,
      uptime: m.online ? (m.status?.uptime ?? 0) : 0,
      ...machineFacts(m),
      instance: "",
      guest: null,
      may: { power: m.online, console: m.online },
      noBackup: false,
      self: false,
    }))
    .sort(byName);
  if (others.length) groups.push({ key: "others", kind: "others", name: "", os: "", online: true, id: "", address: "", cpu: null, memory: null, uptime: 0, counts: counted(others), error: "", rows: others });

  const rows = groups.flatMap((g) => g.rows);
  return {
    groups,
    total: rows.length,
    running: rows.filter((r) => r.status === "running").length,
    notAnswering: groups.filter((g) => !g.online).length,
    notConnected: rows.filter((r) => r.kind === "machine" && !r.connected).length,
    outdated: input.machines.filter((m) => m.online && m.outdated).map((m) => ({ id: m.id, name: m.name })),
    version: input.version,
  };
}
