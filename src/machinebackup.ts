/**
 * Snapshots of the apps of other machines, kept on this server next to its own: `<backup dir>/<name>@
 * <machine>/<id>.tar.gz` and its JSON, the same shape as an app's here — so the Backups page, the daily
 * run, deleting and the second copy elsewhere treat them alike.
 *
 * The machine's client makes the archive (`apps.snapshot`: the app's folder, its own data folder, its
 * named volumes, the app stopped meanwhile) and streams it here; a restore streams it back
 * (`apps.restore`), and the client checks it holds only those paths before it replaces anything.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { appMeta, parseCompose } from "./appform";
import { AppError, jobFinished, startJob, type Job, type Log } from "./apps";
import { appBackupDir, backupDir, BACKUP_KEY_RE, deleteFiles, expired, listSnapshots, mirror, onMachineBackups, SNAPSHOT_ID_RE, snapshotId, type BackupApp, type Snapshot, type SnapshotReason } from "./backup";
import { settings } from "./config";
import { writeJsonAtomic } from "./fsutil";
import { call, machine, machineDataRoot, machines, open } from "./machines";
import { MuxError } from "./mux";

const keyOf = (id: string, name: string) => `${name}@${id}`;
const split = (key: string): { name: string; id: string } | null => {
  const m = /^([a-z0-9][a-z0-9_-]{0,63})@([a-f0-9]{8})$/.exec(key);
  return m ? { name: m[1]!, id: m[2]! } : null;
};

const asApp = (e: unknown): never => {
  if (e instanceof MuxError) throw new AppError(e.code, 400, e.detail);
  throw e;
};

const mb = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(n / 1024 ** 2)} MB`);

async function takeSnapshot(id: string, name: string, reason: SnapshotReason, log: Log): Promise<Snapshot> {
  const key = keyOf(id, name);
  const dir = appBackupDir(key);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = new Date();
  const snap = snapshotId(at);
  const archive = join(dir, snap + ".tar.gz");
  const partial = archive + ".partial";
  log(`Taking a snapshot of ${name} on ${machine(id).name}`);
  const channel = open(id, "apps.snapshot", { name, root: machineDataRoot(id) });
  const out = Bun.file(partial).writer();
  let size = 0;
  const tick = setInterval(() => log(`  ${mb(size)}`), 3000);
  let said: { paths: string[]; images: string[] };
  try {
    for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
      out.write(chunk);
      size += chunk.length;
    }
    await out.end();
    said = (await channel.result) as typeof said;
    renameSync(partial, archive);
  } catch (e) {
    channel.cancel();
    await Promise.resolve(out.end()).catch(() => {});
    rmSync(partial, { force: true });
    asApp(e);
    throw e;
  } finally {
    clearInterval(tick);
  }
  const snapshot: Snapshot = { id: snap, app: key, at: at.getTime(), reason, size: statSync(archive).size, paths: said!.paths, images: said!.images, dataRoot: machineDataRoot(id) };
  writeJsonAtomic(join(dir, snap + ".json"), snapshot);
  log(`Snapshot ${snap}: ${mb(snapshot.size)}, kept on this server in ${dir}`);
  for (const old of expired(listSnapshots(key), settings.backup.keep)) {
    deleteFiles(key, old.id);
    log(`Removed old snapshot ${old.id}`);
  }
  return snapshot;
}

const label = (id: string, name: string) => ({ app: name, machine: machine(id).name });

export function backupMachineApp(key: string, user: string, reason: SnapshotReason = "manual"): Job {
  const parts = split(key);
  if (!parts) throw new AppError("app.notFound", 404);
  const m = machine(parts.id);
  if (!m.online) throw new AppError("machine.offline", 409, { name: m.name });
  return startJob(key, "backup", user, async (log) => {
    await takeSnapshot(parts.id, parts.name, reason, log);
    mirror();
  }, false, label(parts.id, parts.name));
}

export function restoreMachineApp(key: string, snap: string, user: string): Job {
  const parts = split(key);
  if (!parts || !SNAPSHOT_ID_RE.test(snap)) throw new AppError("backup.notFound", 404);
  const snapshot = listSnapshots(key).find((s) => s.id === snap);
  if (!snapshot) throw new AppError("backup.notFound", 404);
  const m = machine(parts.id);
  if (!m.online) throw new AppError("machine.offline", 409, { name: m.name });
  return startJob(key, "restore", user, async (log) => {
    log(`Sending ${snap} back to ${m.name}`);
    const channel = open(parts.id, "apps.restore", { name: parts.name, paths: snapshot.paths });
    try {
      for await (const chunk of createReadStream(join(appBackupDir(key), snap + ".tar.gz"))) await channel.send(chunk as Uint8Array);
      channel.end();
      await channel.result;
    } catch (e) {
      channel.cancel();
      asApp(e);
    }
    log(`${parts.name} is restored on ${m.name} and started`);
  }, false, label(parts.id, parts.name));
}

/** The apps of the machines on the Backups page: those there now, and those with snapshots kept here */
async function entries(lang: string): Promise<BackupApp[]> {
  const list = machines();
  const out = new Map<string, BackupApp>();
  for (const m of list.filter((x) => x.online)) {
    const files = await call<{ name: string; compose: string }[]>(m.id, "apps.list").catch(() => []);
    for (const f of files) {
      let title = f.name;
      let icon = "";
      try {
        const meta = appMeta(parseCompose(f.compose), lang);
        title = meta.title || f.name;
        icon = meta.icon;
      } catch {}
      const key = keyOf(m.id, f.name);
      out.set(key, { name: key, machine: { id: m.id, name: m.name }, title, icon, installed: true, included: !settings.backup.exclude.includes(key), snapshots: listSnapshots(key), otherFolders: [], extraFolders: [] });
    }
  }
  let stored: string[] = [];
  try {
    stored = readdirSync(backupDir()).filter((d) => d.includes("@") && BACKUP_KEY_RE.test(d) && !out.has(d));
  } catch {}
  for (const key of stored) {
    const parts = split(key)!;
    const snapshots = listSnapshots(key);
    if (!snapshots.length) continue;
    const m = list.find((x) => x.id === parts.id);
    out.set(key, { name: key, machine: { id: parts.id, name: m?.name ?? parts.id }, title: parts.name, icon: "", installed: false, included: !settings.backup.exclude.includes(key), snapshots, otherFolders: [], extraFolders: [] });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The daily run's part: every app of every connected machine that is not left out */
async function runAll(user: string, reason: SnapshotReason): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  for (const m of machines()) {
    if (!m.info?.docker.available && m.online) continue;
    const files = m.online ? await call<{ name: string }[]>(m.id, "apps.list").catch(() => null) : null;
    if (!files) {
      // a machine that is away: its apps are not backed up today, and that is said
      const had = readdirSafe().filter((d) => d.endsWith("@" + m.id));
      failed.push(...had);
      continue;
    }
    for (const f of files) {
      const key = keyOf(m.id, f.name);
      if (settings.backup.exclude.includes(key)) continue;
      try {
        const job = backupMachineApp(key, user, reason);
        await jobFinished(job);
        if (job.status === "done") ok++;
        else failed.push(key);
      } catch {
        failed.push(key);
      }
    }
  }
  return { ok, failed };
}

const readdirSafe = (): string[] => {
  try {
    return existsSync(backupDir()) ? readdirSync(backupDir()) : [];
  } catch {
    return [];
  }
};

onMachineBackups(entries, runAll);
