/**
 * Hata as the home's DNS server (Settings → DNS server; `dns.ts` is the pure part). It listens on port 53
 * of the server's addresses in the home network — each address on its own, never on all of them at once:
 * systemd-resolved keeps 127.0.0.53, and the bridges of Incus and of an access point have dnsmasq of their
 * own. It answers only askers of private networks (never an open resolver for the internet), the internet
 * side is closed anyway (`outside.ts`).
 */
import { createSocket, type Socket } from "node:dgram";
import { createServer, connect, type Server as NetServer } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { record } from "./activity";
import type { AttentionItem } from "./attention";
import { saveSettings, settings } from "./config";
import { siteDomain } from "./site";
import { aged, challengeAnswer, challengeName, cleanDns, cleanRecord, ipv4, ipv6, keepFor, loopName, nameData, nameservers, OWN_TTL, ownAnswer, queryFor, RCODE, readAsk, recordsOf, reply, truncated, txtData, TYPE, upstreamsOf, withId, type Answer, type Ask, type DnsSettings, type Upstream } from "./dns";
import { blockedAnswer, type Rewrite } from "./dnsblock";
import { blockFor, blocking, note, takePlan, type ImportParts } from "./dnsblocker";
import { homeLinks } from "./mdns";
import { isPublic } from "./outside";
import { PATH, run } from "./packages";

const PORT = Number(process.env.HATA_DNS_PORT ?? 53);
const UDP_WAIT_MS = 2000;
const DOH_WAIT_MS = 4000;
const CACHE_MAX = 5000;

interface Listener {
  address: string;
  udp: Socket;
  tcp: NetServer;
}

const listeners = new Map<string, Listener>();
/** Addresses that could not be listened on, with why and who holds the port */
const failed = new Map<string, { error: string; holder: string }>();
const cache = new Map<string, { at: number; keep: number; packet: Uint8Array }>();
const stats = { queries: 0, cached: 0, own: 0, upstream: 0, failed: 0, refused: 0, blocked: 0, since: Date.now() };
/** Who asked lately: the page tells a device whether it uses Hata */
const clients = new Map<string, { count: number; last: number }>();
/** The upstream servers: when each last answered or failed, and the last failure */
const health = new Map<string, { ok: number; fail: number; error: string }>();
/** Upstream servers found to send questions back here */
let looping: string[] = [];
const pendingLoops = new Map<string, string>();
let failingSince: number | null = null;

const keyOf = (u: Upstream) => (u.kind === "doh" ? u.url : u.kind === "dot" ? `tls://${u.host}` : u.host);

/** Hata's own addresses: never an upstream */
function ownAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((a) => a.address));
}

/** The servers this machine was given: systemd-resolved's real list when its stub is in /etc/resolv.conf */
function systemServers(): string[] {
  for (const file of ["/run/systemd/resolve/resolv.conf", "/etc/resolv.conf"]) {
    if (!existsSync(file)) continue;
    const list = nameservers(readFileSync(file, "utf8")).filter((ip) => !ip.startsWith("127."));
    if (list.length) return list;
  }
  return [];
}

export const upstreams = (): Upstream[] => upstreamsOf(settings.dns, systemServers(), ownAddresses(), looping);

// --- Asking upstream -----------------------------------------------------------------------------------

function overUdp(host: string, packet: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(host.includes(":") ? "udp6" : "udp4");
    const id = (packet[0]! << 8) | packet[1]!;
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.close();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("no answer"))), UDP_WAIT_MS);
    socket.on("message", (msg) => {
      // an answer to another question (or a forged one) is not ours
      if (msg.length >= 2 && ((msg[0]! << 8) | msg[1]!) === id) done(() => resolve(new Uint8Array(msg)));
    });
    socket.on("error", (e) => done(() => reject(e)));
    socket.send(packet, 53, host);
  });
}

/** Over TCP (`name` — over TLS on 853, the certificate checked against that name): two bytes of length, then the packet */
function overTcp(host: string, packet: Uint8Array, name?: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const socket = name ? tlsConnect({ host, port: 853, servername: name }) : connect({ host, port: 53 });
    let got = Buffer.alloc(0);
    const timer = setTimeout(() => (socket.destroy(), reject(new Error("no answer"))), DOH_WAIT_MS);
    socket.on(name ? "secureConnect" : "connect", () => socket.write(Buffer.concat([Buffer.from([packet.length >> 8, packet.length & 0xff]), packet])));
    socket.on("data", (chunk) => {
      got = Buffer.concat([got, chunk]);
      if (got.length >= 2 && got.length >= 2 + got.readUInt16BE(0)) {
        clearTimeout(timer);
        socket.end();
        resolve(new Uint8Array(got.subarray(2, 2 + got.readUInt16BE(0))));
      }
    });
    socket.on("error", (e) => (clearTimeout(timer), reject(e)));
  });
}

async function overHttps(url: string, packet: Uint8Array): Promise<Uint8Array> {
  const r = await fetch(url, { method: "POST", body: packet, headers: { "content-type": "application/dns-message", accept: "application/dns-message" }, signal: AbortSignal.timeout(DOH_WAIT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** The question asked of the servers in turn; the first answer wins. `tcp` — the asker wants it whole. */
async function askUpstream(packet: Uint8Array, tcp: boolean): Promise<Uint8Array | null> {
  for (const u of upstreams()) {
    const key = keyOf(u);
    const h = health.get(key) ?? { ok: 0, fail: 0, error: "" };
    try {
      let answer = u.kind === "doh" ? await overHttps(u.url, packet) : u.kind === "dot" ? await overTcp(u.host, packet, u.name) : await overUdp(u.host, packet);
      if (u.kind === "udp" && tcp && truncated(answer)) answer = await overTcp(u.host, packet);
      health.set(key, { ...h, ok: Date.now() });
      failingSince = null;
      return answer;
    } catch (e) {
      health.set(key, { ...h, fail: Date.now(), error: e instanceof Error ? e.message : String(e) });
    }
  }
  failingSince ??= Date.now();
  return null;
}

// --- Answering -----------------------------------------------------------------------------------------

/**
 * The domains answered here: the name on the home network, and the HTTPS domain while Hata serves HTTPS
 * itself. Behind a proxy of the person's the domain leads to that proxy, which holds the certificate:
 * answered with Hata's address it would bring browsers to a Hata that has no HTTPS of its own.
 */
function domains(): string[] {
  return [settings.local.enabled ? settings.local.name : "", settings.https.mode === "acme" ? siteDomain() : ""].filter(Boolean);
}

/** The wildcard certificate's TXT values are answered here, with Hata the DNS server of that one name */
const delegated = (): boolean => settings.https.mode === "acme" && settings.https.wildcard === "delegate" && !!siteDomain();
let challengeValues: string[] = [];
export const setChallenge = (values: string[]): void => void (challengeValues = values);

/** The answer to one packet from `from`, asked at Hata's address `here`; null — nothing to answer */
export async function answer(packet: Uint8Array, from: string, here: string, tcp = false, outsideSide = false): Promise<Uint8Array | null> {
  const ask = readAsk(packet);
  if (!ask) return null;
  const asker = from.replace(/^::ffff:/, "");
  stats.queries++;
  // a delegated confirmation is the one thing answered to anyone: the certificate authority asks from the internet
  if (delegated() && ask.name === challengeName(siteDomain())) {
    stats.own++;
    const made = challengeAnswer(ask, siteDomain(), challengeValues);
    return reply(packet, ask, made.rcode, made.answers);
  }
  if (isPublic(asker) || outsideSide) {
    stats.refused++;
    return reply(packet, ask, RCODE.REFUSED);
  }
  const seen = clients.get(asker);
  clients.set(asker, { count: (seen?.count ?? 0) + 1, last: Date.now() });
  // a question Hata itself asked upstream came back: that server sends the questions here
  const loop = pendingLoops.get(ask.name);
  if (loop) {
    if (!looping.includes(loop)) looping = [...looping, loop];
    pendingLoops.delete(ask.name);
    return reply(packet, ask, RCODE.SERVFAIL);
  }
  const own = ownAnswer(ask, { domains: domains(), records: settings.dns.records, hata: here });
  if (own) {
    stats.own++;
    note(ask.name, ask.type, asker, "own");
    return reply(packet, ask, own.rcode, own.answers);
  }
  // Hata's own names above are never blocked: nothing on a list may take the home's way to Hata
  const hit = ask.cls === 1 ? blockFor(ask.name, ask.type, asker) : null;
  if (hit?.action === "block") return blocked(packet, ask, asker, hit);
  if (hit?.action === "rewrite") {
    note(ask.name, ask.type, asker, "rewritten", hit);
    return rewritten(packet, ask, hit.rewrite!, here, tcp);
  }
  // an allowed name is taken at its word; for any other the name its answer leads to may be on a list too
  const cloaked = (p: Uint8Array) => {
    if (hit || !blocking()) return null;
    for (const r of recordsOf(p)) {
      const found = r.target ? blockFor(r.target, ask.type, asker) : null;
      if (found?.action === "block") return found;
    }
    return null;
  };
  const key = `${ask.name}|${ask.type}|${ask.cls}`;
  const kept = cache.get(key);
  const now = Date.now();
  if (kept && now - kept.at < kept.keep * 1000) {
    const behind = cloaked(kept.packet);
    if (behind) return blocked(packet, ask, asker, behind);
    stats.cached++;
    note(ask.name, ask.type, asker, hit ? "allowed" : "passed", hit);
    return withId(aged(kept.packet, Math.floor((now - kept.at) / 1000)), ask.id);
  }
  const got = await askUpstream(packet, tcp);
  if (!got) {
    stats.failed++;
    note(ask.name, ask.type, asker, "failed");
    return reply(packet, ask, RCODE.SERVFAIL);
  }
  stats.upstream++;
  const keep = truncated(got) ? null : keepFor(got);
  if (keep) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, keep, packet: got });
  }
  const behind = cloaked(got);
  if (behind) return blocked(packet, ask, asker, behind);
  note(ask.name, ask.type, asker, hit ? "allowed" : "passed", hit);
  return withId(got, ask.id);
}

function blocked(packet: Uint8Array, ask: Ask, asker: string, hit: NonNullable<ReturnType<typeof blockFor>>): Uint8Array {
  stats.blocked++;
  note(ask.name, ask.type, asker, "blocked", hit);
  const made = blockedAnswer(ask.type, settings.dnsBlock.mode);
  return reply(packet, ask, made.rcode, made.answers);
}

/** The answer of a `$dnsrewrite`. A name given instead is resolved here: `reply` answers under the name asked. */
async function rewritten(packet: Uint8Array, ask: Ask, w: Rewrite, here: string, tcp: boolean): Promise<Uint8Array> {
  if ("rcode" in w) return reply(packet, ask, w.rcode);
  const of = (type: number, data: number[] | null): Answer[] => (data ? [{ type, ttl: OWN_TTL, data }] : []);
  if (w.type === "A") return reply(packet, ask, RCODE.OK, ask.type === TYPE.A || ask.type === TYPE.ANY ? of(TYPE.A, ipv4(w.value)) : []);
  if (w.type === "AAAA") return reply(packet, ask, RCODE.OK, ask.type === TYPE.AAAA || ask.type === TYPE.ANY ? of(TYPE.AAAA, ipv6(w.value)) : []);
  if (w.type === "TXT") return reply(packet, ask, RCODE.OK, ask.type === TYPE.TXT ? of(TYPE.TXT, txtData(w.value)) : []);
  if (ask.type !== TYPE.A && ask.type !== TYPE.AAAA) return reply(packet, ask, RCODE.OK, of(TYPE.CNAME, nameData(w.value)));
  const local = ownAnswer({ ...ask, name: w.value }, { domains: domains(), records: settings.dns.records, hata: here });
  if (local) return reply(packet, ask, local.rcode, local.answers);
  const got = await askUpstream(queryFor(w.value, ask.type, Math.floor(Math.random() * 65535)), tcp);
  if (!got) return reply(packet, ask, RCODE.SERVFAIL);
  return reply(packet, ask, RCODE.OK, recordsOf(got).filter((r) => r.type === ask.type).map((r) => ({ type: r.type, ttl: Math.min(r.ttl, 3600), data: r.data })));
}

function listen(address: string): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const udp = createSocket({ type: "udp4", reuseAddr: false });
    udp.on("message", (msg, rinfo) => {
      void answer(new Uint8Array(msg), rinfo.address, address, false, onOutside(address)).then((out) => out && udp.send(out, rinfo.port, rinfo.address)).catch(() => {});
    });
    udp.once("error", reject);
    udp.bind(PORT, address, () => {
      udp.off("error", reject);
      udp.on("error", () => {});
      const tcp = createServer((socket) => {
        let got = Buffer.alloc(0);
        socket.setTimeout(10_000, () => socket.destroy());
        socket.on("data", (chunk) => {
          got = Buffer.concat([got, chunk]);
          while (got.length >= 2 && got.length >= 2 + got.readUInt16BE(0)) {
            const one = new Uint8Array(got.subarray(2, 2 + got.readUInt16BE(0)));
            got = got.subarray(2 + one.length);
            void answer(one, socket.remoteAddress ?? "", address, true, onOutside(address)).then((out) => out && socket.write(Buffer.concat([Buffer.from([out.length >> 8, out.length & 0xff]), out]))).catch(() => socket.destroy());
          }
        });
        socket.on("error", () => socket.destroy());
      });
      tcp.once("error", (e) => (udp.close(), reject(e)));
      tcp.listen(PORT, address, () => resolve({ address, udp, tcp }));
    });
  });
}

/** Who holds port 53 on an address: the program's name, from ss */
async function holderOf(address: string): Promise<string> {
  if (!Bun.which("ss", { PATH })) return "";
  const out = (await run(["ss", "-H", "-lnup", "sport = :53"], 5_000)).out + (await run(["ss", "-H", "-lntp", "sport = :53"], 5_000)).out;
  for (const line of out.split("\n")) {
    const [, , , local = ""] = line.trim().split(/\s+/);
    const host = local.replace(/:53$/, "").replace(/^\[|\]$/g, "").replace(/%.*$/, "");
    if (host === address || host === "0.0.0.0" || host === "*" || host === "::") return /users:\(\("([^"]+)"/.exec(line)?.[1] ?? "?";
  }
  return "";
}

/** The addresses to listen on: the home networks' (not the internet side, not Docker's or the tunnels) and WireGuard's */
function wantedAddresses(): string[] {
  const home = homeLinks().map((l) => l.address);
  const wg = networkInterfaces()["hata-wg"]?.find((a) => a.family === "IPv4")?.address;
  return [...new Set([...home, ...(wg ? [wg] : []), ...(delegated() ? outsideAddresses() : [])])];
}

/** The addresses on the internet side: listened on only for a delegated confirmation, nothing else answered there */
const outsideAddresses = (): string[] => settings.network.outside.flatMap((name) => (networkInterfaces()[name] ?? []).filter((a) => a.family === "IPv4").map((a) => a.address));
const onOutside = (address: string): boolean => outsideAddresses().includes(address);

/** Brings the listeners in line with the settings and the addresses the server has now */
export async function syncDns(): Promise<void> {
  const want = settings.dns.enabled ? wantedAddresses() : [];
  for (const [address, l] of listeners) {
    if (want.includes(address)) continue;
    l.udp.close();
    l.tcp.close();
    listeners.delete(address);
  }
  for (const address of [...failed.keys()]) if (!want.includes(address)) failed.delete(address);
  for (const address of want) {
    if (listeners.has(address)) continue;
    try {
      listeners.set(address, await listen(address));
      failed.delete(address);
    } catch (e) {
      failed.set(address, { error: e instanceof Error ? e.message : String(e), holder: await holderOf(address) });
    }
  }
}

/** Asks each upstream a made-up name: one that sends it back here is left out from then on */
async function checkLoops(): Promise<void> {
  if (!settings.dns.enabled) return;
  for (const u of upstreamsOf(settings.dns, systemServers(), ownAddresses())) {
    if (u.kind !== "udp") continue;
    const name = loopName(crypto.randomUUID().slice(0, 8));
    pendingLoops.set(name, u.host);
    await overUdp(u.host, queryFor(name, TYPE.A, Math.floor(Math.random() * 65535))).catch(() => {});
    pendingLoops.delete(name);
  }
}

export function startDns(): void {
  void syncDns().then(checkLoops).catch((e) => console.error("DNS:", e));
  setInterval(() => void syncDns().catch(() => {}), 60_000);
  setInterval(() => {
    void checkLoops().catch(() => {});
    for (const [ip, c] of clients) if (Date.now() - c.last > 24 * 3600_000) clients.delete(ip);
  }, 10 * 60_000);
}

// --- The page ------------------------------------------------------------------------------------------

export class DnsError extends Error {
  constructor(readonly code: string, readonly detail: Record<string, string> = {}) {
    super(code);
  }
}

export async function setDns(input: Record<string, unknown>, by: string): Promise<void> {
  const before = settings.dns;
  const next: DnsSettings = cleanDns({ ...before, ...input, records: before.records });
  if (next.upstream === "custom" && !next.servers.length) throw new DnsError("dns.noServers");
  settings.dns = next;
  saveSettings();
  cache.clear();
  looping = [];
  health.clear();
  await syncDns();
  void checkLoops().catch(() => {});
  if (before.enabled !== next.enabled) record(next.enabled ? "dns.on" : "dns.off", { user: by });
  else record("dns.changed", { user: by });
}

export function addRecord(input: unknown, by: string): void {
  const r = cleanRecord(input);
  if (!r) throw new DnsError("dns.badRecord");
  if (settings.dns.records.some((x) => x.name === r.name && x.type === r.type)) throw new DnsError("dns.recordTaken", { name: r.name });
  settings.dns = { ...settings.dns, records: [...settings.dns.records, r] };
  saveSettings();
  record("dns.recordAdded", { user: by, detail: r.name });
}

export function removeRecord(name: string, type: string, by: string): void {
  settings.dns = { ...settings.dns, records: settings.dns.records.filter((r) => !(r.name === name && r.type === type)) };
  saveSettings();
  record("dns.recordRemoved", { user: by, detail: name });
}

/** Who asked lately, for the page of blocking */
export const dnsClients = () => [...clients.entries()].map(([address, c]) => ({ address, ...c }));

/** What a move from Pi-hole or AdGuard Home brings for the server itself; the rest goes to the blocking */
export async function applyImport(id: string, parts: ImportParts, by: string): Promise<void> {
  const { records, upstream } = takePlan(id, parts, by);
  let list = settings.dns.records;
  for (const r of records) {
    const clean = cleanRecord(r);
    if (clean && !list.some((x) => x.name === clean.name && x.type === clean.type)) list = [...list, clean];
  }
  settings.dns = { ...settings.dns, records: list };
  saveSettings();
  if (upstream) {
    const next = upstream.preset ? { upstream: upstream.preset, doh: upstream.doh === true } : { upstream: "custom", servers: upstream.servers ?? [] };
    await setDns(next, by);
  }
}

/** Everything the page shows; `ip` — the address the page's own request came from */
export function dnsReport(ip: string) {
  const asker = ip.replace(/^::ffff:/, "");
  return {
    settings: settings.dns,
    port: PORT,
    listening: [...listeners.keys()],
    failed: [...failed.entries()].map(([address, f]) => ({ address, ...f })),
    wanted: settings.dns.enabled ? wantedAddresses() : homeLinks().map((l) => l.address),
    domains: domains(),
    system: systemServers(),
    upstreams: upstreams().map((u) => ({ ...u, ...(health.get(keyOf(u)) ?? { ok: 0, fail: 0, error: "" }) })),
    looping,
    stats: { ...stats, kept: cache.size },
    clients: [...clients.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, 50).map(([address, c]) => ({ address, ...c })),
    you: { address: asker, seen: clients.get(asker)?.last ?? null },
  };
}

/** For the attention list: what is wrong with the DNS server now — the home is without names while it is */
export function dnsTrouble(): AttentionItem[] {
  if (!settings.dns.enabled) return [];
  const out: AttentionItem[] = [];
  for (const [address, f] of failed) out.push({ id: `dns:port:${address}`, severity: "danger", code: "dns.port", detail: { address, holder: f.holder || "?" } });
  if (failingSince && Date.now() - failingSince > 120_000) out.push({ id: "dns:upstream", severity: "danger", code: "dns.upstream", detail: {} });
  return out;
}
