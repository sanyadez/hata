/**
 * Arrays and pools the system already has: Linux software RAID (md), ZFS pools, btrfs over several
 * disks. Hata makes none of them — it reads how they are, says when one has lost a disk or found
 * damage, and can start or stop their own check (md's `check`, ZFS's and btrfs's scrub).
 *
 * md is read from /proc/mdstat and /sys, so nothing needs installing; ZFS from `zpool`, btrfs from
 * `btrfs` — both are there wherever such a pool is in use. Reading their output is pure and tested;
 * the rest looks every minute and remembers when an md check ended (md keeps no such record).
 */
import { existsSync, readdirSync, readFileSync, readlinkSync, statfsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { record } from "./activity";
import type { AttentionItem } from "./attention";
import { bus } from "./bus";
import { DATA_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { installCommand, PATH, run } from "./packages";

export type PoolKind = "md" | "zfs" | "btrfs";
/** ok; degraded — a disk is missing or failed, the data is still whole; failed — the data cannot be reached; inactive — md assembled nothing */
export type PoolState = "ok" | "degraded" | "failed" | "inactive";
export type MemberState = "ok" | "faulty" | "missing" | "spare" | "rebuilding" | "offline";

export interface Member {
  /** The device as the system names it (sdb1, /dev/sdb1); "" for one that is gone */
  path: string;
  state: MemberState;
  /** Read, write and checksum errors it counted (ZFS, btrfs) */
  errors: number;
}

export interface Work {
  /** check — md reads every copy and counts differences; repair — md makes them agree; rebuild — a disk is filled from the others; resync — md makes copies agree after an unclean stop; reshape — md changes its layout; scrub — ZFS or btrfs reads everything and mends what does not match its checksum */
  what: "check" | "repair" | "rebuild" | "resync" | "reshape" | "scrub";
  /** Percent done; null when it waits its turn */
  percent: number | null;
  /** Minutes still to go, as the system estimates it */
  left: number | null;
}

export interface LastCheck {
  at: number;
  /** Differences (md) or errors (ZFS, btrfs) it found */
  errors: number;
  /** ZFS and btrfs mend what they find when there is a good copy: how much was not mended */
  unmended?: number;
  /** ZFS: how much it mended, as it says it ("31.9M") */
  mended?: string;
}

export interface Pool {
  kind: PoolKind;
  /** `<kind>:<name>` for md and ZFS, `btrfs:<uuid>` */
  id: string;
  /** md0, the ZFS pool's name, the btrfs file system's label */
  name: string;
  /** raid1, raid5, mirror, raidz1, single… */
  level: string;
  state: PoolState;
  members: Member[];
  /** Bytes the pool holds, and bytes used when known */
  size: number;
  used: number | null;
  /** Where it is mounted ("" — not, or ZFS's own datasets) */
  mount: string;
  work: Work | null;
  lastCheck: LastCheck | null;
  /** Errors counted on its disks since they were last cleared (ZFS, btrfs), or md's differences after a check */
  errors: number;
  /** ZFS: files with damage it could not mend */
  dataErrors: number;
}

const int = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// ---- md (/proc/mdstat) ----

/** How many disks a level of md may lose and still hold the data */
const MD_SPARE_ROOM: Record<string, number> = { raid1: Infinity, raid4: 1, raid5: 1, raid6: 2, raid10: 1 };

/** md's arrays as /proc/mdstat tells them; `sizes` of md's own size are in 1 KiB blocks there */
export function parseMdstat(text: string): Pool[] {
  const pools: Pool[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = /^(md[\w]+) : (active|inactive)(?: \((?:auto-)?read-only\))?(.*)$/.exec(lines[i]!);
    if (!head) continue;
    const name = head[1]!;
    const words = head[3]!.trim().split(/\s+/).filter(Boolean);
    const level = words[0] && !/\[\d+\]/.test(words[0]) ? words.shift()! : "";
    const devices = words.map((w) => /^([^[]+)\[(\d+)\]((?:\([A-Z]\))*)$/.exec(w)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ path: m[1]!, role: int(m[2]), flags: m[3]! }));
    // the lines that follow, up to the next empty one, belong to this array
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1]!.trim()) body.push(lines[++i]!);
    const blocks = /^\s*(\d+) blocks/.exec(body[0] ?? "");
    const shape = /\[(\d+)\/(\d+)\] \[([U_]+)\]/.exec(body.join(" "));
    let work: Work | null = null;
    for (const line of body) {
      const going = /(recovery|resync|check|repair|reshape)\s*=\s*([\d.]+)%/.exec(line);
      const finish = /finish=([\d.]+)min/.exec(line);
      const waiting = /(recovery|resync|check|repair|reshape)\s*=\s*(DELAYED|PENDING)/.exec(line);
      const m = going ?? waiting;
      if (!m) continue;
      const what = m[1] === "recovery" ? "rebuild" : (m[1] as Work["what"]);
      work = { what, percent: going ? Number(m[2]) : null, left: finish ? Math.ceil(Number(finish[1])) : null };
    }
    const status = shape?.[3] ?? "";
    const wanted = shape ? int(shape[1]) : devices.length;
    // the number in brackets is the order a device joined in, not its slot: of the devices with no
    // flag, as many as the slots marked U are whole, and the ones that joined last are being rebuilt
    const lost = [...status].filter((c) => c === "_").length;
    const plain = devices.filter((d) => !/\((F|S)\)/.test(d.flags)).sort((a, b) => a.role - b.role);
    const whole = shape ? Math.max(0, wanted - lost) : plain.length;
    const filling = work?.what === "rebuild" || work?.what === "reshape";
    const members: Member[] = devices
      .sort((a, b) => a.role - b.role)
      .map((d) => {
        const state: MemberState = d.flags.includes("(F)") ? "faulty" : d.flags.includes("(S)") ? "spare" : d.flags.includes("(R)") || plain.indexOf(d) >= whole ? (filling ? "rebuilding" : "spare") : "ok";
        return { path: d.path, state, errors: 0 };
      });
    // a slot no device answers for: the disk is gone, not even listed as failed
    const holes = Math.max(0, lost - members.filter((m) => m.state === "rebuilding" || m.state === "faulty").length);
    for (let n = 0; n < holes; n++) members.push({ path: "", state: "missing", errors: 0 });
    let state: PoolState = "ok";
    if (head[2] === "inactive") state = "inactive";
    else if (lost > (MD_SPARE_ROOM[level] ?? 0) || (lost > 0 && wanted - lost < 1)) state = "failed";
    else if (lost > 0) state = "degraded";
    // raid0 and linear have no slots to count: a failed member is the end of them
    else if (!shape && devices.some((d) => d.flags.includes("(F)"))) state = "failed";
    pools.push({ kind: "md", id: `md:${name}`, name, level, state, members, size: blocks ? int(blocks[1]) * 1024 : 0, used: null, mount: "", work, lastCheck: null, errors: 0, dataErrors: 0 });
  }
  return pools;
}

/** A member's state from md's /sys: `state` (in_sync, faulty, spare, write_mostly…) and its `slot` ("none" for a spare) */
export function memberOf(state: string, slot: string, filling: boolean): MemberState {
  const flags = state.split(",");
  if (flags.includes("faulty")) return "faulty";
  if (flags.includes("in_sync")) return "ok";
  if (slot === "none" || !filling) return "spare";
  return "rebuilding";
}

// ---- ZFS (`zpool status -P -p`, `zpool list -H -p`) ----

const ZFS_FAILED = new Set(["FAULTED", "UNAVAIL", "SUSPENDED", "REMOVED"]);

function zfsMember(state: string, note: string): MemberState {
  if (/resilvering/.test(note)) return "rebuilding";
  if (state === "ONLINE" || state === "INUSE") return "ok";
  if (state === "AVAIL") return "spare";
  if (state === "OFFLINE") return "offline";
  if (state === "UNAVAIL" || state === "REMOVED") return "missing";
  return "faulty";
}

/** "00:01:23 to go", "1 days 02:03:04 to go" in minutes */
function minutesLeft(text: string): number | null {
  const m = /(?:(\d+) days? )?(\d+):(\d+):(\d+) to go/.exec(text);
  return m ? Math.ceil(int(m[1]) * 1440 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 60) : null;
}

/** Every pool of `zpool status -P -p`: its state, its disks with their error counters, the scrub running or the last one */
export function parseZpoolStatus(text: string): Pool[] {
  const pools: Pool[] = [];
  for (const chunk of text.split(/^(?=\s*pool: )/m)) {
    const name = /^\s*pool: (.+)$/m.exec(chunk)?.[1]?.trim();
    if (!name) continue;
    // a field runs on over the lines indented under it
    const field = (key: string): string => {
      const m = new RegExp(`^\\s*${key}: (.*(?:\\n\\t(?!\\t?NAME).*)*)`, "m").exec(chunk);
      return m ? m[1]!.replace(/\s+/g, " ").trim() : "";
    };
    const poolState = field("state");
    const scan = field("scan");
    const members: Member[] = [];
    const levels = new Set<string>();
    let section = "";
    let errors = 0;
    const config = chunk.split(/^config:\s*$/m)[1]?.split(/^errors:/m)[0] ?? "";
    for (const line of config.split("\n")) {
      const m = /^\t( *)(\S+)(?:\s+(\S+)(?:\s+(\d+)\s+(\d+)\s+(\d+))?)?\s*(.*)$/.exec(line);
      if (!m || m[2] === "NAME") continue;
      const depth = m[1]!.length / 2;
      const [, , what, state = "", read, write, cksum, note = ""] = m;
      if (depth === 0) {
        section = what === name ? "" : what!;
        if (what === name) errors += int(read) + int(write) + int(cksum);
        continue;
      }
      const group = /^(mirror|raidz\d?|draid\d?|replacing|spare)(?:[-:].*)?$/.exec(what!);
      if (group) {
        if (!section && depth === 1) levels.add(group[1] === "raidz" ? "raidz1" : group[1]!);
        continue;
      }
      // a disk right under the pool is striped: nothing else holds its data
      if (!section && depth === 1) levels.add("stripe");
      const counted = int(read) + int(write) + int(cksum);
      if (!section) errors += counted;
      members.push({ path: /^\d+$/.test(what!) ? (/was (\S+)/.exec(note)?.[1] ?? "") : what!, state: section === "spares" ? zfsMember(state, note) : zfsMember(state, note), errors: counted });
    }
    let work: Work | null = null;
    let lastCheck: LastCheck | null = null;
    if (/in progress/.test(scan)) {
      const done = /([\d.]+)% done/.exec(scan);
      work = { what: /^resilver/.test(scan) ? "rebuild" : "scrub", percent: done ? Number(done[1]) : null, left: minutesLeft(scan) };
    }
    const ended = /^scrub repaired (\S+) in .*? with (\d+) errors on (.+)$/.exec(scan);
    if (ended) {
      const at = Date.parse(ended[3]!);
      // ZFS counts only what it could not mend; what it did mend is an amount
      if (Number.isFinite(at)) lastCheck = { at, errors: int(ended[2]), unmended: int(ended[2]), ...(/^0B?$/.test(ended[1]!) ? {} : { mended: ended[1]! }) };
    }
    const data = /^(\d+) data errors/.exec(field("errors"));
    const failed = ZFS_FAILED.has(poolState);
    pools.push({
      kind: "zfs",
      id: `zfs:${name}`,
      name,
      level: [...levels].join(" + ") || "stripe",
      state: failed ? "failed" : poolState === "DEGRADED" ? "degraded" : "ok",
      members,
      size: 0,
      used: null,
      mount: "",
      work,
      lastCheck,
      errors,
      dataErrors: data ? int(data[1]) : 0,
    });
  }
  return pools;
}

/** `zpool list -H -p -o name,size,alloc`: sizes by pool name */
export function parseZpoolList(text: string): Record<string, { size: number; used: number }> {
  const out: Record<string, { size: number; used: number }> = {};
  for (const line of text.split("\n")) {
    const [name, size, used] = line.split("\t");
    if (name && size && /^\d+$/.test(size)) out[name] = { size: int(size), used: int(used) };
  }
  return out;
}

// ---- btrfs ----

export interface BtrfsFs {
  uuid: string;
  label: string;
  devices: { id: number; size: number; path: string; missing: boolean }[];
  /** Devices it should have */
  total: number;
  used: number;
}

/** `btrfs filesystem show --raw`: every btrfs file system, its devices and the ones it misses */
export function parseBtrfsShow(text: string): BtrfsFs[] {
  const out: BtrfsFs[] = [];
  for (const chunk of text.split(/^(?=Label: )/m)) {
    const head = /^Label: (?:'(.*)'|none)\s+uuid: ([0-9a-f-]+)/.exec(chunk);
    if (!head) continue;
    const totals = /Total devices (\d+) FS bytes used (\d+)/.exec(chunk);
    const devices = [...chunk.matchAll(/^\s*devid\s+(\d+) size (\d+) used \d+ path (.+?)\s*$/gm)].map((m) => {
      const missing = /\bMISSING$/.test(m[3]!) || /^<missing/.test(m[3]!);
      return { id: int(m[1]), size: int(m[2]), path: missing ? "" : m[3]!.replace(/\s+MISSING$/, ""), missing };
    });
    const total = totals ? int(totals[1]) : devices.length;
    // older programs say only that some are missing, without a line for them
    const said = devices.filter((d) => d.missing).length;
    if (/\*\*\* Some devices missing/.test(chunk)) for (let n = devices.length; n < total && said === 0; n++) devices.push({ id: 0, size: 0, path: "", missing: true });
    out.push({ uuid: head[2]!, label: head[1] ?? "", devices, total, used: totals ? int(totals[2]) : 0 });
  }
  return out;
}

/** The profile of the data from `btrfs filesystem df -b`: "raid1", "single"… */
export const parseBtrfsDf = (text: string): string => (/^Data, ([\w]+):/m.exec(text)?.[1] ?? "").toLowerCase();

/** `btrfs device stats`: the errors each device counted, by its path */
export function parseBtrfsStats(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/^\[(.+?)\]\.\w+_errs\s+(\d+)\s*$/gm)) out[m[1]!] = (out[m[1]!] ?? 0) + int(m[2]);
  return out;
}

/** `btrfs scrub status`: a scrub going on, or how the last one ended */
export function parseBtrfsScrub(text: string): { work: Work | null; last: LastCheck | null } {
  const status = /^Status:\s+(\w+)/m.exec(text)?.[1] ?? "";
  if (status === "running") {
    const share = /\(([\d.]+)%\)/.exec(text);
    const left = /^Time left:\s+(\d+):(\d+):(\d+)/m.exec(text);
    return { work: { what: "scrub", percent: share ? Number(share[1]) : null, left: left ? Math.ceil(int(left[1]) * 60 + int(left[2]) + int(left[3]) / 60) : null }, last: null };
  }
  const started = /^Scrub started:\s+(.+)$/m.exec(text)?.[1];
  if (status !== "finished" || !started) return { work: null, last: null };
  const duration = /^Duration:\s+(\d+):(\d+):(\d+)/m.exec(text);
  const at = Date.parse(started) + (duration ? (int(duration[1]) * 3600 + int(duration[2]) * 60 + int(duration[3])) * 1000 : 0);
  if (!Number.isFinite(at)) return { work: null, last: null };
  const summary = /^Error summary:\s+(.+)$/m.exec(text)?.[1] ?? "";
  const errors = /no errors found/.test(summary) ? 0 : [...summary.matchAll(/=(\d+)/g)].reduce((n, m) => n + int(m[1]), 0);
  const unmended = int(/^\s*Uncorrectable:\s+(\d+)/m.exec(text)?.[1]);
  return { work: null, last: { at, errors, unmended } };
}

/** What a btrfs file system over several disks looks like as a pool */
export function btrfsPool(fs: BtrfsFs, mount: string, profile: string, stats: Record<string, number>, scrub: { work: Work | null; last: LastCheck | null }): Pool {
  const members: Member[] = fs.devices.map((d) => ({ path: d.path, state: d.missing ? "missing" : "ok", errors: d.missing ? 0 : (stats[d.path] ?? 0) }));
  const lost = members.filter((m) => m.state === "missing").length;
  // single and raid0 keep one copy: a missing disk takes files with it
  const redundant = /^(raid1|raid1c3|raid1c4|raid10|raid5|raid6|dup)$/.test(profile);
  return {
    kind: "btrfs",
    id: `btrfs:${fs.uuid}`,
    name: fs.label || fs.uuid.slice(0, 8),
    level: profile || "",
    state: !lost ? "ok" : !mount || !redundant ? "failed" : "degraded",
    members,
    size: fs.devices.reduce((n, d) => n + d.size, 0),
    used: fs.used,
    mount,
    work: scrub.work,
    lastCheck: scrub.last,
    errors: members.reduce((n, m) => n + m.errors, 0),
    dataErrors: scrub.last?.unmended ?? 0,
  };
}

// ---- what needs a person ----

/** The items of "needs attention": a pool that lost a disk, cannot be reached, or found damage */
export function poolTrouble(pools: Pool[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const pool of pools) {
    const detail = { pool: pool.name, kind: pool.kind, id: pool.id };
    const lost = pool.members.filter((m) => m.state === "missing" || m.state === "faulty").length;
    if (pool.state === "failed" || pool.state === "inactive") out.push({ id: `raid:${pool.id}`, severity: "danger", code: "raid.failed", detail });
    else if (pool.state === "degraded" && pool.work?.what === "rebuild") out.push({ id: `raid:${pool.id}`, severity: "warn", code: "raid.rebuilding", detail: { ...detail, percent: Math.floor(pool.work.percent ?? 0) } });
    else if (pool.state === "degraded") out.push({ id: `raid:${pool.id}`, severity: "danger", code: "raid.degraded", detail: { ...detail, n: Math.max(1, lost) } });
    else if (pool.dataErrors > 0) out.push({ id: `raid:${pool.id}`, severity: "danger", code: "raid.damaged", detail: { ...detail, n: pool.dataErrors } });
    else if (pool.errors > 0) out.push({ id: `raid:${pool.id}`, severity: "warn", code: pool.kind === "md" ? "raid.mismatch" : "raid.errors", detail: { ...detail, n: pool.errors } });
  }
  return out;
}

// ---- the running part ----

const has = (program: string): string | null => Bun.which(program, { PATH });
const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/** What md was last seen doing, and when its checks ended — md itself forgets */
interface Remembered {
  checks: Record<string, LastCheck>;
}
const FILE = join(DATA_DIR, "raid.json");
const remembered = readJsonFile<Remembered>(FILE, { checks: {} }, (v) => isPlainObject(v) && isPlainObject((v as Remembered).checks));
const doing = new Map<string, Work["what"]>();

let pools: Pool[] = [];
/** btrfs or ZFS seen on a disk, without the program that reads them */
let lacking: { kind: "zfs" | "btrfs"; package: string; install: string }[] = [];

/** /dev/md/<name> → md0: the name an array was given when it was made */
function mdNames(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const entry of readdirSync("/dev/md")) out[basename(readlinkSync(join("/dev/md", entry)))] = entry;
  } catch {}
  return out;
}

const mounted = (): { device: string; path: string; fstype: string }[] =>
  read("/proc/mounts")
    .split("\n")
    .map((line) => line.split(" "))
    .filter((p) => p.length > 2)
    .map(([device, path, fstype]) => ({ device: device!, path: path!.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8))), fstype: fstype! }));

function room(path: string): { size: number; used: number } | null {
  try {
    const s = statfsSync(path);
    return { size: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize };
  } catch {
    return null;
  }
}

async function readMd(mounts: ReturnType<typeof mounted>): Promise<Pool[]> {
  const names = mdNames();
  return parseMdstat(read("/proc/mdstat")).map((pool) => {
    const sys = `/sys/block/${pool.name}/md`;
    const action = read(`${sys}/sync_action`).trim();
    // mdstat says "resync" for a repair; /sys knows which
    if (pool.work && action === "repair") pool.work.what = "repair";
    const mismatches = int(read(`${sys}/mismatch_cnt`).trim());
    const before = doing.get(pool.id);
    if ((before === "check" || before === "repair") && !pool.work) {
      remembered.checks[pool.id] = { at: Date.now(), errors: mismatches };
      writeJsonAtomic(FILE, remembered);
    }
    if (pool.work) doing.set(pool.id, pool.work.what);
    else doing.delete(pool.id);
    pool.lastCheck = remembered.checks[pool.id] ?? null;
    // differences count only after a check of the whole array; a repair leaves the number it mended
    pool.errors = pool.lastCheck && !pool.work && before !== "repair" && doing.get(pool.id) !== "repair" ? pool.lastCheck.errors : 0;
    if (names[pool.name]) pool.name = names[pool.name]!.replace(/^.*:/, "") || pool.name;
    const where = mounts.find((m) => m.device === `/dev/${basename(pool.id.slice(3))}` || m.device === `/dev/md/${names[pool.id.slice(3)] ?? ""}`);
    if (where) {
      pool.mount = where.path;
      const r = room(where.path);
      if (r) pool.used = r.used;
    }
    // /sys knows each device's own state better than the order in mdstat
    pool.members = pool.members.map((m) => {
      const own = m.path && read(`${sys}/dev-${m.path}/state`).trim();
      const state = own ? memberOf(own, read(`${sys}/dev-${m.path}/slot`).trim(), !!pool.work && pool.work.what !== "check") : m.state;
      return { ...m, state, path: m.path && !m.path.startsWith("/") ? `/dev/${m.path}` : m.path };
    });
    return pool;
  });
}

async function readZfs(): Promise<Pool[]> {
  if (!has("zpool")) return [];
  const [status, list] = await Promise.all([run(["zpool", "status", "-P", "-p"], 20_000), run(["zpool", "list", "-H", "-p", "-o", "name,size,alloc"], 20_000)]);
  if (status.code !== 0) return [];
  const sizes = parseZpoolList(list.out);
  // where the pool's own dataset is mounted, for a link to its files
  const places = has("zfs") ? (await run(["zfs", "list", "-H", "-d", "0", "-o", "name,mounted,mountpoint"], 20_000)).out : "";
  const mountOf = (name: string): string => {
    const [, mounted, at] = places.split("\n").map((line) => line.split("\t")).find((f) => f[0] === name) ?? [];
    return mounted === "yes" && at?.startsWith("/") ? at : "";
  };
  return parseZpoolStatus(status.out).map((pool) => ({ ...pool, mount: mountOf(pool.name), ...(sizes[pool.name] ? { size: sizes[pool.name]!.size, used: sizes[pool.name]!.used } : {}) }));
}

async function readBtrfs(mounts: ReturnType<typeof mounted>): Promise<Pool[]> {
  if (!has("btrfs")) return [];
  const shown = await run(["btrfs", "filesystem", "show", "--raw"], 20_000);
  if (shown.code !== 0 && !shown.out) return [];
  const out: Pool[] = [];
  for (const fs of parseBtrfsShow(shown.out)) {
    // one disk is a plain file system, not a pool
    if (fs.total < 2) continue;
    const where = mounts.find((m) => m.fstype === "btrfs" && fs.devices.some((d) => d.path && d.path === m.device));
    const mount = where?.path ?? "";
    if (!mount) {
      out.push(btrfsPool(fs, "", "", {}, { work: null, last: null }));
      continue;
    }
    const [df, stats, scrub] = await Promise.all([run(["btrfs", "filesystem", "df", "-b", mount], 20_000), run(["btrfs", "device", "stats", mount], 20_000), run(["btrfs", "scrub", "status", mount], 20_000)]);
    const pool = btrfsPool(fs, mount, parseBtrfsDf(df.out), parseBtrfsStats(stats.out), parseBtrfsScrub(scrub.out));
    // the room files have: two copies of everything take the disks twice
    const r = room(mount);
    out.push(r ? { ...pool, size: r.size, used: r.used } : pool);
  }
  return out;
}

/** File systems lsblk names on a disk, to tell that a pool is there though its program is not */
let seenTypes: string[] = [];
export const noteTypes = (types: string[]): void => void (seenTypes = types);

let looking: Promise<void> | null = null;
let lastWords = "";

/** Reads every array and pool now; the storage page and the attention list take the last reading */
export function lookAtPools(): Promise<void> {
  looking ??= (async () => {
    try {
      const mounts = mounted();
      const [md, zfs, btrfs] = await Promise.all([readMd(mounts), readZfs(), readBtrfs(mounts)]);
      pools = [...md, ...zfs, ...btrfs];
      lacking = [];
      if (seenTypes.includes("zfs_member") && !has("zpool")) lacking.push({ kind: "zfs", package: "zfsutils-linux", install: installCommand("zfsutils-linux") });
      if (seenTypes.includes("btrfs") && !has("btrfs")) lacking.push({ kind: "btrfs", package: "btrfs-progs", install: installCommand("btrfs-progs") });
      // a page that shows them hears a change of state at once
      const words = JSON.stringify(pools.map((p) => [p.id, p.state, p.work?.what, p.members.map((m) => m.state)]));
      if (words !== lastWords) {
        if (lastWords) bus.publish("disks");
        lastWords = words;
      }
    } catch (e) {
      console.error("Could not read the arrays:", e instanceof Error ? e.message : e);
    } finally {
      looking = null;
    }
  })();
  return looking;
}

export interface PoolsReport {
  pools: Pool[];
  /** A pool's disks are here but the program that reads it is not */
  lacking: typeof lacking;
}

export const poolsReport = (): PoolsReport => ({ pools, lacking });
export const poolsTrouble = (): AttentionItem[] => poolTrouble(pools);

export class PoolError extends Error {
  constructor(readonly code: string, message = "") {
    super(message);
  }
}

/**
 * Starts or stops a pool's own check. md: `check` reads every copy and counts where they differ,
 * `repair` makes them agree (after differences were found). ZFS and btrfs: a scrub, which also mends
 * what it can.
 */
export async function poolCheck(id: unknown, action: unknown, user: string): Promise<void> {
  await lookAtPools();
  const pool = pools.find((p) => p.id === id);
  if (!pool) throw new PoolError("raid.unknown");
  if (action !== "check" && action !== "stop" && action !== "repair") throw new PoolError("raid.badAction");
  if (action === "repair" && pool.kind !== "md") throw new PoolError("raid.badAction");
  if (action !== "stop" && pool.work) throw new PoolError("raid.busy");
  if (action !== "stop" && pool.state !== "ok") throw new PoolError("raid.notWhole");
  if (action === "stop" && !pool.work) return;
  if (action === "stop" && pool.work && !["check", "repair", "scrub"].includes(pool.work.what)) throw new PoolError("raid.cannotStop");
  if (pool.kind === "md") {
    const file = `/sys/block/${pool.id.slice(3)}/md/sync_action`;
    if (!existsSync(file)) throw new PoolError("raid.failedToStart", "md does not offer its check here");
    try {
      writeFileSync(file, action === "stop" ? "idle" : action);
    } catch (e) {
      throw new PoolError("raid.failedToStart", e instanceof Error ? e.message : String(e));
    }
  } else {
    const cmd =
      pool.kind === "zfs"
        ? ["zpool", "scrub", ...(action === "stop" ? ["-s"] : []), pool.name]
        : ["btrfs", "scrub", action === "stop" ? "cancel" : "start", pool.mount];
    if (pool.kind === "btrfs" && !pool.mount) throw new PoolError("raid.notMounted");
    const ran = await run(cmd, 60_000);
    if (ran.code !== 0) throw new PoolError("raid.failedToStart", (ran.err || ran.out).trim());
  }
  record(action === "stop" ? "system.raid.stop" : action === "repair" ? "system.raid.repair" : "system.raid.check", { user, detail: pool.name });
  await Bun.sleep(500);
  await lookAtPools();
}

/**
 * Sets a pool's error counters back to zero once a person has seen them: ZFS's `zpool clear`,
 * btrfs's `device stats -z`; for md the remembered differences are forgotten.
 */
export async function poolClear(id: unknown, user: string): Promise<void> {
  await lookAtPools();
  const pool = pools.find((p) => p.id === id);
  if (!pool) throw new PoolError("raid.unknown");
  if (pool.kind === "md") {
    delete remembered.checks[pool.id];
    writeJsonAtomic(FILE, remembered);
  } else {
    if (pool.kind === "btrfs" && !pool.mount) throw new PoolError("raid.notMounted");
    const ran = await run(pool.kind === "zfs" ? ["zpool", "clear", pool.name] : ["btrfs", "device", "stats", "-z", pool.mount], 30_000);
    if (ran.code !== 0) throw new PoolError("raid.failedToStart", (ran.err || ran.out).trim());
  }
  record("system.raid.clear", { user, detail: pool.name });
  await lookAtPools();
}

export function startPools(): void {
  void lookAtPools();
  setInterval(() => void lookAtPools(), 60_000);
}
