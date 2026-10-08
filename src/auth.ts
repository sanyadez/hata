/**
 * Users and web UI sessions.
 *
 * - There are no default credentials: until the first administrator exists the server is in setup mode,
 *   and creating that administrator needs the setup token printed on the server's console — otherwise
 *   whoever reaches a fresh install on the network first would own it.
 * - Sessions are cookies; only the SHA-256 of a session token is stored, so a leaked state file does not
 *   give anyone a working session.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";

const USERS_FILE = join(DATA_DIR, "users.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
const SETUP_TOKEN_FILE = join(DATA_DIR, "setup-token");

export const COOKIE_NAME = "hata_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS = 50;
export const MIN_PASSWORD_LENGTH = 8;

export interface User {
  id: string;
  name: string;
  role: "admin";
  passwordHash: string;
  createdAt: number;
}

interface Session {
  /** SHA-256 of the cookie token, hex */
  hash: string;
  userId: string;
  /** Expiry, ms since epoch */
  exp: number;
}

const users: User[] = readJsonFile<User[]>(USERS_FILE, [], Array.isArray);
let sessions: Session[] = readJsonFile<Session[]>(SESSIONS_FILE, [], Array.isArray).filter((s) => s.exp > Date.now());

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const randomToken = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");

function timingSafeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y);
}

// --- Setup ------------------------------------------------------------------------------------------

export const needsSetup = (): boolean => users.length === 0;

/** The setup token of a server without users (created on first call); null once setup is done */
export function setupToken(): string | null {
  if (!needsSetup()) return null;
  if (existsSync(SETUP_TOKEN_FILE)) {
    const saved = readFileSync(SETUP_TOKEN_FILE, "utf8").trim();
    if (saved) return saved;
  }
  const token = randomToken().slice(0, 32);
  writeFileSync(SETUP_TOKEN_FILE, token + "\n", { mode: 0o600 });
  chmodSync(SETUP_TOKEN_FILE, 0o600);
  return token;
}

export function validName(name: unknown): name is string {
  return typeof name === "string" && /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(name);
}

export function validPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH && password.length <= 256;
}

/** Creates the first administrator. Returns an error code or the user */
export async function completeSetup(token: unknown, name: unknown, password: unknown): Promise<User | string> {
  const expected = setupToken();
  if (expected === null) return "setup.done";
  if (typeof token !== "string" || !timingSafeEqual(token, expected)) return "setup.badToken";
  if (!validName(name)) return "auth.badName";
  if (!validPassword(password)) return "auth.weakPassword";
  const passwordHash = await Bun.password.hash(password);
  // setup may have been completed by a parallel request while the password was being hashed
  if (!needsSetup()) return "setup.done";
  const user: User = { id: crypto.randomUUID(), name, role: "admin", passwordHash, createdAt: Date.now() };
  users.push(user);
  writeJsonAtomic(USERS_FILE, users);
  rmSync(SETUP_TOKEN_FILE, { force: true });
  return user;
}

// --- Sign-in ----------------------------------------------------------------------------------------

/** A hash to verify against when the user does not exist, so the response time does not reveal that */
const DUMMY_HASH = Bun.password.hash(randomToken());

export async function checkPassword(name: unknown, password: unknown): Promise<User | null> {
  if (typeof name !== "string" || typeof password !== "string" || password.length > 256) return null;
  const user = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  const ok = await Bun.password.verify(password, user?.passwordHash ?? (await DUMMY_HASH)).catch(() => false);
  return user && ok ? user : null;
}

function saveSessions(): void {
  writeJsonAtomic(SESSIONS_FILE, sessions);
}

export function createSession(user: User): string {
  const now = Date.now();
  const token = randomToken();
  sessions = sessions.filter((s) => s.exp > now);
  sessions.push({ hash: sha256(token), userId: user.id, exp: now + SESSION_TTL_MS });
  if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
  saveSessions();
  return token;
}

function cookieToken(req: Request): string | null {
  const match = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)hata_session=([0-9a-f]{64})(?:;|$)/);
  return match?.[1] ?? null;
}

export function sessionUser(req: Request): User | null {
  const token = cookieToken(req);
  if (!token) return null;
  const hash = sha256(token);
  const session = sessions.find((s) => s.hash === hash && s.exp > Date.now());
  return (session && users.find((u) => u.id === session.userId)) ?? null;
}

export function destroySession(req: Request): void {
  const token = cookieToken(req);
  if (!token) return;
  const hash = sha256(token);
  sessions = sessions.filter((s) => s.hash !== hash);
  saveSessions();
}

/** `secure` — the request came over HTTPS, so the cookie must not travel over plain HTTP */
export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export const publicUser = (u: User) => ({ id: u.id, name: u.name, role: u.role });

// --- Sign-in attempt limiting -----------------------------------------------------------------------

const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const FORGET_MS = 60 * 60_000;

interface Attempts {
  failures: number;
  lockedUntil: number;
  lastFailure: number;
}

const attempts = new Map<string, Attempts>();

/** How many ms sign-in from this address is still locked; 0 — may try */
export function loginBlockedFor(ip: string): number {
  const a = attempts.get(ip);
  if (!a) return 0;
  const now = Date.now();
  if (now - a.lastFailure > FORGET_MS) {
    attempts.delete(ip);
    return 0;
  }
  return Math.max(0, a.lockedUntil - now);
}

/** After FREE_ATTEMPTS failures the lock doubles with every further failure (30 s, 60 s, … up to 15 min) */
export function registerLoginFailure(ip: string): void {
  const now = Date.now();
  const a = attempts.get(ip) ?? { failures: 0, lockedUntil: 0, lastFailure: 0 };
  a.failures++;
  a.lastFailure = now;
  if (a.failures >= FREE_ATTEMPTS) {
    a.lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** (a.failures - FREE_ATTEMPTS), MAX_LOCK_MS);
  }
  attempts.set(ip, a);
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (now - v.lastFailure > FORGET_MS) attempts.delete(k);
  }
}

export function registerLoginSuccess(ip: string): void {
  attempts.delete(ip);
}
