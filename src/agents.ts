/**
 * Access keys for programs: an AI agent (or a script) reaches Hata's MCP server with one of these instead
 * of a person's session.
 *
 * - A key is shown once, when it is made; only its SHA-256 is stored, next to the other secrets.
 * - A key has a level, and a level is the whole of what it may do — see `LEVELS`. No level reaches the
 *   users, the passwords, the keys themselves or a shell: those stay with a signed-in administrator.
 * - A key is not tied to the administrator who made it: it works until it is removed.
 * - A connector that signs in (`oauth.ts`) gets a key of the same kind, listed and removed with the
 *   others; its secret is a token that lasts an hour and a second one the connector renews it with.
 */
import { join } from "node:path";
import { SECRETS_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";

/**
 * read — looks: state, apps, logs, backups, disks, the store;
 * operate — also runs what is there: start, stop, update, install from the store, take a snapshot;
 * full — also changes and destroys: compose files, removing an app, restoring a snapshot.
 */
export const LEVELS = ["read", "operate", "full"] as const;
export type Level = (typeof LEVELS)[number];

/** Whether a key of level `have` may do what needs level `need` */
export const allows = (have: Level, need: Level): boolean => LEVELS.indexOf(have) >= LEVELS.indexOf(need);

export interface AgentKey {
  id: string;
  name: string;
  level: Level;
  /** Calls that may destroy something wait for an administrator's word in Hata (`approvals.ts`) */
  confirm: boolean;
  /** SHA-256 of the key, hex */
  hash: string;
  /** The last characters of the key, to tell one from another in the list */
  hint: string;
  createdAt: number;
  createdBy: string;
  /** When and from where the key was last used; 0 — never */
  lastUsed: number;
  lastIp: string;
  /** A key a connector got by signing in: `hash` is its token of the moment */
  oauth?: {
    /** The registered client the tokens belong to, and its name as it was allowed */
    client: string;
    clientName: string;
    /** SHA-256 of the token the next ones are asked with; "" — none given out yet */
    refresh: string;
    /** When the token of the moment stops working */
    expires: number;
  };
}

export interface Tokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: Level;
}

const FILE = join(SECRETS_DIR, "agents.json");
const PREFIX = "hata_";
const MAX_KEYS = 20;
/** How often the "last used" of a key is written down: an agent calls many times a minute */
const SEEN_EVERY_MS = 60_000;
/** How long a connector's token works before it has to be renewed */
export const TOKEN_MS = 3600_000;

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const keys: AgentKey[] = readJsonFile<AgentKey[]>(FILE, [], Array.isArray)
  .filter((k) => LEVELS.includes(k.level))
  .map((k) => ({ ...k, confirm: k.confirm === true }));

const save = (): void => writeJsonAtomic(FILE, keys);

/** A key as the page gets it: `via` names the connector that signed in for it */
export const publicKey = ({ hash: _, oauth, ...key }: AgentKey) => ({ ...key, ...(oauth ? { via: oauth.clientName } : {}) });
export const listKeys = () => keys.map(publicKey);

/** Makes a key; the `key` of the answer is the only time it is seen. A string is an error code. */
export function createKey(name: unknown, level: unknown, by: string, confirm = false): { key: string; info: ReturnType<typeof publicKey> } | string {
  const label = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!label || label.length > 40) return "agents.badName";
  if (!LEVELS.includes(level as Level)) return "agents.badLevel";
  if (keys.some((k) => k.name.toLowerCase() === label.toLowerCase())) return "agents.nameTaken";
  if (keys.length >= MAX_KEYS) return "agents.tooMany";
  const key = PREFIX + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const made: AgentKey = { id: crypto.randomUUID(), name: label, level: level as Level, confirm, hash: sha256(key), hint: key.slice(-4), createdAt: Date.now(), createdBy: by, lastUsed: 0, lastIp: "" };
  keys.push(made);
  save();
  return { key, info: publicKey(made) };
}

/** A name no other key has: the given one, or with a number after it */
function freeName(wanted: string): string {
  const taken = (name: string) => keys.some((k) => k.name.toLowerCase() === name.toLowerCase());
  for (let n = 1; ; n++) {
    const name = n === 1 ? wanted : `${wanted.slice(0, 36)} (${n})`;
    if (!taken(name)) return name;
  }
}

/** What an administrator allowed a connector: becomes its key when the connector comes for the tokens */
export interface Grant {
  level: Level;
  confirm: boolean;
  by: string;
}

/** Whether a connector could be given a key of this level now; the error code when not */
export const cannotGrant = (level: unknown): string | null => (!LEVELS.includes(level as Level) ? "agents.badLevel" : keys.length >= MAX_KEYS ? "agents.tooMany" : null);

/** Makes the key of a connector an administrator allowed, and its first tokens; null — there is no room for it */
export function grantKey(client: { id: string; name: string }, grant: Grant, now = Date.now()): Tokens | null {
  if (cannotGrant(grant.level)) return null;
  const made: AgentKey = { id: crypto.randomUUID(), name: freeName(client.name.slice(0, 40) || "MCP client"), level: grant.level, confirm: grant.confirm, hash: "", hint: "", createdAt: now, createdBy: grant.by, lastUsed: 0, lastIp: "", oauth: { client: client.id, clientName: client.name, refresh: "", expires: 0 } };
  keys.push(made);
  return newTokens(made, now);
}

const secret = (kind: "at" | "rt"): string => `${PREFIX}${kind}_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;

function newTokens(key: AgentKey, now: number): Tokens {
  const access = secret("at");
  const refresh = secret("rt");
  key.hash = sha256(access);
  key.oauth!.refresh = sha256(refresh);
  key.oauth!.expires = now + TOKEN_MS;
  save();
  return { access_token: access, token_type: "Bearer", expires_in: TOKEN_MS / 1000, refresh_token: refresh, scope: key.level };
}

/** New tokens for the one that renews: it is spent by this, and the old access token stops working */
export function renewTokens(refresh: unknown, client: unknown, now = Date.now()): Tokens | null {
  if (typeof refresh !== "string" || !refresh.startsWith(PREFIX)) return null;
  const hash = sha256(refresh);
  const key = keys.find((k) => k.oauth?.refresh === hash && k.oauth.client === client);
  return key ? newTokens(key, now) : null;
}

/** Whether the key asks before it destroys; null — no such key */
export function setConfirm(id: string, confirm: boolean): AgentKey | null {
  const key = keys.find((k) => k.id === id);
  if (!key) return null;
  key.confirm = confirm;
  save();
  return key;
}

export function removeKey(id: string): AgentKey | null {
  const i = keys.findIndex((k) => k.id === id);
  if (i < 0) return null;
  const [gone] = keys.splice(i, 1);
  save();
  return gone!;
}

/** The key a request carries in `Authorization: Bearer …`; null — none, or not one of ours */
export function keyOf(req: Request, ip = ""): AgentKey | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || !m[1]!.startsWith(PREFIX)) return null;
  // looked up by the hash of what was sent: nothing here takes longer for a key that is nearly right
  const hash = sha256(m[1]!);
  const key = keys.find((k) => k.hash === hash) ?? null;
  // a connector's token lasts an hour; it knows how to get the next one
  if (key?.oauth && key.oauth.expires <= Date.now()) return null;
  if (key && (Date.now() - key.lastUsed > SEEN_EVERY_MS || key.lastIp !== ip)) {
    key.lastUsed = Date.now();
    key.lastIp = ip;
    save();
  }
  return key;
}

/** How an agent is named where a person's name would stand (the activity log); the UI words the prefix */
export const AGENT_PREFIX = "agent:";
export const agentUser = (key: Pick<AgentKey, "name">): string => AGENT_PREFIX + key.name;
