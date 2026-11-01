/**
 * What qBittorrent's Web API says, read without touching anything: pure and tested. The talking is in
 * `qbittorrent.ts`.
 */
import type { AttentionItem } from "./attention";

const AWAY_MS = 5 * 60_000;
const MAX_LINKS = 50;
/** A .torrent file is small; a bigger one is not what it says it is */
export const MAX_TORRENT_BYTES = 1024 * 1024;

export type Group = "downloading" | "seeding" | "paused" | "finished" | "checking" | "error";

export interface Torrent {
  hash: string;
  name: string;
  group: Group;
  /** Waiting: nothing is passing, by the queue or for lack of peers */
  waiting: boolean;
  /** 0–100 */
  percent: number;
  size: number;
  down: number;
  up: number;
  /** Seconds left; null — not known */
  eta: number | null;
  ratio: number;
  added: number;
  path: string;
}

export interface Totals {
  total: number;
  /** Something is passing, one way or the other */
  active: number;
  downloading: number;
  seeding: number;
  paused: number;
  errors: number;
  down: number;
  up: number;
}

const GROUPS: Record<string, Group> = {
  downloading: "downloading",
  metaDL: "downloading",
  forcedMetaDL: "downloading",
  forcedDL: "downloading",
  stalledDL: "downloading",
  queuedDL: "downloading",
  allocating: "downloading",
  moving: "downloading",
  uploading: "seeding",
  stalledUP: "seeding",
  forcedUP: "seeding",
  queuedUP: "seeding",
  // named "paused" up to qBittorrent 4, "stopped" since 5
  stoppedDL: "paused",
  pausedDL: "paused",
  stoppedUP: "finished",
  pausedUP: "finished",
  checkingDL: "checking",
  checkingUP: "checking",
  checkingResumeData: "checking",
  error: "error",
  missingFiles: "error",
};
const WAITING = new Set(["stalledDL", "stalledUP", "queuedDL", "queuedUP"]);
/** qBittorrent's word for "no idea": 100 days */
const NO_ETA = 8_640_000;

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function readTorrent(raw: Record<string, unknown>): Torrent {
  const state = String(raw.state ?? "");
  const eta = typeof raw.eta === "number" && raw.eta >= 0 && raw.eta < NO_ETA ? raw.eta : null;
  return {
    hash: String(raw.hash ?? ""),
    name: String(raw.name ?? ""),
    group: GROUPS[state] ?? "downloading",
    waiting: WAITING.has(state),
    percent: Math.min(100, Math.round(count(raw.progress) * 1000) / 10),
    size: count(raw.size),
    down: count(raw.dlspeed),
    up: count(raw.upspeed),
    eta,
    ratio: Math.round(count(raw.ratio) * 100) / 100,
    added: count(raw.added_on) * 1000,
    path: String(raw.save_path ?? ""),
  };
}

export function totalsOf(torrents: Torrent[]): Totals {
  const t: Totals = { total: torrents.length, active: 0, downloading: 0, seeding: 0, paused: 0, errors: 0, down: 0, up: 0 };
  for (const x of torrents) {
    t.down += x.down;
    t.up += x.up;
    if (x.down > 0 || x.up > 0) t.active++;
    if (x.group === "downloading") t.downloading++;
    else if (x.group === "seeding") t.seeding++;
    else if (x.group === "paused" || x.group === "finished") t.paused++;
    else if (x.group === "error") t.errors++;
  }
  return t;
}

/** The session's cookie out of what the login answered: `SID` up to 5.1, `QBT_SID_<port>` since */
export function sessionCookie(headers: string[]): string {
  for (const line of headers) {
    const pair = line.split(";")[0]!.trim();
    if (/^(QBT_)?SID(_\d+)?=./i.test(pair)) return pair;
  }
  return "";
}

/** Pausing is `pause` / `resume` up to Web API 2.10 and `stop` / `start` since 2.11 (qBittorrent 5) */
export function verbsOf(webApi: string): { pause: string; resume: string } {
  const [major = 0, minor = 0] = webApi.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 11) ? { pause: "stop", resume: "start" } : { pause: "pause", resume: "resume" };
}

/** A Web API's version is what tells qBittorrent from whatever else answers on the port */
export const isWebApiVersion = (text: string) => /^\d+\.\d+(\.\d+)?$/.test(text.trim());

export function cleanHashes(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 500) return null;
  const hashes = value.map((x) => String(x).toLowerCase());
  return hashes.every((x) => /^([a-f0-9]{40}|[a-f0-9]{64})$/.test(x)) ? hashes : null;
}

/** Links, one a line: a magnet, a web address of a .torrent, or a bare hash */
export function cleanLinks(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const links = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!links.length || links.length > MAX_LINKS) return null;
  return links.every((x) => /^magnet:\?\S+$/i.test(x) || /^https?:\/\/\S+$/i.test(x) || /^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(x)) ? links : null;
}

/** A torrent is a bencoded dictionary with an `info` in it */
export function isTorrentFile(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes.length > MAX_TORRENT_BYTES || bytes[0] !== 0x64) return false;
  return Buffer.from(bytes).includes("4:info");
}

export interface Watched {
  id: string;
  name: string;
  error: { code: string; since: number } | null;
  ready: boolean;
  /** Names of the torrents in error */
  failed: string[];
}

export function trouble(q: Watched, now = Date.now()): AttentionItem[] {
  const base = { host: q.id, name: q.name };
  if (q.error) {
    if (q.error.code === "qbit.badLogin" || q.error.code === "qbit.banned") return [{ id: `qbit:${q.id}`, severity: "danger", code: q.error.code, detail: base }];
    return now - q.error.since > AWAY_MS ? [{ id: `qbit:${q.id}`, severity: "warn", code: "qbit.away", detail: base }] : [];
  }
  if (!q.ready || !q.failed.length) return [];
  return [{ id: `qbit:${q.id}:errors`, severity: "warn", code: "qbit.errors", detail: { ...base, n: q.failed.length, torrent: q.failed[0]! } }];
}
