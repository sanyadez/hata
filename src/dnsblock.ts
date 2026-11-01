/**
 * Blocking by name in Hata's DNS server, the pure part: the formats lists come in, how they are kept in
 * memory, and which rule decides a question. Understood: hosts files, plain lists of names, dnsmasq's
 * `address=/x/`, AdGuard's syntax (`||x^`, `@@`, `|`, `*`, `/re/`, `$important`, `$dnstype`, `$client`,
 * `$denyallow`, `$dnsrewrite`, `$badfilter`) and Pi-hole's regular expressions. What only a browser can act
 * on (page elements, paths, `$third-party`, …) is left out and counted.
 *
 * A list of a million names would take hundreds of megabytes as a set of strings. The plain ones are kept
 * as sorted 64-bit hashes in typed arrays, 8 bytes a name; only rules with a pattern or a modifier are objects.
 */
import { domainToASCII } from "node:url";
import { ipv4, ipv6, RCODE, TYPE } from "./dns";

/** How much one list may hold; beyond it the rest is counted as `overLimit` */
export const MAX_NAMES = 8_000_000;
export const MAX_RULES = 200_000;
/** Patterns are tried one by one on every question */
export const MAX_PATTERNS = 5_000;
const MAX_LINE = 2048;
const MAX_REGEX = 256;

export type Rewrite = { rcode: number } | { type: "A" | "AAAA" | "CNAME" | "TXT"; value: string };

export interface Rule {
  /** Without `$badfilter`, modifiers sorted: what a `$badfilter` rule is compared by */
  key: string;
  text: string;
  allow: boolean;
  important: boolean;
  how: "exact" | "sub" | "pattern";
  name?: string;
  re?: RegExp;
  types?: { yes: number[]; no: number[] };
  clients?: { yes: string[]; no: string[] };
  denyallow?: string[];
  rewrite?: Rewrite;
}

export type Parsed =
  | { kind: "skip"; why: "comment" | "cosmetic" | "notDns" | "broken" }
  | { kind: "name"; how: "exact" | "sub"; name: string; allow: boolean }
  | { kind: "rule"; rule: Rule }
  | { kind: "badfilter"; key: string };

const skip = (why: "comment" | "cosmetic" | "notDns" | "broken"): Parsed[] => [{ kind: "skip", why }];

/** A name with a dot; the rules of AdGuard's syntax may also name a single label (`||lan^`) */
const NAME_RE = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;
const LABELS_RE = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;
const COSMETIC_RE = /(^|\S)(##|#@#|#\?#|#\$#|#@\$#|#%#|#@%#|\$\$|\$@\$)/;
/** What hosts files name for the machine itself */
const HOSTS_OWN = new Set(["localhost", "localhost.localdomain", "local", "broadcasthost", "ip6-localhost", "ip6-loopback", "ip6-localnet", "ip6-mcastprefix", "ip6-allnodes", "ip6-allrouters", "ip6-allhosts", "0.0.0.0"]);
const SINKS = new Set(["0.0.0.0", "127.0.0.1", "::", "::1", "0:0:0:0:0:0:0:0", "0:0:0:0:0:0:0:1"]);

/** A name as a list writes it: lower case, no last dot, non-Latin letters as DNS carries them */
function hostname(raw: string): string {
  const s = raw.toLowerCase().replace(/\.$/, "");
  return /[^\x00-\x7f]/.test(s) ? domainToASCII(s) : s;
}

/**
 * A regular expression of a list runs on every question, in the server's only thread, so one that can take
 * ages must not get in: nothing repeated without end inside what is repeated without end, no back
 * references, few `.*`. Good enough for what lists hold; a name is at most 253 characters anyway.
 */
export function safeRegex(src: string): boolean {
  if (src.length > MAX_REGEX || /\\[1-9]|\\k</.test(src) || (src.match(/\.[*+]/g)?.length ?? 0) > 3) return false;
  const stack: boolean[] = [];
  let unbounded = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") {
      i++;
      if (src[i] === "^") i++;
      if (src[i] === "]") i++;
      while (i < src.length && src[i] !== "]") i += src[i] === "\\" ? 2 : src[i] === "[" && src[i + 1] === ":" ? src.indexOf(":]", i) - i + 2 : 1;
      continue;
    }
    if (c === "(") {
      stack.push(unbounded);
      unbounded = false;
      continue;
    }
    const endless = c === "*" || c === "+" || (c === "{" && /^\{\d*,\d*\}/.test(src.slice(i)));
    if (c === ")") {
      const inner = unbounded;
      const next = src[i + 1];
      const repeated = next === "*" || next === "+" || (next === "{" && /^\{\d*,\d*\}/.test(src.slice(i + 1)));
      if (inner && repeated) return false;
      unbounded = (stack.pop() ?? false) || inner;
      continue;
    }
    if (endless) unbounded = true;
  }
  return true;
}

function regexOf(src: string): RegExp | null {
  const posix = src.replace(/\[:alpha:\]/g, "a-z").replace(/\[:digit:\]/g, "0-9").replace(/\[:alnum:\]/g, "a-z0-9");
  if (!safeRegex(posix)) return null;
  try {
    return new RegExp(posix, "i");
  } catch {
    return null;
  }
}

/** A pattern of AdGuard's syntax as a regular expression over a host name */
function patternRe(body: string): RegExp | null {
  if ((body.match(/\*/g)?.length ?? 0) > 3) return null;
  let src = "";
  let rest = body;
  if (rest.startsWith("||")) {
    src = "(^|\\.)";
    rest = rest.slice(2);
  } else if (rest.startsWith("|")) {
    src = "^";
    rest = rest.slice(1);
  }
  let end = "";
  if (rest.endsWith("|")) {
    end = "$";
    rest = rest.slice(0, -1);
  }
  if (rest.includes("|")) return null;
  for (const c of rest) src += c === "*" ? ".*" : c === "^" ? "(\\.|$)" : c.replace(/[.\\+?()[\]{}$]/g, "\\$&");
  return new RegExp(src + end);
}

const TYPE_NAMES: Record<string, number> = { A: TYPE.A, AAAA: TYPE.AAAA, CNAME: TYPE.CNAME, MX: TYPE.MX, NS: TYPE.NS, PTR: TYPE.PTR, SOA: TYPE.SOA, SRV: TYPE.SRV, TXT: TYPE.TXT, HTTPS: TYPE.HTTPS, SVCB: 64, CAA: 257, ANY: TYPE.ANY };
const RCODES: Record<string, number> = { NOERROR: RCODE.OK, NXDOMAIN: RCODE.NXDOMAIN, REFUSED: RCODE.REFUSED, SERVFAIL: RCODE.SERVFAIL };

/** The value of `$dnsrewrite`: `1.2.3.4`, `::1`, `host.example`, `NXDOMAIN`, or `RCODE;TYPE;VALUE`; null — not one Hata can give */
export function readRewrite(value: string): Rewrite | null {
  const v = value.trim();
  if (!v) return null;
  if (v.includes(";")) {
    const [code = "", type = "", rest = ""] = v.split(";");
    const rcode = RCODES[code.toUpperCase()];
    if (rcode === undefined) return null;
    if (rcode !== RCODE.OK || !type) return type || rest ? null : { rcode };
    const t = type.toUpperCase();
    if (t === "A") return ipv4(rest) ? { type: "A", value: rest } : null;
    if (t === "AAAA") return ipv6(rest) ? { type: "AAAA", value: rest.toLowerCase() } : null;
    if (t === "CNAME") return LABELS_RE.test(hostname(rest)) ? { type: "CNAME", value: hostname(rest) } : null;
    if (t === "TXT") return { type: "TXT", value: rest };
    return null;
  }
  if (RCODES[v] !== undefined) return { rcode: RCODES[v]! };
  if (ipv4(v)) return { type: "A", value: v };
  if (ipv6(v)) return { type: "AAAA", value: v.toLowerCase() };
  return LABELS_RE.test(hostname(v)) ? { type: "CNAME", value: hostname(v) } : null;
}

/** Modifiers separated by commas — not those in quotes, in a regular expression's slashes, or after a backslash */
function splitModifiers(text: string): string[] {
  const out: string[] = [];
  let piece = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\") {
      piece += c + (text[++i] ?? "");
      continue;
    }
    if (quote) quote = c === quote ? "" : quote;
    else if ((c === "'" || c === '"') && /=$/.test(piece.slice(-1))) quote = c;
    else if (c === ",") {
      out.push(piece);
      piece = "";
      continue;
    }
    piece += c;
  }
  if (piece) out.push(piece);
  return out;
}

/** Where a rule's modifiers begin: the last `$` that a known shape follows */
function modifiersAt(line: string): number {
  if (line.startsWith("/") || line.startsWith("@@/")) {
    const at = line.lastIndexOf("/$");
    return at > 0 ? at + 1 : -1;
  }
  const at = line.lastIndexOf("$");
  return at >= 0 && /^[a-z~-]/.test(line.slice(at + 1)) ? at : -1;
}

/** One list of `a|~b|c` values */
const yesNo = (value: string): { yes: string[]; no: string[] } => {
  const parts = value.split("|").map((v) => v.trim().replace(/^['"]|['"]$/g, "").replace(/\\(.)/g, "$1")).filter(Boolean);
  return { yes: parts.filter((p) => !p.startsWith("~")), no: parts.filter((p) => p.startsWith("~")).map((p) => p.slice(1)) };
};

/** One line of a list; a hosts line may name several */
export function parseLine(raw: string): Parsed[] {
  let line = raw.trim();
  if (!line || line.startsWith("!") || line.startsWith("[")) return skip("comment");
  if (line.length > MAX_LINE) return skip("broken");
  // a line of `#####` or `### Version` is a comment of a hosts file; `##.banner` hides part of a page
  if (line.startsWith("#")) return skip(/^#[@?$%]?#([.\[a-z*:]|#[a-z_-])/i.test(line) ? "cosmetic" : "comment");
  if (COSMETIC_RE.test(line)) return skip("cosmetic");
  // dnsmasq's way of writing it
  const masq = /^(?:address=\/([^/]+)\/(?:0\.0\.0\.0|::|#)?|server=\/([^/]+)\/)$/.exec(line);
  if (masq) {
    const name = hostname(masq[1] ?? masq[2]!);
    return NAME_RE.test(name) ? [{ kind: "name", how: "sub", name, allow: false }] : skip("broken");
  }
  // anything else that is not AdGuard's syntax may carry a comment at the end
  if (!/^(@@|\||\/)/.test(line) && /\s#/.test(line)) line = line.slice(0, line.search(/\s#/)).trim();
  if (/\s/.test(line) && !line.includes("$") && !line.startsWith("/")) {
    const [first = "", ...names] = line.split(/\s+/);
    const ip = first.replace(/%.*$/, "").toLowerCase();
    if (!ipv4(ip) && !ipv6(ip)) return skip("broken");
    const out: Parsed[] = [];
    for (const raw of names) {
      const name = hostname(raw);
      if (HOSTS_OWN.has(name)) continue;
      if (!NAME_RE.test(name)) {
        out.push({ kind: "skip", why: "broken" });
        continue;
      }
      if (SINKS.has(ip)) out.push({ kind: "name", how: "exact", name, allow: false });
      else {
        const type = ipv4(ip) ? "A" : "AAAA";
        out.push({ kind: "rule", rule: { key: `|${name}^$dnsrewrite=${ip}`, text: `${ip} ${name}`, allow: false, important: false, how: "exact", name, rewrite: { type, value: ip } } });
      }
    }
    return out.length ? out : skip("comment");
  }
  // a name by itself
  if (!/^(@@|\||\/|:\/\/)/.test(line) && !/[*^$]/.test(line)) {
    const name = hostname(line);
    if (HOSTS_OWN.has(name)) return skip("comment");
    if (NAME_RE.test(name)) return [{ kind: "name", how: "exact", name, allow: false }];
    // a bare word would catch every name it is part of; a piece like `-ads1.` is a pattern of the lists
    if (/^[a-z0-9_]+$/.test(name)) return skip("broken");
    if (/[/:?=&]/.test(name)) return skip("notDns");
  }
  return ruleOf(line);
}

/** A line of AdGuard's syntax */
function ruleOf(line: string): Parsed[] {
  const text = line;
  let rest = line;
  const allow = rest.startsWith("@@");
  if (allow) rest = rest.slice(2);
  const at = modifiersAt(rest);
  const body = at >= 0 ? rest.slice(0, at) : rest;
  const mods = at >= 0 ? splitModifiers(rest.slice(at + 1)) : [];
  const rule: Rule = { key: "", text, allow, important: false, how: "pattern" };
  let badfilter = false;
  const kept: string[] = [];
  for (const mod of mods) {
    const eq = mod.indexOf("=");
    const key = (eq < 0 ? mod : mod.slice(0, eq)).trim().toLowerCase();
    const value = eq < 0 ? "" : mod.slice(eq + 1);
    if (key === "badfilter") {
      badfilter = true;
      continue;
    }
    kept.push(mod.trim());
    if (key === "important") rule.important = true;
    else if (key === "dnstype") {
      const { yes, no } = yesNo(value.toUpperCase());
      const num = (list: string[]) => list.map((n) => TYPE_NAMES[n] ?? -1);
      if ((yes.length === 0 && no.length === 0) || [...num(yes), ...num(no)].includes(-1)) return skip("broken");
      rule.types = { yes: num(yes), no: num(no) };
    } else if (key === "client") {
      const c = yesNo(value);
      if (!c.yes.length && !c.no.length) return skip("broken");
      rule.clients = c;
    } else if (key === "denyallow") {
      const list = yesNo(value.toLowerCase()).yes.map(hostname);
      if (!list.length || list.some((n) => !LABELS_RE.test(n))) return skip("broken");
      rule.denyallow = list;
    } else if (key === "dnsrewrite") {
      if (value) {
        const made = readRewrite(value);
        if (!made) return skip("broken");
        rule.rewrite = made;
      } else if (!allow) return skip("broken");
    } else return skip("notDns");
  }
  const key = (allow ? "@@" : "") + normalBody(body) + (kept.length ? "$" + [...kept].sort().join(",") : "");
  if (badfilter) return [{ kind: "badfilter", key }];
  rule.key = key;
  if (body.startsWith("/")) {
    if (body.length < 3 || !body.endsWith("/")) return skip("notDns");
    const src = body.slice(1, -1);
    // a host name has no slashes: this is about addresses of pages
    if (src.includes("\\/") || src.includes("/")) return skip("notDns");
    const re = regexOf(src);
    if (!re) return skip("broken");
    rule.re = re;
    return [{ kind: "rule", rule }];
  }
  // `://x^` of the lists: the name starts there, whatever the scheme of an address would be
  const written = normalBody(body).replace(/^:\/\//, "|").toLowerCase();
  const lower = /[^\x00-\x7f]/.test(written) ? domainToASCII(written) || written : written;
  const sub = /^\|\|([^*|^]+)\^?$/.exec(lower);
  const exact = /^\|([^*|^]+)\^?$/.exec(lower);
  const closed = /\^$/.test(lower) || /\|$/.test(body);
  if (sub && closed && LABELS_RE.test(sub[1]!)) {
    if (!kept.length) return [{ kind: "name", how: "sub", name: sub[1]!, allow }];
    return [{ kind: "rule", rule: { ...rule, how: "sub", name: sub[1]! } }];
  }
  if (exact && closed && LABELS_RE.test(exact[1]!)) {
    if (!kept.length) return [{ kind: "name", how: "exact", name: exact[1]!, allow }];
    return [{ kind: "rule", rule: { ...rule, how: "exact", name: exact[1]! } }];
  }
  if (/[^a-z0-9._*^|-]/.test(lower)) return skip("notDns");
  // everything for somebody or of some type: it has to say which
  if (/^(\|\|)?\*?\^?$/.test(lower)) {
    if (!rule.types && !rule.clients) return skip("broken");
    rule.re = /^/;
    return [{ kind: "rule", rule }];
  }
  // a piece of a few letters would catch half the internet
  if (!/[a-z0-9._-]{3}/.test(lower)) return skip("broken");
  const re = patternRe(lower);
  if (!re) return skip("broken");
  rule.re = re;
  return [{ kind: "rule", rule }];
}

const normalBody = (body: string): string => body.replace(/\^\|$/, "^");

const hash = (name: string): bigint => BigInt.asUintN(64, BigInt(Bun.hash.wyhash(name)));

function has(set: BigUint64Array, value: bigint): boolean {
  let low = 0;
  let high = set.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const v = set[mid]!;
    if (v === value) return true;
    if (v < value) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

/** Hashes as they come in; sorted and without repeats once finished */
class HashBag {
  private items = new BigUint64Array(1024);
  private count = 0;
  add(value: bigint): void {
    if (this.count === this.items.length) {
      const more = new BigUint64Array(this.items.length * 2);
      more.set(this.items);
      this.items = more;
    }
    this.items[this.count++] = value;
  }
  get size(): number {
    return this.count;
  }
  finish(): BigUint64Array {
    const sorted = this.items.subarray(0, this.count).sort();
    let kept = 0;
    for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[kept++] = sorted[i]!;
    return sorted.slice(0, kept);
  }
}

export interface ListCounts {
  names: number;
  rules: number;
  cosmetic: number;
  notDns: number;
  broken: number;
  overLimit: number;
}

export interface Hashes {
  exact: BigUint64Array;
  sub: BigUint64Array;
  allowExact: BigUint64Array;
  allowSub: BigUint64Array;
}

export interface Compiled extends Hashes {
  byName: Map<string, Rule[]>;
  patterns: Rule[];
  /** Rules of `$badfilter`: they switch off a rule of any list */
  bad: string[];
  /** The lines of the rules that are objects: what a list kept on disk parses again */
  complex: string[];
  counts: ListCounts;
}

/** A list being read line by line. `allow` — a list of exceptions: whatever it names is allowed. */
export class ListBuilder {
  private exact = new HashBag();
  private sub = new HashBag();
  private allowExact = new HashBag();
  private allowSub = new HashBag();
  private byName = new Map<string, Rule[]>();
  private patterns: Rule[] = [];
  private bad: string[] = [];
  private complex: string[] = [];
  private ruleCount = 0;
  private lineErrors: string[] = [];
  counts: ListCounts = { names: 0, rules: 0, cosmetic: 0, notDns: 0, broken: 0, overLimit: 0 };
  constructor(private readonly allow = false) {}

  /** Adds one line; false — nothing of it was understood */
  add(line: string): boolean {
    let good = true;
    for (const p of parseLine(line)) {
      if (p.kind === "skip") {
        if (p.why === "cosmetic") this.counts.cosmetic++;
        else if (p.why === "notDns") this.counts.notDns++;
        else if (p.why === "broken") {
          this.counts.broken++;
          good = false;
        }
      } else if (p.kind === "name") {
        if (this.exact.size + this.sub.size + this.allowExact.size + this.allowSub.size >= MAX_NAMES) {
          this.counts.overLimit++;
          continue;
        }
        const allow = p.allow || this.allow;
        (p.how === "exact" ? (allow ? this.allowExact : this.exact) : allow ? this.allowSub : this.sub).add(hash(p.name));
      } else if (p.kind === "badfilter") {
        this.bad.push(p.key);
        this.complex.push(line.trim());
      } else if (this.ruleCount >= MAX_RULES || (p.rule.how === "pattern" && this.patterns.length >= MAX_PATTERNS)) {
        this.counts.overLimit++;
      } else {
        const rule = this.allow ? { ...p.rule, allow: true } : p.rule;
        this.ruleCount++;
        if (rule.how === "pattern") this.patterns.push(rule);
        else {
          const at = this.byName.get(rule.name!);
          if (at) at.push(rule);
          else this.byName.set(rule.name!, [rule]);
        }
        this.complex.push(line.trim());
      }
    }
    return good;
  }

  finish(): Compiled {
    return withRules({ exact: this.exact.finish(), sub: this.sub.finish(), allowExact: this.allowExact.finish(), allowSub: this.allowSub.finish() }, { byName: this.byName, patterns: this.patterns, bad: this.bad, complex: this.complex, ruleCount: this.ruleCount }, this.counts);
  }
}

function withRules(h: Hashes, r: { byName: Map<string, Rule[]>; patterns: Rule[]; bad: string[]; complex: string[]; ruleCount: number }, counts: ListCounts): Compiled {
  return { ...h, byName: r.byName, patterns: r.patterns, bad: r.bad, complex: r.complex, counts: { ...counts, names: h.exact.length + h.sub.length + h.allowExact.length + h.allowSub.length, rules: r.ruleCount } };
}

/** A list read whole; lets the server breathe every so often, so a million lines never stop it */
export async function compileText(text: string, allow = false, breathe?: () => Promise<void>): Promise<Compiled> {
  const builder = new ListBuilder(allow);
  let from = 0;
  let lines = 0;
  while (from < text.length) {
    let to = text.indexOf("\n", from);
    if (to < 0) to = text.length;
    builder.add(text.slice(from, to));
    from = to + 1;
    if (breathe && ++lines % 20_000 === 0) await breathe();
  }
  return builder.finish();
}

/** A list as kept on disk: the hashes as they are, the rules parsed again */
export function compiledFrom(h: Hashes, complex: string[], counts: ListCounts, allow = false): Compiled {
  const builder = new ListBuilder(allow);
  for (const line of complex) builder.add(line);
  const made = builder.finish();
  return { ...h, byName: made.byName, patterns: made.patterns, bad: made.bad, complex: made.complex, counts: { ...counts, names: h.exact.length + h.sub.length + h.allowExact.length + h.allowSub.length } };
}

/** What a list takes in memory, about: the arrays exactly, an object per rule roughly */
export function memoryOf(c: Compiled): number {
  return c.exact.byteLength + c.sub.byteLength + c.allowExact.byteLength + c.allowSub.byteLength + c.complex.reduce((sum, line) => sum + 300 + line.length, 0);
}

// --- Deciding --------------------------------------------------------------------------------------------

export interface Asked {
  name: string;
  type: number;
  client: string;
  /** The device's name, for `$client` */
  device?: string;
}

export interface Source {
  id: string;
  list: Compiled;
}

export interface Hit {
  action: "block" | "allow" | "rewrite";
  rule: string;
  /** The list that said so; `own` — the person's own rules */
  source: string;
  rewrite?: Rewrite;
}

function bytesOf(ip: string): number[] | null {
  return ipv4(ip) ?? ipv6(ip);
}

/** Whether an address is the one named, or inside the network named (`192.168.1.0/24`) */
export function addressIs(ip: string, what: string): boolean {
  const [base = "", bits] = what.split("/");
  if (bits === undefined) return ip.toLowerCase() === what.toLowerCase();
  const a = bytesOf(ip);
  const b = bytesOf(base);
  const n = Number(bits);
  if (!a || !b || a.length !== b.length || !Number.isInteger(n) || n < 0 || n > a.length * 8) return false;
  for (let i = 0; i < a.length; i++) {
    const take = Math.min(8, Math.max(0, n - i * 8));
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
    if ((a[i]! & mask) !== (b[i]! & mask)) return false;
  }
  return true;
}

const clientIs = (what: string, ask: Asked): boolean => addressIs(ask.client, what) || (!!ask.device && what.toLowerCase() === ask.device.toLowerCase());

/** Whether a rule that matched the name also holds for this question */
function holds(rule: Rule, ask: Asked): boolean {
  if (rule.types) {
    if (rule.types.yes.length && !rule.types.yes.includes(ask.type)) return false;
    if (rule.types.no.includes(ask.type)) return false;
  }
  if (rule.clients) {
    if (rule.clients.yes.length && !rule.clients.yes.some((c) => clientIs(c, ask))) return false;
    if (rule.clients.no.some((c) => clientIs(c, ask))) return false;
  }
  if (rule.denyallow?.some((n) => ask.name === n || ask.name.endsWith("." + n))) return false;
  return true;
}

/** What beats what, as in AdGuard: `$important` over all else, an exception over a rewrite over blocking */
const rank = (allow: boolean, important: boolean, rewrite: boolean): number => (important ? 10 : 0) + (allow ? 2 : rewrite ? 1.5 : 1);

const hitOf = (rule: Rule, source: string): Hit => (rule.allow ? { action: "allow", rule: rule.text, source } : rule.rewrite ? { action: "rewrite", rule: rule.text, source, rewrite: rule.rewrite } : { action: "block", rule: rule.text, source });

/** The strongest rule of these lists for this question; null — none says anything */
export function strongest(sources: Source[], bad: Set<string>, ask: Asked): Hit | null {
  const parts = ask.name.split(".");
  const suffixes: string[] = [];
  for (let i = 0; i < parts.length; i++) suffixes.push(parts.slice(i).join("."));
  const hashes = suffixes.map(hash);
  let best: Hit | null = null;
  let bestRank = 0;
  const offer = (r: number, make: () => Hit) => {
    if (r > bestRank) {
      bestRank = r;
      best = make();
    }
  };
  const good = (key: string) => bad.size === 0 || !bad.has(key);
  for (const { id, list } of sources) {
    for (let i = 0; i < suffixes.length; i++) {
      const name = suffixes[i]!;
      const value = hashes[i]!;
      // an exception of nothing stronger is enough to stop at; the rest of the lists only for `$important`
      if (bestRank < 2) {
        if (has(list.allowSub, value) && good(`@@||${name}^`)) offer(2, () => ({ action: "allow", rule: `@@||${name}^`, source: id }));
        if (i === 0 && has(list.allowExact, value) && good(`@@|${name}^`)) offer(2, () => ({ action: "allow", rule: `@@|${name}^`, source: id }));
      }
      if (bestRank < 1) {
        if (has(list.sub, value) && good(`||${name}^`)) offer(1, () => ({ action: "block", rule: `||${name}^`, source: id }));
        if (i === 0 && has(list.exact, value) && good(`|${name}^`)) offer(1, () => ({ action: "block", rule: `|${name}^`, source: id }));
      }
      for (const rule of list.byName.get(name) ?? []) {
        if (rule.how === "exact" && i > 0) continue;
        if (!good(rule.key) || !holds(rule, ask)) continue;
        offer(rank(rule.allow, rule.important, !!rule.rewrite), () => hitOf(rule, id));
      }
    }
    for (const rule of list.patterns) {
      if (rank(rule.allow, rule.important, !!rule.rewrite) <= bestRank) continue;
      if (rule.re!.test(ask.name) && good(rule.key) && holds(rule, ask)) offer(rank(rule.allow, rule.important, !!rule.rewrite), () => hitOf(rule, id));
    }
  }
  return best;
}

/** The person's own rules first — whatever they say beats every list — then the lists */
export function decide(own: Source | null, lists: Source[], bad: Set<string>, ask: Asked): Hit | null {
  return (own ? strongest([own], bad, ask) : null) ?? strongest(lists, bad, ask);
}

/** What a blocked name gets. With `zero` an address nobody is at, so an app gives up at once instead of trying again. */
export function blockedAnswer(type: number, mode: BlockMode): { rcode: number; answers: { type: number; ttl: number; data: number[] }[] } {
  if (mode === "nxdomain") return { rcode: RCODE.NXDOMAIN, answers: [] };
  if (type === TYPE.A) return { rcode: RCODE.OK, answers: [{ type: TYPE.A, ttl: BLOCK_TTL, data: [0, 0, 0, 0] }] };
  if (type === TYPE.AAAA) return { rcode: RCODE.OK, answers: [{ type: TYPE.AAAA, ttl: BLOCK_TTL, data: new Array(16).fill(0) }] };
  return { rcode: RCODE.OK, answers: [] };
}

/** Short, so "Allow" and a pause are felt at once */
export const BLOCK_TTL = 10;

// --- Settings --------------------------------------------------------------------------------------------

export type BlockMode = "zero" | "nxdomain";

export interface BlockList {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** A list of exceptions */
  allow: boolean;
}

export interface BlockDevice {
  address: string;
  name: string;
  /** Whether names are blocked for it */
  on: boolean;
}

export interface BlockSettings {
  enabled: boolean;
  mode: BlockMode;
  lists: BlockList[];
  rules: string[];
  /** Lists downloaded again every day */
  update: boolean;
  /** Blocking is paused until then */
  pausedUntil: number;
  /** Questions kept in the log (in memory only) */
  log: boolean;
  devices: BlockDevice[];
}

export const BLOCK_DEFAULTS: BlockSettings = { enabled: false, mode: "zero", lists: [], rules: [], update: true, pausedUntil: 0, log: true, devices: [] };

/** A list's address as typed; null — not one Hata would fetch */
export function cleanListUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? "").trim());
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export const cleanListName = (value: unknown): string => String(value ?? "").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 80);

export function cleanDevice(input: unknown): BlockDevice | null {
  const d = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const address = String(d.address ?? "").trim().toLowerCase();
  if (!ipv4(address) && !ipv6(address)) return null;
  return { address, name: cleanListName(d.name).slice(0, 40), on: d.on !== false };
}

export function cleanBlock(value: unknown): BlockSettings {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const lists: BlockList[] = [];
  for (const raw of Array.isArray(v.lists) ? v.lists : []) {
    const l = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const url = cleanListUrl(l.url);
    if (!url || !/^[a-z0-9]{1,16}$/.test(String(l.id)) || lists.some((x) => x.id === l.id || x.url === url)) continue;
    lists.push({ id: String(l.id), name: cleanListName(l.name) || new URL(url).hostname, url, enabled: l.enabled !== false, allow: l.allow === true });
  }
  return {
    enabled: v.enabled === true,
    mode: v.mode === "nxdomain" ? "nxdomain" : "zero",
    lists: lists.slice(0, 50),
    rules: cleanRules(v.rules),
    update: v.update !== false,
    pausedUntil: typeof v.pausedUntil === "number" && v.pausedUntil > 0 ? v.pausedUntil : 0,
    log: v.log !== false,
    devices: (Array.isArray(v.devices) ? v.devices : []).map(cleanDevice).filter((d): d is BlockDevice => d !== null).slice(0, 500),
  };
}

export const cleanRules = (value: unknown): string[] => (Array.isArray(value) ? value : String(value ?? "").split("\n")).map((line) => String(line).trim()).filter((line) => line && line.length <= MAX_LINE).slice(0, 20_000);

/** The lines of the person's own rules that mean nothing to Hata: the page says which */
export function rulesTrouble(rules: string[]): { line: string; why: "notDns" | "broken" | "cosmetic" }[] {
  const out: { line: string; why: "notDns" | "broken" | "cosmetic" }[] = [];
  for (const line of rules) {
    for (const p of parseLine(line)) {
      if (p.kind === "skip" && p.why !== "comment") out.push({ line, why: p.why });
    }
  }
  return out;
}

/** Lists anyone may choose from; none is on by itself */
export const KNOWN_LISTS: { id: string; name: string; url: string; size: "s" | "m" | "l"; what: string }[] = [
  { id: "adguard", name: "AdGuard DNS filter", url: "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt", size: "m", what: "ads" },
  { id: "oisd-small", name: "OISD small", url: "https://small.oisd.nl/", size: "m", what: "ads" },
  { id: "oisd-big", name: "OISD big", url: "https://big.oisd.nl/", size: "l", what: "wide" },
  { id: "hagezi-light", name: "HaGeZi Light", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/light.txt", size: "s", what: "ads" },
  { id: "hagezi-pro", name: "HaGeZi Pro", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt", size: "l", what: "wide" },
  { id: "steven", name: "StevenBlack Unified", url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts", size: "m", what: "ads" },
  { id: "peter", name: "Peter Lowe's list", url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext", size: "s", what: "ads" },
];

/** A name as the one to put in a rule of "Allow" or "Block" */
export const ruleName = (value: unknown): string | null => {
  const name = hostname(String(value ?? "").trim());
  return LABELS_RE.test(name) ? name : null;
};
