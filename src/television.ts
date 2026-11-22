/**
 * The screen plugged into this server, and who has it: the player (`kodi.ts`) or a browser showing one
 * web page — never both, the screen is one. The browser is `cage` (a compositor that shows a single
 * program) with Chromium in it, a service of the player's own user on the same console; Hata drives it
 * over its local debugging port. A page may be shown for a while, and then what was on the screen
 * before comes back: the film goes on from where it stopped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { record } from "./activity";
import en from "./lang/en.json";
import uk from "./lang/uk.json";
import { AppError, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { saveSettings, settings } from "./config";
import { awaitKodi, kodiRuns, screenDark, sleepScreen, playOnTv, screenShares, setUp, switchTv, tvEnabled, tvNow, tvReport, type TvPage, type TvReport } from "./kodi";
import { installCommand, packageManager, PATH, run, runLogged } from "./packages";
import { parkPointer } from "./pointer";
import { BROWSER_HOME_SCRIPT, BROWSER_POINTER_SCRIPT, BROWSER_SWIPE_SCRIPT, browserPanelScript, PANEL_BUTTONS, BROWSER_PACKAGES, browserCalls, cleanBookmarks, MEDIA_ACTIONS, mediaScript, pointerCalls, PREVIEW_WIDTH, browserHomeHtml, TV_BROWSER_HOME, TV_USER, browserSound, browserUnitText, withoutTranslate, TV_HOME, cleanLink, cleanShowTime, linkName, TV_BROWSER_PORT, TV_BROWSER_UNIT, TV_UNIT, type BrowserReport, type PageCall, type PageMedia, type Screen } from "./tv";

const UNIT_FILE = "/etc/systemd/system/" + TV_BROWSER_UNIT;
const has = (bin: string): boolean => !!Bun.which(bin, { PATH });

export const browserInstalled = (): boolean => has("cage") && has("chromium");

const browserRuns = async (): Promise<boolean> => existsSync(UNIT_FILE) && (await run(["systemctl", "is-active", TV_BROWSER_UNIT], 15_000)).out.trim() === "active";

/** What was on the screen when the browser took it, and when it is to come back */
let showing: { /** Who put the page there: the page going by itself is logged as theirs */ by: string; back: boolean; resume: { file: string; at: number; subtitle: string } | null; until: number; timer: Timer | null } | null = null;
/** The page the browser shows, as last heard from it */
let page: TvPage | null = null;

/** The connection to the page in the browser: calls go over it, and what the page tells comes back */
let link: { socket: WebSocket; calls: Map<number, (value: unknown) => void>; asked: number } | null = null;

interface Target {
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

async function target(): Promise<Target | null> {
  try {
    const all = (await (await fetch(`http://127.0.0.1:${TV_BROWSER_PORT}/json`, { signal: AbortSignal.timeout(2000) })).json()) as Target[];
    return all.find((one) => one.type === "page") ?? null;
  } catch {
    return null;
  }
}

function tellPage(next: TvPage | null): void {
  if (JSON.stringify(next) === JSON.stringify(page)) return;
  page = next;
  bus.publish("tv", tvNow());
}

/** Connects to the page the browser shows; null when the browser does not answer */
async function connected(): Promise<NonNullable<typeof link> | null> {
  if (link && link.socket.readyState === WebSocket.OPEN) return link;
  const found = await target();
  if (!found) return null;
  const socket = new WebSocket(found.webSocketDebuggerUrl);
  const mine = { socket, calls: new Map<number, (value: unknown) => void>(), asked: 0 };
  const opened = await new Promise<boolean>((resolve) => {
    socket.addEventListener("open", () => resolve(true), { once: true });
    socket.addEventListener("error", () => resolve(false), { once: true });
    setTimeout(() => resolve(false), 3000);
  });
  if (!opened) return null;
  socket.addEventListener("message", (event) => {
    let said: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { name?: string; payload?: string; frame?: { parentId?: string; url?: string } } };
    try {
      said = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof said.id === "number") {
      // only an answer to a question that was asked here is taken: the number comes from the browser
      const waiting = mine.calls.get(said.id);
      mine.calls.delete(said.id);
      if (typeof waiting === "function") waiting(said.error ? null : (said.result ?? {}));
      // the remote's "home" button, heard by the script every page gets
    } else if (said.method === "Runtime.bindingCalled" && said.params?.name === "hataScreen") void fromScreen(String(said.params.payload ?? "")).catch(() => {});
    else if (said.method === "Page.frameNavigated" && !said.params?.frame?.parentId) void refreshPage();
    else if (said.method === "Page.loadEventFired") void refreshPage();
    else if (said.method === "Target.attachedToTarget") {
      const told = said.params as unknown as { sessionId?: string; targetInfo?: { type?: string } };
      if (told.sessionId && told.targetInfo?.type === "iframe") {
        inner.add(told.sessionId);
        // a frame of another site is a page of its own to the browser: it gets the script too
        for (const source of [BROWSER_POINTER_SCRIPT, BROWSER_SWIPE_SCRIPT])
          for (const call of [{ method: "Page.addScriptToEvaluateOnNewDocument", params: { source } }, { method: "Runtime.evaluate", params: { expression: source } }]) socket.send(JSON.stringify({ id: ++mine.asked, ...call, sessionId: told.sessionId }));
      }
    } else if (said.method === "Target.detachedFromTarget") inner.delete(String((said.params as unknown as { sessionId?: string }).sessionId));
        else if (said.method === "Page.screencastFrame") {
      const frame = said.params as unknown as { data?: string; sessionId?: number };
      if (frame.data) {
        cast.frame = new Uint8Array(Buffer.from(frame.data, "base64"));
        for (const tell of watchers) tell(cast.frame);
      }
      socket.send(JSON.stringify({ id: ++mine.asked, method: "Page.screencastFrameAck", params: { sessionId: frame.sessionId } }));
    }
  });
  socket.addEventListener("close", () => {
    for (const answer of mine.calls.values()) answer(null);
    if (link === mine) link = null;
    cast.on = false;
    cast.frame = null;
    inner.clear();
    worlds.clear();
    mediaAt = null;
  });
  link = mine;
  await ask({ method: "Page.enable" });
  await ask({ method: "Runtime.enable" });
  await ask({ method: "Runtime.addBinding", params: { name: "hataScreen" } });
  await ask({ method: "Page.addScriptToEvaluateOnNewDocument", params: { source: BROWSER_HOME_SCRIPT } });
  await ask({ method: "Runtime.evaluate", params: { expression: BROWSER_HOME_SCRIPT } });
  await ask({ method: "Page.addScriptToEvaluateOnNewDocument", params: { source: BROWSER_POINTER_SCRIPT } });
  await ask({ method: "Runtime.evaluate", params: { expression: BROWSER_POINTER_SCRIPT } });
  // the panel a finger pulls down from the top edge; frames of the same site are this target's too
  for (const source of [browserPanelScript(panelWords()), BROWSER_SWIPE_SCRIPT]) {
    await ask({ method: "Page.addScriptToEvaluateOnNewDocument", params: { source } });
    await ask({ method: "Runtime.evaluate", params: { expression: source } });
  }
  await ask({ method: "Target.setAutoAttach", params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true } });
  // the pointer stands in the middle of the screen from the browser's start: put away into a corner, in the background
  void parkPointer();
  return mine;
}

/** The labels of the panel pulled down on the screen, in the server's language */
function panelWords(): Record<string, string> {
  const words = (settings.language === "uk" ? uk : en) as Record<string, string>;
  return Object.fromEntries(PANEL_BUTTONS.map(([id]) => [id, words[`tv.panel.${id}`] ?? id]));
}

/** What the page on the screen asks through its binding: the remote's home key, or a button of the pulled-down panel */
async function fromScreen(payload: string): Promise<void> {
  if (payload === "home") return void (await leaveBrowser());
  if (payload === "back" || payload === "forward" || payload === "reload" || payload === "start") {
    const calls = browserCalls(payload, null);
    if (calls) for (const call of calls) await ask(call);
  }
}

/** One call of the browser's protocol; null when it did not answer or refused */
async function ask(call: PageCall, wait = 8000, session = ""): Promise<unknown> {
  const to = link && link.socket.readyState === WebSocket.OPEN ? link : await connected();
  if (!to) return null;
  return new Promise((resolve) => {
    const id = ++to.asked;
    const timer = setTimeout(() => {
      to.calls.delete(id);
      resolve(null);
    }, wait);
    to.calls.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    to.socket.send(JSON.stringify({ id, method: call.method, ...(call.params ? { params: call.params } : {}), ...(session ? { sessionId: session } : {}) }));
  });
}

/** The frames of other sites inside the page (a film site's player is one): each is the browser's own target, attached to as it appears */
const inner = new Set<string>();
/** The place Hata's script runs in, per frame: made once, made again when the frame went elsewhere */
const worlds = new Map<string, number>();
/** Where the video was found last: buttons go there */
let mediaAt: { session: string; frame: string } | null = null;

interface FrameTree {
  frame: { id: string };
  childFrames?: FrameTree[];
}

const framesOf = (tree: FrameTree | undefined): string[] => (tree ? [tree.frame.id, ...(tree.childFrames ?? []).flatMap(framesOf)] : []);

/** Runs a script in one frame, in a world of Hata's own (the page's code does not see it); undefined — the frame is gone */
async function inFrame(session: string, frame: string, expression: string): Promise<unknown> {
  const key = session + "|" + frame;
  for (let tries = 0; tries < 2; tries++) {
    let world = worlds.get(key);
    if (world === undefined) {
      world = ((await ask({ method: "Page.createIsolatedWorld", params: { frameId: frame, worldName: "hata" } }, 3000, session)) as { executionContextId?: number } | null)?.executionContextId;
      if (world === undefined) return undefined;
      worlds.set(key, world);
    }
    const said = (await ask({ method: "Runtime.evaluate", params: { expression, contextId: world, returnByValue: true, userGesture: true } }, 3000, session)) as { result?: { value?: unknown }; exceptionDetails?: unknown } | null;
    if (said && !said.exceptionDetails) return said.result?.value ?? null;
    worlds.delete(key);
  }
  return undefined;
}

type Found = PageMedia & { area: number };

/** The video the page plays, looked for in every frame; with an action, that is done to it where it was found last */
async function media(action = "", value: unknown = null): Promise<PageMedia | null> {
  if (action && mediaAt) {
    const done = (await inFrame(mediaAt.session, mediaAt.frame, mediaScript(action, value))) as Found | null | undefined;
    if (done) return done;
  }
  let best: { found: Found; session: string; frame: string } | null = null;
  for (const session of ["", ...inner]) {
    const tree = (await ask({ method: "Page.getFrameTree" }, 3000, session)) as { frameTree?: FrameTree } | null;
    for (const frame of framesOf(tree?.frameTree)) {
      const found = (await inFrame(session, frame, mediaScript())) as Found | null | undefined;
      if (found && (!best || (!found.paused && best.found.paused) || (found.paused === best.found.paused && found.area > best.found.area))) best = { found, session, frame };
    }
  }
  mediaAt = best && { session: best.session, frame: best.frame };
  if (best && action) return ((await inFrame(best.session, best.frame, mediaScript(action, value))) as Found | null | undefined) ?? best.found;
  return best?.found ?? null;
}

async function refreshPage(): Promise<void> {
  const found = await target();
  tellPage(found && found.url && found.url !== "about:blank" && !found.url.startsWith("file:") ? { url: found.url.slice(0, 2000), title: found.title.replace(/[\x00-\x1f]/g, "").slice(0, 200) } : found ? { url: "", title: "" } : null);
}

const secondsLeft = (): number => (showing?.until ? Math.max(1, Math.ceil((showing.until - Date.now()) / 1000)) : 0);

async function report(): Promise<{ screen: Screen; browser: BrowserReport }> {
  const running = await browserRuns();
  if (running) await refreshPage();
  else if (page) tellPage(null);
  return {
    screen: running ? "browser" : (await kodiRuns()) ? "kodi" : screenDark() ? "dark" : "off",
    browser: {
      installed: browserInstalled(),
      install: installCommand(BROWSER_PACKAGES.join(" ")),
      running,
      url: running ? (page?.url ?? "") : settings.tv.page,
      title: running ? (page?.title ?? "") : "",
      last: settings.tv.page,
      media: running ? await media().catch(() => null) : null,
      bookmarks: settings.tv.bookmarks,
      left: running ? secondsLeft() : 0,
      back: running ? (showing?.back ?? tvEnabled()) : false,
    },
  };
}

/** Called once at import: the player's report and its "now" carry the browser's part from here on */
screenShares({ report, page: () => page });

/** Installs the browser of the screen (a quiet job of kind `tv`); nothing is started by that */
export function installBrowser(by: string): Job {
  if (packageManager() !== "apt-get") throw new AppError("tv.noInstaller", 409);
  return startJob("tv", "tv", by, async (log) => {
    const env = { DEBIAN_FRONTEND: "noninteractive" };
    let done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...BROWSER_PACKAGES], log, 20 * 60_000, env);
    if (done.code !== 0) {
      await runLogged(["apt-get", "update"], log, 5 * 60_000, env);
      done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...BROWSER_PACKAGES], log, 20 * 60_000, env);
    }
    if (done.code !== 0) throw new AppError("tv.installFailed", 409, { message: (done.err || done.out).trim().split("\n").slice(-3).join("\n") });
    record("tv.browserInstalled", { user: by });
    bus.publish("tv");
  }, true);
}

/** The browser's service as it should be now: its sound goes where the player's went */
async function writeUnit(): Promise<boolean> {
  const text = browserUnitText(browserSound(settings.tv.sound));
  let was = "";
  try {
    was = readFileSync(UNIT_FILE, "utf8");
  } catch {}
  if (was !== text) {
    writeFileSync(UNIT_FILE, text);
    await run(["systemctl", "daemon-reload"], 30_000);
  }
  // Hata's own page, in the server's language: what the browser starts with
  const words = (settings.language === "uk" ? uk : en) as Record<string, string>;
  const home = browserHomeHtml(settings.language, settings.local.name || hostname(), words["tv.page.homeHint"] ?? "", settings.tv.bookmarks);
  let had = "";
  try {
    had = readFileSync(TV_BROWSER_HOME, "utf8");
  } catch {}
  if (had !== home) {
    writeFileSync(TV_BROWSER_HOME, home);
    await run(["chown", `${TV_USER}:${TV_USER}`, TV_BROWSER_HOME], 10_000);
  }
  return had !== home;
}

/** The pages kept for the screen: the list as the person made it; Hata's page on the screen shows them as tiles */
export async function setBookmarks(raw: unknown, by: string): Promise<TvReport> {
  settings.tv.bookmarks = cleanBookmarks(raw);
  saveSettings();
  const running = await browserRuns();
  // the screen's own page is a file: written anew, and shown anew when it is the one on the screen
  if (existsSync(UNIT_FILE) && (await writeUnit()) && running && page && !page.url) await ask({ method: "Page.reload" });
  record("tv.bookmarks", { user: by });
  return tvReport();
}

/** Before the browser starts: its settings say not to offer a translation (it reads them only at its start) */
async function quietTranslate(): Promise<void> {
  const dir = `${TV_HOME}/.browser/Default`;
  const file = `${dir}/Preferences`;
  try {
    let had = "";
    try {
      had = readFileSync(file, "utf8");
    } catch {}
    const text = withoutTranslate(had);
    if (text === had) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
    await run(["chown", "-R", `${TV_USER}:${TV_USER}`, `${TV_HOME}/.browser`], 10_000);
  } catch {}
}

/** The browser takes the screen (the player, when it runs, is stopped by that) and answers Hata */
async function startBrowser(by: string): Promise<void> {
  if (!browserInstalled()) throw new AppError("tv.browserMissing", 409);
  const playing = tvNow().playing;
  const back = await kodiRuns();
  // the film on the screen goes on from here when the page leaves
  const resume = back && playing ? { file: playing.file, at: Math.floor(playing.time + (playing.paused ? 0 : (Date.now() - playing.at) / 1000)), subtitle: playing.outside ?? "" } : null;
  await setUp();
  await writeUnit();
  sleepScreen(false);
  if (!(await browserRuns())) await quietTranslate();
  // The player lets the screen go a moment AFTER its service has stopped (its session is still being
  // closed), and a browser started in that moment finds the screen busy and stands there with nothing
  // shown: so the player is stopped first and given that moment, and a start that came to nothing is
  // made once more.
  if (back) {
    await run(["systemctl", "stop", TV_UNIT], 30_000);
    await Bun.sleep(1500);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const done = await run(["systemctl", "start", TV_BROWSER_UNIT], 60_000);
    if (done.code !== 0) throw new AppError("tv.browserFailed", 409, { message: (done.err || done.out).trim().split("\n").slice(-2).join("\n") });
    showing = { by, back, resume, until: 0, timer: null };
    for (let i = 0; i < (attempt ? 40 : 16); i++) {
      if (await connected()) return;
      await Bun.sleep(500);
    }
    if (!attempt) {
      await run(["systemctl", "kill", "--signal=SIGKILL", TV_BROWSER_UNIT], 10_000);
      await run(["systemctl", "reset-failed", TV_BROWSER_UNIT], 10_000);
      await Bun.sleep(1000);
    }
  }
  await run(["systemctl", "stop", TV_BROWSER_UNIT], 30_000);
  showing = null;
  if (back) await run(["systemctl", "start", TV_UNIT], 60_000);
  throw new AppError("tv.browserFailed", 409, { message: (await run(["journalctl", "-u", TV_BROWSER_UNIT, "-n", "3", "--no-pager", "-o", "cat"], 10_000)).out.trim() });
}

/**
 * Shows a web page on the screen. With `seconds` it stays that long and then what was there comes
 * back; without, it stays until somebody changes it. No address: the browser alone, with the page it
 * showed last.
 */
export async function openPage(raw: unknown, seconds: unknown, by: string): Promise<TvReport> {
  const address = raw === undefined || raw === null || raw === "" ? "" : cleanLink(raw);
  if (address === null) throw new AppError("tv.badLink", 400);
  const time = cleanShowTime(seconds);
  if (time === null) throw new AppError("tv.badTime", 400);
  if (!(await browserRuns())) await startBrowser(by);
  // a restart of Hata forgets what was there before: the player comes back when it is set to run
  showing ??= { by, back: tvEnabled(), resume: null, until: 0, timer: null };
  // no address: Hata's own page, which the browser starts with
  const url = address;
  if (url) {
    const went = (await ask({ method: "Page.navigate", params: { url } }, 15_000)) as { errorText?: string } | null;
    if (!went) throw new AppError("tv.browserFailed", 409, { message: "" });
    // said at once: the browser itself names the page only when it has begun to load
    tellPage({ url, title: "" });
  }
  if (showing.timer) clearTimeout(showing.timer);
  showing.timer = time ? setTimeout(() => void leaveBrowser().catch(() => {}), time * 1000) : null;
  showing.until = time ? Date.now() + time * 1000 : 0;
  if (address && !time && settings.tv.page !== address) {
    settings.tv.page = address;
    saveSettings();
  }
  if (address) record("tv.page", { user: by, detail: linkName(address) });
  bus.publish("tv");
  return tvReport();
}

/** The page leaves the screen: the player comes back when it had it (and the film goes on), else the console */
export async function leaveBrowser(who = ""): Promise<TvReport> {
  const was = showing;
  // gone by its time or by the remote's button: whoever put it there
  const by = who || was?.by || "schedule";
  if (was?.timer) clearTimeout(was.timer);
  showing = null;
  if (!(await browserRuns())) return tvReport();
  link?.socket.close();
  const back = was?.back ?? tvEnabled();
  // starting the player stops the browser: the two services exclude each other
  await run(back ? ["systemctl", "start", TV_UNIT] : ["systemctl", "stop", TV_BROWSER_UNIT], 60_000);
  if (!back) await run(["chvt", "1"], 10_000);
  tellPage(null);
  if (back && was?.resume && (await awaitKodi())) await playOnTv(was.resume.file, by, was.resume.at, was.resume.subtitle || undefined).catch(() => {});
  record("tv.pageGone", { user: by });
  bus.publish("tv");
  return tvReport();
}

/** The size of the page the browser shows, in the page's own pixels */
async function pageSize(): Promise<{ width: number; height: number }> {
  const said = (await ask({ method: "Page.getLayoutMetrics" })) as { cssVisualViewport?: { clientWidth?: number; clientHeight?: number } } | null;
  return { width: said?.cssVisualViewport?.clientWidth ?? 0, height: said?.cssVisualViewport?.clientHeight ?? 0 };
}

/**
 * The picture of the screen for Hata's page. The browser sends its own frames, made small, whenever
 * what it shows changes (its "screencast"): asking it for a screenshot of another size each second
 * was seen to resize the page on the real screen. Sent only while a page of Hata's keeps asking.
 */
const cast: { on: boolean; big: boolean; frame: Uint8Array | null; asked: number; timer: Timer | null } = { on: false, big: false, frame: null, asked: 0, timer: null };

/** Those who get every frame as it comes: the streams of pictures open in pages of Hata's */
const watchers = new Set<(frame: Uint8Array) => void>();

/**
 * The screen as a stream of pictures (each replaces the last in an `<img>`): the browser's own frames
 * as they come, at most a dozen a second, for as long as the page that asked stays. No program is
 * added and nothing shows on the screen itself — live enough to aim and to follow a film, without sound.
 */
export async function screenStream(signal: AbortSignal): Promise<Response> {
  const first = await screenShot();
  const encoder = new TextEncoder();
  const part = (frame: Uint8Array) => [encoder.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`), frame, encoder.encode("\r\n")];
  let tell: ((frame: Uint8Array) => void) | null = null;
  let keep: Timer | null = null;
  const end = () => {
    if (tell) watchers.delete(tell);
    if (keep) clearInterval(keep);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = 0;
      let latest = first;
      const send = (frame: Uint8Array) => {
        try {
          for (const piece of part(frame)) controller.enqueue(piece);
        } catch {
          end();
        }
      };
      send(first);
      tell = (frame) => {
        latest = frame;
        if (Date.now() - last < 80) return;
        last = Date.now();
        send(frame);
      };
      watchers.add(tell);
      // the screencast goes on while somebody watches; a page that stands still sends its last picture again, so the connection lives
      keep = setInterval(() => {
        cast.asked = Date.now();
        if (Date.now() - last > 4000) ((last = Date.now()), send(latest));
        if (!cast.on) void screenShot().catch(() => {});
      }, 2000);
      signal.addEventListener("abort", () => {
        end();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: end,
  });
  return new Response(body, { headers: { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store" } });
}

/** What the screen shows right now, as a small picture for Hata's page: only while the browser has it */
export async function screenShot(big = false): Promise<Uint8Array> {
  if (!(await browserRuns())) throw new AppError("tv.browserOff", 409);
  cast.asked = Date.now();
  // looked at on a whole screen, the picture is sent as large as the screen itself
  if (cast.on && link && cast.big !== big) {
    await ask({ method: "Page.stopScreencast" });
    cast.on = false;
    cast.frame = null;
  }
  if (!cast.on || !link) {
    cast.big = big;
    if ((await ask({ method: "Page.startScreencast", params: { format: "jpeg", quality: big ? 75 : 55, maxWidth: big ? 3840 : PREVIEW_WIDTH, maxHeight: big ? 2160 : PREVIEW_WIDTH, everyNthFrame: 2 } })) === null) throw new AppError("tv.browserFailed", 409, { message: "" });
    cast.on = true;
    // nobody looks any more: the browser is told to stop making frames
    cast.timer ??= setInterval(() => {
      if (Date.now() - cast.asked < 15_000) return;
      clearInterval(cast.timer!);
      cast.timer = null;
      cast.on = false;
      cast.frame = null;
      if (link) void ask({ method: "Page.stopScreencast" });
    }, 5000);
  }
  for (let i = 0; i < 8 && !cast.frame; i++) await Bun.sleep(100);
  // a page that stands still sends no frame: one picture of it as it is (whole, never resized — that was seen to resize the page itself)
  if (!cast.frame) {
    const still = (await ask({ method: "Page.captureScreenshot", params: { format: "jpeg", quality: 60 } }, 6000)) as { data?: string } | null;
    if (still?.data && !cast.frame) cast.frame = new Uint8Array(Buffer.from(still.data, "base64"));
  }
  if (!cast.frame) throw new AppError("tv.browserFailed", 409, { message: "" });
  return cast.frame;
}

/** What is on the screen, for a card that keeps looking: the player's "now" and, while a page shows, how its video stands */
export async function screenNow(): Promise<ReturnType<typeof tvNow> & { kind: Screen; media: PageMedia | null; left: number; back: boolean; bookmarks: typeof settings.tv.bookmarks; can: { kodi: boolean; browser: boolean } }> {
  const browsing = await browserRuns();
  const kind: Screen = browsing ? "browser" : (await kodiRuns()) ? "kodi" : screenDark() ? "dark" : "off";
  return { ...tvNow(), kind, media: browsing ? await media().catch(() => null) : null, left: browsing ? secondsLeft() : 0, back: browsing ? (showing?.back ?? tvEnabled()) : false, bookmarks: settings.tv.bookmarks, can: { kodi: has("kodi"), browser: browserInstalled() } };
}

/** A button of the page's remote for the browser */
export async function browserDo(action: unknown, value: unknown, by: string): Promise<void> {
  if (action === "home") return void (await leaveBrowser(by));
  if (typeof action === "string" && MEDIA_ACTIONS.includes(action)) {
    if (!(await browserRuns())) throw new AppError("tv.browserOff", 409);
    if (!(await media(action, value))) throw new AppError("tv.noVideo", 409);
    return;
  }
  const pointed = action === "click" || action === "wheel";
  if (pointed && !(await browserRuns())) throw new AppError("tv.browserOff", 409);
  const calls = pointed ? pointerCalls(action, value, await pageSize()) : browserCalls(action, value);
  if (!calls) throw new AppError("tv.badAction", 400);
  if (!(await browserRuns())) throw new AppError("tv.browserOff", 409);
  for (const call of calls) if ((await ask(call)) === null) throw new AppError("tv.browserFailed", 409, { message: "" });
}

/** Who has the screen, as the person chooses it: the player, the browser, the system's console, or nobody — the screen asleep */
export async function setScreen(screen: unknown, by: string): Promise<TvReport> {
  if (screen === "browser") return openPage("", 0, by);
  if (screen === "kodi") {
    if (await browserRuns()) {
      if (showing) showing.back = true;
      else showing = { by, back: true, resume: null, until: 0, timer: null };
      await leaveBrowser(by);
    }
    return switchTv(true, by);
  }
  if (screen === "off" || screen === "dark") {
    if (await browserRuns()) {
      if (showing) showing.back = false;
      else showing = { by, back: false, resume: null, until: 0, timer: null };
      await leaveBrowser(by);
    }
    if (tvEnabled() || (await kodiRuns())) await switchTv(false, by);
    // the console has the screen now: left there, or put to sleep with it
    sleepScreen(screen === "dark");
    if (screen === "dark") await Bun.sleep(600);
    bus.publish("tv");
    return tvReport();
  }
  throw new AppError("tv.badAction", 400);
}
