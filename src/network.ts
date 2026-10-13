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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { record } from "./activity";
import { bus } from "./bus";
import { installCommand, PATH, run } from "./packages";

const TRIAL_S = 90;
/** Interfaces that are Docker's or a tunnel's, not the server's way to the network */
const NOT_OURS = /^(lo|docker|br-|veth|virbr|cni|flannel|lxcbr|podman|tun|tap|wg|tailscale|zt)/;
const PACKAGE = "network-manager";
const NM = ["org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager", "org.freedesktop.NetworkManager"];
const HANDED = (name: string) => `/etc/systemd/network/00-hata-${name}.network`;
const UDEV_RULE = (name: string) => `/etc/udev/rules.d/99-zz-hata-${name}.rules`;
const WAIT_DIR = "/etc/systemd/system/systemd-networkd-wait-online.service.d";
const WAIT_FILE = `${WAIT_DIR}/zz-hata.conf`;
const profileName = (name: string) => `hata-${name}`;

export interface Nic {
  name: string;
  kind: "ethernet" | "wifi" | "other";
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
}

interface IpLink {
  ifname: string;
  link_type?: string;
  address?: string;
  flags?: string[];
  addr_info?: { family: string; local: string; prefixlen: number; scope?: string; dynamic?: boolean }[];
}

/** The interfaces out of `ip -j addr` and `ip -j route show default`, without Docker's and tunnels */
export function parseLinks(addrJson: string, routeJson: string): Pick<Nic, "name" | "mac" | "up" | "addresses" | "addresses6" | "dynamic" | "gateway">[] {
  let links: IpLink[] = [];
  let routes: { dev?: string; gateway?: string }[] = [];
  try {
    links = JSON.parse(addrJson);
    routes = JSON.parse(routeJson || "[]");
  } catch {}
  return links
    .filter((l) => l.link_type === "ether" && !NOT_OURS.test(l.ifname))
    .map((l) => {
      const v4 = (l.addr_info ?? []).filter((a) => a.family === "inet");
      return {
        name: l.ifname,
        mac: l.address ?? "",
        up: (l.flags ?? []).includes("LOWER_UP"),
        addresses: v4.map((a) => `${a.local}/${a.prefixlen}`),
        addresses6: (l.addr_info ?? []).filter((a) => a.family === "inet6" && a.scope === "global").map((a) => `${a.local}/${a.prefixlen}`),
        dynamic: v4.some((a) => a.dynamic === true),
        gateway: routes.find((r) => r.dev === l.ifname && r.gateway)?.gateway ?? "",
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

let pending: (Pending & { undo: () => Promise<void>; keep: () => Promise<void>; timer: Timer }) | null = null;

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
    nics.push({
      ...link,
      kind: existsSync(`/sys/class/net/${link.name}/wireless`) ? "wifi" : "ethernet",
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
  pending = { ...p, until, token, timer, ...hooks };
  return { ...p, until, token };
}

/** Keeps the change on trial. `token` — from the link; without one the caller is a signed-in administrator */
export async function confirmChange(token?: string): Promise<boolean> {
  if (!pending || (token !== undefined && token !== pending.token)) return false;
  const kept = pending;
  pending = null;
  clearTimeout(kept.timer);
  await kept.keep().catch(() => {});
  record(kept.kind === "handover" ? "network.handedOver" : "network.changed", { detail: kept.nic });
  bus.publish("network");
  return true;
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
  setTimeout(() => void nmcli(["connection", "up", uuid, "ifname", name], 60_000), 400);
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
  if (nic.manager !== "networkd") throw new NetworkError("network.cannotHandOver");
  const change: Change = nic.dynamic || !nic.addresses.length ? { method: "auto", address: "", gateway: "", dns: [] } : { method: "manual", address: nic.addresses[0]!, gateway: nic.gateway, dns: nic.dns };
  const script = `/run/hata-network-undo-${name}.sh`;
  const unit = `hata-network-undo-${name}`;
  writeFileSync(script, handBackScript(name), { mode: 0o700 });
  await run(["systemctl", "stop", `${unit}.timer`]);
  await must(run(["systemd-run", "--unit", unit, "--collect", "--quiet", `--on-active=${TRIAL_S + 5}`, "/bin/sh", script]));
  const undo = async () => {
    await run(["systemctl", "stop", `${unit}.timer`]);
    await run(["/bin/sh", script], 60_000);
    rmSync(script, { force: true });
  };
  try {
    await nmcli(["connection", "delete", profileName(name)]);
    await must(nmcli(["connection", "add", "type", "ethernet", "ifname", name, "con-name", profileName(name), "autoconnect", "yes", "save", "yes", ...profileArgs(change)]));
  } catch (e) {
    await undo();
    throw e;
  }
  setTimeout(async () => {
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
    await nmcli(["device", "set", name, "managed", "yes"]);
    await nmcli(["connection", "up", profileName(name), "ifname", name], 60_000);
  }, 400);
  return startTrial({ nic: name, kind: "handover", address: "" }, user, {
    undo,
    keep: async () => {
      await run(["systemctl", "stop", `${unit}.timer`]);
      rmSync(script, { force: true });
    },
  });
}
