/**
 * Newer versions of the system's packages, of this server and of the machines (Settings → System
 * programs, the overview of a machine).
 *
 * Asked a few minutes after the start when not asked for a day, then daily, and by "Check now": the
 * package lists are refreshed, nothing is installed. Installing is the person's button — every
 * package, the chosen ones, or one program's — and runs as a job with the package manager's log.
 * A machine is asked through its client, which runs the same `pkgupdates.ts`.
 */
import { join } from "node:path";
import { record } from "./activity";
import { AppError, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { DATA_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { call, machine, machines, open } from "./machines";
import { MuxError } from "./mux";
import { checkPackages, upgradePackages, type PackageUpdates } from "./pkgupdates";

const STATE_FILE = join(DATA_DIR, "sysupdates.json");
const CHECK_EVERY_MS = 24 * 3600_000;

/** "" — this server; else a machine's id */
const state: Record<string, PackageUpdates> = readJsonFile<Record<string, PackageUpdates>>(STATE_FILE, {}, isPlainObject);
const checking = new Set<string>();

export interface UpdatesView extends Partial<PackageUpdates> {
  checking: boolean;
}

/** What the last check found */
export const packageUpdates = (at = ""): UpdatesView => ({ ...(state[at] ?? {}), checking: checking.has(at) });

/** A client older than these calls does not know them: it is to be brought to Hata's version */
function onMachine<T>(id: string, op: string, args: unknown = {}): Promise<T> {
  const { name } = machine(id);
  return call<T>(id, op, args).catch((e) => {
    throw e instanceof AppError && e.code === "machine.unknownOperation" ? new AppError("machine.clientOutdated", 409, { name }) : e;
  });
}

/** Refreshes the lists and asks again; answers with what it found */
export async function checkUpdates(at = ""): Promise<UpdatesView> {
  if (at) machine(at);
  if (!checking.has(at)) {
    checking.add(at);
    bus.publish("sysupdates", { at });
    try {
      state[at] = at ? await onMachine<PackageUpdates>(at, "system.updates.check") : await checkPackages();
      writeJsonAtomic(STATE_FILE, state);
    } finally {
      checking.delete(at);
      bus.publish("sysupdates", { at });
    }
  } else while (checking.has(at)) await Bun.sleep(500);
  return packageUpdates(at);
}

/** Installs newer versions: of every package (`packages` empty) or the ones named; a job with the log */
export function upgrade(packages: unknown, user: string, at = ""): Job {
  const names = Array.isArray(packages) ? packages.map(String) : [];
  if (names.some((name) => !/^[a-z0-9][a-z0-9+._-]*(:[a-z0-9]+)?$/i.test(name)) || names.length > 500) throw new AppError("request.notFound", 404);
  const m = at ? machine(at) : null;
  if (m && !m.online) throw new AppError("machine.offline", 409, { name: m.name });
  const work = async (log: (line: string) => void) => {
    if (!m) await upgradePackages(names, log);
    else {
      const channel = open(at, "system.updates.upgrade", { packages: names });
      const decoder = new TextDecoder();
      let rest = "";
      try {
        for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
          rest += decoder.decode(chunk, { stream: true });
          const lines = rest.split("\n");
          rest = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) log(line);
        }
        if (rest.trim()) log(rest);
        await channel.result;
      } catch (e) {
        if (e instanceof MuxError && e.code === "machine.unknownOperation") throw new AppError("machine.clientOutdated", 409, { name: m.name });
        throw e instanceof MuxError ? new Error(e.message) : e;
      }
    }
    record(names.length ? "system.packages.updated" : "system.packages.all", { user, machine: m?.name, detail: names.join(", ").slice(0, 300) });
    log("");
    log("Checking again…");
    await checkUpdates(at).catch(() => {});
  };
  // one update at a time per place: the package manager allows no more
  return startJob(at ? `@system@${at}` : "@system", "sysupdate", user, work, true, m ? { app: "", machine: m.name } : undefined);
}

/** Checks this server and every connected machine when their last check is a day old */
export function startSysUpdates(): void {
  const due = async () => {
    for (const at of ["", ...machines().filter((m) => m.online).map((m) => m.id)]) {
      if (Date.now() - (state[at]?.at ?? 0) < CHECK_EVERY_MS) continue;
      await checkUpdates(at).catch((e) => console.error(`Could not check for system updates${at ? " on " + at : ""}:`, e instanceof Error ? e.message : e));
    }
  };
  setTimeout(due, 6 * 60_000);
  setInterval(due, 3600_000);
}
