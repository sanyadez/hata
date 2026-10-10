/**
 * The backup of the server itself, and `hata restore`.
 *
 * Next to the snapshots of the apps (`<backup dir>/<app>/`) lies `<backup dir>/_server/`: snapshots of
 * Hata's own state — settings, users, the compose files of the apps, certificates. Together they are the
 * whole server: on a new machine `hata restore <backup dir>` puts the state back, and the server, once
 * started, brings every app back from its latest snapshot (`resumeRestore` in `backup.ts`).
 *
 * This file is what the command line needs and nothing more: it must run before there is any state.
 */
import { MOVED_MARK, serviceStateDir } from "./statedir";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { openFile, SEALED_EXT, SealError } from "./seal";
import { COMPILED, VERSION } from "./version";

export const SERVER_DIR = "_server";
/** Left in the state directory by `hata restore`: the server finishes the job when it starts */
export const RESTORE_MARK = "restore.json";

export interface ServerSnapshot {
  /** Also the file name: local time, `20261009-031400` */
  id: string;
  at: number;
  reason: "manual" | "schedule";
  size: number;
  /** The version of Hata that made it */
  version: string;
  /** The apps installed at that moment */
  apps: string[];
}

export function listServerSnapshots(backupDir: string): ServerSnapshot[] {
  const dir = join(backupDir, SERVER_DIR);
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: ServerSnapshot[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !/^\d{8}-\d{6}$/.test(id)) continue;
    const meta = readJsonFile<ServerSnapshot | null>(join(dir, file), null);
    if (meta && existsSync(join(dir, id + ".tar.gz"))) out.push({ ...meta, id, apps: Array.isArray(meta.apps) ? meta.apps : [] });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * What of the state directory stays out of a snapshot: sign-ins that are still open (a restored server
 * asks to sign in again), what is downloaded anew (the stores), the marks of an update or a restore in
 * progress — and the backups themselves, when they are kept inside.
 */
export function stateExcludes(dataDir: string, backupDir: string): string[] {
  // the mark of a moved folder belongs to this machine: a restore must neither bring one nor take it away
  const skip = ["./sessions.json", "./stores", "./update.json", "./" + RESTORE_MARK, "./" + MOVED_MARK];
  const inside = relative(dataDir, backupDir);
  if (inside && !inside.startsWith("..") && !inside.startsWith("/")) skip.push("./" + inside);
  return skip;
}

/** Members of a state archive must stay inside the directory it is unpacked into */
export function strayMembers(listing: string): string[] {
  return listing.split("\n").filter((member) => member && (!(member === "./" || member.startsWith("./")) || member.split("/").includes("..")));
}

const tar = (...args: string[]) => {
  const result = Bun.spawnSync({ cmd: ["tar", ...args], stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, out: result.stdout.toString(), error: result.stderr.toString().trim().split("\n").slice(-2).join("\n") };
};

function confirm(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = prompt(`${question} [y/N]`);
  return /^y(es)?$/i.test(answer?.trim() ?? "");
}

const USAGE = "Usage: hata restore <backup folder> [--yes]";

/**
 * Of a folder that came back from another machine sealed: the files of its latest snapshot, if that one
 * is not open yet. Older ones stay sealed — a restore takes the latest, and they can be opened by hand.
 */
export function sealedToOpen(names: string[]): string[] {
  const ids = [...new Set(names.map((name) => /^(\d{8}-\d{6})\.(tar\.gz|json)(\.enc)?$/.exec(name)?.[1]).filter((id): id is string => !!id))].sort();
  const latest = ids.findLast((id) => ["tar.gz", "json"].every((kind) => names.includes(`${id}.${kind}`) || names.includes(`${id}.${kind}${SEALED_EXT}`)));
  if (!latest) return [];
  return ["json", "tar.gz"].filter((kind) => !names.includes(`${latest}.${kind}`)).map((kind) => `${latest}.${kind}${SEALED_EXT}`);
}

/** Asks without showing what is typed */
function askSecret(question: string): string {
  if (!process.stdin.isTTY) return "";
  const stty = (mode: string) => Bun.spawnSync({ cmd: ["stty", mode], stdin: "inherit", stdout: "ignore", stderr: "ignore" });
  stty("-echo");
  try {
    return prompt(question) ?? "";
  } finally {
    stty("echo");
    console.log("");
  }
}

const passphrase = (): string => process.env.HATA_PASSPHRASE || askSecret("Passphrase of the backups:");

/** Opens the latest snapshot of every folder of a sealed copy, next to the sealed files. False — it could not */
async function openSealedCopy(from: string): Promise<boolean> {
  const work: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(from, { withFileTypes: true }).filter((e) => e.isDirectory() && (e.name === SERVER_DIR || /^[a-z0-9][a-z0-9_-]*$/.test(e.name))).map((e) => e.name);
  } catch {}
  // the server's own first: it is small, and a wrong passphrase shows at once
  for (const dir of dirs.sort((a, b) => Number(b === SERVER_DIR) - Number(a === SERVER_DIR))) work.push(...sealedToOpen(readdirSync(join(from, dir))).map((name) => join(from, dir, name)));
  if (!work.length) return true;
  console.log("These backups are sealed with a passphrase.");
  const secret = passphrase();
  if (!secret) {
    console.error("A passphrase is needed: type it when asked, or give it in HATA_PASSPHRASE.");
    return false;
  }
  for (const file of work) {
    console.log(`Opening ${file}`);
    try {
      await openFile(file, file.slice(0, -SEALED_EXT.length), secret);
    } catch (e) {
      console.error(e instanceof SealError ? e.message : `Could not open ${file}: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
  return true;
}

/** `hata unseal <file> [<output>]`: opens one sealed file by hand */
export async function unseal(args: string[]): Promise<number> {
  const [file, output, ...extra] = args;
  if (!file || extra.length || file.startsWith("--")) {
    console.error("Usage: hata unseal <file.enc> [<output file>]");
    return 2;
  }
  const to = output ?? (file.endsWith(SEALED_EXT) ? file.slice(0, -SEALED_EXT.length) : file + ".open");
  if (!existsSync(file)) {
    console.error(`There is no file ${file}.`);
    return 1;
  }
  if (existsSync(to)) {
    console.error(`${to} already exists.`);
    return 1;
  }
  const secret = passphrase();
  if (!secret) {
    console.error("A passphrase is needed: type it when asked, or give it in HATA_PASSPHRASE.");
    return 1;
  }
  try {
    await openFile(file, to, secret);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  console.log(to);
  return 0;
}

/** `hata restore <backup folder>`: puts Hata's state back from the latest snapshot of the server found there */
export async function restoreServer(args: string[]): Promise<number> {
  const flags = args.filter((a) => a.startsWith("--"));
  const [from, ...extra] = args.filter((a) => !a.startsWith("--"));
  if (!from || extra.length || flags.some((f) => f !== "--yes")) {
    console.error(USAGE);
    return 2;
  }
  if (COMPILED && process.getuid?.() !== 0) {
    console.error("This needs root: run it with sudo.");
    return 1;
  }
  // the state restored here must be the service's own
  if (COMPILED) process.env.HATA_DATA_DIR ??= serviceStateDir();
  const { DATA_DIR, SECRETS_DIR, SECRET_NAMES } = await import("./config");
  const apart = SECRETS_DIR !== DATA_DIR;

  if (!(await openSealedCopy(from))) return 1;
  const snapshot = listServerSnapshots(from)[0];
  if (!snapshot) {
    console.error(`No backup of the server was found in ${join(from, SERVER_DIR)}.\nGive the folder Hata kept its backups in (by default <data folder>/Backups).`);
    return 1;
  }
  const archive = join(from, SERVER_DIR, snapshot.id + ".tar.gz");
  const listing = tar("-tzf", archive);
  if (!listing.ok) {
    console.error(`The archive ${archive} is damaged: ${listing.error}`);
    return 1;
  }
  const stray = strayMembers(listing.out);
  if (stray.length) {
    console.error(`The archive holds files that do not belong to Hata's state: ${stray[0]}`);
    return 1;
  }

  console.log(`Backup of the server made ${new Date(snapshot.at).toLocaleString()} by Hata ${snapshot.version}.`);
  console.log(`Apps: ${snapshot.apps.length ? snapshot.apps.join(", ") : "(none)"}`);
  if (snapshot.version !== VERSION) console.log(`Note: this is Hata ${VERSION}; a backup made by a newer version may hold settings this one does not know.`);
  console.log("");
  console.log("What will happen:");
  console.log(`  1. Hata's state in ${DATA_DIR} (settings, users, the apps' compose files) is replaced by the backup.`);
  console.log(`     What is there now is kept in ${DATA_DIR}.before-restore.`);
  console.log("  2. Hata starts and brings every app back from its latest snapshot in the same folder:");
  console.log("     the app's data is replaced by the snapshot and the app is started.");
  console.log("");
  if (!flags.includes("--yes") && !confirm("Continue?")) {
    console.log("Nothing was changed. Run again with --yes to proceed without asking.");
    return 1;
  }

  const systemctl = (...a: string[]) => Bun.spawnSync({ cmd: ["systemctl", ...a], stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  const service = COMPILED && existsSync("/etc/systemd/system/hata.service");
  if (service) systemctl("stop", "hata.service");

  const aside = DATA_DIR + ".before-restore";
  rmSync(aside, { recursive: true, force: true });
  if (existsSync(DATA_DIR)) cpSync(DATA_DIR, aside, { recursive: true, preserveTimestamps: true });
  // the secrets lie apart from the state: what is there now is kept with the rest of it
  if (apart) for (const name of SECRET_NAMES) if (existsSync(join(SECRETS_DIR, name))) cpSync(join(SECRETS_DIR, name), join(aside, name), { recursive: true, preserveTimestamps: true });
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  // everything a snapshot holds goes; what it leaves out (the stores) may stay
  const kept = new Set(stateExcludes(DATA_DIR, from).map((path) => path.slice(2).split("/")[0]));
  for (const entry of readdirSync(DATA_DIR)) if (!kept.has(entry)) rmSync(join(DATA_DIR, entry), { recursive: true, force: true });
  const unpacked = tar("--numeric-owner", "-xzpf", archive, "-C", DATA_DIR);
  if (!unpacked.ok) {
    console.error(`Unpacking failed: ${unpacked.error}\nThe previous state is in ${aside}.`);
    return 1;
  }

  // the archive holds the secrets with the rest; here they have a place of their own, and the restored ones win
  if (apart) {
    for (const name of SECRET_NAMES) {
      if (name === "sessions.json" || name === "setup-token") continue;
      rmSync(join(SECRETS_DIR, name), { recursive: true, force: true });
      if (!existsSync(join(DATA_DIR, name))) continue;
      cpSync(join(DATA_DIR, name), join(SECRETS_DIR, name), { recursive: true, preserveTimestamps: true });
      rmSync(join(DATA_DIR, name), { recursive: true, force: true });
    }
  }

  // the backups may lie elsewhere on this machine than on the one they were made on
  const settingsFile = join(DATA_DIR, "settings.json");
  const saved = JSON.parse(readFileSync(settingsFile, "utf8")) as { dataRoot?: string; backup?: { dir?: string } };
  const expected = saved.backup?.dir || join(saved.dataRoot ?? "/DATA", "Backups");
  if (expected !== from) writeJsonAtomic(settingsFile, { ...saved, backup: { ...saved.backup, dir: from } });
  writeJsonAtomic(join(DATA_DIR, RESTORE_MARK), { at: Date.now(), snapshot: snapshot.id });

  console.log("Hata's state is restored.");
  if (service) {
    systemctl("start", "hata.service");
    console.log("Hata is starting and restores the apps now; their progress is on the Backups page.");
  } else console.log("Start Hata (`hata install` makes it a service): it restores the apps when it starts.");
  return 0;
}
