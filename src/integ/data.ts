/**
 * What an integration's description does with the answers: rows out of a list, values out of the rows,
 * conditions, the places of a template filled in. Pure: no network, no disk.
 */
import type { Cond, Field, Req, Sort, Source, Spec, Value } from "./spec";

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar | Scalar[]>;
/** What was read: a source's rows (a list) or its answer (anything else) */
export type Answers = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A dotted path in a value; a number picks from a list */
export function get(value: unknown, path: string): unknown {
  if (!path) return value;
  let at = value;
  for (const part of path.split(".")) {
    if (Array.isArray(at) && /^\d+$/.test(part)) at = at[Number(part)];
    else if (isObject(at)) at = Object.hasOwn(at, part) ? at[part] : undefined;
    else return undefined;
  }
  return at;
}

const typed = (v: unknown, type: Exclude<Field, string>["type"]): unknown => {
  if (v === undefined || v === null) return null;
  switch (type) {
    case "text":
      return typeof v === "string" && v !== "" ? v : null;
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    case "bool":
      return typeof v === "boolean" ? v : null;
    case "list":
      return Array.isArray(v) ? v : null;
    default:
      return v;
  }
};

const scalar = (v: unknown): Scalar | Scalar[] => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean") as Scalar[];
  return null;
};

/** A path of a field: `$key` is the entry's own name, `$field` one of this row's, `@source.path` another answer, with `{field}` places of this row */
function at(path: string, item: unknown, key: string, answers: Answers, row: Row): unknown {
  if (path === "$key") return key;
  // `$name` is a field of this row made before it
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return row[path.slice(1)];
  const filled = path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n: string) => String(row[n] ?? ""));
  if (filled.startsWith("@")) {
    const [source = "", ...rest] = filled.slice(1).split(".");
    return get(answers[source], rest.join("."));
  }
  return get(item, filled);
}

export function field(f: Field, item: unknown, key: string, answers: Answers, row: Row): Scalar | Scalar[] {
  if (typeof f === "string") return scalar(at(f, item, key, answers, row));
  if (f.test) return test(f.test, (name) => row[name] ?? scalar(get(item, name)));
  let v: unknown = null;
  for (const path of f.first ?? (f.from ? [f.from] : [])) {
    v = typed(at(path, item, key, answers, row), f.type);
    if (v !== null) break;
  }
  if (f.equals !== undefined) {
    const other = at(f.equals, item, key, answers, row);
    return v !== null && v !== undefined && v === other;
  }
  if (f.map) {
    const k = String(v);
    v = Object.hasOwn(f.map, k) ? f.map[k] : (f.else ?? null);
  } else if (v === null && f.else !== undefined) v = f.else;
  if (typeof v === "number") {
    if (f.between && (v < f.between[0] || v > f.between[1])) return null;
    if (f.minus !== undefined) {
      const m = at(f.minus, item, key, answers, row);
      v = typeof m === "number" ? v - m : null;
    }
    if (f.over !== undefined && typeof v === "number") {
      const d = at(f.over, item, key, answers, row);
      v = typeof d === "number" && d > 0 ? v / d : null;
    }
  }
  if (typeof v === "number") {
    if (f.times !== undefined) v = v * f.times;
    if (f.round !== undefined) v = Math.round((v as number) * 10 ** f.round) / 10 ** f.round;
  }
  return scalar(v);
}

/** The rows of a list's answer: an array's items, or an object's entries with their names as `$key` */
export function rowsOf(source: Source, answer: unknown, answers: Answers): Row[] {
  if (source.list === undefined) return [];
  const list = get(answer, source.list);
  const entries: [string, unknown][] = Array.isArray(list) ? list.map((x, i) => [String(i), x]) : isObject(list) ? Object.entries(list) : [];
  const rows: Row[] = [];
  for (const [key, item] of entries) {
    const row: Row = {};
    // in order: a later field may name an earlier one in its path
    for (const [name, f] of Object.entries(source.fields)) row[name] = field(f, item, key, answers, row);
    const id = row[source.key];
    if (id === null || id === undefined || id === "" || Array.isArray(id)) continue;
    if (source.where && !test(source.where, (n) => row[n])) continue;
    rows.push(row);
  }
  return rows;
}

/** Versions compared by their numbers: 2.11 is more than 2.9 */
export function atLeast(have: unknown, want: string): boolean {
  const m = /^v?(\d+(?:\.\d+){0,3})/.exec(String(have ?? "").trim());
  if (!m) return false;
  const a = m[1]!.split(".").map(Number);
  const b = want.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export function test(c: Cond, value: (name: string) => unknown): boolean {
  if ("any" in c) return c.any.some((x) => test(x, value));
  if ("all" in c) return c.all.every((x) => test(x, value));
  if ("not" in c) return !test(c.not, value);
  const v = value(c.field);
  if (c.in && !c.in.some((x) => x === v)) return false;
  if (c.is !== undefined && (c.is === null ? v !== null && v !== undefined : v !== c.is)) return false;
  if (c.gt !== undefined && !(typeof v === "number" && v > c.gt)) return false;
  if (c.lt !== undefined && !(typeof v === "number" && v < c.lt)) return false;
  if (c.atLeast !== undefined && !atLeast(v, c.atLeast)) return false;
  return true;
}

const ofRow = (row: Row) => (name: string) => row[name];

export function sortRows(rows: Row[], sort: Sort[]): Row[] {
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const x = a[s.field];
      const y = b[s.field];
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
      if (d) return s.desc ? -d : d;
    }
    return 0;
  });
}

export const where = (rows: Row[], c?: Cond) => (c ? rows.filter((row) => test(c, ofRow(row))) : rows);

export function value(v: Value, answers: Answers): Scalar {
  if ("from" in v) {
    const read = (path: string) => {
      const [source = "", ...rest] = path.slice(1).split(".");
      return get(answers[source], rest.join("."));
    };
    const got = read(v.from);
    if (v.over === undefined && v.times === undefined && v.round === undefined) return typeof got === "string" ? got.trim() : (scalar(got) as Scalar);
    if (typeof got !== "number") return null;
    let n = got;
    if (v.over !== undefined) {
      const d = read(v.over);
      if (typeof d !== "number" || d <= 0) return null;
      n /= d;
    }
    if (v.times !== undefined) n *= v.times;
    return v.round !== undefined ? Math.round(n * 10 ** v.round) / 10 ** v.round : n;
  }
  if ("sum" in v) {
    const [list = "", f = ""] = v.sum.split(".");
    return where((answers[list] as Row[]) ?? [], v.where).reduce((n, row) => n + (typeof row[f] === "number" ? (row[f] as number) : 0), 0);
  }
  if ("count" in v) return where((answers[v.count] as Row[]) ?? [], v.where).length;
  const rows = where((answers[v.first] as Row[]) ?? [], v.where);
  const first = (v.sort ? sortRows(rows, v.sort) : rows)[0];
  return (first?.[v.field] ?? null) as Scalar;
}

export const valuesOf = (spec: Spec, answers: Answers): Record<string, Scalar> => Object.fromEntries(Object.entries(spec.values).map(([name, v]) => [name, value(v, answers)]));

// --- Templates --------------------------------------------------------------------------------------

const PLACE = /\{([A-Za-z_$@][A-Za-z0-9_.$@]*)(?:\|([a-z]+))?\}/g;

const joined = (v: unknown, by: string) => (Array.isArray(v) ? v.map(String).join(by) : v === null || v === undefined ? "" : String(v));

function formatted(v: unknown, how?: string): string {
  switch (how) {
    case "pipe":
      return joined(v, "|");
    case "lines":
      return joined(v, "\n");
    case "comma":
      return joined(v, ",");
    case "lower":
      return joined(v, ",").toLowerCase();
    case "basic":
      // HTTP basic sign-in with a key alone: no user, the key as the password
      return Buffer.from(`:${joined(v, ",")}`).toString("base64");
    default:
      return joined(v, ",");
  }
}

/** A template's places filled; `encode` for a path or a query, where a value must stay one piece */
export function fill(template: string, vars: Record<string, unknown>, encode = false): string {
  return template.replace(PLACE, (_, name: string, how?: string) => {
    const s = formatted(vars[name], how);
    return encode ? encodeURIComponent(s) : s;
  });
}

/** A value placed whole when a JSON string is nothing but a place: a list stays a list, a number a number */
export function fillJson(x: unknown, vars: Record<string, unknown>): unknown {
  if (typeof x === "string") {
    const whole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(x);
    if (whole) return vars[whole[1]!] ?? null;
    return fill(x, vars);
  }
  if (Array.isArray(x)) return x.map((y) => fillJson(y, vars));
  if (isObject(x)) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fillJson(y, vars)]));
  return x;
}

/** The path and query of a request, every place encoded */
export function target(req: Req, vars: Record<string, unknown>): string {
  const path = fill(req.path, vars, true);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {})) {
    const s = fill(v, vars);
    // a place with nothing in it leaves its parameter out
    if (s !== "" || !/\{/.test(v)) q.set(k, s);
  }
  const query = q.toString();
  return query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path;
}

/** The request of several whose condition the values meet first */
export const chosen = (reqs: Req[], values: Record<string, unknown>) => reqs.find((r) => !r.when || test(r.when, (n) => values[n])) ?? null;

/** Words of a text in a language, English when there are none */
export const say = (text: Record<string, string> | undefined, lang: string) => (text ? (text[lang] ?? text.en ?? "") : "");

/** Prometheus' text format, read as samples: `name{label="value",…} 1.5`; comments and what cannot be read are left out */
export function prometheusSamples(text: string): { name: string; labels: Record<string, string>; value: number }[] {
  const out: { name: string; labels: Record<string, string>; value: number }[] = [];
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line.trim());
    if (!m) continue;
    const value = Number(m[3]);
    if (!Number.isFinite(value) && m[3] !== "NaN") continue;
    const labels: Record<string, string> = {};
    for (const l of (m[2] ?? "").matchAll(/([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]!] = l[2]!.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
    out.push({ name: m[1]!, labels, value });
  }
  return out;
}
