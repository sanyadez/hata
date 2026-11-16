/**
 * Bluetooth, the part with no side effects: what BlueZ says about its adapters and devices turned
 * into what the page shows, what a device is, and the pairing agent's answers.
 */

/** Everything BlueZ has, as its object manager gives it: path → interface → properties */
export type Objects = Record<string, Record<string, Record<string, unknown>>>;

export const ADAPTER = "org.bluez.Adapter1";
export const DEVICE = "org.bluez.Device1";
export const BATTERY = "org.bluez.Battery1";

export type Kind = "keyboard" | "mouse" | "gamepad" | "remote" | "input" | "speaker" | "headphones" | "phone" | "computer" | "tv" | "other";

export interface BtDevice {
  address: string;
  name: string;
  kind: Kind;
  paired: boolean;
  trusted: boolean;
  connected: boolean;
  /** Percent, where the device tells; null — it does not */
  battery: number | null;
  /** How strongly it is heard, dBm; null — not heard now */
  signal: number | null;
  /** It plays or records sound */
  audio: boolean;
  /** It is a keyboard, a mouse, a remote — something to press */
  input: boolean;
}

export interface BtAdapter {
  path: string;
  name: string;
  address: string;
  on: boolean;
  looking: boolean;
}

const ADDRESS_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/** A device's address as BlueZ writes it; "" — not one */
export function cleanAddress(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim().toUpperCase().replace(/-/g, ":") : "";
  return ADDRESS_RE.test(text) ? text : "";
}

const short = (uuid: unknown): string => {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(String(uuid));
  return m ? m[1]!.toLowerCase() : "";
};

// audio sink, headset, hands-free, and the two ways a thing to press introduces itself
const AUDIO = ["110b", "1108", "111e", "184e"];
const INPUT = ["1124", "1812"];

const BY_ICON: Record<string, Kind> = {
  "input-keyboard": "keyboard",
  "input-mouse": "mouse",
  "input-gaming": "gamepad",
  "input-tablet": "input",
  "audio-card": "speaker",
  "audio-headset": "headphones",
  "audio-headphones": "headphones",
  phone: "phone",
  computer: "computer",
  "video-display": "tv",
};

/** What a device is, by what it says about itself */
export function kindOf(props: Record<string, unknown>): Kind {
  const uuids = Array.isArray(props.UUIDs) ? props.UUIDs.map(short) : [];
  const look = Number(props.Appearance) || 0;
  // low energy devices name their kind by a number: 0x0180 a remote, 0x03C1… what is pressed
  if (look >= 0x0180 && look <= 0x01bf) return "remote";
  if (look === 0x03c1) return "keyboard";
  if (look === 0x03c2) return "mouse";
  if (look === 0x03c3 || look === 0x03c4) return "gamepad";
  const icon = BY_ICON[String(props.Icon ?? "")];
  if (icon) return icon;
  if (uuids.some((u) => AUDIO.includes(u))) return "speaker";
  if (uuids.some((u) => INPUT.includes(u)) || (look >= 0x03c0 && look <= 0x03ff)) return "input";
  return "other";
}

const INPUT_KINDS: Kind[] = ["keyboard", "mouse", "gamepad", "remote", "input"];
const AUDIO_KINDS: Kind[] = ["speaker", "headphones"];

export function deviceOf(objects: Objects, path: string): BtDevice | null {
  const props = objects[path]?.[DEVICE];
  const address = cleanAddress(props?.Address);
  if (!props || !address) return null;
  const uuids = Array.isArray(props.UUIDs) ? props.UUIDs.map(short) : [];
  const kind = kindOf(props);
  const battery = objects[path]?.[BATTERY]?.Percentage;
  const named = typeof props.Name === "string" && props.Name.trim() !== "";
  return {
    address,
    // a device that has not said its name is called by its address: such a one is not offered
    name: (typeof props.Alias === "string" && props.Alias.trim()) || (named ? String(props.Name) : ""),
    kind,
    paired: props.Paired === true,
    trusted: props.Trusted === true,
    connected: props.Connected === true,
    battery: typeof battery === "number" ? battery : null,
    signal: typeof props.RSSI === "number" ? props.RSSI : null,
    audio: AUDIO_KINDS.includes(kind) || uuids.some((u) => AUDIO.includes(u)),
    input: INPUT_KINDS.includes(kind) || uuids.some((u) => INPUT.includes(u)),
  };
}

export function adaptersOf(objects: Objects): BtAdapter[] {
  return Object.keys(objects)
    .filter((path) => objects[path]![ADAPTER])
    .sort()
    .map((path) => {
      const props = objects[path]![ADAPTER]!;
      return { path, name: String(props.Alias ?? props.Name ?? ""), address: String(props.Address ?? ""), on: props.Powered === true, looking: props.Discovering === true };
    });
}

/** The path of a device by its address; "" — BlueZ knows none */
export function pathOf(objects: Objects, address: string): string {
  return Object.keys(objects).find((path) => cleanAddress(objects[path]![DEVICE]?.Address) === address) ?? "";
}

export interface DeviceLists {
  /** The devices of this server: paired once, whether they are near or not */
  devices: BtDevice[];
  /** What is heard around and can be paired: only what says its name, the nearest first */
  found: BtDevice[];
}

export function devicesOf(objects: Objects): DeviceLists {
  const all = Object.keys(objects)
    .map((path) => ({ path, device: deviceOf(objects, path), named: typeof objects[path]![DEVICE]?.Name === "string" }))
    .filter((one): one is { path: string; device: BtDevice; named: boolean } => one.device !== null);
  const byName = (a: BtDevice, b: BtDevice) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address);
  return {
    devices: all
      .filter((one) => one.device.paired)
      .map((one) => one.device)
      .sort((a, b) => Number(b.connected) - Number(a.connected) || byName(a, b)),
    found: all
      .filter((one) => !one.device.paired && one.named && one.device.signal !== null)
      .map((one) => one.device)
      .sort((a, b) => b.signal! - a.signal! || byName(a, b)),
  };
}

/** What the person has to do for a pairing to go on */
export type PairStep = "working" | "passkey" | "pin" | "confirm" | "done" | "failed";

export interface Pairing {
  address: string;
  name: string;
  step: PairStep;
  /** The digits to type on the device (passkey, pin) or to compare with what it shows (confirm) */
  code: string;
  /** How many of them the device says were typed */
  typed: number;
  /** Why it failed: a code of `error.bluetooth.*`; "" — it did not */
  error: string;
}

/** A code of six digits, as devices show it */
export const sixDigits = (n: number): string => String(n >>> 0).padStart(6, "0").slice(-6);

/**
 * The PIN for a device that asks Hata for one. A thing with keys gets digits to type on it; a thing
 * without (a speaker of the old kind) has its PIN built in, and that is nearly always four zeros.
 */
export function pinFor(device: Pick<BtDevice, "kind" | "input"> | null, random: () => number = Math.random): { pin: string; show: boolean } {
  if (device && (device.input || device.kind === "keyboard")) return { pin: sixDigits(Math.floor(random() * 1_000_000)), show: true };
  return { pin: "0000", show: false };
}

const PAIR_ERRORS: Record<string, string> = {
  "org.bluez.Error.AuthenticationFailed": "bluetooth.pair.failed",
  "org.bluez.Error.AuthenticationCanceled": "bluetooth.pair.cancelled",
  "org.bluez.Error.AuthenticationRejected": "bluetooth.pair.rejected",
  "org.bluez.Error.AuthenticationTimeout": "bluetooth.pair.timeout",
  "org.bluez.Error.ConnectionAttemptFailed": "bluetooth.pair.unreachable",
  "org.bluez.Error.InProgress": "bluetooth.busy",
  "org.bluez.Error.DoesNotExist": "bluetooth.gone",
  "org.freedesktop.DBus.Error.UnknownObject": "bluetooth.gone",
  "org.freedesktop.DBus.Error.UnknownMethod": "bluetooth.gone",
  "hata.timeout": "bluetooth.pair.timeout",
  "hata.closed": "bluetooth.stopped",
};

/** A pairing's failure in Hata's codes */
export const pairError = (code: string): string => PAIR_ERRORS[code] ?? "bluetooth.pair.failed";

/**
 * Why a connection did not happen. BlueZ says it in the message more than in the name: no program on
 * this server takes the device's sound, the device is off or far, it has forgotten this server.
 */
export function connectError(code: string, message: string): string {
  if (code === "hata.closed") return "bluetooth.stopped";
  if (code === "org.bluez.Error.DoesNotExist" || code.startsWith("org.freedesktop.DBus.Error.Unknown")) return "bluetooth.gone";
  if (code === "org.bluez.Error.InProgress") return "bluetooth.busy";
  if (/profile-unavailable|ProfileUnavailable|NotAvailable|Protocol not available/i.test(code + " " + message)) return "bluetooth.noProfile";
  if (/page-timeout|host-down|Host is down|timeout|hata\.timeout/i.test(code + " " + message)) return "bluetooth.unreachable";
  if (/refused|key-missing|authentication/i.test(message)) return "bluetooth.forgotten";
  return "bluetooth.connectFailed";
}

/** A radio switch of the kernel that is Bluetooth's and is turned off by software */
export function blocked(switches: { type: string; soft: string; hard: string }[]): { soft: boolean; hard: boolean } {
  const ours = switches.filter((one) => one.type.trim() === "bluetooth");
  return { soft: ours.some((one) => one.soft.trim() === "1"), hard: ours.some((one) => one.hard.trim() === "1") };
}
