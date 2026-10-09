/**
 * Certificates from Let's Encrypt (ACME, RFC 8555), without a helper program: an account key, signed
 * requests, the HTTP-01 challenge answered by our own server, a certificate request built by hand.
 *
 * One certificate per name — Hata's own and one for each app's subdomain — so a name that cannot be
 * validated does not hold the others back. Everything is in `data/certs/`.
 */
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, DOMAIN_RE, settings } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";

const CERTS_DIR = join(DATA_DIR, "certs");
const ACCOUNT_FILE = join(CERTS_DIR, "account.json");
const LETS_ENCRYPT = "https://acme-v02.api.letsencrypt.org/directory";

/** The certificate authority's directory. The override is for testing against a local ACME server. */
const directoryUrl = (): string => process.env.HATA_ACME_DIRECTORY || LETS_ENCRYPT;
/** A local test authority signs its own API certificate; nothing else is ever fetched without checking */
const fetchOptions = (): RequestInit => (process.env.HATA_ACME_INSECURE === "1" ? ({ tls: { rejectUnauthorized: false } } as RequestInit) : {});

// --- Encoding ---------------------------------------------------------------------------------------

const b64url = (data: Uint8Array | ArrayBuffer | string): string => Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer)).toString("base64url");

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** One DER element: tag, length, content */
export function der(tag: number, ...content: (Uint8Array | number[])[]): Uint8Array {
  const body = concat(...content);
  const length = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 255];
  return concat([tag], length, body);
}

/** A big-endian unsigned number as a DER INTEGER */
function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.slice(start);
  // a set top bit would read as a negative number
  return der(0x02, trimmed[0]! & 0x80 ? [0] : [], trimmed);
}

const OID_COMMON_NAME = [0x06, 0x03, 0x55, 0x04, 0x03];
const OID_EXTENSION_REQUEST = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x0e];
const OID_SUBJECT_ALT_NAME = [0x06, 0x03, 0x55, 0x1d, 0x11];
const OID_ECDSA_SHA256 = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];

const pem = (label: string, bytes: Uint8Array | ArrayBuffer): string =>
  `-----BEGIN ${label}-----\n${Buffer.from(new Uint8Array(bytes as ArrayBuffer)).toString("base64").replace(/(.{64})/g, "$1\n").trimEnd()}\n-----END ${label}-----\n`;

const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/** A certificate signing request (PKCS #10) for one name, signed with its key */
export async function certificateRequest(name: string, keys: CryptoKeyPair): Promise<Uint8Array> {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const dnsName = der(0x82, new TextEncoder().encode(name));
  const extensions = der(0x30, der(0x30, OID_SUBJECT_ALT_NAME, der(0x04, der(0x30, dnsName))));
  const info = der(
    0x30,
    [0x02, 0x01, 0x00],
    der(0x30, der(0x31, der(0x30, OID_COMMON_NAME, der(0x0c, new TextEncoder().encode(name))))),
    spki,
    der(0xa0, der(0x30, OID_EXTENSION_REQUEST, der(0x31, extensions))),
  );
  // WebCrypto signs to r‖s; X.509 wants the two as a DER sequence of integers
  const raw = new Uint8Array(await crypto.subtle.sign(SIGN, keys.privateKey, info));
  const signature = der(0x30, derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
  return der(0x30, info, der(0x30, OID_ECDSA_SHA256), der(0x03, [0], signature));
}

// --- The account and signed requests ----------------------------------------------------------------

interface Account {
  directory: string;
  key: JsonWebKey;
  /** The account's URL at the authority */
  kid: string;
}

interface Directory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
}

class AcmeError extends Error {
  constructor(
    message: string,
    readonly type = "",
  ) {
    super(message);
  }
}

class Client {
  private nonce = "";
  private constructor(
    private directory: Directory,
    private key: CryptoKey,
    private jwk: { crv: string; kty: string; x: string; y: string },
    private kid: string,
  ) {}

  /** Loads the account, or registers one with the authority */
  static async open(email: string): Promise<Client> {
    mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });
    const res = await fetch(directoryUrl(), { ...fetchOptions(), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new AcmeError(`The certificate authority answered ${res.status}`);
    const directory = (await res.json()) as Directory;

    let account = readJsonFile<Account | null>(ACCOUNT_FILE, null);
    if (account && account.directory !== directoryUrl()) account = null;
    const pair = account ? null : await crypto.subtle.generateKey(EC, true, ["sign", "verify"]);
    const privateJwk = account ? account.key : await crypto.subtle.exportKey("jwk", pair!.privateKey);
    const key = await crypto.subtle.importKey("jwk", privateJwk, EC, false, ["sign"]);
    const jwk = { crv: privateJwk.crv!, kty: privateJwk.kty!, x: privateJwk.x!, y: privateJwk.y! };
    const client = new Client(directory, key, jwk, account?.kid ?? "");
    if (!account) {
      const created = await client.post(directory.newAccount, { termsOfServiceAgreed: true, ...(email ? { contact: [`mailto:${email}`] } : {}) });
      client.kid = created.headers.get("location") ?? "";
      if (!client.kid) throw new AcmeError("The certificate authority did not return an account");
      writeJsonAtomic(ACCOUNT_FILE, { directory: directoryUrl(), key: privateJwk, kid: client.kid } satisfies Account);
    }
    return client;
  }

  /** `SHA-256(account key)`, the second half of a challenge's answer */
  async thumbprint(): Promise<string> {
    const { crv, kty, x, y } = this.jwk;
    return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ crv, kty, x, y }))));
  }

  /** A signed POST; `payload` null is a "POST-as-GET" */
  async post(url: string, payload: unknown, retry = true): Promise<Response> {
    if (!this.nonce) {
      const head = await fetch(this.directory.newNonce, { ...fetchOptions(), method: "HEAD", signal: AbortSignal.timeout(20_000) });
      this.nonce = head.headers.get("replay-nonce") ?? "";
    }
    const header = { alg: "ES256", nonce: this.nonce, url, ...(this.kid ? { kid: this.kid } : { jwk: this.jwk }) };
    const protectedPart = b64url(JSON.stringify(header));
    const payloadPart = payload === null ? "" : b64url(JSON.stringify(payload));
    const signature = b64url(await crypto.subtle.sign(SIGN, this.key, new TextEncoder().encode(`${protectedPart}.${payloadPart}`)));
    const res = await fetch(url, {
      ...fetchOptions(),
      method: "POST",
      headers: { "content-type": "application/jose+json" },
      body: JSON.stringify({ protected: protectedPart, payload: payloadPart, signature }),
      signal: AbortSignal.timeout(30_000),
    });
    this.nonce = res.headers.get("replay-nonce") ?? "";
    if (res.ok) return res;
    const problem = (await res.json().catch(() => ({}))) as { type?: string; detail?: string };
    // the authority may retire a nonce at any time: the same request with a fresh one is fine
    if (retry && problem.type?.endsWith(":badNonce")) return this.post(url, payload, false);
    throw new AcmeError(problem.detail || `The certificate authority answered ${res.status}`, problem.type);
  }

  newOrder(name: string): Promise<Response> {
    return this.post(this.directory.newOrder, { identifiers: [{ type: "dns", value: name }] });
  }
}

// --- Challenges -------------------------------------------------------------------------------------

/** Tokens the authority may ask for right now, and what to answer */
const challenges = new Map<string, string>();

/** The answer to `GET /.well-known/acme-challenge/<token>`, or null */
export const challengeResponse = (token: string): string | null => challenges.get(token) ?? null;

// --- Certificates -----------------------------------------------------------------------------------

export interface StoredCertificate {
  name: string;
  cert: string;
  key: string;
  /** ms since epoch */
  notAfter: number;
  issuer: string;
}

const certFile = (name: string) => join(CERTS_DIR, name + ".json");

export function loadCertificates(): StoredCertificate[] {
  let files: string[] = [];
  try {
    files = readdirSync(CERTS_DIR);
  } catch {}
  return files
    .filter((f) => f.endsWith(".json") && f !== "account.json" && DOMAIN_RE.test(f.slice(0, -5)))
    .map((f) => readJsonFile<StoredCertificate | null>(join(CERTS_DIR, f), null))
    .filter((c): c is StoredCertificate => !!c && typeof c.cert === "string" && typeof c.key === "string");
}

export function forgetCertificate(name: string): void {
  if (DOMAIN_RE.test(name)) rmSync(certFile(name), { force: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks until the object at `url` leaves the given waiting states */
async function poll(client: Client, url: string, waiting: string[]): Promise<Record<string, unknown>> {
  for (let i = 0; i < 40; i++) {
    const body = (await (await client.post(url, null)).json()) as Record<string, unknown>;
    if (!waiting.includes(String(body.status))) return body;
    await sleep(i < 5 ? 1000 : 3000);
  }
  throw new AcmeError("The certificate authority took too long");
}

/** Gets a certificate for one name. The name must lead to this server's port 80 from where the authority is. */
export async function issueCertificate(name: string, email: string): Promise<StoredCertificate> {
  if (!DOMAIN_RE.test(name)) throw new AcmeError(`"${name}" is not a host name`);
  const client = await Client.open(email);
  const orderResponse = await client.newOrder(name);
  const orderUrl = orderResponse.headers.get("location") ?? "";
  const order = (await orderResponse.json()) as { authorizations: string[]; finalize: string };
  const used: string[] = [];
  try {
    for (const authUrl of order.authorizations) {
      const auth = (await (await client.post(authUrl, null)).json()) as { status: string; challenges: { type: string; url: string; token: string }[] };
      if (auth.status === "valid") continue;
      const http = auth.challenges.find((c) => c.type === "http-01");
      if (!http) throw new AcmeError("The certificate authority offers no HTTP check for this name");
      challenges.set(http.token, `${http.token}.${await client.thumbprint()}`);
      used.push(http.token);
      await client.post(http.url, {});
      const checked = (await poll(client, authUrl, ["pending", "processing"])) as { status: string; challenges?: { error?: { detail?: string } }[] };
      if (checked.status !== "valid") {
        const why = checked.challenges?.map((c) => c.error?.detail).find(Boolean);
        throw new AcmeError(why ?? `The name could not be confirmed (${checked.status})`);
      }
    }
    const keys = await crypto.subtle.generateKey(EC, true, ["sign", "verify"]);
    await client.post(order.finalize, { csr: b64url(await certificateRequest(name, keys)) });
    const done = (await poll(client, orderUrl, ["pending", "ready", "processing"])) as { status: string; certificate?: string };
    if (done.status !== "valid" || !done.certificate) throw new AcmeError(`The order ended as "${done.status}"`);
    const cert = await (await client.post(done.certificate, null)).text();
    const parsed = new X509Certificate(cert);
    const stored: StoredCertificate = {
      name,
      cert,
      key: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", keys.privateKey)),
      notAfter: new Date(parsed.validTo).getTime(),
      issuer: /(?:^|\n)O=([^\n]+)/.exec(parsed.issuer)?.[1] ?? /(?:^|\n)CN=([^\n]+)/.exec(parsed.issuer)?.[1] ?? "",
    };
    writeJsonAtomic(certFile(name), stored);
    return stored;
  } finally {
    for (const token of used) challenges.delete(token);
  }
}

// --- Keeping certificates current -------------------------------------------------------------------

const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000;
/** After a failure a name is left alone for a while: authorities limit failed attempts per name */
const RETRY_AFTER_MS = 60 * 60 * 1000;

export interface CertificateState {
  name: string;
  /** ms since epoch; null — there is no certificate yet */
  notAfter: number | null;
  issuer: string;
  /** Being requested right now */
  working: boolean;
  /** Why the last attempt failed */
  error: string;
}

const failures = new Map<string, { at: number; message: string }>();
const working = new Set<string>();
let running: Promise<boolean> | null = null;

export function certificateStates(names: string[]): CertificateState[] {
  const stored = new Map(loadCertificates().map((c) => [c.name, c]));
  return names.map((name) => ({
    name,
    notAfter: stored.get(name)?.notAfter ?? null,
    issuer: stored.get(name)?.issuer ?? "",
    working: working.has(name),
    error: failures.get(name)?.message ?? "",
  }));
}

/**
 * Makes sure each name has a certificate that is not about to expire. Returns whether any certificate
 * changed (the HTTPS listener then has to pick them up). `force` retries names that failed recently.
 */
export function ensureCertificates(names: string[], force = false): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    if (!existsSync(CERTS_DIR)) mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });
    const stored = new Map(loadCertificates().map((c) => [c.name, c]));
    let changed = false;
    for (const name of names) {
      const have = stored.get(name);
      if (have && have.notAfter - Date.now() > RENEW_BEFORE_MS) continue;
      const failed = failures.get(name);
      if (!force && failed && Date.now() - failed.at < RETRY_AFTER_MS) continue;
      working.add(name);
      try {
        await issueCertificate(name, settings.https.email);
        failures.delete(name);
        changed = true;
        console.log(`Certificate issued for ${name}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.set(name, { at: Date.now(), message });
        console.error(`No certificate for ${name}: ${message}`);
      } finally {
        working.delete(name);
      }
    }
    return changed;
  })().finally(() => {
    running = null;
  });
  return running;
}
