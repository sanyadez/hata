/**
 * Containers on this server, made with Incus (Settings stay Incus's own: it keeps every container, its
 * limits and snapshots; Hata keeps nothing of them). Hata talks to Incus over its socket, the way it
 * talks to Docker, and installs it only by the "Install" button: `incus-base` (containers only) and
 * `dnsmasq-base` (the addresses on its bridge).
 *
 * What Hata adds: the first setup (a storage pool, the bridge `hatabr0` with NAT, the default profile),
 * the rules that keep the bridge's containers online next to Docker, and a new container made with
 * Docker and Hata's client in it — so that it becomes one of the machines, with its apps, files and
 * terminal. Nothing is offered while Hata itself runs inside a container that maps only part of the
 * user ids: the person's decision is that neither containers nor virtual machines are made there.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { record } from "./activity";
import { AppError, isBusy, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { DATA_DIR, listenAddress, SECRETS_DIR, settings } from "./config";
import { onContainerPlaces } from "./mounting";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { screenSocket, withScreen, trouble, BRIDGE, bridgeRules, configOf, devicesOf, diskChange, LIMITED, FieldError, placeFor, poolName, IMAGE_SERVER, IMAGES, insideNarrowMap, limitsChange, NAME_RE, readInstance, readNew, setupScript, snapshotName, SNAPSHOT_RE, type Container } from "./incus";
import { invite, machines, remove as removeMachine } from "./machines";
import { packageManager, PATH, run, runLogged } from "./packages";

export const SOCKET = "/var/lib/incus/unix.socket";
/** What the button installs: containers only — the virtual machines' packages come later, by a button of their own */
export const PACKAGES = ["incus-base", "dnsmasq-base"];
/**
 * What virtual machines add, by a button of their own: `incus` brings QEMU, the agent and the rest it
 * depends on; the firmware, the disk tool and the display module are only "recommended" by the packages,
 * and without each of them Incus refuses to make a machine.
 */
export const VM_PACKAGES = ["incus", "ovmf", "qemu-utils", "qemu-system-modules-spice"];

const has = (bin: string): boolean => !!Bun.which(bin, { PATH });

/** Incus's answer to a request; an error of Incus is a 409 with its own words */
export async function incus(method: string, path: string, body?: unknown, timeout = 30_000): Promise<any> {
  let r: Response;
  try {
    r = await fetch(`http://incus${path}`, { unix: SOCKET, method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeout) } as RequestInit);
  } catch (e) {
    throw new AppError("containers.noAnswer", 503, { message: e instanceof Error ? e.message : String(e) });
  }
  const answer = (await r.json().catch(() => null)) as any;
  if (!answer || answer.type === "error") throw new AppError("containers.failed", 409, { message: String(answer?.error ?? `HTTP ${r.status}`) });
  return answer;
}

/** Waits for a background operation of Incus to end; its failure is said in Incus's words */
export async function finished(op: any, seconds = 600): Promise<void> {
  if (op.type !== "async") return;
  const done = await incus("GET", `${op.operation}/wait?timeout=${seconds}`, undefined, (seconds + 10) * 1000);
  if (done.metadata?.status_code >= 400) throw new AppError("containers.failed", 409, { message: String(done.metadata.err ?? "") });
}

/** Why Hata may not make containers here: "nested" — it runs in a container with part of the user ids */
function blocked(): string {
  try {
    return insideNarrowMap(readFileSync("/proc/self/uid_map", "utf8")) ? "nested" : "";
  } catch {
    return "";
  }
}

/** Why its programs cannot be put to use here: nested (both), noArch / noKvm (virtual machines); "" — they can */
export function cannotInstall(what: "incus" | "vm"): string {
  const why = blocked();
  if (why || what === "incus") return why;
  return process.arch !== "x64" ? "noArch" : existsSync("/dev/kvm") ? "" : "noKvm";
}

/**
 * Whether virtual machines can be made here: noArch — Hata knows the packages of x86 only; noKvm — the
 * processor gives no virtualisation (switched off in the firmware, or Hata itself is in a virtual
 * machine without nested virtualisation); missing — their packages are not installed; ready.
 */
export type VmState = "noArch" | "noKvm" | "missing" | "ready";

async function vmState(driver: string): Promise<VmState> {
  if (process.arch !== "x64") return "noArch";
  if (!existsSync("/dev/kvm")) return "noKvm";
  return /\bqemu\b/.test(driver) && has("qemu-system-x86_64") ? "ready" : "missing";
}

export interface Place {
  name: string;
  driver: string;
  /** The folder; "" — Incus's own under /var/lib/incus */
  path: string;
  /** Where new ones go */
  standard: boolean;
  /** Incus's default profile keeps its disk there: it cannot be taken away */
  profile: boolean;
  /** Instances that live there */
  instances: number;
  /** Incus cannot reach its folder (the disk it is on is not connected): its room is not known then */
  away: boolean;
  used: number;
  total: number;
}

/** The folders the pools are in, as last seen: a disk holding one is not disconnected or formatted */
let placePaths: string[] = [];

/** What Hata keeps of its own about the containers: the place new ones go to, the ones stopped on purpose */
const OWN_FILE = join(DATA_DIR, "containers.json");
const own: { standard: string; stopped: string[] } = { standard: "", stopped: [], ...readJsonFile(OWN_FILE, {}) };

/** A container stopped through Hata is not a problem while it stays stopped; started again, it is watched again */
function stoppedOnPurpose(name: string, on: boolean): void {
  const was = own.stopped.includes(name);
  if (on === was) return;
  own.stopped = on ? [...own.stopped, name] : own.stopped.filter((n) => n !== name);
  writeJsonAtomic(OWN_FILE, own);
}

/** What was last seen, for the attention list (asked every minute, read without waiting) */
const lastLook: { silentSince: number | null; instances: Container[]; placesAway: { name: string; path: string }[] } = { silentSince: null, instances: [], placesAway: [] };

/** The attention items of the containers: Incus silent, an instance in error, one that should run and does not */
export function containersTrouble() {
  // one a job holds (a backup stops it for a while, a restore replaces it) is not looked at meanwhile
  const instances = lastLook.instances.filter((c) => !isBusy(`incus:${c.name}`));
  return trouble({ installed: has("incus"), silentSince: lastLook.silentSince, instances, stoppedByHand: own.stopped, now: Date.now(), placesAway: lastLook.placesAway });
}

/** Looks at Incus once: whether it answers and in what state the instances are */
async function lookAtIncus(): Promise<void> {
  if (!has("incus") || blocked()) return;
  try {
    const list = await incus("GET", "/1.0/instances?recursion=1", undefined, 15_000);
    lastLook.instances = ((list.metadata ?? []) as any[]).flatMap((raw) => readInstance({ ...raw, state: null, snapshots: [] }) ?? []);
    const pools = ((await incus("GET", "/1.0/storage-pools?recursion=1", undefined, 15_000)).metadata ?? []) as any[];
    lastLook.placesAway = pools.filter((p) => p.status === "Unavailable").map((p) => ({ name: String(p.name), path: String(p.config?.source ?? "") }));
    lastLook.silentSince = null;
  } catch {
    lastLook.silentSince ??= Date.now();
  }
}
onContainerPlaces(() => placePaths);

const INCUS_POOLS = "/var/lib/incus/storage-pools";

/** The place a restored instance goes to: where it lived, while that place is there; else where new ones go */
export async function placeForRestore(was: string): Promise<string> {
  const all = await places();
  return (all.find((p) => p.name === was) ?? all.find((p) => p.standard) ?? all[0])?.name ?? "default";
}

/** Every pool, with the room the file system under it has */
async function places(): Promise<Place[]> {
  const [list, profile] = await Promise.all([incus("GET", "/1.0/storage-pools?recursion=1"), incus("GET", "/1.0/profiles/default")]);
  const inProfile = String(Object.values((profile.metadata?.devices ?? {}) as Record<string, any>).find((d) => d.type === "disk" && d.path === "/")?.pool ?? "");
  const names = ((list.metadata ?? []) as any[]).map((p) => String(p.name));
  const standard = names.includes(own.standard) ? own.standard : inProfile;
  const out: Place[] = [];
  for (const p of (list.metadata ?? []) as any[]) {
    const res = (await incus("GET", `/1.0/storage-pools/${encodeURIComponent(p.name)}/resources`).catch(() => null))?.metadata;
    const source = String(p.config?.source ?? "");
    out.push({
      name: String(p.name),
      driver: String(p.driver),
      path: source.startsWith(INCUS_POOLS) ? "" : source,
      standard: p.name === standard,
      profile: p.name === inProfile,
      instances: ((p.used_by ?? []) as string[]).filter((u) => u.startsWith("/1.0/instances/")).length,
      away: p.status === "Unavailable",
      // an unavailable place's "room" is that of the folder under its mount point: the system's disk
      used: p.status === "Unavailable" ? 0 : Number(res?.space?.used ?? 0),
      total: p.status === "Unavailable" ? 0 : Number(res?.space?.total ?? 0),
    });
  }
  placePaths = out.map((p) => p.path).filter(Boolean);
  return out;
}

const mounts = (): { path: string; fstype: string }[] => {
  try {
    return readFileSync("/proc/mounts", "utf8")
      .split("\n")
      .map((line) => line.split(" "))
      .filter((f) => f[1])
      .map((f) => ({ path: f[1]!.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))), fstype: f[2] ?? "" }));
  } catch {
    return [];
  }
};

/** A folder checked as a new place: the pool's folder and driver, or the error to answer with */
function checkPlace(path: unknown) {
  const place = placeFor(path, { mounts: mounts(), dataRoot: settings.dataRoot, backupDir: settings.backup.dir, state: [DATA_DIR, SECRETS_DIR], pools: placePaths });
  if ("error" in place) throw new AppError(place.error, 400);
  if (existsSync(place.path) && readdirSync(place.path).length) throw new AppError("containers.place.notEmpty", 400, { path: place.path });
  return place;
}

/** Makes a pool in a folder that was checked; the folder is made when it is not there */
async function makePool(place: { path: string; driver: string }, taken: string[], name?: string): Promise<string> {
  // btrfs makes the folder itself, as a subvolume; it refuses one that is there
  if (place.driver === "btrfs") {
    mkdirSync(dirname(place.path), { recursive: true, mode: 0o711 });
    if (existsSync(place.path)) rmdirSync(place.path);
  } else mkdirSync(place.path, { recursive: true, mode: 0o711 });
  const pool = name ?? poolName(place.path, taken);
  await incus("POST", "/1.0/storage-pools", { name: pool, driver: place.driver, config: { source: place.path } });
  return pool;
}

export interface ContainersReport {
  /** missing — Incus is not installed; blocked — may not be here; setup — installed, not set up; ready */
  state: "missing" | "blocked" | "setup" | "ready";
  why: string;
  /** The command the "Install" button runs; "" — this system's package manager is not apt */
  install: string;
  version: string;
  /** The network the containers are on and its address */
  network: { name: string; address: string } | null;
  /** Where Incus keeps them: every pool, the room on it, which one new ones go to */
  places: Place[];
  containers: (Container & { machine: string })[];
  images: { id: string; name: string; client: boolean; container: boolean; vm: boolean; docker: boolean; least: { memory: number; disk: number } | null }[];
  /** Virtual machines: a test feature, installed apart */
  vms: { state: VmState; install: string };
}

const installCommand = (packages = PACKAGES): string => (packageManager() === "apt-get" ? `apt-get install -y --no-install-recommends ${packages.join(" ")}` : "");

/** The network of the default profile's first card: the one new containers go on */
async function networkOf(): Promise<{ name: string; address: string } | null> {
  const profile = (await incus("GET", "/1.0/profiles/default")).metadata;
  const nic = Object.values((profile?.devices ?? {}) as Record<string, any>).find((d) => d.type === "nic" && d.network);
  if (!nic) return null;
  const net = (await incus("GET", `/1.0/networks/${encodeURIComponent(nic.network)}`).catch(() => null))?.metadata;
  return { name: String(nic.network), address: String(net?.config?.["ipv4.address"] ?? "") };
}

/** Whether the default profile gives a new container a disk and a network */
async function setUp(): Promise<boolean> {
  const devices = Object.values(((await incus("GET", "/1.0/profiles/default")).metadata?.devices ?? {}) as Record<string, any>);
  return devices.some((d) => d.type === "disk" && d.path === "/") && devices.some((d) => d.type === "nic");
}

/** The containers as last seen, by their cards and names: which machine is one of them */
let seen: { name: string; mac: string; kind: string }[] = [];

/** What a machine is here, by one of its cards or its host name: "container", "vm"; "" — neither */
/** The instance of this server a machine is, as last looked at, and whether it runs */
export function instanceOfMachine(macs: string[], hostname: string): { name: string; running: boolean } | null {
  const cards = new Set(macs.map((m) => m.toLowerCase()));
  const c = lastLook.instances.find((x) => (x.mac && cards.has(x.mac)) || x.name === hostname);
  return c ? { name: c.name, running: c.status === "running" } : null;
}

export function containerOfMachine(macs: string[], hostname: string): string {
  const cards = new Set(macs.map((m) => m.toLowerCase()));
  return seen.find((c) => (c.mac && cards.has(c.mac)) || c.name === hostname)?.kind ?? "";
}

export async function report(): Promise<ContainersReport> {
  const base = { why: "", install: installCommand(), version: "", network: null, places: [] as Place[], containers: [], images: IMAGES.map((i) => ({ id: i.id, name: i.name, client: i.family !== "", container: i.container, vm: i.vm, docker: i.docker !== false, least: i.least ?? null })), vms: { state: "missing" as VmState, install: installCommand(VM_PACKAGES) } };
  const why = blocked();
  if (why) return { ...base, state: "blocked", why };
  if (!has("incus") || !existsSync(SOCKET)) return { ...base, state: "missing" };
  const server = (await incus("GET", "/1.0")).metadata;
  const version = String(server?.environment?.server_version ?? "");
  const vms = { ...base.vms, state: await vmState(String(server?.environment?.driver ?? "")) };
  if (!(await setUp())) return { ...base, state: "setup", version, vms };
  const [list, network, pools] = await Promise.all([incus("GET", "/1.0/instances?recursion=2"), networkOf(), places().catch(() => [] as Place[])]);
  const known = machines();
  const containers = ((list.metadata ?? []) as any[]).flatMap((raw) => {
    const c = readInstance(raw);
    if (!c) return [];
    // the machine this container is: by its network card, or by its name while it has no address yet
    const machine = known.find((m) => (c.mac && (m.info?.macs ?? []).some((card) => card.mac.toLowerCase() === c.mac)) || m.info?.hostname === c.name);
    return [{ ...c, machine: machine?.id ?? "" }];
  });
  seen = containers.map((c) => ({ name: c.name, mac: c.mac, kind: c.kind }));
  return { ...base, state: "ready", version, vms, network, places: pools, containers: containers.sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * The first setup, as `incus admin init` would do it, but only what is missing: a storage pool of
 * plain folders, a bridge with NAT, and the default profile's disk and card. A setup somebody made by
 * hand stays as it is.
 */
async function setUpIncus(log: (line: string) => void, place?: { path: string; driver: string }): Promise<void> {
  const pools = ((await incus("GET", "/1.0/storage-pools")).metadata ?? []) as string[];
  if (!pools.length) {
    log(place ? `Making the storage pool in ${place.path} (${place.driver})` : "Making the storage pool");
    if (place) await makePool(place, [], "default");
    else await incus("POST", "/1.0/storage-pools", { name: "default", driver: "dir" });
  }
  const pool = pools.length ? String(pools[0]).split("/").pop()! : "default";
  const nets = ((await incus("GET", "/1.0/networks?recursion=1")).metadata ?? []) as any[];
  let net = nets.find((n) => n.managed && n.type === "bridge")?.name as string | undefined;
  if (!net) {
    log(`Making the network ${BRIDGE}`);
    await incus("POST", "/1.0/networks", { name: BRIDGE, type: "bridge", config: { "ipv4.address": "auto", "ipv4.nat": "true", "ipv6.address": "none" } });
    net = BRIDGE;
  }
  const profile = (await incus("GET", "/1.0/profiles/default")).metadata;
  const devices = { ...(profile.devices ?? {}) };
  const values = Object.values(devices) as any[];
  if (!values.some((d) => d.type === "disk" && d.path === "/")) devices.root = { type: "disk", path: "/", pool };
  if (!values.some((d) => d.type === "nic")) devices.eth0 = { type: "nic", name: "eth0", network: net };
  await incus("PUT", "/1.0/profiles/default", { config: profile.config ?? {}, description: profile.description ?? "", devices });
  await openBridges();
}

/** Installs Incus (a job of kind `incus`) and sets it up */
export function install(by: string, where?: unknown): Job {
  if (blocked()) throw new AppError("containers.nested", 409);
  if (packageManager() !== "apt-get") throw new AppError("containers.noInstaller", 409);
  // the folder is checked before anything is installed; "" — Incus's own under /var/lib/incus. Places
  // remembered from an Incus taken away by hand are gone with it
  if (!has("incus")) placePaths = [];
  const place = typeof where === "string" && where.trim() ? checkPlace(where) : undefined;
  return startJob("incus", "incus", by, async (log) => {
    if (!has("incus")) {
      const env = { DEBIAN_FRONTEND: "noninteractive" };
      let done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...PACKAGES], log, 10 * 60_000, env);
      if (done.code !== 0) {
        await runLogged(["apt-get", "update"], log, 5 * 60_000, env);
        done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...PACKAGES], log, 10 * 60_000, env);
      }
      if (done.code !== 0) throw new AppError("containers.installFailed", 409, { message: (done.err || done.out).trim().split("\n").slice(-3).join("\n") });
    }
    // the socket is made by its own unit, started with the package
    for (let i = 0; i < 30 && !existsSync(SOCKET); i++) {
      if (i === 0) await run(["systemctl", "enable", "--now", "incus.socket"], 30_000);
      await Bun.sleep(1000);
    }
    await setUpIncus(log, place);
    record("containers.installed", { user: by });
    bus.publish("containers");
  }, true);
}

/**
 * Installs what virtual machines need (a quiet job of kind `incus`), then restarts Incus: it looks for
 * QEMU only when it starts.
 */
export async function installVms(by: string): Promise<Job> {
  const r = await ready();
  if (r.vms.state === "noArch" || r.vms.state === "noKvm") throw new AppError("containers.vm." + r.vms.state, 409);
  if (packageManager() !== "apt-get") throw new AppError("containers.noInstaller", 409);
  return startJob("incus-vm", "incus", by, async (log) => {
    const env = { DEBIAN_FRONTEND: "noninteractive" };
    const done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...VM_PACKAGES], log, 20 * 60_000, env);
    if (done.code !== 0) throw new AppError("containers.installFailed", 409, { message: (done.err || done.out).trim().split("\n").slice(-3).join("\n") });
    log("Restarting Incus");
    await run(["systemctl", "restart", "incus"], 60_000);
    for (let i = 0; i < 30; i++) {
      const driver = String((await incus("GET", "/1.0").catch(() => null))?.metadata?.environment?.driver ?? "");
      if (/\bqemu\b/.test(driver)) {
        record("containers.vmsInstalled", { user: by });
        bus.publish("containers");
        return;
      }
      await Bun.sleep(1000);
    }
    throw new AppError("containers.vm.notReady", 409);
  }, true);
}

/** Sets up an Incus that was installed by hand and never set up */
export async function setUpNow(by: string): Promise<void> {
  if (blocked()) throw new AppError("containers.nested", 409);
  await setUpIncus(() => {});
  record("containers.setUp", { user: by });
  bus.publish("containers");
}

/**
 * Keeps every bridge of Incus's online next to Docker: two rules of `DOCKER-USER`, put back when Docker
 * re-made the chain. Runs after the setup and every minute.
 */
export async function openBridges(): Promise<void> {
  if (!has("iptables") || !existsSync(SOCKET)) return;
  if ((await run(["iptables", "-w", "-S", "DOCKER-USER"], 10_000)).code !== 0) return;
  const nets = ((await incus("GET", "/1.0/networks?recursion=1").catch(() => null))?.metadata ?? []) as any[];
  for (const net of nets.filter((n) => n.managed && n.type === "bridge")) {
    for (const rule of bridgeRules(net.name)) {
      if ((await run(["iptables", "-w", "-C", "DOCKER-USER", ...rule], 10_000)).code !== 0) await run(["iptables", "-w", "-I", "DOCKER-USER", "1", ...rule], 10_000);
    }
  }
}

export const findContainer = async (name: string): Promise<Container> => {
  if (!NAME_RE.test(name)) throw new AppError("containers.notFound", 404, { name });
  const raw = await incus("GET", `/1.0/instances/${name}?recursion=1`).catch(() => null);
  const c = raw && readInstance({ ...raw.metadata, snapshots: [] });
  if (!c) throw new AppError("containers.notFound", 404, { name });
  return c;
};

const ready = async (): Promise<ContainersReport> => {
  const r = await report();
  if (r.state === "blocked") throw new AppError("containers.nested", 409);
  if (r.state !== "ready") throw new AppError("containers.notReady", 409);
  return r;
};

/**
 * A new container (a job of kind `container`): made from the image and started, then — when asked —
 * Docker and Hata's client put in through `incus exec`, and the machine awaited. The client reaches
 * Hata at the bridge's own address, which is this server.
 */
export async function create(input: Record<string, unknown>, by: string): Promise<{ job: string; name: string }> {
  const r = await ready();
  let c;
  try {
    c = readNew(input, r.containers.map((x) => x.name));
  } catch (e) {
    throw new AppError("containers.badField", 400, { field: e instanceof FieldError ? e.field : "" });
  }
  if (c.kind === "vm" && r.vms.state !== "ready") throw new AppError("containers.vm." + (r.vms.state === "missing" ? "notInstalled" : r.vms.state), 409);
  const vm = c.kind === "vm";
  const chosen = typeof input.place === "string" && input.place ? r.places.find((p) => p.name === input.place) : r.places.find((p) => p.standard);
  if (!chosen) throw new AppError("containers.badField", 400, { field: "place" });
  const pool = chosen.name;
  // a plain folder cannot hold a container's disk to a size: Incus would take the limit and keep none
  if (c.kind === "container" && c.disk && !LIMITED.includes(chosen.driver)) throw new AppError("containers.disk.notHere", 400, { name: pool });
  const job = startJob(`incus:${c.name}`, "container", by, async (log) => told(log, async () => {
    log(`Making ${c.name} from ${c.image.name} (the image is downloaded once)`);
    const op = await incus("POST", "/1.0/instances", { name: c.name, type: vm ? "virtual-machine" : "container", start: true, source: { type: "image", protocol: "simplestreams", server: IMAGE_SERVER, alias: c.image.alias }, config: { ...configOf(c), ...(vm ? { "raw.qemu": withScreen("", c.name) } : {}) }, devices: devicesOf(c, pool) });
    await finished(op, 1800);
    bus.publish("containers");
    // a virtual machine boots its own kernel first: its address and its agent come later (a desktop takes ~3 min)
    let address = "";
    for (let i = 0; i < (vm ? 360 : 60) && !address; i++) {
      address = (await findContainer(c.name)).address;
      if (!address) await Bun.sleep(1000);
    }
    log(address ? `Started, address ${address}` : "Started, no address yet");
    record(vm ? "containers.vmCreated" : "containers.created", { user: by, detail: c.name });
    if (!c.client && !c.docker) return;
    if (vm) {
      log("Waiting for the machine's agent");
      let agent = false;
      for (let i = 0; i < 60 && !agent; i++) {
        agent = (await run(["incus", "exec", c.name, "--", "true"], 15_000)).code === 0;
        if (!agent) await Bun.sleep(3000);
      }
      if (!agent) throw new AppError("containers.vm.noAgent", 409, { name: c.name });
    }
    const gateway = r.network?.address.split("/")[0] ?? "";
    if (c.client && !gateway) throw new AppError("containers.noNetwork", 409);
    const before = new Set(machines().map((m) => m.id));
    const line = c.client ? `curl -fsSL http://${gateway}:${listenAddress().port}/client/${(await invite(by)).code} | sh` : "";
    log(c.docker ? "Putting Docker and Hata's client in" : "Putting Hata's client in");
    const ran = await runLogged(["incus", "exec", c.name, "--", "sh", "-c", setupScript({ ...c, family: c.image.family, dockerFrom: c.image.docker }, line)], log, 30 * 60_000);
    if (ran.code !== 0) throw new AppError("containers.setupFailed", 409, { name: c.name });
    if (!c.client) return;
    log("Waiting for the machine to connect");
    for (let i = 0; i < 60; i++) {
      const fresh = machines().find((m) => !before.has(m.id) && m.info?.hostname === c.name);
      if (fresh) {
        log(`Connected: ${fresh.name}`);
        job.result = { machine: fresh.id };
        return;
      }
      await Bun.sleep(2000);
    }
    throw new AppError("containers.notConnected", 409, { name: c.name });
  }), true, { app: c.name, machine: "" });
  return { job: job.id, name: c.name };
}

/** Runs a job's work, putting Incus's own words into its log when it fails: the job keeps only the code */
async function told(log: (line: string) => void, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (e) {
    if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
    throw e;
  }
}

/** Start, stop or restart; a container that does not stop in 30 s is stopped hard */
export async function act(name: string, action: unknown, by: string): Promise<void> {
  if (action !== "start" && action !== "stop" && action !== "restart") throw new AppError("containers.badAction", 400);
  await ready();
  await findContainer(name);
  try {
    await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action, timeout: 30 }), 60);
  } catch (e) {
    if (action === "start") throw e;
    await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action, timeout: 30, force: true }), 60);
  }
  stoppedOnPurpose(name, action === "stop");
  await lookAtIncus();
  record(`containers.${action}`, { user: by, detail: name });
  bus.publish("containers");
}

/** Deletes a container and its snapshots; the machine it was goes from the list too */
export async function removeContainer(name: string, by: string): Promise<void> {
  await ready();
  const c = await findContainer(name);
  if (c.status === "running") await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", force: true, timeout: 30 }), 60);
  await finished(await incus("DELETE", `/1.0/instances/${name}`), 300);
  const machine = machines().find((m) => (c.mac && (m.info?.macs ?? []).some((card) => card.mac.toLowerCase() === c.mac)) || m.info?.hostname === c.name);
  if (machine) await removeMachine(machine.id, by).catch(() => {});
  stoppedOnPurpose(name, false);
  await lookAtIncus();
  record("containers.removed", { user: by, detail: name });
  bus.publish("containers");
  bus.publish("machines");
}

/** Changes the limits, the start with the server and nesting; Incus applies them to a running container at once */
export async function setLimits(name: string, input: Record<string, unknown>, by: string): Promise<void> {
  const r = await ready();
  const c = await findContainer(name);
  const raw = (await incus("GET", `/1.0/instances/${name}`)).metadata;
  let change;
  let size;
  try {
    change = limitsChange(input, raw.config ?? {});
    size = diskChange(input.disk, c.disk, c.kind);
  } catch (e) {
    throw new AppError("containers.badField", 400, { field: e instanceof FieldError ? e.field : "" });
  }
  if (!Object.keys(change).length && size === undefined) return;
  const config = { ...raw.config };
  for (const [key, value] of Object.entries(change)) {
    if (value) config[key] = value;
    else delete config[key];
  }
  const devices = { ...(raw.devices ?? {}) };
  if (size !== undefined) {
    const place = r.places.find((p) => p.name === c.place);
    if (c.kind === "container" && size && !LIMITED.includes(place?.driver ?? "")) throw new AppError("containers.disk.notHere", 400, { name: c.place });
    // the disk of an older one comes from the profile: it gets one of its own, the same but for the size
    const root = { ...(raw.expanded_devices?.root ?? { type: "disk", path: "/", pool: c.place }), ...(devices.root ?? {}) };
    if (size) root.size = size;
    else delete root.size;
    devices.root = root;
  }
  await finished(await incus("PUT", `/1.0/instances/${name}`, { ...raw, config, devices }), 120);
  record("containers.changed", { user: by, detail: name });
  bus.publish("containers");
}

export async function takeSnapshot(name: string, input: unknown, by: string): Promise<string> {
  await ready();
  await findContainer(name);
  let snap;
  try {
    snap = snapshotName(input);
  } catch {
    throw new AppError("containers.badField", 400, { field: "snapshot" });
  }
  await finished(await incus("POST", `/1.0/instances/${name}/snapshots`, { name: snap }), 1800);
  record("containers.snapshot.taken", { user: by, detail: `${name} · ${snap}` });
  bus.publish("containers");
  return snap;
}

/** Puts a container back to a snapshot: what changed after it is lost; a running container is stopped for it */
export async function restoreSnapshot(name: string, snap: string, by: string): Promise<void> {
  await ready();
  if (!SNAPSHOT_RE.test(snap)) throw new AppError("containers.notFound", 404, { name: snap });
  const c = await findContainer(name);
  const raw = (await incus("GET", `/1.0/instances/${name}`)).metadata;
  if (c.status === "running") await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 30, force: true }), 60);
  await finished(await incus("PUT", `/1.0/instances/${name}`, { ...raw, restore: snap }), 1800);
  if (c.status === "running") await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "start" }), 60);
  record("containers.snapshot.restored", { user: by, detail: `${name} · ${snap}` });
  bus.publish("containers");
}

export async function removeSnapshot(name: string, snap: string, by: string): Promise<void> {
  await ready();
  if (!SNAPSHOT_RE.test(snap)) throw new AppError("containers.notFound", 404, { name: snap });
  await findContainer(name);
  await finished(await incus("DELETE", `/1.0/instances/${name}/snapshots/${encodeURIComponent(snap)}`), 600);
  record("containers.snapshot.removed", { user: by, detail: `${name} · ${snap}` });
  bus.publish("containers");
}

/** Whether the terminal may open a shell in a container: it is there and running */
export async function shellReady(name: string): Promise<"ok" | "notFound" | "notRunning"> {
  if (!NAME_RE.test(name) || !has("incus")) return "notFound";
  const c = await findContainer(name).catch(() => null);
  return !c ? "notFound" : c.status === "running" ? "ok" : "notRunning";
}

/** The shell of a container for the terminal: bash where it has one, sh otherwise */
export const shellCommand = (name: string): string[] => ["incus", "exec", name, "--env", "TERM=xterm-256color", "--", "sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"];

/** Whether something of Hata's stands on Incus: instances are there (only virtual machines, when asked) */
export async function inUse(kind?: "vm"): Promise<boolean> {
  if (!existsSync(SOCKET)) return false;
  const list = await incus("GET", `/1.0/instances${kind ? "?filter=" + encodeURIComponent("type eq virtual-machine") : ""}`).catch(() => null);
  return ((list?.metadata ?? []) as string[]).length > 0;
}

export function startContainers(): void {
  const tick = () => {
    void openBridges().catch(() => {});
    void lookAtIncus();
    if (existsSync(SOCKET)) void report().catch(() => {});
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000);
}

// --- Places -------------------------------------------------------------------------------------------

/** Another place for containers: a pool in a folder of the person's choosing */
export async function addPlace(path: unknown, by: string): Promise<Place[]> {
  await ready();
  const place = checkPlace(path);
  const taken = (await places()).map((p) => p.name);
  const name = await makePool(place, taken);
  record("containers.place.added", { user: by, detail: `${name} · ${place.path}` });
  bus.publish("containers");
  return places();
}

/** The place new containers go to unless another is chosen: the default profile's disk */
export async function setStandardPlace(name: string, by: string): Promise<Place[]> {
  await ready();
  if (!(await places()).some((p) => p.name === name)) throw new AppError("containers.place.notFound", 404, { name });
  // Hata's own word, not the default profile's disk: Incus refuses to move that while containers lean on it
  own.standard = name;
  writeJsonAtomic(OWN_FILE, own);
  record("containers.place.standard", { user: by, detail: name });
  bus.publish("containers");
  return places();
}

/** Takes an empty place away; its folder stays */
export async function removePlace(name: string, by: string): Promise<Place[]> {
  await ready();
  const place = (await places()).find((p) => p.name === name);
  if (!place) throw new AppError("containers.place.notFound", 404, { name });
  if (place.standard) throw new AppError("containers.place.isStandard", 409, { name });
  if (place.profile) throw new AppError("containers.place.profile", 409, { name });
  if (place.instances) throw new AppError("containers.place.inUse", 409, { name, n: place.instances });
  await incus("DELETE", `/1.0/storage-pools/${encodeURIComponent(name)}`);
  record("containers.place.removed", { user: by, detail: name });
  bus.publish("containers");
  return places();
}

/**
 * Moves a container or virtual machine to another place (a job of kind `container`): Incus copies it
 * while it is stopped; one that ran is started again. Its snapshots go with it.
 */
export async function moveInstance(name: string, to: unknown, by: string): Promise<{ job: string }> {
  const r = await ready();
  const c = await findContainer(name);
  const target = r.places.find((p) => p.name === to);
  if (!target) throw new AppError("containers.place.notFound", 404, { name: String(to) });
  const raw = (await incus("GET", `/1.0/instances/${name}`)).metadata;
  const from = String(raw.expanded_devices?.root?.pool ?? "");
  if (from === target.name) throw new AppError("containers.place.same", 400, { name: target.name });
  const job = startJob(`incus:${name}`, "container", by, async (log) => {
    const running = c.status === "running";
    if (running) {
      log(`Stopping ${name}`);
      await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 60 }), 90).catch(async () => finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 30, force: true }), 60));
    }
    try {
      log(`Moving ${name} from ${from} to ${target.name}`);
      // Incus's API moves between pools only as a copy and a rename the client makes; its own program does that
      const done = await runLogged(["incus", "move", name, "--storage", target.name], log, 6 * 3600_000, {}, (line) => (/^\s*Transferring instance:/.test(line) ? null : line));
      if (done.code !== 0) throw new AppError("containers.failed", 409, { message: (done.err || done.out).trim().split("\n").pop() ?? "" });
      record("containers.moved", { user: by, detail: `${name} → ${target.name}` });
    } catch (e) {
      if (e instanceof AppError && e.detail.message) log(String(e.detail.message));
      throw e;
    } finally {
      if (running) {
        log(`Starting ${name}`);
        await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "start" }), 120).catch((e) => log(String(e instanceof Error ? e.message : e)));
      }
      bus.publish("containers");
    }
  }, true, { app: name, machine: "" });
  return { job: job.id };
}

// --- A virtual machine's screen ------------------------------------------------------------------------------

/** Screens the page asked for, opened by its socket within a minute; once */
const screens = new Map<string, { name: string; at: number }>();

/**
 * A virtual machine's screen: a key for the page's socket. One made before Hata asked QEMU for a VNC screen has
 * none until it is turned on and the machine restarted (`screenOff`); `screenAway` — asked for, but not there.
 */
export async function askScreen(name: string): Promise<{ screen: string; name: string }> {
  await ready();
  const c = await findContainer(name);
  if (c.kind !== "vm") throw new AppError("containers.noScreen", 409, { name });
  if (c.status !== "running") throw new AppError("containers.notRunning", 409, { name });
  // by the config, not the file: a socket of an earlier start stays in the folder after QEMU is gone
  const raw = String((await incus("GET", `/1.0/instances/${name}`)).metadata?.config?.["raw.qemu"] ?? "");
  if (withScreen(raw, name) !== raw) throw new AppError("containers.screenOff", 409, { name });
  if (!existsSync(screenSocket(name))) throw new AppError("containers.screenAway", 409, { name });
  for (const [k, v] of screens) if (Date.now() - v.at > 60_000) screens.delete(k);
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  screens.set(key, { name, at: Date.now() });
  return { screen: key, name };
}

/**
 * Asks QEMU for the screen of an older virtual machine. Incus changes `raw.qemu` of a stopped one only, so a
 * running machine is stopped (cleanly, by force after 30 s), changed and started again.
 */
export async function screenOn(name: string, by: string): Promise<void> {
  await ready();
  const c = await findContainer(name);
  if (c.kind !== "vm") throw new AppError("containers.noScreen", 409, { name });
  const raw = String((await incus("GET", `/1.0/instances/${name}`)).metadata?.config?.["raw.qemu"] ?? "");
  const running = c.status === "running";
  if (running) {
    try {
      await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 30 }), 60);
    } catch {
      await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "stop", timeout: 30, force: true }), 60);
    }
  }
  try {
    await finished(await incus("PATCH", `/1.0/instances/${name}`, { config: { "raw.qemu": withScreen(raw, name) } }), 60);
  } finally {
    if (running) await finished(await incus("PUT", `/1.0/instances/${name}/state`, { action: "start" }), 120);
  }
  record("containers.screenOn", { user: by, detail: name });
  bus.publish("containers");
}

/** What the page's socket is joined to: QEMU's VNC socket, byte for byte */
export interface ScreenSocket {
  send(bytes: Uint8Array): void;
  close(): void;
  onData: (bytes: Uint8Array) => void;
  onClose: (why: string) => void;
}

export async function openScreen(key: string): Promise<{ socket: ScreenSocket; name: string }> {
  const s = screens.get(key);
  screens.delete(key);
  if (!s || Date.now() - s.at > 60_000) throw new AppError("containers.screenGone", 410);
  const out: ScreenSocket = { send: () => {}, close: () => {}, onData: () => {}, onClose: () => {} };
  const sock = await Bun.connect({
    unix: screenSocket(s.name),
    socket: {
      data: (_, bytes) => out.onData(new Uint8Array(bytes)),
      close: () => out.onClose("closed"),
      error: () => out.onClose("error"),
    },
  });
  out.send = (bytes) => void sock.write(bytes);
  out.close = () => sock.end();
  return { socket: out, name: s.name };
}

/** Whether a key is one of these screens (the page's socket asks before Proxmox's) */
export const isContainerScreen = (key: string): boolean => screens.has(key);

// --- Taking Incus away ---------------------------------------------------------------------------------------

/**
 * What Hata set up for Incus, taken away before its packages are removed (System programs → Remove): the
 * images kept, the default profile's disk and card, the networks with their rules in DOCKER-USER, every
 * place (Incus empties the folders it made). Only when no container or virtual machine is left — the
 * removal is refused before that. Incus's own folders go after the packages (`afterIncusRemoved`).
 */
export async function letIncusGo(): Promise<void> {
  if (!existsSync(SOCKET)) return;
  const list = ((await incus("GET", "/1.0/instances")).metadata ?? []) as string[];
  if (list.length) throw new AppError("tools.holds.containers", 409);
  for (const path of ((await incus("GET", "/1.0/images")).metadata ?? []) as string[]) await incus("DELETE", path).then((op) => finished(op, 120)).catch(() => {});
  const profile = (await incus("GET", "/1.0/profiles/default")).metadata;
  await incus("PUT", "/1.0/profiles/default", { config: profile.config ?? {}, description: profile.description ?? "", devices: {} });
  const nets = ((await incus("GET", "/1.0/networks?recursion=1")).metadata ?? []) as any[];
  for (const net of nets.filter((n) => n.managed)) {
    await incus("DELETE", `/1.0/networks/${net.name}`).catch(() => {});
    if (net.type !== "bridge" || !has("iptables")) continue;
    for (const rule of bridgeRules(net.name)) while ((await run(["iptables", "-w", "-D", "DOCKER-USER", ...rule], 10_000)).code === 0);
  }
  for (const pool of ((await incus("GET", "/1.0/storage-pools?recursion=1")).metadata ?? []) as any[]) {
    // what Incus left in a pool (its own volumes of images) goes with it
    const name = String(pool.name);
    for (const vol of ((await incus("GET", `/1.0/storage-pools/${name}/volumes`).catch(() => null))?.metadata ?? []) as string[]) {
      if (/\/volumes\/(image|custom)\//.test(vol)) await incus("DELETE", vol).catch(() => {});
    }
    await incus("DELETE", `/1.0/storage-pools/${name}`).catch(() => {});
    // a place in a folder of the person's: the folder Hata made for it goes once Incus has emptied it
    const source = String(pool.config?.source ?? "");
    if (source && !source.startsWith(INCUS_POOLS)) {
      try {
        rmdirSync(source);
      } catch {}
    }
  }
  own.standard = "";
  own.stopped = [];
  writeJsonAtomic(OWN_FILE, own);
  // the places are gone: a disk may be let go of, and a new install may use the same folder
  placePaths = [];
  lastLook.instances = [];
  lastLook.silentSince = null;
  // the daemon keeps running when its package goes, its folders mounted
  await run(["systemctl", "stop", "incus.service", "incus.socket", "incus-user.service", "incus-user.socket", "incus-startup.service"], 120_000);
}

/** Incus's own folders, once its packages are gone: a later install starts afresh */
export async function afterIncusRemoved(): Promise<void> {
  // what it left mounted inside them (shmounts, guestapi), deepest first
  const mounts = readFileSync("/proc/mounts", "utf8").split("\n").map((l) => (l.split(" ")[1] ?? "").replace(/\\040/g, " ")).filter((m) => m.startsWith("/var/lib/incus/") || m === "/var/lib/incus");
  for (const m of mounts.sort((a, b) => b.length - a.length)) await run(["umount", "-l", m], 30_000);
  for (const dir of ["/var/lib/incus", "/var/log/incus", "/var/cache/incus"]) rmSync(dir, { recursive: true, force: true });
}
