/**
 * What the dashboard shows and in which order (pure). The layout is groups of tiles; a tile is an app, a
 * link, a folder of the file manager, or a folder of tiles — which holds the first three and opens in
 * place, like one on a phone's home screen. Apps and file folders are only referred to (by name, by path):
 * whether they exist is decided elsewhere, and `arrange` matches the layout against what does. Links live
 * in the layout itself.
 */

export type Entry =
  | { type: "app"; name: string }
  | { type: "link"; id: string; title: string; url: string; icon: string }
  | { type: "files"; path: string }
  /** A tile of Hata's own, which can be moved but not taken off: the store, the "Add" tile */
  | { type: "builtin"; id: string }
  /** A number of the system standing among the tiles instead of in a place of its own */
  | { type: "widget"; id: string };

export const BUILTINS = ["store", "add"] as const;
export type Item = Entry | { type: "folder"; id: string; title: string; items: Entry[] };

export interface Group {
  id: string;
  /** "" — the first group under its default heading */
  title: string;
  /** Tiles standing on the board by themselves, without a heading; with no tiles left such a group is gone */
  bare?: boolean;
  items: Item[];
}

/**
 * The board is a grid of twelve columns. A block is one of Hata's own (a number of the system,
 * `attention`, `activity`) or a group of tiles (`group:<id>`); it has a column, a width in columns and a
 * row. How tall a block is depends on what is in it and on the width of the window, so rows are settled
 * in the browser (`src/ui/grid.js`): `y` here says what comes above what. One of Hata's own blocks may
 * also be put away (`hidden`): it is offered again in the "Add" menu.
 */
export const STATS = ["cpu", "memory", "disk", "network", "temp"] as const;
export const WIDGETS = [...STATS, "attention", "activity"] as const;
export const COLUMNS = 12;

export interface Block {
  id: string;
  x: number;
  y: number;
  w: number;
}

export interface Layout {
  groups: Group[];
  /** Every block that is on the board; each one once */
  blocks: Block[];
  hidden: string[];
}

/** Where a block of Hata's own stands until it is moved: the numbers in a row, the lists down the right */
const USUAL: Record<string, Omit<Block, "id">> = {
  cpu: { x: 0, y: 0, w: 3 },
  memory: { x: 3, y: 0, w: 2 },
  disk: { x: 5, y: 0, w: 2 },
  network: { x: 7, y: 0, w: 3 },
  temp: { x: 10, y: 0, w: 2 },
  attention: { x: 8, y: 1, w: 4 },
  activity: { x: 8, y: 2, w: 4 },
};
const GROUP_WIDTH = 8;
const MAX_ROW = 100_000;

export const minWidth = (id: string): number => (id === "attention" || id === "activity" ? 3 : 2);
const isOwn = (id: string) => (WIDGETS as readonly string[]).includes(id);

/** What a layout saved while blocks stood in five places (a row, three columns, a row) is on the grid */
function fromPlaces(places: Record<string, unknown>): Block[] {
  const named = (place: string): string[] => (Array.isArray(places[place]) ? places[place] : []).flatMap((id: unknown) => (id === "stats" ? [...STATS] : typeof id === "string" ? [id] : []));
  const out: Block[] = [];
  let y = 0;
  const row = (ids: string[]) => {
    let x = 0;
    for (const id of ids) {
      const w = (STATS as readonly string[]).includes(id) ? 2 : COLUMNS;
      if (x + w > COLUMNS) (x = 0), y++;
      out.push({ id, x, y, w });
      x += w;
    }
    if (ids.length) y++;
  };
  row(named("top"));
  const [left, main, side] = [named("left"), named("main"), named("side")];
  const [lw, sw] = [left.length ? 3 : 0, side.length ? 3 : 0];
  left.forEach((id, i) => out.push({ id, x: 0, y: y + i, w: 3 }));
  main.forEach((id, i) => out.push({ id, x: lw, y: y + i, w: COLUMNS - lw - sw }));
  side.forEach((id, i) => out.push({ id, x: COLUMNS - 3, y: y + i, w: 3 }));
  y += Math.max(left.length, main.length, side.length);
  row(named("bottom"));
  return out;
}

/**
 * The blocks of a layout, made whole: one named twice or not known is dropped, sizes are brought within
 * the grid, and what is on the board but named nowhere is put on it — a block of Hata's own at its usual
 * spot, a group of tiles under everything else. `tiles` are the numbers that stand among the tiles of a
 * group: they are there and nowhere else.
 */
export function cleanBlocks(input: unknown, groups: string[] = [], tiles: string[] = []): Pick<Layout, "blocks" | "hidden"> {
  const raw = isObject(input) ? input : {};
  const known = new Set<string>([...WIDGETS, ...groups.map((id) => "group:" + id)]);
  const seen = new Set<string>(tiles);
  const whole = (value: unknown, min: number, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min);
  const listed: unknown[] = Array.isArray(raw.blocks) ? raw.blocks : isObject(raw.widgets) ? fromPlaces(raw.widgets) : [];
  const blocks: Block[] = [];
  for (const one of listed) {
    if (!isObject(one) || typeof one.id !== "string" || !known.has(one.id) || seen.has(one.id)) continue;
    seen.add(one.id);
    const w = whole(one.w, minWidth(one.id), COLUMNS);
    blocks.push({ id: one.id, x: whole(one.x, 0, COLUMNS - w), y: whole(one.y, 0, MAX_ROW), w });
  }
  // only Hata's own blocks can be put away: a group that is not wanted is removed
  const away: unknown[] = Array.isArray(raw.hidden) ? raw.hidden : isObject(raw.widgets) && Array.isArray(raw.widgets.hidden) ? raw.widgets.hidden : [];
  const hidden = away.filter((id): id is string => typeof id === "string" && isOwn(id) && !seen.has(id) && !!seen.add(id));
  const fresh = blocks.length === 0;
  let below = blocks.reduce((max, block) => Math.max(max, block.y), 0) + 1;
  for (const id of WIDGETS) if (!seen.has(id)) blocks.push({ id, ...USUAL[id]!, y: fresh ? USUAL[id]!.y : below++ });
  // on a board nobody has arranged yet the groups go down the left, next to the lists
  for (const [i, id] of groups.entries()) if (!seen.has("group:" + id)) blocks.push({ id: "group:" + id, x: 0, y: fresh ? 1 + i : below++, w: fresh ? GROUP_WIDTH : COLUMNS });
  return { blocks, hidden };
}

const STAT_IDS: readonly string[] = STATS;

/** The numbers of the system that stand among the tiles of the groups */
function amongTiles(groups: Group[]): string[] {
  return groups.flatMap((group) => group.items.flatMap((item) => (item.type === "widget" ? [item.id] : [])));
}

/** The layout as text an administrator can edit, and back; what does not fit is dropped as anywhere else */
export function layoutText(layout: Layout): string {
  // Bun puts an empty list on a line of its own; next to its key it reads as what it is
  return Bun.YAML.stringify(layout, null, 2).replace(/[ \t]+$/gm, "").replace(/:\n\s+\[\]$/gm, ": []") + "\n";
}

export function parseLayoutText(text: string): Layout {
  const doc: unknown = Bun.YAML.parse(text);
  if (!isObject(doc) || !Array.isArray(doc.groups)) throw new Error("The text must be a mapping with a list of groups");
  return cleanLayout(doc);
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

  const entry = (raw: unknown, inFolder = false): Entry | null => {
    if (!isObject(raw) || tiles >= MAX_TILES) return null;
    let made: Entry | null = null;
    // "Add" is a doorway, not a thing to keep in a folder
    if (raw.type === "builtin" && typeof raw.id === "string" && (BUILTINS as readonly string[]).includes(raw.id) && !(inFolder && raw.id === "add") && once("builtin " + raw.id)) made = { type: "builtin", id: raw.id };
    if (raw.type === "app" && typeof raw.name === "string" && APP_RE.test(raw.name) && once("app " + raw.name)) made = { type: "app", name: raw.name };
    if (raw.type === "files" && typeof raw.path === "string" && raw.path.startsWith("/") && raw.path.length <= 4096 && once("files " + raw.path)) made = { type: "files", path: raw.path };
    if (raw.type === "link") {
      const url = webUrl(raw.url);
      if (url) made = { type: "link", id: id(raw.id), title: text(raw.title, MAX_TITLE) || new URL(url).host, url, icon: webUrl(raw.icon) };
    }
    if (raw.type === "widget" && typeof raw.id === "string" && STAT_IDS.includes(raw.id) && !inFolder && once("widget " + raw.id)) made = { type: "widget", id: raw.id };
    if (made) tiles++;
    return made;
  };
  const item = (raw: unknown): Item | null => {
    if (!isObject(raw) || raw.type !== "folder") return entry(raw);
    const items = (Array.isArray(raw.items) ? raw.items : []).map((inner) => entry(inner, true)).filter((e): e is Entry => e !== null);
    // a folder is its tiles: with none left there is nothing to open
    return items.length ? { type: "folder", id: id(raw.id), title: text(raw.title, MAX_TITLE), items } : null;
  };

  const groups = (isObject(input) && Array.isArray(input.groups) ? input.groups : [])
    .filter(isObject)
    .slice(0, MAX_GROUPS)
    .map((raw): Group => ({ id: id(raw.id), title: text(raw.title, MAX_TITLE), ...(raw.bare === true ? { bare: true } : {}), items: (Array.isArray(raw.items) ? raw.items : []).map(item).filter((i): i is Item => i !== null) }))
    // tiles standing by themselves are their group: with none left there is no group
    .filter((group) => !group.bare || group.items.length > 0);
  return { groups, ...cleanBlocks(input, groups.map((group) => group.id), amongTiles(groups)) };
}

/**
 * The layout as one user sees it: tiles of apps and folders that are not there (removed, not theirs to
 * open) are left out, and those not placed yet come at the end of the first group — a newly installed app
 * needs no arranging to show up. `builtins` are Hata's own tiles this user has: they are always there.
 */
export function arrange(layout: Layout, apps: string[], folders: string[], builtins: string[] = []): Layout {
  const there = new Set([...apps.map((name) => "app " + name), ...folders.map((path) => "files " + path), ...builtins.map((id) => "builtin " + id)]);
  const key = (e: Entry) => (e.type === "app" ? "app " + e.name : e.type === "files" ? "files " + e.path : e.type === "builtin" ? "builtin " + e.id : "");
  const placed = new Set<string>();
  const keep = (e: Entry) => e.type === "link" || e.type === "widget" || (there.has(key(e)) && !!placed.add(key(e)));

  const groups = layout.groups.map((group): Group => ({
    ...group,
    items: group.items.flatMap((item): Item[] => {
      if (item.type !== "folder") return keep(item) ? [item] : [];
      const items = item.items.filter(keep);
      return items.length ? [{ ...item, items }] : [];
    }),
  }));
  // what is new goes to the first group that has a heading; tiles standing by themselves are not a home
  let home = groups.findIndex((group) => !group.bare);
  if (home < 0) home = groups.push({ id: groups.some((group) => group.id === "main") ? crypto.randomUUID().slice(0, 13) : "main", title: "", items: [] }) - 1;
  const rest: Entry[] = [...apps.filter((name) => !placed.has("app " + name)).map((name): Entry => ({ type: "app", name })), ...folders.filter((path) => !placed.has("files " + path)).map((path): Entry => ({ type: "files", path }))];
  const own = builtins.filter((id) => !placed.has("builtin " + id)).map((id): Entry => ({ type: "builtin", id }));
  const first = [...groups[home]!.items];
  // "Add" left at the very end stays there: what is new comes before it
  const last = first.at(-1);
  const tail = last?.type === "builtin" && last.id === "add" ? first.splice(-1) : [];
  groups[home] = { ...groups[home]!, items: [...first, ...rest, ...own, ...tail] };
  return { groups, ...cleanBlocks(layout, groups.map((group) => group.id), amongTiles(groups)) };
}

/** The layout after a folder of the file manager was moved or renamed (`to`), or removed (`to` is null) */
export function movePath(layout: Layout, from: string, to: string | null): Layout {
  const inside = (path: string) => path === from || path.startsWith(from.endsWith("/") ? from : from + "/");
  const entry = (e: Entry): Entry[] => (e.type !== "files" || !inside(e.path) ? [e] : to === null ? [] : [{ type: "files", path: to + e.path.slice(from.length) }]);
  return cleanLayout({ blocks: layout.blocks, hidden: layout.hidden, groups: layout.groups.map((group) => ({ ...group, items: group.items.flatMap((item) => (item.type === "folder" ? [{ ...item, items: item.items.flatMap(entry) }] : entry(item))) })) });
}
