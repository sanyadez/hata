/**
 * Containers and virtual machines on this server itself, made with Incus: what the page sends read and
 * checked, what Incus answers put into the shape the page shows, and the commands run inside a new one.
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
  family: "apt" | "dnf" | "";
  /** Offered as a container; a desktop is a virtual machine only */
  container: boolean;
  /** Offered for a virtual machine too: only images tried as one */
  vm: boolean;
  /** Docker can go in: by Docker's own script, or — "rhel" — from Docker's RHEL packages (its script does not know Rocky) */
  docker: boolean | "rhel";
  /** What a virtual machine of it needs at least: memory in MB, disk in GB */
  least?: { memory: number; disk: number };
}

export const IMAGES: Image[] = [
  { id: "debian-13", alias: "debian/13", name: "Debian 13", family: "apt", container: true, vm: true, docker: true },
  { id: "debian-12", alias: "debian/12", name: "Debian 12", family: "apt", container: true, vm: true, docker: true },
  { id: "ubuntu-24.04", alias: "ubuntu/24.04", name: "Ubuntu 24.04", family: "apt", container: true, vm: true, docker: true },
  { id: "ubuntu-24.04-desktop", alias: "ubuntu/24.04/desktop", name: "Ubuntu 24.04 Desktop", family: "apt", container: false, vm: true, docker: true, least: { memory: 4096, disk: 20 } },
  { id: "fedora-43", alias: "fedora/43", name: "Fedora 43", family: "dnf", container: true, vm: true, docker: true },
  { id: "rockylinux-9", alias: "rockylinux/9", name: "Rocky Linux 9", family: "dnf", container: true, vm: true, docker: "rhel" },
  { id: "alpine-3.22", alias: "alpine/3.22", name: "Alpine 3.22", family: "", container: true, vm: false, docker: false },
];

/** Where the images come from: the server of the people who make Incus */
export const IMAGE_SERVER = "https://images.linuxcontainers.org";

/** The bridge Hata makes for its containers, unless Incus has a network of its own already */
export const BRIDGE = "hatabr0";

/**
 * The bridge of the home network (made in Settings → Network, `network.ts`): an instance on it sits in the
 * home network beside the server, with an address from the router, as Proxmox's guests do on vmbr0.
 */
export const HOME_BRIDGE = "hatalan0";

/** Where an instance's network card is: in the home network, or on Hata's own network behind NAT; "" — elsewhere */
export type Network = "home" | "private" | "";

/** Where an instance's first network card leads, by its devices */
export function networkOf(devices: Record<string, Record<string, string>> | undefined): Network {
  const nic = Object.values(devices ?? {}).find((d) => d.type === "nic");
  if (!nic) return "";
  if (nic.parent === HOME_BRIDGE) return "home";
  return nic.network ? "private" : "";
}

/** The network card an instance gets: on the home bridge, or on Incus's network `net` */
export const nicFor = (network: "home" | "private", net: string): Record<string, string> => (network === "home" ? { type: "nic", name: "eth0", nictype: "bridged", parent: HOME_BRIDGE } : { type: "nic", name: "eth0", network: net });

/**
 * Hata's client file inside an instance moved to the other network: the address of Hata it names is the
 * bridge's on the network the instance leaves, and becomes the one on the network it joins. A file naming
 * Hata by another name (a domain) is left as it is; null — nothing to change.
 */
export function movedLink(text: string, from: string, to: string): string | null {
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof state.url !== "string" || !from || !to) return null;
  let url: URL;
  try {
    url = new URL(state.url);
  } catch {
    return null;
  }
  if (url.hostname !== from) return null;
  url.hostname = to;
  return JSON.stringify({ ...state, url: url.origin }, null, 2);
}

/** A container's name: Incus takes it as the host name too */
export const NAME_RE = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** Names the routes of the page take for themselves */
export const RESERVED = ["install", "setup", "vms", "places", "discs"];
export const SNAPSHOT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
export const MEMORY = { min: 128, max: 262144 };
/** The drivers whose pools can hold a container's disk to a size: a plain folder cannot */
export const LIMITED = ["btrfs", "zfs", "lvm"];

/** A virtual machine's disk, GB; Incus's own default is 10 */
export const DISK = { min: 4, max: 4096, standard: 10 };

export type Kind = "container" | "vm";

export class FieldError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export interface NewContainer {
  kind: Kind;
  name: string;
  image: Image;
  cores: number;
  /** MB; 0 — as much as the server has */
  memory: number;
  autostart: boolean;
  /** Docker inside: a container needs nesting for it */
  docker: boolean;
  client: boolean;
  /** GB: a virtual machine's disk, a container's limit (0 — none) */
  disk: number;
  /** In the home network, or on Hata's network behind NAT; null — as the default profile says */
  network: "home" | "private" | null;
}

const whole = (value: unknown, min: number, max: number, field: string): number => {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < min || n > max) throw new FieldError(field);
  return n;
};

/** A name for a new instance, a copy or a renamed one: also its host name, so the rules of one */
export function readName(input: unknown, taken: string[]): string {
  const name = String(input ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name) || name.includes("--") || RESERVED.includes(name)) throw new FieldError("name");
  if (taken.includes(name)) throw new FieldError("taken");
  return name;
}

/** What the "New container" dialog sent, checked */
export function readNew(input: Record<string, unknown>, taken: string[]): NewContainer {
  const name = readName(input.name, taken);
  const kind: Kind = input.kind === "vm" ? "vm" : "container";
  const image = IMAGES.find((i) => i.id === input.image);
  if (!image || (kind === "vm" ? !image.vm : !image.container)) throw new FieldError("image");
  const client = input.client !== false && image.family !== "";
  const least = kind === "vm" ? image.least : undefined;
  const memory = input.memory ? whole(input.memory, MEMORY.min, MEMORY.max, "memory") : 0;
  const disk = kind === "vm" ? (input.disk ? whole(input.disk, DISK.min, DISK.max, "disk") : Math.max(DISK.standard, least?.disk ?? 0)) : input.disk ? whole(input.disk, 1, DISK.max, "disk") : 0;
  // a desktop does not start in less: the page offers no less, a request asking less is refused
  if (least && memory < least.memory) throw new FieldError("memory");
  if (least && disk < least.disk) throw new FieldError("disk");
  return {
    kind,
    name,
    image,
    cores: whole(input.cores, 0, 256, "cores"),
    memory,
    autostart: input.autostart !== false,
    // Docker is put in by the same script as the client
    docker: client && image.docker !== false && input.docker === true,
    client,
    disk,
    network: readNetwork(input.network),
  };
}

/** The network asked for: home, private; null — not said */
export function readNetwork(input: unknown): "home" | "private" | null {
  if (input === undefined || input === null || input === "") return null;
  if (input !== "home" && input !== "private") throw new FieldError("network");
  return input;
}

/** The settings of a container Hata keeps: limits, start with the server, nesting */
export function configOf(c: Pick<NewContainer, "cores" | "memory" | "autostart"> & { docker?: boolean; kind?: Kind }): Record<string, string> {
  const config: Record<string, string> = { "boot.autostart": String(c.autostart), "user.hata": "true" };
  if (c.cores) config["limits.cpu"] = String(c.cores);
  if (c.memory) config["limits.memory"] = `${c.memory}MiB`;
  // Docker's own containers inside need it; it stays unprivileged on the host
  if (c.docker && c.kind !== "vm") config["security.nesting"] = "true";
  // the images of linuxcontainers.org are not signed for Secure Boot's keys
  if (c.kind === "vm") config["security.secureboot"] = "false";
  return config;
}

/**
 * Where QEMU shows a virtual machine's screen over VNC. Incus itself offers the screen over SPICE only, and the
 * page speaks VNC (the same client as for Proxmox), so QEMU is asked for a VNC socket too, in the instance's own
 * folder of Incus (made before QEMU starts, root's only).
 */
export const screenSocket = (name: string): string => `/run/incus/${name}/vnc.sock`;
const screenArg = (name: string): string => `-vnc unix:${screenSocket(name)}`;

/** `raw.qemu` with the screen in it; what was there is kept */
export function withScreen(raw: string, name: string): string {
  const arg = screenArg(name);
  return raw.includes(arg) ? raw : [raw.trim(), arg].filter(Boolean).join(" ");
}

/** `raw.qemu` of a machine renamed or copied: its screen moves to the folder of the new name; one without a screen stays so */
export function screenRenamed(raw: string, from: string, to: string): string {
  return raw.split(screenArg(from)).join(screenArg(to));
}

/**
 * `/etc/hostname` and `/etc/hosts` of a system renamed or copied, where they still say the old name (an image's
 * own templates may have done it already on a copy); `null` — nothing to change.
 */
export function hostFiles(files: { hostname: string | null; hosts: string | null }, from: string, to: string): { hostname?: string; hosts?: string } | null {
  // a system without the file (Fedora) takes its name from Incus; its hosts may still say the old one
  if (files.hostname !== null && files.hostname.trim() !== from) return null;
  const out: { hostname?: string; hosts?: string } = files.hostname === null ? {} : { hostname: to + "\n" };
  // the name as a whole word of a line: `127.0.1.1 box1`, never a part of another name
  const hosts = files.hosts?.replace(new RegExp(`(?<=^|\\s)${from}(?=\\s|$)`, "gm"), to);
  if (hosts !== undefined && hosts !== files.hosts) out.hosts = hosts;
  return Object.keys(out).length ? out : null;
}

/**
 * What a copy runs once, started without its network, so it is not taken for the original: Hata's client
 * forgets its pairing (it pairs anew, as a machine of its own; "hata-client" is printed when it was there),
 * the system gets an identity of its own (DHCP knows a system by it, so the copy would take the original's
 * address) and SSH host keys of its own.
 */
export const CLONE_SCRIPT = [
  "if [ -f /var/lib/hata-client/link.json ]; then systemctl disable --now hata-client.service >/dev/null 2>&1 || true; rm -f /var/lib/hata-client/link.json; echo hata-client; fi",
  // Debian's /var/lib/dbus/machine-id is a link to it: only a file of its own is removed
  "if [ -s /etc/machine-id ]; then rm -f /etc/machine-id; [ -L /var/lib/dbus/machine-id ] || rm -f /var/lib/dbus/machine-id; systemd-machine-id-setup >/dev/null 2>&1 || dbus-uuidgen --ensure=/etc/machine-id >/dev/null 2>&1 || true; fi",
  "if ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then rm -f /etc/ssh/ssh_host_*; ssh-keygen -A >/dev/null 2>&1 || true; fi",
].join("\n") + "\n";

/**
 * The request that copies an instance (`source` — its name, or `name/snapshot` for a running one): into the place
 * chosen, without its snapshots; its network cards switched off for the first start (`quiet`). Incus adds what
 * the original has and the request does not say, and gives the copy new MAC addresses.
 */
export function cloneRequest(src: { type: string; config?: Record<string, string>; devices?: Record<string, Record<string, string>>; expanded_devices?: Record<string, Record<string, string>> }, o: { from: string; name: string; source: string; pool: string; driver: string; quiet: string[] }): Record<string, unknown> {
  const root: Record<string, string> = { type: "disk", path: "/", ...(src.expanded_devices?.root ?? {}), ...(src.devices?.root ?? {}), pool: o.pool };
  // a plain folder cannot hold a container's disk to a size
  if (src.type === "container" && !LIMITED.includes(o.driver)) delete root.size;
  const raw = src.config?.["raw.qemu"] ?? "";
  const config = src.type === "virtual-machine" && raw.includes(screenArg(o.from)) ? { "raw.qemu": screenRenamed(raw, o.from, o.name) } : {};
  return {
    name: o.name,
    type: src.type,
    source: { type: "copy", source: o.source, instance_only: true },
    config,
    devices: { root, ...Object.fromEntries(o.quiet.map((k) => [k, { type: "none" }])) },
  };
}

/** The network cards of an instance, by device name: switched off for a copy's first start */
export const nicsOf = (devices: Record<string, Record<string, string>> | undefined): string[] => Object.entries(devices ?? {}).filter(([, d]) => d.type === "nic").map(([k]) => k);

/** The disk a new one gets: in the place chosen, of the size asked (a container's only where the place can hold it to one) */
export function devicesOf(c: Pick<NewContainer, "kind" | "disk">, pool: string, nic?: Record<string, string>): Record<string, Record<string, string>> {
  return { root: { type: "disk", path: "/", pool, ...(c.disk ? { size: `${c.disk}GiB` } : {}) }, ...(nic ? { eth0: nic } : {}) };
}

/**
 * The size a disk is to have after the limits dialog: `undefined` — unchanged; "" — no limit (a container
 * only); else Incus's size. A virtual machine's disk only grows: its file system would be cut otherwise.
 */
export function diskChange(input: unknown, now: number, kind: Kind): string | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const gb = whole(input, 0, DISK.max, "disk");
  if (gb === now) return undefined;
  if (kind === "vm") {
    if (gb < now || gb < DISK.min) throw new FieldError("diskShrink");
    return `${gb}GiB`;
  }
  return gb ? `${gb}GiB` : "";
}

/**
 * What the limits dialog changes: only what differs, as Incus keys ("" takes a limit away). A field not
 * sent stays as it is — an empty request takes nothing away.
 */
export function limitsChange(input: Record<string, unknown>, now: Record<string, string>): Record<string, string> {
  const wanted: Record<string, string> = {};
  if (input.cores !== undefined) {
    const cores = whole(input.cores, 0, 256, "cores");
    wanted["limits.cpu"] = cores ? String(cores) : "";
  }
  if (input.memory !== undefined) {
    const memory = input.memory ? whole(input.memory, MEMORY.min, MEMORY.max, "memory") : 0;
    wanted["limits.memory"] = memory ? `${memory}MiB` : "";
  }
  if (input.autostart !== undefined) wanted["boot.autostart"] = String(input.autostart !== false);
  if (input.nesting !== undefined) wanted["security.nesting"] = input.nesting === true ? "true" : "";
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
  kind: Kind;
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
  /** The pool it lives in */
  place: string;
  /** GB its disk is held to; 0 — none */
  disk: number;
  /** The disc image in its drive (a virtual machine made from one); "" — none */
  disc: string;
  /** Where its network card is */
  network: Network;
  usage: { memory: number; cpu: number; disk: number; processes: number } | null;
  snapshots: Snapshot[];
}

type Raw = Record<string, any>;

const statusOf = (s: string): Container["status"] => {
  const low = (s ?? "").toLowerCase();
  return low === "running" || low === "stopped" || low === "frozen" || low === "error" ? low : "other";
};

/** A container or a virtual machine as `GET /1.0/instances?recursion=2` gives it; null — something else */
export function readInstance(raw: Raw): Container | null {
  if (raw.type !== "container" && raw.type !== "virtual-machine") return null;
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
    kind: raw.type === "virtual-machine" ? "vm" : "container",
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
    place: String(raw.expanded_devices?.root?.pool ?? raw.devices?.root?.pool ?? ""),
    disk: Math.round(megabytes(raw.expanded_devices?.root?.size ?? raw.devices?.root?.size) / 1024),
    disc: String(raw.devices?.[DISC_DEVICE]?.source ?? raw.devices?.[DRIVERS_DEVICE]?.source ?? ""),
    network: networkOf(raw.expanded_devices ?? raw.devices),
    usage: st && statusOf(raw.status) === "running" ? { memory: Number(st.memory?.usage ?? 0), cpu: Number(st.cpu?.usage ?? 0), disk: Number(st.disk?.root?.usage ?? 0), processes: Number(st.processes ?? 0) } : null,
    snapshots: ((raw.snapshots ?? []) as Raw[]).map((s) => ({ name: String(s.name).split("/").pop()!, created: Date.parse(s.created_at) || 0 })).sort((a, b) => b.created - a.created),
  };
}

// --- Disc images -----------------------------------------------------------------------------------

/** A disc image (ISO) Incus keeps as a volume of a place, for virtual machines to boot from */
export interface Disc {
  /** The place (pool) it is kept in */
  place: string;
  name: string;
  /** Bytes; 0 — not known */
  size: number;
  /** The instances it is in the drive of */
  usedBy: string[];
}

/** The device a disc image is put in as: booted before the virtual machine's own disk */
export const DISC_DEVICE = "disc";
export const DISC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The disc images among a place's custom volumes, as `GET …/volumes/custom?recursion=1` gives them */
export function readDiscs(place: string, volumes: Raw[]): Disc[] {
  return volumes
    .filter((v) => v.content_type === "iso")
    .map((v) => ({
      place,
      name: String(v.name),
      size: Number(v.config?.size ?? 0) || 0,
      usedBy: ((v.used_by ?? []) as string[]).map((u) => decodeURIComponent(String(u).split("?")[0]!.split("/").pop() ?? "")).filter(Boolean),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The name a disc image is kept under, from what it was called — a file's name or the last part of a link:
 * what a volume's name cannot hold becomes "-", ".iso" stays at the end; "" — nothing usable is left.
 */
export function discName(from: unknown): string {
  const last = decodeURIComponent(String(from ?? "").split(/[?#]/)[0]!.split(/[\\/]/).pop() ?? "").trim();
  const bare = last.replace(/\.iso$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+|[-.]+$/g, "").slice(0, 90);
  return bare ? `${bare}.iso` : "";
}

/** A virtual machine to be made from a disc image: an empty disk of its size, the disc booted first */
export interface NewFromDisc {
  name: string;
  disc: Disc;
  cores: number;
  memory: number;
  disk: number;
  autostart: boolean;
  /** Windows: TPM, Secure Boot, its disk on NVMe and the disc on USB — both seen without drivers */
  windows: boolean;
  /** The disc of virtio drivers put in a second drive for Windows (its network needs them); null — none here */
  drivers: Disc | null;
  network: "home" | "private" | null;
}

/** What Windows 11 asks of a machine: memory in MB, disk in GB */
export const WINDOWS = { memory: 4096, disk: 64 };

/** The drivers' disc for Windows, by the name of Fedora's published one */
export const DRIVERS_RE = /^virtio-win/i;
export const DRIVERS_URL = "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso";

/** The new-machine dialog's answers for a machine from a disc (`image` is `disc:<place>/<name>`); a wrong field throws */
export function readNewFromDisc(input: Record<string, unknown>, taken: string[], discs: Disc[]): NewFromDisc {
  const name = readName(input.name, taken);
  const wanted = String(input.image ?? "").replace(/^disc:/, "");
  const disc = discs.find((d) => `${d.place}/${d.name}` === wanted);
  if (!disc) throw new FieldError("image");
  const windows = input.windows === true;
  const memory = input.memory ? whole(input.memory, MEMORY.min, MEMORY.max, "memory") : windows ? WINDOWS.memory : 0;
  // a system installed from a disc wants room: most installers ask for 10–20 GB, Windows 11 for 64
  const disk = input.disk ? whole(input.disk, DISK.min, DISK.max, "disk") : windows ? WINDOWS.disk : DISC_DISK;
  if (windows && memory < WINDOWS.memory) throw new FieldError("memory");
  if (windows && disk < WINDOWS.disk) throw new FieldError("disk");
  return {
    name,
    disc,
    cores: whole(input.cores, 0, 256, "cores"),
    memory,
    disk,
    autostart: input.autostart !== false,
    windows,
    drivers: windows ? (discs.find((d) => DRIVERS_RE.test(d.name) && d !== disc) ?? null) : null,
    network: readNetwork(input.network),
  };
}

/** The settings of a machine from a disc; Windows boots with Secure Boot (Microsoft's keys) and is told so to Incus */
export function discConfig(c: NewFromDisc): Record<string, string> {
  const config = configOf({ ...c, kind: "vm" });
  config["image.description"] = c.disc.name.replace(/\.iso$/i, "");
  if (c.windows) {
    config["security.secureboot"] = "true";
    config["image.os"] = "Windows";
  }
  return config;
}

/** GB of a new machine's disk when one is made from a disc */
export const DISC_DISK = 20;

/** The devices of a machine made from a disc: its own disk in the place, the disc in its drive */
export function discDevices(c: NewFromDisc, pool: string, nic?: Record<string, string>): Record<string, Record<string, string>> {
  const devices: Record<string, Record<string, string>> = { ...devicesOf({ kind: "vm", disk: c.disk }, pool, nic), [DISC_DEVICE]: { type: "disk", pool: c.disc.place, source: c.disc.name, "boot.priority": "10" } };
  if (!c.windows) return devices;
  // the installer of Windows knows neither virtio-scsi nor virtio's network: NVMe and USB it knows
  devices.root!["io.bus"] = "nvme";
  devices[DISC_DEVICE]!["io.bus"] = "usb";
  devices.tpm = { type: "tpm", path: "/dev/tpm0" };
  if (c.drivers) devices[DRIVERS_DEVICE] = { type: "disk", pool: c.drivers.place, source: c.drivers.name, "io.bus": "usb" };
  return devices;
}

/** The second drive, with the drivers' disc for Windows */
export const DRIVERS_DEVICE = "drivers";

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
export function setupScript(c: Pick<NewContainer, "docker" | "client"> & { family?: Image["family"]; dockerFrom?: Image["docker"] }, clientLine: string): string {
  const lines = [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    // the container gets its address a moment after it starts
    `for i in $(seq 1 60); do getent hosts ${c.family === "dnf" ? "mirrors.fedoraproject.org" : "deb.debian.org"} >/dev/null 2>&1 && break; sleep 1; done`,
    ...(c.family === "dnf" ? ["dnf install -y -q curl ca-certificates"] : ["apt-get update -q", "apt-get install -y -q curl ca-certificates"]),
  ];
  if (c.docker && c.dockerFrom === "rhel") {
    lines.push(
      "dnf install -y -q dnf-plugins-core",
      "dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo",
      "dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin",
      "systemctl enable --now docker",
    );
  } else if (c.docker) lines.push("curl -fsSL https://get.docker.com | sh");
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

// --- Where the containers live -------------------------------------------------------------------------

/** Whether `path` is `dir` or lies inside it */
const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(dir.replace(/\/$/, "") + "/");

/** File systems a pool cannot live on: no owners (FAT, exFAT, NTFS), another machine's, or a program's (FUSE) */
const UNFIT_FS = /^(vfat|msdos|exfat|ntfs3?|fuseblk|nfs\d?|cifs|smb3|smbfs|9p|ceph|glusterfs|fuse\..+|tmpfs|ramfs|overlay|squashfs)$/;

export interface PlaceUses {
  /** Every mount, longest path wins */
  mounts: { path: string; fstype: string }[];
  dataRoot: string;
  backupDir: string;
  /** Hata's own state and secrets */
  state: string[];
  /** The folders the pools there are already in */
  pools: string[];
}

/**
 * Whether a folder may hold a storage pool, and which driver Incus is given for it: btrfs where the
 * file system is btrfs (then a container's disk can be limited), plain folders elsewhere. Not inside the
 * data folder (it is mounted into apps and shared), the backups or Hata's state, not inside another pool
 * and none inside it, not on a file system that keeps no owners or belongs to another machine.
 */
export function placeFor(input: unknown, uses: PlaceUses): { path: string; driver: "dir" | "btrfs"; fstype: string } | { error: string } {
  if (typeof input === "string" && input.trim() === "/") return { error: "containers.place.system" };
  const path = typeof input === "string" ? input.trim().replace(/\/+$/, "") : "";
  if (!path.startsWith("/") || path.includes("/../") || path.endsWith("/..") || path.includes("\0")) return { error: "containers.place.bad" };
  const top = path.split("/")[1] ?? "";
  if (!path || ["bin", "boot", "dev", "etc", "lib", "lib64", "proc", "run", "sbin", "sys", "usr", "tmp"].includes(top) || path === "/" || path === "/var") return { error: "containers.place.system" };
  if (uses.state.some((dir) => inside(path, dir) || inside(dir, path))) return { error: "containers.place.state" };
  if (uses.dataRoot && (inside(path, uses.dataRoot) || inside(uses.dataRoot, path))) return { error: "containers.place.data" };
  if (uses.backupDir && (inside(path, uses.backupDir) || inside(uses.backupDir, path))) return { error: "containers.place.backups" };
  if (uses.pools.some((pool) => inside(path, pool) || inside(pool, path))) return { error: "containers.place.taken" };
  const holder = uses.mounts.filter((m) => inside(path, m.path)).sort((a, b) => b.path.length - a.path.length)[0];
  const fstype = holder?.fstype ?? "";
  if (UNFIT_FS.test(fstype)) return { error: "containers.place.fs" };
  return { path, driver: fstype === "btrfs" ? "btrfs" : "dir", fstype };
}

/** A pool's name made of its folder: `disk1` for /mnt/disk1/containers' parent… the last word that fits */
export function poolName(path: string, taken: string[]): string {
  const words = path.split("/").filter(Boolean).reverse();
  const base = (words.find((w) => /^[a-z0-9][a-z0-9-]*$/i.test(w) && !/^(containers|incus|storage-pools)$/i.test(w)) ?? "place").toLowerCase().slice(0, 40);
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}-${i}`;
  return name;
}

// --- What needs attention -----------------------------------------------------------------------------

/** How long Incus may stay silent before it is said: a restart of it (new packages) takes a moment */
export const SILENT_MS = 2 * 60_000;

export interface Trouble {
  id: string;
  severity: "danger" | "warn";
  code: string;
  detail: Record<string, string | number>;
}

/**
 * The attention items of the containers: Incus that stopped answering, an instance in an error state,
 * one that starts with the server but is stopped — unless somebody stopped it through Hata.
 */
export function trouble(input: { installed: boolean; silentSince: number | null; instances: Pick<Container, "name" | "kind" | "status" | "autostart" | "place">[]; stoppedByHand: string[]; now: number; placesAway?: { name: string; path: string }[] }): Trouble[] {
  if (!input.installed) return [];
  if (input.silentSince !== null) return input.now - input.silentSince >= SILENT_MS ? [{ id: "incus:away", severity: "danger", code: "containers.away", detail: {} }] : [];
  const items: Trouble[] = [];
  for (const c of input.instances) {
    const kind = c.kind === "vm" ? "vm" : "container";
    if (c.status === "error") items.push({ id: `incus:${c.name}`, severity: "danger", code: "containers.error", detail: { name: c.name, kind } });
    else if (c.status === "stopped" && c.autostart && !input.stoppedByHand.includes(c.name)) {
      // its place is gone (a disk not connected): Incus starts it by itself once the place is back
      const away = input.placesAway?.find((p) => p.name === c.place);
      items.push(away ? { id: `incus:${c.name}`, severity: "warn", code: "containers.placeAway", detail: { name: c.name, kind, place: away.name, path: away.path } } : { id: `incus:${c.name}`, severity: "warn", code: "containers.down", detail: { name: c.name, kind } });
    }
  }
  return items;
}
