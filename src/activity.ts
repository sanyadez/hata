/**
 * The activity log: what happened on this server and when, newest last. Shown on the home page and on an
 * app's page. Entries carry a code and details; the UI words them in the user's language.
 */
import { join } from "node:path";
import { bus } from "./bus";
import { DATA_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";

const FILE = join(DATA_DIR, "activity.json");
const KEEP = 300;

export interface Activity {
  ts: number;
  /** e.g. `app.install.done`, `app.update.failed`, `auth.signin` */
  code: string;
  app?: string;
  user?: string;
  /** Extra text: an error message, an address */
  detail?: string;
}

let entries: Activity[] = readJsonFile<Activity[]>(FILE, [], Array.isArray);

export function record(code: string, data: Omit<Activity, "ts" | "code"> = {}): void {
  entries.push({ ts: Date.now(), code, ...data });
  if (entries.length > KEEP) entries = entries.slice(-KEEP);
  try {
    writeJsonAtomic(FILE, entries);
  } catch (e) {
    // the log is a convenience: failing to write it must not fail the operation being logged
    console.error("Could not write the activity log:", e instanceof Error ? e.message : e);
  }
  bus.publish("activity");
}

/** The newest entries first; `app` narrows to one app */
export function recent(limit: number, app?: string): Activity[] {
  const list = app ? entries.filter((e) => e.app === app) : entries;
  return list.slice(-limit).reverse();
}
