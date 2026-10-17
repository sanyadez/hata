/**
 * Sign-in in front of an app.
 *
 * A protected app no longer publishes its web port to the network: a `compose.override.yml` next to its
 * compose file moves that port to 127.0.0.1 on another number, and Hata listens on the original port
 * instead. A request is let through to the app only if it carries a Hata session of a user who may open
 * the app; everyone else is sent to Hata's sign-in page. Browsers send Hata's cookie to any port of the
 * same host, so this needs no domains and no HTTPS, and the app's address does not change.
 *
 * The override file is plain compose, picked up by `docker compose` on its own: started by hand, the app
 * comes up the same way — reachable from the machine itself, not from the network.
 *
 * Only the web port is guarded unless more are named: the app's other published ports stay open, and a
 * port that does not speak HTTP (SSH, a database) cannot be guarded this way at all.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { appMeta, normalize, resolvePorts, type Compose } from "./appform";
import { AppError, appDir, appEnv, dc, onCompose, readCompose, startJob, viewOf, type Job } from "./apps";
import { COOKIE_NAME, sessionUser, type User } from "./auth";
import { anyAddress, listenAddress, saveSettings, settings, type AppAccess } from "./config";
import { plainIp } from "./site";
import { writeTextAtomic } from "./fsutil";

export const OVERRIDE_FILE = "compose.override.yml";
const overridePath = (name: string) => join(appDir(name), OVERRIDE_FILE);
const OVERRIDE_MARK = "# Written by Hata";

// --- Who may open what ------------------------------------------------------------------------------

const DEFAULT_ACCESS: AppAccess = { allowed: "all", protect: false };
export const accessOf = (name: string): AppAccess => settings.access[name] ?? DEFAULT_ACCESS;

/**
 * May this user see and open the app? Administrators always; members unless the app is limited to
 * chosen people; guests only where they are named.
 */
export function mayOpen(user: Pick<User, "id" | "role">, name: string): boolean {
  if (user.role === "admin") return true;
  const { allowed } = accessOf(name);
  return allowed === "all" ? user.role === "member" : allowed.includes(user.id);
}

// --- The ports to guard -----------------------------------------------------------------------------

export interface GateTarget {
  service: string;
  /** The port inside the container */
  target: number;
  /** The port on the server that people open */
  port: number;
}

/** A guarded port: Hata listens on `port`, the app on 127.0.0.1:`upstream` */
export interface Guard {
  port: number;
  upstream: number;
}

type Env = Record<string, string>;

/** The compose file as `docker compose` will read its ports: variables filled from `.env`, long syntax */
function resolved(compose: Compose, dataRoot: string, env: Env): Compose {
  const copy = structuredClone(compose);
  resolvePorts(copy, env);
  normalize(copy, dataRoot);
  return copy;
}

const isLocal = (ip: unknown): boolean => typeof ip === "string" && (ip.startsWith("127.") || ip === "::1");

/** Every TCP port the app publishes to the network, in the order of the file */
function networkPorts(copy: Compose): GateTarget[] {
  const out: GateTarget[] = [];
  for (const [service, def] of Object.entries(copy.services) as [string, Compose][]) {
    for (const p of Array.isArray(def.ports) ? def.ports : []) {
      if (typeof p !== "object" || p === null || (p.protocol ?? "tcp") !== "tcp" || isLocal(p.host_ip)) continue;
      const port = Number(p.published);
      if (/^\d+$/.test(String(p.published)) && /^\d+$/.test(String(p.target)) && port >= 1 && port <= 65535 && !out.some((o) => o.port === port)) out.push({ service, target: Number(p.target), port });
    }
  }
  return out;
}

/** The web port of an app as a compose port entry, or why the app cannot be put behind sign-in */
export function gateTarget(compose: Compose, dataRoot: string, env: Env = {}): GateTarget | "noPort" | "hostNetwork" {
  const copy = resolved(compose, dataRoot, env);
  const ports = networkPorts(copy);
  const named = Number(appMeta(copy, "en").port);
  // the app says it has a web UI on this port but publishes nothing: it shares the host's network
  if (named && !ports.length) return "hostNetwork";
  // a port changed by hand in the compose file leaves the metadata behind: then the first one published
  return ports.find((p) => p.port === named) ?? ports[0] ?? "noPort";
}

/**
 * The other TCP ports the app publishes. Sign-in in front of the web port leaves them open to the
 * network; each can be guarded too, but only when it speaks HTTP — Hata cannot tell, the person can.
 */
export function otherPorts(compose: Compose, dataRoot: string, env: Env = {}): GateTarget[] {
  const web = gateTarget(compose, dataRoot, env);
  return typeof web === "string" ? [] : networkPorts(resolved(compose, dataRoot, env)).filter((p) => p.port !== web.port);
}

/** The guarded ports of an app as its settings hold them: the web port first */
export function guardsOf(access: AppAccess): Guard[] {
  if (!access.protect || !access.port || !access.upstream) return [];
  return [{ port: access.port, upstream: access.upstream }, ...(access.extra ?? [])];
}

/**
 * The devices of each service that this server has, for the services that name one it has not: Docker
 * refuses to start a container whose device is missing (a TV tuner, a Raspberry Pi's video), and a
 * store writes them for the machines that have them. Pure: `has` says whether a path exists.
 */
export function presentDevices(compose: Compose, has: (path: string) => boolean): { devices: Record<string, unknown[]>; missing: string[] } {
  const devices: Record<string, unknown[]> = {};
  const missing: string[] = [];
  for (const [service, def] of Object.entries((compose.services ?? {}) as Record<string, Compose>)) {
    if (!Array.isArray(def.devices)) continue;
    const host = (d: unknown) => (typeof d === "string" ? d.split(":")[0]! : typeof d === "object" && d !== null ? String((d as Compose).source ?? "") : "");
    // a device given by a variable or a CDI name (vendor.com/gpu=all) is not a path to look for
    const gone = def.devices.filter((d: unknown) => host(d).startsWith("/") && !has(host(d)));
    if (!gone.length) continue;
    devices[service] = def.devices.filter((d: unknown) => !gone.includes(d));
    for (const d of gone) if (!missing.includes(host(d))) missing.push(host(d));
  }
  return { devices, missing };
}

/**
 * The override file: the whole port list of every service with a guarded port again (compose replaces
 * a list marked `!override`, it does not merge into it), the guarded ports moved to 127.0.0.1; and the
 * device lists without the devices this server has not.
 */
export function overrideText(compose: Compose, dataRoot: string, guards: Guard[], env: Env = {}, through?: { host: string; port: number }, devices?: { devices: Record<string, unknown[]>; missing: string[] }): string {
  const copy = resolved(compose, dataRoot, env);
  const upstreamOf = (p: unknown): number | undefined => {
    if (typeof p !== "object" || p === null || ((p as Compose).protocol ?? "tcp") !== "tcp" || isLocal((p as Compose).host_ip)) return undefined;
    return guards.find((g) => String(g.port) === String((p as Compose).published))?.upstream;
  };
  const lines: string[] = [];
  for (const [service, def] of Object.entries(copy.services) as [string, Compose][]) {
    const ports: unknown[] = Array.isArray(def.ports) ? def.ports : [];
    const guarded = ports.some((p) => upstreamOf(p) !== undefined);
    const kept = devices?.devices[service];
    if (!guarded && !kept) continue;
    lines.push(`  ${JSON.stringify(service)}:`);
    if (guarded) {
      lines.push("    ports: !override");
      for (const p of ports) {
        const upstream = upstreamOf(p);
        // JSON is YAML: flow style keeps this free of quoting questions
        lines.push(`      - ${JSON.stringify(upstream === undefined ? p : { ...(p as Compose), published: String(upstream), host_ip: "127.0.0.1" })}`);
      }
    }
    if (kept) lines.push(`    devices: !override ${JSON.stringify(kept)}`);
  }
  const list = guards.map((g) => g.port).join(", ");
  const left = devices?.missing.length ? [`# Devices this server does not have are left out: ${devices.missing.join(", ")}.`] : [];
  // an app of another machine is opened through the Hata that looks after it
  const head = !guards.length
    ? [`${OVERRIDE_MARK}: what this server cannot give the app.`]
    : through
    ? [`${OVERRIDE_MARK}: this app is behind the sign-in of Hata at ${through.host}, opened there on port ${through.port};`, `# here it listens on 127.0.0.1 (${guards.map((g) => g.upstream).join(", ")}) only. Remove the protection in Hata, not by deleting this file.`]
    : [`${OVERRIDE_MARK}: this app is behind Hata's sign-in. Hata listens on ${guards.length > 1 ? "ports" : "port"} ${list} and passes`, `# signed-in users on to 127.0.0.1 (${guards.map((g) => g.upstream).join(", ")}). Remove the protection in Hata, not by deleting this file.`];
  return [
    ...head,
    ...left,
    "services:",
    ...lines,
    "",
  ].join("\n");
}

/** Writes the override when it says something new; a file of that name written by the person is theirs */
function writeOverride(name: string, text: string): void {
  const path = overridePath(name);
  if (existsSync(path) && !readFileSync(path, "utf8").startsWith(OVERRIDE_MARK)) return;
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeTextAtomic(path, text);
}

/** Removes the override — ours only: a file of that name written by the person is theirs */
function removeOverride(name: string): void {
  const path = overridePath(name);
  if (existsSync(path) && readFileSync(path, "utf8").startsWith(OVERRIDE_MARK)) rmSync(path, { force: true });
}

function freeLocalPort(preferred: number, taken: number[] = []): number {
  for (let port = preferred; port < preferred + 2000; port++) {
    if (taken.includes(port) || Object.values(settings.access).some((a) => guardsOf(a).some((g) => g.upstream === port))) continue;
    try {
      Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }).stop(true);
      return port;
    } catch {}
  }
  throw new AppError("gate.noFreePort");
}

// --- The listeners ----------------------------------------------------------------------------------

/** The largest request body passed on to an app */
export const MAX_APP_BODY = 64 * 1024 ** 3;

export interface Tunnel {
  /** The upstream WebSocket and what arrived for it before it opened */
  upstream: WebSocket;
  queue: (string | Uint8Array)[];
}

/** Per app: the port Hata listens on → the listener */
const listeners = new Map<string, Map<number, Server>>();

const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length"];

/** The request headers for the app: without our own cookie, with the usual proxy headers */
function forwardHeaders(req: Request, ip: string, proto: string): Headers {
  const headers = new Headers(req.headers);
  const cookies = (headers.get("cookie") ?? "").split(/;\s*/).filter((c) => c && !c.startsWith(COOKIE_NAME + "="));
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  else headers.delete("cookie");
  headers.set("x-forwarded-for", [req.headers.get("x-forwarded-for"), ip].filter(Boolean).join(", "));
  headers.set("x-forwarded-host", req.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", proto);
  return headers;
}

export function page(status: number, title: string, text: string): Response {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><body style="font:16px system-ui;background:#131110;color:#f3eee8;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:26rem;padding:2rem;text-align:center"><h1 style="font-size:1.3rem">${escape(title)}</h1><p style="color:#a8a099">${escape(text)}</p></main>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** WebSocket plumbing shared by every server that passes connections on to an app */
export const tunnelHandlers = {
  open(ws: ServerWebSocket<Tunnel>) {
    const { upstream: target, queue } = ws.data;
    target.onopen = () => {
      for (const message of queue.splice(0)) target.send(message);
    };
    target.onmessage = (event) => {
      ws.send(typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer));
    };
    target.onclose = (event) => ws.close(event.code === 1005 || event.code === 1006 ? 1011 : event.code, event.reason);
    target.onerror = () => ws.close(1011);
  },
  message(ws: ServerWebSocket<Tunnel>, message: string | Buffer) {
    const { upstream: target, queue } = ws.data;
    const data = typeof message === "string" ? message : new Uint8Array(message);
    if (target.readyState === WebSocket.OPEN) target.send(data);
    else queue.push(data);
  },
  close(ws: ServerWebSocket<Tunnel>, code: number, reason: string) {
    const target = ws.data.upstream;
    if (target.readyState === WebSocket.OPEN || target.readyState === WebSocket.CONNECTING) target.close(code === 1005 || code === 1006 ? 1000 : code, reason);
  },
};

/**
 * Decides whether a request may reach an app that asks for sign-in. Returns null to let it through, or
 * the answer to give instead: a redirect to `signIn` for a page, a refusal for anything else.
 */
export function guard(req: Request, name: string, signIn: string): Response | null {
  const user = sessionUser(req);
  if (!user) {
    // a page can be sent to sign in; a script's request can only be told why it failed
    return req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html") ? Response.redirect(signIn, 302) : new Response("Sign in to Hata first", { status: 401 });
  }
  return mayOpen(user, name) ? null : page(403, "No access", `${user.name} may not open this app. Ask an administrator of this server.`);
}

/** Passes a request (or a WebSocket upgrade) on to an app listening on a local port */
export async function passToApp(req: Request, server: Server, upstream: number, proto: "http" | "https", ip: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = forwardHeaders(req, ip, proto);
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const protocols = req.headers.get("sec-websocket-protocol")?.split(",").map((p) => p.trim()).filter(Boolean);
    for (const h of ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]) headers.delete(h);
    const target = new WebSocket(`ws://127.0.0.1:${upstream}${url.pathname}${url.search}`, { headers: Object.fromEntries(headers), protocols } as never);
    target.binaryType = "arraybuffer";
    if (server.upgrade(req, { data: { upstream: target, queue: [] } })) return undefined as never;
    target.close();
    return new Response("WebSocket upgrade failed", { status: 400 });
  }
  // a download or an event stream may be silent for a long time
  server.timeout(req, 0);
  try {
    const res = await fetch(`http://127.0.0.1:${upstream}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
      // pass the body through exactly as the app sent it, compressed or not
      decompress: false,
      signal: req.signal,
    } as RequestInit);
    const out = new Headers(res.headers);
    for (const h of HOP_HEADERS) if (h !== "content-length") out.delete(h);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return page(502, "The app is not answering", e instanceof Error ? e.message : String(e));
  }
}

const listening = (name: string): Map<number, Server> => listeners.get(name) ?? listeners.set(name, new Map()).get(name)!;

function startListener(name: string, { port, upstream }: Guard): void {
  listening(name).get(port)?.stop(true);
  listening(name).set(port, guardedServer(name, port, upstream));
}

/**
 * A listener on `port` of this server that lets signed-in people who may open `name` through to
 * 127.0.0.1:`upstream` — the app itself, or (for an app of another machine) the end of a tunnel to it.
 */
export function guardedServer(name: string, port: number, upstream: number): Server {
  return Bun.serve<Tunnel, never>({
    port,
    hostname: anyAddress(),
    // uploads to a photo library or a cloud drive are large; the app sets its own limits
    maxRequestBodySize: MAX_APP_BODY,
    idleTimeout: 0,
    async fetch(req, self) {
      const url = new URL(req.url);
      const host = (req.headers.get("host") ?? url.host).replace(/:\d+$/, "");
      const hata = listenAddress().port;
      const signIn = `http://${host}${hata === 80 ? "" : ":" + hata}/?next=${encodeURIComponent(`http://${req.headers.get("host") ?? url.host}${url.pathname}${url.search}`)}`;
      return guard(req, name, signIn) ?? passToApp(req, self, upstream, "http", plainIp(self.requestIP(req)?.address ?? ""));
    },
    websocket: tunnelHandlers,
  });
}

/** Stops the listeners of an app — all of them, or those on ports that are not in `keep` */
function stopListeners(name: string, keep: Guard[] = []): void {
  for (const [port, server] of listeners.get(name) ?? []) {
    if (keep.some((g) => g.port === port)) continue;
    server.stop(true);
    listeners.get(name)!.delete(port);
  }
}

/** Starts the listeners an app is missing. A port that is taken is reported, not fatal. */
function startListeners(name: string): void {
  const access = accessOf(name);
  if (!existsSync(overridePath(name))) return;
  for (const g of guardsOf(access)) {
    if (listeners.get(name)?.has(g.port)) continue;
    try {
      startListener(name, g);
    } catch (e) {
      console.error(`Cannot guard ${name} on port ${g.port}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/** Starts the listeners of every protected app */
export function startGates(): void {
  for (const name of Object.keys(settings.access)) startListeners(name);
}

// --- Keeping the override in step with the compose file -------------------------------------------

function save(name: string, access: AppAccess): void {
  settings.access[name] = access;
  saveSettings();
}

/**
 * Before `docker compose` reads an app's files: the override is written again from the compose file as it
 * is now. The file may have been edited since the protection was switched on — a port renumbered, added
 * or removed — and an override left as it was would silently undo that. A guarded port that is gone is
 * no longer guarded; when the web port itself is gone, so is the protection.
 */
function syncOverride(name: string): void {
  const access = accessOf(name);
  const view = viewOf(name);
  const compose = access.protect ? view : null;
  const env = appEnv(name);
  // a device this server has not would keep the app from starting at all
  const devices = view ? presentDevices(view, existsSync) : { devices: {}, missing: [] };
  const fixDevices = devices.missing.length > 0;
  const web = compose ? gateTarget(compose, settings.dataRoot, env) : "noPort";
  if (!compose || typeof web === "string" || !access.upstream) {
    if (fixDevices && view) writeOverride(name, overrideText(view, settings.dataRoot, [], env, undefined, devices));
    else removeOverride(name);
    stopListeners(name);
    if (access.protect) save(name, { allowed: access.allowed, protect: false });
    return;
  }
  const others = otherPorts(compose, settings.dataRoot, env);
  const extra = (access.extra ?? []).filter((g) => others.some((o) => o.port === g.port));
  const next: AppAccess = { allowed: access.allowed, protect: true, port: web.port, upstream: access.upstream, ...(extra.length ? { extra } : {}) };
  if (JSON.stringify(next) !== JSON.stringify(access)) save(name, next);
  writeOverride(name, overrideText(compose, settings.dataRoot, guardsOf(next), env, undefined, fixDevices ? devices : undefined));
  // a port that is not guarded any more goes back to the app: let go of it before the app asks for it
  stopListeners(name, guardsOf(next));
}

onCompose(syncOverride, startListeners);

// --- Changing the access of an app ------------------------------------------------------------------

export interface AccessRequest {
  allowed: "all" | string[];
  protect: boolean;
  /** Other ports of the app to guard as well; left out — as they are */
  ports?: number[];
}

/**
 * Sets who may open an app and whether it is behind sign-in. A change of what is guarded restarts the
 * app on other ports, so it runs as a job; a change of the list of people alone takes effect at once.
 */
export function setAccess(name: string, request: AccessRequest, user: string): Job | null {
  const compose = viewOf(name);
  if (!compose) throw new AppError("app.notFound", 404);
  const current = accessOf(name);
  const env = appEnv(name);

  let next: AppAccess = { allowed: request.allowed, protect: false };
  if (request.protect) {
    const gate = gateTarget(compose, settings.dataRoot, env);
    if (typeof gate === "string") throw new AppError("gate." + gate);
    const others = otherPorts(compose, settings.dataRoot, env).map((p) => p.port);
    const wanted = (request.ports ?? (current.extra ?? []).map((g) => g.port)).filter((port) => others.includes(port));
    const before = guardsOf(current);
    const taken: number[] = [];
    const guardFor = (port: number): Guard => {
      const upstream = before.find((g) => g.port === port)?.upstream ?? freeLocalPort(20000 + (port % 10000), taken);
      taken.push(upstream);
      return { port, upstream };
    };
    const web = guardFor(gate.port);
    const extra = [...new Set(wanted)].sort((a, b) => a - b).map(guardFor);
    next = { allowed: request.allowed, protect: true, port: web.port, upstream: web.upstream, ...(extra.length ? { extra } : {}) };
  }

  if (JSON.stringify(guardsOf(next)) === JSON.stringify(guardsOf(current))) {
    save(name, { ...current, allowed: request.allowed });
    return null;
  }

  return startJob(name, "apply", user, async (log) => {
    // `dc` brings the override and the listeners in line with what is saved
    save(name, next);
    try {
      await dc(name, ["config", "--quiet"], log);
      await dc(name, ["up", "-d", "--remove-orphans"], log);
    } catch (e) {
      save(name, { ...current, allowed: request.allowed });
      await dc(name, ["up", "-d", "--remove-orphans"], log).catch(() => {});
      throw e;
    }
    for (const g of guardsOf(next)) log(`Port ${g.port} now asks for a Hata sign-in; the app itself listens on 127.0.0.1:${g.upstream}`);
  });
}

/** Forgets an app that was removed */
export function dropAccess(name: string): void {
  stopListeners(name);
  listeners.delete(name);
  if (name in settings.access) {
    delete settings.access[name];
    saveSettings();
  }
}

/** A removed user is taken off every list */
export function dropUser(id: string): void {
  let changed = false;
  for (const access of Object.values(settings.access)) {
    if (Array.isArray(access.allowed) && access.allowed.includes(id)) {
      access.allowed = access.allowed.filter((u) => u !== id);
      changed = true;
    }
  }
  if (changed) saveSettings();
}
