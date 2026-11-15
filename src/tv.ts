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
    default: return null;
  }
}

/** Kodi's `{ hours, minutes, seconds }` in seconds */
export const seconds = (time: unknown): number => {
  const t = (time ?? {}) as Record<string, unknown>;
  return (Number(t.hours) || 0) * 3600 + (Number(t.minutes) || 0) * 60 + (Number(t.seconds) || 0);
};

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
