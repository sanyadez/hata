/**
 * Room on a network file system, asked without blocking: the file system call waits while a server does
 * not answer, and in this process that would stop everything — so `df` runs in a process of its own with
 * a time limit, and what it last said is kept. No imports with side effects: the file manager and the
 * disks' page use it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./packages";

const rooms = new Map<string, { total: number; free: number; at: number }>();

/** Room as last measured; measured again in the background when older than a minute. null — not known yet */
export function roomOf(path: string): { total: number; free: number } | null {
  const known = rooms.get(path);
  if (!known || Date.now() - known.at > 60_000) {
    rooms.set(path, { total: known?.total ?? 0, free: known?.free ?? 0, at: Date.now() });
    void run(["timeout", "8", "df", "-B1", "--output=size,avail", path], 10_000).then((r) => {
      const nums = r.out.trim().split("\n")[1]?.trim().split(/\s+/).map(Number) ?? [];
      // a server that does not tell its size is answered with a made-up petabyte or more: not known
      if (r.code === 0 && nums.length === 2 && nums.every(Number.isFinite) && nums[0]! < 2 ** 50) rooms.set(path, { total: nums[0]!, free: nums[1]!, at: Date.now() });
    });
  }
  return known && known.total ? { total: known.total, free: known.free } : null;
}

// --- Whether a network folder answers ------------------------------------------------------------------

/** File systems that live on another machine: a call into one waits as long as its server does not answer */
export const NETWORK_FS = /^(nfs\d?|cifs|smb3|smbfs|9p|ceph|glusterfs|fuse\.(sshfs|rclone|glusterfs|s3fs))$/;

const unescapeMount = (s: string) => s.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

let table = { at: 0, mounts: [] as string[] };

/** The network mount points as /proc/mounts lists them — it answers at once whatever the servers do */
export function networkMounts(): string[] {
  if (Date.now() - table.at > 2_000) {
    let text = "";
    try {
      text = readFileSync("/proc/mounts", "utf8");
    } catch {}
    const mounts = text.split("\n").map((line) => line.split(" ")).filter((f) => f[2] && NETWORK_FS.test(f[2])).map((f) => unescapeMount(f[1]!));
    table = { at: Date.now(), mounts };
  }
  return table.mounts;
}

const under = (path: string, dir: string): boolean => dir === "/" || path === dir || path.startsWith(dir + "/");

/** The network mount a path lies on (the innermost); "" — the path is this machine's own */
export function networkMountOf(path: string): string {
  const abs = resolve(path);
  return networkMounts().reduce((best, mount) => (under(abs, mount) && mount.length > best.length ? mount : best), "");
}

/** How long an answer of a folder is believed, and how long one is waited for */
const FRESH_MS = 20_000;
const ASK_MS = 8_000;

const heard = new Map<string, { ok: boolean; at: number }>();
const asking = new Map<string, Promise<boolean>>();

/** Asks a network folder whether it answers: read in a process of its own, never in this one */
function ask(mount: string): Promise<boolean> {
  const going = asking.get(mount);
  if (going) return going;
  // a reader stuck on a dead server may outlive its time limit: the answer is not waited for longer
  const ran = run(["timeout", "-k", "2", String(ASK_MS / 1000 - 2), "ls", "-A", mount], ASK_MS + 5_000).then((r) => r.code === 0);
  const done = Promise.race([ran, Bun.sleep(ASK_MS).then(() => false)]).then((ok) => {
    heard.set(mount, { ok, at: Date.now() });
    asking.delete(mount);
    return ok;
  });
  asking.set(mount, done);
  return done;
}

/**
 * Whether this process may touch a path now, as last heard — for what must answer at once (the home
 * page, attention): true for a path of this machine, false while its server was silent, null when not
 * known yet. A stale answer is asked again in the background.
 */
export function answered(path: string): boolean | null {
  const mount = networkMountOf(path);
  if (!mount) return true;
  const known = heard.get(mount);
  if (!known || Date.now() - known.at > FRESH_MS) void ask(mount);
  return known ? known.ok : null;
}

/** The same, waiting for a fresh answer (a few seconds at most) — for what is about to read or write there */
export async function answers(path: string): Promise<boolean> {
  const mount = networkMountOf(path);
  if (!mount) return true;
  const known = heard.get(mount);
  if (known && Date.now() - known.at <= FRESH_MS) return known.ok;
  return ask(mount);
}
