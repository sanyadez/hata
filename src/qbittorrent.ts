/**
 * qBittorrent servers, reached through their Web API. Its only sign-in is a user and a password, so the
 * password is kept, in `qbittorrent.json` in the secrets folder, and the page never gets it back.
 *
 * qBittorrent bans an address after a few wrong passwords, and the ban would take the person's own
 * browser too if it comes from the same address. So a refused sign-in is not tried again by itself: only
 * a restart of Hata or a change of the sign-in tries once more.
 */
import { join } from "node:path";
import { record } from "./activity";
import { AppError, listApps } from "./apps";
import { SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { cleanUrl } from "./ha";
import { appOfServer, cleanName, isHere, newId, portOf } from "./integration";
import { cleanHashes, cleanLinks, isTorrentFile, isWebApiVersion, MAX_TORRENT_BYTES, readTorrent, sessionCookie, type Torrent, totalsOf, trouble, verbsOf } from "./qbit";

const FILE = join(SECRETS_DIR, "qbittorrent.json");
const ID_RE = /^[a-f0-9]{8}$/;
const CALL_MS = 10_000;
const LOOK_MS = 15_000;
const DEFAULT_PORT = "8080";

export interface Server {
  id: string;
  name: string;
  url: string;
  user: string;
  password: string;
  added: number;
  by: string;
}

interface Live {
  cookie: string;
  version: string;
  webApi: string;
  torrents: Torrent[];
  at: number;
  error: { code: string; message: string; since: number } | null;
  /** The sign-in was refused: not asked again until somebody changes it */
  refused: boolean;
}

const state = readJsonFile<{ servers: Server[] }>(FILE, { servers: [] });
const live = new Map<string, Live>();
const save = () => writeJsonAtomic(FILE, state);
const liveOf = (s: Server): Live => {
  let l = live.get(s.id);
  if (!l) live.set(s.id, (l = { cookie: "", version: "", webApi: "", torrents: [], at: 0, error: null, refused: false }));
  return l;
};

function serverOf(id: string): Server {
  const s = ID_RE.test(id) ? state.servers.find((one) => one.id === id) : undefined;
  if (!s) throw new AppError("qbit.notFound", 404);
  return s;
}

// --- Talking ----------------------------------------------------------------------------------------

/**
 * qBittorrent answers 401 to a Host whose port is not the one it listens on inside its container, which
 * is what a published port looks like (seen with 5.3: 8181 outside, 8080 inside), and it compares Origin and
 * Referer with that Host. A Host without a port passes both checks.
 */
async function request(url: string, path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  const { protocol, hostname } = new URL(url);
  const headers = new Headers(init.headers);
  headers.set("host", hostname);
  headers.set("referer", `${protocol}//${hostname}/`);
  headers.set("origin", `${protocol}//${hostname}`);
  if (cookie) headers.set("cookie", cookie);
  try {
    return await fetch(url + path, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(CALL_MS) });
  } catch (e) {
    throw new AppError("qbit.noAnswer", 502, { url, message: e instanceof Error ? e.message : String(e) });
  }
}

/** The version, signing in first when it asks for that. Whatever else answers on the port is said to be something else. */
async function signIn(url: string, user: string, password: string): Promise<{ cookie: string; webApi: string; version: string }> {
  const ask = async (cookie: string) => {
    const res = await request(url, "/api/v2/app/webapiVersion", cookie);
    return { status: res.status, text: (await res.text()).trim() };
  };
  let cookie = "";
  let first = await ask("");
  // a server may let this network in without a password
  if (first.status === 401 || first.status === 403) {
    const res = await request(url, "/api/v2/auth/login", "", { method: "POST", body: new URLSearchParams({ username: user, password }) });
    const said = (await res.text()).trim();
    if (res.status === 403) throw new AppError("qbit.banned", 403, { url });
    if (!res.ok || said === "Fails.") throw new AppError("qbit.badLogin", 401, { url });
    cookie = sessionCookie(res.headers.getSetCookie());
    first = await ask(cookie);
  }
  if (first.status === 401 || first.status === 403) throw new AppError("qbit.badLogin", 401, { url });
  if (first.status !== 200 || !isWebApiVersion(first.text)) throw new AppError("qbit.notQbit", 502, { url });
  const version = await request(url, "/api/v2/app/version", cookie).then((res) => (res.ok ? res.text() : ""));
  return { cookie, webApi: first.text, version: version.trim() };
}

/** A request with the session, signing in again when it ran out */
async function call(s: Server, path: string, init?: RequestInit): Promise<Response> {
  const l = liveOf(s);
  if (l.refused) throw new AppError("qbit.badLogin", 401, { url: s.url });
  const signedIn = async () => {
    try {
      Object.assign(l, await signIn(s.url, s.user, s.password));
    } catch (e) {
      if (e instanceof AppError && (e.code === "qbit.badLogin" || e.code === "qbit.banned")) l.refused = true;
      throw e;
    }
  };
  if (!l.webApi) await signedIn();
  let res = await request(s.url, path, l.cookie, init);
  if (res.status === 401 || res.status === 403) {
    await signedIn();
    res = await request(s.url, path, l.cookie, init);
  }
  if (res.status === 415) throw new AppError("qbit.badTorrent", 400);
  if (!res.ok) throw new AppError("qbit.refused", 502, { status: res.status });
  return res;
}

async function look(s: Server): Promise<void> {
  const l = liveOf(s);
  try {
    const res = await call(s, "/api/v2/torrents/info?sort=added_on&reverse=true");
    const list = (await res.json()) as Record<string, unknown>[];
    l.torrents = list.map(readTorrent);
    l.at = Date.now();
    l.error = null;
  } catch (e) {
    const code = e instanceof AppError ? e.code : "qbit.noAnswer";
    const message = e instanceof AppError ? String(e.detail.message ?? "") : e instanceof Error ? e.message : String(e);
    // the first failure's time is what "for more than five minutes" counts from
    l.error = { code, message, since: l.error?.code === code ? l.error.since : Date.now() };
    l.webApi = "";
  }
}

export function startQbittorrent(): void {
  const round = () => void Promise.all(state.servers.map(look));
  round();
  setInterval(round, LOOK_MS);
}

// --- What the pages are told ------------------------------------------------------------------------

function summary(s: Server) {
  const l = liveOf(s);
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    user: s.user,
    version: l.version,
    online: !l.error && l.at > 0,
    error: l.error,
    here: isHere(s.url),
    port: portOf(s.url),
    totals: totalsOf(l.torrents),
    at: l.at,
  };
}

export const qbitServers = () => state.servers.map(summary);
export const qbitServer = (id: string) => summary(serverOf(id));

/** The torrents as they are right now */
export async function qbitTorrents(id: string): Promise<{ torrents: Torrent[] }> {
  const s = serverOf(id);
  await look(s);
  const l = liveOf(s);
  if (l.error) throw new AppError(l.error.code, 502, { url: s.url, message: l.error.message });
  return { torrents: l.torrents };
}

export const qbitTrouble = () =>
  state.servers.flatMap((s) => {
    const l = liveOf(s);
    return trouble({ id: s.id, name: s.name, error: l.error, ready: l.at > 0, failed: l.torrents.filter((x) => x.group === "error").map((x) => x.name) });
  });

/** What the tile of an installed app says: the app whose published port this server is */
export function qbitOfApps(apps: { name: string; port?: string | number | null }[]) {
  const out: Record<string, { id: string; online: boolean; down: number; up: number; active: number; total: number }> = {};
  for (const s of qbitServers()) {
    const app = appOfServer(apps, s);
    if (app) out[app.name] = { id: s.id, online: s.online, down: s.totals.down, up: s.totals.up, active: s.totals.active, total: s.totals.total };
  }
  return out;
}

/** An app here that runs qBittorrent and is not connected yet */
export async function qbitFound(lang: string) {
  const apps = await listApps(lang);
  const known = new Set(qbitServers().filter((s) => s.here).map((s) => String(s.port)));
  return apps.filter((a) => a.port && !known.has(String(a.port)) && a.containers.some((c) => /qbittorrent/i.test(c.image))).map((a) => ({ app: a.name, title: a.title, port: a.port }));
}

// --- Changes ----------------------------------------------------------------------------------------

interface Input {
  name?: unknown;
  url?: unknown;
  user?: unknown;
  password?: unknown;
}

const words = (value: unknown) => (typeof value === "string" ? value : "");

export async function addQbit(input: Input, by: string) {
  const url = cleanUrl(input.url, DEFAULT_PORT);
  if (!url) throw new AppError("qbit.badUrl", 400);
  if (state.servers.some((s) => s.url === url)) throw new AppError("qbit.exists", 409);
  const user = words(input.user).trim();
  const password = words(input.password);
  const about = await signIn(url, user, password);
  const s: Server = { id: newId(state.servers), name: cleanName(input.name, "qBittorrent"), url, user, password, added: Date.now(), by };
  state.servers.push(s);
  save();
  Object.assign(liveOf(s), about);
  await look(s);
  record("qbit.added", { user: by, detail: `${s.name} (${url})` });
  return summary(s);
}

export async function changeQbit(id: string, input: Input, by: string) {
  const s = serverOf(id);
  const url = input.url === undefined ? s.url : cleanUrl(input.url, DEFAULT_PORT);
  if (!url) throw new AppError("qbit.badUrl", 400);
  if (url !== s.url && state.servers.some((one) => one.id !== id && one.url === url)) throw new AppError("qbit.exists", 409);
  const user = input.user === undefined ? s.user : words(input.user).trim();
  // an empty password keeps the one saved
  const password = words(input.password) || s.password;
  const about = await signIn(url, user, password);
  Object.assign(s, { url, user, password, name: cleanName(input.name, s.name) });
  save();
  Object.assign(liveOf(s), about, { refused: false, error: null });
  await look(s);
  record("qbit.changed", { user: by, detail: s.name });
  return summary(s);
}

export function removeQbit(id: string, by: string): void {
  const s = serverOf(id);
  live.delete(s.id);
  state.servers = state.servers.filter((one) => one.id !== id);
  save();
  record("qbit.removed", { user: by, detail: s.name });
}

/** Links and a .torrent file (base64) are given to qBittorrent as they are: it downloads to where it is set to */
export async function addTorrents(id: string, input: { links?: unknown; file?: unknown }, by: string): Promise<void> {
  const s = serverOf(id);
  const form = new FormData();
  if (input.file) {
    const bytes = typeof input.file === "string" ? Buffer.from(input.file, "base64") : Buffer.alloc(0);
    if (bytes.length > MAX_TORRENT_BYTES || !isTorrentFile(bytes)) throw new AppError("qbit.badTorrent", 400);
    form.append("torrents", new Blob([bytes], { type: "application/x-bittorrent" }), "added.torrent");
  } else {
    const links = cleanLinks(input.links);
    if (!links) throw new AppError("qbit.badLinks", 400);
    form.append("urls", links.join("\n"));
  }
  const res = await call(s, "/api/v2/torrents/add", { method: "POST", body: form });
  if ((await res.text()).trim() === "Fails.") throw new AppError("qbit.badTorrent", 400);
  record("qbit.torrentAdded", { user: by, detail: s.name });
  void look(s);
}

const named = (s: Server, hashes: string[]) => {
  const list = liveOf(s).torrents;
  const first = list.find((x) => hashes.includes(x.hash))?.name ?? hashes[0]!;
  return hashes.length > 1 ? `${first} +${hashes.length - 1}` : first;
};

export async function torrentsPower(id: string, hashes: unknown, action: "pause" | "resume", by: string): Promise<void> {
  const s = serverOf(id);
  const list = cleanHashes(hashes);
  if (!list) throw new AppError("qbit.badHashes", 400);
  const l = liveOf(s);
  if (!l.webApi) await look(s);
  const verb = verbsOf(l.webApi)[action];
  await call(s, `/api/v2/torrents/${verb}`, { method: "POST", body: new URLSearchParams({ hashes: list.join("|") }) });
  record(action === "pause" ? "qbit.paused" : "qbit.resumed", { user: by, detail: `${s.name}: ${named(s, list)}` });
  void look(s);
}

/** Taken off the list, and with `withData` its files gone too: those are not in Hata's trash */
export async function removeTorrents(id: string, hashes: unknown, withData: boolean, by: string): Promise<void> {
  const s = serverOf(id);
  const list = cleanHashes(hashes);
  if (!list) throw new AppError("qbit.badHashes", 400);
  await call(s, "/api/v2/torrents/delete", { method: "POST", body: new URLSearchParams({ hashes: list.join("|"), deleteFiles: withData ? "true" : "false" }) });
  record(withData ? "qbit.torrentRemovedData" : "qbit.torrentRemoved", { user: by, detail: `${s.name}: ${named(s, list)}` });
  void look(s);
}
