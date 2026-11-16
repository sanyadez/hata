/**
 * Bluetooth devices of this server: keyboards, mice, remotes — found, paired, connected, forgotten.
 * BlueZ does the work and is asked over the system bus; Hata keeps one connection to it, hears what
 * changes and is the agent BlueZ asks during a pairing (the digits to type are shown on the page).
 * `bt.ts` is the part without side effects.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { record } from "./activity";
import { AppError } from "./apps";
import { ADAPTER, adaptersOf, blocked, cleanAddress, connectError, DEVICE, deviceOf, devicesOf, pairError, pathOf, pinFor, sixDigits, type BtAdapter, type BtDevice, type Objects, type Pairing } from "./bt";
import { bus as events } from "./bus";
import { Bus, BusError, variant, type Answer, type Message } from "./dbus";
import { installCommand, PATH, run } from "./packages";

const BLUEZ = "org.bluez";
const PROPS = "org.freedesktop.DBus.Properties";
const AGENT_PATH = "/hata/bluetooth/agent";
/** How long one look around lasts */
const LOOK_MS = 60_000;

let conn: Bus | null = null;
let connecting: Promise<void> | null = null;
/** BlueZ answers on the bus */
let running = false;
let objects: Objects = {};
let pairing: Pairing | null = null;
let lookTimer: ReturnType<typeof setTimeout> | null = null;
let tellTimer: ReturnType<typeof setTimeout> | null = null;

export const bluetoothInstalled = (): boolean => !!Bun.which("bluetoothctl", { PATH });

/** The page is told that something changed — not more often than once a second: a look around changes signal levels all the time */
function changed(): void {
  if (tellTimer) return;
  tellTimer = setTimeout(() => {
    tellTimer = null;
    events.publish("bluetooth");
  }, 1000);
}

const isProps = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function heard(message: Message): void {
  const [first, second, third] = message.body;
  if (message.interface === "org.freedesktop.DBus" && message.member === "NameOwnerChanged") {
    if (first !== BLUEZ) return;
    objects = {};
    running = false;
    if (third) void load().catch(() => {});
    return changed();
  }
  if (message.member === "InterfacesAdded" && typeof first === "string" && isProps(second)) {
    objects[first] = { ...objects[first], ...(second as Objects[string]) };
  } else if (message.member === "InterfacesRemoved" && typeof first === "string" && Array.isArray(second)) {
    for (const name of second) delete objects[first]?.[String(name)];
    if (objects[first] && Object.keys(objects[first]).length === 0) delete objects[first];
  } else if (message.member === "PropertiesChanged" && message.path && typeof first === "string" && isProps(second)) {
    const kept = ((objects[message.path] ??= {})[first] ??= {});
    Object.assign(kept, second);
    if (Array.isArray(third)) for (const name of third) delete kept[String(name)];
  } else return;
  // a speaker that has begun to play takes the volume that waited for it
  if (wanted.size && message.path?.includes("/dev_")) for (const address of wanted.keys()) giveVolume(address);
  changed();
}

/** Everything BlueZ has, read anew, and Hata put in place as the one it asks during a pairing */
async function load(): Promise<void> {
  if (!conn) return;
  try {
    const [all] = await conn.call(BLUEZ, "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects", "", [], 8000);
    objects = isProps(all) ? (all as Objects) : {};
    running = true;
  } catch {
    objects = {};
    running = false;
    return;
  }
  try {
    await conn.call(BLUEZ, "/org/bluez", "org.bluez.AgentManager1", "RegisterAgent", "os", [AGENT_PATH, "KeyboardDisplay"]);
    await conn.call(BLUEZ, "/org/bluez", "org.bluez.AgentManager1", "RequestDefaultAgent", "o", [AGENT_PATH]);
  } catch (e) {
    if (!(e instanceof BusError && e.code === "org.bluez.Error.AlreadyExists")) console.error("Bluetooth agent:", e instanceof Error ? e.message : e);
  }
}

function link(): Promise<void> {
  if (conn?.open) return Promise.resolve();
  connecting ??= (async () => {
    const bus = new Bus();
    await bus.connect();
    bus.onSignal = heard;
    bus.onClose = () => {
      if (conn !== bus) return;
      conn = null;
      objects = {};
      running = false;
      changed();
    };
    bus.serveObject(AGENT_PATH, agent);
    conn = bus;
    await bus.match(`type='signal',sender='${BLUEZ}'`);
    await bus.match(`type='signal',sender='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${BLUEZ}'`);
    await load();
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

/** The module's work: a connection to BlueZ kept while it is installed, looked after every half a minute */
export function startBluetooth(): void {
  const look = () => {
    if (!bluetoothInstalled()) return;
    if (!conn?.open) void link().catch(() => {});
    else if (!running) void load().catch(() => {});
  };
  look();
  setInterval(look, 30_000);
}

const pairingPath = (): string => (pairing && pairing.step !== "done" && pairing.step !== "failed" ? pathOf(objects, pairing.address) : "");

const refuse = (): never => {
  throw new BusError("org.bluez.Error.Rejected", "not asked for");
};

/** What BlueZ asks while pairing. Only the device the person chose on the page is let through */
function agent(message: Message): Answer {
  const [path, value, typed] = message.body;
  const mine = typeof path === "string" && path !== "" && path === pairingPath();
  const show = (step: Pairing["step"], code: string, count = 0) => {
    if (!pairing) return;
    pairing.step = step;
    pairing.code = code;
    pairing.typed = count;
    changed();
  };
  switch (message.member) {
    case "Release":
    case "Cancel":
      return;
    case "RequestPinCode": {
      if (!mine) return refuse();
      const { pin, show: shown } = pinFor(deviceOf(objects, path as string));
      if (shown) show("pin", pin);
      return { signature: "s", body: [pin] };
    }
    case "DisplayPinCode":
      if (mine) show("pin", String(value));
      return;
    case "DisplayPasskey":
      if (mine) show("passkey", sixDigits(Number(value)), Number(typed) || 0);
      return;
    case "RequestConfirmation":
      // the person started this pairing from the page a moment ago; the digits are shown to compare
      if (!mine) return refuse();
      show("confirm", sixDigits(Number(value)));
      return;
    case "RequestAuthorization":
      if (!mine) return refuse();
      return;
    case "AuthorizeService":
      if (!mine && objects[String(path)]?.[DEVICE]?.Paired !== true) return refuse();
      return;
    default:
      // a code typed here for the device to check is not built
      return refuse();
  }
}

function switches(): { type: string; soft: string; hard: string; path: string }[] {
  const dir = "/sys/class/rfkill";
  const read = (path: string): string => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  try {
    return readdirSync(dir).map((name) => ({ path: `${dir}/${name}`, type: read(`${dir}/${name}/type`), soft: read(`${dir}/${name}/soft`), hard: read(`${dir}/${name}/hard`) }));
  } catch {
    return [];
  }
}

/** This computer has a Bluetooth radio the kernel knows */
function hardware(): boolean {
  try {
    return readdirSync("/sys/class/bluetooth").some((name) => /^hci\d+$/.test(name));
  } catch {
    return false;
  }
}

export interface BtReport {
  /** missing — BlueZ is not installed; stopped — its service does not run; noAdapter; off — the radio is off; ready */
  state: "missing" | "stopped" | "noAdapter" | "off" | "ready";
  /** The command the Install button runs */
  install: string;
  /** The kernel sees a Bluetooth radio in this computer */
  hardware: boolean;
  /** The radio is turned off by a switch on the computer itself: Hata cannot turn it on */
  hardBlocked: boolean;
  adapter: { name: string; address: string; looking: boolean } | null;
  devices: BtDevice[];
  found: BtDevice[];
  pairing: Pairing | null;
  /** Speakers and headphones: missing — the package that plays to them is not installed; stopped; ready */
  sound: "missing" | "stopped" | "ready";
  soundInstall: string;
}

const adapter = (): BtAdapter | null => adaptersOf(objects)[0] ?? null;

export async function bluetoothReport(): Promise<BtReport> {
  const start = { install: installCommand("bluez"), soundInstall: installCommand("bluez-alsa-utils"), hardware: hardware(), hardBlocked: blocked(switches()).hard, adapter: null, devices: [], found: [], pairing: null, sound: "missing" as const };
  if (!bluetoothInstalled()) return { ...start, state: "missing" };
  await link().catch(() => {});
  const base = { ...start, sound: !soundInstalled() ? ("missing" as const) : (await hasName("org.bluealsa")) ? ("ready" as const) : ("stopped" as const) };
  if (conn?.open && !running) await load().catch(() => {});
  if (!running) return { ...base, state: "stopped" };
  const one = adapter();
  if (!one) return { ...base, state: "noAdapter" };
  return { ...base, state: one.on ? "ready" : "off", adapter: { name: one.name, address: one.address, looking: one.looking }, ...devicesOf(objects), pairing };
}

function ready(): { bus: Bus; adapter: BtAdapter } {
  const one = adapter();
  if (!conn?.open || !running || !one) throw new AppError("bluetooth.notReady", 409);
  return { bus: conn, adapter: one };
}

const setProp = (bus: Bus, path: string, iface: string, name: string, value: ReturnType<typeof variant>) => bus.call(BLUEZ, path, PROPS, "Set", "ssv", [iface, name, value]);

/** After the package is installed, or by the Start button: the service on now and at every boot */
export async function startService(): Promise<void> {
  const ran = await run(["systemctl", "enable", "--now", "bluetooth"], 30_000);
  if (ran.code !== 0) throw new AppError("bluetooth.startFailed", 500, { message: (ran.err || ran.out).trim().split("\n").pop() ?? "" });
  await link().catch(() => {});
  for (let i = 0; i < 10 && !adapter(); i++) {
    await Bun.sleep(500);
    await load().catch(() => {});
  }
  changed();
}

/** The radio on or off. A software switch of the kernel that holds it off is released first */
export async function setPower(on: boolean, by: string): Promise<void> {
  const { bus, adapter: one } = ready();
  if (on) {
    const radio = blocked(switches());
    if (radio.hard) throw new AppError("bluetooth.hardBlocked", 409);
    if (radio.soft) {
      for (const item of switches())
        if (item.type.trim() === "bluetooth" && item.soft.trim() === "1") {
          try {
            writeFileSync(`${item.path}/soft`, "0");
          } catch {
            // BlueZ will say why the radio stays off
          }
        }
      await Bun.sleep(700);
    }
  } else stopLooking();
  try {
    await setProp(bus, one.path, ADAPTER, "Powered", variant("b", on));
  } catch (e) {
    throw new AppError("bluetooth.powerFailed", 409, { message: e instanceof Error ? e.message : String(e) });
  }
  record(on ? "bluetooth.on" : "bluetooth.off", { user: by });
  changed();
}

function stopLooking(): void {
  if (lookTimer) clearTimeout(lookTimer);
  lookTimer = null;
  const one = adapter();
  if (conn?.open && one?.looking) void conn.call(BLUEZ, one.path, ADAPTER, "StopDiscovery").catch(() => {});
}

/** Looks around for devices for a minute (BlueZ looks only while the one who asked stays connected — Hata does) */
export async function lookAround(on: boolean): Promise<void> {
  const { bus, adapter: one } = ready();
  if (!on) return stopLooking();
  if (!one.on) throw new AppError("bluetooth.isOff", 409);
  try {
    await bus.call(BLUEZ, one.path, ADAPTER, "StartDiscovery");
  } catch (e) {
    if (!(e instanceof BusError && e.code === "org.bluez.Error.InProgress")) throw new AppError("bluetooth.lookFailed", 409, { message: e instanceof Error ? e.message : String(e) });
  }
  if (lookTimer) clearTimeout(lookTimer);
  lookTimer = setTimeout(stopLooking, LOOK_MS);
}

function known(raw: unknown): { path: string; device: BtDevice } {
  const address = cleanAddress(raw);
  const path = address ? pathOf(objects, address) : "";
  const device = path ? deviceOf(objects, path) : null;
  if (!device) throw new AppError("bluetooth.gone", 404);
  return { path, device };
}

async function connectTo(bus: Bus, path: string): Promise<void> {
  try {
    await bus.call(BLUEZ, path, DEVICE, "Connect", "", [], 40_000);
  } catch (e) {
    // some devices are connected by the pairing itself and say so in an odd way
    if (objects[path]?.[DEVICE]?.Connected === true) return;
    throw new AppError(e instanceof BusError ? connectError(e.code, e.message) : "bluetooth.connectFailed", 409);
  }
}

/**
 * Pairs with a device found around. Goes on in the background: what the person has to do (type the
 * digits on the keyboard) is `pairing` of the report. Paired, the device is trusted — it may connect
 * by itself from then on — and connected.
 */
export function pair(raw: unknown, by: string): void {
  const { bus } = ready();
  const { path, device } = known(raw);
  if (pairingPath()) throw new AppError("bluetooth.busy", 409);
  const mine: Pairing = { address: device.address, name: device.name, step: "working", code: "", typed: 0, error: "" };
  pairing = mine;
  changed();
  void (async () => {
    try {
      try {
        await bus.call(BLUEZ, path, DEVICE, "Pair", "", [], 90_000);
      } catch (e) {
        if (!(e instanceof BusError && e.code === "org.bluez.Error.AlreadyExists")) throw e;
      }
      await setProp(bus, path, DEVICE, "Trusted", variant("b", true)).catch(() => {});
      // paired is paired, whatever the connection says: why it did not connect is told next to it
      await connectTo(bus, path).catch((e) => {
        mine.error = e instanceof AppError ? e.code : "bluetooth.connectFailed";
      });
      mine.step = "done";
      record("bluetooth.paired", { user: by, detail: device.name });
    } catch (e) {
      mine.step = "failed";
      mine.error = pairError(e instanceof BusError ? e.code : "");
      // a device left half-paired would refuse the next try
      if (objects[path]?.[DEVICE]?.Paired !== true) void bus.call(BLUEZ, path, DEVICE, "CancelPairing").catch(() => {});
    }
    changed();
  })();
}

/** The pairing dialog is closed: one that still goes on is stopped, a finished one is forgotten */
export function endPairing(): void {
  const path = pairingPath();
  if (path && conn?.open) void conn.call(BLUEZ, path, DEVICE, "CancelPairing").catch(() => {});
  else pairing = null;
  changed();
}

export async function connectDevice(raw: unknown): Promise<void> {
  const { bus } = ready();
  const { path } = known(raw);
  await connectTo(bus, path);
  changed();
}

export async function disconnectDevice(raw: unknown): Promise<void> {
  const { bus } = ready();
  const { path } = known(raw);
  await bus.call(BLUEZ, path, DEVICE, "Disconnect", "", [], 15_000).catch(() => {
    throw new AppError("bluetooth.disconnectFailed", 409);
  });
  changed();
}

/** Forgets a device: its pairing goes, and it has to be paired anew to be used again */
export async function forgetDevice(raw: unknown, by: string): Promise<void> {
  const { bus, adapter: one } = ready();
  const { path, device } = known(raw);
  await bus.call(BLUEZ, one.path, ADAPTER, "RemoveDevice", "o", [path]).catch((e) => {
    throw new AppError("bluetooth.forgetFailed", 409, { message: e instanceof Error ? e.message : String(e) });
  });
  if (pairing?.address === device.address) pairing = null;
  record("bluetooth.forgotten", { user: by, detail: device.name });
  changed();
}

const hasName = async (name: string): Promise<boolean> => !!conn?.open && (await conn.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner", "s", [name]).catch(() => [false]))[0] === true;

/** The program that turns a Bluetooth speaker into a sound output of the system is installed and runs */
export const soundInstalled = (): boolean => !!Bun.which("bluealsa", { PATH });

/** The speakers and headphones that are connected and can be played to right now */
export async function speakers(): Promise<{ address: string; name: string }[]> {
  if (!running || !soundInstalled() || !(await hasName("org.bluealsa"))) return [];
  return devicesOf(objects)
    .devices.filter((one) => one.connected && one.audio)
    .map((one) => ({ address: one.address, name: one.name }));
}

/**
 * After the package for sound is installed: its service on, and the part that would play a phone's
 * music on this server's speakers off — nobody asked for that.
 */
export async function soundAfterInstall(): Promise<void> {
  await run(["systemctl", "disable", "--now", "bluealsa-aplay"], 30_000);
  await run(["systemctl", "enable", "--now", "bluealsa"], 30_000);
  // BlueZ learns of the new sound profiles when the service registers them; a moment is enough
  await Bun.sleep(1000);
  changed();
}

const TRANSPORT = "org.bluez.MediaTransport1";
/** The volume a speaker is to get once its sound runs: it takes none while it is silent */
const wanted = new Map<string, number>();

/** The sound channel BlueZ holds to a speaker: there while it is connected */
function transportOf(address: string): { path: string; props: Record<string, unknown> } | null {
  const device = pathOf(objects, address);
  if (!device) return null;
  const path = Object.keys(objects).find((one) => one.startsWith(device + "/") && objects[one]![TRANSPORT]);
  return path ? { path, props: objects[path]![TRANSPORT]! } : null;
}

/** A speaker's own volume in percent; null — it is not connected, or its volume cannot be set from here */
export function speakerVolume(address: string): number | null {
  const volume = wanted.get(address) ?? transportOf(address)?.props.Volume;
  return typeof volume === "number" ? Math.round((volume * 100) / 127) : null;
}

function giveVolume(address: string): void {
  const value = wanted.get(address);
  const transport = transportOf(address);
  if (value === undefined || !transport || transport.props.State !== "active" || !conn?.open) return;
  wanted.delete(address);
  transport.props.Volume = value;
  void setProp(conn, transport.path, TRANSPORT, "Volume", variant("q", value)).catch(() => {});
}

/** Sets a speaker's own volume (what its buttons change); false — this speaker has none to set */
export function setSpeakerVolume(address: string, percent: number): boolean {
  if (typeof transportOf(address)?.props.Volume !== "number") return false;
  wanted.set(address, Math.round((Math.min(100, Math.max(0, percent)) * 127) / 100));
  giveVolume(address);
  changed();
  return true;
}

/** The speaker a program reaches when it plays to "Bluetooth Audio" without naming one; "" — none is connected */
export function playingSpeaker(): string {
  return devicesOf(objects).devices.find((one) => one.connected && one.audio && transportOf(one.address))?.address ?? "";
}

/** How many devices are paired with this server, by what BlueZ keeps on the disk: known without asking it */
export function pairedKept(): number {
  const root = "/var/lib/bluetooth";
  let count = 0;
  try {
    for (const one of readdirSync(root)) {
      if (!cleanAddress(one)) continue;
      for (const device of readdirSync(`${root}/${one}`)) if (cleanAddress(device) && existsSync(`${root}/${one}/${device}/info`)) count++;
    }
  } catch {
    // no such folder: nothing was ever paired
  }
  return count;
}
