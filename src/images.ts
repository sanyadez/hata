/**
 * Newer images in the registries.
 *
 * Once a day (and when asked) every image an app's containers run is compared with what its registry
 * holds under the same tag: the registry is asked through Docker (`/distribution/<name>/json`), so it
 * is reached the way a pull would reach it, and nothing is downloaded. A container whose image the tag
 * no longer points at makes its app "has newer images". The mark is tied to the image the container
 * runs, so it goes away by itself once the app is updated.
 *
 * On request the apps are also updated by themselves at a set time — the same "Update images" a person
 * presses, with the snapshot before it. An app that is stopped is left alone: an update would start it.
 *
 * Reading an image's name (`parseRef`), the comparison (`behind`) and the sign-in for a private
 * registry (`registryAuth`) are pure functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bus } from "./bus";
import { DATA_DIR, settings } from "./config";
import { imageDigests, listContainers, PROJECT_LABEL, registryDigest, type ContainerSummary } from "./docker";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";

export interface ImageRef {
  registry: string;
  repository: string;
  tag: string;
  /** Set when the image is named by digest: it can have no newer version */
  digest: string;
}

/** An image's name as Docker reads it: `nginx` is `docker.io/library/nginx:latest` */
export function parseRef(image: string): ImageRef | null {
  // a container whose image lost its tag is listed by the image's id
  if (/^(sha256:)?[0-9a-f]{64}$/.test(image)) return null;
  const at = image.indexOf("@");
  const digest = at < 0 ? "" : image.slice(at + 1);
  let name = at < 0 ? image : image.slice(0, at);
  let tag = "latest";
  const colon = name.lastIndexOf(":");
  if (colon > name.lastIndexOf("/")) {
    tag = name.slice(colon + 1);
    name = name.slice(0, colon);
  }
  const slash = name.indexOf("/");
  const first = slash < 0 ? "" : name.slice(0, slash);
  // the first part is a host only when it looks like one; `user/image` is a repository of Docker Hub
  const hasHost = first.includes(".") || first.includes(":") || first === "localhost";
  let registry = hasHost ? first : "docker.io";
  let repository = hasHost ? name.slice(slash + 1) : name;
  if (registry === "index.docker.io" || registry === "registry-1.docker.io") registry = "docker.io";
  if (registry === "docker.io" && !repository.includes("/")) repository = "library/" + repository;
  if (!/^[a-z0-9]+([._/-]+[a-z0-9]+)*$/.test(repository) || !/^[\w][\w.-]{0,127}$/.test(tag)) return null;
  if (digest && !/^[a-z0-9]+:[0-9a-f]{32,}$/.test(digest)) return null;
  return { registry, repository, tag, digest };
}

export const refName = (ref: ImageRef): string => `${ref.registry}/${ref.repository}:${ref.tag}`;

/**
 * Whether the registry's tag has moved on from the image at hand. `local` are the image's
 * `RepoDigests`; null — it cannot be told (an image built on this machine has none).
 */
export function behind(ref: ImageRef, local: string[], remote: string): boolean | null {
  const own: string[] = [];
  for (const entry of local) {
    const at = entry.lastIndexOf("@");
    const named = at < 0 ? null : parseRef(entry.slice(0, at));
    if (named && named.registry === ref.registry && named.repository === ref.repository) own.push(entry.slice(at + 1));
  }
  return own.length ? !own.includes(remote) : null;
}

/** The `X-Registry-Auth` header for a registry out of Docker's `config.json`; "" — no sign-in is saved */
export function registryAuth(config: unknown, registry: string): string {
  const auths = isPlainObject(config) && isPlainObject(config.auths) ? config.auths : {};
  const host = (key: string) => key.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const names = registry === "docker.io" ? ["index.docker.io", "docker.io", "registry-1.docker.io"] : [registry];
  for (const [key, entry] of Object.entries(auths)) {
    if (!names.includes(host(key)) || !isPlainObject(entry) || typeof entry.auth !== "string") continue;
    const pair = Buffer.from(entry.auth, "base64").toString("utf8");
    const colon = pair.indexOf(":");
    if (colon < 1) continue;
    const json = JSON.stringify({ username: pair.slice(0, colon), password: pair.slice(colon + 1), serveraddress: key });
    // Docker reads URL-safe base64 and wants its padding
    return Buffer.from(json).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  }
  return "";
}

function dockerConfig(): unknown {
  for (const dir of [process.env.DOCKER_CONFIG, process.env.HOME && join(process.env.HOME, ".docker"), "/root/.docker"]) {
    if (!dir) continue;
    try {
      return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    } catch {}
  }
  return null;
}

// --- State ------------------------------------------------------------------------------------------

const STATE_FILE = join(DATA_DIR, "images.json");
const CHECK_EVERY_MS = 24 * 3600_000;

interface State {
  /** When the registries were last asked */
  at: number;
  /** How many images were asked about */
  asked: number;
  /** `<image id> <image name>` of a container → the digest its tag has in the registry now */
  stale: Record<string, string>;
  /** Image name → why its registry gave no answer */
  failed: Record<string, string>;
}

const state: State = { at: 0, asked: 0, stale: {}, failed: {}, ...readJsonFile<Partial<State>>(STATE_FILE, {}, isPlainObject) };
let running: Promise<void> | null = null;

const keyOf = (c: ContainerSummary): string => `${c.ImageID} ${c.Image}`;

/** The images among these containers that their registry has a newer version of */
export function newerImages(containers: ContainerSummary[]): string[] {
  if (!settings.images.check) return [];
  return [...new Set(containers.filter((c) => keyOf(c) in state.stale).map((c) => c.Image))];
}

export interface ImagesStatus {
  running: boolean;
  at: number | null;
  asked: number;
  newer: number;
  failed: { image: string; message: string }[];
}

export async function imagesStatus(): Promise<ImagesStatus> {
  // counted over the containers there are now: an app updated since the check no longer counts
  const apps = installed();
  const containers = (await listContainers().catch(() => [])).filter((c) => apps.includes(c.Labels[PROJECT_LABEL] ?? ""));
  return {
    running: running !== null,
    at: state.at || null,
    asked: state.asked,
    newer: newerImages(containers).length,
    failed: Object.entries(state.failed).map(([image, message]) => ({ image, message })),
  };
}

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).trim().split("\n")[0]!.slice(0, 300);

async function check(apps: string[]): Promise<void> {
  const containers = (await listContainers()).filter((c) => apps.includes(c.Labels[PROJECT_LABEL] ?? ""));
  const config = dockerConfig();
  const stale: State["stale"] = {};
  const failed: State["failed"] = {};
  const remote = new Map<string, string | Error>();
  /** A registry that said "too many requests" is not asked again in this run */
  const limited = new Map<string, Error>();
  const seen = new Set<string>();
  for (const c of containers) {
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = parseRef(c.Image);
    if (!ref || ref.digest) continue;
    const name = refName(ref);
    if (!remote.has(name)) {
      remote.set(name, limited.get(ref.registry) ?? (await registryDigest(name, registryAuth(config, ref.registry)).catch((e) => (e instanceof Error ? e : new Error(String(e))))));
    }
    const digest = remote.get(name)!;
    if (digest instanceof Error) {
      if (/toomanyrequests|too many requests|rate limit/i.test(digest.message)) limited.set(ref.registry, digest);
      failed[c.Image] = firstLine(digest);
      // what was known about this very image stays known
      if (state.stale[key]) stale[key] = state.stale[key]!;
      continue;
    }
    if (behind(ref, await imageDigests(c.ImageID), digest)) stale[key] = digest;
  }
  Object.assign(state, { at: Date.now(), asked: remote.size, stale, failed });
  writeJsonAtomic(STATE_FILE, state);
}

let installed: () => string[] = () => [];

/** Asks the registries about the images of every app; one run at a time */
export function checkImages(): Promise<void> {
  running ??= check(installed())
    .catch((e) => console.error("Could not look for newer images:", firstLine(e)))
    .finally(() => {
      running = null;
      bus.publish("apps");
    });
  return running;
}

/** Updates, one after another, the running apps that have newer images and are not left out */
async function updateAll(update: (app: string) => Promise<void>): Promise<void> {
  await checkImages();
  const containers = await listContainers().catch(() => []);
  for (const app of installed()) {
    if (settings.images.exclude.includes(app)) continue;
    const own = containers.filter((c) => c.Labels[PROJECT_LABEL] === app);
    if (!own.some((c) => c.State === "running") || !newerImages(own).length) continue;
    await update(app).catch((e) => console.error(`Could not update ${app}:`, firstLine(e)));
  }
}

/**
 * Looks for newer images a few minutes after the start, when not done today, and then daily; updates
 * the apps when the minute set for it comes. `update` runs an app's update and waits for it.
 */
export function startImages(hooks: { apps: () => string[]; update: (app: string) => Promise<void> }): void {
  installed = hooks.apps;
  const due = () => {
    if (settings.images.check && Date.now() - state.at >= CHECK_EVERY_MS) void checkImages();
  };
  setTimeout(due, 4 * 60_000);
  setInterval(due, 3600_000);
  let lastDay = "";
  setInterval(() => {
    if (!settings.images.check || !settings.images.auto) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const day = now.toDateString();
    if (time !== settings.images.time || lastDay === day) return;
    lastDay = day;
    void updateAll(hooks.update);
  }, 20_000);
}
