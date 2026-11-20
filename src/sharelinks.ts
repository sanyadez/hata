/**
 * Links for people without an account: a file or a folder to look at and download, or a folder to put
 * files into. `links.json` in the secrets folder (the address of a link is what opens it). A link works
 * with the rights of the one who made it: a member's link stops working once the folder is no longer
 * shared with them, and every link once its maker is removed. The rules are `sharelink.ts`.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { findUser, type User } from "./auth";
import { SECRETS_DIR } from "./config";
import { locate, mustBeLinkable, onPathMoved, within } from "./files";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { rightsOf } from "./memberfiles";
import { alive, expiresAt, GRANT_MS, hiddenName, ID_RE, kept, moved, pausedFor, piecesOf, readNewLink, roomInDrop, TOKEN_RE, wrongOnce, type ShareLink, type Tries } from "./sharelink";
import { TRASH_DIR } from "./trash";

const FILE = join(SECRETS_DIR, "links.json");

let links: ShareLink[] = kept(readJsonFile<{ links?: ShareLink[] }>(FILE, {}).links ?? [], Date.now());

function save(): void {
  links = kept(links, Date.now());
  writeJsonAtomic(FILE, { links });
}

// the file manager moves, renames and removes: a link into what moved follows it
onPathMoved((from, to) => {
  const next = moved(links, from, to);
  if (JSON.stringify(next) === JSON.stringify(links)) return;
  links = next;
  save();
});

/** A link as its maker and the administrators see it: without the password's hash */
export interface LinkInfo extends Omit<ShareLink, "password" | "by"> {
  locked: boolean;
  alive: boolean;
  by: { id: string; name: string };
}

const shown = (link: ShareLink, now = Date.now()): LinkInfo => {
  const { password, by, ...rest } = link;
  return { ...rest, locked: !!password, alive: alive(link, now), by: { id: by, name: findUser(by)?.name ?? "" } };
};

const mayManage = (user: User, link: ShareLink) => user.role === "admin" || link.by === user.id;

function own(user: User, id: string): ShareLink {
  const link = ID_RE.test(id) ? links.find((one) => one.id === id) : undefined;
  if (!link || !mayManage(user, link)) throw new AppError("links.notFound", 404);
  return link;
}

/** The links one may see: an administrator all of them, anybody else their own; those of a path first when asked */
export function listLinks(user: User, path?: string): LinkInfo[] {
  const now = Date.now();
  return links.filter((link) => mayManage(user, link) && (!path || link.path === path)).sort((a, b) => b.made - a.made).map((link) => shown(link, now));
}

/** Whether the maker may still give this: a member's rights are asked every time, an administrator's path is checked again */
function stillMay(link: ShareLink): boolean {
  const maker = findUser(link.by);
  if (!maker || maker.role === "guest") return false;
  try {
    if (mustBeLinkable(link.path) !== link.dir) return false;
    if (maker.role !== "admin") rightsOf(maker).need(link.path, link.kind === "get" ? "read" : "write");
    return true;
  } catch {
    return false;
  }
}

export async function makeLink(user: User, data: Record<string, unknown>): Promise<LinkInfo> {
  if (user.role === "guest") throw new AppError("auth.forbidden", 403);
  const path = locate(data.path);
  const wanted = readNewLink(data, true);
  if (typeof wanted === "string") throw new AppError(wanted);
  // a member gives only what is shared with them, and lets files in only where they may write
  if (user.role !== "admin") rightsOf(user).need(path, wanted.kind === "get" ? "read" : "write");
  const dir = mustBeLinkable(path);
  const checked = readNewLink(data, dir);
  if (typeof checked === "string") throw new AppError(checked);
  const now = Date.now();
  const link: ShareLink = {
    id: randomBytes(4).toString("hex"),
    token: randomBytes(16).toString("base64url"),
    kind: checked.kind,
    path,
    dir,
    by: user.id,
    made: now,
    expires: expiresAt(checked.hours, now),
    ...(checked.password ? { password: await Bun.password.hash(checked.password) } : {}),
    limit: checked.limit,
    received: 0,
    files: 0,
    opened: 0,
    last: 0,
    note: checked.note,
  };
  links.push(link);
  save();
  record(link.kind === "get" ? "links.made" : "links.madeDrop", { user: user.name, detail: path });
  return shown(link);
}

/** Longer or shorter, another password or none, other words */
export async function changeLink(user: User, id: string, data: Record<string, unknown>): Promise<LinkInfo> {
  const link = own(user, id);
  if (data.hours !== undefined) {
    const read = readNewLink({ kind: link.kind, hours: data.hours }, link.dir);
    if (typeof read === "string") throw new AppError(read);
    link.expires = expiresAt(read.hours, Date.now());
  }
  if (data.password !== undefined) {
    const read = readNewLink({ kind: link.kind, password: data.password }, link.dir);
    if (typeof read === "string") throw new AppError(read);
    if (read.password) link.password = await Bun.password.hash(read.password);
    else delete link.password;
    for (const [grant, held] of grants) if (held.id === link.id) grants.delete(grant);
  }
  if (data.note !== undefined || data.limit !== undefined) {
    const read = readNewLink({ kind: link.kind, note: data.note ?? link.note, limit: data.limit ?? link.limit }, link.dir);
    if (typeof read === "string") throw new AppError(read);
    link.note = read.note;
    link.limit = read.limit;
  }
  save();
  return shown(link);
}

export function removeLink(user: User, id: string): void {
  const link = own(user, id);
  links = links.filter((one) => one !== link);
  for (const [grant, held] of grants) if (held.id === link.id) grants.delete(grant);
  save();
  record("links.removed", { user: user.name, detail: link.path });
}

/** The links of a removed user go with them */
export function dropLinksOf(userId: string): void {
  if (!links.some((link) => link.by === userId)) return;
  links = links.filter((link) => link.by !== userId);
  save();
}

// --- Opened by somebody without an account ----------------------------------------------------------

/** Who typed the password rightly, by the cookie given to their browser; memory only */
const grants = new Map<string, { id: string; until: number }>();
/** Wrong passwords per link */
const tries = new Map<string, Tries>();

export const grantCookie = (link: ShareLink) => `hata_link_${link.id}`;

/** The link of an address, while it works and its maker may still give it; null — it does not */
export function linkOf(token: string): ShareLink | null {
  if (!TOKEN_RE.test(token)) return null;
  const link = links.find((one) => one.token === token);
  return link && alive(link, Date.now()) && stillMay(link) ? link : null;
}

/** Whether this browser may open it: no password, or the password typed within `GRANT_MS` */
export function unlocked(link: ShareLink, cookie: string | undefined): boolean {
  if (!link.password) return true;
  const held = cookie ? grants.get(cookie) : undefined;
  return !!held && held.id === link.id && held.until > Date.now();
}

/** The password typed on the link's page: a grant for its cookie, or why not */
export async function unlock(link: ShareLink, password: unknown): Promise<string> {
  const now = Date.now();
  const wait = pausedFor(tries.get(link.id), now);
  if (wait) throw new AppError("links.tooMany", 429, { seconds: wait });
  if (!link.password || (typeof password === "string" && password.length <= 200 && (await Bun.password.verify(password, link.password)))) {
    tries.delete(link.id);
    for (const [grant, held] of grants) if (held.until <= now) grants.delete(grant);
    const grant = randomBytes(24).toString("base64url");
    grants.set(grant, { id: link.id, until: now + GRANT_MS });
    return grant;
  }
  tries.set(link.id, wrongOnce(tries.get(link.id), now));
  throw new AppError("links.wrongPassword", 403);
}

/** Opened once more (the page asked what it gives) */
export function opened(link: ShareLink): void {
  link.opened++;
  link.last = Date.now();
  save();
}

/** The real folder or file of the link */
function base(link: ShareLink): string {
  try {
    return realpathSync(link.path);
  } catch {
    throw new AppError("links.gone", 404);
  }
}

/**
 * A path inside a link's folder → where it is on the disk. Links inside are not followed (the page
 * cannot tell where one leads), and nothing hidden of Hata's is reached.
 */
export function inside(link: ShareLink, rel: unknown): string {
  const top = base(link);
  if (!link.dir) {
    if (rel) throw new AppError("links.notFound", 404);
    return top;
  }
  const pieces = piecesOf(rel);
  if (!pieces || pieces.includes(TRASH_DIR)) throw new AppError("links.notFound", 404);
  let at = top;
  for (const piece of pieces) {
    at = join(at, piece);
    let st;
    try {
      st = lstatSync(at);
    } catch {
      throw new AppError("links.notFound", 404);
    }
    if (st.isSymbolicLink()) throw new AppError("links.notFound", 404);
  }
  if (!within(at, top)) throw new AppError("links.notFound", 404);
  return at;
}

export interface LinkEntry {
  name: string;
  type: "dir" | "file";
  size: number;
  modified: number;
}

/** What a folder of a link holds, folders first: links and what Hata keeps there are left out */
export function entriesOf(link: ShareLink, rel: unknown): { entries: LinkEntry[]; truncated: boolean } {
  const dir = inside(link, rel);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new AppError("links.notFound", 404);
  }
  const entries: LinkEntry[] = [];
  for (const name of names) {
    if (hiddenName(name) || name === TRASH_DIR) continue;
    let st;
    try {
      st = lstatSync(join(dir, name));
    } catch {
      continue;
    }
    if (st.isDirectory()) entries.push({ name, type: "dir", size: 0, modified: Math.round(st.mtimeMs) });
    else if (st.isFile()) entries.push({ name, type: "file", size: st.size, modified: Math.round(st.mtimeMs) });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1));
  return { entries: entries.slice(0, 2000), truncated: entries.length > 2000 };
}

/** What the page of a link shows before anything inside */
export function aboutLink(link: ShareLink, open: boolean): Record<string, unknown> {
  const name = link.path.split("/").pop() || "/";
  if (!open) return { kind: link.kind, locked: true };
  let size = 0;
  if (!link.dir) {
    try {
      size = statSync(base(link)).size;
    } catch {}
  }
  return { kind: link.kind, locked: false, name, dir: link.dir, size, expires: link.expires, note: link.note, from: findUser(link.by)?.name ?? "", limit: link.limit, room: link.limit ? Math.max(0, link.limit - link.received) : null };
}

/** A part of a file sent into a drop: within its limit, a name of the sender's own, never over what is there */
export function mayTake(link: ShareLink, name: unknown, end: number): void {
  if (link.kind !== "drop") throw new AppError("links.notFound", 404);
  if (typeof name !== "string" || hiddenName(name) || name === TRASH_DIR) throw new AppError("files.badName");
  if (!roomInDrop(link, end)) throw new AppError("links.full", 413);
}

/** A file came in whole through a drop */
export function took(link: ShareLink, path: string, size: number): void {
  link.received += size;
  link.files++;
  link.last = Date.now();
  save();
  record("links.received", { detail: path });
}
