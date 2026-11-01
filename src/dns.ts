/**
 * Hata as the home's DNS server: the packets and the decisions, pure and tested (`dnsserver.ts` listens).
 *
 * What it answers by itself: the name on the home network and the HTTPS domain, each with one label under
 * it (the apps' and the names' of Settings → Domains), with Hata's own address on the asker's network — so
 * a router that cannot point every subdomain at Hata needs only to hand Hata out as the DNS server; and the
 * records the person adds. Anything else goes on to the servers chosen (`upstreamsOf`), and their answers
 * are kept for as long as they say.
 */

export const TYPE = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, HTTPS: 65, ANY: 255 } as const;

export const RCODE = { OK: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 } as const;

/** One question of a query, as asked */
export interface Ask {
  id: number;
  name: string;
  type: number;
  cls: number;
  /** Recursion desired: copied into the answer */
  rd: boolean;
  /** Where the question ends in the packet (the header is 12 bytes) */
  end: number;
}

const view = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);

/** Where a name that starts at `pos` ends (pointers followed only to be skipped); -1 — broken */
export function skipName(p: Uint8Array, pos: number): number {
  for (let hops = 0; hops < 128; hops++) {
    if (pos >= p.length) return -1;
    const len = p[pos]!;
    if (len === 0) return pos + 1;
    if ((len & 0xc0) === 0xc0) return pos + 2 <= p.length ? pos + 2 : -1;
    if (len > 63) return -1;
    pos += 1 + len;
  }
  return -1;
}

/** Reads a name, pointers followed */
export function readName(p: Uint8Array, pos: number): string | null {
  const labels: string[] = [];
  for (let hops = 0; hops < 128; hops++) {
    if (pos >= p.length) return null;
    const len = p[pos]!;
    if (len === 0) return labels.join(".");
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= p.length) return null;
      pos = ((len & 0x3f) << 8) | p[pos + 1]!;
      continue;
    }
    if (len > 63 || pos + 1 + len > p.length) return null;
    labels.push(new TextDecoder().decode(p.subarray(pos + 1, pos + 1 + len)));
    pos += 1 + len;
  }
  return null;
}

/** The one question of a plain query; null — not a query, another operation, or not exactly one question */
export function readAsk(p: Uint8Array): Ask | null {
  if (p.length < 17) return null;
  const v = view(p);
  const flags = v.getUint16(2);
  if (flags & 0x8000 || (flags >> 11) & 0xf || v.getUint16(4) !== 1) return null;
  const nameEnd = skipName(p, 12);
  if (nameEnd < 0 || nameEnd + 4 > p.length) return null;
  const name = readName(p, 12);
  if (name === null) return null;
  return { id: v.getUint16(0), name: name.toLowerCase().replace(/\.$/, ""), type: v.getUint16(nameEnd), cls: v.getUint16(nameEnd + 2), rd: (flags & 0x0100) !== 0, end: nameEnd + 4 };
}

export interface Answer {
  type: number;
  ttl: number;
  data: number[];
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [...u16(n >>> 16), ...u16(n & 0xffff)];

/** An answer to `ask` made here: the question as it was asked, the records under its name (a pointer to it) */
export function reply(query: Uint8Array, ask: Ask, rcode: number, answers: Answer[] = []): Uint8Array {
  const flags = 0x8000 | 0x0400 | (ask.rd ? 0x0100 : 0) | 0x0080 | (rcode & 0xf);
  const head = [...u16(ask.id), ...u16(flags), ...u16(1), ...u16(answers.length), ...u16(0), ...u16(0)];
  const records = answers.flatMap((a) => [0xc0, 0x0c, ...u16(a.type), ...u16(1), ...u32(a.ttl), ...u16(a.data.length), ...a.data]);
  return new Uint8Array([...head, ...query.subarray(12, ask.end), ...records]);
}

/** Bytes of an IPv4 address; null — not one */
export function ipv4(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** Bytes of an IPv6 address; null — not one */
export function ipv6(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return null;
  const [head = "", tail, ...more] = ip.split("::");
  if (more.length) return null;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap((g) => u16(parseInt(g, 16)));
}

/** The answer's code, whether it was cut short (TC) */
export const rcodeOf = (p: Uint8Array): number => (p.length >= 4 ? p[3]! & 0xf : RCODE.SERVFAIL);
export const truncated = (p: Uint8Array): boolean => p.length >= 3 && (p[2]! & 0x02) !== 0;

/** A copy of a packet with another id */
export function withId(p: Uint8Array, id: number): Uint8Array {
  const out = new Uint8Array(p);
  out[0] = (id >> 8) & 0xff;
  out[1] = id & 0xff;
  return out;
}

/**
 * Walks the records of an answer (answer, authority and additional sections) and calls `each` with the
 * position of every TTL; false — the packet is broken
 */
function walkTtls(p: Uint8Array, each: (at: number, type: number) => void): boolean {
  if (p.length < 12) return false;
  const v = view(p);
  let pos = 12;
  for (let i = 0; i < v.getUint16(4); i++) {
    pos = skipName(p, pos);
    if (pos < 0 || pos + 4 > p.length) return false;
    pos += 4;
  }
  const records = v.getUint16(6) + v.getUint16(8) + v.getUint16(10);
  for (let i = 0; i < records; i++) {
    pos = skipName(p, pos);
    if (pos < 0 || pos + 10 > p.length) return false;
    const type = v.getUint16(pos);
    // the OPT pseudo-record (EDNS) has no TTL of its own: its field holds flags
    if (type !== 41) each(pos + 4, type);
    pos += 10 + v.getUint16(pos + 8);
    if (pos > p.length) return false;
  }
  return true;
}

/**
 * How long an upstream answer may be kept, seconds: the smallest TTL of its records, between `min` and
 * `max`; an answer without records (no such name, nothing of that type) — the SOA's own TTL, else `negative`.
 * null — not to be kept (a failure, a broken packet).
 */
export function keepFor(p: Uint8Array, min = 5, max = 3600, negative = 60): number | null {
  const code = rcodeOf(p);
  if (code !== RCODE.OK && code !== RCODE.NXDOMAIN) return null;
  let least = Infinity;
  if (!walkTtls(p, (at) => (least = Math.min(least, view(p).getUint32(at))))) return null;
  if (least === Infinity) least = negative;
  return Math.max(min, Math.min(max, least));
}

/** A kept answer as it is given out later: every TTL lowered by the seconds it has been kept */
export function aged(p: Uint8Array, seconds: number): Uint8Array {
  const out = new Uint8Array(p);
  const v = view(out);
  walkTtls(out, (at) => v.setUint32(at, Math.max(0, v.getUint32(at) - seconds)));
  return out;
}

// --- What is answered here ---------------------------------------------------------------------------

/** A record of the person's: a name of the home network and the address it stands for */
export interface DnsRecord {
  name: string;
  type: "A" | "AAAA";
  value: string;
}

const NAME_RE = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A record as the page sent it; null — not one */
export function cleanRecord(input: unknown): DnsRecord | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const name = String(r.name ?? "").trim().toLowerCase().replace(/\.$/, "");
  const value = String(r.value ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  if (r.type === "AAAA") return ipv6(value) ? { name, type: "AAAA", value } : null;
  return ipv4(value) ? { name, type: "A", value } : null;
}

export const cleanRecords = (value: unknown): DnsRecord[] => (Array.isArray(value) ? value.map(cleanRecord).filter((r): r is DnsRecord => r !== null).slice(0, 500) : []);

/** How long what is answered here may be kept by the asker: short, so a change is noticed */
export const OWN_TTL = 60;

/** Whether a name is a domain of ours or one label under it */
export const underDomain = (name: string, domain: string): boolean => !!domain && (name === domain || (name.endsWith("." + domain) && !name.slice(0, -domain.length - 1).includes(".")));

/**
 * The answer made here, or null — it goes on upstream. `domains` — the name on the home network and the
 * HTTPS domain; `hata` — Hata's IPv4 address on the asker's network.
 */
export function ownAnswer(ask: Ask, ctx: { domains: string[]; records: DnsRecord[]; hata: string }): { rcode: number; answers: Answer[] } | null {
  if (ask.cls !== 1) return null;
  const mine = ctx.records.filter((r) => r.name === ask.name);
  if (mine.length) {
    const want = ask.type === TYPE.A ? "A" : ask.type === TYPE.AAAA ? "AAAA" : ask.type === TYPE.ANY ? null : "";
    const answers = mine.filter((r) => want === null || r.type === want).map((r) => ({ type: r.type === "A" ? TYPE.A : TYPE.AAAA, ttl: OWN_TTL, data: (r.type === "A" ? ipv4(r.value) : ipv6(r.value))! }));
    return { rcode: RCODE.OK, answers };
  }
  if (ctx.domains.some((d) => underDomain(ask.name, d))) {
    const at = ipv4(ctx.hata);
    // Hata has no IPv6 of its own to give here: "nothing of that type", so the asker takes the IPv4
    return { rcode: RCODE.OK, answers: at && (ask.type === TYPE.A || ask.type === TYPE.ANY) ? [{ type: TYPE.A, ttl: OWN_TTL, data: at }] : [] };
  }
  return null;
}

// --- Where the rest goes -----------------------------------------------------------------------------

export type Upstream = { kind: "udp"; host: string } | { kind: "doh"; url: string } | { kind: "dot"; host: string; name: string };

/**
 * The servers offered by name. Encrypted, they are asked over TLS (DoT, port 853) by address, the name only
 * checked in the certificate — so it needs no DNS to be found; DNS over HTTPS is not used for them because
 * Quad9 answers it over HTTP/2 only, which Bun's fetch does not speak.
 */
export const PRESETS: Record<string, { udp: string[]; tls: string }> = {
  quad9: { udp: ["9.9.9.9", "149.112.112.112"], tls: "dns.quad9.net" },
  cloudflare: { udp: ["1.1.1.1", "1.0.0.1"], tls: "cloudflare-dns.com" },
  google: { udp: ["8.8.8.8", "8.8.4.4"], tls: "dns.google" },
  adguard: { udp: ["94.140.14.14", "94.140.15.15"], tls: "dns.adguard-dns.com" },
};

/** Used when the system names none but Hata itself (its DHCP hands out Hata) */
export const FALLBACK: Upstream[] = [...PRESETS.quad9!.udp.slice(0, 1), ...PRESETS.cloudflare!.udp.slice(0, 1)].map((host) => ({ kind: "udp", host }));

export interface DnsSettings {
  enabled: boolean;
  /** system — the servers this machine uses; a preset; custom — `servers` */
  upstream: "system" | "quad9" | "cloudflare" | "google" | "adguard" | "custom";
  /** A preset encrypted (DNS over TLS) instead of plain DNS; the field keeps its first name */
  doh: boolean;
  /** Addresses of servers, or `https://…/dns-query` */
  servers: string[];
  records: DnsRecord[];
}

export const DNS_DEFAULTS: DnsSettings = { enabled: false, upstream: "system", doh: false, servers: [], records: [] };

/** A server as typed: an address, or a DoH URL; null — neither */
export function cleanServer(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (ipv4(s) || ipv6(s)) return s.toLowerCase();
  try {
    const url = new URL(s);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function cleanDns(value: unknown): DnsSettings {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const upstream = ["system", "quad9", "cloudflare", "google", "adguard", "custom"].includes(String(v.upstream)) ? (v.upstream as DnsSettings["upstream"]) : "system";
  const servers = Array.isArray(v.servers) ? v.servers.map(cleanServer).filter((s): s is string => s !== null).slice(0, 8) : [];
  return { enabled: v.enabled === true, upstream, doh: v.doh === true, servers, records: cleanRecords(v.records) };
}

/**
 * Where the questions not answered here go. `system` — the servers this machine was given; `own` — Hata's
 * own addresses, never used (a router handing out Hata would send the questions back here); `looping` —
 * servers found to send them back here.
 */
export function upstreamsOf(s: Pick<DnsSettings, "upstream" | "doh" | "servers">, system: string[], own: string[], looping: string[] = []): Upstream[] {
  const fit = (host: string) => !own.includes(host) && !looping.includes(host) && !host.startsWith("127.") && host !== "::1";
  if (s.upstream === "custom") return s.servers.flatMap((x): Upstream[] => (x.startsWith("https://") ? [{ kind: "doh", url: x }] : fit(x) ? [{ kind: "udp", host: x }] : []));
  const preset = PRESETS[s.upstream];
  if (preset) return s.doh ? preset.udp.map((host) => ({ kind: "dot", host, name: preset.tls })) : preset.udp.map((host) => ({ kind: "udp", host }));
  const list = system.filter(fit).map((host): Upstream => ({ kind: "udp", host }));
  return list.length ? list : FALLBACK;
}

/** The servers a resolv.conf names */
export const nameservers = (text: string): string[] => [...text.matchAll(/^\s*nameserver\s+(\S+)/gm)].map((m) => m[1]!.replace(/%.*$/, ""));

/** A question Hata asks its upstream to learn whether it sends questions back here: a made-up name nobody has */
export const loopName = (token: string): string => `hata-loop-${token}.example.com`;

/** A query of Hata's own: one question, recursion desired */
export function queryFor(name: string, type: number, id: number): Uint8Array {
  const labels = name.split(".").flatMap((label) => {
    const bytes = [...new TextEncoder().encode(label)];
    return [bytes.length, ...bytes];
  });
  return new Uint8Array([...u16(id), ...u16(0x0100), ...u16(1), ...u16(0), ...u16(0), ...u16(0), ...labels, 0, ...u16(type), ...u16(1)]);
}
