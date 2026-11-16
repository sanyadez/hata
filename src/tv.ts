/**
 * The media player on the server's own screen (the module "TV"): Kodi, run by Hata on the display
 * plugged into the server. This file is the pure part — what the system says about its screens, the
 * files Hata writes for Kodi, the remote's actions as Kodi's calls. What runs is `television.ts`.
 */

export const TV_USER = "hata-tv";
export const TV_HOME = "/var/lib/hata-tv";
export const TV_UNIT = "hata-tv.service";
/** Kodi's control port, moved from its usual 9090: that one is taken by other programs too often */
export const TV_PORT = 9391;
/** The console the player takes: the first ones stay the system's own */
export const TV_CONSOLE = 7;

export interface Display {
  /** HDMI-A-1, DP-1 */
  name: string;
  connected: boolean;
  /** The best mode it offers, 1920x1080 */
  mode: string;
  /** What the monitor calls itself */
  monitor: string;
  /** Whether it says it can play sound */
  audio: boolean;
}

/** The monitor's own name from its EDID: the descriptor of type 0xfc */
export function monitorName(edid: Uint8Array): string {
  for (let at = 54; at + 18 <= Math.min(edid.length, 126); at += 18) {
    if (edid[at] !== 0 || edid[at + 1] !== 0 || edid[at + 2] !== 0 || edid[at + 3] !== 0xfc) continue;
    return String.fromCharCode(...edid.subarray(at + 5, at + 18)).split("\n")[0]!.replace(/[^\x20-\x7e]/g, "").trim();
  }
  return "";
}

/** Whether the monitor announces sound: the "basic audio" bit of its CTA extension block */
export function monitorAudio(edid: Uint8Array): boolean {
  for (let at = 128; at + 128 <= edid.length; at += 128) if (edid[at] === 2 && (edid[at + 3]! & 0x40) !== 0) return true;
  return false;
}

/** One connector of /sys/class/drm: `card0-HDMI-A-1` with its `status`, `modes` and `edid` */
export function readDisplay(dir: string, status: string, modes: string, edid: Uint8Array): Display {
  return { name: dir.replace(/^card\d+-/, ""), connected: status.trim() === "connected", mode: modes.split("\n")[0]?.trim() ?? "", monitor: monitorName(edid), audio: monitorAudio(edid) };
}

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The name a folder goes by in Kodi: its last part */
export const folderName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** Kodi's list of places: the folders the person chose, offered for video, music and pictures alike */
export function sourcesXml(folders: string[]): string {
  const sources = folders.map((path) => `<source><name>${xml(folderName(path))}</name><path pathversion="1">${xml(path.replace(/\/+$/, "") + "/")}</path><allowsharing>true</allowsharing></source>`).join("");
  const kind = (name: string) => `<${name}><default pathversion="1"></default>${sources}</${name}>`;
  return `<!-- Written by Hata: changes made here are lost -->\n<sources>${["video", "music", "pictures"].map(kind).join("")}</sources>\n`;
}

const OURS = "<!-- Written by Hata";

/** Whether a file of Kodi's is Hata's to rewrite: one the person made by hand is left alone */
export const isOurs = (text: string): boolean => text === "" || text.startsWith(OURS);

/** Kodi's own settings file of Hata's: the port Hata reaches it by, and no "Exit" in its power menu */
export const advancedXml = (port: number): string => `${OURS}: the port Hata reaches Kodi by; the player is turned off in Hata, not from the sofa -->\n<advancedsettings version="1.0"><jsonrpc><tcpport>${port}</tcpport></jsonrpc><showexitbutton>false</showexitbutton></advancedsettings>\n`;

/**
 * The keys that would end the player straight away (Ctrl+End, the power and sleep buttons) do
 * nothing in Kodi. Kodi binds Ctrl+End on its home and sign-in windows, not globally, so those are
 * named too: a rule for "global" alone left it working (checked with a stand-in keyboard).
 */
export const keymapXml = (): string => `${OURS}: changes made here are lost -->
<keymap>
<global><keyboard><end mod="ctrl">noop</end><power>noop</power><sleep>noop</sleep></keyboard><remote><power>noop</power></remote></global>
<Home><keyboard><end mod="ctrl">noop</end></keyboard></Home>
<LoginScreen><keyboard><end mod="ctrl">noop</end></keyboard></LoginScreen>
</keymap>
`;

export const TV_POLKIT = "/etc/polkit-1/rules.d/49-hata-tv.rules";

/** Where the system lets whoever sits at the screen power it off, the player's user is told no */
export const polkitRule = (): string => `// Written by Hata: the media player on the screen never powers the server off, restarts it or puts it to sleep
polkit.addRule(function (action, subject) {
  if (subject.user == "${TV_USER}" && action.id.indexOf("org.freedesktop.login1.") == 0) return polkit.Result.NO;
});
`;

/** The port a hand-made advancedsettings.xml names for Kodi's control, when it does */
export function portIn(text: string): number | null {
  const port = Number(/<tcpport>\s*(\d{2,5})\s*<\/tcpport>/.exec(text)?.[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * The service: Kodi without a desktop, as its own user with a session of its own on a console of its
 * own — so the keyboard and the remote are the player's alone, and the system's consoles stay as they are.
 * It comes back whatever ends it ("Exit" in Kodi's own menu too): only Hata's switch turns the player off.
 */
export const unitText = (): string => `# Written by Hata: changes made here are lost
[Unit]
Description=Hata: the media player on this server's screen (Kodi)
After=systemd-user-sessions.service network-online.target sound.target
Conflicts=getty@tty${TV_CONSOLE}.service

[Service]
User=${TV_USER}
Group=${TV_USER}
SupplementaryGroups=video audio input render
PAMName=login
TTYPath=/dev/tty${TV_CONSOLE}
StandardInput=tty
StandardOutput=journal
StandardError=journal
Environment=HOME=${TV_HOME}
ExecStartPre=+/usr/bin/chvt ${TV_CONSOLE}
ExecStart=/usr/bin/kodi --standalone --windowing=gbm
ExecStopPost=+/usr/bin/chvt 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`;

export const TV_HWDB = "/etc/udev/hwdb.d/70-hata-tv.hwdb";

/**
 * Remotes made for Android boxes send "select" for OK and "menu" for the menu button; Kodi takes
 * neither (checked with a stand-in keyboard: Enter and Compose are what it obeys). The system is told
 * to read those two buttons as the keys the player knows, for every input device: a usual keyboard has
 * no such buttons. A remote's power button is another matter: the system takes it for the server's own
 * (every keyboard is a "power switch" to systemd) and would shut the server down from the sofa.
 */
export const hwdbText = (): string => `# Written by Hata: changes made here are lost
# Remotes made for Android boxes: OK ("select") acts as Enter, the menu button as the context menu key
evdev:input:b*
 KEYBOARD_KEY_c0041=enter
 KEYBOARD_KEY_c0040=compose

# The power and sleep buttons of keyboards and remotes plugged in over USB or Bluetooth do nothing:
# the system would power the whole server off for them. The server's own power button is not touched.
evdev:input:b0003*
 KEYBOARD_KEY_c0030=reserved
 KEYBOARD_KEY_c0032=reserved
 KEYBOARD_KEY_10081=reserved
 KEYBOARD_KEY_10082=reserved
 KEYBOARD_KEY_70066=reserved

evdev:input:b0005*
 KEYBOARD_KEY_c0030=reserved
 KEYBOARD_KEY_c0032=reserved
 KEYBOARD_KEY_10081=reserved
 KEYBOARD_KEY_10082=reserved
 KEYBOARD_KEY_70066=reserved
`;

/** The driver that lets the graphics card decode video, by who made the card (PCI vendor id) */
export function decodePackages(vendor: string): string[] {
  if (vendor === "0x8086") return ["intel-media-va-driver", "i965-va-driver"];
  if (vendor === "0x1002" || vendor === "0x10de") return ["mesa-va-drivers"];
  return [];
}

/** The values of a stream of JSON texts written one after another, and what is left unfinished */
export function takeJson(buffer: string): { values: unknown[]; rest: string } {
  const values: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let done = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") {
      if (depth++ === 0) start = i;
    } else if (ch === "}" || ch === "]") {
      if (--depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(buffer.slice(start, i + 1)));
        } catch {}
        done = i + 1;
        start = -1;
      }
    }
  }
  return { values, rest: buffer.slice(done) };
}

export interface Call {
  method: string;
  params?: Record<string, unknown>;
}

const key = (name: string): Call => ({ method: "Input." + name });

/** What the remote of the page can do, as Kodi's calls; `player` — the one playing, null when none is */
export function remoteCall(action: string, value: unknown, player: number | null): Call | null {
  const playing = (call: (id: number) => Call): Call | null => (player === null ? null : call(player));
  switch (action) {
    case "up": return key("Up");
    case "down": return key("Down");
    case "left": return key("Left");
    case "right": return key("Right");
    case "select": return key("Select");
    case "back": return key("Back");
    case "home": return key("Home");
    case "menu": return key("ContextMenu");
    case "info": return key("Info");
    case "osd": return key("ShowOSD");
    case "playpause": return playing((playerid) => ({ method: "Player.PlayPause", params: { playerid } }));
    case "stop": return playing((playerid) => ({ method: "Player.Stop", params: { playerid } }));
    case "forward": return playing((playerid) => ({ method: "Player.Seek", params: { playerid, value: { seconds: 30 } } }));
    case "rewind": return playing((playerid) => ({ method: "Player.Seek", params: { playerid, value: { seconds: -30 } } }));
    case "seek": {
      const percentage = Number(value);
      return Number.isFinite(percentage) ? playing((playerid) => ({ method: "Player.Seek", params: { playerid, value: { percentage: Math.min(100, Math.max(0, percentage)) } } })) : null;
    }
    case "volume": {
      const volume = Number(value);
      return Number.isFinite(volume) ? { method: "Application.SetVolume", params: { volume: Math.round(Math.min(100, Math.max(0, volume))) } } : null;
    }
    case "mute": return { method: "Application.SetMute", params: { mute: "toggle" } };
    case "audio": return Number.isInteger(value) && (value as number) >= 0 ? playing((playerid) => ({ method: "Player.SetAudioStream", params: { playerid, stream: value } })) : null;
    case "subtitle": {
      if (value === "off") return playing((playerid) => ({ method: "Player.SetSubtitle", params: { playerid, subtitle: "off" } }));
      return Number.isInteger(value) && (value as number) >= 0 ? playing((playerid) => ({ method: "Player.SetSubtitle", params: { playerid, subtitle: value, enable: true } })) : null;
    }
    // typed on a phone instead of picked letter by letter on the screen: goes into the field Kodi has open
    case "text": return typeof value === "string" && value.length > 0 && value.length <= 500 && !/[\x00-\x1f]/.test(value) ? { method: "Input.SendText", params: { text: value, done: true } } : null;
    default: return null;
  }
}

/** Kodi's `{ hours, minutes, seconds }` in seconds */
export const seconds = (time: unknown): number => {
  const t = (time ?? {}) as Record<string, unknown>;
  return (Number(t.hours) || 0) * 3600 + (Number(t.minutes) || 0) * 60 + (Number(t.seconds) || 0);
};

const RELEASE_TAG = /\b(2160p|1080p|1080i|720p|480p|4k|uhd|web[- ]?dl(rip)?|web[- ]?rip|bd[- ]?rip|br[- ]?rip|blu[- ]?ray|hd[- ]?tv|hd[- ]?rip|dvd[- ]?rip|remux|imax|x26[45]|h ?26[45]|hevc|avc|xvid|hdr|proper|repack|extended|unrated)\b/i;

/**
 * A film's name as a person would say it, from the name of its file: `Coyote.vs.Acme.(2026).WEB-DL.1080p.mkv`
 * is "Coyote vs Acme". What stands after the year or the first mark of a release is left out; an episode's
 * number stays. A name that is not a file's (Kodi's library gives real titles) comes back as it is.
 */
export function shortTitle(name: string): string {
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) return name.trim();
  let text = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[._]+/g, " ").replace(/^\s*\[[^\]]*\]\s*/, "");
  const episode = /\bS\d{1,2} ?E\d{1,3}\b/i.exec(text);
  if (episode) return text.slice(0, episode.index + episode[0].length).replace(/\s+/g, " ").trim();
  // a year that opens the name is part of it ("2001 A Space Odyssey"): the one meant comes later
  const year = [...text.matchAll(/[([]?\b(19|20)\d{2}\b[)\]]?/g)].find((found) => found.index > 0)?.index;
  const tag = RELEASE_TAG.exec(text)?.index;
  const cut = Math.min(year ?? Infinity, tag && tag > 0 ? tag : Infinity);
  if (Number.isFinite(cut)) text = text.slice(0, cut);
  return text.replace(/[\s\-–([]+$/, "").replace(/\s+/g, " ").trim() || name;
}

const PLAYABLE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|mpg|mpeg|wmv|flv|ogv|3gp|iso|mp3|flac|m4a|ogg|opus|wav|aac|wma|jpe?g|png|gif|webp|bmp|heic)$/i;

/** Whether a file is something a media player plays: video, music or a picture, by its name */
export const playable = (name: string): boolean => PLAYABLE.test(name);

/** The folders of the settings, made whole: absolute paths, each once, 30 at most */
export function cleanFolders(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const one of list) {
    if (typeof one !== "string" || !one.startsWith("/") || one.length > 1000 || /[\0\n]/.test(one)) continue;
    const path = one.length > 1 ? one.replace(/\/+$/, "") : one;
    if (!out.includes(path)) out.push(path);
  }
  return out.slice(0, 30);
}

/** Kodi's own window that asks whether a new screen mode is kept, and its two buttons */
export const KEEP_WINDOW = 10100;
export const KEEP_YES = 11;
export const KEEP_NO = 10;
/** How long Kodi waits for that answer before it puts the old mode back, seconds */
export const KEEP_SECONDS = 15;
/** Kodi's "adjust the display's refresh rate": off, and "when a film starts and when it stops" */
export const MATCH_OFF = 0;
export const MATCH_ON = 2;

export interface Choice<T> {
  value: T;
  options: { label: string; value: T }[];
}

export interface Picture {
  /** 1920×1080, 1280×720: Kodi's own list for the screen it draws on */
  resolution: Choice<number>;
  /** The refresh rates the chosen resolution has, in Hz */
  rate: Choice<string>;
  /** The screen's rate follows the film's while it plays */
  match: boolean;
}

/**
 * The picture's settings out of Kodi's own (`Settings.GetSettings` of system / display, and the value
 * of `videoplayer.adjustrefreshrate`); null when Kodi names no resolution to choose from.
 */
export function pictureOf(list: unknown, adjust: unknown): Picture | null {
  const all = (Array.isArray(list) ? list : []) as { id?: unknown; value?: unknown; options?: { label?: unknown; value?: unknown }[] }[];
  const options = (id: string) => all.find((one) => one?.id === id);
  const resolution = options("videoscreen.resolution");
  const mode = options("videoscreen.screenmode");
  const sizes = (resolution?.options ?? []).flatMap((o) => {
    const found = /^(\d+)x(\d+)([pi])/.exec(String(o.label).trim());
    return found && Number.isInteger(o.value) ? [{ label: `${found[1]}×${found[2]}${found[3] === "i" ? "i" : ""}`, value: o.value as number, area: Number(found[1]) * Number(found[2]) }] : [];
  });
  if (!resolution || sizes.length === 0) return null;
  const rates = (mode?.options ?? []).flatMap((o) => (typeof o.value === "string" && Number.isFinite(parseFloat(String(o.label))) ? [{ label: String(parseFloat(String(o.label))), value: o.value, hz: parseFloat(String(o.label)) }] : []));
  // Kodi names the screen's own rate "DESKTOP" until another is chosen, then by the mode's full name
  const current = typeof mode?.value === "string" ? mode.value : "";
  const rate = rates.find((o) => o.value === current) ?? rates.find((o) => current !== "DESKTOP" && Math.abs(o.hz - parseFloat(current.slice(11, 20))) < 0.005);
  return {
    resolution: { value: Number(resolution.value), options: sizes.sort((a, b) => b.area - a.area).map(({ label, value }) => ({ label, value })) },
    rate: { value: rate?.value ?? current, options: rates.sort((a, b) => b.hz - a.hz).map(({ label, value }) => ({ label, value })) },
    match: Number(adjust) !== MATCH_OFF,
  };
}

/**
 * A packet of Kodi's event port (UDP, this machine only): the one way to press a button of a window
 * Kodi waits in, because its control port answers nobody until that window is closed.
 */
export function eventPacket(type: number, payload: Uint8Array): Uint8Array {
  const packet = new Uint8Array(32 + payload.length);
  const view = new DataView(packet.buffer);
  packet.set([0x58, 0x42, 0x4d, 0x43, 2, 0]); // "XBMC", version 2.0
  view.setUint16(6, type);
  view.setUint32(8, 1); // this packet of
  view.setUint32(12, 1); // this many
  view.setUint16(16, payload.length);
  view.setUint32(18, 0x48617461); // who sends: "Hata"
  packet.set(payload, 32);
  return packet;
}

const bytes = (text: string): number[] => [...new TextEncoder().encode(text), 0];

/** The greeting Kodi's event port expects first */
export const helloPacket = (): Uint8Array => eventPacket(0x01, new Uint8Array([...bytes("Hata"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

/** One of Kodi's own commands ("built-in functions"), which its control port has no call for */
export const builtinPacket = (command: string): Uint8Array => eventPacket(0x0a, new Uint8Array([0x01, ...bytes(command)]));

/** A press of one button of one window */
export const clickPacket = (window: number, control: number): Uint8Array => builtinPacket(`SendClick(${window},${control})`);

/** A sound track or a subtitle of what plays, as the page lists it */
export interface Track {
  index: number;
  /** ukr, eng — as the file says */
  language: string;
  name: string;
  codec?: string;
  channels?: number;
}

export interface Tracks {
  audio: Track[];
  audioNow: number;
  subs: Track[];
  /** -1 — subtitles are off */
  subNow: number;
}

const track = (raw: unknown): Track[] => {
  const t = (raw ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(t.index)) return [];
  return [{ index: t.index as number, language: typeof t.language === "string" ? t.language.slice(0, 12) : "", name: typeof t.name === "string" ? t.name.replace(/[\x00-\x1f]/g, "").slice(0, 120) : "", ...(typeof t.codec === "string" && t.codec ? { codec: t.codec.slice(0, 20) } : {}), ...(Number.isInteger(t.channels) && (t.channels as number) > 0 ? { channels: t.channels as number } : {}) }];
};

/** The tracks of what plays, out of Kodi's `Player.GetProperties` */
export function tracksOf(props: Record<string, unknown> | null): Tracks {
  const list = (value: unknown) => (Array.isArray(value) ? value.flatMap(track) : []);
  const subs = list(props?.subtitles);
  return {
    audio: list(props?.audiostreams),
    audioNow: track(props?.currentaudiostream)[0]?.index ?? -1,
    subs,
    subNow: props?.subtitleenabled === true && subs.length > 0 ? (track(props?.currentsubtitle)[0]?.index ?? -1) : -1,
  };
}

/** Kodi's language packs for the languages Hata speaks */
export const TV_LANGUAGES: Record<string, string> = { en: "resource.language.en_gb", uk: "resource.language.uk_ua" };

/**
 * The settings of Kodi the page shows as they are. `list` — one of the values Kodi itself offers;
 * `fixed` — one of these; `flag` — on / off written as Kodi's two values.
 */
export const PREFS: Record<string, { kind: "list" } | { kind: "fixed"; values: (string | number)[] } | { kind: "flag"; on: unknown; off: unknown }> = {
  "locale.audiolanguage": { kind: "list" },
  "locale.subtitlelanguage": { kind: "list" },
  "audiooutput.channels": { kind: "list" },
  "audiooutput.passthrough": { kind: "flag", on: true, off: false },
  "audiooutput.guisoundmode": { kind: "flag", on: 1, off: 0 },
  "screensaver.mode": { kind: "fixed", values: ["", "screensaver.xbmc.builtin.dim", "screensaver.xbmc.builtin.black"] },
  "screensaver.time": { kind: "fixed", values: [1, 2, 3, 5, 10, 15, 30, 60] },
  // minutes of nothing happening before the picture's output is switched off, so that the TV or monitor goes to sleep; 0 — never
  "powermanagement.displaysoff": { kind: "fixed", values: [0, 5, 10, 15, 30, 60, 120] },
};

export interface Pref {
  value: string | number | boolean;
  options?: { label: string; value: string | number }[];
}

/** Those settings out of Kodi's own lists (`Settings.GetSettings`, several categories put together) */
export function prefsOf(list: unknown): Record<string, Pref> {
  const out: Record<string, Pref> = {};
  for (const one of (Array.isArray(list) ? list : []) as { id?: unknown; value?: unknown; options?: { label?: unknown; value?: unknown }[] }[]) {
    const spec = typeof one?.id === "string" ? PREFS[one.id] : undefined;
    if (!spec) continue;
    if (spec.kind === "flag") out[one.id as string] = { value: one.value === spec.on || (spec.on === 1 && Number(one.value) > 0) };
    else if (typeof one.value === "string" || typeof one.value === "number") {
      const options = spec.kind === "list" ? (one.options ?? []).flatMap((o) => (typeof o.value === "string" || typeof o.value === "number" ? [{ label: String(o.label).replace(/[\x00-\x1f]/g, "").trim(), value: o.value }] : [])) : undefined;
      out[one.id as string] = { value: one.value, ...(options ? { options } : {}) };
    }
  }
  return out;
}

/** What a setting is to be in Kodi for what the page asked; undefined — not a setting of the page's, or not one of its values */
export function prefValue(id: string, raw: unknown, now: Record<string, Pref>): unknown {
  const spec = PREFS[id];
  if (!spec || !now[id]) return undefined;
  if (spec.kind === "flag") return typeof raw === "boolean" ? (raw ? spec.on : spec.off) : undefined;
  if (spec.kind === "fixed") return spec.values.includes(raw as string | number) ? raw : undefined;
  return now[id]!.options?.some((o) => o.value === raw) ? raw : undefined;
}

/** An address on the network instead of a file of this server */
export const isLink = (path: string): boolean => /^https?:\/\//i.test(path);

/** An address a player may be sent to: http or https, whole, nothing a program could read as two arguments */
export function cleanLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 2000 || /[\s\x00-\x1f\x7f]/.test(text) || !isLink(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/** An address as the log and a title may show it: where it leads, without a sign-in or what follows the "?" (keys live there) */
export function linkName(link: string): string {
  try {
    const url = new URL(link);
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {}
    return (url.host + (path === "/" ? "" : path)).replace(/[\x00-\x1f]/g, "").slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * How the programs open a source. For an address: only the web's own protocols — a playlist from the
 * network may name anything, a file of this server too, and would be read without this — and an end
 * to waiting for a server that went silent.
 */
export const sourceArgs = (path: string): string[] => [...(isLink(path) ? ["-protocol_whitelist", "http,https,tcp,tls,crypto", "-rw_timeout", "20000000"] : []), "-i", path];

/** The number subtitles given by an address of their own go by among a source's subtitles */
export const OUTSIDE_SUB = 1000;

/** What a file holds, for the browser's player: read from `ffprobe -show_format -show_streams -show_programs` */
export interface Media {
  duration: number;
  /** `n` — which of the source's pictures: a stream from the network often carries the same film in several sizes, the largest is taken */
  video: { codec: string; width: number; height: number; n: number } | null;
  audio: Track[];
  /** `text` — written as text, so a browser can show it; pictures (discs' subtitles) it cannot */
  subs: (Track & { text: boolean })[];
}

const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);

export function mediaOf(probe: unknown): Media {
  const said = (probe ?? {}) as { format?: { duration?: unknown }; streams?: Record<string, unknown>[]; programs?: { streams?: Record<string, unknown>[] }[] };
  const streams = Array.isArray(said.streams) ? said.streams : [];
  // the programs count a stream among all of its kind, cover pictures too: "0:a:1" is the second sound whatever is shown
  const kind = (type: string) => streams.filter((one) => one?.codec_type === type).map((one, n) => ({ one, n }));
  const shown = (type: string) => kind(type).filter(({ one }) => (one.disposition as Record<string, unknown> | undefined)?.attached_pic !== 1);
  const size = (one: Record<string, unknown>) => (Number(one.width) || 0) * (Number(one.height) || 0);
  const picture = shown("video").reduce<{ one: Record<string, unknown>; n: number } | null>((best, next) => (!best || size(next.one) > size(best.one) ? next : best), null);
  // several sizes of one film come as programs, each with a sound of its own: the sound of the picture taken is the one offered
  const programs = Array.isArray(said.programs) ? said.programs.map((program) => new Set((program?.streams ?? []).map((one) => one?.index))) : [];
  const mine = picture ? programs.find((program) => program.has(picture.one.index)) : undefined;
  const beside = (type: string) => {
    const all = shown(type);
    const own = mine && programs.length > 1 ? all.filter(({ one }) => mine.has(one.index)) : [];
    return own.length ? own : all;
  };
  const named = (one: Record<string, unknown>, index: number): Track => {
    const tags = (one.tags ?? {}) as Record<string, unknown>;
    const tag = (name: string) => String(tags[name] ?? tags[name.toUpperCase()] ?? "").replace(/[\x00-\x1f]/g, "");
    return { index, language: tag("language").slice(0, 12), name: tag("title").slice(0, 120), codec: String(one.codec_name ?? "").slice(0, 20), ...(Number(one.channels) > 0 ? { channels: Number(one.channels) } : {}) };
  };
  return {
    duration: Number(said.format?.duration) || 0,
    video: picture ? { codec: String(picture.one.codec_name ?? ""), width: Number(picture.one.width) || 0, height: Number(picture.one.height) || 0, n: picture.n } : null,
    audio: beside("audio").map(({ one, n }) => named(one, n)),
    subs: beside("subtitle").map(({ one, n }) => ({ ...named(one, n), text: TEXT_SUBS.has(String(one.codec_name)) })),
  };
}

/** Asks where the picture can start at or before a moment: a copied video starts only at a whole frame of its own */
export const keyframeArgs = (path: string, at: number, video = 0): string[] => ["ffprobe", "-v", "error", "-select_streams", `v:${video}`, "-read_intervals", `${at.toFixed(3)}%+#1`, "-show_entries", "packet=pts_time", "-of", "csv=p=0", ...sourceArgs(path)];

/** Asks what a source holds */
export const probeArgs = (path: string): string[] => ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_programs", ...sourceArgs(path)];

/**
 * How much earlier than its picture a stream's sound begins, seconds: silence, so that the sound has
 * no hole at its start (a browser plays sound back to back and would run it ahead by the hole) and the
 * stream's clock is known — its zero is this long before the keyframe it starts with.
 */
export const STREAM_LEAD = 0.25;
/** ffmpeg looks for a keyframe a little before the moment asked: asked this much after one, it lands on it */
const PAST_KEYFRAME = 0.14;

/**
 * The file as a browser plays it, from the keyframe at `start` on: the picture as it is, the chosen
 * sound made into stereo AAC (browsers play neither AC3 nor DTS), in pieces a browser plays while
 * they still come. The sound is cut exactly and padded back with silence to `STREAM_LEAD` before the
 * picture: found live — without that the picture began up to a whole gap between keyframes earlier
 * than the page counted, and the sound ran ahead.
 */
export function streamArgs(path: string, start: string, audio: number, video = 0): string[] {
  const from = Number(start);
  const seek = from > 0 ? ["-ss", (from + PAST_KEYFRAME).toFixed(3)] : [];
  const lead = Math.round(((from > 0 ? PAST_KEYFRAME : 0) + STREAM_LEAD) * 48000);
  return ["ffmpeg", "-v", "error", "-nostdin", ...seek, ...sourceArgs(path), "-map", `0:v:${video}`, "-map", `0:a:${audio}?`, "-c:v", "copy", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k", "-af", `aresample=async=1:first_pts=-${lead}`, "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"];
}

/**
 * Where the clock of such a stream stands at its first moment, as a moment of the file: the silence
 * before the keyframe, and the 1024 samples the AAC encoder puts in front of everything (measured).
 */
export const streamZero = (start: string): number => Number(start) - STREAM_LEAD - 1024 / 48000;

/**
 * One subtitle of the file from about that moment on, in the text format browsers know, WITH THE
 * FILE'S OWN TIMES (`-copyts`): left to itself ffmpeg counts them from the first line it happens to
 * find, so the page places each line by the stream's clock itself.
 */
export const subsArgs = (path: string, start: string, index: number): string[] => ["ffmpeg", "-v", "error", "-nostdin", ...(Number(start) > 5 ? ["-ss", (Number(start) - 5).toFixed(3)] : []), "-copyts", ...sourceArgs(path), "-map", `0:s:${index}`, "-f", "webvtt", "pipe:1"];

/** A moment of a file as the programs take it: seconds with a fraction, nothing else */
export const cleanStart = (raw: unknown): string | null => (typeof raw === "string" && /^\d{1,6}(\.\d{1,6})?$/.test(raw) ? raw : null);
