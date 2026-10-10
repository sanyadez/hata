/**
 * Folders shared over the network (SMB), so that they open in the file manager of a computer or a phone.
 *
 * The serving is Samba's — installed from the page, on request. Hata keeps the list of shares in its
 * settings, writes them into a file of its own that Samba's configuration reads (`smbconf.ts`), and
 * keeps one name with a password to connect with: Samba cannot check Hata's passwords, it needs the
 * password itself. A change is tried with Samba's own `testparm` before it is put to work.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { record } from "./activity";
import { AppError } from "./apps";
import { saveSettings, settings } from "./config";
import { locate, mustBeSharable, onSharesMoved } from "./files";
import { writeTextAtomic } from "./fsutil";
import { answersItself, homeLinks } from "./mdns";
import { installCommand, installPackage, PATH, run } from "./packages";
import { localDomain } from "./site";
import { HATA_CONF, hasInclude, nameFor, parseUsers, shareName, SMB_CONF, SMB_USER, smbConf, withInclude, writablePath, type Share } from "./smbconf";

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

/** Why the last change did not reach Samba; "" when it did */
let failure = "";
let queue: Promise<void> = Promise.resolve();

async function sync(): Promise<void> {
  failure = "";
  if (!installed()) return;
  const ours = read(HATA_CONF);
  // nothing was ever shared from here: Samba is left exactly as it is
  if (!settings.shares.length && ours === null) return;
  const main = read(SMB_CONF);
  const conf = smbConf(settings.shares);
  if (conf !== ours || main === null || !hasInclude(main)) {
    put(HATA_CONF, conf);
    if (main === null || !hasInclude(main)) put(SMB_CONF, withInclude(main));
    const check = await run(["testparm", "-s"], 20_000);
    if (check.code !== 0) {
      put(HATA_CONF, ours);
      put(SMB_CONF, main);
      failure = (check.err.trim() || check.out.trim()).split("\n").slice(-3).join("\n") || `testparm exited with ${check.code}`;
      return;
    }
  }
  const name = await unit();
  if (!name) return;
  if (await isActive(name)) await run(["smbcontrol", "all", "reload-config"], 10_000);
  // a stopped Samba is started only when there is something of ours to serve
  else if (settings.shares.length) {
    const started = await run(["systemctl", "enable", "--now", `${name}.service`], 60_000);
    if (started.code !== 0) failure = started.err.trim().split("\n").slice(-3).join("\n") || `systemctl exited with ${started.code}`;
  }
}

/** Brings Samba in line with the settings, one change at a time */
function apply(): Promise<void> {
  queue = queue.then(sync).catch((e) => {
    failure = e instanceof Error ? e.message : String(e);
    console.error("Could not set up the shared folders:", failure);
  });
  return queue;
}

async function hasPassword(): Promise<boolean> {
  return parseUsers((await run(["pdbedit", "-L"], 10_000)).out).includes(SMB_USER);
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
  account: { name: string; set: boolean };
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
  return {
    tool,
    install: tool === "missing" ? installCommand(PACKAGE) : "",
    running: tool === "ok" && (await isActive(await unit())),
    error: failure,
    account: { name: SMB_USER, set: tool === "ok" && (await hasPassword()) },
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
  readOnly?: unknown;
}

/** Shares a folder; without a name it is called as the folder is */
export async function addShare(input: ShareInput, by: string): Promise<SharesReport> {
  if (!installed()) throw new AppError("shares.noTool", 409);
  const path = locate(input.path);
  mustBeSharable(path);
  if (!writablePath(path)) throw new AppError("shares.badPath");
  if (settings.shares.some((share) => share.path === path)) throw new AppError("shares.already", 409);
  if (settings.shares.length >= MAX_SHARES) throw new AppError("shares.tooMany", 409, { max: MAX_SHARES });
  const name = input.name === undefined || input.name === "" ? nameFor(path, settings.shares.map((share) => share.name)) : named(input.name);
  settings.shares = [...settings.shares, { name, path, guest: input.guest === true, readOnly: input.readOnly === true }];
  record("system.share.on", { user: by, detail: name });
  return applied();
}

export async function changeShare(current: string, input: ShareInput): Promise<SharesReport> {
  const share = find(current);
  const next = { ...share };
  if (input.name !== undefined) next.name = named(input.name, share);
  if (input.guest !== undefined) next.guest = input.guest === true;
  if (input.readOnly !== undefined) next.readOnly = input.readOnly === true;
  settings.shares = settings.shares.map((one) => (one === share ? next : one));
  return applied();
}

export async function removeShare(name: string, by: string): Promise<SharesReport> {
  const share = find(name);
  settings.shares = settings.shares.filter((one) => one !== share);
  record("system.share.off", { user: by, detail: share.name });
  return applied();
}

const nologin = (): string => ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false"].find((path) => existsSync(path)) ?? "/bin/false";

/**
 * Sets the password people connect with. Samba wants a system account behind the name, so one is made
 * the first time — an account nobody can sign in to the server with.
 */
export async function setPassword(password: unknown): Promise<SharesReport> {
  if (!installed()) throw new AppError("shares.noTool", 409);
  if (typeof password !== "string" || password.length < 8 || password.length > 127 || /[\x00-\x1f\x7f]/.test(password)) throw new AppError("shares.badPassword");
  if ((await run(["id", "-u", SMB_USER], 10_000)).code !== 0) {
    const made = await run(["useradd", "--system", "--no-create-home", "--shell", nologin(), SMB_USER], 20_000);
    if (made.code !== 0) throw new AppError("shares.passwordFailed", 500, { message: made.err.trim() || `useradd exited with ${made.code}` });
  }
  const set = await run(["smbpasswd", "-s", "-a", SMB_USER], 20_000, {}, `${password}\n${password}\n`);
  if (set.code !== 0) throw new AppError("shares.passwordFailed", 500, { message: (set.err.trim() || set.out.trim()).split("\n").slice(-2).join("\n") || `smbpasswd exited with ${set.code}` });
  await run(["smbpasswd", "-e", SMB_USER], 10_000);
  return listShares();
}

/**
 * Installs Samba with the system's package manager; throws with what went wrong.
 * Only ever called for the button: Hata installs nothing on its own.
 */
export async function installSamba(): Promise<SharesReport> {
  if (!installed()) {
    const failed = await installPackage(PACKAGE);
    if (failed || !installed()) throw new AppError("shares.installFailed", 500, { message: failed ?? "The package is installed, but smbd is not there" });
  }
  await apply();
  return listShares();
}

/** On start: the shares of the settings are served again — after a restore of the server, too */
export function startShares(): void {
  onSharesMoved(() => void apply());
  if (settings.shares.length) void apply();
}
