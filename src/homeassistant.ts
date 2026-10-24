/**
 * Home Assistant servers, reached through their own WebSocket API with a long-lived access token. Hata
 * keeps one connection to each: the states of every entity live in memory and follow Home Assistant's
 * `state_changed` events, so a tile on the home page changes the moment a light does. Nothing is
 * installed there; the token has the rights of the Home Assistant user it was made by.
 *
 * State is `homeassistant.json` in the secrets folder (the tokens are there). A token can be pasted, or
 * made by Hata from a person's sign-in — then the password is used once and not kept.
 */
import { createSocket } from "node:dgram";
import { hostname } from "node:os";
import { join } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { bus } from "./bus";
import { SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { areaOf, cleanPeople, cleanUrl, ENTITY_RE, lowBatteries, serviceOf, show, TOKEN_RE, trouble, updatesOf, type People, type RawState, type Shown, type Update } from "./ha";
import { browseQuery, parseAnswer } from "./netplace";

const FILE = join(SECRETS_DIR, "homeassistant.json");
const ID_RE = /^[a-f0-9]{8}$/;
const CALL_MS = 15_000;
const PING_MS = 30_000;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;
/** A token refused is asked about again this seldom: it will not mend by itself */
const REFUSED_RETRY_MS = 10 * 60_000;
const BACKUPS_MS = 10 * 60_000;
/** State changes are told to the pages in bunches: a power meter may change every second */
const FLUSH_MS = 400;
const NAME_MAX = 40;

export interface Server {
  id: string;
  name: string;
  /** `http://192.168.1.5:8123` */
  url: string;
  token: string;
  /** Who sees its tiles on the home page besides the administrators */
  people: People;
  added: number;
  by: string;
}

interface State {
  servers: Server[];
}

const state: State = readJsonFile<State>(FILE, { servers: [] }, (v) => typeof v === "object" && v !== null && Array.isArray((v as State).servers));
const save = () => writeJsonAtomic(FILE, state);

export interface Backup {
  id: string;
  name: string;
  date: string;
  size: number;
  automatic: boolean;
}

interface Live {
  ws: WebSocket | null;
  next: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: Timer }>;
  online: boolean;
  /** Why it is not connected, since when */
  error: { code: string; message: string; since: number } | null;
  /** The states were read since the connection was made */
  ready: boolean;
  config: { version: string; location: string } | null;
  states: Map<string, RawState>;
  areas: Map<string, string>;
  /** device id → its area id */
  devices: Map<string, string | null>;
  /** entity → its registry entry, as `list_for_display` gives it */
  registry: Map<string, { ai?: string | null; di?: string | null; ec?: number; hb?: boolean }>;
  backups: Backup[];
  /** `idle`, `create_backup`… */
  backupState: string;
  /** The local place backups are made in: `backup.local`, `hassio.local` */
  backupAgent: string;
  changed: Set<string>;
  flush: Timer | null;
  retry: Timer | null;
  backoff: number;
  ping: Timer | null;
  registryTimer: Timer | null;
  backupsAt: number;
  closed: boolean;
}

const live = new Map<string, Live>();

const fresh = (): Live => ({ ws: null, next: 1, pending: new Map(), online: false, error: null, ready: false, config: null, states: new Map(), areas: new Map(), devices: new Map(), registry: new Map(), backups: [], backupState: "", backupAgent: "", changed: new Set(), flush: null, retry: null, backoff: RETRY_MIN_MS, ping: null, registryTimer: null, backupsAt: 0, closed: false });
const liveOf = (s: Server): Live => live.get(s.id) ?? (live.set(s.id, fresh()), live.get(s.id)!);
const wsUrl = (url: string) => url.replace(/^http/, "ws") + "/api/websocket";

// --- The connection ---------------------------------------------------------------------------------

function call<T = unknown>(l: Live, message: Record<string, unknown>, ms = CALL_MS): Promise<T> {
  const ws = l.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN || !l.online) return Promise.reject(new AppError("ha.away", 502));
  const id = l.next++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      l.pending.delete(id);
      reject(new AppError("ha.timeout", 504));
    }, ms);
    l.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    ws.send(JSON.stringify({ ...message, id }));
  });
}

function connect(s: Server): void {
  const l = liveOf(s);
  if (l.closed) return;
  clearTimeout(l.retry!);
  l.retry = null;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(s.url));
  } catch (e) {
    return lost(s, "ha.unreachable", String((e as Error).message ?? e));
  }
  l.ws = ws;
  let refused = false;
  ws.onmessage = (e) => {
    let m: Record<string, any>;
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: s.token }));
    else if (m.type === "auth_invalid") {
      refused = true;
      lost(s, "ha.badToken", String(m.message ?? ""));
      ws.close();
    } else if (m.type === "auth_ok") void ready(s, l, String(m.ha_version ?? ""));
    else if (m.type === "result" || m.type === "pong") {
      const p = l.pending.get(m.id);
      if (!p) return;
      l.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.type === "pong" || m.success) p.resolve(m.result);
      else p.reject(new AppError("ha.failed", 502, { message: String(m.error?.message ?? m.error?.code ?? "") }));
    } else if (m.type === "event") onEvent(s, l, m.event);
  };
  ws.onclose = () => {
    if (l.ws !== ws) return;
    l.ws = null;
    if (!refused) lost(s, "ha.unreachable", "");
  };
  ws.onerror = () => {
    // the close that follows says the rest
  };
}

/** The connection is gone or was refused: what was waiting fails, and it is tried again later */
function lost(s: Server, code: string, message: string): void {
  const l = liveOf(s);
  const was = l.online;
  l.online = false;
  l.ready = false;
  // the first failure decides "since": a server away for an hour stays away since then
  if (!l.error || l.error.code !== code) l.error = { code, message, since: l.error?.since ?? Date.now() };
  else l.error.message = message || l.error.message;
  for (const p of l.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new AppError(code === "ha.badToken" ? "ha.badToken" : "ha.away", 502));
  }
  l.pending.clear();
  clearInterval(l.ping!);
  l.ping = null;
  if (l.closed) return;
  clearTimeout(l.retry!);
  l.retry = setTimeout(() => connect(s), code === "ha.badToken" ? REFUSED_RETRY_MS : l.backoff);
  l.backoff = Math.min(RETRY_MAX_MS, l.backoff * 2);
  if (was || code === "ha.badToken") bus.publish("ha", { id: s.id, server: true });
}

async function ready(s: Server, l: Live, version: string): Promise<void> {
  l.online = true;
  try {
    const [config, states] = await Promise.all([call<Record<string, unknown>>(l, { type: "get_config" }), call<RawState[]>(l, { type: "get_states" })]);
    l.config = { version: String(config.version ?? version), location: String(config.location_name ?? "") };
    l.states = new Map(states.map((st) => [st.entity_id, st]));
    await readRegistry(l).catch(() => {});
    await call(l, { type: "subscribe_events", event_type: "state_changed" });
    for (const type of ["area_registry_updated", "device_registry_updated", "entity_registry_updated"]) await call(l, { type: "subscribe_events", event_type: type });
  } catch (e) {
    l.ws?.close();
    return lost(s, "ha.unreachable", String((e as Error).message ?? e));
  }
  l.error = null;
  l.backoff = RETRY_MIN_MS;
  l.ready = true;
  clearInterval(l.ping!);
  l.ping = setInterval(() => {
    call(l, { type: "ping" }, 10_000).catch(() => l.ws?.close());
    if (Date.now() - l.backupsAt > BACKUPS_MS) void readBackups(l);
  }, PING_MS);
  void readBackups(l);
  bus.publish("ha", { id: s.id, server: true });
}

async function readRegistry(l: Live): Promise<void> {
  const [areas, devices, entities] = await Promise.all([
    call<{ area_id: string; name: string }[]>(l, { type: "config/area_registry/list" }),
    call<{ id: string; area_id: string | null }[]>(l, { type: "config/device_registry/list" }),
    call<{ entities: { ei: string; ai?: string | null; di?: string | null; ec?: number; hb?: boolean }[] }>(l, { type: "config/entity_registry/list_for_display" }),
  ]);
  l.areas = new Map(areas.map((a) => [a.area_id, a.name]));
  l.devices = new Map(devices.map((d) => [d.id, d.area_id]));
  l.registry = new Map(entities.entities.map((e) => [e.ei, e]));
}

async function readBackups(l: Live): Promise<void> {
  l.backupsAt = Date.now();
  try {
    const info = await call<{ backups: { backup_id: string; name: string; date: string; agents?: Record<string, { size?: number }>; with_automatic_settings?: boolean | null }[]; state?: string }>(l, { type: "backup/info" });
    l.backups = info.backups
      .map((b) => ({ id: b.backup_id, name: b.name, date: b.date, size: Math.max(0, ...Object.values(b.agents ?? {}).map((a) => a.size ?? 0)), automatic: b.with_automatic_settings === true }))
      .sort((a, b) => b.date.localeCompare(a.date));
    l.backupState = info.state ?? "";
    if (!l.backupAgent) {
      const agents = await call<{ agents: { agent_id: string }[] }>(l, { type: "backup/agents/info" }).catch(() => ({ agents: [] }));
      l.backupAgent = agents.agents.map((a) => a.agent_id).find((a) => a.endsWith(".local")) ?? "";
    }
  } catch {
    // an older Home Assistant without these commands: no backups are shown
  }
}

function onEvent(s: Server, l: Live, event: { event_type?: string; data?: Record<string, any> }): void {
  if (event.event_type === "state_changed") {
    const id = String(event.data?.entity_id ?? "");
    const next = event.data?.new_state as RawState | null;
    if (next) l.states.set(id, next);
    else l.states.delete(id);
    l.changed.add(id);
    l.flush ??= setTimeout(() => flush(s, l), FLUSH_MS);
    return;
  }
  if (event.event_type?.endsWith("_registry_updated")) {
    clearTimeout(l.registryTimer!);
    l.registryTimer = setTimeout(() => void readRegistry(l).then(() => bus.publish("ha", { id: s.id, server: true })).catch(() => {}), 2000);
  }
}

function flush(s: Server, l: Live): void {
  l.flush = null;
  const states: Record<string, Shown | null> = {};
  let server = false;
  for (const id of l.changed) {
    const raw = l.states.get(id);
    states[id] = raw ? shownOf(l, raw) : null;
    // an update or a battery changes what the server's page and the attention list say
    if (id.startsWith("update.") || raw?.attributes.device_class === "battery") server = true;
  }
  l.changed.clear();
  bus.publish("ha", { id: s.id, states, ...(server ? { server: true } : {}) });
}

function shownOf(l: Live, raw: RawState): Shown {
  const reg = l.registry.get(raw.entity_id);
  const out = show(raw, reg ? areaOf(reg, l.devices, l.areas) : "");
  // config and diagnostic entities, and those hidden in Home Assistant: listed apart
  if (reg && (reg.ec !== undefined || reg.hb)) out.extra = true;
  return out;
}

export function startHomeAssistant(): void {
  for (const s of state.servers) connect(s);
}

// --- What the pages are told ------------------------------------------------------------------------

function serverOf(id: string): Server {
  const s = ID_RE.test(id) ? state.servers.find((one) => one.id === id) : undefined;
  if (!s) throw new AppError("ha.notFound", 404);
  return s;
}

function summary(s: Server) {
  const l = liveOf(s);
  const updates = updatesOf(l.states.values());
  let on = 0;
  for (const raw of l.states.values()) if ((raw.entity_id.startsWith("light.") || raw.entity_id.startsWith("switch.")) && raw.state === "on") on++;
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    online: l.online && l.ready,
    error: l.error && { code: l.error.code, message: l.error.message, since: l.error.since },
    version: l.config?.version ?? "",
    location: l.config?.location ?? "",
    entities: l.states.size,
    on,
    updates: updates.length,
    low: lowBatteries(l.states.values()).length,
    people: s.people,
  };
}

export const servers = () => state.servers.map(summary);

export function server(id: string) {
  const s = serverOf(id);
  const l = liveOf(s);
  return { ...summary(s), updates: updatesOf(l.states.values()), low: lowBatteries(l.states.values()), backups: l.backups.slice(0, 20), backupState: l.backupState, canBackup: !!l.backupAgent, added: s.added, by: s.by };
}

/** Every entity of a server, with its room, for the list on its page and the picker of tiles */
export function entities(id: string): Shown[] {
  const l = liveOf(serverOf(id));
  return [...l.states.values()].map((raw) => shownOf(l, raw)).sort((a, b) => (a.area || "￿").localeCompare(b.area || "￿") || a.name.localeCompare(b.name));
}

/** The servers a user sees tiles of: id, name, address, whether it answers */
export const visibleTo = (user: { id: string; role: string }) => state.servers.filter((s) => user.role === "admin" || s.people === "all" || (Array.isArray(s.people) && s.people.includes(user.id))).map((s) => ({ id: s.id, name: s.name, url: s.url, online: liveOf(s).online && liveOf(s).ready }));

/** The states of the tiles asked for (`<server>/<entity>`); null — not known (yet) */
export function tileStates(keys: string[]): Record<string, Shown | null> {
  const out: Record<string, Shown | null> = {};
  for (const key of keys) {
    const [id, entity] = key.split("/");
    const s = state.servers.find((one) => one.id === id);
    const raw = s ? liveOf(s).states.get(entity!) : undefined;
    out[key] = raw && s ? shownOf(liveOf(s), raw) : null;
  }
  return out;
}

export const homeAssistantTrouble = () =>
  state.servers.flatMap((s) => {
    const l = liveOf(s);
    return trouble({ id: s.id, name: s.name, error: l.error && { code: l.error.code, since: l.error.since }, ready: l.ready, updates: updatesOf(l.states.values()), low: lowBatteries(l.states.values()) });
  });

// --- Doing things -----------------------------------------------------------------------------------

/** A press on a tile: the service Home Assistant has for it, on that one entity */
export async function act(id: string, entity: unknown, action: unknown, value: unknown): Promise<Shown> {
  const s = serverOf(id);
  const l = liveOf(s);
  if (typeof entity !== "string" || !ENTITY_RE.test(entity)) throw new AppError("ha.noEntity", 404);
  const raw = l.states.get(entity);
  if (!raw) throw new AppError(l.online ? "ha.noEntity" : "ha.away", l.online ? 404 : 502, { name: s.name });
  const service = serviceOf(raw, action, value);
  if (!service) throw new AppError("ha.badAction", 400);
  await call(l, { type: "call_service", domain: service.domain, service: service.service, service_data: service.data, target: { entity_id: entity } });
  // the new state comes as an event a moment after the answer: the tile is told that one, not the old
  for (let waited = 0; waited < 1500 && l.states.get(entity) === raw; waited += 50) await Bun.sleep(50);
  return shownOf(l, l.states.get(entity) ?? raw);
}

export async function installUpdate(id: string, entity: unknown, backup: unknown, by: string): Promise<void> {
  const s = serverOf(id);
  const l = liveOf(s);
  const u = typeof entity === "string" ? updatesOf(l.states.values()).find((one) => one.entity === entity) : undefined;
  if (!u) throw new AppError("ha.noUpdate", 404);
  if (!u.install) throw new AppError("ha.notInstallable", 400);
  if (u.running) throw new AppError("ha.updateRunning", 409);
  // an update of Home Assistant itself restarts it, and the answer may never come: what it says in the
  // first seconds — a refusal — is told, the rest shows in the update's own state
  const asked = call(l, { type: "call_service", domain: "update", service: "install", service_data: backup === true && u.backup ? { backup: true } : {}, target: { entity_id: u.entity } }, 30 * 60_000);
  const early = await Promise.race([asked.then(() => null, (e) => e as Error), Bun.sleep(3000).then(() => null)]);
  if (early && !(early instanceof AppError && early.code === "ha.away")) throw early;
  asked.catch(() => {});
  record("ha.update", { user: by, detail: `${s.name}: ${updateName(u)} ${u.latest}` });
}

const updateName = (u: Update) => (u.title && !u.name.includes(u.title) ? `${u.name} (${u.title})` : u.name);

export async function makeBackup(id: string, by: string): Promise<void> {
  const s = serverOf(id);
  const l = liveOf(s);
  if (!l.backupAgent) throw new AppError("ha.noBackups", 400);
  if (l.backupState && l.backupState !== "idle") throw new AppError("ha.backupRunning", 409);
  await call(l, { type: "backup/generate", agent_ids: [l.backupAgent], include_homeassistant: true, include_database: true, name: `Hata ${new Date().toLocaleString("sv-SE").slice(0, 16)}` });
  l.backupState = "create_backup";
  record("ha.backup", { user: by, detail: s.name });
  // the list is read again as the backup is made; a small one is done in seconds
  for (const ms of [5_000, 30_000, 120_000]) setTimeout(() => void readBackups(l).then(() => bus.publish("ha", { id: s.id, server: true })), ms);
}

// --- Adding, changing, removing ---------------------------------------------------------------------

/** Opens a connection of its own with a token and asks Home Assistant who it is */
function tryToken(url: string, token: string): Promise<{ version: string; location: string }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(url));
    } catch (e) {
      return reject(new AppError("ha.unreachable", 400, { message: String((e as Error).message ?? e) }));
    }
    let done = false;
    const finish = (error: AppError | null, value?: { version: string; location: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new AppError("ha.unreachable", 400, { message: "no answer in 15 s" })), CALL_MS);
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (m.type === "auth_invalid") finish(new AppError("ha.badToken", 400));
      else if (m.type === "auth_ok") ws.send(JSON.stringify({ id: 1, type: "get_config" }));
      else if (m.type === "result" && m.id === 1) finish(null, { version: String(m.result?.version ?? m.ha_version ?? ""), location: String(m.result?.location_name ?? "") });
    };
    ws.onerror = () => finish(new AppError("ha.unreachable", 400, { message: "" }));
    ws.onclose = () => finish(new AppError("ha.unreachable", 400, { message: "" }));
  });
}

/** Sign-ins waiting for their second step (a code of an authenticator app), by Home Assistant's flow id */
const flows = new Map<string, { url: string; expires: number }>();

async function haFetch(url: string, path: string, body: Record<string, string> | string, form = false): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(url + path, {
      method: "POST",
      headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: typeof body === "string" ? body : form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_MS),
      redirect: "manual",
    });
  } catch (e) {
    throw new AppError("ha.unreachable", 400, { message: String((e as Error).message ?? e) });
  }
  const text = await response.text();
  if (!response.ok) throw new AppError(response.status === 403 || response.status === 429 ? "ha.signInBlocked" : "ha.unreachable", 400, { message: `${response.status} ${text.slice(0, 200)}` });
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("ha.notHomeAssistant", 400);
  }
}

/**
 * A token made from a person's sign-in: Home Assistant's own login flow, then a long-lived token called
 * "Hata" in that person's profile. The short session it took is ended; the password is not kept.
 */
async function tokenBySignIn(url: string, input: { user?: unknown; password?: unknown; code?: unknown; flow?: unknown }): Promise<string> {
  // Home Assistant asks a client to name itself by a URL; its own address is one it takes without fetching it
  const client = url + "/";
  let step: Record<string, any>;
  const flow = typeof input.flow === "string" && /^[a-f0-9]{32}$/.test(input.flow) ? input.flow : "";
  if (flow && typeof input.code === "string") {
    const known = flows.get(flow);
    if (!known || known.url !== url || known.expires < Date.now()) throw new AppError("ha.signInAgain", 400);
    step = await haFetch(url, `/auth/login_flow/${flow}`, { client_id: client, code: input.code.trim() });
  } else {
    if (typeof input.user !== "string" || !input.user.trim() || typeof input.password !== "string" || !input.password) throw new AppError("ha.signInMissing", 400);
    const started = await haFetch(url, "/auth/login_flow", JSON.stringify({ client_id: client, handler: ["homeassistant", null], redirect_uri: client + "?auth_callback=1" }));
    if (started.type !== "form" || !started.flow_id) throw new AppError("ha.notHomeAssistant", 400);
    step = await haFetch(url, `/auth/login_flow/${started.flow_id}`, { client_id: client, username: input.user.trim(), password: input.password });
  }
  if (step.type === "form" && step.step_id === "mfa") {
    if (step.errors?.base) throw new AppError("ha.badCode", 400, { flow: String(step.flow_id) });
    flows.set(String(step.flow_id), { url, expires: Date.now() + 5 * 60_000 });
    throw new AppError("ha.needCode", 400, { flow: String(step.flow_id) });
  }
  if (step.type === "form") throw new AppError(step.errors?.base === "invalid_auth" ? "ha.badPassword" : "ha.signInFailed", 400, { message: String(step.errors?.base ?? "") });
  if (step.type !== "create_entry" || typeof step.result !== "string") throw new AppError("ha.signInFailed", 400, { message: String(step.type ?? "") });
  if (flow) flows.delete(flow);
  const tokens = await haFetch(url, "/auth/token", { grant_type: "authorization_code", code: step.result, client_id: client }, true);
  const access = String(tokens.access_token ?? "");
  const refresh = String(tokens.refresh_token ?? "");
  try {
    return await longLived(url, access);
  } finally {
    // the session of the sign-in is no longer needed: the long-lived token is a session of its own
    if (refresh) await fetch(url + "/auth/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }).toString(), signal: AbortSignal.timeout(CALL_MS) }).catch(() => {});
  }
}

function longLived(url: string, access: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(url));
    const timer = setTimeout(() => (ws.close(), reject(new AppError("ha.unreachable", 400, { message: "no answer in 15 s" }))), CALL_MS);
    // the person sees it in their profile of Home Assistant: which Hata, since when
    const name = `Hata (${hostname()}) ${new Date().toLocaleString("sv-SE").slice(0, 16)}`;
    let tries = 0;
    const ask = () => ws.send(JSON.stringify({ id: ++tries, type: "auth/long_lived_access_token", client_name: tries > 1 ? `${name} (${tries})` : name, lifespan: 3650 }));
    const end = (error: AppError | null, token = "") => {
      clearTimeout(timer);
      ws.close();
      if (error) reject(error);
      else resolve(token);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: access }));
      else if (m.type === "auth_invalid") end(new AppError("ha.signInFailed", 400, { message: String(m.message ?? "") }));
      else if (m.type === "auth_ok") ask();
      else if (m.type === "result" && m.id === tries) {
        if (m.success && typeof m.result === "string") return end(null, m.result);
        // a token's name is unique for a user: one made earlier the same minute takes a number
        if (tries < 5) return ask();
        end(new AppError("ha.signInFailed", 400, { message: String(m.error?.message ?? "") }));
      }
    };
    ws.onerror = () => end(new AppError("ha.unreachable", 400, { message: "" }));
  });
}

const cleanName = (value: unknown, fallback: string) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "") || fallback;

type Input = { name?: unknown; url?: unknown; token?: unknown; user?: unknown; password?: unknown; code?: unknown; flow?: unknown; people?: unknown };

async function tokenOf(url: string, input: Input): Promise<string> {
  if (input.password !== undefined || input.code !== undefined) return tokenBySignIn(url, input);
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (!TOKEN_RE.test(token)) throw new AppError("ha.badTokenText", 400);
  return token;
}

export async function addServer(input: Input, by: string) {
  const url = cleanUrl(input.url);
  if (!url) throw new AppError("ha.badUrl", 400);
  if (state.servers.some((s) => s.url === url)) throw new AppError("ha.exists", 409);
  const token = await tokenOf(url, input);
  const about = await tryToken(url, token);
  let id = "";
  while (!id || state.servers.some((s) => s.id === id)) id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  const s: Server = { id, name: cleanName(input.name, about.location && about.location !== "Home" ? about.location : "Home Assistant"), url, token, people: cleanPeople(input.people), added: Date.now(), by };
  state.servers.push(s);
  save();
  record("ha.added", { user: by, detail: `${s.name} (${url})` });
  connect(s);
  return summary(s);
}

export async function changeServer(id: string, input: Input, by: string) {
  const s = serverOf(id);
  const url = input.url === undefined ? s.url : cleanUrl(input.url);
  if (!url) throw new AppError("ha.badUrl", 400);
  if (url !== s.url && state.servers.some((one) => one.id !== id && one.url === url)) throw new AppError("ha.exists", 409);
  const newToken = input.token || input.password !== undefined || input.code !== undefined;
  const token = newToken ? await tokenOf(url, input) : s.token;
  if (newToken || url !== s.url) await tryToken(url, token);
  const reconnect = token !== s.token || url !== s.url;
  s.url = url;
  s.token = token;
  if (input.name !== undefined) s.name = cleanName(input.name, s.name);
  if (input.people !== undefined) s.people = cleanPeople(input.people);
  save();
  record("ha.changed", { user: by, detail: s.name });
  if (reconnect) {
    const l = liveOf(s);
    l.error = null;
    l.backoff = RETRY_MIN_MS;
    l.ws?.close();
    connect(s);
  }
  bus.publish("ha", { id: s.id, server: true });
  return summary(s);
}

export function removeServer(id: string, by: string): void {
  const s = serverOf(id);
  const l = liveOf(s);
  l.closed = true;
  clearTimeout(l.retry!);
  clearInterval(l.ping!);
  clearTimeout(l.flush!);
  l.ws?.close();
  live.delete(s.id);
  state.servers = state.servers.filter((one) => one.id !== id);
  save();
  record("ha.removed", { user: by, detail: s.name });
}

/** A user was removed: they see no server's tiles any more */
export function forgetUser(userId: string): void {
  let changed = false;
  for (const s of state.servers) {
    if (Array.isArray(s.people) && s.people.includes(userId)) {
      s.people = s.people.filter((one) => one !== userId);
      changed = true;
    }
  }
  if (changed) save();
}

// --- Looking around ---------------------------------------------------------------------------------

/** Home Assistant servers on the home network: they announce `_home-assistant._tcp` over multicast DNS */
export function discover(): Promise<{ name: string; url: string; known: boolean }[]> {
  const type = "_home-assistant._tcp";
  return new Promise((resolve) => {
    const records: ReturnType<typeof parseAnswer> = [];
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    const done = () => {
      try {
        socket.close();
      } catch {}
      const found = new Map<string, { name: string; url: string; known: boolean }>();
      for (const ptr of records.filter((r) => r.type === 12 && r.name === `${type}.local`)) {
        const srv = records.find((r) => r.type === 33 && r.name === ptr.value);
        const address = srv && records.find((r) => r.type === 1 && r.name === srv.value)?.value;
        if (!srv || !address) continue;
        const url = `http://${address}:${srv.port ?? 8123}`;
        found.set(url, { name: ptr.value.slice(0, -(type.length + ".local".length + 1)).replace(/\\032/g, " "), url, known: state.servers.some((s) => s.url === url) });
      }
      resolve([...found.values()]);
    };
    socket.on("message", (packet) => records.push(...parseAnswer(new Uint8Array(packet))));
    socket.on("error", done);
    socket.bind(0, () => {
      const query = browseQuery([type]);
      socket.send(query, 5353, "224.0.0.251");
      setTimeout(() => socket.send(query, 5353, "224.0.0.251"), 600);
      setTimeout(done, 2000);
    });
  });
}
