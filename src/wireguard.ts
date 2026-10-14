/**
 * WireGuard, both ways (Settings → Remote access).
 *
 * **In**: this server takes connections from the person's own devices. Hata makes the keys, gives every
 * device an address and its configuration — as a QR code for a phone, as a file for a computer — and
 * decides per device whether it sees the server alone or the home network through it. It needs an
 * address the server is reached at from outside and one UDP port passed on by the router; that part is
 * the person's, and the page says which port and where.
 *
 * **Out**: this server joins somebody else's WireGuard — a VPS, a provider — from the configuration
 * file they hand out.
 *
 * The work is done by the system's `wg-quick` (the package wireguard-tools, installed by its button):
 * Hata writes `/etc/wireguard/hata-wg.conf` and `hata-wgc.conf` whole and starts their units. Keys are
 * made here with WebCrypto. The files, the addresses and what `wg` reports are pure and tested.
 */
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { SECRETS_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { homeLinks } from "./mdns";
import { installCommand, PATH, run } from "./packages";
import { siteDomain } from "./site";
import { homeNetworks } from "./tailscale";

export const SERVER_IF = "hata-wg";
export const CLIENT_IF = "hata-wgc";
const CONF_DIR = "/etc/wireguard";
const PACKAGE = "wireguard-tools";
const MAX_DEVICES = 100;

export interface Device {
  id: string;
  name: string;
  /** Its address inside the tunnel, `10.77.0.2` */
  address: string;
  publicKey: string;
  privateKey: string;
  presharedKey: string;
  /** May reach the home network through the server, not the server alone */
  lan: boolean;
  createdAt: number;
}

interface Saved {
  server: {
    enabled: boolean;
    port: number;
    /** The name or address the server is reached at from outside, without the port */
    endpoint: string;
    /** The tunnel's own network, `10.77.0`: the server is `.1`, devices follow */
    subnet: string;
    privateKey: string;
    publicKey: string;
    devices: Device[];
  };
  client: { enabled: boolean; conf: string };
}

/** What `wg show <interface> dump` tells about one peer */
export interface Peer {
  publicKey: string;
  /** Where it last spoke from; "" — never seen */
  endpoint: string;
  /** The last time the two sides agreed on keys, ms; 0 — never. Fresh means connected */
  handshake: number;
  received: number;
  sent: number;
}

// --- Pure -------------------------------------------------------------------------------------------

const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/** The devices' part of an address: letters, digits, a few signs; what a file name and a list can carry */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 40 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}

/** A host name or an address, without a port; null — not one */
export function cleanEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "") return "";
  return /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) || /^[0-9a-f:]{3,39}$/.test(host) ? host : null;
}

/** The first tunnel network that is none of the networks this machine is on already */
export function pickSubnet(taken: string[]): string {
  for (const second of [77, 78, 79, 80, 81, 82, 83]) if (!taken.some((net) => net.startsWith(`10.${second}.`) || /^10\.0\.0\.0\/([89]|1[0-5])$/.test(net))) return `10.${second}.0`;
  return "172.31.77";
}

/** The lowest free address for a new device; null — the network is full */
export function nextAddress(subnet: string, devices: Pick<Device, "address">[]): string | null {
  const used = new Set(devices.map((device) => device.address));
  for (let host = 2; host < 255; host++) if (!used.has(`${subnet}.${host}`)) return `${subnet}.${host}`;
  return null;
}

const CHAIN = "HATA-WG";

/**
 * Who of the tunnel may go further than the server, as commands. What comes out of the tunnel towards
 * another network goes through a chain of Hata's own: a device allowed into the home network has a
 * rule there, everything else is dropped — also on a machine whose firewall would let it through. `up`
 * empties the chain and fills it anew, so it can be run again at any time and nothing of an earlier
 * list of devices stays behind.
 */
export function firewall(server: Pick<Saved["server"], "subnet" | "devices">, iface: string): { up: string[]; down: string[] } {
  const disguise = (how: string) => `iptables -t nat -${how} POSTROUTING -s ${server.subnet}.0/24 ! -o ${iface} -j MASQUERADE`;
  const sharing = server.devices.some((device) => device.lan);
  return {
    up: [
      `iptables -N ${CHAIN} 2>/dev/null; iptables -F ${CHAIN}`,
      `iptables -A ${CHAIN} -o ${iface} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`,
      ...server.devices.filter((device) => device.lan).map((device) => `iptables -A ${CHAIN} -i ${iface} -s ${device.address} -j ACCEPT`),
      `iptables -A ${CHAIN} -i ${iface} -j DROP`,
      `iptables -C FORWARD -j ${CHAIN} 2>/dev/null || iptables -I FORWARD -j ${CHAIN}`,
      // going further means passing packets on, under the server's own address
      ...(sharing ? ["sysctl -q -w net.ipv4.ip_forward=1", `${disguise("C")} 2>/dev/null || ${disguise("I")}`] : [`${disguise("D")} 2>/dev/null; true`]),
    ],
    down: [`iptables -D FORWARD -j ${CHAIN}; iptables -F ${CHAIN}; iptables -X ${CHAIN}; true`, `${disguise("D")} 2>/dev/null; true`],
  };
}

/** The server's side, as `wg-quick` reads it */
export function serverConf(server: Saved["server"], iptables: boolean): string {
  const lines = ["# Written by Hata — changes made here are lost", "[Interface]", `Address = ${server.subnet}.1/24`, `ListenPort = ${server.port}`, `PrivateKey = ${server.privateKey}`];
  if (iptables) {
    const rules = firewall(server, "%i");
    lines.push(...rules.up.map((command) => `PostUp = ${command}`), ...rules.down.map((command) => `PostDown = ${command}`));
  }
  for (const device of server.devices) lines.push("", `# ${device.name.replace(/[\r\n]/g, " ")}`, "[Peer]", `PublicKey = ${device.publicKey}`, `PresharedKey = ${device.presharedKey}`, `AllowedIPs = ${device.address}/32`);
  return lines.join("\n") + "\n";
}

/** What a device is given: its own key, where the server is, and what goes into the tunnel */
export function deviceConf(device: Device, server: Pick<Saved["server"], "publicKey" | "endpoint" | "port" | "subnet">, networks: string[]): string {
  const host = server.endpoint.includes(":") ? `[${server.endpoint}]` : server.endpoint;
  const allowed = [device.lan ? `${server.subnet}.0/24` : `${server.subnet}.1/32`, ...(device.lan ? networks : [])];
  return ["[Interface]", `PrivateKey = ${device.privateKey}`, `Address = ${device.address}/32`, "", "[Peer]", `PublicKey = ${server.publicKey}`, `PresharedKey = ${device.presharedKey}`, `Endpoint = ${host}:${server.port}`, `AllowedIPs = ${allowed.join(", ")}`, "PersistentKeepalive = 25"].join("\n") + "\n";
}

export interface ClientConf {
  /** The file as Hata keeps it: only what joins the tunnel, no commands and no change of the server's DNS */
  text: string;
  address: string;
  endpoint: string;
  allowed: string[];
  /** Everything this server sends would go through the tunnel */
  everything: boolean;
  /** Lines of the file that were left out, by their names */
  dropped: string[];
}

const KEPT = { interface: ["privatekey", "address", "mtu", "listenport", "table", "fwmark"], peer: ["publickey", "presharedkey", "endpoint", "allowedips", "persistentkeepalive"] };

/**
 * Reads a configuration somebody else gave. Lines that run commands (`PostUp` and the like) and `DNS`
 * are left out: the first would run as root on somebody's word, the second would take the whole
 * server's name lookups elsewhere and needs a program this system may not have. A string is the code
 * of what is wrong.
 */
export function readClientConf(input: unknown): ClientConf | string {
  if (typeof input !== "string" || input.length > 16_384) return "wireguard.badConf";
  const out: string[] = [];
  const dropped: string[] = [];
  const seen: Record<string, string> = {};
  let section: "interface" | "peer" | "" = "";
  let peers = 0;
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const head = /^\[(\w+)\]$/.exec(line);
    if (head) {
      const name = head[1]!.toLowerCase();
      if (name !== "interface" && name !== "peer") return "wireguard.badConf";
      section = name;
      if (name === "peer") peers++;
      out.push(...(out.length ? [""] : []), name === "peer" ? "[Peer]" : "[Interface]");
      continue;
    }
    const pair = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line);
    if (!pair || !section) return "wireguard.badConf";
    const key = pair[1]!.toLowerCase();
    const value = pair[2]!.trim();
    if (!KEPT[section].includes(key)) {
      dropped.push(pair[1]!);
      continue;
    }
    if (/[\x00-\x1f]/.test(value)) return "wireguard.badConf";
    if ((key === "privatekey" || key === "publickey" || key === "presharedkey") && !KEY_RE.test(value)) return "wireguard.badKey";
    seen[`${section}.${key}`] = section === "peer" && key === "allowedips" && seen["peer.allowedips"] ? `${seen["peer.allowedips"]}, ${value}` : value;
    out.push(`${pair[1]} = ${value}`);
  }
  if (peers !== 1) return "wireguard.onePeer";
  for (const need of ["interface.privatekey", "interface.address", "peer.publickey", "peer.endpoint", "peer.allowedips"]) if (!seen[need]) return "wireguard.incomplete";
  const allowed = seen["peer.allowedips"]!.split(",").map((part) => part.trim()).filter(Boolean);
  return { text: "# Written by Hata from a file given to it — changes made here are lost\n" + out.join("\n") + "\n", address: seen["interface.address"]!, endpoint: seen["peer.endpoint"]!, allowed, everything: allowed.some((net) => net === "0.0.0.0/0" || net === "::/0"), dropped: [...new Set(dropped)] };
}

/** `wg show <interface> dump`: the first line is the interface itself, each other one a peer */
export function parseDump(output: string): Peer[] {
  return output
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"))
    .filter((cells) => cells.length >= 8)
    .map((cells) => ({ publicKey: cells[0]!, endpoint: cells[2] === "(none)" ? "" : cells[2]!, handshake: Number(cells[4]) * 1000 || 0, received: Number(cells[5]) || 0, sent: Number(cells[6]) || 0 }));
}

// --- Keys -------------------------------------------------------------------------------------------

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

/** A pair of keys as WireGuard writes them */
export async function keyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const secret = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
  return { privateKey: base64(Buffer.from(secret, "base64url")), publicKey: base64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))) };
}

// --- State and the system ---------------------------------------------------------------------------

const FILE = join(SECRETS_DIR, "wireguard.json");
const EMPTY: Saved = { server: { enabled: false, port: 51820, endpoint: "", subnet: "", privateKey: "", publicKey: "", devices: [] }, client: { enabled: false, conf: "" } };
const read = readJsonFile<Partial<Saved>>(FILE, {}, isPlainObject);
const saved: Saved = { server: { ...EMPTY.server, ...(isPlainObject(read.server) ? read.server : {}) }, client: { ...EMPTY.client, ...(isPlainObject(read.client) ? read.client : {}) } };
if (!Array.isArray(saved.server.devices)) saved.server.devices = [];
const persist = () => writeJsonAtomic(FILE, saved, 0o600);

export const toolInstalled = (): boolean => !!Bun.which("wg-quick", { PATH }) && !!Bun.which("wg", { PATH });
const hasIptables = (): boolean => !!Bun.which("iptables", { PATH });
/** Whether either tunnel is set to run: what stands on the program */
/** The port devices from afar come in on, while the server is on */
export const listeningPort = (): number | null => (saved.server.enabled ? saved.server.port : null);
export const inUse = (): boolean => saved.server.enabled || saved.client.enabled;

const networks = (): string[] => homeNetworks(homeLinks()).filter((net) => !saved.server.subnet || !net.startsWith(saved.server.subnet + "."));
const said = (ran: { out: string; err: string }): string => (ran.err.trim() || ran.out.trim()).split("\n").slice(-1)[0] ?? "";

/** Writes one tunnel's file and brings its unit in step with `on`; throws with what the system said */
async function apply(name: string, conf: string, on: boolean): Promise<void> {
  const file = join(CONF_DIR, `${name}.conf`);
  const unit = `wg-quick@${name}`;
  if (!on) {
    await run(["systemctl", "disable", "--now", unit], 60_000);
    if (!conf) rmSync(file, { force: true });
    else writeTextAtomic(file, conf, 0o600);
    return;
  }
  if (!toolInstalled()) throw new AppError("wireguard.needsPackage", 409, { package: PACKAGE, install: installCommand(PACKAGE) });
  mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
  // taken down with the file it came up with: its own rules are the ones to take away
  await run(["systemctl", "stop", unit], 60_000);
  writeTextAtomic(file, conf, 0o600);
  chmodSync(file, 0o600);
  await run(["systemctl", "enable", unit], 30_000);
  const started = await run(["systemctl", "start", unit], 60_000);
  if (started.code !== 0) {
    const why = await run(["journalctl", "-u", unit, "-n", "4", "--no-pager", "-o", "cat"], 10_000);
    throw new AppError("wireguard.failed", 500, { message: why.out.trim().split("\n").filter(Boolean).slice(-2).join(" · ") || said(started) });
  }
}

async function peersOf(name: string): Promise<Peer[] | null> {
  if (!toolInstalled()) return null;
  const dump = await run(["wg", "show", name, "dump"], 8000);
  return dump.code === 0 ? parseDump(dump.out) : null;
}

const shownDevice = (device: Device, peer?: Peer) => ({ id: device.id, name: device.name, address: device.address, lan: device.lan, createdAt: device.createdAt, handshake: peer?.handshake ?? 0, endpoint: peer?.endpoint ?? "", received: peer?.received ?? 0, sent: peer?.sent ?? 0 });

export async function report(port: number) {
  const [inPeers, outPeers] = await Promise.all([saved.server.enabled ? peersOf(SERVER_IF) : null, saved.client.enabled ? peersOf(CLIENT_IF) : null]);
  const { server, client } = saved;
  const given = client.conf ? readClientConf(client.conf) : null;
  return {
    tool: toolInstalled() ? ("ok" as const) : ("missing" as const),
    package: PACKAGE,
    install: installCommand(PACKAGE),
    /** The port Hata answers on, for the address the page shows */
    web: port,
    server: {
      enabled: server.enabled,
      running: inPeers !== null,
      port: server.port,
      endpoint: server.endpoint,
      /** Offered when nothing is typed yet: the domain Hata is reached by */
      suggested: siteDomain(),
      address: server.subnet ? `${server.subnet}.1` : "",
      networks: networks(),
      /** Without iptables nobody can be let into the home network, and nothing stops a device at the server */
      firewall: hasIptables(),
      devices: server.devices.map((device) => shownDevice(device, inPeers?.find((peer) => peer.publicKey === device.publicKey))),
    },
    client: given && typeof given !== "string" ? { set: true, enabled: client.enabled, running: outPeers !== null, address: given.address, endpoint: given.endpoint, allowed: given.allowed, everything: given.everything, handshake: outPeers?.[0]?.handshake ?? 0, received: outPeers?.[0]?.received ?? 0, sent: outPeers?.[0]?.sent ?? 0 } : { set: false, enabled: false, running: false },
  };
}

/**
 * Brings the server's tunnel in step with what is saved. A change of devices alone is made on the
 * running tunnel: starting it anew would cut every connected device off for a quarter of a minute.
 */
async function applyServer(restart = false): Promise<void> {
  const conf = saved.server.privateKey ? serverConf(saved.server, hasIptables()) : "";
  const running = saved.server.enabled && !restart && toolInstalled() && (await run(["wg", "show", SERVER_IF, "listen-port"], 8000)).out.trim() === String(saved.server.port);
  if (!running) return apply(SERVER_IF, conf, saved.server.enabled);
  const file = join(CONF_DIR, `${SERVER_IF}.conf`);
  writeTextAtomic(file, conf, 0o600);
  const bare = await run(["wg-quick", "strip", SERVER_IF], 10_000);
  const peers = join(CONF_DIR, `.${SERVER_IF}.peers`);
  writeTextAtomic(peers, bare.out, 0o600);
  const synced = bare.code === 0 ? await run(["wg", "syncconf", SERVER_IF, peers], 10_000) : bare;
  rmSync(peers, { force: true });
  if (synced.code !== 0) throw new AppError("wireguard.failed", 500, { message: said(synced) });
  if (hasIptables()) for (const command of firewall(saved.server, SERVER_IF).up) await run(["sh", "-c", command], 10_000);
}

/** Switches taking connections on or off, and sets where and on which port the server is reached */
export async function setServer(input: Record<string, unknown>, user: string): Promise<void> {
  const next = { ...saved.server };
  if ("port" in input) {
    if (typeof input.port !== "number" || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new AppError("wireguard.badPort", 400);
    next.port = input.port;
  }
  if ("endpoint" in input) {
    const endpoint = cleanEndpoint(input.endpoint);
    if (endpoint === null) throw new AppError("wireguard.badEndpoint", 400);
    next.endpoint = endpoint;
  }
  if ("enabled" in input) next.enabled = input.enabled === true;
  if (next.enabled && !next.endpoint) throw new AppError("wireguard.needEndpoint", 400);
  if (next.enabled && !toolInstalled()) throw new AppError("wireguard.needsPackage", 409, { package: PACKAGE, install: installCommand(PACKAGE) });
  if (!next.privateKey) Object.assign(next, await keyPair());
  if (!next.subnet) next.subnet = pickSubnet(homeNetworks(homeLinks()));
  const was = saved.server;
  saved.server = next;
  try {
    await applyServer(true);
  } catch (e) {
    saved.server = was;
    throw e;
  }
  persist();
  if (was.enabled !== next.enabled) record(next.enabled ? "system.wireguard.on" : "system.wireguard.off", { user });
}

const find = (id: string): Device => {
  const device = saved.server.devices.find((item) => item.id === id);
  if (!device) throw new AppError("wireguard.noDevice", 404);
  return device;
};

/** What is handed to the device: the file's text; the page draws the code from it */
export function deviceFile(id: string): { name: string; conf: string } {
  const device = find(id);
  if (!saved.server.endpoint) throw new AppError("wireguard.needEndpoint", 400);
  return { name: device.name, conf: deviceConf(device, saved.server, networks()) };
}

export async function addDevice(input: Record<string, unknown>, user: string): Promise<string> {
  const name = cleanName(input.name);
  if (!name) throw new AppError("wireguard.badName", 400);
  if (!saved.server.privateKey || !saved.server.endpoint) throw new AppError("wireguard.needEndpoint", 400);
  if (saved.server.devices.length >= MAX_DEVICES) throw new AppError("wireguard.full", 409);
  const address = nextAddress(saved.server.subnet, saved.server.devices);
  if (!address) throw new AppError("wireguard.full", 409);
  const device: Device = { id: crypto.randomUUID().slice(0, 8), name, address, ...(await keyPair()), presharedKey: base64(crypto.getRandomValues(new Uint8Array(32))), lan: input.lan === true, createdAt: Date.now() };
  saved.server.devices.push(device);
  try {
    await applyServer();
  } catch (e) {
    saved.server.devices = saved.server.devices.filter((item) => item !== device);
    throw e;
  }
  persist();
  record("system.wireguard.device", { user, detail: name });
  return device.id;
}

export async function changeDevice(id: string, input: Record<string, unknown>): Promise<void> {
  const device = find(id);
  const was = { ...device };
  if ("name" in input) {
    const name = cleanName(input.name);
    if (!name) throw new AppError("wireguard.badName", 400);
    device.name = name;
  }
  if ("lan" in input) device.lan = input.lan === true;
  try {
    await applyServer();
  } catch (e) {
    Object.assign(device, was);
    throw e;
  }
  persist();
}

export async function removeDevice(id: string, user: string): Promise<void> {
  const device = find(id);
  const all = saved.server.devices;
  saved.server.devices = all.filter((item) => item !== device);
  try {
    await applyServer();
  } catch (e) {
    saved.server.devices = all;
    throw e;
  }
  persist();
  record("system.wireguard.deviceRemoved", { user, detail: device.name });
}

/** Takes the configuration of somebody else's server, or switches the tunnel to it on and off */
export async function setClient(input: Record<string, unknown>, user: string): Promise<{ dropped: string[] }> {
  const next = { ...saved.client };
  let dropped: string[] = [];
  if ("conf" in input) {
    const given = readClientConf(input.conf);
    if (typeof given === "string") throw new AppError(given, 400);
    next.conf = given.text;
    dropped = given.dropped;
  }
  if ("enabled" in input) next.enabled = input.enabled === true;
  if (!next.conf) throw new AppError("wireguard.incomplete", 400);
  const was = saved.client;
  saved.client = next;
  try {
    await apply(CLIENT_IF, next.conf, next.enabled);
  } catch (e) {
    saved.client = was;
    // what was there before is put back, so a file that does not start does not stay
    await apply(CLIENT_IF, was.conf, false).catch(() => {});
    throw e;
  }
  persist();
  if (was.enabled !== next.enabled) record(next.enabled ? "system.wireguard.joined" : "system.wireguard.left", { user });
  return { dropped };
}

export async function forgetClient(user: string): Promise<void> {
  await apply(CLIENT_IF, "", false);
  if (saved.client.enabled) record("system.wireguard.left", { user });
  saved.client = { enabled: false, conf: "" };
  persist();
}
