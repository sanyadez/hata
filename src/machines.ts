/**
 * Other machines, looked after by this Hata through a client of their own (`client.ts`): a PC, a
 * virtual machine, a container — anything running Linux where the client is installed.
 *
 * Adding one: an administrator asks for an install line; it holds a one-time code (`<id>.<secret>`,
 * 30 minutes) and is run on the machine. The script it downloads from here has Hata's address as the
 * machine reached it, Hata's key and the checksum of the client; the client pairs (the code is the
 * secret of the first handshake, see `link.ts`) and stays connected as a service. The connection is
 * the client's, so the machine needs no open port.
 *
 * State is `machines.json` in the secrets folder: Hata's key, the machines (their keys, what they said
 * about themselves when they last connected) and the open invitations. What a connected machine says
 * every few seconds (its state, its containers) lives in memory only.
 *
 * The client's binary is the one of Hata's own version: taken from the release on GitHub the first
 * time it is needed and kept in the state folder (`HATA_CLIENT_FROM` — a folder or an address holding
 * `hata-client-linux-<arch>` and SHA256SUMS — takes it from elsewhere).
 */
import type { ServerWebSocket } from "bun";
import { createSocket } from "node:dgram";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { bus } from "./bus";
import type { MachineContainer, MachineInfo } from "./client";
import { DATA_DIR, SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { fingerprint, keyPair, linkKeys, Opener, readHello, Sealer, type KeyPair } from "./link";
import { MuxError, Peer, type Channel } from "./mux";
import type { SystemStatus } from "./system";
import { checksumFor } from "./update";
import { VERSION } from "./version";

const FILE = join(SECRETS_DIR, "machines.json");
const BIN_DIR = join(DATA_DIR, "client");
const CLIENT_FROM = process.env.HATA_CLIENT_FROM ?? `https://github.com/sanyadez/hata/releases/download/v${VERSION}`;
/** How long an install line works */
export const INVITE_MS = 30 * 60_000;
/** A machine silent for longer than this is away */
const TICK_MS = 30_000;
export const ARCHES = ["x64", "arm64"] as const;
export const MACHINE_ID_RE = /^[a-f0-9]{8}$/;

export interface Machine {
  id: string;
  name: string;
  /** The client's long-lived public key */
  key: string;
  added: number;
  by: string;
  /** When it was last connected */
  seen: number;
  info?: MachineInfo;
  /** Where the machine's apps keep their data; `/DATA` until said otherwise */
  dataRoot?: string;
  /** The other users of Hata may use it: they have accounts there, and its folders can be shared with them */
  people?: true;
}

interface Invite {
  id: string;
  secret: string;
  expires: number;
  by: string;
  /** The machine it adds is let to the other users of Hata from the start */
  people?: true;
}

interface State {
  key: KeyPair | null;
  machines: Machine[];
  invites: Invite[];
}

const valid = (v: unknown): boolean => typeof v === "object" && v !== null && Array.isArray((v as State).machines);
const state: State = readJsonFile<State>(FILE, { key: null, machines: [], invites: [] }, valid);
state.invites ??= [];

function save(): void {
  state.invites = state.invites.filter((i) => i.expires > Date.now());
  writeJsonAtomic(FILE, state);
}

async function ownKey(): Promise<KeyPair> {
  if (!state.key) {
    state.key = await keyPair();
    save();
  }
  return state.key;
}

const random = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
const hex = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");

// --- Live connections -------------------------------------------------------------------------------

interface Live {
  peer: Peer;
  since: number;
  ip: string;
  status: SystemStatus | null;
  containers: { docker: MachineInfo["docker"]; containers: MachineContainer[] } | null;
  ws: ServerWebSocket<LinkSocket>;
}

const live = new Map<string, Live>();

/** The connection to a machine, or the error the page words */
function linkOf(id: string): Live {
  const machine = state.machines.find((m) => m.id === id);
  if (!machine) throw new AppError("machine.notFound", 404);
  const link = live.get(id);
  if (!link) throw new AppError("machine.offline", 409, { name: machine.name });
  return link;
}

/** An error of the machine's own, as Hata's: the page words both the same way */
const asApp = (e: unknown): never => {
  if (e instanceof MuxError) throw new AppError(e.code, e.code === "link.lost" ? 409 : 400, { ...e.detail, message: e.message });
  throw e;
};

export function call<T>(id: string, op: string, args: unknown = {}): Promise<T> {
  return (linkOf(id).peer.call(op, args) as Promise<T>).catch(asApp);
}

export function open(id: string, op: string, args: unknown = {}): Channel {
  return linkOf(id).peer.open(op, args);
}

// --- What the page sees -----------------------------------------------------------------------------

export interface MachineView {
  id: string;
  name: string;
  added: number;
  seen: number;
  online: boolean;
  ip: string;
  info: MachineInfo | null;
  status: SystemStatus | null;
  /** The client runs another version than Hata: it can be brought to Hata's */
  outdated: boolean;
  /** Where its apps keep their data */
  dataRoot: string;
  /** Let to the other users of Hata */
  people: boolean;
}

const view = (m: Machine): MachineView => {
  const link = live.get(m.id);
  return { id: m.id, name: m.name, added: m.added, seen: link ? Date.now() : m.seen, online: !!link, ip: link?.ip ?? "", info: m.info ?? null, status: link?.status ?? null, outdated: !!m.info && m.info.version !== VERSION, dataRoot: m.dataRoot ?? "/DATA", people: !!m.people };
};

/** The data folder of a machine's apps */
export const machineDataRoot = (id: string): string => state.machines.find((m) => m.id === id)?.dataRoot ?? "/DATA";

export const machines = (): MachineView[] => state.machines.map(view);

export function machine(id: string): MachineView {
  const m = state.machines.find((x) => x.id === id);
  if (!m) throw new AppError("machine.notFound", 404);
  return view(m);
}

/** Machines that have been away for a while, for the attention list */
export const machinesAway = (): { id: string; name: string; since: number }[] => state.machines.filter((m) => !live.has(m.id) && Date.now() - m.seen > 5 * 60_000).map((m) => ({ id: m.id, name: m.name, since: m.seen }));

export async function containersOf(id: string): Promise<NonNullable<Live["containers"]>> {
  const link = linkOf(id);
  link.containers = await (link.peer.call("containers") as Promise<NonNullable<Live["containers"]>>).catch(asApp);
  return link.containers;
}

const NAME_MAX = 40;

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX) : "";
  if (!name) throw new AppError("machine.badName");
  return name;
}

export function rename(id: string, value: unknown, by: string): MachineView {
  const m = state.machines.find((x) => x.id === id);
  if (!m) throw new AppError("machine.notFound", 404);
  const name = cleanName(value);
  if (state.machines.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new AppError("machine.nameTaken", 409, { name });
  const old = m.name;
  m.name = name;
  save();
  record("machine.renamed", { user: by, detail: `${old} → ${name}` });
  bus.publish("machines");
  return view(m);
}

/** Forgets a machine; a connected client is told to remove itself first */
export async function remove(id: string, by: string): Promise<void> {
  const m = state.machines.find((x) => x.id === id);
  if (!m) throw new AppError("machine.notFound", 404);
  const link = live.get(id);
  if (link) {
    await link.peer.call("forget").catch(() => {});
    link.ws.close(1000, "removed");
    live.delete(id);
  }
  state.machines = state.machines.filter((x) => x.id !== id);
  save();
  record("machine.removed", { user: by, detail: m.name });
  bus.publish("machines");
}

// --- Power ------------------------------------------------------------------------------------------

/** The Wake-on-LAN magic packet for a card: six bytes of 0xFF, then its address sixteen times */
export function magicPacket(mac: string): Uint8Array {
  const bytes = mac.split(/[:-]/).map((x) => parseInt(x, 16));
  if (bytes.length !== 6 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new AppError("machine.noMac", 400);
  const out = new Uint8Array(102).fill(0xff);
  for (let i = 0; i < 16; i++) out.set(bytes, 6 + i * 6);
  return out;
}

/** The broadcast address of a network: `192.168.1.0/24` from an address and its mask */
export function broadcastOf(address: string, netmask: string): string {
  const a = address.split(".").map(Number);
  const m = netmask.split(".").map(Number);
  return a.map((x, i) => (x | (~m[i]! & 255)) & 255).join(".");
}

/**
 * Wakes a machine that is off or asleep: the magic packet for each of its cards, to every home network
 * of this server and to the general broadcast, on the usual ports 9 and 7. The machine's card must have
 * Wake-on-LAN on — that is its BIOS and driver, not Hata.
 */
export async function wake(id: string, by: string): Promise<{ sent: number }> {
  const m = state.machines.find((x) => x.id === id);
  if (!m) throw new AppError("machine.notFound", 404);
  const cards = m.info?.macs ?? [];
  if (!cards.length) throw new AppError("machine.noMac", 409, { name: m.name });
  const targets = new Set(["255.255.255.255"]);
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && a.netmask) targets.add(broadcastOf(a.address, a.netmask));
  const socket = createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, () => resolve()));
  socket.setBroadcast(true);
  let sent = 0;
  for (const { mac } of cards) {
    const packet = magicPacket(mac);
    for (const host of targets) {
      for (const port of [9, 7]) {
        await new Promise<void>((resolve) => socket.send(packet, port, host, () => resolve()));
        sent++;
      }
    }
  }
  socket.close();
  record("machine.wake", { user: by, detail: m.name });
  return { sent };
}

export async function power(id: string, action: unknown, by: string): Promise<void> {
  if (action !== "reboot" && action !== "poweroff") throw new AppError("request.notFound", 404);
  const m = linkOf(id);
  await (m.peer.call("power", { action }) as Promise<unknown>).catch(asApp);
  record(`machine.${action}`, { user: by, detail: state.machines.find((x) => x.id === id)?.name ?? id });
}

// --- The client's binary ----------------------------------------------------------------------------

const binName = (arch: string) => `hata-client-linux-${arch}`;
const fetching = new Map<string, Promise<{ path: string; sha256: string }>>();

/**
 * The client of Hata's own version for an architecture: from the cache, or fetched and checked.
 * Several machines asking at once share one download.
 */
export function clientBinary(arch: string): Promise<{ path: string; sha256: string }> {
  if (!(ARCHES as readonly string[]).includes(arch)) return Promise.reject(new AppError("request.notFound", 404));
  const path = join(BIN_DIR, binName(arch));
  const sumFile = `${path}.${VERSION}.sha256`;
  if (existsSync(path) && existsSync(sumFile)) return Promise.resolve({ path, sha256: readFileSync(sumFile, "utf8").trim() });
  let pending = fetching.get(arch);
  if (!pending) {
    pending = fetchBinary(arch, path, sumFile).finally(() => fetching.delete(arch));
    fetching.set(arch, pending);
  }
  return pending;
}

async function fetchBinary(arch: string, path: string, sumFile: string): Promise<{ path: string; sha256: string }> {
  const file = binName(arch);
  const local = CLIENT_FROM.startsWith("/");
  const get = async (name: string): Promise<Response> => {
    if (local) {
      const f = Bun.file(join(CLIENT_FROM, name));
      if (!(await f.exists())) throw new AppError("machine.noClient", 502, { message: `${join(CLIENT_FROM, name)} is missing` });
      return new Response(f);
    }
    const res = await fetch(`${CLIENT_FROM}/${name}`, { headers: { "user-agent": `hata/${VERSION}` }, signal: AbortSignal.timeout(10 * 60_000) }).catch((e) => {
      throw new AppError("machine.noClient", 502, { message: e instanceof Error ? e.message : String(e) });
    });
    if (!res.ok) throw new AppError("machine.noClient", 502, { message: `${CLIENT_FROM}/${name}: ${res.status}` });
    return res;
  };
  const expected = checksumFor(await (await get("SHA256SUMS")).text(), file);
  if (!expected) throw new AppError("machine.noClient", 502, { message: `SHA256SUMS has no ${file}` });
  mkdirSync(BIN_DIR, { recursive: true });
  const fresh = `${path}.download`;
  await Bun.write(fresh, await get(file));
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(fresh).stream()) hasher.update(chunk);
  if (hasher.digest("hex") !== expected) throw new AppError("machine.noClient", 502, { message: "The checksum does not match" });
  renameSync(fresh, path);
  await Bun.write(sumFile, expected);
  return { path, sha256: expected };
}

/** Brings a machine's client to Hata's version */
export async function updateClient(id: string, by: string): Promise<void> {
  const m = state.machines.find((x) => x.id === id);
  const link = linkOf(id);
  const arch = m?.info?.arch === "arm64" ? "arm64" : "x64";
  const { sha256 } = await clientBinary(arch);
  await (link.peer.call("update", { version: VERSION, sha256 }) as Promise<unknown>).catch(asApp);
  record("machine.updated", { user: by, detail: `${m?.name} → ${VERSION}` });
}

// --- Adding a machine -------------------------------------------------------------------------------

/** A new install line's code; the line itself is put together by the page around Hata's address */
export async function invite(by: string, people = false): Promise<{ code: string; expires: number; fingerprint: string }> {
  const key = await ownKey();
  const item: Invite = { id: hex(4), secret: random(24), expires: Date.now() + INVITE_MS, by, ...(people ? { people: true as const } : {}) };
  state.invites.push(item);
  // a page that asks again and again must not grow the file without bound
  state.invites = state.invites.slice(-20);
  save();
  return { code: `${item.id}.${item.secret}`, expires: item.expires, fingerprint: await fingerprint(key.publicKey) };
}

const openInvite = (code: string): Invite | null => {
  const [id, secret] = code.split(".");
  return state.invites.find((i) => i.id === id && i.secret === secret && i.expires > Date.now()) ?? null;
};

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The install script for a code. `origin` is Hata as the machine reached it — the address that is
 * known to work from there. An expired or unknown code gets a script that says so.
 */
export async function installScript(code: string, origin: string): Promise<string> {
  if (!openInvite(code)) return `#!/bin/sh\necho "This install line is no longer valid: ask Hata's page \\"Machines\\" for a new one." >&2\nexit 1\n`;
  const key = await ownKey();
  const sums: Record<string, string> = {};
  for (const arch of ARCHES) sums[arch] = (await clientBinary(arch).catch(() => null))?.sha256 ?? "";
  return `#!/bin/sh
# Installs the Hata client on this machine and pairs it with Hata at ${origin}.
set -eu
HATA=${shellQuote(origin)}
[ "$(uname -s)" = "Linux" ] || { echo "The Hata client runs on Linux." >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "This needs root: put sudo before sh." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd was not found; the client is installed as a systemd service." >&2; exit 1; }
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64; SUM=${shellQuote(sums.x64 ?? "")} ;;
  aarch64 | arm64) ARCH=arm64; SUM=${shellQuote(sums.arm64 ?? "")} ;;
  *) echo "Unsupported processor: $(uname -m). The client is built for x86_64 and arm64." >&2; exit 1 ;;
esac
[ -n "$SUM" ] || { echo "Hata has no client for $ARCH right now: see Hata's page." >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
echo "Downloading the Hata client from $HATA"
if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$TMP/hata-client" "$HATA/client/bin/$ARCH"
elif command -v wget >/dev/null 2>&1; then wget -q -O "$TMP/hata-client" "$HATA/client/bin/$ARCH"
else echo "curl or wget is needed." >&2; exit 1; fi
[ "$(sha256sum "$TMP/hata-client" | cut -d' ' -f1)" = "$SUM" ] || { echo "The download is damaged: its checksum does not match." >&2; exit 1; }
chmod +x "$TMP/hata-client"
"$TMP/hata-client" join "$HATA" ${shellQuote(key.publicKey)} ${shellQuote(code)}
`;
}

// --- The socket -------------------------------------------------------------------------------------

export interface LinkSocket {
  kind: "machine";
  ip: string;
  stage: "hello" | "welcome" | "live";
  machine?: Machine;
  invite?: Invite;
  clientKey?: string;
  sealer?: Sealer;
  opener?: Opener;
  peer?: Peer;
  /** Frames are opened one after another, whatever arrives while one is being opened waits */
  chain: Promise<void>;
}

export const linkData = (ip: string): LinkSocket => ({ kind: "machine", ip, stage: "hello", chain: Promise.resolve() });

const refuse = (ws: ServerWebSocket<LinkSocket>, error: string) => {
  ws.send(JSON.stringify({ error }));
  ws.close(1008, error);
};

/** A unique name among the machines: the host name, with a number when it is taken */
function freeName(base: string): string {
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX) || "machine";
  const taken = (n: string) => state.machines.some((m) => m.name.toLowerCase() === n.toLowerCase());
  if (!taken(clean)) return clean;
  for (let i = 2; ; i++) if (!taken(`${clean} ${i}`)) return `${clean} ${i}`;
}

async function onHello(ws: ServerWebSocket<LinkSocket>, text: string): Promise<void> {
  const hello = readHello(text);
  if (!hello) return refuse(ws, "Not a Hata client");
  const d = ws.data;
  if (hello.machine) {
    d.machine = state.machines.find((m) => m.id === hello.machine && m.key === hello.s);
    if (!d.machine) return refuse(ws, "This machine is not known to Hata: it was removed. Add it again on Hata's page \"Machines\".");
  } else {
    d.invite = state.invites.find((i) => i.id === hello.invite && i.expires > Date.now());
    if (!d.invite) return refuse(ws, "The install line is no longer valid: ask Hata's page \"Machines\" for a new one.");
  }
  d.clientKey = hello.s;
  const own = await ownKey();
  const ephemeral = await keyPair();
  const answer = JSON.stringify({ e: ephemeral.publicKey });
  const keys = await linkKeys("hata", { staticKey: own.privateKey, ephemeral: ephemeral.privateKey }, { staticKey: hello.s, ephemeral: hello.e }, text, answer, d.invite?.secret ?? "");
  d.sealer = new Sealer(keys.down);
  d.opener = new Opener(keys.up);
  d.stage = "welcome";
  ws.send(answer);
}

async function onWelcome(ws: ServerWebSocket<LinkSocket>, plain: Uint8Array): Promise<void> {
  const d = ws.data;
  const said = JSON.parse(new TextDecoder().decode(plain)) as { hello?: MachineInfo };
  const about = said.hello;
  if (!about || typeof about.hostname !== "string") return void ws.close(1008, "no hello");
  let m = d.machine;
  if (!m) {
    // the pairing: the code is used up
    const inv = d.invite!;
    if (!state.invites.includes(inv)) return void ws.close(1008, "The install line was used already");
    state.invites = state.invites.filter((i) => i !== inv);
    m = { id: hex(4), name: freeName(about.hostname), key: d.clientKey!, added: Date.now(), by: inv.by, seen: Date.now(), info: about, ...(inv.people ? { people: true as const } : {}) };
    state.machines.push(m);
    record("machine.added", { user: inv.by, detail: `${m.name} (${d.ip})` });
  }
  m.info = about;
  m.seen = Date.now();
  save();
  d.machine = m;
  d.stage = "live";
  ws.send(await d.sealer!.seal(new TextEncoder().encode(JSON.stringify({ machine: m.id, name: m.name }))));
  const machine = m;
  const old = live.get(machine.id);
  if (old) old.ws.close(1000, "connected again");
  d.peer = new Peer({
    side: "hata",
    send: (frame) => void d.sealer!.seal(frame).then((f) => ws.readyState === 1 && ws.send(f)),
    onEvent: (name, value) => {
      const link = live.get(machine.id);
      if (!link || link.ws !== ws) return;
      if (name === "status") {
        link.status = value as SystemStatus;
        bus.publish("machine", { id: machine.id, status: link.status });
      } else if (name === "containers") {
        link.containers = null;
        bus.publish("machine", { id: machine.id, containers: true });
      }
    },
  });
  live.set(machine.id, { peer: d.peer, since: Date.now(), ip: d.ip, status: null, containers: null, ws });
  bus.publish("machines");
  for (const listener of upListeners) listener(machine.id);
}

const upListeners: ((id: string) => void)[] = [];

/** Who wants to hear that a machine connected (again): what it should have may have changed meanwhile */
export const onMachineUp = (listener: (id: string) => void): void => void upListeners.push(listener);

/** Lets a machine to the other users of Hata, or takes it back */
export function setPeople(id: string, on: boolean): MachineView {
  const m = state.machines.find((one) => one.id === id);
  if (!m) throw new AppError("machine.notFound", 404);
  if (on) m.people = true;
  else delete m.people;
  save();
  bus.publish("machines");
  return view(m);
}

export const isOnline = (id: string): boolean => live.has(id);

/** The handlers of the clients' WebSockets (`/client/link`) */
export const linkHandlers = {
  open(_ws: ServerWebSocket<LinkSocket>) {},
  message(ws: ServerWebSocket<LinkSocket>, message: string | Buffer) {
    const d = ws.data;
    d.chain = d.chain.then(async () => {
      try {
        if (d.stage === "hello") {
          if (typeof message !== "string") return void ws.close(1008, "hello first");
          return await onHello(ws, message);
        }
        if (typeof message === "string") return void ws.close(1008, "sealed frames only");
        const plain = await d.opener!.open(new Uint8Array(message));
        if (d.stage === "welcome") return await onWelcome(ws, plain);
        d.peer?.receive(plain);
      } catch {
        // a frame that does not open: whoever this is, the conversation is over
        ws.close(1008, "bad frame");
      }
    });
  },
  close(ws: ServerWebSocket<LinkSocket>) {
    const d = ws.data;
    d.peer?.close();
    const m = d.machine;
    if (!m || live.get(m.id)?.ws !== ws) return;
    live.delete(m.id);
    m.seen = Date.now();
    save();
    bus.publish("machines");
  },
};

/** Keeps the connections talking: a client that hears nothing for long takes the connection for dead */
export function startMachines(): void {
  setInterval(() => {
    for (const link of live.values()) link.peer.event("tick", Date.now());
  }, TICK_MS).unref?.();
}
