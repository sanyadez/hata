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
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { cleanFingerprint, cleanUrl, failed, GUEST_RE, guestOfMachine as findGuest, guestRights, mayPath, POWER, readConfig, readResources, readTask, SECRET_RE, SNAPSHOT_RE, snapshotName, TOKEN_RE, trouble, clientLine, hostKeysIn, nextId, readNewGuest, readSettings, restoreParams, cloneParams, readVersions, readContent, type Versions, type Volume, settingsChange, cleanSchedule, readRrd, TIMEFRAMES, archOf, readOffered, TEMPLATE_RE, type Offered, dayOf, scheduleDue, scheduled, toPrune, SCHEDULE_MARK, type Schedule, setupScript, gibOf, cloudImages, sumFor, uploadName, readNewVm, vmSetupLine, ISO_RE, IMPORT_RE, type CloudImage, type NewVm, type NewVmOptions, type UploadKind, type NewOptions, type SettingsChange, type Guest, type GuestConfig, type Permissions, type PveItem, type Resource, type Task, type Watched } from "./pve";

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
  /** Hata's own schedule of backups for this server's guests */
  schedule?: Schedule;
  /** The day it last ran, and how */
  ran?: string;
  last?: { at: number; ok: boolean; guests: number; pruned: number; message: string; /** Proxmox's backup task ran: its failure is its own item */ task?: boolean };
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
  /** Each node's versions, and how many packages of the whole system have updates (null — the token may not ask) */
  versions: Record<string, Versions & { all: number | null }>;
  /** When each slower question was asked last */
  asked: { tasks: number; configs: number; disks: number };
  busy: boolean;
}

const live = new Map<string, Live>();

function liveOf(h: Host): Live {
  let l = live.get(h.id);
  if (!l) {
    l = { id: h.id, name: h.name, error: null, nodes: [], guests: [], storages: [], configs: {}, tasks: [], disks: [], unprotected: null, ips: {}, at: 0, version: "", perms: {}, pools: {}, versions: {}, asked: { tasks: 0, configs: 0, disks: 0 }, busy: false };
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
      // the guests Hata's own schedule backs up are not left out
      const ours = h.schedule?.on ? scheduled(h.schedule, mayBackUp(read.guests, l.perms)) : [];
      l.unprotected = left ? left.filter((g) => !read.guests.find((x) => x.vmid === g.vmid)?.template && !ours.includes(g.vmid)).map((g) => ({ vmid: g.vmid, name: g.name ?? "" })) : null;
    }
    if (all || fresh || now - l.asked.disks > DISKS_MS) {
      l.asked.disks = now;
      const disks: Live["disks"] = [];
      for (const node of online) {
        const list = await pve<{ devpath: string; model?: string; health?: string }[]>(h, "GET", `/nodes/${node}/disks/list`).catch(() => null);
        for (const d of list ?? []) disks.push({ node, device: d.devpath, model: d.model ?? "", health: d.health ?? "" });
      }
      l.disks = disks;
      // versions and updates: as slow to change as the disks' health
      for (const node of online) {
        const list = await pve<Record<string, unknown>[]>(h, "GET", `/nodes/${node}/apt/versions`).catch(() => null);
        if (!list) continue;
        // the whole system's list needs Sys.Modify on the node: most tokens get a refusal, and that is fine
        const all = await pve<unknown[]>(h, "GET", `/nodes/${node}/apt/update`).catch(() => null);
        l.versions[node] = { ...readVersions(list), all: all ? all.length : null };
      }
    }
  } catch (e) {
    const code = e instanceof AppError ? e.code : "pve.unreachable";
    if (l.error?.code !== code) l.error = { code, since: now };
  } finally {
    l.busy = false;
    bus.publish("proxmox", { id: h.id });
  }
}

/** Keeps every server's picture fresh, and runs Hata's schedules of backups when their time comes */
/**
 * What a question about rights needs: what was said in the last minute, with the rights read. Right after
 * a start the first round may still be on its way (then it is waited for) and the rights come with it.
 */
async function readNow(h: Host): Promise<void> {
  for (let i = 0; i < 120 && liveOf(h).busy; i++) await Bun.sleep(250);
  const l = liveOf(h);
  if (Date.now() - l.at > 60_000 || !Object.keys(l.perms).length) await look(h, !Object.keys(l.perms).length);
}

export function startProxmox(): void {
  const tick = () => {
    for (const h of state.hosts) void look(h);
  };
  setTimeout(tick, 5_000).unref?.();
  setInterval(tick, RESOURCES_MS).unref?.();
  setInterval(() => {
    for (const h of state.hosts) {
      if (!scheduleDue(h.schedule, h.ran, new Date())) continue;
      h.ran = dayOf(new Date());
      save();
      try {
        runSchedule(h, "schedule");
      } catch {
        // a run still going (started by hand) is this day's run
      }
    }
  }, 60_000).unref?.();
}

// --- Hata's own schedule of backups ----------------------------------------------------------------------

/** The guests the token may back up: what "all" means for a schedule */
const mayBackUp = (guests: Guest[], perms: Permissions): number[] => guests.filter((g) => !g.template && guestRights(perms, g).backup).map((g) => g.vmid);

/** The storages a schedule may write to: holding backups, on every node, where the token may write */
function scheduleStorages(h: Host): string[] {
  const l = liveOf(h);
  return [...new Set(l.storages.filter((s) => s.content.includes("backup") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace")).map((s) => s.name))].sort();
}

export function setSchedule(id: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  let schedule: Schedule;
  try {
    schedule = cleanSchedule(input, scheduleStorages(h));
  } catch (e) {
    throw new AppError(`pve.schedule.${(e as { field?: string }).field ?? "time"}`, 400);
  }
  const was = h.schedule;
  h.schedule = schedule;
  // a schedule moved to a later hour today still runs today
  if (!was || was.time !== schedule.time) delete h.ran;
  save();
  record(schedule.on ? "pve.schedule.set" : "pve.schedule.off", { user: by, detail: schedule.on ? `${h.name}: ${schedule.time} → ${schedule.storage}` : h.name });
  void look(h, true);
  return { schedule, storages: scheduleStorages(h) };
}

export function runScheduleNow(id: string, by: string) {
  const h = hostOf(id);
  if (!h.schedule?.storage) throw new AppError("pve.schedule.storage", 400);
  return { job: runSchedule(h, by).id };
}

/**
 * One run: a backup of every scheduled guest, node by node (one task per node), then the schedule's own
 * copies beyond `keep` deleted. A guest that failed keeps all its copies: the newest might be the broken one.
 */
function runSchedule(h: Host, by: string) {
  const s = h.schedule!;
  return startJob(`pve:${h.id}:schedule`, "backup", by, async (log) => {
    const l = liveOf(h);
    const guests = l.guests.filter((g) => scheduled(s, mayBackUp(l.guests, l.perms)).includes(g.vmid));
    let failedOnes: string[] = [];
    let pruned = 0;
    let message = "";
    let task = false;
    try {
      if (!guests.length) throw new AppError("pve.schedule.nothing", 409, { name: h.name });
      const nodes = [...new Set(guests.map((g) => g.node))];
      for (const node of nodes) {
        const here = guests.filter((g) => g.node === node);
        log(`${h.name} / ${node}: ${here.map((g) => `${g.name} (${g.vmid})`).join(", ")} → ${s.storage}`);
        const upid = await pve<string>(h, "POST", `/nodes/${node}/vzdump`, { vmid: here.map((g) => g.vmid).join(","), storage: s.storage, mode: "snapshot", compress: "zstd", "notes-template": `{{guestname}} ${SCHEDULE_MARK}` });
        task = true;
        try {
          await followTask(h, node, upid, log, 6 * 3600_000);
        } catch (e) {
          // which guests failed: their lines say "ERROR: Backup of VM <id> failed"
          const lines = await taskLog(h.id, upid).catch(() => []);
          const bad = here.filter((g) => lines.some((line) => new RegExp(`Backup of VM ${g.vmid} failed`).test(line)));
          failedOnes.push(...(bad.length ? bad : here).map((g) => `${g.name} (${g.vmid})`));
          message = e instanceof AppError ? String(e.detail.message ?? e.code) : String(e);
        }
        const content = await pve<{ volid: string; vmid?: number; ctime?: number; notes?: string; protected?: number }[]>(h, "GET", `/nodes/${node}/storage/${s.storage}/content`, { content: "backup" }).catch(() => []);
        const keepAll = new Set(failedOnes);
        const list = content.filter((b) => here.some((g) => g.vmid === b.vmid && !keepAll.has(`${g.name} (${g.vmid})`))).map((b) => ({ volid: b.volid, vmid: b.vmid!, at: (b.ctime ?? 0) * 1000, notes: b.notes ?? "", protected: b.protected === 1 }));
        for (const volid of toPrune(list, s.keep)) {
          try {
            const upid = await pve<string | null>(h, "DELETE", `/nodes/${node}/storage/${s.storage}/content/${encodeURIComponent(volid)}`);
            if (typeof upid === "string" && upid.startsWith("UPID:")) await waitTask(h, node, upid, 60_000);
            log(`Deleted the older copy ${volid}`);
            pruned++;
          } catch (e) {
            log(`Could not delete ${volid}: ${e instanceof AppError ? String(e.detail.message ?? e.code) : String(e)}`);
          }
        }
      }
    } catch (e) {
      message = e instanceof AppError ? String(e.detail.message ?? e.code) : String(e);
      failedOnes = guests.map((g) => `${g.name} (${g.vmid})`);
      if (!guests.length) failedOnes = [h.name];
    } finally {
      h.last = { at: Date.now(), ok: !failedOnes.length, task, guests: guests.length, pruned, message: failedOnes.length ? `${failedOnes.join(", ")}: ${message}` : "" };
      save();
      record(failedOnes.length ? "pve.schedule.failed" : "pve.schedule.ran", { user: by, detail: failedOnes.length ? `${h.name}: ${failedOnes.join(", ")}` : `${h.name}: ${guests.length} → ${s.storage}` });
      void look(h, true);
    }
    if (failedOnes.length) throw new AppError("pve.schedule.failedRun", 409, { name: h.name, message: h.last.message });
  }, true, { app: h.name, machine: "" });
}

/** What every server is worth on the home page */
export const proxmoxTrouble = (): PveItem[] =>
  state.hosts.flatMap((h) => [
    ...trouble(liveOf(h)),
    // a run that failed before Proxmox's task: a failed task is an item of its own already
    ...(h.schedule?.on && h.last && !h.last.ok && !h.last.task ? [{ id: `pve:${h.id}:schedule`, severity: "danger" as const, code: "pve.scheduleFailed", detail: { host: h.id, name: h.name, message: h.last.message.slice(0, 200) }, at: h.last.at }] : []),
  ]);

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
    versions: l.versions,
    unprotected: l.unprotected,
    schedule: h.schedule ?? null,
    scheduleStorages: scheduleStorages(h),
    last: h.last ?? null,
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

/** What the settings dialog shows: the guest's settings now, and what waits for a restart to take effect */
export async function guestSettings(id: string, guest: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const path = `/nodes/${g.node}/${g.type}/${g.vmid}`;
  const [config, pending] = await Promise.all([pve<Record<string, unknown>>(h, "GET", path + "/config"), pve<{ key: string; pending?: unknown; delete?: number }[]>(h, "GET", path + "/pending").catch(() => [])]);
  return { settings: readSettings(config, g.type), pending: pendingOf(pending), may: guestRights(liveOf(h).perms, g), running: g.status === "running" };
}

/** The keys whose new value Proxmox keeps until the guest is restarted */
const pendingOf = (list: { key: string; pending?: unknown; delete?: number }[]): string[] => list.filter((p) => p.pending !== undefined || p.delete).map((p) => p.key);

const NEEDS: Record<SettingsChange["needs"][number], keyof ReturnType<typeof guestRights>> = { cpu: "cpu", memory: "memory", disk: "disk", options: "configure" };

/**
 * Changes a guest's settings: what differs goes to `/config` in one request (with the digest of the
 * configuration read, so a change made meanwhile in Proxmox is not overwritten), then each disk that
 * grows. A running guest takes some at once; what it takes after a restart comes back as `pending`.
 */
export async function changeGuest(id: string, guest: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const path = `/nodes/${g.node}/${g.type}/${g.vmid}`;
  const config = await pve<Record<string, unknown>>(h, "GET", path + "/config");
  let change: SettingsChange;
  try {
    change = settingsChange(readSettings(config, g.type), input, g.type);
  } catch (e) {
    throw new AppError(`pve.setting.${(e as { field?: string }).field ?? "name"}`, 400);
  }
  const may = guestRights(liveOf(h).perms, g);
  const refused = change.needs.filter((n) => !may[NEEDS[n]]);
  if (refused.length) throw new AppError("pve.mayNot", 403, { name: h.name, guest: g.name, what: refused.join(", ") });
  const said: string[] = [];
  if (Object.keys(change.params).length || change.remove.length) {
    const params: Record<string, string | number> = { ...change.params, ...(change.remove.length ? { delete: change.remove.join(",") } : {}) };
    if (typeof config.digest === "string") params.digest = config.digest;
    await pve(h, "PUT", path + "/config", params);
    said.push(...Object.keys(change.params), ...change.remove);
  }
  for (const d of change.grow) {
    const upid = await pve<string | null>(h, "PUT", path + "/resize", { disk: d.disk, size: d.size });
    if (typeof upid === "string" && upid.startsWith("UPID:")) await waitTask(h, g.node, upid, 60_000);
    said.push(`${d.disk} → ${d.size}`);
  }
  if (said.length) record("pve.guest.changed", { user: by, detail: `${label(h, g)}: ${said.join(", ")}` });
  void look(h, true);
  const pending = pendingOf(await pve<{ key: string; pending?: unknown; delete?: number }[]>(h, "GET", path + "/pending").catch(() => []));
  return { changed: said, pending, settings: readSettings(await pve<Record<string, unknown>>(h, "GET", path + "/config"), g.type) };
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

/** What the restore dialog offers for a guest's backup: where its disks may go, the next free number, the pools */
export async function restoreOptions(id: string, guest: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const l = liveOf(h);
  const config = await pve<Record<string, unknown>>(h, "GET", `/nodes/${g.node}/${g.type}/${g.vmid}/config`).catch(() => ({}));
  const storages = l.storages.filter((s) => s.node === g.node && s.active && s.content.includes(g.type === "lxc" ? "rootdir" : "images") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace")).map((s) => s.name);
  const listed = ((await pve<{ poolid: string }[]>(h, "GET", "/pools").catch(() => [])) ?? []).map((p) => p.poolid);
  const named = Object.keys(l.perms).flatMap((path) => /^\/pool\/([^/]+)$/.exec(path)?.[1] ?? []);
  const pools = [...new Set([...listed, ...named])].filter((p) => mayPath(l.perms, `/pool/${p}`, "VM.Allocate")).sort();
  const free = mayPath(l.perms, "/vms", "VM.Allocate");
  return {
    storages,
    // where its disks lie now: what a restore over it keeps
    storage: readSettings(config, g.type).disks[0]?.storage ?? storages[0] ?? "",
    next: nextId({ ids: h.ids ?? null, taken: l.guests.map((x) => x.vmid) }),
    ids: h.ids ?? null,
    pools,
    pool: g.pool,
    free,
    self: selfOf(l) === g.id,
  };
}

/**
 * Puts a guest's backup back — over the guest (stopped, its name typed: what it has now is lost) or as a
 * new guest with new network cards. Proxmox's task takes minutes, so it is a job; its lines are the log.
 */
export async function restoreBackup(id: string, guest: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const l = liveOf(h);
  const { backups: list } = await backups(id, guest);
  const backup = list.find((b) => b.volid === input.volid);
  if (!backup) throw new AppError("pve.noBackup", 404);
  const o = await restoreOptions(id, guest);
  const replace = input.replace === true;
  let vmid = g.vmid;
  let pool = "";
  if (replace) {
    if (input.name !== g.name) throw new AppError("pve.typeName", 400, { name: g.name });
    if (o.self) throw new AppError("pve.isSelfRestore", 409, { name: g.name });
    const now = await pve<{ status?: string }>(h, "GET", `/nodes/${g.node}/${g.type}/${g.vmid}/status/current`);
    if (now.status !== "stopped") throw new AppError("pve.stopFirst", 409, { name: g.name });
  } else {
    const asked = typeof input.vmid === "number" ? input.vmid : Number(input.vmid);
    if (!Number.isInteger(asked) || asked < 100 || asked > 999_999_999) throw new AppError("pve.setting.vmid", 400);
    if (l.guests.some((x) => x.vmid === asked)) throw new AppError("pve.vmidTaken", 409, { vmid: asked });
    if (o.ids && (asked < o.ids.from || asked > o.ids.to)) throw new AppError("pve.vmidRange", 400, o.ids);
    vmid = asked;
    pool = typeof input.pool === "string" && input.pool ? input.pool : o.free ? "" : (o.pools.includes(g.pool) ? g.pool : (o.pools[0] ?? ""));
    if (pool && !o.pools.includes(pool)) throw new AppError("pve.setting.pool", 400);
  }
  const storage = typeof input.storage === "string" && input.storage ? input.storage : g.type === "lxc" ? o.storage : "";
  if (storage && !o.storages.includes(storage)) throw new AppError("pve.setting.storage", 400);
  const params = restoreParams(g.type, { volid: backup.volid, vmid, storage, replace, pool });
  const start = input.start === true;
  const job = startJob(`pve:${h.id}:${vmid}`, "restore", by, async (log) => {
    try {
      log(`Proxmox ${h.name}: ${backup.volid} → ${g.type === "lxc" ? "CT" : "VM"} ${vmid}${replace ? ` (${g.name})` : ""}`);
      await followTask(h, g.node, await pve<string>(h, "POST", `/nodes/${g.node}/${g.type}`, params), log, 60 * 60_000);
      record(replace ? "pve.backup.restored" : "pve.backup.restoredNew", { user: by, detail: `${label(h, g)}${replace ? "" : ` → ${vmid}`}: ${new Date(backup.at).toISOString().slice(0, 16).replace("T", " ")}` });
      if (start) {
        log("Starting");
        await followTask(h, g.node, await pve<string>(h, "POST", `/nodes/${g.node}/${g.type}/${vmid}/status/start`), log, 2 * 60_000);
      }
      job.result = { vmid };
    } catch (e) {
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    } finally {
      void look(h, true);
    }
  }, true, { app: g.name, machine: h.name });
  return { job: job.id, vmid };
}

/** What the clone dialog offers: where disks may go, the next free number, the pools */
export async function cloneOptions(id: string, guest: string) {
  const o = await restoreOptions(id, guest);
  return { ...o, template: guestOf(hostOf(id), guest).template };
}

/**
 * A copy of a guest as a new one, with new network cards. Proxmox copies a running virtual machine but
 * not a running container (only a stopped one or a template). It is a job: copying disks takes minutes.
 */
export async function cloneGuest(id: string, guest: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  const l = liveOf(h);
  const o = await cloneOptions(id, guest);
  if (g.type === "lxc" && !g.template) {
    const now = await pve<{ status?: string }>(h, "GET", `/nodes/${g.node}/lxc/${g.vmid}/status/current`);
    if (now.status !== "stopped") throw new AppError("pve.cloneStopFirst", 409, { name: g.name });
  }
  const newid = typeof input.vmid === "number" ? input.vmid : Number(input.vmid);
  if (!Number.isInteger(newid) || newid < 100 || newid > 999_999_999) throw new AppError("pve.setting.vmid", 400);
  if (l.guests.some((x) => x.vmid === newid)) throw new AppError("pve.vmidTaken", 409, { vmid: newid });
  if (o.ids && (newid < o.ids.from || newid > o.ids.to)) throw new AppError("pve.vmidRange", 400, o.ids);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!(g.type === "lxc" ? /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i : /^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$/i).test(name)) throw new AppError("pve.setting.name", 400);
  const linked = input.linked === true && g.template;
  const storage = typeof input.storage === "string" && input.storage && !linked ? input.storage : "";
  if (storage && !o.storages.includes(storage)) throw new AppError("pve.setting.storage", 400);
  const pool = typeof input.pool === "string" && input.pool ? input.pool : o.free ? "" : (o.pools.includes(g.pool) ? g.pool : (o.pools[0] ?? ""));
  if (pool && !o.pools.includes(pool)) throw new AppError("pve.setting.pool", 400);
  const start = input.start === true;
  const job = startJob(`pve:${h.id}:${newid}`, "clone", by, async (log) => {
    try {
      log(`Proxmox ${h.name}: ${g.name} (${g.vmid}) → ${name} (${newid})${linked ? ", linked" : ""}`);
      await followTask(h, g.node, await pve<string>(h, "POST", `/nodes/${g.node}/${g.type}/${g.vmid}/clone`, cloneParams(g.type, { newid, name, linked, storage, pool })), log, 60 * 60_000);
      record("pve.guest.cloned", { user: by, detail: `${label(h, g)} → ${name} (${newid})` });
      if (start) {
        log("Starting");
        await followTask(h, g.node, await pve<string>(h, "POST", `/nodes/${g.node}/${g.type}/${newid}/status/start`), log, 2 * 60_000);
      }
      job.result = { vmid: newid };
    } catch (e) {
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    } finally {
      void look(h, true);
    }
  }, true, { app: name, machine: h.name });
  return { job: job.id, vmid: newid };
}

/** A stopped guest made a template: it can no longer be started, only cloned — Proxmox cannot undo it */
export async function makeTemplate(id: string, guest: string, typed: unknown, by: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (typed !== g.name) throw new AppError("pve.typeName", 400, { name: g.name });
  if (selfOf(liveOf(h)) === g.id) throw new AppError("pve.isSelf", 409, { name: g.name });
  const now = await pve<{ status?: string }>(h, "GET", `/nodes/${g.node}/${g.type}/${g.vmid}/status/current`);
  if (now.status !== "stopped") throw new AppError("pve.stopFirst", 409, { name: g.name });
  const upid = await pve<string | null>(h, "POST", `/nodes/${g.node}/${g.type}/${g.vmid}/template`);
  if (typeof upid === "string" && upid.startsWith("UPID:")) await waitTask(h, g.node, upid, 120_000);
  record("pve.guest.template", { user: by, detail: label(h, g) });
  void look(h, true);
  return { ok: true };
}

/** The backup jobs of the server, as its schedule says */
export async function backupJobs(id: string) {
  const h = hostOf(id);
  const jobs = await pve<{ id: string; enabled?: number; schedule?: string; storage?: string; vmid?: string; all?: number; mode?: string; "next-run"?: number; comment?: string; pool?: string; exclude?: string }[]>(h, "GET", "/cluster/backup");
  return jobs.map((j) => ({ id: j.id, enabled: j.enabled !== 0, schedule: j.schedule ?? "", storage: j.storage ?? "", guests: j.all ? "all" : j.pool ? `pool:${j.pool}` : (j.vmid ?? ""), exclude: j.exclude ?? "", mode: j.mode ?? "", next: (j["next-run"] ?? 0) * 1000, comment: j.comment ?? "" }));
}

/** One task as Proxmox says it now: the list is asked once a minute */
export async function taskNow(id: string, upid: string): Promise<(Task & { failed: boolean }) | null> {
  const h = hostOf(id);
  const node = upid.split(":")[1] ?? "";
  if (!upid.startsWith("UPID:") || !/^[A-Za-z0-9.-]+$/.test(node)) throw new AppError("pve.noTask", 404);
  const s = await pve<Record<string, unknown>>(h, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`).catch(() => null);
  const t = s && readTask({ ...s, upid });
  return t ? { ...t, failed: failed(t) } : null;
}

/** What a task wrote, for its line on the page */
export async function taskLog(id: string, upid: string): Promise<string[]> {
  const h = hostOf(id);
  const node = upid.split(":")[1] ?? "";
  if (!upid.startsWith("UPID:") || !/^[A-Za-z0-9.-]+$/.test(node)) throw new AppError("pve.noTask", 404);
  const lines = await pve<{ n: number; t: string }[]>(h, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/log`, { limit: 1000 });
  return lines.map((l) => l.t);
}

// --- What a storage holds ------------------------------------------------------------------------------------

/**
 * A storage's contents with what may be deleted from here: a backup of a guest the token may back up (as
 * the schedule's pruning does), or anything where it has Datastore.Allocate — except a disk of a guest
 * that is there: that goes with the guest.
 */
export async function storageContent(id: string, node: string, storage: string) {
  const h = hostOf(id);
  const l = liveOf(h);
  const s = l.storages.find((x) => x.node === node && x.name === storage);
  if (!s) throw new AppError("pve.noStorage", 404);
  if (!s.active) throw new AppError("pve.storageOff", 409, { storage });
  const list = readContent(await pve<Record<string, unknown>[]>(h, "GET", `/nodes/${node}/storage/${storage}/content`), new Map(l.guests.map((g) => [g.vmid, g.name])));
  const allocate = mayPath(l.perms, `/storage/${storage}`, "Datastore.Allocate");
  const space = mayPath(l.perms, `/storage/${storage}`, "Datastore.AllocateSpace");
  const deletable = (v: Volume): boolean => {
    if (v.protected) return false;
    if ((v.content === "images" || v.content === "rootdir") && !v.orphan) return false;
    if (allocate) return true;
    const g = v.vmid !== null ? l.guests.find((x) => x.vmid === v.vmid) : undefined;
    return v.content === "backup" && space && !!g && guestRights(l.perms, g).backup;
  };
  return { node, storage, type: s.type, used: s.used, total: s.total, items: list.map((v) => ({ ...v, deletable: deletable(v) })) };
}

export async function removeVolume(id: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  const { items, node, storage } = await storageContent(id, String(input.node ?? ""), String(input.storage ?? ""));
  const v = items.find((x) => x.volid === input.volid);
  if (!v) throw new AppError("pve.noVolume", 404);
  if (!v.deletable) throw new AppError("pve.volumeKept", 403);
  const upid = await pve<string | null>(h, "DELETE", `/nodes/${node}/storage/${storage}/content/${encodeURIComponent(v.volid)}`);
  if (typeof upid === "string" && upid.startsWith("UPID:")) await waitTask(h, node, upid, 120_000);
  record("pve.volume.removed", { user: by, detail: `${h.name}: ${v.volid}` });
  void look(h, true);
  return { ok: true };
}

// --- Load over time -----------------------------------------------------------------------------------------

/** The graphs of a node (`node`) or a guest (`guest`) over an hour, a day, a week or a month */
export async function load(id: string, input: { node?: string | null; guest?: string | null; timeframe?: string | null }) {
  const h = hostOf(id);
  const timeframe = (TIMEFRAMES as readonly string[]).includes(input.timeframe ?? "") ? input.timeframe! : "hour";
  let path: string;
  if (input.guest) {
    const g = guestOf(h, input.guest);
    path = `/nodes/${g.node}/${g.type}/${g.vmid}/rrddata`;
  } else {
    const node = liveOf(h).nodes.find((n) => n.name === input.node);
    if (!node) throw new AppError("pve.noNode", 404);
    path = `/nodes/${node.name}/rrddata`;
  }
  return { timeframe, points: readRrd(await pve<Record<string, unknown>[]>(h, "GET", path, { timeframe, cf: "AVERAGE" })) };
}

// --- Templates of containers -------------------------------------------------------------------------

/** Proxmox's list of templates changes rarely: asked once an hour */
const offered = new Map<string, { at: number; list: Offered[] }>();

/** A node's processor, asked once: it does not change */
const arches = new Map<string, string>();

async function archOfNode(h: Host, node: string): Promise<string> {
  const key = `${h.id}/${node}`;
  if (!arches.has(key)) {
    const arch = archOf(await pve<{ cpuinfo?: { flags?: string } }>(h, "GET", `/nodes/${node}/status`).catch(() => ({})));
    if (arch) arches.set(key, arch);
    return arch;
  }
  return arches.get(key)!;
}

/** A file a storage keeps: a template, a disk image, a disc */
interface Kept {
  node: string;
  storage: string;
  volid: string;
  name: string;
  size: number;
  at: number;
}

/** What the storages of the online nodes keep of one kind, a shared storage listed once */
async function keptOf(h: Host, l: Live, nodes: string[], kind: "vztmpl" | UploadKind): Promise<Kept[]> {
  const have: Kept[] = [];
  for (const s of l.storages.filter((x) => x.active && x.content.includes(kind) && nodes.includes(x.node))) {
    if (s.shared && have.some((x) => x.storage === s.name)) continue;
    const content = await pve<{ volid: string; size?: number; ctime?: number }[]>(h, "GET", `/nodes/${s.node}/storage/${s.name}/content`, { content: kind }).catch(() => []);
    for (const c of content) have.push({ node: s.node, storage: s.name, volid: c.volid, name: c.volid.split("/").pop() ?? c.volid, size: c.size ?? 0, at: (c.ctime ?? 0) * 1000 });
  }
  return have.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

/** Where the token may put files of a kind: Datastore.AllocateTemplate on a storage that takes them */
function keepers(l: Live, nodes: string[], kind: "vztmpl" | UploadKind) {
  return l.storages.filter((s) => s.active && s.content.includes(kind) && nodes.includes(s.node) && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateTemplate")).map((s) => ({ node: s.node, storage: s.name, free: Math.max(0, s.total - s.used) }));
}

/** What can be downloaded, what is there already, and where the token may keep it: templates of containers, disk images, discs */
export async function templates(id: string) {
  const h = hostOf(id);
  await readNow(h);
  const l = liveOf(h);
  const nodes = l.nodes.filter((n) => n.online).map((n) => n.name);
  const node = nodes[0];
  let list = offered.get(h.id);
  const arch = node ? await archOfNode(h, node) : "";
  if (node && (!list || Date.now() - list.at > 3600_000)) {
    list = { at: Date.now(), list: readOffered(await pve<Record<string, unknown>[]>(h, "GET", `/nodes/${node}/aplinfo`).catch(() => []), arch) };
    offered.set(h.id, list);
  }
  // deleting a file of a storage is a right of its own, wider than keeping templates there: it reaches backups too
  const removable = [...new Set(l.storages.filter((s) => mayPath(l.perms, `/storage/${s.name}`, "Datastore.Allocate")).map((s) => s.name))];
  return {
    nodes,
    offered: list?.list ?? [],
    have: await keptOf(h, l, nodes, "vztmpl"),
    storages: keepers(l, nodes, "vztmpl"),
    removable,
    images: { have: await keptOf(h, l, nodes, "import"), storages: keepers(l, nodes, "import"), offered: cloudImages(arch).map(({ id, name, file, url }) => ({ id, name, file, url })) },
    isos: { have: await keptOf(h, l, nodes, "iso"), storages: keepers(l, nodes, "iso") },
  };
}

export async function downloadTemplate(id: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  const { storages, offered: list } = await templates(id);
  const node = String(input.node ?? "");
  const storage = String(input.storage ?? "");
  const template = String(input.template ?? "");
  if (!storages.some((s) => s.node === node && s.storage === storage)) throw new AppError("pve.template.storage", 400, { name: h.name });
  if (!TEMPLATE_RE.test(template) || !list.some((t) => t.template === template)) throw new AppError("pve.template.unknown", 404);
  const job = startJob(`pve:${h.id}:template:${template}`, "template", by, async (log) => {
    try {
      log(`${h.name} / ${node}: ${template} → ${storage}`);
      await followTask(h, node, await pve<string>(h, "POST", `/nodes/${node}/aplinfo`, { storage, template }), log, 60 * 60_000);
      record("pve.template.downloaded", { user: by, detail: `${h.name}: ${template} → ${storage}` });
    } catch (e) {
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    }
  }, true, { app: template, machine: "" });
  return { job: job.id };
}

export async function removeTemplate(id: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  const { have, removable, images, isos } = await templates(id);
  const t = [...have, ...images.have, ...isos.have].find((x) => x.volid === input.volid && x.node === input.node);
  if (!t) throw new AppError("pve.template.unknown", 404);
  if (!removable.includes(t.storage)) throw new AppError("pve.template.noRemove", 403, { name: h.name, storage: t.storage });
  const upid = await pve<string | null>(h, "DELETE", `/nodes/${t.node}/storage/${t.storage}/content/${encodeURIComponent(t.volid)}`);
  if (typeof upid === "string" && upid.startsWith("UPID:")) await waitTask(h, t.node, upid, 60_000);
  record("pve.template.removed", { user: by, detail: `${h.name}: ${t.name}` });
  return { ok: true };
}

// --- Disk images and discs sent to a storage --------------------------------------------------------

/**
 * Sends a file to a storage (`POST …/storage/<s>/upload`) over a connection checked like every request,
 * as one multipart body streamed from `chunks`: Proxmox needs its length beforehand. With a checksum
 * Proxmox itself compares the file once it has it all. The answer is the task that moves the file in.
 */
async function upload(h: Host, node: string, storage: string, kind: UploadKind, name: string, size: number, chunks: AsyncIterator<Uint8Array>, first: Uint8Array, checksum: { algorithm: string; value: string } | null, log: Log): Promise<string> {
  const { socket, shown } = await reach(h.url);
  if (h.fingerprint ? shown.fingerprint !== h.fingerprint : !shown.trusted) {
    socket.destroy();
    throw new AppError("pve.certChanged", 409, { name: h.name, fingerprint: shown.fingerprint });
  }
  // a large file is read by Proxmox before it answers: the connection may stay quiet that long
  socket.setTimeout(0);
  const boundary = "----hata" + Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("hex");
  const part = (field: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`;
  const head = Buffer.from(part("content", kind) + (checksum ? part("checksum-algorithm", checksum.algorithm) + part("checksum", checksum.value) : "") + `--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const u = new URL(h.url);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(e instanceof AppError ? e : new AppError("pve.unreachable", 502, { name: h.name, message: (e as NodeJS.ErrnoException)?.code ?? String((e as Error)?.message ?? e) }));
    };
    const req = request(
      {
        host: u.hostname,
        port: Number(u.port || 443),
        method: "POST",
        path: `/api2/json/nodes/${node}/storage/${storage}/upload`,
        createConnection: () => socket,
        headers: { ...auth(h, "POST"), Accept: "application/json", Connection: "close", "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": head.length + size + tail.length },
      } as Parameters<typeof request>[0],
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () => {
          if (settled) return;
          settled = true;
          let body: { data?: unknown; errors?: Record<string, string> } = {};
          try {
            body = JSON.parse(Buffer.concat(parts).toString("utf8"));
          } catch {}
          const status = res.statusCode ?? 0;
          const message = [res.statusMessage ?? "", ...Object.entries(body.errors ?? {}).map(([k, v]) => `${k}: ${String(v).trim()}`)].filter(Boolean).join("; ").slice(0, 400);
          if (status === 401) return reject(new AppError("pve.badToken", 401, { name: h.name }));
          if (status === 403) return reject(new AppError("pve.denied", 403, { name: h.name, message }));
          if (status >= 400 || typeof body.data !== "string") return reject(new AppError("pve.failed", 502, { name: h.name, message: message || String(status) }));
          resolve(body.data);
        });
      },
    );
    req.on("error", fail);
    const write = (b: Uint8Array) => (req.write(b) ? Promise.resolve() : new Promise<void>((r) => req.once("drain", () => r())));
    void (async () => {
      let sent = 0;
      let said = Date.now();
      const step = async (b: Uint8Array) => {
        sent += b.length;
        if (sent > size) throw new AppError("pve.upload.size", 409, { name });
        await write(b);
        if (Date.now() - said > 5000) {
          said = Date.now();
          log(`${Math.floor((sent / size) * 100)}% · ${(sent / 1e9).toFixed(2)} of ${(size / 1e9).toFixed(2)} GB`);
        }
      };
      await write(head);
      if (first.length) await step(first);
      for (;;) {
        const { value, done } = await chunks.next();
        if (done) break;
        await step(value);
      }
      if (sent !== size) throw new AppError("pve.upload.size", 409, { name });
      log(`100% · ${(size / 1e9).toFixed(2)} GB; Proxmox puts it in place`);
      req.end(tail);
    })().catch(fail);
  });
}

/** A checksum given by the person: its algorithm by its length */
function checksumOf(value: unknown): { algorithm: string; value: string } | null {
  const v = typeof value === "string" ? value.trim().toLowerCase().replace(/^(sha256|sha512|sha1|md5)[:=]/, "") : "";
  if (!v) return null;
  const algorithm = ({ 32: "md5", 40: "sha1", 64: "sha256", 128: "sha512" } as Record<number, string>)[v.length];
  if (!algorithm || !/^[0-9a-f]+$/.test(v)) throw new AppError("pve.upload.badChecksum", 400);
  return { algorithm, value: v };
}

/**
 * A disk image or a disc put on a storage: one of the cloud images Hata knows (with its published
 * checksum), a file from a link, or a file of this server. It passes through Hata as it comes —
 * nothing is kept here; Proxmox's own download needs a right on the node (Sys.Modify) a token is rarely given.
 */
export async function sendFile(id: string, input: Record<string, unknown>, by: string) {
  const h = hostOf(id);
  await readNow(h);
  const l = liveOf(h);
  const nodes = l.nodes.filter((n) => n.online).map((n) => n.name);
  const kind: UploadKind = input.kind === "iso" ? "iso" : "import";
  const node = String(input.node ?? "");
  const storage = String(input.storage ?? "");
  const where = keepers(l, nodes, kind).find((s) => s.node === node && s.storage === storage);
  if (!where) throw new AppError("pve.upload.storage", 400, { name: h.name });
  let image: CloudImage | undefined;
  let from: string;
  let checksum = checksumOf(input.checksum);
  if (typeof input.image === "string") {
    image = cloudImages(await archOfNode(h, node)).find((x) => x.id === input.image);
    if (!image || kind !== "import") throw new AppError("pve.template.unknown", 404);
    from = image.url;
  } else if (typeof input.url === "string" && /^https?:\/\/[^\s]+$/i.test(input.url.trim())) {
    from = input.url.trim();
  } else if (typeof input.path === "string" && input.path.startsWith("/")) {
    from = input.path;
    const st = statSync(from, { throwIfNoEntry: false });
    if (!st?.isFile()) throw new AppError("files.notFound", 404);
  } else throw new AppError("pve.upload.from", 400);
  const have = await keptOf(h, l, [node], kind);
  // what the file will be called is known before anything is downloaded, but for a disk image's extension
  const guess = image ? image.file : uploadName(from, kind, new Uint8Array(0));
  const stem = (n: string) => (kind === "import" ? n.replace(/\.[^.]+$/, "") : n);
  const taken = guess && have.find((x) => x.storage === storage && stem(x.name) === stem(guess));
  if (taken) throw new AppError("pve.upload.exists", 409, { name: taken.name, storage });
  const label = image ? image.file : from;
  const job = startJob(`pve:${h.id}:upload:${label.split("/").pop()}`, "upload", by, async (log) => {
    try {
      let size: number;
      let chunks: AsyncIterator<Uint8Array>;
      if (from.startsWith("/")) {
        size = statSync(from).size;
        chunks = (Bun.file(from).stream() as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      } else {
        if (image) {
          log(`${image.sums}`);
          const sums = await fetch(image.sums, { signal: AbortSignal.timeout(30_000) });
          const value = sums.ok ? sumFor(await sums.text(), image.listed) : null;
          if (!value) throw new AppError("pve.upload.noChecksum", 502, { message: image.sums });
          checksum = { algorithm: image.algorithm, value };
        }
        log(from);
        const res = await fetch(from, { redirect: "follow" });
        size = Number(res.headers.get("content-length") ?? NaN);
        if (!res.ok || !res.body) throw new AppError("pve.upload.fetch", 502, { message: `${res.status} ${res.statusText}` });
        if (!Number.isFinite(size) || size <= 0) throw new AppError("pve.upload.noSize", 409);
        chunks = (res.body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      }
      // the name needs the first bytes: Proxmox reads a disk image's format from its extension
      const firstRead = await chunks.next();
      const first = firstRead.done ? new Uint8Array(0) : firstRead.value;
      const name = image ? image.file : uploadName(from, kind, first);
      if (!name || !(kind === "iso" ? ISO_RE : IMPORT_RE).test(name)) throw new AppError("pve.upload.badName", 400);
      if (have.some((x) => x.storage === storage && x.name === name)) throw new AppError("pve.upload.exists", 409, { name, storage });
      // Proxmox keeps the whole upload in a folder of its own system disk before moving it in
      if (size > where.free) throw new AppError("pve.upload.noRoom", 409, { storage, size });
      log(`${h.name} / ${node}: ${name} → ${storage}${checksum ? ` (${checksum.algorithm} checked by Proxmox)` : ""}`);
      await followTask(h, node, await upload(h, node, storage, kind, name, size, chunks, first, checksum, log), log, 30 * 60_000);
      record("pve.upload.done", { user: by, detail: `${h.name}: ${name} → ${storage}` });
    } catch (e) {
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    }
  }, true, { app: label.split("/").pop() ?? label, machine: h.name });
  return { job: job.id };
}

/**
 * A file the browser sends (`POST …/files/upload`, the file as the body): passed on to the storage as it
 * comes, like a link's; the request lasts as long as the sending and Proxmox's moving it in.
 */
export async function receiveFile(id: string, q: { kind?: string | null; node?: string | null; storage?: string | null; name?: string | null }, size: number, body: ReadableStream<Uint8Array> | null, by: string) {
  const h = hostOf(id);
  await readNow(h);
  const l = liveOf(h);
  const nodes = l.nodes.filter((n) => n.online).map((n) => n.name);
  const kind: UploadKind = q.kind === "iso" ? "iso" : "import";
  const node = q.node ?? "";
  const storage = q.storage ?? "";
  const where = keepers(l, nodes, kind).find((s) => s.node === node && s.storage === storage);
  if (!where) throw new AppError("pve.upload.storage", 400, { name: h.name });
  if (!body || !Number.isFinite(size) || size <= 0) throw new AppError("pve.upload.noSize", 400);
  if (size > where.free) throw new AppError("pve.upload.noRoom", 409, { storage, size });
  const chunks = (body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const firstRead = await chunks.next();
  const first = firstRead.done ? new Uint8Array(0) : firstRead.value;
  const name = uploadName(q.name ?? "", kind, first);
  if (!name) throw new AppError("pve.upload.badName", 400);
  const have = await keptOf(h, l, [node], kind);
  if (have.some((x) => x.storage === storage && x.name === name)) throw new AppError("pve.upload.exists", 409, { name, storage });
  const said: string[] = [];
  const log = (line: string) => void said.push(line);
  try {
    await followTask(h, node, await upload(h, node, storage, kind, name, size, chunks, first, null, log), log, 30 * 60_000);
  } catch (e) {
    if (e instanceof AppError && !e.detail.message && said.length) e.detail.message = said.at(-1);
    throw e;
  }
  record("pve.upload.done", { user: by, detail: `${h.name}: ${name} → ${storage}` });
  return { name, storage };
}

// --- A new container with Hata's client -------------------------------------------------------------

/** What the server offers for a new guest: templates, images, discs, storages, bridges and pools the token may use */
export async function newOptions(id: string): Promise<NewVmOptions & { next: number | null; offer: boolean }> {
  const h = hostOf(id);
  await readNow(h);
  const l = liveOf(h);
  const nodes = l.nodes.filter((n) => n.online).map((n) => n.name);
  const templates: Record<string, string[]> = {};
  const storages: Record<string, string[]> = {};
  const bridges: Record<string, string[]> = {};
  const disks: Record<string, string[]> = {};
  const images: Record<string, string[]> = {};
  const isos: Record<string, string[]> = {};
  for (const node of nodes) {
    const here = l.storages.filter((s) => s.node === node && s.active);
    templates[node] = [];
    for (const s of here.filter((x) => x.content.includes("vztmpl"))) {
      const list = await pve<{ volid: string }[]>(h, "GET", `/nodes/${node}/storage/${s.name}/content`, { content: "vztmpl" }).catch(() => []);
      templates[node]!.push(...list.map((x) => x.volid));
    }
    storages[node] = here.filter((s) => s.content.includes("rootdir") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace")).map((s) => s.name);
    disks[node] = here.filter((s) => s.content.includes("images") && mayPath(l.perms, `/storage/${s.name}`, "Datastore.AllocateSpace")).map((s) => s.name);
    // a disc or an image the token may not read is no use to a new guest
    images[node] = [];
    isos[node] = [];
    for (const s of here.filter((x) => (x.content.includes("import") || x.content.includes("iso")) && (mayPath(l.perms, `/storage/${x.name}`, "Datastore.AllocateSpace") || mayPath(l.perms, `/storage/${x.name}`, "Datastore.Audit")))) {
      for (const kind of ["import", "iso"] as const) {
        if (!s.content.includes(kind)) continue;
        const list = await pve<{ volid: string }[]>(h, "GET", `/nodes/${node}/storage/${s.name}/content`, { content: kind }).catch(() => []);
        (kind === "import" ? images : isos)[node]!.push(...list.map((x) => x.volid).filter((v) => kind === "iso" || /\.(qcow2|raw|vmdk)$/.test(v)));
      }
    }
    const nets = await pve<{ iface: string }[]>(h, "GET", `/nodes/${node}/network`, { type: "any_bridge" }).catch(() => []);
    bridges[node] = nets.map((n) => n.iface).filter((b) => mayPath(l.perms, `/sdn/zones/localnetwork/${b}`, "SDN.Use")).sort();
  }
  // a role given on a pool hides the auditor's rights there, and /pools no longer lists it: the token's own rights name it too
  const listed = ((await pve<{ poolid: string }[]>(h, "GET", "/pools").catch(() => [])) ?? []).map((p) => p.poolid);
  const named = Object.keys(l.perms).flatMap((path) => /^\/pool\/([^/]+)$/.exec(path)?.[1] ?? []);
  const pools = [...new Set([...listed, ...named])].filter((p) => mayPath(l.perms, `/pool/${p}`, "VM.Allocate")).sort();
  const free = mayPath(l.perms, "/vms", "VM.Allocate");
  const o: NewVmOptions = { nodes, templates, storages, bridges, pools, free, ids: h.ids ?? null, taken: l.guests.map((g) => g.vmid), disks, images, isos };
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

/**
 * A new virtual machine. From a disk image: Proxmox imports the image as its disk, cloud-init makes a
 * user with a password, and Hata — with no key and no address needed — signs in on the machine's serial
 * console, as on a container's, installs the guest agent, Docker when asked and its client, then locks
 * the password when it was Hata's. From a disc: an empty disk and the disc, for the person to install
 * from on the machine's screen.
 */
export async function createVm(id: string, input: Record<string, unknown>, by: string, hata: string) {
  const h = hostOf(id);
  const o = await newOptions(id);
  let g: NewVm;
  try {
    g = readNewVm(input, o);
  } catch (e) {
    throw new AppError("pve.badField", 400, { field: (e as { field?: string }).field ?? "" });
  }
  const path = `/nodes/${g.node}/qemu/${g.vmid}`;
  const job = startJob(`pve:${h.id}:${g.vmid}`, "guest", by, async (log) => {
    let t: Typist | null = null;
    try {
      log(`Proxmox ${h.name}: VM ${g.vmid} ${g.name}`);
      await followTask(h, g.node, await pve<string>(h, "POST", `/nodes/${g.node}/qemu`, g.params), log, 30 * 60_000);
      await pve(h, "PUT", `${path}/config`, g.later);
      // an image's disk is as large as the image made it: grown to what was asked, cloud-init grows the system into it
      const disk = /size=([^,]+)/.exec(String((await pve<Record<string, unknown>>(h, "GET", `${path}/config`)).scsi0 ?? ""))?.[1];
      if (g.from === "image" && disk && gibOf(disk) < g.disk) {
        log(`Disk: ${disk} → ${g.disk}G`);
        const upid = await pve<string | null>(h, "PUT", `${path}/resize`, { disk: "scsi0", size: `${g.disk}G` });
        if (typeof upid === "string" && upid.startsWith("UPID:")) await waitTask(h, g.node, upid, 60_000);
      }
      record("pve.guest.created", { user: by, detail: `${g.name} (${g.vmid}, ${h.name})` });
      void look(h, true);
      if (!g.start) return;
      log("Starting");
      await followTask(h, g.node, await pve<string>(h, "POST", `${path}/status/start`), log, 2 * 60_000);
      if (!g.client) return;
      const config = readConfig(await pve<Record<string, unknown>>(h, "GET", `${path}/config`));
      // the console from the first moment: the system's start is seen in the log
      const con = await consoleOf(h, { node: g.node, type: "qemu", vmid: g.vmid, name: g.name } as Guest, 160, 40);
      t = typist(con, log, g.name, () => g.password);
      try {
        log("Waiting for the system to start");
        const prompt = await t.signIn(g.user, g.password, 5 * 60_000, 3 * 60_000);
        log(`Signed in to ${g.name} as ${g.user}`);
        if (prompt === "$") {
          const mark = t.at();
          t.type("sudo -i\r");
          if (!(await t.until(/# $/, 30_000, mark))) throw new AppError("pve.noSudo", 409, { name: g.name });
        }
        const { code } = await invite(by);
        const before = new Set(machines().map((m) => m.id));
        t.speak();
        if ((await t.run(vmSetupLine(g, `curl -fsSL ${hata.replace(/\/$/, "")}/client/${code} | sh`), 30 * 60_000)) !== 0) throw new AppError("pve.setupFailed", 409, { address: g.name });
        t.type("exit\r");
        await Bun.sleep(300);
        if (prompt === "$") t.type("exit\r");
        await Bun.sleep(500);
        log("Waiting for the machine to connect");
        for (let i = 0; i < 60; i++) {
          const fresh = machines().find((m) => !before.has(m.id) && (m.info?.hostname === g.name || (m.info?.macs ?? []).some((c) => config.macs.includes(c.mac.toLowerCase()))));
          if (fresh) {
            log(`Connected: ${fresh.name}`);
            job.result = { machine: fresh.id };
            return;
          }
          await Bun.sleep(2000);
        }
        throw new AppError("pve.notConnected", 409, { address: g.name });
      } finally {
        con.close();
      }
    } catch (e) {
      if (t) for (const line of t.last(6)) log("> " + line);
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    } finally {
      void look(h, true);
    }
  }, true, { app: g.name, machine: h.name });
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

/** A WebSocket of Proxmox reached from here: what comes in, what goes out, how it ends */
interface PveSocket {
  send(bytes: Uint8Array): void;
  close(): void;
  onData: (bytes: Uint8Array) => void;
  onClose: (why: string) => void;
}

/**
 * Opens `vncwebsocket` of a guest over a connection whose certificate was checked like every other
 * request; the upgrade is written by hand (Bun's WebSocket client cannot take a socket of ours).
 */
async function vncSocket(h: Host, g: Guest, port: number | string, ticket: string): Promise<PveSocket> {
  const { socket, shown } = await reach(h.url);
  if (h.fingerprint ? shown.fingerprint !== h.fingerprint : !shown.trusted) {
    socket.destroy();
    throw new AppError("pve.certChanged", 409, { name: h.name, fingerprint: shown.fingerprint });
  }
  // a console may stay quiet for minutes (a command that prints nothing): the time limit was for reaching it
  socket.setTimeout(0);
  const u = new URL(h.url);
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const path = `/api2/json/nodes/${g.node}/${g.type}/${g.vmid}/vncwebsocket?port=${encodeURIComponent(String(port))}&vncticket=${encodeURIComponent(ticket)}`;
  socket.write([`GET ${path} HTTP/1.1`, `Host: ${u.host}`, "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", "Sec-WebSocket-Protocol: binary", `Authorization: PVEAPIToken=${h.token}=${h.secret}`, "", ""].join("\r\n"));
  const reader = new FrameReader();
  const accept = await acceptFor(key);
  let head = Buffer.alloc(0);
  let open = false;
  let closed = false;
  const ws: PveSocket = {
    send: (bytes) => !closed && socket.write(encodeFrame(BINARY, bytes)),
    close: () => {
      if (closed) return;
      closed = true;
      socket.end(encodeFrame(CLOSE, new Uint8Array(0)));
      socket.destroy();
    },
    onData: () => {},
    onClose: () => {},
  };
  const end = (why: string) => {
    if (closed) return;
    closed = true;
    socket.destroy();
    ws.onClose(why);
  };
  await new Promise<void>((resolve, reject) => {
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
        resolve();
        chunk = head.subarray(at + 4);
        if (!chunk.length) return;
      }
      for (const f of reader.push(new Uint8Array(chunk))) {
        if (f.opcode === CLOSE) return end("closed");
        if (f.opcode === PING) socket.write(encodeFrame(PONG, f.data));
        else if (f.opcode === TEXT || f.opcode === BINARY) ws.onData(f.data);
      }
    });
    socket.on("close", () => (open ? end("closed") : reject(new AppError("pve.unreachable", 502, { name: h.name, message: "closed" }))));
    socket.on("error", (e: Error) => (open ? end(e.message) : reject(new AppError("pve.unreachable", 502, { name: h.name, message: e.message }))));
    setTimeout(() => reject(new AppError("pve.unreachable", 502, { name: h.name, message: "timeout" })), TIMEOUT_MS);
  });
  return ws;
}

/**
 * Opens a container's console: `termproxy` starts one, its WebSocket is reached by `vncSocket`, and the
 * first line hands the console's ticket in. Proxmox's own page talks the same way: `0:<bytes>:<data>`
 * typed, `1:<cols>:<rows>:` a size, `2` alive.
 */
export async function openConsole(id: string, guest: string, cols: number, rows: number): Promise<Console> {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (g.type !== "lxc") throw new AppError("pve.noConsole", 409);
  if (g.status !== "running") throw new AppError("pve.notRunning", 409, { name: g.name });
  return consoleOf(h, g, cols, rows);
}

/** A container's console, or the serial console of a virtual machine that has one (`serial0: socket`) */
async function consoleOf(h: Host, g: Guest, cols: number, rows: number): Promise<Console> {
  const proxy = await pve<{ port: number | string; ticket: string; user: string }>(h, "POST", `/nodes/${g.node}/${g.type}/${g.vmid}/termproxy`, g.type === "qemu" ? { serial: "serial0" } : undefined);
  const ws = await vncSocket(h, g, proxy.port, proxy.ticket);
  let closed = false;
  const con: Console = {
    send: (bytes) => !closed && ws.send(typed(bytes)),
    resize: (c, r) => !closed && ws.send(new TextEncoder().encode(sized(c, r))),
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(alive);
      ws.close();
    },
    onData: () => {},
    onClose: () => {},
  };
  const alive = setInterval(() => !closed && ws.send(new TextEncoder().encode(PVE_PING)), 30_000);
  ws.onClose = (why) => {
    if (closed) return;
    closed = true;
    clearInterval(alive);
    con.onClose(why);
  };
  // the console's own sign-in: its user and the ticket termproxy gave; the first word back is "OK"
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => (ws.close(), reject(new AppError("pve.unreachable", 502, { name: h.name, message: "timeout" }))), TIMEOUT_MS);
    ws.onData = (data) => {
      clearTimeout(timer);
      const text = new TextDecoder().decode(data);
      if (!text.startsWith("OK")) {
        ws.close();
        return reject(new AppError("pve.failed", 409, { name: h.name, message: text.slice(0, 200) }));
      }
      ws.onData = (bytes) => con.onData(bytes);
      con.resize(cols, rows);
      resolve();
      if (data.length > 2) con.onData(data.subarray(2));
    };
    ws.send(new TextEncoder().encode(`${proxy.user}:${proxy.ticket}\n`));
  });
  return con;
}

/** The screens of virtual machines asked for and not yet opened: the browser opens its socket with the id */
const screens = new Map<string, { host: string; guest: string; port: number | string; ticket: string; at: number }>();

/**
 * Asks Proxmox for a virtual machine's screen (`vncproxy`). The answer's ticket is also the VNC password,
 * so the browser gets it to sign in to the screen with; the socket is opened by `openScreen` with the id.
 */
export async function askScreen(id: string, guest: string) {
  const h = hostOf(id);
  const g = guestOf(h, guest);
  if (g.type !== "qemu") throw new AppError("pve.noScreen", 409);
  if (g.status !== "running") throw new AppError("pve.notRunning", 409, { name: g.name });
  if (!guestRights(liveOf(h).perms, g).console) throw new AppError("pve.denied", 403, { name: h.name, message: "VM.Console" });
  const proxy = await pve<{ port: number | string; ticket: string }>(h, "POST", `/nodes/${g.node}/qemu/${g.vmid}/vncproxy`, { websocket: 1 });
  for (const [k, v] of screens) if (Date.now() - v.at > 60_000) screens.delete(k);
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  screens.set(key, { host: h.id, guest: g.id, port: proxy.port, ticket: proxy.ticket, at: Date.now() });
  return { screen: key, password: proxy.ticket, name: g.name };
}

/** The socket of a screen asked for a minute ago at most; once */
export async function openScreen(key: string): Promise<{ socket: PveSocket; name: string }> {
  const s = screens.get(key);
  screens.delete(key);
  if (!s || Date.now() - s.at > 60_000) throw new AppError("pve.screenGone", 410);
  const h = hostOf(s.host);
  const g = guestOf(h, s.guest);
  return { socket: await vncSocket(h, g, s.port, s.ticket), name: g.name };
}

/** What a console printed, as lines for a job's log: colours and cursor moves taken out */
const plain = (text: string) => text.replace(/\x1b\[[0-9;?!]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, "").replace(/\r/g, "");

/** A console Hata types into and reads, the way a person would */
interface Typist {
  type(text: string): void;
  /** Waits up to `ms` for what the console shows from `from` on to match */
  until(re: RegExp, ms: number, from?: number): Promise<RegExpExecArray | null>;
  /** How much has been shown: a mark to read from */
  at(): number;
  /** Lines shown from now on go to the log too */
  speak(): void;
  /** Signs in as `user` with `password`; a sign-in left half-way is ended first. `wait` — how long the sign-in may take to appear */
  signIn(user: string, password: string, wait: number, retry?: number): Promise<"#" | "$">;
  /** Types a line and follows it to its end; its exit code */
  run(line: string, ms: number): Promise<number | null>;
  /** The last lines shown, the password hidden */
  last(n: number): string[];
}

/** What a console asks for, as the last thing it shows: a sign-in, a password, a shell's prompt */
const PROMPT = /(login:|Password:|[#$]) $/;

function typist(con: Console, log: Log, name: string, secret: () => string): Typist {
  let screen = "";
  let pending = "";
  let quiet = true;
  let wake: () => void = () => {};
  let gone = false;
  // a sequence of the terminal's may come cut in two: the cut end waits for the next piece
  let cut = "";
  const decoder = new TextDecoder();
  con.onData = (bytes) => {
    let raw = cut + decoder.decode(bytes, { stream: true });
    const esc = raw.lastIndexOf("\x1b");
    cut = esc >= 0 && raw.length - esc < 16 && !/^\x1b(\[[0-9;?!]*[A-Za-z]|[()][A-Z0-9])/.test(raw.slice(esc)) ? raw.slice(esc) : "";
    if (cut) raw = raw.slice(0, esc);
    const text = plain(raw);
    screen += text;
    if (!quiet) {
      const parts = (pending + text).split("\n");
      pending = parts.pop() ?? "";
      for (const p of parts) if (p.trim() && !/HATA-[0-9a-f]{6}/.test(p)) log(p);
    }
    wake();
  };
  con.onClose = () => ((gone = true), wake());
  const type = (text: string) => con.send(new TextEncoder().encode(text));
  const until = async (re: RegExp, ms: number, from = 0): Promise<RegExpExecArray | null> => {
    const end = Date.now() + ms;
    for (;;) {
      let m = re.exec(screen.slice(from));
      // what is asked for at the end of the screen counts once the console is quiet: output comes in pieces,
      // and a piece of a starting system's lines may end like a prompt
      if (m && re.source.endsWith("$")) {
        const seen = screen.length;
        await Bun.sleep(700);
        if (screen.length !== seen) m = null;
      }
      if (m || gone || Date.now() > end) return m;
      await Promise.race([new Promise<void>((r) => (wake = r)), Bun.sleep(500)]);
    }
  };
  const silent = () => new AppError("pve.consoleSilent", 409, { name });
  return {
    type,
    until,
    at: () => screen.length,
    speak: () => void (quiet = false),
    async signIn(user, password, wait, retry = 0) {
      const giveUp = Date.now() + retry;
      for (;;) {
        // the console shows its last screen or nothing: Enter brings the sign-in back. What is asked is the
        // last thing shown — a line of a starting system may end with "#" too —, and a system still
        // starting may print over its sign-in: Enter again until it is there
        let mark = 0;
        let first: RegExpExecArray | null = null;
        for (const end = Date.now() + wait; !first && !gone && Date.now() < end; ) {
          mark = screen.length;
          type("\r");
          first = await until(PROMPT, Math.min(10_000, Math.max(1000, end - Date.now())), mark);
        }
        // a sign-in left half-way (by somebody, or by that Enter): an empty password ends it
        if (first && first[1] === "Password:") {
          mark = screen.length;
          type("\r");
          first = await until(/login: $/, 15_000, mark);
        }
        if (!first) throw silent();
        if (first[1] === "#" || first[1] === "$") return first[1];
        mark = screen.length;
        type(user + "\r");
        if (!(await until(/Password: $/, 10_000, mark))) throw silent();
        mark = screen.length;
        type(password + "\r");
        const after = await until(/Login incorrect|[#$] $/, 20_000, mark);
        if (after && !after[0].startsWith("Login")) return after[0].trim() as "#" | "$";
        // a system just started may show its sign-in before cloud-init has set the password
        if (Date.now() > giveUp) throw new AppError("pve.badRootPassword", 400, { name });
        await Bun.sleep(5000);
        wait = 20_000;
      }
    },
    async run(line, ms) {
      const marker = `HATA-${Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex")}`;
      const mark = screen.length;
      type(`${line}; echo ${marker}-$?\r`);
      const end = await until(new RegExp(`${marker}-(\\d+)`), ms, mark);
      return end ? Number(end[1]) : null;
    },
    last: (n) => plain(screen.replaceAll(secret() || "\0", "***")).split("\n").map((x) => x.trim()).filter(Boolean).slice(-n),
  };
}

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
    const con = await consoleOf(h, g, 160, 40);
    const t = typist(con, log, g.name, () => password);
    try {
      if ((await t.signIn("root", password, 15_000)) !== "#") throw new AppError("pve.badRootPassword", 400, { name: g.name });
      log(`Signed in to ${g.name}`);
      t.speak();
      if ((await t.run(line, 15 * 60_000)) !== 0) throw new AppError("pve.setupFailed", 409, { address: g.name });
      // the sign-in ends with the work
      t.type("exit\r");
      await Bun.sleep(500);
    } catch (e) {
      // what the console showed last says why better than any word of Hata's
      for (const line of t.last(6)) log("> " + line);
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
