/**
 * Moving in from Pi-hole and AdGuard Home: their settings read into a plan the person looks over. Nothing here
 * touches Hata: `dnsblocker.ts` applies what is chosen. Pure but for the files of a Teleporter archive.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanServer, ipv4, ipv6, PRESETS, type DnsRecord } from "./dns";
import { cleanListUrl, type BlockMode } from "./dnsblock";
import { openZip } from "./unzip";

export interface ImportPlan {
  from: "pihole" | "adguard";
  lists: { name: string; url: string; enabled: boolean; allow: boolean }[];
  rules: string[];
  records: DnsRecord[];
  /** Servers upstream: a preset's name or addresses */
  upstream: { preset?: string; doh?: boolean; servers?: string[] } | null;
  mode: BlockMode | null;
  devices: { address: string; name: string; on: boolean }[];
  /** What has no place in Hata, for the person to know: a code and how many, or which */
  leftOut: { code: string; detail: string }[];
}

const empty = (from: ImportPlan["from"]): ImportPlan => ({ from, lists: [], rules: [], records: [], upstream: null, mode: null, devices: [], leftOut: [] });

/** A record of a name and an address, or else a rewrite rule */
function addName(plan: ImportPlan, name: string, value: string): void {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  const v = value.trim().toLowerCase();
  if (!n || !v) return;
  if (n.startsWith("*.")) plan.rules.push(`||${n.slice(2)}^$dnsrewrite=${v}`);
  else if (ipv4(v)) plan.records.push({ name: n, type: "A", value: v });
  else if (ipv6(v)) plan.records.push({ name: n, type: "AAAA", value: v });
  else plan.rules.push(`|${n}^$dnsrewrite=${v}`);
}

/** A regular expression of Pi-hole's as a rule here; `;querytype=` is translated, its other options have no equal */
export function piholeRegex(re: string, allow: boolean): string | null {
  const [src = "", ...options] = re.split(";");
  const mods: string[] = [];
  for (const option of options) {
    const q = /^querytype=(.+)$/.exec(option);
    if (!q) return null;
    const value = q[1]!.toUpperCase();
    mods.push("dnstype=" + (value.startsWith("!") ? value.slice(1).split(",").map((t) => "~" + t).join("|") : value.split(",").join("|")));
  }
  if (!src || src.includes("/")) return null;
  return `${allow ? "@@" : ""}/${src}/${mods.length ? "$" + mods.join(",") : ""}`;
}

/** Pi-hole's own table of lists and names (`gravity.db`, the same since version 5) */
export function fromGravity(db: Database, plan: ImportPlan = empty("pihole")): ImportPlan {
  const lists = db.query("SELECT address, enabled, comment, type FROM adlist").all() as { address: string; enabled: number; comment: string | null; type: number }[];
  for (const l of lists) {
    const url = cleanListUrl(l.address);
    if (!url) {
      plan.leftOut.push({ code: "localList", detail: l.address });
      continue;
    }
    plan.lists.push({ name: (l.comment ?? "").split("\n")[0]!.trim() || new URL(url).hostname, url, enabled: l.enabled === 1, allow: l.type === 1 });
  }
  const names = db.query("SELECT type, domain, enabled FROM domainlist").all() as { type: number; domain: string; enabled: number }[];
  let off = 0;
  for (const n of names) {
    if (n.enabled !== 1) {
      off++;
      continue;
    }
    if (n.type === 0) plan.rules.push(`@@|${n.domain}^`);
    else if (n.type === 1) plan.rules.push(`|${n.domain}^`);
    else {
      const rule = piholeRegex(n.domain, n.type === 2);
      if (rule) plan.rules.push(rule);
      else plan.leftOut.push({ code: "regexOption", detail: n.domain });
    }
  }
  if (off) plan.leftOut.push({ code: "disabledNames", detail: String(off) });
  try {
    const clients = db.query("SELECT ip, comment FROM client").all() as { ip: string; comment: string | null }[];
    for (const c of clients) {
      if (ipv4(c.ip) || ipv6(c.ip)) plan.devices.push({ address: c.ip.toLowerCase(), name: (c.comment ?? "").trim().slice(0, 40), on: true });
      else plan.leftOut.push({ code: "clientKind", detail: c.ip });
    }
    const groups = db.query("SELECT COUNT(*) AS n FROM \"group\"").get() as { n: number };
    if (groups.n > 1) plan.leftOut.push({ code: "groups", detail: String(groups.n) });
  } catch {
    // an older table without these
  }
  return plan;
}

/** `pihole.toml` of Pi-hole 6: its names, where it asks, how it blocks */
export function fromPiholeToml(text: string, plan: ImportPlan = empty("pihole")): ImportPlan {
  const toml = Bun.TOML.parse(text) as { dns?: { upstreams?: unknown; hosts?: unknown; cnameRecords?: unknown; blocking?: { mode?: unknown } } };
  const dns = toml.dns ?? {};
  for (const line of Array.isArray(dns.hosts) ? dns.hosts : []) hostsLine(plan, String(line));
  for (const line of Array.isArray(dns.cnameRecords) ? dns.cnameRecords : []) cnameLine(plan, String(line));
  plan.upstream = upstreamOf(plan, Array.isArray(dns.upstreams) ? dns.upstreams.map(String) : []);
  const mode = String(dns.blocking?.mode ?? "");
  if (mode) plan.mode = mode === "NXDOMAIN" ? "nxdomain" : "zero";
  return plan;
}

function hostsLine(plan: ImportPlan, line: string): void {
  const [ip = "", ...names] = line.trim().split(/\s+/);
  if (ipv4(ip) || ipv6(ip)) for (const name of names) addName(plan, name, ip);
}

/** `name[,name…],target[,ttl]` */
function cnameLine(plan: ImportPlan, line: string): void {
  const parts = line.replace(/^cname=/, "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]!)) parts.pop();
  const target = parts.pop();
  if (target) for (const name of parts) addName(plan, name, target);
}

/** The servers named: a preset's when they are its, plain addresses and DoH as they are; the others are said */
function upstreamOf(plan: ImportPlan, list: string[]): ImportPlan["upstream"] {
  const servers: string[] = [];
  let tlsPreset = "";
  for (const raw of list) {
    const s = raw.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("[/")) {
      plan.leftOut.push({ code: "upstreamDomain", detail: s });
      continue;
    }
    const tls = /^tls:\/\/([^/:]+)/.exec(s)?.[1];
    if (tls) {
      const found = Object.entries(PRESETS).find(([, p]) => p.tls === tls)?.[0];
      if (found) tlsPreset ||= found;
      else plan.leftOut.push({ code: "upstreamKind", detail: s });
      continue;
    }
    const plain = s.replace(/^udp:\/\//, "").replace(/#53$/, "").replace(/^(\d+\.\d+\.\d+\.\d+):53$/, "$1");
    const server = cleanServer(plain);
    if (server) servers.push(server);
    else plan.leftOut.push({ code: "upstreamKind", detail: s });
  }
  if (tlsPreset) return { preset: tlsPreset, doh: true };
  if (!servers.length) return null;
  const preset = Object.entries(PRESETS).find(([, p]) => p.udp.includes(servers[0]!) && servers.every((x) => p.udp.includes(x)))?.[0];
  return preset ? { preset, doh: false } : { servers: servers.slice(0, 8) };
}

/** The Teleporter archive of Pi-hole 5: JSON files by table */
function fromTeleporter5(files: Map<string, string>): ImportPlan {
  const plan = empty("pihole");
  const json = (name: string): Record<string, unknown>[] => {
    const text = files.get(name);
    if (!text) return [];
    try {
      const list = JSON.parse(text);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  for (const l of json("adlist.json")) {
    const url = cleanListUrl(l.address);
    if (url) plan.lists.push({ name: String(l.comment ?? "").split("\n")[0]!.trim() || new URL(url).hostname, url, enabled: l.enabled === 1 || l.enabled === true, allow: false });
  }
  const on = (r: Record<string, unknown>) => r.enabled === 1 || r.enabled === true;
  for (const r of json("whitelist.exact.json")) if (on(r)) plan.rules.push(`@@|${r.domain}^`);
  for (const r of json("blacklist.exact.json")) if (on(r)) plan.rules.push(`|${r.domain}^`);
  for (const [name, allow] of [["whitelist.regex.json", true], ["blacklist.regex.json", false]] as const) {
    for (const r of json(name)) {
      if (!on(r)) continue;
      const rule = piholeRegex(String(r.domain), allow);
      if (rule) plan.rules.push(rule);
      else plan.leftOut.push({ code: "regexOption", detail: String(r.domain) });
    }
  }
  for (const c of json("client.json")) {
    const ip = String(c.ip ?? "");
    if (ipv4(ip) || ipv6(ip)) plan.devices.push({ address: ip.toLowerCase(), name: String(c.comment ?? "").trim().slice(0, 40), on: true });
    else plan.leftOut.push({ code: "clientKind", detail: ip });
  }
  for (const line of (files.get("custom.list") ?? "").split("\n")) hostsLine(plan, line);
  for (const line of (files.get("05-pihole-custom-cname.conf") ?? "").split("\n")) if (line.startsWith("cname=")) cnameLine(plan, line);
  const vars = files.get("setupVars.conf") ?? "";
  if (/^BLOCKINGMODE=NXDOMAIN$/m.test(vars)) plan.mode = "nxdomain";
  else if (/^BLOCKINGMODE=/m.test(vars)) plan.mode = "zero";
  const servers = [...vars.matchAll(/^PIHOLE_DNS_\d+=(.+)$/gm)].map((m) => m[1]!.trim());
  plan.upstream = upstreamOf(plan, servers);
  return plan;
}

/** The files of a plain tar archive, by the last part of their names */
export function readTar(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const text = new TextDecoder();
  for (let pos = 0; pos + 512 <= data.length; ) {
    const head = data.subarray(pos, pos + 512);
    if (head.every((b) => b === 0)) break;
    const field = (at: number, len: number) => text.decode(head.subarray(at, at + len)).replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8) || 0;
    const kind = field(156, 1);
    const name = field(0, 100).split("/").pop() ?? "";
    if ((kind === "0" || kind === "") && name && size <= 32 * 1024 * 1024) out.set(name, text.decode(data.subarray(pos + 512, pos + 512 + size)));
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** AdGuard Home's settings file. Filters kept as files of its own and blocked services have no address to go by. */
export function fromAdguardYaml(text: string): ImportPlan {
  const plan = empty("adguard");
  const y = (Bun.YAML.parse(text) ?? {}) as Record<string, any>;
  if (typeof y !== "object" || (!y.filters && !y.dns && !y.user_rules)) throw new Error("not AdGuard Home's settings");
  const take = (list: unknown, allow: boolean) => {
    for (const f of Array.isArray(list) ? list : []) {
      const url = cleanListUrl(f?.url);
      if (!url) {
        plan.leftOut.push({ code: "localList", detail: String(f?.url ?? f?.name ?? "") });
        continue;
      }
      plan.lists.push({ name: String(f.name ?? "").trim() || new URL(url).hostname, url, enabled: f.enabled !== false, allow });
    }
  };
  take(y.filters, false);
  take(y.whitelist_filters, true);
  for (const line of Array.isArray(y.user_rules) ? y.user_rules : []) {
    const rule = String(line).trim();
    if (rule && !rule.startsWith("!") && !rule.startsWith("#")) plan.rules.push(rule);
  }
  const filtering = y.filtering ?? y.dns ?? {};
  for (const r of Array.isArray(filtering.rewrites) ? filtering.rewrites : []) {
    if (r?.enabled === false) continue;
    const answer = String(r?.answer ?? "");
    if (answer === "A" || answer === "AAAA") plan.leftOut.push({ code: "rewriteKeep", detail: String(r?.domain ?? "") });
    else addName(plan, String(r?.domain ?? ""), answer);
  }
  const blockedServices = filtering.blocked_services?.ids ?? filtering.blocked_services ?? y.dns?.blocked_services;
  if (Array.isArray(blockedServices) && blockedServices.length) plan.leftOut.push({ code: "services", detail: blockedServices.join(", ") });
  const mode = String(filtering.blocking_mode ?? y.dns?.blocking_mode ?? "");
  if (mode === "nxdomain" || mode === "refused") plan.mode = "nxdomain";
  else if (mode) plan.mode = "zero";
  if (mode === "custom_ip") plan.leftOut.push({ code: "customIp", detail: "" });
  plan.upstream = upstreamOf(plan, Array.isArray(y.dns?.upstream_dns) ? y.dns.upstream_dns.map(String) : []);
  for (const c of Array.isArray(y.clients?.persistent) ? y.clients.persistent : []) {
    const ids = (Array.isArray(c?.ids) ? c.ids : []).map(String);
    const on = c?.use_global_settings !== false || c?.filtering_enabled !== false;
    for (const id of ids) {
      if (ipv4(id) || ipv6(id)) plan.devices.push({ address: id.toLowerCase(), name: String(c?.name ?? "").trim().slice(0, 40), on });
      else plan.leftOut.push({ code: "clientKind", detail: id });
    }
  }
  return plan;
}

/** A `gravity.db` lying on the disk, with `pihole.toml` next to it when there is one */
export function fromPiholeFiles(gravity: string, toml?: string): ImportPlan {
  const plan = empty("pihole");
  // a copy: the running Pi-hole may hold the file, and a look must not touch it
  const dir = mkdtempSync(join(tmpdir(), "hata-pihole-"));
  try {
    const copy = join(dir, "gravity.db");
    writeFileSync(copy, readFileSync(gravity));
    const db = new Database(copy, { readonly: true });
    try {
      fromGravity(db, plan);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (toml) fromPiholeToml(toml, plan);
  return plan;
}

/** What was uploaded: a Teleporter archive of Pi-hole (zip of 6, tar.gz of 5), `AdGuardHome.yaml` or a `gravity.db` */
export async function readImportFile(data: Uint8Array): Promise<ImportPlan> {
  const dir = mkdtempSync(join(tmpdir(), "hata-import-"));
  try {
    if (data[0] === 0x50 && data[1] === 0x4b) {
      const path = join(dir, "teleporter.zip");
      writeFileSync(path, data);
      const zip = openZip(path);
      try {
        const named = (end: string) => zip.entries.find((e) => !e.dir && e.name.split("/").pop() === end);
        const gravity = named("gravity.db");
        if (!gravity) throw new ImportError("dns.import.unknown");
        const to = join(dir, "gravity.db");
        await zip.extract(gravity, to);
        const toml = named("pihole.toml");
        let tomlText: string | undefined;
        if (toml) {
          const at = join(dir, "pihole.toml");
          await zip.extract(toml, at);
          tomlText = readFileSync(at, "utf8");
        }
        return fromPiholeFiles(to, tomlText);
      } finally {
        zip.close();
      }
    }
    if (data[0] === 0x1f && data[1] === 0x8b) return fromTeleporter5(readTar(Bun.gunzipSync(data as Uint8Array<ArrayBuffer>)));
    if (new TextDecoder().decode(data.subarray(0, 15)) === "SQLite format 3") {
      const path = join(dir, "gravity.db");
      writeFileSync(path, data);
      return fromPiholeFiles(path);
    }
    try {
      return fromAdguardYaml(new TextDecoder().decode(data));
    } catch {
      throw new ImportError("dns.import.unknown");
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("dns.import.broken", e instanceof Error ? e.message : String(e));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class ImportError extends Error {
  constructor(readonly code: string, readonly why = "") {
    super(code);
  }
}
