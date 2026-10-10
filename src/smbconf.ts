/**
 * Folders shared over the network (SMB), as text: Samba's configuration as Hata writes it. Pure, with
 * no imports — the uninstaller uses it too.
 *
 * Samba is Hata's to set up: the whole `smb.conf` is written from the settings, and what was there
 * before is kept next to it once, as `smb.conf.before-hata`.
 */

export const SMB_CONF = "/etc/samba/smb.conf";
/** What `smb.conf` held before Hata took it over */
export const SMB_CONF_BEFORE = "/etc/samba/smb.conf.before-hata";
/** The names people type → the system accounts behind them */
export const USER_MAP = "/etc/samba/hata-users.map";

export type Access = "read" | "write";

export interface Share {
  /** What the folder is called on the network: `\\server\<name>` */
  name: string;
  /** The folder, an absolute path */
  path: string;
  /** What anyone on the network may do without a name and a password */
  guest: Access | "none";
  /** What each user of Hata may do, by id; one not listed may not open the folder */
  users: Record<string, Access>;
}

/** A user of Hata as Samba knows them */
export interface Account {
  id: string;
  /** The name they sign in to Hata with — and connect with */
  name: string;
}

/**
 * The system account behind a user. Samba wants one for every name, and a name of Hata's may be taken
 * on the system by somebody else (`root`, a person's own login) — so it is made from the user's id.
 */
export const unixName = (id: string): string => "hata-" + id.replace(/[^0-9a-f]/gi, "").slice(0, 8).toLowerCase();
export const UNIX_NAME_RE = /^hata-[0-9a-f]{8}$/;

const RESERVED = new Set(["global", "homes", "printers", "print$", "ipc$", "admin$"]);
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

/** A share's name as typed: letters, digits, spaces, dots, hyphens; null when it cannot be one */
export function shareName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return NAME_RE.test(name) && !/[. ]$/.test(name) && !RESERVED.has(name.toLowerCase()) ? name : null;
}

/** A name for a folder that is being shared: its own, tidied, and not one of the `taken` */
export function nameFor(path: string, taken: string[]): string {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const tidy = last.normalize("NFC").replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 36).replace(/[. ]+$/, "");
  const base = shareName(tidy) ?? "Shared";
  const used = new Set(taken.map((name) => name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/**
 * Whether a path can stand in Samba's file as it is: `%` begins a substitution there, a backslash at
 * the end of a line continues it, and a line is trimmed.
 */
export const writablePath = (path: string): boolean => /^\/[^%\\\x00-\x1f\x7f]*$/.test(path) && path === path.trim();

const isAccess = (v: unknown): v is Access => v === "read" || v === "write";

/** The shares as they are kept in the settings: whatever is not one is dropped, names are unique */
export function cleanShares(value: unknown): Share[] {
  const out: Share[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const name = shareName(item?.name);
    if (!name || typeof item.path !== "string" || !writablePath(item.path)) continue;
    if (out.some((share) => share.name.toLowerCase() === name.toLowerCase() || share.path === item.path)) continue;
    const users: Record<string, Access> = {};
    if (typeof item.users === "object" && item.users !== null && !Array.isArray(item.users)) for (const [id, access] of Object.entries(item.users)) if (isAccess(access)) users[id] = access;
    out.push({ name, path: item.path, guest: isAccess(item.guest) ? item.guest : "none", users });
  }
  return out;
}

const MARK = "# Written by Hata from its settings (Settings → Network folders).";

/** Whether this `smb.conf` is one Hata wrote */
export const isOurs = (conf: string): boolean => conf.startsWith(MARK);

/**
 * Samba's whole configuration. Only what Hata offers is on: no printers, no home folders, no SMB1.
 * Files are written as root and take the owner of the folder they land in — the same as in Hata's file
 * manager, whoever connects.
 */
export function smbConf(shares: Share[], accounts: Account[]): string {
  const lines = [
    MARK,
    "# Changes made here by hand are overwritten.",
    "",
    "[global]",
    "   server role = standalone server",
    "   server string = Hata",
    "   server min protocol = SMB2",
    `   username map = ${USER_MAP}`,
    // a visitor Samba does not know comes in as a guest — and gets only what is open to anyone
    `   map to guest = ${shares.some((share) => share.guest !== "none") ? "Bad User" : "Never"}`,
    "   guest account = nobody",
    "   load printers = no",
    "   printing = bsd",
    "   printcap name = /dev/null",
    "   disable spoolss = yes",
    "   log file = /var/log/samba/log.%m",
    "   max log size = 1000",
  ];
  const known = new Map(accounts.map((account) => [account.id, unixName(account.id)]));
  for (const share of shares) {
    const granted = Object.entries(share.users).filter(([id]) => known.has(id));
    const names = (access?: Access) => granted.filter(([, has]) => !access || has === access).map(([id]) => known.get(id)!).join(" ");
    lines.push("", `[${share.name}]`, `   path = ${share.path}`, "   browseable = yes", `   guest ok = ${share.guest === "none" ? "no" : "yes"}`, `   read only = ${share.guest === "write" ? "no" : "yes"}`);
    if (share.guest === "none") {
      // an empty list would mean "everyone": a folder nobody is named for is closed instead
      if (granted.length) lines.push(`   valid users = ${names()}`);
      else lines.push("   available = no");
    }
    if (share.guest !== "write" && names("write")) lines.push(`   write list = ${names("write")}`);
    // Windows' "archive" mark would otherwise be kept as the right to run the file
    lines.push("   force user = root", "   inherit owner = yes", "   inherit permissions = yes", "   map archive = no");
  }
  return lines.join("\n") + "\n";
}

/** The file that tells Samba which system account a typed name stands for */
export const userMap = (accounts: Account[]): string => "# Written by Hata: its users and the system accounts Samba knows them by.\n" + accounts.map((account) => `${unixName(account.id)} = ${account.name}\n`).join("");

/** The names Samba has passwords for, from `pdbedit -L` (`name:uid:full name`) */
export const parseUsers = (out: string): string[] => out.split("\n").map((line) => line.split(":")[0]!.trim()).filter(Boolean);
