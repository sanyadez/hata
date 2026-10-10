/**
 * Names on the home network without a DNS server: Hata answers multicast DNS (RFC 6762) for
 * `<name>.local` and for every `<app>.<name>.local` with the address of this machine. Phones and
 * computers ask the whole network for names ending in `.local`, so nothing is set up on them.
 *
 * The packets are pure functions; the responder below them listens on UDP 5353 next to whatever else
 * does (Avahi, systemd-resolved) and answers only for its own names.
 */
import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { settings } from "./config";
import { localDomain } from "./site";

const GROUP = "224.0.0.251";
const PORT = 5353;
const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_NSEC = 47;
const TYPE_ANY = 255;
/** How long an answer may be remembered, seconds: short, so a changed address is noticed */
const TTL = 120;

export interface Question {
  name: string;
  type: number;
  /** The asker wants the answer sent to it alone (the top bit of the class) */
  unicast: boolean;
}

export interface Query {
  id: number;
  questions: Question[];
}

/** Reads the questions of a DNS query; null for anything that is not one (answers, broken packets) */
export function parseQuery(packet: Uint8Array): Query | null {
  if (packet.length < 12) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  // an answer, or an operation other than a plain query
  if (view.getUint16(2) & 0xf800) return null;
  const count = view.getUint16(4);
  const questions: Question[] = [];
  let at = 12;
  for (let i = 0; i < count; i++) {
    const labels: string[] = [];
    let pos = at;
    let jumped = false;
    // a name is labels up to an empty one; a pointer continues it somewhere earlier in the packet
    for (let hops = 0; ; hops++) {
      if (pos >= packet.length || hops > 64) return null;
      const length = packet[pos]!;
      if (length === 0) {
        if (!jumped) at = pos + 1;
        break;
      }
      if ((length & 0xc0) === 0xc0) {
        if (pos + 1 >= packet.length) return null;
        if (!jumped) at = pos + 2;
        jumped = true;
        pos = ((length & 0x3f) << 8) | packet[pos + 1]!;
        continue;
      }
      if (length > 63 || pos + 1 + length > packet.length) return null;
      labels.push(new TextDecoder().decode(packet.subarray(pos + 1, pos + 1 + length)));
      pos += 1 + length;
    }
    if (at + 4 > packet.length) return null;
    const cls = view.getUint16(at + 2);
    // class IN only
    if ((cls & 0x7fff) === 1) questions.push({ name: labels.join(".").toLowerCase(), type: view.getUint16(at), unicast: (cls & 0x8000) !== 0 });
    at += 4;
  }
  return { id: view.getUint16(0), questions };
}

function encodeName(name: string): number[] {
  const out: number[] = [];
  for (const label of name.split(".")) {
    const bytes = new TextEncoder().encode(label);
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  return out;
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [...u16(n >>> 16), ...u16(n & 0xffff)];

/**
 * The answer to a query, or null when it asks for nothing of ours. `ours` says whether a name is one we
 * answer for; `address` is this machine's IPv4 address as the asker reaches it. A question for the IPv6
 * address gets "there is only an IPv4 one" (an NSEC record), so the asker does not wait for more.
 * `legacy` — the asker is an ordinary DNS client (not on port 5353): it gets its id and question back.
 */
export function answerQuery(query: Query, ours: (name: string) => boolean, address: string, legacy = false): Uint8Array | null {
  const ip = address.split(".").map(Number);
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const mine = query.questions.filter((q) => ours(q.name) && [TYPE_A, TYPE_AAAA, TYPE_ANY].includes(q.type));
  if (!mine.length) return null;
  // an ordinary client knows nothing of the "flush what you had" bit and must not keep the answer long
  const cls = u16(legacy ? 1 : 0x8001);
  const ttl = u32(legacy ? 10 : TTL);
  const records = new Map<string, number[]>();
  for (const q of mine) {
    const name = encodeName(q.name);
    if (q.type !== TYPE_AAAA) records.set(q.name + " A", [...name, ...u16(TYPE_A), ...cls, ...ttl, ...u16(4), ...ip]);
    // the name itself as "the next one", and a bitmap with the one type it has: A
    else records.set(q.name + " NSEC", [...name, ...u16(TYPE_NSEC), ...cls, ...ttl, ...u16(name.length + 3), ...name, 0, 1, 0x40]);
  }
  const asked = legacy ? mine.flatMap((q) => [...encodeName(q.name), ...u16(q.type), ...u16(1)]) : [];
  return new Uint8Array([...u16(legacy ? query.id : 0), ...u16(0x8400), ...u16(legacy ? mine.length : 0), ...u16(records.size), ...u16(0), ...u16(0), ...asked, ...[...records.values()].flat()]);
}

/** Whether `name` is the local domain itself or one label under it (an app's) */
export const isLocalName = (name: string, domain: string): boolean => name === domain || (name.endsWith("." + domain) && !name.slice(0, -domain.length - 1).includes("."));

export interface Link {
  address: string;
  netmask: string;
}

const toNumber = (ip: string): number => ip.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);

/** The address of ours that is on the same network as the asker; null when it asks from elsewhere */
export function addressFor(remote: string, links: Link[]): string | null {
  for (const link of links) {
    const mask = toNumber(link.netmask);
    // bitwise operators give signed numbers: compare what they give, not the numbers themselves
    if (mask && (toNumber(link.address) & mask) === (toNumber(remote) & mask)) return link.address;
  }
  return null;
}

// --- The responder ----------------------------------------------------------------------------------

/** Bridges and pairs Docker makes for containers: nobody on them looks for the server by name */
const INSIDE = /^(docker|br-|veth|virbr|cni|flannel|lxcbr|podman)/;

/** The addresses of this machine on the networks people are on */
export function homeLinks(): Link[] {
  return Object.entries(networkInterfaces()).flatMap(([name, list]) => (INSIDE.test(name) ? [] : (list ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => ({ address: a.address, netmask: a.netmask }))));
}

let socket: Socket | null = null;
let listening = false;
let failure = "";
let joined = new Set<string>();
let upkeep: Timer | null = null;

/** Joins the multicast group on every network that appeared since the last look */
function join(): void {
  if (!socket || !listening) return;
  const now = new Set(homeLinks().map((link) => link.address));
  for (const address of now) {
    if (joined.has(address)) continue;
    try {
      socket.addMembership(GROUP, address);
    } catch {
      // already a member through another address of the same interface
    }
  }
  joined = now;
}

/** Tells the networks our name without being asked: whoever remembered another address forgets it */
function announce(): void {
  const domain = localDomain();
  if (!socket || !listening || !domain) return;
  for (const link of homeLinks()) {
    const packet = answerQuery({ id: 0, questions: [{ name: domain, type: TYPE_A, unicast: false }] }, () => true, link.address);
    if (!packet) continue;
    try {
      socket.setMulticastInterface(link.address);
      socket.send(packet, PORT, GROUP);
    } catch {
      // a network that just went away
    }
  }
}

function onPacket(packet: Uint8Array, remote: { address: string; port: number }): void {
  const domain = localDomain();
  if (!socket || !domain) return;
  const query = parseQuery(packet);
  if (!query?.questions.length) return;
  const address = addressFor(remote.address, homeLinks());
  if (!address) return;
  const legacy = remote.port !== PORT;
  const answer = answerQuery(query, (name) => isLocalName(name, domain), address, legacy);
  if (!answer) return;
  try {
    if (legacy || query.questions.every((q) => q.unicast)) socket.send(answer, remote.port, remote.address);
    else {
      socket.setMulticastInterface(address);
      socket.send(answer, PORT, GROUP);
    }
  } catch {
    // the answer is asked for again
  }
}

/** Brings the responder in line with the settings: listening when local names are on, silent otherwise */
export function refreshLocalNames(): void {
  if (!settings.local.enabled) {
    socket?.close();
    socket = null;
    listening = false;
    failure = "";
    if (upkeep) clearInterval(upkeep);
    upkeep = null;
    return;
  }
  if (socket) return announce();
  failure = "";
  joined = new Set();
  // the port is shared: another responder on this machine keeps answering for its own names
  const made = createSocket({ type: "udp4", reuseAddr: true });
  made.on("error", (e) => {
    failure = e.message;
    console.error(`Local names are off: ${e.message}`);
    made.close();
    if (socket === made) (socket = null), (listening = false);
  });
  made.on("message", onPacket);
  socket = made;
  made.bind(PORT, () => {
    listening = true;
    made.setMulticastTTL(255);
    made.setMulticastLoopback(false);
    join();
    announce();
  });
  // networks come and go (a cable, Wi-Fi): look again now and then
  upkeep ??= setInterval(() => (socket ? join() : refreshLocalNames()), 60_000);
}

export function localNamesStatus(): { enabled: boolean; name: string; domain: string; listening: boolean; error: string; addresses: string[] } {
  return { enabled: settings.local.enabled, name: settings.local.name, domain: localDomain(), listening, error: failure, addresses: homeLinks().map((link) => link.address) };
}
