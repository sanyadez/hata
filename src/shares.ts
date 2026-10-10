/**
 * Folders shared over the network (SMB), so that they open in the file manager of a computer or a phone.
 *
 * The serving is Samba's, and Samba is Hata's to set up: its whole configuration is written from the
 * settings (`smbconf.ts`), tried with Samba's own `testparm` and put to work. The users are Hata's: each
 * has a system account behind them and connects with the name and the password they sign in to Hata
 * with. Samba has to keep a password itself, so it learns one when Hata sees it — when it is set, and
 * when it is typed in rightly at sign-in.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { findUser, listUsers, onPasswords, type Role, type User } from "./auth";
import { DATA_DIR, saveSettings, settings } from "./config";
import { locate, mustBeSharable, onSharesMoved } from "./files";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import { answersItself, homeLinks } from "./mdns";
import { installCommand, installPackage, PATH, run } from "./packages";
import { localDomain } from "./site";
import { isOurs, nameFor, parseUsers, shareName, SMB_CONF, SMB_CONF_BEFORE, smbConf, UNIX_NAME_RE, unixName, USER_MAP, userMap, writablePath, type Access, type Share } from "./smbconf";

const PACKAGE = "samba";
const MAX_SHARES = 40;

const installed = (): boolean => Bun.which("smbd", { PATH }) !== null;

/** Samba's service: `smbd` on Debian and Ubuntu, `smb` on Fedora, Arch and openSUSE */
async function unit(): Promise<string | null> {
  for (const name of ["smbd", "smb"]) if ((await run(["systemctl", "cat", `${name}.service`], 10_000)).code === 0) return name;
  return null;
}

const isActive = async (name: string | null): Promise<boolean> => name !== null && (await run(["systemctl", "is-active", "--quiet", `${name}.service`], 10_000)).code === 0;

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const put = (path: string, text: string | null) => (text === null ? rmSync(path, { force: true }) : writeTextAtomic(path, text));

/** Which password of a user Samba was given: a digest of Hata's own hash of it, by user id */
const KNOWN_FILE = join(DATA_DIR, "shares.json");
const known = readJsonFile<Record<string, string>>(KNOWN_FILE, {}, (v) => typeof v === "object" && v !== null && !Array.isArray(v));
const digest = (user: User): string => new Bun.CryptoHasher("sha256").update(user.passwordHash).digest("hex");

const nologin = (): string => ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false"].find((path) => existsSync(path)) ?? "/bin/false";

/** The names Samba has passwords for */
const inSamba = async (): Promise<string[]> => parseUsers((await run(["pdbedit", "-L"], 10_000)).out);

/** Why the last change did not reach Samba; "" when it did */
let failure = "";
let queue: Promise<void> = Promise.resolve();

/** Every user of Hata has a system account; the accounts of users that are gone go too */
async function syncAccounts(): Promise<void> {
  const users = listUsers();
  for (const user of users) {
    const name = unixName(user.id);
    if ((await run(["id", "-u", name], 10_000)).code === 0) continue;
    // an account nobody can sign in to the server with
    const made = await run(["useradd", "--system", "--no-create-home", "--shell", nologin(), "--comment", `Hata user ${user.name}`, name], 20_000);
    if (made.code !== 0) console.error(`Could not make the account ${name} for ${user.name}:`, made.err.trim());
  }
  const ours = new Set(users.map((user) => unixName(user.id)));
  const passwd = read("/etc/passwd") ?? "";
  const left = new Set([...(await inSamba()), ...passwd.split("\n").map((line) => line.split(":")[0]!)].filter((name) => UNIX_NAME_RE.test(name) && !ours.has(name)));
  for (const name of left) {
    await run(["smbpasswd", "-x", name], 10_000);
    await run(["userdel", name], 20_000);
  }
  for (const id of Object.keys(known)) if (!users.some((user) => user.id === id)) delete known[id];
}

async function sync(): Promise<void> {
  failure = "";
  if (!installed()) return;
  await syncAccounts();
  // a folder shared with a user who is gone is not shared with whoever comes next
  const ids = new Set(listUsers().map((user) => user.id));
  let pruned = false;
  for (const share of settings.shares) for (const id of Object.keys(share.users)) if (!ids.has(id)) (delete share.users[id], (pruned = true));
  if (pruned) saveSettings();
  writeJsonAtomic(KNOWN_FILE, known);

  const accounts = listUsers().map((user) => ({ id: user.id, name: user.name }));
  const conf = smbConf(settings.shares, accounts);
  const map = userMap(accounts);
  const before = read(SMB_CONF);
  const mapBefore = read(USER_MAP);
  if (conf !== before || map !== mapBefore) {
    // what was there before Hata is kept, once
    if (before !== null && !isOurs(before) && !existsSync(SMB_CONF_BEFORE)) put(SMB_CONF_BEFORE, before);
    put(USER_MAP, map);
    put(SMB_CONF, conf);
    const check = await run(["testparm", "-s"], 20_000);
    if (check.code !== 0) {
      put(SMB_CONF, before);
      put(USER_MAP, mapBefore);
      failure = (check.err.trim() || check.out.trim()).split("\n").slice(-3).join("\n") || `testparm exited with ${check.code}`;
      return;
    }
  }
  const name = await unit();
  if (!name) return;
  if (await isActive(name)) await run(["smbcontrol", "all", "reload-config"], 10_000);
  // a stopped Samba is started only when there is something to serve
  else if (settings.shares.length) {
    const started = await run(["systemctl", "enable", "--now", `${name}.service`], 60_000);
    if (started.code !== 0) failure = started.err.trim().split("\n").slice(-3).join("\n") || `systemctl exited with ${started.code}`;
  }
}

const queued = (work: () => Promise<void>): Promise<void> => {
  queue = queue.then(work).catch((e) => {
    failure = e instanceof Error ? e.message : String(e);
    console.error("Could not set up the shared folders:", failure);
  });
  return queue;
};

/** Brings Samba in line with the settings and the users, one change at a time */
const apply = (): Promise<void> => queued(sync);

/** A password Hata has just seen is given to Samba, unless Samba has that very one */
function learn(user: User, password: string): void {
  if (!installed()) return;
  // what Samba's tool reads line by line cannot hold a line break
  if (/[\r\n\0]/.test(password)) return;
  void queued(async () => {
    const name = unixName(user.id);
    if (known[user.id] === digest(user) && (await inSamba()).includes(name)) return;
    // a user made a moment ago: the account, and the name Samba knows them by
    if ((await run(["id", "-u", name], 10_000)).code !== 0) await sync();
    const set = await run(["smbpasswd", "-s", "-a", name], 20_000, {}, `${password}\n${password}\n`);
    if (set.code !== 0) return void console.error(`Samba did not take the password of ${user.name}:`, (set.err.trim() || set.out.trim()).split("\n").pop());
    await run(["smbpasswd", "-e", name], 10_000);
    known[user.id] = digest(user);
    writeJsonAtomic(KNOWN_FILE, known);
  });
}

export interface ShareReport extends Share {
  /** The folder is not there (a disk not mounted) */
  missing: boolean;
}

export interface SharesReport {
  /** ok — Samba is installed; missing — it is not */
  tool: "ok" | "missing";
  /** The command the "Install" button runs */
  install: string;
  running: boolean;
  /** Why the shares are not served as set; "" when they are */
  error: string;
  /** Hata's users; `ready` — Samba has their password, so they can connect */
  users: { id: string; name: string; role: Role; ready: boolean }[];
  /** How this server is called from another machine: the name on the home network first, then its addresses */
  hosts: string[];
  shares: ShareReport[];
}

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export async function listShares(): Promise<SharesReport> {
  const tool = installed() ? "ok" : "missing";
  const domain = localDomain();
  const hosts = [...(domain && answersItself(domain) ? [domain] : []), ...homeLinks().map((link) => link.address)];
  const has = tool === "ok" ? await inSamba() : [];
  const ready = (id: string): boolean => {
    const user = findUser(id);
    return !!user && known[id] === digest(user) && has.includes(unixName(id));
  };
  return {
    tool,
    install: tool === "missing" ? installCommand(PACKAGE) : "",
    running: tool === "ok" && (await isActive(await unit())),
    error: failure,
    users: listUsers().map((user) => ({ id: user.id, name: user.name, role: user.role, ready: ready(user.id) })),
    hosts,
    shares: settings.shares.map((share) => ({ ...share, missing: !isDir(share.path) })),
  };
}

const find = (name: string): Share => {
  const share = settings.shares.find((one) => one.name.toLowerCase() === name.toLowerCase());
  if (!share) throw new AppError("shares.notFound", 404);
  return share;
};

function named(value: unknown, but?: Share): string {
  const name = shareName(value);
  if (!name) throw new AppError("shares.badName");
  if (settings.shares.some((share) => share !== but && share.name.toLowerCase() === name.toLowerCase())) throw new AppError("shares.nameTaken", 409, { name });
  return name;
}

async function applied(): Promise<SharesReport> {
  saveSettings();
  await apply();
  return listShares();
}

export interface ShareInput {
  path?: unknown;
  name?: unknown;
  guest?: unknown;
  users?: unknown;
}

const isAccess = (v: unknown): v is Access => v === "read" || v === "write";

function guestOf(value: unknown): Share["guest"] {
  if (value !== "none" && !isAccess(value)) throw new AppError("shares.badAccess");
  return value;
}

/** Who may do what, as sent: user ids of Hata with "read" or "write"; "none" and nothing mean no access */
function usersOf(value: unknown): Record<string, Access> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AppError("shares.badAccess");
  const out: Record<string, Access> = {};
  for (const [id, access] of Object.entries(value)) {
    if (access === "none") continue;
    if (!isAccess(access) || !findUser(id)) throw new AppError("shares.badAccess");
    out[id] = access;
  }
  return out;
}

/** Shares a folder; without a name it is called as the folder is. Whoever shares it may change it unless told otherwise */
export async function addShare(input: ShareInput, by: User): Promise<SharesReport> {
  if (!installed()) throw new AppError("shares.noTool", 409);
  const path = locate(input.path);
  mustBeSharable(path);
  if (!writablePath(path)) throw new AppError("shares.badPath");
  if (settings.shares.some((share) => share.path === path)) throw new AppError("shares.already", 409);
  if (settings.shares.length >= MAX_SHARES) throw new AppError("shares.tooMany", 409, { max: MAX_SHARES });
  const name = input.name === undefined || input.name === "" ? nameFor(path, settings.shares.map((share) => share.name)) : named(input.name);
  const share: Share = { name, path, guest: input.guest === undefined ? "none" : guestOf(input.guest), users: input.users === undefined ? { [by.id]: "write" } : usersOf(input.users) };
  settings.shares = [...settings.shares, share];
  record("system.share.on", { user: by.name, detail: name });
  return applied();
}

export async function changeShare(current: string, input: ShareInput): Promise<SharesReport> {
  const share = find(current);
  const next = { ...share };
  if (input.name !== undefined) next.name = named(input.name, share);
  if (input.guest !== undefined) next.guest = guestOf(input.guest);
  if (input.users !== undefined) next.users = usersOf(input.users);
  settings.shares = settings.shares.map((one) => (one === share ? next : one));
  return applied();
}

export async function removeShare(name: string, by: User): Promise<SharesReport> {
  const share = find(name);
  settings.shares = settings.shares.filter((one) => one !== share);
  record("system.share.off", { user: by.name, detail: share.name });
  return applied();
}

/**
 * Installs Samba with the system's package manager; throws with what went wrong. The installer of Hata
 * does the same at the first install; this is for a server that was set up without it.
 */
export async function installSamba(): Promise<SharesReport> {
  if (!installed()) {
    const failed = await installPackage(PACKAGE);
    if (failed || !installed()) throw new AppError("shares.installFailed", 500, { message: failed ?? "The package is installed, but smbd is not there" });
  }
  await apply();
  return listShares();
}

/** On start: Samba, when it is there, is set up from the settings — after a restore of the server, too */
export function startShares(): void {
  onSharesMoved(() => void apply());
  onPasswords(learn, () => void apply());
  if (installed()) void apply();
}
