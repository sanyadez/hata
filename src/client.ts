#!/usr/bin/env bun
/**
 * The client of a machine Hata looks after: `hata-client`, a binary of its own built from this file.
 *
 * It has no web page, no users and no settings of its own: it connects to one Hata (the connection is
 * the client's, so the machine needs no open port), and runs what Hata asks — the machine's state, its
 * containers, a terminal, its files (`clientfiles.ts`), and its own update. Everything is decided on
 * Hata's side; here are the hands.
 *
 *   hata-client join <Hata address> <Hata's key> <code>   pair with Hata and install the service
 *   hata-client                                            run (what the service does)
 *   hata-client uninstall                                  stop and remove the service
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch, hostname, release, totalmem } from "node:os";
import { dirname } from "node:path";
import { containerCommand, shellCommand, TerminalManager, terminalEnv, type TerminalClient } from "./terminal";
import { diskUsage, dockerInfo, listContainers, PROJECT_LABEL, pruneBuildCache, pruneImages, pruneVolumes, removeImage, removeVolume, run, SERVICE_LABEL, startContainer, stopContainer, type ContainerSummary } from "./docker";
import * as apps from "./clientapps";
import * as files from "./clientfiles";
import { syncUsers } from "./clientusers";
import { keyPair, linkKeys, Opener, Sealer, splitCode, type KeyPair } from "./link";
import { MuxError, Peer, type Channel, type Handler } from "./mux";
import { checkPackages, upgradePackages } from "./pkgupdates";
import { startSampler, systemStatus } from "./system";
import { VERSION } from "./version";

const STATE_DIR = process.env.HATA_CLIENT_DIR || "/var/lib/hata-client";
const LINK_FILE = `${STATE_DIR}/link.json`;
const BIN = "/usr/local/bin/hata-client";
const UNIT = "/etc/systemd/system/hata-client.service";

/** What the client knows: where Hata is, its key, and its own */
interface LinkState {
  url: string;
  /** Hata's long-lived public key, from the install line */
  hata: string;
  key: KeyPair;
  /** Given by Hata at the pairing */
  machine?: string;
}

const readState = (): LinkState | null => {
  try {
    return JSON.parse(readFileSync(LINK_FILE, "utf8"));
  } catch {
    return null;
  }
};

function writeState(state: LinkState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(LINK_FILE + ".tmp", JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(LINK_FILE + ".tmp", LINK_FILE);
}

// --- What the machine is ----------------------------------------------------------------------------

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

export interface MachineInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  cpu: string;
  cores: number;
  memory: number;
  version: string;
  docker: { available: boolean; version?: string; compose?: string; state?: string };
  /** The machine's own network cards, for waking it from Hata (Wake-on-LAN) */
  macs: { iface: string; mac: string }[];
}

/** Network cards of the hardware (a `device` in sysfs), not bridges, tunnels or Docker's */
function macs(): { iface: string; mac: string }[] {
  const out: { iface: string; mac: string }[] = [];
  let names: string[] = [];
  try {
    names = readdirSync("/sys/class/net");
  } catch {}
  for (const iface of names) {
    if (!existsSync(`/sys/class/net/${iface}/device`)) continue;
    const mac = read(`/sys/class/net/${iface}/address`).trim().toLowerCase();
    if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) && mac !== "00:00:00:00:00:00") out.push({ iface, mac });
  }
  return out;
}

async function info(): Promise<MachineInfo> {
  const os = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(read("/etc/os-release"))?.[1] ?? "Linux";
  const cpu = /^model name\s*:\s*(.+)$/m.exec(read("/proc/cpuinfo"))?.[1]?.trim() ?? "";
  const docker = await dockerInfo();
  return { hostname: hostname(), os, kernel: release(), arch: arch(), cpu, cores: navigator.hardwareConcurrency, memory: totalmem(), version: VERSION, docker: { available: docker.available, version: docker.version, compose: docker.compose, state: docker.state }, macs: macs() };
}

// --- Containers -------------------------------------------------------------------------------------

export interface MachineContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  /** The compose project it belongs to, "" for a container started on its own */
  project: string;
  service: string;
  ports: { ip?: string; private: number; public?: number; type: string }[];
}

export const containerOf = (c: ContainerSummary): MachineContainer => ({
  id: c.Id,
  name: (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, ""),
  image: c.Image,
  state: c.State,
  status: c.Status,
  project: c.Labels?.[PROJECT_LABEL] ?? "",
  service: c.Labels?.[SERVICE_LABEL] ?? "",
  ports: (c.Ports ?? []).map((p) => ({ ip: p.IP, private: p.PrivatePort, public: p.PublicPort, type: p.Type })),
});

async function containers(): Promise<{ docker: MachineInfo["docker"]; containers: MachineContainer[] }> {
  const docker = await dockerInfo();
  if (!docker.available && docker.state !== "noCompose") return { docker: { available: false, state: docker.state }, containers: [] };
  return { docker: { available: docker.available, version: docker.version, compose: docker.compose, state: docker.state }, containers: (await listContainers()).map(containerOf) };
}

const ID_RE = /^[a-f0-9]{12,64}$/;

async function containerAction(args: { id?: unknown; action?: unknown }): Promise<void> {
  const id = String(args.id ?? "");
  if (!ID_RE.test(id)) throw new MuxError("machine.noContainer");
  const action = String(args.action);
  if (action === "start") return void (await startContainer(id));
  if (action === "stop") return void (await stopContainer(id));
  if (action === "restart") {
    await stopContainer(id).catch(() => {});
    return void (await startContainer(id));
  }
  throw new MuxError("request.notFound");
}

/** The containers of a compose project, all at once: started in their order, stopped in reverse */
async function projectAction(args: { project?: unknown; action?: unknown }): Promise<void> {
  const project = String(args.project ?? "");
  const all = (await listContainers()).filter((c) => c.Labels?.[PROJECT_LABEL] === project);
  if (!project || !all.length) throw new MuxError("machine.noContainer");
  const action = String(args.action);
  if (!["start", "stop", "restart"].includes(action)) throw new MuxError("request.notFound");
  if (action !== "start") for (const c of [...all].reverse()) if (c.State === "running") await stopContainer(c.Id);
  if (action !== "stop") for (const c of all) await startContainer(c.Id).catch(() => {});
}

/** The output of a container as it comes: the tail first, then what it writes, until cancelled */
async function logs(args: { id?: unknown; tail?: unknown }, channel: Channel): Promise<void> {
  const id = String(args.id ?? "");
  if (!ID_RE.test(id)) throw new MuxError("machine.noContainer");
  const tail = Math.min(5000, Math.max(0, Number(args.tail) || 200));
  const proc = Bun.spawn({ cmd: ["docker", "logs", "--follow", "--tail", String(tail), id], stdout: "pipe", stderr: "pipe" });
  channel.signal.addEventListener("abort", () => proc.kill());
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) await channel.send(chunk).catch(() => proc.kill());
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  await proc.exited;
}

// --- Terminal ---------------------------------------------------------------------------------------

const terminals = new TerminalManager();
/** How much output may wait for Hata before a terminal treats it as a slow window */
const TERMINAL_BACKLOG = 2 * 1024 * 1024;

/**
 * A terminal of the machine: its shell (`host`) or one in a container (`c:<id>`). The bytes are the
 * terminal's; the JSON messages of the terminal manager travel as controls, and so does a new size.
 */
async function terminal(args: { key?: unknown; cols?: unknown; rows?: unknown }, channel: Channel): Promise<void> {
  const key = String(args.key ?? "host");
  const container = /^c:([a-f0-9]{12,64})$/.exec(key)?.[1];
  if (key !== "host" && !container) throw new MuxError("request.notFound");
  let backlog = 0;
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const client: TerminalClient = {
    send(data) {
      if (typeof data === "string") return channel.control({ json: data });
      backlog += data.length;
      channel.send(data).then(
        () => (backlog -= data.length),
        () => done(),
      );
    },
    close: () => done(),
    getBufferedAmount: () => backlog,
  };
  terminals.attach(client, key, args.cols, args.rows, () =>
    container ? { cmd: containerCommand(container), cwd: "/", env: terminalEnv() } : { cmd: shellCommand(), cwd: existsSync(process.env.HOME ?? "/root") ? (process.env.HOME ?? "/root") : "/", env: terminalEnv() },
  );
  channel.onControl((m) => {
    if (m.type === "resize") terminals.resize(client, m.cols, m.rows);
  });
  channel.signal.addEventListener("abort", () => done());
  void (async () => {
    try {
      for (let chunk = await channel.read(); chunk; chunk = await channel.read()) terminals.input(client, chunk);
    } catch {
      // the link went away
    }
    done();
  })();
  await finished;
  terminals.detach(client);
  if (backlog > TERMINAL_BACKLOG) throw new MuxError("terminal.slow");
}

// --- Updating and leaving ---------------------------------------------------------------------------

/**
 * Takes a new binary from Hata, checks it and puts it in place; the service starts it as soon as this
 * process exits. A binary that does not run here never replaces the working one.
 */
async function update(args: { version?: unknown; sha256?: unknown }, state: LinkState): Promise<void> {
  const version = String(args.version ?? "");
  const sha256 = String(args.sha256 ?? "");
  if (!/^[0-9a-z.+-]{1,40}$/.test(version) || !/^[a-f0-9]{64}$/.test(sha256)) throw new MuxError("request.notFound");
  const target = process.execPath;
  const res = await fetch(`${state.url}/client/bin/${archName()}`);
  if (!res.ok) throw new MuxError("machine.updateFailed", `Hata answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (hash !== sha256) throw new MuxError("machine.updateFailed", "The checksum does not match");
  const next = `${target}.new`;
  writeFileSync(next, bytes, { mode: 0o755 });
  const said = Bun.spawnSync({ cmd: [next, "version"] });
  if (said.exitCode !== 0 || said.stdout.toString().trim() !== version) {
    rmSync(next, { force: true });
    throw new MuxError("machine.updateFailed", "The new version does not run on this machine");
  }
  renameSync(next, target);
  console.log(`Updated to ${version}; starting it`);
  // the answer goes out first
  setTimeout(() => process.exit(0), 300);
}

const archName = (): string => (arch() === "arm64" ? "arm64" : "x64");

/** Hata removed this machine: the client takes itself away */
function forget(): void {
  console.log("Hata removed this machine; the client removes itself (its apps stay where they are)");
  rmSync(LINK_FILE, { force: true });
  setTimeout(() => {
    if (existsSync(UNIT)) {
      Bun.spawnSync({ cmd: ["systemctl", "disable", "hata-client.service"] });
      rmSync(UNIT, { force: true });
      Bun.spawnSync({ cmd: ["systemctl", "daemon-reload"] });
    }
    rmSync(BIN, { force: true });
    process.exit(0);
  }, 300);
}

// --- The connection ---------------------------------------------------------------------------------

/** How often the machine's state is sent */
const STATUS_EVERY_MS = 5000;
/** Hata says something at least this often; silence longer than this is a dead connection */
const SILENCE_MS = 90_000;

interface Connected {
  peer: Peer;
  machine: string;
  name: string;
  closed: Promise<string>;
  close(): void;
}

/**
 * One connection: the two hello messages, the keys, the encrypted hello inside, and then the calls.
 * `pairing` carries the install code the first time.
 */
function connect(state: LinkState, handlers: Record<string, Handler>, pairing?: { invite: string; secret: string }): Promise<Connected> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(state.url.replace(/^http/, "ws") + "/client/link");
    ws.binaryType = "arraybuffer";
    let stage: "hello" | "welcome" | "live" = "hello";
    let ephemeral: KeyPair;
    let hello = "";
    let sealer: Sealer;
    let opener: Opener;
    let peer: Peer | null = null;
    let heard = Date.now();
    let silence: Timer | undefined;
    let endWith: (why: string) => void = () => {};
    const closed = new Promise<string>((r) => (endWith = r));
    const fail = (why: string) => {
      if (stage !== "live") reject(new Error(why));
      try {
        ws.close();
      } catch {}
    };

    ws.onopen = async () => {
      ephemeral = await keyPair();
      hello = JSON.stringify({ hata: "link", v: 1, e: ephemeral.publicKey, s: state.key.publicKey, ...(state.machine ? { machine: state.machine } : {}), ...(pairing ? { invite: pairing.invite } : {}) });
      ws.send(hello);
    };
    ws.onmessage = async (event) => {
      heard = Date.now();
      try {
        if (stage === "hello") {
          const answer = String(event.data);
          const parsed = JSON.parse(answer) as { e?: string; error?: string };
          if (!parsed.e) return fail(parsed.error ?? "Hata refused the connection");
          const keys = await linkKeys("client", { staticKey: state.key.privateKey, ephemeral: ephemeral.privateKey }, { staticKey: state.hata, ephemeral: parsed.e }, hello, answer, pairing?.secret ?? "");
          sealer = new Sealer(keys.up);
          opener = new Opener(keys.down);
          stage = "welcome";
          const about = await info();
          ws.send(await sealer.seal(new TextEncoder().encode(JSON.stringify({ hello: about }))));
          return;
        }
        const plain = await opener.open(new Uint8Array(event.data as ArrayBuffer));
        if (stage === "welcome") {
          const welcome = JSON.parse(new TextDecoder().decode(plain)) as { machine?: string; name?: string };
          if (!welcome.machine) return fail("Hata did not accept this machine");
          stage = "live";
          peer = new Peer({ side: "client", handlers, send: (frame) => void sealer.seal(frame).then((f) => ws.send(f)).catch(() => fail("sealing failed")) });
          silence = setInterval(() => Date.now() - heard > SILENCE_MS && fail("Hata went silent"), 10_000);
          resolve({ peer, machine: welcome.machine, name: welcome.name ?? "", closed, close: () => fail("closed") });
          return;
        }
        peer?.receive(plain);
      } catch (e) {
        // a frame that does not open is not Hata's — or the connection is not what it was
        fail(e instanceof Error ? e.message : String(e));
      }
    };
    ws.onerror = () => fail("Hata is not reachable at " + state.url);
    ws.onclose = (event) => {
      clearInterval(silence);
      peer?.close();
      const why = event.reason || "the connection was closed";
      if (stage !== "live") reject(new Error(why));
      endWith(why);
    };
  });
}

function handlersFor(state: LinkState): Record<string, Handler> {
  return {
    info: () => info(),
    status: () => systemStatus(),
    containers: () => containers(),
    container: (args) => containerAction(args),
    project: (args) => projectAction(args),
    logs: (args, channel) => logs(args, channel),
    terminal: (args, channel) => terminal(args, channel),
    update: (args) => update(args, state),
    forget: () => forget(),
    // the answer goes out first, then the machine goes down
    power: (args) => {
      const action = args?.action === "reboot" ? "reboot" : args?.action === "poweroff" ? "poweroff" : "";
      if (!action) throw new MuxError("request.notFound");
      setTimeout(() => Bun.spawn(["systemctl", action]), 500);
      return { ok: true };
    },
    "apps.list": () => apps.list(),
    "apps.write": (args) => apps.write(args),
    "apps.compose": (args, channel) => apps.compose(args, channel),
    "apps.logs": (args, channel) => apps.logs(args, channel),
    "apps.folders": (args) => apps.folders(args),
    "apps.ports": (args) => apps.ports(args),
    "apps.remove": (args) => apps.remove(args),
    "apps.snapshot": (args, channel) => apps.snapshot(args, channel),
    tcp: (args, channel) => apps.tcp(args, channel),
    "apps.restore": (args, channel) => apps.restore(args, channel),
    // images and volumes as Docker tells them; what they mean and whether one may go is Hata's to say
    "docker.space": async () => ({ df: await diskUsage(), containers: await listContainers() }),
    "docker.image.remove": async (args) => {
      const id = String(args?.id ?? "");
      if (!/^sha256:[0-9a-f]{64}$/.test(id)) throw new MuxError("request.notFound");
      if ((await listContainers()).some((c) => c.ImageID === id)) throw new MuxError("docker.imageInUse");
      await removeImage(id);
      return { ok: true };
    },
    "docker.volume.remove": async (args) => {
      const name = String(args?.name ?? "");
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(name)) throw new MuxError("request.notFound");
      if ((await listContainers()).some((c) => c.Mounts?.some((m) => m.Type === "volume" && m.Name === name))) throw new MuxError("docker.volumeInUse");
      await removeVolume(name);
      return { ok: true };
    },
    "docker.prune": (args) => (args?.kind === "images" ? pruneImages() : args?.kind === "volumes" ? pruneVolumes() : args?.kind === "cache" ? pruneBuildCache() : Promise.reject(new MuxError("request.notFound"))),
    // newer versions of the system's packages: Hata asks, the person decides
    "system.updates.check": () => checkPackages(),
    "system.updates.upgrade": (args, channel) => {
      const encoder = new TextEncoder();
      const packages = Array.isArray(args?.packages) ? args.packages.map(String) : [];
      return upgradePackages(packages, (line) => void channel.send(encoder.encode(line + "\n")).catch(() => {}));
    },
    "fs.list": (args) => files.list(args),
    "fs.summary": (args) => files.summary(args),
    "fs.info": (args) => files.fileInfo(args),
    "fs.read": (args, channel) => files.read(args, channel),
    "fs.text": (args) => files.readText(args),
    "fs.textPut": (args) => files.writeText(args),
    "fs.zip": (args, channel) => files.zip(args, channel),
    "fs.folder": (args) => files.makeFolder(args),
    "fs.file": (args) => files.makeFile(args),
    "fs.rename": (args) => files.rename(args),
    "fs.delete": (args) => files.remove(args),
    "fs.transfer": (args) => files.transfer(args),
    "fs.upload": (args, channel) => files.upload(args, channel),
    "fs.uploadAbort": (args) => files.abortUpload(args),
    "fs.taken": (args) => files.taken(args),
    "fs.pack": (args, channel) => files.pack(args, channel),
    "fs.unpack": (args, channel) => files.unpack(args, channel),
    "fs.dropData": (args) => files.dropData(args),
    "fs.real": (args) => files.real(args),
    // the users of Hata, as accounts of this machine: only while it is let to them
    "users.sync": (args) => syncUsers(args),
    ping: () => "pong",
  };
}

/** Docker's container events, told to Hata at most once a second */
async function watchContainers(tell: () => void): Promise<never> {
  let timer: Timer | null = null;
  const announce = () => (timer ??= setTimeout(() => ((timer = null), tell()), 1000));
  const filters = encodeURIComponent(JSON.stringify({ type: ["container"] }));
  for (;;) {
    try {
      const res = await fetch(`http://docker/events?filters=${filters}`, { unix: process.env.HATA_DOCKER_SOCK ?? "/var/run/docker.sock" } as RequestInit);
      if (res.ok && res.body) for await (const _ of res.body) announce();
    } catch {
      // Docker may come later
    }
    await Bun.sleep(5000);
  }
}

async function serve(): Promise<number> {
  const state = readState();
  if (!state?.machine) {
    console.error(`This machine is not paired with Hata (${LINK_FILE} is missing). Add it on Hata's page "Machines".`);
    return 1;
  }
  startSampler(() => "/", false);
  const handlers = handlersFor(state);
  let current: Connected | null = null;
  void watchContainers(() => current?.peer.event("containers", null));
  setInterval(() => current?.peer.event("status", systemStatus()), STATUS_EVERY_MS);
  let wait = 2000;
  for (;;) {
    try {
      current = await connect(state, handlers);
      console.log(`Connected to Hata at ${state.url} as "${current.name}"`);
      wait = 2000;
      current.peer.event("status", systemStatus());
      const why = await current.closed;
      console.log(`Disconnected: ${why}`);
    } catch (e) {
      console.log(`Cannot connect to ${state.url}: ${e instanceof Error ? e.message : e}`);
    }
    current = null;
    await Bun.sleep(wait);
    wait = Math.min(60_000, wait * 2);
  }
}

// --- Pairing and the service ------------------------------------------------------------------------

const unit = `[Unit]
Description=Hata client: this machine is looked after by a Hata server
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=${BIN}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`;

async function join(args: string[]): Promise<number> {
  const [url, hataKey, code] = args;
  const parts = splitCode(code ?? "");
  if (!url || !/^https?:\/\/[^/\s]+$/.test(url) || !hataKey || !parts) {
    console.error("Usage: hata-client join <Hata address> <Hata's key> <code> — the line is on Hata's page \"Machines\".");
    return 2;
  }
  if (process.getuid?.() !== 0) {
    console.error("This needs root: run it with sudo.");
    return 1;
  }
  const state: LinkState = { url, hata: hataKey, key: readState()?.key ?? (await keyPair()) };
  let connected: Connected;
  try {
    connected = await connect(state, {}, parts);
  } catch (e) {
    console.error(`Hata did not take this machine: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  state.machine = connected.machine;
  connected.close();
  writeState(state);
  console.log(`Paired with Hata at ${url} as "${connected.name}".`);
  if (process.execPath !== BIN) {
    mkdirSync(dirname(BIN), { recursive: true });
    writeFileSync(BIN + ".tmp", readFileSync(process.execPath));
    chmodSync(BIN + ".tmp", 0o755);
    renameSync(BIN + ".tmp", BIN);
  }
  writeFileSync(UNIT, unit);
  const ok = (cmd: string[]) => Bun.spawnSync({ cmd, stdout: "inherit", stderr: "inherit" }).exitCode === 0;
  if (!ok(["systemctl", "daemon-reload"]) || !ok(["systemctl", "enable", "hata-client.service"]) || !ok(["systemctl", "restart", "hata-client.service"])) {
    console.error("The service could not be started: see `journalctl -u hata-client`.");
    return 1;
  }
  console.log("The service hata-client is running.");
  return 0;
}

function uninstall(): number {
  if (process.getuid?.() !== 0) {
    console.error("This needs root: run it with sudo.");
    return 1;
  }
  Bun.spawnSync({ cmd: ["systemctl", "disable", "--now", "hata-client.service"], stdout: "inherit", stderr: "inherit" });
  rmSync(UNIT, { force: true });
  Bun.spawnSync({ cmd: ["systemctl", "daemon-reload"] });
  rmSync(LINK_FILE, { force: true });
  rmSync(BIN, { force: true });
  console.log(`The Hata client is removed. Apps it installed keep running; their compose files stay in ${apps.APPS_DIR}. Remove the machine on Hata's page too, if it is still listed.`);
  return 0;
}

if (import.meta.main) {
  const command = process.argv[2] ?? "run";
  switch (command) {
    case "run":
      process.exit(await serve());
    case "join":
      process.exit(await join(process.argv.slice(3)));
    case "uninstall":
      process.exit(uninstall());
    case "version":
    case "--version":
      console.log(VERSION);
      break;
    default:
      console.log(`Hata client ${VERSION}\n\nUsage:\n  hata-client join <Hata address> <Hata's key> <code>   pair with Hata (the line is on Hata's page "Machines")\n  hata-client                                            run (what the service does)\n  hata-client uninstall                                  stop and remove the client`);
      process.exit(command === "help" || command === "--help" ? 0 : 2);
  }
}
