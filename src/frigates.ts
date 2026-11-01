/**
 * Frigate servers, reached through their API. On its port with a sign-in (8971 by default, HTTPS with a
 * certificate of its own) a user and a password are asked for: the password is kept in `frigate.json` in the
 * secrets folder, the page never gets it back, and it goes out only to the certificate the person confirmed.
 * On its internal port (5000, plain HTTP) nothing is asked.
 *
 * Pictures are passed on from Frigate as they are; nothing of a camera is stored here.
 */
import { join } from "node:path";
import { record } from "./activity";
import { AppError, listApps } from "./apps";
import { SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { type Camera, EVENT_RE, eventsQuery, type FrigateEvent, NAME_RE, readCameras, readEvent, tokenCookie, trouble } from "./frigate";
import { cleanUrl } from "./ha";
import { appOfServer, cleanName, isHere, newId, portOf } from "./integration";
import { CertificateChanged, type Answer, pinnedRequest, showCertificate } from "./pinned";
import { cleanFingerprint } from "./pve";

const FILE = join(SECRETS_DIR, "frigate.json");
const ID_RE = /^[a-f0-9]{8}$/;
const CALL_MS = 10_000;
const LOOK_MS = 20_000;
const CONFIG_MS = 10 * 60_000;
/** A refused password is asked about again this seldom: it will not mend by itself */
const REFUSED_RETRY_MS = 10 * 60_000;

export interface Server {
  id: string;
  name: string;
  url: string;
  user: string;
  password: string;
  fingerprint: string;
  added: number;
  by: string;
}

interface Live {
  cookie: string;
  version: string;
  config: unknown;
  configAt: number;
  cameras: Camera[];
  latest: FrigateEvent[];
  at: number;
  error: { code: string; message: string; since: number } | null;
  refusedAt: number;
}

const state = readJsonFile<{ servers: Server[] }>(FILE, { servers: [] });
const live = new Map<string, Live>();
const save = () => writeJsonAtomic(FILE, state);
const liveOf = (s: Server): Live => {
  let l = live.get(s.id);
  if (!l) live.set(s.id, (l = { cookie: "", version: "", config: null, configAt: 0, cameras: [], latest: [], at: 0, error: null, refusedAt: 0 }));
  return l;
};

function serverOf(id: string): Server {
  const s = ID_RE.test(id) ? state.servers.find((one) => one.id === id) : undefined;
  if (!s) throw new AppError("frigate.notFound", 404);
  return s;
}

// --- Talking ----------------------------------------------------------------------------------------

type Where = Pick<Server, "url" | "fingerprint">;

async function ask(at: Where, path: string, cookie: string, init: { method?: string; body?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(cookie ? { Cookie: cookie } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) };
  try {
    if (at.url.startsWith("https:")) return await pinnedRequest(at.url, at.fingerprint, path, { ...init, headers }, CALL_MS);
    const res = await fetch(at.url + path, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(CALL_MS) });
    return { status: res.status, cookies: res.headers.getSetCookie(), bytes: Buffer.from(await res.arrayBuffer()) };
  } catch (e) {
    if (e instanceof CertificateChanged) throw new AppError("frigate.certChanged", 409, { url: at.url, fingerprint: e.message });
    throw new AppError("frigate.noAnswer", 502, { url: at.url, message: e instanceof Error ? e.message : String(e) });
  }
}

const textOf = (a: Answer) => a.bytes.toString("utf8");
function jsonOf(a: Answer): unknown {
  try {
    return JSON.parse(textOf(a));
  } catch {
    throw new AppError("frigate.notFrigate", 502);
  }
}

/** Its version tells Frigate from whatever else answers on the port; signed in first when it asks for that */
async function signIn(at: Where, user: string, password: string): Promise<{ cookie: string; version: string }> {
  let cookie = "";
  let about = await ask(at, "/api/version", "");
  if (about.status === 401 || about.status === 403) {
    const res = await ask(at, "/api/login", "", { method: "POST", body: JSON.stringify({ user, password }) });
    if (res.status === 401 || res.status === 403 || res.status === 400) throw new AppError("frigate.badLogin", 401, { url: at.url });
    cookie = tokenCookie(res.cookies);
    if (res.status !== 200 || !cookie) throw new AppError("frigate.notFrigate", 502, { url: at.url });
    about = await ask(at, "/api/version", cookie);
  }
  const version = textOf(about).trim();
  if (about.status !== 200 || !/^\d+\.\d+/.test(version)) throw new AppError("frigate.notFrigate", 502, { url: at.url });
  return { cookie, version };
}

async function call(s: Server, path: string, init?: { method?: string; body?: string }): Promise<Answer> {
  const l = liveOf(s);
  const signedIn = async () => {
    if (l.refusedAt && Date.now() - l.refusedAt < REFUSED_RETRY_MS) throw new AppError("frigate.badLogin", 401, { url: s.url });
    try {
      Object.assign(l, await signIn(s, s.user, s.password), { refusedAt: 0 });
    } catch (e) {
      if (e instanceof AppError && e.code === "frigate.badLogin") l.refusedAt = Date.now();
      throw e;
    }
  };
  if (!l.version) await signedIn();
  let res = await ask(s, path, l.cookie, init);
  if (res.status === 401 || res.status === 403) {
    await signedIn();
    res = await ask(s, path, l.cookie, init);
  }
  return res;
}

async function look(s: Server): Promise<void> {
  const l = liveOf(s);
  try {
    const stats = await call(s, "/api/stats");
    if (stats.status !== 200) throw new AppError("frigate.notFrigate", 502, { url: s.url });
    if (!l.config || Date.now() - l.configAt > CONFIG_MS) {
      const config = await call(s, "/api/config");
      if (config.status === 200) Object.assign(l, { config: jsonOf(config), configAt: Date.now() });
    }
    l.cameras = readCameras(l.config, jsonOf(stats));
    const events = await call(s, "/api/events?limit=12");
    if (events.status === 200) l.latest = (jsonOf(events) as unknown[]).map(readEvent);
    l.at = Date.now();
    l.error = null;
  } catch (e) {
    const code = e instanceof AppError ? e.code : "frigate.noAnswer";
    const message = e instanceof AppError ? String(e.detail.message ?? "") : e instanceof Error ? e.message : String(e);
    l.error = { code, message, since: l.error?.code === code ? l.error.since : Date.now() };
    l.version = "";
  }
}

export function startFrigate(): void {
  const round = () => void Promise.all(state.servers.map(look));
  round();
  setInterval(round, LOOK_MS);
}

// --- What the pages are told ------------------------------------------------------------------------

function summary(s: Server) {
  const l = liveOf(s);
  return { id: s.id, name: s.name, url: s.url, user: s.user, version: l.version, online: !l.error && l.at > 0, error: l.error, here: isHere(s.url), port: portOf(s.url), cameras: l.cameras, latest: l.latest, at: l.at };
}

export const frigateServers = () => state.servers.map(summary);
export const frigateServer = (id: string) => summary(serverOf(id));
export const frigateTrouble = () => state.servers.flatMap((s) => { const l = liveOf(s); return trouble({ id: s.id, name: s.name, error: l.error, ready: l.at > 0, cameras: l.cameras }); });

export function frigateOfApps(apps: { name: string; port?: string | number | null }[]) {
  const out: Record<string, { id: string; online: boolean; cameras: number; working: number }> = {};
  for (const s of frigateServers()) {
    const app = appOfServer(apps, s);
    if (app) out[app.name] = { id: s.id, online: s.online, cameras: s.cameras.length, working: s.cameras.filter((c) => c.online).length };
  }
  return out;
}

export async function frigateFound(lang: string) {
  const apps = await listApps(lang);
  const known = new Set(frigateServers().filter((s) => s.here).map((s) => String(s.port)));
  return apps.filter((a) => a.port && !known.has(String(a.port)) && a.containers.some((c) => /frigate/i.test(c.image))).map((a) => ({ app: a.name, title: a.title, port: a.port, scheme: a.scheme === "https" ? "https" : "http" }));
}

export async function frigateEvents(id: string, input: { camera?: unknown; label?: unknown; before?: unknown; limit?: unknown }): Promise<{ events: FrigateEvent[] }> {
  const res = await call(serverOf(id), `/api/events?${eventsQuery(input)}`);
  if (res.status !== 200) throw new AppError("frigate.refused", 502, { status: res.status });
  return { events: (jsonOf(res) as unknown[]).map(readEvent) };
}

const picture = (res: Answer) => {
  if (res.status !== 200) throw new AppError("frigate.noPicture", res.status === 404 ? 404 : 502);
  return res.bytes;
};

/** What a camera sees now, at most this high: the page shows them small */
export async function cameraPicture(id: string, camera: string, height: number): Promise<Buffer> {
  if (!NAME_RE.test(camera)) throw new AppError("frigate.noPicture", 404);
  const h = Math.min(1080, Math.max(90, Math.round(height) || 360));
  return picture(await call(serverOf(id), `/api/${camera}/latest.jpg?h=${h}`));
}

export async function eventPicture(id: string, event: string, kind: "thumbnail" | "snapshot"): Promise<Buffer> {
  if (!EVENT_RE.test(event)) throw new AppError("frigate.noPicture", 404);
  return picture(await call(serverOf(id), `/api/events/${event}/${kind === "snapshot" ? "snapshot.jpg?bbox=1" : "thumbnail.jpg"}`));
}

// --- Changes ----------------------------------------------------------------------------------------

interface Input {
  name?: unknown;
  url?: unknown;
  user?: unknown;
  password?: unknown;
  fingerprint?: unknown;
}

const words = (value: unknown) => (typeof value === "string" ? value : "");

/** A certificate no authority vouches for is shown to the person first, and kept once confirmed */
async function confirmed(url: string, input: Input, kept = ""): Promise<string> {
  if (!url.startsWith("https:")) return "";
  let shown;
  try {
    shown = await showCertificate(url, CALL_MS);
  } catch (e) {
    throw new AppError("frigate.noAnswer", 502, { url, message: e instanceof Error ? e.message : String(e) });
  }
  if (shown.trusted) return "";
  const given = cleanFingerprint(input.fingerprint) ?? kept;
  if (given !== shown.fingerprint) throw new AppError("frigate.confirmCert", 409, { fingerprint: shown.fingerprint, subject: shown.subject, issuer: shown.issuer });
  return given;
}

const httpsFirst = (value: unknown) => {
  // a bare address means the port with a sign-in, and that one speaks HTTPS
  const bare = typeof value === "string" && !/^[a-z]+:\/\//i.test(value.trim());
  return cleanUrl(bare ? `https://${String(value).trim().replace(/\/+$/, "")}${/:\d+$/.test(String(value).trim()) ? "" : ":8971"}` : value);
};

export async function addFrigate(input: Input, by: string) {
  const url = httpsFirst(input.url);
  if (!url) throw new AppError("frigate.badUrl", 400);
  if (state.servers.some((s) => s.url === url)) throw new AppError("frigate.exists", 409);
  const fingerprint = await confirmed(url, input);
  const user = words(input.user).trim();
  const password = words(input.password);
  const about = await signIn({ url, fingerprint }, user, password);
  const s: Server = { id: newId(state.servers), name: cleanName(input.name, "Frigate"), url, user, password, fingerprint, added: Date.now(), by };
  state.servers.push(s);
  save();
  Object.assign(liveOf(s), about);
  await look(s);
  record("frigate.added", { user: by, detail: `${s.name} (${url})` });
  return summary(s);
}

export async function changeFrigate(id: string, input: Input, by: string) {
  const s = serverOf(id);
  const url = input.url === undefined ? s.url : httpsFirst(input.url);
  if (!url) throw new AppError("frigate.badUrl", 400);
  if (url !== s.url && state.servers.some((one) => one.id !== id && one.url === url)) throw new AppError("frigate.exists", 409);
  // the same address keeps the certificate confirmed unless a new one was just confirmed; a changed one is asked about again
  const fingerprint = await confirmed(url, input, url === s.url ? s.fingerprint : "");
  const user = input.user === undefined ? s.user : words(input.user).trim();
  const password = words(input.password) || s.password;
  const about = await signIn({ url, fingerprint }, user, password);
  Object.assign(s, { url, user, password, fingerprint, name: cleanName(input.name, s.name) });
  save();
  Object.assign(liveOf(s), about, { refusedAt: 0, error: null, config: null });
  await look(s);
  record("frigate.changed", { user: by, detail: s.name });
  return summary(s);
}

export function removeFrigate(id: string, by: string): void {
  const s = serverOf(id);
  live.delete(s.id);
  state.servers = state.servers.filter((one) => one.id !== id);
  save();
  record("frigate.removed", { user: by, detail: s.name });
}
