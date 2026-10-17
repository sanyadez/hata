/**
 * What Docker keeps on the disk besides the apps' own folders: images and volumes, which of them a
 * container uses, and taking away what nothing uses. Docker leaves behind an older image after every
 * update and the volumes of a project removed without them; this is where they are seen and cleared.
 */
import { record } from "./activity";
import { AppError, installedNames, viewOf } from "./apps";
import { diskUsage, listContainers, PROJECT_LABEL, pruneBuildCache, pruneImages, pruneVolumes, removeImage, removeVolume, type ContainerSummary, type DiskUsage } from "./docker";

/** Who uses an image or a volume: a container, and the app it belongs to when it is a compose project */
export interface User {
  container: string;
  app: string;
  running: boolean;
}

export interface ImageReport {
  id: string;
  /** `name:tag`; "" for an image without a name — an older version left by an update */
  name: string;
  /** Its other names */
  more: string[];
  size: number;
  created: number;
  used: User[];
  /** Installed apps whose compose file names it though no container of theirs is there: they would download it again */
  wanted: string[];
}

export interface VolumeReport {
  name: string;
  /** -1 — not known */
  size: number;
  created: string;
  /** The compose project it was made for; "" when made by hand */
  project: string;
  /** Made for a container's own use, without a name in a compose file */
  anonymous: boolean;
  used: User[];
}

export interface SpaceReport {
  images: ImageReport[];
  volumes: VolumeReport[];
  /** What builds left behind */
  cache: number;
}

const containerName = (c: ContainerSummary): string => (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, "");
const userOf = (c: ContainerSummary): User => ({ container: containerName(c), app: c.Labels[PROJECT_LABEL] ?? "", running: c.State === "running" });

/** The reference without its registry's default parts, as people write it: `nginx:latest`, not `docker.io/library/nginx:latest` */
const shortName = (ref: string): string => ref.replace(/^docker\.io\//, "").replace(/^library\//, "");
/** A reference as a compose file has it, with the tag Docker takes when none is written */
const tagged = (ref: string): string => {
  const name = shortName(ref);
  return name.includes("@") || /:[^/]*$/.test(name) ? name : `${name}:latest`;
};
/** An amount for the activity log, which shows details as they are */
export const amount = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.round(bytes / 1e3)} KB`);

/**
 * The report from what Docker said. Pure. `named` — installed app → the image references its compose
 * file names; an image they name is "wanted" even with no container.
 */
export function describeSpace(df: DiskUsage, containers: ContainerSummary[], named: Record<string, string[]>): SpaceReport {
  const images = (df.Images ?? []).map((image): ImageReport => {
    const tags = (image.RepoTags ?? []).filter((tag) => tag !== "<none>:<none>").map(shortName);
    const used = containers.filter((c) => c.ImageID === image.Id).map(userOf);
    const wanted = used.length ? [] : Object.entries(named).filter(([, refs]) => refs.some((ref) => tags.includes(tagged(ref)))).map(([app]) => app);
    return { id: image.Id, name: tags[0] ?? "", more: tags.slice(1), size: image.Size, created: image.Created, used, wanted };
  });
  const volumes = (df.Volumes ?? []).map((volume): VolumeReport => {
    const labels = volume.Labels ?? {};
    return {
      name: volume.Name,
      size: volume.UsageData?.Size ?? -1,
      created: volume.CreatedAt ?? "",
      project: labels[PROJECT_LABEL] ?? "",
      anonymous: "com.docker.volume.anonymous" in labels || (/^[0-9a-f]{64}$/.test(volume.Name) && !labels[PROJECT_LABEL]),
      used: containers.filter((c) => c.Mounts?.some((m) => m.Type === "volume" && m.Name === volume.Name)).map(userOf),
    };
  });
  // the largest first, the unused before the used: what is worth taking away is on top
  const order = <T extends { used: User[]; size: number }>(a: T, b: T) => Number(a.used.length > 0) - Number(b.used.length > 0) || b.size - a.size;
  return { images: images.sort(order), volumes: volumes.sort(order), cache: (df.BuildCache ?? []).filter((c) => !c.InUse).reduce((n, c) => n + c.Size, 0) };
}

/** The image references the compose files of the installed apps name */
function namedImages(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of installedNames()) {
    const compose = viewOf(name);
    out[name] = Object.values(compose?.services ?? {}).map((service) => (typeof service?.image === "string" ? service.image : "")).filter(Boolean);
  }
  return out;
}

export async function dockerSpace(): Promise<SpaceReport> {
  const [df, containers] = await Promise.all([diskUsage(), listContainers()]);
  return describeSpace(df, containers, namedImages());
}

const short = (id: string) => id.replace(/^sha256:/, "").slice(0, 12);

/** Takes away one image no container uses */
export async function dropImage(id: string, user: string): Promise<void> {
  const containers = await listContainers();
  if (containers.some((c) => c.ImageID === id)) throw new AppError("docker.imageInUse", 409);
  const df = await diskUsage();
  const image = df.Images?.find((one) => one.Id === id);
  if (!image) throw new AppError("docker.notFound", 404);
  await removeImage(id);
  record("system.docker.image", { user, detail: (image.RepoTags ?? []).filter((t) => t !== "<none>:<none>").map(shortName)[0] ?? short(id) });
}

/** Takes away one volume no container uses — and the data in it */
export async function dropVolume(name: string, user: string): Promise<void> {
  const containers = await listContainers();
  if (containers.some((c) => c.Mounts?.some((m) => m.Type === "volume" && m.Name === name))) throw new AppError("docker.volumeInUse", 409);
  await removeVolume(name).catch((e) => {
    throw e?.status === 404 ? new AppError("docker.notFound", 404) : e?.status === 409 ? new AppError("docker.volumeInUse", 409) : e;
  });
  record("system.docker.volume", { user, detail: name });
}

/** Takes away everything of a kind nothing uses; answers how much room it gave back (and how many volumes) */
export async function prune(kind: "images" | "volumes" | "cache", user: string): Promise<{ count: number; freed: number }> {
  if (kind === "volumes") {
    // Docker answers 0 for the room volumes gave back: their sizes are taken from before
    const before = new Map((await diskUsage()).Volumes?.map((v) => [v.Name, Math.max(0, v.UsageData?.Size ?? 0)]) ?? []);
    const done = await pruneVolumes();
    const gone = done.VolumesDeleted ?? [];
    const freed = done.SpaceReclaimed || gone.reduce((n, name) => n + (before.get(name) ?? 0), 0);
    record("system.docker.prune.volumes", { user, detail: `${gone.length}, ${amount(freed)}` });
    return { count: gone.length, freed };
  }
  const done = kind === "images" ? await pruneImages() : await pruneBuildCache();
  record(`system.docker.prune.${kind}`, { user, detail: amount(done.SpaceReclaimed) });
  return { count: 0, freed: done.SpaceReclaimed };
}
