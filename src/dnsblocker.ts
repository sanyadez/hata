/**
 * Blocking by name in the DNS server, the part with state: the lists downloaded and kept in `dnslists/` of the
 * state directory (compiled, so a start reads them in no time; left out of the server's snapshot, because they
 * are downloaded again), the person's own rules, the pause, the devices, and what was asked lately. What is
 * asked stays in memory only. The formats and the deciding are in `dnsblock.ts`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { listApps, viewOf } from "./apps";
import type { AttentionItem } from "./attention";
import { appFolders } from "./backup";
import { DATA_DIR, saveSettings, settings } from "./config";
import { cleanBlock, cleanDevice, cleanListName, cleanListUrl, cleanRules, compiledFrom, compileText, decide, KNOWN_LISTS, ListBuilder, memoryOf, ruleName, rulesTrouble, type BlockList, type Compiled, type Hit, type ListCounts, type Source } from "./dnsblock";
import { fromAdguardYaml, fromPiholeFiles, ImportError, readImportFile, type ImportPlan } from "./dnsimport";

const DIR = join(DATA_DIR, "dnslists");
const STATS_FILE = join(DATA_DIR, "dns-stats.json");
const FORMAT = 1;
const MAX_DOWNLOAD = 150 * 1024 * 1024;
const DOWNLOAD_MS = 3 * 60_000;
const DAY_MS = 24 * 3600_000;
const STALE_MS = 7 * DAY_MS;
const LOG_MAX = 5000;
const TOP_MAX = 5000;

interface Meta {
  format: number;
  url: string;
  allow: boolean;
  updated: number;
  checked: number;
  etag: string;
  modified: string;
  counts: ListCounts;
  complex: string[];
  /** How many hashes each array holds */
  sizes: [number, number, number, number];
}

const loaded = new Map<string, { list: Compiled; meta: Meta }>();
const status = new Map<string, { busy: boolean; error: string; failedAt: number }>();
let sources: Source[] = [];
let bad = new Set<string>();
let own: Source | null = null;

export class BlockError extends Error {
  constructor(readonly code: string, readonly detail: Record<string, string> = {}) {
    super(code);
  }
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rebuild(): void {
  sources = settings.dnsBlock.lists.flatMap((l) => {
    const at = l.enabled ? loaded.get(l.id) : undefined;
    return at ? [{ id: l.id, list: at.list }] : [];
  });
  const b = new ListBuilder();
  for (const line of settings.dnsBlock.rules) b.add(line);
  const made = b.finish();
  own = { id: "own", list: made };
  bad = new Set([...made.bad, ...sources.flatMap((s) => s.list.bad)]);
}

// --- Lists on the disk -----------------------------------------------------------------------------------

const metaPath = (id: string) => join(DIR, `${id}.json`);
const hashesPath = (id: string) => join(DIR, `${id}.bin`);

function writeList(id: string, list: Compiled, meta: Meta): void {
  mkdirSync(DIR, { recursive: true });
  const arrays = [list.exact, list.sub, list.allowExact, list.allowSub];
  const bytes = new Uint8Array(arrays.reduce((sum, a) => sum + a.byteLength, 0));
  let at = 0;
  for (const a of arrays) {
    bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at);
    at += a.byteLength;
  }
  writeFileSync(hashesPath(id) + ".new", bytes);
  writeFileSync(metaPath(id) + ".new", JSON.stringify(meta));
  renameSync(hashesPath(id) + ".new", hashesPath(id));
  renameSync(metaPath(id) + ".new", metaPath(id));
}

/** A list from the disk; false — it is not there, or not of this version */
async function readList(l: BlockList): Promise<boolean> {
  try {
    if (!existsSync(metaPath(l.id)) || !existsSync(hashesPath(l.id))) return false;
    const meta = JSON.parse(readFileSync(metaPath(l.id), "utf8")) as Meta;
    if (meta.format !== FORMAT || meta.url !== l.url || meta.allow !== l.allow) return false;
    const buffer = await Bun.file(hashesPath(l.id)).arrayBuffer();
    if (buffer.byteLength !== meta.sizes.reduce((sum, n) => sum + n, 0) * 8) return false;
    let at = 0;
    const next = (n: number) => {
      const a = new BigUint64Array(buffer, at, n);
      at += n * 8;
      return a;
    };
    const [a, b, c, d] = meta.sizes;
    const list = compiledFrom({ exact: next(a), sub: next(b), allowExact: next(c), allowSub: next(d) }, meta.complex, meta.counts, l.allow);
    loaded.set(l.id, { list, meta });
    return true;
  } catch {
    return false;
  }
}

/** Reads a body up to the limit */
async function bodyText(r: Response): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) return "";
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DOWNLOAD) {
      void reader.cancel().catch(() => {});
      throw new Error("the list is larger than 150 MB");
    }
    pieces.push(value);
  }
  return Buffer.concat(pieces).toString("utf8");
}

/** Downloads a list and puts it in use; what was in use stays when anything goes wrong */
async function download(l: BlockList, force = false): Promise<void> {
  const st = status.get(l.id) ?? { busy: false, error: "", failedAt: 0 };
  if (st.busy) return;
  status.set(l.id, { ...st, busy: true });
  try {
    const before = loaded.get(l.id)?.meta;
    const headers: Record<string, string> = { "user-agent": "Hata" };
    if (before && !force) {
      if (before.etag) headers["if-none-match"] = before.etag;
      if (before.modified) headers["if-modified-since"] = before.modified;
    }
    const r = await fetch(l.url, { headers, signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (r.status === 304 && before) {
      const meta = { ...before, checked: Date.now() };
      writeFileSync(metaPath(l.id), JSON.stringify(meta));
      loaded.set(l.id, { list: loaded.get(l.id)!.list, meta });
    } else {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await bodyText(r);
      if (/^\s*<(!doctype|html)/i.test(text.slice(0, 200))) throw new Error("a web page came instead of a list");
      const list = await compileText(text, l.allow, breathe);
      if (!list.counts.names && !list.counts.rules) throw new Error("nothing in it could be understood");
      const meta: Meta = { format: FORMAT, url: l.url, allow: l.allow, updated: Date.now(), checked: Date.now(), etag: r.headers.get("etag") ?? "", modified: r.headers.get("last-modified") ?? "", counts: list.counts, complex: list.complex, sizes: [list.exact.length, list.sub.length, list.allowExact.length, list.allowSub.length] };
      writeList(l.id, list, meta);
      // it may have been switched off or removed while this was running
      const now = settings.dnsBlock.lists.find((x) => x.id === l.id);
      if (!now) forgetFiles(l.id);
      else if (now.enabled && settings.dnsBlock.enabled) {
        loaded.set(l.id, { list, meta });
        rebuild();
      }
    }
    status.set(l.id, { busy: false, error: "", failedAt: 0 });
  } catch (e) {
    status.set(l.id, { busy: false, error: e instanceof Error ? e.message : String(e), failedAt: Date.now() });
  }
}

function forgetFiles(id: string): void {
  rmSync(metaPath(id), { force: true });
  rmSync(hashesPath(id), { force: true });
}

/** Puts what is switched on in memory (from the disk, or downloaded), and takes the rest out of it */
let settling = Promise.resolve();
function settle(): Promise<void> {
  settling = settling.then(async () => {
    const s = settings.dnsBlock;
    for (const id of [...loaded.keys()]) {
      const l = s.lists.find((x) => x.id === id);
      if (!s.enabled || !l?.enabled) loaded.delete(id);
    }
    rebuild();
    if (!s.enabled) return;
    for (const l of s.lists) {
      if (!l.enabled || loaded.has(l.id)) continue;
      if (await readList(l)) rebuild();
      else await download(l);
    }
    rebuild();
  }).catch((e) => console.error("DNS lists:", e));
  return settling;
}

/** The daily look: a list not asked about for a day is asked about now; a failure is tried again the next hour */
async function updateDue(): Promise<void> {
  const s = settings.dnsBlock;
  if (!s.enabled || !s.update) return;
  for (const l of s.lists) {
    const meta = loaded.get(l.id)?.meta;
    if (l.enabled && meta && Date.now() - meta.checked >= DAY_MS) await download(l);
  }
}

// --- Deciding --------------------------------------------------------------------------------------------

const paused = (): boolean => settings.dnsBlock.pausedUntil > Date.now();

/** Whether anything is being looked at for questions now */
export const blocking = (): boolean => settings.dnsBlock.enabled && !paused();

/** The rule that decides a question, if any; null when blocking is off or paused or the device is left out */
export function blockFor(name: string, type: number, client: string): Hit | null {
  if (!blocking()) return null;
  const device = settings.dnsBlock.devices.find((d) => d.address === client);
  if (device && !device.on) return null;
  return decide(own, sources, bad, { name, type, client, device: device?.name });
}

// --- What was asked --------------------------------------------------------------------------------------

export type Outcome = "blocked" | "rewritten" | "allowed" | "passed" | "own" | "failed";

interface Entry {
  at: number;
  name: string;
  type: number;
  client: string;
  outcome: Outcome;
  rule?: string;
  source?: string;
}

const log: Entry[] = [];
let logAt = 0;
const hours: { at: number; questions: number; blocked: number }[] = [];
const top = new Map<string, number>();
const blockedBy = new Map<string, number>();

/** Called for every question answered */
export function note(name: string, type: number, client: string, outcome: Outcome, hit?: Hit | null): void {
  const now = Date.now();
  const hour = Math.floor(now / 3600_000) * 3600_000;
  let last = hours[hours.length - 1];
  if (last?.at !== hour) {
    last = { at: hour, questions: 0, blocked: 0 };
    hours.push(last);
    while (hours.length > 24 * 7) hours.shift();
  }
  last.questions++;
  if (outcome === "blocked") {
    last.blocked++;
    top.set(name, (top.get(name) ?? 0) + 1);
    blockedBy.set(client, (blockedBy.get(client) ?? 0) + 1);
    if (top.size > TOP_MAX) for (const [n, c] of top) if (c === 1) top.delete(n);
  }
  if (!settings.dnsBlock.log) return;
  const entry: Entry = { at: now, name, type, client, outcome, ...(hit ? { rule: hit.rule, source: hit.source } : {}) };
  if (log.length < LOG_MAX) log.push(entry);
  else {
    log[logAt] = entry;
    logAt = (logAt + 1) % LOG_MAX;
  }
}

/** The log, the newest first */
export function blockLog(filter: { q?: string; outcome?: string; client?: string; limit?: number }) {
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  const q = (filter.q ?? "").trim().toLowerCase();
  const out: Entry[] = [];
  for (let i = 0; i < log.length && out.length < limit; i++) {
    const e = log[(logAt - 1 - i + log.length * 2) % log.length]!;
    if (q && !e.name.includes(q)) continue;
    if (filter.outcome && e.outcome !== filter.outcome) continue;
    if (filter.client && e.client !== filter.client) continue;
    out.push(e);
  }
  return out.map((e) => ({ ...e, listName: listNameOf(e.source) }));
}

const listNameOf = (source?: string): string | undefined => (source && source !== "own" ? settings.dnsBlock.lists.find((l) => l.id === source)?.name : undefined);

function readStats(): void {
  try {
    const saved = JSON.parse(readFileSync(STATS_FILE, "utf8")) as { hours?: typeof hours };
    if (Array.isArray(saved.hours)) hours.push(...saved.hours.filter((h) => typeof h?.at === "number" && Date.now() - h.at < 7 * DAY_MS));
  } catch {
    // none yet
  }
}

function writeStats(): void {
  try {
    writeFileSync(STATS_FILE, JSON.stringify({ hours }));
  } catch {
    // the numbers are not worth a complaint
  }
}

const lastDay = () => hours.filter((h) => Date.now() - h.at < DAY_MS);

// --- The page ---------------------------------------------------------------------------------------------

function listRow(l: BlockList) {
  const at = loaded.get(l.id);
  const st = status.get(l.id);
  let meta = at?.meta;
  if (!meta && existsSync(metaPath(l.id))) {
    try {
      meta = JSON.parse(readFileSync(metaPath(l.id), "utf8")) as Meta;
    } catch {
      meta = undefined;
    }
  }
  return { ...l, counts: meta?.counts ?? null, updated: meta?.updated ?? 0, checked: meta?.checked ?? 0, memory: at ? memoryOf(at.list) : 0, disk: existsSync(hashesPath(l.id)) ? statSync(hashesPath(l.id)).size : 0, busy: st?.busy ?? false, error: st?.error ?? "" };
}

/** What the page shows; `clients` — who asks, from the DNS server */
export function blockReport(clients: { address: string; count: number; last: number }[]) {
  const s = settings.dnsBlock;
  const lists = s.lists.map(listRow);
  const day = lastDay();
  const devices = new Map<string, { address: string; name: string; on: boolean; known: boolean; count: number; last: number; blocked: number }>();
  for (const c of clients) devices.set(c.address, { address: c.address, name: "", on: true, known: false, count: c.count, last: c.last, blocked: blockedBy.get(c.address) ?? 0 });
  for (const d of s.devices) devices.set(d.address, { ...(devices.get(d.address) ?? { count: 0, last: 0, blocked: 0 }), address: d.address, name: d.name, on: d.on, known: true });
  const ownList = own?.list;
  return {
    settings: s,
    paused: paused(),
    lists,
    known: KNOWN_LISTS,
    own: { names: ownList?.counts.names ?? 0, rules: ownList?.counts.rules ?? 0, trouble: rulesTrouble(s.rules).slice(0, 50) },
    memory: { lists: lists.reduce((sum, l) => sum + l.memory, 0), process: process.memoryUsage().rss },
    names: lists.reduce((sum, l) => sum + (l.enabled ? (l.counts?.names ?? 0) : 0), 0),
    day: { questions: day.reduce((sum, h) => sum + h.questions, 0), blocked: day.reduce((sum, h) => sum + h.blocked, 0) },
    hours: hours.slice(-24),
    top: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    devices: [...devices.values()].sort((a, b) => Number(b.known) - Number(a.known) || b.last - a.last).slice(0, 100),
  };
}

/** For the block on Home */
export function blockSummary() {
  const s = settings.dnsBlock;
  const day = lastDay();
  return { enabled: s.enabled, serving: settings.dns.enabled, paused: paused(), pausedUntil: s.pausedUntil, questions: day.reduce((sum, h) => sum + h.questions, 0), blocked: day.reduce((sum, h) => sum + h.blocked, 0), names: sources.reduce((sum, x) => sum + x.list.counts.names, 0) };
}

export function checkName(name: unknown, client: unknown, type: number) {
  const n = ruleName(name);
  if (!n) throw new BlockError("dns.block.badName");
  const asker = String(client ?? "").trim() || "0.0.0.0";
  // what a list says, also while blocking is paused: the question is what would happen
  const device = settings.dnsBlock.devices.find((d) => d.address === asker);
  const hit = decide(own, sources, bad, { name: n, type, client: asker, device: device?.name });
  return { name: n, hit: hit ? { ...hit, listName: listNameOf(hit.source) } : null, deviceOff: device ? !device.on : false };
}

export async function setBlock(input: Record<string, unknown>, by: string): Promise<void> {
  const before = settings.dnsBlock;
  const next = cleanBlock({ ...before, ...("enabled" in input ? { enabled: input.enabled } : {}), ...("mode" in input ? { mode: input.mode } : {}), ...("update" in input ? { update: input.update } : {}), ...("log" in input ? { log: input.log } : {}) });
  settings.dnsBlock = next;
  if (!next.log) log.length = logAt = 0;
  saveSettings();
  if (before.enabled !== next.enabled) record(next.enabled ? "dns.block.on" : "dns.block.off", { user: by });
  else record("dns.block.changed", { user: by });
  void settle();
}

export function pauseBlock(minutes: unknown, by: string): void {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 0 || n > 7 * 24 * 60) throw new BlockError("dns.block.badPause");
  settings.dnsBlock = { ...settings.dnsBlock, pausedUntil: n === 0 ? 0 : Date.now() + n * 60_000 };
  saveSettings();
  record(n === 0 ? "dns.block.resumed" : "dns.block.paused", { user: by, detail: n === 0 ? undefined : String(n) });
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

export function addList(input: Record<string, unknown>, by: string): void {
  const url = cleanListUrl(input.url);
  if (!url) throw new BlockError("dns.block.badUrl");
  const s = settings.dnsBlock;
  if (s.lists.some((l) => l.url === url)) throw new BlockError("dns.block.listTaken");
  if (s.lists.length >= 50) throw new BlockError("dns.block.tooManyLists");
  const list: BlockList = { id: newId(), name: cleanListName(input.name) || new URL(url).hostname, url, enabled: true, allow: input.allow === true };
  settings.dnsBlock = { ...s, lists: [...s.lists, list] };
  saveSettings();
  record("dns.block.listAdded", { user: by, detail: list.name });
  void settle();
}

const listOf = (id: string): BlockList => {
  const l = settings.dnsBlock.lists.find((x) => x.id === id);
  if (!l) throw new BlockError("dns.block.noList");
  return l;
};

export function changeList(id: string, input: Record<string, unknown>, by: string): void {
  const l = listOf(id);
  const name = "name" in input ? cleanListName(input.name) || l.name : l.name;
  const enabled = "enabled" in input ? input.enabled === true : l.enabled;
  settings.dnsBlock = { ...settings.dnsBlock, lists: settings.dnsBlock.lists.map((x) => (x.id === id ? { ...x, name, enabled } : x)) };
  saveSettings();
  record("dns.block.listChanged", { user: by, detail: name });
  void settle();
}

export function removeList(id: string, by: string): void {
  const l = listOf(id);
  settings.dnsBlock = { ...settings.dnsBlock, lists: settings.dnsBlock.lists.filter((x) => x.id !== id) };
  saveSettings();
  loaded.delete(id);
  status.delete(id);
  forgetFiles(id);
  rebuild();
  record("dns.block.listRemoved", { user: by, detail: l.name });
}

/** Downloads one list now, or all of them that are on: the page goes on asking how it went */
export function refreshLists(id?: string): void {
  const s = settings.dnsBlock;
  const wanted = id ? [listOf(id)] : s.lists.filter((l) => l.enabled);
  void (async () => {
    for (const l of wanted) await download(l, true);
  })().catch((e) => console.error("DNS lists:", e));
}

export function setRules(text: unknown, by: string): void {
  settings.dnsBlock = { ...settings.dnsBlock, rules: cleanRules(text) };
  saveSettings();
  rebuild();
  record("dns.block.rules", { user: by });
}

/** "Allow" or "Block" of the log: the opposite rule of the person's for that name goes, this one comes */
export function ruleForName(name: unknown, allow: boolean, by: string): string {
  const n = ruleName(name);
  if (!n) throw new BlockError("dns.block.badName");
  const opposite = allow ? [`||${n}^`, `|${n}^`] : [`@@||${n}^`, `@@|${n}^`];
  const rule = allow ? `@@||${n}^` : `||${n}^`;
  const rest = settings.dnsBlock.rules.filter((line) => !opposite.includes(line) && line !== rule);
  settings.dnsBlock = { ...settings.dnsBlock, rules: [...rest, rule] };
  saveSettings();
  rebuild();
  record(allow ? "dns.block.allowed" : "dns.block.blocked", { user: by, detail: n });
  return rule;
}

export function setDevice(input: unknown, by: string): void {
  const d = cleanDevice(input);
  if (!d) throw new BlockError("dns.block.badDevice");
  const rest = settings.dnsBlock.devices.filter((x) => x.address !== d.address);
  settings.dnsBlock = { ...settings.dnsBlock, devices: d.name || !d.on ? [...rest, d] : rest };
  saveSettings();
  record("dns.block.device", { user: by, detail: d.name || d.address });
}

// --- Moving in --------------------------------------------------------------------------------------------

const plans = new Map<string, { plan: ImportPlan; at: number }>();

function keepPlan(plan: ImportPlan) {
  for (const [id, p] of plans) if (Date.now() - p.at > 3600_000) plans.delete(id);
  const id = newId();
  plans.set(id, { plan, at: Date.now() });
  const have = new Set(settings.dnsBlock.lists.map((l) => l.url));
  return { id, ...plan, lists: plan.lists.map((l) => ({ ...l, have: have.has(l.url) })) };
}

export async function planFromFile(data: Uint8Array) {
  try {
    return keepPlan(await readImportFile(data));
  } catch (e) {
    if (e instanceof ImportError) throw new BlockError(e.code, { why: e.why });
    throw e;
  }
}

/** A file somewhere in an app's folder: at its top or a level or two below */
function findIn(folders: string[], names: string[]): string | null {
  const look = (dir: string, depth: number): string | null => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) if (e.isFile() && names.includes(e.name)) return join(dir, e.name);
    if (depth > 0) for (const e of entries) if (e.isDirectory()) {
      const found = look(join(dir, e.name), depth - 1);
      if (found) return found;
    }
    return null;
  };
  for (const folder of folders) {
    const found = look(folder, 2);
    if (found) return found;
  }
  return null;
}

const KIND_OF_IMAGE: [RegExp, "pihole" | "adguard"][] = [[/(^|\/)pi-?hole(:|@|$)/i, "pihole"], [/(^|\/)adguardhome(:|@|$)/i, "adguard"]];

function kindOfApp(name: string): "pihole" | "adguard" | null {
  const compose = viewOf(name) as { services?: Record<string, { image?: unknown }> } | null;
  for (const service of Object.values(compose?.services ?? {})) {
    const found = KIND_OF_IMAGE.find(([re]) => re.test(String(service?.image ?? "")));
    if (found) return found[1];
  }
  return null;
}

function foldersOf(name: string): string[] {
  const f = appFolders(name);
  return [...f.included, ...f.other];
}

/** The apps of this server that are a Pi-hole or an AdGuard Home; `found` — their settings are in a folder Hata can read */
export async function importableApps() {
  const apps = await listApps("en");
  return apps.flatMap((app) => {
    const kind = kindOfApp(app.name);
    if (!kind) return [];
    const file = findIn(foldersOf(app.name), kind === "pihole" ? ["gravity.db"] : ["AdGuardHome.yaml"]);
    return [{ name: app.name, title: app.title, kind, found: !!file, running: app.status === "running" }];
  });
}

export function planFromApp(name: unknown) {
  const n = String(name ?? "");
  const kind = kindOfApp(n);
  if (!kind) throw new BlockError("dns.import.notSuch");
  const folders = foldersOf(n);
  const file = findIn(folders, kind === "pihole" ? ["gravity.db"] : ["AdGuardHome.yaml"]);
  if (!file) throw new BlockError("dns.import.noFile");
  try {
    if (kind === "adguard") return keepPlan(fromAdguardYaml(readFileSync(file, "utf8")));
    const toml = findIn(folders, ["pihole.toml"]);
    return keepPlan(fromPiholeFiles(file, toml ? readFileSync(toml, "utf8") : undefined));
  } catch (e) {
    throw new BlockError("dns.import.broken", { why: e instanceof Error ? e.message : String(e) });
  }
}

export interface ImportParts {
  lists?: boolean;
  rules?: boolean;
  records?: boolean;
  upstream?: boolean;
  mode?: boolean;
  devices?: boolean;
}

/** Takes the blocking's part of a plan; what concerns the DNS server itself is handed back */
export function takePlan(id: string, parts: ImportParts, by: string): Pick<ImportPlan, "records" | "upstream"> {
  const kept = plans.get(id);
  if (!kept) throw new BlockError("dns.import.gone");
  const { plan } = kept;
  const s = settings.dnsBlock;
  const lists = [...s.lists];
  if (parts.lists) {
    for (const l of plan.lists) {
      const url = cleanListUrl(l.url);
      if (url && !lists.some((x) => x.url === url) && lists.length < 50) lists.push({ id: newId(), name: cleanListName(l.name) || new URL(url).hostname, url, enabled: l.enabled, allow: l.allow });
    }
  }
  const rules = parts.rules ? cleanRules([...s.rules, ...plan.rules.filter((r) => !s.rules.includes(r))]) : s.rules;
  const devices = [...s.devices];
  if (parts.devices) {
    for (const raw of plan.devices) {
      const d = cleanDevice(raw);
      if (d && !devices.some((x) => x.address === d.address)) devices.push(d);
    }
  }
  settings.dnsBlock = { ...s, enabled: true, lists, rules, devices, mode: parts.mode && plan.mode ? plan.mode : s.mode };
  saveSettings();
  plans.delete(id);
  record("dns.block.imported", { user: by, detail: plan.from === "pihole" ? "Pi-hole" : "AdGuard Home" });
  void settle();
  return { records: parts.records ? plan.records : [], upstream: parts.upstream ? plan.upstream : null };
}

/** For the attention list: a list that has not been brought up to date for a week */
export function blockTrouble(): AttentionItem[] {
  const s = settings.dnsBlock;
  if (!s.enabled || !s.update) return [];
  const out: AttentionItem[] = [];
  for (const l of s.lists) {
    if (!l.enabled) continue;
    const meta = loaded.get(l.id)?.meta;
    const st = status.get(l.id);
    if (meta ? Date.now() - meta.updated > STALE_MS && Date.now() - meta.checked > STALE_MS : !!st?.error) out.push({ id: `dns:block:${l.id}`, severity: "warn", code: "dns.blockList", detail: { list: l.name, error: st?.error || "" } });
  }
  return out;
}

export function startBlocker(): void {
  readStats();
  rebuild();
  void settle();
  setTimeout(() => void updateDue().catch(() => {}), 5 * 60_000);
  setInterval(() => void updateDue().catch(() => {}), 3600_000);
  setInterval(writeStats, 10 * 60_000);
}
