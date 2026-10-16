/**
 * Network places: folders of other machines mounted under `/mnt/net` — SMB and NFS by the kernel, SFTP,
 * WebDAV and FTP by `rclone mount`. `netplaces.json` (in the secrets folder: it holds passwords) is the
 * one source; the units, the SMB sign-in files and rclone's configuration are written from it on every
 * start, so a restored server gets its places back by itself.
 *
 * A place is tried before it is kept: written, started, and if it does not mount, everything written is
 * taken away again and the server's own words are shown. Once kept, a place that is not mounted is tried
 * again every minute (the server was off) and shows up under "needs attention" while it stays away.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, installedNames } from "./apps";
import { appFolders } from "./backup";
import { bus } from "./bus";
import { DATA_DIR, SECRETS_DIR, settings } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { openFolder, sealFolder } from "./mounting";
import { BINARY, browseQuery, byRclone, cleanPlace, credentials, foundServers, mountUnit, PACKAGES, parseAnswer, parseExports, parseSmbShares, rcloneSection, rcloneUnit, SERVICE_KINDS, shown, unitOf, where, type Found, type Input, type Kind, type Place } from "./netplace";
import { checkPlacesWith, fingerprint, knowPlaces, offsitePlace, preferredKey } from "./offsite";
import { roomOf } from "./netroom";
import { installCommand, installPackage, PATH, run } from "./packages";

const FILE = join(SECRETS_DIR, "netplaces.json");
const CREDS = join(SECRETS_DIR, "net");
const RCLONE_CONF = join(SECRETS_DIR, "rclone.conf");
const KNOWN_HOSTS = join(SECRETS_DIR, "net-known-hosts");
const UNITS = "/etc/systemd/system";
const CACHE = "/var/cache/hata-rclone";
const MAX = 30;

const saved = readJsonFile<{ places?: unknown }>(FILE, {}, isPlainObject);
let places: Place[] = Array.isArray(saved.places) ? (saved.places.filter((p) => isPlainObject(p) && typeof p.id === "string" && typeof p.slug === "string") as Place[]) : [];

const save = (): void => writeJsonAtomic(FILE, { places });
const has = (program: string): string | null => Bun.which(program, { PATH });
const owner = () => ({ uid: settings.puid, gid: settings.pgid });
const said = (r: { out: string; err: string }): string => (r.err.trim() || r.out.trim()).split("\n").filter(Boolean).slice(-3).join("\n");

/** The packages the places kept now are mounted with — not to be removed from under them */
export const packagesInUse = (): string[] => [...new Set(places.flatMap((p) => PACKAGES[p.kind]))];

/** The packages a kind still needs here; [] — it can be mounted */
export const missing = (kind: Kind): string[] => PACKAGES[kind].filter((pkg) => !has(BINARY[pkg]!));

const credentialsFile = (place: Place): string => join(CREDS, `${place.id}.cred`);

function mountedAt(): Map<string, string> {
  try {
    return new Map(
      readFileSync("/proc/mounts", "utf8")
        .split("\n")
        .map((line) => line.split(" "))
        .filter((f) => f.length > 2)
        .map((f) => [f[1]!.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8))), f[2]!]),
    );
  } catch {
    return new Map();
  }
}

/** Writes a file only when its text changed; true — it did */
function put(path: string, text: string, mode = 0o644): boolean {
  try {
    if (readFileSync(path, "utf8") === text) return false;
  } catch {}
  writeTextAtomic(path, text);
  chmodSync(path, mode);
  return true;
}

/** rclone's configuration, every place's section; the passwords in rclone's own obscured form */
async function writeRcloneConfig(): Promise<boolean> {
  const rclone = has("rclone");
  const sections: string[] = [];
  for (const place of places.filter((p) => byRclone(p.kind))) {
    let obscured = "";
    if (place.password && rclone) {
      const r = await run([rclone, "obscure", "-"], 10_000, {}, place.password);
      obscured = r.code === 0 ? r.out.trim() : "";
    }
    sections.push(rcloneSection(place, obscured, KNOWN_HOSTS));
  }
  return put(RCLONE_CONF, sections.join("\n"), 0o600);
}

/** The files of one place; true — something changed and systemd has to read them again */
async function writePlace(place: Place): Promise<boolean> {
  let changed = false;
  mkdirSync(where(place), { recursive: true });
  if (byRclone(place.kind)) {
    mkdirSync(join(CACHE, place.slug), { recursive: true });
    const unit = rcloneUnit(place, owner(), has("rclone") ?? "/usr/bin/rclone", RCLONE_CONF, join(CACHE, place.slug), has("fusermount3") ?? has("fusermount") ?? "/bin/fusermount3");
    changed = put(join(UNITS, unitOf(place)), unit) || changed;
  } else {
    if (place.kind === "smb") {
      mkdirSync(CREDS, { recursive: true, mode: 0o700 });
      put(credentialsFile(place), credentials(place), 0o600);
    }
    changed = put(join(UNITS, unitOf(place)), mountUnit(place, owner(), credentialsFile(place))) || changed;
  }
  return changed;
}

const systemctl = (...args: string[]) => run(["systemctl", ...args], 60_000);

/** Takes a place's files away (the folder and its closed mark stay to the caller) */
async function unwritePlace(place: Place): Promise<void> {
  const unit = unitOf(place);
  await systemctl("disable", "--now", unit);
  if (!byRclone(place.kind) && mountedAt().has(where(place))) await run(["umount", "-l", where(place)], 30_000);
  rmSync(join(UNITS, unit), { force: true });
  rmSync(credentialsFile(place), { force: true });
  rmSync(join(CACHE, place.slug), { recursive: true, force: true });
}

/** Waits for the folder to be mounted, up to `ms`; true — it is */
async function mounted(place: Place, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (mountedAt().has(where(place))) return true;
    if (Date.now() > until) return false;
    const state = (await systemctl("is-active", unitOf(place))).out.trim();
    if (state === "failed") return false;
    await Bun.sleep(700);
  }
}

/** The last words the unit's program said — why it did not mount */
async function whyNot(place: Place): Promise<string> {
  const log = await run(["journalctl", "-u", unitOf(place), "-n", "12", "-o", "cat", "--no-pager"], 10_000);
  const lines = log.out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(Mounting|Mounted|Unmounting|Unmounted|Starting|Started|Stopping|Stopped|Failed to (mount|start)|Refer to the mount|.*: Deactivated successfully|.*: Failed with result|.*Consumed .* CPU time)/.test(l) && !/^(mnt-net-.*\.mount|hata-net-.*\.service):/.test(l));
  return [...new Set(lines)].slice(-3).join("\n") || "it did not mount";
}

/** Brings the units in line with the places, and starts those that are not mounted */
async function sync(): Promise<void> {
  if (process.getuid?.() !== 0 || !has("systemctl")) return;
  let changed = await writeRcloneConfig();
  for (const place of places) changed = (await writePlace(place)) || changed;
  if (changed) await systemctl("daemon-reload");
  const now = mountedAt();
  for (const place of places) {
    if (now.has(where(place))) continue;
    await sealFolder(where(place));
    if (!missing(place.kind).length) await systemctl("enable", "--now", unitOf(place));
  }
}

// --- One at a time ---------------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
const turn = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
};

// --- What the page sees -----------------------------------------------------------------------------

export interface PlaceReport extends ReturnType<typeof shown> {
  /** Where it is mounted here; `path` is the folder on the server */
  folder: string;
  mounted: boolean;
  /** Mounted, or not, and its server has not answered for two looks */
  away: boolean;
  /** systemd's word for the unit: active, failed, activating, inactive */
  state: string;
  missing: string[];
  /** Bytes, as `df` last told; 0 — not known */
  total: number;
  free: number;
}

export async function listPlaces(): Promise<{ places: PlaceReport[]; packages: Record<Kind, { missing: string[]; install: string }>; smbclient: boolean }> {
  const now = mountedAt();
  const reports: PlaceReport[] = [];
  for (const place of places) {
    const state = has("systemctl") ? (await systemctl("is-active", unitOf(place))).out.trim() : "";
    const room = now.has(where(place)) ? roomOf(where(place)) : null;
    reports.push({ ...shown(place), folder: where(place), mounted: now.has(where(place)), away: away.has(place.id), state, missing: missing(place.kind), total: room?.total ?? 0, free: room?.free ?? 0 });
  }
  const packages = Object.fromEntries((["smb", "nfs", "sftp", "webdav", "ftp"] as Kind[]).map((kind) => [kind, { missing: missing(kind), install: missing(kind).length ? installCommand(missing(kind).join(" ")) : "" }])) as Record<Kind, { missing: string[]; install: string }>;
  return { places: reports, packages, smbclient: !!has("smbclient") };
}

// --- Changing them ----------------------------------------------------------------------------------

/** Asks an SFTP server for its key; the line when the person has to confirm it, null when it is known */
async function unknownKey(place: Place, trust: unknown): Promise<{ fingerprint: string } | null> {
  if (place.kind !== "sftp") return null;
  const port = place.port || 22;
  const known = existsSync(KNOWN_HOSTS) ? readFileSync(KNOWN_HOSTS, "utf8") : "";
  const tag = port === 22 ? place.host : `[${place.host}]:${port}`;
  if (known.split("\n").some((line) => line.split(" ")[0] === tag)) return null;
  if (!has("ssh-keyscan")) throw new AppError("netplace.needsSsh", 400);
  const scan = await run(["ssh-keyscan", "-T", "10", "-t", "ed25519,ecdsa,rsa", "-p", String(port), place.host], 20_000);
  const lines = scan.out.split("\n").filter((l) => l && !l.startsWith("#"));
  if (!lines.length) throw new AppError("netplace.failed", 400, { message: said(scan) || `${place.host} did not answer on port ${port}` });
  const print = await fingerprint(preferredKey(lines));
  if (trust !== print) return { fingerprint: print };
  writeTextAtomic(KNOWN_HOSTS, known + lines.join("\n") + "\n");
  chmodSync(KNOWN_HOSTS, 0o600);
  return null;
}

/** Why a place cannot go away now: what of Hata's or of an app lies there */
function holds(place: Place): { code: string; detail?: Record<string, string> } | null {
  const path = where(place);
  const inside = (p: string) => p === path || p.startsWith(path + "/");
  if ([DATA_DIR, SECRETS_DIR].some(inside)) return { code: "netplace.holds.state" };
  if (inside(settings.dataRoot)) return { code: "netplace.holds.data" };
  if (settings.backup.dir && inside(settings.backup.dir)) return { code: "netplace.holds.backups" };
  if (offsitePlace() === place.id) return { code: "netplace.holds.offsite" };
  const share = settings.shares.find((s) => inside(s.path));
  if (share) return { code: "netplace.holds.share", detail: { name: share.name } };
  for (const app of installedNames()) {
    const folders = appFolders(app);
    if ([...folders.included, ...folders.other].some(inside)) return { code: "netplace.holds.app", detail: { app } };
  }
  return null;
}

/**
 * rclone mounts without asking the server anything, and a wrong password shows only when a file is
 * read — so the folder is listed first, and what the server says is the answer.
 */
async function reachable(place: Place): Promise<string | null> {
  const rclone = has("rclone");
  if (!byRclone(place.kind) || !rclone) return null;
  const r = await run([rclone, "lsf", "--config", RCLONE_CONF, "--max-depth", "1", "--contimeout", "15s", "--timeout", "30s", "--low-level-retries", "1", "--retries", "1", `hata-${place.slug}:${place.path}`], 60_000);
  if (r.code === 0) return null;
  // rclone's levels, times and its summary of the same error said twice are not the server's words
  const lines = r.err
    .split("\n")
    .map((l) => l.replace(/^<\d>/, "").replace(/^(\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d )?(ERROR|NOTICE|CRITICAL)\s*:[^:]*:\s*/, "").replace(/^Failed to lsf with \d+ errors: last error was: /, "").replace(/^error in ListJSON: /, "").trim())
    .filter(Boolean);
  return [...new Set(lines)].slice(-1).join("\n") || "the server did not answer";
}

/** Writes a place, starts it and waits for it; on failure takes it back and throws with the server's words */
async function tryPlace(place: Place): Promise<void> {
  await writeRcloneConfig();
  const refused = await reachable(place);
  if (refused) throw new AppError("netplace.failed", 400, { message: refused });
  await writePlace(place);
  await systemctl("daemon-reload");
  await sealFolder(where(place));
  const started = await systemctl("enable", "--now", unitOf(place));
  if (started.code === 0 && (await mounted(place, 25_000))) return;
  const why = await whyNot(place);
  await unwritePlace(place);
  await openFolder(where(place));
  throw new AppError("netplace.failed", 400, { message: why });
}

/**
 * Connects a new place, or changes one (`id`). An SFTP server seen for the first time answers with its
 * key's fingerprint first (`unknownHost`); the person confirms it by sending it back as `trust`.
 */
export function savePlace(input: Input & { trust?: unknown }, id: string | null, user: string): Promise<{ unknownHost: string } | PlaceReport[]> {
  return turn(async () => {
    if (process.getuid?.() !== 0) throw new AppError("netplace.notRoot", 400);
    const before = id ? places.find((p) => p.id === id) : null;
    if (id && !before) throw new AppError("netplace.notFound", 404);
    if (!before && places.length >= MAX) throw new AppError("netplace.tooMany", 400);
    const next = cleanPlace(input, before ?? null, places.filter((p) => p.id !== id).map((p) => p.slug), crypto.randomUUID().slice(0, 12), Date.now());
    if (typeof next === "string") throw new AppError(next, 400);
    const need = missing(next.kind);
    if (need.length) throw new AppError("netplace.needsPackage", 400, { package: need.join(" "), install: installCommand(need.join(" ")) });
    const key = await unknownKey(next, input.trust);
    if (key) return { unknownHost: key.fingerprint };
    if (before) {
      await unwritePlace(before);
      places = places.filter((p) => p.id !== before.id);
    }
    places.push(next);
    try {
      await tryPlace(next);
    } catch (e) {
      places = places.filter((p) => p.id !== next.id);
      await writeRcloneConfig();
      // a change that does not work leaves the place as it was
      if (before) {
        places.push(before);
        await tryPlace(before).catch(() => {});
      }
      throw e;
    }
    save();
    record(before ? "system.netplace.changed" : "system.netplace.connected", { user, detail: `${next.name} → ${where(next)}` });
    bus.publish("disks");
    return (await listPlaces()).places;
  });
}

/** Unmounts a place and forgets it — refused while something lies there */
export function removePlace(id: string, user: string): Promise<PlaceReport[]> {
  return turn(async () => {
    const place = places.find((p) => p.id === id);
    if (!place) throw new AppError("netplace.notFound", 404);
    const why = holds(place);
    if (why) throw new AppError(why.code, 409, why.detail);
    await unwritePlace(place);
    places = places.filter((p) => p !== place);
    save();
    await writeRcloneConfig();
    await systemctl("daemon-reload");
    await openFolder(where(place));
    record("system.netplace.removed", { user, detail: place.name });
    bus.publish("disks");
    return (await listPlaces()).places;
  });
}

/** Tries a place that is not mounted again now */
export function retryPlace(id: string): Promise<PlaceReport[]> {
  return turn(async () => {
    const place = places.find((p) => p.id === id);
    if (!place) throw new AppError("netplace.notFound", 404);
    if (!mountedAt().has(where(place)) || !(await answers(place))) {
      // a mount whose server went away is let go first: unmounting it the usual way would wait for the server
      if (!byRclone(place.kind) && mountedAt().has(where(place))) await run(["umount", "-l", where(place)], 30_000);
      await systemctl("reset-failed", unitOf(place));
      await systemctl("restart", unitOf(place));
      if (!(await mounted(place, 25_000)) || !(await answers(place))) throw new AppError("netplace.failed", 400, { message: await whyNot(place) });
    }
    missed.delete(place.id);
    away.delete(place.id);
    bus.publish("disks");
    return (await listPlaces()).places;
  });
}

/** The packages of a kind, by the person's button */
export async function installFor(kind: unknown): Promise<string | null> {
  const k = (["smb", "nfs", "sftp", "webdav", "ftp", "smbclient"] as const).find((x) => x === kind);
  if (!k) return "not a kind Hata mounts";
  for (const pkg of k === "smbclient" ? ["smbclient"] : missing(k)) {
    const failed = await installPackage(pkg);
    if (failed) return failed;
  }
  return null;
}

// --- Looking around ---------------------------------------------------------------------------------

/** Servers on the home network that announce a file service, asked over multicast DNS for 2 s */
export function discover(): Promise<Found[]> {
  return new Promise((resolve) => {
    const records: ReturnType<typeof parseAnswer> = [];
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    const done = () => {
      try {
        socket.close();
      } catch {}
      // this server announces itself too
      const own = new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((a) => a.address)));
      resolve(foundServers(records).filter((f) => !own.has(f.address)));
    };
    socket.on("message", (packet) => records.push(...parseAnswer(new Uint8Array(packet))));
    socket.on("error", done);
    socket.bind(0, () => {
      const query = browseQuery(Object.keys(SERVICE_KINDS));
      socket.send(query, 5353, "224.0.0.251");
      setTimeout(() => socket.send(query, 5353, "224.0.0.251"), 600);
      setTimeout(done, 2000);
    });
  });
}

/** The shares an SMB server or the exports an NFS server offers; the sign-in is passed in the environment */
export async function shares(input: { kind?: unknown; host?: unknown; user?: unknown; password?: unknown }): Promise<string[]> {
  const host = typeof input.host === "string" ? input.host.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(host)) throw new AppError("netplace.badHost", 400);
  if (input.kind === "nfs") {
    if (!has("showmount")) throw new AppError("netplace.needsPackage", 400, { package: "nfs-common", install: installCommand("nfs-common") });
    const r = await run(["showmount", "-e", "--no-headers", host], 15_000);
    if (r.code !== 0) throw new AppError("netplace.failed", 400, { message: said(r) });
    return parseExports("\n" + r.out);
  }
  if (!has("smbclient")) throw new AppError("netplace.needsPackage", 400, { package: "smbclient", install: installCommand("smbclient") });
  const user = typeof input.user === "string" && input.user.trim() ? input.user.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const r = await run(["smbclient", "-L", `//${host}`, "-g", ...(user ? ["-U", user] : ["-N"])], 15_000, user ? { PASSWD: password } : {});
  const list = parseSmbShares(r.out);
  if (!list.length && r.code !== 0) throw new AppError("netplace.failed", 400, { message: said(r) });
  return list;
}

// --- Watching ---------------------------------------------------------------------------------------

/** Places that should be mounted and have not been for two looks in a row */
let away = new Set<string>();
const missed = new Map<string, number>();

export const placesDown = (): { id: string; name: string; path: string }[] => places.filter((p) => away.has(p.id)).map((p) => ({ id: p.id, name: p.name, path: where(p) }));

/**
 * Whether the folder answers: a mount stays in place while its server is off, so the folder is read —
 * in a process of its own with a time limit, because the read waits as long as the server does not answer.
 */
const answers = async (place: Place): Promise<boolean> => (await run(["timeout", "15", "ls", "-A", where(place)], 20_000)).code === 0;

async function look(): Promise<void> {
  const now = mountedAt();
  const next = new Set<string>();
  const alive = new Map(await Promise.all(places.filter((p) => now.has(where(p))).map(async (p) => [p.id, await answers(p)] as const)));
  for (const place of places) {
    if (alive.get(place.id)) {
      missed.delete(place.id);
      continue;
    }
    if (now.has(where(place))) {
      // mounted but silent: the server is away; the mount comes back by itself when it answers again
      const n = (missed.get(place.id) ?? 0) + 1;
      missed.set(place.id, n);
      if (n >= 2) next.add(place.id);
      continue;
    }
    const n = (missed.get(place.id) ?? 0) + 1;
    missed.set(place.id, n);
    if (n >= 2) next.add(place.id);
    // the server may be back: the kernel's units do not try again by themselves
    if (!missing(place.kind).length) await systemctl("start", unitOf(place));
  }
  away = next;
}

// the second copy of the backups may go to a place: what there is, and whether one may be written to now
knowPlaces(() => {
  const now = mountedAt();
  return places.map((p) => ({ id: p.id, name: p.name, kind: p.kind, folder: where(p), ready: now.has(where(p)) && !away.has(p.id), readOnly: p.readOnly }));
});
checkPlacesWith(async (p) => mountedAt().has(p.folder) && (await run(["timeout", "15", "ls", "-A", p.folder], 20_000)).code === 0);

/** On start: the files written anew from the list, the places started, a look every minute */
export function startNetPlaces(): void {
  void turn(sync).catch((e) => console.error("Could not set up the network places:", e instanceof Error ? e.message : e));
  setInterval(() => void turn(look).catch(() => {}), 60_000);
}
