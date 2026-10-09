/**
 * The HTTP server: the web UI's files and the JSON API behind it.
 *
 * Access rules, in one place:
 * - the UI shell (HTML, CSS, JS, translations) is public — it holds no data;
 * - `/api/state`, `/api/setup` and `/api/login` are public by necessity;
 * - everything else under `/api/` needs a session cookie;
 * - a request that changes something must come from this origin (CSRF) and carry JSON.
 */
import { networkInterfaces } from "node:os";
import type { Server } from "bun";
import { recent, record } from "./activity";
import { AppError, appAction, appDetail, appLogs, appStats, applyCompose, composeText, getJob, installCustom, installFromStore, listApps, listJobs, removeApp, storeAppDetail } from "./apps";
import { attention } from "./attention";
import { APP_NAME_RE } from "./appform";
import {
  checkPassword,
  clearSessionCookie,
  completeSetup,
  createSession,
  destroySession,
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
import { DATA_DIR, listenAddress, settings, timezone, updateSettings } from "./config";
import { dockerInfo, watchEvents } from "./docker";
import { ARCH, catalogue, scheduleStoreSync, syncStore } from "./store";
import { startSampler, systemStatus } from "./system";
import { VERSION } from "./version";

import appCss from "./ui/app.css" with { type: "text" };
import appJs from "./ui/app.js" with { type: "text" };
import indexHtml from "./ui/index.html" with { type: "text" };
import logoSvg from "./ui/logo.svg" with { type: "text" };
import interCyrillic from "./ui/fonts/inter-cyrillic.woff2" with { type: "file" };
import interLatinExt from "./ui/fonts/inter-latin-ext.woff2" with { type: "file" };
import interLatin from "./ui/fonts/inter-latin.woff2" with { type: "file" };
import manropeCyrillic from "./ui/fonts/manrope-cyrillic.woff2" with { type: "file" };
import manropeLatinExt from "./ui/fonts/manrope-latin-ext.woff2" with { type: "file" };
import manropeLatin from "./ui/fonts/manrope-latin.woff2" with { type: "file" };
import en from "./lang/en.json";
import uk from "./lang/uk.json";

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

const STATIC: Record<string, { body: string; type: string }> = {
  "/": { body: indexHtml, type: "text/html; charset=utf-8" },
  "/app.css": { body: appCss, type: "text/css; charset=utf-8" },
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8" },
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
  "content-security-policy": "default-src 'self'; img-src 'self' https: data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
  const headers = { ...SECURITY_HEADERS, "content-type": file.type, "cache-control": "no-cache", etag };
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

const isHttps = (req: Request, url: URL): boolean => url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

function language(url: URL): string {
  const lang = url.searchParams.get("lang") ?? "";
  return /^[a-z]{2}$/.test(lang) ? lang : settings.language;
}

const publicSettings = () => ({ ...settings, systemTimezone: timezone(), languages: Object.keys(LANGUAGES) });

// --- Events -----------------------------------------------------------------------------------------

function events(req: Request, server: Server): Response {
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
      unsubscribe = bus.subscribe((event) => send(`data: ${JSON.stringify(event)}\n\n`));
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

// --- API --------------------------------------------------------------------------------------------

async function api(req: Request, url: URL, server: Server): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const write = method !== "GET" && method !== "HEAD";
  if (write && !sameOrigin(req, url)) return fail(403, "request.crossSite");
  const ip = server.requestIP(req)?.address ?? "unknown";

  if (path === "/api/state" && method === "GET") {
    const user = sessionUser(req);
    return json({
      version: VERSION,
      setup: needsSetup(),
      user: user ? publicUser(user) : null,
      language: settings.language,
      languages: Object.keys(LANGUAGES),
    });
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
    return json({ user: publicUser(result) }, 200, { "set-cookie": sessionCookie(createSession(result), isHttps(req, url)) });
  }

  if (path === "/api/login" && method === "POST") {
    const data = await body(req);
    const blocked = loginBlockedFor(ip);
    if (blocked > 0) return fail(429, "auth.locked", { seconds: Math.ceil(blocked / 1000) });
    const user = await checkPassword(data.name, data.password);
    if (!user) {
      registerLoginFailure(ip);
      return fail(401, "auth.wrong");
    }
    registerLoginSuccess(ip);
    record("auth.signin", { user: user.name, detail: ip });
    return json({ user: publicUser(user) }, 200, { "set-cookie": sessionCookie(createSession(user), isHttps(req, url)) });
  }

  // ---- everything below needs a session ----
  const user = sessionUser(req);
  if (!user) return fail(401, "auth.required");

  if (path === "/api/logout" && method === "POST") {
    destroySession(req);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (path === "/api/events" && method === "GET") return events(req, server);

  if (path === "/api/overview" && method === "GET") {
    const [docker, apps] = await Promise.all([dockerInfo(), listApps(language(url))]);
    const system = systemStatus();
    return json({
      system,
      docker,
      apps,
      arch: ARCH,
      attention: attention({ system, docker, apps, activity: recent(100) }),
      activity: recent(8),
      jobs: listJobs().filter((j) => j.status === "running").map(({ log: _, ...job }) => job),
    });
  }

  if (path === "/api/activity" && method === "GET") {
    const app = url.searchParams.get("app") ?? undefined;
    return json(recent(app ? 20 : 100, app));
  }

  if (path === "/api/settings") {
    if (method === "GET") return json(publicSettings());
    if (method === "PUT") {
      const error = updateSettings(await body(req));
      return error ? fail(400, error) : json(publicSettings());
    }
  }

  if (path === "/api/store" && method === "GET") return json(catalogue(language(url)));

  let m = /^\/api\/store\/([a-z0-9-]+)\/sync$/.exec(path);
  if (m && method === "POST") return json(await syncStore(m[1]!));

  m = /^\/api\/store\/([a-z0-9-]+)\/apps\/([a-z0-9_-]+)$/.exec(path);
  if (m && method === "GET") return json(await storeAppDetail(m[1]!, m[2]!, language(url)));

  if (path === "/api/apps") {
    if (method === "GET") return json(await listApps(language(url)));
    if (method === "POST") {
      const data = await body(req);
      const job =
        typeof data.store === "string"
          ? await installFromStore(data.store, String(data.name ?? ""), data.form, user.name)
          : await installCustom(data.name, data.compose, user.name);
      return json({ job: job.id, app: job.app }, 202);
    }
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
    if (!sub && method === "GET") return json(await appDetail(name, language(url)));
    if (!sub && method === "DELETE") return json({ job: removeApp(name, url.searchParams.get("data") === "1", user.name).id }, 202);
    if (sub === "stats" && method === "GET") return json(await appStats(name));
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

async function handle(req: Request, server: Server): Promise<Response> {
  const url = new URL(req.url);
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
    server = Bun.serve({ port, hostname, maxRequestBodySize: 2 * 1024 * 1024, fetch: handle });
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

  startSampler();
  scheduleStoreSync();
  void watchEvents();
}
