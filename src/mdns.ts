/**
 * Names on the home network without a DNS server: Hata answers multicast DNS (RFC 6762) for
 * `<name>.local` and for every `<app>.<name>.local` with the address of this machine. Phones and
 * computers ask the whole network for names ending in `.local`, so nothing is set up on them. A name
 * with another ending (`hata.lan`) is not ours to answer: the home's DNS has to know it.
 *
 * The same way it tells what this machine serves (DNS-SD, RFC 6763): the shared folders, so that the
 * server shows up by itself in Finder and in the file managers of phones.
 *
 * The packets are pure functions; the responder below them listens on UDP 5353 next to whatever else
 * does (Avahi, systemd-resolved) and answers only for its own names.
 */
import { createSocket, type Socket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { settings } from "./config";
import { localDomain } from "./site";

const GROUP = "224.0.0.251";
const PORT = 5353;
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_AAAA = 28;
const TYPE_SRV = 33;
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

/** Something this machine serves, to be found by browsing the network */
export interface Service {
  /** The kind, as browsers ask for it: `_smb._tcp` */
  type: string;
  /** 0 — nothing to connect to, only a description (`_device-info._tcp`) */
  port: number;
  txt?: string[];
}

/** What is served and under which name: the host (`hata.local`), whose first label names every service */
export interface Offer {
  host: string;
  services: Service[];
}

/** The question a browser asks to learn which kinds of services there are at all */
const KINDS = "_services._dns-sd._udp.local";

const instanceOf = (offer: Offer, service: Service): string => `${offer.host.split(".")[0]}.${service.type}.local`;

const txtData = (strings: string[] = []): number[] => {
  const out = strings.flatMap((text) => {
    const bytes = [...new TextEncoder().encode(text)].slice(0, 255);
    return [bytes.length, ...bytes];
  });
  // a description with nothing in it is still one empty string
  return out.length ? out : [0];
};

/**
 * The answer to a query, or null when it asks for nothing of ours. `ours` says whether a name is one we
 * answer for; `address` is this machine's IPv4 address as the asker reaches it. A question for the IPv6
 * address gets "there is only an IPv4 one" (an NSEC record), so the asker does not wait for more.
 * `legacy` — the asker is an ordinary DNS client (not on port 5353): it gets its id and question back.
 * With an `offer`, questions about its services are answered too; whoever asks who serves a kind is
 * told, in the same packet, where that is (port, description, address). `ttl` 0 takes the records back.
 */
export function answerQuery(query: Query, ours: (name: string) => boolean, address: string, legacy = false, offer: Offer | null = null, ttl = TTL): Uint8Array | null {
  const ip = address.split(".").map(Number);
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  // an ordinary client knows nothing of the "flush what you had" bit and must not keep the answer long;
  // a record others may hold as well (who serves a kind) never carries that bit
  const record = (name: string, type: number, data: number[], shared = false): number[] => [...encodeName(name), ...u16(type), ...u16(legacy || shared ? 1 : 0x8001), ...u32(legacy ? Math.min(ttl, 10) : ttl), ...u16(data.length), ...data];
  const a = (name: string) => record(name, TYPE_A, ip);
  const srv = (service: Service) => record(instanceOf(offer!, service), TYPE_SRV, [...u16(0), ...u16(0), ...u16(service.port), ...encodeName(offer!.host)]);
  const txt = (service: Service) => record(instanceOf(offer!, service), TYPE_TXT, txtData(service.txt));

  const answers = new Map<string, number[]>();
  const extras = new Map<string, number[]>();
  const mine: Question[] = [];
  for (const q of query.questions) {
    const before = answers.size;
    const wants = (type: number) => q.type === type || q.type === TYPE_ANY;
    if (ours(q.name)) {
      if (wants(TYPE_A)) answers.set(q.name + " A", a(q.name));
      // the name itself as "the next one", and a bitmap with the one type it has: A
      else if (q.type === TYPE_AAAA) answers.set(q.name + " NSEC", record(q.name, TYPE_NSEC, [...encodeName(q.name), 0, 1, 0x40]));
    }
    for (const service of offer?.services ?? []) {
      const kind = `${service.type}.local`;
      const instance = instanceOf(offer!, service);
      if (service.port && wants(TYPE_PTR)) {
        if (q.name === KINDS) answers.set(kind + " KIND", record(KINDS, TYPE_PTR, encodeName(kind), true));
        if (q.name === kind) {
          answers.set(instance + " PTR", record(kind, TYPE_PTR, encodeName(instance), true));
          extras.set(instance + " SRV", srv(service)).set(instance + " TXT", txt(service)).set(offer!.host + " A", a(offer!.host));
        }
      }
      if (q.name !== instance) continue;
      if (service.port && wants(TYPE_SRV)) {
        answers.set(instance + " SRV", srv(service));
        extras.set(offer!.host + " A", a(offer!.host));
      }
      if (wants(TYPE_TXT)) answers.set(instance + " TXT", txt(service));
    }
    if (answers.size > before) mine.push(q);
  }
  if (!answers.size) return null;
  for (const key of answers.keys()) extras.delete(key);
  // taking a service back must not take the machine's name with it
  if (!ttl) extras.clear();
  const asked = legacy ? mine.flatMap((q) => [...encodeName(q.name), ...u16(q.type), ...u16(1)]) : [];
  return new Uint8Array([...u16(legacy ? query.id : 0), ...u16(0x8400), ...u16(legacy ? mine.length : 0), ...u16(answers.size), ...u16(0), ...u16(extras.size), ...asked, ...[...answers.values()].flat(), ...[...extras.values()].flat()]);
}

/** Everything of ours said at once, unasked: the name and what is served under it */
export function announcement(host: string, services: Service[], address: string, ttl = TTL): Uint8Array | null {
  const offer = { host, services };
  const questions = [...(ttl ? [{ name: host, type: TYPE_A, unicast: false }] : []), ...services.flatMap((service) => [{ name: `${service.type}.local`, type: TYPE_PTR, unicast: false }, { name: instanceOf(offer, service), type: TYPE_ANY, unicast: false }])];
  return answerQuery({ id: 0, questions }, (name) => name === host, address, false, offer, ttl);
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

/** Multicast DNS is for names ending in `.local` only: any other name is the business of the home's DNS */
export const answersItself = (domain: string): boolean => domain.endsWith(".local");

let socket: Socket | null = null;
let listening = false;
let failure = "";
let joined = new Set<string>();
let upkeep: Timer | null = null;
let services: Service[] = [];

function sendAll(packetFor: (address: string) => Uint8Array | null): void {
  if (!socket || !listening) return;
  for (const link of homeLinks()) {
    const packet = packetFor(link.address);
    if (!packet) continue;
    try {
      socket.setMulticastInterface(link.address);
      socket.send(packet, PORT, GROUP);
    } catch {
      // a network that just went away
    }
  }
}

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

/** Tells the networks our name and what we serve without being asked: whoever remembered otherwise forgets it */
function announce(): void {
  const domain = localDomain();
  if (domain) sendAll((address) => announcement(domain, services, address));
}

/**
 * What this machine serves, for those who browse the network; an empty list takes it all back. The
 * services go by the first label of the local name, and are told only while Hata answers for that name.
 */
export function offer(list: Service[]): void {
  const domain = localDomain();
  const gone = services.filter((old) => !list.some((service) => service.type === old.type));
  // a goodbye: the same records with no time to live
  if (domain && gone.length) sendAll((address) => announcement(domain, gone, address, 0));
  services = list;
  announce();
}

/** Whether those who browse the network are being told what is served */
export const offering = (): boolean => listening && services.length > 0;

function onPacket(packet: Uint8Array, remote: { address: string; port: number }): void {
  const domain = localDomain();
  if (!socket || !domain) return;
  const query = parseQuery(packet);
  if (!query?.questions.length) return;
  const address = addressFor(remote.address, homeLinks());
  if (!address) return;
  const legacy = remote.port !== PORT;
  const answer = answerQuery(query, (name) => isLocalName(name, domain), address, legacy, { host: domain, services });
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

/** Brings the responder in line with the settings: listening when there is a name of ours to answer for */
export function refreshLocalNames(): void {
  if (!answersItself(localDomain())) {
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

/** Where a name leads according to the DNS this machine uses — usually the router's, the same the home asks */
async function leadsHere(host: string, addresses: string[]): Promise<{ host: string; ok: boolean; found: string[] }> {
  const found = await lookup(host, { family: 4, all: true }).then((list) => list.map((one) => one.address), () => []);
  return { host, ok: found.some((address) => addresses.includes(address)), found };
}

/**
 * How the name on the home network is doing. One we answer for ourselves: whether the responder listens.
 * Any other: whether it, and a made-up app name under it, lead to this machine.
 */
export async function localNamesStatus() {
  const domain = localDomain();
  const addresses = homeLinks().map((link) => link.address);
  const own = answersItself(domain);
  return { enabled: settings.local.enabled, name: settings.local.name, domain, own, listening, error: failure, addresses, checks: domain && !own ? await Promise.all([leadsHere(domain, addresses), leadsHere(`hata-check.${domain}`, addresses)]) : [] };
}
