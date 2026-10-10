/**
 * Folders shared over the network (SMB), as text: the file Hata writes for Samba and the one line in
 * Samba's own configuration that reads it. Pure, with no imports — the uninstaller uses it too.
 *
 * Samba's `smb.conf` stays the user's: Hata adds a single `include` at its end and keeps everything of
 * its own in a file next to it, written anew on every change.
 */

export const SMB_CONF = "/etc/samba/smb.conf";
export const HATA_CONF = "/etc/samba/hata.conf";

/** The one name people connect with: Samba keeps its own passwords, apart from Hata's users */
export const SMB_USER = "hata";

export interface Share {
  /** What the folder is called on the network: `\\server\<name>` */
  name: string;
  /** The folder, an absolute path */
  path: string;
  /** Open to anyone on the network, without a name and a password */
  guest: boolean;
  readOnly: boolean;
}

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

/** The shares as they are kept in the settings: whatever is not one is dropped, names are unique */
export function cleanShares(value: unknown): Share[] {
  const out: Share[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const name = shareName(item?.name);
    if (!name || typeof item.path !== "string" || !writablePath(item.path)) continue;
    if (out.some((share) => share.name.toLowerCase() === name.toLowerCase() || share.path === item.path)) continue;
    out.push({ name, path: item.path, guest: item.guest === true, readOnly: item.readOnly === true });
  }
  return out;
}

const yes = (on: boolean) => (on ? "yes" : "no");

/**
 * Hata's file for Samba. Files are written as root and take the owner of the folder they land in — the
 * same as in Hata's file manager, whoever connects.
 */
export function smbConf(shares: Share[], user = SMB_USER): string {
  const lines = ["# Written by Hata: the folders shared over the network.", "# Changes made here by hand are overwritten; shares of your own belong in smb.conf."];
  // without it Samba refuses a visitor it does not know instead of letting them in as a guest
  if (shares.some((share) => share.guest)) lines.push("", "[global]", "   map to guest = Bad User");
  for (const share of shares) {
    lines.push("", `[${share.name}]`, `   path = ${share.path}`, "   browseable = yes", `   read only = ${yes(share.readOnly)}`, `   guest ok = ${yes(share.guest)}`);
    if (!share.guest) lines.push(`   valid users = ${user}`);
    // Windows' "archive" mark would otherwise be kept as the right to run the file
    lines.push("   force user = root", "   inherit owner = yes", "   inherit permissions = yes", "   map archive = no");
  }
  return lines.join("\n") + "\n";
}

const INCLUDE = `include = ${HATA_CONF}`;
const NOTE = "# The folders shared from Hata";
const isInclude = (line: string) => line.trim().replace(/\s+/g, " ") === INCLUDE;

export const hasInclude = (conf: string): boolean => conf.split("\n").some(isInclude);

/** Samba's configuration with our file read at its end; `null` — there is none yet, so the least that works */
export function withInclude(conf: string | null): string {
  const text = conf ?? "[global]\n   server role = standalone server\n";
  return hasInclude(text) ? text : `${text.replace(/\n*$/, "\n")}\n${NOTE}\n${INCLUDE}\n`;
}

/** …and with that line taken out again, as it was */
export function withoutInclude(conf: string): string {
  if (!hasInclude(conf)) return conf;
  const lines = conf.split("\n").filter((line) => !isInclude(line) && line.trim() !== NOTE);
  return lines.join("\n").replace(/\n*$/, "\n");
}

/** The names Samba has passwords for, from `pdbedit -L` (`name:uid:full name`) */
export const parseUsers = (out: string): string[] => out.split("\n").map((line) => line.split(":")[0]!.trim()).filter(Boolean);
