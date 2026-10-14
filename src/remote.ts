/**
 * The second copy of the backups as it lies somewhere else — what sending it (`offsite.ts`) and fetching
 * it back for `hata restore` have in common, and the fetching itself. Nothing here reads Hata's state:
 * the restore runs before there is any.
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getFile, list, S3Error, type S3Place } from "./s3";
import { SEALED_EXT } from "./seal";

/** The name of a file in the bucket */
export const objectKey = (prefix: string, dir: string, name: string): string => [prefix, dir, name].filter(Boolean).join("/");

/** The keys listed under the prefix, as the names each folder holds; what lies deeper or beside is not Hata's */
export function groupKeys(prefix: string, keys: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const start = prefix ? prefix + "/" : "";
  for (const key of keys) {
    if (!key.startsWith(start)) continue;
    const parts = key.slice(start.length).split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    out.set(parts[0], [...(out.get(parts[0]) ?? []), parts[1]]);
  }
  return out;
}

/** A path as sftp's batch mode takes it; what quoting cannot carry is kept out before (`cleanTarget`, `parseSource`) */
export const quoted = (path: string): string => `"${path}"`;

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

/** Where a copy to restore from lies; null — the word is not an address, so it is a folder of this machine */
export type Source = { kind: "s3"; bucket: string; prefix: string } | { kind: "sftp"; user: string; host: string; port: number; path: string };

/**
 * `s3://<bucket>[/<folder>]` or `sftp://<user>@<host>[:<port>]/<folder>` — the folder from the root of the
 * other machine, `/~/<folder>` from the user's home. A string is what is wrong with an address.
 */
export function parseSource(word: string): Source | string | null {
  const s3 = /^s3:\/\/([^/]*)(?:\/(.*))?$/.exec(word);
  if (s3) {
    const prefix = (s3[2] ?? "").replace(/\/+$/, "");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s3[1]!)) return "The bucket's name is 3–63 small letters, digits, dots and dashes.";
    if (/[\x00-\x1f\\]/.test(prefix) || prefix.split("/").some((part) => part === ".." || part === "." || (part === "" && prefix !== ""))) return "The folder in the bucket must not hold \"..\" or empty parts.";
    return { kind: "s3", bucket: s3[1]!, prefix };
  }
  if (!word.startsWith("sftp://")) return null;
  const sftp = /^sftp:\/\/([A-Za-z0-9_][A-Za-z0-9._-]{0,63})@(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9._-]{0,252})(?::(\d{1,5}))?\/(.+)$/.exec(word);
  if (!sftp) return "An SFTP address looks like sftp://user@host/folder or sftp://user@host:2222/~/folder.";
  const path = (sftp[4]!.startsWith("~/") ? sftp[4]!.slice(2) : "/" + sftp[4]!).replace(/\/+$/, "");
  const port = Number(sftp[3] ?? 22);
  if (!path || path === "/" || path.startsWith("-") || /[\x00-\x1f"'\\*?[\]{}]/.test(path) || path.split("/").includes("..")) return "The folder must not hold quotes, backslashes, *, ?, brackets or \"..\".";
  if (port < 1 || port > 65535) return "The port must be a number from 1 to 65535.";
  return { kind: "sftp", user: sftp[1]!, host: sftp[2]!.replace(/^\[|\]$/g, ""), port, path };
}

/** A folder of the backup directory: the server's own, or an app's */
export const isCopyFolder = (name: string): boolean => name === "_server" || /^[a-z0-9][a-z0-9_-]{0,62}(@[a-f0-9]{8})?$/.test(name);

/** Of the files of one folder: the two of its latest whole snapshot, sealed or not — what a restore needs */
export function latestFiles(names: string[]): string[] {
  const ids = [...new Set(names.map((name) => /^(\d{8}-\d{6})\.(tar\.gz|json)(\.enc)?$/.exec(name)?.[1]).filter((id): id is string => !!id))].sort();
  const kinds = ["json", "tar.gz"];
  const latest = ids.findLast((id) => kinds.every((kind) => names.includes(`${id}.${kind}`) || names.includes(`${id}.${kind}${SEALED_EXT}`)));
  return latest ? kinds.map((kind) => (names.includes(`${latest}.${kind}`) ? `${latest}.${kind}` : `${latest}.${kind}${SEALED_EXT}`)) : [];
}

const size = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);

/** Brings the latest snapshot of every folder of a bucket into `to`; what is there already is not fetched again */
export async function fetchFromBucket(place: S3Place, prefix: string, to: string): Promise<boolean> {
  let folders: Map<string, string[]>;
  try {
    folders = groupKeys(prefix, await list(place, prefix ? prefix + "/" : ""));
  } catch (e) {
    console.error(`The storage did not show the bucket: ${e instanceof S3Error ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : e}`);
    return false;
  }
  const work = [...folders].filter(([dir]) => isCopyFolder(dir)).flatMap(([dir, names]) => latestFiles(names).map((name) => ({ dir, name })));
  if (!work.some(({ dir }) => dir === "_server")) {
    console.error(`No backup of the server was found in s3://${place.bucket}/${prefix}: there is no folder _server with a whole snapshot.`);
    return false;
  }
  for (const { dir, name } of work) {
    const local = join(to, dir, name);
    if (existsSync(local)) continue;
    mkdirSync(join(to, dir), { recursive: true });
    process.stdout.write(`Fetching ${dir}/${name} … `);
    try {
      await getFile(place, objectKey(prefix, dir, name), local);
    } catch (e) {
      console.error(`\n${e instanceof S3Error ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : e}`);
      return false;
    }
    console.log(size(statSync(local).size));
  }
  return true;
}

/**
 * The same over SFTP, with the system's `ssh`: the person signs in once, their own way (a key, an agent,
 * a password typed at the prompt), and the listing and the downloads go over that one connection.
 */
export async function fetchOverSftp(source: Extract<Source, { kind: "sftp" }>, to: string): Promise<boolean> {
  if (!Bun.which("ssh") || !Bun.which("sftp")) {
    console.error("This machine has no ssh and sftp: install the package openssh-client.");
    return false;
  }
  const socket = `/tmp/hata-restore-${process.pid}.sock`;
  const who = `${source.user}@${source.host}`;
  const shared = ["-o", `ControlPath=${socket}`, "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30"];
  const opened = Bun.spawnSync({ cmd: ["ssh", "-M", "-f", "-N", "-o", "ControlPersist=600", ...shared, "-p", String(source.port), who], stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (opened.exitCode !== 0) {
    console.error(`Could not sign in to ${who}.`);
    return false;
  }
  const batch = (commands: string[], show = false) => {
    const result = Bun.spawnSync({ cmd: ["sftp", "-b", "-", ...shared, "-P", String(source.port), who], stdin: Buffer.from(commands.join("\n") + "\n"), stdout: "pipe", stderr: show ? "inherit" : "pipe" });
    return { ok: result.exitCode === 0, output: result.stdout.toString() };
  };
  try {
    const top = batch([`ls -1 ${quoted(source.path)}`]);
    if (!top.ok) {
      console.error(`There is no folder ${source.path} on ${source.host}, or it cannot be read.`);
      return false;
    }
    const dirs = (parseListings(top.output).get(source.path) ?? []).filter(isCopyFolder);
    const listed = parseListings(batch(dirs.map((dir) => `-ls -1 ${quoted(`${source.path}/${dir}`)}`)).output);
    const work = dirs.flatMap((dir) => latestFiles(listed.get(`${source.path}/${dir}`) ?? []).map((name) => ({ dir, name })));
    if (!work.some(({ dir }) => dir === "_server")) {
      console.error(`No backup of the server was found in ${source.path} on ${source.host}: there is no folder _server with a whole snapshot.`);
      return false;
    }
    for (const { dir, name } of work) {
      const local = join(to, dir, name);
      if (existsSync(local)) continue;
      mkdirSync(join(to, dir), { recursive: true });
      process.stdout.write(`Fetching ${dir}/${name} … `);
      rmSync(local + ".partial", { force: true });
      if (!batch([`get ${quoted(`${source.path}/${dir}/${name}`)} ${quoted(local + ".partial")}`], true).ok) {
        console.error(`\nCould not fetch ${dir}/${name}.`);
        return false;
      }
      renameSync(local + ".partial", local);
      console.log(size(statSync(local).size));
    }
    return true;
  } finally {
    Bun.spawnSync({ cmd: ["ssh", ...shared, "-O", "exit", "-p", String(source.port), who], stdout: "ignore", stderr: "ignore" });
  }
}
