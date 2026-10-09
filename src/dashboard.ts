/**
 * What the dashboard shows and in which order (pure). The layout is groups of tiles; a tile is an app, a
 * link, a folder of the file manager, or a folder of tiles — which holds the first three and opens in
 * place, like one on a phone's home screen. Apps and file folders are only referred to (by name, by path):
 * whether they exist is decided elsewhere, and `arrange` matches the layout against what does. Links live
 * in the layout itself.
 */

export type Entry = { type: "app"; name: string } | { type: "link"; id: string; title: string; url: string; icon: string } | { type: "files"; path: string };
export type Item = Entry | { type: "folder"; id: string; title: string; items: Entry[] };

export interface Group {
  id: string;
  /** "" — the first group under its default heading */
  title: string;
  items: Item[];
}

/** The blocks of the dashboard besides the tiles, and the places they can stand in */
export const WIDGETS = ["stats", "attention", "activity"] as const;
export const ZONES = ["top", "side", "bottom"] as const;
export type Widgets = Record<(typeof ZONES)[number], string[]>;

export interface Layout {
  groups: Group[];
  /** Which block stands where, in order; every block is in exactly one place */
  widgets: Widgets;
}

const DEFAULT_ZONE: Record<string, (typeof ZONES)[number]> = { stats: "top", attention: "side", activity: "side" };

/** Blocks named twice or not known are dropped; one that is named nowhere goes to its usual place */
export function cleanWidgets(input: unknown): Widgets {
  const out: Widgets = { top: [], side: [], bottom: [] };
  const seen = new Set<string>();
  for (const zone of ZONES) {
    const list = isObject(input) && Array.isArray(input[zone]) ? input[zone] : [];
    for (const id of list) if (typeof id === "string" && (WIDGETS as readonly string[]).includes(id) && !seen.has(id) && seen.add(id)) out[zone].push(id);
  }
  for (const id of WIDGETS) if (!seen.has(id)) out[DEFAULT_ZONE[id]!].push(id);
  return out;
}

const MAX_GROUPS = 24;
const MAX_TILES = 500;
const MAX_TITLE = 60;
const MAX_URL = 2000;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const APP_RE = /^[a-z0-9_-]{1,64}$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** An address a tile may point to or take its picture from: http and https only */
export function webUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_URL) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * Makes a layout out of whatever was saved or sent: what does not fit is dropped, an app or a folder
 * named twice stays where it was named first, ids that are missing or taken are given anew.
 */
export function cleanLayout(input: unknown): Layout {
  const ids = new Set<string>();
  const seen = new Set<string>();
  let tiles = 0;
  const id = (value: unknown) => {
    let next = typeof value === "string" && ID_RE.test(value) && !ids.has(value) ? value : "";
    while (!next || ids.has(next)) next = crypto.randomUUID().slice(0, 13);
    ids.add(next);
    return next;
  };
  const once = (key: string) => !seen.has(key) && !!seen.add(key);

  const entry = (raw: unknown): Entry | null => {
    if (!isObject(raw) || tiles >= MAX_TILES) return null;
    let made: Entry | null = null;
    if (raw.type === "app" && typeof raw.name === "string" && APP_RE.test(raw.name) && once("app " + raw.name)) made = { type: "app", name: raw.name };
    if (raw.type === "files" && typeof raw.path === "string" && raw.path.startsWith("/") && raw.path.length <= 4096 && once("files " + raw.path)) made = { type: "files", path: raw.path };
    if (raw.type === "link") {
      const url = webUrl(raw.url);
      if (url) made = { type: "link", id: id(raw.id), title: text(raw.title, MAX_TITLE) || new URL(url).host, url, icon: webUrl(raw.icon) };
    }
    if (made) tiles++;
    return made;
  };
  const item = (raw: unknown): Item | null => {
    if (!isObject(raw) || raw.type !== "folder") return entry(raw);
    const items = (Array.isArray(raw.items) ? raw.items : []).map(entry).filter((e): e is Entry => e !== null);
    // a folder is its tiles: with none left there is nothing to open
    return items.length ? { type: "folder", id: id(raw.id), title: text(raw.title, MAX_TITLE), items } : null;
  };

  const groups = (isObject(input) && Array.isArray(input.groups) ? input.groups : [])
    .filter(isObject)
    .slice(0, MAX_GROUPS)
    .map((raw): Group => ({ id: id(raw.id), title: text(raw.title, MAX_TITLE), items: (Array.isArray(raw.items) ? raw.items : []).map(item).filter((i): i is Item => i !== null) }));
  return { groups, widgets: cleanWidgets(isObject(input) ? input.widgets : null) };
}

/**
 * The layout as one user sees it: tiles of apps and folders that are not there (removed, not theirs to
 * open) are left out, and those not placed yet come at the end of the first group — a newly installed app
 * needs no arranging to show up.
 */
export function arrange(layout: Layout, apps: string[], folders: string[]): Layout {
  const there = new Set([...apps.map((name) => "app " + name), ...folders.map((path) => "files " + path)]);
  const key = (e: Entry) => (e.type === "app" ? "app " + e.name : e.type === "files" ? "files " + e.path : "");
  const placed = new Set<string>();
  const keep = (e: Entry) => e.type === "link" || (there.has(key(e)) && !!placed.add(key(e)));

  const groups = layout.groups.map((group): Group => ({
    ...group,
    items: group.items.flatMap((item): Item[] => {
      if (item.type !== "folder") return keep(item) ? [item] : [];
      const items = item.items.filter(keep);
      return items.length ? [{ ...item, items }] : [];
    }),
  }));
  if (!groups.length) groups.push({ id: "main", title: "", items: [] });
  const rest: Entry[] = [...apps.filter((name) => !placed.has("app " + name)).map((name): Entry => ({ type: "app", name })), ...folders.filter((path) => !placed.has("files " + path)).map((path): Entry => ({ type: "files", path }))];
  groups[0] = { ...groups[0]!, items: [...groups[0]!.items, ...rest] };
  return { groups, widgets: layout.widgets };
}

/** The layout after a folder of the file manager was moved or renamed (`to`), or removed (`to` is null) */
export function movePath(layout: Layout, from: string, to: string | null): Layout {
  const inside = (path: string) => path === from || path.startsWith(from.endsWith("/") ? from : from + "/");
  const entry = (e: Entry): Entry[] => (e.type !== "files" || !inside(e.path) ? [e] : to === null ? [] : [{ type: "files", path: to + e.path.slice(from.length) }]);
  return cleanLayout({ widgets: layout.widgets, groups: layout.groups.map((group) => ({ ...group, items: group.items.flatMap((item) => (item.type === "folder" ? [{ ...item, items: item.items.flatMap(entry) }] : entry(item))) })) });
}
