/**
 * Bringing a newer store version of a compose file into an installed app without losing what the user
 * changed. A three-way merge over the parsed files:
 *
 * - `base` — the store's file the app was installed from;
 * - `ours` — the app's compose file as it is now (form answers, edits by hand);
 * - `theirs` — the store's file today.
 *
 * What the user did not touch follows the store; what the user changed stays; where both changed the same
 * thing, the user's value stays and the difference is reported. All three must be normalised first, so
 * that ports and binds are compared entry by entry and not as text.
 *
 * Pure: no disk, no Docker.
 */
import type { Compose } from "./appform";

export interface MergeChange {
  /** Where in the file, e.g. `services.web.image` */
  path: string;
  /** `store` — the store's new value was taken; `conflict` — both changed it, the user's value was kept */
  kind: "store" | "conflict";
  /** Values as short text; "" — the key is not there */
  from: string;
  to: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Equal as data: the order of keys does not matter, the order of list items does */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
  }
  return false;
}

function show(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 200 ? text.slice(0, 200) + "…" : text;
}

/** What identifies an entry of a service's `ports` or `volumes`: the container's side of it */
function entryKey(list: "ports" | "volumes", item: unknown): string {
  if (!isObject(item)) return `=${String(item)}`;
  return list === "ports" ? `${item.target}/${item.protocol ?? "tcp"}` : String(item.target);
}

/** A list as a map by entry key, or null when two entries would share a key */
function keyed(list: "ports" | "volumes", items: unknown): Map<string, unknown> | null {
  const map = new Map<string, unknown>();
  for (const item of Array.isArray(items) ? items : []) {
    const key = entryKey(list, item);
    if (map.has(key)) return null;
    map.set(key, item);
  }
  return map;
}

function mergeNode(base: unknown, ours: unknown, theirs: unknown, path: string[], changes: MergeChange[]): unknown {
  if (same(ours, theirs) || same(base, theirs)) return ours;
  // look inside when there is an inside: the report then names the very line that changes
  if (isObject(ours) && isObject(theirs) && (base === undefined || isObject(base))) {
    const b = (base ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // our order first: the file keeps looking like the user's
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const value = mergeNode(b[key], ours[key], theirs[key], [...path, key], changes);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  const list = path.length === 3 && path[0] === "services" && (path[2] === "ports" || path[2] === "volumes") ? path[2] : null;
  if (list && Array.isArray(ours) && Array.isArray(theirs)) {
    const [b, o, t] = [keyed(list, base), keyed(list, ours), keyed(list, theirs)];
    if (b && o && t) {
      const out: unknown[] = [];
      for (const key of new Set([...o.keys(), ...t.keys()])) {
        const value = mergeNode(b.get(key), o.get(key), t.get(key), [...path, key], changes);
        if (value !== undefined) out.push(value);
      }
      return out;
    }
  }
  if (same(base, ours)) {
    changes.push({ path: path.join("."), kind: "store", from: show(ours), to: show(theirs) });
    return theirs;
  }
  changes.push({ path: path.join("."), kind: "conflict", from: show(ours), to: show(theirs) });
  return ours;
}

export function merge3(base: Compose, ours: Compose, theirs: Compose): { merged: Compose; changes: MergeChange[] } {
  const changes: MergeChange[] = [];
  const merged = mergeNode(base, ours, theirs, [], changes) as Compose;
  return { merged, changes };
}

/**
 * A stand-in base for an app whose store file was not kept (installed by an older Hata, or moved in from
 * CasaOS): the app's own file, with the answers of the install form — published ports, bind folders,
 * variable values — put back to what the store says. Merging from it keeps exactly those answers and lets
 * the store decide everything else; an edit made by hand beyond them cannot be told from the store's old
 * text and follows the store.
 */
export function guessBase(ours: Compose, theirs: Compose): Compose {
  const base = structuredClone(ours);
  for (const [name, service] of Object.entries(base.services ?? {}) as [string, Compose][]) {
    const store: unknown = theirs.services?.[name];
    if (!isObject(service) || !isObject(store)) continue;
    for (const [list, field] of [["ports", "published"], ["volumes", "source"]] as const) {
      const entries = keyed(list, store[list]);
      if (!entries || !Array.isArray(service[list])) continue;
      for (const item of service[list]) {
        const theirsItem = entries.get(entryKey(list, item));
        if (!isObject(item) || !isObject(theirsItem)) continue;
        if (theirsItem[field] === undefined) delete item[field];
        else item[field] = theirsItem[field];
      }
    }
    if (isObject(service.environment) && isObject(store.environment)) {
      for (const key of Object.keys(service.environment)) if (Object.hasOwn(store.environment, key)) service.environment[key] = store.environment[key];
    }
  }
  // the tile opens the port the user chose
  const [mine, tile] = [base["x-casaos"], theirs["x-casaos"]];
  if (isObject(mine) && isObject(tile) && tile.port_map !== undefined) mine.port_map = tile.port_map;
  return base;
}
