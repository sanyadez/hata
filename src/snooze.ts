/**
 * "Remind me later" and "never remind me" for the items of the "needs attention" list. An item put off stays
 * out of the list (and so out of the notifications) until its time is up — or until it gets worse: a warning
 * that turns into a danger is shown at once, and so is an event put off for some days that happens again
 * (another `at`). One put off for good comes back only when it gets worse. State is `snoozed.json` in the
 * state directory; ended entries are dropped as they are met. Each entry keeps the item's code and detail,
 * so the list of what is hidden can word it while it is not happening.
 */
import { join } from "node:path";
import type { AttentionItem } from "./attention";
import { DATA_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";

export interface Snoozed {
  /** When it comes back; 0 — never */
  until: number;
  /** What the item was when it was put off */
  severity: AttentionItem["severity"];
  at: number;
  /** When it was put off */
  put?: number;
  code?: string;
  detail?: Record<string, string | number>;
  app?: string;
}

/** An entry as the list of what is hidden shows it */
export interface Hidden {
  id: string;
  until: number;
  put: number;
  severity: AttentionItem["severity"];
  code: string;
  detail: Record<string, string | number>;
  app?: string;
}

const FILE = join(DATA_DIR, "snoozed.json");
const DAY = 24 * 60 * 60_000;
/** The longest one may put an item off for some days */
export const MAX_DAYS = 30;

let saved: Record<string, Snoozed> = readJsonFile<Record<string, Snoozed>>(FILE, {}, isPlainObject);

// --- Pure -------------------------------------------------------------------------------------------

const RANK = { warn: 0, danger: 1 } as const;

/** Whether an item is still put off: its time has not come and it is no worse than it was */
export function asleep(item: AttentionItem, entry: Snoozed | undefined, now: number): boolean {
  if (!entry || RANK[item.severity] > RANK[entry.severity]) return false;
  if (entry.until === 0) return true;
  return entry.until > now && (item.at ?? 0) === entry.at;
}

/** The list without what is put off */
export const awake = (items: AttentionItem[], snoozed: Record<string, Snoozed>, now: number): AttentionItem[] => items.filter((item) => !asleep(item, snoozed[item.id], now));

const ended = (entry: Snoozed, now: number) => entry.until !== 0 && entry.until <= now;

/** A detail as the client sends it: a few short strings and numbers, nothing else */
function cleanDetail(detail: unknown): Record<string, string | number> | null {
  if (detail === undefined) return {};
  if (!isPlainObject(detail)) return null;
  const out: Record<string, string | number> = {};
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length > 20) return null;
  for (const [key, value] of entries) {
    if (key.length > 40) return null;
    if (typeof value === "string") out[key] = value.slice(0, 500);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (value !== null && value !== undefined) return null;
  }
  return out;
}

// --- State ------------------------------------------------------------------------------------------

function sweep(now: number) {
  const gone = Object.keys(saved).filter((id) => ended(saved[id]!, now));
  if (!gone.length) return;
  for (const id of gone) delete saved[id];
  writeJsonAtomic(FILE, saved);
}

/** The items of the list that are not put off now */
export function notSnoozed(items: AttentionItem[]): AttentionItem[] {
  const now = Date.now();
  sweep(now);
  return awake(items, saved, now);
}

/** What is put off now, those put off for good first, then by when they come back */
export function hidden(): Hidden[] {
  sweep(Date.now());
  return Object.entries(saved)
    .map(([id, e]) => ({ id, until: e.until, put: e.put ?? 0, severity: e.severity, code: e.code ?? "", detail: e.detail ?? {}, ...(e.app ? { app: e.app } : {}) }))
    .sort((a, b) => (a.until === 0 ? 0 : 1) - (b.until === 0 ? 0 : 1) || a.until - b.until || b.put - a.put);
}

/** How many are put off now */
export const hiddenCount = (): number => (sweep(Date.now()), Object.keys(saved).length);

/** Puts an item off for `days`, or for good (`forever`); a string is the error's code */
export function snooze(input: Record<string, unknown>): string | null {
  const { id, severity, at, days, forever, code, app } = input;
  if (typeof id !== "string" || !id || id.length > 300) return "attention.badItem";
  if (severity !== "warn" && severity !== "danger") return "attention.badItem";
  if (at !== undefined && (typeof at !== "number" || !Number.isFinite(at))) return "attention.badItem";
  if (code !== undefined && (typeof code !== "string" || code.length > 100)) return "attention.badItem";
  if (app !== undefined && (typeof app !== "string" || app.length > 200)) return "attention.badItem";
  const detail = cleanDetail(input.detail);
  if (!detail) return "attention.badItem";
  if (forever !== true && (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS)) return "attention.badDays";
  const now = Date.now();
  saved = { ...saved, [id]: { until: forever === true ? 0 : now + (days as number) * DAY, severity, at: (at as number | undefined) ?? 0, put: now, code: (code as string | undefined) ?? "", detail, ...(app ? { app: app as string } : {}) } };
  writeJsonAtomic(FILE, saved);
  return null;
}

/** Brings an item back to the list at once; false when it was not put off */
export function wake(id: string): boolean {
  if (!(id in saved)) return false;
  const { [id]: _, ...rest } = saved;
  saved = rest;
  writeJsonAtomic(FILE, saved);
  return true;
}
