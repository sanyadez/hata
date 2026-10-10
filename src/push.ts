/**
 * Web Push, the sending side: a notification goes to the device through the push service of its browser
 * (Google for Chrome and Android, Apple for Safari and iOS, Mozilla for Firefox), which gives the browser
 * an address (`endpoint`) and the keys to encrypt for. The content is encrypted for the device (RFC 8291,
 * aes128gcm), so the service cannot read it, and the request is signed with the server's key (VAPID,
 * RFC 8292). Everything is WebCrypto.
 */
import { isPlainObject } from "./fsutil";

/** Bytes WebCrypto accepts (not a SharedArrayBuffer) */
type Bytes = Uint8Array<ArrayBuffer>;

/** The record size of aes128gcm; a notification always fits into one record */
const RECORD_SIZE = 4096;
/** How long the push service keeps a notification for a device that is offline, seconds */
const TTL_SECONDS = 24 * 3600;
const SEND_TIMEOUT_MS = 15_000;

export interface VapidKeys {
  /** The raw public key, base64url — what the browser takes as `applicationServerKey` */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const fromB64u = (text: string): Bytes => new Uint8Array(Buffer.from(text, "base64url"));

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** A P-256 private key from raw values: WebCrypto takes it only as a JWK */
const privateJwk = (publicRaw: Uint8Array, d: Uint8Array): JsonWebKey => ({ kty: "EC", crv: "P-256", x: b64u(publicRaw.slice(1, 33)), y: b64u(publicRaw.slice(33, 65)), d: b64u(d), ext: true });

/**
 * Encrypts the content for a device: `p256dh` is the device's public key (65 bytes), `auth` its secret
 * (16 bytes). `fixed` is for tests only (the example of the RFC): the salt and the server's one-time key pair.
 */
export async function encryptPayload(plaintext: Bytes, p256dh: Bytes, auth: Bytes, fixed?: { salt: Bytes; publicKey: Bytes; privateKey: Bytes }): Promise<Bytes> {
  let asPublic: Bytes;
  let asPrivate: CryptoKey;
  if (fixed) {
    asPublic = fixed.publicKey;
    asPrivate = await crypto.subtle.importKey("jwk", privateJwk(fixed.publicKey, fixed.privateKey), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivate = pair.privateKey;
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const ikm = await hkdf(auth, ecdh, concat(enc.encode("WebPush: info\0"), p256dh, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 marks the last record; no padding is added
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const header: Bytes = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** The Authorization header of a request to `endpoint`; `subject` says who runs the server (a URL or mailto:) */
export async function vapidAuthorization(endpoint: string, subject: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // `exp` may be at most 24 hours ahead; 12 leaves room for clocks that disagree
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto gives an ECDSA signature as r||s — the form a JWT wants
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`;
}

export async function generateVapid(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}

const B64U_RE = /^[A-Za-z0-9_-]+={0,2}$/;

/** A subscription as the browser gives it (`PushSubscription.toJSON()`); null when it is not one */
export function cleanSubscription(raw: unknown): PushTarget | null {
  if (!isPlainObject(raw) || typeof raw.endpoint !== "string" || raw.endpoint.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.endpoint);
  } catch {
    return null;
  }
  // the server itself calls this address: HTTPS only, and no credentials in it
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const keys = isPlainObject(raw.keys) ? raw.keys : {};
  const p256dh = typeof keys.p256dh === "string" && B64U_RE.test(keys.p256dh) ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" && B64U_RE.test(keys.auth) ? keys.auth : "";
  const key = fromB64u(p256dh);
  if (key.length !== 65 || key[0] !== 4 || fromB64u(auth).length !== 16) return null;
  return { endpoint: raw.endpoint, keys: { p256dh, auth } };
}

/**
 * Sends one notification. "gone" — the push service says the device is no longer subscribed (the browser
 * was removed or the permission taken back), so the subscription can be forgotten.
 */
export async function sendPush(target: PushTarget, payload: unknown, vapid: VapidKeys, subject: string, doFetch: typeof fetch = fetch): Promise<"sent" | "gone"> {
  const res = await doFetch(target.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(target.endpoint, subject, vapid),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(TTL_SECONDS),
      urgency: "high",
    },
    body: await encryptPayload(enc.encode(JSON.stringify(payload)), fromB64u(target.keys.p256dh), fromB64u(target.keys.auth)),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) throw new Error(`${new URL(target.endpoint).host}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
  return "sent";
}
