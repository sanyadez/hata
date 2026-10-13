/**
 * The network interfaces of the server (Settings → Network).
 *
 * Looking is done with `ip` and works everywhere. Changing goes through NetworkManager only — it is the
 * one tool that also knows Wi-Fi, access points and modems — and is installed by the button on the page.
 * An interface another tool looks after (systemd-networkd, with or without netplan) is first handed over:
 * a NetworkManager profile with the settings it has right now, and a `.network` file of Hata's that tells
 * networkd to leave it alone.
 *
 * A wrong address cuts the server off together with this page, so every change is on trial: unless it
 * is confirmed within `TRIAL_S` seconds — by the page, or by opening the link with the token at the new
 * address — the previous state comes back. For a change of settings that is NetworkManager's own
 * checkpoint; for a hand-over, a script started by a systemd timer. Both work with Hata itself down.
 *
 * Pure and tested: reading `ip -j`, nmcli's terse output, the check of a change (`cleanChange`), the
 * commands of a change and of a hand-over.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { record } from "./activity";
import { bus } from "./bus";
import { installCommand, PATH, run } from "./packages";

const TRIAL_S = 90;
/** Interfaces that are Docker's or a tunnel's, not the server's way to the network */
const NOT_OURS = /^(lo|docker|br-|veth|virbr|cni|flannel|lxcbr|podman|tun|tap|wg|tailscale|zt)/;
const PACKAGE = "network-manager";
/** Without it NetworkManager has a Wi-Fi device and cannot use it */
const WIFI_PACKAGE = "wpasupplicant";
export const NETWORK_PACKAGES = [PACKAGE, WIFI_PACKAGE];
const PROFILES = "/etc/NetworkManager/system-connections";
const NM = ["org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager", "org.freedesktop.NetworkManager"];
const HANDED = (name: string) => `/etc/systemd/network/00-hata-${name}.network`;
const UDEV_RULE = (name: string) => `/etc/udev/rules.d/99-zz-hata-${name}.rules`;
const WAIT_DIR = "/etc/systemd/system/systemd-networkd-wait-online.service.d";
const WAIT_FILE = `${WAIT_DIR}/zz-hata.conf`;
const profileName = (name: string) => `hata-${name}`;

export interface Nic {
  name: string;
  /** modem — a USB modem or a phone sharing its connection: it shows up as a network card of its own */
  kind: "ethernet" | "wifi" | "modem";
  /** What the device calls itself, for a USB one */
  product: string;
  /** Whether the server's way to the internet leads through it: the first choice, a spare one, or not at all */
  internet: "main" | "backup" | "none";
  mac: string;
  /** A cable is in, or the radio is connected */
  up: boolean;
  /** IPv4 addresses with their prefix, `192.168.1.5/24` */
  addresses: string[];
  /** Global IPv6 addresses */
  addresses6: string[];
  /** The address came by itself (DHCP) */
  dynamic: boolean;
  gateway: string;
  dns: string[];
  /** Mbit/s, when the interface says */
  speed: number | null;
  /** Who configures it: NetworkManager, systemd-networkd (netplan writes for it too), ifupdown, "" — nobody we know */
  manager: "nm" | "networkd" | "ifupdown" | "";
  /** A Wi-Fi interface: whether it can be used, what it lacks, the network it is on */
  wifi?: { ready: boolean; needs: { package: string; install: string } | null; ssid: string; signal: number };
}

interface IpLink {
  ifname: string;
  link_type?: string;
  address?: string;
  flags?: string[];
  addr_info?: { family: string; local: string; prefixlen: number; scope?: string; dynamic?: boolean }[];
}

/** The interfaces out of `ip -j addr` and `ip -j route show default`, without Docker's and tunnels */
export function parseLinks(addrJson: string, routeJson: string): Pick<Nic, "name" | "mac" | "up" | "addresses" | "addresses6" | "dynamic" | "gateway" | "internet">[] {
  let links: IpLink[] = [];
  let routes: { dev?: string; gateway?: string; metric?: number }[] = [];
  try {
    links = JSON.parse(addrJson);
    routes = JSON.parse(routeJson || "[]");
  } catch {}
  // of several ways out the kernel takes the one with the lowest metric
  const ways = routes.filter((r) => r.dev && r.gateway).sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0));
  return links
    .filter((l) => l.link_type === "ether" && !NOT_OURS.test(l.ifname))
    .map((l) => {
      const v4 = (l.addr_info ?? []).filter((a) => a.family === "inet");
      const way = ways.findIndex((r) => r.dev === l.ifname);
      return {
        name: l.ifname,
        mac: l.address ?? "",
        up: (l.flags ?? []).includes("LOWER_UP"),
        addresses: v4.map((a) => `${a.local}/${a.prefixlen}`),
        addresses6: (l.addr_info ?? []).filter((a) => a.family === "inet6" && a.scope === "global").map((a) => `${a.local}/${a.prefixlen}`),
        dynamic: v4.some((a) => a.dynamic === true),
        gateway: way < 0 ? "" : ways[way]!.gateway!,
        internet: way < 0 ? ("none" as const) : way === 0 ? ("main" as const) : ("backup" as const),
      };
    });
}

/** One line of `nmcli -t`: fields are split by ":", and a ":" inside a value is written `\:` */
export function terse(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) field += line[++i];
    else if (line[i] === ":") {
      fields.push(field);
      field = "";
    } else field += line[i];
  }
  fields.push(field);
  return fields;
}

/** Drivers of the USB devices that are a modem or a phone, not a network card on a cable */
const MODEM_DRIVERS = /^(cdc_ether|cdc_ncm|cdc_mbim|rndis_host|ipheth|qmi_wwan|huawei_cdc_ncm|cdc_eem|sierra_net|hso)$/;
export const isModem = (subsystem: string, driver: string): boolean => subsystem === "usb" && MODEM_DRIVERS.test(driver);

export type Role = "main" | "backup" | "off";
/** A route's metric is its place in the queue: NetworkManager gives a cable 100 and Wi-Fi 600 */
const MAIN_METRIC = 50;
const BACKUP_METRIC = 900;

/** The settings of a profile for an interface's part in reaching the internet */
export function roleArgs(role: Role): string[] {
  const metric = role === "main" ? String(MAIN_METRIC) : role === "backup" ? String(BACKUP_METRIC) : "-1";
  const never = role === "off" ? "yes" : "no";
  return ["ipv4.route-metric", metric, "ipv6.route-metric", metric, "ipv4.never-default", never, "ipv6.never-default", never];
}

export interface Change {
  /** auto — the address comes from the router (DHCP); manual — the one given here */
  method: "auto" | "manual";
  /** `192.168.1.5/24` */
  address: string;
  gateway: string;
  dns: string[];
}

const ipNumber = (ip: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.some((p) => p > 255) ? null : ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
};

/** Checks what the form sent; an error code, or the change as it will be applied */
export function cleanChange(input: Record<string, unknown>): Change | string {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : []).map((s) => String(s).trim()).filter(Boolean);
  const dns = list(input.dns);
  if (dns.length > 3 || dns.some((d) => ipNumber(d) === null)) return "network.badDns";
  if (input.method === "auto") return { method: "auto", address: "", gateway: "", dns };
  if (input.method !== "manual") return "network.badMethod";
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(typeof input.address === "string" ? input.address.trim() : "");
  const ip = m ? ipNumber(m[1]!) : null;
  const prefix = m ? Number(m[2]) : 0;
  if (ip === null || prefix < 8 || prefix > 30) return "network.badAddress";
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const host = ip & ~mask;
  // the first and the last address of a network are not a machine's
  if (host === 0 || host === (~mask >>> 0) || ip >>> 24 === 127 || ip >>> 24 >= 224 || ip >>> 24 === 0) return "network.badAddress";
  const gateway = typeof input.gateway === "string" ? input.gateway.trim() : "";
  if (gateway) {
    const g = ipNumber(gateway);
    if (g === null || g === ip || (g & mask) !== (ip & mask)) return "network.badGateway";
  }
  return { method: "manual", address: `${m![1]}/${prefix}`, gateway, dns };
}

/** The settings of a NetworkManager profile for a change, as arguments of `nmcli connection modify|add` */
export function profileArgs(change: Change): string[] {
  return change.method === "auto"
    ? ["ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", "", "ipv4.dns", change.dns.join(","), "ipv4.ignore-auto-dns", change.dns.length ? "yes" : "no"]
    : ["ipv4.method", "manual", "ipv4.addresses", change.address, "ipv4.gateway", change.gateway, "ipv4.dns", change.dns.join(","), "ipv4.ignore-auto-dns", "no"];
}

/** The `.network` file that takes an interface away from systemd-networkd: the first file to match wins */
export const handedFile = (name: string): string => `# Written by Hata: this interface is looked after by NetworkManager.\n# Remove this file and the "${profileName(name)}" profile to give it back.\n[Match]\nName=${name}\n\n[Link]\nUnmanaged=yes\n`;

/**
 * netplan marks its interfaces as not NetworkManager's with a udev rule; this one, read after it, takes
 * the mark off — without it the interface would be nobody's after a reboot.
 */
export const udevRule = (name: string): string => `# Written by Hata: ${name} is looked after by NetworkManager.\nACTION!="remove", SUBSYSTEM=="net", KERNEL=="${name}", ENV{NM_UNMANAGED}="0"\n`;

/**
 * The boot waits for networkd's interfaces to come up, two minutes for one that was handed over: with
 * `left` — the interfaces networkd still has — only those are waited for, with none nothing is.
 */
export function waitOnline(handed: string[], left: string[]): string {
  const wait = left.length ? `/lib/systemd/systemd-networkd-wait-online --any ${handed.map((name) => `--ignore=${name}`).join(" ")}` : "/bin/true";
  return `# Written by Hata: the interfaces handed over to NetworkManager are not waited for here.\n[Service]\nExecStart=\nExecStart=${wait}\n`;
}

/** What undoes a hand-over, run by a timer unless the change is confirmed */
export const handBackScript = (name: string): string =>
  [
    "#!/bin/sh",
    "PATH=$PATH:/usr/sbin:/sbin",
    `rm -f ${HANDED(name)} ${UDEV_RULE(name)}`,
    `ls /etc/systemd/network/00-hata-*.network >/dev/null 2>&1 || rm -f ${WAIT_FILE}`,
    "systemctl daemon-reload",
    "udevadm control --reload",
    `nmcli connection delete ${profileName(name)}`,
    `nmcli device set ${name} managed no`,
    `udevadm trigger --action=change /sys/class/net/${name}`,
    "networkctl reload",
    `networkctl reconfigure ${name}`,
    "",
  ].join("\n");

export interface WifiNetwork {
  ssid: string;
  /** 0–100 */
  signal: number;
  /** A password is asked for */
  secure: boolean;
  /** Only WPA3: the password is checked another way (SAE) */
  wpa3: boolean;
  band: "2.4" | "5" | "6";
  /** The interface is on this network now */
  active: boolean;
  /** Its password is saved here */
  known: boolean;
}

/**
 * The networks out of `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY,FREQ device wifi list`: one line per
 * name — the access point in use, otherwise the strongest — strongest first; nameless ones are left out.
 */
export function parseWifi(out: string, known: string[] = []): WifiNetwork[] {
  const best = new Map<string, WifiNetwork>();
  for (const line of out.split("\n")) {
    const [inUse, ssid, signal, security, freq] = terse(line);
    if (!ssid) continue;
    const mhz = parseInt(freq ?? "", 10) || 0;
    const sec = (security ?? "").replace("--", "").trim();
    const found: WifiNetwork = { ssid, signal: Number(signal) || 0, secure: sec !== "", wpa3: /WPA3/.test(sec) && !/WPA[12]/.test(sec), band: mhz >= 5925 ? "6" : mhz >= 4000 ? "5" : "2.4", active: inUse === "*", known: known.includes(ssid) };
    const had = best.get(ssid);
    if (!had || (found.active && !had.active) || (found.active === had.active && found.signal > had.signal)) best.set(ssid, found);
  }
  return [...best.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.signal - a.signal);
}

/** A Wi-Fi password as WPA takes it: 8–63 printable characters */
export const wifiPassword = (value: unknown): value is string => typeof value === "string" && /^[\x20-\x7e]{8,63}$/.test(value);

/**
 * The NetworkManager profile of a Wi-Fi network as a file: written with mode 0600, so the password is
 * never an argument of a command, where every user of the machine could read it.
 */
export function wifiProfile(id: string, nic: string, net: { ssid: string; secure: boolean; wpa3: boolean }, password: string): string {
  // the name as a list of bytes: any characters, nothing to escape
  const ssid = [...new TextEncoder().encode(net.ssid)].join(";") + ";";
  const lines = ["[connection]", `id=${id}`, `uuid=${crypto.randomUUID()}`, "type=wifi", `interface-name=${nic}`, "", "[wifi]", "mode=infrastructure", `ssid=${ssid}`, ""];
  if (net.secure) lines.push("[wifi-security]", `key-mgmt=${net.wpa3 ? "sae" : "wpa-psk"}`, `psk=${password.replace(/\\/g, "\\\\").replace(/^ /, "\\s")}`, "");
  lines.push("[ipv4]", "method=auto", "", "[ipv6]", "method=auto", "");
  return lines.join("\n");
}

/** The name of the profile Hata keeps for a Wi-Fi network: readable, and safe as a file name */
export const wifiProfileId = (ssid: string): string => "hata-wifi-" + (ssid.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "network") + "-" + new Bun.CryptoHasher("sha256").update(ssid).digest("hex").slice(0, 6);

const INTERFACES = "/etc/network/interfaces";
const MARK = "#hata# ";

/**
 * `/etc/network/interfaces` without an interface: its `iface` stanzas and its name on the `auto` and
 * `allow-…` lines are commented out with a mark, everything else stays as written. null — the file
 * does not set the interface up (it may be in a file this one includes, which Hata does not edit).
 */
export function withoutIface(text: string, name: string): string | null {
  const out: string[] = [];
  let inside = false;
  let found = false;
  for (const line of text.split("\n")) {
    const words = line.trim().split(/\s+/);
    const stanza = /^(iface|mapping|auto|allow-[\w-]+|source|source-directory|rename|no-auto-down|no-scripts)$/.test(words[0] ?? "");
    if (stanza) inside = words[0] === "iface" && words[1] === name;
    if (inside) {
      found = true;
      out.push(line.trim() ? MARK + line : line);
    } else if (stanza && /^(auto|allow-)/.test(words[0]!) && words.slice(1).includes(name)) {
      const others = words.slice(1).filter((word) => word !== name);
      out.push(MARK + line);
      if (others.length) out.push(`${words[0]} ${others.join(" ")}`);
    } else out.push(line);
  }
  return found ? out.join("\n") : null;
}

/**
 * The name an interface gave the router when dhcpcd asked for its address: with the same one
 * NetworkManager is given the same address, so a hand-over does not move the server. dhcpcd's is
 * `ff`, the last four bytes of the hardware address, and its DUID (`/var/lib/dhcpcd/duid`).
 */
export function dhcpcdClientId(mac: string, duid: string): string {
  const bytes = mac.toLowerCase().split(":");
  const id = duid.trim().toLowerCase();
  return bytes.length === 6 && /^[0-9a-f]{2}(:[0-9a-f]{2}){3,}$/.test(id) ? ["ff", ...bytes.slice(2), id].join(":") : "";
}

/** What undoes a hand-over from ifupdown: the file as it was, and the interface brought up by it again */
export const ifupBackScript = (name: string, saved: string): string =>
  ["#!/bin/sh", "PATH=$PATH:/usr/sbin:/sbin", `nmcli connection delete ${profileName(name)}`, `nmcli device set ${name} managed no`, `cp ${saved} ${INTERFACES}`, "systemctl restart NetworkManager", `ip addr flush dev ${name}`, `ifup --force ${name}`, ""].join("\n");

// --- Reading ----------------------------------------------------------------------------------------

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

const nmcli = (args: string[], timeout = 20_000) => run(["nmcli", ...args], timeout);
const hasNm = (): boolean => !!Bun.which("nmcli", { PATH });

async function nmRunning(): Promise<boolean> {
  return hasNm() && (await nmcli(["-t", "-f", "RUNNING", "general"])).out.trim() === "running";
}

/** Device → its state in NetworkManager ("unmanaged", "connected", "connected (externally)"…) */
async function nmDevices(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!(await nmRunning())) return out;
  for (const line of (await nmcli(["-t", "-f", "DEVICE,STATE", "device"])).out.split("\n")) {
    const [device, state] = terse(line);
    if (device) out.set(device, state ?? "");
  }
  return out;
}

async function networkdManaged(): Promise<Set<string>> {
  const out = new Set<string>();
  if (!Bun.which("networkctl", { PATH })) return out;
  try {
    const list = JSON.parse((await run(["networkctl", "list", "--json=short"])).out) as { Interfaces?: { Name: string; AdministrativeState?: string }[] };
    for (const i of list.Interfaces ?? []) if (i.AdministrativeState && i.AdministrativeState !== "unmanaged") out.add(i.Name);
  } catch {}
  return out;
}

function ifupdownNames(): Set<string> {
  const text = [read("/etc/network/interfaces"), ...(existsSync("/etc/network/interfaces.d") ? [...new Bun.Glob("*").scanSync({ cwd: "/etc/network/interfaces.d", absolute: true })].map(read) : [])].join("\n");
  return new Set([...text.matchAll(/^\s*iface\s+(\S+)\s+inet/gm)].map((m) => m[1]!));
}

async function dnsOf(name: string, byNm: boolean): Promise<string[]> {
  if (byNm) {
    const lines = (await nmcli(["-t", "-f", "IP4.DNS", "device", "show", name])).out.split("\n");
    const found = lines.map((line) => terse(line)[1] ?? "").filter(Boolean);
    if (found.length) return found;
  }
  if (Bun.which("resolvectl", { PATH })) {
    const m = /:\s*(.+)$/.exec((await run(["resolvectl", "dns", name])).out.trim());
    const found = (m?.[1] ?? "").split(/\s+/).filter((s) => /^[\d.]+$/.test(s));
    if (found.length) return found;
  }
  return [...read("/etc/resolv.conf").matchAll(/^nameserver\s+([\d.]+)/gm)].map((m) => m[1]!).filter((ip) => !ip.startsWith("127."));
}

export interface Pending {
  nic: string;
  kind: "change" | "handover";
  until: number;
  /** Opens `/network/confirm?token=…` at the new address, where the page's own session does not reach */
  token: string;
  /** The address the server is to be found at afterwards; "" — as before, or not known (DHCP) */
  address: string;
}

/** `applied` — the change has been made: before that, reaching the server proves nothing */
let pending: (Pending & { undo: () => Promise<void>; keep: () => Promise<void>; timer: Timer; applied: boolean }) | null = null;

export interface NetworkReport {
  /** NetworkManager: ok, missing (`needs` says what to install), stopped */
  tool: "ok" | "missing" | "stopped";
  needs: { package: string; install: string } | null;
  nics: Nic[];
  pending: Pending | null;
  trial: number;
}

export async function networkReport(): Promise<NetworkReport> {
  const [addr, route, nm, networkd] = await Promise.all([run(["ip", "-j", "addr"]), run(["ip", "-j", "route", "show", "default"]), nmDevices(), networkdManaged()]);
  const ifupdown = ifupdownNames();
  const nics: Nic[] = [];
  for (const link of parseLinks(addr.out, route.out)) {
    const state = nm.get(link.name) ?? "";
    // "connected (externally)" is NetworkManager only watching what somebody else configured
    const byNm = state !== "" && state !== "unmanaged" && !state.includes("externally");
    const speed = Number(read(`/sys/class/net/${link.name}/speed`));
    const isWifi = existsSync(`/sys/class/net/${link.name}/wireless`);
    const device = `/sys/class/net/${link.name}/device`;
    const sysName = (path: string) => {
      try {
        return realpathSync(path).split("/").pop() ?? "";
      } catch {
        return "";
      }
    };
    const usb = sysName(`${device}/subsystem`) === "usb";
    const modem = !isWifi && isModem(usb ? "usb" : "", sysName(`${device}/driver`));
    let wifi: Nic["wifi"];
    if (isWifi) {
      const supplicant = !!Bun.which("wpa_supplicant", { PATH });
      const on = byNm && state !== "unavailable" ? parseWifi((await nmcli(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY,FREQ", "device", "wifi", "list", "ifname", link.name, "--rescan", "no"])).out).find((n) => n.active) : undefined;
      wifi = { ready: byNm && state !== "unavailable", needs: supplicant ? null : { package: WIFI_PACKAGE, install: installCommand(WIFI_PACKAGE) }, ssid: on?.ssid ?? "", signal: on?.signal ?? 0 };
    }
    nics.push({
      ...link,
      ...(wifi ? { wifi } : {}),
      kind: isWifi ? "wifi" : modem ? "modem" : "ethernet",
      // a USB interface hangs under its device, where the names are
      product: usb ? [read(`${device}/../manufacturer`), read(`${device}/../product`)].filter(Boolean).join(" ") : "",
      dns: link.addresses.length ? await dnsOf(link.name, byNm) : [],
      speed: speed > 0 ? speed : null,
      manager: byNm ? "nm" : networkd.has(link.name) ? "networkd" : ifupdown.has(link.name) ? "ifupdown" : "",
    });
  }
  const running = nm.size > 0 || (await nmRunning());
  return {
    tool: !hasNm() ? "missing" : running ? "ok" : "stopped",
    needs: hasNm() ? null : { package: PACKAGE, install: installCommand(PACKAGE) },
    nics,
    pending: pending && { nic: pending.nic, kind: pending.kind, until: pending.until, token: pending.token, address: pending.address },
    trial: TRIAL_S,
  };
}

// --- Changing ---------------------------------------------------------------------------------------

export class NetworkError extends Error {
  constructor(
    readonly code: string,
    readonly detail: Record<string, string> = {},
  ) {
    super(code);
  }
}

const must = async (what: Promise<{ code: number; out: string; err: string }>): Promise<string> => {
  const r = await what;
  if (r.code !== 0) throw new NetworkError("network.failed", { message: (r.err.trim() || r.out.trim()).split("\n").slice(-2).join(" ") || `exit ${r.code}` });
  return r.out;
};

async function findNic(name: string): Promise<Nic> {
  const nic = (await networkReport()).nics.find((n) => n.name === name);
  if (!nic) throw new NetworkError("network.noNic");
  return nic;
}

/** Starts the trial: `undo` brings the previous state back when nobody confirms in time */
function startTrial(p: Omit<Pending, "until" | "token">, user: string, hooks: { undo: () => Promise<void>; keep: () => Promise<void> }): Pending {
  const until = Date.now() + TRIAL_S * 1000;
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const timer = setTimeout(() => {
    const over = pending;
    pending = null;
    if (!over) return;
    void over.undo().finally(() => {
      record("network.rolledBack", { user, detail: over.nic });
      bus.publish("network");
    });
  }, TRIAL_S * 1000);
  pending = { ...p, until, token, timer, applied: false, ...hooks };
  return { ...p, until, token };
}

/** Keeps the change on trial. `token` — from the link; without one the caller is a signed-in administrator */
export async function confirmChange(token?: string): Promise<boolean> {
  if (!pending || !pending.applied || (token !== undefined && token !== pending.token)) return false;
  const kept = pending;
  pending = null;
  clearTimeout(kept.timer);
  await kept.keep().catch(() => {});
  record(kept.kind === "handover" ? "network.handedOver" : "network.changed", { detail: kept.nic });
  bus.publish("network");
  return true;
}

/** The change has been made — from here on it can be kept; one that could not be made is taken back at once */
async function applied(worked: boolean): Promise<void> {
  if (!pending) return;
  if (worked) pending.applied = true;
  else await revertChange();
}

/** Takes the change on trial back at once */
export async function revertChange(): Promise<void> {
  const over = pending;
  if (!over) return;
  pending = null;
  clearTimeout(over.timer);
  await over.undo();
  bus.publish("network");
}

const addressOf = (change: Change, nic: Nic): string => (change.method === "manual" && !nic.addresses.includes(change.address) ? change.address.split("/")[0]! : "");

/** Changes the IPv4 settings of an interface NetworkManager looks after; applied a moment after the answer */
export async function changeNic(name: string, input: Record<string, unknown>, user: string): Promise<Pending> {
  if (pending) throw new NetworkError("network.pending");
  const change = cleanChange(input);
  if (typeof change === "string") throw new NetworkError(change);
  const nic = await findNic(name);
  if (nic.manager !== "nm") throw new NetworkError("network.notOurs");
  const show = await must(nmcli(["-t", "-f", "GENERAL.CON-UUID,GENERAL.DBUS-PATH", "device", "show", name]));
  const field = (key: string) => show.split("\n").map(terse).find((f) => f[0] === key)?.[1] ?? "";
  const uuid = field("GENERAL.CON-UUID");
  const device = field("GENERAL.DBUS-PATH");
  if (!uuid || !device) throw new NetworkError("network.failed", { message: "the interface has no connection" });
  // NetworkManager itself puts the device back when the checkpoint is not removed in time
  const made = await must(run(["busctl", "call", ...NM, "CheckpointCreate", "aouu", "1", device, String(TRIAL_S + 5), "0"]));
  const checkpoint = /"([^"]+)"/.exec(made)?.[1] ?? "";
  const drop = (method: string) => run(["busctl", "call", ...NM, method, "o", checkpoint]).then(() => {});
  try {
    await must(nmcli(["connection", "modify", uuid, ...profileArgs(change)]));
  } catch (e) {
    await drop("CheckpointRollback");
    throw e;
  }
  // the answer has to leave through the address that is about to go
  setTimeout(async () => applied((await nmcli(["connection", "up", uuid, "ifname", name], 60_000)).code === 0), 400);
  return startTrial({ nic: name, kind: "change", address: addressOf(change, nic) }, user, { undo: () => drop("CheckpointRollback"), keep: () => drop("CheckpointDestroy") });
}

/**
 * Hands an interface of systemd-networkd over to NetworkManager with the settings it has right now, so
 * nothing changes for whoever is connected — and on trial all the same.
 */
export async function handOver(name: string, user: string): Promise<Pending> {
  if (pending) throw new NetworkError("network.pending");
  if (!(await nmRunning())) throw new NetworkError("network.noTool");
  const nic = await findNic(name);
  if (nic.manager !== "networkd" && nic.manager !== "ifupdown") throw new NetworkError("network.cannotHandOver");
  const ifupdown = nic.manager === "ifupdown";
  const edited = ifupdown ? withoutIface(read(INTERFACES), name) : null;
  // set up in a file that one includes: not ours to edit
  if (ifupdown && edited === null) throw new NetworkError("network.cannotHandOver");
  const change: Change = nic.dynamic || !nic.addresses.length ? { method: "auto", address: "", gateway: "", dns: [] } : { method: "manual", address: nic.addresses[0]!, gateway: nic.gateway, dns: nic.dns };
  const script = `/run/hata-network-undo-${name}.sh`;
  const saved = `/run/hata-network-undo-${name}.interfaces`;
  const unit = `hata-network-undo-${name}`;
  if (ifupdown) {
    writeFileSync(saved, readFileSync(INTERFACES));
    if (!existsSync(`${INTERFACES}.before-hata`)) writeFileSync(`${INTERFACES}.before-hata`, readFileSync(INTERFACES));
  }
  writeFileSync(script, ifupdown ? ifupBackScript(name, saved) : handBackScript(name), { mode: 0o700 });
  await run(["systemctl", "stop", `${unit}.timer`]);
  await must(run(["systemd-run", "--unit", unit, "--collect", "--quiet", `--on-active=${TRIAL_S + 5}`, "/bin/sh", script]));
  const undo = async () => {
    await run(["systemctl", "stop", `${unit}.timer`]);
    await run(["/bin/sh", script], 60_000);
    rmSync(script, { force: true });
    rmSync(saved, { force: true });
  };
  try {
    await nmcli(["connection", "delete", profileName(name)]);
    // the router knows the interface by the name its DHCP client gave: keep it, and the address stays
    const clientId = ifupdown && change.method === "auto" ? dhcpcdClientId(nic.mac, read("/var/lib/dhcpcd/duid")) : "";
    await must(nmcli(["connection", "add", "type", "ethernet", "ifname", name, "con-name", profileName(name), "autoconnect", "yes", "save", "yes", ...profileArgs(change), ...(clientId ? ["ipv4.dhcp-client-id", clientId] : [])]));
  } catch (e) {
    await undo();
    throw e;
  }
  setTimeout(async () => {
    if (ifupdown) {
      // ifdown needs the stanza it is taking down, so the file changes after it
      await run(["ifdown", "--force", name], 30_000);
      writeFileSync(INTERFACES, edited!);
      // NetworkManager reads that file only when it starts; what it has connected stays connected
      await run(["systemctl", "restart", "NetworkManager"], 60_000);
      for (let i = 0; i < 20 && !(await nmRunning()); i++) await Bun.sleep(500);
    } else {
      const left = [...(await networkdManaged())].filter((other) => other !== name);
      mkdirSync("/etc/systemd/network", { recursive: true });
      writeFileSync(HANDED(name), handedFile(name));
      writeFileSync(UDEV_RULE(name), udevRule(name));
      mkdirSync(WAIT_DIR, { recursive: true });
      const handed = [...new Bun.Glob("00-hata-*.network").scanSync({ cwd: "/etc/systemd/network" })].map((file) => file.slice(8, -8));
      writeFileSync(WAIT_FILE, waitOnline(handed, left));
      await run(["systemctl", "daemon-reload"]);
      await run(["udevadm", "control", "--reload"]);
      await run(["udevadm", "trigger", "--action=change", `/sys/class/net/${name}`]);
      await run(["networkctl", "reload"]);
    }
    await nmcli(["device", "set", name, "managed", "yes"]);
    await applied((await nmcli(["connection", "up", profileName(name), "ifname", name], 60_000)).code === 0);
  }, 400);
  return startTrial({ nic: name, kind: "handover", address: "" }, user, {
    undo,
    keep: async () => {
      await run(["systemctl", "stop", `${unit}.timer`]);
      rmSync(script, { force: true });
      rmSync(saved, { force: true });
    },
  });
}

// --- Wi-Fi ------------------------------------------------------------------------------------------

/** SSIDs whose profile is saved, with the profile's name */
async function savedWifi(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const line of (await nmcli(["-t", "-f", "NAME,TYPE", "connection"])).out.split("\n")) {
    const [name, type] = terse(line);
    if (!name || type !== "802-11-wireless") continue;
    const ssid = terse((await nmcli(["-t", "-f", "802-11-wireless.ssid", "connection", "show", name])).out.trim())[1];
    if (ssid) out.set(ssid, name);
  }
  return out;
}

async function wifiNic(name: string): Promise<Nic> {
  const nic = await findNic(name);
  if (!nic.wifi) throw new NetworkError("network.notWifi");
  if (nic.manager !== "nm") throw new NetworkError("network.notOurs");
  return nic;
}

/** The Wi-Fi networks in reach; looking around takes a few seconds */
export async function wifiNetworks(name: string): Promise<WifiNetwork[]> {
  await wifiNic(name);
  await nmcli(["radio", "wifi", "on"]);
  const list = await must(nmcli(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY,FREQ", "device", "wifi", "list", "ifname", name, "--rescan", "yes"], 40_000));
  return parseWifi(list, [...(await savedWifi()).keys()]);
}

/**
 * Connects to a network. A wrong password or a network out of reach is told within half a minute, and
 * nothing is kept of the attempt: the interface goes back to the network it was on.
 */
export async function wifiConnect(name: string, input: Record<string, unknown>, user: string): Promise<void> {
  await wifiNic(name);
  const ssid = typeof input.ssid === "string" ? input.ssid : "";
  if (!ssid || new TextEncoder().encode(ssid).length > 32) throw new NetworkError("network.badSsid");
  const saved = (await savedWifi()).get(ssid);
  const net = (await wifiNetworks(name)).find((n) => n.ssid === ssid);
  if (!net) throw new NetworkError("network.wifiGone");
  const fresh = !saved || typeof input.password === "string";
  let profile = saved ?? wifiProfileId(ssid);
  if (fresh) {
    if (net.secure && !wifiPassword(input.password)) throw new NetworkError("network.badWifiPassword");
    if (saved) await nmcli(["connection", "delete", saved]);
    profile = wifiProfileId(ssid);
    const file = `${PROFILES}/${profile}.nmconnection`;
    mkdirSync(PROFILES, { recursive: true });
    writeFileSync(file, wifiProfile(profile, name, net, net.secure ? (input.password as string) : ""), { mode: 0o600 });
    await must(nmcli(["connection", "load", file]));
  }
  const up = await nmcli(["--wait", "40", "connection", "up", profile, "ifname", name], 60_000);
  if (up.code !== 0) {
    // an attempt that failed leaves no profile behind: it would be tried again on every start
    if (fresh) await nmcli(["connection", "delete", profile]);
    const text = up.err + up.out;
    throw new NetworkError(/secrets were required|802-1x|wrong|password/i.test(text) ? "network.wifiWrongPassword" : "network.wifiFailed", { message: text.trim().split("\n").slice(-1)[0] ?? "" });
  }
  record("network.wifi.connected", { user, detail: ssid });
  bus.publish("network");
}

/** Leaves the network the interface is on and forgets its password */
export async function wifiForget(name: string, user: string): Promise<void> {
  const nic = await wifiNic(name);
  const profile = nic.wifi!.ssid ? (await savedWifi()).get(nic.wifi!.ssid) : undefined;
  if (!profile) throw new NetworkError("network.wifiGone");
  await must(nmcli(["connection", "delete", profile]));
  record("network.wifi.forgotten", { user, detail: nic.wifi!.ssid });
  bus.publish("network");
}

/** NetworkManager notices the program it lacked only when it starts; what it has connected stays connected */
export async function afterPackage(pkg: string): Promise<void> {
  if (pkg !== WIFI_PACKAGE || !(await nmRunning())) return;
  await run(["systemctl", "restart", "NetworkManager"], 60_000);
  for (let i = 0; i < 20 && !(await nmRunning()); i++) await Bun.sleep(500);
  await Bun.sleep(2000);
}

// --- The way to the internet ------------------------------------------------------------------------

/**
 * Says which part an interface plays in reaching the internet: the first choice, a spare one for when
 * the first is gone, or none. Only the default route changes — the interface keeps its address and the
 * machines of its own network still reach the server through it, so there is nothing to put on trial.
 */
export async function setRole(name: string, role: unknown, user: string): Promise<void> {
  if (role !== "main" && role !== "backup" && role !== "off") throw new NetworkError("network.badRole");
  const nic = await findNic(name);
  if (nic.manager !== "nm") throw new NetworkError("network.notOurs");
  const uuidOf = async (device: string) => terse((await nmcli(["-t", "-f", "GENERAL.CON-UUID", "device", "show", device])).out.trim())[1] ?? "";
  const uuid = await uuidOf(name);
  if (!uuid) throw new NetworkError("network.failed", { message: "the interface has no connection" });
  if (role === "main") {
    // one first choice: whoever was it before goes back to its usual place
    for (const other of (await networkReport()).nics) {
      if (other.name === name || other.manager !== "nm") continue;
      const id = await uuidOf(other.name);
      if (id && (await nmcli(["-t", "-f", "ipv4.route-metric", "connection", "show", id])).out.trim().endsWith(`:${MAIN_METRIC}`)) {
        await nmcli(["connection", "modify", id, "ipv4.route-metric", "-1", "ipv6.route-metric", "-1"]);
        await nmcli(["device", "reapply", other.name]);
      }
    }
  }
  await must(nmcli(["connection", "modify", uuid, ...roleArgs(role)]));
  const applied = await nmcli(["device", "reapply", name], 30_000);
  if (applied.code !== 0) await must(nmcli(["connection", "up", uuid, "ifname", name], 60_000));
  // the routes follow a moment later: whoever asks for the report next should see them
  await Bun.sleep(1500);
  record("network.role." + role, { user, detail: name });
  bus.publish("network");
}
