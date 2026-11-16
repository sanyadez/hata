/**
 * Music on the server's own speakers: a second player next to the TV's, without a screen — mpv in a
 * service of its own (`hata-music.service`), told what to do over its socket. It has an output of its
 * own, so the TV may play a film by HDMI while this one plays to a speaker. `sound.ts` is the part
 * without side effects.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { record } from "./activity";
import { AppError } from "./apps";
import { speakers } from "./bluetooth";
import { bus } from "./bus";
import { saveSettings, settings } from "./config";
import { installCommand, PATH, run } from "./packages";
import { cleanLink, MUSIC_SOCKET, MUSIC_UNIT, MUSIC_USER, musicCommand, musicUnit, nameOf, nowOf, outputFor, outputsOf, parseCards, queueOf, takeLines, type NowPlaying, type Output, type Pcm, type QueueItem } from "./sound";

const UNIT_FILE = `/etc/systemd/system/${MUSIC_UNIT}`;

export const musicInstalled = (): boolean => !!Bun.which("mpv", { PATH });

const text = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/** Where sound can go right now: the cards' own outputs and the Bluetooth speakers that are connected */
export async function soundOutputs(): Promise<Output[]> {
  const cards = parseCards(text("/proc/asound/cards"));
  const pcms: Pcm[] = [];
  for (const card of cards) {
    let names: string[] = [];
    try {
      names = readdirSync(`/proc/asound/card${card.index}`);
    } catch {}
    for (const name of names) {
      const m = /^pcm(\d+)p$/.exec(name);
      if (m) pcms.push({ card: card.index, device: Number(m[1]), name: /^name:\s*(.+)$/m.exec(text(`/proc/asound/card${card.index}/${name}/info`))?.[1]?.trim() ?? "" });
    }
  }
  return outputsOf(cards, pcms, await speakers().catch(() => []));
}

let sock: Socket | null = null;
let linking: Promise<boolean> | null = null;
let kept = "";
let asked = 0;
const waiting = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let tellTimer: ReturnType<typeof setTimeout> | null = null;

function changed(): void {
  tellTimer ??= setTimeout(() => {
    tellTimer = null;
    bus.publish("music");
  }, 500);
}

function heard(chunk: Buffer): void {
  const got = takeLines(kept + chunk.toString("utf8"));
  kept = got.rest;
  for (const message of got.messages) {
    if (typeof message.request_id === "number") {
      const one = waiting.get(message.request_id);
      if (!one) continue;
      waiting.delete(message.request_id);
      clearTimeout(one.timer);
      if (message.error === "success") one.resolve(message.data);
      else one.reject(new Error(String(message.error)));
    } else if (message.event) changed();
  }
}

/** Says a thing to mpv and gives what it answered */
function command(cmd: unknown[], timeout = 4000): Promise<unknown> {
  return new Promise((done, fail) => {
    if (!sock) return fail(new Error("the player does not run"));
    const id = ++asked;
    const timer = setTimeout(() => {
      waiting.delete(id);
      fail(new Error("the player does not answer"));
    }, timeout);
    waiting.set(id, { resolve: done, reject: fail, timer });
    sock.write(JSON.stringify({ command: cmd, request_id: id }) + "\n");
  });
}

const get = (name: string): Promise<unknown> => command(["get_property", name]).catch(() => null);

// what the page shows: a change of any of these is told to it
const WATCHED = ["pause", "playlist-pos", "playlist-count", "media-title", "metadata", "idle-active", "volume", "mute", "audio-device"];

/** The connection to the player, made when it runs; false — it does not */
function link(): Promise<boolean> {
  if (sock) return Promise.resolve(true);
  if (!existsSync(MUSIC_SOCKET)) return Promise.resolve(false);
  linking ??= new Promise<boolean>((done) => {
    const one = createConnection({ path: MUSIC_SOCKET });
    one.once("error", () => done(false));
    one.once("connect", () => {
      sock = one;
      kept = "";
      one.on("data", heard);
      one.on("error", () => {});
      one.on("close", () => {
        if (sock !== one) return;
        sock = null;
        for (const w of waiting.values()) {
          clearTimeout(w.timer);
          w.reject(new Error("the player stopped"));
        }
        waiting.clear();
        changed();
      });
      WATCHED.forEach((name, i) => void command(["observe_property", i + 1, name]).catch(() => {}));
      done(true);
    });
  }).finally(() => {
    linking = null;
  });
  return linking;
}

export interface MusicReport {
  /** missing — mpv is not installed */
  state: "missing" | "ready";
  install: string;
  /** The player's service runs (it is started by the first thing played) */
  running: boolean;
  now: NowPlaying | null;
  queue: QueueItem[];
  volume: number;
  muted: boolean;
  /** Where the sound goes: an id of `outputs`; "" — this server has nothing that plays sound */
  output: string;
  outputs: Output[];
}

export async function musicReport(): Promise<MusicReport> {
  const outputs = await soundOutputs();
  const base: MusicReport = { state: musicInstalled() ? "ready" : "missing", install: installCommand("mpv"), running: false, now: null, queue: [], volume: settings.music.volume, muted: false, output: outputFor(settings.music.output, outputs), outputs };
  if (base.state === "missing" || !(await link())) return base;
  const [idle, path, title, metadata, position, duration, paused, playlist, volume, muted] = await Promise.all(["idle-active", "path", "media-title", "metadata", "time-pos", "duration", "pause", "playlist", "volume", "mute"].map(get));
  return { ...base, running: true, now: nowOf({ idle, path, title, metadata, position, duration, paused }), queue: queueOf(playlist), volume: typeof volume === "number" ? Math.round(volume) : base.volume, muted: muted === true };
}

/** What the head of the page shows while music plays; null — nothing does */
export async function musicNow(): Promise<{ title: string; paused: boolean } | null> {
  if (!sock) return null;
  const [idle, path, title, metadata, paused] = await Promise.all(["idle-active", "path", "media-title", "metadata", "pause"].map(get));
  const now = nowOf({ idle, path, title, metadata, position: 0, duration: 0, paused });
  return now && { title: now.title, paused: now.paused };
}

/** The player's user and its service; started, and the sound sent where the person chose */
async function ensure(): Promise<void> {
  if (!musicInstalled()) throw new AppError("music.missing", 409);
  if (await link()) return;
  if ((await run(["id", MUSIC_USER], 10_000)).code !== 0) {
    const made = await run(["useradd", "--system", "--no-create-home", "--shell", "/usr/sbin/nologin", "--groups", "audio", MUSIC_USER], 30_000);
    if (made.code !== 0) throw new AppError("music.setupFailed", 409, { message: (made.err || made.out).trim() });
  }
  if (text(UNIT_FILE) !== musicUnit()) {
    writeFileSync(UNIT_FILE, musicUnit());
    await run(["systemctl", "daemon-reload"], 30_000);
  }
  const started = await run(["systemctl", "start", MUSIC_UNIT], 30_000);
  if (started.code !== 0) throw new AppError("music.setupFailed", 409, { message: (started.err || started.out).trim().split("\n").pop() ?? "" });
  for (let i = 0; i < 25 && !(await link()); i++) await Bun.sleep(200);
  if (!sock) throw new AppError("music.setupFailed", 409, { message: "the player did not come up" });
  const output = outputFor(settings.music.output, await soundOutputs());
  if (output) await command(["set_property", "audio-device", "alsa/" + output]).catch(() => {});
  await command(["set_property", "volume", settings.music.volume]).catch(() => {});
}

/**
 * Plays a file, a whole folder (everything in it that is sound, the folders inside too) or a link —
 * at once, or after what is in the queue (`add`).
 */
export async function playMusic(raw: { path?: unknown; url?: unknown; add?: unknown }, by: string): Promise<MusicReport> {
  let what = "";
  if (raw.url !== undefined) {
    what = cleanLink(raw.url);
    if (!what) throw new AppError("music.badLink", 400);
  } else {
    if (typeof raw.path !== "string" || !raw.path.startsWith("/")) throw new AppError("music.notFound", 404);
    what = resolve(raw.path);
    if (!existsSync(what)) throw new AppError("music.notFound", 404);
  }
  await ensure();
  const add = raw.add === true && (await get("idle-active")) === false;
  await command(["loadfile", what, add ? "append" : "replace"]).catch((e) => {
    throw new AppError("music.playFailed", 409, { message: e instanceof Error ? e.message : String(e) });
  });
  if (!add) {
    await command(["set_property", "pause", false]).catch(() => {});
    // a file that cannot be read or is not sound ends at once; an output that is taken gives no sound
    let playing = false;
    for (let i = 0; i < 20 && !playing; i++) {
      await Bun.sleep(250);
      playing = (await get("idle-active")) === false && (await get("current-ao")) !== null;
    }
    if (!playing) {
      const idle = (await get("idle-active")) !== false;
      if (!idle) await command(["stop"]).catch(() => {});
      const folder = raw.url === undefined && statSync(what, { throwIfNoEntry: false })?.isDirectory();
      throw new AppError(idle ? (raw.url !== undefined ? "music.linkFailed" : folder ? "music.nothingToPlay" : "music.playFailed") : "music.outputFailed", 409, { message: "" });
    }
  }
  record(add ? "music.queued" : "music.play", { user: by, detail: raw.url !== undefined ? nameOf(what) : what });
  changed();
  return musicReport();
}

/** A button of the player */
export async function musicDo(action: unknown, value: unknown): Promise<MusicReport> {
  if (!(await link())) throw new AppError("music.notRunning", 409);
  const count = Number(await get("playlist-count")) || 0;
  const cmd = musicCommand(action, value, count);
  if (!cmd) throw new AppError("music.badAction", 400);
  await command(cmd).catch(() => {});
  if (action === "volume" && typeof value === "number") {
    settings.music.volume = Math.round(value);
    saveSettings();
  }
  return musicReport();
}

/** Sends the music to another output; what plays goes on there */
export async function setMusicOutput(id: unknown, by: string): Promise<MusicReport> {
  const outputs = await soundOutputs();
  const output = outputs.find((one) => one.id === id);
  if (!output) throw new AppError("music.badOutput", 400);
  settings.music.output = output.id;
  saveSettings();
  if (await link()) {
    await command(["set_property", "audio-device", "alsa/" + output.id]).catch(() => {});
    // the player opens the new output when it has something to play: said at once when it cannot
    if ((await get("idle-active")) === false && (await get("pause")) === false) {
      await Bun.sleep(1200);
      if ((await get("current-ao")) === null) throw new AppError("music.outputFailed", 409, { message: "" });
    }
  }
  record("music.output", { user: by, detail: output.name });
  changed();
  return musicReport();
}

/** The module is turned off: the player goes with it */
export function stopMusic(): void {
  if (existsSync(UNIT_FILE)) void run(["systemctl", "stop", MUSIC_UNIT], 30_000).catch(() => {});
}

/** The module's work: a player that already runs (Hata was restarted under it) is listened to again */
export function startMusic(): void {
  void link().catch(() => {});
  setInterval(() => void link().catch(() => {}), 30_000);
}
