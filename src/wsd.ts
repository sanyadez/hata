/**
 * Showing up under "Network" in Windows' Explorer. Windows finds computers there by WS-Discovery: it
 * asks the whole network (SOAP over UDP, multicast) who is a device, and then fetches from each one
 * that answered a short description over HTTP — the computer's name among it. Opening the computer is
 * ordinary SMB to that name.
 *
 * The messages are pure functions (text in, text out — the few fields needed are picked with patterns,
 * there is no XML parser); the responder below them listens on UDP 3702 and TCP 5357.
 */
import { createSocket, type Socket } from "node:dgram";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { addressFor, homeLinks } from "./mdns";

const GROUP = "239.255.255.250";
const PORT = 3702;
const HTTP_PORT = 5357;

const NS = 'xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:wsx="http://schemas.xmlsoap.org/ws/2004/09/mex" xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof" xmlns:pnpx="http://schemas.microsoft.com/windows/pnpx/2005/10" xmlns:pub="http://schemas.microsoft.com/windows/pub/2005/07"';
const DISCOVERY = "http://schemas.xmlsoap.org/ws/2005/04/discovery";
const TRANSFER = "http://schemas.xmlsoap.org/ws/2004/09/transfer";
const PROFILE = "http://schemas.xmlsoap.org/ws/2006/02/devprof";
const TO_ALL = "urn:schemas-xmlsoap-org:ws:2005:04:discovery";
const TO_ASKER = "http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous";
const TYPES = "wsdp:Device pub:Computer";

export const escapeXml = (text: string): string => text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** A lasting id for this machine as a device, made from something that names it (the machine id) */
export function deviceId(seed: string): string {
  const hex = new Bun.CryptoHasher("sha256").update("hata-wsd:" + seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface Message {
  /** What is asked, a URI ending in `/Probe`, `/Resolve`, `/Get` */
  action: string;
  id: string;
  /** Probe: the kinds of device looked for, without their prefixes; empty — any */
  types: string[];
  /** Probe: narrowed to some scope, which we have none of */
  scoped: boolean;
  /** Resolve: the device asked about */
  address: string;
}

/** The text of the first element with this local name, whatever its prefix */
const pick = (xml: string, tag: string): string => new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</`).exec(xml)?.[1] ?? "";

/** Reads a request; null for what is not one */
export function readMessage(xml: string): Message | null {
  const action = pick(xml, "Action");
  const id = pick(xml, "MessageID");
  if (!action || !id || id.length > 200 || /[<>&"'\s]/.test(id)) return null;
  const types = pick(xml, "Types").split(/\s+/).filter(Boolean).map((type) => type.slice(type.indexOf(":") + 1));
  return { action, id, types, scoped: pick(xml, "Scopes") !== "", address: pick(xml, "Address") };
}

/** A device as it tells of itself */
export interface Device {
  /** `deviceId` */
  id: string;
  /** The computer's name: what Windows shows and connects to */
  name: string;
  /** Counts the messages of this run, so that a late one is told from a fresh one */
  sequence: { instance: number; message: number };
}

function envelope(device: Device, action: string, to: string, body: string, relatesTo = ""): string {
  const header = [`<wsa:To>${to}</wsa:To>`, `<wsa:Action>${action}</wsa:Action>`, `<wsa:MessageID>urn:uuid:${crypto.randomUUID()}</wsa:MessageID>`];
  if (relatesTo) header.push(`<wsa:RelatesTo>${escapeXml(relatesTo)}</wsa:RelatesTo>`);
  if (action.startsWith(DISCOVERY)) header.push(`<wsd:AppSequence InstanceId="${device.sequence.instance}" MessageNumber="${++device.sequence.message}"/>`);
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope ${NS}><soap:Header>${header.join("")}</soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

const reference = (device: Device): string => `<wsa:EndpointReference><wsa:Address>urn:uuid:${device.id}</wsa:Address></wsa:EndpointReference>`;
const where = (device: Device, address: string): string => `<wsd:XAddrs>http://${address}:${HTTP_PORT}/${device.id}</wsd:XAddrs>`;
const VERSION = "<wsd:MetadataVersion>1</wsd:MetadataVersion>";

/** "I am here", said to everyone when the device appears */
export const hello = (device: Device, address: string): string => envelope(device, `${DISCOVERY}/Hello`, TO_ALL, `<wsd:Hello>${reference(device)}<wsd:Types>${TYPES}</wsd:Types>${where(device, address)}${VERSION}</wsd:Hello>`);

/** "I am leaving" */
export const bye = (device: Device): string => envelope(device, `${DISCOVERY}/Bye`, TO_ALL, `<wsd:Bye>${reference(device)}</wsd:Bye>`);

/**
 * The answer to what came over the network, or null when it is not for us: "who is a device?" (Probe)
 * and "where is this device?" (Resolve). `address` is ours as the asker reaches it.
 */
export function answer(device: Device, message: Message, address: string): string | null {
  if (message.action === `${DISCOVERY}/Probe`) {
    // a match is a device that is of every kind asked for
    if (message.scoped || !message.types.every((type) => type === "Device" || type === "Computer")) return null;
    return envelope(device, `${DISCOVERY}/ProbeMatches`, TO_ASKER, `<wsd:ProbeMatches><wsd:ProbeMatch>${reference(device)}<wsd:Types>${TYPES}</wsd:Types>${where(device, address)}${VERSION}</wsd:ProbeMatch></wsd:ProbeMatches>`, message.id);
  }
  if (message.action === `${DISCOVERY}/Resolve`) {
    if (message.address !== `urn:uuid:${device.id}`) return null;
    return envelope(device, `${DISCOVERY}/ResolveMatches`, TO_ASKER, `<wsd:ResolveMatches><wsd:ResolveMatch>${reference(device)}<wsd:Types>${TYPES}</wsd:Types>${where(device, address)}${VERSION}</wsd:ResolveMatch></wsd:ResolveMatches>`, message.id);
  }
  return null;
}

/** The description fetched over HTTP: what the device is and the computer's name; null for another request */
export function describe(device: Device, message: Message): string | null {
  if (message.action !== `${TRANSFER}/Get`) return null;
  const name = escapeXml(device.name);
  const section = (dialect: string, body: string) => `<wsx:MetadataSection Dialect="${PROFILE}/${dialect}">${body}</wsx:MetadataSection>`;
  const body =
    section("ThisDevice", `<wsdp:ThisDevice><wsdp:FriendlyName>Hata (${name})</wsdp:FriendlyName><wsdp:FirmwareVersion>1.0</wsdp:FirmwareVersion><wsdp:SerialNumber>1</wsdp:SerialNumber></wsdp:ThisDevice>`) +
    section("ThisModel", "<wsdp:ThisModel><wsdp:Manufacturer>Hata</wsdp:Manufacturer><wsdp:ModelName>Hata</wsdp:ModelName><pnpx:DeviceCategory>Computers</pnpx:DeviceCategory></wsdp:ThisModel>") +
    section("Relationship", `<wsdp:Relationship Type="${PROFILE}/host"><wsdp:Host>${reference(device)}<wsdp:Types>pub:Computer</wsdp:Types><wsdp:ServiceId>urn:uuid:${device.id}</wsdp:ServiceId><pub:Computer>${name}/Workgroup:WORKGROUP</pub:Computer></wsdp:Host></wsdp:Relationship>`);
  return envelope(device, `${TRANSFER}/GetResponse`, TO_ASKER, `<wsx:Metadata>${body}</wsx:Metadata>`, message.id);
}

// --- The responder ----------------------------------------------------------------------------------

let device: Device | null = null;
let socket: Socket | null = null;
let listening = false;
let http: ReturnType<typeof Bun.serve> | null = null;
let failure = "";
let joined = new Set<string>();
let upkeep: Timer | null = null;

function machineSeed(): string {
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(path, "utf8").trim();
      if (id) return id;
    } catch {
      // the next place
    }
  }
  return hostname();
}

function sendAll(textFor: (address: string) => string, to: string[] = homeLinks().map((link) => link.address)): void {
  if (!socket || !listening) return;
  for (const address of to) {
    try {
      socket.setMulticastInterface(address);
      socket.send(textFor(address), PORT, GROUP);
    } catch {
      // a network that just went away
    }
  }
}

/** Joins the multicast group on every network that appeared since the last look, and says hello there */
function join(): void {
  if (!socket || !listening || !device) return;
  const now = new Set(homeLinks().map((link) => link.address));
  const fresh = [...now].filter((address) => !joined.has(address));
  for (const address of fresh) {
    try {
      socket.addMembership(GROUP, address);
    } catch {
      // already a member through another address of the same interface
    }
  }
  joined = now;
  const current = device;
  sendAll((address) => hello(current, address), fresh);
}

function onPacket(packet: Uint8Array, remote: { address: string; port: number }): void {
  if (!socket || !device || packet.length > 16_384) return;
  const address = addressFor(remote.address, homeLinks());
  const message = address && readMessage(new TextDecoder().decode(packet));
  const reply = message && answer(device, message, address);
  if (!reply) return;
  const from = socket;
  // everyone is asked at once: answers are spread out a little, as the protocol asks
  setTimeout(() => {
    try {
      if (socket === from) from.send(reply, remote.port, remote.address);
    } catch {
      // the question is asked again
    }
  }, Math.random() * 300);
}

async function onRequest(request: Request, server: { requestIP(request: Request): { address: string } | null }): Promise<Response> {
  const none = new Response(null, { status: 404 });
  const from = server.requestIP(request)?.address.replace(/^::ffff:/, "") ?? "";
  if (!device || request.method !== "POST" || new URL(request.url).pathname !== `/${device.id}` || !addressFor(from, homeLinks())) return none;
  const message = readMessage(await request.text());
  const reply = message && describe(device, message);
  return reply ? new Response(reply, { headers: { "content-type": "application/soap+xml" } }) : none;
}

function stop(): void {
  if (device && socket && listening) {
    const leaving = device;
    sendAll(() => bye(leaving));
  }
  const old = socket;
  // the goodbye is on its way before the door closes
  if (old) setTimeout(() => old.close(), 200);
  http?.stop(true);
  socket = null;
  http = null;
  device = null;
  listening = false;
  joined = new Set();
  if (upkeep) clearInterval(upkeep);
  upkeep = null;
}

/** Brings the responder in line: answering as the computer `name`, or silent when there is none */
export function refreshWsd(name: string | null): void {
  if (device?.name === name && (socket || !name)) return;
  stop();
  failure = "";
  if (!name) return;
  device = { id: deviceId(machineSeed()), name, sequence: { instance: Math.floor(Date.now() / 1000), message: 0 } };
  try {
    http = Bun.serve({ port: HTTP_PORT, hostname: "0.0.0.0", maxRequestBodySize: 65_536, fetch: onRequest });
  } catch (e) {
    // another responder of the kind (wsdd) holds the port: it speaks for this machine then
    failure = e instanceof Error ? e.message : String(e);
    console.error(`Not announced to Windows: ${failure}`);
    device = null;
    return;
  }
  const made = createSocket({ type: "udp4", reuseAddr: true });
  made.on("error", (e) => {
    console.error(`Not announced to Windows: ${e.message}`);
    if (socket !== made) return;
    stop();
    failure = e.message;
  });
  made.on("message", onPacket);
  socket = made;
  made.bind(PORT, () => {
    if (socket !== made) return;
    listening = true;
    made.setMulticastTTL(1);
    made.setMulticastLoopback(false);
    join();
  });
  // networks come and go (a cable, Wi-Fi): look again now and then
  upkeep = setInterval(join, 60_000);
}

/** Whether Windows is being told of this machine, and why not */
export const wsdStatus = (): { on: boolean; error: string } => ({ on: listening && http !== null, error: failure });
