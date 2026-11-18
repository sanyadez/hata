/**
 * Integrations: services Hata talks to through their API, each described by a store (`integ/spec.ts`).
 * This is the one engine that does what a description says — signs in, reads, shows, acts — for every
 * kind of service. Nothing of a description runs: Hata makes only the requests it names, only to the
 * address the person gave.
 *
 * A connection's password or token is kept in `integrations.json` in the secrets folder and never goes
 * back to the page. Over HTTPS with a certificate of the service's own, the fingerprint the person
 * confirmed is checked before anything is sent.
 *
 * The descriptions in use are kept in the state folder (`integrations/<id>.yml`) as they were taken, so a
 * store that changes or goes away changes nothing until the person takes the newer one.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, listApps } from "./apps";
import type { AttentionItem } from "./attention";
import { DATA_DIR, SECRETS_DIR, settings } from "./config";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { type Answers, atLeast, chosen, fill, fillJson, get, rowsOf, type Row, type Scalar, say, sortRows, target, test, valuesOf, where } from "./integ/data";
import { readSpec, type Req, type Spec, SPEC_ID, SpecError } from "./integ/spec";
import { appOfServer, cleanName, isHere, lanAddress, newId, portOf } from "./integration";
import { CertificateChanged, pinnedRequest, pinnedStream, showCertificate, type Stream } from "./pinned";
import { cleanFingerprint } from "./pve";
import { VERSION } from "./version";
import frigateSeed from "./integ/seeds/frigate.yml" with { type: "text" };
import qbitSeed from "./integ/seeds/qbittorrent.yml" with { type: "text" };

const FILE = join(SECRETS_DIR, "integrations.json");
const SPECS_DIR = join(DATA_DIR, "integrations");
const ID_RE = /^[a-f0-9]{8}$/;
const CALL_MS = 10_000;
const TICK_MS = 5_000;
const AWAY_MS = 5 * 60_000;
/** A refused sign-in is tried again this seldom, unless the description says never by itself */
const REFUSED_RETRY_MS = 10 * 60_000;
/** An answer larger than this is not read */
const MAX_ANSWER = 32 * 1024 * 1024;
const MAX_TORRENT = 1024 * 1024;
const MAX_IDS = 500;

export interface Connection {
  id: string;
  /** The description's id */
  kind: string;
  name: string;
  url: string;
  user: string;
  password: string;
  token: string;
  fingerprint: string;
  added: number;
  by: string;
}

interface Kept {
  /** The description as taken, YAML */
  text: string;
  /** The store it came from; "" — Hata's own copy */
  store: string;
  taken: number;
}

interface Live {
  ready: boolean;
  cookie: string;
  /** A session given in an answer and sent back in a header */
  session: { header: string; value: string } | null;
  /** A token the service hands out on a refusal and wants back */
  handshake: string;
  answers: Answers;
  readAt: Record<string, number>;
  /** Rows seen lately, by list and key: what a picture or an action may name */
  seen: Record<string, Map<string, Row>>;
  at: number;
  error: { code: string; message: string; since: number } | null;
  refusedAt: number;
  /** A refusal the description says not to retry: waits for the person */
  refused: boolean;
  busy: boolean;
}

/** `moved`: connections of the time before descriptions, taken over once */
const state = readJsonFile<{ connections: Connection[]; moved?: string[] }>(FILE, { connections: [] });
const live = new Map<string, Live>();
const specs = new Map<string, { spec: Spec } & Kept>();
const save = () => writeJsonAtomic(FILE, state);
const liveOf = (c: Connection): Live => {
  let l = live.get(c.id);
  if (!l) live.set(c.id, (l = { ready: false, cookie: "", session: null, handshake: "", answers: {}, readAt: {}, seen: {}, at: 0, error: null, refusedAt: 0, refused: false, busy: false }));
  return l;
};

// --- Descriptions -----------------------------------------------------------------------------------

function loadSpecs(): void {
  if (!existsSync(SPECS_DIR)) return;
  for (const file of readdirSync(SPECS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const kept = JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8")) as Kept;
      const spec = readSpec(Bun.YAML.parse(kept.text));
      specs.set(spec.id, { spec, ...kept });
    } catch (e) {
      console.error(`integration ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
loadSpecs();

/** A description taken into use: checked, kept on disk, and from now on what its connections follow */
export function keepSpec(text: string, store: string): Spec {
  const spec = readSpec(Bun.YAML.parse(text));
  if (!atLeast(VERSION, spec.requires)) throw new AppError("integration.tooNew", 409, { kind: spec.title, version: spec.requires });
  mkdirSync(SPECS_DIR, { recursive: true });
  const kept: Kept = { text, store, taken: Date.now() };
  writeTextAtomic(join(SPECS_DIR, `${spec.id}.json`), JSON.stringify(kept));
  specs.set(spec.id, { spec, ...kept });
  // what was read is read again by the new description
  for (const c of state.connections) if (c.kind === spec.id) live.delete(c.id);
  return spec;
}

/** What a store offers: given by the store's index (`store.ts` hands it in), read by the same reader */
type Offer = { store: string; text: string };
let offered: () => Offer[] = () => [];
export const offerSpecs = (from: () => Offer[]) => void (offered = from);

let parsed: { from: Offer[]; specs: { spec: Spec; store: string; text: string }[] } | null = null;
function storeSpecs(): { spec: Spec; store: string; text: string }[] {
  const now = offered();
  // read again only when the stores' list is another one
  if (parsed?.from === now) return parsed.specs;
  const out: { spec: Spec; store: string; text: string }[] = [];
  for (const o of now) {
    try {
      const spec = readSpec(Bun.YAML.parse(o.text));
      if (atLeast(VERSION, spec.requires) && !out.some((x) => x.spec.id === spec.id)) out.push({ spec, store: o.store, text: o.text });
    } catch {
      // a description this Hata cannot read is not offered
    }
  }
  parsed = { from: now, specs: out };
  return out;
}

function specOf(kind: string): Spec {
  const s = specs.get(kind);
  if (!s) throw new AppError("integration.unknownKind", 404, { kind });
  return s.spec;
}

/** Every kind that can be connected: those in use, and what the stores offer */
export function integrationKinds(lang: string) {
  const out = new Map<string, { id: string; title: string; icon: string; what: string; version: number; kept: boolean; newer: number | null; store: string; apps: string[] }>();
  const store = storeSpecs();
  for (const [id, s] of specs) {
    const there = store.find((x) => x.spec.id === id);
    out.set(id, { id, title: s.spec.title, icon: s.spec.icon, what: say(s.spec.what, lang), version: s.spec.version, kept: true, newer: there && there.spec.version > s.spec.version ? there.spec.version : null, store: s.store, apps: s.spec.apps });
  }
  for (const x of store) if (!out.has(x.spec.id)) out.set(x.spec.id, { id: x.spec.id, title: x.spec.title, icon: x.spec.icon, what: say(x.spec.what, lang), version: x.spec.version, kept: false, newer: null, store: x.store, apps: x.spec.apps });
  return [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** A kind not in use yet is taken from its store when it is first connected */
function specFor(kind: string): Spec {
  if (specs.has(kind)) return specOf(kind);
  const there = storeSpecs().find((x) => x.spec.id === kind);
  if (!there) throw new AppError("integration.unknownKind", 404, { kind });
  return keepSpec(there.text, there.store);
}

export function takeNewerSpec(kind: string, by: string) {
  const there = storeSpecs().find((x) => x.spec.id === kind);
  if (!there || !specs.has(kind)) throw new AppError("integration.unknownKind", 404, { kind });
  const spec = keepSpec(there.text, there.store);
  record("integration.specUpdated", { user: by, detail: `${spec.title} ${spec.version}` });
  return { version: spec.version };
}

/** What a page draws by: the description without how to sign in; a kind not in use yet as its store has it */
export function kindView(kind: string) {
  const spec = specs.get(kind)?.spec ?? storeSpecs().find((x) => x.spec.id === kind)?.spec;
  if (!spec) throw new AppError("integration.unknownKind", 404, { kind });
  const { signIn, read, ...rest } = spec;
  return {
    ...rest,
    ask: signIn.ask,
    defaults: signIn.defaults,
    lists: Object.fromEntries(Object.entries(read).filter(([, s]) => s.list !== undefined).map(([name, s]) => [name, { key: s.key, params: s.params, private: s.private }])),
  };
}

/** The descriptions of the kinds connected, for the page to draw their widgets and pages by */
export const specsInUse = () => Object.fromEntries([...new Set(state.connections.map((c) => c.kind))].filter((k) => specs.has(k)).map((k) => [k, kindView(k)]));

// --- Talking ----------------------------------------------------------------------------------------

interface Sent {
  method: string;
  path: string;
  body?: string | Uint8Array;
  type?: string;
}

interface Got {
  status: number;
  type: string;
  headers: Record<string, string>;
  cookies: string[];
  bytes: Buffer;
}

function headersFor(c: Connection, spec: Spec, l: Live, sent: Sent): Record<string, string> {
  const h: Record<string, string> = {};
  const who = { user: c.user, password: c.password, token: c.token };
  for (const [k, v] of Object.entries(spec.signIn.headers)) h[k] = fill(v, who);
  if (spec.signIn.basic) h.Authorization = `Basic ${Buffer.from(`${c.user}:${c.password}`).toString("base64")}`;
  if (l.cookie) h.Cookie = l.cookie;
  if (l.session) h[l.session.header] = l.session.value;
  if (spec.signIn.handshake && l.handshake) h[spec.signIn.handshake.header] = l.handshake;
  if (spec.signIn.host === "bare") {
    const { protocol, hostname } = new URL(c.url);
    h.Host = hostname;
    h.Origin = `${protocol}//${hostname}`;
    h.Referer = `${protocol}//${hostname}/`;
  }
  if (sent.type) h["Content-Type"] = sent.type;
  h.Accept = "application/json, text/plain, */*";
  return h;
}

async function send(c: Connection, spec: Spec, sent: Sent, again = true): Promise<Got> {
  const l = liveOf(c);
  const headers = headersFor(c, spec, l, sent);
  let got: Got;
  try {
    if (c.url.startsWith("https:")) {
      const a = await pinnedRequest(c.url, c.fingerprint, sent.path, { method: sent.method, headers, ...(sent.body !== undefined ? { body: sent.body } : {}) }, CALL_MS);
      got = { status: a.status, type: a.headers["content-type"] ?? "", headers: a.headers, cookies: a.cookies, bytes: a.bytes };
    } else {
      const res = await fetch(c.url + sent.path, { method: sent.method, headers, body: sent.body as BodyInit | undefined, redirect: "manual", signal: AbortSignal.timeout(CALL_MS) });
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > MAX_ANSWER) throw new Error("the answer is too large");
      got = { status: res.status, type: res.headers.get("content-type") ?? "", headers: Object.fromEntries(res.headers.entries()), cookies: res.headers.getSetCookie(), bytes: Buffer.from(await res.arrayBuffer()) };
    }
  } catch (e) {
    if (e instanceof CertificateChanged) throw new AppError("integration.certChanged", 409, { url: c.url, fingerprint: e.message });
    throw new AppError("integration.noAnswer", 502, { url: c.url, message: e instanceof Error ? e.message : String(e) });
  }
  if (got.bytes.length > MAX_ANSWER) throw new AppError("integration.noAnswer", 502, { url: c.url, message: "the answer is too large" });
  // Transmission's way: a refusal that hands out the token to send back
  const hs = spec.signIn.handshake;
  if (hs && got.status === hs.status && got.headers[hs.header.toLowerCase()] && again) {
    l.handshake = got.headers[hs.header.toLowerCase()]!;
    return send(c, spec, sent, false);
  }
  return got;
}

function sentOf(req: Req, vars: Record<string, unknown>, files: Record<string, Uint8Array> = {}): Sent {
  const path = target(req, vars);
  if (req.form) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(req.form)) form.set(k, fill(v, vars));
    return { method: req.method, path, body: form.toString(), type: "application/x-www-form-urlencoded" };
  }
  if (req.json !== undefined) return { method: req.method, path, body: JSON.stringify(fillJson(req.json, vars)), type: "application/json" };
  if (req.multipart) {
    // written by hand: Bun's own FormData body comes without its Content-Type, and the boundary is in it
    const boundary = `----hata${crypto.randomUUID().replace(/-/g, "")}`;
    const parts: Uint8Array[] = [];
    const enc = new TextEncoder();
    for (const [k, v] of Object.entries(req.multipart)) {
      const whole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(v);
      const file = whole && files[whole[1]!];
      if (file) {
        parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${whole![1]}.torrent"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, enc.encode("\r\n"));
        continue;
      }
      const text = fill(v, vars);
      if (text) parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${text}\r\n`));
    }
    parts.push(enc.encode(`--${boundary}--\r\n`));
    return { method: req.method, path, body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
  }
  return { method: req.method, path };
}

const text = (g: Got) => g.bytes.toString("utf8");
function jsonOf(g: Got, c: Connection): unknown {
  try {
    return JSON.parse(text(g));
  } catch {
    throw new AppError("integration.notIt", 502, { url: c.url });
  }
}

const cookieIn = (lines: string[], names: string[]) => {
  for (const line of lines) {
    const pair = line.split(";")[0]!.trim();
    const name = pair.split("=")[0]!;
    if (pair.length > name.length + 1 && names.some((n) => name === n || (n.endsWith("_") && name.startsWith(n)))) return pair;
  }
  return "";
};

/** Signed in (when the service asks for that) and sure it is the service the description is about */
async function signIn(c: Connection, spec: Spec): Promise<void> {
  const l = liveOf(c);
  if (l.refused) throw new AppError("integration.badLogin", 401, { url: c.url, name: c.name });
  if (l.refusedAt && Date.now() - l.refusedAt < REFUSED_RETRY_MS) throw new AppError("integration.badLogin", 401, { url: c.url, name: c.name });
  const who = { user: c.user, password: c.password, token: c.token };
  l.cookie = "";
  l.session = null;
  const check = () => send(c, spec, sentOf(spec.signIn.check.request, {}));
  let got = await check();
  const refusedNow = (code: "integration.badLogin" | "integration.banned") => {
    if (spec.signIn.once) l.refused = true;
    else l.refusedAt = Date.now();
    return new AppError(code, code === "integration.banned" ? 403 : 401, { url: c.url, name: c.name });
  };
  const login = spec.signIn.login;
  if ((got.status === 401 || got.status === 403) && login) {
    const res = await send(c, spec, sentOf(login.request, who));
    if (login.banned.includes(res.status)) throw refusedNow("integration.banned");
    if (login.refused.status.includes(res.status) || (login.refused.text !== undefined && text(res).trim() === login.refused.text)) throw refusedNow("integration.badLogin");
    if (res.status >= 300) throw new AppError("integration.notIt", 502, { url: c.url });
    if (login.cookie) l.cookie = cookieIn(res.cookies, login.cookie);
    if (login.session) {
      const v = get(jsonOf(res, c), login.session.json);
      if (typeof v === "string" && v) l.session = { header: login.session.header, value: v };
    }
    if (!l.cookie && !l.session) throw new AppError("integration.notIt", 502, { url: c.url });
    got = await check();
  }
  if (got.status === 401 || got.status === 403) throw refusedNow("integration.badLogin");
  const is = spec.signIn.check.is;
  let answer: unknown;
  if (is === "version") {
    answer = text(got).trim().replace(/^"|"$/g, "");
    if (got.status !== 200 || !/^v?\d+\.\d+/.test(String(answer))) throw new AppError("integration.notIt", 502, { url: c.url });
  } else if (is === "ok") {
    if (got.status < 200 || got.status >= 300) throw new AppError("integration.notIt", 502, { url: c.url });
    answer = got.type.includes("json") ? jsonOf(got, c) : text(got);
  } else {
    answer = jsonOf(got, c);
    const v = get(answer, is.json);
    if (got.status !== 200 || v === undefined || v === null || v === "") throw new AppError("integration.notIt", 502, { url: c.url });
  }
  l.answers.check = answer;
  l.ready = true;
  l.refusedAt = 0;
}

/** A request with the session; signed in again once when it ran out */
async function call(c: Connection, spec: Spec, s: Sent): Promise<Got> {
  const l = liveOf(c);
  if (!l.ready) await signIn(c, spec);
  let got = await send(c, spec, s);
  if (got.status === 401 || got.status === 403) {
    l.ready = false;
    await signIn(c, spec);
    got = await send(c, spec, s);
  }
  return got;
}

function remember(c: Connection, list: string, rows: Row[], keep: number, key: string) {
  const l = liveOf(c);
  const seen = (l.seen[list] ??= new Map());
  for (const row of rows) {
    const k = String(row[key]);
    seen.delete(k);
    seen.set(k, row);
  }
  while (seen.size > Math.max(keep, rows.length)) seen.delete(seen.keys().next().value!);
}

/** One source read, and those read out of it */
async function readSource(c: Connection, spec: Spec, name: string, params: Record<string, unknown> = {}): Promise<Row[] | unknown> {
  const l = liveOf(c);
  const s = spec.read[name]!;
  const got = await call(c, spec, sentOf(s.request!, { ...defaultsOf(spec, name), ...params }));
  if (got.status === 404) throw new AppError("integration.refused", 502, { status: 404, path: s.request!.path });
  if (got.status < 200 || got.status >= 300) throw new AppError("integration.refused", 502, { status: got.status });
  const answer = s.text ? text(got).trim() : jsonOf(got, c);
  if (s.list === undefined) {
    l.answers[name] = answer;
    return answer;
  }
  const rows = rowsOf(s, answer, l.answers);
  remember(c, name, rows, s.keep, s.key);
  return rows;
}

/** What is read out of another answer is made again after every round: it may join several (Frigate's cameras and their frames) */
function settle(c: Connection, spec: Spec) {
  const l = liveOf(c);
  for (const [name, s] of Object.entries(spec.read)) {
    if (!s.from) continue;
    if (s.list === undefined) l.answers[name] = l.answers[s.from];
    else {
      const rows = rowsOf(s, l.answers[s.from], l.answers);
      l.answers[name] = rows;
      remember(c, name, rows, s.keep, s.key);
    }
  }
}

const defaultsOf = (spec: Spec, name: string) => Object.fromEntries(Object.entries(spec.read[name]!.params).flatMap(([k, p]) => (p.default !== undefined ? [[k, p.default]] : [])));

async function look(c: Connection, all = false): Promise<void> {
  const l = liveOf(c);
  if (l.busy) return;
  const spec = specs.get(c.kind)?.spec;
  if (!spec) return;
  l.busy = true;
  try {
    const now = Date.now();
    for (const [name, s] of Object.entries(spec.read)) {
      if (s.from || s.every === 0) continue;
      if (!all && l.readAt[name] && now - l.readAt[name] < s.every * 1000) continue;
      const got = await readSource(c, spec, name);
      if (s.list !== undefined) l.answers[name] = got;
      l.readAt[name] = now;
    }
    settle(c, spec);
    l.at = Date.now();
    l.error = null;
  } catch (e) {
    const code = e instanceof AppError ? e.code : "integration.noAnswer";
    const message = e instanceof AppError ? String(e.detail.message ?? e.detail.status ?? "") : e instanceof Error ? e.message : String(e);
    l.error = { code, message, since: l.error?.code === code ? l.error.since : Date.now() };
    l.ready = false;
  } finally {
    l.busy = false;
  }
}

let started = false;
export function startIntegrations(): void {
  if (started) return;
  started = true;
  const round = () => void Promise.all(state.connections.map((c) => look(c)));
  round();
  setInterval(round, TICK_MS);
}

// --- What pages are told ----------------------------------------------------------------------------

const valuesNow = (c: Connection) => {
  const spec = specs.get(c.kind)?.spec;
  return spec ? valuesOf(spec, liveOf(c).answers) : {};
};

function summary(c: Connection) {
  const l = liveOf(c);
  const spec = specs.get(c.kind)?.spec;
  return {
    id: c.id,
    kind: c.kind,
    title: spec?.title ?? c.kind,
    icon: spec?.icon ?? "plug",
    name: c.name,
    url: c.url,
    user: c.user,
    secret: Boolean(c.password || c.token),
    https: c.url.startsWith("https:"),
    online: !l.error && l.at > 0,
    error: l.error,
    here: isHere(c.url),
    port: portOf(c.url),
    values: valuesNow(c),
    at: l.at,
  };
}

export type Summary = ReturnType<typeof summary>;
export const connections = () => state.connections.map(summary);

function connectionOf(id: string): Connection {
  const c = ID_RE.test(id) ? state.connections.find((x) => x.id === id) : undefined;
  if (!c) throw new AppError("integration.notFound", 404);
  return c;
}

/** One connection for its page: what it is, its values and the rows of its lists as last read */
export function connectionView(id: string) {
  const c = connectionOf(id);
  const l = liveOf(c);
  const spec = specs.get(c.kind)?.spec;
  const lists: Record<string, Row[]> = {};
  if (spec) for (const [name, s] of Object.entries(spec.read)) if (s.list !== undefined) lists[name] = (l.answers[name] as Row[] | undefined) ?? [];
  return { ...summary(c), lists };
}

/** The rows of a list now, read with what the page asks (a filter, a page further) */
export async function rowsNow(id: string, list: string, asked: Record<string, string>): Promise<{ rows: Row[] }> {
  const c = connectionOf(id);
  const spec = specOf(c.kind);
  const s = spec.read[list];
  if (!s || s.list === undefined) throw new AppError("integration.notFound", 404);
  const params: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(s.params)) {
    const v = asked[k];
    if (v === undefined || v === "") continue;
    if (p.kind === "name" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v)) params[k] = v;
    else if (p.kind === "number" && Number.isFinite(Number(v)) && Number(v) >= 0) params[k] = Math.min(p.max ?? 1e12, Number(v));
    else throw new AppError("integration.badInput", 400, { field: k });
  }
  if (s.from) return { rows: (liveOf(c).answers[list] as Row[] | undefined) ?? [] };
  const rows = (await readSource(c, spec, list, params)) as Row[];
  if (!Object.keys(params).length) liveOf(c).answers[list] = rows;
  return { rows };
}

/** What the widgets on Home show: each connection's values and its lists' first rows */
export function widgetData() {
  return state.connections.map((c) => {
    const spec = specs.get(c.kind)?.spec;
    const l = liveOf(c);
    const lists: Record<string, Row[]> = {};
    for (const w of Object.values(spec?.widgets ?? {})) {
      if (w.kind === "summary" && w.list) lists[w.list.of] = sortRows(where((l.answers[w.list.of] as Row[]) ?? [], w.list.where), w.list.sort).slice(0, w.list.limit);
      else if (w.kind !== "summary") lists[w.of] = ((l.answers[w.of] as Row[]) ?? []).slice(0, 60);
    }
    return { ...summary(c), lists };
  });
}

/** What the tile of an installed app says, and which app a connection is */
export function integrationsOfApps(apps: { name: string; port?: string | number | null }[]) {
  const out: Record<string, { id: string; kind: string; online: boolean; values: Record<string, Scalar> }> = {};
  for (const s of connections()) {
    const app = appOfServer(apps, s);
    if (app && !out[app.name]) out[app.name] = { id: s.id, kind: s.kind, online: s.online, values: s.values };
  }
  return out;
}

/** Apps of this server that run a kind of service and are not connected yet */
export async function integrationsFound(lang: string) {
  const apps = await listApps(lang);
  const kinds = [...specs.values()].map((x) => x.spec).concat(storeSpecs().map((x) => x.spec).filter((s) => !specs.has(s.id)));
  const known = new Set(connections().filter((s) => s.here).map((s) => String(s.port)));
  const out: { app: string; title: string; kind: string; kindTitle: string; icon: string; url: string }[] = [];
  for (const a of apps) {
    if (!a.port || known.has(String(a.port))) continue;
    const spec = kinds.find((k) => (a.store && k.apps.includes(a.name)) || a.containers.some((x) => k.images.some((i) => x.image.toLowerCase().includes(i))));
    if (spec) out.push({ app: a.name, title: a.title, kind: spec.id, kindTitle: spec.title, icon: spec.icon, url: `${a.scheme === "https" ? "https" : spec.address.scheme}://${lanAddress()}:${a.port}` });
  }
  return out;
}

// --- Pictures ---------------------------------------------------------------------------------------

function rowFor(c: Connection, list: string, key: string, missing = "integration.noPicture"): Row {
  const l = liveOf(c);
  const row = l.seen[list]?.get(key) ?? ((l.answers[list] as Row[] | undefined) ?? []).find((r) => String(r[specOf(c.kind).read[list]!.key]) === key);
  if (!row) throw new AppError(missing, 404);
  return row;
}

export async function pictureOf(id: string, name: string, key: string, height: number): Promise<{ bytes: Buffer; type: string }> {
  const c = connectionOf(id);
  const spec = specOf(c.kind);
  const p = spec.pictures[name];
  if (!p || p.stream) throw new AppError("integration.noPicture", 404);
  const row = rowFor(c, p.of, key);
  if (p.when && !test(p.when, (f) => row[f])) throw new AppError("integration.noPicture", 404);
  const got = await call(c, spec, sentOf(p.request, { ...row, height: Math.min(1080, Math.max(90, Math.round(height) || 360)) }));
  if (got.status !== 200 || !/^image\/(jpeg|png|webp|gif|avif)/.test(got.type)) throw new AppError("integration.noPicture", got.status === 404 ? 404 : 502);
  return { bytes: got.bytes, type: got.type.split(";")[0]! };
}

/** Frames as they come, passed on and never kept; the stream ends when the page stops reading */
export async function streamOf(id: string, name: string, key: string, height: number, fps: number, signal: AbortSignal): Promise<Stream> {
  const c = connectionOf(id);
  const spec = specOf(c.kind);
  const p = spec.pictures[name];
  if (!p || !p.stream) throw new AppError("integration.noPicture", 404);
  const row = rowFor(c, p.of, key);
  const l = liveOf(c);
  const path = target(p.request, { ...row, height: Math.min(1080, Math.max(90, Math.round(height) || 360)), fps: Math.min(10, Math.max(1, Math.round(fps) || 5)) });
  const open = async (): Promise<Stream> => {
    const headers = headersFor(c, spec, l, { method: "GET", path });
    try {
      if (c.url.startsWith("https:")) return await pinnedStream(c.url, c.fingerprint, path, headers, signal, CALL_MS);
      const res = await fetch(c.url + path, { headers, redirect: "manual", signal });
      return { status: res.status, type: res.headers.get("content-type") ?? "", body: res.body ?? new ReadableStream() };
    } catch (e) {
      if (e instanceof CertificateChanged) throw new AppError("integration.certChanged", 409, { url: c.url, fingerprint: e.message });
      throw new AppError("integration.noAnswer", 502, { url: c.url, message: e instanceof Error ? e.message : String(e) });
    }
  };
  if (!l.ready) await signIn(c, spec);
  let res = await open();
  if (res.status === 401 || res.status === 403) {
    void res.body.cancel().catch(() => {});
    l.ready = false;
    await signIn(c, spec);
    res = await open();
  }
  if (res.status !== 200 || !res.type.startsWith("multipart/")) {
    void res.body.cancel().catch(() => {});
    throw new AppError("integration.noPicture", res.status === 404 ? 404 : 502);
  }
  return res;
}

// --- Actions ----------------------------------------------------------------------------------------

/** Links, one a line: a magnet, a web address of a .torrent, or a bare hash */
export function cleanLinks(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const links = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!links.length || links.length > 50) return null;
  return links.every((x) => /^magnet:\?\S+$/i.test(x) || /^https?:\/\/\S+$/i.test(x) || /^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(x)) ? links : null;
}

/** A torrent is a bencoded dictionary with an `info` in it */
export function isTorrentFile(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes.length > MAX_TORRENT || bytes[0] !== 0x64) return false;
  return Buffer.from(bytes).includes("4:info");
}

export interface Doing {
  ids?: unknown;
  /** What the action asks, by name; a file is base64 */
  input?: Record<string, unknown>;
}

/** An action of a description, done as it says; `level` is the caller's, for agents */
export async function act(id: string, name: string, doing: Doing, by: string, level: "operate" | "full" = "full"): Promise<{ ok: true; done: string[] }> {
  const c = connectionOf(id);
  const spec = specOf(c.kind);
  const a = spec.actions[name];
  if (!a) throw new AppError("integration.notFound", 404);
  if (a.level === "full" && level !== "full") throw new AppError("integration.level", 403);
  const vars: Record<string, unknown> = { ...valuesNow(c) };
  const names: string[] = [];
  if (a.on) {
    const list = spec.read[a.on]!;
    const asked = Array.isArray(doing.ids) ? doing.ids.map(String) : [];
    if (!asked.length || asked.length > MAX_IDS) throw new AppError("integration.badInput", 400, { field: "ids" });
    const rows = asked.map((k) => rowFor(c, a.on!, k, "integration.noRow"));
    if (a.when && !rows.every((r) => test(a.when!, (f) => r[f]))) throw new AppError("integration.notNow", 409);
    vars.ids = rows.map((r) => r[list.key]);
    vars.id = vars.ids && (vars.ids as Scalar[])[0];
    for (const r of rows) names.push(String(r.name ?? r[list.key]));
  } else if (a.when && !test(a.when, (f) => vars[f])) throw new AppError("integration.notNow", 409);
  const files: Record<string, Uint8Array> = {};
  const input = doing.input ?? {};
  const groups = new Map<string, boolean>();
  for (const q of a.ask) {
    const v = input[q.name];
    let given = false;
    if (q.kind === "check") vars[q.name] = v === true ? "true" : "false";
    else if (q.kind === "file") {
      if (typeof v === "string" && v) {
        const bytes = Buffer.from(v, "base64");
        if (q.check === "torrent" && !isTorrentFile(bytes)) throw new AppError("integration.badInput", 400, { field: q.name });
        files[q.name] = bytes;
        vars[q.name] = "";
        given = true;
      }
    } else if (typeof v === "string" && v.trim()) {
      if (q.kind === "lines" && q.check === "links") {
        const links = cleanLinks(v);
        if (!links) throw new AppError("integration.badInput", 400, { field: q.name });
        vars[q.name] = links;
      } else vars[q.name] = v.slice(0, 2000);
      given = true;
    }
    if (q.group) groups.set(q.group, (groups.get(q.group) ?? false) || given);
  }
  for (const [g, any] of groups) if (!any) throw new AppError("integration.badInput", 400, { field: g });
  const req = chosen(a.requests, vars);
  if (!req) throw new AppError("integration.notNow", 409);
  const got = await call(c, spec, sentOf(req, vars, files));
  if (got.status < 200 || got.status >= 300 || (a.fails !== undefined && text(got).trim() === a.fails)) throw new AppError("integration.refused", 502, { status: got.status });
  record("integration.did", { user: by, detail: `${c.name} — ${say(a.label, settings.language || "en")}${names.length ? `: ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}` : ""}` });
  void look(c, true);
  return { ok: true, done: names };
}

// --- Attention --------------------------------------------------------------------------------------

export function integrationTrouble(lang = settings.language || "en", now = Date.now()): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const c of state.connections) {
    const l = liveOf(c);
    const spec = specs.get(c.kind)?.spec;
    const base = { host: c.id, name: c.name, kind: spec?.title ?? c.kind };
    if (l.error) {
      const sure = ["integration.badLogin", "integration.banned", "integration.certChanged"].includes(l.error.code);
      if (sure) out.push({ id: `x:${c.id}`, severity: "danger", code: l.error.code, detail: base });
      else if (now - l.error.since > AWAY_MS) out.push({ id: `x:${c.id}`, severity: "warn", code: "integration.away", detail: base });
      continue;
    }
    if (!spec || !l.at) continue;
    const values = valuesOf(spec, l.answers);
    for (const rule of spec.attention) {
      const words = (vars: Record<string, unknown>) => ({ title: fill(say(rule.title, lang), vars), text: rule.text ? fill(say(rule.text, lang), vars) : "" });
      if (rule.each) {
        for (const row of where((l.answers[rule.each] as Row[]) ?? [], rule.where)) out.push({ id: `x:${c.id}:${rule.id}:${row[spec.read[rule.each]!.key]}`, severity: rule.severity, code: "integration.rule", detail: { ...base, ...words({ ...row, server: c.name }) } });
      } else if (rule.when && test(rule.when, (f) => values[f])) out.push({ id: `x:${c.id}:${rule.id}`, severity: rule.severity, code: "integration.rule", detail: { ...base, ...words({ ...values, server: c.name }) } });
    }
  }
  return out;
}

// --- Connecting -------------------------------------------------------------------------------------

interface Input {
  kind?: unknown;
  name?: unknown;
  url?: unknown;
  user?: unknown;
  password?: unknown;
  token?: unknown;
  fingerprint?: unknown;
}

const words = (value: unknown) => (typeof value === "string" ? value : "");

/** A bare address gets the description's scheme and port */
function cleanAddress(value: unknown, spec: Spec): string | null {
  if (typeof value !== "string") return null;
  let t = value.trim().replace(/\/+$/, "");
  if (!t || /\s/.test(t)) return null;
  const bare = !/^[a-z]+:\/\//i.test(t);
  if (bare) t = `${spec.address.scheme}://${t}`;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search) return null;
  if (bare && !url.port) url.port = String(spec.address.port);
  return url.origin;
}

/** A certificate no authority vouches for is shown to the person first, and kept once confirmed */
async function confirmed(url: string, input: Input, kept = ""): Promise<string> {
  if (!url.startsWith("https:")) return "";
  let shown;
  try {
    shown = await showCertificate(url, CALL_MS);
  } catch (e) {
    throw new AppError("integration.noAnswer", 502, { url, message: e instanceof Error ? e.message : String(e) });
  }
  if (shown.trusted) return "";
  const given = cleanFingerprint(input.fingerprint) ?? kept;
  if (given !== shown.fingerprint) throw new AppError("integration.confirmCert", 409, { fingerprint: shown.fingerprint, subject: shown.subject, issuer: shown.issuer });
  return given;
}

async function tryIt(c: Connection, spec: Spec): Promise<void> {
  live.delete(c.id);
  await signIn(c, spec);
  await look(c, true);
  const l = liveOf(c);
  if (l.error) throw new AppError(l.error.code, 502, { url: c.url, message: l.error.message });
}

export async function connect(input: Input, by: string) {
  const kind = words(input.kind);
  if (!SPEC_ID.test(kind)) throw new AppError("integration.unknownKind", 404, { kind });
  const spec = specFor(kind);
  const url = cleanAddress(input.url, spec);
  if (!url) throw new AppError("integration.badUrl", 400);
  if (state.connections.some((x) => x.kind === kind && x.url === url)) throw new AppError("integration.exists", 409);
  const fingerprint = await confirmed(url, input);
  const c: Connection = { id: newId(state.connections), kind, name: cleanName(input.name, spec.title), url, user: words(input.user).trim(), password: words(input.password), token: words(input.token).trim(), fingerprint, added: Date.now(), by };
  try {
    await tryIt(c, spec);
  } catch (e) {
    live.delete(c.id);
    throw e;
  }
  state.connections.push(c);
  save();
  record("integration.added", { user: by, detail: `${spec.title}: ${c.name} (${url})` });
  return summary(c);
}

export async function changeConnection(id: string, input: Input, by: string) {
  const c = connectionOf(id);
  const spec = specOf(c.kind);
  const url = input.url === undefined ? c.url : cleanAddress(input.url, spec);
  if (!url) throw new AppError("integration.badUrl", 400);
  if (url !== c.url && state.connections.some((x) => x.id !== id && x.kind === c.kind && x.url === url)) throw new AppError("integration.exists", 409);
  // the same address keeps the confirmed certificate; another one is asked about again
  const fingerprint = await confirmed(url, input, url === c.url ? c.fingerprint : "");
  // an empty password or token keeps the one saved
  const next: Connection = { ...c, url, fingerprint, name: cleanName(input.name, c.name), user: input.user === undefined ? c.user : words(input.user).trim(), password: words(input.password) || c.password, token: words(input.token).trim() || c.token };
  await tryIt(next, spec);
  Object.assign(c, next);
  save();
  record("integration.changed", { user: by, detail: `${spec.title}: ${c.name}` });
  return summary(c);
}

export function disconnect(id: string, by: string): void {
  const c = connectionOf(id);
  live.delete(c.id);
  state.connections = state.connections.filter((x) => x.id !== id);
  save();
  record("integration.removed", { user: by, detail: `${specs.get(c.kind)?.spec.title ?? c.kind}: ${c.name}` });
  // a description nothing uses any more is let go: the store's newest is taken at the next connection
  if (!state.connections.some((x) => x.kind === c.kind)) {
    specs.delete(c.kind);
    rmSync(join(SPECS_DIR, `${c.kind}.json`), { force: true });
  }
}

// --- From before descriptions -----------------------------------------------------------------------

/**
 * qBittorrent and Frigate were built into Hata before; their connections become connections of their
 * descriptions with the same ids, so Home's widgets and the activity keep pointing at them.
 */
export function moveOldConnections(): { moved: Record<string, string> } {
  const moved: Record<string, string> = {};
  const old = [
    { file: join(SECRETS_DIR, "qbittorrent.json"), kind: "qbittorrent", seed: qbitSeed },
    { file: join(SECRETS_DIR, "frigate.json"), kind: "frigate", seed: frigateSeed },
  ];
  for (const o of old) {
    if (!existsSync(o.file)) continue;
    const was = new Set(state.moved ?? []);
    const before = readJsonFile<{ servers: { id: string; name: string; url: string; user: string; password: string; fingerprint?: string; added: number; by: string }[] }>(o.file, { servers: [] });
    const left = before.servers.filter((s) => !was.has(s.id) && !state.connections.some((x) => x.id === s.id));
    if (!left.length) continue;
    if (!specs.has(o.kind)) keepSpec(o.seed, "");
    for (const s of left) {
      state.connections.push({ id: s.id, kind: o.kind, name: s.name, url: s.url, user: s.user, password: s.password, token: "", fingerprint: s.fingerprint ?? "", added: s.added, by: s.by });
      moved[s.id] = o.kind;
    }
    // the old file stays for a way back to the version before; what was taken over is not taken again
    state.moved = [...was, ...left.map((s) => s.id)];
    save();
  }
  return { moved };
}

export { SpecError };

// taken over as soon as Hata starts, before anything counts the connections
if (!process.env.HATA_NO_MOVE) moveOldConnections();
