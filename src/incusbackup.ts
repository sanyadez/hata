/**
 * Snapshots of the containers and virtual machines of this server, kept next to the apps' own:
 * `<backup dir>/<name>@incus/<id>.tar.gz` and its JSON, the same shape — so the Backups page, the daily
 * run, deleting and the second copy elsewhere treat them alike.
 *
 * A snapshot is Incus's own export of the whole instance (its system and everything in it, without its
 * Incus snapshots), taken while it is stopped and started again after, as an app is. Incus writes the
 * export into its own folder first and Hata moves it here, so the room is needed twice for a moment.
 * A restore imports it under a name of its own, and only once that worked the old one is deleted and
 * the new one takes its name: a machine it was comes back with its own keys.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, jobFinished, startJob, type Job, type Log } from "./apps";
import { addBackupSource, appBackupDir, backupDir, deleteFiles, expired, listSnapshots, mirror, SNAPSHOT_ID_RE, snapshotId, type BackupApp, type Snapshot, type SnapshotReason } from "./backup";
import { bus } from "./bus";
import { settings } from "./config";
import { findContainer, finished, incus, placeForRestore, SOCKET } from "./containers";
import { writeJsonAtomic } from "./fsutil";
import { readInstance, type Container } from "./incus";

export const INCUS_KEY_RE = /^([a-z][a-z0-9-]{0,62})@incus$/;
const keyOf = (name: string) => `${name}@incus`;
const nameOf = (key: string): string => {
  const m = INCUS_KEY_RE.exec(key);
  if (!m) throw new AppError("backup.notFound", 404);
  return m[1]!;
};

const mb = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(n / 1024 ** 2)} MB`);
const label = (name: string) => ({ app: name, machine: "" });

/** Stops an instance for a while: cleanly, and by force when it does not stop in a minute */
async function stopFor(name: string, log: Log): Promise<void> {
  log(`Stopping ${name} for the snapshot`);
  try {
    await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 60 }), 90);
  } catch {
    await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 30, force: true }), 60);
  }
}

const start = async (name: string): Promise<void> => finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "start" }), 120);

async function takeSnapshot(c: Container, reason: SnapshotReason, log: Log): Promise<Snapshot> {
  const key = keyOf(c.name);
  const dir = appBackupDir(key);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = new Date();
  const id = snapshotId(at);
  const archive = join(dir, id + ".tar.gz");
  const partial = archive + ".partial";
  const backup = `hata-${id}`;
  const running = c.status === "running";
  if (running) await stopFor(c.name, log);
  try {
    log(`Incus is exporting ${c.name}`);
    await finished(await incus("POST", `/1.0/instances/${c.name}/backups`, { name: backup, instance_only: true, optimized_storage: false, compression_algorithm: "gzip" }), 6 * 3600);
    log("Copying the export into the backup folder");
    let r: Response;
    try {
      r = await fetch(`http://incus/1.0/instances/${c.name}/backups/${backup}/export`, { unix: SOCKET } as RequestInit);
    } catch (e) {
      throw new AppError("containers.noAnswer", 503, { message: e instanceof Error ? e.message : String(e) });
    }
    if (!r.ok || !r.body) throw new AppError("containers.failed", 409, { message: `HTTP ${r.status}` });
    const out = Bun.file(partial).writer();
    let size = 0;
    const tick = setInterval(() => log(`  ${mb(size)}`), 3000);
    try {
      for await (const chunk of r.body) {
        out.write(chunk);
        size += chunk.length;
      }
      await out.end();
      renameSync(partial, archive);
    } catch (e) {
      await Promise.resolve(out.end()).catch(() => {});
      rmSync(partial, { force: true });
      throw e;
    } finally {
      clearInterval(tick);
    }
  } finally {
    // Incus's own copy goes whatever happened; the instance runs again as it did
    await incus("DELETE", `/1.0/instances/${c.name}/backups/${backup}`).then((op) => finished(op, 300)).catch(() => {});
    if (running) await start(c.name).catch((e) => log(`Could not start ${c.name} again: ${e instanceof Error ? e.message : e}`));
  }
  const snapshot: Snapshot = { id, app: key, at: at.getTime(), reason, size: statSync(archive).size, paths: [], images: c.os ? [c.os] : [], ...(c.place ? { place: c.place } : {}) };
  writeJsonAtomic(join(dir, id + ".json"), snapshot);
  log(`Snapshot ${id}: ${mb(snapshot.size)}, in ${dir}`);
  for (const old of expired(listSnapshots(key), settings.backup.keep)) {
    deleteFiles(key, old.id);
    log(`Removed old snapshot ${old.id}`);
  }
  return snapshot;
}

/** A snapshot of one container or virtual machine (a job of kind `backup`) */
export function backupInstance(key: string, user: string, reason: SnapshotReason = "manual"): Job {
  const name = nameOf(key);
  return startJob(`incus:${name}`, "backup", user, async (log) => {
    const c = await findContainer(name);
    await takeSnapshot(c, reason, log);
    mirror();
  }, false, label(name));
}

/**
 * Puts a container or virtual machine back as it was in a snapshot (a job of kind `restore`): imported
 * under a name of its own first, then the old one — with its own Incus snapshots — is deleted and the
 * imported one takes its name. One that was deleted meanwhile is simply made again.
 */
export function restoreInstance(key: string, snap: string, user: string): Job {
  const name = nameOf(key);
  if (!SNAPSHOT_ID_RE.test(snap) || !listSnapshots(key).some((s) => s.id === snap)) throw new AppError("backup.notFound", 404);
  const archive = join(appBackupDir(key), snap + ".tar.gz");
  if (!existsSync(archive)) throw new AppError("backup.notFound", 404);
  return startJob(`incus:${name}`, "restore", user, async (log) => {
    const temp = `${name.slice(0, 54)}-restoring`;
    await incus("DELETE", `/1.0/instances/${temp}`).then((op) => finished(op, 300)).catch(() => {});
    // back where it lived (a snapshot keeps its place too), or where new ones go once that place is gone
    const old = await findContainer(name).catch(() => null);
    const was = old?.place || String(listSnapshots(key).find((s) => s.id === snap)?.place ?? "");
    const pool = await placeForRestore(was);
    log(`Importing ${snap} (${mb(statSync(archive).size)})`);
    let r: Response;
    try {
      r = await fetch("http://incus/1.0/instances", { unix: SOCKET, method: "POST", body: Bun.file(archive), headers: { "content-type": "application/octet-stream", "X-Incus-name": temp, "X-Incus-pool": pool } } as RequestInit);
    } catch (e) {
      throw new AppError("containers.noAnswer", 503, { message: e instanceof Error ? e.message : String(e) });
    }
    const op = (await r.json().catch(() => null)) as any;
    if (!op || op.type === "error") throw new AppError("containers.failed", 409, { message: String(op?.error ?? `HTTP ${r.status}`) });
    try {
      await finished(op, 6 * 3600);
    } catch (e) {
      await incus("DELETE", `/1.0/instances/${temp}`).then((o) => finished(o, 300)).catch(() => {});
      throw e;
    }
    if (old) {
      log(`Replacing ${name}`);
      if (old.status === "running") await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 30, force: true }), 60);
      await finished(await incus("DELETE", `/1.0/instances/${name}`), 600);
    }
    await finished(await incus("POST", `/1.0/instances/${temp}`, { name }), 300);
    if (!old || old.status === "running") {
      log(`Starting ${name}`);
      await start(name);
    }
    log(`${name} is back as it was at ${snap}`);
    record("containers.restored", { user, detail: `${name} · ${snap}` });
    bus.publish("containers");
  }, false, label(name));
}

/** The instances on the Backups page: those there now, and those whose snapshots are kept here */
async function entries(): Promise<BackupApp[]> {
  const out = new Map<string, BackupApp>();
  const entry = (name: string, kind: string, installed: boolean): BackupApp => {
    const key = keyOf(name);
    return { name: key, title: name, icon: "", installed, included: !settings.backup.exclude.includes(key), snapshots: listSnapshots(key), otherFolders: [], extraFolders: [], incus: { kind } };
  };
  if (existsSync(SOCKET)) {
    const list = ((await incus("GET", "/1.0/instances?recursion=1").catch(() => null))?.metadata ?? []) as any[];
    for (const raw of list) {
      const c = readInstance({ ...raw, state: null, snapshots: [] });
      if (c) out.set(keyOf(c.name), entry(c.name, c.kind, true));
    }
  }
  let stored: string[] = [];
  try {
    stored = readdirSync(backupDir()).filter((d) => INCUS_KEY_RE.test(d) && !out.has(d));
  } catch {}
  for (const key of stored) {
    const one = entry(nameOf(key), "", false);
    if (one.snapshots.length) out.set(key, one);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The daily run's part: every instance that is not left out */
async function runAll(user: string, reason: SnapshotReason): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  if (!existsSync(SOCKET)) return { ok, failed };
  const names = ((await incus("GET", "/1.0/instances").catch(() => null))?.metadata ?? []) as string[];
  for (const path of names) {
    const key = keyOf(path.split("/").pop()!);
    if (settings.backup.exclude.includes(key)) continue;
    try {
      const job = backupInstance(key, user, reason);
      await jobFinished(job);
      if (job.status === "done") ok++;
      else failed.push(key);
    } catch {
      failed.push(key);
    }
  }
  return { ok, failed };
}

addBackupSource(entries, runAll);
