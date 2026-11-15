/**
 * Walks the pages of a freshly set-up server in a headless browser: `bun run smoke`.
 *
 * The page's scripts are served as text and nothing parses or runs them before a browser does, so a slip
 * there shows only on screen. This starts Hata from source with a state folder of its own, creates the
 * administrator, signs in through the form and opens every page — wide, then at a phone's width. It fails
 * on an exception, an error in the console, a request the server answered with 5xx, a page left empty and,
 * on the phone, anything that scrolls sideways.
 *
 * The browser is Chrome or Chromium found on the machine (`HATA_CHROME` names one); nothing is installed.
 * `bun run smoke --shots <folder>` also keeps a picture of every page.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const shotsAt = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : "";
const NAME = "smoke";
const PASSWORD = "smoke-test-password";

// --- The browser ------------------------------------------------------------------------------------

async function findBrowser(): Promise<string | null> {
  if (process.env.HATA_CHROME) return process.env.HATA_CHROME;
  for (const name of ["chrome-headless-shell", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = Bun.which(name);
    if (found) return found;
  }
  const kept = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(kept)) return null;
  for (const pattern of ["chromium_headless_shell-*/*/chrome-headless-shell", "chromium-*/*/chrome"]) {
    const found = (await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: kept, absolute: true }))).sort().at(-1);
    if (found) return found;
  }
  return null;
}

const browser = await findBrowser();
if (!browser) {
  console.error("No Chrome or Chromium found. Install one, or name it in HATA_CHROME.");
  process.exit(2);
}

// --- The server -------------------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "hata-smoke-"));
const stateDir = join(work, "state");
mkdirSync(stateDir);
// a data folder of its own: the page of Files makes the data folder when it is missing, and that must not be /DATA
mkdirSync(join(work, "data"));
await Bun.write(join(stateDir, "settings.json"), JSON.stringify({ dataRoot: join(work, "data") }));

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

const port = freePort();
const base = `http://127.0.0.1:${port}`;
const serverLog: string[] = [];
const server = Bun.spawn([process.execPath, join(root, "src", "index.ts"), "serve"], {
  cwd: work,
  env: { ...process.env, HATA_DATA_DIR: stateDir, HATA_PORT: String(port), HATA_HOST: "127.0.0.1" },
  stdout: "pipe",
  stderr: "pipe",
});
const keep = async (stream: ReadableStream<Uint8Array>) => {
  for await (const chunk of stream.pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>)) serverLog.push(chunk);
};
void keep(server.stdout);
void keep(server.stderr);

let chrome: ReturnType<typeof Bun.spawn> | null = null;
function cleanUp(): void {
  chrome?.kill();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
function giveUp(why: string): never {
  console.error(why);
  const tail = serverLog.join("").trim().split("\n").slice(-30).join("\n");
  if (tail) console.error(`\nThe server said:\n${tail}`);
  cleanUp();
  process.exit(1);
}

async function until<T>(what: string, ask: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const got = await ask().catch(() => null);
    if (got) return got;
    await Bun.sleep(100);
  }
  return giveUp(`Waited ${ms / 1000} s for ${what}.`);
}

await until("the server to answer", async () => (await fetch(`${base}/api/state`)).ok);
const token = await until("the setup token", async () => readFileSync(join(stateDir, "setup-token"), "utf8").trim());
const made = await fetch(`${base}/api/setup`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ token, name: NAME, password: PASSWORD }) });
if (!made.ok) giveUp(`Could not create the administrator: ${made.status} ${await made.text()}`);

// --- The page, over the DevTools protocol -----------------------------------------------------------

const profile = join(work, "profile");
chrome = Bun.spawn([browser, "--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
const debugPort = await until("the browser to start", async () => readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
const target = await until("the browser's page", async () => {
  const list = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  return list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
});

type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message: string } };
const socket = new WebSocket(target);
await new Promise((open) => (socket.onopen = open));
let lastId = 0;
const waiting = new Map<number, (m: Message) => void>();
/** What went wrong since the last look */
let trouble: string[] = [];
const requests = new Map<string, string>();
/** Requests sent and not answered yet */
const underWay = new Set<string>();
const missing: { id: string; line: string }[] = [];
/** Requests the server answered with 5xx; what it said is asked for when the page has settled */
let failed: { id: string; line: string }[] = [];
socket.onmessage = (event) => {
  const m = JSON.parse(String(event.data)) as Message;
  if (typeof m.id === "number") {
    const answer = waiting.get(m.id);
    if (typeof answer === "function") answer(m);
    return;
  }
  const p = m.params;
  if (m.method === "Runtime.exceptionThrown") trouble.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
  if (m.method === "Runtime.consoleAPICalled" && p.type === "error") trouble.push(`console: ${p.args.map((a: any) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Network.requestWillBeSent") {
    requests.set(p.requestId, `${p.request.method} ${new URL(p.request.url).pathname}`);
    // the stream of events never ends: it is not something to wait for
    if (p.type !== "EventSource" && p.type !== "WebSocket") underWay.add(p.requestId);
  }
  if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") underWay.delete(p.requestId);
  // a page that asks a module that is off for something shows a part it should not have
  if (m.method === "Network.responseReceived" && p.response.status === 404 && new URL(p.response.url).pathname.startsWith("/api/")) missing.push({ id: p.requestId, line: `${requests.get(p.requestId) ?? p.response.url}` });
  if (m.method === "Network.responseReceived" && p.response.status >= 500) failed.push({ id: p.requestId, line: `${p.response.status}: ${requests.get(p.requestId) ?? p.response.url}` });
};
const send = (method: string, params: object = {}) =>
  new Promise<any>((done) => {
    const id = ++lastId;
    waiting.set(id, (m) => (waiting.delete(id), done(m.result ?? m)));
    socket.send(JSON.stringify({ id, method, params }));
  });
async function js<T = unknown>(expression: string): Promise<T> {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) trouble.push(`script: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value as T;
}
const width = (w: number, h: number, mobile: boolean) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await width(1440, 900, false);
await send("Page.navigate", { url: base });

// the sign-in form, as a person fills it
await until("the sign-in form", () => js<boolean>(`!!document.querySelector("form [name=password]")`));
await js(`document.querySelector("form [name=name]").focus()`);
await send("Input.insertText", { text: NAME });
await js(`document.querySelector("form [name=password]").focus()`);
await send("Input.insertText", { text: PASSWORD });
await js(`document.querySelector("form").requestSubmit()`);
await until("the page after signing in", () => js<boolean>(`!document.querySelector("form [name=password]") && !!document.querySelector("#view")`));

// --- The pages --------------------------------------------------------------------------------------

/** The sections of Settings, read from the page's own list so a new one is walked without a word here */
const appJs = readFileSync(join(root, "src", "ui", "app.js"), "utf8");
const sectionList = /const SECTIONS = \[([\s\S]*?)\n\];/.exec(appJs)?.[1] ?? "";
const sections = [...sectionList.matchAll(/\{ id: "([a-z]+)"/g)].map((m) => m[1]!);
if (sections.length < 10) giveUp("Could not read the sections of Settings from app.js.");

const ROUTES = [
  "#/welcome/server", "#/welcome/existing", "#/welcome/data", "#/welcome/backups", "#/welcome/apps",
  "#/", "#/store", "#/files", "#/files/", "#/hata", "#/trash", "#/activity", "#/import",
  "#/machines", "#/containers", "#/containers/settings", "#/integrations", "#/ha", "#/assistant",
  ...sections.map((id) => `#/settings/${id}`),
  "#/settings/storage/fs", "#/settings/storage/fills",
];

/** Whether the page shows something: the view of the usual frame, or the first run's own frame */
const DRAWN = `!!(document.querySelector("#view")?.childElementCount || (!document.querySelector("#view") && document.querySelector("#app")?.innerText.trim().length > 40))`;

/** Quiet for a moment: the view is drawn and no request is on its way */
async function settled(): Promise<void> {
  let calm = 0;
  for (let i = 0; i < 200 && calm < 4; i++) {
    await Bun.sleep(100);
    calm = underWay.size || !(await js<boolean>(DRAWN)) ? 0 : calm + 1;
  }
  if (calm < 4) trouble.push(`still loading after 20 s: ${[...underWay].map((id) => requests.get(id)).join(", ") || "nothing drawn"}`);
}

const SIDEWAYS = `(() => {
  const out = [];
  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth + 1) {
    out.push("the page is " + page.scrollWidth + " px wide");
    // what reaches past the edge, innermost first
    const past = [...document.querySelectorAll("#app *")].filter((el) => el.getBoundingClientRect().right > page.clientWidth + 1);
    for (const el of past.filter((el) => !past.some((other) => other !== el && el.contains(other))).slice(0, 3)) out.push("  past the edge: " + el.tagName.toLowerCase() + "." + [...el.classList].join(".") + " “" + el.textContent.trim().slice(0, 60) + "”");
  }
  for (const el of document.querySelectorAll("#view *")) {
    const style = getComputedStyle(el);
    if (["auto", "scroll"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(el.tagName.toLowerCase() + "." + [...el.classList].join(".") + " " + el.clientWidth + "/" + el.scrollWidth);
  }
  return out.slice(0, 8);
})()`;

const failures: string[] = [];
async function walk(label: string, phone: boolean): Promise<void> {
  for (const route of ROUTES) {
    trouble = [];
    failed = [];
    await send("Page.navigate", { url: `${base}/${route}` });
    await settled();
    const found = [...trouble];
    for (const { id, line } of failed) {
      const said = await send("Network.getResponseBody", { requestId: id });
      found.push(`${line} ${typeof said.body === "string" ? said.body.slice(0, 300) : ""}`.trim());
    }
    for (const { id, line } of missing.splice(0)) {
      const said = await send("Network.getResponseBody", { requestId: id }).catch(() => ({ body: "" }));
      if (typeof said.body === "string" && said.body.includes("modules.off")) found.push(`asked a module that is off: ${line}`);
    }
    if (!(await js<boolean>(DRAWN))) found.push("the page is empty");
    if (phone) for (const wide of await js<string[]>(SIDEWAYS)) found.push(`scrolls sideways: ${wide}`);
    if (shotsAt) {
      mkdirSync(shotsAt, { recursive: true });
      const picture = await send("Page.captureScreenshot", { format: "png" });
      await Bun.write(join(shotsAt, `${label}${route.replace(/[#/]+/g, "-")}.png`), Buffer.from(picture.data, "base64"));
    }
    console.log(`${found.length ? "✗" : "✓"} ${label} ${route}`);
    for (const line of new Set(found)) {
      console.log(`    ${line}`);
      failures.push(`${label} ${route}: ${line}`);
    }
  }
}

// a new server as a person gets it: the base alone, the pages of modules saying they are off
await walk("base ", false);
// then with every module on, so their pages are walked too
const MODULES_ON = `(async () => {
  const list = (await (await fetch("/api/modules")).json()).modules;
  for (const m of list) {
    const res = await fetch("/api/modules/" + m.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: true, withNeeds: true }) });
    const said = await res.text();
    if (!res.ok) return m.id + ": " + res.status + " " + said.slice(0, 200);
  }
  return "";
})()`;
const notOn = await js<string>(MODULES_ON);
if (notOn) giveUp(`Could not turn a module on: ${notOn}`);
await send("Page.reload");
await until("the page after a reload", () => js<boolean>(DRAWN));
// what the page before the reload was still waiting for is gone with it
underWay.clear();
await walk("wide ", false);
await width(390, 844, true);
await send("Page.reload");
await until("the page after a reload", () => js<boolean>(DRAWN));
await walk("phone", true);

cleanUp();
if (failures.length) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? "" : "s"} on ${ROUTES.length} pages.`);
  process.exit(1);
}
console.log(`\n${ROUTES.length} pages — the base alone, every module on, and at a phone's width: nothing wrong.`);
process.exit(0);
