/**
 * What a member (or a guest) may do in Files: the folders shared over the network, with the same rights
 * as there — read, or read and write. Everything else is an administrator's. Like Samba with `wide
 * links = no`, a link leading out of a shared folder does not open: every path is judged by where it
 * really is.
 */

import { basename, dirname, join } from "node:path";
import { AppError } from "./apps";
import type { User } from "./auth";
import { settings } from "./config";
import { locate, realPath, within } from "./files";
import type { Access, Share } from "./smbconf";

/** A shared folder as one user may use it */
export interface Granted {
  name: string;
  path: string;
  access: Access;
}

/**
 * The shared folders a user may open, and how: what they are given by name, or what anyone on the
 * network gets, whichever is more. One kept out of the network folders gets only the latter.
 */
export function grantedTo(shares: Share[], user: Pick<User, "id" | "noShares">): Granted[] {
  return shares.flatMap((share) => {
    const own = user.noShares ? undefined : share.users[user.id];
    const anyone = share.guest === "none" ? undefined : share.guest;
    const access = own === "write" || anyone === "write" ? "write" : (own ?? anyone);
    return access ? [{ name: share.name, path: share.path, access }] : [];
  });
}

/** The shared folder a real path lies in — the innermost, when one is shared inside another */
export function grantAt<T extends { real: string }>(grants: T[], real: string): T | null {
  return grants.filter((g) => within(real, g.real)).sort((a, b) => b.real.length - a.real.length)[0] ?? null;
}

export interface Rights {
  shares: Granted[];
  /**
   * Throws unless the user may do this at the path. `entry` — the entry itself is acted on (renamed,
   * moved, deleted): a link is judged by where it lies, not where it leads; `inner` — and it must lie
   * inside a shared folder, not be one (that is the administrator's to rename or delete).
   */
  need(path: unknown, access: Access, how?: { entry?: boolean; inner?: boolean }): string;
  /** The same as a yes or no; `entry` — the entry itself, inside a shared folder */
  may(path: string, access: Access, entry?: boolean): boolean;
}

export function rightsOf(user: User): Rights {
  const shares = grantedTo(settings.shares, user);
  const grants = shares.map((g) => ({ ...g, real: realPath(g.path) }));
  const realOf = (abs: string, entry: boolean) => (entry && abs !== "/" ? join(realPath(dirname(abs)), basename(abs)) : realPath(abs));
  const need: Rights["need"] = (path, access, how = {}) => {
    const abs = locate(path);
    const real = realOf(abs, !!how.entry);
    const grant = grantAt(grants, real);
    if (!grant) throw new AppError("files.notShared", 403);
    if (access === "write" && grant.access !== "write") throw new AppError("files.readOnlyShare", 403, { name: grant.name });
    if (how.inner && real === grant.real) throw new AppError("files.shareItself", 403, { name: grant.name });
    return abs;
  };
  return {
    shares,
    need,
    may: (path, access, entry = false) => {
      try {
        need(path, access, { entry, inner: entry });
        return true;
      } catch {
        return false;
      }
    },
  };
}
