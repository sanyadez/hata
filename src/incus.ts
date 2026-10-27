/**
 * Containers on this server itself, made with Incus: what the page sends read and checked, what Incus
 * answers put into the shape the page shows, and the commands run inside a new container.
 *
 * Pure and tested; the requests themselves are in `containers.ts`.
 */

/** The systems a container is made from: only these, each tried with Hata's client in it */
export interface Image {
  id: string;
  /** The image's name on the image server */
  alias: string;
  name: string;
  /** How its packages are installed; "" — Hata's client does not go on it (no systemd) */
  family: "apt" | "";
}

export const IMAGES: Image[] = [
  { id: "debian-13", alias: "debian/13", name: "Debian 13", family: "apt" },
  { id: "debian-12", alias: "debian/12", name: "Debian 12", family: "apt" },
  { id: "ubuntu-24.04", alias: "ubuntu/24.04", name: "Ubuntu 24.04", family: "apt" },
  { id: "alpine-3.22", alias: "alpine/3.22", name: "Alpine 3.22", family: "" },
];

/** Where the images come from: the server of the people who make Incus */
export const IMAGE_SERVER = "https://images.linuxcontainers.org";

/** The bridge Hata makes for its containers, unless Incus has a network of its own already */
export const BRIDGE = "hatabr0";

/** A container's name: Incus takes it as the host name too */
export const NAME_RE = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
export const SNAPSHOT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
export const MEMORY = { min: 128, max: 262144 };

export class FieldError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export interface NewContainer {
  name: string;
  image: Image;
  cores: number;
  /** MB; 0 — as much as the server has */
  memory: number;
  autostart: boolean;
  /** Docker inside: needs nesting */
  docker: boolean;
  client: boolean;
}

const whole = (value: unknown, min: number, max: number, field: string): number => {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < min || n > max) throw new FieldError(field);
  return n;
};

/** What the "New container" dialog sent, checked */
export function readNew(input: Record<string, unknown>, taken: string[]): NewContainer {
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name) || name.includes("--")) throw new FieldError("name");
  if (taken.includes(name)) throw new FieldError("taken");
  const image = IMAGES.find((i) => i.id === input.image);
  if (!image) throw new FieldError("image");
  const client = input.client !== false && image.family !== "";
  return {
    name,
    image,
    cores: whole(input.cores, 0, 256, "cores"),
    memory: input.memory ? whole(input.memory, MEMORY.min, MEMORY.max, "memory") : 0,
    autostart: input.autostart !== false,
    // Docker is put in by the same script as the client
    docker: client && input.docker === true,
    client,
  };
}

/** The settings of a container Hata keeps: limits, start with the server, nesting */
export function configOf(c: Pick<NewContainer, "cores" | "memory" | "autostart"> & { docker?: boolean }): Record<string, string> {
  const config: Record<string, string> = { "boot.autostart": String(c.autostart), "user.hata": "true" };
  if (c.cores) config["limits.cpu"] = String(c.cores);
  if (c.memory) config["limits.memory"] = `${c.memory}MiB`;
  // Docker's own containers inside need it; it stays unprivileged on the host
  if (c.docker) config["security.nesting"] = "true";
  return config;
}

/** What the limits dialog changes: only what differs, as Incus keys ("" takes a limit away) */
export function limitsChange(input: Record<string, unknown>, now: Record<string, string>): Record<string, string> {
  const cores = whole(input.cores, 0, 256, "cores");
  const memory = input.memory ? whole(input.memory, MEMORY.min, MEMORY.max, "memory") : 0;
  const wanted: Record<string, string> = {
    "limits.cpu": cores ? String(cores) : "",
    "limits.memory": memory ? `${memory}MiB` : "",
    "boot.autostart": String(input.autostart !== false),
    "security.nesting": input.nesting === true ? "true" : "",
  };
  const change: Record<string, string> = {};
  for (const [key, value] of Object.entries(wanted)) if ((now[key] ?? "") !== value && !(key === "boot.autostart" && !now[key] && value === "false")) change[key] = value;
  return change;
}

/** Megabytes in an Incus size: "512MiB", "2GiB", "1GB", "1073741824" */
export function megabytes(size: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)\s*([KMGT]i?B|B)?$/i.exec((size ?? "").trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = (m[2] ?? "B").toUpperCase();
  const power = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit] ?? 0;
  const base = unit.includes("I") || unit === "B" ? 1024 : 1000;
  return Math.round((n * base ** power) / 1024 ** 2);
}

export interface Snapshot {
  name: string;
  created: number;
}

export interface Container {
  name: string;
  status: "running" | "stopped" | "frozen" | "error" | "other";
  /** The system it was made from, as the image said */
  os: string;
  cores: number;
  /** MB, 0 — no limit */
  memory: number;
  autostart: boolean;
  nesting: boolean;
  /** Made by Hata */
  ours: boolean;
  created: number;
  address: string;
  mac: string;
  usage: { memory: number; cpu: number; disk: number; processes: number } | null;
  snapshots: Snapshot[];
}

type Raw = Record<string, any>;

const statusOf = (s: string): Container["status"] => {
  const low = (s ?? "").toLowerCase();
  return low === "running" || low === "stopped" || low === "frozen" || low === "error" ? low : "other";
};

/** A container as `GET /1.0/instances?recursion=2` gives it; null — not a container (a virtual machine) */
export function readInstance(raw: Raw): Container | null {
  if (raw.type !== "container") return null;
  const config: Record<string, string> = raw.config ?? {};
  const st: Raw | null = raw.state ?? null;
  // the container's own card first: Docker inside adds bridges of its own (docker0 172.17.0.1)
  const mac = String(config["volatile.eth0.hwaddr"] ?? "").toLowerCase();
  const nics = Object.entries((st?.network ?? {}) as Record<string, Raw>)
    .filter(([name, n]) => name !== "lo" && n.type !== "loopback" && !/^(docker|br-|veth|virbr|lxcbr|incusbr)/.test(name))
    .sort(([a, x], [b, y]) => Number(String(y.hwaddr).toLowerCase() === mac || b === "eth0") - Number(String(x.hwaddr).toLowerCase() === mac || a === "eth0"));
  const inet = nics.flatMap(([, n]) => ((n.addresses ?? []) as Raw[]).filter((a) => a.family === "inet" && a.scope === "global").map((a) => String(a.address)));
  const os = [config["image.os"], config["image.release"] ?? config["image.version"]].filter(Boolean).join(" ");
  return {
    name: String(raw.name),
    status: statusOf(raw.status),
    os: os ? os.charAt(0).toUpperCase() + os.slice(1) : String(config["image.description"] ?? ""),
    cores: Number(config["limits.cpu"] ?? 0) || 0,
    memory: megabytes(config["limits.memory"]),
    autostart: config["boot.autostart"] === "true",
    nesting: config["security.nesting"] === "true",
    ours: config["user.hata"] === "true",
    created: Date.parse(raw.created_at) || 0,
    address: inet[0] ?? "",
    mac: mac || String(nics[0]?.[1]?.hwaddr ?? "").toLowerCase(),
    usage: st && statusOf(raw.status) === "running" ? { memory: Number(st.memory?.usage ?? 0), cpu: Number(st.cpu?.usage ?? 0), disk: Number(st.disk?.root?.usage ?? 0), processes: Number(st.processes ?? 0) } : null,
    snapshots: ((raw.snapshots ?? []) as Raw[]).map((s) => ({ name: String(s.name).split("/").pop()!, created: Date.parse(s.created_at) || 0 })).sort((a, b) => b.created - a.created),
  };
}

/**
 * Whether Hata itself runs inside a container that maps only a part of the user ids (an unprivileged
 * LXC): containers made there would need ids it does not have — the person's decision is that nothing
 * is made then. `/proc/self/uid_map` of the host and of a privileged container is the whole range.
 */
export function insideNarrowMap(uidMap: string): boolean {
  const rows = uidMap.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  if (!rows.length || rows.some((r) => r.length !== 3 || r.some((n) => !Number.isFinite(n)))) return false;
  return !(rows.length === 1 && rows[0]![0] === 0 && rows[0]![1] === 0 && rows[0]![2] === 4294967295);
}

/**
 * The rules that let a bridge's containers out while Docker is there: Docker turns the policy of
 * FORWARD to DROP, and `DOCKER-USER` is the chain it leaves to others. As arguments after `-C`/`-I DOCKER-USER`.
 */
export function bridgeRules(bridge: string): string[][] {
  return [
    ["-i", bridge, "-j", "ACCEPT"],
    ["-o", bridge, "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"],
  ];
}

/** Shell lines taking those rules away, for the uninstaller; nothing fails when they are not there */
export function bridgeRulesDown(bridge: string): string[] {
  return bridgeRules(bridge).map((rule) => `while iptables -D DOCKER-USER ${rule.join(" ")} 2>/dev/null; do :; done`);
}

/**
 * What runs inside a new container: the network awaited, then Docker when asked and Hata's client.
 * `clientLine` is the usual `curl … | sh` with an invite, or "" when the client is not wanted.
 */
export function setupScript(c: Pick<NewContainer, "docker" | "client">, clientLine: string): string {
  const lines = [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    // the container gets its address a moment after it starts
    'for i in $(seq 1 60); do getent hosts deb.debian.org >/dev/null 2>&1 && break; sleep 1; done',
    "apt-get update -q",
    "apt-get install -y -q curl ca-certificates",
  ];
  if (c.docker) lines.push("curl -fsSL https://get.docker.com | sh");
  if (c.client && clientLine) lines.push(clientLine);
  return lines.join("\n") + "\n";
}

/** A snapshot's name: the one given, or one made of the time */
export function snapshotName(input: unknown, now = new Date()): string {
  const given = typeof input === "string" ? input.trim() : "";
  if (given) {
    if (!SNAPSHOT_RE.test(given)) throw new FieldError("snapshot");
    return given;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `snap-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
