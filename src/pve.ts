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
  console: mayGuest(perms, g.vmid, g.pool, "VM.Console"),
  configure: mayGuest(perms, g.vmid, g.pool, "VM.Config.Options"),
  cpu: mayGuest(perms, g.vmid, g.pool, "VM.Config.CPU"),
  memory: mayGuest(perms, g.vmid, g.pool, "VM.Config.Memory"),
  disk: mayGuest(perms, g.vmid, g.pool, "VM.Config.Disk"),
  clone: mayGuest(perms, g.vmid, g.pool, "VM.Clone"),
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
    items.push({ id: `pve:${h.id}:down:${g.id}`, severity: "warn", code: "pve.guestDown", detail: { ...base, guest: g.name, vmid: g.vmid, guestId: g.id } });
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

/** The line that puts Hata's client on a system, run as root; null — the system has no systemd for it */
export function clientLine(os: string, hata: string, code: string): string | null {
  const line = `curl -fsSL ${hata.replace(/\/$/, "")}/client/${code} | sh`;
  if (/^(debian|ubuntu)$/.test(os)) return `export DEBIAN_FRONTEND=noninteractive; apt-get update -q && apt-get install -y -q curl ca-certificates && ${line}`;
  if (/^(fedora|centos|rocky|alma)/.test(os)) return `dnf install -y -q curl && ${line}`;
  if (!os || os === "l26") return line;
  return null;
}

// --- A guest's settings --------------------------------------------------------------------------------

/** What the settings dialog changes in a guest */
export interface GuestSettings {
  /** A container's host name, a virtual machine's name */
  name: string;
  cores: number;
  /** MB */
  memory: number;
  /** MB, containers only */
  swap: number | null;
  onboot: boolean;
  tags: string[];
  description: string;
  /** The guest's own disks: they can be made larger, never smaller */
  disks: { key: string; storage: string; size: number }[];
}

/** `4G`, `512M`, `1T` in GiB; Proxmox writes a disk's size so */
export function gibOf(size: string): number {
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(size.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2]!.toUpperCase();
  return unit === "T" ? n * 1024 : unit === "G" ? n : unit === "M" ? n / 1024 : unit === "K" ? n / 1024 ** 2 : n / 1024 ** 3;
}

const QEMU_DISK = /^(scsi|virtio|sata|ide)\d+$/;
const LXC_DISK = /^(rootfs|mp\d+)$/;

/** A guest's `/config` read for the settings dialog */
export function readSettings(config: Record<string, unknown>, type: "lxc" | "qemu"): GuestSettings {
  const disks: GuestSettings["disks"] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string" || !(type === "lxc" ? LXC_DISK : QEMU_DISK).test(key)) continue;
    const [volume = "", ...opts] = value.split(",");
    // a CD drive, a folder of the host bound in, a passed-through device: nothing to grow
    if (opts.includes("media=cdrom") || volume === "none" || volume.startsWith("/") || !volume.includes(":")) continue;
    const size = opts.find((o) => o.startsWith("size="))?.slice(5);
    if (!size) continue;
    disks.push({ key, storage: volume.split(":")[0]!, size: gibOf(size) });
  }
  disks.sort((a, b) => (a.key === "rootfs" ? -1 : b.key === "rootfs" ? 1 : a.key.localeCompare(b.key, "en", { numeric: true })));
  const memory = Number(/(\d+)/.exec(String(config.memory ?? ""))?.[1] ?? 0);
  return {
    name: str(type === "lxc" ? config.hostname : config.name),
    cores: Number(config.cores ?? 1) || 1,
    memory: memory || (type === "lxc" ? 512 : 2048),
    swap: type === "lxc" ? Number(config.swap ?? 512) : null,
    onboot: config.onboot === 1 || config.onboot === "1",
    tags: str(config.tags).split(/[;, ]+/).filter(Boolean),
    description: str(config.description),
    disks,
  };
}

const GUEST_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const VM_NAME_RE = /^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$/i;
export const TAG_RE = /^[a-z0-9_][a-z0-9_+.-]{0,63}$/i;

/** What changes, as Proxmox takes it: `params` and `delete` for `/config`, then each disk to grow */
export interface SettingsChange {
  params: Record<string, string | number>;
  remove: string[];
  grow: { disk: string; size: string }[];
  /** Which rights the change needs: cpu, memory, disk, options */
  needs: ("cpu" | "memory" | "disk" | "options")[];
}

/** The answers of the dialog against what the guest has; a field not sent stays. A wrong one is refused by its name */
export function settingsChange(old: GuestSettings, input: Record<string, unknown>, type: "lxc" | "qemu"): SettingsChange {
  const bad = (field: string): never => {
    throw Object.assign(new Error("pve.setting"), { field });
  };
  const out: SettingsChange = { params: {}, remove: [], grow: [], needs: [] };
  const need = (what: SettingsChange["needs"][number]) => out.needs.includes(what) || out.needs.push(what);
  const whole = (v: unknown, min: number, max: number, field: string): number => {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : bad(field);
  };
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!(type === "lxc" ? GUEST_NAME_RE : VM_NAME_RE).test(name)) bad("name");
    if (name !== old.name) (out.params[type === "lxc" ? "hostname" : "name"] = name), need("options");
  }
  if (input.cores !== undefined) {
    const cores = whole(input.cores, 1, 512, "cores");
    if (cores !== old.cores) (out.params.cores = cores), need("cpu");
  }
  if (input.memory !== undefined) {
    const memory = whole(input.memory, 64, 4_194_304, "memory");
    if (memory !== old.memory) (out.params.memory = memory), need("memory");
  }
  if (input.swap !== undefined && type === "lxc") {
    const swap = whole(input.swap, 0, 4_194_304, "swap");
    if (swap !== old.swap) (out.params.swap = swap), need("memory");
  }
  if (input.onboot !== undefined) {
    if (typeof input.onboot !== "boolean") bad("onboot");
    if (input.onboot !== old.onboot) (out.params.onboot = input.onboot ? 1 : 0), need("options");
  }
  if (input.tags !== undefined) {
    const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter(Boolean))] : bad("tags");
    if (tags.length > 20 || tags.some((x) => !TAG_RE.test(x))) bad("tags");
    if (tags.join(";") !== old.tags.join(";")) {
      if (tags.length) out.params.tags = tags.join(";");
      else out.remove.push("tags");
      need("options");
    }
  }
  if (input.description !== undefined) {
    const description = typeof input.description === "string" ? input.description.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") : bad("description");
    if (description.length > 8000) bad("description");
    if (description.trim() !== old.description.trim()) {
      if (description.trim()) out.params.description = description;
      else out.remove.push("description");
      need("options");
    }
  }
  if (input.disks !== undefined) {
    if (!input.disks || typeof input.disks !== "object" || Array.isArray(input.disks)) bad("disk");
    for (const [key, value] of Object.entries(input.disks as Record<string, unknown>)) {
      const disk = old.disks.find((d) => d.key === key) ?? bad("disk");
      const size = whole(value, 1, 65_536, "disk");
      if (size < Math.ceil(disk.size - 0.001)) bad("diskShrink");
      if (size > disk.size + 0.001) out.grow.push({ disk: key, size: `${size}G` }), need("disk");
    }
  }
  return out;
}

// --- A backup put back -------------------------------------------------------------------------------

/** How a backup comes back: over the guest it was taken of, or as a new guest beside it */
export interface Restore {
  volid: string;
  vmid: number;
  /** Where the disks go; empty — where the backup says they were (virtual machines only) */
  storage: string;
  replace: boolean;
  pool: string;
}

/**
 * The request that restores a backup. A new guest gets new network cards (`unique`): with the old ones
 * it would take the original's address from the router while that one runs.
 */
export function restoreParams(type: "lxc" | "qemu", r: Restore): Record<string, string | number> {
  return {
    vmid: r.vmid,
    ...(type === "lxc" ? { ostemplate: r.volid, restore: 1 } : { archive: r.volid }),
    ...(r.storage ? { storage: r.storage } : {}),
    ...(r.replace ? { force: 1 } : { unique: 1 }),
    ...(r.pool && !r.replace ? { pool: r.pool } : {}),
  };
}

// --- Hata's own schedule of backups ------------------------------------------------------------------
// Proxmox's own jobs (`/cluster/backup`) need Sys.Modify on the whole server: a token kept narrow cannot
// make one. Hata runs its own instead, with the rights the token has, and keeps only its own copies.

export interface Schedule {
  on: boolean;
  /** HH:MM, the server's local time */
  time: string;
  storage: string;
  /** How many of the schedule's copies each guest keeps; older ones are deleted, no other copy is */
  keep: number;
  /** Every guest the token may back up, or these numbers */
  guests: "all" | number[];
}

/** What the notes of a scheduled copy end with: the only copies the schedule ever deletes */
export const SCHEDULE_MARK = "— Hata, by schedule";

/** The schedule's answers checked; a wrong one is refused by its name */
export function cleanSchedule(input: Record<string, unknown>, storages: string[]): Schedule {
  const bad = (field: string): never => {
    throw Object.assign(new Error("pve.schedule"), { field });
  };
  const on = input.on === true;
  const time = typeof input.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : bad("time");
  const storage = typeof input.storage === "string" && storages.includes(input.storage) ? input.storage : on ? bad("storage") : "";
  const keep = typeof input.keep === "number" && Number.isInteger(input.keep) && input.keep >= 1 && input.keep <= 30 ? input.keep : bad("keep");
  let guests: Schedule["guests"];
  if (input.guests === "all") guests = "all";
  else if (Array.isArray(input.guests) && input.guests.every((v) => Number.isInteger(v) && (v as number) >= 100)) guests = [...new Set(input.guests as number[])].sort((a, b) => a - b);
  else guests = bad("guests");
  if (on && Array.isArray(guests) && !guests.length) bad("guests");
  return { on, time, storage, keep, guests };
}

/** The local day, `2026-10-18` */
export const dayOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whether the schedule should run now: on, its time of today has come, and it has not run today */
export function scheduleDue(s: Schedule | undefined, ran: string | undefined, now: Date): boolean {
  if (!s?.on) return false;
  const [hh, mm] = s.time.split(":").map(Number) as [number, number];
  return now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm && ran !== dayOf(now);
}

/** The guests a schedule covers among those the token may back up */
export const scheduled = (s: Schedule, may: number[]): number[] => (s.guests === "all" ? may : s.guests.filter((v) => may.includes(v)));

/** The schedule's own copies beyond `keep`, per guest, oldest ones; a copy someone made or protected stays */
export function toPrune(list: { volid: string; vmid: number; at: number; notes: string; protected: boolean }[], keep: number): string[] {
  const out: string[] = [];
  const mine = list.filter((b) => !b.protected && b.notes.trim().endsWith(SCHEDULE_MARK));
  for (const vmid of new Set(mine.map((b) => b.vmid))) {
    out.push(...mine.filter((b) => b.vmid === vmid).sort((a, b) => b.at - a.at).slice(keep).map((b) => b.volid));
  }
  return out;
}

// --- Templates of containers --------------------------------------------------------------------------

/** A template Proxmox offers to download (`/nodes/<node>/aplinfo`) */
export interface Offered {
  template: string;
  /** system, turnkeylinux, mail */
  section: string;
  os: string;
  version: string;
  headline: string;
  description: string;
  /** Hata's client can go in: a system with apt or dnf */
  client: boolean;
  /** amd64, arm64; "" when Proxmox does not say */
  arch: string;
}

/** Proxmox's list read: the plain systems first, newest version of a name first; with `arch`, only what runs there */
export function readOffered(list: Record<string, unknown>[], arch = ""): Offered[] {
  const order = (s: string) => (s === "system" ? 0 : s === "turnkeylinux" ? 2 : 1);
  return list
    .filter((t) => str(t.type) === "lxc" && str(t.template) && (!arch || !str(t.architecture) || str(t.architecture) === arch))
    .map((t) => ({ template: str(t.template), section: str(t.section), os: str(t.os), version: str(t.version), headline: str(t.headline), description: str(t.description).slice(0, 300), client: familyOf(str(t.template)) !== null, arch: str(t.architecture) }))
    .sort((a, b) => order(a.section) - order(b.section) || a.headline.localeCompare(b.headline, "en") || b.version.localeCompare(a.version, "en", { numeric: true }));
}

/** A node's processor as its `/status` says it: x86 shows SSE2 among its flags */
export const archOf = (status: { cpuinfo?: { flags?: string } }): string => (/\bsse2\b/.test(status.cpuinfo?.flags ?? "") ? "amd64" : status.cpuinfo?.flags ? "arm64" : "");

/** A template's file name as Proxmox checks it: no folder, no way out of the storage */
export const TEMPLATE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.tar\.(gz|xz|zst)$/;

// --- Load over time ---------------------------------------------------------------------------------------

export const TIMEFRAMES = ["hour", "day", "week", "month"] as const;

/** One point of a graph: CPU 0..1, memory in bytes, network in bytes a second; null where Proxmox has nothing */
export interface Point {
  t: number;
  cpu: number | null;
  mem: number | null;
  maxmem: number | null;
  netin: number | null;
  netout: number | null;
}

/** `rrddata` read: a node says `memused`/`memtotal`, a guest `mem`/`maxmem`; a point with nothing at all is a gap */
export function readRrd(list: Record<string, unknown>[]): Point[] {
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return list
    .map((p) => ({ t: (n(p.time) ?? 0) * 1000, cpu: n(p.cpu), mem: n(p.mem) ?? n(p.memused), maxmem: n(p.maxmem) ?? n(p.memtotal), netin: n(p.netin), netout: n(p.netout) }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t);
}

// --- Clones --------------------------------------------------------------------------------------------

export interface Clone {
  newid: number;
  name: string;
  /** A linked clone shares its template's disks: only from a template, and only on the same storage */
  linked: boolean;
  storage: string;
  pool: string;
}

/** The request that clones a guest: a container names its host, a virtual machine itself; a full clone may move storage */
export function cloneParams(type: "lxc" | "qemu", c: Clone): Record<string, string | number> {
  return {
    newid: c.newid,
    [type === "lxc" ? "hostname" : "name"]: c.name,
    full: c.linked ? 0 : 1,
    ...(c.storage && !c.linked ? { storage: c.storage } : {}),
    ...(c.pool ? { pool: c.pool } : {}),
  };
}

// --- A node's versions ------------------------------------------------------------------------------------

/** Two Debian-like versions compared part by part, numbers as numbers: `7.0.14-24` > `7.0.14-20`; enough for Proxmox's own */
export function versionCompare(a: string, b: string): number {
  const pa = a.split(/[.\-+~:]/);
  const pb = b.split(/[.\-+~:]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const c = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y, "en", { numeric: true });
    if (c) return Math.sign(c);
  }
  return 0;
}

export interface Versions {
  /** pve-manager */
  manager: string;
  running: string;
  /** The newest kernel installed: when it is not the running one, a restart is needed to use it */
  newest: string;
  reboot: boolean;
  /** Proxmox's packages with a newer version to install */
  newer: { name: string; from: string; to: string }[];
}

/** `/nodes/<n>/apt/versions` read: `OldVersion` is installed, `Version` the one apt would install */
export function readVersions(list: Record<string, unknown>[]): Versions {
  const running = str(list.find((p) => p.RunningKernel)?.RunningKernel);
  const kernels = list
    .map((p) => /^proxmox-kernel-(\d[\w.]*-\d+-pve)(-signed)?$/.exec(str(p.Package))?.[1])
    .filter((k): k is string => !!k)
    .sort((a, b) => versionCompare(b, a));
  const newest = kernels[0] ?? running;
  const seen = new Set<string>();
  const newer = list
    .filter((p) => str(p.CurrentState) === "Installed" && str(p.OldVersion) && str(p.Version) && versionCompare(str(p.Version), str(p.OldVersion)) > 0)
    .map((p) => ({ name: str(p.Package), from: str(p.OldVersion), to: str(p.Version) }))
    .filter((p) => !seen.has(p.name) && seen.add(p.name));
  return { manager: str(list.find((p) => p.Package === "pve-manager")?.OldVersion), running, newest, reboot: !!running && !!newest && versionCompare(newest, running) > 0, newer };
}

// --- What a storage holds -------------------------------------------------------------------------------

export interface Volume {
  volid: string;
  /** images, rootdir, backup, iso, vztmpl, import, snippets */
  content: string;
  size: number;
  at: number;
  vmid: number | null;
  /** The guest it belongs to, when it is still there */
  guest: string;
  /** A disk or a backup of a guest that is gone */
  orphan: boolean;
  notes: string;
  protected: boolean;
}

/** `/storage/<s>/content` read against the guests there are; the largest first */
export function readContent(list: Record<string, unknown>[], guests: Map<number, string>): Volume[] {
  return list
    .map((v) => {
      const vmid = typeof v.vmid === "number" ? v.vmid : typeof v.vmid === "string" && /^\d+$/.test(v.vmid) ? Number(v.vmid) : null;
      return { volid: str(v.volid), content: str(v.content), size: num(v.size), at: num(v.ctime) * 1000, vmid, guest: vmid !== null ? (guests.get(vmid) ?? "") : "", orphan: vmid !== null && !guests.has(vmid), notes: str(v.notes), protected: v.protected === 1 };
    })
    .filter((v) => v.volid)
    .sort((a, b) => b.size - a.size);
}

// --- Images, discs and virtual machines of Hata's own -------------------------------------------------

/** A cloud image a system publishes for virtual machines: a disk with cloud-init inside, ready to start */
export interface CloudImage {
  id: string;
  name: string;
  /** How its system installs packages */
  family: "apt" | "dnf";
  url: string;
  /** The list of checksums published next to it */
  sums: string;
  algorithm: "sha256" | "sha512";
  /** The name in the list of checksums */
  listed: string;
  /** The name it gets on the storage: Proxmox takes a disk image by its extension */
  file: string;
}

const DEBIAN = (n: number, code: string) => (arch: string): CloudImage => ({
  id: `debian-${n}`,
  name: `Debian ${n} (${code})`,
  family: "apt",
  url: `https://cloud.debian.org/images/cloud/${code}/latest/debian-${n}-genericcloud-${arch}.qcow2`,
  sums: `https://cloud.debian.org/images/cloud/${code}/latest/SHA512SUMS`,
  algorithm: "sha512",
  listed: `debian-${n}-genericcloud-${arch}.qcow2`,
  file: `debian-${n}-genericcloud-${arch}.qcow2`,
});

const UBUNTU = (v: string, code: string) => (arch: string): CloudImage => ({
  id: `ubuntu-${v}`,
  name: `Ubuntu ${v} LTS (${code})`,
  family: "apt",
  url: `https://cloud-images.ubuntu.com/${code}/current/${code}-server-cloudimg-${arch}.img`,
  sums: `https://cloud-images.ubuntu.com/${code}/current/SHA256SUMS`,
  algorithm: "sha256",
  listed: `${code}-server-cloudimg-${arch}.img`,
  // Ubuntu's .img is a qcow2 disk
  file: `${code}-server-cloudimg-${arch}.qcow2`,
});

const IMAGES = [DEBIAN(13, "trixie"), DEBIAN(12, "bookworm"), UBUNTU("26.04", "resolute"), UBUNTU("24.04", "noble")];

/** The cloud images Hata offers for a node's processor; none when it is not known */
export const cloudImages = (arch: string): CloudImage[] => (arch === "amd64" || arch === "arm64" ? IMAGES.map((f) => f(arch)) : []);

/** A file's checksum in a published list (`<hex>  <name>`, or `<hex> *<name>`); null when it is not there */
export function sumFor(list: string, name: string): string | null {
  for (const line of list.split("\n")) {
    const m = /^([0-9a-f]{64}|[0-9a-f]{128})\s+\*?(\S+)\s*$/i.exec(line.trim());
    if (m && m[2] === name) return m[1]!.toLowerCase();
  }
  return null;
}

/** What a storage keeps: an installation disc, or a disk image a new virtual machine starts from */
export type UploadKind = "iso" | "import";

/** A file name Proxmox takes for a kind: no folder, an extension it knows */
export const ISO_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(iso|img)$/;
export const IMPORT_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(qcow2|raw|vmdk)$/;

/**
 * The name a file gets on the storage: the last part of its path or link, characters Proxmox refuses
 * made "-", and for a disk image the extension of what it is (`head` — its first bytes: a qcow2 disk
 * starts with `QFI\xfb`), because Proxmox reads the format from the name. null — nothing usable is left.
 */
export function uploadName(from: string, kind: UploadKind, head: Uint8Array): string | null {
  let name = (from.split(/[?#]/)[0]!.split("/").pop() ?? "").replace(/[^A-Za-z0-9._+-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  if (kind === "iso") {
    if (!/\.(iso|img)$/i.test(name)) name += ".iso";
    name = name.replace(/\.(iso|img)$/i, (e) => e.toLowerCase());
    return ISO_RE.test(name) && name.length <= 200 ? name : null;
  }
  const qcow = head.length >= 4 && head[0] === 0x51 && head[1] === 0x46 && head[2] === 0x49 && head[3] === 0xfb;
  const vmdk = head.length >= 4 && head[0] === 0x4b && head[1] === 0x44 && head[2] === 0x4d && head[3] === 0x56;
  const ext = qcow ? "qcow2" : vmdk ? "vmdk" : "raw";
  name = name.replace(/\.(qcow2|raw|vmdk|img)$/i, "") + "." + ext;
  return IMPORT_RE.test(name) && name.length <= 200 ? name : null;
}

/** How a disk image's system installs packages, by its name; null — not known, the client's line is tried as is */
export function imageFamily(volid: string): "apt" | "dnf" | null {
  const name = volid.split("/").pop()!.toLowerCase();
  if (/^(debian|ubuntu|noble|jammy|resolute|plucky|questing|trixie|bookworm)\b/.test(name)) return "apt";
  if (/^(fedora|rocky|alma|centos)/i.test(name)) return "dnf";
  return null;
}

/** What the server offers for a new virtual machine, per node; the rest is `NewOptions` */
export interface NewVmOptions extends NewOptions {
  /** Disk images (`local:import/….qcow2`) */
  images: Record<string, string[]>;
  /** Installation discs (`local:iso/….iso`) */
  isos: Record<string, string[]>;
  /** Storages a virtual machine's disk may go to */
  disks: Record<string, string[]>;
}

export interface NewVm {
  node: string;
  vmid: number;
  name: string;
  /** Started from a disk image with cloud-init, or installed from a disc by the person */
  from: "image" | "iso";
  address: string | null;
  family: "apt" | "dnf" | null;
  docker: boolean;
  client: boolean;
  /** The user cloud-init makes; the person's own password, or one of Hata's that is locked afterwards */
  user: string;
  password: string;
  ownPassword: boolean;
  /** The disk's size, GB: an image's disk is made larger to it once imported */
  disk: number;
  start: boolean;
  params: Record<string, string | number>;
  later: Record<string, string | number>;
}

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
/** Names a system keeps for itself: cloud-init would refuse them or break something */
const SYSTEM_USERS = new Set(["root", "daemon", "bin", "sys", "sync", "games", "man", "lp", "mail", "news", "uucp", "proxy", "backup", "list", "irc", "nobody", "systemd-network", "messagebus", "sshd", "_apt"]);
const SSH_KEY_RE = /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/=]+( [^\r\n]*)?$/;

/** A password nobody types: cloud-init needs one for the console, and it is locked once Hata is done */
export const throwawayPassword = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");

/** The new virtual machine's answers checked against what the server offers; every refusal names its field */
export function readNewVm(input: Record<string, unknown>, o: NewVmOptions, password = throwawayPassword()): NewVm {
  const bad = (field: string): never => {
    throw Object.assign(new Error("pve.badField"), { field });
  };
  const node = typeof input.node === "string" && o.nodes.includes(input.node) ? input.node : bad("node");
  const vmid = int(input.vmid, 100, 999_999_999) ?? bad("vmid");
  if (o.taken.includes(vmid)) bad("vmidTaken");
  if (o.ids && (vmid < o.ids.from || vmid > o.ids.to)) bad("vmidRange");
  const name = typeof input.hostname === "string" ? input.hostname.trim().toLowerCase() : "";
  if (!HOSTNAME_RE.test(name)) bad("hostname");
  const source = typeof input.source === "string" ? input.source : "";
  const from = o.images[node]?.includes(source) ? "image" : o.isos[node]?.includes(source) ? "iso" : bad("source");
  const storage = typeof input.storage === "string" && o.disks[node]?.includes(input.storage) ? input.storage : bad("storage");
  const bridge = typeof input.bridge === "string" && o.bridges[node]?.includes(input.bridge) ? input.bridge : bad("bridge");
  const disk = int(input.disk, 2, 4096) ?? bad("disk");
  const cores = int(input.cores, 1, 128) ?? bad("cores");
  const memory = int(input.memory, 256, 1_048_576) ?? bad("memory");
  const pool = typeof input.pool === "string" && input.pool ? (o.pools.includes(input.pool) ? input.pool : bad("pool")) : o.free ? "" : bad("pool");
  // the processor Proxmox's own page gives a new machine: through the API it would be kvm64, without
  // SSE4, and Bun (Hata's client) does not run there
  const params: Record<string, string | number> = { vmid, name, ostype: "l26", cpu: "x86-64-v2-AES", cores, memory, scsihw: "virtio-scsi-single", net0: `virtio,bridge=${bridge}`, agent: 1, ...(pool ? { pool } : {}) };
  const later = { onboot: input.onboot === false ? 0 : 1, tags: "hata", description: "Made by Hata" };
  if (from === "iso") {
    // an empty disk boots nothing, so the disc starts; the network is not in the order: a home network's PXE would answer first
    Object.assign(params, { scsi0: `${storage}:${disk},discard=on,iothread=1`, ide2: `${source},media=cdrom`, boot: "order=scsi0;ide2" });
    return { node, vmid, name, from, address: null, family: null, docker: false, client: false, user: "", password: "", ownPassword: false, disk, start: input.start !== false, params, later };
  }
  const user = typeof input.user === "string" && input.user.trim() ? input.user.trim() : "hata";
  if (!USER_RE.test(user) || SYSTEM_USERS.has(user)) bad("user");
  const own = typeof input.password === "string" ? input.password : "";
  if (own && (own.length < 8 || /[\r\n]/.test(own))) bad("password");
  const keys = typeof input.sshKeys === "string" ? input.sshKeys.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  if (keys.length > 10 || keys.some((k) => !SSH_KEY_RE.test(k))) bad("sshKeys");
  let ip = "ip=dhcp";
  let address: string | null = null;
  if (input.address !== undefined && input.address !== "dhcp" && input.address !== "") {
    const cidr = typeof input.address === "string" ? CIDR_RE.exec(input.address.trim()) : null;
    if (!cidr || !octets(cidr, 4) || Number(cidr[5]) < 8 || Number(cidr[5]) > 30) bad("address");
    const gw = typeof input.gateway === "string" ? IP_RE.exec(input.gateway.trim()) : null;
    if (!gw || !octets(gw, 4)) bad("gateway");
    address = cidr![0].split("/")[0]!;
    ip = `ip=${cidr![0]},gw=${gw![0]}`;
  }
  const client = input.client !== false;
  Object.assign(params, {
    scsi0: `${storage}:0,import-from=${source},discard=on,iothread=1`,
    ide2: `${storage}:cloudinit`,
    // the console Hata signs in on: cloud images print to it and keep a login there
    serial0: "socket",
    boot: "order=scsi0",
    ciuser: user,
    cipassword: own || password,
    ipconfig0: ip,
    // Proxmox wants the keys encoded once more inside the form
    ...(keys.length ? { sshkeys: encodeURIComponent(keys.join("\n") + "\n") } : {}),
  });
  return { node, vmid, name, from, address, family: imageFamily(source), docker: client && input.docker === true, client, user, password: own || password, ownPassword: !!own, disk, start: client || input.start !== false, params, later };
}

/**
 * The commands typed as root into a new virtual machine's console: cloud-init's work awaited, the guest
 * agent (Proxmox then knows its address and shuts it down cleanly), Docker if asked, Hata's client;
 * Hata's password locked when the person gave none of their own. One line: it is typed into a console.
 */
export function vmSetupLine(g: Pick<NewVm, "family" | "docker" | "client" | "user" | "ownPassword">, installLine: string): string {
  const steps = ["cloud-init status --wait >/dev/null 2>&1 || true"];
  if (g.family === "apt") steps.push("export DEBIAN_FRONTEND=noninteractive", "apt-get update -q", "apt-get install -y -q qemu-guest-agent curl ca-certificates");
  if (g.family === "dnf") steps.push("dnf install -y -q qemu-guest-agent curl ca-certificates");
  if (g.family) steps.push("(systemctl start qemu-guest-agent || true)");
  if (g.docker) steps.push("curl -fsSL https://get.docker.com | sh");
  if (g.client) steps.push(installLine);
  const body = steps.join(" && ");
  // the lock goes whatever happened above: the password was for this once
  return g.ownPassword ? `(${body})` : `(${body}); r=$?; passwd -l ${g.user} >/dev/null; (exit $r)`;
}
