/**
 * Passkeys (WebAuthn): signing in with the device's fingerprint, face or PIN instead of a password.
 *
 * The browser does the ceremony; this module checks what comes back. A passkey here is always a full
 * sign-in — the authenticator must have verified the user (the UV flag) — so it replaces the password and
 * the second factor at once.
 *
 * No attestation is asked for ("none"): which make of authenticator holds the key is not our business.
 * That is why the public key is taken as the browser hands it over (`getPublicKey()`, SPKI) rather than
 * dug out of the attestation object: without attestation nothing vouches for either, and a registration
 * is made by a signed-in user for their own account.
 *
 * Browsers offer WebAuthn only in a secure context, and a passkey belongs to a domain name: passkeys
 * exist when Hata is reached by its domain over HTTPS.
 */

export interface StoredPasskey {
  /** Credential id, base64url */
  id: string;
  /** SubjectPublicKeyInfo, base64 */
  publicKey: string;
  /** COSE algorithm: -7 ES256, -257 RS256, -8 Ed25519 */
  alg: number;
  /** The authenticator's signature counter at its last use; 0 — it does not count */
  counter: number;
  name: string;
  createdAt: number;
  lastUsed?: number;
}

export const PASSKEY_ALGORITHMS = [-7, -8, -257];

export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
/** Bytes of a base64url string; null when it is not one */
export function fromB64url(text: unknown, max = 8192): Uint8Array | null {
  if (typeof text !== "string" || text.length > max || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  return new Uint8Array(Buffer.from(text, "base64url"));
}

const sha256 = async (data: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  /** Present in a registration */
  credentialId?: Uint8Array;
}

/** The fixed-layout head of authenticator data (WebAuthn §6.1); null when it is too short to be one */
export function parseAuthData(data: Uint8Array): AuthData | null {
  if (data.length < 37) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: AuthData = { rpIdHash: data.subarray(0, 32), flags: data[32]!, counter: view.getUint32(33) };
  if (out.flags & FLAG_ATTESTED_DATA) {
    // 16 bytes of AAGUID, then the length of the credential id and the id itself
    if (data.length < 55) return null;
    const length = view.getUint16(53);
    if (data.length < 55 + length) return null;
    out.credentialId = data.subarray(55, 55 + length);
  }
  return out;
}

export interface Expected {
  challenge: string;
  /** The domain the passkey belongs to */
  rpId: string;
}

/** Was the ceremony ours: the right kind, our challenge, a page of our domain over HTTPS */
function checkClientData(json: Uint8Array, type: string, expected: Expected): boolean {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return false;
  }
  if (data.type !== type || data.challenge !== expected.challenge || data.crossOrigin === true || typeof data.origin !== "string") return false;
  try {
    const origin = new URL(data.origin);
    return origin.protocol === "https:" && origin.hostname === expected.rpId;
  } catch {
    return false;
  }
}

async function checkAuthData(data: Uint8Array, expected: Expected): Promise<AuthData | null> {
  const parsed = parseAuthData(data);
  if (!parsed || !equal(parsed.rpIdHash, await sha256(new TextEncoder().encode(expected.rpId)))) return null;
  const need = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
  return (parsed.flags & need) === need ? parsed : null;
}

const IMPORT: Record<number, { key: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams; verify: AlgorithmIdentifier | EcdsaParams }> = {
  [-7]: { key: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } },
  [-8]: { key: { name: "Ed25519" }, verify: { name: "Ed25519" } },
  [-257]: { key: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: { name: "RSASSA-PKCS1-v1_5" } },
};

const importKey = (spki: Uint8Array, alg: number) => crypto.subtle.importKey("spki", spki, IMPORT[alg]!.key, false, ["verify"]);

/** An ECDSA signature arrives as ASN.1 `SEQUENCE { r, s }`; WebCrypto wants the two numbers side by side */
export function derToRaw(der: Uint8Array, size = 32): Uint8Array | null {
  let at = 0;
  const length = (): number => {
    const first = der[at++]!;
    if (first < 0x80) return first;
    let value = 0;
    for (let i = 0; i < (first & 0x7f); i++) value = (value << 8) | der[at++]!;
    return value;
  };
  const integer = (): Uint8Array | null => {
    if (der[at++] !== 0x02) return null;
    const n = length();
    let bytes = der.subarray(at, at + n);
    at += n;
    while (bytes.length > size && bytes[0] === 0) bytes = bytes.subarray(1);
    return bytes.length > size ? null : bytes;
  };
  if (der[at++] !== 0x30) return null;
  length();
  const [r, s] = [integer(), integer()];
  if (!r || !s || at !== der.length) return null;
  const raw = new Uint8Array(size * 2);
  raw.set(r, size - r.length);
  raw.set(s, size * 2 - s.length);
  return raw;
}

/**
 * Bun leaves the error of a failed key import or verification behind, and the next keyed hash on this
 * thread (a TOTP code, say) would throw it: it is spent here on a hash nobody waits for.
 */
function spendCryptoError(): void {
  try {
    new Bun.CryptoHasher("sha256", new Uint8Array(1)).update("").digest();
  } catch {}
}

export interface RegistrationInput {
  clientDataJSON: unknown;
  authenticatorData: unknown;
  publicKey: unknown;
  alg: unknown;
}

/** Checks a new passkey; returns what to store, or null when the answer is not acceptable */
export async function verifyRegistration(input: RegistrationInput, expected: Expected): Promise<Pick<StoredPasskey, "id" | "publicKey" | "alg" | "counter"> | null> {
  const [clientData, authData, publicKey] = [fromB64url(input.clientDataJSON), fromB64url(input.authenticatorData), fromB64url(input.publicKey)];
  if (!clientData || !authData || !publicKey || typeof input.alg !== "number" || !PASSKEY_ALGORITHMS.includes(input.alg)) return null;
  if (!checkClientData(clientData, "webauthn.create", expected)) return null;
  const parsed = await checkAuthData(authData, expected);
  if (!parsed?.credentialId || parsed.credentialId.length === 0 || parsed.credentialId.length > 1023) return null;
  try {
    await importKey(publicKey, input.alg);
  } catch {
    spendCryptoError();
    return null;
  }
  return { id: b64url(parsed.credentialId), publicKey: Buffer.from(publicKey).toString("base64"), alg: input.alg, counter: parsed.counter };
}

export interface AssertionInput {
  clientDataJSON: unknown;
  authenticatorData: unknown;
  signature: unknown;
}

/** Checks a sign-in with a stored passkey; returns the authenticator's new counter, or null when it fails */
export async function verifyAssertion(input: AssertionInput, key: StoredPasskey, expected: Expected): Promise<{ counter: number } | null> {
  const [clientData, authData, signature] = [fromB64url(input.clientDataJSON), fromB64url(input.authenticatorData), fromB64url(input.signature)];
  if (!clientData || !authData || !signature || !IMPORT[key.alg]) return null;
  if (!checkClientData(clientData, "webauthn.get", expected)) return null;
  const parsed = await checkAuthData(authData, expected);
  if (!parsed) return null;
  // a counter that does not move forward means the key was copied; authenticators that do not count send 0
  if ((parsed.counter !== 0 || key.counter !== 0) && parsed.counter <= key.counter) return null;
  const sig = key.alg === -7 ? derToRaw(signature) : signature;
  if (!sig) return null;
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData);
  signed.set(await sha256(clientData), authData.length);
  try {
    const ok = await crypto.subtle.verify(IMPORT[key.alg]!.verify, await importKey(new Uint8Array(Buffer.from(key.publicKey, "base64")), key.alg), sig, signed);
    if (!ok) spendCryptoError();
    return ok ? { counter: parsed.counter } : null;
  } catch {
    spendCryptoError();
    return null;
  }
}

// --- Challenges -------------------------------------------------------------------------------------

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 1000;
/** challenge → what it was issued for; each works once */
const challenges = new Map<string, { exp: number; purpose: string }>();

/** A fresh challenge; `purpose` says what it may be spent on (`signin`, or `add:<user id>`) */
export function newChallenge(purpose: string): string {
  const now = Date.now();
  for (const [key, entry] of challenges) if (entry.exp < now || challenges.size >= MAX_CHALLENGES) challenges.delete(key);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  challenges.set(challenge, { exp: now + CHALLENGE_TTL_MS, purpose });
  return challenge;
}

/** Spends the challenge an answer was made for: true when it is ours, unexpired, and issued for this purpose */
export function spendChallenge(clientDataJSON: unknown, purpose: string): string | null {
  const bytes = fromB64url(clientDataJSON);
  let challenge: unknown;
  try {
    challenge = bytes && JSON.parse(new TextDecoder().decode(bytes)).challenge;
  } catch {
    return null;
  }
  if (typeof challenge !== "string") return null;
  const entry = challenges.get(challenge);
  if (!entry || entry.purpose !== purpose) return null;
  challenges.delete(challenge);
  return entry.exp > Date.now() ? challenge : null;
}
