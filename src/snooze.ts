/**
 * "Remind me later" for the items of the "needs attention" list. An item put off stays out of the list
 * (and so out of the notifications) until its time is up — or until it gets worse: a warning that turns
 * into a danger, or an event that happens again (another `at`), is shown at once. State is
 * `snoozed.json` in the state directory; ended entries are dropped as they are met.
 */
import { join } from "node:path";
import type { AttentionItem } from "./attention";
import { DATA_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";

export interface Snoozed {
  until: number;
  /** What the item was when it was put off */
  severity: AttentionItem["severity"];
  at: number;
}

const FILE = join(DATA_DIR, "snoozed.json");
const DAY = 24 * 60 * 60_000;
/** The longest one may put an item off */
export const MAX_DAYS = 30;

let saved: Record<string, Snoozed> = readJsonFile<Record<string, Snoozed>>(FILE, {}, isPlainObject);

// --- Pure -------------------------------------------------------------------------------------------

const RANK = { warn: 0, danger: 1 } as const;

/** Whether an item is still put off: its time has not come and it is no worse than it was */
export function asleep(item: AttentionItem, entry: Snoozed | undefined, now: number): boolean {
  return !!entry && entry.until > now && RANK[item.severity] <= RANK[entry.severity] && (item.at ?? 0) === entry.at;
}

/** The list without what is put off */
export const awake = (items: AttentionItem[], snoozed: Record<string, Snoozed>, now: number): AttentionItem[] => items.filter((item) => !asleep(item, snoozed[item.id], now));

// --- State ------------------------------------------------------------------------------------------

/** The items of the list that are not put off now */
export function notSnoozed(items: AttentionItem[]): AttentionItem[] {
  const now = Date.now();
  const ended = Object.keys(saved).filter((id) => saved[id]!.until <= now);
  if (ended.length) {
    for (const id of ended) delete saved[id];
    writeJsonAtomic(FILE, saved);
  }
  return awake(items, saved, now);
}

/** Puts an item off for `days`; a string is the error's code */
export function snooze(input: Record<string, unknown>): string | null {
  const { id, severity, at, days } = input;
  if (typeof id !== "string" || !id || id.length > 300) return "attention.badItem";
  if (severity !== "warn" && severity !== "danger") return "attention.badItem";
  if (at !== undefined && (typeof at !== "number" || !Number.isFinite(at))) return "attention.badItem";
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) return "attention.badDays";
  saved = { ...saved, [id]: { until: Date.now() + days * DAY, severity, at: (at as number | undefined) ?? 0 } };
  writeJsonAtomic(FILE, saved);
  return null;
}
