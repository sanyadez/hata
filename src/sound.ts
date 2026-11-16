/**
 * Where sound can go on this server and the music player's side of talking to mpv — the part with no
 * side effects. An output is an ALSA device: the jack, a USB speaker, an HDMI port, a Bluetooth
 * speaker (through bluez-alsa).
 */

export interface Card {
  index: number;
  /** The kernel's short name of the card, as ALSA devices are addressed: `PCH`, `Device_1` */
  id: string;
  name: string;
  usb: boolean;
}

/** The cards of `/proc/asound/cards` */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+\[(\S+)\s*\]:\s*(\S+)\s+-\s+(.+)$/.exec(line);
    if (m) out.push({ index: Number(m[1]), id: m[2]!, name: m[4]!.trim(), usb: /^USB/i.test(m[3]!) });
  }
  return out;
}

/** A device of a card that plays: `pcm3p` of `/proc/asound/card1` with the `name:` of its `info` */
export interface Pcm {
  card: number;
  device: number;
  name: string;
}

export type OutputKind = "analog" | "usb" | "hdmi" | "digital" | "bluetooth";

export interface Output {
  /** The ALSA device, as mpv is told it after `alsa/` */
  id: string;
  kind: OutputKind;
  name: string;
}

const ORDER: OutputKind[] = ["bluetooth", "usb", "analog", "digital", "hdmi"];

/** The outputs a person would name: what plays, the nearest to a speaker first */
export function outputsOf(cards: Card[], pcms: Pcm[], speakers: { address: string; name: string }[]): Output[] {
  const out: Output[] = speakers.map((one) => ({ id: `bluealsa:DEV=${one.address},PROFILE=a2dp`, kind: "bluetooth" as const, name: one.name || one.address }));
  for (const pcm of pcms) {
    const card = cards.find((one) => one.index === pcm.card);
    if (!card) continue;
    const kind: OutputKind = /hdmi|displayport/i.test(pcm.name) ? "hdmi" : /digital|s\/?pdif|iec958/i.test(pcm.name) ? "digital" : card.usb ? "usb" : "analog";
    out.push({ id: `plughw:CARD=${card.id},DEV=${pcm.device}`, kind, name: kind === "hdmi" ? pcm.name : card.name });
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}

/** The output to play to: the chosen one while it is there, else the first that is not the TV's */
export function outputFor(chosen: string, outputs: Output[]): string {
  if (outputs.some((one) => one.id === chosen)) return chosen;
  return (outputs.find((one) => one.kind !== "hdmi") ?? outputs[0])?.id ?? "";
}

export const MUSIC_USER = "hata-music";
export const MUSIC_UNIT = "hata-music.service";
export const MUSIC_SOCKET = "/run/hata-music/mpv.sock";

/**
 * The player's service: mpv without a window, waiting for what to play. It reads no settings of its
 * own, runs no scripts and fetches nothing by itself; a playlist from the network cannot name a file
 * of this server (mpv's own rule).
 */
export function musicUnit(): string {
  const args = ["--no-config", "--idle=yes", "--no-video", "--no-terminal", "--audio-display=no", "--ytdl=no", "--load-scripts=no", "--input-default-bindings=no", "--input-terminal=no", "--volume-max=100", "--gapless-audio=weak", "--directory-mode=recursive", "--directory-filter-types=audio,video,playlist", `--input-ipc-server=${MUSIC_SOCKET}`];
  return `# Written by Hata: changes made here are lost
[Unit]
Description=Hata music player
After=sound.target bluealsa.service

[Service]
User=${MUSIC_USER}
SupplementaryGroups=audio
RuntimeDirectory=hata-music
ExecStart=/usr/bin/mpv ${args.join(" ")}
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
`;
}

export const SPEAKER_UNIT = "hata-speaker.service";

/** The name the speaker goes by in Music Assistant: letters, digits, spaces and a few signs; "" — not a name */
export function cleanSpeakerName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return /^[\p{L}\p{N} ._-]{1,40}$/u.test(name) ? name : "";
}

/** The address of the server a speaker goes to, `host[:port]`; "" — it finds one by itself; null — not an address */
export function cleanSpeakerServer(raw: unknown): string | null {
  const server = typeof raw === "string" ? raw.trim() : "";
  if (!server) return "";
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(server);
  return m && (!m[2] || (Number(m[2]) > 0 && Number(m[2]) < 65536)) ? server : null;
}

/**
 * The service that makes this server's speakers a player of Music Assistant (or of a Lyrion server):
 * Squeezelite on the output chosen for music. It lets the output go a few seconds after it falls
 * silent, so Hata's own player can have it then.
 */
export function speakerUnit(name: string, output: string, server: string): string {
  const args = ["-n", `"${name}"`, "-o", output, "-C", "5", ...(server ? ["-s", server] : [])];
  return `# Written by Hata: changes made here are lost
[Unit]
Description=Hata speaker for Music Assistant
After=network-online.target sound.target bluealsa.service
Wants=network-online.target

[Service]
User=${MUSIC_USER}
SupplementaryGroups=audio
ExecStart=/usr/bin/squeezelite ${args.join(" ")}
Restart=always
RestartSec=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
`;
}

/** Whole lines of what mpv has sent so far, as values, and what is left for the next piece */
export function takeLines(kept: string): { messages: Record<string, unknown>[]; rest: string } {
  const lines = kept.split("\n");
  const rest = lines.pop() ?? "";
  const messages: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") messages.push(value);
    } catch {
      // a line that is not a value is nothing to act on
    }
  }
  return { messages, rest };
}

/** What a link to play may be: the web, nothing else */
export function cleanLink(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2000) return "";
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const isLink = (path: string): boolean => /^https?:\/\//i.test(path);

/** How an entry of the queue is called when the file itself says nothing: its name without the ending, a link's host */
export function nameOf(path: string): string {
  if (isLink(path)) {
    try {
      const url = new URL(path);
      return url.host + (url.pathname.length > 1 ? url.pathname : "");
    } catch {
      return path;
    }
  }
  return (path.split("/").pop() ?? path).replace(/\.[a-z0-9]{2,5}$/i, "");
}

export interface QueueItem {
  title: string;
  /** The folder a file lies in; "" for a link */
  where: string;
  link: boolean;
  current: boolean;
}

/** mpv's playlist as the page lists it */
export function queueOf(playlist: unknown): QueueItem[] {
  if (!Array.isArray(playlist)) return [];
  return playlist.map((one) => {
    const item = (one ?? {}) as { filename?: unknown; title?: unknown; current?: unknown; playing?: unknown };
    const path = typeof item.filename === "string" ? item.filename : "";
    const link = isLink(path);
    return { title: (typeof item.title === "string" && item.title.trim()) || nameOf(path), where: link ? "" : path.split("/").slice(0, -1).join("/"), link, current: item.current === true || item.playing === true };
  });
}

export interface NowPlaying {
  title: string;
  /** The artist and the album, or what a radio station says it plays */
  by: string;
  link: boolean;
  position: number;
  /** 0 — not known (a broadcast) */
  duration: number;
  paused: boolean;
}

const tag = (tags: unknown, ...names: string[]): string => {
  if (!tags || typeof tags !== "object") return "";
  const all = Object.entries(tags as Record<string, unknown>);
  for (const name of names) {
    const found = all.find(([key, value]) => key.toLowerCase() === name && typeof value === "string" && value.trim());
    if (found) return String(found[1]).trim();
  }
  return "";
};

/** What plays, from mpv's properties; null — nothing does */
export function nowOf(props: { idle: unknown; path: unknown; title: unknown; metadata: unknown; position: unknown; duration: unknown; paused: unknown }): NowPlaying | null {
  if (props.idle === true || typeof props.path !== "string" || !props.path) return null;
  const link = isLink(props.path);
  const said = tag(props.metadata, "title");
  // a station says the song in `icy-title` and its own name in `icy-name`
  const song = tag(props.metadata, "icy-title");
  const station = tag(props.metadata, "icy-name");
  const title = song || said || (typeof props.title === "string" && props.title && !isLink(props.title) ? props.title.replace(/\.[a-z0-9]{2,5}$/i, "") : nameOf(props.path));
  const by = song ? station : [tag(props.metadata, "artist", "album_artist"), tag(props.metadata, "album")].filter(Boolean).join(" · ");
  const number = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);
  // a broadcast has no length: what the player calls one is only how much of it has arrived
  const live = link && (song !== "" || station !== "");
  return { title, by: by || (link && !song ? station : ""), link, position: number(props.position), duration: live ? 0 : number(props.duration), paused: props.paused === true };
}

/** The buttons of the player as mpv's commands; null — not a button */
export function musicCommand(action: unknown, value: unknown, count: number): unknown[] | null {
  const n = typeof value === "number" && isFinite(value) ? value : NaN;
  const index = Number.isInteger(n) && n >= 0 && n < count ? n : -1;
  switch (action) {
    case "playpause":
      return ["cycle", "pause"];
    case "stop":
      return ["stop"];
    case "next":
      return ["playlist-next", "weak"];
    case "previous":
      return ["playlist-prev", "weak"];
    case "seek":
      return n >= 0 ? ["seek", Math.floor(n), "absolute"] : null;
    case "volume":
      return n >= 0 && n <= 100 ? ["set_property", "volume", Math.round(n)] : null;
    case "mute":
      return ["set_property", "mute", value === true];
    case "jump":
      return index >= 0 ? ["set_property", "playlist-pos", index] : null;
    case "remove":
      return index >= 0 ? ["playlist-remove", index] : null;
    case "clear":
      return ["playlist-clear"];
    case "shuffle":
      return ["playlist-shuffle"];
    default:
      return null;
  }
}
