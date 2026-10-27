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
import { existsSync, readFileSync } from "node:fs";
import { record } from "./activity";
import { AppError, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { listenAddress } from "./config";
import { BRIDGE, bridgeRules, configOf, FieldError, IMAGE_SERVER, IMAGES, insideNarrowMap, limitsChange, NAME_RE, readInstance, readNew, setupScript, snapshotName, SNAPSHOT_RE, type Container } from "./incus";
import { invite, machines, remove as removeMachine } from "./machines";
import { packageManager, PATH, run, runLogged } from "./packages";

const SOCKET = "/var/lib/incus/unix.socket";
/** What the button installs: containers only — the virtual machines' packages come later, by a button of their own */
export const PACKAGES = ["incus-base", "dnsmasq-base"];

const has = (bin: string): boolean => !!Bun.which(bin, { PATH });

/** Incus's answer to a request; an error of Incus is a 409 with its own words */
async function incus(method: string, path: string, body?: unknown, timeout = 30_000): Promise<any> {
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
async function finished(op: any, seconds = 600): Promise<void> {
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

export interface ContainersReport {
  /** missing — Incus is not installed; blocked — may not be here; setup — installed, not set up; ready */
  state: "missing" | "blocked" | "setup" | "ready";
  why: string;
  /** The command the "Install" button runs; "" — this system's package manager is not apt */
  install: string;
  version: string;
  /** The network the containers are on and its address */
  network: { name: string; address: string } | null;
  /** Where Incus keeps them, and how much room is there */
  storage: { driver: string; path: string } | null;
  containers: (Container & { machine: string })[];
  images: { id: string; name: string; client: boolean }[];
}

const installCommand = (): string => (packageManager() === "apt-get" ? `apt-get install -y --no-install-recommends ${PACKAGES.join(" ")}` : "");

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
let seen: { name: string; mac: string }[] = [];

/** The container a machine is, by one of its cards or its host name; "" — none */
export function containerOfMachine(macs: string[], hostname: string): string {
  const cards = new Set(macs.map((m) => m.toLowerCase()));
  return seen.find((c) => (c.mac && cards.has(c.mac)) || c.name === hostname)?.name ?? "";
}

export async function report(): Promise<ContainersReport> {
  const base = { why: "", install: installCommand(), version: "", network: null, storage: null, containers: [], images: IMAGES.map((i) => ({ id: i.id, name: i.name, client: i.family !== "" })) };
  const why = blocked();
  if (why) return { ...base, state: "blocked", why };
  if (!has("incus") || !existsSync(SOCKET)) return { ...base, state: "missing" };
  const server = (await incus("GET", "/1.0")).metadata;
  const version = String(server?.environment?.server_version ?? "");
  if (!(await setUp())) return { ...base, state: "setup", version };
  const [list, network, pool] = await Promise.all([incus("GET", "/1.0/instances?recursion=2"), networkOf(), incus("GET", "/1.0/storage-pools/default").catch(() => null)]);
  const known = machines();
  const containers = ((list.metadata ?? []) as any[]).flatMap((raw) => {
    const c = readInstance(raw);
    if (!c) return [];
    // the machine this container is: by its network card, or by its name while it has no address yet
    const machine = known.find((m) => (c.mac && (m.info?.macs ?? []).some((card) => card.mac.toLowerCase() === c.mac)) || m.info?.hostname === c.name);
    return [{ ...c, machine: machine?.id ?? "" }];
  });
  seen = containers.map((c) => ({ name: c.name, mac: c.mac }));
  return { ...base, state: "ready", version, network, storage: pool ? { driver: String(pool.metadata.driver), path: String(pool.metadata.config?.source ?? "") } : null, containers: containers.sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * The first setup, as `incus admin init` would do it, but only what is missing: a storage pool of
 * plain folders, a bridge with NAT, and the default profile's disk and card. A setup somebody made by
 * hand stays as it is.
 */
async function setUpIncus(log: (line: string) => void): Promise<void> {
  const pools = ((await incus("GET", "/1.0/storage-pools")).metadata ?? []) as string[];
  if (!pools.length) {
    log("Making the storage pool");
    await incus("POST", "/1.0/storage-pools", { name: "default", driver: "dir" });
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
export function install(by: string): Job {
  if (blocked()) throw new AppError("containers.nested", 409);
  if (packageManager() !== "apt-get") throw new AppError("containers.noInstaller", 409);
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
    await setUpIncus(log);
    record("containers.installed", { user: by });
    bus.publish("containers");
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

const findContainer = async (name: string): Promise<Container> => {
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
  const job = startJob(`incus:${c.name}`, "container", by, async (log) => {
    log(`Making ${c.name} from ${c.image.name} (the image is downloaded once)`);
    const op = await incus("POST", "/1.0/instances", { name: c.name, type: "container", start: true, source: { type: "image", protocol: "simplestreams", server: IMAGE_SERVER, alias: c.image.alias }, config: configOf(c) });
    await finished(op, 1800);
    bus.publish("containers");
    let address = "";
    for (let i = 0; i < 60 && !address; i++) {
      address = (await findContainer(c.name)).address;
      if (!address) await Bun.sleep(1000);
    }
    log(address ? `Started, address ${address}` : "Started, no address yet");
    record("containers.created", { user: by, detail: c.name });
    if (!c.client && !c.docker) return;
    const gateway = r.network?.address.split("/")[0] ?? "";
    if (c.client && !gateway) throw new AppError("containers.noNetwork", 409);
    const before = new Set(machines().map((m) => m.id));
    const line = c.client ? `curl -fsSL http://${gateway}:${listenAddress().port}/client/${(await invite(by)).code} | sh` : "";
    log(c.docker ? "Putting Docker and Hata's client in" : "Putting Hata's client in");
    const ran = await runLogged(["incus", "exec", c.name, "--", "sh", "-c", setupScript(c, line)], log, 30 * 60_000);
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
  }, true, { app: c.name, machine: "" });
  return { job: job.id, name: c.name };
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
  record("containers.removed", { user: by, detail: name });
  bus.publish("containers");
  bus.publish("machines");
}

/** Changes the limits, the start with the server and nesting; Incus applies them to a running container at once */
export async function setLimits(name: string, input: Record<string, unknown>, by: string): Promise<void> {
  await ready();
  await findContainer(name);
  const raw = (await incus("GET", `/1.0/instances/${name}`)).metadata;
  let change;
  try {
    change = limitsChange(input, raw.config ?? {});
  } catch (e) {
    throw new AppError("containers.badField", 400, { field: e instanceof FieldError ? e.field : "" });
  }
  if (!Object.keys(change).length) return;
  const config = { ...raw.config };
  for (const [key, value] of Object.entries(change)) {
    if (value) config[key] = value;
    else delete config[key];
  }
  await finished(await incus("PUT", `/1.0/instances/${name}`, { ...raw, config }), 60);
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

/** Whether something of Hata's stands on Incus: containers are there */
export async function inUse(): Promise<boolean> {
  if (!existsSync(SOCKET)) return false;
  const list = await incus("GET", "/1.0/instances").catch(() => null);
  return ((list?.metadata ?? []) as string[]).length > 0;
}

export function startContainers(): void {
  const tick = () => {
    void openBridges().catch(() => {});
    if (existsSync(SOCKET)) void report().catch(() => {});
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000);
}
