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
import { saveSettings, settings } from "./config";
import { cleanOutside, inNetworkOf, isPublic, OUTSIDE_CHAIN, OUTSIDE_HOOKS, outsideDown, outsideRules } from "./outside";
import { installCommand, PATH, run } from "./packages";
import { listeningPort } from "./wireguard";

const TRIAL_S = 90;
/** Interfaces that are Docker's or a tunnel's, not the server's way to the network */
const NOT_OURS = /^(lo|docker|br-|veth|virbr|cni|flannel|lxcbr|incusbr|hatabr|podman|tun|tap|wg|tailscale|zt)/;
const PACKAGE = "network-manager";
/** Without it NetworkManager has a Wi-Fi device and cannot use it */
const WIFI_PACKAGE = "wpasupplicant";
/** NetworkManager starts it to hand out addresses to whoever joins the access point */
const SHARE_PACKAGE = "dnsmasq-base";
/** The rules that close the internet side are written with it */
const FIREWALL_PACKAGE = "iptables";
export const NETWORK_PACKAGES = [PACKAGE, WIFI_PACKAGE, SHARE_PACKAGE, FIREWALL_PACKAGE];
const hotspotId = (name: string) => `hata-hotspot-${name}`;
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
  /** The server gives the internet out here: who has taken an address; null — it does not */
  shares: Hotspot["clients"] | null;
  /** The person marked it as the side the internet comes in on: nothing of the server answers there */
  outside: boolean;
  /** An IPv4 address of it the whole internet can reach, without the prefix; "" — none */
  public: string;
  /** With the check on: whether the internet is reached through this interface; null — not known */
  online: boolean | null;
  mac: string;
  /** A cable is in, or the radio is connected */
  up: boolean;
  /** IPv4 addresses with their prefix, `192.168.1.5/24` */
  addresses: string[];
  /** Global IPv6 addresses */
  addresses6: string[];
  /** IPv6 as its NetworkManager profile has it; method "" — not known, or not something the form sets */
  v6: { method: Change6["method"] | ""; address: string; gateway: string; dns: string[] };
  /** Whose it was before Hata handed it over to NetworkManager — it can be given back; "" — not handed over */
  handed: "networkd" | "ifupdown" | "";
  /** The address came by itself (DHCP) */
  dynamic: boolean;
  gateway: string;
  dns: string[];
  /** Mbit/s, when the interface says */
  speed: number | null;
  /** Who configures it: NetworkManager, systemd-networkd (netplan writes for it too), ifupdown, "" — nobody we know */
  manager: "nm" | "networkd" | "ifupdown" | "";
  /** A Wi-Fi interface: whether it can be used, what it lacks, the network it is on */
  wifi?: { ready: boolean; needs: { package: string; install: string } | null; ssid: string; signal: number; /** The adapter can be an access point */ ap: boolean; hotspot: Hotspot | null };
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

/**
 * The properties of one thing (`nmcli -t -f a,b connection show <name>`): a line each, `name:value` —
 * and there, unlike in a table, the value is written as it is, colons and all.
 */
export function props(out: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of out.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) found.set(line.slice(0, at), line.slice(at + 1));
  }
  return found;
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
  /**
   * auto — the address comes from the router (DHCP); manual — the one given here; shared — the server
   * is the router on this interface: it hands out addresses and shares its way to the internet
   */
  method: "auto" | "manual" | "shared";
  /** `192.168.1.5/24` */
  address: string;
  gateway: string;
  dns: string[];
  /** IPv6, when the form sent it; without it IPv6 stays as it is */
  v6?: Change6;
}

export interface Change6 {
  /** auto — from the router (its announcements, DHCPv6); manual — the one given here; off — no IPv6 on this interface */
  method: "auto" | "manual" | "off";
  /** `2001:db8::5/64` */
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

const words = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : []).map((s) => String(s).trim()).filter(Boolean);

/** An address with the size of its network, `192.168.1.5/24`, as a machine can have it; null — it is not one */
function hostAddress(value: unknown): { text: string; ip: number; mask: number; prefix: number } | null {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(typeof value === "string" ? value.trim() : "");
  const ip = m ? ipNumber(m[1]!) : null;
  const prefix = m ? Number(m[2]) : 0;
  if (ip === null || prefix < 8 || prefix > 30) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const host = ip & ~mask;
  // the first and the last address of a network are not a machine's
  if (host === 0 || host === (~mask >>> 0) || ip >>> 24 === 127 || ip >>> 24 >= 224 || ip >>> 24 === 0) return null;
  return { text: `${m![1]}/${prefix}`, ip, mask, prefix };
}

/**
 * The server's address on a network of its own — an access point, a port it gives the internet out on:
 * "" — left to NetworkManager (10.42.x.1/24); null — not an address, or a network with no room for others.
 */
export function shareAddress(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "";
  const address = hostAddress(value);
  return address && address.prefix >= 16 && address.prefix <= 28 ? address.text : null;
}

/** Two networks, each written as an address in it with its size, have addresses in common */
export function overlaps(a: string, b: string): boolean {
  const x = hostAddress(a);
  const y = hostAddress(b);
  if (!x || !y) return false;
  const mask = x.prefix < y.prefix ? x.mask : y.mask;
  return (x.ip & mask) === (y.ip & mask);
}

/** Whoever took an address of the network the server has there now: a lease outlives a change of the network */
const joined = (clients: Hotspot["clients"], own: string | undefined): Hotspot["clients"] => (own ? clients.filter((c) => overlaps(`${c.ip}/${own.split("/")[1]}`, own) || c.ip.includes(":")) : clients);

/** An IPv6 address as its eight numbers; null — it is not one (an IPv4 tail is not read) */
export function ip6Groups(text: string): number[] | null {
  const halves = text.split("::");
  if (!/^[0-9a-f:]+$/i.test(text) || halves.length > 2) return null;
  const part = (half: string) => (half ? half.split(":") : []);
  const head = part(halves[0]!);
  const tail = part(halves[1] ?? "");
  if ([...head, ...tail].some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  return [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail].map((group) => parseInt(group, 16));
}

function cleanV6(input: unknown): Change6 | string {
  const v = (typeof input === "object" && input ? input : {}) as Record<string, unknown>;
  const dns = words(v.dns);
  if (dns.length > 3 || dns.some((d) => ip6Groups(d) === null)) return "network.badDns6";
  if (v.method === "off") return { method: "off", address: "", gateway: "", dns: [] };
  if (v.method === "auto") return { method: "auto", address: "", gateway: "", dns };
  if (v.method !== "manual") return "network.badMethod";
  const m = /^([0-9a-f:]+)\/(\d{1,3})$/i.exec(typeof v.address === "string" ? v.address.trim() : "");
  const groups = m ? ip6Groups(m[1]!) : null;
  const prefix = m ? Number(m[2]) : 0;
  // not the addresses every interface has by itself (fe80::), nor those of many machines at once (ff…)
  if (!groups || prefix < 8 || prefix > 128 || groups[0]! >>> 8 === 0xff || (groups[0]! & 0xffc0) === 0xfe80 || groups.slice(0, 7).every((g) => g === 0)) return "network.badAddress6";
  const gateway = typeof v.gateway === "string" ? v.gateway.trim() : "";
  if (gateway) {
    const g = ip6Groups(gateway);
    if (!g || g[0]! >>> 8 === 0xff || g.every((n, i) => n === groups[i])) return "network.badGateway6";
  }
  return { method: "manual", address: `${m![1]!.toLowerCase()}/${prefix}`, gateway: gateway.toLowerCase(), dns };
}

/** Checks what the form sent; an error code, or the change as it will be applied */
export function cleanChange(input: Record<string, unknown>): Change | string {
  const dns = words(input.dns);
  if (dns.length > 3 || dns.some((d) => ipNumber(d) === null)) return "network.badDns";
  const v6 = input.v6 === undefined ? undefined : cleanV6(input.v6);
  if (typeof v6 === "string") return v6;
  const more = v6 ? { v6 } : {};
  if (input.method === "auto") return { method: "auto", address: "", gateway: "", dns, ...more };
  if (input.method === "shared") {
    const own = shareAddress(input.address);
    return own === null ? "network.badShareAddress" : { method: "shared", address: own, gateway: "", dns: [] };
  }
  if (input.method !== "manual") return "network.badMethod";
  const address = hostAddress(input.address);
  if (!address) return "network.badAddress";
  const gateway = typeof input.gateway === "string" ? input.gateway.trim() : "";
  if (gateway) {
    const g = ipNumber(gateway);
    if (g === null || g === address.ip || (g & address.mask) !== (address.ip & address.mask)) return "network.badGateway";
  }
  return { method: "manual", address: address.text, gateway, dns, ...more };
}

/** The settings of a NetworkManager profile for a change, as arguments of `nmcli connection modify|add` */
export function profileArgs(change: Change): string[] {
  if (change.method === "shared") return ["ipv4.method", "shared", "ipv4.addresses", change.address, "ipv4.gateway", "", "ipv4.dns", "", "ipv4.ignore-auto-dns", "no"];
  const v4 =
    change.method === "auto"
      ? ["ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", "", "ipv4.dns", change.dns.join(","), "ipv4.ignore-auto-dns", change.dns.length ? "yes" : "no"]
      : ["ipv4.method", "manual", "ipv4.addresses", change.address, "ipv4.gateway", change.gateway, "ipv4.dns", change.dns.join(","), "ipv4.ignore-auto-dns", "no"];
  const v6 = change.v6;
  if (!v6) return v4;
  // the gateway goes before the method: NetworkManager takes no gateway for a method without addresses
  if (v6.method === "manual") return [...v4, "ipv6.method", "manual", "ipv6.addresses", v6.address, "ipv6.gateway", v6.gateway, "ipv6.dns", v6.dns.join(","), "ipv6.ignore-auto-dns", "no"];
  return [...v4, "ipv6.gateway", "", "ipv6.addresses", "", "ipv6.method", v6.method === "off" ? "disabled" : "auto", "ipv6.dns", v6.dns.join(","), "ipv6.ignore-auto-dns", v6.dns.length ? "yes" : "no"];
}

/** IPv6 of a profile, out of `nmcli -t -f ipv6.method,ipv6.addresses,ipv6.gateway,ipv6.dns connection show` */
export function parseV6(out: string): Nic["v6"] {
  const got = props(out);
  const field = (key: string) => got.get(key) ?? "";
  const method = field("ipv6.method");
  return {
    method: method === "auto" || method === "dhcp" ? "auto" : method === "manual" ? "manual" : method === "disabled" || method === "ignore" ? "off" : "",
    address: words(field("ipv6.addresses"))[0] ?? "",
    gateway: field("ipv6.gateway").replace(/^--$/, ""),
    dns: words(field("ipv6.dns")),
  };
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

/**
 * Gives an interface back to systemd-networkd: Hata's files go, the profile stays switched off until
 * the change is kept. `waitFile` — what the boot's waiting is told from now on, "" — nothing of Hata's.
 */
export const giveBackScript = (name: string, waitFile: string): string =>
  [
    "#!/bin/sh",
    "PATH=$PATH:/usr/sbin:/sbin",
    `nmcli connection modify ${profileName(name)} connection.autoconnect no`,
    `rm -f ${HANDED(name)} ${UDEV_RULE(name)}`,
    waitFile ? `cat > ${WAIT_FILE} <<'HATA'\n${waitFile.trimEnd()}\nHATA` : `rm -f ${WAIT_FILE}`,
    "systemctl daemon-reload",
    "udevadm control --reload",
    `nmcli device set ${name} managed no`,
    `udevadm trigger --action=change /sys/class/net/${name}`,
    "networkctl reload",
    `networkctl reconfigure ${name}`,
    "",
  ].join("\n");

/** What undoes giving back to systemd-networkd: the files as they were (`saved`, a folder), the profile up again */
export const retakeScript = (name: string, saved: string): string =>
  [
    "#!/bin/sh",
    "PATH=$PATH:/usr/sbin:/sbin",
    `cp ${saved}/network ${HANDED(name)}`,
    `cp ${saved}/rule ${UDEV_RULE(name)}`,
    `mkdir -p ${WAIT_DIR}`,
    `if [ -f ${saved}/wait ]; then cp ${saved}/wait ${WAIT_FILE}; else rm -f ${WAIT_FILE}; fi`,
    "systemctl daemon-reload",
    "udevadm control --reload",
    `udevadm trigger --action=change /sys/class/net/${name}`,
    "networkctl reload",
    `nmcli device set ${name} managed yes`,
    `nmcli connection modify ${profileName(name)} connection.autoconnect yes`,
    `nmcli connection up ${profileName(name)} ifname ${name}`,
    "",
  ].join("\n");

/** What undoes giving back to ifupdown: the file with the interface commented out again, the profile up again */
export const ifupRetakeScript = (name: string, saved: string): string =>
  [
    "#!/bin/sh",
    "PATH=$PATH:/usr/sbin:/sbin",
    `ifdown --force ${name}`,
    `cp ${saved} ${INTERFACES}`,
    "systemctl restart NetworkManager",
    "sleep 3",
    `ip addr flush dev ${name}`,
    `nmcli device set ${name} managed yes`,
    `nmcli connection modify ${profileName(name)} connection.autoconnect yes`,
    `nmcli connection up ${profileName(name)} ifname ${name}`,
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

export interface Hotspot {
  ssid: string;
  password: string;
  band: "2.4" | "5";
  /** 0 — the adapter picks one */
  channel: number;
  /** The server's address on that network, with its size: `10.42.0.1/24` */
  address: string;
  /** Who has joined: what the address service remembers */
  clients: { mac: string; ip: string; name: string }[];
}

/** The channels an access point is offered: at 5 GHz those that need no waiting for radars */
export const CHANNELS = { "2.4": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "5": [36, 40, 44, 48, 149, 153, 157, 161] };

/**
 * The profile of an access point of the server's own: its network, with addresses and a way out through
 * the server. `address` — the server's own there, the addresses handed out follow it; "" — NetworkManager's choice.
 */
export function hotspotProfile(id: string, nic: string, spot: { ssid: string; password: string; band: "2.4" | "5"; channel?: number; address?: string }): string {
  const ssid = [...new TextEncoder().encode(spot.ssid)].join(";") + ";";
  return [
    "[connection]",
    `id=${id}`,
    `uuid=${crypto.randomUUID()}`,
    "type=wifi",
    `interface-name=${nic}`,
    // back by itself after a restart, and ahead of the networks the adapter could join instead
    "autoconnect=true",
    "autoconnect-priority=10",
    "",
    "[wifi]",
    "mode=ap",
    `ssid=${ssid}`,
    `band=${spot.band === "5" ? "a" : "bg"}`,
    ...(spot.channel ? [`channel=${spot.channel}`] : []),
    "",
    "[wifi-security]",
    "key-mgmt=wpa-psk",
    "proto=rsn;",
    "pairwise=ccmp;",
    // plain WPA2: left to itself NetworkManager offers WPA3 next to it, and Windows then calls a right password wrong
    "pmf=1",
    `psk=${spot.password.replace(/\\/g, "\\\\").replace(/^ /, "\\s")}`,
    "",
    "[ipv4]",
    "method=shared",
    ...(spot.address ? [`address1=${spot.address}`] : []),
    "",
    "[ipv6]",
    "method=ignore",
    "",
  ].join("\n");
}

/** The leases dnsmasq keeps for an access point: `<expires> <mac> <ip> <name> <client id>` a line */
export function parseLeases(text: string): Hotspot["clients"] {
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 4 && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(f[1]!))
    .map((f) => ({ mac: f[1]!.toLowerCase(), ip: f[2]!, name: f[3] === "*" ? "" : f[3]! }));
}

/** What a phone's camera reads to join a network: the text of the QR code */
export const wifiQrText = (ssid: string, password: string): string => `WIFI:T:WPA;S:${ssid.replace(/([\\;,":])/g, "\\$1")};P:${password.replace(/([\\;,":])/g, "\\$1")};;`;

/** A Wi-Fi password as WPA takes it: 8–63 printable characters */
export const wifiPassword = (value: unknown): value is string => typeof value === "string" && /^[\x20-\x7e]{8,63}$/.test(value);

/**
 * The NetworkManager profile of a Wi-Fi network as a file: written with mode 0600, so the password is
 * never an argument of a command, where every user of the machine could read it.
 */
export function wifiProfile(id: string, nic: string, net: { ssid: string; secure: boolean; wpa3: boolean; /** The network does not say its name: it has to be called by it */ hidden?: boolean }, password: string): string {
  // the name as a list of bytes: any characters, nothing to escape
  const ssid = [...new TextEncoder().encode(net.ssid)].join(";") + ";";
  const lines = ["[connection]", `id=${id}`, `uuid=${crypto.randomUUID()}`, "type=wifi", `interface-name=${nic}`, "", "[wifi]", "mode=infrastructure", `ssid=${ssid}`, ...(net.hidden ? ["hidden=true"] : []), ""];
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

/** The opposite of `withoutIface`: the lines commented out for an interface are the file's again; null — there are none */
export function withIface(text: string, name: string): string | null {
  const out: string[] = [];
  const lines = text.split("\n");
  let inside = false;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marked = line.startsWith(MARK);
    const body = marked ? line.slice(MARK.length) : line;
    const words = body.trim().split(/\s+/);
    const stanza = /^(iface|mapping|auto|allow-[\w-]+|source|source-directory|rename|no-auto-down|no-scripts)$/.test(words[0] ?? "");
    if (stanza) inside = marked && words[0] === "iface" && words[1] === name;
    if (marked && inside) {
      found = true;
      out.push(body);
    } else if (marked && stanza && /^(auto|allow-)/.test(words[0]!) && words.slice(1).includes(name)) {
      out.push(body);
      // the line written in its place for the other interfaces it named
      const others = words.slice(1).filter((word) => word !== name);
      if (others.length && lines[i + 1] === `${words[0]} ${others.join(" ")}`) i++;
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
  kind: "change" | "handover" | "handback";
  until: number;
  /** Opens `/network/confirm?token=…` at the new address, where the page's own session does not reach */
  token: string;
  /** The address the server is to be found at afterwards; "" — as before, or not known (DHCP) */
  address: string;
}

/** `applied` — the change has been made: before that, reaching the server proves nothing */
let pending: (Pending & { undo: () => Promise<void>; keep: () => Promise<void>; timer: Timer; applied: boolean }) | null = null;

const CHECK_FILE = "/etc/NetworkManager/conf.d/90-hata-connectivity.conf";
/** The small page NetworkManager's own project keeps for this very question */
export const CHECK_URL = "http://nmcheck.gnome.org/check_network_status.txt";

/**
 * NetworkManager's check of whether a way really reaches the internet: every minute it asks for a
 * small page through each interface, and one that gets no answer is moved behind the ways that do —
 * so a spare way takes over also when the router is on and its internet is not.
 */
export const checkConf = (): string => `# Written by Hata: Settings → Network, "Check that the internet works".\n[connectivity]\nuri=${CHECK_URL}\nresponse=NetworkManager is online\ninterval=60\n`;

/** Device → whether the internet is reached through it, out of `nmcli -t -f GENERAL.DEVICE,GENERAL.IP4-CONNECTIVITY device show` */
export function parseConnectivity(out: string): Map<string, boolean> {
  const found = new Map<string, boolean>();
  let device = "";
  for (const line of out.split("\n")) {
    const [key, value] = terse(line);
    if (key === "GENERAL.DEVICE") device = value ?? "";
    else if (key === "GENERAL.IP4-CONNECTIVITY" && device && !/unknown/.test(value ?? "")) found.set(device, /full/.test(value ?? ""));
  }
  return found;
}

export interface Trouble {
  /** main — the first way has no internet and a spare one carries it; spare — a spare way has none; none — no way has */
  code: "main" | "spare" | "none";
  nic: string;
  /** What a person calls the interface, and the one that works instead of it (for `main`) */
  label: string;
  other: string;
}

/** What NetworkManager adds to the metric of a way that does not reach the internet */
const PENALTY = 20000;

/**
 * Which ways to the internet do not reach it, from the default routes (`ip -j route show default`) and
 * what the check found. A way without an answer has its route moved behind the others, so its place in
 * the queue is read without that.
 */
export function trouble(routeJson: string, reached: Map<string, boolean>): Trouble[] {
  let routes: { dev?: string; gateway?: string; metric?: number }[] = [];
  try {
    routes = JSON.parse(routeJson || "[]");
  } catch {}
  const ways = new Map<string, { nic: string; place: number; online: boolean }>();
  for (const r of routes) {
    if (!r.dev || !r.gateway || !reached.has(r.dev) || ways.has(r.dev)) continue;
    const metric = r.metric ?? 0;
    ways.set(r.dev, { nic: r.dev, place: metric >= PENALTY ? metric - PENALTY : metric, online: reached.get(r.dev)! });
  }
  const all = [...ways.values()].sort((a, b) => a.place - b.place);
  const works = all.find((w) => w.online);
  if (!all.length || all.every((w) => w.online)) return [];
  if (!works) return [{ code: "none", nic: all[0]!.nic, label: all[0]!.nic, other: "" }];
  return all.filter((w) => !w.online).map((w) => (w.place < works.place ? { code: "main" as const, nic: w.nic, label: w.nic, other: works.nic } : { code: "spare" as const, nic: w.nic, label: w.nic, other: "" }));
}

let troubles: Trouble[] = [];
/** What the last look at the ways to the internet found; empty with the check off */
export const internetTrouble = (): Trouble[] => troubles;

/** What a person calls an interface: a modem by what it says it is, the rest by name */
function nicLabel(name: string): string {
  const device = `/sys/class/net/${name}/device`;
  return [read(`${device}/../manufacturer`), read(`${device}/../product`)].filter(Boolean).join(" ") || name;
}

async function lookAtWays(): Promise<void> {
  await lookAtSides();
  const before = JSON.stringify(troubles);
  if (!existsSync(CHECK_FILE) || !(await nmRunning())) troubles = [];
  else {
    const reached = parseConnectivity((await nmcli(["-t", "-f", "GENERAL.DEVICE,GENERAL.IP4-CONNECTIVITY", "device", "show"])).out);
    troubles = trouble((await run(["ip", "-j", "route", "show", "default"])).out, reached).map((t) => ({ ...t, label: nicLabel(t.nic), other: t.other && nicLabel(t.other) }));
  }
  if (JSON.stringify(troubles) !== before) bus.publish("network");
}

/** Keeps an eye on the ways to the internet while the check is on, for the "needs attention" list, and keeps the internet side closed */
export function startNetwork(): void {
  void closeOutside().catch(() => {});
  setTimeout(() => void lookAtWays().catch(() => {}), 20_000);
  setInterval(() => {
    void lookAtWays().catch(() => {});
    // Docker makes its chain anew when it starts, and the WireGuard port may have changed
    void closeOutside().catch(() => {});
  }, 60_000);
}

// --- The internet side ------------------------------------------------------------------------------

const hasFirewall = (): boolean => !!Bun.which("iptables", { PATH }) && !!Bun.which("ip6tables", { PATH });
/** The rules last written, so that a look every minute only checks the jumps */
let written = "";

/**
 * Writes Hata's chain for the interfaces marked as the internet side and jumps to it from where traffic
 * comes in; with none marked, takes it all away. The rules live in the kernel only, so this runs at
 * every start; a jump somebody else removed (Docker re-making `DOCKER-USER`) is put back.
 */
export async function closeOutside(): Promise<void> {
  const names = settings.network.outside;
  if (!hasFirewall()) return;
  if (!names.length) {
    if (written !== "none") for (const line of outsideDown()) await run(["sh", "-c", line], 10_000);
    written = "none";
    return;
  }
  const open = { wireguard: listeningPort() };
  const wanted = JSON.stringify([names, open]);
  for (const [tool, family] of [["iptables", "4"], ["ip6tables", "6"]] as const) {
    if (wanted !== written) {
      await run([tool, "-w", "-N", OUTSIDE_CHAIN]);
      await run([tool, "-w", "-F", OUTSIDE_CHAIN]);
      for (const rule of outsideRules(names, open, family)) {
        const done = await run([tool, "-w", ...rule]);
        if (done.code !== 0) throw new NetworkError("network.failed", { message: (done.err || done.out).trim() });
      }
    }
    for (const hook of OUTSIDE_HOOKS) {
      // DOCKER-USER is there only once Docker has run
      if ((await run([tool, "-w", "-S", hook])).code !== 0) continue;
      if ((await run([tool, "-w", "-C", hook, "-j", OUTSIDE_CHAIN])).code !== 0) await run([tool, "-w", "-I", hook, "1", "-j", OUTSIDE_CHAIN]);
    }
  }
  written = wanted;
}

/**
 * Marks an interface as the internet side, or as the home network again. Refused for the interface the
 * person is on right now — the page would go dark with nobody to undo it; `peer` is the address the
 * request came from (a proxy's, when there is one: that is the one the rules would stop).
 */
export async function setSide(name: string, side: unknown, peer: string, user: string): Promise<void> {
  if (side !== "outside" && side !== "home") throw new NetworkError("network.badSide");
  const nic = await findNic(name);
  const outside = side === "outside";
  if (outside) {
    if (!hasFirewall()) throw new NetworkError("network.needsPackage", { package: FIREWALL_PACKAGE, install: installCommand(FIREWALL_PACKAGE) });
    if (inNetworkOf(peer.replace(/^::ffff:/, ""), [...nic.addresses, ...nic.addresses6])) throw new NetworkError("network.outsideHere");
  }
  const before = settings.network.outside;
  settings.network.outside = cleanOutside(outside ? [...before, name] : before.filter((n) => n !== name));
  try {
    await closeOutside();
  } catch (e) {
    settings.network.outside = before;
    await closeOutside().catch(() => {});
    throw e;
  }
  saveSettings();
  record(outside ? "network.side.outside" : "network.side.home", { user, detail: name });
  bus.publish("network");
}

let exposed: { nic: string; address: string }[] = [];
/** Interfaces with an address the internet reaches that are not marked as the internet side */
export const exposedNics = (): { nic: string; address: string }[] => exposed;

async function lookAtSides(): Promise<void> {
  const before = JSON.stringify(exposed);
  exposed = parseLinks((await run(["ip", "-j", "addr"])).out, "[]").flatMap((link) => {
    const address = link.addresses.find(isPublic);
    return address && !settings.network.outside.includes(link.name) ? [{ nic: link.name, address: address.split("/")[0]! }] : [];
  });
  if (JSON.stringify(exposed) !== before) bus.publish("network");
}

export interface NetworkReport {
  /** The check of whether each way reaches the internet: on or off, and the page it asks for */
  check: { on: boolean; url: string };
  /** NetworkManager: ok, missing (`needs` says what to install), stopped */
  tool: "ok" | "missing" | "stopped";
  needs: { package: string; install: string } | null;
  nics: Nic[];
  pending: Pending | null;
  trial: number;
  /** The channels offered for an access point, by band */
  channels: typeof CHANNELS;
  /** iptables, which closes the internet side, is missing: what to install */
  firewall: { package: string; install: string } | null;
}

export async function networkReport(): Promise<NetworkReport> {
  const [addr, route, nm, networkd] = await Promise.all([run(["ip", "-j", "addr"]), run(["ip", "-j", "route", "show", "default"]), nmDevices(), networkdManaged()]);
  const ifupdown = ifupdownNames();
  const interfaces = read(INTERFACES);
  const checking = existsSync(CHECK_FILE);
  // device → the profile it is on
  const profiles = new Map<string, string>();
  if (nm.size) for (const line of (await nmcli(["-t", "-f", "DEVICE,UUID", "connection", "show", "--active"])).out.split("\n")) if (terse(line)[0]) profiles.set(terse(line)[0]!, terse(line)[1] ?? "");
  const reached = checking && nm.size ? parseConnectivity((await nmcli(["-t", "-f", "GENERAL.DEVICE,GENERAL.IP4-CONNECTIVITY", "device", "show"])).out) : new Map<string, boolean>();
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
      const ready = byNm && state !== "unavailable";
      let hotspot: Hotspot | null = null;
      let ap = false;
      if (ready) {
        const show = (await nmcli(["-t", "-f", "GENERAL.CONNECTION,WIFI-PROPERTIES.AP", "device", "show", link.name])).out.split("\n").map(terse);
        ap = show.find((f) => f[0] === "WIFI-PROPERTIES.AP")?.[1] === "yes";
        if (show.find((f) => f[0] === "GENERAL.CONNECTION")?.[1] === hotspotId(link.name)) {
          const got = props((await nmcli(["-s", "-t", "-f", "802-11-wireless.ssid,802-11-wireless.band,802-11-wireless.channel,802-11-wireless-security.psk", "connection", "show", hotspotId(link.name)])).out);
          const field = (key: string) => got.get(key) ?? "";
          hotspot = { ssid: field("802-11-wireless.ssid"), password: field("802-11-wireless-security.psk"), band: field("802-11-wireless.band") === "a" ? "5" : "2.4", channel: Number(field("802-11-wireless.channel")) || 0, address: link.addresses[0] ?? "", clients: joined(parseLeases(read(`/var/lib/NetworkManager/dnsmasq-${link.name}.leases`)), link.addresses[0]) };
        }
      }
      wifi = { ready, needs: supplicant ? null : { package: WIFI_PACKAGE, install: installCommand(WIFI_PACKAGE) }, ssid: hotspot ? "" : (on?.ssid ?? ""), signal: on?.signal ?? 0, ap, hotspot };
    }
    const profile = byNm ? profiles.get(link.name) : undefined;
    nics.push({
      ...link,
      ...(wifi ? { wifi } : {}),
      v6: profile ? parseV6((await nmcli(["-t", "-f", "ipv6.method,ipv6.addresses,ipv6.gateway,ipv6.dns", "connection", "show", profile])).out) : { method: "", address: "", gateway: "", dns: [] },
      handed: !byNm || isWifi ? "" : existsSync(HANDED(link.name)) ? "networkd" : withIface(interfaces, link.name) !== null ? "ifupdown" : "",
      kind: isWifi ? "wifi" : modem ? "modem" : "ethernet",
      // a USB interface hangs under its device, where the names are
      product: usb ? [read(`${device}/../manufacturer`), read(`${device}/../product`)].filter(Boolean).join(" ") : "",
      dns: link.addresses.length ? await dnsOf(link.name, byNm) : [],
      outside: settings.network.outside.includes(link.name),
      public: link.addresses.find(isPublic)?.split("/")[0] ?? "",
      online: byNm && link.internet !== "none" ? (reached.get(link.name) ?? null) : null,
      // NetworkManager keeps this file for an interface only while it shares the internet there
      shares: byNm && !isWifi && existsSync(`/run/nm-dnsmasq-${link.name}.pid`) ? joined(parseLeases(read(`/var/lib/NetworkManager/dnsmasq-${link.name}.leases`)), link.addresses[0]) : null,
      speed: speed > 0 ? speed : null,
      manager: byNm ? "nm" : networkd.has(link.name) ? "networkd" : ifupdown.has(link.name) ? "ifupdown" : "",
    });
  }
  const running = nm.size > 0 || (await nmRunning());
  return {
    tool: !hasNm() ? "missing" : running ? "ok" : "stopped",
    needs: hasNm() ? null : { package: PACKAGE, install: installCommand(PACKAGE) },
    nics,
    check: { on: checking, url: CHECK_URL },
    pending: pending && { nic: pending.nic, kind: pending.kind, until: pending.until, token: pending.token, address: pending.address },
    trial: TRIAL_S,
    channels: CHANNELS,
    firewall: hasFirewall() ? null : { package: FIREWALL_PACKAGE, install: installCommand(FIREWALL_PACKAGE) },
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
  record(kept.kind === "handover" ? "network.handedOver" : kept.kind === "handback" ? "network.givenBack" : "network.changed", { detail: kept.nic });
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

/** A network of the server's own cannot have the addresses of one it is already on: nothing would know which is meant */
async function mustBeFree(address: string, name: string): Promise<void> {
  if (!address) return;
  for (const other of (await networkReport()).nics) {
    const taken = other.name !== name && other.addresses.find((a) => overlaps(a, address));
    if (taken) throw new NetworkError("network.addressTaken", { address: taken, nic: other.name });
  }
}

const addressOf = (change: Change, nic: Nic): string => (change.method === "manual" && !nic.addresses.includes(change.address) ? change.address.split("/")[0]! : "");

/** Changes the IPv4 settings of an interface NetworkManager looks after; applied a moment after the answer */
export async function changeNic(name: string, input: Record<string, unknown>, user: string): Promise<Pending> {
  if (pending) throw new NetworkError("network.pending");
  const change = cleanChange(input);
  if (typeof change === "string") throw new NetworkError(change);
  const nic = await findNic(name);
  if (nic.manager !== "nm") throw new NetworkError("network.notOurs");
  if (change.method === "shared") {
    // the internet cannot be given out through the interface it comes in by
    if (nic.internet === "main" || nic.wifi) throw new NetworkError("network.shareMain");
    if (!Bun.which("dnsmasq", { PATH })) throw new NetworkError("network.needsPackage", { package: SHARE_PACKAGE, install: installCommand(SHARE_PACKAGE) });
    await mustBeFree(change.address, name);
  }
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
  const edited = ifupdown ? withoutIface(readFileSync(INTERFACES, "utf8"), name) : null;
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

/**
 * Gives an interface Hata handed over back to the service it was taken from: systemd-networkd or
 * ifupdown sets it up again, by its own files — which may say another address than the interface has
 * now. On trial like the hand-over: the profile is kept, switched off, until the change is.
 */
export async function giveBack(name: string, user: string): Promise<Pending> {
  if (pending) throw new NetworkError("network.pending");
  const nic = await findNic(name);
  if (!nic.handed) throw new NetworkError("network.notHanded");
  const dir = `/run/hata-network-back-${name}`;
  const script = `${dir}/undo.sh`;
  const unit = `hata-network-undo-${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let forward: () => Promise<void>;
  if (nic.handed === "ifupdown") {
    const now = readFileSync(INTERFACES, "utf8");
    const restored = withIface(now, name)!;
    writeFileSync(`${dir}/interfaces`, now);
    writeFileSync(script, ifupRetakeScript(name, `${dir}/interfaces`), { mode: 0o700 });
    forward = async () => {
      await nmcli(["connection", "modify", profileName(name), "connection.autoconnect", "no"]);
      writeFileSync(INTERFACES, restored);
      // NetworkManager lets go of what that file names, and reads it only when it starts
      await run(["systemctl", "restart", "NetworkManager"], 60_000);
      for (let i = 0; i < 20 && !(await nmRunning()); i++) await Bun.sleep(500);
      await nmcli(["device", "set", name, "managed", "no"]);
      await run(["ip", "addr", "flush", "dev", name]);
      await run(["ifup", "--force", name], 60_000);
    };
  } else {
    for (const [from, to] of [[HANDED(name), "network"], [UDEV_RULE(name), "rule"], [WAIT_FILE, "wait"]] as const) if (existsSync(from)) writeFileSync(`${dir}/${to}`, readFileSync(from));
    const handed = [...new Bun.Glob("00-hata-*.network").scanSync({ cwd: "/etc/systemd/network" })].map((file) => file.slice(8, -8)).filter((other) => other !== name);
    writeFileSync(script, retakeScript(name, dir), { mode: 0o700 });
    writeFileSync(`${dir}/forward.sh`, giveBackScript(name, handed.length ? waitOnline(handed, [...(await networkdManaged()), name]) : ""), { mode: 0o700 });
    forward = async () => void (await run(["/bin/sh", `${dir}/forward.sh`], 60_000));
  }
  await run(["systemctl", "stop", `${unit}.timer`]);
  await must(run(["systemd-run", "--unit", unit, "--collect", "--quiet", `--on-active=${TRIAL_S + 5}`, "/bin/sh", script]));
  setTimeout(async () => {
    await forward();
    // the service takes its time to ask the router for an address
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await Bun.sleep(1000);
      up = (parseLinks((await run(["ip", "-j", "addr"])).out, "").find((l) => l.name === name)?.addresses.length ?? 0) > 0;
    }
    await applied(up);
  }, 400);
  return startTrial({ nic: name, kind: "handback", address: "" }, user, {
    undo: async () => {
      await run(["systemctl", "stop", `${unit}.timer`]);
      await run(["/bin/sh", script], 60_000);
      rmSync(dir, { recursive: true, force: true });
    },
    keep: async () => {
      await run(["systemctl", "stop", `${unit}.timer`]);
      await nmcli(["connection", "delete", profileName(name)]);
      rmSync(dir, { recursive: true, force: true });
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
    const ssid = props((await nmcli(["-t", "-f", "802-11-wireless.ssid", "connection", "show", name])).out).get("802-11-wireless.ssid");
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
 * nothing is kept of the attempt: the interface goes back to the network it was on. `hidden` — a
 * network that does not say its name and so is in no list: it is called by the name typed in.
 */
export async function wifiConnect(name: string, input: Record<string, unknown>, user: string): Promise<void> {
  const nic = await wifiNic(name);
  const ssid = typeof input.ssid === "string" ? input.ssid : "";
  if (!ssid || new TextEncoder().encode(ssid).length > 32) throw new NetworkError("network.badSsid");
  const saved = (await savedWifi()).get(ssid);
  const seen = (await wifiNetworks(name)).find((n) => n.ssid === ssid);
  const net = seen ?? (input.hidden === true ? { ssid, secure: typeof input.password === "string" && input.password !== "", wpa3: false, hidden: true } : undefined);
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
  // an adapter does one thing at a time: joining a network ends its access point
  const spot = nic.wifi!.hotspot ? hotspotId(name) : "";
  const up = await nmcli(["--wait", "40", "connection", "up", profile, "ifname", name], 60_000);
  if (up.code !== 0) {
    // an attempt that failed leaves no profile behind: it would be tried again on every start
    if (fresh) await nmcli(["connection", "delete", profile]);
    if (spot) await nmcli(["--wait", "40", "connection", "up", spot, "ifname", name], 60_000);
    const text = up.err + up.out;
    throw new NetworkError(/secrets were required|802-1x|wrong|password/i.test(text) ? "network.wifiWrongPassword" : "network.wifiFailed", { message: text.trim().split("\n").slice(-1)[0] ?? "" });
  }
  // or it would take the adapter back at the next start
  if (spot) await nmcli(["connection", "delete", spot]);
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
  // the address may be asked for anew, and a modem takes its time to answer: whoever asks for the
  // report next should see the routes as they will be
  for (let i = 0; i < 25; i++) {
    await Bun.sleep(1000);
    const now = parseLinks((await run(["ip", "-j", "addr"])).out, (await run(["ip", "-j", "route", "show", "default"])).out).find((l) => l.name === name);
    if (!now || !nic.addresses.length || (now.addresses.length && (role === "off" ? now.internet === "none" : now.internet !== "none"))) break;
  }
  record("network.role." + role, { user, detail: name });
  bus.publish("network");
}

// --- The server's own access point ------------------------------------------------------------------

/**
 * Turns the Wi-Fi adapter into an access point: a network of the server's own, with addresses handed
 * out and the way to the internet shared through the server. An adapter does one thing at a time, so
 * the network it was on is left — refused when that network is the only way to reach the server.
 */
export async function startHotspot(name: string, input: Record<string, unknown>, user: string): Promise<void> {
  const nic = await wifiNic(name);
  if (!nic.wifi!.ap) throw new NetworkError("network.noAp");
  if (!Bun.which("dnsmasq", { PATH })) throw new NetworkError("network.needsPackage", { package: SHARE_PACKAGE, install: installCommand(SHARE_PACKAGE) });
  const ssid = typeof input.ssid === "string" ? input.ssid.trim() : "";
  if (!ssid || new TextEncoder().encode(ssid).length > 32 || /[\x00-\x1f]/.test(ssid)) throw new NetworkError("network.badSsid");
  if (!wifiPassword(input.password)) throw new NetworkError("network.badWifiPassword");
  const band = input.band === "5" ? "5" : "2.4";
  const channel = Number(input.channel) || 0;
  if (channel && !CHANNELS[band].includes(channel)) throw new NetworkError("network.badChannel");
  const address = shareAddress(input.address);
  if (address === null) throw new NetworkError("network.badShareAddress");
  await mustBeFree(address, name);
  const others = (await networkReport()).nics.filter((n) => n.name !== name && n.addresses.length > 0);
  if (nic.addresses.length && !nic.wifi!.hotspot && !others.length) throw new NetworkError("network.hotspotOnlyWay");
  const id = hotspotId(name);
  const file = `${PROFILES}/${id}.nmconnection`;
  await nmcli(["connection", "delete", id]);
  mkdirSync(PROFILES, { recursive: true });
  writeFileSync(file, hotspotProfile(id, name, { ssid, password: input.password, band, channel, address }), { mode: 0o600 });
  await must(nmcli(["connection", "load", file]));
  const up = await nmcli(["--wait", "40", "connection", "up", id, "ifname", name], 60_000);
  if (up.code !== 0) {
    await nmcli(["connection", "delete", id]);
    throw new NetworkError("network.hotspotFailed", { message: (up.err + up.out).trim().split("\n").slice(-1)[0] ?? "" });
  }
  record("network.hotspot.on", { user, detail: ssid });
  bus.publish("network");
}

export async function stopHotspot(name: string, user: string): Promise<void> {
  await wifiNic(name);
  await must(nmcli(["connection", "delete", hotspotId(name)]));
  record("network.hotspot.off", { user, detail: name });
  bus.publish("network");
}

/** Turns NetworkManager's check of the internet on or off */
export async function setCheck(on: unknown, user: string): Promise<void> {
  if (!(await nmRunning())) throw new NetworkError("network.noTool");
  if (on === true) {
    mkdirSync("/etc/NetworkManager/conf.d", { recursive: true });
    writeFileSync(CHECK_FILE, checkConf());
  } else rmSync(CHECK_FILE, { force: true });
  await must(nmcli(["general", "reload", "conf"]));
  // the first answers, so the page does not show "not known" for a minute
  if (on === true) await nmcli(["networking", "connectivity", "check"], 30_000);
  await lookAtWays().catch(() => {});
  record(on === true ? "network.check.on" : "network.check.off", { user });
  bus.publish("network");
}
