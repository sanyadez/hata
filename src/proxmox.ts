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
import { request } from "node:https";
import { connect, type TLSSocket } from "node:tls";
import { join } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { bus } from "./bus";
import { SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { cleanFingerprint, cleanUrl, failed, GUEST_RE, guestOfMacs, guestRights, mayPath, POWER, readConfig, readResources, readTask, SECRET_RE, SNAPSHOT_RE, snapshotName, TOKEN_RE, trouble, type Guest, type GuestConfig, type Permissions, type PveItem, type Resource, type Task, type Watched } from "./pve";

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
  added: number;
  by: string;
}

interface State {
  hosts: Host[];
}

const state: State = readJsonFile<State>(FILE, { hosts: [] }, (v) => typeof v === "object" && v !== null && Array.isArray((v as State).hosts));
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

/**
 * One request to the API. The connection is made first and its certificate judged; only then the
 * token goes out. Proxmox says what went wrong in the status line; its parameter errors come in the body.
 */
async function pve<T>(h: Pick<Host, "url" | "token" | "secret" | "fingerprint" | "name">, method: string, path: string, params?: Record<string, string | number | boolean>): Promise<T> {
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
        headers: { Authorization: `PVEAPIToken=${h.token}=${h.secret}`, Accept: "application/json", Connection: "close", ...(payload ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) } : {}) },
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
          if (status === 401) return reject(new AppError("pve.badToken", 401, { name: h.name }));
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
  /** When each slower question was asked last */
  asked: { tasks: number; configs: number; disks: number };
  busy: boolean;
}

const live = new Map<string, Live>();

function liveOf(h: Host): Live {
  let l = live.get(h.id);
  if (!l) {
    l = { id: h.id, name: h.name, error: null, nodes: [], guests: [], storages: [], configs: {}, tasks: [], disks: [], unprotected: null, at: 0, version: "", perms: {}, asked: { tasks: 0, configs: 0, disks: 0 }, busy: false };
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

/** The guest a machine is, found by its network cards */
export function guestOfMachine(macs: string[]): { host: string; hostName: string; id: string; vmid: number; name: string; status: string; node: string; power: boolean } | null {
  const found = guestOfMacs(state.hosts.map(liveOf), macs);
  if (!found) return null;
  const l = liveOf(state.hosts.find((h) => h.id === found.host)!);
  return { host: found.host, hostName: found.hostName, id: found.guest.id, vmid: found.guest.vmid, name: found.guest.name, status: found.guest.status, node: found.guest.node, power: guestRights(l.perms, found.guest).power };
}

// --- For the page -----------------------------------------------------------------------------------

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
    fingerprint: h.fingerprint,
    online: !l.error && l.at > 0,
    error: l.error,
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

export async function addHost(input: Input, by: string) {
  const tried = await tryHost(input);
  if (state.hosts.some((h) => h.url === tried.url)) throw new AppError("pve.taken", 409, { name: state.hosts.find((h) => h.url === tried.url)!.name });
  const h: Host = { id: Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString("hex"), ...tried, added: Date.now(), by };
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
  save();
  record("pve.changed", { user: by, detail: h.name });
  await look(h, true);
  return summary(h);
}

export function removeHost(id: string, by: string): void {
  const h = hostOf(id);
  state.hosts = state.hosts.filter((x) => x.id !== id);
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
