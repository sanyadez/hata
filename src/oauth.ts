/**
 * Signing an agent in instead of pasting a key: the OAuth side of the MCP server.
 *
 * A connector that lives in somebody's browser or cloud has nowhere to paste a key into. It is given
 * the address of `/mcp` alone, finds out from there where to ask (`resourceMetadata`, `serverMetadata`),
 * registers itself (`register`), and sends the person to Hata, where an administrator signs in and
 * says what the connector may do. What comes out is an access key like the ones made by hand — listed
 * and removed in the same place — only its secret is a short-lived token the connector renews itself.
 *
 * Hata is its own authorization server, as small as the MCP specification lets it be: public clients
 * only (no client secrets), the authorization code with PKCE (S256), refresh tokens that rotate.
 * Registering is open to whoever reaches the server and gives nothing by itself: nothing is granted
 * until a signed-in administrator allows it with the password.
 *
 * The checks are pure functions; the state is the registered clients (`oauth.json`, with the secrets)
 * and, in memory, what is under way: the questions put to an administrator and the codes given out.
 */
import { join } from "node:path";
import { LEVELS, type Grant, type Level } from "./agents";
import { SECRETS_DIR } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";

export interface Client {
  id: string;
  name: string;
  redirects: string[];
  createdAt: number;
  /** When an administrator last allowed it; 0 — never: such a client is the first to be forgotten */
  grantedAt: number;
}

/** What a connector asked for at `/oauth/authorize`, waiting for an administrator's answer */
export interface Pending {
  id: string;
  client: string;
  redirect: string;
  challenge: string;
  state: string;
  /** The level it asked for, when it named one */
  level: Level | "";
  at: number;
}

interface Code {
  hash: string;
  client: string;
  redirect: string;
  challenge: string;
  /** What the administrator allowed: the code is exchanged for a key of this kind */
  grant: Grant;
  at: number;
}

export const PENDING_MS = 10 * 60_000;
export const CODE_MS = 2 * 60_000;
const MAX_CLIENTS = 100;
const MAX_PENDING = 50;
/** A client nobody allowed is kept this long: a registration is made right before the question */
const UNUSED_MS = 24 * 3600_000;

const b64url = (bytes: Uint8Array | ArrayBuffer): string => Buffer.from(bytes as ArrayBuffer).toString("base64url");
export const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");
export const randomToken = (bytes = 32): string => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

// --- Pure checks ------------------------------------------------------------------------------------

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Schemes that run something in the page that follows the redirect, or read the machine */
const NEVER = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "filesystem:"]);

/**
 * Where a connector may be sent back to: an HTTPS address, a program on the person's own computer
 * (`http://localhost:…`), or an app's own scheme (`cursor://…`).
 */
export function redirectAllowed(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2048 || /[\s<>"\\]/.test(uri)) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return !NEVER.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** Exactly a registered address — except that a program on the person's computer may listen on any port */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) return false;
  return registered.some((known) => {
    try {
      const k = new URL(known);
      return k.protocol === "http:" && k.hostname === url.hostname && k.pathname === url.pathname && k.search === url.search;
    } catch {
      return false;
    }
  });
}

/** A registration as it is kept, or the error to answer with (RFC 7591) */
export function cleanRegistration(body: unknown): { name: string; redirects: string[] } | { error: string; error_description: string } {
  if (!isPlainObject(body)) return { error: "invalid_client_metadata", error_description: "A JSON object is expected." };
  const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirects.length === 0 || redirects.length > 10 || !redirects.every(redirectAllowed)) return { error: "invalid_redirect_uri", error_description: "redirect_uris: one to ten addresses — https, http on localhost, or an app's own scheme." };
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return { error: "invalid_client_metadata", error_description: "Only public clients are registered: token_endpoint_auth_method must be \"none\"." };
  // the name is shown to the person who decides: no line breaks or control characters to dress it up with
  const name = (typeof body.client_name === "string" ? body.client_name : "").replace(/[\p{C}\s]+/gu, " ").trim().slice(0, 60);
  return { name: name || "MCP client", redirects: redirects as string[] };
}

/** PKCE, S256: the code is given only to whoever holds what the challenge was made of */
export function pkceOk(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return new Bun.CryptoHasher("sha256").update(verifier).digest("base64url") === challenge;
}

/** `base` is how the caller reached the server: `https://hata.example.com` */
export const resourceMetadata = (base: string) => ({
  resource: `${base}/mcp`,
  authorization_servers: [base],
  bearer_methods_supported: ["header"],
  scopes_supported: [...LEVELS],
  resource_name: "Hata",
});

export const serverMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/oauth/authorize`,
  token_endpoint: `${base}/oauth/token`,
  registration_endpoint: `${base}/oauth/register`,
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [...LEVELS],
});

/** The address a connector is sent back to, with the answer in its query */
export function backTo(redirect: string, answer: Record<string, string>): string {
  const url = new URL(redirect);
  for (const [name, value] of Object.entries(answer)) if (value) url.searchParams.set(name, value);
  return url.href;
}

/**
 * Reads the query of `/oauth/authorize`. `refuse` — the request cannot be trusted enough to send the
 * person anywhere (unknown client, an address it did not register): said on the spot. `back` — the
 * connector is told what is wrong at its own address.
 */
export function readAuthorize(query: URLSearchParams, client: Client | undefined): { refuse: string } | { back: string } | { ask: Omit<Pending, "id" | "at"> } {
  if (!client) return { refuse: "This connector is not registered with this server (unknown client_id). Remove it in the program and add it again." };
  const redirect = query.get("redirect_uri") ?? (client.redirects.length === 1 ? client.redirects[0]! : "");
  if (!redirect || !redirectMatches(client.redirects, redirect)) return { refuse: "The address to return to (redirect_uri) is not one this connector registered." };
  const state = query.get("state") ?? "";
  const back = (error: string, error_description: string) => ({ back: backTo(redirect, { error, error_description, state }) });
  if (query.get("response_type") !== "code") return back("unsupported_response_type", "response_type must be \"code\".");
  const challenge = query.get("code_challenge") ?? "";
  if ((query.get("code_challenge_method") ?? "plain") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back("invalid_request", "PKCE is required: code_challenge with code_challenge_method=S256.");
  if (state.length > 1024) return back("invalid_request", "state is too long.");
  // a level it names is offered first — one level: a client that lists them all has only read the list back
  const asked = (query.get("scope") ?? "").split(/\s+/).filter((s): s is Level => LEVELS.includes(s as Level));
  const level = asked.length === 1 ? asked[0]! : "";
  return { ask: { client: client.id, redirect, challenge, state, level } };
}

// --- State ------------------------------------------------------------------------------------------

const FILE = join(SECRETS_DIR, "oauth.json");
let clients: Client[] = readJsonFile<Client[]>(FILE, [], Array.isArray).filter((c) => isPlainObject(c) && typeof c.id === "string" && Array.isArray(c.redirects));
let pending: Pending[] = [];
let codes: Code[] = [];

const save = (): void => writeJsonAtomic(FILE, clients);

/** Which clients to keep when there is no room: the ones somebody allowed, then the newest */
export function keepClients(all: Client[], now: number, max = MAX_CLIENTS): Client[] {
  const fresh = all.filter((c) => c.grantedAt > 0 || now - c.createdAt < UNUSED_MS);
  return fresh.sort((a, b) => Number(b.grantedAt > 0) - Number(a.grantedAt > 0) || b.createdAt - a.createdAt).slice(0, max);
}

export const findClient = (id: string | null): Client | undefined => clients.find((c) => c.id === id);

/** Registers a connector; the answer is the body of the reply, with `error` when it is refused */
export function register(body: unknown): Record<string, unknown> {
  const clean = cleanRegistration(body);
  if ("error" in clean) return clean;
  const now = Date.now();
  const client: Client = { id: crypto.randomUUID(), name: clean.name, redirects: clean.redirects, createdAt: now, grantedAt: 0 };
  clients = keepClients([...clients, client], now);
  save();
  return { client_id: client.id, client_id_issued_at: Math.floor(now / 1000), client_name: client.name, redirect_uris: client.redirects, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

/** Keeps the question for the page that asks the administrator; returns its id */
export function holdQuestion(ask: Omit<Pending, "id" | "at">): string {
  const now = Date.now();
  pending = pending.filter((p) => now - p.at < PENDING_MS).slice(-MAX_PENDING + 1);
  const id = crypto.randomUUID();
  pending.push({ ...ask, id, at: now });
  return id;
}

export function question(id: string): (Pending & { name: string }) | null {
  const found = pending.find((p) => p.id === id && Date.now() - p.at < PENDING_MS);
  const client = found && findClient(found.client);
  return found && client ? { ...found, name: client.name } : null;
}

/** The administrator said no: the question is gone, the connector is told at its address */
export function declined(id: string): string | null {
  const q = question(id);
  if (!q) return null;
  pending = pending.filter((p) => p.id !== id);
  return backTo(q.redirect, { error: "access_denied", error_description: "The administrator declined.", state: q.state });
}

/** The administrator said yes: where to send the browser, with the code the connector gets its key for */
export function allowed(id: string, grant: Grant): string | null {
  const q = question(id);
  if (!q) return null;
  pending = pending.filter((p) => p.id !== id);
  const now = Date.now();
  const code = randomToken();
  codes = [...codes.filter((c) => now - c.at < CODE_MS), { hash: sha256(code), client: q.client, redirect: q.redirect, challenge: q.challenge, grant, at: now }];
  const client = findClient(q.client);
  if (client) {
    client.grantedAt = now;
    save();
  }
  return backTo(q.redirect, { code, state: q.state });
}

/**
 * Spends a code: what was allowed and to which client, or null. A code is good once — whoever comes
 * second with it gets nothing, whether the first try held the right proof or not.
 */
export function spendCode(input: { code: unknown; client: unknown; redirect: unknown; verifier: unknown }): { client: Client; grant: Grant } | null {
  if (typeof input.code !== "string") return null;
  const hash = sha256(input.code);
  const found = codes.find((c) => c.hash === hash);
  if (!found) return null;
  codes = codes.filter((c) => c !== found);
  if (Date.now() - found.at >= CODE_MS || found.client !== input.client) return null;
  // the address is repeated by clients of the older rules; when it is, it must be the same one
  if (input.redirect !== undefined && input.redirect !== null && input.redirect !== found.redirect) return null;
  const client = findClient(found.client);
  return client && pkceOk(input.verifier, found.challenge) ? { client, grant: found.grant } : null;
}
