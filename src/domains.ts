/**
 * Settings → Domains: names under Hata's domain for containers, virtual machines, guests of Proxmox,
 * machines, their apps and any address of the home network (`names.ts` is the pure part). A name answers
 * the way an app's does — Hata passes the request on — so the labels of apps and of names are one list.
 */
import { record } from "./activity";
import { appMeta } from "./appform";
import { AppError, installedNames, viewOf } from "./apps";
import { listUsers } from "./auth";
import { saveSettings, settings } from "./config";
import { accessOf } from "./gate";
import { instanceAddress, instancesSeen, onInstanceRenamed } from "./containers";
import { tunnelPort } from "./machinegate";
import { machineTiles } from "./machineapps";
import { machines } from "./machines";
import { NameError, readName, renamedTarget, upstreamOf, type DomainName, type Target, type Upstream, type World } from "./names";
import { allGuests, guestAddress } from "./proxmox";

/** What is known of the targets now: read without waiting, as a request comes */
const world: World = {
  container: (name) => instanceAddress(name),
  guest: (host, guest) => guestAddress(host, guest),
  machine: (id) => {
    const m = machines().find((x) => x.id === id);
    return m ? (m.online ? m.ip : "") : null;
  },
  tunnel: (id, app) => tunnelPort(id, app),
};

/** The name a label is, if it is one of these */
export const nameOf = (label: string): DomainName | undefined => settings.names.find((n) => n.label === label);

export const upstream = (name: DomainName): Promise<Upstream> => upstreamOf(name, world);

/** The labels the apps of this server answer to: the one chosen for each, or the one its name gives */
export function appLabels(): { app: string; label: string }[] {
  return installedNames().map((app) => {
    const view = viewOf(app);
    return { app, label: (view && appMeta(view, "en").subdomain) || app.replace(/_/g, "-") };
  });
}

const changed: (() => void)[] = [];
/** Told after the list changed: the certificates follow the names */
export const onNamesChanged = (listener: () => void): void => void changed.push(listener);

function save(names: DomainName[]): void {
  settings.names = names;
  saveSettings();
  for (const listener of changed) listener();
}

const asApp = (e: unknown): never => {
  if (e instanceof NameError) throw new AppError(e.code, e.code === "domains.taken" ? 409 : 400, e.detail);
  throw e;
};

function read(input: Record<string, unknown>, except?: string): DomainName {
  const taken = [...appLabels().map((a) => a.label), ...settings.names.map((n) => n.label)].filter((l) => l !== except);
  try {
    return readName(input, taken, listUsers().map((u) => u.id));
  } catch (e) {
    return asApp(e);
  }
}

export function addName(input: Record<string, unknown>, by: string): DomainName {
  const name = read(input);
  save([...settings.names, name]);
  record("domains.added", { user: by, detail: name.label });
  return name;
}

export function changeName(label: string, input: Record<string, unknown>, by: string): DomainName {
  const i = settings.names.findIndex((n) => n.label === label);
  if (i < 0) throw new AppError("domains.notFound", 404, { label });
  const name = read(input, label);
  save(settings.names.map((n, j) => (j === i ? name : n)));
  record("domains.changed", { user: by, detail: name.label });
  return name;
}

export function removeName(label: string, by: string): void {
  if (!nameOf(label)) throw new AppError("domains.notFound", 404, { label });
  save(settings.names.filter((n) => n.label !== label));
  record("domains.removed", { user: by, detail: label });
}

/** The words of a target, for the page: what it is and the address it has now */
function describe(t: Target, guests: ReturnType<typeof allGuests>, tiles: Awaited<ReturnType<typeof machineTiles>>): { title: string; kind: string } {
  switch (t.kind) {
    case "container":
      return { title: t.name, kind: instancesSeen().find((c) => c.name === t.name)?.kind === "vm" ? "vm" : "container" };
    case "guest": {
      const g = guests.find((x) => x.host === t.host && x.id === t.guest);
      return { title: g ? `${g.name} (${g.hostName})` : t.guest, kind: "guest" };
    }
    case "machine":
      return { title: machines().find((m) => m.id === t.id)?.name ?? t.id, kind: "machine" };
    case "machineApp": {
      const tile = tiles.find((x) => x.machine.id === t.id && x.name === t.app);
      return { title: `${tile?.title ?? t.app} (${machines().find((m) => m.id === t.id)?.name ?? t.id})`, kind: "machineApp" };
    }
    case "address":
      return { title: t.host, kind: "address" };
  }
}

/** What the page shows: every name with where it leads now, and what a name can be given to */
export async function domainsReport(lang: string) {
  const guests = allGuests();
  const tiles = await machineTiles(machines().map((m) => ({ id: m.id, name: m.name, ip: m.ip, online: m.online })), lang).catch(() => []);
  return {
    names: await Promise.all(
      settings.names.map(async (n) => {
        const up = await upstream(n);
        // an app of a machine behind Hata's sign-in keeps it under the name too
        const inherits = n.target.kind === "machineApp" && accessOf(`${n.target.app}@${n.target.id}`).protect;
        return { ...n, ...describe(n.target, guests, tiles), inherits, at: "away" in up ? null : `${up.host}:${up.port}`, away: "away" in up ? up.away : null };
      }),
    ),
    apps: appLabels(),
    targets: {
      containers: await Promise.all(instancesSeen().map(async (c) => ({ name: c.name, kind: c.kind, address: (await instanceAddress(c.name)) ?? "", status: c.status }))),
      guests,
      machines: machines().map((m) => ({ id: m.id, name: m.name, ip: m.ip, online: m.online })),
      machineApps: tiles.map((t) => ({ id: t.machine.id, machine: t.machine.name, app: t.name, title: t.title, port: t.port ?? null })),
    },
  };
}

// a name follows its instance when it is renamed
onInstanceRenamed((from, to) => {
  const next = renamedTarget(settings.names, { kind: "container", name: from }, { kind: "container", name: to });
  if (JSON.stringify(next) !== JSON.stringify(settings.names)) save(next);
});
