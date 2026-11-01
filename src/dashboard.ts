/**
 * What Home shows and where (pure). Home is one grid: every card has a place and a size in cells, and
 * nothing else decides where it stands. A card is an app, a link, a folder of the file manager, a device
 * of Home Assistant, what an integration shows, a block of Hata's own, or a folder of tiles — which holds
 * the small ones and opens in place, like one on a phone's home screen. Apps and file folders are only
 * referred to (by name, by path): whether they exist is decided elsewhere, and `arrange` matches the layout
 * against what does. Links live in the layout itself.
 */

export type Entry =
  | { type: "app"; name: string }
  | { type: "link"; id: string; title: string; url: string; icon: string }
  | { type: "files"; path: string }
  /** An entity of a Home Assistant server Hata is connected to: a light, a switch, a sensor */
  | { type: "ha"; server: string; entity: string }
  /** What an integration shows right on the page: its numbers, a camera, what the cameras noticed */
  | { type: "widget"; id: string; source: "qbit" | "frigate"; server: string; view: "torrents" | "camera" | "events"; camera?: string }
  /** A tile of Hata's own, which can be moved but not taken off: the store, the "Add" tile */
  | { type: "builtin"; id: string };

export const BUILTINS = ["store", "add"] as const;
const WIDGET_VIEWS: Record<string, string[]> = { qbit: ["torrents"], frigate: ["camera", "events"] };
const CAMERA_RE = /^[A-Za-z0-9_-]{1,64}$/;
export type Item = Entry | { type: "folder"; id: string; title: string; items: Entry[] };

/** A block of Hata's own: the numbers of this server or of a machine, what needs attention, the activity */
export interface Block {
  type: "block";
  id: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Card = (Item | Block) & Box;

export interface Layout {
  cards: Card[];
}

export const WIDGETS = ["stats", "attention", "activity", "adblock"] as const;
/** Not on the page until somebody adds it: it says nothing while nothing is being blocked */
const OFFERED_ONLY = ["adblock"];
/** The numbers of another machine Hata looks after, by the machine's id: put on the page by hand, any number of them */
export const MACHINE_BLOCK_RE = /^machine:[a-f0-9]{8}$/;
const knownBlock = (id: string) => (WIDGETS as readonly string[]).includes(id) || MACHINE_BLOCK_RE.test(id);

/** The grid: how many columns it has, the smallest and largest size of every kind of card, the size a card first takes */
export const GRID = {
  cols: 8,
  /** [least width, least height, most width, most height] */
  limits: {
    stats: [2, 2, 8, 6], attention: [2, 2, 8, 8], activity: [2, 2, 8, 8], adblock: [2, 1, 4, 4], machine: [2, 1, 8, 4],
    app: [1, 1, 4, 4], link: [1, 1, 4, 4], files: [1, 1, 4, 4], builtin: [1, 1, 4, 4], folder: [1, 1, 4, 4], ha: [1, 1, 4, 4],
    torrents: [1, 1, 8, 6], camera: [1, 1, 8, 6], events: [1, 1, 8, 6],
  } as Record<string, [number, number, number, number]>,
  first: { stats: [5, 3], attention: [3, 3], activity: [3, 2], adblock: [2, 2], machine: [3, 1], torrents: [2, 1], camera: [2, 1], events: [2, 2] } as Record<string, [number, number]>,
};
const MAX_ROW = 500;

export const cardKind = (card: Item | Block): string => (card.type === "block" ? (card.id.startsWith("machine:") ? "machine" : card.id) : card.type === "widget" ? card.view : card.type);

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first free place from the top: nothing already placed moves */
function fit(taken: Box[], w: number, h: number): Box {
  for (let y = 0; ; y++) for (let x = 0; x + w <= GRID.cols; x++) if (!taken.some((box) => overlap({ x, y, w, h }, box))) return { x, y, w, h };
}

/** The numbers of the system were blocks of their own for a while: any of them stands for `stats` */
const NUMBERS = ["cpu", "memory", "disk", "network", "temp"];
const blockIds = (list: unknown): string[] => (Array.isArray(list) ? list : []).flatMap((id: unknown) => (typeof id !== "string" ? [] : NUMBERS.includes(id) ? ["stats"] : [id]));

/**
 * What a layout of before the one grid had — groups of tiles and blocks in zones above, beside and below
 * them — as a list in the order it is laid out. The headings of the groups have no place on the grid.
 */
function fromZones(raw: Record<string, unknown>): unknown[] {
  const listed = (Array.isArray(raw.groups) ? raw.groups : []).filter(isObject).slice(0, MAX_GROUPS);
  // a layout saved while the dashboard was a free grid lists its blocks with a row and a column each
  const blocks = Array.isArray(raw.blocks) ? raw.blocks.filter(isObject) : null;
  if (blocks) {
    const at = (group: Record<string, unknown>) => {
      const block = blocks.find((one) => one.id === "group:" + group.id);
      return block ? (Number(block.y) || 0) * 100 + (Number(block.x) || 0) : Infinity;
    };
    const order = new Map(listed.map((group) => [group, at(group)]));
    listed.sort((a, b) => order.get(a)! - order.get(b)! || 0);
  }
  const zones = isObject(raw.widgets) ? raw.widgets : {};
  const onBoard = blockIds(blocks?.map((one) => one.id));
  const hidden = blocks ? blockIds(raw.hidden).filter((id) => !onBoard.includes(id)) : blockIds(zones.hidden);
  const seen = new Set(hidden);
  const take = (list: unknown) => blockIds(list).filter((id) => knownBlock(id) && !seen.has(id) && !!seen.add(id));
  const top = blocks ? [] : take(zones.top);
  const side = blocks ? [] : [...take(zones.left), ...take(zones.side)];
  const bottom = blocks ? [] : take(zones.bottom);
  // a block named nowhere goes to its usual place
  for (const id of WIDGETS) if (!seen.has(id) && !OFFERED_ONLY.includes(id)) (id === "stats" ? top : side).push(id);
  const block = (id: string) => ({ type: "block", id });
  return [...top.map(block), ...side.map(block), ...listed.flatMap((group) => (Array.isArray(group.items) ? group.items : [])), ...bottom.map(block)];
}

/** The layout as text an administrator can edit, and back; what does not fit is dropped as anywhere else */
export function layoutText(layout: Layout): string {
  // Bun puts an empty list on a line of its own; next to its key it reads as what it is
  return Bun.YAML.stringify(layout, null, 2).replace(/[ \t]+$/gm, "").replace(/:\n\s+\[\]$/gm, ": []") + "\n";
}

export function parseLayoutText(text: string): Layout {
  const doc: unknown = Bun.YAML.parse(text);
  if (!isObject(doc) || !(Array.isArray(doc.cards) || Array.isArray(doc.groups))) throw new Error("The text must be a mapping with a list of cards");
  return cleanLayout(doc);
}

const MAX_GROUPS = 24;
const MAX_TILES = 500;
const MAX_TITLE = 60;
const MAX_URL = 2000;
const ID_RE = /^[a-z0-9-]{1,40}$/;
/** An app of this server, or `<name>@<machine>` — an app of another machine */
const APP_RE = /^[a-z0-9_-]{1,64}(@[a-f0-9]{8})?$/;
const SERVER_RE = /^[a-f0-9]{8}$/;
const ENTITY_RE = /^[a-z0-9_]{1,64}\.[a-z0-9_]{1,200}$/;

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
 * Makes a layout out of whatever was saved or sent, also in the formats of before the grid: what does not
 * fit is dropped, an app or a folder named twice stays where it was named first, ids that are missing or
 * taken are given anew. A size goes within the limits of its kind; a card over another goes down, one with
 * no place takes the first free one.
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
    if (raw.type === "ha" && typeof raw.server === "string" && SERVER_RE.test(raw.server) && typeof raw.entity === "string" && ENTITY_RE.test(raw.entity) && once(`ha ${raw.server}/${raw.entity}`)) made = { type: "ha", server: raw.server, entity: raw.entity };
    // a widget is as large as the page lets it be: it does not go into a folder
    if (!inFolder && raw.type === "widget" && typeof raw.source === "string" && WIDGET_VIEWS[raw.source]?.includes(String(raw.view)) && typeof raw.server === "string" && SERVER_RE.test(raw.server) && (raw.view !== "camera" || (typeof raw.camera === "string" && CAMERA_RE.test(raw.camera)))) {
      made = { type: "widget", id: id(raw.id), source: raw.source as "qbit" | "frigate", server: raw.server, view: raw.view as "torrents" | "camera" | "events", ...(raw.view === "camera" ? { camera: raw.camera as string } : {}) };
    }
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
    const items = (Array.isArray(raw.items) ? raw.items : []).map((inner) => entry(inner, true)).filter((e): e is Entry => e !== null);
    // a folder is its tiles: with none left there is nothing to open
    return items.length ? { type: "folder", id: id(raw.id), title: text(raw.title, MAX_TITLE), items } : null;
  };

  const raw = isObject(input) ? input : {};
  const listed: unknown[] = Array.isArray(raw.cards) ? raw.cards : fromZones(raw);
  const made: { card: Item | Block; w: number; h: number; x: number | null; y: number | null }[] = [];
  const whole = (value: unknown, least: number, most: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(least, Math.min(most, Math.round(value))) : null);
  for (const one of listed) {
    if (!isObject(one)) continue;
    const card: Item | Block | null = one.type === "block" ? (typeof one.id === "string" && knownBlock(one.id) && once("block " + one.id) ? { type: "block", id: one.id } : null) : item(one);
    if (!card) continue;
    const kind = cardKind(card);
    const [minW, minH, maxW, maxH] = GRID.limits[kind]!;
    // a tile sized before the grid said it as "2x1"
    const [oldW, oldH] = typeof one.size === "string" && /^[12]x[12]$/.test(one.size) ? one.size.split("x").map(Number) : [];
    const [firstW, firstH] = GRID.first[kind] ?? [1, 1];
    const w = whole(one.w ?? oldW ?? firstW, minW, Math.min(maxW, GRID.cols))!;
    const h = whole(one.h ?? oldH ?? firstH, minH, maxH)!;
    const x = whole(one.x, 0, GRID.cols - w);
    const y = whole(one.y, 0, MAX_ROW);
    made.push({ card, w, h, x: y === null ? null : x, y: x === null ? null : y });
  }
  const out: Card[] = [];
  const placed = made.filter((one) => one.x !== null).sort((a, b) => a.y! - b.y! || a.x! - b.x!);
  for (const { card, w, h, x, y } of placed) {
    const box = { x: x!, y: y!, w, h };
    while (out.some((other) => overlap(box, other))) box.y++;
    out.push({ ...card, ...box });
  }
  for (const { card, w, h, x } of made) if (x === null) out.push({ ...card, ...fit(out, w, h) });
  return { cards: out };
}

export interface Seen {
  apps: string[];
  folders?: string[];
  /** Hata's own tiles this user has: they are always there */
  builtins?: string[];
  /** The Home Assistant servers this user sees */
  servers?: string[];
  /** The servers of the integrations whose widgets this user sees */
  widgetServers?: string[];
  /** An administrator: every block, and the page as it was laid out. Anyone else has the numbers of this server, and what is left closes up */
  admin?: boolean;
}

/**
 * The layout as one user sees it: cards of what is not there (removed, not theirs to open) are left out, and
 * what is not placed yet takes the first free place — a newly installed app needs no arranging to show up.
 */
export function arrange(layout: Layout, seen: Seen): Layout {
  const { apps, folders = [], builtins = [], servers = [], widgetServers = [], admin = false } = seen;
  const there = new Set([...apps.map((name) => "app " + name), ...folders.map((path) => "files " + path), ...builtins.map((id) => "builtin " + id)]);
  const key = (e: Entry) => (e.type === "app" ? "app " + e.name : e.type === "files" ? "files " + e.path : e.type === "builtin" ? "builtin " + e.id : "");
  const placed = new Set<string>();
  // a tile of Home Assistant stays while its server is one this user sees — also while it does not answer
  const keep = (e: Entry) => e.type === "link" || (e.type === "widget" ? widgetServers.includes(e.server) : e.type === "ha" ? servers.includes(e.server) : there.has(key(e)) && !!placed.add(key(e)));

  let cards = layout.cards.flatMap((card): Card[] => {
    if (card.type === "block") return admin || card.id === "stats" ? [card] : [];
    if (card.type !== "folder") return keep(card) ? [card] : [];
    const items = card.items.filter(keep);
    return items.length ? [{ ...card, items }] : [];
  });
  if (!admin) cards = cards.sort((a, b) => a.y - b.y || a.x - b.x).reduce<Card[]>((done, card) => [...done, { ...card, ...fit(done, card.w, card.h) }], []);
  const rest: Entry[] = [
    ...apps.filter((name) => !placed.has("app " + name)).map((name): Entry => ({ type: "app", name })),
    ...folders.filter((path) => !placed.has("files " + path)).map((path): Entry => ({ type: "files", path })),
    ...builtins.filter((id) => !placed.has("builtin " + id)).map((id): Entry => ({ type: "builtin", id })),
  ];
  for (const entry of rest) cards.push({ ...entry, ...fit(cards, 1, 1) });
  return { cards };
}

/** The same layout with its cards changed: places and sizes stay */
const mapCards = (layout: Layout, change: (card: Card) => Card[], inner: (e: Entry) => Entry[]) => cleanLayout({ cards: layout.cards.flatMap((card) => (card.type === "folder" ? change({ ...card, items: card.items.flatMap(inner) }) : change(card))) });

/** The layout after a folder of the file manager was moved or renamed (`to`), or removed (`to` is null) */
export function movePath(layout: Layout, from: string, to: string | null): Layout {
  const inside = (path: string) => path === from || path.startsWith(from.endsWith("/") ? from : from + "/");
  const entry = (e: Entry): Entry[] => (e.type !== "files" || !inside(e.path) ? [e] : to === null ? [] : [{ type: "files", path: to + e.path.slice(from.length) }]);
  return mapCards(layout, (card) => (card.type === "files" ? entry(card).map((e) => ({ ...card, ...e })) : [card]), entry);
}

/** The Home Assistant entities the layout shows, as `<server>/<entity>` */
export function haTiles(layout: Layout): string[] {
  const out: string[] = [];
  const take = (e: Entry | Block) => e.type === "ha" && out.push(`${e.server}/${e.entity}`);
  for (const card of layout.cards) card.type === "folder" ? card.items.forEach(take) : take(card);
  return out;
}

/** The layout without the tiles of a connected server that was removed */
export function dropServer(layout: Layout, server: string): Layout {
  const gone = (e: Entry | Block) => (e.type === "ha" || e.type === "widget") && e.server === server;
  return mapCards(layout, (card) => (gone(card) ? [] : [card]), (e) => (gone(e) ? [] : [e]));
}

/** The layout without a block: a machine's numbers go with the machine */
export function dropBlock(layout: Layout, id: string): Layout {
  return { cards: layout.cards.filter((card) => !(card.type === "block" && card.id === id)) };
}
