/**
 * The module "TV": Kodi on the screen plugged into this server, installed by its button, run as a
 * service of its own user, and driven from Hata's page over Kodi's local control port. Remotes,
 * keyboards and mice plugged into the server are Kodi's own business — it reads them itself.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createSocket } from "node:dgram";
import { connect } from "node:net";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, startJob, type Job } from "./apps";
import { bus } from "./bus";
import { saveSettings, settings } from "./config";
import { installCommand, packageManager, PATH, run, runLogged } from "./packages";
import { advancedXml, builtinPacket, cleanFolders, cleanLink, cleanStart, clickPacket, isLink, keyframeArgs, linkName, mediaOf, OUTSIDE_SUB, probeArgs, prefsOf, prefValue, streamArgs, subsArgs, tracksOf, streamZero, TV_LANGUAGES, type Media, type Pref, type Tracks, helloPacket, KEEP_NO, KEEP_SECONDS, KEEP_WINDOW, KEEP_YES, MATCH_OFF, MATCH_ON, pictureOf, decodePackages, isOurs, playable, portIn, readDisplay, hwdbText, keymapXml, polkitRule, remoteCall, seconds, shortTitle, sourcesXml, takeJson, TV_HOME, TV_HWDB, TV_POLKIT, TV_PORT, TV_UNIT, TV_USER, unitText, type Call, type Display, type Picture } from "./tv";

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

/** Kodi's windows by number: a film on the whole screen, and the player's menu over it */
const WINDOW_FULLSCREEN = 12005;
const WINDOW_OSD = 12901;

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

interface Playing extends Tracks {
  title: string;
  file: string;
  /** An address played with subtitles of an address of their own: kept so that a browser taking the film over has them too */
  outside?: string;
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
  /** The resolution, the refresh rate and whether the rate follows the film; null while Kodi does not answer */
  picture: Picture | null;
  /** Kodi's own settings the page shows (`PREFS`), by their names there */
  prefs: Record<string, Pref>;
  /** The language Kodi speaks: one of Hata's ("en", "uk"), "" — another; `busy` while a language is fetched and set */
  language: { value: string; busy: boolean; failed: boolean };
  /** ffmpeg is here: the browser's player chooses sound and subtitles and plays what a browser alone cannot */
  streams: boolean;
  /** The command that brings ffmpeg, shown by its button */
  streamsInstall: string;
  /** A new screen mode is on trial: seconds left to keep it before Kodi puts the old one back; 0 — none is */
  asking: number;
}

const packages = (): string[] => ["kodi", ...(decodeDriver() ? [] : decodePackages(cardVendor()))];

async function nowPlaying(): Promise<{ player: number | null; playing: Playing | null }> {
  const players = (await rpc({ method: "Player.GetActivePlayers" })) as { playerid: number }[] | null;
  const player = players?.[0]?.playerid ?? null;
  if (player === null) return { player, playing: null };
  const [props, item] = (await Promise.all([rpc({ method: "Player.GetProperties", params: { playerid: player, properties: ["time", "totaltime", "speed", "audiostreams", "currentaudiostream", "subtitles", "currentsubtitle", "subtitleenabled"] } }), rpc({ method: "Player.GetItem", params: { playerid: player, properties: ["title", "file"] } })])) as [Record<string, unknown> | null, { item?: Record<string, unknown> } | null];
  if (!props) return { player, playing: null };
  const file = String(item?.item?.file ?? "");
  const link = isLink(file);
  // an address says little as a title, and may carry a key: where it leads is shown
  const title = link ? String(item?.item?.title || "") || linkName(file) : shortTitle(String(item?.item?.title || item?.item?.label || file.split("/").pop() || ""));
  return { player, playing: { title, file, ...(link && sent?.link === file && sent.subtitle ? { outside: sent.subtitle } : {}), paused: props.speed === 0, time: seconds(props.time), total: seconds(props.totaltime), ...tracksOf(props) } };
}

async function audioChoice(): Promise<TvReport["audio"]> {
  const said = (await rpc({ method: "Settings.GetSettings", params: { level: "expert", filter: { section: "system", category: "audio" } } })) as { settings?: { id: string; value: unknown; options?: { label: string; value: string }[] }[] } | null;
  const device = said?.settings?.find((one) => one.id === "audiooutput.audiodevice");
  return device ? { value: String(device.value), options: (device.options ?? []).map((o) => ({ label: String(o.label).replace(/[\x00-\x1f]/g, "").replace(/\s+/g, " ").trim(), value: String(o.value) })) } : null;
}

async function pictureChoice(): Promise<Picture | null> {
  const [said, adjust] = (await Promise.all([rpc({ method: "Settings.GetSettings", params: { level: "expert", filter: { section: "system", category: "display" } } }), rpc({ method: "Settings.GetSettingValue", params: { setting: "videoplayer.adjustrefreshrate" } })])) as [{ settings?: unknown } | null, { value?: unknown } | null];
  return pictureOf(said?.settings, adjust?.value);
}

let prefsKept: { at: number; prefs: Record<string, Pref>; language: string } | null = null;

/** The settings shown on the page: asked at most twice a minute — Kodi's port answers one caller at a time */
async function prefsChoice(): Promise<{ prefs: Record<string, Pref>; language: string }> {
  if (prefsKept && Date.now() - prefsKept.at < 30_000) return prefsKept;
  const lists = (await Promise.all([["player", "language"], ["system", "audio"], ["interface", "screensaver"], ["system", "powermanagement"]].map(([section, category]) => rpc({ method: "Settings.GetSettings", params: { level: "expert", filter: { section, category } } })))) as ({ settings?: unknown[] } | null)[];
  const spoken = ((await rpc({ method: "Settings.GetSettingValue", params: { setting: "locale.language" } })) as { value?: unknown } | null)?.value;
  const language = Object.entries(TV_LANGUAGES).find(([, addon]) => addon === spoken)?.[0] ?? "";
  if (lists.some((one) => !one)) return { prefs: {}, language };
  prefsKept = { at: Date.now(), prefs: prefsOf(lists.flatMap((one) => one?.settings ?? [])), language };
  return prefsKept;
}

/** The programs the browser's player stands on */
export const streamsHere = (): boolean => has("ffmpeg") && has("ffprobe");

/** A screen mode on trial: Kodi's control port is silent until it is answered or its time is out */
let trial: { until: number; done: Promise<unknown>; port: number } | null = null;
let last: TvReport | null = null;

const secondsLeft = (): number => (trial ? Math.max(1, Math.ceil((trial.until - Date.now()) / 1000)) : 0);

export async function tvReport(): Promise<TvReport> {
  // Kodi answers nothing while it asks about the new mode: the page keeps what it had
  if (trial && last) return { ...last, asking: secondsLeft() };
  const installed = has("kodi");
  const running = installed && tvSetUp() && (await unit("is-active")) === "active";
  const app = running ? ((await rpc({ method: "Application.GetProperties", params: { properties: ["volume", "muted", "version"] } }, 2500)) as { volume?: number; muted?: boolean; version?: { major?: number; minor?: number } } | null) : null;
  const [playing, audio, picture, kept] = app ? await Promise.all([nowPlaying().then((now) => now.playing), audioChoice(), pictureChoice(), prefsChoice()]) : [null, null, null, null];
  const media = join(settings.dataRoot, "Media");
  return (last = {
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
    picture,
    prefs: kept?.prefs ?? {},
    language: { value: kept?.language ?? "", busy: speaking === "busy", failed: speaking === "failed" },
    streams: streamsHere(),
    streamsInstall: installCommand("ffmpeg"),
    asking: secondsLeft(),
  });
}

/** A file of Kodi's that Hata keeps, written unless the person keeps one of their own there */
function writeOurs(name: string, body: string): boolean {
  const path = join(USERDATA, name);
  const was = text(path);
  if (!isOurs(was) || was === body) return false;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  return true;
}

/** The player's user, its files and its service: everything but the program itself */
async function setUp(): Promise<void> {
  if ((await run(["id", TV_USER], 10_000)).code !== 0) {
    const made = await run(["useradd", "--system", "--create-home", "--home-dir", TV_HOME, "--shell", "/usr/sbin/nologin", "--groups", "video,audio,input,render", TV_USER], 30_000);
    if (made.code !== 0) throw new AppError("tv.setupFailed", 409, { message: (made.err || made.out).trim() });
  }
  mkdirSync(USERDATA, { recursive: true });
  // Kodi reads these when it starts: a running one is started again when one of them changed
  const changed = [writeOurs("advancedsettings.xml", advancedXml(TV_PORT)), writeOurs("keymaps/hata.xml", keymapXml()), writeOurs("sources.xml", sourcesXml(settings.tv.folders))].some(Boolean);
  if (existsSync("/usr/share/polkit-1") && text(TV_POLKIT) !== polkitRule()) {
    mkdirSync("/etc/polkit-1/rules.d", { recursive: true });
    writeFileSync(TV_POLKIT, polkitRule());
  }
  await run(["chown", "-R", `${TV_USER}:${TV_USER}`, join(TV_HOME, ".kodi")], 60_000);
  writeFileSync(UNIT_FILE, unitText());
  await run(["systemctl", "daemon-reload"], 30_000);
  // the buttons of Android remotes: read anew by devices already plugged in, no restart of anything
  if (text(TV_HWDB) !== hwdbText()) {
    mkdirSync("/etc/udev/hwdb.d", { recursive: true });
    writeFileSync(TV_HWDB, hwdbText());
    await run(["systemd-hwdb", "update"], 60_000);
    // udev is told to read the new table: a trigger right after the update was seen to go by the old one
    await run(["udevadm", "control", "--reload"], 30_000);
    await run(["udevadm", "trigger", "--subsystem-match=input", "--action=change"], 30_000);
    await run(["udevadm", "settle", "--timeout=10"], 15_000);
  }
  if (changed && (await unit("is-active")) === "active") await run(["systemctl", "restart", TV_UNIT], 60_000);
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

/**
 * The picture: the resolution, the refresh rate, whether the rate follows the film. A new mode is on
 * trial first — Kodi shows its own "keep it?" for a quarter of a minute and puts the old mode back
 * unless somebody says yes, on the screen or from the page (`keepPicture`), so a mode the TV cannot
 * show never stays. While it asks, its control port answers nobody.
 */
export async function setPicture(data: Record<string, unknown>, by: string): Promise<TvReport> {
  if (trial) throw new AppError("tv.asking", 409);
  const picture = await pictureChoice();
  if (!picture) throw new AppError("tv.notRunning", 409);
  if ("match" in data) {
    await rpc({ method: "Settings.SetSettingValue", params: { setting: "videoplayer.adjustrefreshrate", value: data.match === true ? MATCH_ON : MATCH_OFF } });
    record(data.match === true ? "tv.matchOn" : "tv.matchOff", { user: by });
    return tvReport();
  }
  const which = "resolution" in data ? "resolution" : "rate";
  const chosen = (picture[which].options as { label: string; value: unknown }[]).find((o) => o.value === data[which]);
  if (!chosen) throw new AppError("tv.badPicture", 400);
  if (chosen.value === picture[which].value) return tvReport();
  // the screen goes dark for a moment and a window covers it: not over a film somebody watches
  if ((await nowPlaying()).player !== null) throw new AppError("tv.picturePlaying", 409);
  const port = await eventPort();
  await tvReport();
  const label = which === "rate" ? chosen.label + " Hz" : chosen.label;
  const mine = { until: Date.now() + KEEP_SECONDS * 1000, port, done: rpc({ method: "Settings.SetSettingValue", params: { setting: which === "resolution" ? "videoscreen.resolution" : "videoscreen.screenmode", value: chosen.value } }, (KEEP_SECONDS + 10) * 1000) };
  trial = mine;
  void mine.done.then((kept) => {
    if (trial === mine) trial = null;
    if (kept === true) record("tv.picture", { user: by, detail: label });
    bus.publish("tv");
  });
  // a mode that needs no trial (Kodi did not ask) is done at once
  await Promise.race([mine.done, Bun.sleep(1200)]);
  return tvReport();
}

/** One of Kodi's settings of the page (`PREFS`) */
export async function setPref(id: unknown, value: unknown, by: string): Promise<TvReport> {
  if (trial) throw new AppError("tv.asking", 409);
  prefsKept = null;
  const { prefs } = await prefsChoice();
  if (Object.keys(prefs).length === 0) throw new AppError("tv.notRunning", 409);
  const next = typeof id === "string" ? prefValue(id, value, prefs) : undefined;
  if (next === undefined) throw new AppError("tv.badSetting", 400);
  await rpc({ method: "Settings.SetSettingValue", params: { setting: id as string, value: next } });
  prefsKept = null;
  record("tv.setting", { user: by, detail: id as string });
  return tvReport();
}

/** A packet for Kodi's event port: its own commands and presses, which the control port has no call for */
async function toEventPort(port: number, ...packets: Uint8Array[]): Promise<void> {
  const socket = createSocket("udp4");
  try {
    for (const packet of packets) await new Promise<void>((resolve) => socket.send(packet, port, "127.0.0.1", () => resolve()));
  } finally {
    socket.close();
  }
}

/** Kodi's event port, 0 when it is turned off there */
async function eventPort(): Promise<number> {
  const value = async (setting: string) => ((await rpc({ method: "Settings.GetSettingValue", params: { setting } })) as { value?: unknown } | null)?.value;
  return (await value("services.esenabled")) === true ? Number(await value("services.esport")) || 0 : 0;
}

let speaking: "" | "busy" | "failed" = "";

/**
 * The language Kodi speaks. Debian's package has English alone: another one is a pack Kodi fetches from
 * its own repository — asked for through the event port, its "install?" answered for the person — and
 * only then the setting is changed. Goes on in the background; the page sees `language.busy`.
 */
export async function setLanguage(lang: unknown, by: string): Promise<TvReport> {
  const addon = typeof lang === "string" ? TV_LANGUAGES[lang] : undefined;
  if (!addon) throw new AppError("tv.badSetting", 400);
  if (trial || speaking === "busy") throw new AppError("tv.asking", 409);
  if ((await rpc({ method: "JSONRPC.Ping" }, 2000)) !== "pong") throw new AppError("tv.notRunning", 409);
  // the whole screen is drawn anew in the other language: not over a film somebody watches
  if ((await nowPlaying()).player !== null) throw new AppError("tv.languagePlaying", 409);
  const there = async () => !!((await rpc({ method: "Addons.GetAddonDetails", params: { addonid: addon, properties: ["enabled"] } })) as { addon?: unknown } | null)?.addon;
  speaking = "busy";
  void (async () => {
    try {
      if (!(await there())) {
        const port = await eventPort();
        if (!port) throw new Error("no event port");
        await toEventPort(port, helloPacket(), builtinPacket(`InstallAddon(${addon})`));
        for (let i = 0; i < 60 && !(await there()); i++) {
          await Bun.sleep(1500);
          const shown = ((await rpc({ method: "GUI.GetProperties", params: { properties: ["currentwindow"] } })) as { currentwindow?: { id?: number } } | null)?.currentwindow?.id;
          if (shown === KEEP_WINDOW) await toEventPort(port, clickPacket(KEEP_WINDOW, KEEP_YES));
        }
        if (!(await there())) throw new Error("not installed");
      }
      await rpc({ method: "Settings.SetSettingValue", params: { setting: "locale.language", value: addon } }, 30_000);
      speaking = "";
      record("tv.language", { user: by, detail: lang as string });
    } catch {
      speaking = "failed";
    }
    prefsKept = null;
    bus.publish("tv");
  })();
  return tvReport();
}

/** The answer to Kodi's "keep it?", pressed for the person: its control port is deaf meanwhile, its event port is not */
export async function keepPicture(keep: boolean): Promise<TvReport> {
  const mine = trial;
  if (!mine) return tvReport();
  if (!mine.port) throw new AppError("tv.answerOnScreen", 409);
  await toEventPort(mine.port, helloPacket(), clickPacket(KEEP_WINDOW, keep ? KEEP_YES : KEEP_NO));
  const kept = await Promise.race([mine.done, Bun.sleep(5000).then(() => "late")]);
  if (kept === "late") throw new AppError("tv.answerOnScreen", 409);
  if (keep && kept !== true) throw new AppError("tv.notKept", 409);
  return tvReport();
}

/** The address last sent to the screen, with the subtitles given for it */
let sent: { link: string; subtitle: string } | null = null;

/** Gives the film that starts on the screen subtitles from an address of their own, once the player has it */
async function addSubtitle(link: string, subtitle: string): Promise<void> {
  for (let tries = 0; tries < 20; tries++) {
    await Bun.sleep(1000);
    if (sent?.link !== link) return;
    const { player, playing } = await nowPlaying();
    if (player === null || playing?.file !== link) continue;
    await rpc({ method: "Player.AddSubtitle", params: { playerid: player, subtitle } }, 8000);
    return;
  }
}

/** Plays a file of this server, or an address on the network, on the screen */
export async function playOnTv(raw: unknown, by: string, from?: unknown, subs?: unknown): Promise<void> {
  const link = typeof raw === "string" && !raw.startsWith("/");
  const path = link ? cleanLink(raw) : raw;
  if (link && !path) throw new AppError("tv.badLink", 400);
  const subtitle = link && subs ? cleanLink(subs) : "";
  if (subtitle === null) throw new AppError("tv.badLink", 400);
  if (typeof path !== "string" || (!link && !playable(path))) throw new AppError("tv.notPlayable", 400);
  let file = link;
  try {
    file ||= statSync(path).isFile();
  } catch {}
  if (!file) throw new AppError("tv.noFile", 404);
  if ((await rpc({ method: "JSONRPC.Ping" }, 2000)) !== "pong") throw new AppError("tv.notRunning", 409);
  // carried over from a browser: it goes on from where it was watched to
  const at = typeof from === "number" && Number.isFinite(from) && from >= 1 ? Math.floor(from) : 0;
  const resume = at ? { options: { resume: { hours: Math.floor(at / 3600), minutes: Math.floor((at % 3600) / 60), seconds: at % 60, milliseconds: 0 } } } : {};
  if ((await rpc({ method: "Player.Open", params: { item: { file: path }, ...resume } }, link ? 25_000 : 8000)) !== "OK") throw new AppError(link ? "tv.linkFailed" : "tv.playFailed", 409);
  sent = link ? { link: path, subtitle: subtitle ?? "" } : null;
  if (link && subtitle) void addSubtitle(path, subtitle).catch(() => {});
  record("tv.play", { user: by, detail: link ? linkName(path) : path });
  bus.publish("tv");
}

export interface TvNow extends Playing {
  /** When this was read: the page counts the seconds on from here while it plays */
  at: number;
}

let now: TvNow | null = null;
let watching = false;
/** Kodi is there and listened to */
let heard = false;

/** The player as every page shows it: whether it runs, and what plays (null — nothing) */
export const tvNow = (): { on: boolean; screen: boolean; streams: boolean; playing: TvNow | null } => ({ on: heard, screen: screenThere(), streams: streamsHere(), playing: now });

let screen = { at: 0, there: false };
/** A TV or monitor is plugged in and seen: looked at anew every ten seconds at most */
function screenThere(): boolean {
  if (Date.now() - screen.at > 10_000) screen = { at: Date.now(), there: displays().some((d) => d.connected) };
  return screen.there;
}

function tell(next: TvNow | null): void {
  const same = JSON.stringify(next && { ...next, at: 0, time: 0 }) === JSON.stringify(now && { ...now, at: 0, time: 0 });
  // the same film a little further on is news only when it jumped: the page counts the seconds itself
  const jumped = !!next && !!now && Math.abs(next.time - (now.time + (now.paused ? 0 : (next.at - now.at) / 1000))) > 3;
  now = next;
  if (!same || jumped) bus.publish("tv", tvNow());
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
    socket.once("connect", () => {
      heard = true;
      bus.publish("tv", tvNow());
      refresh();
    });
    socket.on("data", (piece) => {
      const taken = takeJson(buffer + piece.toString("utf8"));
      buffer = taken.rest.slice(-65536);
      if ((taken.values as { method?: unknown }[]).some((value) => typeof value?.method === "string" && value.method.startsWith("Player."))) refresh();
    });
    socket.once("error", () => {});
    socket.once("close", () => {
      const was = heard;
      heard = false;
      now = null;
      if (was) bus.publish("tv", tvNow());
      setTimeout(listen, was ? 3_000 : 10_000);
    });
  };
  listen();
}

/** A button of the page's remote */
export async function remote(action: unknown, value: unknown): Promise<void> {
  const { player } = typeof action === "string" && /^(playpause|stop|forward|rewind|seek|audio|subtitle)$/.test(action) ? await nowPlaying() : { player: null };
  let call = typeof action === "string" ? remoteCall(action, value, player) : null;
  if (!call) throw new AppError("tv.badAction", 400);
  // "Menu" is the menu of what is on the screen: over a film that is the player's own (sound, subtitles,
  // settings) — Kodi's context menu does nothing there — and a second press closes it
  if (action === "menu") {
    const shown = ((await rpc({ method: "GUI.GetProperties", params: { properties: ["currentwindow"] } })) as { currentwindow?: { id?: number } } | null)?.currentwindow?.id;
    if (shown === WINDOW_FULLSCREEN) call = { method: "Input.ShowOSD" };
    else if (shown === WINDOW_OSD) call = { method: "Input.Back" };
  }
  if ((await rpc(call)) === null && (await rpc({ method: "JSONRPC.Ping" }, 1500)) !== "pong") throw new AppError("tv.notRunning", 409);
}

// --- The browser's player: a file of this server made into what a browser plays, by ffmpeg ---------

const probed = new Map<string, Media>();

async function fileFor(path: unknown): Promise<string> {
  if (!streamsHere()) throw new AppError("tv.noStreams", 409);
  if (typeof path === "string" && !path.startsWith("/")) {
    const link = cleanLink(path);
    if (!link) throw new AppError("tv.badLink", 400);
    return link;
  }
  if (typeof path !== "string" || /[\0\n]/.test(path)) throw new AppError("tv.noFile", 404);
  let file = false;
  try {
    file = statSync(path).isFile();
  } catch {}
  if (!file) throw new AppError("tv.noFile", 404);
  return path;
}

/**
 * What a file holds — its length, sound tracks and subtitles — and, for a moment asked, where the
 * picture can really start (`start`, a keyframe) and where the clock of the stream from there begins (`zero`).
 */
async function held(path: string): Promise<Media> {
  const key = isLink(path) ? path : `${path}\n${statSync(path).mtimeMs}`;
  let media = probed.get(key);
  if (!media) {
    const said = await run(probeArgs(path), 30_000);
    if (said.code !== 0) throw new AppError(isLink(path) ? "tv.linkNotMedia" : "tv.notMedia", 409);
    media = mediaOf(JSON.parse(said.out || "{}"));
    if (isLink(path) && !media.video && !media.audio.length) throw new AppError("tv.linkNotMedia", 409);
    if (probed.size > 50) probed.clear();
    probed.set(key, media);
  }
  return media;
}

export async function mediaInfo(raw: unknown, at: number, subs?: unknown): Promise<Media & { start: string; zero: number }> {
  const path = await fileFor(raw);
  let media = await held(path);
  if (subs) {
    if (!cleanLink(subs)) throw new AppError("tv.badLink", 400);
    media = { ...media, subs: [...media.subs, { index: OUTSIDE_SUB, language: "", name: "", codec: "", text: true }] };
  }
  let start = "0";
  // a broadcast has no length and no earlier moment to go to
  if (at > 0.5 && media.video && media.duration > 0) {
    const found = (await run(keyframeArgs(path, at, media.video.n), 20_000)).out.split("\n").map((line) => line.trim().replace(/,+$/, "")).find((line) => cleanStart(line));
    start = found ?? at.toFixed(3);
  }
  // `zero` — the moment of the file the stream's own clock starts at
  return { ...media, start, zero: streamZero(start) };
}

/**
 * A program whose output is the answer: ended when the browser stops listening. A browser that went
 * away while nothing was being read was seen to leave the program waiting for ever on its full pipe,
 * so one nobody has read from for a minute is ended too — a player paused that long asks again.
 */
function piped(argv: string[], type: string, signal: AbortSignal): Response {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { PATH } });
  const end = () => proc.kill();
  signal.addEventListener("abort", end, { once: true });
  const reader = proc.stdout.getReader();
  let read = Date.now();
  let reading = false;
  const watch = setInterval(() => !reading && Date.now() - read > STREAM_IDLE_MS && end(), 10_000);
  void proc.exited.then(() => clearInterval(watch));
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        reading = true;
        const { done, value } = await reader.read();
        reading = false;
        read = Date.now();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: end,
    }),
    { headers: { "content-type": type, "cache-control": "no-store" } },
  );
}

const STREAM_IDLE_MS = 60_000;

/** The file from `start` on with one of its sound tracks, as a browser plays it */
export async function mediaStream(raw: unknown, start: unknown, audio: number, signal: AbortSignal): Promise<Response> {
  const path = await fileFor(raw);
  const from = cleanStart(start);
  if (from === null || !Number.isInteger(audio) || audio < 0 || audio > 99) throw new AppError("tv.badSetting", 400);
  return piped(streamArgs(path, from, audio, (await held(path)).video?.n ?? 0), "video/mp4", signal);
}

/** One of the file's subtitles from the same moment on */
export async function mediaSubs(raw: unknown, start: unknown, index: number, signal: AbortSignal, subs?: unknown): Promise<Response> {
  const path = await fileFor(raw);
  const from = cleanStart(start);
  if (index === OUTSIDE_SUB) {
    // subtitles of an address of their own: a whole small file, read from its start
    const link = cleanLink(subs);
    if (from === null || !link) throw new AppError("tv.badLink", 400);
    return piped(subsArgs(link, "0", 0), "text/vtt; charset=utf-8", signal);
  }
  if (from === null || !Number.isInteger(index) || index < 0 || index > 199) throw new AppError("tv.badSetting", 400);
  return piped(subsArgs(path, from, index), "text/vtt; charset=utf-8", signal);
}
