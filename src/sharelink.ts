/**
 * Links that give a file or a folder to somebody without an account here, or let them put files into a
 * folder. The pure part: what a new link may be, whether it still works, where inside it a path leads,
 * and how many wrong passwords it takes. The state and the requests are `sharelinks.ts`.
 */

export type LinkKind = "get" | "drop";

export interface ShareLink {
  /** Names it in the API */
  id: string;
  /** Goes into the address: whoever has it may open the link */
  token: string;
  kind: LinkKind;
  /** What it gives, or where what is sent lands */
  path: string;
  dir: boolean;
  /** The user who made it: its rights are theirs */
  by: string;
  made: number;
  /** When it stops working; 0 — never */
  expires: number;
  /** A hash by Bun.password; none — the link alone opens it */
  password?: string;
  /** For a drop: how many bytes everything sent may take; 0 — no limit */
  limit: number;
  /** For a drop: bytes and files received so far */
  received: number;
  files: number;
  /** How many times it was opened, and when last */
  opened: number;
  last: number;
  /** What it is for, the maker's own words */
  note: string;
}

export interface NewLink {
  kind: LinkKind;
  /** How long it works, in hours; 0 — until it is removed */
  hours: number;
  password: string;
  limit: number;
  note: string;
}

/** The lengths a link may be made for: an hour up to a year */
export const MAX_HOURS = 24 * 366;
/** A password shorter than this is refused: it would be guessed */
export const MIN_PASSWORD = 4;
/** A link that stopped working is kept this long, so the list says it ended, then it goes */
export const KEEP_ENDED = 30 * 24 * 3600_000;
/** Wrong passwords before the link refuses to listen for a while, and how long */
export const TRIES = 5;
export const PAUSE = 10 * 60_000;
/** How long a typed password keeps the link open in that browser */
export const GRANT_MS = 12 * 3600_000;

export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const ID_RE = /^[a-f0-9]{8}$/;

/** What the dialog sent, checked; a string — the error code */
export function readNewLink(data: Record<string, unknown>, dir: boolean): NewLink | string {
  const kind = data.kind === "drop" ? "drop" : data.kind === "get" || data.kind === undefined ? "get" : null;
  if (!kind) return "links.badKind";
  if (kind === "drop" && !dir) return "links.dropNeedsFolder";
  const hours = data.hours === undefined ? 168 : data.hours;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 0 || hours > MAX_HOURS) return "links.badTime";
  const password = typeof data.password === "string" ? data.password : "";
  if (password && (password.length < MIN_PASSWORD || password.length > 200)) return "links.badPassword";
  const limit = data.limit === undefined || data.limit === null ? 0 : data.limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0) return "links.badLimit";
  const note = typeof data.note === "string" ? data.note.replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return { kind, hours, password, limit: kind === "drop" ? limit : 0, note };
}

/** When a link made now for these hours ends; 0 — never */
export const expiresAt = (hours: number, now: number): number => (hours === 0 ? 0 : now + hours * 3600_000);

/** Whether it still works */
export const alive = (link: Pick<ShareLink, "expires">, now: number): boolean => link.expires === 0 || link.expires > now;

/** The links worth keeping: ended ones go a month after their end */
export const kept = <T extends Pick<ShareLink, "expires">>(links: T[], now: number): T[] => links.filter((link) => link.expires === 0 || link.expires + KEEP_ENDED > now);

/** Names a link's page never shows and never opens: what Hata keeps for itself in a folder */
export const hiddenName = (name: string): boolean => name.startsWith(".hata-");

/**
 * A path inside the link as the page sends it ("trip/day 1/a.jpg", "" — the link's own folder) → its
 * pieces; null — not a path inside: "..", empty pieces, a hidden name, too deep.
 */
export function piecesOf(rel: unknown): string[] | null {
  if (rel === null || rel === undefined || rel === "") return [];
  if (typeof rel !== "string" || rel.length > 4096 || rel.includes("\0") || rel.includes("\\")) return null;
  const pieces = rel.split("/");
  if (pieces.length > 64) return null;
  for (const piece of pieces) if (!piece || piece === "." || piece === ".." || hiddenName(piece) || Buffer.byteLength(piece) > 255) return null;
  return pieces;
}

/** A path that moved: the links into it follow; a removed one takes them with it */
export function moved<T extends Pick<ShareLink, "path">>(links: T[], from: string, to: string | null): T[] {
  const under = (path: string) => path === from || path.startsWith(from.endsWith("/") ? from : from + "/");
  return links.flatMap((link) => (!under(link.path) ? [link] : to === null ? [] : [{ ...link, path: to + link.path.slice(from.length) }]));
}

/** Wrong passwords of one link: counted, and paused after `TRIES` */
export interface Tries {
  count: number;
  /** Until when it refuses to listen; 0 — it listens */
  until: number;
}

/** Seconds left of a pause; 0 — a password may be typed */
export const pausedFor = (tries: Tries | undefined, now: number): number => (tries && tries.until > now ? Math.ceil((tries.until - now) / 1000) : 0);

/** One more wrong password */
export function wrongOnce(tries: Tries | undefined, now: number): Tries {
  const count = (tries && tries.until <= now && tries.until !== 0 ? 0 : (tries?.count ?? 0)) + 1;
  return count >= TRIES ? { count: 0, until: now + PAUSE } : { count, until: 0 };
}

/** Whether a drop may take a part that ends at `end` bytes of its file, given what it took before */
export const roomInDrop = (link: Pick<ShareLink, "limit" | "received">, end: number): boolean => link.limit === 0 || link.received + end <= link.limit;
