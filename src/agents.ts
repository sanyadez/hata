/**
 * Access keys for programs: an AI agent (or a script) reaches Hata's MCP server with one of these instead
 * of a person's session.
 *
 * - A key is shown once, when it is made; only its SHA-256 is stored, next to the other secrets.
 * - A key has a level, and a level is the whole of what it may do — see `LEVELS`. No level reaches the
 *   users, the passwords, the keys themselves or a shell: those stay with a signed-in administrator.
 * - A key is not tied to the administrator who made it: it works until it is removed.
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
  /** SHA-256 of the key, hex */
  hash: string;
  /** The last characters of the key, to tell one from another in the list */
  hint: string;
  createdAt: number;
  createdBy: string;
  /** When and from where the key was last used; 0 — never */
  lastUsed: number;
  lastIp: string;
}

const FILE = join(SECRETS_DIR, "agents.json");
const PREFIX = "hata_";
const MAX_KEYS = 20;
/** How often the "last used" of a key is written down: an agent calls many times a minute */
const SEEN_EVERY_MS = 60_000;

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const keys: AgentKey[] = readJsonFile<AgentKey[]>(FILE, [], Array.isArray).filter((k) => LEVELS.includes(k.level));

const save = (): void => writeJsonAtomic(FILE, keys);

export const publicKey = ({ hash: _, ...key }: AgentKey) => key;
export const listKeys = () => keys.map(publicKey);

/** Makes a key; the `key` of the answer is the only time it is seen. A string is an error code. */
export function createKey(name: unknown, level: unknown, by: string): { key: string; info: ReturnType<typeof publicKey> } | string {
  const label = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!label || label.length > 40) return "agents.badName";
  if (!LEVELS.includes(level as Level)) return "agents.badLevel";
  if (keys.some((k) => k.name.toLowerCase() === label.toLowerCase())) return "agents.nameTaken";
  if (keys.length >= MAX_KEYS) return "agents.tooMany";
  const key = PREFIX + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const made: AgentKey = { id: crypto.randomUUID(), name: label, level: level as Level, hash: sha256(key), hint: key.slice(-4), createdAt: Date.now(), createdBy: by, lastUsed: 0, lastIp: "" };
  keys.push(made);
  save();
  return { key, info: publicKey(made) };
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
