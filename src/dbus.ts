/**
 * D-Bus, as much of it as Hata needs to talk to the system's services (BlueZ) over the system bus:
 * the wire format — pure, tested — and one connection that calls methods, hears signals and answers
 * the calls made to objects of its own (BlueZ asks its pairing agent that way).
 */
import { createConnection, type Socket } from "node:net";

/** A value that travels with its own type: what a "v" holds */
export class Variant {
  constructor(
    readonly signature: string,
    readonly value: unknown,
  ) {}
}

export const variant = (signature: string, value: unknown): Variant => new Variant(signature, value);

const SIZES: Record<string, number> = { y: 1, b: 4, n: 2, q: 2, i: 4, u: 4, h: 4, x: 8, t: 8, d: 8, s: 4, o: 4, g: 1, a: 4, "(": 8, "{": 8, v: 1 };

/** One complete type at the start of a signature */
export function firstType(signature: string, at = 0): string {
  const c = signature[at];
  if (c === undefined) throw new Error("signature ends early");
  if (c === "a") return "a" + firstType(signature, at + 1);
  if (c === "(" || c === "{") {
    const close = c === "(" ? ")" : "}";
    let i = at + 1;
    while (signature[i] !== close) {
      if (i >= signature.length) throw new Error("signature is not closed");
      i += firstType(signature, i).length;
    }
    return signature.slice(at, i + 1);
  }
  if (!(c in SIZES)) throw new Error(`type "${c}" is not known`);
  return c;
}

/** The complete types a signature is made of */
export function typesOf(signature: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < signature.length; ) {
    const one = firstType(signature, i);
    out.push(one);
    i += one.length;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Writer {
  bytes: number[] = [];
  align(n: number): void {
    while (this.bytes.length % n) this.bytes.push(0);
  }
  uint(value: number, size: number): void {
    this.align(size);
    for (let i = 0; i < size; i++) this.bytes.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
  }
  text(value: string, lengthSize: 1 | 4): void {
    const raw = encoder.encode(value);
    this.uint(raw.length, lengthSize);
    for (const b of raw) this.bytes.push(b);
    this.bytes.push(0);
  }
  write(type: string, value: unknown): void {
    const c = type[0]!;
    if (c === "y") this.bytes.push(Number(value) & 0xff);
    else if (c === "b") this.uint(value ? 1 : 0, 4);
    else if (c === "n" || c === "q") this.uint(Number(value) & 0xffff, 2);
    else if (c === "i" || c === "u" || c === "h") this.uint(Number(value) >>> 0, 4);
    else if (c === "x" || c === "t" || c === "d") {
      this.align(8);
      const view = new DataView(new ArrayBuffer(8));
      if (c === "d") view.setFloat64(0, Number(value), true);
      else if (c === "x") view.setBigInt64(0, BigInt(value as number), true);
      else view.setBigUint64(0, BigInt(value as number), true);
      for (let i = 0; i < 8; i++) this.bytes.push(view.getUint8(i));
    } else if (c === "s" || c === "o") this.text(String(value), 4);
    else if (c === "g") this.text(String(value), 1);
    else if (c === "v") {
      if (!(value instanceof Variant)) throw new Error("a variant needs its type");
      this.text(value.signature, 1);
      this.write(value.signature, value.value);
    } else if (c === "a") {
      const inner = type.slice(1);
      this.uint(0, 4);
      const lengthAt = this.bytes.length - 4;
      this.align(SIZES[inner[0]!]!);
      const start = this.bytes.length;
      if (inner[0] === "{") {
        const [keyType, valueType] = typesOf(inner.slice(1, -1));
        const entries = value instanceof Map ? [...value.entries()] : Array.isArray(value) ? (value as [unknown, unknown][]) : Object.entries(value as object);
        for (const [key, one] of entries) {
          this.align(8);
          this.write(keyType!, key);
          this.write(valueType!, one);
        }
      } else for (const one of value as unknown[]) this.write(inner, one);
      const length = this.bytes.length - start;
      for (let i = 0; i < 4; i++) this.bytes[lengthAt + i] = (length >>> (8 * i)) & 0xff;
    } else if (c === "(") {
      this.align(8);
      const types = typesOf(type.slice(1, -1));
      types.forEach((one, i) => this.write(one, (value as unknown[])[i]));
    } else throw new Error(`type "${c}" cannot be written`);
  }
}

/** Values in the wire format, as a message body (which starts on a boundary of 8) */
export function marshal(signature: string, values: unknown[]): Uint8Array {
  const w = new Writer();
  typesOf(signature).forEach((type, i) => w.write(type, values[i]));
  return Uint8Array.from(w.bytes);
}

class Reader {
  at = 0;
  constructor(
    readonly view: DataView,
    readonly little: boolean,
  ) {}
  align(n: number): void {
    this.at += (n - (this.at % n)) % n;
  }
  uint(size: 1 | 2 | 4): number {
    this.align(size);
    const v = size === 1 ? this.view.getUint8(this.at) : size === 2 ? this.view.getUint16(this.at, this.little) : this.view.getUint32(this.at, this.little);
    this.at += size;
    return v;
  }
  text(lengthSize: 1 | 4): string {
    const length = this.uint(lengthSize);
    const raw = new Uint8Array(this.view.buffer, this.view.byteOffset + this.at, length);
    this.at += length + 1;
    return decoder.decode(raw);
  }
  read(type: string): unknown {
    const c = type[0]!;
    if (c === "y") return this.uint(1);
    if (c === "b") return this.uint(4) !== 0;
    if (c === "q") return this.uint(2);
    if (c === "n") return (this.uint(2) << 16) >> 16;
    if (c === "u" || c === "h") return this.uint(4);
    if (c === "i") return this.uint(4) | 0;
    if (c === "x" || c === "t" || c === "d") {
      this.align(8);
      const v = c === "d" ? this.view.getFloat64(this.at, this.little) : Number(c === "x" ? this.view.getBigInt64(this.at, this.little) : this.view.getBigUint64(this.at, this.little));
      this.at += 8;
      return v;
    }
    if (c === "s" || c === "o") return this.text(4);
    if (c === "g") return this.text(1);
    if (c === "v") return this.read(this.text(1));
    if (c === "a") {
      const inner = type.slice(1);
      const length = this.uint(4);
      this.align(SIZES[inner[0]!]!);
      const end = this.at + length;
      if (end > this.view.byteLength) throw new Error("an array runs past the message");
      if (inner[0] === "{") {
        const [keyType, valueType] = typesOf(inner.slice(1, -1));
        const out: Record<string, unknown> = {};
        while (this.at < end) {
          this.align(8);
          const key = String(this.read(keyType!));
          out[key] = this.read(valueType!);
        }
        return out;
      }
      const out: unknown[] = [];
      while (this.at < end) out.push(this.read(inner));
      return out;
    }
    if (c === "(") {
      this.align(8);
      return typesOf(type.slice(1, -1)).map((one) => this.read(one));
    }
    throw new Error(`type "${c}" cannot be read`);
  }
}

/**
 * Values out of the wire format. Variants come as what they hold, dictionaries as plain objects,
 * structures as arrays, 64-bit numbers as numbers.
 */
export function unmarshal(signature: string, bytes: Uint8Array, little = true): unknown[] {
  const r = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little);
  return typesOf(signature).map((type) => r.read(type));
}

export const CALL = 1;
export const RETURN = 2;
export const ERROR = 3;
export const SIGNAL = 4;

export interface Message {
  type: number;
  serial: number;
  /** 1 — no answer is wanted */
  flags?: number;
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  signature?: string;
  body: unknown[];
}

const FIELDS: [number, keyof Message, string][] = [
  [1, "path", "o"],
  [2, "interface", "s"],
  [3, "member", "s"],
  [4, "errorName", "s"],
  [5, "replySerial", "u"],
  [6, "destination", "s"],
  [7, "sender", "s"],
  [8, "signature", "g"],
];

export function encode(message: Message): Uint8Array {
  const body = message.signature ? marshal(message.signature, message.body) : new Uint8Array(0);
  const fields: [number, Variant][] = [];
  for (const [code, key, type] of FIELDS) {
    const value = message[key];
    if (value !== undefined && value !== "") fields.push([code, variant(type, value)]);
  }
  const w = new Writer();
  w.bytes.push(0x6c, message.type, message.flags ?? 0, 1);
  w.uint(body.length, 4);
  w.uint(message.serial, 4);
  w.write("a(yv)", fields);
  w.align(8);
  const out = new Uint8Array(w.bytes.length + body.length);
  out.set(w.bytes);
  out.set(body, w.bytes.length);
  return out;
}

/** The first whole message of what has arrived and how many bytes it took; null — not all of it is here yet */
export function decode(bytes: Uint8Array): { message: Message; used: number } | null {
  if (bytes.length < 16) return null;
  const little = bytes[0] === 0x6c;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLength = view.getUint32(4, little);
  const fieldsLength = view.getUint32(12, little);
  const bodyAt = 16 + fieldsLength + ((8 - (fieldsLength % 8)) % 8);
  const used = bodyAt + bodyLength;
  if (bodyLength > 64 * 1024 * 1024 || fieldsLength > 1024 * 1024) throw new Error("a message of an impossible size");
  if (bytes.length < used) return null;
  const message: Message = { type: bytes[1]!, flags: bytes[2]!, serial: view.getUint32(8, little), body: [] };
  // the fields are read from the message's start: their padding counts from there
  const r = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bodyAt), little);
  r.at = 12;
  for (const [code, value] of r.read("a(yv)") as [number, unknown][]) {
    const field = FIELDS.find((one) => one[0] === code);
    if (field) (message as unknown as Record<string, unknown>)[field[1]] = value;
  }
  if (message.signature) message.body = unmarshal(message.signature, bytes.subarray(bodyAt, used), little);
  return { message, used };
}

/** What a service answered instead of a result */
export class BusError extends Error {
  constructor(
    /** The error's name, as "org.bluez.Error.Failed" */
    readonly code: string,
    message: string,
  ) {
    super(message || code);
  }
}

/** What an object of ours gives back to a call: its values, or nothing */
export type Answer = { signature: string; body: unknown[] } | void;
export type Handler = (message: Message) => Answer | Promise<Answer>;

export const SYSTEM_BUS = "/run/dbus/system_bus_socket";

/** One connection to a bus */
export class Bus {
  private socket: Socket | null = null;
  private serial = 0;
  private kept = new Uint8Array(0);
  private waiting = new Map<number, { resolve: (body: unknown[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private objects = new Map<string, Handler>();
  /** Every signal that arrives (what arrives is chosen with `match`) */
  onSignal: (message: Message) => void = () => {};
  /** The connection is gone: every pending call has failed already */
  onClose: () => void = () => {};
  name = "";

  get open(): boolean {
    return this.socket !== null;
  }

  /** Connects, signs in as the user of this process and says hello */
  connect(path = SYSTEM_BUS): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path });
      let signedIn = false;
      let line = "";
      const fail = (e: Error) => {
        socket.destroy();
        reject(e);
      };
      const limit = setTimeout(() => fail(new Error("the bus does not answer")), 8000);
      socket.once("error", fail);
      socket.once("connect", () => {
        const uid = Buffer.from(String(process.getuid?.() ?? 0)).toString("hex");
        socket.write(`\0AUTH EXTERNAL ${uid}\r\n`);
      });
      socket.on("data", (chunk: Buffer) => {
        if (signedIn) return this.arrived(chunk);
        line += chunk.toString("latin1");
        if (!line.includes("\r\n")) return;
        if (!line.startsWith("OK ")) return fail(new Error("the bus refused the sign-in"));
        signedIn = true;
        socket.write("BEGIN\r\n");
        this.socket = socket;
        socket.removeListener("error", fail);
        socket.on("error", () => {});
        socket.on("close", () => this.closed());
        this.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "Hello")
          .then(([name]) => {
            clearTimeout(limit);
            this.name = String(name);
            resolve();
          })
          .catch((e) => {
            clearTimeout(limit);
            fail(e instanceof Error ? e : new Error(String(e)));
          });
      });
    });
  }

  close(): void {
    this.socket?.destroy();
  }

  private closed(): void {
    if (!this.socket) return;
    this.socket = null;
    for (const one of this.waiting.values()) {
      clearTimeout(one.timer);
      one.reject(new BusError("hata.closed", "the connection to the bus is gone"));
    }
    this.waiting.clear();
    this.onClose();
  }

  private arrived(chunk: Uint8Array): void {
    const all = new Uint8Array(this.kept.length + chunk.length);
    all.set(this.kept);
    all.set(chunk, this.kept.length);
    let at = 0;
    try {
      for (;;) {
        const got = decode(all.subarray(at));
        if (!got) break;
        at += got.used;
        this.take(got.message);
      }
    } catch {
      // what cannot be read cannot be skipped either: the stream is lost
      this.close();
      return;
    }
    this.kept = all.slice(at);
  }

  private take(message: Message): void {
    if (message.type === RETURN || message.type === ERROR) {
      const one = this.waiting.get(message.replySerial ?? -1);
      if (!one) return;
      this.waiting.delete(message.replySerial!);
      clearTimeout(one.timer);
      if (message.type === RETURN) one.resolve(message.body);
      else one.reject(new BusError(message.errorName ?? "", typeof message.body[0] === "string" ? message.body[0] : ""));
    } else if (message.type === SIGNAL) {
      try {
        this.onSignal(message);
      } catch (e) {
        console.error("D-Bus signal:", e instanceof Error ? e.message : e);
      }
    } else if (message.type === CALL) void this.serve(message);
  }

  private async serve(message: Message): Promise<void> {
    const wanted = !((message.flags ?? 0) & 1);
    const reply = (rest: Partial<Message>) => wanted && this.send({ type: RETURN, serial: 0, body: [], replySerial: message.serial, destination: message.sender, ...rest });
    const handler = this.objects.get(message.path ?? "");
    try {
      if (!handler) throw new BusError("org.freedesktop.DBus.Error.UnknownObject", "no such object");
      const answer = await handler(message);
      reply(answer ? { signature: answer.signature, body: answer.body } : {});
    } catch (e) {
      const code = e instanceof BusError ? e.code : "org.freedesktop.DBus.Error.Failed";
      reply({ type: ERROR, errorName: code, signature: "s", body: [e instanceof Error ? e.message : String(e)] });
    }
  }

  private send(message: Message): number {
    if (!this.socket) throw new BusError("hata.closed", "no connection to the bus");
    this.serial = (this.serial % 0x7fffffff) + 1;
    this.socket.write(encode({ ...message, serial: this.serial }));
    return this.serial;
  }

  /** Calls a method and gives what it returned; a refusal is a `BusError` with the service's own name for it */
  call(destination: string, path: string, iface: string, member: string, signature = "", body: unknown[] = [], timeout = 25_000): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      let serial: number;
      try {
        serial = this.send({ type: CALL, serial: 0, destination, path, interface: iface, member, signature, body });
      } catch (e) {
        return reject(e);
      }
      const timer = setTimeout(() => {
        this.waiting.delete(serial);
        reject(new BusError("hata.timeout", `${member}: no answer`));
      }, timeout);
      this.waiting.set(serial, { resolve, reject, timer });
    });
  }

  /** Asks the bus to pass on the signals a rule describes */
  match(rule: string): Promise<unknown[]> {
    return this.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "AddMatch", "s", [rule]);
  }

  /** An object of ours: calls made to its path go to the handler */
  serveObject(path: string, handler: Handler): void {
    this.objects.set(path, handler);
  }
}
