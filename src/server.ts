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
import { recent, record, history } from "./activity";
import { agentUser, cannotGrant, cleanName, createKey, grantKey, keyOf, listKeys, removeKey, renewTokens, setConfirm } from "./agents";
import type { Level } from "./agents";
import { Desk } from "./approvals";
import { answerCall, assistantConfig, configured as assistantReady, findChat, listChats, ModelError, modelsFor, removeChat, retry as retryAssistant, say as sayToAssistant, shownChat, shownConfig as shownAssistant, stopChat, updateAssistant } from "./assistant";
import { AppError, appAction, startJob, type Job, installedNames, jobFinished, appEnv, appDetail, appLogs, appIcon, appSettings, appStats, applyCompose, ICON_MIME, MAX_ICON, removeAppIcon, setAppIcon, applySettings, installFromSettings, applyStoreUpdate, composeText, getJob, installCustom, installFromStore, listApps, listJobs, onAppRemoved, planStoreUpdate, readCompose, removeApp, storeAppDetail } from "./apps";
import { certificateStates, challengeResponse, ensureCertificates, loadCertificates } from "./acme";
import { attention } from "./attention";
import { folderSize, restoreFromSnapshot, snapshotFile, snapshotFiles } from "./snapshot";
import { appFolders, extraAllowed, backupApp, backupOverview, deleteSnapshot, listSnapshots, mirror, restoreSnapshot, resumeRestore, runBackups, scheduleBackups, takeServerSnapshot } from "./backup";
import { allowed as oauthAllowed, declined as oauthDeclined, findClient, holdQuestion, question as oauthQuestion, readAuthorize, register as oauthRegister, resourceMetadata, serverMetadata, spendCode } from "./oauth";
import { checkOffsite, forgetHost, offsiteFailure, saveOffsite } from "./offsite";
import { APP_NAME_RE, dumpCompose } from "./appform";
import { trashSizeOn } from "./trash";
import { discover as discoverPlaces, installFor as installPlaceTools, listPlaces, placesDown, removePlace, retryPlace, savePlace, shares as placeShares, startNetPlaces } from "./netplaces";
import { addShare, changeShare, installSamba, listShares, refreshShares, removeShare, shareTrouble, startShares } from "./shares";
import { checkDisks, diskHealth, installTool, listDisks, startDisks, startSelfTest } from "./disks";
import { fills, measureFills, startFills } from "./fills";
import { checkImages, imagesStatus, startImages } from "./images";
import { afterPackage, exposedNics, giveBack, internetTrouble, setSide, startNetwork, setCheck, setRole, startHotspot, stopHotspot, wifiQrText, changeNic, confirmChange, handOver, NETWORK_PACKAGES, networkReport, NetworkError, revertChange, wifiConnect, wifiForget, wifiNetworks } from "./network";
import { DOCKER_INSTALL_COMMAND, installDocker, startDocker } from "./dockerinstall";
import { installOne, removeOne, toolsReport } from "./tools";
import { ArrayError, arrayReport, arrayTrouble, bringBack, rebuild as rebuildParity, repair as repairArray, scrub as scrubArray, setUp as setUpArray, startSnapraid, stop as stopArray, sync as syncArray, turnOff as turnOffArray } from "./snapraid";
import { ignoreDisk, unusedDisks, absent, connectVolume, disconnect, checkVolume, wipeDisk, formatDisk, mergeFolders, mountingReport, relabel, startMounting, type Outcome } from "./mounting";
import { moveData } from "./movedata";
import { installPackage } from "./packages";
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
  type User,
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
import { abortUpload, copyIn, archivePlan, emptyTrash, extract as extractArchive, find as findFiles, list as listFiles, makeFile, makeFolder, pinFolder, pinnedFolders, readable, readText, remove as removeFiles, rename as renameFile, restore as restoreFiles, startTrash, summary as filesSummary, transfer, trash, upload, writeText } from "./files";
import { adoptProject, casaosState, containerDraft, importCount, importList, moveInCasaos, projectDraft, rebuildContainer } from "./import";
import { accessOf, dropAccess, dropUser, gateTarget, guard, guardsOf, mayOpen, otherPorts, MAX_APP_BODY, page, passToApp, setAccess, startGates, tunnelHandlers } from "./gate";
import { parseDockerRun } from "./dockerrun";
import { cannotMove, finishMove, moveState } from "./relocate";
import { isPlainObject } from "./fsutil";
import { mcpResponse } from "./mcp";
import { instructions as mcpInstructions, TOOLS } from "./mcptools";
import { localNamesStatus, refreshLocalNames } from "./mdns";
import { addDevice, CHANNELS, listDevices, notifyStatus, pushKey, removeDevice, renewDevice, sendAsk, sendTest, startNotifications, telegramChats, updateNotify } from "./notify";
import { appHost, appLabel, classifyHost, clientIp, cookieDomain, domainOf, localDomain, requestHost, requestPort, requestProto, siteDomain } from "./site";
import { newChallenge, PASSKEY_ALGORITHMS, spendChallenge, verifyAssertion, verifyRegistration } from "./passkey";
import { qrMatrix } from "./qr";
import { connect as connectTailscale, disconnect as disconnectTailscale, install as installTailscale, offerNetworks, report as tailscaleReport, signOut as signOutTailscale, start as startTailscale } from "./tailscale";
import { addDevice as addWireguardDevice, changeDevice as changeWireguardDevice, deviceFile as wireguardDeviceFile, forgetClient as forgetWireguardClient, removeDevice as removeWireguardDevice, report as wireguardReport, setClient as setWireguardClient, setServer as setWireguardServer } from "./wireguard";
import { IMAGE_MIME, imageType, wallpaperSvg, WALLPAPERS } from "./wallpapers";
import { containerCommand, MAX_BUFFERED_BYTES, shellCommand, TerminalError, TerminalManager, terminalEnv, WS_SLOW_CLIENT, type TerminalClient, type TerminalStart } from "./terminal";
import { MuxError, type Channel } from "./mux";
import { crossTransfer } from "./machinefiles";
import { applyMachineCompose, installComposeOnMachine, machineTiles, installOnMachine, machineAppAction, machineAppLogs, machineApps, machineCompose, removeMachineApp, storeAppFor } from "./machineapps";
import { addStore, ARCH, catalogue, removeStore, scheduleStoreSync, StoreError, syncStore } from "./store";
import { startSampler, systemStatus } from "./system";
import { call as machineCall, clientBinary, containersOf, installScript, invite as machineInvite, INVITE_MS, linkData, linkHandlers, machine as machineView, MACHINE_ID_RE, machines as machineList, machinesAway, open as machineOpen, remove as removeMachine, rename as renameMachine, startMachines, updateClient, type LinkSocket } from "./machines";
import { availableUpdate, checkForUpdate, confirmUpdate, scheduleUpdateChecks, startRollback, startUpdate, updateStatus } from "./update";
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
import badgePng from "./ui/badge.png" with { type: "file" };
import icon192 from "./ui/icon-192.png" with { type: "file" };
import icon512 from "./ui/icon-512.png" with { type: "file" };
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
  icons: [
    { src: "/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
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

/** Pictures of the app for systems that take no SVG: notifications, the home screen of a phone */
const ICONS: Record<string, string> = { "/icon-192.png": icon192, "/icon-512.png": icon512, "/badge.png": badgePng };

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
  if (Object.hasOwn(ICONS, path)) {
    return new Response(Bun.file(ICONS[path]!), { headers: { ...SECURITY_HEADERS, "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  }
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

/** When the disk with the data folder will be full, for the "needs attention" list; null — not known or not growing */
function fillingUp(): { path: string; days: number; percent: number } | null {
  const now = fills();
  return now && now.fullIn !== null && now.total > 0 ? { path: now.root, days: now.fullIn, percent: Math.round((now.used / now.total) * 100) } : null;
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

/** The rules ask this administrator for two-factor sign-in, and it is not on yet */
const mustSetUpTwoFactor = (user: User): boolean => user.role === "admin" && settings.security.adminTwoFactor && !user.totp;
/** The user the page is told it is signed in as */
const signedIn = (user: User) => ({ ...publicUser(user), mustTwoFactor: mustSetUpTwoFactor(user) });

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
  const machineId = url.searchParams.get("machine");
  if (machineId !== null) {
    if (!MACHINE_ID_RE.test(machineId)) return fail(404, "machine.notFound");
    const m = machineView(machineId);
    if (!m.online) return fail(409, "machine.offline", { name: m.name });
    const container = url.searchParams.get("container");
    if (container !== null && !/^[a-f0-9]{12,64}$/.test(container)) return fail(404, "machine.noContainer");
    if (!upgrade) return json({ ok: true });
    const data: MachineTerminalSocket = { kind: "machineTerminal", machine: machineId, name: m.name, user, key: container ? `c:${container}` : "host", cols: url.searchParams.get("cols"), rows: url.searchParams.get("rows"), channel: null };
    if (server.upgrade(req, { data })) return undefined as never;
    return fail(400, "request.notFound");
  }
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

/** A terminal of another machine: the browser's socket joined to a channel of the machine's client */
interface MachineTerminalSocket {
  kind: "machineTerminal";
  machine: string;
  name: string;
  user: string;
  /** `host`, or `c:<container id>` */
  key: string;
  cols: string | null;
  rows: string | null;
  channel: Channel | null;
}

function machineTerminalOpen(ws: ServerWebSocket<MachineTerminalSocket>): void {
  const d = ws.data;
  const failed = (e: unknown) => {
    const code = e instanceof MuxError || e instanceof AppError ? e.code : "terminal.spawn";
    ws.send(JSON.stringify({ type: "error", code: code.startsWith("terminal.") ? code : "error." + code, message: e instanceof Error ? e.message : String(e) }));
    ws.close(1011, "failed");
  };
  try {
    d.channel = machineOpen(d.machine, "terminal", { key: d.key, cols: d.cols, rows: d.rows });
  } catch (e) {
    return failed(e);
  }
  const channel = d.channel;
  channel.onControl((m) => {
    if (typeof m.json !== "string") return;
    // a shell really started there: that is worth a line in the activity log
    if (m.json.startsWith('{"type":"ready","created":true')) record("machine.terminal", { user: d.user, detail: d.key === "host" ? d.name : `${d.name}: ${d.key.slice(2, 14)}` });
    ws.send(m.json);
  });
  void (async () => {
    try {
      for (let chunk = await channel.read(); chunk; chunk = await channel.read()) {
        if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) {
          // a slow window: the page connects again and gets the tail
          channel.cancel();
          return ws.close(WS_SLOW_CLIENT, "slow");
        }
        ws.send(chunk);
      }
    } catch {
      // the channel failed: its result says why
    }
  })();
  channel.result.then(
    () => ws.close(1000, "ended"),
    (e) => failed(e),
  );
}

function machineTerminalMessage(ws: ServerWebSocket<MachineTerminalSocket>, message: string | Buffer): void {
  const channel = ws.data.channel;
  if (!channel) return;
  if (typeof message !== "string") {
    if (message.length <= MAX_TERMINAL_INPUT) channel.send(new Uint8Array(message)).catch(() => {});
    return;
  }
  try {
    const data = JSON.parse(message) as { type?: string; cols?: unknown; rows?: unknown };
    if (data.type === "resize") channel.control({ type: "resize", cols: data.cols, rows: data.rows });
  } catch {
    // not ours to understand
  }
}

type AnySocket = ServerWebSocket<TerminalSocket | MachineTerminalSocket | LinkSocket | Parameters<typeof tunnelHandlers.open>[0]["data"]>;
const isTerminal = (ws: AnySocket): ws is ServerWebSocket<TerminalSocket> => (ws.data as { kind?: string }).kind === "terminal";
const isLink = (ws: AnySocket): ws is ServerWebSocket<LinkSocket> => (ws.data as { kind?: string }).kind === "machine";
const isMachineTerminal = (ws: AnySocket): ws is ServerWebSocket<MachineTerminalSocket> => (ws.data as { kind?: string }).kind === "machineTerminal";

/** The sockets of Hata's own listeners: terminals, and connections passed on to apps */
const sockets = {
  open(ws: AnySocket) {
    if (isLink(ws)) return linkHandlers.open(ws);
    if (isMachineTerminal(ws)) return machineTerminalOpen(ws);
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
    if (isLink(ws)) return linkHandlers.message(ws, message);
    if (isMachineTerminal(ws)) return machineTerminalMessage(ws, message);
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
    if (isLink(ws)) return linkHandlers.close(ws);
    if (isMachineTerminal(ws)) return ws.data.channel?.cancel();
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
  if (write && path !== "/api/files/upload" && !/^\/api\/machines\/[a-f0-9]{8}\/files\/upload$/.test(path) && path !== "/api/appearance/wallpaper" && Number(req.headers.get("content-length") ?? 0) > MAX_API_BODY) return fail(413, "request.tooLarge");
  const cookie = (token: string) => sessionCookie(token, requestProto(req) === "https", cookieDomain(requestHost(req)));
  const client = { ip, userAgent: req.headers.get("user-agent") ?? "" };

  if (path === "/api/state" && method === "GET") {
    const user = sessionUser(req);
    return json({
      version: VERSION,
      setup: needsSetup(),
      user: user ? signedIn(user) : null,
      language: settings.language,
      languages: Object.keys(LANGUAGES),
      passkeys: passkeyDomain(req) !== "",
      // a new server: its administrator is walked through the first choices
      welcome: settings.welcome && user?.role === "admin",
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
    updateSettings({ welcome: true });
    return json({ user: signedIn(result) }, 200, { "set-cookie": cookie(createSession(result, client)) });
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
    return json({ user: signedIn(user) }, 200, { "set-cookie": cookie(createSession(user, client)) });
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
    return json({ user: signedIn(found.user) }, 200, { "set-cookie": cookie(createSession(found.user, client)) });
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
    return json({ user: signedIn(result) }, 200, { "set-cookie": cookie(createSession(result, client)) });
  }

  // ---- everything below needs a session ----
  const user = sessionUser(req);
  if (!user) return fail(401, "auth.required");
  // an administrator the rules ask for two-factor sign-in is a member until it is set up
  const admin = user.role === "admin" && !mustSetUpTwoFactor(user);
  if (!admin && !memberMay(method, path, user.role === "admin" ? "member" : user.role)) return fail(403, user.role === "admin" ? "auth.twoFactorRequired" : "auth.forbidden");

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
    if (user.role === "admin" && settings.security.adminTwoFactor) return fail(400, "totp.required");
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

  // ---- access keys of agents (the MCP server) ----
  if (path === "/api/agents") {
    if (method === "GET") return json(listKeys());
    if (method === "POST") {
      const data = await body(req);
      const made = createKey(data.name, data.level, user.name, data.confirm === true);
      if (typeof made === "string") return fail(made === "agents.nameTaken" ? 409 : 400, made);
      record("agents.create", { user: user.name, detail: made.info.name });
      return json(made, 201);
    }
  }
  const agent = /^\/api\/agents\/([0-9a-f-]{36})$/.exec(path);
  if (agent && method === "DELETE") {
    const gone = removeKey(agent[1]!);
    if (!gone) return fail(404, "agents.notFound");
    desk.forget(gone.name);
    record("agents.remove", { user: user.name, detail: gone.name });
    return json({ ok: true });
  }
  if (agent && method === "PATCH") {
    const key = setConfirm(agent[1]!, (await body(req)).confirm === true);
    if (!key) return fail(404, "agents.notFound");
    record(key.confirm ? "agents.asks" : "agents.asksNot", { user: user.name, detail: key.name });
    return json({ ok: true });
  }

  // ---- the assistant: a chat with a model that works with the tools of the MCP server (`assistant.ts`) ----
  if (path === "/api/assistant" && method === "GET") return json({ config: shownAssistant(), chats: listChats(user.id) });
  if (path === "/api/assistant/config" && method === "PUT") {
    const error = updateAssistant(await body(req));
    if (error) return fail(400, error);
    record("assistant.config", { user: user.name });
    return json({ config: shownAssistant() });
  }
  if (path === "/api/assistant/models" && method === "POST") {
    try {
      return json({ models: await modelsFor(await body(req)) });
    } catch (e) {
      if (e instanceof ModelError) return fail(502, "assistant." + e.code, { message: e.message });
      throw e;
    }
  }
  // where the person has Hata open: the assistant gives the addresses of apps with that host
  const assistantHost = { tools: TOOLS, instructions: mcpInstructions, origin: `${requestProto(req)}://${req.headers.get("host") ?? new URL(req.url).host}` };
  if (path === "/api/assistant/chats" && method === "POST") {
    const chat = sayToAssistant(user, null, (await body(req)).text, assistantHost);
    return typeof chat === "string" ? fail(400, chat) : json(shownChat(chat), 201);
  }
  const talk = /^\/api\/assistant\/chats\/([0-9a-f-]{36})(?:\/(stop|calls\/([\w-]{1,120})))?$/.exec(path);
  if (talk) {
    const [, chatId, sub, callId] = talk;
    if (!sub && method === "GET") {
      const chat = findChat(user.id, chatId!);
      return chat ? json(shownChat(chat)) : fail(404, "assistant.noChat");
    }
    if (!sub && method === "DELETE") return removeChat(user.id, chatId!) ? json({ ok: true }) : fail(404, "assistant.noChat");
    if (method === "POST") {
      if (sub === "stop") return stopChat(user.id, chatId!) ? json({ ok: true }) : fail(404, "assistant.noChat");
      const data = await body(req);
      const chat = callId ? answerCall(user.id, chatId!, callId, data.run === true, assistantHost) : data.retry === true ? retryAssistant(user.id, chatId!, assistantHost) : sayToAssistant(user, chatId!, data.text, assistantHost);
      return typeof chat === "string" ? fail(chat === "assistant.noChat" ? 404 : 409, chat) : json(shownChat(chat));
    }
  }

  // ---- a connector that signs in: the question put to the administrator (`oauth.ts`) ----
  const connect = /^\/api\/oauth\/requests\/([0-9a-f-]{36})$/.exec(path);
  if (connect) {
    const q = oauthQuestion(connect[1]!);
    if (!q) return fail(404, "oauth.gone");
    if (method === "GET") return json({ name: q.name, redirect: q.redirect, level: q.level });
    if (method === "POST") {
      const data = await body(req);
      if (data.allow !== true) return json({ redirect: oauthDeclined(q.id) });
      // a link is enough to put this question on the screen: only the person who knows the password answers it
      if (!(await checkOwnPassword(user, data.password))) return fail(400, "auth.wrongPassword");
      const refused = cannotGrant(data.level);
      if (refused) return fail(400, refused);
      // the connector's own name says little ("MCP CLI Proxy"): the administrator may give the access another
      const typed = typeof data.name === "string" && data.name.trim() !== "";
      const name = typed ? cleanName(data.name) : "";
      if (typed && !name) return fail(400, "agents.badName");
      record("agents.connect", { user: user.name, detail: name && name !== q.name ? `${name} (${q.name})` : q.name });
      return json({ redirect: oauthAllowed(q.id, { level: data.level as Level, confirm: data.confirm === true, by: user.name, ...(name ? { name } : {}) }) });
    }
  }

  // ---- calls of agents that wait for an administrator's word ----
  if (path === "/api/approvals" && method === "GET") return json(desk.waiting().map(({ print: _, ...ask }) => ask));
  const asked = /^\/api\/approvals\/([0-9a-f-]{36})$/.exec(path);
  if (asked && method === "POST") {
    const ask = desk.decide(asked[1]!, (await body(req)).allow === true, user.name);
    if (!ask) return fail(404, "approvals.gone");
    record(ask.state === "allowed" ? "agents.allowed" : "agents.declined", { user: user.name, detail: `${ask.agent}: ${ask.tool}${typeof ask.args.app === "string" ? " " + ask.args.app : ""}` });
    return json({ ok: true });
  }

  // ---- who may open what ----
  if (path === "/api/access" && method === "GET") {
    const apps = (await listApps(language(url))).map((app) => {
      const compose = readCompose(app.name);
      const env = appEnv(app.name);
      const gate = compose ? gateTarget(compose, settings.dataRoot, env) : "noPort";
      const access = accessOf(app.name);
      // the app's other published ports: sign-in in front of the web port does not close them
      const others = compose ? otherPorts(compose, settings.dataRoot, env).map((p) => ({ port: p.port, guarded: guardsOf(access).some((g) => g.port === p.port) })) : [];
      return { name: app.name, title: app.title, icon: app.icon, allowed: access.allowed, protect: access.protect, cannotProtect: typeof gate === "string" ? gate : null, others };
    });
    return json({ apps, users: listUsers().map(({ id, name, role }) => ({ id, name, role })) });
  }

  if (path === "/api/events" && method === "GET") return events(req, server, admin);

  if (path === "/api/overview" && method === "GET") {
    const [docker, all, containers, onMachines] = await Promise.all([dockerInfo(), listApps(language(url)), admin ? listContainers().catch(() => []) : [], admin ? machineTiles(machineList(), language(url)) : []]);
    const apps = all.filter((app) => mayOpen(user, app.name));
    const system = systemStatus();
    return json({
      system,
      docker,
      apps,
      arch: ARCH,
      // with a domain, apps are opened at <label>.<domain> when Hata itself is opened by that domain
      site: { domain: siteDomain(), mode: settings.https.mode, local: localDomain() },
      // whether the assistant can be asked: the pages offer it next to what is wrong
      assistant: admin && assistantReady(assistantConfig()),
      attention: admin ? attention({ system, docker, apps, activity: recent(100), update: availableUpdate(), offsite: offsiteFailure(), disks: diskHealth(), trash: trashSizeOn, absent: absent(), internet: internetTrouble(), exposed: exposedNics(), array: arrayTrouble(), shares: shareTrouble(), places: placesDown(), machines: machinesAway(), unused: unusedDisks(), filling: fillingUp() }) : [],
      // who signed in from where, and what was installed by whom, is the administrators' business
      activity: admin ? recent(8) : [],
      // containers and compose projects on this machine that are not apps here yet
      importable: admin ? importCount(containers) : 0,
      // folders an administrator put on the dashboard from the file manager
      folders: admin ? pinnedFolders() : [],
      // apps of the other machines, for administrators: their tiles are `<name>@<machine>`
      machineApps: onMachines,
      dashboard: arrange(settings.dashboard, [...apps.map((app) => app.name), ...onMachines.map((app) => app.key)], admin ? settings.folders : [], admin ? ["store", "add"] : user.role === "guest" ? [] : ["store"]),
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
    const onMachines = await machineTiles(machineList(), "en");
    return json({ text: layoutText(arrange(settings.dashboard, [...apps.map((app) => app.name), ...onMachines.map((app) => app.key)], settings.folders, ["store", "add"])) });
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
    // the page of the whole history asks for it in parts
    if (url.searchParams.has("before")) return json(history(Number(url.searchParams.get("before")), 200));
    return json(recent(app ? 20 : 100, app));
  }

  if (path === "/api/settings") {
    if (method === "GET") return json(publicSettings());
    if (method === "PUT") {
      const patch = await body(req);
      // whoever turns the rule on must not be the first one it locks out
      if (isPlainObject(patch.security) && patch.security.adminTwoFactor === true && !user.totp) return fail(400, "security.ownFirst");
      const error = updateSettings(patch);
      if (error) return fail(400, error);
      // certificates take a while: the page asks for their state
      if ("https" in patch) void refreshHttps(true);
      if ("local" in patch) {
        refreshLocalNames();
        // the shared folders are announced under the same name
        refreshShares();
      }
      return json(publicSettings());
    }
  }

  if (path === "/api/network" && method === "GET") return json(await networkReport());
  if (path.startsWith("/api/network")) {
    try {
      if (path === "/api/network/package" && method === "POST") {
        const name = (await body(req)).package ?? "network-manager";
        if (typeof name !== "string" || !NETWORK_PACKAGES.includes(name)) return fail(400, "network.failed", { message: "not a package Hata installs" });
        server.timeout(req, 0);
        const message = await installPackage(name);
        if (message) return fail(500, "network.failed", { message });
        await afterPackage(name);
        return json(await networkReport());
      }
      if (path === "/api/network/check" && method === "PUT") {
        server.timeout(req, 0);
        await setCheck((await body(req)).on, user.name);
        return json(await networkReport());
      }
      if (path === "/api/network/confirm" && method === "POST") return (await confirmChange()) ? json(await networkReport()) : fail(409, "network.nothingPending");
      if (path === "/api/network/revert" && method === "POST") {
        await revertChange();
        return json(await networkReport());
      }
      const wifi = /^\/api\/network\/([A-Za-z0-9_.-]{1,15})\/wifi$/.exec(path);
      if (wifi) {
        // looking around and joining a network take their time
        server.timeout(req, 0);
        if (method === "GET") return json({ networks: await wifiNetworks(wifi[1]!) });
        if (method === "POST") await wifiConnect(wifi[1]!, await body(req), user.name);
        else if (method === "DELETE") await wifiForget(wifi[1]!, user.name);
        else return fail(404, "network.noNic");
        return json(await networkReport());
      }
      const hotspot = /^\/api\/network\/([A-Za-z0-9_.-]{1,15})\/hotspot$/.exec(path);
      if (hotspot && (method === "PUT" || method === "DELETE")) {
        server.timeout(req, 0);
        if (method === "PUT") await startHotspot(hotspot[1]!, await body(req), user.name);
        else await stopHotspot(hotspot[1]!, user.name);
        return json(await networkReport());
      }
      // the code a phone's camera reads to join the access point
      if (hotspot && method === "GET") {
        const spot = (await networkReport()).nics.find((n) => n.name === hotspot[1])?.wifi?.hotspot;
        if (!spot) return fail(404, "network.noNic");
        return json({ qr: qrMatrix(wifiQrText(spot.ssid, spot.password)).map((row) => row.map((dark) => (dark ? "1" : "0")).join("")) });
      }
      const side = /^\/api\/network\/([A-Za-z0-9_.-]{1,15})\/side$/.exec(path);
      if (side && method === "PUT") {
        // the address the packets come from, a proxy's included: that is what the rules would stop
        await setSide(side[1]!, (await body(req)).side, server.requestIP(req)?.address ?? "", user.name);
        // the server stops announcing itself there, and the network folders follow
        refreshShares();
        return json(await networkReport());
      }
      const role = /^\/api\/network\/([A-Za-z0-9_.-]{1,15})\/role$/.exec(path);
      if (role && method === "PUT") {
        await setRole(role[1]!, (await body(req)).role, user.name);
        return json(await networkReport());
      }
      const nic = /^\/api\/network\/([A-Za-z0-9_.-]{1,15})(\/handover|\/handback)?$/.exec(path);
      if (nic && method === "POST" && nic[2] === "/handover") return json(await handOver(nic[1]!, user.name));
      if (nic && method === "POST" && nic[2] === "/handback") return json(await giveBack(nic[1]!, user.name));
      if (nic && method === "PUT" && !nic[2]) return json(await changeNic(nic[1]!, await body(req), user.name));
    } catch (e) {
      if (e instanceof NetworkError) return fail(e.code === "network.noNic" ? 404 : 400, e.code, e.detail);
      throw e;
    }
  }

  if (path === "/api/images" && method === "GET") return json(await imagesStatus());
  // the answer does not wait for the registries: the page asks again while it runs
  if (path === "/api/images/check" && method === "POST") {
    void checkImages();
    return json(await imagesStatus());
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
  // sent by the service worker when the browser has replaced the subscription by itself
  if (path === "/api/notify/push/renew" && method === "POST") {
    const data = await body(req);
    return renewDevice(user.id, data.old, data.subscription) ? json({ ok: true }) : fail(404, "notify.noDevice");
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

  // the data folder moves as a job: the apps are stopped, the files copied, the apps pointed at them
  if (path === "/api/data-root/move" && method === "POST") {
    const job = moveData((await body(req)).path, user.name);
    return job ? json({ job: job.id, app: job.app }, 202) : json({ path: settings.dataRoot });
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
  const storage = async (more: Record<string, unknown> = {}) => {
    const listed = await listDisks();
    return json({ ...listed, fills: fills(), mounting: mountingReport(listed.disks), array: arrayReport(), ...more });
  };
  const refused = (failure: Extract<Outcome, { error: string }>) => fail(400, failure.error, { message: failure.message ?? "", ...(failure.needs ?? {}) });
  // a long piece of work on a disk: answered at once with the job the page then follows
  const diskJob = (kind: "format" | "fsck" | "wipe", by: string, work: (log: (line: string) => void) => Promise<void>, started: (job: Job) => void = () => {}) => {
    try {
      const job = startJob("", kind, by, work, true);
      started(job);
      return json({ job: job.id }, 202);
    } catch (e) {
      if (e instanceof AppError && e.code === "app.busy") return fail(409, "disk.working");
      throw e;
    }
  };
  const failureWords = (failure: Extract<Outcome, { error: string }>) => `${({ "disk.busy": "Something is still using the folder.", "disk.mountFailed": "The disk could not be connected.", "disk.formatFailed": "The disk could not be formatted.", "disk.wipeFailed": "The disk could not be erased.", "disk.inUse": "The disk is in use." } as Record<string, string>)[failure.error] ?? failure.error} ${failure.message ?? ""}`.trim();
  const changed = (outcome: Outcome) => ("error" in outcome ? refused(outcome) : storage());
  if (path === "/api/disks" && method === "GET") return storage();

  // ---- folders of other machines mounted here (never through MCP: passwords) ----
  if (path === "/api/netplaces" && method === "GET") return json(await listPlaces());
  if (path === "/api/netplaces/discover" && method === "GET") return json(await discoverPlaces());
  if (path === "/api/netplaces/shares" && method === "POST") return json(await placeShares(await body(req)));
  if (path === "/api/netplaces/package" && method === "POST") {
    server.timeout(req, 0);
    const failed = await installPlaceTools((await body(req)).kind);
    return failed ? fail(500, "netplace.packageFailed", { message: failed }) : json(await listPlaces());
  }
  if (path === "/api/netplaces" && method === "POST") {
    server.timeout(req, 0);
    const res = await savePlace(await body(req), null, user.name);
    return Array.isArray(res) ? json({ places: res }, 201) : json(res);
  }
  const place = /^\/api\/netplaces\/([a-z0-9-]{1,40})(\/retry)?$/.exec(path);
  if (place && method === "POST" && place[2]) {
    server.timeout(req, 0);
    return json({ places: await retryPlace(place[1]!) });
  }
  if (place && !place[2] && method === "PUT") {
    server.timeout(req, 0);
    const res = await savePlace(await body(req), place[1]!, user.name);
    return Array.isArray(res) ? json({ places: res }) : json(res);
  }
  if (place && !place[2] && method === "DELETE") return json({ places: await removePlace(place[1]!, user.name) });
  if (path === "/api/disks/check" && method === "POST") {
    // a disk that sleeps takes its time to spin up
    server.timeout(req, 0);
    await checkDisks(true);
    return storage();
  }
  if (path === "/api/disks/tool" && method === "POST") {
    server.timeout(req, 0);
    const message = await installTool();
    if (message) return fail(500, "disk.installFailed", { message });
    return storage();
  }
  // what a disk action said it lacks, installed by the button next to the reason and the command
  if (path === "/api/disks/package" && method === "POST") {
    const name = (await body(req)).package;
    if (typeof name !== "string" || !["ntfs-3g", "fdisk", "sfdisk", "util-linux", "e2fsprogs", "dosfstools", "exfatprogs", "mergerfs", "snapraid"].includes(name)) return fail(400, "disk.packageFailed", { message: "not a package Hata installs" });
    server.timeout(req, 0);
    const message = await installPackage(name);
    if (message) return fail(500, "disk.packageFailed", { message });
    return storage();
  }
  // erasing a disk asks for the password, like everything that cannot be undone by a second click
  const diskFormat = /^\/api\/disks\/([A-Za-z0-9_-]+)\/format$/.exec(path);
  if (diskFormat && method === "POST") {
    const data = await body(req);
    // a new partition in free room erases nothing
    if (data.part !== "free" && !(await checkOwnPassword(user, data.password))) return fail(400, "auth.wrongPassword");
    // a large disk takes its time
    server.timeout(req, 0);
    const ask = { part: String(data.part ?? ""), size: Number(data.bytes) || 0, fs: String(data.fs ?? ""), label: String(data.label ?? ""), connect: data.connect === "keep" || data.connect === "once" ? data.connect : "no", name: String(data.name ?? "") };
    const seen = { serial: String(data.serial ?? ""), size: Number(data.size) };
    // what can be refused is refused at once, in the dialog; the work itself is a job with a log
    const may = await formatDisk(diskFormat[1]!, seen, ask, user.name, undefined, true);
    if ("error" in may) return refused(may);
    return diskJob("format", user.name, async (log) => {
      const done = await formatDisk(diskFormat[1]!, seen, ask, user.name, log);
      if ("error" in done) throw new Error(failureWords(done));
      log(done.path ? `Done: connected as ${done.path}` : "Done");
    });
  }
  const diskWipe = /^\/api\/disks\/([A-Za-z0-9_-]+)\/wipe$/.exec(path);
  if (diskWipe && method === "POST") {
    const data = await body(req);
    if (!(await checkOwnPassword(user, data.password))) return fail(400, "auth.wrongPassword");
    const seen = { serial: String(data.serial ?? ""), size: Number(data.size) };
    const may = await wipeDisk(diskWipe[1]!, seen, data.thorough === true, user.name, undefined, true);
    if ("error" in may) return refused(may);
    return diskJob("wipe", user.name, async (log) => {
      const done = await wipeDisk(diskWipe[1]!, seen, data.thorough === true, user.name, log);
      if ("error" in done) throw new Error(failureWords(done));
      log("Done: the disk is empty");
    });
  }
  // looking a file system over, and mending it: the answer carries what the program said
  if (path === "/api/disks/fsck" && method === "POST") {
    const data = await body(req);
    server.timeout(req, 0);
    const device = String(data.device ?? "");
    const may = await checkVolume(device, data.repair === true, user.name, undefined, true);
    if ("error" in may) return refused(may);
    let job: Job | undefined;
    const answer = diskJob("fsck", user.name, async (log) => {
      const checked = await checkVolume(device, data.repair === true, user.name, log);
      if ("error" in checked) throw new Error(failureWords(checked));
      if (job) job.result = checked;
    }, (started) => (job = started));
    return answer;
  }
  if (path === "/api/disks/label" && method === "POST") {
    const data = await body(req);
    server.timeout(req, 0);
    return changed(await relabel(String(data.device ?? ""), String(data.label ?? ""), user.name));
  }
  if (path === "/api/disks/connect" && method === "POST") {
    const data = await body(req);
    server.timeout(req, 0);
    return changed(await connectVolume(String(data.device ?? ""), String(data.name ?? ""), data.keep === true, user.name));
  }
  if (path === "/api/disks/merge" && method === "POST") {
    const data = await body(req);
    return changed(await mergeFolders(data.folders, String(data.name ?? ""), user.name));
  }
  if (path === "/api/disks/disconnect" && method === "POST") {
    server.timeout(req, 0);
    return changed(await disconnect(String((await body(req)).path ?? ""), user.name));
  }
  // every program of the system Hata relies on, in one list
  if (path === "/api/tools" && method === "GET") return json(await toolsReport());
  const tool = /^\/api\/tools\/([a-z0-9-]+)\/install$/.exec(path);
  if (tool && method === "POST") {
    server.timeout(req, 0);
    const done = await installOne(tool[1]!, user.name);
    if ("job" in done) return json({ job: done.job.id }, 202);
    if (done.error) return fail(500, "tools.installFailed", { message: done.error });
    return json(await toolsReport());
  }
  const toolGone = /^\/api\/tools\/([a-z0-9-]+)\/remove$/.exec(path);
  if (toolGone && method === "POST") {
    // without Docker every app is down: asked for the password, like everything that hurts to undo
    if (toolGone[1] === "docker" && !(await checkOwnPassword(user, (await body(req)).password))) return fail(400, "auth.wrongPassword");
    server.timeout(req, 0);
    const failed = await removeOne(toolGone[1]!, user.name);
    if (failed) return fail(failed.message ? 500 : 409, failed.code, { message: failed.message ?? "" });
    return json(await toolsReport());
  }
  // remote access: the server in the person's own private network
  if (path === "/api/tailscale" && method === "GET") return json(await tailscaleReport(listenAddress().port));
  if (path.startsWith("/api/tailscale/") && method === "POST") {
    const what = path.slice("/api/tailscale/".length);
    if (what === "install") return json({ job: installTailscale(user.name).id }, 202);
    server.timeout(req, 0);
    const data = await body(req);
    if (what === "start") await startTailscale();
    else if (what === "connect") await connectTailscale(data.server, user.name);
    else if (what === "disconnect") await disconnectTailscale(user.name);
    else if (what === "signout") await signOutTailscale(user.name);
    else if (what === "networks") await offerNetworks(data.on === true, user.name);
    else return fail(404, "request.notFound");
    return json(await tailscaleReport(listenAddress().port));
  }
  // WireGuard: devices let in to this server, and this server joining somebody else's
  if (path === "/api/wireguard" && method === "GET") return json(await wireguardReport(listenAddress().port));
  if (path.startsWith("/api/wireguard/")) {
    server.timeout(req, 0);
    const what = path.slice("/api/wireguard/".length);
    const one = /^devices\/([0-9a-f]{8})$/.exec(what);
    let extra = {};
    if (what === "server" && method === "PUT") await setWireguardServer(await body(req), user.name);
    else if (what === "devices" && method === "POST") extra = { added: await addWireguardDevice(await body(req), user.name) };
    else if (one && method === "GET") {
      const file = wireguardDeviceFile(one[1]!);
      // the file for a computer: saved under the device's name
      if (url.searchParams.has("download")) return new Response(file.conf, { headers: { "x-content-type-options": "nosniff", "content-type": "application/octet-stream", "content-disposition": disposition("attachment", `${file.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "hata"}.conf`), "cache-control": "no-store" } });
      return json({ ...file, qr: qrMatrix(file.conf).map((row) => row.map((dark) => (dark ? "1" : "0")).join("")) });
    } else if (one && method === "PUT") await changeWireguardDevice(one[1]!, await body(req));
    else if (one && method === "DELETE") await removeWireguardDevice(one[1]!, user.name);
    else if (what === "client" && method === "PUT") extra = await setWireguardClient(await body(req), user.name);
    else if (what === "client" && method === "DELETE") await forgetWireguardClient(user.name);
    else return fail(404, "request.notFound");
    return json({ ...(await wireguardReport(listenAddress().port)), ...extra });
  }
  // Docker itself, for a server that has none: the button on the home page
  if (path === "/api/docker" && method === "GET") return json({ ...(await dockerInfo()), install: DOCKER_INSTALL_COMMAND });
  if (path === "/api/docker/install" && method === "POST") return json({ job: installDocker(user.name).id }, 202);
  if (path === "/api/docker/start" && method === "POST") {
    await startDocker();
    return json(await dockerInfo());
  }
  // protection from a disk failure; the long runs answer at once and the page follows them
  if (path.startsWith("/api/disks/array")) {
    try {
      const what = path.slice("/api/disks/array".length);
      if (what === "" && method === "PUT") setUpArray(await body(req), user.name);
      else if (what === "" && method === "DELETE") turnOffArray(url.searchParams.get("wipe") === "1", user.name);
      else if (method !== "POST") return fail(404, "notFound");
      else if (what === "/sync") {
        const asked = await body(req);
        syncArray(asked.force === true, user.name, asked.empty === true);
      }
      else if (what === "/scrub") scrubArray((await body(req)).whole === true, user.name);
      else if (what === "/repair") repairArray(user.name);
      else if (what === "/fix") bringBack((await body(req)).disk, user.name);
      else if (what === "/rebuild") rebuildParity(user.name);
      else if (what === "/stop") stopArray();
      else return fail(404, "notFound");
      return storage();
    } catch (e) {
      if (e instanceof ArrayError) return fail(400, e.code, e.detail);
      throw e;
    }
  }
  if (path === "/api/disks/ignore" && method === "POST") {
    ignoreDisk((await body(req)).id);
    return storage();
  }
  // the answer does not wait for the measuring: the page asks again while it runs
  if (path === "/api/disks/fills" && method === "POST") {
    void measureFills();
    return storage();
  }
  const diskTest = /^\/api\/disks\/([A-Za-z0-9_-]+)\/test$/.exec(path);
  if (diskTest && method === "POST") {
    const type = (await body(req)).type === "long" ? "long" : "short";
    const failed = await startSelfTest(diskTest[1]!, type);
    if (failed) return fail(failed === "disk.unknown" ? 404 : 400, failed);
    return storage();
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
  if (path === "/api/update/rollback" && method === "POST") {
    const error = startRollback(user.name);
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
  // the folders of an app outside AppData: which of them go into its snapshots
  const chosen = /^\/api\/backups\/([a-z0-9_-]+)\/folders$/.exec(path);
  if (chosen && (method === "GET" || method === "PUT")) {
    const name = chosen[1]!;
    if (!installedNames().includes(name)) return fail(404, "app.notFound");
    if (method === "PUT") {
      const asked = (await body(req)).folders;
      const { other } = appFolders(name);
      if (!Array.isArray(asked) || asked.some((p) => typeof p !== "string" || !other.includes(p) || !extraAllowed(p))) return fail(400, "backup.badFolder");
      const error = updateSettings({ backup: { folders: { [name]: asked } } });
      if (error) return fail(400, error);
      record("app.backup.folders", { app: name, user: user.name, detail: String(asked.length) });
    }
    const { included, other, extra } = appFolders(name);
    // counting a large folder takes its time; one that takes too long simply has no number
    server.timeout(req, 0);
    return json({
      always: included,
      folders: await Promise.all(other.map(async (folder) => ({ path: folder, allowed: extraAllowed(folder), included: extra.includes(folder), size: extraAllowed(folder) ? await folderSize(folder) : null }))),
    });
  }
  // looking inside a snapshot
  const inside = /^\/api\/backups\/([a-z0-9_-]+)\/(\d{8}-\d{6})\/(files|file|restore-files)$/.exec(path);
  if (inside) {
    // the first look reads the whole archive
    server.timeout(req, 0);
    const at = url.searchParams.get("path") ?? "";
    if (inside[3] === "files" && method === "GET") return json(await snapshotFiles(inside[1]!, inside[2]!, at));
    if (inside[3] === "file" && method === "GET") {
      const file = await snapshotFile(inside[1]!, inside[2]!, at);
      return new Response(file.body, { headers: { "x-content-type-options": "nosniff", "content-type": "application/octet-stream", "content-length": String(file.size), "content-disposition": disposition("attachment", file.name), "cache-control": "no-store" } });
    }
    if (inside[3] === "restore-files" && method === "POST") return json({ job: restoreFromSnapshot(inside[1]!, inside[2]!, (await body(req)).paths, user.name).id }, 202);
  }
  const b = /^\/api\/backups\/([a-z0-9_-]+)\/(\d{8}-\d{6})(\/restore)?$/.exec(path);
  if (b && b[3] && method === "POST") return json({ job: restoreSnapshot(b[1]!, b[2]!, user.name).id }, 202);
  if (b && !b[3] && method === "DELETE") {
    deleteSnapshot(b[1]!, b[2]!);
    record("app.snapshot.remove", { app: b[1]!, user: user.name });
    return json({ ok: true });
  }

  // ---- other machines (administrators only) ----
  if (path.startsWith("/api/machines")) {
    const response = await machinesApi(req, url, server, user.name);
    if (response) return response;
  }

  // ---- files (administrators only: members were turned away above) ----
  if (path.startsWith("/api/files")) {
    const response = await files(req, url, server, user.name);
    if (response) return response;
  }

  if (path === "/api/store" && method === "GET") return json(catalogue(language(url)));

  if (path === "/api/stores" && method === "POST") {
    try {
      // the repository is read before it is kept: that takes a while
      server.timeout(req, 0);
      return json(await addStore((await body(req)).url, user.name), 201);
    } catch (e) {
      if (e instanceof StoreError) return fail(e.code === "store.exists" ? 409 : 400, e.code, e.detail);
      throw e;
    }
  }
  const storeGone = /^\/api\/stores\/([a-z0-9-]+)$/.exec(path);
  if (storeGone && method === "DELETE") {
    try {
      removeStore(storeGone[1]!, user.name);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof StoreError) return fail(404, e.code);
      throw e;
    }
  }
  let m = /^\/api\/store\/([a-z0-9-]+)\/sync$/.exec(path);
  if (m && method === "POST") return json(await syncStore(m[1]!));

  m = /^\/api\/store\/([a-z0-9-]+)\/apps\/([a-z0-9_-]+)$/.exec(path);
  if (m && method === "GET") {
    const on = url.searchParams.get("machine");
    // the form for another machine: its data folder and its ports
    if (on && user.role === "admin") return json(await storeAppFor(on, m[1]!, m[2]!, language(url)));
    return json(await storeAppDetail(m[1]!, m[2]!, language(url)));
  }

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
      const ports = Array.isArray(data.ports) ? data.ports.filter((p): p is number => Number.isInteger(p)) : undefined;
      const job = setAccess(name, { allowed, protect: data.protect === true, ports }, user.name);
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

/** The address the caller reached the server at, as the OAuth documents must name it */
const reachedAt = (req: Request): string => `${requestProto(req)}://${req.headers.get("host") ?? new URL(req.url).host}`;

/** These are read by programs in other people's pages too; nothing here goes by a cookie */
const OPEN = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS", "cache-control": "no-store" };
const open = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { ...OPEN, "content-type": "application/json" } });

/** A form or JSON, as the token endpoint is sent either */
async function fields(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text().catch(() => "");
  if ((req.headers.get("content-type") ?? "").startsWith("application/json")) {
    try {
      const data: unknown = JSON.parse(text);
      return isPlainObject(data) ? data : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/**
 * The OAuth side of the MCP server (`oauth.ts`): what a connector reads and calls by itself. The one
 * step with a person in it — `/oauth/authorize` — only notes the question and hands over to the web
 * UI, where a signed-in administrator answers it. null — not one of these addresses.
 */
async function oauth(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const known = path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp" || path === "/.well-known/oauth-authorization-server" || path.startsWith("/oauth/");
  if (!known) return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: OPEN });
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) return new Response(null, { status: 413 });
  const base = reachedAt(req);
  if (req.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource")) return open(resourceMetadata(base));
  if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") return open(serverMetadata(base));
  if (req.method === "POST" && path === "/oauth/register") {
    const answer = oauthRegister(await req.json().catch(() => null));
    return open(answer, "error" in answer ? 400 : 201);
  }
  if (req.method === "GET" && path === "/oauth/authorize") {
    const read = readAuthorize(url.searchParams, findClient(url.searchParams.get("client_id")));
    if ("refuse" in read) return new Response(read.refuse, { status: 400, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" } });
    return new Response(null, { status: 302, headers: { location: "back" in read ? read.back : `/#/connect/${holdQuestion(read.ask)}`, "cache-control": "no-store" } });
  }
  if (req.method === "POST" && path === "/oauth/token") {
    const data = await fields(req);
    let tokens;
    if (data.grant_type === "authorization_code") {
      const spent = spendCode({ code: data.code, client: data.client_id, redirect: data.redirect_uri, verifier: data.code_verifier });
      tokens = spent ? grantKey(spent.client, spent.grant) : null;
    } else if (data.grant_type === "refresh_token") tokens = renewTokens(data.refresh_token, data.client_id);
    else return open({ error: "unsupported_grant_type" }, 400);
    return tokens ? open(tokens) : open({ error: "invalid_grant", error_description: "The code or token is wrong, was used already, or its time has passed." }, 400);
  }
  return new Response(null, { status: 404, headers: OPEN });
}

/** Where the destroying calls of agents wait for an administrator's word */
const desk = new Desk({ asked: (ask) => void sendAsk(ask), changed: () => bus.publish("approvals") });

/**
 * The MCP server, for agents. It is not part of `/api/`: nothing here goes by a session cookie, so a
 * page in somebody's browser has no way in — only the holder of an access key, sent as a Bearer token.
 */
async function mcp(req: Request, server: Server): Promise<Response> {
  const key = keyOf(req, clientIp(req, server));
  // a connector that can sign in learns from the header where to; one whose token ran out, that it is time for the next
  if (!key) {
    const sent = req.headers.has("authorization");
    return new Response(JSON.stringify({ error: "An access key is required: Authorization: Bearer <key>. Keys are made in Hata, Settings → Agents." }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": `Bearer ${sent ? 'error="invalid_token", ' : ""}resource_metadata="${reachedAt(req)}/.well-known/oauth-protected-resource"`, "cache-control": "no-store" } });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_API_BODY) return new Response(null, { status: 413 });
  // a tool waits for an operation for half a minute; the default idle timeout would cut the answer
  server.timeout(req, 120);
  return mcpResponse(req, TOOLS, { name: key.name, level: key.level, user: agentUser(key), confirm: key.confirm, origin: `${requestProto(req)}://${req.headers.get("host") ?? new URL(req.url).host}` }, { version: VERSION, instructions: mcpInstructions, approve: (tool, args, caller) => desk.ask(caller.name, tool, args) });
}

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
  return sendBytes(req, file, download, (start, end) => Bun.file(file.file).slice(start, end + 1));
}

/** A file to the browser, with ranges for players: `bytes` gives the part from `start` to `end`, inclusive */
function sendBytes(req: Request, file: { name: string; size: number; modified: number; inline: string }, download: boolean, bytes: (start: number, end: number) => BodyInit): Response {
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
    return new Response(bytes(start, end), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${file.size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(file.size ? bytes(0, file.size - 1) : "", { headers: { ...headers, "content-length": String(file.size) } });
}

/** The paths of a file action as the activity log keeps them: the full path of one, or the first names and a count */
function filesNamed(paths: unknown): string {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
  if (list.length === 1) return list[0]!.slice(0, 300);
  const names = list.slice(0, 3).map((p) => p.split("/").pop()).join(", ");
  return (list.length > 3 ? `${names} +${list.length - 3}` : names).slice(0, 300);
}

async function files(req: Request, url: URL, server: Server, by: string): Promise<Response | null> {
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
  if (path === "/api/files/file" && method === "POST") {
    const data = await body(req);
    return json({ path: makeFile(data.path, data.name) }, 201);
  }
  if (path === "/api/files/find" && method === "GET") return json(await findFiles(q.get("path") ?? "", q.get("q")));
  if (path === "/api/files/extract" && method === "POST") return json({ job: extractArchive((await body(req)).path, by).id }, 202);
  if (path === "/api/files/pin" && method === "POST") {
    const data = await body(req);
    pinFolder(data.path, data.pinned === true);
    return json({ pinned: pinnedFolders().map((folder) => folder.path) });
  }
  if (path === "/api/files/rename" && method === "POST") {
    const data = await body(req);
    const renamed = renameFile(data.path, data.name);
    record("files.rename", { user: by, detail: `${data.path} → ${renamed.split("/").pop()}` });
    return json({ path: renamed });
  }
  // what a plugged-in disk holds, copied onto the server as a job
  if (path === "/api/files/copy-in" && method === "POST") {
    const data = await body(req);
    return json({ job: copyIn(data.paths, data.to, by).id }, 202);
  }
  if ((path === "/api/files/move" || path === "/api/files/copy") && method === "POST") {
    const data = await body(req);
    // a large folder takes its time, and more so across disks
    server.timeout(req, 0);
    await transfer(data.paths, data.to, path.endsWith("copy"));
    record(path.endsWith("copy") ? "files.copy" : "files.move", { user: by, detail: `${filesNamed(data.paths)} → ${data.to}` });
    return json({ ok: true });
  }
  // between Hata and a machine, or two machines: a job
  if (path === "/api/files/transfer" && method === "POST") return json({ job: (await crossTransfer(await body(req), by)).id }, 202);
  if (path === "/api/files/delete" && method === "POST") {
    server.timeout(req, 0);
    const data = await body(req);
    await removeFiles(data.paths, data.forever === true, by);
    record(data.forever === true ? "files.deleteForever" : "files.delete", { user: by, detail: filesNamed(data.paths) });
    return json({ ok: true });
  }
  if (path === "/api/files/trash" && method === "GET") return json(trash());
  if (path === "/api/files/trash/restore" && method === "POST") {
    const restored = restoreFiles((await body(req)).ids);
    if (restored.length) record("files.restore", { user: by, detail: filesNamed(restored.map((r) => r.path)) });
    return json({ restored });
  }
  if (path === "/api/files/trash/delete" && method === "POST") {
    server.timeout(req, 0);
    const removed = await emptyTrash((await body(req)).ids);
    if (removed) record("files.purge", { user: by, detail: String(removed) });
    return json({ removed });
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

// --- Other machines ---------------------------------------------------------------------------------

async function clientRoutes(req: Request, url: URL, server: Server): Promise<Response> {
  if (url.pathname === "/client/link") {
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket" && server.upgrade(req, { data: linkData(clientIp(req, server)) })) return undefined as never;
    return fail(400, "request.notFound");
  }
  if (req.method !== "GET") return fail(405, "request.notFound");
  const bin = /^\/client\/bin\/(x64|arm64)$/.exec(url.pathname);
  if (bin) {
    server.timeout(req, 0);
    const { path } = await clientBinary(bin[1]!);
    return new Response(Bun.file(path), { headers: { ...SECURITY_HEADERS, "content-type": "application/octet-stream", "cache-control": "no-store" } });
  }
  const code = /^\/client\/([a-f0-9]{8}\.[A-Za-z0-9_-]{22,64})$/.exec(url.pathname);
  if (code) {
    // the address this machine reached Hata at is the one it will keep using
    server.timeout(req, 0);
    const origin = `${requestProto(req)}://${req.headers.get("host") ?? url.host}`;
    return new Response(await installScript(code[1]!, origin), { headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return fail(404, "request.notFound");
}

const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CONTAINER_ACTIONS = ["start", "stop", "restart"];

/**
 * The file manager's calls for a machine's files: the same shapes as `/api/files`, answered by the
 * machine's client. No trash there (a delete is for good), no pins, shares, search or unpacking.
 */
async function machineFiles(req: Request, url: URL, server: Server, id: string, sub: string, by: string): Promise<Response> {
  const method = req.method;
  const q = url.searchParams;
  const name = machineView(id).name;
  const ask = <T>(op: string, args: unknown) => machineCall<T>(id, op, args);
  const said = (code: string, detail: string) => record(code, { user: by, detail: `${name}:${detail}`.slice(0, 300) });
  server.timeout(req, 0);
  if (sub === "" && method === "GET") return json(await ask("fs.list", { path: q.get("path") ?? "" }));
  if (sub === "/raw" && method === "GET") {
    const path = q.get("path");
    const file = await ask<{ name: string; size: number; modified: number; inline: string }>("fs.info", { path });
    return sendBytes(req, file, q.get("download") === "1", (start, end) => {
      const channel = machineOpen(id, "fs.read", { path, start, end });
      req.signal.addEventListener("abort", () => channel.cancel(), { once: true });
      return channel.readable();
    });
  }
  if (sub === "/zip" && method === "GET") {
    const paths = q.getAll("path");
    const channel = machineOpen(id, "fs.zip", { paths });
    req.signal.addEventListener("abort", () => channel.cancel(), { once: true });
    const stem = paths.length === 1 ? paths[0]!.split("/").pop() : paths[0]?.split("/").slice(-2, -1)[0];
    return new Response(channel.readable(), { headers: { "x-content-type-options": "nosniff", "content-type": "application/zip", "content-disposition": disposition("attachment", `${stem || "files"}.zip`), "cache-control": "no-store" } });
  }
  if (sub === "/summary" && method === "POST") return json(await ask("fs.summary", { paths: (await body(req)).paths }));
  if (sub === "/text" && method === "GET") return json(await ask("fs.text", { path: q.get("path") }));
  if (sub === "/text" && method === "PUT") {
    const data = await body(req);
    return json(await ask("fs.textPut", { path: data.path, content: data.content, modified: data.modified }));
  }
  if ((sub === "/folder" || sub === "/file") && method === "POST") {
    const data = await body(req);
    return json(await ask(sub === "/folder" ? "fs.folder" : "fs.file", { path: data.path, name: data.name }), 201);
  }
  if (sub === "/rename" && method === "POST") {
    const data = await body(req);
    const renamed = await ask<{ path: string }>("fs.rename", { path: data.path, name: data.name });
    said("files.rename", `${data.path} → ${renamed.path.split("/").pop()}`);
    return json(renamed);
  }
  if ((sub === "/move" || sub === "/copy") && method === "POST") {
    const data = await body(req);
    await ask("fs.transfer", { paths: data.paths, to: data.to, copy: sub === "/copy" });
    said(sub === "/copy" ? "files.copy" : "files.move", `${filesNamed(data.paths)} → ${data.to}`);
    return json({ ok: true });
  }
  if (sub === "/delete" && method === "POST") {
    const data = await body(req);
    await ask("fs.delete", { paths: data.paths });
    said("files.deleteForever", filesNamed(data.paths));
    return json({ ok: true });
  }
  if (sub === "/upload" && method === "PUT") {
    const channel = machineOpen(id, "fs.upload", { dir: q.get("dir"), name: q.get("name"), sub: q.get("sub") ?? "", id: q.get("id") ?? "", offset: Number(q.get("offset") ?? 0), last: q.get("last") === "1", overwrite: q.get("overwrite") === "1" });
    try {
      if (req.body) for await (const chunk of req.body) await channel.send(chunk);
      channel.end();
    } catch {
      channel.cancel();
    }
    return json(await (channel.result as Promise<unknown>).catch((e) => {
      throw e instanceof MuxError ? new AppError(e.code, 400, e.detail) : e;
    }));
  }
  if (sub === "/upload" && method === "DELETE") {
    await ask("fs.uploadAbort", { dir: q.get("dir"), sub: q.get("sub") ?? "", id: q.get("id") ?? "" });
    return json({ ok: true });
  }
  return fail(404, "request.notFound");
}

async function machinesApi(req: Request, url: URL, server: Server, by: string): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;
  if (path === "/api/machines" && method === "GET") return json({ machines: machineList(), version: VERSION });
  if (path === "/api/machines/invite" && method === "POST") return json({ ...(await machineInvite(by)), valid: INVITE_MS, lan: baseUrl() });
  const m = /^\/api\/machines\/([a-f0-9]{8})(\/.*)?$/.exec(path);
  if (!m) return null;
  const id = m[1]!;
  const rest = m[2] ?? "";
  if (rest === "" && method === "GET") return json(machineView(id));
  if (rest === "" && method === "PATCH") return json(renameMachine(id, (await body(req)).name, by));
  if (rest === "" && method === "DELETE") {
    await removeMachine(id, by);
    return json({ ok: true });
  }
  if (rest === "/containers" && method === "GET") return json(await containersOf(id));
  const one = /^\/(containers|projects)\/([^/]+)$/.exec(rest);
  if (one && method === "POST") {
    const action = String((await body(req)).action);
    const target = decodeURIComponent(one[2]!);
    if (!CONTAINER_ACTIONS.includes(action) || !(one[1] === "containers" ? CONTAINER_ID_RE : PROJECT_RE).test(target)) return fail(400, "request.notFound");
    server.timeout(req, 0);
    await machineCall(id, one[1] === "containers" ? "container" : "project", one[1] === "containers" ? { id: target, action } : { project: target, action });
    const name = machineView(id).name;
    record(`machine.container.${action}`, { user: by, detail: `${name}: ${one[1] === "containers" ? String((await containersOf(id).catch(() => null))?.containers.find((c) => c.id === target)?.name ?? target.slice(0, 12)) : target}` });
    return json({ ok: true });
  }
  if (rest === "/logs" && method === "GET") {
    const container = url.searchParams.get("container") ?? "";
    if (!CONTAINER_ID_RE.test(container)) return fail(404, "machine.noContainer");
    machineView(id);
    server.timeout(req, 0);
    const channel = machineOpen(id, "logs", { id: container, tail: 200 });
    req.signal.addEventListener("abort", () => channel.cancel(), { once: true });
    return new Response(channel.readable(), { headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }
  if (rest.startsWith("/files")) return machineFiles(req, url, server, id, rest.slice(6), by);
  // apps of the machine
  if (rest === "/apps" && method === "GET") return json(await machineApps(id, language(url)));
  if (rest === "/apps" && method === "POST") {
    const data = await body(req);
    const job = typeof data.store === "string" ? await installOnMachine(id, data.store, String(data.name ?? ""), data.form, by) : await installComposeOnMachine(id, data.name, data.compose, by);
    return json({ job: job.id }, 202);
  }
  const app = /^\/apps\/([a-z0-9][a-z0-9_-]{0,63})(?:\/([a-z]+))?$/.exec(rest);
  if (app) {
    const [, name, part] = app as unknown as [string, string, string | undefined];
    if (!part && method === "DELETE") return json({ job: (await removeMachineApp(id, name, url.searchParams.get("data") === "1", by)).id }, 202);
    if (part === "compose" && method === "GET") return json(await machineCompose(id, name));
    if (part === "compose" && method === "PUT") return json({ job: (await applyMachineCompose(id, name, (await body(req)).compose, by)).id }, 202);
    if (part === "logs" && method === "GET") {
      server.timeout(req, 0);
      return new Response(machineAppLogs(id, name, req.signal), { headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
    }
    if (part && ["start", "stop", "restart", "update"].includes(part) && method === "POST") return json({ job: (await machineAppAction(id, name, part, by)).id }, 202);
  }
  if (rest === "/update" && method === "POST") {
    server.timeout(req, 0);
    await updateClient(id, by);
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
  // a name chosen for an app wins over a name another app merely has
  const app = apps.find((a) => a.subdomain === label) ?? apps.find((a) => !a.subdomain && appLabel(a.name) === label);
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
  return [domain, ...apps.filter((app) => app.port).map((app) => appHost(app))];
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
  if (url.pathname === "/mcp") return mcp(req, server);
  const signIn = await oauth(req, url);
  if (signIn) return signIn;
  // a network change on trial is kept by opening this at the server's new address, where no session reaches
  if (url.pathname === "/network/confirm" && req.method === "GET") {
    await confirmChange(url.searchParams.get("token") ?? "");
    return new Response(null, { status: 302, headers: { location: "/#/settings/network" } });
  }
  // the clients of other machines: their connection, their install script and binary — no session here
  if (url.pathname.startsWith("/client/")) {
    try {
      return await clientRoutes(req, url, server);
    } catch (e) {
      if (e instanceof AppError) return fail(e.status, e.code, e.detail);
      throw e;
    }
  }
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
  console.log(`Hata ${VERSION} is listening on ${hostname.includes(":") ? `[${hostname}]` : hostname}:${server.port}; state in ${DATA_DIR}`);
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
  startSampler(() => settings.dataRoot);
  startMachines();
  startDisks();
  startFills();
  startImages({
    apps: installedNames,
    update: async (app) => {
      await jobFinished(appAction(app, "update", "schedule"));
    },
  });
  startMounting();
  startNetwork();
  startSnapraid();
  startShares();
  startNetPlaces();
  startTrash();
  scheduleStoreSync();
  scheduleBackups();
  void resumeRestore();
  startGates();
  void refreshHttps();
  refreshLocalNames();
  startNotifications({
    attention: async () => attention({ system: systemStatus(), docker: await dockerInfo(), apps: await listApps("en"), activity: recent(100), update: availableUpdate(), offsite: offsiteFailure(), disks: diskHealth(), trash: trashSizeOn, absent: absent(), internet: internetTrouble(), exposed: exposedNics(), array: arrayTrouble(), shares: shareTrouble(), places: placesDown(), machines: machinesAway(), unused: unusedDisks(), filling: fillingUp() }),
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
