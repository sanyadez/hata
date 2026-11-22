/**
 * What stands on a folder that is about to be disconnected: the apps that keep files there, what plays
 * from it, the folders the TV shows, what is pinned, marked and shared. None of it stops a disk from
 * being taken away — it is said first, and what holds files open there is stopped.
 */
import { AppError, appAction, getJob, listApps } from "./apps";
import { appFolders } from "./backup";
import { settings } from "./config";
import { musicDo, musicPaths } from "./music";
import { remote as tvRemote, tvNow } from "./kodi";

export interface DiskUse {
  /**
   * app — an app with a folder there (`running`: it is stopped first); tvPlaying / musicPlaying — what plays
   * from there now (stopped first); tvFolder, pin, favorite, share — what will lead nowhere.
   */
  kind: "app" | "tvPlaying" | "musicPlaying" | "tvFolder" | "pin" | "favorite" | "share";
  name: string;
  /** The folder or file there */
  path: string;
  running?: boolean;
}

export interface World {
  apps: { name: string; title: string; running: boolean; folders: string[] }[];
  /** The file the TV plays; "" — nothing, or not a file of this server */
  tvPlaying: string;
  tvFolders: string[];
  /** The files in the music player's queue while it plays */
  music: string[];
  pins: string[];
  favorites: string[];
  shares: { name: string; path: string }[];
}

const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith("/") ? root : root + "/");
const last = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** Everything of the world that lies under a folder (pure) */
export function findUses(root: string, world: World): DiskUse[] {
  const out: DiskUse[] = [];
  for (const app of world.apps) {
    const folder = app.folders.find((one) => within(one, root));
    if (folder) out.push({ kind: "app", name: app.title || app.name, path: folder, running: app.running });
  }
  if (world.tvPlaying && within(world.tvPlaying, root)) out.push({ kind: "tvPlaying", name: last(world.tvPlaying), path: world.tvPlaying });
  const song = world.music.find((one) => within(one, root));
  if (song) out.push({ kind: "musicPlaying", name: last(song), path: song });
  for (const folder of world.tvFolders) if (within(folder, root)) out.push({ kind: "tvFolder", name: last(folder), path: folder });
  for (const share of world.shares) if (within(share.path, root)) out.push({ kind: "share", name: share.name, path: share.path });
  for (const pin of world.pins) if (within(pin, root)) out.push({ kind: "pin", name: last(pin), path: pin });
  for (const one of [...new Set(world.favorites)]) if (within(one, root)) out.push({ kind: "favorite", name: last(one), path: one });
  return out;
}

async function world(): Promise<World> {
  const apps = await listApps("en").catch(() => []);
  const playing = tvNow().playing as { file?: unknown } | null | undefined;
  return {
    apps: apps.map((app) => {
      const folders = appFolders(app.name);
      return { name: app.name, title: app.title ?? app.name, running: app.status === "running" || app.status === "partial", folders: [...folders.included, ...folders.other] };
    }),
    tvPlaying: typeof playing?.file === "string" && playing.file.startsWith("/") ? playing.file : "",
    tvFolders: settings.tv.folders,
    music: await musicPaths().catch(() => []),
    pins: settings.folders,
    favorites: Object.values(settings.favorites).flatMap((list) => list.map((one) => one.path)),
    shares: settings.shares.map((share) => ({ name: share.name, path: share.path })),
  };
}

export const diskUses = async (path: string): Promise<DiskUse[]> => findUses(path, await world());

/** Stops what keeps files open under a folder, so the system lets the folder go */
export async function letGo(path: string, by: string): Promise<void> {
  const now = await world();
  const uses = findUses(path, now);
  if (uses.some((use) => use.kind === "tvPlaying")) await tvRemote("stop", undefined).catch(() => {});
  if (uses.some((use) => use.kind === "musicPlaying")) await musicDo("stop", undefined).catch(() => {});
  for (const app of now.apps) {
    if (!app.running || !app.folders.some((one) => within(one, path))) continue;
    const job = appAction(app.name, "stop", by);
    for (let i = 0; i < 120 && getJob(job.id)?.status === "running"; i++) await Bun.sleep(1000);
    if (getJob(job.id)?.status !== "done") throw new AppError("disk.stopFailed", 409, { app: app.title });
  }
}
