/**
 * The secure channel between Hata and a machine's client. Pure: no files, no sockets.
 *
 * The client connects to Hata (a WebSocket the client opens, so the machine needs no open port) and the
 * two agree on keys before anything else is said. Hata may be reached over plain HTTP on the home
 * network, so the channel does not lean on TLS: both sides have a long-lived X25519 key, known to the
 * other since the pairing, and every connection mixes them with fresh keys of its own:
 *
 *   keys = HKDF(DH(eC, eH) ‖ DH(sC, eH) ‖ DH(eC, sH) ‖ secret, salt = SHA-256(label ‖ hello ‖ answer))
 *
 * Only the holder of Hata's key computes DH(eC, sH), only the holder of the client's key DH(sC, eH); a
 * stranger in between cannot read or forge a frame. At the pairing Hata does not know the client's key
 * yet: the one-time code of the install line is the `secret` then, and Hata's key travels in the same
 * line. Every frame after the two hello messages is AES-256-GCM with a counter of its own per direction
 * as the nonce — a frame dropped, repeated or reordered fails to open.
 */

export const LINK_LABEL = "hata-link-1";

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
export const fromB64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64"));

export interface KeyPair {
  /** PKCS #8, base64 */
  privateKey: string;
  /** The raw 32 bytes, base64 */
  publicKey: string;
}

export async function keyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    privateKey: b64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
    publicKey: b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
  };
}

const privateKey = (pkcs8: string) => crypto.subtle.importKey("pkcs8", fromB64(pkcs8), { name: "X25519" }, false, ["deriveBits"]);
const publicKey = (raw: string) => crypto.subtle.importKey("raw", fromB64(raw), { name: "X25519" }, false, []);

async function dh(own: string, other: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: await publicKey(other) }, await privateKey(own), 256));
}

/** A short form of a public key that a person can compare: the first 16 bytes of its SHA-256, hex */
export async function fingerprint(publicKeyB64: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", fromB64(publicKeyB64)));
  return Buffer.from(hash.subarray(0, 16)).toString("hex");
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const utf8 = (text: string) => new TextEncoder().encode(text);

/** The client's first message, in the clear */
export interface Hello {
  hata: "link";
  v: 1;
  /** The client's key of this connection */
  e: string;
  /** The client's long-lived key */
  s: string;
  /** The machine, once paired */
  machine?: string;
  /** The public half of the install code, at the pairing */
  invite?: string;
}

/** Hata's answer, in the clear: its key of this connection, or why it will not talk */
export interface Answer {
  e?: string;
  error?: string;
}

export function readHello(text: string): Hello | null {
  try {
    const m = JSON.parse(text);
    if (m?.hata !== "link" || m.v !== 1 || typeof m.e !== "string" || typeof m.s !== "string") return null;
    if (fromB64(m.e).length !== 32 || fromB64(m.s).length !== 32) return null;
    if (m.machine !== undefined && typeof m.machine !== "string") return null;
    if (m.invite !== undefined && typeof m.invite !== "string") return null;
    return m as Hello;
  } catch {
    return null;
  }
}

export interface Keys {
  /** Frames the client sends */
  up: CryptoKey;
  /** Frames Hata sends */
  down: CryptoKey;
}

/**
 * The keys of one connection. `hello` and `answer` are the exact texts that went over the wire; `secret`
 * is the private half of the install code at the pairing, empty afterwards.
 */
export async function linkKeys(side: "client" | "hata", own: { staticKey: string; ephemeral: string }, other: { staticKey: string; ephemeral: string }, hello: string, answer: string, secret = ""): Promise<Keys> {
  const parts =
    side === "client"
      ? [await dh(own.ephemeral, other.ephemeral), await dh(own.staticKey, other.ephemeral), await dh(own.ephemeral, other.staticKey)]
      : [await dh(own.ephemeral, other.ephemeral), await dh(own.ephemeral, other.staticKey), await dh(own.staticKey, other.ephemeral)];
  const ikm = await crypto.subtle.importKey("raw", concat(...parts, utf8(secret)), "HKDF", false, ["deriveBits"]);
  const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", concat(utf8(LINK_LABEL), utf8(hello), utf8(answer))));
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: utf8("keys") }, ikm, 512));
  const key = (raw: Uint8Array) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { up: await key(bits.subarray(0, 32)), down: await key(bits.subarray(32, 64)) };
}

const nonce = (counter: number): Uint8Array => {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setBigUint64(4, BigInt(counter));
  return n;
};

/**
 * One direction of the channel. Frames are sealed and opened strictly in order: the counter is the
 * nonce, so the calls are chained even though WebCrypto answers asynchronously.
 */
export class Sealer {
  private counter = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly key: CryptoKey) {}

  seal(plain: Uint8Array): Promise<Uint8Array> {
    const n = nonce(this.counter++);
    const next = this.chain.then(async () => new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: n }, this.key, plain)));
    this.chain = next.catch(() => {});
    return next;
  }
}

export class Opener {
  private counter = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly key: CryptoKey) {}

  /** Rejects when the frame is not the next one sealed with the other side's key */
  open(sealed: Uint8Array): Promise<Uint8Array> {
    const n = nonce(this.counter++);
    const next = this.chain.then(async () => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: n }, this.key, sealed)));
    this.chain = next.catch(() => {});
    return next;
  }
}

/** The install code: `<invite id>.<secret>` — the id names the invitation, the secret is never sent */
export function splitCode(code: string): { invite: string; secret: string } | null {
  const m = /^([a-z0-9]{8})\.([A-Za-z0-9_-]{22,64})$/.exec(code);
  return m ? { invite: m[1]!, secret: m[2]! } : null;
}
