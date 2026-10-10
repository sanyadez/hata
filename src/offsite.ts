/**
 * Backups on another machine.
 *
 * The backup folder on this machine stays what it is — plain files, the place a restore reads from. What
 * is added here is a second copy of it somewhere else, reached over SFTP: a NAS, a rented storage box, a
 * friend's server. After every snapshot the remote folder is brought in step: what is missing there is
 * uploaded (so a day the other machine was off is caught up the next time), and a snapshot Hata deletes
 * here is deleted there. Only that: what is merely absent on this machine — a new backup disk, a server
 * restored from its latest snapshots — is left alone on the other.
 *
 * With a passphrase set, files are sealed (`seal.ts`) before they leave: the other machine holds
 * `<id>.tar.gz.enc` and never sees the content. Without one they travel as they are.
 *
 * The work is done by the system's `sftp`, with a key Hata makes for itself (the other machine is told
 * its public half) and the host's key remembered at the first connection. Building the commands and
 * deciding what to upload are pure and tested.
 */
import { chmodSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SECRETS_DIR } from "./config";
import { run } from "./docker";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { SEALED_EXT, sealFile } from "./seal";

export interface OffsiteTarget {
  host: string;
  port: number;
  user: string;
  /** Folder on the other machine; a relative one starts at the user's home */
  path: string;
}

interface Saved extends OffsiteTarget {
  enabled: boolean;
  /** "" — files are uploaded as they are */
  passphrase: string;
  /** Snapshots deleted here and not yet there, `<folder>/<id>` */
  removed: string[];
  last: OffsiteRun | null;
}

export interface OffsiteRun {
  at: number;
  uploaded: number;
  /** "" — the other machine holds everything this one does */
  error: string;
}

export interface OffsiteStatus extends OffsiteTarget {
  /** The system has `sftp` and `ssh-keygen` */
  available: boolean;
  enabled: boolean;
  sealed: boolean;
  /** What the other machine must have in its `authorized_keys` */
  publicKey: string;
  /** The remembered key of the other machine; "" — not connected yet */
  fingerprint: string;
  running: boolean;
  last: OffsiteRun | null;
}

/** The snapshots of one folder of the backup directory: an app's, or the server's own */
export interface LocalSet {
  dir: string;
  ids: string[];
}

const FILE = join(SECRETS_DIR, "backup-remote.json");
const KEY_FILE = join(SECRETS_DIR, "backup-key");
const HOSTS_FILE = join(SECRETS_DIR, "backup-known-hosts");
const EMPTY: Saved = { enabled: false, host: "", port: 22, user: "", path: "hata-backups", passphrase: "", removed: [], last: null };

const saved: Saved = { ...EMPTY, ...readJsonFile<Partial<Saved>>(FILE, {}, isPlainObject) };
if (!Array.isArray(saved.removed)) saved.removed = [];
let running = false;
let again: (() => { root: string; sets: LocalSet[] }) | null = null;

const persist = () => writeJsonAtomic(FILE, saved);

// --- Pure: the target, the commands, the plan -------------------------------------------------------

/** Checks what was typed in; a string is the error's code. Nothing here may be read by ssh as an option or by sftp as a pattern */
export function cleanTarget(input: Record<string, unknown>, current: OffsiteTarget): OffsiteTarget | string {
  const next: OffsiteTarget = { host: current.host, port: current.port, user: current.user, path: current.path };
  if ("host" in input) {
    if (typeof input.host !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$/.test(input.host.trim())) return "offsite.badHost";
    next.host = input.host.trim();
  }
  if ("port" in input) {
    if (typeof input.port !== "number" || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) return "offsite.badPort";
    next.port = input.port;
  }
  if ("user" in input) {
    if (typeof input.user !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(input.user.trim())) return "offsite.badUser";
    next.user = input.user.trim();
  }
  if ("path" in input) {
    const path = typeof input.path === "string" ? input.path.trim().replace(/\/+$/, "") : "";
    if (!path || path.length > 1024 || path.startsWith("-") || /[\x00-\x1f"'\\*?[\]{}]/.test(path) || path.split("/").includes("..")) return "offsite.badPath";
    next.path = path;
  }
  return next;
}

/** A path as sftp's batch mode takes it; `cleanTarget` has kept out what quoting cannot carry */
export const quoted = (path: string): string => `"${path}"`;

/** `mkdir` for every step of the way to `path`: sftp has no `mkdir -p`, and "it exists" is not an error here */
export function mkdirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const start = path.startsWith("/") ? "/" : "";
  return parts.map((_, i) => `-mkdir ${quoted(start + parts.slice(0, i + 1).join("/"))}`);
}

/**
 * What `ls -1 <dir>` printed for each folder asked. Batch mode repeats every command after `sftp> `,
 * which is what tells the answers apart; a folder that is not there has no names.
 */
export function parseListings(output: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let names: string[] | null = null;
  for (const line of output.split("\n")) {
    const command = /^sftp> -?ls -1 "(.*)"$/.exec(line);
    if (command) {
      names = [];
      out.set(command[1]!, names);
    } else if (line.startsWith("sftp> ")) names = null;
    else if (names && line && !line.startsWith("Can't ls:")) names.push(line.slice(line.lastIndexOf("/") + 1).trim());
  }
  return out;
}

const SNAPSHOT_FILE_RE = /^(\d{8}-\d{6})\.(tar\.gz|json)(\.enc)?(\.partial)?$/;

/**
 * What to send and what to take away in one folder: `local` are the snapshots here, `remote` the files
 * there, `removed` the snapshots deleted here. A snapshot is there when both its files are, sealed or
 * not; the description goes last, so that a snapshot half-way up is not taken for a whole one.
 */
export function plan(local: string[], remote: string[], removed: string[] = []): { upload: string[]; remove: string[] } {
  const has = (id: string, kind: string) => remote.includes(`${id}.${kind}`) || remote.includes(`${id}.${kind}${SEALED_EXT}`);
  const upload: string[] = [];
  for (const id of [...local].sort()) {
    if (has(id, "tar.gz") && has(id, "json")) continue;
    upload.push(`${id}.tar.gz`, `${id}.json`);
  }
  // being absent here is no reason to go: only what was deleted here is deleted there
  const remove = remote.filter((name) => {
    const id = SNAPSHOT_FILE_RE.exec(name)?.[1];
    return id !== undefined && removed.includes(id) && !local.includes(id);
  });
  return { upload, remove };
}

/** The fingerprint of a `known_hosts` line, as `ssh-keygen -l` and the other machine's console show it */
export async function fingerprint(line: string): Promise<string> {
  const blob = line.trim().split(/\s+/)[2];
  if (!blob) return "";
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(blob, "base64"));
  return "SHA256:" + Buffer.from(digest).toString("base64").replace(/=+$/, "");
}

/** The line to show of several: the strongest kind of key the host has */
export function preferredKey(lines: string[]): string {
  const order = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "rsa-sha2-512", "ssh-rsa"];
  const rank = (line: string) => {
    const at = order.indexOf(line.trim().split(/\s+/)[1] ?? "");
    return at < 0 ? order.length : at;
  };
  return [...lines].sort((a, b) => rank(a) - rank(b))[0] ?? "";
}

/** The reason out of what ssh printed: its last line that is not sftp's own farewell */
export function reason(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("sftp> ") && l !== "Connection closed" && !/^Connected to /.test(l));
  return lines[lines.length - 1] ?? "sftp failed";
}

// --- The system's ssh -------------------------------------------------------------------------------

const available = () => Bun.which("sftp") !== null && Bun.which("ssh-keygen") !== null && Bun.which("ssh-keyscan") !== null;

async function publicKey(): Promise<string> {
  if (!existsSync(KEY_FILE) || !existsSync(KEY_FILE + ".pub")) {
    if (!available()) return "";
    rmSync(KEY_FILE, { force: true });
    rmSync(KEY_FILE + ".pub", { force: true });
    const made = await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "hata-backup", "-f", KEY_FILE]);
    if (made.code !== 0) return "";
    chmodSync(KEY_FILE, 0o600);
  }
  return readFileSync(KEY_FILE + ".pub", "utf8").trim();
}

const knownHosts = (): string[] => {
  try {
    return readFileSync(HOSTS_FILE, "utf8").split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  } catch {
    return [];
  }
};

async function sftp(commands: string[]): Promise<{ ok: boolean; output: string }> {
  const address = saved.host.includes(":") ? `[${saved.host}]` : saved.host;
  const result = await run(
    [
      "sftp", "-b", "-", "-P", String(saved.port), "-i", KEY_FILE,
      "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${HOSTS_FILE}`,
      "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4",
      `${saved.user}@${address}`,
    ],
    { stdin: commands.join("\n") + "\n" },
  );
  return { ok: result.code === 0, output: result.output };
}

// --- Settings and the check -------------------------------------------------------------------------

export async function offsiteStatus(): Promise<OffsiteStatus> {
  const { host, port, user, path, enabled, last } = saved;
  return { available: available(), host, port, user, path, enabled, sealed: saved.passphrase !== "", publicKey: await publicKey(), fingerprint: await fingerprint(preferredKey(knownHosts())), running, last };
}

/** Saves what was typed in; returns the error's code, or null. `passphrase` is only ever written: "" takes it away */
export function saveOffsite(input: Record<string, unknown>): string | null {
  const target = cleanTarget(input, saved);
  if (typeof target === "string") return target;
  if ("passphrase" in input) {
    if (typeof input.passphrase !== "string" || input.passphrase.length > 1024 || (input.passphrase !== "" && input.passphrase.length < 8)) return "offsite.badPassphrase";
    saved.passphrase = input.passphrase;
  }
  // another machine has another key: the remembered one must not vouch for it
  if (target.host !== saved.host || target.port !== saved.port) rmSync(HOSTS_FILE, { force: true });
  Object.assign(saved, target);
  if ("enabled" in input) saved.enabled = input.enabled === true;
  if (!saved.host || !saved.user) saved.enabled = false;
  persist();
  return null;
}

export type OffsiteCheck =
  | { status: "ok" }
  /** The other machine is seen for the first time: its key is shown, and remembered once confirmed */
  | { status: "unknownHost"; fingerprint: string; keyType: string }
  /** It does not let Hata's key in */
  | { status: "denied" }
  | { status: "failed"; message: string };

/** Connects, makes the folder and looks into it. `trust` is the fingerprint the user has confirmed */
export async function checkOffsite(trust?: string): Promise<OffsiteCheck> {
  if (!available()) return { status: "failed", message: "sftp is not installed on this machine (the package is openssh-client)." };
  if (!saved.host || !saved.user) return { status: "failed", message: "No address is set." };
  await publicKey();
  if (!knownHosts().length) {
    const scan = await run(["ssh-keyscan", "-T", "10", "-t", "ed25519,ecdsa,rsa", "-p", String(saved.port), saved.host]);
    const lines = scan.output.split("\n").filter((line) => line.trim() && !line.startsWith("#") && line.trim().split(/\s+/).length === 3);
    if (!lines.length) return { status: "failed", message: `No SSH server answers at ${saved.host}, port ${saved.port}.` };
    const prints = await Promise.all(lines.map(fingerprint));
    if (!trust || !prints.includes(trust)) {
      const shown = preferredKey(lines);
      return { status: "unknownHost", fingerprint: await fingerprint(shown), keyType: shown.trim().split(/\s+/)[1] ?? "" };
    }
    writeTextAtomic(HOSTS_FILE, lines.join("\n") + "\n", 0o600);
  }
  const result = await sftp([...mkdirs(saved.path), `ls -1 ${quoted(saved.path)}`]);
  if (result.ok) return { status: "ok" };
  if (/Permission denied \(/.test(result.output)) return { status: "denied" };
  return { status: "failed", message: reason(result.output) };
}

/** Forgets the other machine's key: the next check shows the one it has now */
export function forgetHost(): void {
  rmSync(HOSTS_FILE, { force: true });
}

// --- Bringing the other machine in step -------------------------------------------------------------

const UPLOAD_EXT = ".upload";

async function sendFile(root: string, dir: string, file: string): Promise<void> {
  const local = join(root, dir, file);
  const name = saved.passphrase ? file + SEALED_EXT : file;
  const sealed = local + SEALED_EXT + UPLOAD_EXT;
  try {
    if (saved.passphrase) await sealFile(local, sealed, saved.passphrase);
    const remote = `${saved.path}/${dir}/${name}`;
    // under another name until it is whole, as on this machine
    const result = await sftp([`put ${quoted(saved.passphrase ? sealed : local)} ${quoted(remote + ".partial")}`, `-rm ${quoted(remote)}`, `rename ${quoted(remote + ".partial")} ${quoted(remote)}`]);
    if (!result.ok) throw new Error(reason(result.output));
  } finally {
    rmSync(sealed, { force: true });
    rmSync(sealed + ".partial", { force: true });
  }
}

async function sync(root: string, sets: LocalSet[]): Promise<number> {
  // what an interrupted run left behind
  for (const { dir } of sets) {
    try {
      for (const name of readdirSync(join(root, dir))) if (name.includes(SEALED_EXT + UPLOAD_EXT)) rmSync(join(root, dir, name), { force: true });
    } catch {}
  }
  const folder = (dir: string) => `${saved.path}/${dir}`;
  const listed = await sftp([...mkdirs(saved.path), ...sets.flatMap(({ dir }) => [`-mkdir ${quoted(folder(dir))}`, `-ls -1 ${quoted(folder(dir))}`])]);
  if (!listed.ok) throw new Error(reason(listed.output));
  const remote = parseListings(listed.output);
  let uploaded = 0;
  const gone: string[] = [];
  const asked = [...saved.removed];
  for (const { dir, ids } of sets) {
    const deleted = asked.filter((entry) => entry.startsWith(dir + "/")).map((entry) => entry.slice(dir.length + 1));
    const { upload, remove } = plan(ids, remote.get(folder(dir)) ?? [], deleted);
    for (const file of upload) {
      await sendFile(root, dir, file);
      uploaded++;
    }
    gone.push(...remove.map((name) => `-rm ${quoted(`${folder(dir)}/${name}`)}`));
  }
  if (gone.length) {
    const removed = await sftp(gone);
    if (!removed.ok) throw new Error(reason(removed.output));
  }
  saved.removed = saved.removed.filter((entry) => !asked.includes(entry));
  return uploaded;
}

/**
 * Brings the other machine in step with the backup folder, in the background. One run at a time: asked
 * again while one is going, it goes once more when that one ends, with what there is by then.
 * `onDone` hears how each run ended.
 */
export function syncOffsite(local: () => { root: string; sets: LocalSet[] }, onDone?: (run: OffsiteRun) => void): void {
  if (!saved.enabled || !saved.host) return;
  if (running) {
    again = local;
    return;
  }
  running = true;
  void (async () => {
    let next: typeof again = local;
    while (next) {
      const current = next;
      again = null;
      const result: OffsiteRun = { at: Date.now(), uploaded: 0, error: "" };
      try {
        const { root, sets } = current();
        result.uploaded = await sync(root, sets);
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
      result.at = Date.now();
      saved.last = result;
      persist();
      onDone?.(result);
      next = again;
    }
    running = false;
  })();
}

/** A snapshot was deleted here: the next run deletes it there */
export function forgetSnapshot(dir: string, id: string): void {
  if (!saved.host) return;
  saved.removed = [...saved.removed.filter((entry) => entry !== `${dir}/${id}`), `${dir}/${id}`].slice(-5000);
  persist();
}

/** The last run, if it failed: one of the things that need attention */
export const offsiteFailure = (): OffsiteRun | null => (saved.enabled && saved.last?.error ? saved.last : null);
