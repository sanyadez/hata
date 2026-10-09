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
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { appMeta, normalize, publishedPorts, type Compose } from "./appform";
import { AppError, appDir, dc, readCompose, startJob, type Job } from "./apps";
import { COOKIE_NAME, sessionUser, type User } from "./auth";
import { listenAddress, saveSettings, settings, type AppAccess } from "./config";
import { writeTextAtomic } from "./fsutil";

export const OVERRIDE_FILE = "compose.override.yml";
const overridePath = (name: string) => join(appDir(name), OVERRIDE_FILE);

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

// --- The port to guard ------------------------------------------------------------------------------

export interface GateTarget {
  service: string;
  /** The port inside the container */
  target: number;
  /** The port on the server that people open */
  port: number;
}

/** The web port of an app as a compose port entry, or why the app cannot be put behind sign-in */
export function gateTarget(compose: Compose, dataRoot: string): GateTarget | "noPort" | "hostNetwork" {
  const copy = structuredClone(compose);
  normalize(copy, dataRoot);
  const web = appMeta(copy, "en").port || String(publishedPorts(copy).find((p) => p.protocol === "tcp")?.port ?? "");
  if (!web) return "noPort";
  for (const [service, def] of Object.entries(copy.services) as [string, Compose][]) {
    for (const p of Array.isArray(def.ports) ? def.ports : []) {
      if (typeof p === "object" && p !== null && String(p.published) === web && (p.protocol ?? "tcp") === "tcp") {
        return { service, target: Number(p.target), port: Number(web) };
      }
    }
  }
  // the app says it has a web UI on this port but publishes nothing there: it shares the host's network
  return "hostNetwork";
}

/**
 * The override file: the service's whole port list again (compose replaces a list marked `!override`, it
 * does not merge into it), with the web port moved to 127.0.0.1:`upstream`.
 */
export function overrideText(compose: Compose, dataRoot: string, gate: GateTarget, upstream: number): string {
  const copy = structuredClone(compose);
  normalize(copy, dataRoot);
  const ports = (copy.services[gate.service].ports as unknown[]).map((p) => {
    if (typeof p === "object" && p !== null && String((p as Compose).published) === String(gate.port) && ((p as Compose).protocol ?? "tcp") === "tcp") {
      return { ...(p as Compose), published: String(upstream), host_ip: "127.0.0.1" };
    }
    return p;
  });
  return [
    `# Written by Hata: this app is behind Hata's sign-in. Hata listens on port ${gate.port} and passes`,
    `# signed-in users on to 127.0.0.1:${upstream}. Remove the protection in Hata, not by deleting this file.`,
    "services:",
    `  ${JSON.stringify(gate.service)}:`,
    "    ports: !override",
    // JSON is YAML: flow style keeps this free of quoting questions
    ...ports.map((p) => `      - ${JSON.stringify(p)}`),
    "",
  ].join("\n");
}

function freeLocalPort(preferred: number): number {
  for (let port = preferred; port < preferred + 2000; port++) {
    if (Object.values(settings.access).some((a) => a.upstream === port)) continue;
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

const listeners = new Map<string, Server>();

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

function startListener(name: string, port: number, upstream: number): void {
  listeners.get(name)?.stop(true);
  const server = Bun.serve<Tunnel, never>({
    port,
    hostname: "0.0.0.0",
    // uploads to a photo library or a cloud drive are large; the app sets its own limits
    maxRequestBodySize: MAX_APP_BODY,
    idleTimeout: 0,
    async fetch(req, self) {
      const url = new URL(req.url);
      const host = (req.headers.get("host") ?? url.host).replace(/:\d+$/, "");
      const hata = listenAddress().port;
      const signIn = `http://${host}${hata === 80 ? "" : ":" + hata}/?next=${encodeURIComponent(`http://${req.headers.get("host") ?? url.host}${url.pathname}${url.search}`)}`;
      return guard(req, name, signIn) ?? passToApp(req, self, upstream, "http", self.requestIP(req)?.address ?? "");
    },
    websocket: tunnelHandlers,
  });
  listeners.set(name, server);
}

function stopListener(name: string): void {
  listeners.get(name)?.stop(true);
  listeners.delete(name);
}

/** Starts the listeners of every protected app. An app whose port is taken is reported, not fatal. */
export function startGates(): void {
  for (const [name, access] of Object.entries(settings.access)) {
    if (!access.protect || !access.port || !access.upstream || !existsSync(overridePath(name))) continue;
    try {
      startListener(name, access.port, access.upstream);
    } catch (e) {
      console.error(`Cannot guard ${name} on port ${access.port}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

// --- Changing the access of an app ------------------------------------------------------------------

export interface AccessRequest {
  allowed: "all" | string[];
  protect: boolean;
}

/**
 * Sets who may open an app and whether it is behind sign-in. Switching the protection on or off restarts
 * the app on another port, so it runs as a job; a change of the list alone takes effect at once.
 */
export function setAccess(name: string, request: AccessRequest, user: string): Job | null {
  const compose = readCompose(name);
  if (!compose) throw new AppError("app.notFound", 404);
  const current = accessOf(name);
  const save = (access: AppAccess) => {
    settings.access[name] = access;
    saveSettings();
  };

  if (request.protect === current.protect) {
    save({ ...current, allowed: request.allowed });
    return null;
  }

  if (request.protect) {
    const gate = gateTarget(compose, settings.dataRoot);
    if (typeof gate === "string") throw new AppError("gate." + gate);
    const upstream = freeLocalPort(20000 + (gate.port % 10000));
    return startJob(name, "apply", user, async (log) => {
      writeTextAtomic(overridePath(name), overrideText(compose, settings.dataRoot, gate, upstream));
      try {
        await dc(name, ["config", "--quiet"], log);
        await dc(name, ["up", "-d", "--remove-orphans"], log);
        // the container has let go of the port: it is ours now
        startListener(name, gate.port, upstream);
      } catch (e) {
        rmSync(overridePath(name), { force: true });
        await dc(name, ["up", "-d", "--remove-orphans"], log).catch(() => {});
        throw e;
      }
      save({ allowed: request.allowed, protect: true, port: gate.port, upstream });
      log(`Port ${gate.port} now asks for a Hata sign-in; the app itself listens on 127.0.0.1:${upstream}`);
    });
  }

  return startJob(name, "apply", user, async (log) => {
    stopListener(name);
    rmSync(overridePath(name), { force: true });
    save({ allowed: request.allowed, protect: false });
    await dc(name, ["up", "-d", "--remove-orphans"], log);
  });
}

/** Forgets an app that was removed */
export function dropAccess(name: string): void {
  stopListener(name);
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
