/**
 * Hata's sign-in in front of an app of another machine.
 *
 * A browser sends Hata's cookie to Hata's host only, so the app cannot stay at the machine's address:
 * on the machine its web port is moved to 127.0.0.1 (the same `compose.override.yml` as for an app
 * here, written by Hata through the client), and Hata listens on a port of its own — the app's number
 * when that is free here — letting through those who are signed in and may open the app. What passes
 * goes to a local end of a tunnel (`forwarder`): each connection is a channel to the machine's client,
 * which connects to the app on its 127.0.0.1 (`tcp` in clientapps.ts). The access is kept in
 * `settings.access["<name>@<machine>"]` with `listen` — the app's address is Hata's host and that port.
 */
import type { Server, TCPSocketListener } from "bun";
import { hostname } from "node:os";
import { appMeta, parseCompose, parseEnv, type Compose } from "./appform";
import { AppError, busyPorts, type Job } from "./apps";
import { listenAddress, saveSettings, settings, type AppAccess } from "./config";
import { accessOf, gateTarget, guardedServer, guardsOf, overrideText } from "./gate";
import { beforeMachineUp, filesOfMachineApp, jobOnMachine, onMachineAppGone, runOnMachine } from "./machineapps";
import { call, machine, machineDataRoot, machines, open } from "./machines";

const MARK = "# Written by Hata";
const keyOf = (id: string, name: string) => `${name}@${id}`;

const forwarders = new Map<string, TCPSocketListener<unknown>>();
const listeners = new Map<string, Server>();

/** A local port whose connections are carried to 127.0.0.1:`upstream` of the machine */
function forwarder(id: string, upstream: number): TCPSocketListener<unknown> {
  type Conn = { channel: ReturnType<typeof open> | null; sending: Promise<void>; pending: Uint8Array[] };
  return Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { channel: null, sending: Promise.resolve(), pending: [] };
        let channel: ReturnType<typeof open>;
        try {
          channel = open(id, "tcp", { port: upstream });
        } catch {
          return void socket.end();
        }
        socket.data.channel = channel;
        const write = () => {
          while (socket.data.pending.length) {
            const chunk = socket.data.pending[0]!;
            const n = socket.write(chunk);
            if (n < chunk.length) {
              socket.data.pending[0] = chunk.subarray(n);
              return;
            }
            socket.data.pending.shift();
          }
        };
        (socket.data as Conn & { write?: () => void }).write = write;
        void (async () => {
          try {
            for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
              socket.data.pending.push(chunk);
              write();
            }
          } catch {}
          socket.end();
        })();
        channel.result.catch(() => socket.end());
      },
      data(socket, data) {
        const channel = socket.data.channel;
        if (!channel) return;
        const copy = new Uint8Array(data);
        socket.data.sending = socket.data.sending.then(() => channel.send(copy)).catch(() => socket.end());
      },
      drain(socket) {
        (socket.data as Conn & { write?: () => void }).write?.();
      },
      close(socket) {
        const channel = socket.data?.channel;
        if (channel) void socket.data.sending.then(() => channel.end()).catch(() => {});
      },
    },
  });
}

function stopGate(key: string): void {
  listeners.get(key)?.stop(true);
  listeners.delete(key);
  forwarders.get(key)?.stop(true);
  forwarders.delete(key);
}

function startGate(key: string): void {
  stopGate(key);
  const access = accessOf(key);
  const [, id] = key.split("@");
  if (!access.protect || !access.listen || !access.upstream || !id) return;
  try {
    const tunnel = forwarder(id, access.upstream);
    forwarders.set(key, tunnel);
    listeners.set(key, guardedServer(key, access.listen, tunnel.port));
  } catch (e) {
    console.error(`Cannot guard ${key} on port ${access.listen}: ${e instanceof Error ? e.message : e}`);
  }
}

/** The listeners of every protected app of a machine, at the start */
export function startMachineGates(): void {
  for (const key of Object.keys(settings.access)) if (key.includes("@")) startGate(key);
}

function save(key: string, access: AppAccess | null): void {
  if (access) settings.access[key] = access;
  else delete settings.access[key];
  saveSettings();
}

/** The override of a machine's app as it must be now; null — none (or the person's own, left alone) */
function overrideOf(id: string, name: string, files: { compose: string; env: string }): string | null {
  const access = accessOf(keyOf(id, name));
  if (!access.protect) return null;
  try {
    return overrideText(parseCompose(files.compose), machineDataRoot(id), guardsOf(access), parseEnv(files.env), { host: hostname(), port: access.listen ?? 0 });
  } catch {
    return null;
  }
}

// before `docker compose` reads a machine's app: the override in step with the compose file and the access
beforeMachineUp(async (id, name) => {
  const files = await filesOfMachineApp(id, name);
  const want = overrideOf(id, name, files);
  const ours = files.override === null || files.override.startsWith(MARK);
  if (!ours) return;
  if (want !== files.override) await call(id, "apps.write", { name, files: { "compose.override.yml": want } });
});

async function freeOnMachine(id: string, near: number): Promise<number> {
  const taken = new Set(Object.values(settings.access).flatMap((a) => guardsOf(a).map((g) => g.upstream)));
  for (let from = near; from < near + 400; from += 20) {
    const ports = Array.from({ length: 20 }, (_, i) => from + i).filter((p) => !taken.has(p));
    const { busy } = await call<{ busy: number[] }>(id, "apps.ports", { ports: ports.map((port) => ({ port, protocol: "tcp" })) });
    const free = ports.find((p) => !busy.includes(p));
    if (free) return free;
  }
  throw new AppError("gate.noFreePort");
}

/** A port of this server for people to open: the app's own number when it is free here */
async function freeHere(near: number, own: string): Promise<number> {
  const used = new Set([listenAddress().port, ...Object.entries(settings.access).filter(([k]) => k !== own).flatMap(([, a]) => [a.listen ?? a.port ?? 0])]);
  for (let port = near; port < near + 400; port++) {
    if (used.has(port)) continue;
    if (!(await busyPorts([{ port, protocol: "tcp" }])).length) return port;
  }
  throw new AppError("gate.noFreePort");
}

/** Who may open an app of a machine, and whether it is behind sign-in; a change of the latter is a job */
export async function setMachineAccess(id: string, name: string, request: { allowed: "all" | string[]; protect: boolean }, user: string): Promise<Job | null> {
  const key = keyOf(id, name);
  const files = await filesOfMachineApp(id, name);
  const current = accessOf(key);
  let next: AppAccess = { allowed: request.allowed, protect: false };
  if (request.protect) {
    const gate = gateTarget(parseCompose(files.compose), machineDataRoot(id), parseEnv(files.env));
    if (typeof gate === "string") throw new AppError("gate." + gate);
    const upstream = current.protect && current.port === gate.port && current.upstream ? current.upstream : await freeOnMachine(id, 20000 + (gate.port % 10000));
    const listen = current.protect && current.listen ? current.listen : await freeHere(gate.port, key);
    next = { allowed: request.allowed, protect: true, port: gate.port, upstream, listen };
  }
  if (next.protect === current.protect && next.port === current.port && next.upstream === current.upstream && next.listen === current.listen) {
    save(key, { ...current, allowed: request.allowed });
    return null;
  }
  return jobOnMachine(id, name, "apply", user, async (log) => {
    save(key, next);
    try {
      await runOnMachine(id, name, "config", log);
      await runOnMachine(id, name, "up", log);
    } catch (e) {
      save(key, { ...current, allowed: request.allowed });
      await runOnMachine(id, name, "up", log).catch(() => {});
      throw e;
    }
    if (next.protect) {
      startGate(key);
      log(`The app now opens through this server, on port ${next.listen}, after a Hata sign-in; on ${machine(id).name} it listens on 127.0.0.1:${next.upstream} only`);
    } else {
      stopGate(key);
      log(`The app is open again at ${machine(id).name}'s own address`);
    }
  });
}

/** A machine's app removed or moved away: what was kept about its access goes */
export function dropMachineAccess(id: string, name: string): void {
  const key = keyOf(id, name);
  stopGate(key);
  if (key in settings.access) save(key, null);
}

onMachineAppGone(dropMachineAccess);

/** The rows of the access table for the apps of the machines */
export async function machineAccessRows(lang: string) {
  const rows = [];
  for (const m of machines().filter((x) => x.online)) {
    const files = await call<{ name: string; compose: string; env: string }[]>(m.id, "apps.list").catch(() => []);
    for (const f of files) {
      let compose: Compose | null = null;
      try {
        compose = parseCompose(f.compose);
      } catch {}
      const key = keyOf(m.id, f.name);
      const access = accessOf(key);
      const gate = compose ? gateTarget(compose, machineDataRoot(m.id), parseEnv(f.env)) : "noPort";
      const meta = compose ? appMeta(compose, lang) : null;
      rows.push({ name: key, app: f.name, machine: { id: m.id, name: m.name }, title: meta?.title || f.name, icon: meta?.icon ?? "", allowed: access.allowed, protect: access.protect, cannotProtect: typeof gate === "string" ? gate : null, others: [] as { port: number; guarded: boolean }[], listen: access.listen ?? null });
    }
  }
  return rows;
}
