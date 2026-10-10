/**
 * The HTTP server: the web UI's files and the JSON API behind it.
 *
 * Access rules, in one place:
 * - the UI shell (HTML, CSS, JS, translations) is public — it holds no data;
 * - `/api/state`, `/api/setup` and `/api/login` are public by necessity;
 * - everything else under `/api/` needs a session cookie;
 * - a request that changes something must come from this origin (CSRF) and carry JSON.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import type { Server, ServerWebSocket } from "bun";
import { recent, record } from "./activity";
import { AppError, appAction, appDetail, appLogs, appIcon, appSettings, appStats, applyCompose, ICON_MIME, MAX_ICON, removeAppIcon, setAppIcon, applySettings, installFromSettings, applyStoreUpdate, composeText, getJob, installCustom, installFromStore, listApps, listJobs, onAppRemoved, planStoreUpdate, readCompose, removeApp, storeAppDetail } from "./apps";
import { certificateStates, challengeResponse, ensureCertificates, loadCertificates } from "./acme";
import { attention } from "./attention";
import { backupApp, backupOverview, deleteSnapshot, listSnapshots, mirror, restoreSnapshot, resumeRestore, runBackups, scheduleBackups, takeServerSnapshot } from "./backup";
import { checkOffsite, forgetHost, offsiteFailure, saveOffsite } from "./offsite";
import { APP_NAME_RE, dumpCompose } from "./appform";
import { addShare, changeShare, installSamba, listShares, removeShare, startShares } from "./shares";
import { checkDisks, diskHealth, installTool, listDisks, startDisks, startSelfTest } from "./disks";
import {
  acceptInvite,
  addPasskey,
  checkOwnPassword,
  findPasskey,
  listPasskeys,
  passkeyUsed,
  removePasskey,
  beginTotp,
  createInvite,
  inviteInfo,
  listInvites,
  listSignIns,
  recordSignIn,
  revokeInvite,
  revokeSessions,
  type Role,
  changePassword,
  checkPassword,
  checkSecondFactor,
  clearSessionCookie,
  completeSetup,
  createSession,
  createUser,
  deleteUser,
  destroySession,
  disableTotp,
  enableTotp,
  findUser,
  listSessions,
  listUsers,
  recoveryCodesLeft,
  revokeSession,
  updateUser,
  loginBlockedFor,
  needsSetup,
  publicUser,
  registerLoginFailure,
  registerLoginSuccess,
  sessionCookie,
  sessionUser,
  setupToken,
} from "./auth";
import { bus } from "./bus";
import { DATA_DIR, dropOldSecrets, listenAddress, saveSettings, settings, timezone, updateSettings } from "./config";
import { arrange, cleanLayout, layoutText, parseLayoutText } from "./dashboard";
import { dockerInfo, listContainers, watchEvents } from "./docker";
import { abortUpload, archivePlan, list as listFiles, makeFolder, pinFolder, pinnedFolders, readable, readText, remove as removeFiles, rename as renameFile, summary as filesSummary, transfer, upload, writeText } from "./files";
import { adoptProject, casaosState, containerDraft, importCount, importList, moveInCasaos, projectDraft, rebuildContainer } from "./import";
import { accessOf, dropAccess, dropUser, gateTarget, guard, mayOpen, MAX_APP_BODY, page, passToApp, setAccess, startGates, tunnelHandlers } from "./gate";
import { parseDockerRun } from "./dockerrun";
import { cannotMove, finishMove, moveState } from "./relocate";
import { isPlainObject } from "./fsutil";
import { localNamesStatus, refreshLocalNames } from "./mdns";
import { addDevice, CHANNELS, listDevices, notifyStatus, pushKey, removeDevice, sendTest, startNotifications, telegramChats, updateNotify } from "./notify";
import { appHost, appLabel, classifyHost, clientIp, cookieDomain, domainOf, localDomain, requestHost, requestPort, requestProto, siteDomain } from "./site";
import { newChallenge, PASSKEY_ALGORITHMS, spendChallenge, verifyAssertion, verifyRegistration } from "./passkey";
import { qrMatrix } from "./qr";
import { IMAGE_MIME, imageType, wallpaperSvg, WALLPAPERS } from "./wallpapers";
import { containerCommand, shellCommand, TerminalError, TerminalManager, terminalEnv, type TerminalClient, type TerminalStart } from "./terminal";
import { ARCH, catalogue, scheduleStoreSync, syncStore } from "./store";
import { startSampler, systemStatus } from "./system";
import { availableUpdate, checkForUpdate, confirmUpdate, scheduleUpdateChecks, startUpdate, updateStatus } from "./update";
import { VERSION } from "./version";
import { zipStream } from "./zip";

import appCss from "./ui/app.css" with { type: "text" };
import appJs from "./ui/app.js" with { type: "text" };
import indexHtml from "./ui/index.html" with { type: "text" };
import terminalHtml from "./ui/terminal.html" with { type: "text" };
import terminalJs from "./ui/terminal.js" with { type: "text" };
import xtermFit from "./ui/vendor/xterm-addon-fit.js" with { type: "text" };
import xtermCss from "./ui/vendor/xterm.css" with { type: "text" };
import xtermJs from "./ui/vendor/xterm.js" with { type: "text" };
import logoSvg from "./ui/logo.svg" with { type: "text" };
import interCyrillic from "./ui/fonts/inter-cyrillic.woff2" with { type: "file" };
import interLatinExt from "./ui/fonts/inter-latin-ext.woff2" with { type: "file" };
import interLatin from "./ui/fonts/inter-latin.woff2" with { type: "file" };
import manropeCyrillic from "./ui/fonts/manrope-cyrillic.woff2" with { type: "file" };
import manropeLatinExt from "./ui/fonts/manrope-latin-ext.woff2" with { type: "file" };
import manropeLatin from "./ui/fonts/manrope-latin.woff2" with { type: "file" };
import swJs from "./ui/sw.js" with { type: "text" };
import en from "./lang/en.json";
import uk from "./lang/uk.json";

onAppRemoved(dropAccess);

// --- Static files -----------------------------------------------------------------------------------

const LANGUAGES: Record<string, Record<string, string>> = { en, uk };

const MANIFEST = JSON.stringify({
  name: "Hata",
  short_name: "Hata",
  start_url: "/",
  display: "standalone",
  background_color: "#131110",
  theme_color: "#131110",
  icons: [{ src: "/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
});

const STATIC: Record<string, { body: string; type: string; headers?: Record<string, string> }> = {
  "/": { body: indexHtml, type: "text/html; charset=utf-8" },
  "/app.css": { body: appCss, type: "text/css; charset=utf-8" },
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8" },
  // the terminal is a page of its own, shown in a frame: its emulator writes styles into the page, which
  // the UI's policy forbids — here it is allowed, and nothing but the emulator lives there
  "/terminal.html": {
    body: terminalHtml,
    type: "text/html; charset=utf-8",
    headers: {
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
      "x-frame-options": "SAMEORIGIN",
    },
  },
  "/sw.js": { body: swJs, type: "text/javascript; charset=utf-8" },
  "/terminal.js": { body: terminalJs, type: "text/javascript; charset=utf-8" },
  "/vendor/xterm.js": { body: xtermJs, type: "text/javascript; charset=utf-8" },
  "/vendor/xterm-addon-fit.js": { body: xtermFit, type: "text/javascript; charset=utf-8" },
  "/vendor/xterm.css": { body: xtermCss, type: "text/css; charset=utf-8" },
  ...Object.fromEntries(WALLPAPERS.map((id) => [`/wallpapers/${id}.svg`, { body: wallpaperSvg(id)!, type: "image/svg+xml" }])),
  "/logo.svg": { body: logoSvg, type: "image/svg+xml" },
  "/favicon.ico": { body: logoSvg, type: "image/svg+xml" },
  "/manifest.webmanifest": { body: MANIFEST, type: "application/manifest+json; charset=utf-8" },
  ...Object.fromEntries(Object.entries(LANGUAGES).map(([code, dict]) => [`/lang/${code}.json`, { body: JSON.stringify(dict), type: "application/json; charset=utf-8" }])),
};

/** Binary files of the UI: embedded in the binary, read from it on request */
const FONTS: Record<string, string> = {
  "/fonts/inter-latin.woff2": interLatin,
  "/fonts/inter-latin-ext.woff2": interLatinExt,
  "/fonts/inter-cyrillic.woff2": interCyrillic,
  "/fonts/manrope-latin.woff2": manropeLatin,
  "/fonts/manrope-latin-ext.woff2": manropeLatinExt,
  "/fonts/manrope-cyrillic.woff2": manropeCyrillic,
};

const ETAGS = new Map(Object.entries(STATIC).map(([path, file]) => [path, `"${Bun.hash(file.body).toString(36)}"`]));

/** Scripts and styles only from this server; images also from anywhere over HTTPS (store icons) */
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' https: http: data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function serveStatic(req: Request, path: string): Response | null {
  if (Object.hasOwn(FONTS, path)) {
    return new Response(Bun.file(FONTS[path]!), { headers: { ...SECURITY_HEADERS, "content-type": "font/woff2", "cache-control": "public, max-age=604800" } });
  }
  if (!Object.hasOwn(STATIC, path)) return null;
  const file = STATIC[path]!;
  const etag = ETAGS.get(path)!;
  // always revalidate: after an update the browser must not keep running the old UI
  const headers = { ...SECURITY_HEADERS, ...file.headers, "content-type": file.type, "cache-control": "no-cache", etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(file.body, { headers });
}

// --- Helpers ----------------------------------------------------------------------------------------

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** `code` is translated by the UI; `detail` fills the placeholders of its message */
function fail(status: number, code: string, detail: Record<string, string | number> = {}): Response {
  return json({ error: { code, detail } }, status);
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new AppError("request.notJson", 415);
  const data: unknown = await req.json().catch(() => null);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new AppError("request.notJson", 400);
  return data as Record<string, unknown>;
}

/** A cross-site page can make the browser send our cookie; it cannot fake the Origin header */
function sameOrigin(req: Request, url: URL): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (req.headers.get("host") ?? url.host);
  } catch {
    return false;
  }
}


function language(url: URL): string {
  const lang = url.searchParams.get("lang") ?? "";
  return /^[a-z]{2}$/.test(lang) ? lang : settings.language;
}

/**
 * The domain passkeys belong to, when this request can use them: browsers offer WebAuthn only over HTTPS,
 * and a passkey is tied to the name it was made for — so only on Hata's own domain. "" — not here.
 */
function passkeyDomain(req: Request): string {
  const domain = siteDomain();
  return domain && requestProto(req) === "https" && requestHost(req) === domain ? domain : "";
}

const publicSettings = () => ({ ...settings, systemTimezone: timezone(), languages: Object.keys(LANGUAGES), stateDir: DATA_DIR, stateMovable: cannotMove() === null });

// --- Events -----------------------------------------------------------------------------------------

/** What a member may do: look at the apps and manage their own account. Everything else is an administrator's. */
export function memberMay(method: string, path: string, role: Role = "member"): boolean {
  if (path === "/api/logout" || path === "/api/account") return true;
  // a guest is a shared account: whoever holds it must not be able to lock the others out of it
  if (path.startsWith("/api/account/")) return role !== "guest";
  if (method !== "GET") return false;
  if (["/api/events", "/api/overview", "/api/apps"].includes(path) || /^\/api\/apps\/[a-z0-9_-]+(\/(stats|icon))?$/.test(path)) return true;
  return role === "member" && (path === "/api/store" || /^\/api\/store\/[a-z0-9-]+\/apps\/[a-z0-9_-]+$/.test(path));
}

/** Events a member's page receives: job output and the activity log are not for them */
const MEMBER_EVENTS = new Set(["system", "apps", "store"]);

function events(req: Request, server: Server, admin: boolean): Response {
  // an event stream is silent for long stretches; the default idle timeout would cut it
  server.timeout(req, 0);
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: Timer | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const close = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
      unsubscribe = bus.subscribe((event) => {
        if (admin || MEMBER_EVENTS.has(event.type)) send(`data: ${JSON.stringify(event)}\n\n`);
      });
      heartbeat = setInterval(() => send(": ping\n\n"), 25_000);
      req.signal.addEventListener("abort", close, { once: true });
      send("retry: 2000\n\n");
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: { ...SECURITY_HEADERS, "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

/** The background picture an administrator uploaded */
const WALLPAPER_FILE = join(DATA_DIR, "wallpaper");
const MAX_WALLPAPER = 12 * 1024 * 1024;

// --- Terminals --------------------------------------------------------------------------------------

const terminals = new TerminalManager();

interface TerminalSocket {
  kind: "terminal";
  key: string;
  cols: string | null;
  rows: string | null;
  start: () => TerminalStart;
  /** Written to the activity log when a shell is really started */
  opened: () => void;
}

/** The largest input message: a paste arrives in parts of this size at most */
const MAX_TERMINAL_INPUT = 128 * 1024;

/**
 * Opens the WebSocket of a terminal: the server's own shell, or (with `app` and `container`) a shell
 * inside a running container of that app. Administrators only — the caller has checked.
 */
async function openTerminal(req: Request, url: URL, server: Server, user: string): Promise<Response> {
  const upgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
  // a page of another site can open a WebSocket here with our cookie; it cannot fake where it comes from
  if (upgrade && (req.headers.get("origin") === null || !sameOrigin(req, url))) return fail(403, "request.crossSite");
  const app = url.searchParams.get("app");
  let key = "host";
  let start = (): TerminalStart => ({ cmd: shellCommand(), cwd: existsSync(homedir()) ? homedir() : "/", env: terminalEnv() });
  if (app !== null) {
    if (!APP_NAME_RE.test(app)) return fail(404, "app.notFound");
    const found = (await listApps("en")).find((a) => a.name === app);
    if (!found) return fail(404, "app.notFound");
    const container = found.containers.find((c) => c.name === url.searchParams.get("container")) ?? found.containers.find((c) => c.state === "running");
    if (!container || container.state !== "running") return fail(409, "terminal.notRunning");
    key = `app:${app}:${container.name}`;
    start = () => ({ cmd: containerCommand(container.id), cwd: "/", env: terminalEnv() });
  }
  if (!terminals.supported()) return fail(501, "terminal.unsupported");
  // a plain request is the page asking why its connection was refused: nothing stands in the way
  if (!upgrade) return json({ ok: true });
  const data: TerminalSocket = {
    kind: "terminal",
    key,
    cols: url.searchParams.get("cols"),
    rows: url.searchParams.get("rows"),
    start,
    opened: () => record(app === null ? "system.terminal.host" : "system.terminal.app", { user, app: app ?? undefined }),
  };
  if (server.upgrade(req, { data })) return undefined as never;
  return fail(400, "request.notFound");
}

type AnySocket = ServerWebSocket<TerminalSocket | Parameters<typeof tunnelHandlers.open>[0]["data"]>;
const isTerminal = (ws: AnySocket): ws is ServerWebSocket<TerminalSocket> => (ws.data as { kind?: string }).kind === "terminal";

/** The sockets of Hata's own listeners: terminals, and connections passed on to apps */
const sockets = {
  open(ws: AnySocket) {
    if (!isTerminal(ws)) return tunnelHandlers.open(ws as never);
    const client = ws as unknown as TerminalClient;
    try {
      if (terminals.attach(client, ws.data.key, ws.data.cols, ws.data.rows, ws.data.start)) ws.data.opened();
    } catch (e) {
      const kind = e instanceof TerminalError ? e.kind : "spawn";
      ws.send(JSON.stringify({ type: "error", code: "terminal." + kind, message: e instanceof Error ? e.message : String(e) }));
      ws.close(1011, kind);
    }
  },
  message(ws: AnySocket, message: string | Buffer) {
    if (!isTerminal(ws)) return tunnelHandlers.message(ws as never, message);
    const client = ws as unknown as TerminalClient;
    if (typeof message !== "string") {
      if (message.length <= MAX_TERMINAL_INPUT) terminals.input(client, new Uint8Array(message));
      return;
    }
    try {
      const data = JSON.parse(message) as { type?: string; cols?: unknown; rows?: unknown };
      if (data.type === "resize") terminals.resize(client, data.cols, data.rows);
    } catch {
      // not ours to understand
    }
  },
  close(ws: AnySocket, code: number, reason: string) {
    if (!isTerminal(ws)) return tunnelHandlers.close(ws as never, code, reason);
    terminals.detach(ws as unknown as TerminalClient);
  },
};

// --- API --------------------------------------------------------------------------------------------

async function api(req: Request, url: URL, server: Server): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const write = method !== "GET" && method !== "HEAD";
  if (write && !sameOrigin(req, url)) return fail(403, "request.crossSite");
  const ip = clientIp(req, server);
  // the API takes small JSON bodies; the server's own limit is the apps' (they upload files through it)
  if (write && path !== "/api/files/upload" && path !== "/api/appearance/wallpaper" && Number(req.headers.get("content-length") ?? 0) > MAX_API_BODY) return fail(413, "request.tooLarge");
  const cookie = (token: string) => sessionCookie(token, requestProto(req) === "https", cookieDomain(requestHost(req)));
  const client = { ip, userAgent: req.headers.get("user-agent") ?? "" };

  if (path === "/api/state" && method === "GET") {
    const user = sessionUser(req);
    return json({
      version: VERSION,
      setup: needsSetup(),
      user: user ? publicUser(user) : null,
      language: settings.language,
      languages: Object.keys(LANGUAGES),
      passkeys: passkeyDomain(req) !== "",
      // the sign-in page looks like the rest
      appearance: settings.appearance,
      wallpapers: WALLPAPERS,
    });
  }

  // the uploaded background: part of the look, shown before sign-in as well
  if (path === "/api/wallpaper" && method === "GET") {
    const kind = settings.appearance.custom;
    const file = kind ? Bun.file(WALLPAPER_FILE) : null;
    if (!kind || !file || !(await file.exists())) return fail(404, "request.notFound");
    return new Response(file, { headers: { ...SECURITY_HEADERS, "content-type": IMAGE_MIME[kind], "cache-control": "public, max-age=31536000, immutable" } });
  }

  if (path === "/api/setup" && method === "POST") {
    const data = await body(req);
    const blocked = loginBlockedFor(ip);
    if (blocked > 0) return fail(429, "auth.locked", { seconds: Math.ceil(blocked / 1000) });
    const result = await completeSetup(data.token, data.name, data.password);
    if (typeof result === "string") {
      if (result === "setup.badToken") registerLoginFailure(ip);
      return fail(result === "setup.done" ? 409 : 400, result);
    }
    console.log(`Administrator "${result.name}" created from ${ip}`);
    record("auth.setup", { user: result.name, detail: ip });
    return json({ user: publicUser(result) }, 200, { "set-cookie": cookie(createSession(result, client)) });
  }

  if (path === "/api/login" && method === "POST") {
    const data = await body(req);
    const blocked = loginBlockedFor(ip);
    if (blocked > 0) {
      recordSignIn(data.name, ip, "locked");
      return fail(429, "auth.locked", { seconds: Math.ceil(blocked / 1000) });
    }
    const user = await checkPassword(data.name, data.password);
    if (!user) {
      registerLoginFailure(ip);
      recordSignIn(data.name, ip, "wrongPassword");
      return fail(401, "auth.wrong");
    }
    if (user.totp) {
      // the password was right: now the code from the app, or a recovery code
      if (data.code === undefined || data.code === "") return fail(401, "auth.codeRequired");
      if (!checkSecondFactor(user, data.code)) {
        registerLoginFailure(ip);
        recordSignIn(data.name, ip, "wrongCode");
        return fail(401, "auth.wrongCode");
      }
    }
    registerLoginSuccess(ip);
    recordSignIn(user.name, ip, "ok");
    record("auth.signin", { user: user.name, detail: ip });
    return json({ user: publicUser(user) }, 200, { "set-cookie": cookie(createSession(user, client)) });
  }

  // signing in with a passkey: the browser signs our challenge with a key only that device holds
  if (path === "/api/login/passkey/begin" && method === "POST") {
    const rpId = passkeyDomain(req);
    return rpId ? json({ challenge: newChallenge("signin"), rpId }) : fail(400, "passkey.unavailable");
  }
  if (path === "/api/login/passkey" && method === "POST") {
    const data = await body(req);
    const rpId = passkeyDomain(req);
    if (!rpId) return fail(400, "passkey.unavailable");
    const blocked = loginBlockedFor(ip);
    if (blocked > 0) return fail(429, "auth.locked", { seconds: Math.ceil(blocked / 1000) });
    const challenge = spendChallenge(data.clientDataJSON, "signin");
    const found = findPasskey(data.id);
    const verified = challenge && found ? await verifyAssertion(data, found.key, { challenge, rpId }) : null;
    if (!found || !verified) {
      registerLoginFailure(ip);
      recordSignIn(found?.user.name ?? "", ip, "wrongPasskey");
      return fail(401, "passkey.rejected");
    }
    passkeyUsed(found.key, verified.counter);
    registerLoginSuccess(ip);
    recordSignIn(found.user.name, ip, "ok");
    record("auth.signin", { user: found.user.name, detail: ip });
    return json({ user: publicUser(found.user) }, 200, { "set-cookie": cookie(createSession(found.user, client)) });
  }

  // an invitation link: the page asks what it is for, then creates the account
  if (path === "/api/invite" && method === "GET") {
    const info = inviteInfo(url.searchParams.get("token"));
    return info ? json(info) : fail(404, "invite.invalid");
  }
  if (path === "/api/invite" && method === "POST") {
    const data = await body(req);
    const blocked = loginBlockedFor(ip);
    if (blocked > 0) return fail(429, "auth.locked", { seconds: Math.ceil(blocked / 1000) });
    const result = await acceptInvite(data.token, data.name, data.password);
    if (typeof result === "string") {
      if (result === "invite.invalid") registerLoginFailure(ip);
      return fail(result === "users.nameTaken" ? 409 : 400, result);
    }
    record("users.joined", { user: result.name, detail: ip });
    return json({ user: publicUser(result) }, 200, { "set-cookie": cookie(createSession(result, client)) });
  }

  // ---- everything below needs a session ----
  const user = sessionUser(req);
  if (!user) return fail(401, "auth.required");
  const admin = user.role === "admin";
  if (!admin && !memberMay(method, path, user.role)) return fail(403, "auth.forbidden");

  // ---- the signed-in user's own account ----
  if (path === "/api/account" && method === "GET") {
    return json({ user: publicUser(user), sessions: listSessions(user, req), recoveryCodes: recoveryCodesLeft(user), passkeys: listPasskeys(user), passkeysHere: passkeyDomain(req) !== "" });
  }
  if (path === "/api/account/password" && method === "POST") {
    const data = await body(req);
    const error = await changePassword(user, data.current, data.password, req);
    if (error) return fail(400, error);
    record("auth.password", { user: user.name });
    return json({ ok: true });
  }
  if (path === "/api/account/sessions/others" && method === "DELETE") {
    revokeSessions(user, req);
    return json({ ok: true });
  }
  const session = /^\/api\/account\/sessions\/([0-9a-f-]{36})$/.exec(path);
  if (session && method === "DELETE") return revokeSession(user, session[1]!) ? json({ ok: true }) : fail(404, "auth.noSession");
  if (path === "/api/account/totp/begin" && method === "POST") {
    if (user.totp) return fail(409, "totp.alreadyOn");
    const { secret, uri } = beginTotp(user);
    return json({ secret, uri, qr: qrMatrix(uri).map((row) => row.map((dark) => (dark ? "1" : "0")).join("")) });
  }
  if (path === "/api/account/totp/enable" && method === "POST") {
    const result = enableTotp(user, (await body(req)).code);
    if (typeof result === "string") return fail(400, result);
    record("auth.twoFactorOn", { user: user.name });
    return json({ recovery: result });
  }
  if (path === "/api/account/totp/disable" && method === "POST") {
    const error = await disableTotp(user, (await body(req)).password);
    if (error) return fail(400, error);
    record("auth.twoFactorOff", { user: user.name });
    return json({ ok: true });
  }

  // a new passkey is as good as the password, so adding one asks for the password
  if (path === "/api/account/passkeys/begin" && method === "POST") {
    const rpId = passkeyDomain(req);
    if (!rpId) return fail(400, "passkey.unavailable");
    if (!(await checkOwnPassword(user, (await body(req)).password))) return fail(400, "auth.wrongPassword");
    return json({ challenge: newChallenge(`add:${user.id}`), rpId, user: { id: user.id, name: user.name }, algorithms: PASSKEY_ALGORITHMS, exclude: listPasskeys(user).map((k) => k.id) });
  }
  if (path === "/api/account/passkeys" && method === "POST") {
    const data = await body(req);
    const rpId = passkeyDomain(req);
    const challenge = rpId && spendChallenge(data.clientDataJSON, `add:${user.id}`);
    const key = challenge ? await verifyRegistration(data as never, { challenge, rpId }) : null;
    if (!key) return fail(400, "passkey.rejected");
    const error = addPasskey(user, key, data.name);
    if (error) return fail(409, error);
    record("auth.passkeyAdded", { user: user.name });
    return json({ ok: true }, 201);
  }
  const passkey = /^\/api\/account\/passkeys\/([A-Za-z0-9_-]{1,1400})$/.exec(path);
  if (passkey && method === "DELETE") {
    if (!removePasskey(user, passkey[1]!)) return fail(404, "passkey.notFound");
    record("auth.passkeyRemoved", { user: user.name });
    return json({ ok: true });
  }

  // ---- users (administrators only: members were turned away above) ----
  if (path === "/api/users") {
    if (method === "GET") return json(listUsers());
    if (method === "POST") {
      const data = await body(req);
      const created = await createUser(data.name, data.password, data.role);
      if (typeof created === "string") return fail(created === "users.nameTaken" ? 409 : 400, created);
      record("users.create", { user: user.name, detail: created.name });
      return json(publicUser(created), 201);
    }
  }
  const target = /^\/api\/users\/([0-9a-f-]{36})$/.exec(path);
  if (target && method === "PUT") {
    const error = await updateUser(target[1]!, await body(req));
    return error ? fail(error === "users.notFound" ? 404 : 400, error) : json({ ok: true });
  }
  if (target && method === "DELETE") {
    const name = findUser(target[1]!)?.name ?? "";
    const error = deleteUser(target[1]!, user);
    if (error) return fail(error === "users.notFound" ? 404 : 400, error);
    dropUser(target[1]!);
    record("users.remove", { user: user.name, detail: name });
    return json({ ok: true });
  }

  if (path === "/api/logout" && method === "POST") {
    destroySession(req);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(cookieDomain(requestHost(req))) });
  }

  if (path === "/api/invites") {
    if (method === "GET") return json(listInvites());
    if (method === "POST") {
      const data = await body(req);
      const invite = createInvite(data.role, data.note, user);
      return typeof invite === "string" ? fail(400, invite) : json(invite, 201);
    }
  }
  const invite = /^\/api\/invites\/([0-9a-f-]{36})$/.exec(path);
  if (invite && method === "DELETE") return revokeInvite(invite[1]!) ? json({ ok: true }) : fail(404, "invite.invalid");
  if (path === "/api/signins" && method === "GET") return json(listSignIns());

  // ---- who may open what ----
  if (path === "/api/access" && method === "GET") {
    const apps = (await listApps(language(url))).map((app) => {
      const compose = readCompose(app.name);
      const gate = compose ? gateTarget(compose, settings.dataRoot) : "noPort";
      return { name: app.name, title: app.title, icon: app.icon, ...accessOf(app.name), cannotProtect: typeof gate === "string" ? gate : null };
    });
    return json({ apps, users: listUsers().map(({ id, name, role }) => ({ id, name, role })) });
  }

  if (path === "/api/events" && method === "GET") return events(req, server, admin);

  if (path === "/api/overview" && method === "GET") {
    const [docker, all, containers] = await Promise.all([dockerInfo(), listApps(language(url)), admin ? listContainers().catch(() => []) : []]);
    const apps = all.filter((app) => mayOpen(user, app.name));
    const system = systemStatus();
    return json({
      system,
      docker,
      apps,
      arch: ARCH,
      // with a domain, apps are opened at <label>.<domain> when Hata itself is opened by that domain
      site: { domain: siteDomain(), mode: settings.https.mode, local: localDomain() },
      attention: admin ? attention({ system, docker, apps, activity: recent(100), update: availableUpdate(), offsite: offsiteFailure(), disks: diskHealth() }) : [],
      // who signed in from where, and what was installed by whom, is the administrators' business
      activity: admin ? recent(8) : [],
      // containers and compose projects on this machine that are not apps here yet
      importable: admin ? importCount(containers) : 0,
      // folders an administrator put on the dashboard from the file manager
      folders: admin ? pinnedFolders() : [],
      dashboard: arrange(settings.dashboard, apps.map((app) => app.name), admin ? settings.folders : [], admin ? ["store", "add"] : user.role === "guest" ? [] : ["store"]),
      jobs: admin ? listJobs().filter((j) => j.status === "running").map(({ log: _, ...job }) => job) : [],
    });
  }

  if (path === "/api/terminal/ws" && method === "GET") return openTerminal(req, url, server, user.name);
  if (path === "/api/terminal" && method === "GET") return json({ supported: terminals.supported(), terminals: terminals.list().map(({ key, startedAt, clients }) => ({ key, startedAt, clients })) });
  if (path === "/api/terminal" && method === "DELETE") {
    const key = url.searchParams.get("key") ?? "";
    return json({ closed: terminals.kill(key) });
  }

  if (path === "/api/appearance/wallpaper" && method === "PUT") {
    // without a stated length there is no telling how much is coming
    if (!(Number(req.headers.get("content-length")) <= MAX_WALLPAPER)) return fail(413, "appearance.tooLarge", { max: MAX_WALLPAPER / 1024 / 1024 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_WALLPAPER) return fail(413, "appearance.tooLarge", { max: MAX_WALLPAPER / 1024 / 1024 });
    const kind = imageType(bytes.subarray(0, 16));
    if (!kind) return fail(400, "appearance.notImage");
    await Bun.write(WALLPAPER_FILE, bytes);
    settings.appearance = { ...settings.appearance, custom: kind, stamp: Date.now(), wallpaper: "custom" };
    saveSettings();
    return json(publicSettings());
  }

  if (path === "/api/appearance/wallpaper" && method === "DELETE") {
    rmSync(WALLPAPER_FILE, { force: true });
    const look = settings.appearance;
    settings.appearance = { ...look, custom: "", stamp: 0, wallpaper: look.wallpaper === "custom" ? "" : look.wallpaper };
    saveSettings();
    return json(publicSettings());
  }

  // the layout as text: everything that is on the dashboard, for an editor instead of a mouse
  if (path === "/api/dashboard/text" && method === "GET") {
    const apps = await listApps("en");
    return json({ text: layoutText(arrange(settings.dashboard, apps.map((app) => app.name), settings.folders, ["store", "add"])) });
  }
  if (path === "/api/dashboard/text" && method === "PUT") {
    const data = await body(req);
    try {
      settings.dashboard = parseLayoutText(typeof data.text === "string" ? data.text : "");
    } catch (e) {
      return fail(400, "dashboard.badText", { message: e instanceof Error ? e.message.split("\n")[0]! : String(e) });
    }
    saveSettings();
    bus.publish("apps");
    return json({ ok: true });
  }

  if (path === "/api/dashboard" && method === "PUT") {
    settings.dashboard = cleanLayout(await body(req));
    saveSettings();
    bus.publish("apps");
    return json({ ok: true });
  }

  if (path === "/api/activity" && method === "GET") {
    const app = url.searchParams.get("app") ?? undefined;
    return json(recent(app ? 20 : 100, app));
  }

  if (path === "/api/settings") {
    if (method === "GET") return json(publicSettings());
    if (method === "PUT") {
      const patch = await body(req);
      const error = updateSettings(patch);
      if (error) return fail(400, error);
      // certificates take a while: the page asks for their state
      if ("https" in patch) void refreshHttps(true);
      if ("local" in patch) refreshLocalNames();
      return json(publicSettings());
    }
  }

  if (path === "/api/notify") {
    if (method === "GET") return json(notifyStatus());
    if (method === "PUT") {
      const error = updateNotify(await body(req));
      return error ? fail(400, error) : json(notifyStatus());
    }
  }
  if (path === "/api/notify/test" && method === "POST") {
    const data = await body(req);
    const channel = CHANNELS.find((c) => c === data.channel);
    if (!channel) return fail(400, "notify.bad");
    const message = await sendTest(channel, user.id, typeof data.device === "string" ? data.device : undefined);
    return message ? fail(502, "notify.failed", { message }) : json(notifyStatus());
  }
  if (path === "/api/notify/telegram/chats" && method === "POST") {
    const chats = await telegramChats((await body(req)).token);
    return typeof chats === "string" ? fail(400, chats) : json(chats);
  }
  if (path === "/api/notify/push") {
    if (method === "GET") return json({ key: await pushKey(), devices: listDevices(user.id) });
    if (method === "POST") {
      const data = await body(req);
      // a push service wants to know who is sending: the address this device reaches Hata by
      const error = addDevice(user.id, { subscription: data.subscription, label: data.label, lang: language(url), origin: `https://${requestHost(req)}` });
      return error ? fail(400, error) : json({ devices: listDevices(user.id) }, 201);
    }
    if (method === "DELETE") {
      removeDevice(user.id, url.searchParams.get("id") ?? "");
      return json({ devices: listDevices(user.id) });
    }
  }

  // the configuration folder moves as a whole, and the service restarts in the new place
  if (path === "/api/state-dir" && method === "POST") {
    const from = DATA_DIR;
    const failed = moveState((await body(req)).path);
    if (failed) return fail(failed.error === "state.busy" ? 409 : 400, failed.error, failed.detail);
    console.log(`The configuration folder is moved from ${from} by ${user.name}; restarting`);
    return json({ restarting: true }, 202);
  }

  if (path === "/api/local" && method === "GET") return json({ ...(await localNamesStatus()), port: listenAddress().port });

  if (path === "/api/https" && method === "GET") {
    return json({ mode: settings.https.mode, listening: !!httpsServer, error: httpsError, httpPort: listenAddress().port, certificates: certificateStates(await httpsNames()) });
  }
  if (path === "/api/https/retry" && method === "POST") {
    void refreshHttps(true);
    return json({ started: true }, 202);
  }
  if (path === "/api/https/check" && method === "POST") {
    const domain = siteDomain();
    if (!domain) return fail(400, "settings.needDomain");
    return json(await Promise.all([checkDomain(domain), checkDomain(`hata-check.${domain}`)]));
  }

  // ---- disks and their health ----
  if (path === "/api/disks" && method === "GET") return json(await listDisks());
  if (path === "/api/disks/check" && method === "POST") {
    // a disk that sleeps takes its time to spin up
    server.timeout(req, 0);
    await checkDisks(true);
    return json(await listDisks());
  }
  if (path === "/api/disks/tool" && method === "POST") {
    server.timeout(req, 0);
    const message = await installTool();
    if (message) return fail(500, "disk.installFailed", { message });
    return json(await listDisks());
  }
  const diskTest = /^\/api\/disks\/([A-Za-z0-9_-]+)\/test$/.exec(path);
  if (diskTest && method === "POST") {
    const type = (await body(req)).type === "long" ? "long" : "short";
    const failed = await startSelfTest(diskTest[1]!, type);
    if (failed) return fail(failed === "disk.unknown" ? 404 : 400, failed);
    return json(await listDisks());
  }

  // ---- folders shared over the network ----
  if (path === "/api/shares" && method === "GET") return json(await listShares());
  if (path === "/api/shares" && method === "POST") return json(await addShare(await body(req), user), 201);
  if (path === "/api/shares/tool" && method === "POST") {
    server.timeout(req, 0);
    return json(await installSamba());
  }
  if (path.startsWith("/api/shares/") && (method === "PUT" || method === "DELETE")) {
    let name: string;
    try {
      name = decodeURIComponent(path.slice("/api/shares/".length));
    } catch {
      return fail(404, "shares.notFound");
    }
    return json(method === "PUT" ? await changeShare(name, await body(req)) : await removeShare(name, user));
  }

  if (path === "/api/update" && method === "GET") return json(updateStatus());
  if (path === "/api/update/check" && method === "POST") return json(await checkForUpdate());
  if (path === "/api/update/install" && method === "POST") {
    const error = startUpdate(user.name);
    return error ? fail(409, error) : json({ started: true }, 202);
  }

  if (path === "/api/backups" && method === "GET") return json(await backupOverview(language(url)));
  if (path === "/api/backups/run" && method === "POST") {
    // the run takes minutes; its progress shows up as jobs and in the overview
    void runBackups(user.name);
    return json({ started: true }, 202);
  }
  if (path === "/api/backups/server" && method === "POST") {
    await takeServerSnapshot("manual");
    record("system.backup.done", { user: user.name });
    return json(await backupOverview(language(url)), 201);
  }
  if (path === "/api/backups/offsite" && method === "PUT") {
    const error = saveOffsite(await body(req));
    return error ? fail(400, error) : json(await backupOverview(language(url)));
  }
  if (path === "/api/backups/offsite/check" && method === "POST") {
    const trust = (await body(req)).trust;
    return json(await checkOffsite(typeof trust === "string" ? trust : undefined));
  }
  if (path === "/api/backups/offsite/host" && method === "DELETE") {
    forgetHost();
    return json(await backupOverview(language(url)));
  }
  if (path === "/api/backups/offsite/sync" && method === "POST") {
    mirror();
    return json({ started: true }, 202);
  }
  const b = /^\/api\/backups\/([a-z0-9_-]+)\/(\d{8}-\d{6})(\/restore)?$/.exec(path);
  if (b && b[3] && method === "POST") return json({ job: restoreSnapshot(b[1]!, b[2]!, user.name).id }, 202);
  if (b && !b[3] && method === "DELETE") {
    deleteSnapshot(b[1]!, b[2]!);
    record("app.snapshot.remove", { app: b[1]!, user: user.name });
    return json({ ok: true });
  }

  // ---- files (administrators only: members were turned away above) ----
  if (path.startsWith("/api/files")) {
    const response = await files(req, url, server);
    if (response) return response;
  }

  if (path === "/api/store" && method === "GET") return json(catalogue(language(url)));

  let m = /^\/api\/store\/([a-z0-9-]+)\/sync$/.exec(path);
  if (m && method === "POST") return json(await syncStore(m[1]!));

  m = /^\/api\/store\/([a-z0-9-]+)\/apps\/([a-z0-9_-]+)$/.exec(path);
  if (m && method === "GET") return json(await storeAppDetail(m[1]!, m[2]!, language(url)));

  // a `docker run` command read into the form of a custom app; nothing is installed here
  if (path === "/api/dockerrun" && method === "POST") {
    const run = parseDockerRun((await body(req)).command);
    return typeof run === "string" ? fail(400, run) : json(run);
  }

  if (path === "/api/apps") {
    if (method === "GET") return json((await listApps(language(url))).filter((app) => mayOpen(user, app.name)));
    if (method === "POST") {
      const data = await body(req);
      const job =
        typeof data.store === "string"
          ? await installFromStore(data.store, String(data.name ?? ""), data.form, user.name)
          : isPlainObject(data.settings)
            ? await installFromSettings(data.name, data.settings, user.name, language(url))
            : await installCustom(data.name, data.compose, user.name);
      return json({ job: job.id, app: job.app }, 202);
    }
  }

  if (path === "/api/import" && method === "GET") return json({ casaos: casaosState(), ...(await importList()) });
  if (path === "/api/import/casaos" && method === "POST") return json(await moveInCasaos((await body(req)).stop === true, user.name));
  m = /^\/api\/import\/projects\/([a-z0-9][a-z0-9_-]*)$/.exec(path);
  if (m && method === "GET") {
    const { env: _, ...draft } = await projectDraft(m[1]!);
    return json(draft);
  }
  if (m && method === "POST") {
    await adoptProject(m[1]!, user.name);
    return json({ app: m[1] }, 201);
  }
  m = /^\/api\/import\/containers\/([0-9a-f]{12,64})$/.exec(path);
  if (m && method === "GET") return json(await containerDraft(m[1]!));
  if (m && method === "POST") {
    const data = await body(req);
    const job = await rebuildContainer(m[1]!, data.name, data.compose, user.name);
    return json({ job: job.id, app: job.app }, 202);
  }

  m = /^\/api\/jobs\/([0-9a-f-]{36})$/.exec(path);
  if (m && method === "GET") {
    const job = getJob(m[1]!);
    return job ? json(job) : fail(404, "job.notFound");
  }

  m = /^\/api\/apps\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
  if (m) {
    const name = m[1]!;
    const sub = m[2];
    if (!APP_NAME_RE.test(name)) return fail(400, "app.badName");
    // an app the user may not open does not exist for them
    if (!mayOpen(user, name)) return fail(404, "app.notFound");
    if (sub === "access" && method === "PUT") {
      const data = await body(req);
      const ids = new Set(listUsers().map((u) => u.id));
      const allowed = data.allowed === "all" ? "all" : Array.isArray(data.allowed) ? [...new Set(data.allowed.filter((id): id is string => typeof id === "string" && ids.has(id)))] : null;
      if (allowed === null) return fail(400, "gate.badAccess");
      const job = setAccess(name, { allowed, protect: data.protect === true }, user.name);
      return json({ job: job?.id ?? null }, job ? 202 : 200);
    }
    if (!sub && method === "GET") return json(await appDetail(name, language(url)));
    if (!sub && method === "DELETE") return json({ job: removeApp(name, url.searchParams.get("data") === "1", user.name).id }, 202);
    if (sub === "stats" && method === "GET") return json(await appStats(name));
    if (sub === "backups" && method === "GET") return json(listSnapshots(name));
    if (sub === "backup" && method === "POST") return json({ job: backupApp(name, user.name).id }, 202);
    if (sub === "storeupdate" && method === "GET") {
      const plan = planStoreUpdate(name);
      if (!plan) return fail(404, "app.noUpdate");
      return json({ store: plan.store, recorded: plan.recorded, exact: plan.exact, changes: plan.changes, compose: dumpCompose(plan.merged) });
    }
    if (sub === "storeupdate" && method === "POST") return json({ job: applyStoreUpdate(name, user.name).id }, 202);
    if (sub === "icon" && method === "GET") {
      const icon = appIcon(name);
      if (!icon) return fail(404, "request.notFound");
      // an SVG can carry a script: it is shown as a picture, and opened by itself it may do nothing
      return new Response(Bun.file(icon.path), { headers: { ...SECURITY_HEADERS, "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "content-type": ICON_MIME[icon.type], "cache-control": "private, max-age=31536000, immutable" } });
    }
    if (sub === "icon" && method === "PUT") {
      if (!(Number(req.headers.get("content-length")) <= MAX_ICON)) return fail(413, "icon.tooLarge", { max: MAX_ICON / 1024 / 1024 });
      setAppIcon(name, new Uint8Array(await req.arrayBuffer()));
      return json({ icon: appSettings(name, language(url)).ownIcon });
    }
    if (sub === "icon" && method === "DELETE") {
      removeAppIcon(name);
      return json({ icon: "" });
    }
    if (sub === "settings" && method === "GET") return json({ ...appSettings(name, language(url)), memoryTotal: Math.round(systemStatus().memory.total / 1024 ** 2) });
    if (sub === "settings" && method === "PUT") return json({ job: applySettings(name, await body(req), user.name, language(url)).id }, 202);
    if (sub === "compose" && method === "GET") return json({ compose: composeText(name) });
    if (sub === "compose" && method === "PUT") return json({ job: applyCompose(name, (await body(req)).compose, user.name).id }, 202);
    if (sub === "logs" && method === "GET") {
      server.timeout(req, 0);
      return new Response(appLogs(name, req.signal), {
        headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
      });
    }
    if (sub && method === "POST") return json({ job: appAction(name, sub, user.name).id }, 202);
  }

  return fail(404, "request.notFound");
}

const MAX_API_BODY = 2 * 1024 * 1024;

/** A file name for the Content-Disposition header, whatever letters it has */
function disposition(kind: "inline" | "attachment", name: string): string {
  return `${kind}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

/**
 * A file of the user's, sent to the browser. It is somebody's upload, not a page of ours: the type is
 * never guessed from the content, and nothing in it may run — a file opened in a tab is sandboxed.
 */
function sendFile(req: Request, path: string | null, download: boolean): Response {
  const file = readable(path);
  const inline = !download && file.inline !== "";
  const etag = `"${file.size.toString(36)}-${file.modified.toString(36)}"`;
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    // the PDF viewer of the browser does not start in a sandbox
    "content-security-policy": file.inline === "application/pdf" ? "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'" : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'",
    "content-type": inline ? file.inline : "application/octet-stream",
    "content-disposition": disposition(inline ? "inline" : "attachment", file.name),
    "cache-control": "private, no-cache",
    "accept-ranges": "bytes",
    etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  // players ask for a video piece by piece
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2]) && file.size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
    if (start > end || start >= file.size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${file.size}` } });
    return new Response(Bun.file(file.file).slice(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${file.size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Bun.file(file.file), { headers });
}

async function files(req: Request, url: URL, server: Server): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;
  const q = url.searchParams;
  if (path === "/api/files" && method === "GET") return json(await listFiles(q.get("path") ?? ""));
  if (path === "/api/files/raw" && method === "GET") return sendFile(req, q.get("path"), q.get("download") === "1");
  if (path === "/api/files/summary" && method === "POST") return json(await filesSummary((await body(req)).paths));
  if (path === "/api/files/zip" && method === "GET") {
    const plan = await archivePlan(q.getAll("path"));
    server.timeout(req, 0);
    return new Response(zipStream(plan.sources), { headers: { "x-content-type-options": "nosniff", "content-type": "application/zip", "content-disposition": disposition("attachment", plan.name), "cache-control": "no-store" } });
  }
  if (path === "/api/files/text" && method === "GET") return json(await readText(q.get("path")));
  if (path === "/api/files/text" && method === "PUT") {
    const data = await body(req);
    return json(await writeText(data.path, data.content, data.modified));
  }
  if (path === "/api/files/folder" && method === "POST") {
    const data = await body(req);
    return json({ path: makeFolder(data.path, data.name) }, 201);
  }
  if (path === "/api/files/pin" && method === "POST") {
    const data = await body(req);
    pinFolder(data.path, data.pinned === true);
    return json({ pinned: pinnedFolders().map((folder) => folder.path) });
  }
  if (path === "/api/files/rename" && method === "POST") {
    const data = await body(req);
    return json({ path: renameFile(data.path, data.name) });
  }
  if ((path === "/api/files/move" || path === "/api/files/copy") && method === "POST") {
    const data = await body(req);
    // a large folder takes its time, and more so across disks
    server.timeout(req, 0);
    await transfer(data.paths, data.to, path.endsWith("copy"));
    return json({ ok: true });
  }
  if (path === "/api/files/delete" && method === "POST") {
    server.timeout(req, 0);
    await removeFiles((await body(req)).paths);
    return json({ ok: true });
  }
  if (path === "/api/files/upload" && method === "PUT") {
    server.timeout(req, 0);
    const part = { dir: q.get("dir"), name: q.get("name"), sub: q.get("sub") ?? "", id: q.get("id") ?? "", offset: Number(q.get("offset") ?? 0), last: q.get("last") === "1", overwrite: q.get("overwrite") === "1" };
    return json(await upload(part, req.body));
  }
  if (path === "/api/files/upload" && method === "DELETE") {
    abortUpload(q.get("dir"), q.get("sub") ?? "", q.get("id") ?? "");
    return json({ ok: true });
  }
  return null;
}

/**
 * Asks the domain for this very process, the way a browser would: does the name lead here, over HTTPS,
 * with the host name kept? Run for Hata's own name and for a made-up subdomain (the apps' addresses).
 */
async function checkDomain(host: string): Promise<{ host: string; ok: boolean; problem?: string }> {
  try {
    const res = await fetch(`https://${host}/.well-known/hata-check`, { signal: AbortSignal.timeout(8000), redirect: "manual" });
    if (!res.ok) return { host, ok: false, problem: `answered ${res.status}` };
    const seen = (await res.json().catch(() => null)) as { instance?: string; host?: string; proto?: string } | null;
    if (seen?.instance !== INSTANCE) return { host, ok: false, problem: "the name leads to another server" };
    if (seen.host !== host) return { host, ok: false, problem: `the proxy passes the host name as "${seen.host}", not as it was asked` };
    if (seen.proto !== "https") return { host, ok: false, problem: "the proxy does not send X-Forwarded-Proto: https" };
    return { host, ok: true };
  } catch (e) {
    return { host, ok: false, problem: e instanceof Error ? e.message : String(e) };
  }
}

/** A random mark of this process: the HTTPS check asks the domain for it to see that the domain leads here */
const INSTANCE = crypto.randomUUID();

/** A request for `<app>.<domain>`: the app itself, behind sign-in if the app asks for it */
async function serveApp(req: Request, server: Server, label: string): Promise<Response> {
  const apps = await listApps("en");
  const app = apps.find((a) => appLabel(a.name) === label);
  if (!app) return page(404, "No such app", `Nothing is installed at ${requestHost(req)}.`);
  const access = accessOf(app.name);
  const upstream = access.protect && access.upstream ? access.upstream : Number(app.port);
  if (!upstream) return page(404, "No web page", `${app.title} has no web port to open.`);
  const proto = requestProto(req);
  const url = new URL(req.url);
  if (access.protect || access.allowed !== "all") {
    const here = `${proto}://${req.headers.get("host") ?? url.host}${url.pathname}${url.search}`;
    // sign-in is on Hata's own name of the same domain: the cookie it sets reaches this address too
    const refusal = guard(req, app.name, `${proto}://${domainOf(requestHost(req))}${requestPort(req)}/?next=${encodeURIComponent(here)}`);
    if (refusal) return refusal;
  }
  return passToApp(req, server, upstream, proto, clientIp(req, server));
}

// --- HTTPS served by Hata itself --------------------------------------------------------------------

const HTTPS_PORT = Number(process.env.HATA_HTTPS_PORT ?? 443);
let httpsServer: Server | null = null;
let httpsError = "";

/** Every name that needs a certificate: Hata's own and one per app that has a web page */
async function httpsNames(): Promise<string[]> {
  const domain = siteDomain();
  if (settings.https.mode !== "acme" || !domain) return [];
  const apps = await listApps("en");
  return [domain, ...apps.filter((app) => app.port).map((app) => appHost(app.name))];
}

/** (Re)starts the HTTPS listener with the certificates there are; without any, there is nothing to serve */
function restartHttps(names: string[]): void {
  httpsServer?.stop();
  httpsServer = null;
  httpsError = "";
  // Hata's own name first: a client that sends no name gets that certificate
  const certs = loadCertificates().filter((c) => names.includes(c.name)).sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
  if (!certs.length) return;
  try {
    httpsServer = Bun.serve({
      port: HTTPS_PORT,
      hostname: listenAddress().hostname,
      tls: certs.map((c) => ({ serverName: c.name, cert: c.cert, key: c.key })),
      maxRequestBodySize: MAX_APP_BODY,
      fetch: handle,
      websocket: sockets,
    });
  } catch (e) {
    httpsError = e instanceof Error ? e.message : String(e);
    console.error(`Cannot serve HTTPS on port ${HTTPS_PORT}: ${httpsError}`);
  }
}

let refreshing: Promise<void> | null = null;

/** Brings certificates and the HTTPS listener in line with the settings and the installed apps */
function refreshHttps(force = false): Promise<void> {
  refreshing ??= (async () => {
    const names = await httpsNames();
    if (!names.length) {
      httpsServer?.stop();
      httpsServer = null;
      return;
    }
    const served = new Set((httpsServer as unknown as { names?: string[] } | null)?.names ?? []);
    const changed = await ensureCertificates(names, force);
    const have = loadCertificates().filter((c) => names.includes(c.name)).map((c) => c.name);
    if (changed || !httpsServer || have.length !== served.size || have.some((n) => !served.has(n))) {
      restartHttps(names);
      if (httpsServer) (httpsServer as unknown as { names: string[] }).names = have;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function handle(req: Request, server: Server): Promise<Response> {
  const url = new URL(req.url);
  const challenge = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (challenge) {
    const answer = challengeResponse(challenge[1]!);
    return answer ? new Response(answer, { headers: { "content-type": "application/octet-stream" } }) : new Response("Not found", { status: 404 });
  }
  // we serve HTTPS for this name: a plain request for it is sent there (by address, HTTP keeps working)
  if (httpsServer && url.protocol === "http:" && (httpsServer as unknown as { names?: string[] }).names?.includes(requestHost(req))) {
    return Response.redirect(`https://${requestHost(req)}${HTTPS_PORT === 443 ? "" : ":" + HTTPS_PORT}${url.pathname}${url.search}`, 301);
  }
  if (url.pathname === "/.well-known/hata-check") return json({ instance: INSTANCE, host: requestHost(req), proto: requestProto(req) });
  const host = classifyHost(requestHost(req));
  if (host.kind === "app") return serveApp(req, server, host.label);
  if (!url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "request.notFound");
    return serveStatic(req, url.pathname) ?? new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  try {
    return await api(req, url, server);
  } catch (e) {
    if (e instanceof AppError) return fail(e.status, e.code, e.detail);
    console.error(`${req.method} ${url.pathname}:`, e);
    return fail(500, "request.failed", { message: e instanceof Error ? e.message : String(e) });
  }
}

// --- Start ------------------------------------------------------------------------------------------

/** The first address of this machine on the local network, for the links we print */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "localhost";
}

/** The address to put into a message that is read elsewhere: the domain when there is one */
function publicUrl(): string {
  const domain = siteDomain();
  if (domain) return `https://${domain}/`;
  const { port } = listenAddress();
  return localDomain() ? `http://${localDomain()}${port === 80 ? "" : ":" + port}/` : baseUrl();
}

export function baseUrl(): string {
  const { port } = listenAddress();
  return `http://${lanAddress()}${port === 80 ? "" : ":" + port}/`;
}

/**
 * Where to create the first administrator; null once that is done. The token travels in the fragment,
 * which browsers never send to servers or put into the Referer header.
 */
export function setupUrl(): string | null {
  const token = setupToken();
  return token ? `${baseUrl()}#setup=${token}` : null;
}

export async function serve(): Promise<void> {
  const { port, hostname } = listenAddress();
  let server: Server;
  try {
    server = Bun.serve({ port, hostname, maxRequestBodySize: MAX_APP_BODY, fetch: handle, websocket: sockets });
  } catch (e) {
    console.error(`Cannot listen on ${hostname}:${port}: ${e instanceof Error ? e.message : e}`);
    console.error("Set HATA_PORT to use another port.");
    process.exit(1);
  }
  console.log(`Hata ${VERSION} is listening on ${hostname}:${server.port}; state in ${DATA_DIR}`);
  const url = setupUrl();
  console.log(url ? `No administrator yet. Create one at:\n  ${url}` : `Open ${baseUrl()}`);

  const docker = await dockerInfo();
  console.log(docker.available ? `Docker ${docker.version}, compose ${docker.compose}` : `Docker is not available: ${docker.error}`);

  const aside = finishMove();
  if (aside) {
    console.log(`The configuration folder was moved here; the old one is kept as ${aside}`);
    record("system.stateMoved", { detail: DATA_DIR });
  }
  confirmUpdate();
  dropOldSecrets();
  scheduleUpdateChecks();
  startSampler();
  startDisks();
  startShares();
  scheduleStoreSync();
  scheduleBackups();
  void resumeRestore();
  startGates();
  void refreshHttps();
  refreshLocalNames();
  startNotifications({
    attention: async () => attention({ system: systemStatus(), docker: await dockerInfo(), apps: await listApps("en"), activity: recent(100), update: availableUpdate(), offsite: offsiteFailure(), disks: diskHealth() }),
    baseUrl: publicUrl,
    isAdmin: (id) => findUser(id)?.role === "admin",
  });
  setInterval(() => void refreshHttps(), 10 * 60_000);
  // a newly installed app needs a certificate for its name
  let appsChanged: Timer | null = null;
  bus.subscribe((event) => {
    if (event.type !== "apps" || settings.https.mode !== "acme") return;
    if (appsChanged) clearTimeout(appsChanged);
    appsChanged = setTimeout(() => void refreshHttps(), 20_000);
  });
  void watchEvents();
}
