/**
 * Ports passed on (`forward.ts` is the pure part): a container of this server gets proxy devices of Incus's
 * own, kept by Incus; every other target is relayed here — TCP by `node:net`, UDP by `node:dgram` with one
 * socket towards the target per sender. The target's address is looked up for every connection, as for a
 * name under the domain, so a guest that got another address from the router is still found.
 */
import { createServer, connect, type Server as NetServer } from "node:net";
import { createSocket, type Socket } from "node:dgram";
import { record } from "./activity";
import { AppError } from "./apps";
import { anyAddress, listenAddress, saveSettings, settings } from "./config";
import { finished, incus, instancesSeen, SOCKET } from "./containers";
import { upstream } from "./domains";
import { deviceName, isOurDevice, ownPorts, protocolsOf, proxyDevice, readForward, clash, type Forward } from "./forward";
import { NameError } from "./names";
import { existsSync } from "node:fs";

const HTTPS_PORT = Number(process.env.HATA_HTTPS_PORT ?? 443);
/** A UDP sender not heard for this long is forgotten, and its socket towards the target closed */
const UDP_IDLE_MS = 120_000;

interface Running {
  stop: () => void;
}

/** What runs for each forward, by `<port>/<protocol>`; a failure to start is kept to be shown */
const running = new Map<string, Running>();
const failures = new Map<string, string>();
const keyOf = (port: number, proto: string) => `${port}/${proto}`;

/** Whether a forward goes to a container of this server: Incus carries it then */
async function isContainer(f: Forward): Promise<boolean> {
  if (f.target.kind !== "container" || !existsSync(SOCKET)) return false;
  const name = f.target.name;
  const seen = instancesSeen().find((c) => c.name === name);
  if (seen) return seen.kind === "container";
  const raw = await incus("GET", `/1.0/instances/${name}`, undefined, 5_000).catch(() => null);
  return raw?.metadata?.type === "container";
}

/** Puts the proxy devices of a forward into its container, or takes them away (`on` false) */
async function containerDevices(f: Forward, on: boolean): Promise<void> {
  if (f.target.kind !== "container") return;
  const raw = (await incus("GET", `/1.0/instances/${f.target.name}`)).metadata;
  const devices = { ...(raw.devices ?? {}) } as Record<string, Record<string, string>>;
  for (const proto of protocolsOf(f.proto)) {
    if (on) devices[deviceName(f.port, proto)] = proxyDevice(f, proto);
    else delete devices[deviceName(f.port, proto)];
  }
  await finished(await incus("PUT", `/1.0/instances/${f.target.name}`, { architecture: raw.architecture, config: raw.config, devices, ephemeral: raw.ephemeral, profiles: raw.profiles, stateful: raw.stateful, description: raw.description }), 60);
}

/** A TCP relay: every connection goes on to where the target is now */
function relayTcp(f: Forward): Promise<Running> {
  const server: NetServer = createServer((client) => {
    client.pause();
    void upstream({ label: "", target: f.target, port: f.to, https: false, protect: false, allowed: "all" }).then((to) => {
      if ("away" in to) return void client.destroy();
      const far = connect({ host: to.host, port: to.port });
      far.on("connect", () => client.resume());
      client.pipe(far);
      far.pipe(client);
      far.on("error", () => client.destroy());
      client.on("error", () => far.destroy());
      far.on("close", () => client.destroy());
      client.on("close", () => far.destroy());
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: f.port, host: anyAddress(), ipv6Only: false }, () => {
      server.off("error", reject);
      resolve({ stop: () => server.close() });
    });
  });
}

/** A UDP relay: a socket towards the target for each sender, closed once it is silent */
function relayUdp(f: Forward): Promise<Running> {
  const server = createSocket({ type: "udp6", ipv6Only: false });
  const peers = new Map<string, { socket: Socket; at: number }>();
  server.on("message", (message, from) => {
    const key = `${from.address}|${from.port}`;
    const known = peers.get(key);
    if (known) {
      known.at = Date.now();
      return void known.socket.send(message);
    }
    void upstream({ label: "", target: f.target, port: f.to, https: false, protect: false, allowed: "all" }).then((to) => {
      if ("away" in to) return;
      const socket = createSocket(to.host.includes(":") ? "udp6" : "udp4");
      socket.on("message", (back) => server.send(back, from.port, from.address));
      socket.on("error", () => socket.close());
      socket.connect(to.port, to.host, () => socket.send(message));
      peers.set(key, { socket, at: Date.now() });
    });
  });
  const sweep = setInterval(() => {
    for (const [key, peer] of peers) if (Date.now() - peer.at > UDP_IDLE_MS) (peer.socket.close(), peers.delete(key));
  }, 30_000);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(f.port, "::", () => {
      server.off("error", reject);
      resolve({
        stop: () => {
          clearInterval(sweep);
          for (const peer of peers.values()) peer.socket.close();
          server.close();
        },
      });
    });
  });
}

/** Starts a forward: devices of its container, or Hata's own relays; a failure is kept for the page */
async function start(f: Forward): Promise<void> {
  for (const proto of protocolsOf(f.proto)) failures.delete(keyOf(f.port, proto));
  if (await isContainer(f)) {
    try {
      await containerDevices(f, true);
    } catch (e) {
      for (const proto of protocolsOf(f.proto)) failures.set(keyOf(f.port, proto), e instanceof Error ? e.message : String(e));
    }
    return;
  }
  for (const proto of protocolsOf(f.proto)) {
    const key = keyOf(f.port, proto);
    if (running.has(key)) continue;
    try {
      running.set(key, await (proto === "tcp" ? relayTcp(f) : relayUdp(f)));
    } catch (e) {
      failures.set(key, e instanceof Error ? e.message : String(e));
    }
  }
}

/** Stops a forward: its relays, or its devices in the container */
async function stop(f: Forward): Promise<void> {
  for (const proto of protocolsOf(f.proto)) {
    const key = keyOf(f.port, proto);
    running.get(key)?.stop();
    running.delete(key);
    failures.delete(key);
  }
  if (f.target.kind === "container") await containerDevices(f, false).catch(() => {});
}

/** Every forward at the start; devices of Hata's that no forward names any more are taken out of the containers */
export async function startForwards(): Promise<void> {
  for (const f of settings.forwards) await start(f);
  if (!existsSync(SOCKET)) return;
  const list = ((await incus("GET", "/1.0/instances?recursion=1").catch(() => null))?.metadata ?? []) as any[];
  for (const raw of list) {
    const stale = Object.keys(raw.devices ?? {}).filter((d) => isOurDevice(d) && !settings.forwards.some((f) => f.target.kind === "container" && f.target.name === raw.name && protocolsOf(f.proto).some((p) => deviceName(f.port, p) === d)));
    if (!stale.length) continue;
    const devices = { ...raw.devices };
    for (const d of stale) delete devices[d];
    await incus("PUT", `/1.0/instances/${raw.name}`, { architecture: raw.architecture, config: raw.config, devices, ephemeral: raw.ephemeral, profiles: raw.profiles, stateful: raw.stateful, description: raw.description }).then((op) => finished(op, 60)).catch(() => {});
  }
}

const changed: (() => void)[] = [];
/** Told after the list changed: the internet side's firewall follows the ports opened there */
export const onForwardsChanged = (listener: () => void): void => void changed.push(listener);

function save(forwards: Forward[]): void {
  settings.forwards = forwards;
  saveSettings();
  for (const listener of changed) listener();
}

/** Reads what the page sent; a port that is not ours and is taken on this server is refused before anything */
async function read(input: Record<string, unknown>, except?: Forward): Promise<Forward> {
  let f: Forward;
  try {
    f = readForward(input, [...settings.forwards.filter((x) => x !== except), ...ownPorts(listenAddress().port, HTTPS_PORT)]);
  } catch (e) {
    if (e instanceof NameError) throw new AppError(e.code, e.code === "ports.taken" ? 409 : 400, e.detail);
    throw e;
  }
  const mine = except && clash(except, f);
  for (const proto of protocolsOf(f.proto)) {
    if (mine && protocolsOf(except!.proto).includes(proto)) continue;
    if (!(await free(f.port, proto))) throw new AppError("ports.busy", 409, { port: String(f.port) });
  }
  return f;
}

/** Whether a port of a protocol is free on this server right now */
async function free(port: number, proto: "tcp" | "udp"): Promise<boolean> {
  try {
    if (proto === "udp") (await Bun.udpSocket({ port })).close();
    else Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

export async function addForward(input: Record<string, unknown>, by: string): Promise<Forward> {
  const f = await read(input);
  save([...settings.forwards, f]);
  await start(f);
  record("ports.added", { user: by, detail: String(f.port) });
  return f;
}

export async function changeForward(port: number, input: Record<string, unknown>, by: string): Promise<Forward> {
  const old = settings.forwards.find((x) => x.port === port);
  if (!old) throw new AppError("ports.notFound", 404, { port: String(port) });
  await stop(old);
  let f: Forward;
  try {
    f = await read(input, old);
  } catch (e) {
    await start(old);
    throw e;
  }
  save(settings.forwards.map((x) => (x === old ? f : x)));
  await start(f);
  record("ports.changed", { user: by, detail: String(f.port) });
  return f;
}

export async function removeForward(port: number, by: string): Promise<void> {
  const old = settings.forwards.find((x) => x.port === port);
  if (!old) throw new AppError("ports.notFound", 404, { port: String(port) });
  await stop(old);
  save(settings.forwards.filter((x) => x !== old));
  record("ports.removed", { user: by, detail: String(port) });
}

/** The forwards as the page shows them: where each leads now, and what failed */
export async function forwardsReport() {
  return Promise.all(
    settings.forwards.map(async (f) => {
      const to = await upstream({ label: "", target: f.target, port: f.to, https: false, protect: false, allowed: "all" });
      const container = await isContainer(f);
      return { ...f, by: container ? "incus" : "hata", at: "away" in to ? null : `${to.host}:${to.port}`, away: container ? null : "away" in to ? to.away : null, error: protocolsOf(f.proto).map((p) => failures.get(keyOf(f.port, p))).find(Boolean) ?? null };
    }),
  );
}
