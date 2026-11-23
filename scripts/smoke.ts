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
 * Words written straight on the background fail it too: everything stands on a card.
 * `bun run smoke --shots <folder>` also keeps a picture of every page.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  env: { ...process.env, HATA_DATA_DIR: stateDir, HATA_PORT: String(port), HATA_HOST: "127.0.0.1", HATA_NO_LOOK: "1" },
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
/** Requests a member's page made that the server refused them: the page asked for what is not theirs */
let forbidden: string[] = [];
let watchForbidden = false;
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
  if (watchForbidden && m.method === "Network.responseReceived" && p.response.status === 403 && new URL(p.response.url).pathname.startsWith("/api/")) forbidden.push(requests.get(p.requestId) ?? p.response.url);
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

/** The tabs of every section of the page, read from the page's own list so a new one is walked without a word here */
const appDir = join(root, "src", "ui", "app");
const appJs = readdirSync(appDir).filter((name) => name.endsWith(".js")).sort().map((name) => readFileSync(join(appDir, name), "utf8")).join("\n");
const areaList = /const AREAS = \{([\s\S]*?)\n\};/.exec(appJs)?.[1] ?? "";
const bases = Object.fromEntries([.../(\w+): "(#[^"]+)"/g[Symbol.matchAll](/const AREA_BASE = \{([^}]*)\}/.exec(appJs)?.[1] ?? "")].map((m) => [m[1]!, m[2]!]));
const tabs: string[] = [];
let area = "";
for (const line of areaList.split("\n")) {
  const opened = /^  (\w+): \[/.exec(line);
  if (opened) area = opened[1]!;
  for (const m of line.matchAll(/\{ id: "([a-z]+)"(?:, hash: "([^"]+)")?/g)) tabs.push(m[2] ?? `${bases[area]}/${m[1]}`);
}
if (tabs.length < 20 || tabs.some((x) => x.startsWith("undefined"))) giveUp("Could not read the sections of the page from src/ui/app/.");

const ROUTES = [
  "#/welcome/server", "#/welcome/existing", "#/welcome/data", "#/welcome/backups", "#/welcome/modules", "#/welcome/apps",
  "#/", "#/files", "#/files/", "#/hata", "#/trash", "#/links", "#/activity", "#/blocks",
  "#/machines", "#/machines/load", "#/containers", "#/containers/settings", "#/machines/this/apps", "#/house", "#/integrations", "#/assistant", "#/tv", "#/terminal",
  ...new Set(tabs),
  "#/settings/users/access", "#/settings/users/invites", "#/settings/users/signins",
  // addresses from before the sections moved out of Settings
  "#/settings/docker", "#/settings/storage/fs", "#/settings/ports",
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

/** Words of the page that lie straight on the background: everything is written on a card */
const BARE = `(() => {
  const view = document.querySelector("#view");
  if (!view) return [];
  // as with a picture behind the page: what the page backs for that case counts as covered
  document.documentElement.classList.add("has-wallpaper");
  const out = new Set();
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text.length < 2 || !node.parentElement.getClientRects().length) continue;
    let covered = false;
    let shown = true;
    for (let el = node.parentElement; el && el !== view; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") shown = false;
      if (!/^(rgba\\(0, 0, 0, 0\\)|transparent)$/.test(style.backgroundColor)) covered = true;
    }
    if (shown && !covered) out.add(text.slice(0, 60));
  }
  return [...out].slice(0, 5);
})()`;

/**
 * Gaps between the blocks of a card that are not one of the steps of "The building blocks" (app.css): 0, 6, 8 or
 * 16 px. A block pinned to the card's foot is left out: its gap is whatever room is left.
 */
const STEPS = `(() => {
  const view = document.querySelector("#view");
  if (!view) return [];
  const seen = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0 && !e.classList.contains("offscreen"); };
  const name = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => "." + c).join("");
  const out = [];
  for (const card of view.querySelectorAll(".card.pad, .card.module-card")) {
    if (card.closest("dialog") || !seen(card)) continue;
    const kids = [...card.children].filter(seen);
    for (let i = 1; i < kids.length; i++) {
      if (kids[i].matches(".block-foot, .module-card-foot")) continue;
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      if (b.top < a.bottom - 1) continue; // side by side
      const gap = Math.round(b.top - a.bottom);
      if (![0, 6, 8, 16].some((step) => Math.abs(step - gap) <= 1)) out.push(gap + " px between " + name(kids[i - 1]) + " and " + name(kids[i]) + " in " + name(card));
    }
  }
  return out.slice(0, 5);
})()`;

/**
 * A string of the page shown as its key ("area.settings.schedule"): the words of the view and of an open
 * window that look like a key whose first part is one the language files have. Names of files and hosts
 * ("app.js", "hata.local") end in what keys never do.
 */
const PREFIXES = [...new Set(Object.keys(JSON.parse(readFileSync(join(root, "src", "lang", "en.json"), "utf8"))).map((k) => k.split(".")[0]))];
const KEYS = `(() => {
  const prefixes = new Set(${JSON.stringify(PREFIXES)});
  const out = new Set();
  for (const scope of [document.querySelector("#view"), ...document.querySelectorAll("dialog[open]")]) {
    if (!scope) continue;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (!/^[a-z][A-Za-z0-9]*(\\.[A-Za-z0-9-]+)+$/.test(text) || !prefixes.has(text.split(".")[0])) continue;
      if (/\\.(js|json|css|ya?ml|local|lan|home|io|com|org|net|ua|txt|conf|sh|png|jpe?g|svg|log|md)$/i.test(text)) continue;
      out.add(text);
    }
  }
  return [...out].slice(0, 5);
})()`;


const failures: string[] = [];
async function walk(label: string, phone: boolean): Promise<void> {
  for (const route of ROUTES) {
    trouble = [];
    failed = [];
    forbidden = [];
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
    for (const gap of await js<string[]>(STEPS)) found.push(`off the steps: ${gap}`);
    if (!route.startsWith("#/welcome")) for (const words of await js<string[]>(BARE)) found.push(`written outside a card: “${words}”`);
    for (const key of await js<string[]>(KEYS)) found.push(`a string shown as its key: ${key}`);
    for (const line of new Set(forbidden)) found.push(`asked for what is not theirs (403): ${line}`);
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

/**
 * Windows opened as a person would open them, on the page they belong to: each only shows — nothing is
 * pressed in it. The page's functions are globals (its script is plain scripts sharing one scope), so the
 * window is opened by its own function, not by hunting for a button.
 */
const DIALOGS: [string, string][] = [
  ["#/", "addDialog()"],
  ["#/", "layoutTextDialog()"],
  ["#/", "linkDialog()"],
  ["#/files", "shareLinkDialog(state.files.path, 'data', true)"],
  ["#/files", "shareLinkDialog(state.files.path, 'data', true, 'drop')"],
  ["#/files", "sizeDialog(state.files.path, 'data')"],
  ["#/apps", "customDialog()"],
  ["#/machines", "addMachineDialog()"],
  ["#/machines/load", "loadWarnDialog()"],
  ["#/machines", "pveDialog()"],
  ["#/house", "haDialog()"],
  ["#/house/tv", "playLinkDialog()"],
  ["#/settings/users", "userDialog()"],
  ["#/settings/users", "inviteDialog()"],
  ["#/settings/assistant", "agentDialog()"],
  ["#/settings/general", "renameServerDialog(() => {})"],
  ["#/settings/general", "serverPowerDialog('reboot')"],
  ["#/storage", "mergeDialog()"],
  ["#/storage", "poolDialog()"],
  ["#/storage/places", "placeDialog()"],
  ["#/network/addresses", "domainNameDialog(null, null, () => {})"],
  ["#/network/addresses", "forwardDialog(null, null, () => {})"],
  ["#/network/remote", "wgAddDialog()"],
  ["#/machines/this/system", "moveDataDialog()"],
];

/** A window wider than the page, or one that scrolls sideways inside */
const DIALOG_WIDE = `(() => {
  const out = [];
  for (const d of document.querySelectorAll("dialog[open]")) {
    if (d.getBoundingClientRect().right > document.documentElement.clientWidth + 1) out.push("the window reaches past the page");
    for (const el of [d, ...d.querySelectorAll("*")]) {
      const style = getComputedStyle(el);
      if (["auto", "scroll"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(el.tagName.toLowerCase() + "." + [...el.classList].join(".") + " " + el.clientWidth + "/" + el.scrollWidth);
    }
  }
  return out.slice(0, 5);
})()`;

async function dialogs(label: string, phone: boolean): Promise<void> {
  for (const [route, opener] of DIALOGS) {
    trouble = [];
    failed = [];
    await send("Page.navigate", { url: `${base}/${route}` });
    await settled();
    // a page drawn after its data came may still be on its way: the window needs what it reads
    await Bun.sleep(300);
    await js(`(async () => { await (${opener}); })()`);
    await settled();
    const found = [...trouble];
    for (const { id, line } of failed) {
      const said = await send("Network.getResponseBody", { requestId: id });
      found.push(`${line} ${typeof said.body === "string" ? said.body.slice(0, 300) : ""}`.trim());
    }
    if (!(await js<boolean>(`!!document.querySelector("dialog[open]")`))) found.push("no window opened");
    for (const key of await js<string[]>(KEYS)) found.push(`a string shown as its key: ${key}`);
    if (phone) for (const wide of await js<string[]>(DIALOG_WIDE)) found.push(`too wide: ${wide}`);
    if (shotsAt) {
      const picture = await send("Page.captureScreenshot", { format: "png" });
      await Bun.write(join(shotsAt, `${label}-dialog-${opener.replace(/\W+/g, "-").slice(0, 40)}.png`), Buffer.from(picture.data, "base64"));
    }
    await js(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
    console.log(`${found.length ? "✗" : "✓"} ${label} ${route} ${opener}`);
    for (const line of new Set(found)) {
      console.log(`    ${line}`);
      failures.push(`${label} ${route} ${opener}: ${line}`);
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
await dialogs("wide ", false);
await width(390, 844, true);
await send("Page.reload");
await until("the page after a reload", () => js<boolean>(DRAWN));
await walk("phone", true);
await dialogs("phone", true);

// in Ukrainian: every string there, none shown as its key, nothing longer than the page
await width(1440, 900, false);
await js(`localStorage.setItem("hata.lang", "uk")`);
await send("Page.reload");
await until("the page after a reload", () => js<boolean>(DRAWN));
underWay.clear();
await walk("uk   ", false);
await width(390, 844, true);
await send("Page.reload");
await until("the page after a reload", () => js<boolean>(DRAWN));
underWay.clear();
await walk("ukph ", true);
await dialogs("ukph ", true);
await js(`localStorage.removeItem("hata.lang")`);

// a member: the pages of the administrators send them away or say so, and nothing asks for what is not theirs
await width(1440, 900, false);
const MEMBER = { name: "smoke-member", password: "smoke member 1" };
const madeMember = await js<string>(`fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(${JSON.stringify({ ...MEMBER, role: "member" })}) }).then((r) => r.ok ? "" : r.status + " " + r.statusText)`);
if (madeMember) giveUp(`Could not make a member: ${madeMember}`);
await js(`fetch("/api/logout", { method: "POST" })`);
await send("Page.navigate", { url: base });
await until("the sign-in form", () => js<boolean>(`!!document.querySelector("form [name=password]")`));
await js(`document.querySelector("form [name=name]").focus()`);
await send("Input.insertText", { text: MEMBER.name });
await js(`document.querySelector("form [name=password]").focus()`);
await send("Input.insertText", { text: MEMBER.password });
await js(`document.querySelector("form").requestSubmit()`);
await until("the page after a member signed in", () => js<boolean>(`!document.querySelector("form [name=password]") && !!document.querySelector("#view")`));
underWay.clear();
watchForbidden = true;
await walk("member", false);
watchForbidden = false;

cleanUp();
if (failures.length) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? "" : "s"} on ${ROUTES.length} pages.`);
  process.exit(1);
}
console.log(`\n${ROUTES.length} pages — the base alone, every module on, a phone's width, in Ukrainian, and as a member, with ${DIALOGS.length} windows opened: nothing wrong.`);
process.exit(0);
