/**
 * Proxmox VE as data: what its API answers, read into what Hata shows, and what of it is worth a word
 * on the home page. No side effects — `proxmox.ts` asks the server, this reads the answers.
 */

/** An address as typed: `192.168.1.10`, `pve:8006`, `https://pve.example.com` — with no scheme Proxmox's own port is meant */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // the address of the web page itself is pasted often: what follows # is the page's
  let text = value.trim().replace(/#.*$/, "").replace(/\/+$/, "");
  if (!text || /\s/.test(text)) return null;
  const bare = !/^[a-z]+:\/\//i.test(text);
  if (bare) text = "https://" + text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (bare && !url.port) url.port = "8006";
  return url.origin;
}

/** A token's name as Proxmox shows it: `user@realm!name` */
export const TOKEN_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+![A-Za-z][A-Za-z0-9._-]*$/;
/** The token's secret: a UUID */
export const SECRET_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A guest as the API names it: `lxc/210`, `qemu/233` */
export const GUEST_RE = /^(lxc|qemu)\/([1-9][0-9]{1,8})$/;
/** A snapshot's name as Proxmox allows it */
export const SNAPSHOT_RE = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
export const POWER = ["start", "shutdown", "stop", "reboot", "suspend", "resume"] as const;
export type Power = (typeof POWER)[number];

/** The fingerprint as Proxmox and browsers show it: upper-case pairs joined by colons */
export function cleanFingerprint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.replace(/[\s:]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(":");
}

/** One entry of `/cluster/resources`, the fields Hata reads */
export interface Resource {
  id: string;
  type: string;
  node?: string;
  status?: string;
  name?: string;
  vmid?: number;
  template?: number;
  pool?: string;
  tags?: string;
  lock?: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  storage?: string;
  plugintype?: string;
  content?: string;
  shared?: number;
}

export interface Node {
  name: string;
  online: boolean;
  cpu: number;
  cores: number;
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  uptime: number;
}

export interface Guest {
  /** `lxc/210` */
  id: string;
  type: "lxc" | "qemu";
  vmid: number;
  name: string;
  node: string;
  status: string;
  template: boolean;
  pool: string;
  tags: string[];
  /** A lock Proxmox holds on it: backup, snapshot, migrate… */
  lock: string;
  cpu: number;
  cores: number;
  memory: { used: number; total: number };
  /** Containers only: a virtual machine's disk use is not known to Proxmox without the guest agent */
  disk: { used: number; total: number };
  uptime: number;
}

export interface Storage {
  /** `i5/local-lvm` */
  id: string;
  name: string;
  node: string;
  type: string;
  /** available, or not reachable (an NFS server that is off) */
  active: boolean;
  shared: boolean;
  content: string[];
  used: number;
  total: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** `/cluster/resources` read into nodes, guests and storages, each sorted the way the page lists them */
export function readResources(list: Resource[]): { nodes: Node[]; guests: Guest[]; storages: Storage[] } {
  const nodes: Node[] = [];
  const guests: Guest[] = [];
  const storages: Storage[] = [];
  for (const r of list) {
    if (r.type === "node") {
      nodes.push({ name: str(r.node), online: r.status === "online", cpu: num(r.cpu), cores: num(r.maxcpu), memory: { used: num(r.mem), total: num(r.maxmem) }, disk: { used: num(r.disk), total: num(r.maxdisk) }, uptime: num(r.uptime) });
    } else if ((r.type === "lxc" || r.type === "qemu") && typeof r.vmid === "number") {
      guests.push({
        id: `${r.type}/${r.vmid}`,
        type: r.type,
        vmid: r.vmid,
        name: str(r.name) || String(r.vmid),
        node: str(r.node),
        status: str(r.status) || "unknown",
        template: r.template === 1,
        pool: str(r.pool),
        tags: str(r.tags).split(/[;, ]+/).filter(Boolean),
        lock: str(r.lock),
        cpu: num(r.cpu),
        cores: num(r.maxcpu),
        memory: { used: num(r.mem), total: num(r.maxmem) },
        disk: { used: r.type === "lxc" ? num(r.disk) : 0, total: num(r.maxdisk) },
        uptime: num(r.uptime),
      });
    } else if (r.type === "storage") {
      storages.push({ id: `${str(r.node)}/${str(r.storage)}`, name: str(r.storage), node: str(r.node), type: str(r.plugintype), active: r.status === "available", shared: r.shared === 1, content: str(r.content).split(",").filter(Boolean).sort(), used: num(r.disk), total: num(r.maxdisk) });
    }
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  guests.sort((a, b) => a.vmid - b.vmid);
  storages.sort((a, b) => a.node.localeCompare(b.node) || a.name.localeCompare(b.name));
  return { nodes, guests, storages };
}

/** What a guest's configuration says that the list does not: its cards, its addresses, whether it starts with the server */
export interface GuestConfig {
  macs: string[];
  addresses: string[];
  onboot: boolean;
  /** Containers: run without root's rights on the host */
  unprivileged: boolean;
  os: string;
  description: string;
}

/** A guest's `/config` read: `net0: name=eth0,bridge=vmbr0,hwaddr=BC:24:11:…,ip=192.168.1.10/24` or, for a virtual machine, `virtio=BC:24:11:…,bridge=vmbr0` */
export function readConfig(config: Record<string, unknown>): GuestConfig {
  const macs: string[] = [];
  const addresses: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (!/^net\d+$/.test(key) || typeof value !== "string") continue;
    for (const part of value.split(",")) {
      const [k, v = ""] = part.split("=") as [string, string?];
      if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v) && (k === "hwaddr" || /^(virtio|e1000e?|rtl8139|vmxnet3|ne2k_pci|pcnet|i82551|i82557b|i82559er|ne2k_isa)$/.test(k))) macs.push(v.toLowerCase());
      if (k === "ip" && v && v !== "dhcp" && v !== "manual") addresses.push(v.replace(/\/\d+$/, ""));
    }
  }
  // a virtual machine with cloud-init says its address in ipconfig<n>
  for (const [key, value] of Object.entries(config)) {
    if (!/^ipconfig\d+$/.test(key) || typeof value !== "string") continue;
    const ip = /(?:^|,)ip=([^,/]+)/.exec(value)?.[1];
    if (ip && ip !== "dhcp") addresses.push(ip);
  }
  return {
    macs,
    addresses,
    onboot: config.onboot === 1 || config.onboot === "1",
    unprivileged: config.unprivileged === 1 || config.unprivileged === "1",
    os: str(config.ostype),
    description: str(config.description).slice(0, 2000),
  };
}

/** The privileges `/access/permissions` gives, path → privilege → 1 */
export type Permissions = Record<string, Record<string, number>>;

/**
 * Whether a privilege holds for a guest: the most specific path that says anything wins — the guest's
 * own (`/vms/210`), its pool's, `/vms`, then `/`. Privileges given on a path reach the paths under it;
 * `/access/permissions` lists each path where something was given, so walking up finds it.
 */
export function mayGuest(perms: Permissions, vmid: number, pool: string, privilege: string): boolean {
  for (const path of [`/vms/${vmid}`, pool && `/pool/${pool}`, "/vms", "/"]) {
    if (path && perms[path]?.[privilege]) return true;
  }
  return false;
}

/** Whether a privilege holds on a path or anything above it */
export function mayPath(perms: Permissions, path: string, privilege: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    if (perms["/" + parts.slice(0, i).join("/")]?.[privilege]) return true;
  }
  return false;
}

/** What may be done with a guest, so the page offers only what Proxmox would allow */
export const guestRights = (perms: Permissions, g: Guest) => ({
  power: mayGuest(perms, g.vmid, g.pool, "VM.PowerMgmt"),
  snapshot: mayGuest(perms, g.vmid, g.pool, "VM.Snapshot"),
  rollback: mayGuest(perms, g.vmid, g.pool, "VM.Snapshot.Rollback"),
  backup: mayGuest(perms, g.vmid, g.pool, "VM.Backup"),
  remove: mayGuest(perms, g.vmid, g.pool, "VM.Allocate"),
});

/** A task of Proxmox, from `/cluster/tasks` or a task's `/status` */
export interface Task {
  upid: string;
  node: string;
  type: string;
  /** What it was about: a guest's number, a storage */
  id: string;
  user: string;
  start: number;
  end: number | null;
  /** OK, an error message, or "" while it runs */
  status: string;
}

export function readTask(t: Record<string, unknown>): Task | null {
  const upid = str(t.upid);
  if (!upid.startsWith("UPID:")) return null;
  // the list says when a task ended; a task's own /status says only "stopped" and how
  const end = num(t.endtime);
  const over = t.status === "stopped" || typeof t.exitstatus === "string" || (end > 0 && t.status !== "running");
  return { upid, node: str(t.node), type: str(t.type), id: str(t.id), user: str(t.user), start: num(t.starttime), end: over ? end || Math.floor(Date.now() / 1000) : null, status: over ? str(t.exitstatus) || str(t.status) : "" };
}

/** A task that ended badly; a warning is not a failure */
export const failed = (t: Task): boolean => t.end !== null && t.status !== "OK" && !/^WARNINGS: \d+$/.test(t.status);

/** An item of the home page's list, as `attention.ts` takes it */
export interface PveItem {
  id: string;
  severity: "danger" | "warn";
  code: string;
  detail: Record<string, string | number>;
  at?: number;
}

export const STORAGE_WARN = 85;
export const STORAGE_DANGER = 95;
const MEMORY_WARN = 92;
/** The server unanswered for this long is worth a word: Proxmox restarts take a few minutes */
export const AWAY_MS = 5 * 60_000;
const FAILURE_WINDOW_S = 24 * 3600;

export interface Watched {
  id: string;
  name: string;
  /** Since when it does not answer, and why */
  error: { code: string; since: number } | null;
  nodes: Node[];
  guests: Guest[];
  storages: Storage[];
  configs: Record<string, GuestConfig>;
  tasks: Task[];
  disks: { node: string; device: string; model: string; health: string }[];
  /** Guests no backup job covers; null when not known */
  unprotected: { vmid: number; name: string }[] | null;
  /** The addresses running containers have now, from the router too: guest id → addresses */
  ips: Record<string, string[]>;
}

/** What of a Proxmox server is worth a word on the home page */
export function trouble(h: Watched, now = Date.now()): PveItem[] {
  const items: PveItem[] = [];
  const base = { host: h.id, name: h.name };
  if (h.error) {
    if (h.error.code === "pve.badToken") items.push({ id: `pve:${h.id}`, severity: "danger", code: "pve.badToken", detail: base });
    else if (h.error.code === "pve.certChanged") items.push({ id: `pve:${h.id}`, severity: "danger", code: "pve.certChanged", detail: base });
    else if (now - h.error.since > AWAY_MS) items.push({ id: `pve:${h.id}`, severity: "warn", code: "pve.away", detail: base });
    // what it said last is old news while it does not answer
    return items;
  }
  for (const n of h.nodes) {
    if (!n.online) items.push({ id: `pve:${h.id}:node:${n.name}`, severity: "danger", code: "pve.nodeOffline", detail: { ...base, node: n.name } });
    else if (n.memory.total && (n.memory.used / n.memory.total) * 100 >= MEMORY_WARN) items.push({ id: `pve:${h.id}:mem:${n.name}`, severity: "warn", code: "pve.memory", detail: { ...base, node: n.name, percent: Math.round((n.memory.used / n.memory.total) * 100) } });
  }
  const offline = new Set(h.nodes.filter((n) => !n.online).map((n) => n.name));
  for (const s of h.storages) {
    if (!s.active || !s.total || offline.has(s.node)) continue;
    const percent = Math.round((s.used / s.total) * 100);
    if (percent >= STORAGE_WARN) items.push({ id: `pve:${h.id}:storage:${s.id}`, severity: percent >= STORAGE_DANGER ? "danger" : "warn", code: "pve.storageFull", detail: { ...base, storage: s.name, node: s.node, percent, free: s.total - s.used } });
  }
  // a guest set to start with the server that is not running: it fell, or it did not come up
  for (const g of h.guests) {
    if (g.template || offline.has(g.node) || g.status !== "stopped" || !h.configs[g.id]?.onboot) continue;
    items.push({ id: `pve:${h.id}:down:${g.id}`, severity: "warn", code: "pve.guestDown", detail: { ...base, guest: g.name, vmid: g.vmid } });
  }
  // a backup that failed: the latest run of each guest's backup decides, so a run that worked afterwards clears it
  const latest = new Map<string, Task>();
  for (const t of h.tasks) {
    if (t.type !== "vzdump" || t.end === null || now / 1000 - t.end > FAILURE_WINDOW_S) continue;
    const key = `${t.node}/${t.id}`;
    const seen = latest.get(key);
    if (!seen || seen.start < t.start) latest.set(key, t);
  }
  for (const t of latest.values()) {
    if (!failed(t)) continue;
    const guest = h.guests.find((g) => String(g.vmid) === t.id)?.name ?? t.id;
    items.push({ id: `pve:${h.id}:backup:${t.node}/${t.id || "all"}`, severity: "danger", code: "pve.backupFailed", detail: { ...base, guest: guest || t.node, message: t.status.slice(0, 200) }, at: t.end! * 1000 });
  }
  for (const d of h.disks) {
    if (!d.health || /^(PASSED|OK|UNKNOWN)$/i.test(d.health)) continue;
    items.push({ id: `pve:${h.id}:disk:${d.node}:${d.device}`, severity: "danger", code: "pve.diskHealth", detail: { ...base, node: d.node, disk: d.model || d.device, health: d.health } });
  }
  if (h.unprotected?.length) {
    const named = h.unprotected.map((g) => g.name || String(g.vmid));
    items.push({ id: `pve:${h.id}:unprotected`, severity: "warn", code: "pve.notBackedUp", detail: { ...base, n: named.length, guests: named.slice(0, 5).join(", ") + (named.length > 5 ? ` +${named.length - 5}` : "") } });
  }
  return items;
}

/**
 * The guest of any watched server that is a machine of Hata's: by a card of the machine (a virtual
 * machine's), else by the address the machine connects from — a container's card is virtual, and the
 * client names only real ones.
 */
export function guestOfMachine(hosts: Watched[], macs: string[], ip: string): { host: string; hostName: string; guest: Guest } | null {
  const wanted = new Set(macs.map((m) => m.toLowerCase()));
  for (const h of hosts) {
    for (const g of h.guests) {
      if (wanted.size && h.configs[g.id]?.macs.some((m) => wanted.has(m))) return { host: h.id, hostName: h.name, guest: g };
    }
  }
  if (!ip) return null;
  for (const h of hosts) {
    for (const g of h.guests) {
      if (h.configs[g.id]?.addresses.includes(ip) || h.ips[g.id]?.includes(ip)) return { host: h.id, hostName: h.name, guest: g };
    }
  }
  return null;
}

/** The name of a snapshot made now, when the person gives none: `hata-20261017-2214` */
export function snapshotName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `hata-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

// --- A new container ---------------------------------------------------------------------------------

/** What the server offers for a new container, per node */
export interface NewOptions {
  nodes: string[];
  templates: Record<string, string[]>;
  storages: Record<string, string[]>;
  bridges: Record<string, string[]>;
  /** Pools the token may put a guest into; `free` — it may make one outside any pool too */
  pools: string[];
  free: boolean;
  /** The numbers new guests take, when the person keeps them in a range */
  ids: { from: number; to: number } | null;
  /** Numbers already used by guests */
  taken: number[];
}

export interface NewGuest {
  node: string;
  vmid: number;
  hostname: string;
  /** The address it gets, without the mask; null — from the router */
  address: string | null;
  family: "apt" | "dnf" | null;
  docker: boolean;
  client: boolean;
  /** For `POST /nodes/<node>/lxc`, the key added by the caller */
  params: Record<string, string | number>;
  /**
   * Set once it exists: Proxmox judges these by the rights on the guest's own path while it is being
   * made, before it is in its pool — a token with rights on a pool only would be refused
   */
  later: Record<string, string | number>;
}

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const octets = (m: RegExpExecArray, n: number) => m.slice(1, n + 1).every((x) => Number(x) <= 255);

/** How a template's system installs packages; Hata's client needs systemd, so the families it knows are those */
export function familyOf(template: string): "apt" | "dnf" | null {
  const name = template.split("/").pop()!.toLowerCase();
  if (/^(debian|ubuntu)-/.test(name)) return "apt";
  if (/^(fedora|rockylinux|almalinux|centos)-/.test(name)) return "dnf";
  return null;
}

/** The first free number in the range, or after 100 when there is none */
export function nextId(o: Pick<NewOptions, "ids" | "taken">): number | null {
  const taken = new Set(o.taken);
  const [from, to] = o.ids ? [o.ids.from, o.ids.to] : [100, 999_999_999];
  for (let id = from; id <= to; id++) if (!taken.has(id)) return id;
  return null;
}

const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** The new container's answers checked against what the server offers; every refusal names its field */
export function readNewGuest(input: Record<string, unknown>, o: NewOptions): NewGuest {
  const bad = (field: string): never => {
    throw Object.assign(new Error("pve.badField"), { field });
  };
  const node = typeof input.node === "string" && o.nodes.includes(input.node) ? input.node : bad("node");
  const vmid = int(input.vmid, 100, 999_999_999) ?? bad("vmid");
  if (o.taken.includes(vmid)) bad("vmidTaken");
  if (o.ids && (vmid < o.ids.from || vmid > o.ids.to)) bad("vmidRange");
  const hostname = typeof input.hostname === "string" ? input.hostname.trim().toLowerCase() : "";
  if (!HOSTNAME_RE.test(hostname)) bad("hostname");
  const template = typeof input.template === "string" && o.templates[node]?.includes(input.template) ? input.template : bad("template");
  const storage = typeof input.storage === "string" && o.storages[node]?.includes(input.storage) ? input.storage : bad("storage");
  const bridge = typeof input.bridge === "string" && o.bridges[node]?.includes(input.bridge) ? input.bridge : bad("bridge");
  const disk = int(input.disk, 2, 4096) ?? bad("disk");
  const cores = int(input.cores, 1, 128) ?? bad("cores");
  const memory = int(input.memory, 256, 1_048_576) ?? bad("memory");
  const pool = typeof input.pool === "string" && input.pool ? (o.pools.includes(input.pool) ? input.pool : bad("pool")) : o.free ? "" : bad("pool");
  let net = `name=eth0,bridge=${bridge},ip=dhcp`;
  let address: string | null = null;
  if (input.address !== undefined && input.address !== "dhcp" && input.address !== "") {
    const cidr = typeof input.address === "string" ? CIDR_RE.exec(input.address.trim()) : null;
    if (!cidr || !octets(cidr, 4) || Number(cidr[5]) < 8 || Number(cidr[5]) > 30) bad("address");
    const gw = typeof input.gateway === "string" ? IP_RE.exec(input.gateway.trim()) : null;
    if (!gw || !octets(gw, 4)) bad("gateway");
    address = cidr![0].split("/")[0]!;
    net = `name=eth0,bridge=${bridge},ip=${cidr![0]},gw=${gw![0]}`;
  }
  const client = input.client !== false;
  const family = familyOf(template);
  if (client && !family) bad("templateNoClient");
  return {
    node,
    vmid,
    hostname,
    address,
    family,
    docker: client && input.docker === true,
    client,
    params: {
      vmid,
      hostname,
      ostemplate: template,
      rootfs: `${storage}:${disk}`,
      cores,
      memory,
      swap: 512,
      net0: net,
      unprivileged: 1,
      ...(pool ? { pool } : {}),
    },
    later: {
      // Docker in an unprivileged container needs it; keyctl only root@pam may set
      features: "nesting=1",
      onboot: input.onboot === false ? 0 : 1,
      tags: "hata",
      description: "Made by Hata",
    },
  };
}

/** The commands run in a new container: packages, Docker if asked, Hata's client, then Hata's key taken out */
export function setupScript(g: Pick<NewGuest, "family" | "docker" | "client">, installLine: string, key: string): string {
  // Hata's key was for this once: nothing of it stays in the container, whatever happens below
  const lines = [`trap "sed -i '\\|${key.split(" ")[1]}|d' /root/.ssh/authorized_keys" EXIT`, "set -e", "export DEBIAN_FRONTEND=noninteractive"];
  if (g.family === "apt") lines.push("apt-get update -q", "apt-get install -y -q curl ca-certificates");
  if (g.family === "dnf") lines.push("dnf install -y -q curl ca-certificates");
  if (g.docker) lines.push("curl -fsSL https://get.docker.com | sh");
  if (g.client) lines.push(installLine);
  return lines.join("\n") + "\n";
}

/** The fingerprints of a new container's SSH keys, as Proxmox's task wrote them while making them */
export function hostKeysIn(lines: string[]): string[] {
  return lines.flatMap((l) => /^done: (SHA256:[A-Za-z0-9+/]{43})\b/.exec(l.trim())?.[1] ?? []);
}
