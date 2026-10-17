/**
 * Machines let to the other users of Hata. While a machine is, every user of Hata has an account
 * there (`hata-<8 hex>`, as on this server — `clientusers.ts` makes them), and its folders can be
 * shared with them: they open such a folder in Files with the rights given, as a folder of this server
 * shared over the network. A machine not let to them is the administrators' alone.
 */

import { record } from "./activity";
import { AppError } from "./apps";
import { findUser, listUsers, onUsersChanged, type User } from "./auth";
import { saveSettings, settings } from "./config";
import { grantAt, grantedTo, type Granted } from "./memberfiles";
import { call, isOnline, machine, machines, onMachineUp, setPeople } from "./machines";
import { shareName, unixName, writablePath, type Access, type MachineShare } from "./smbconf";

/** What the machine's accounts should be: every user of Hata while it is let to them, none otherwise */
const accountsFor = (id: string) => (machine(id).people ? listUsers().map((user) => ({ name: unixName(user.id), comment: user.name })) : []);

/** Brings the machine's accounts in step; a machine that is away gets them when it connects again */
export async function syncAccounts(id: string): Promise<void> {
  if (!isOnline(id)) return;
  try {
    const done = await call<{ failed: string[] }>(id, "users.sync", { users: accountsFor(id) });
    if (done.failed.length) console.error(`Accounts on ${machine(id).name} not in step:`, done.failed.join(", "));
  } catch (e) {
    // an older client does not know the call: it is brought up to date from the machine's page
    console.error(`Accounts on ${machine(id).name}:`, e instanceof Error ? e.message : e);
  }
}

/** Lets the machine to the other users of Hata or takes it back; taken back, its shared folders go too */
export async function letMachine(id: string, on: boolean, by: string): Promise<void> {
  const before = machine(id);
  if (before.people === on) return;
  setPeople(id, on);
  if (!on && settings.machineShares[id]) {
    delete settings.machineShares[id];
    saveSettings();
  }
  record(on ? "machine.people.on" : "machine.people.off", { user: by, machine: before.name, detail: before.name });
  await syncAccounts(id);
}

export const machineShares = (id: string): MachineShare[] => settings.machineShares[id] ?? [];

/**
 * Shares a folder of the machine with users of Hata, changes who may do what there, or — with nobody
 * named — stops sharing it. A folder is told by its path.
 */
export function shareOnMachine(id: string, input: { path?: unknown; name?: unknown; users?: unknown }, by: string): MachineShare[] {
  const m = machine(id);
  if (!m.people) throw new AppError("machine.notLet", 409);
  const path = typeof input.path === "string" ? input.path.replace(/(.)\/+$/, "$1") : "";
  if (!writablePath(path) || path === "/") throw new AppError("files.badPath");
  const users: Record<string, Access> = {};
  if (typeof input.users === "object" && input.users !== null && !Array.isArray(input.users)) {
    for (const [userId, access] of Object.entries(input.users)) if ((access === "read" || access === "write") && findUser(userId)) users[userId] = access;
  }
  const list = machineShares(id).filter((share) => share.path !== path);
  if (Object.keys(users).length) {
    const name = shareName(input.name) ?? shareName(path.split("/").pop()) ?? "Shared";
    if (list.some((share) => share.name.toLowerCase() === name.toLowerCase())) throw new AppError("shares.nameTaken", 409, { name });
    list.push({ name, path, users });
    record("machine.share.saved", { user: by, machine: m.name, detail: `${m.name}:${path}` });
  } else record("machine.share.removed", { user: by, machine: m.name, detail: `${m.name}:${path}` });
  if (list.length) settings.machineShares[id] = list;
  else delete settings.machineShares[id];
  saveSettings();
  return list;
}

/** The folders of other machines shared with a user, by machine */
export function sharedOnMachines(user: User): { id: string; name: string; online: boolean; shares: Granted[] }[] {
  return machines()
    .filter((m) => m.people)
    .map((m) => ({ id: m.id, name: m.name, online: m.online, shares: grantedTo(machineShares(m.id).map((share) => ({ ...share, guest: "none" as const })), user) }))
    .filter((m) => m.shares.length > 0);
}

/**
 * A user's rights on a machine: like `rightsOf` here, but where a path really is the machine says.
 * One call asks for every path of a request.
 */
export async function machineRights(user: User, id: string) {
  const m = machine(id);
  const shares = m.people ? grantedTo(machineShares(id).map((share) => ({ ...share, guest: "none" as const })), user) : [];
  if (!shares.length) throw new AppError("files.notShared", 403);
  const roots = await call<{ target: string }[]>(id, "fs.real", { paths: shares.map((share) => share.path) });
  const grants = shares.map((share, i) => ({ ...share, real: roots[i]!.target }));
  /** Throws unless each path may be used so; `entry`/`inner` as in `rightsOf` */
  const need = async (paths: unknown[], access: Access, how: { entry?: boolean; inner?: boolean } = {}): Promise<void> => {
    if (!paths.length || paths.some((path) => typeof path !== "string")) throw new AppError("files.badPath");
    const real = await call<{ target: string; entry: string }[]>(id, "fs.real", { paths });
    for (const one of real) {
      const at = how.entry ? one.entry : one.target;
      const grant = grantAt(grants, at);
      if (!grant) throw new AppError("files.notShared", 403);
      if (access === "write" && grant.access !== "write") throw new AppError("files.readOnlyShare", 403, { name: grant.name });
      if (how.inner && at === grant.real) throw new AppError("files.shareItself", 403, { name: grant.name });
    }
  };
  return { shares, need, may: (path: string, access: Access) => need([path], access).then(() => true, () => false) };
}

export function startMachineUsers(): void {
  onMachineUp((id) => void syncAccounts(id));
  onUsersChanged(() => {
    for (const m of machines()) if (m.people) void syncAccounts(m.id);
  });
}
