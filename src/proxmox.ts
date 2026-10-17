/**
 * Proxmox VE servers, looked after through their own API with a token made there (Datacenter →
 * Permissions → API Tokens). Nothing is installed on the server; what the token may do is what
 * Proxmox allows it, and the page offers only that.
 *
 * Proxmox's certificate is usually its own: the person confirms its fingerprint once, and every
 * request after that goes over a connection whose certificate was compared with it BEFORE the token
 * is sent. A certificate a system authority vouches for (a proxy with Let's Encrypt) is checked the
 * usual way.
 *
 * State is `proxmox.json` in the secrets folder (the token's secret is there). What the servers said
 * last lives in memory: `/cluster/resources` every 20 s — one request for nodes, guests and storages,
 * the servers are often small —, the tasks every minute, the guests' configurations and the disks'
 * health every few minutes. A server that does not answer is asked again at the same pace.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { networkInterfaces, tmpdir } from "node:os";
import { connect, type TLSSocket } from "node:tls";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, startJob, type Log } from "./apps";
import { bus } from "./bus";
import { SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { invite, machines } from "./machines";
import { acceptFor, BINARY, CLOSE, encodeFrame, FrameReader, PING, PONG, PVE_PING, sized, TEXT, typed } from "./wsframe";
import { cleanFingerprint, cleanUrl, failed, GUEST_RE, guestOfMachine as findGuest, guestRights, mayPath, POWER, readConfig, readResources, readTask, SECRET_RE, SNAPSHOT_RE, snapshotName, TOKEN_RE, trouble, clientLine, hostKeysIn, nextId, readNewGuest, setupScript, type NewOptions, type Guest, type GuestConfig, type Permissions, type PveItem, type Resource, type Task, type Watched } from "./pve";

const FILE = join(SECRETS_DIR, "proxmox.json");
const ID_RE = /^[a-f0-9]{8}$/;
const TIMEOUT_MS = 15_000;
const RESOURCES_MS = 20_000;
const TASKS_MS = 60_000;
const CONFIGS_MS = 10 * 60_000;
const DISKS_MS = 30 * 60_000;
/** How long a request that starts a task waits for it before answering "still going" */
const WAIT_MS = 25_000;
const NAME_MAX = 40;

export interface Host {
  id: string;
  name: string;
  /** `https://192.168.1.10:8006` */
  url: string;
  /** `user@realm!name` */
  token: string;
  secret: string;
  /** The certificate confirmed by the person; null — one a system authority vouches for */
  fingerprint: string | null;
  /** The numbers new guests made here take: a range the person keeps for Hata */
  ids?: { from: number; to: number };
  added: number;
  by: string;
}

interface State {
  hosts: Host[];
  /** Which guest each machine of Hata's was found to be: kept, because a machine that is off has no address to be found by */
  links: Record<string, { host: string; guest: string }>;
}

const state: State = readJsonFile<State>(FILE, { hosts: [], links: {} }, (v) => typeof v === "object" && v !== null && Array.isArray((v as State).hosts));
state.links ??= {};
const save = () => writeJsonAtomic(FILE, state);

// --- Talking to the server --------------------------------------------------------------------------

/** What a server answered: the certificate it showed, whether a system authority vouches for it */
interface Shown {
  fingerprint: string;
  trusted: boolean;
  subject: string;
  issuer: string;
}

function reach(url: string): Promise<{ socket: TLSSocket; shown: Shown }> {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: Number(u.port || 443), servername: /^[\d.]+$|:/.test(host) ? undefined : host, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ socket, shown: { fingerprint: cleanFingerprint(cert.fingerprint256) ?? "", trusted: socket.authorized, subject: String(cert.subject?.CN ?? ""), issuer: String(cert.issuer?.CN ?? cert.issuer?.O ?? "") } });
    });
    socket.once("timeout", () => (socket.destroy(), reject(new AppError("pve.unreachable", 502, { message: "timeout" }))));
    socket.once("error", (e: NodeJS.ErrnoException) => reject(new AppError("pve.unreachable", 502, { message: e.code ?? e.message })));
  });
}

function auth(h: Caller, method: string): Record<string, string> {
  if (h.ticket) return { Cookie: `PVEAuthCookie=${encodeURIComponent(h.ticket)}`, ...(method !== "GET" && h.csrf ? { CSRFPreventionToken: h.csrf } : {}) };
  if (h.token) return { Authorization: `PVEAPIToken=${h.token}=${h.secret}` };
  return {};
}

/**
 * One request to the API. The connection is made first and its certificate judged; only then the
 * token goes out. Proxmox says what went wrong in the status line; its parameter errors come in the body.
 */
/** Who asks: Hata's token, or — only while setting itself up — a person's sign-in, or nobody (the sign-in itself) */
type Caller = Pick<Host, "url" | "fingerprint" | "name"> & { token?: string; secret?: string; ticket?: string; csrf?: string };

async function pve<T>(h: Caller, method: string, path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const { socket, shown } = await reach(h.url);
  const ok = h.fingerprint ? shown.fingerprint === h.fingerprint : shown.trusted;
  if (!ok) {
    socket.destroy();
    throw new AppError("pve.certChanged", 409, { name: h.name, fingerprint: shown.fingerprint });
  }
  const form = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)])).toString() : "";
  const query = form && (method === "GET" || method === "DELETE") ? "?" + form : "";
  const payload = form && !query ? form : "";
  const u = new URL(h.url);
  return new Promise<T>((resolve, reject) => {
    const req = request(
      {
        host: u.hostname,
        port: Number(u.port || 443),
        method,
        path: "/api2/json" + path + query,
        createConnection: () => socket,
        headers: { ...auth(h, method), Accept: "application/json", Connection: "close", ...(payload ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) } : {}) },
        timeout: TIMEOUT_MS,
      } as Parameters<typeof request>[0],
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: { data?: unknown; errors?: Record<string, string> } = {};
          try {
            body = JSON.parse(text);
          } catch {}
          const status = res.statusCode ?? 0;
          const message = [res.statusMessage ?? "", ...Object.entries(body.errors ?? {}).map(([k, v]) => `${k}: ${String(v).trim()}`)].filter(Boolean).join("; ").slice(0, 400);
          if (status === 401) return reject(new AppError(h.token ? "pve.badToken" : "pve.badLogin", 401, { name: h.name }));
          if (status === 403) return reject(new AppError("pve.denied", 403, { name: h.name, message }));
          if (status >= 400 || status === 0) return reject(new AppError("pve.failed", status >= 500 ? 502 : 400, { name: h.name, message: message || String(status) }));
          resolve(body.data as T);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e instanceof AppError ? e : new AppError("pve.unreachable", 502, { name: h.name, message: e.code ?? e.message })));
    if (payload) req.write(payload);
    req.end();
  });
}

// --- What the servers said last ---------------------------------------------------------------------

interface Live extends Watched {
  at: number;
  version: string;
  perms: Permissions;
  /** The pool of each guest: `/cluster/resources` leaves it out where the pool's own rights hide the auditor's */
  pools: Record<number, string>;
  /** When each slower question was asked last */
  asked: { tasks: number; configs: number; disks: number };
  busy: boolean;
}

const live = new Map<string, Live>();

function liveOf(h: Host): Live {
  let l = live.get(h.id);
  if (!l) {
    l = { id: h.id, name: h.name, error: null, nodes: [], guests: [], storages: [], configs: {}, tasks: [], disks: [], unprotected: null, ips: {}, at: 0, version: "", perms: {}, pools: {}, asked: { tasks: 0, configs: 0, disks: 0 }, busy: false };
    live.set(h.id, l);
  }
  l.name = h.name;
  return l;
}

/** Asks one server what is new; the slower questions only when their time has come, or `all` */
async function look(h: Host, all = false): Promise<void> {
  const l = liveOf(h);
  if (l.busy) return;
  l.busy = true;
  const now = Date.now();
  try {
    const resources = await pve<Resource[]>(h, "GET", "/cluster/resources");
    const read = readResources(resources);
    for (const g of read.guests) if (!g.pool && l.pools[g.vmid]) g.pool = l.pools[g.vmid]!;
    const fresh = l.error !== null || !l.at;
    l.nodes = read.nodes;
    l.guests = read.guests;
    l.storages = read.storages;
    l.error = null;
    l.at = now;
    const online = read.nodes.filter((n) => n.online).map((n) => n.name);
    if (all || fresh || now - l.asked.tasks > TASKS_MS) {
      l.asked.tasks = now;
      const tasks = await pve<Record<string, unknown>[]>(h, "GET", "/cluster/tasks").catch(() => null);
      if (tasks) l.tasks = tasks.map(readTask).filter((t): t is Task => t !== null).sort((a, b) => b.start - a.start);
    }
    if (all || fresh || now - l.asked.configs > CONFIGS_MS || read.guests.some((g) => !l.configs[g.id])) {
      l.asked.configs = now;
      if (!l.version) l.version = (await pve<{ version: string }>(h, "GET", "/version").catch(() => null))?.version ?? "";
      l.perms = (await pve<Permissions>(h, "GET", "/access/permissions").catch(() => null)) ?? l.perms;
      // the members of the pools the token has rights in: `/pools?poolid=` answers where `/pools/<id>` is refused
      const pools: Record<number, string> = {};
      for (const pool of Object.keys(l.perms).flatMap((path) => /^\/pool\/([^/]+)$/.exec(path)?.[1] ?? [])) {
        const list = await pve<{ poolid: string; members?: { vmid?: number }[] }[]>(h, "GET", "/pools", { poolid: pool }).catch(() => []);
        for (const p of list) for (const m of p.members ?? []) if (typeof m.vmid === "number") pools[m.vmid] = p.poolid;
      }
      l.pools = pools;
      for (const g of read.guests) if (!g.pool && pools[g.vmid]) g.pool = pools[g.vmid]!;
      const configs: Record<string, GuestConfig> = {};
      for (const g of read.guests) {
        if (!online.includes(g.node)) {
          if (l.configs[g.id]) configs[g.id] = l.configs[g.id]!;
          continue;
        }
        const c = await pve<Record<string, unknown>>(h, "GET", `/nodes/${g.node}/${g.type}/${g.vmid}/config`).catch(() => null);
        if (c) configs[g.id] = readConfig(c);
        else if (l.configs[g.id]) configs[g.id] = l.configs[g.id]!;
      }
      l.configs = configs;
      // what the running containers' cards have now; a virtual machine says it only through its agent
      const ips: Record<string, string[]> = {};
      for (const g of read.guests.filter((x) => x.type === "lxc" && x.status === "running" && online.includes(x.node))) {
        const list = await pve<{ name: string; inet?: string }[]>(h, "GET", `/nodes/${g.node}/lxc/${g.vmid}/interfaces`).catch(() => null);
        if (list) ips[g.id] = list.filter((x) => x.name !== "lo" && x.inet).map((x) => x.inet!.split("/")[0]!);
        else if (l.ips[g.id]) ips[g.id] = l.ips[g.id]!;
      }
      l.ips = ips;
      const left = await pve<{ vmid: number; name?: string; type?: string }[]>(h, "GET", "/cluster/backup-info/not-backed-up").catch(() => null);
      l.unprotected = left ? left.filter((g) => !read.guests.find((x) => x.vmid === g.vmid)?.template).map((g) => ({ vmid: g.vmid, name: g.name ?? "" })) : null;
    }
    if (all || fresh || now - l.asked.disks > DISKS_MS) {
      l.asked.disks = now;
      const disks: Live["disks"] = [];
      for (const node of online) {
        const list = await pve<{ devpath: string; model?: string; health?: string }[]>(h, "GET", `/nodes/${node}/disks/list`).catch(() => null);
        for (const d of list ?? []) disks.push({ node, device: d.devpath, model: d.model ?? "", health: d.health ?? "" });
      }
      l.disks = disks;
    }
  } catch (e) {
    const code = e instanceof AppError ? e.code : "pve.unreachable";
    if (l.error?.code !== code) l.error = { code, since: now };
  } finally {
    l.busy = false;
    bus.publish("proxmox", { id: h.id });
  }
}

/** Keeps every server's picture fresh */
export function startProxmox(): void {
  const tick = () => {
    for (const h of state.hosts) void look(h);
  };
  setTimeout(tick, 5_000).unref?.();
  setInterval(tick, RESOURCES_MS).unref?.();
}

/** What every server is worth on the home page */
export const proxmoxTrouble = (): PveItem[] => state.hosts.flatMap((h) => trouble(liveOf(h)));

/** The guest a machine is: found by its cards or its address while it is connected, remembered for when it is not */
export function guestOfMachine(machine: string, macs: string[], ip: string): { host: string; hostName: string; id: string; type: string; vmid: number; name: string; status: string; node: string; power: boolean } | null {
  let found = findGuest(state.hosts.map(liveOf), macs, ip);
  const kept = state.links[machine];
  if (found && (kept?.host !== found.host || kept.guest !== found.guest.id)) {
    state.links[machine] = { host: found.host, guest: found.guest.id };
    save();
  }
  if (!found && kept) {
    const h = state.hosts.find((x) => x.id === kept.host);
    const g = h && liveOf(h).guests.find((x) => x.id === kept.guest);
    if (g) found = { host: h.id, hostName: h.name, guest: g };
  }
  if (!found) return null;
  const l = liveOf(state.hosts.find((h) => h.id === found.host)!);
  return { host: found.host, hostName: found.hostName, id: found.guest.id, type: found.guest.type, vmid: found.guest.vmid, name: found.guest.name, status: found.guest.status, node: found.guest.node, power: guestRights(l.perms, found.guest).power };
}

// --- For the page -----------------------------------------------------------------------------------

/**
 * The guest this Hata runs in, when it is one of the server's: a container's or a virtual machine's
 * card shows inside it with the address its configuration gives.
 */
function selfOf(l: Live): string | null {
  const own = new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).filter((a) => !a.internal && a.mac && a.mac !== "00:00:00:00:00:00").map((a) => a.mac.toLowerCase())));
  return l.guests.find((g) => l.configs[g.id]?.macs.some((m) => own.has(m)))?.id ?? null;
}

function hostOf(id: string): Host {
  const h = ID_RE.test(id) ? state.hosts.find((x) => x.id === id) : undefined;
  if (!h) throw new AppError("pve.notFound", 404);
  return h;
}

function guestOf(h: Host, guest: string): Guest {
  if (!GUEST_RE.test(guest)) throw new AppError("pve.noGuest", 404);
  const g = liveOf(h).guests.find((x) => x.id === guest);
  if (!g) throw new AppError("pve.noGuest", 404);
  return g;
}

const summary = (h: Host) => {
  const l = liveOf(h);
  return {
    id: h.id,
    name: h.name,
    url: h.url,
    token: h.token,
    ids: h.ids ?? null,
    fingerprint: h.fingerprint,
    online: !l.error && l.at > 0,
    error: l.error,
    self: selfOf(l),
    at: l.at,
    version: l.version,
    nodes: l.nodes,
    counts: { guests: l.guests.filter((g) => !g.template).length, running: l.guests.filter((g) => !g.template && g.status === "running").length },
  };
};

export const hosts = () => state.hosts.map(summary);

/** Everything the page of one server shows */
export function host(id: string) {
  const h = hostOf(id);
  const l = liveOf(h);
  return {
    ...summary(h),
    guests: l.guests.map((g) => ({ ...g, config: l.configs[g.id] ?? null, may: guestRights(l.perms, g) })),
    storages: l.storages.map((s) => ({ ...s, backup: s.content.includes("backup") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace") })),
    tasks: l.tasks.slice(0, 100).map((t) => ({ ...t, failed: failed(t) })),
    disks: l.disks,
    unprotected: l.unprotected,
    trouble: trouble(l),
  };
}

/** Asks the server now, for a page that has just done something */
export async function refresh(id: string): Promise<void> {
  await look(hostOf(id), true);
}

const cleanName = (value: unknown, fallback: string): string => {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX) : "";
  return name || fallback;
};

interface Input {
  ids?: unknown;
  name?: unknown;
  url?: unknown;
  token?: unknown;
  secret?: unknown;
  fingerprint?: unknown;
}

/**
 * Reads what the add dialog sent and tries it. An unknown certificate comes back as
 * `pve.confirmCert` with its fingerprint: the dialog shows it and sends it back once confirmed.
 */
async function tryHost(input: Input, old?: Host): Promise<Omit<Host, "id" | "added" | "by">> {
  const url = cleanUrl(input.url ?? old?.url);
  if (!url) throw new AppError("pve.badUrl");
  const token = typeof input.token === "string" && input.token.trim() ? input.token.trim() : old?.token;
  if (!token || !TOKEN_RE.test(token)) throw new AppError("pve.badTokenId");
  const secret = typeof input.secret === "string" && input.secret.trim() ? input.secret.trim() : old?.secret;
  if (!secret || !SECRET_RE.test(secret)) throw new AppError("pve.badSecret");
  const { socket, shown } = await reach(url);
  socket.destroy();
  let fingerprint: string | null = null;
  if (!shown.trusted) {
    const confirmed = cleanFingerprint(input.fingerprint) ?? (old?.url === url ? old.fingerprint : null);
    if (confirmed !== shown.fingerprint) throw new AppError("pve.confirmCert", 409, { fingerprint: shown.fingerprint, subject: shown.subject, issuer: shown.issuer });
    fingerprint = confirmed;
  }
  const probe = { url, token, secret, fingerprint, name: cleanName(input.name, "Proxmox") };
  await pve(probe, "GET", "/version");
  // the name of the cluster, or of the one node, unless the person gave one
  const status = await pve<{ type: string; name: string }[]>(probe, "GET", "/cluster/status").catch(() => []);
  const fallback = status.find((s) => s.type === "cluster")?.name ?? status.find((s) => s.type === "node")?.name ?? new URL(url).hostname;
  return { ...probe, name: cleanName(input.name, old?.name ?? fallback) };
}

/** A range of numbers for new guests, `{ from, to }`; anything else is none */
function cleanIds(value: unknown): { from: number; to: number } | null {
  if (!value || typeof value !== "object") return null;
  const { from, to } = value as Record<string, unknown>;
  if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 100 || (to as number) < (from as number) || (to as number) > 999_999_999) {
    if (from === undefined || from === null || from === "") return null;
    throw new AppError("pve.badIds");
  }
  return { from: from as number, to: to as number };
}

export async function addHost(input: Input, by: string) {
  const tried = await tryHost(input);
  if (state.hosts.some((h) => h.url === tried.url)) throw new AppError("pve.taken", 409, { name: state.hosts.find((h) => h.url === tried.url)!.name });
  const ids = cleanIds(input.ids);
  const h: Host = { id: Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString("hex"), ...tried, ...(ids ? { ids } : {}), added: Date.now(), by };
  state.hosts.push(h);
  save();
  record("pve.added", { user: by, detail: `${h.name} (${h.url})` });
  await look(h, true);
  return summary(h);
}

/** A new name, a new token, or the server's new certificate confirmed */
export async function changeHost(id: string, input: Input, by: string) {
  const h = hostOf(id);
  const onlyName = input.url === undefined && input.token === undefined && input.secret === undefined && input.fingerprint === undefined;
  if (onlyName) h.name = cleanName(input.name, h.name);
  else Object.assign(h, await tryHost(input, h));
  if (input.ids !== undefined) {
    const ids = cleanIds(input.ids);
    if (ids) h.ids = ids;
    else delete h.ids;
  }
  save();
  record("pve.changed", { user: by, detail: h.name });
  await look(h, true);
  return summary(h);
}

export function removeHost(id: string, by: string): void {
  const h = hostOf(id);
  state.hosts = state.hosts.filter((x) => x.id !== id);
  for (const [m, link] of Object.entries(state.links)) if (link.host === id) delete state.links[m];
  live.delete(id);
  save();
  record("pve.removed", { user: by, detail: h.name });
  bus.publish("proxmox", { id });
}

// --- Doing things -----------------------------------------------------------------------------------

/** Waits for a task to end, up to `ms`; a failed one is an error in Proxmox's words */
async function waitTask(h: Host, node: string, upid: string, ms = WAIT_MS): Promise<{ upid: string; done: boolean }> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await Bun.sleep(1000);
    const s = await pve<Record<string, unknown>>(h, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`).catch(() => null);
    const t = s && readTask({ ...s, upid });
    if (t && t.end !== null) {
      if (failed(t)) throw new AppError("pve.taskFailed", 409, { name: h.name, message: t.status });
      return { upid, done: true };
    }
  }
  return { upid, done: false };
}

const label = (h: Host, g: Guest) => `${g.name} (${g.vmid}, ${h.name})`;

export async function power(id: string, guest: string, action: unknown, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (!(POWER as readonly unknown[]).includes(action)) throw new AppError("request.notFound", 404);
  if (g.type === "lxc" && (action === "suspend" || action === "resume")) throw new AppError("request.notFound", 404);
  const upid = await pve<string>(h, "POST", `/nodes/${g.node}/${g.type}/${g.vmid}/status/${action}`);
  record(`pve.guest.${action}`, { user: by, detail: label(h, g) });
  const result = await waitTask(h, g.node, upid, action === "shutdown" ? 60_000 : WAIT_MS);
  void look(h, true);
  return result;
}

export async function snapshots(id: string, guest: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const list = await pve<{ name: string; description?: string; snaptime?: number; parent?: string; vmstate?: number }[]>(h, "GET", `/nodes/${g.node}/${g.type}/${g.vmid}/snapshot`);
  return list
    .filter((s) => s.name !== "current")
    .map((s) => ({ name: s.name, description: s.description?.trim() ?? "", at: (s.snaptime ?? 0) * 1000, parent: s.parent ?? "", memory: s.vmstate === 1 }))
    .sort((a, b) => b.at - a.at);
}

export async function takeSnapshot(id: string, guest: string, input: { name?: unknown; description?: unknown }, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : snapshotName();
  if (!SNAPSHOT_RE.test(name)) throw new AppError("pve.badSnapshot");
  const description = typeof input.description === "string" ? input.description.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, 500) : "";
  const upid = await pve<string>(h, "POST", `/nodes/${g.node}/${g.type}/${g.vmid}/snapshot`, { snapname: name, ...(description ? { description } : {}) });
  record("pve.snapshot.taken", { user: by, detail: `${label(h, g)}: ${name}` });
  return waitTask(h, g.node, upid, 60_000);
}

export async function snapshotAction(id: string, guest: string, name: string, action: "rollback" | "delete", by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (!SNAPSHOT_RE.test(name)) throw new AppError("pve.badSnapshot");
  const path = `/nodes/${g.node}/${g.type}/${g.vmid}/snapshot/${name}`;
  const upid = action === "rollback" ? await pve<string>(h, "POST", path + "/rollback") : await pve<string>(h, "DELETE", path);
  record(`pve.snapshot.${action === "rollback" ? "rolledBack" : "removed"}`, { user: by, detail: `${label(h, g)}: ${name}` });
  const result = await waitTask(h, g.node, upid, 60_000);
  void look(h, true);
  return result;
}

/** The backups of a guest kept on the storages of its node that are reachable now */
export async function backups(id: string, guest: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const places = liveOf(h).storages.filter((s) => s.node === g.node && s.active && s.content.includes("backup"));
  const out: { volid: string; storage: string; at: number; size: number; notes: string; protected: boolean }[] = [];
  const unreachable: string[] = [];
  for (const s of places) {
    const list = await pve<{ volid: string; ctime?: number; size?: number; notes?: string; protected?: number; vmid?: number }[]>(h, "GET", `/nodes/${g.node}/storage/${s.name}/content`, { content: "backup", vmid: g.vmid }).catch(() => null);
    if (!list) {
      unreachable.push(s.name);
      continue;
    }
    for (const b of list) if (b.vmid === g.vmid) out.push({ volid: b.volid, storage: s.name, at: (b.ctime ?? 0) * 1000, size: b.size ?? 0, notes: b.notes ?? "", protected: b.protected === 1 });
  }
  out.sort((a, b) => b.at - a.at);
  return { backups: out, storages: places.map((s) => s.name), unreachable };
}

/** A backup of one guest now, to a storage of its node; it runs as Proxmox's task, the page follows the tasks */
export async function takeBackup(id: string, guest: string, input: { storage?: unknown }, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const l = liveOf(h);
  // only where the token may write: a storage it may not use would be refused after the request
  const places = l.storages.filter((s) => s.node === g.node && s.active && s.content.includes("backup") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace"));
  const storage = places.find((s) => s.name === input.storage) ?? (input.storage === undefined ? places[0] : undefined);
  if (!storage) throw new AppError("pve.noBackupStorage", 409, { name: h.name });
  const upid = await pve<string>(h, "POST", `/nodes/${g.node}/vzdump`, { vmid: g.vmid, storage: storage.name, mode: "snapshot", compress: "zstd", "notes-template": "{{guestname}} — Hata" });
  record("pve.backup.started", { user: by, detail: `${label(h, g)} → ${storage.name}` });
  void look(h, true);
  return { upid };
}

/** The backup jobs of the server, as its schedule says */
export async function backupJobs(id: string) {
  const h = hostOf(id);
  const jobs = await pve<{ id: string; enabled?: number; schedule?: string; storage?: string; vmid?: string; all?: number; mode?: string; "next-run"?: number; comment?: string; pool?: string; exclude?: string }[]>(h, "GET", "/cluster/backup");
  return jobs.map((j) => ({ id: j.id, enabled: j.enabled !== 0, schedule: j.schedule ?? "", storage: j.storage ?? "", guests: j.all ? "all" : j.pool ? `pool:${j.pool}` : (j.vmid ?? ""), exclude: j.exclude ?? "", mode: j.mode ?? "", next: (j["next-run"] ?? 0) * 1000, comment: j.comment ?? "" }));
}

/** What a task wrote, for its line on the page */
export async function taskLog(id: string, upid: string): Promise<string[]> {
  const h = hostOf(id);
  const node = upid.split(":")[1] ?? "";
  if (!upid.startsWith("UPID:") || !/^[A-Za-z0-9.-]+$/.test(node)) throw new AppError("pve.noTask", 404);
  const lines = await pve<{ n: number; t: string }[]>(h, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/log`, { limit: 1000 });
  return lines.map((l) => l.t);
}

// --- A new container with Hata's client -------------------------------------------------------------

/** What the server offers for a new container: templates, storages, bridges and pools the token may use */
export async function newOptions(id: string): Promise<NewOptions & { next: number | null; offer: boolean }> {
  const h = hostOf(id);
  // what was said in the last minute is fresh enough; the rights and pools come with the slower round
  if (Date.now() - liveOf(h).at > 60_000) await look(h);
  const l = liveOf(h);
  const nodes = l.nodes.filter((n) => n.online).map((n) => n.name);
  const templates: Record<string, string[]> = {};
  const storages: Record<string, string[]> = {};
  const bridges: Record<string, string[]> = {};
  for (const node of nodes) {
    const here = l.storages.filter((s) => s.node === node && s.active);
    templates[node] = [];
    for (const s of here.filter((x) => x.content.includes("vztmpl"))) {
      const list = await pve<{ volid: string }[]>(h, "GET", `/nodes/${node}/storage/${s.name}/content`, { content: "vztmpl" }).catch(() => []);
      templates[node]!.push(...list.map((x) => x.volid));
    }
    storages[node] = here.filter((s) => s.content.includes("rootdir") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace")).map((s) => s.name);
    const nets = await pve<{ iface: string }[]>(h, "GET", `/nodes/${node}/network`, { type: "any_bridge" }).catch(() => []);
    bridges[node] = nets.map((n) => n.iface).filter((b) => mayPath(l.perms, `/sdn/zones/localnetwork/${b}`, "SDN.Use")).sort();
  }
  // a role given on a pool hides the auditor's rights there, and /pools no longer lists it: the token's own rights name it too
  const listed = ((await pve<{ poolid: string }[]>(h, "GET", "/pools").catch(() => [])) ?? []).map((p) => p.poolid);
  const named = Object.keys(l.perms).flatMap((path) => /^\/pool\/([^/]+)$/.exec(path)?.[1] ?? []);
  const pools = [...new Set([...listed, ...named])].filter((p) => mayPath(l.perms, `/pool/${p}`, "VM.Allocate")).sort();
  const free = mayPath(l.perms, "/vms", "VM.Allocate");
  const o: NewOptions = { nodes, templates, storages, bridges, pools, free, ids: h.ids ?? null, taken: l.guests.map((g) => g.vmid) };
  return { ...o, next: nextId(o), offer: free || pools.length > 0 };
}

/** Runs a command, each line of what it prints to the log; the exit code back */
async function logged(cmd: string[], log: Log, input?: string): Promise<number> {
  const proc = Bun.spawn({ cmd, stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe", env: { ...process.env, LC_ALL: "C.UTF-8" } });
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    let rest = "";
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      const parts = (rest + chunk).split(/\r?\n|\r/);
      rest = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) log(line);
    }
    if (rest.trim()) log(rest);
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  return proc.exited;
}

/**
 * A new container on the server, made into a machine of Hata's: Proxmox makes it with a key of
 * Hata's for root, Hata waits for its address, then over SSH installs curl, Docker when asked and
 * the client — with an install line of its own, like a person would — and the key is taken out
 * again. The container's host key cannot be known beforehand: it was made a minute ago on the same
 * network, so it is taken as it comes.
 */
export async function createGuest(id: string, input: Record<string, unknown>, by: string, hata: string) {
  const h = hostOf(id);
  const o = await newOptions(id);
  let g: ReturnType<typeof readNewGuest>;
  try {
    g = readNewGuest(input, o);
  } catch (e) {
    throw new AppError("pve.badField", 400, { field: (e as { field?: string }).field ?? "" });
  }
  if (!Bun.which("ssh") || !Bun.which("ssh-keygen")) throw new AppError("pve.noSsh", 409);
  const job = startJob(`pve:${h.id}:${g.vmid}`, "guest", by, async (log) => {
    const dir = mkdtempSync(join(tmpdir(), "hata-ct-"));
    try {
      const keyFile = join(dir, "key");
      if ((await logged(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "hata-setup", "-f", keyFile], log)) !== 0) throw new AppError("pve.noSsh", 409);
      const key = readFileSync(keyFile + ".pub", "utf8").trim();
      log(`Proxmox ${h.name}: CT ${g.vmid} ${g.hostname}`);
      const made = await pve<string>(h, "POST", `/nodes/${g.node}/lxc`, { ...g.params, "ssh-public-keys": key + "\n" });
      const keys = hostKeysIn(await followTask(h, g.node, made, log, 10 * 60_000));
      await pve(h, "PUT", `/nodes/${g.node}/lxc/${g.vmid}/config`, g.later);
      record("pve.guest.created", { user: by, detail: `${g.hostname} (${g.vmid}, ${h.name})` });
      log("Starting");
      await followTask(h, g.node, await pve<string>(h, "POST", `/nodes/${g.node}/lxc/${g.vmid}/status/start`), log, 2 * 60_000);
      const config = readConfig(await pve<Record<string, unknown>>(h, "GET", `/nodes/${g.node}/lxc/${g.vmid}/config`));
      void look(h, true);
      if (!g.client) return;
      const address = g.address ?? (await addressOf(h, g.node, g.vmid, log));
      log(`Address: ${address}`);
      // the container's keys as it shows them, kept only when they are the ones Proxmox just made
      const known = join(dir, "known_hosts");
      for (let i = 0; ; i++) {
        const scan = Bun.spawnSync({ cmd: ["ssh-keyscan", "-T", "5", address], stdout: "pipe", stderr: "ignore" }).stdout.toString();
        const lines = scan.split("\n").filter((l) => l && !l.startsWith("#"));
        const good = lines.filter((line) => {
          writeFileSync(known + ".one", line + "\n");
          const fp = Bun.spawnSync({ cmd: ["ssh-keygen", "-l", "-f", known + ".one"], stdout: "pipe", stderr: "ignore" }).stdout.toString().split(" ")[1] ?? "";
          return keys.includes(fp);
        });
        if (good.length) {
          writeFileSync(known, good.join("\n") + "\n");
          break;
        }
        if (lines.length && keys.length) throw new AppError("pve.hostKey", 409, { address });
        if (i >= 24) throw new AppError("pve.noSshIn", 409, { address });
        await Bun.sleep(5000);
      }
      const ssh = ["ssh", "-i", keyFile, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${known}`, "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", `root@${address}`];
      const { code } = await invite(by);
      const line = `curl -fsSL ${hata.replace(/\/$/, "")}/client/${code} | sh`;
      const before = new Set(machines().map((m) => m.id));
      if ((await logged([...ssh, "sh", "-s"], log, setupScript(g, line, key))) !== 0) throw new AppError("pve.setupFailed", 409, { address });
      log("Waiting for the machine to connect");
      for (let i = 0; i < 60; i++) {
        // the new machine of this line: the client names itself by the container's host name
        const fresh = machines().find((m) => !before.has(m.id) && (m.info?.hostname === g.hostname || (m.info?.macs ?? []).some((c) => config.macs.includes(c.mac.toLowerCase()))));
        if (fresh) {
          log(`Connected: ${fresh.name}`);
          job.result = { machine: fresh.id };
          return;
        }
        await Bun.sleep(2000);
      }
      throw new AppError("pve.notConnected", 409, { address });
    } catch (e) {
      // the job keeps the code; what Proxmox said goes to the log for the person to read
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    } finally {
      rmSync(dir, { recursive: true, force: true });
      void look(h, true);
    }
  }, true, { app: g.hostname, machine: h.name });
  return { job: job.id, vmid: g.vmid };
}

/** Follows a task to its end, its lines into the log */
async function followTask(h: Host, node: string, upid: string, log: Log, ms: number): Promise<string[]> {
  const until = Date.now() + ms;
  const said: string[] = [];
  let shown = 0;
  for (;;) {
    await Bun.sleep(1500);
    const lines = await pve<{ n: number; t: string }[]>(h, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/log`, { start: shown, limit: 500 }).catch(() => []);
    for (const l of lines) if (l.n > shown) (log(l.t), said.push(l.t), (shown = l.n));
    const s = await pve<Record<string, unknown>>(h, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`).catch(() => null);
    const t = s && readTask({ ...s, upid });
    if (t && t.end !== null) {
      if (failed(t)) throw new AppError("pve.taskFailed", 409, { name: h.name, message: t.status });
      return said;
    }
    if (Date.now() > until) throw new AppError("pve.taskFailed", 409, { name: h.name, message: "timeout" });
  }
}

/** The address a container got from the router, as Proxmox sees it */
async function addressOf(h: Host, node: string, vmid: number, log: Log): Promise<string> {
  log("Waiting for an address from the router");
  for (let i = 0; i < 30; i++) {
    const list = await pve<{ name: string; inet?: string }[]>(h, "GET", `/nodes/${node}/lxc/${vmid}/interfaces`).catch(() => []);
    const ip = list.find((x) => x.name !== "lo" && x.inet)?.inet?.split("/")[0];
    if (ip) return ip;
    await Bun.sleep(2000);
  }
  throw new AppError("pve.noAddress", 409);
}

/** A stopped guest deleted with its disks; the person types its name, so a slip of the mouse cannot do it */
export async function removeGuest(id: string, guest: string, typed: unknown, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (typed !== g.name) throw new AppError("pve.typeName", 400, { name: g.name });
  // Hata would delete itself half-way
  if (selfOf(liveOf(h)) === g.id) throw new AppError("pve.isSelf", 409, { name: g.name });
  // what was said a few seconds ago may be before a shutdown: Proxmox is asked now
  const now = await pve<{ status?: string }>(h, "GET", `/nodes/${g.node}/${g.type}/${g.vmid}/status/current`);
  if (now.status !== "stopped") throw new AppError("pve.stopFirst", 409, { name: g.name });
  const path = `/nodes/${g.node}/${g.type}/${g.vmid}`;
  let result: { upid: string; done: boolean };
  try {
    result = await waitTask(h, g.node, await pve<string>(h, "DELETE", path, { purge: 1, "destroy-unreferenced-disks": 1 }), 60_000);
  } catch (e) {
    // looking for disks it no longer uses, Proxmox asks every storage, and one that is off (a NAS) stops it:
    // the guest's own disks go without that look
    if (!(e instanceof AppError && /is not online|not available|unable to activate/i.test(String(e.detail.message ?? "")))) throw e;
    result = await waitTask(h, g.node, await pve<string>(h, "DELETE", path), 60_000);
  }
  record("pve.guest.removed", { user: by, detail: label(h, g) });
  void look(h, true);
  return result;
}

// --- Set up by a person's sign-in -------------------------------------------------------------------

/** What the token Hata makes for itself may do */
export const LEVELS = ["read", "manage", "pool"] as const;
const POOL = "hata";
const USER = "hata@pve";

/** The roles given to Hata's user, path → role; Proxmox's own roles, so the person recognises them there */
export function rolesFor(level: (typeof LEVELS)[number]): [string, string][] {
  const see: [string, string][] = [["/", "PVEAuditor"]];
  // making a container takes room on a storage and a bridge to plug it into
  const room: [string, string][] = [["/storage", "PVEDatastoreUser"], ["/sdn/zones", "PVESDNUser"]];
  if (level === "read") return see;
  if (level === "pool") return [...see, [`/pool/${POOL}`, "PVEVMAdmin"], ...room];
  return [...see, ["/vms", "PVEVMAdmin"], ...room];
}

/**
 * Adds a server from a person's sign-in: Hata signs in once (a code too when the account has two
 * factors), makes the user `hata@pve` when it is not there, a token of its own for it — named after
 * this Hata, so several can share a server — and its rights, then keeps the token and forgets the
 * password. The token is privilege-separated and given the rights of the level itself, so it may no
 * more than was chosen even when the user already holds more (another Hata, an earlier level).
 */
export async function addBySignIn(input: Input & { user?: unknown; password?: unknown; otp?: unknown; level?: unknown }, by: string) {
  const url = cleanUrl(input.url);
  if (!url) throw new AppError("pve.badUrl");
  if (state.hosts.some((h) => h.url === url)) throw new AppError("pve.taken", 409, { name: state.hosts.find((h) => h.url === url)!.name });
  const level = LEVELS.find((l) => l === input.level) ?? "manage";
  let user = typeof input.user === "string" && input.user.trim() ? input.user.trim() : "root";
  if (!user.includes("@")) user += "@pam";
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(user)) throw new AppError("pve.badUser");
  const password = typeof input.password === "string" ? input.password : "";
  if (!password) throw new AppError("pve.badLogin", 400, { name: url });
  const { socket, shown } = await reach(url);
  socket.destroy();
  let fingerprint: string | null = null;
  if (!shown.trusted) {
    fingerprint = cleanFingerprint(input.fingerprint);
    if (fingerprint !== shown.fingerprint) throw new AppError("pve.confirmCert", 409, { fingerprint: shown.fingerprint, subject: shown.subject, issuer: shown.issuer });
  }
  const bare: Caller = { url, fingerprint, name: new URL(url).hostname };
  let signed = await pve<{ ticket: string; CSRFPreventionToken?: string; NeedTFA?: number }>(bare, "POST", "/access/ticket", { username: user, password });
  if (signed.NeedTFA) {
    const otp = typeof input.otp === "string" ? input.otp.replace(/\s/g, "") : "";
    if (!/^\d{6,8}$/.test(otp)) throw new AppError("pve.needOtp", 409);
    signed = await pve(bare, "POST", "/access/ticket", { username: user, "tfa-challenge": signed.ticket, password: `totp:${otp}` }).catch((e) => {
      throw e instanceof AppError && e.code === "pve.badLogin" ? new AppError("pve.badOtp", 401) : e;
    });
  }
  const as: Caller = { ...bare, ticket: signed.ticket, csrf: signed.CSRFPreventionToken };
  const users = await pve<{ userid: string }[]>(as, "GET", "/access/users");
  if (!users.some((u) => u.userid === USER)) await pve(as, "POST", "/access/users", { userid: USER, comment: "Hata" });
  if (level === "pool") {
    const pools = await pve<{ poolid: string }[]>(as, "GET", "/pools");
    if (!pools.some((p) => p.poolid === POOL)) await pve(as, "POST", "/pools", { poolid: POOL, comment: "Guests Hata looks after" });
  }
  const tokenId = `hata-${Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex")}`;
  const made = await pve<{ value: string; "full-tokenid": string }>(as, "POST", `/access/users/${encodeURIComponent(USER)}/token/${tokenId}`, { privsep: 1, comment: `Hata (${level})` });
  // a separated token may what both it and its user are given
  for (const [path, role] of rolesFor(level)) await pve(as, "PUT", "/access/acl", { path, roles: role, users: USER, tokens: made["full-tokenid"], propagate: 1 });
  const tried = await tryHost({ url, token: made["full-tokenid"], secret: made.value, fingerprint: fingerprint ?? undefined, name: input.name });
  const ids = cleanIds(input.ids);
  const h: Host = { id: Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString("hex"), ...tried, ...(ids ? { ids } : {}), added: Date.now(), by };
  state.hosts.push(h);
  save();
  record("pve.added", { user: by, detail: `${h.name} (${h.url}, ${made["full-tokenid"]})` });
  await look(h, true);
  return summary(h);
}

// --- A container's console ----------------------------------------------------------------------------

/** A console of a guest as Proxmox serves it: what it prints comes to `onData`, what is typed goes in */
export interface Console {
  send(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onData: (bytes: Uint8Array) => void;
  onClose: (why: string) => void;
}

/**
 * Opens a container's console: `termproxy` starts one, its WebSocket is reached over a connection whose
 * certificate was checked like every other request, and the first line hands the console's ticket in.
 * Proxmox's own page talks the same way: `0:<bytes>:<data>` typed, `1:<cols>:<rows>:` a size, `2` alive.
 */
export async function openConsole(id: string, guest: string, cols: number, rows: number): Promise<Console> {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (g.type !== "lxc") throw new AppError("pve.noConsole", 409);
  if (g.status !== "running") throw new AppError("pve.notRunning", 409, { name: g.name });
  const proxy = await pve<{ port: number | string; ticket: string; user: string }>(h, "POST", `/nodes/${g.node}/lxc/${g.vmid}/termproxy`);
  const { socket, shown } = await reach(h.url);
  if (h.fingerprint ? shown.fingerprint !== h.fingerprint : !shown.trusted) {
    socket.destroy();
    throw new AppError("pve.certChanged", 409, { name: h.name, fingerprint: shown.fingerprint });
  }
  const u = new URL(h.url);
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const path = `/api2/json/nodes/${g.node}/lxc/${g.vmid}/vncwebsocket?port=${encodeURIComponent(String(proxy.port))}&vncticket=${encodeURIComponent(proxy.ticket)}`;
  socket.write([`GET ${path} HTTP/1.1`, `Host: ${u.host}`, "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", "Sec-WebSocket-Protocol: binary", `Authorization: PVEAPIToken=${h.token}=${h.secret}`, "", ""].join("\r\n"));
  const reader = new FrameReader();
  const accept = await acceptFor(key);
  let head = Buffer.alloc(0);
  let open = false;
  let closed = false;
  const con: Console = {
    send: (bytes) => !closed && socket.write(encodeFrame(BINARY, typed(bytes))),
    resize: (c, r) => !closed && socket.write(encodeFrame(BINARY, new TextEncoder().encode(sized(c, r)))),
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(alive);
      socket.end(encodeFrame(CLOSE, new Uint8Array(0)));
      socket.destroy();
    },
    onData: () => {},
    onClose: () => {},
  };
  const alive = setInterval(() => !closed && socket.write(encodeFrame(BINARY, new TextEncoder().encode(PVE_PING))), 30_000);
  const end = (why: string) => {
    if (closed) return;
    closed = true;
    clearInterval(alive);
    socket.destroy();
    con.onClose(why);
  };
  await new Promise<void>((resolve, reject) => {
    let said = false;
    socket.on("data", (chunk: Buffer) => {
      if (!open) {
        head = Buffer.concat([head, chunk]);
        const at = head.indexOf("\r\n\r\n");
        if (at < 0) return;
        const lines = head.subarray(0, at).toString("latin1").split("\r\n");
        const status = Number(lines[0]?.split(" ")[1]);
        const ok = status === 101 && lines.some((l) => /^sec-websocket-accept:\s*/i.test(l) && l.split(":")[1]!.trim() === accept);
        if (!ok) return reject(new AppError(status === 401 ? "pve.badToken" : "pve.failed", 409, { name: h.name, message: lines[0] ?? "" }));
        open = true;
        // the console's own sign-in: its user and the ticket termproxy gave
        socket.write(encodeFrame(BINARY, new TextEncoder().encode(`${proxy.user}:${proxy.ticket}\n`)));
        chunk = head.subarray(at + 4);
        if (!chunk.length) return;
      }
      for (const f of reader.push(new Uint8Array(chunk))) {
        if (f.opcode === CLOSE) return end("closed");
        if (f.opcode === PING) socket.write(encodeFrame(PONG, f.data));
        else if (f.opcode === TEXT || f.opcode === BINARY) {
          // the first word is "OK" when the ticket was taken
          if (!said) {
            said = true;
            const text = new TextDecoder().decode(f.data);
            if (text.startsWith("OK")) {
              con.resize(cols, rows);
              resolve();
              if (f.data.length > 2) con.onData(f.data.subarray(2));
              continue;
            }
            return reject(new AppError("pve.failed", 409, { name: h.name, message: text.slice(0, 200) }));
          }
          con.onData(f.data);
        }
      }
    });
    socket.on("close", () => (open ? end("closed") : reject(new AppError("pve.unreachable", 502, { name: h.name, message: "closed" }))));
    socket.on("error", (e: Error) => (open ? end(e.message) : reject(new AppError("pve.unreachable", 502, { name: h.name, message: e.message }))));
    setTimeout(() => reject(new AppError("pve.unreachable", 502, { name: h.name, message: "timeout" })), TIMEOUT_MS);
  });
  return con;
}

/** What a console printed, as lines for a job's log: colours and cursor moves taken out */
const plain = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, "").replace(/\r/g, "");

/**
 * Hata's client put on a running container through its console: Hata signs in there as root with the
 * password the person gives (typed into the console, kept nowhere), types the line and follows it to
 * its end. Proxmox's "shell" console mode would need no password, but on a running container a change
 * of it waits for a restart.
 */
export async function installByConsole(id: string, guest: string, input: { password?: unknown }, by: string, hata: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const l = liveOf(h);
  const may = guestRights(l.perms, g);
  if (g.type !== "lxc") throw new AppError("pve.noConsole", 409);
  if (g.status !== "running") throw new AppError("pve.notRunning", 409, { name: g.name });
  if (!may.console) throw new AppError("pve.denied", 403, { name: h.name, message: "VM.Console" });
  const password = typeof input.password === "string" ? input.password : "";
  if (!password || /[\r\n]/.test(password)) throw new AppError("pve.badRootPassword", 400, { name: g.name });
  const config = await pve<Record<string, unknown>>(h, "GET", `/nodes/${g.node}/lxc/${g.vmid}/config`);
  const os = typeof config.ostype === "string" ? config.ostype : "";
  const { code } = await invite(by);
  const line = clientLine(os, hata, code);
  if (!line) throw new AppError("pve.noClientHere", 409, { os });
  const before = new Set(machines().map((m) => m.id));
  const job = startJob(`pve:${h.id}:${g.vmid}`, "client", by, async (log) => {
    const con = await openConsole(id, guest, 160, 40);
    const type = (text: string) => con.send(new TextEncoder().encode(text));
    let screen = "";
    const shown = () => screen.replace(password, "***");
    try {
      let pending = "";
      let quiet = true;
      let wake: () => void = () => {};
      con.onData = (bytes) => {
        const text = plain(new TextDecoder().decode(bytes));
        screen += text;
        if (!quiet) {
          const parts = (pending + text).split("\n");
          pending = parts.pop() ?? "";
          for (const p of parts) if (p.trim() && !/HATA-[0-9a-f]{6}/.test(p)) log(p);
        }
        wake();
      };
      let gone = false;
      con.onClose = () => ((gone = true), wake());
      /** Waits for what the console shows to match, up to `ms`; the screen is read from `from` on */
      const until = async (re: RegExp, ms: number, from = 0): Promise<RegExpExecArray | null> => {
        const end = Date.now() + ms;
        for (;;) {
          const m = re.exec(screen.slice(from));
          if (m || gone || Date.now() > end) return m;
          await Promise.race([new Promise<void>((r) => (wake = r)), Bun.sleep(500)]);
        }
      };
      // the console shows its last screen or nothing: Enter brings the sign-in back
      let mark0 = screen.length;
      type("\r");
      let first = await until(/login:\s*$|Password:\s*$|[#$]\s*$/m, 15_000, mark0);
      // a sign-in left half-way (by somebody, or by that Enter): an empty password ends it
      if (first && first[0].startsWith("Password")) {
        mark0 = screen.length;
        type("\r");
        first = await until(/login:\s*$/m, 15_000, mark0);
      }
      if (!first) throw new AppError("pve.consoleSilent", 409, { name: g.name });
      if (!/[#]\s*$/.test(first[0])) {
        let mark = screen.length;
        type("root\r");
        if (!(await until(/Password:\s*$/m, 10_000, mark))) throw new AppError("pve.consoleSilent", 409, { name: g.name });
        mark = screen.length;
        type(password + "\r");
        const after = await until(/Login incorrect|#\s*$/m, 15_000, mark);
        if (!after || after[0].startsWith("Login")) throw new AppError("pve.badRootPassword", 400, { name: g.name });
      }
      log(`Signed in to ${g.name}`);
      quiet = false;
      const marker = `HATA-${Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex")}`;
      const mark = screen.length;
      type(`${line}; echo ${marker}-$?\r`);
      const end = await until(new RegExp(`${marker}-(\\d+)`), 15 * 60_000, mark);
      if (!end || Number(end[1]) !== 0) throw new AppError("pve.setupFailed", 409, { address: g.name });
      // the sign-in ends with the work
      type("exit\r");
      await Bun.sleep(500);
    } catch (e) {
      // what the console showed last says why better than any word of Hata's
      for (const line of plain(shown()).split("\n").map((x) => x.trim()).filter(Boolean).slice(-6)) log("> " + line);
      throw e;
    } finally {
      con.close();
    }
    log("Waiting for the machine to connect");
    for (let i = 0; i < 45; i++) {
      const fresh = machines().find((m) => !before.has(m.id));
      if (fresh) {
        log(`Connected: ${fresh.name}`);
        job.result = { machine: fresh.id };
        record("pve.client.installed", { user: by, detail: `${g.name} (${g.vmid}, ${h.name})` });
        return;
      }
      await Bun.sleep(2000);
    }
    throw new AppError("pve.notConnected", 409, { address: g.name });
  }, true, { app: g.name, machine: h.name });
  return { job: job.id };
}
