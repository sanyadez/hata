/**
 * An integration as a store describes it: how to sign in to a service, what to read from its API, how to
 * show it and what may be done to it. A description is data only — nothing in it runs. Hata does the
 * requests itself, only to the address the person gave, and only with the paths written here.
 *
 * The building blocks (ways to sign in, formats, blocks of a page, kinds of widgets) are Hata's; a new
 * one comes with a new version of Hata, never from a store. `format` says which set a description needs.
 *
 * Pure: `readSpec` turns parsed YAML into a `Spec` or says everything that is wrong with it. The store's
 * own check runs this very function.
 */

export const FORMAT = 1;

/** Texts are `{ en, uk }`; a plain string is English */
export type Text = Record<string, string>;

export type Format = "text" | "mono" | "number" | "bytes" | "rate" | "percent" | "progress" | "duration" | "time" | "ago" | "ratio" | "bool";
export const FORMATS: readonly Format[] = ["text", "mono", "number", "bytes", "rate", "percent", "progress", "duration", "time", "ago", "ratio", "bool"];
/** How a state is coloured: the page's own state chips */
export type Tone = "running" | "stopped" | "restarting" | "";
const TONES: readonly string[] = ["running", "stopped", "restarting", ""];
export type ValueType = "text" | "number" | "bool" | "list";

/** A value inside one answer: a dotted path, `$key` (the name an entry has in an object), `@source.path` (another source's answer) */
export type Field =
  | string
  | {
      from?: string;
      /** The first of these that has a value of the type */
      first?: string[];
      type?: ValueType;
      /** What is taken away and what it is divided by, before `times`: a part done out of a whole */
      minus?: string;
      over?: string;
      times?: number;
      round?: number;
      map?: Record<string, string | number | boolean>;
      else?: string | number | boolean | null;
      /** Outside this the value is "not known" */
      between?: [number, number];
      /** A yes or no */
      test?: Cond;
      /** Yes when the value is the same as this other one (a path, often `@source.path`) */
      equals?: string;
    };

export type Cond =
  | { field: string; in?: (string | number | boolean)[]; is?: string | number | boolean | null; gt?: number; lt?: number; atLeast?: string }
  | { any: Cond[] }
  | { all: Cond[] }
  | { not: Cond };

/** A request to the service. `{name}` puts a value in; in a path and a query it is encoded */
export interface Req {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  form?: Record<string, string>;
  json?: unknown;
  multipart?: Record<string, string>;
  /** Of several requests the first whose condition the values meet is made */
  when?: Cond;
}

export interface Source {
  /** Made by itself, or read out of another source's answer (`from`) with it */
  request?: Req;
  from?: string;
  /** Seconds between two reads; 0 — only when a page asks (then with its `params`) */
  every: number;
  /** The answer is text, kept as it is */
  text: boolean;
  /** The answer is Prometheus' text format: samples `{ name, labels, value }` */
  prometheus: boolean;
  /** Only the rows that meet it are kept */
  where?: Cond;
  /** Where the list is in the answer; "" — the answer itself. An object's entries become rows, its keys `$key` */
  list?: string;
  /** The field that tells rows apart */
  key: string;
  fields: Record<string, Field>;
  /** What a page may ask with; a regular read goes without them */
  params: Record<string, { kind: "name" | "number"; max?: number; default?: number }>;
  /** What it holds is about people: only a full key reads it through MCP, and only by asking each time */
  private: boolean;
  /** Rows kept after a read, for their pictures to be asked for later */
  keep: number;
}

export type Value = { from: string; over?: string; times?: number; round?: number } | { sum: string; where?: Cond } | { count: string; where?: Cond } | { first: string; field: string; where?: Cond; sort?: Sort[] };
export interface Sort {
  field: string;
  desc?: boolean;
}

export interface Picture {
  of: string;
  request: Req;
  /** Frames as they come (MJPEG); `{height}` and `{fps}` are Hata's */
  stream: boolean;
  /** Live video by WebRTC, tried before the frames: the browser's offer goes to this request as `{ type: "offer", sdp }`
   *  and its JSON answer (`{ type: "answer", sdp }`, as go2rtc gives) back; the video itself goes straight between them */
  webrtc?: Req;
  when?: Cond;
}

export interface Input {
  name: string;
  kind: "check" | "text" | "lines" | "file";
  label: Text;
  hint?: Text;
  /** What a file or the lines must be; Hata knows these */
  check?: "torrent" | "links";
  /** One of the inputs of the same group is enough */
  group?: string;
}

export interface Action {
  label: Text;
  icon: string;
  /** The rows it is done to; none — to the whole service */
  on?: string;
  /** For which rows it is offered */
  when?: Cond;
  effect: "change" | "destroy";
  /** What an agent's key must be to do it */
  level: "operate" | "full";
  confirm?: { title: Text; lead?: Text };
  ask: Input[];
  requests: Req[];
  /** Said when it is done */
  done?: Text;
  /** An answer of 200 with these words is a refusal all the same */
  fails?: string;
  /** What a JSON answer says when it went well; anything else there is a refusal, worded with it */
  ok?: { json: string; is: string };
}

export interface Column {
  label?: Text;
  field: string;
  as: Format;
  /** A state's words and colour */
  words?: string;
  under?: { field: string; as: Format };
  /** Words shown with it, a template of the row */
  note?: string;
}

export type Block =
  | { numbers: { label: Text; value: string; as: Format }[] }
  | { table: { of: string; title?: Text; columns: Column[]; search: string[]; tabs?: { field: string; values: string[]; words: string }; actions: string[]; limit: number; empty?: Text } }
  | { pictures: { of: string; title?: Text; picture: string; live?: string; caption: string; note?: string; off?: Cond } }
  | { events: { of: string; title?: Text; picture: string; open?: string; name: string; note?: string; filters: { param: string; label: Text; options?: string }[]; empty?: Text } };

export type Widget =
  | {
      kind: "summary";
      label: Text;
      /** A number's own words under it, when the number alone says nothing ("5 up") */
      numbers: { value: string; as: Format; label?: Text }[];
      /** `state` is a row's field told by a group of words (a coloured mark), `note` a template said at the right */
      list?: { of: string; where?: Cond; sort: Sort[]; title: string; bar?: string; state?: { field: string; words: string }; note?: string; limit: number };
    }
  | { kind: "picture"; label: Text; of: string; picture: string; live?: string; caption: string }
  | { kind: "pictures"; label: Text; of: string; picture: string; caption: string; note?: string };

export interface Rule {
  id: string;
  /** A condition of the values, or one item a row of `each` meeting `where` */
  when?: Cond;
  each?: string;
  where?: Cond;
  severity: "warn" | "danger";
  title: Text;
  text?: Text;
}

export interface SignIn {
  ask: ("user" | "password" | "token")[];
  /** Where the person finds what is asked: an API key's place in the service's settings */
  hint?: Text;
  defaults: { user?: string };
  /** What tells this service from whatever else answers there; kept as the source `check` */
  check: { request: Req; is: "version" | "ok" | { json: string } };
  /** Sent with every request */
  headers: Record<string, string>;
  basic: boolean;
  login?: { request: Req; cookie?: string[]; session?: { json: string; header: string }; refused: { status: number[]; text?: string }; banned: number[] };
  /** The service gives a token on a refusal and wants it back (Transmission) */
  handshake?: { status: number; header: string };
  /** A refused sign-in is not tried again by itself: the service would lock the address out */
  once: boolean;
  /** Host, Origin and Referer without the port: for services that compare them with their own port inside a container */
  host: "as-is" | "bare";
}

export interface Spec {
  format: number;
  id: string;
  version: number;
  /** The least Hata that reads it */
  requires: string;
  title: string;
  icon: string;
  what: Text;
  /** Store apps that run it, and pieces of image names: what makes "found on this server" */
  apps: string[];
  images: string[];
  address: { scheme: "http" | "https"; port: number; path: string };
  signIn: SignIn;
  read: Record<string, Source>;
  values: Record<string, Value>;
  words: Record<string, Record<string, { label: Text; tone: Tone }>>;
  pictures: Record<string, Picture>;
  actions: Record<string, Action>;
  page: Block[];
  widgets: Record<string, Widget>;
  /** Words on the tile of the app it is, a template of the values */
  tile?: string;
  /** The widget the app's own page shows */
  appCard?: string;
  attention: Rule[];
}

// --- Reading ----------------------------------------------------------------------------------------

export class SpecError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("; "));
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
export const SPEC_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ICON = /^[a-z][a-z0-9-]{0,23}$/;
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const COOKIE = /^[A-Za-z0-9_.-]{1,64}$/;
/** A path inside the service: no other host, no way up, nothing a URL would read twice */
const PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/{}|-]*$/;
const PLACE = /\{([A-Za-z_$@][A-Za-z0-9_.$@]*)(\|[a-z]+)?\}/g;
const TEMPLATE_FORMATS = new Set(["pipe", "lines", "comma", "lower", "basic", "bytes", "rate", "percent", "number", "duration", "time", "ago"]);

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

class Reader {
  problems: string[] = [];
  bad(at: string, what: string) {
    this.problems.push(`${at}: ${what}`);
  }
  obj(v: unknown, at: string): Raw {
    if (v === undefined || v === null) return {};
    if (!isObject(v)) this.bad(at, "must be a mapping");
    return isObject(v) ? v : {};
  }
  list(v: unknown, at: string): unknown[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) this.bad(at, "must be a list");
    return Array.isArray(v) ? v : [];
  }
  str(v: unknown, at: string, re?: RegExp, max = 200): string {
    if (typeof v === "number") v = String(v);
    if (typeof v !== "string" || !v || v.length > max) return this.bad(at, `must be text up to ${max} characters`), "";
    if (re && !re.test(v)) this.bad(at, `"${v}" is not allowed here`);
    return v;
  }
  optStr(v: unknown, at: string, re?: RegExp, max = 200) {
    return v === undefined || v === null ? undefined : this.str(v, at, re, max);
  }
  num(v: unknown, at: string, min: number, max: number, fallback?: number): number {
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return this.bad(at, `must be a number from ${min} to ${max}`), fallback ?? min;
    return v;
  }
  bool(v: unknown, at: string): boolean {
    if (v === undefined) return false;
    if (typeof v !== "boolean") this.bad(at, "must be true or false");
    return v === true;
  }
  text(v: unknown, at: string, max = 300): Text {
    if (typeof v === "string") return { en: this.str(v, at, undefined, max) };
    const o = this.obj(v, at);
    if (typeof o.en !== "string") this.bad(at, "needs an English text, `en`");
    const out: Text = {};
    for (const [lang, s] of Object.entries(o)) {
      if (!/^[a-z]{2}$/.test(lang)) this.bad(`${at}.${lang}`, "a language is two letters");
      out[lang] = this.str(s, `${at}.${lang}`, undefined, max);
    }
    return out;
  }
  optText(v: unknown, at: string, max = 300) {
    return v === undefined || v === null ? undefined : this.text(v, at, max);
  }
  /** A template: text with `{name}` places, each a known name */
  template(v: unknown, at: string, known: (name: string) => boolean, max = 300): string {
    const s = this.str(v, at, undefined, max);
    for (const m of s.matchAll(PLACE)) {
      if (!known(m[1]!)) this.bad(at, `{${m[1]}} is nothing known here`);
      if (m[2] && !TEMPLATE_FORMATS.has(m[2].slice(1))) this.bad(at, `"${m[2].slice(1)}" is not a format`);
    }
    const left = s.replace(PLACE, "");
    if (/[{}]/.test(left)) this.bad(at, "a brace that is not a place: {name}");
    return s;
  }
}

function readCond(r: Reader, v: unknown, at: string, known: (field: string) => boolean): Cond {
  const o = r.obj(v, at);
  if ("any" in o || "all" in o) {
    const key = "any" in o ? "any" : "all";
    const list = r.list(o[key], `${at}.${key}`).map((c, i) => readCond(r, c, `${at}.${key}[${i}]`, known));
    if (!list.length) r.bad(at, `${key} needs conditions`);
    return key === "any" ? { any: list } : { all: list };
  }
  if ("not" in o) return { not: readCond(r, o.not, `${at}.not`, known) };
  const field = r.str(o.field, `${at}.field`);
  if (field && !known(field)) r.bad(`${at}.field`, `"${field}" is no field here`);
  const out: Cond = { field };
  const scalar = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
  if (o.in !== undefined) {
    const list = r.list(o.in, `${at}.in`);
    if (!list.every(scalar)) r.bad(`${at}.in`, "holds text, numbers or true / false");
    out.in = list as (string | number | boolean)[];
  }
  if (o.is !== undefined) {
    if (o.is !== null && !scalar(o.is)) r.bad(`${at}.is`, "is text, a number, true / false or null");
    out.is = o.is as string | number | boolean | null;
  }
  if (o.gt !== undefined) out.gt = r.num(o.gt, `${at}.gt`, -1e15, 1e15);
  if (o.lt !== undefined) out.lt = r.num(o.lt, `${at}.lt`, -1e15, 1e15);
  if (o.atLeast !== undefined) out.atLeast = r.str(o.atLeast, `${at}.atLeast`, /^\d+(\.\d+){0,3}$/);
  if (Object.keys(out).length < 2) r.bad(at, "says nothing to compare with: in, is, gt, lt or atLeast");
  for (const k of Object.keys(o)) if (!["field", "in", "is", "gt", "lt", "atLeast"].includes(k)) r.bad(`${at}.${k}`, "is not a part of a condition");
  return out;
}

function readReq(r: Reader, v: unknown, at: string, known: (name: string) => boolean, allowCond = false, valueNames: (n: string) => boolean = () => false): Req {
  const o = r.obj(v, at);
  const method = (o.method ?? "GET") as Req["method"];
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) r.bad(`${at}.method`, "is GET, POST, PUT, PATCH or DELETE");
  const path = r.template(o.path, `${at}.path`, known);
  if (path && (!PATH.test(path) || path.includes("..") || path.includes("\\"))) r.bad(`${at}.path`, "must be a path inside the service, starting with /");
  const out: Req = { method, path };
  const flat = (x: unknown, where: string) => {
    const m = r.obj(x, where);
    const res: Record<string, string> = {};
    for (const [k, val] of Object.entries(m)) res[r.str(k, `${where} key`, /^[A-Za-z0-9_.[\]-]{1,64}$/)] = r.template(typeof val === "number" || typeof val === "boolean" ? String(val) : val, `${where}.${k}`, known);
    return res;
  };
  if (o.query !== undefined) out.query = flat(o.query, `${at}.query`);
  const bodies = ["form", "json", "multipart"].filter((k) => o[k] !== undefined);
  if (bodies.length > 1) r.bad(at, "has one body: form, json or multipart");
  if (bodies.length && method === "GET") r.bad(at, "a GET has no body");
  if (o.form !== undefined) out.form = flat(o.form, `${at}.form`);
  if (o.multipart !== undefined) out.multipart = flat(o.multipart, `${at}.multipart`);
  if (o.json !== undefined) {
    const walk = (x: unknown, where: string): unknown => {
      if (typeof x === "string") return r.template(x, where, known, 2000);
      if (Array.isArray(x)) return x.map((y, i) => walk(y, `${where}[${i}]`));
      if (isObject(x)) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, `${where}.${k}`)]));
      return x;
    };
    out.json = walk(o.json, `${at}.json`);
  }
  if (o.when !== undefined) {
    if (!allowCond) r.bad(`${at}.when`, "a condition belongs to one of several requests");
    else out.when = readCond(r, o.when, `${at}.when`, valueNames);
  }
  for (const k of Object.keys(o)) if (!["method", "path", "query", "form", "json", "multipart", "when"].includes(k)) r.bad(`${at}.${k}`, "is not a part of a request");
  return out;
}

function readField(r: Reader, v: unknown, at: string): Field {
  if (typeof v === "string") return r.str(v, at);
  const o = r.obj(v, at);
  const out: Exclude<Field, string> = {};
  if (o.from !== undefined) out.from = r.str(o.from, `${at}.from`);
  if (o.first !== undefined) out.first = r.list(o.first, `${at}.first`).map((x, i) => r.str(x, `${at}.first[${i}]`));
  if (o.type !== undefined) {
    if (!["text", "number", "bool", "list"].includes(String(o.type))) r.bad(`${at}.type`, "is text, number, bool or list");
    out.type = o.type as ValueType;
  }
  if (o.minus !== undefined) out.minus = r.str(o.minus, `${at}.minus`);
  if (o.over !== undefined) out.over = r.str(o.over, `${at}.over`);
  if (o.times !== undefined) out.times = r.num(o.times, `${at}.times`, -1e9, 1e9);
  if (o.round !== undefined) out.round = r.num(o.round, `${at}.round`, 0, 6);
  if (o.map !== undefined) out.map = r.obj(o.map, `${at}.map`) as Record<string, string>;
  if (o.else !== undefined) out.else = o.else as string;
  if (o.between !== undefined) {
    const b = r.list(o.between, `${at}.between`);
    if (b.length !== 2 || !b.every((x) => typeof x === "number")) r.bad(`${at}.between`, "is two numbers");
    out.between = b as [number, number];
  }
  if (o.test !== undefined) out.test = readCond(r, o.test, `${at}.test`, () => true);
  if (o.equals !== undefined) out.equals = r.str(o.equals, `${at}.equals`);
  if (!out.from && !out.first && !out.test) r.bad(at, "says where the value is: from, first or test");
  for (const k of Object.keys(o)) if (!["from", "first", "type", "minus", "over", "times", "round", "map", "else", "between", "test", "equals"].includes(k)) r.bad(`${at}.${k}`, "is not a part of a field");
  return out;
}

function readFormat(r: Reader, v: unknown, at: string): Format {
  if (v === undefined) return "text";
  if (!FORMATS.includes(v as Format)) r.bad(at, `is one of ${FORMATS.join(", ")}`);
  return v as Format;
}

function readSorts(r: Reader, v: unknown, at: string, known: (f: string) => boolean): Sort[] {
  return r.list(v, at).map((x, i) => {
    const o = r.obj(x, `${at}[${i}]`);
    const field = r.str(o.field, `${at}[${i}].field`);
    if (field && !known(field)) r.bad(`${at}[${i}].field`, `"${field}" is no field here`);
    return { field, ...(o.desc === true ? { desc: true } : {}) };
  });
}

export function readSpec(raw: unknown): Spec {
  const r = new Reader();
  const o = r.obj(raw, "integration");
  const format = r.num(o.format, "format", 1, 1000);
  if (format > FORMAT) r.bad("format", `this Hata reads format ${FORMAT}`);
  const id = r.str(o.id, "id", SPEC_ID, 40);
  const version = r.num(o.version, "version", 1, 1e6, 1);
  const requires = o.requires === undefined ? "0.0.0" : r.str(o.requires, "requires", /^\d+\.\d+\.\d+$/);
  const title = r.str(o.title, "title", undefined, 40);
  const icon = r.str(o.icon ?? "plug", "icon", ICON);
  const what = r.text(o.what, "what", 200);
  const apps = r.list(o.apps, "apps").map((x, i) => r.str(x, `apps[${i}]`, /^[a-z0-9][a-z0-9-]{0,63}$/));
  const images = r.list(o.images, "images").map((x, i) => r.str(x, `images[${i}]`, /^[a-z0-9][a-z0-9._/-]{1,99}$/));
  const ad = r.obj(o.address, "address");
  const address = { scheme: (ad.scheme ?? "http") as "http" | "https", port: r.num(ad.port, "address.port", 1, 65535), path: ad.path === undefined ? "" : r.str(ad.path, "address.path", /^\/[A-Za-z0-9._~/-]*$/) };
  if (!["http", "https"].includes(address.scheme)) r.bad("address.scheme", "is http or https");

  const people = new Set(["user", "password", "token"]);
  const si = r.obj(o.signIn, "signIn");
  const ask = r.list(si.ask, "signIn.ask").map((x, i) => {
    if (!people.has(String(x))) r.bad(`signIn.ask[${i}]`, "is user, password or token");
    return x as "user" | "password" | "token";
  });
  const asked = (n: string) => ask.includes(n as "user");
  const chk = r.obj(si.check, "signIn.check");
  const is = chk.is === "version" || chk.is === "ok" ? chk.is : isObject(chk.is) ? { json: r.str(chk.is.json, "signIn.check.is.json") } : (r.bad("signIn.check.is", "is version, ok or { json: path }"), "ok" as const);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.obj(si.headers, "signIn.headers"))) {
    r.str(k, "signIn.headers key", HEADER);
    if (/^(host|cookie|content-length|transfer-encoding|connection|origin|referer)$/i.test(k)) r.bad(`signIn.headers.${k}`, "is Hata's to send");
    headers[k] = r.template(v, `signIn.headers.${k}`, asked);
  }
  let login: SignIn["login"];
  if (si.login !== undefined) {
    const l = r.obj(si.login, "signIn.login");
    const refused = r.obj(l.refused, "signIn.login.refused");
    login = {
      request: readReq(r, l.request, "signIn.login.request", asked),
      ...(l.cookie !== undefined ? { cookie: r.list(l.cookie, "signIn.login.cookie").map((x, i) => r.str(x, `signIn.login.cookie[${i}]`, COOKIE)) } : {}),
      ...(l.session !== undefined ? { session: { json: r.str(r.obj(l.session, "signIn.login.session").json, "signIn.login.session.json"), header: r.str(r.obj(l.session, "signIn.login.session").header, "signIn.login.session.header", HEADER) } } : {}),
      refused: { status: r.list(refused.status ?? [401], "signIn.login.refused.status").map((x, i) => r.num(x, `signIn.login.refused.status[${i}]`, 200, 599)), ...(refused.text !== undefined ? { text: r.str(refused.text, "signIn.login.refused.text", undefined, 100) } : {}) },
      banned: r.list(l.banned, "signIn.login.banned").map((x, i) => r.num(x, `signIn.login.banned[${i}]`, 400, 599)),
    };
    if (!login.cookie && !login.session) r.bad("signIn.login", "says what keeps the session: cookie or session");
  }
  let handshake: SignIn["handshake"];
  if (si.handshake !== undefined) {
    const hs = r.obj(si.handshake, "signIn.handshake");
    handshake = { status: r.num(hs.status, "signIn.handshake.status", 400, 499), header: r.str(hs.header, "signIn.handshake.header", HEADER) };
  }
  const basic = r.bool(si.basic, "signIn.basic");
  if (basic && !(asked("user") && asked("password"))) r.bad("signIn.basic", "asks for a user and a password");
  const defaults = r.obj(si.defaults, "signIn.defaults");
  const signIn: SignIn = {
    ask,
    ...(si.hint !== undefined ? { hint: r.text(si.hint, "signIn.hint") } : {}),
    defaults: defaults.user !== undefined ? { user: r.str(defaults.user, "signIn.defaults.user", undefined, 64) } : {},
    check: { request: readReq(r, chk.request, "signIn.check.request", () => false), is },
    headers,
    basic,
    ...(login ? { login } : {}),
    ...(handshake ? { handshake } : {}),
    once: r.bool(si.once, "signIn.once"),
    host: si.host === "bare" ? "bare" : (si.host !== undefined && si.host !== "as-is" && r.bad("signIn.host", "is as-is or bare"), "as-is"),
  };

  // sources, then what refers to them
  const read: Record<string, Source> = { };
  const rd = r.obj(o.read, "read");
  if (rd.check !== undefined) r.bad("read.check", "is the answer of signIn.check");
  const sourceNames = ["check", ...Object.keys(rd)];
  for (const [name, v] of Object.entries(rd)) {
    const at = `read.${name}`;
    r.str(name, at, NAME);
    const s = r.obj(v, at);
    const params: Source["params"] = {};
    for (const [p, pv] of Object.entries(r.obj(s.params, `${at}.params`))) {
      r.str(p, `${at}.params`, NAME);
      const po = r.obj(pv, `${at}.params.${p}`);
      if (po.kind !== "name" && po.kind !== "number") r.bad(`${at}.params.${p}.kind`, "is name or number");
      params[p] = { kind: po.kind === "number" ? "number" : "name", ...(po.max !== undefined ? { max: r.num(po.max, `${at}.params.${p}.max`, 1, 1e12) } : {}), ...(po.default !== undefined ? { default: r.num(po.default, `${at}.params.${p}.default`, 0, 1e12) } : {}) };
    }
    const fields: Record<string, Field> = {};
    for (const [f, fv] of Object.entries(r.obj(s.fields, `${at}.fields`))) {
      r.str(f, `${at}.fields`, NAME);
      fields[f] = readField(r, fv, `${at}.fields.${f}`);
    }
    const text = r.bool(s.text, `${at}.text`);
    const prometheus = r.bool(s.prometheus, `${at}.prometheus`);
    if (text && prometheus) r.bad(at, "is text or prometheus, not both");
    const list = s.list === undefined ? undefined : s.list === "" ? "" : r.str(s.list, `${at}.list`);
    if (list !== undefined && !Object.keys(fields).length) r.bad(at, "a list needs fields");
    const key = s.key === undefined ? "id" : r.str(s.key, `${at}.key`, NAME);
    if (list !== undefined && !(key in fields)) r.bad(`${at}.key`, `"${key}" is not one of the fields`);
    const every = r.num(s.every, `${at}.every`, 0, 86_400, 30);
    if (every > 0 && every < 5) r.bad(`${at}.every`, "is 5 seconds at least, or 0");
    let from: string | undefined;
    if (s.from !== undefined) {
      from = r.str(s.from, `${at}.from`, NAME);
      const parent = rd[from];
      if (from !== "check" && (!isObject(parent) || parent.from !== undefined || parent.list !== undefined)) r.bad(`${at}.from`, `"${from}" is no source read by itself that is not a list`);
      if (s.request !== undefined) r.bad(at, "is read by itself (request) or out of another (from), not both");
    }
    read[name] = {
      ...(from ? { from } : { request: readReq(r, s.request, `${at}.request`, (n) => n in params) }),
      every,
      text,
      prometheus,
      ...(list !== undefined ? { list } : {}),
      key,
      fields,
      params,
      private: r.bool(s.private, `${at}.private`),
      keep: r.num(s.keep, `${at}.keep`, 0, 5000, list !== undefined ? 500 : 0),
    };
    if (s.where !== undefined) {
      if (list === undefined) r.bad(`${at}.where`, "keeps rows of a list");
      else read[name]!.where = readCond(r, s.where, `${at}.where`, (f) => f in fields);
    }
  }
  const isList = (n: string) => read[n]?.list !== undefined;
  const fieldsOf = (n: string) => (f: string) => f in (read[n]?.fields ?? {});
  const listOf = (n: unknown, at: string) => {
    const s = r.str(n, at);
    if (s && !isList(s)) r.bad(at, `"${s}" is no list of read`);
    return s;
  };

  const values: Record<string, Value> = {};
  for (const [name, v] of Object.entries(r.obj(o.values, "values"))) {
    const at = `values.${name}`;
    r.str(name, at, NAME);
    const x = r.obj(v, at);
    if (x.from !== undefined) {
      const from = r.str(x.from, `${at}.from`);
      if (!from.startsWith("@") || !sourceNames.includes(from.slice(1).split(".")[0]!)) r.bad(`${at}.from`, "is @<source>[.path]");
      values[name] = { from };
      // a share of a whole: blocked out of all the questions
      if (x.over !== undefined) {
        const over = r.str(x.over, `${at}.over`);
        if (!over.startsWith("@") || !sourceNames.includes(over.slice(1).split(".")[0]!)) r.bad(`${at}.over`, "is @<source>[.path]");
        (values[name] as { over?: string }).over = over;
      }
      if (x.times !== undefined) (values[name] as { times?: number }).times = r.num(x.times, `${at}.times`, -1e9, 1e9);
      if (x.round !== undefined) (values[name] as { round?: number }).round = r.num(x.round, `${at}.round`, 0, 6);
    } else if (x.sum !== undefined) {
      const [list = "", field = ""] = r.str(x.sum, `${at}.sum`).split(".");
      if (!isList(list) || !fieldsOf(list)(field)) r.bad(`${at}.sum`, "is <list>.<field>");
      values[name] = { sum: `${list}.${field}`, ...(x.where !== undefined ? { where: readCond(r, x.where, `${at}.where`, fieldsOf(list)) } : {}) };
    } else if (x.count !== undefined) {
      const list = listOf(x.count, `${at}.count`);
      values[name] = { count: list, ...(x.where !== undefined ? { where: readCond(r, x.where, `${at}.where`, fieldsOf(list)) } : {}) };
    } else if (x.first !== undefined) {
      const list = listOf(x.first, `${at}.first`);
      const field = r.str(x.field, `${at}.field`);
      if (!fieldsOf(list)(field)) r.bad(`${at}.field`, `"${field}" is no field of ${list}`);
      values[name] = { first: list, field, ...(x.where !== undefined ? { where: readCond(r, x.where, `${at}.where`, fieldsOf(list)) } : {}), ...(x.sort !== undefined ? { sort: readSorts(r, x.sort, `${at}.sort`, fieldsOf(list)) } : {}) };
    } else r.bad(at, "is from, sum, count or first");
  }
  const valueNames = (n: string) => n in values;

  const wordsOut: Spec["words"] = {};
  for (const [group, v] of Object.entries(r.obj(o.words, "words"))) {
    r.str(group, `words.${group}`, NAME);
    wordsOut[group] = {};
    for (const [value, w] of Object.entries(r.obj(v, `words.${group}`))) {
      const wo = r.obj(w, `words.${group}.${value}`);
      const tone = (wo.tone ?? "") as Tone;
      if (!TONES.includes(tone)) r.bad(`words.${group}.${value}.tone`, "is running, stopped, restarting or empty");
      wordsOut[group][value] = { label: r.text(wo.label, `words.${group}.${value}.label`, 60), tone };
    }
  }
  const wordGroup = (v: unknown, at: string) => {
    const g = r.str(v, at, NAME);
    if (g && !(g in wordsOut)) r.bad(at, `"${g}" is no group of words`);
    return g;
  };

  const pictures: Record<string, Picture> = {};
  for (const [name, v] of Object.entries(r.obj(o.pictures, "pictures"))) {
    const at = `pictures.${name}`;
    r.str(name, at, NAME);
    const p = r.obj(v, at);
    const of = listOf(p.of, `${at}.of`);
    const stream = r.bool(p.stream, `${at}.stream`);
    const known = (n: string) => fieldsOf(of)(n) || n === "height" || (stream && n === "fps");
    pictures[name] = { of, request: readReq(r, p.request, `${at}.request`, known), stream, ...(p.when !== undefined ? { when: readCond(r, p.when, `${at}.when`, fieldsOf(of)) } : {}) };
    if (pictures[name]!.request.method !== "GET") r.bad(`${at}.request.method`, "a picture is a GET");
    if (p.webrtc !== undefined) {
      if (!stream) r.bad(`${at}.webrtc`, "belongs to a stream");
      const offer = readReq(r, p.webrtc, `${at}.webrtc`, fieldsOf(of));
      if (offer.method !== "POST" || offer.form || offer.json !== undefined || offer.multipart) r.bad(`${at}.webrtc`, "is a POST without a body: the offer is its body");
      pictures[name]!.webrtc = offer;
    }
  }
  const pictureOf = (v: unknown, at: string, of: string, stream: boolean) => {
    const n = r.str(v, at, NAME);
    if (n && (!pictures[n] || pictures[n]!.of !== of || pictures[n]!.stream !== stream)) r.bad(at, `"${n}" is no ${stream ? "stream" : "picture"} of ${of}`);
    return n;
  };

  const actions: Record<string, Action> = {};
  for (const [name, v] of Object.entries(r.obj(o.actions, "actions"))) {
    const at = `actions.${name}`;
    r.str(name, at, NAME);
    const a = r.obj(v, at);
    const on = a.on === undefined ? undefined : listOf(a.on, `${at}.on`);
    const ask = r.list(a.ask, `${at}.ask`).map((x, i) => {
      const q = r.obj(x, `${at}.ask[${i}]`);
      const kind = q.kind as Input["kind"];
      if (!["check", "text", "lines", "file"].includes(kind)) r.bad(`${at}.ask[${i}].kind`, "is check, text, lines or file");
      if (q.check !== undefined && q.check !== "torrent" && q.check !== "links") r.bad(`${at}.ask[${i}].check`, "is torrent or links");
      if (kind === "file" && q.check !== "torrent") r.bad(`${at}.ask[${i}].check`, "a file is checked to be something: torrent");
      return {
        name: r.str(q.name, `${at}.ask[${i}].name`, NAME),
        kind,
        label: r.text(q.label, `${at}.ask[${i}].label`, 80),
        ...(q.hint !== undefined ? { hint: r.text(q.hint, `${at}.ask[${i}].hint`) } : {}),
        ...(q.check !== undefined ? { check: q.check as "torrent" } : {}),
        ...(q.group !== undefined ? { group: r.str(q.group, `${at}.ask[${i}].group`, NAME) } : {}),
      } satisfies Input;
    });
    const known = (n: string) => ask.some((q) => q.name === n) || valueNames(n) || (on !== undefined && (n === "ids" || n === "id"));
    // which of several requests is made may hang on the values and on what was given
    const reqs = a.requests !== undefined ? r.list(a.requests, `${at}.requests`).map((x, i) => readReq(r, x, `${at}.requests[${i}]`, known, true, (n) => valueNames(n) || ask.some((q) => q.name === n))) : [readReq(r, a.request, `${at}.request`, known)];
    if (!reqs.length) r.bad(at, "makes a request");
    const effect = a.effect === "destroy" ? "destroy" : (a.effect !== "change" && r.bad(`${at}.effect`, "is change or destroy"), "change");
    const level = a.level === undefined ? (effect === "destroy" ? "full" : "operate") : a.level === "full" ? "full" : (a.level !== "operate" && r.bad(`${at}.level`, "is operate or full"), "operate");
    if (effect === "destroy" && level !== "full") r.bad(`${at}.level`, "what destroys needs a full key");
    const conf = a.confirm === undefined ? undefined : r.obj(a.confirm, `${at}.confirm`);
    actions[name] = {
      label: r.text(a.label, `${at}.label`, 60),
      icon: r.str(a.icon ?? "play", `${at}.icon`, ICON),
      ...(on !== undefined ? { on } : {}),
      ...(a.when !== undefined ? { when: readCond(r, a.when, `${at}.when`, on ? fieldsOf(on) : valueNames) } : {}),
      effect,
      level,
      ...(conf ? { confirm: { title: r.text(conf.title, `${at}.confirm.title`, 120), ...(conf.lead !== undefined ? { lead: r.text(conf.lead, `${at}.confirm.lead`) } : {}) } } : {}),
      ask,
      requests: reqs,
      ...(a.done !== undefined ? { done: r.text(a.done, `${at}.done`, 120) } : {}),
      ...(a.fails !== undefined ? { fails: r.str(a.fails, `${at}.fails`, undefined, 100) } : {}),
      ...(a.ok !== undefined ? { ok: { json: r.str(r.obj(a.ok, `${at}.ok`).json, `${at}.ok.json`), is: r.str(r.obj(a.ok, `${at}.ok`).is, `${at}.ok.is`, undefined, 100) } } : {}),
    };
    if (effect === "destroy" && !conf) r.bad(`${at}.confirm`, "what destroys asks first");
  }

  const rowTemplate = (of: string) => (n: string) => fieldsOf(of)(n);
  const page: Block[] = r.list(o.page, "page").map((x, i) => {
    const at = `page[${i}]`;
    const b = r.obj(x, at);
    const kind = Object.keys(b);
    if (kind.length !== 1) r.bad(at, "is one block: numbers, table, pictures or events");
    if (b.numbers !== undefined)
      return {
        numbers: r.list(b.numbers, `${at}.numbers`).map((n, j) => {
          const no = r.obj(n, `${at}.numbers[${j}]`);
          const value = r.str(no.value, `${at}.numbers[${j}].value`);
          if (value && !valueNames(value)) r.bad(`${at}.numbers[${j}].value`, `"${value}" is no value`);
          return { label: r.text(no.label, `${at}.numbers[${j}].label`, 60), value, as: readFormat(r, no.as, `${at}.numbers[${j}].as`) };
        }),
      };
    if (b.table !== undefined) {
      const t = r.obj(b.table, `${at}.table`);
      const of = listOf(t.of, `${at}.table.of`);
      const f = fieldsOf(of);
      const columns = r.list(t.columns, `${at}.table.columns`).map((c, j) => {
        const co = r.obj(c, `${at}.table.columns[${j}]`);
        const field = r.str(co.field, `${at}.table.columns[${j}].field`);
        if (field && !f(field)) r.bad(`${at}.table.columns[${j}].field`, `"${field}" is no field of ${of}`);
        const under = co.under === undefined ? undefined : r.obj(co.under, `${at}.table.columns[${j}].under`);
        if (under && !f(String(under.field))) r.bad(`${at}.table.columns[${j}].under.field`, "is no field of the list");
        return {
          ...(co.label !== undefined ? { label: r.text(co.label, `${at}.table.columns[${j}].label`, 40) } : {}),
          field,
          as: readFormat(r, co.as, `${at}.table.columns[${j}].as`),
          ...(co.words !== undefined ? { words: wordGroup(co.words, `${at}.table.columns[${j}].words`) } : {}),
          ...(under ? { under: { field: String(under.field), as: readFormat(r, under.as, `${at}.table.columns[${j}].under.as`) } } : {}),
          ...(co.note !== undefined ? { note: r.template(co.note, `${at}.table.columns[${j}].note`, rowTemplate(of)) } : {}),
        } satisfies Column;
      });
      const tabs = t.tabs === undefined ? undefined : r.obj(t.tabs, `${at}.table.tabs`);
      if (tabs && !f(String(tabs.field))) r.bad(`${at}.table.tabs.field`, "is no field of the list");
      const acts = r.list(t.actions, `${at}.table.actions`).map((a, j) => {
        const n = r.str(a, `${at}.table.actions[${j}]`);
        if (n && actions[n]?.on !== of) r.bad(`${at}.table.actions[${j}]`, `"${n}" is no action on ${of}`);
        return n;
      });
      return {
        table: {
          of,
          ...(t.title !== undefined ? { title: r.text(t.title, `${at}.table.title`, 60) } : {}),
          columns,
          search: r.list(t.search, `${at}.table.search`).map((s, j) => {
            const n = r.str(s, `${at}.table.search[${j}]`);
            if (n && !f(n)) r.bad(`${at}.table.search[${j}]`, "is no field of the list");
            return n;
          }),
          ...(tabs ? { tabs: { field: String(tabs.field), values: r.list(tabs.values, `${at}.table.tabs.values`).map((v, j) => r.str(v, `${at}.table.tabs.values[${j}]`)), words: wordGroup(tabs.words, `${at}.table.tabs.words`) } } : {}),
          actions: acts,
          limit: r.num(t.limit, `${at}.table.limit`, 1, 1000, 300),
          ...(t.empty !== undefined ? { empty: r.text(t.empty, `${at}.table.empty`) } : {}),
        },
      };
    }
    if (b.pictures !== undefined) {
      const p = r.obj(b.pictures, `${at}.pictures`);
      const of = listOf(p.of, `${at}.pictures.of`);
      const caption = r.str(p.caption, `${at}.pictures.caption`);
      if (caption && !fieldsOf(of)(caption)) r.bad(`${at}.pictures.caption`, "is no field of the list");
      return {
        pictures: {
          of,
          ...(p.title !== undefined ? { title: r.text(p.title, `${at}.pictures.title`, 60) } : {}),
          picture: pictureOf(p.picture, `${at}.pictures.picture`, of, false),
          ...(p.live !== undefined ? { live: pictureOf(p.live, `${at}.pictures.live`, of, true) } : {}),
          caption,
          ...(p.note !== undefined ? { note: r.template(p.note, `${at}.pictures.note`, rowTemplate(of)) } : {}),
          ...(p.off !== undefined ? { off: readCond(r, p.off, `${at}.pictures.off`, fieldsOf(of)) } : {}),
        },
      };
    }
    if (b.events !== undefined) {
      const e = r.obj(b.events, `${at}.events`);
      const of = listOf(e.of, `${at}.events.of`);
      const params = read[of]?.params ?? {};
      return {
        events: {
          of,
          ...(e.title !== undefined ? { title: r.text(e.title, `${at}.events.title`, 60) } : {}),
          picture: pictureOf(e.picture, `${at}.events.picture`, of, false),
          ...(e.open !== undefined ? { open: pictureOf(e.open, `${at}.events.open`, of, false) } : {}),
          name: r.template(e.name, `${at}.events.name`, rowTemplate(of)),
          ...(e.note !== undefined ? { note: r.template(e.note, `${at}.events.note`, rowTemplate(of)) } : {}),
          filters: r.list(e.filters, `${at}.events.filters`).map((x, j) => {
            const fo = r.obj(x, `${at}.events.filters[${j}]`);
            const param = r.str(fo.param, `${at}.events.filters[${j}].param`);
            if (param && params[param]?.kind !== "name") r.bad(`${at}.events.filters[${j}].param`, `"${param}" is no name param of ${of}`);
            let options: string | undefined;
            if (fo.options !== undefined) {
              options = r.str(fo.options, `${at}.events.filters[${j}].options`);
              const [l = "", fld = ""] = options.split(".");
              if (!isList(l) || !fieldsOf(l)(fld)) r.bad(`${at}.events.filters[${j}].options`, "is <list>.<field>");
            }
            return { param, label: r.text(fo.label, `${at}.events.filters[${j}].label`, 40), ...(options ? { options } : {}) };
          }),
          ...(e.empty !== undefined ? { empty: r.text(e.empty, `${at}.events.empty`) } : {}),
        },
      };
    }
    r.bad(at, "is numbers, table, pictures or events");
    return { numbers: [] };
  });

  const widgets: Record<string, Widget> = {};
  for (const [name, v] of Object.entries(r.obj(o.widgets, "widgets"))) {
    const at = `widgets.${name}`;
    r.str(name, at, /^[a-z][a-z0-9-]{0,31}$/);
    const w = r.obj(v, at);
    const label = r.text(w.label, `${at}.label`, 60);
    if (w.kind === "summary") {
      const l = w.list === undefined ? undefined : r.obj(w.list, `${at}.list`);
      const of = l ? listOf(l.of, `${at}.list.of`) : "";
      widgets[name] = {
        kind: "summary",
        label,
        numbers: r.list(w.numbers, `${at}.numbers`).map((n, j) => {
          const no = r.obj(n, `${at}.numbers[${j}]`);
          const value = r.str(no.value, `${at}.numbers[${j}].value`);
          if (value && !valueNames(value)) r.bad(`${at}.numbers[${j}].value`, `"${value}" is no value`);
          return { value, as: readFormat(r, no.as, `${at}.numbers[${j}].as`), ...(no.label !== undefined ? { label: r.text(no.label, `${at}.numbers[${j}].label`, 30) } : {}) };
        }),
        ...(l
          ? {
              list: {
                of,
                ...(l.where !== undefined ? { where: readCond(r, l.where, `${at}.list.where`, fieldsOf(of)) } : {}),
                sort: readSorts(r, l.sort, `${at}.list.sort`, fieldsOf(of)),
                title: (() => {
                  const t = r.str(l.title, `${at}.list.title`);
                  if (t && !fieldsOf(of)(t)) r.bad(`${at}.list.title`, "is no field of the list");
                  return t;
                })(),
                ...(l.bar !== undefined ? { bar: r.str(l.bar, `${at}.list.bar`) } : {}),
                ...(l.state !== undefined
                  ? {
                      state: (() => {
                        const st = r.obj(l.state, `${at}.list.state`);
                        const field = r.str(st.field, `${at}.list.state.field`);
                        if (field && !fieldsOf(of)(field)) r.bad(`${at}.list.state.field`, "is no field of the list");
                        return { field, words: wordGroup(st.words, `${at}.list.state.words`) };
                      })(),
                    }
                  : {}),
                ...(l.note !== undefined ? { note: r.template(l.note, `${at}.list.note`, fieldsOf(of), 80) } : {}),
                limit: r.num(l.limit, `${at}.list.limit`, 1, 50, 6),
              },
            }
          : {}),
      };
    } else if (w.kind === "picture" || w.kind === "pictures") {
      const of = listOf(w.of, `${at}.of`);
      const caption = r.str(w.caption, `${at}.caption`);
      if (caption && !fieldsOf(of)(caption)) r.bad(`${at}.caption`, "is no field of the list");
      widgets[name] =
        w.kind === "picture"
          ? { kind: "picture", label, of, picture: pictureOf(w.picture, `${at}.picture`, of, false), ...(w.live !== undefined ? { live: pictureOf(w.live, `${at}.live`, of, true) } : {}), caption }
          : { kind: "pictures", label, of, picture: pictureOf(w.picture, `${at}.picture`, of, false), caption, ...(w.note !== undefined ? { note: r.template(w.note, `${at}.note`, rowTemplate(of)) } : {}) };
    } else r.bad(`${at}.kind`, "is summary, picture or pictures");
  }

  const attention: Rule[] = r.list(o.attention, "attention").map((x, i) => {
    const at = `attention[${i}]`;
    const a = r.obj(x, at);
    const each = a.each === undefined ? undefined : listOf(a.each, `${at}.each`);
    // `server` is the connection's own name
    const known = each ? (n: string) => fieldsOf(each)(n) || n === "server" : (n: string) => valueNames(n) || n === "server";
    if (!each && a.when === undefined) r.bad(at, "says when: when (of the values) or each (a list)");
    if (a.severity !== "warn" && a.severity !== "danger") r.bad(`${at}.severity`, "is warn or danger");
    const title = r.text(a.title, `${at}.title`, 120);
    for (const [lang, s] of Object.entries(title)) r.template(s, `${at}.title.${lang}`, known, 120);
    const text = a.text === undefined ? undefined : r.text(a.text, `${at}.text`);
    if (text) for (const [lang, s] of Object.entries(text)) r.template(s, `${at}.text.${lang}`, known);
    return {
      id: r.str(a.id, `${at}.id`, /^[a-z][a-z0-9-]{0,31}$/),
      ...(a.when !== undefined ? { when: readCond(r, a.when, `${at}.when`, valueNames) } : {}),
      ...(each ? { each } : {}),
      ...(a.where !== undefined && each ? { where: readCond(r, a.where, `${at}.where`, fieldsOf(each)) } : {}),
      severity: a.severity === "danger" ? "danger" : "warn",
      title,
      ...(text ? { text } : {}),
    };
  });

  const tile = o.tile === undefined ? undefined : r.template(o.tile, "tile", valueNames, 80);
  const appCard = o.appCard === undefined ? undefined : r.str(o.appCard, "appCard");
  if (appCard && !widgets[appCard]) r.bad("appCard", `"${appCard}" is no widget`);
  for (const k of Object.keys(o))
    if (!["format", "id", "version", "requires", "title", "icon", "what", "apps", "images", "address", "signIn", "read", "values", "words", "pictures", "actions", "page", "widgets", "tile", "appCard", "attention"].includes(k)) r.bad(k, "is not a part of an integration");
  if (r.problems.length) throw new SpecError(r.problems);
  return { format, id, version, requires, title, icon, what, apps, images, address, signIn, read, values, words: wordsOut, pictures, actions, page, widgets, ...(tile ? { tile } : {}), ...(appCard ? { appCard } : {}), attention };
}

