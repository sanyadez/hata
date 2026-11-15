/**
 * The module "TV": Kodi on the screen plugged into this server, installed by its button, run as a
 * service of its own user, and driven from Hata's page over Kodi's local control port. Remotes,
 * keyboards and mice plugged into the server are Kodi's own business — it reads them itself.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { saveSettings, settings } from "./config";
import { installCommand, packageManager, PATH, run, runLogged } from "./packages";
import { advancedXml, cleanFolders, decodePackages, isOurs, playable, portIn, readDisplay, hwdbText, remoteCall, seconds, sourcesXml, takeJson, TV_HOME, TV_HWDB, TV_PORT, TV_UNIT, TV_USER, unitText, type Call, type Display } from "./tv";

const USERDATA = join(TV_HOME, ".kodi", "userdata");
const UNIT_FILE = "/etc/systemd/system/" + TV_UNIT;
const DRM = "/sys/class/drm";

const has = (bin: string): boolean => !!Bun.which(bin, { PATH });
const text = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/** The screens the server has connectors for, as the kernel sees them: nothing is installed to know */
export function displays(): Display[] {
  let dirs: string[] = [];
  try {
    dirs = readdirSync(DRM).filter((name) => /^card\d+-/.test(name));
  } catch {}
  return dirs.sort().map((dir) => {
    let edid = new Uint8Array(0);
    try {
      edid = new Uint8Array(readFileSync(join(DRM, dir, "edid")));
    } catch {}
    return readDisplay(dir, text(join(DRM, dir, "status")), text(join(DRM, dir, "modes")), edid);
  });
}

/** Who made the graphics card: decides the driver that decodes video */
const cardVendor = (): string => text(join(DRM, "card0", "device", "vendor")).trim() || text(join(DRM, "card1", "device", "vendor")).trim();

const decodeDriver = (): boolean => ["/usr/lib/x86_64-linux-gnu/dri", "/usr/lib/aarch64-linux-gnu/dri", "/usr/lib64/dri", "/usr/lib/dri"].some((dir) => {
  try {
    return readdirSync(dir).some((name) => name.endsWith("_drv_video.so"));
  } catch {
    return false;
  }
});

/** Keyboards, mice and remotes plugged in over USB or Bluetooth: what the player can be driven with from the sofa */
function remotes(): string[] {
  const names: string[] = [];
  for (const block of text("/proc/bus/input/devices").split("\n\n")) {
    if (!/^I: Bus=000[35] /m.test(block) || !/^H: Handlers=.*\b(kbd|mouse\d*)\b/m.test(block)) continue;
    const name = /^N: Name="(.*)"$/m.exec(block)?.[1]?.replace(/\s+(Keyboard|Mouse|Consumer Control|System Control)$/i, "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The port Kodi listens on for Hata: ours unless the person keeps an advancedsettings.xml of their own */
function controlPort(): number {
  const file = text(join(USERDATA, "advancedsettings.xml"));
  return isOurs(file) ? TV_PORT : (portIn(file) ?? 9090);
}

let asked = 0;

/** One call of Kodi's JSON-RPC over its local port; null when Kodi does not answer */
function rpc(call: Call, wait = 4000): Promise<unknown> {
  return new Promise((resolve) => {
    const id = ++asked;
    let buffer = "";
    const socket = connect({ host: "127.0.0.1", port: controlPort() });
    const done = (value: unknown) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(wait, () => done(null));
    socket.once("error", () => done(null));
    socket.once("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id, method: call.method, ...(call.params ? { params: call.params } : {}) })));
    socket.on("data", (piece) => {
      const taken = takeJson(buffer + piece.toString("utf8"));
      buffer = taken.rest;
      // Kodi tells every listener what happens (a film started): only the answer to this call counts
      for (const value of taken.values as { id?: unknown; result?: unknown }[]) if (value?.id === id) return done(value.result ?? null);
    });
  });
}

const unit = async (verb: string): Promise<string> => (await run(["systemctl", verb, TV_UNIT], 15_000)).out.trim();

/** The player is set to start with the server: what holds the module on */
export const tvEnabled = (): boolean => existsSync("/etc/systemd/system/multi-user.target.wants/" + TV_UNIT);
/** Hata has set the player up here before */
export const tvSetUp = (): boolean => existsSync(UNIT_FILE);

interface Playing {
  title: string;
  file: string;
  paused: boolean;
  time: number;
  total: number;
}

export interface TvReport {
  displays: Display[];
  /** Kodi is installed */
  installed: boolean;
  version: string;
  /** Why it cannot be installed from here: "" — it can */
  cannot: string;
  install: string;
  /** The graphics card decodes video itself */
  decodes: boolean;
  on: boolean;
  running: boolean;
  /** Kodi answers Hata */
  answers: boolean;
  folders: string[];
  /** A folder of the data folder that looks like the place of films and music, offered when none is chosen */
  suggested: string[];
  remotes: string[];
  playing: Playing | null;
  volume: number;
  muted: boolean;
  audio: { value: string; options: { label: string; value: string }[] } | null;
}

const packages = (): string[] => ["kodi", ...(decodeDriver() ? [] : decodePackages(cardVendor()))];

async function nowPlaying(): Promise<{ player: number | null; playing: Playing | null }> {
  const players = (await rpc({ method: "Player.GetActivePlayers" })) as { playerid: number }[] | null;
  const player = players?.[0]?.playerid ?? null;
  if (player === null) return { player, playing: null };
  const [props, item] = (await Promise.all([rpc({ method: "Player.GetProperties", params: { playerid: player, properties: ["time", "totaltime", "speed"] } }), rpc({ method: "Player.GetItem", params: { playerid: player, properties: ["title", "file"] } })])) as [Record<string, unknown> | null, { item?: Record<string, unknown> } | null];
  if (!props) return { player, playing: null };
  const file = String(item?.item?.file ?? "");
  return { player, playing: { title: String(item?.item?.title || item?.item?.label || file.split("/").pop() || ""), file, paused: props.speed === 0, time: seconds(props.time), total: seconds(props.totaltime) } };
}

async function audioChoice(): Promise<TvReport["audio"]> {
  const said = (await rpc({ method: "Settings.GetSettings", params: { level: "expert", filter: { section: "system", category: "audio" } } })) as { settings?: { id: string; value: unknown; options?: { label: string; value: string }[] }[] } | null;
  const device = said?.settings?.find((one) => one.id === "audiooutput.audiodevice");
  return device ? { value: String(device.value), options: (device.options ?? []).map((o) => ({ label: String(o.label).replace(/[\x00-\x1f]/g, "").replace(/\s+/g, " ").trim(), value: String(o.value) })) } : null;
}

export async function tvReport(): Promise<TvReport> {
  const installed = has("kodi");
  const running = installed && tvSetUp() && (await unit("is-active")) === "active";
  const app = running ? ((await rpc({ method: "Application.GetProperties", params: { properties: ["volume", "muted", "version"] } }, 2500)) as { volume?: number; muted?: boolean; version?: { major?: number; minor?: number } } | null) : null;
  const [playing, audio] = app ? await Promise.all([nowPlaying().then((now) => now.playing), audioChoice()]) : [null, null];
  const media = join(settings.dataRoot, "Media");
  return {
    displays: displays(),
    installed,
    version: app?.version ? `${app.version.major}.${app.version.minor}` : "",
    cannot: installed || packageManager() === "apt-get" ? "" : "noInstaller",
    install: installCommand(packages().join(" ")),
    decodes: decodeDriver(),
    on: tvEnabled(),
    running,
    answers: !!app,
    folders: settings.tv.folders,
    suggested: settings.tv.folders.length === 0 && existsSync(media) ? [media] : [],
    remotes: remotes(),
    playing,
    volume: app?.volume ?? 0,
    muted: app?.muted ?? false,
    audio,
  };
}

/** A file of Kodi's that Hata keeps, written unless the person keeps one of their own there */
function writeOurs(name: string, body: string): void {
  const path = join(USERDATA, name);
  if (isOurs(text(path))) writeFileSync(path, body);
}

/** The player's user, its files and its service: everything but the program itself */
async function setUp(): Promise<void> {
  if ((await run(["id", TV_USER], 10_000)).code !== 0) {
    const made = await run(["useradd", "--system", "--create-home", "--home-dir", TV_HOME, "--shell", "/usr/sbin/nologin", "--groups", "video,audio,input,render", TV_USER], 30_000);
    if (made.code !== 0) throw new AppError("tv.setupFailed", 409, { message: (made.err || made.out).trim() });
  }
  mkdirSync(USERDATA, { recursive: true });
  writeOurs("advancedsettings.xml", advancedXml(TV_PORT));
  writeOurs("sources.xml", sourcesXml(settings.tv.folders));
  await run(["chown", "-R", `${TV_USER}:${TV_USER}`, join(TV_HOME, ".kodi")], 60_000);
  writeFileSync(UNIT_FILE, unitText());
  await run(["systemctl", "daemon-reload"], 30_000);
  // the buttons of Android remotes: read anew by devices already plugged in, no restart of anything
  if (text(TV_HWDB) !== hwdbText()) {
    mkdirSync("/etc/udev/hwdb.d", { recursive: true });
    writeFileSync(TV_HWDB, hwdbText());
    await run(["systemd-hwdb", "update"], 60_000);
    await run(["udevadm", "trigger", "--subsystem-match=input", "--action=change"], 30_000);
  }
}

/** Installs Kodi and the driver that decodes video (a quiet job of kind `tv`), then sets the player up; it is not started by that */
export function installTv(by: string): Job {
  if (packageManager() !== "apt-get") throw new AppError("tv.noInstaller", 409);
  return startJob("tv", "tv", by, async (log) => {
    const env = { DEBIAN_FRONTEND: "noninteractive" };
    const wanted = packages();
    if (!has("kodi") || wanted.length > 1) {
      let done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...wanted], log, 15 * 60_000, env);
      if (done.code !== 0) {
        await runLogged(["apt-get", "update"], log, 5 * 60_000, env);
        done = await runLogged(["apt-get", "install", "-y", "--no-install-recommends", ...wanted], log, 15 * 60_000, env);
      }
      if (done.code !== 0) throw new AppError("tv.installFailed", 409, { message: (done.err || done.out).trim().split("\n").slice(-3).join("\n") });
    }
    await setUp();
    record("tv.installed", { user: by });
    bus.publish("tv");
  }, true);
}

/** Kodi answers: waited for after a start, it takes a few seconds to come up */
async function awaitKodi(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    if ((await rpc({ method: "JSONRPC.Ping" }, 1500)) === "pong") return true;
    await Bun.sleep(1000);
  }
  return false;
}

/**
 * The first time the player runs, its sound goes where the picture goes: the HDMI output whose monitor
 * says it plays sound. After that the choice is the person's and is not touched.
 */
async function chooseAudioOnce(): Promise<void> {
  if (settings.tv.audioChosen) return;
  const choice = await audioChoice();
  if (!choice) return;
  let cards: string[] = [];
  try {
    cards = readdirSync("/proc/asound").filter((name) => /^card\d+$/.test(name));
  } catch {}
  for (const card of cards) {
    const id = text(`/proc/asound/${card}/id`).trim();
    let elds: string[] = [];
    try {
      elds = readdirSync(`/proc/asound/${card}`).filter((name) => name.startsWith("eld#"));
    } catch {}
    for (const eld of elds.sort()) {
      if (!/monitor_present\s+1/.test(text(`/proc/asound/${card}/${eld}`))) continue;
      // Kodi's own value carries the card's name after a bar: `ALSA:hdmi:CARD=HDMI,DEV=0|HDA Intel`
      const device = `ALSA:hdmi:CARD=${id},DEV=${eld.split(".")[1]}`;
      const value = choice.options.find((o) => o.value === device || o.value.startsWith(device + "|"))?.value;
      if (!value) continue;
      await rpc({ method: "Settings.SetSettingValue", params: { setting: "audiooutput.audiodevice", value } });
      settings.tv.audioChosen = true;
      saveSettings();
      return;
    }
  }
}

/** On: the player starts now and with the server. Off: it stops and the screen goes back to the console */
export async function switchTv(on: boolean, by: string): Promise<TvReport> {
  if (!has("kodi")) throw new AppError("tv.notInstalled", 409);
  if (on) await setUp();
  const done = await run(["systemctl", on ? "enable" : "disable", "--now", TV_UNIT], 60_000);
  if (done.code !== 0) throw new AppError("tv.switchFailed", 409, { message: (done.err || done.out).trim().split("\n").slice(-2).join("\n") });
  if (on && (await awaitKodi())) await chooseAudioOnce();
  record(on ? "tv.on" : "tv.off", { user: by });
  bus.publish("tv");
  return tvReport();
}

/** The folders the player shows. Kodi reads its places when it starts, so a running one is started again */
export async function setFolders(raw: unknown, by: string): Promise<TvReport> {
  const folders = cleanFolders(raw);
  for (const path of folders) {
    let dir = false;
    try {
      dir = statSync(path).isDirectory();
    } catch {}
    if (!dir) throw new AppError("tv.noFolder", 400, { path });
  }
  settings.tv.folders = folders;
  saveSettings();
  if (tvSetUp()) {
    writeOurs("sources.xml", sourcesXml(folders));
    await run(["chown", `${TV_USER}:${TV_USER}`, join(USERDATA, "sources.xml")], 10_000);
    if ((await unit("is-active")) === "active") {
      await run(["systemctl", "restart", TV_UNIT], 60_000);
      await awaitKodi();
    }
  }
  record("tv.folders", { user: by, detail: String(folders.length) });
  return tvReport();
}

export async function setAudio(value: unknown): Promise<TvReport> {
  const choice = await audioChoice();
  if (!choice) throw new AppError("tv.notRunning", 409);
  if (typeof value !== "string" || !choice.options.some((o) => o.value === value)) throw new AppError("tv.badAudio", 400);
  await rpc({ method: "Settings.SetSettingValue", params: { setting: "audiooutput.audiodevice", value } });
  settings.tv.audioChosen = true;
  saveSettings();
  return tvReport();
}

/** Plays a file of this server on the screen */
export async function playOnTv(path: unknown, by: string): Promise<void> {
  if (typeof path !== "string" || !path.startsWith("/") || !playable(path)) throw new AppError("tv.notPlayable", 400);
  let file = false;
  try {
    file = statSync(path).isFile();
  } catch {}
  if (!file) throw new AppError("tv.noFile", 404);
  if ((await rpc({ method: "JSONRPC.Ping" }, 2000)) !== "pong") throw new AppError("tv.notRunning", 409);
  if ((await rpc({ method: "Player.Open", params: { item: { file: path } } }, 8000)) !== "OK") throw new AppError("tv.playFailed", 409);
  record("tv.play", { user: by, detail: path });
  bus.publish("tv");
}

export interface TvNow extends Playing {
  /** When this was read: the page counts the seconds on from here while it plays */
  at: number;
}

let now: TvNow | null = null;
let watching = false;

/** What plays on the screen, as last heard from Kodi; null — nothing, or the player is off */
export const tvNow = (): TvNow | null => now;

function tell(next: TvNow | null): void {
  const same = JSON.stringify(next && { ...next, at: 0, time: 0 }) === JSON.stringify(now && { ...now, at: 0, time: 0 });
  // the same film a little further on is news only when it jumped: the page counts the seconds itself
  const jumped = !!next && !!now && Math.abs(next.time - (now.time + (now.paused ? 0 : (next.at - now.at) / 1000))) > 3;
  now = next;
  if (!same || jumped) bus.publish("tv", { playing: next });
}

/**
 * Listens to Kodi for as long as Hata runs: Kodi tells every program connected to its port what
 * happens (started, paused, sought, stopped — also when the remote in the person's hand did it), so
 * every page can show what is on the screen without asking again and again.
 */
export function watchTv(): void {
  if (watching) return;
  watching = true;
  let timer: Timer | null = null;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void nowPlaying().then(({ playing }) => tell(playing ? { ...playing, at: Date.now() } : null), () => {}), 300);
  };
  const listen = () => {
    // not set up here: nothing to listen to, looked at again later
    if (!tvSetUp()) return void setTimeout(listen, 30_000);
    let buffer = "";
    const socket = connect({ host: "127.0.0.1", port: controlPort() });
    socket.once("connect", refresh);
    socket.on("data", (piece) => {
      const taken = takeJson(buffer + piece.toString("utf8"));
      buffer = taken.rest.slice(-65536);
      if ((taken.values as { method?: unknown }[]).some((value) => typeof value?.method === "string" && value.method.startsWith("Player."))) refresh();
    });
    socket.once("error", () => {});
    socket.once("close", () => {
      tell(null);
      setTimeout(listen, 10_000);
    });
  };
  listen();
}

/** A button of the page's remote */
export async function remote(action: unknown, value: unknown): Promise<void> {
  const { player } = typeof action === "string" && /^(playpause|stop|forward|rewind|seek)$/.test(action) ? await nowPlaying() : { player: null };
  const call = typeof action === "string" ? remoteCall(action, value, player) : null;
  if (!call) throw new AppError("tv.badAction", 400);
  if ((await rpc(call)) === null && (await rpc({ method: "JSONRPC.Ping" }, 1500)) !== "pong") throw new AppError("tv.notRunning", 409);
}
