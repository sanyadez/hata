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
import { newSecret, otpauthUri, verifyTotp } from "./totp";

const USERS_FILE = join(DATA_DIR, "users.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
const SETUP_TOKEN_FILE = join(DATA_DIR, "setup-token");

export const COOKIE_NAME = "hata_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS = 50;
export const MIN_PASSWORD_LENGTH = 8;

export type Role = "admin" | "member" | "guest";

export interface User {
  id: string;
  name: string;
  /**
   * An administrator manages the server; a member sees the apps and opens them; a guest is a shared
   * account (the TV in the living room) that opens only the apps it is named for and cannot change itself
   */
  role: Role;
  passwordHash: string;
  createdAt: number;
  lastSignIn?: number;
  /** Two-factor sign-in, once switched on */
  totp?: {
    secret: string;
    /** SHA-256 of the recovery codes that are still unused */
    recovery: string[];
    /** The time step of the last accepted code: a code works once */
    lastStep: number;
  };
  /** A secret shown to the user but not confirmed with a code yet */
  totpPending?: string;
}

interface Session {
  /** Public handle of the session, for the list of sessions */
  id: string;
  /** SHA-256 of the cookie token, hex */
  hash: string;
  userId: string;
  /** Expiry, ms since epoch */
  exp: number;
  createdAt: number;
  lastSeen: number;
  ip: string;
  userAgent: string;
}

const users: User[] = readJsonFile<User[]>(USERS_FILE, [], Array.isArray).map((u) => ({ ...u, role: u.role === "member" || u.role === "guest" ? u.role : "admin" }));
let sessions: Session[] = readJsonFile<Session[]>(SESSIONS_FILE, [], Array.isArray)
  .filter((s) => s.exp > Date.now())
  // sessions written by a version without these fields
  .map((s) => ({ ...s, id: s.id ?? crypto.randomUUID(), createdAt: s.createdAt ?? Date.now(), lastSeen: s.lastSeen ?? Date.now(), ip: s.ip ?? "", userAgent: s.userAgent ?? "" }));

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

export function createSession(user: User, client: { ip: string; userAgent: string }): string {
  const now = Date.now();
  const token = randomToken();
  sessions = sessions.filter((s) => s.exp > now);
  sessions.push({ id: crypto.randomUUID(), hash: sha256(token), userId: user.id, exp: now + SESSION_TTL_MS, createdAt: now, lastSeen: now, ip: client.ip, userAgent: client.userAgent.slice(0, 300) });
  if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
  saveSessions();
  user.lastSignIn = now;
  saveUsers();
  return token;
}

function cookieToken(req: Request): string | null {
  const match = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)hata_session=([0-9a-f]{64})(?:;|$)/);
  return match?.[1] ?? null;
}

const SEEN_EVERY_MS = 5 * 60_000;

export function sessionUser(req: Request): User | null {
  const token = cookieToken(req);
  if (!token) return null;
  const hash = sha256(token);
  const now = Date.now();
  const session = sessions.find((s) => s.hash === hash && s.exp > now);
  if (!session) return null;
  // "last seen" is for the list of sessions: minute precision is plenty, a write per request is not
  if (now - session.lastSeen > SEEN_EVERY_MS) {
    session.lastSeen = now;
    saveSessions();
  }
  return users.find((u) => u.id === session.userId) ?? null;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastSeen: number;
  ip: string;
  userAgent: string;
  /** The session this request came with */
  current: boolean;
}

export function listSessions(user: User, req: Request): SessionInfo[] {
  const token = cookieToken(req);
  const hash = token ? sha256(token) : "";
  const now = Date.now();
  return sessions
    .filter((s) => s.userId === user.id && s.exp > now)
    .map((s) => ({ id: s.id, createdAt: s.createdAt, lastSeen: s.lastSeen, ip: s.ip, userAgent: s.userAgent, current: s.hash === hash }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeen - a.lastSeen);
}

/** Ends one of the user's sessions; false if there is no such session */
export function revokeSession(user: User, id: string): boolean {
  const before = sessions.length;
  sessions = sessions.filter((s) => !(s.userId === user.id && s.id === id));
  if (sessions.length === before) return false;
  saveSessions();
  return true;
}

/** Ends the user's sessions, except the one of `keep` (a request) if given */
export function revokeSessions(user: User, keep?: Request): void {
  const token = keep ? cookieToken(keep) : null;
  const hash = token ? sha256(token) : "";
  sessions = sessions.filter((s) => s.userId !== user.id || s.hash === hash);
  saveSessions();
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

export const publicUser = (u: User) => ({ id: u.id, name: u.name, role: u.role, twoFactor: !!u.totp });

// --- Users ------------------------------------------------------------------------------------------

function saveUsers(): void {
  writeJsonAtomic(USERS_FILE, users);
}

const isRole = (role: unknown): role is Role => role === "admin" || role === "member" || role === "guest";
const admins = (): User[] => users.filter((u) => u.role === "admin");
export const findUser = (id: string): User | null => users.find((u) => u.id === id) ?? null;

export interface UserInfo {
  id: string;
  name: string;
  role: Role;
  twoFactor: boolean;
  createdAt: number;
  lastSignIn: number | null;
  sessions: number;
}

export function listUsers(): UserInfo[] {
  const now = Date.now();
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    twoFactor: !!u.totp,
    createdAt: u.createdAt,
    lastSignIn: u.lastSignIn ?? null,
    sessions: sessions.filter((s) => s.userId === u.id && s.exp > now).length,
  }));
}

/** Returns the new user or an error code */
export async function createUser(name: unknown, password: unknown, role: unknown): Promise<User | string> {
  if (!validName(name)) return "auth.badName";
  if (!validPassword(password)) return "auth.weakPassword";
  if (!isRole(role)) return "users.badRole";
  if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) return "users.nameTaken";
  const user: User = { id: crypto.randomUUID(), name, role, passwordHash: await Bun.password.hash(password), createdAt: Date.now() };
  users.push(user);
  saveUsers();
  return user;
}

/**
 * An administrator changes another user: the role, a new password, switching 2FA off (for someone who
 * lost their phone). Returns an error code or null. The last administrator cannot be demoted.
 */
export async function updateUser(id: string, patch: Record<string, unknown>): Promise<string | null> {
  const user = findUser(id);
  if (!user) return "users.notFound";
  if ("role" in patch) {
    if (!isRole(patch.role)) return "users.badRole";
    if (user.role === "admin" && patch.role !== "admin" && admins().length === 1) return "users.lastAdmin";
  }
  if ("password" in patch && !validPassword(patch.password)) return "auth.weakPassword";
  if ("role" in patch) user.role = patch.role as Role;
  if ("password" in patch) {
    user.passwordHash = await Bun.password.hash(patch.password as string);
    // whoever knew the old password must not stay signed in
    revokeSessions(user);
  }
  if (patch.twoFactor === false) {
    delete user.totp;
    delete user.totpPending;
  }
  saveUsers();
  return null;
}

export function deleteUser(id: string, acting: User): string | null {
  const user = findUser(id);
  if (!user) return "users.notFound";
  if (user.id === acting.id) return "users.self";
  if (user.role === "admin" && admins().length === 1) return "users.lastAdmin";
  users.splice(users.indexOf(user), 1);
  saveUsers();
  revokeSessions(user);
  return null;
}

/** The user changes their own password; other sessions end, the one of `req` stays */
export async function changePassword(user: User, current: unknown, next: unknown, req: Request): Promise<string | null> {
  if (typeof current !== "string" || !(await Bun.password.verify(current, user.passwordHash).catch(() => false))) return "auth.wrongPassword";
  if (!validPassword(next)) return "auth.weakPassword";
  user.passwordHash = await Bun.password.hash(next);
  saveUsers();
  revokeSessions(user, req);
  return null;
}

// --- Sign-in log ------------------------------------------------------------------------------------
// Kept apart from the activity log: a stranger guessing passwords must not push everything else out of it.

const SIGNINS_FILE = join(DATA_DIR, "signins.json");
const KEEP_SIGNINS = 200;

export interface SignIn {
  ts: number;
  /** The name as typed — it may not be a user */
  name: string;
  ip: string;
  outcome: "ok" | "wrongPassword" | "wrongCode" | "locked";
}

let signIns: SignIn[] = readJsonFile<SignIn[]>(SIGNINS_FILE, [], Array.isArray);

export function recordSignIn(name: unknown, ip: string, outcome: SignIn["outcome"]): void {
  signIns.push({ ts: Date.now(), name: typeof name === "string" ? name.slice(0, 32) : "", ip, outcome });
  if (signIns.length > KEEP_SIGNINS) signIns = signIns.slice(-KEEP_SIGNINS);
  try {
    writeJsonAtomic(SIGNINS_FILE, signIns);
  } catch {}
}

/** Newest first */
export const listSignIns = (limit = 50): SignIn[] => signIns.slice(-limit).reverse();

// --- Invitations ------------------------------------------------------------------------------------

const INVITES_FILE = join(DATA_DIR, "invites.json");
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

interface Invite {
  id: string;
  /** SHA-256 of the token in the link */
  hash: string;
  role: Role;
  /** A note for the administrator: who the link is for */
  note: string;
  createdBy: string;
  exp: number;
}

let invites: Invite[] = readJsonFile<Invite[]>(INVITES_FILE, [], Array.isArray).filter((i) => i.exp > Date.now());

function saveInvites(): void {
  writeJsonAtomic(INVITES_FILE, invites);
}

export const listInvites = () => invites.filter((i) => i.exp > Date.now()).map(({ hash: _, ...invite }) => invite);

/** Creates a single-use link token for a new account. Administrators are not made by link. */
export function createInvite(role: unknown, note: unknown, by: User): { token: string; id: string } | string {
  if (role !== "member" && role !== "guest") return "users.badRole";
  const token = randomToken().slice(0, 40);
  const invite: Invite = { id: crypto.randomUUID(), hash: sha256(token), role, note: typeof note === "string" ? note.slice(0, 80) : "", createdBy: by.name, exp: Date.now() + INVITE_TTL_MS };
  invites = [...invites.filter((i) => i.exp > Date.now()), invite];
  saveInvites();
  return { token, id: invite.id };
}

export function revokeInvite(id: string): boolean {
  const before = invites.length;
  invites = invites.filter((i) => i.id !== id);
  saveInvites();
  return invites.length !== before;
}

const findInvite = (token: unknown): Invite | null => (typeof token === "string" ? (invites.find((i) => i.hash === sha256(token) && i.exp > Date.now()) ?? null) : null);

/** What the invitation page shows before the account exists; null — the link is wrong, used or expired */
export const inviteInfo = (token: unknown): { role: Role } | null => {
  const invite = findInvite(token);
  return invite ? { role: invite.role } : null;
};

/** Creates the account an invitation is for and uses the invitation up */
export async function acceptInvite(token: unknown, name: unknown, password: unknown): Promise<User | string> {
  const invite = findInvite(token);
  if (!invite) return "invite.invalid";
  const user = await createUser(name, password, invite.role);
  if (typeof user === "string") return user;
  // two requests with the same link: the first to finish hashing wins, the other account is taken back
  if (!invites.includes(invite)) {
    users.splice(users.indexOf(user), 1);
    saveUsers();
    return "invite.invalid";
  }
  invites = invites.filter((i) => i !== invite);
  saveInvites();
  return user;
}

// --- Two-factor sign-in -----------------------------------------------------------------------------

const RECOVERY_CODES = 8;
const recoveryHash = (code: string): string => sha256(code.toLowerCase().replace(/[\s-]/g, ""));

/** Starts switching 2FA on: a fresh secret that takes effect once confirmed with a code */
export function beginTotp(user: User): { secret: string; uri: string } {
  user.totpPending = newSecret();
  saveUsers();
  return { secret: user.totpPending, uri: otpauthUri(user.name, user.totpPending) };
}

/** Confirms the pending secret. Returns the recovery codes (shown once) or an error code. */
export function enableTotp(user: User, code: unknown): string[] | string {
  if (!user.totpPending) return "totp.notStarted";
  const step = typeof code === "string" ? verifyTotp(user.totpPending, code, Date.now()) : null;
  if (step === null) return "totp.wrongCode";
  const codes = Array.from({ length: RECOVERY_CODES }, () => {
    const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(5))).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  user.totp = { secret: user.totpPending, recovery: codes.map(recoveryHash), lastStep: step };
  delete user.totpPending;
  saveUsers();
  return codes;
}

export async function disableTotp(user: User, password: unknown): Promise<string | null> {
  if (typeof password !== "string" || !(await Bun.password.verify(password, user.passwordHash).catch(() => false))) return "auth.wrongPassword";
  delete user.totp;
  delete user.totpPending;
  saveUsers();
  return null;
}

/** The second step of signing in: a code from the app, or a recovery code (which is then used up) */
export function checkSecondFactor(user: User, code: unknown): boolean {
  if (!user.totp || typeof code !== "string" || code.length > 64) return false;
  const step = verifyTotp(user.totp.secret, code, Date.now(), user.totp.lastStep);
  if (step !== null) {
    user.totp.lastStep = step;
    saveUsers();
    return true;
  }
  const at = user.totp.recovery.indexOf(recoveryHash(code));
  if (at < 0) return false;
  user.totp.recovery.splice(at, 1);
  saveUsers();
  return true;
}

export const recoveryCodesLeft = (user: User): number => user.totp?.recovery.length ?? 0;

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
