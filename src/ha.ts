/**
 * Home Assistant as Hata sees it (pure): the address as typed, what an entity's state means for a tile,
 * which of Home Assistant's services a press on a tile calls, the updates it offers and what is worth
 * the person's attention. The connection itself is in `homeassistant.ts`.
 */
import type { AttentionItem } from "./attention";

/** `light.kitchen`, `sensor.outside_temperature` */
export const ENTITY_RE = /^[a-z0-9_]{1,64}\.[a-z0-9_]{1,200}$/;
/** A long-lived access token is a JWT */
export const TOKEN_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
/** Silent for longer than this, a server is worth a line on the home page */
export const AWAY_MS = 5 * 60_000;
/** A battery at or below this many percent wants changing */
export const BATTERY_LOW = 20;

/**
 * The address of Home Assistant as typed — `192.168.1.5`, `homeassistant.local:8123`, `https://ha.example.com`
 * — as the origin its API is reached at. Without a scheme it is plain HTTP on 8123, as Home Assistant comes.
 */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/\/+$/, "");
  if (!text || /\s/.test(text)) return null;
  const bare = !/^[a-z]+:\/\//i.test(text);
  if (bare) text = "http://" + text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search) return null;
  if (bare && !url.port) url.port = "8123";
  return url.origin;
}

/** One entity's state as Home Assistant sends it */
export interface RawState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

/** What a tile is told about an entity */
export interface Shown {
  id: string;
  name: string;
  domain: string;
  state: string;
  /** The unit of a measurement; "" — none */
  unit: string;
  /** Home Assistant's device class: `temperature`, `door`, `motion`… */
  kind: string;
  area: string;
  /** What a press can do: `toggle`, `brightness`, `open`… — see `serviceOf` */
  actions: string[];
  /** A light's brightness, 0–100, while it is on */
  brightness?: number;
  /** A thermostat's: the temperature asked for, the one measured, the range and the step */
  target?: number;
  current?: number;
  min?: number;
  max?: number;
  step?: number;
  /** When the state last changed */
  at: number;
  /** A config or diagnostic entity, or one hidden in Home Assistant: listed apart */
  extra?: true;
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const feature = (attrs: Record<string, unknown>, bit: number) => ((num(attrs.supported_features) ?? 0) & bit) !== 0;

/** Domains a press switches on and off */
const TOGGLES = new Set(["switch", "input_boolean", "fan", "siren", "humidifier", "automation"]);

/** What can be done to an entity from a tile: only what is plainly one press, or one number */
export function actionsOf(raw: RawState): string[] {
  const domain = raw.entity_id.split(".")[0]!;
  const a = raw.attributes;
  if (TOGGLES.has(domain)) return ["toggle"];
  if (domain === "light") {
    const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
    return modes.some((m) => m !== "onoff") ? ["toggle", "brightness"] : ["toggle"];
  }
  // cover and valve: OPEN 1, CLOSE 2, STOP 8
  if (domain === "cover" || domain === "valve") return [feature(a, 1) && "open", feature(a, 2) && "close", feature(a, 8) && "stop"].filter((x): x is string => !!x);
  if (domain === "lock") return ["lock", "unlock"];
  if (domain === "scene" || domain === "script") return ["run"];
  if (domain === "button" || domain === "input_button") return ["press"];
  // climate: TARGET_TEMPERATURE 1 — one number asked for; a range (heat and cool) is not one press
  if (domain === "climate") return feature(a, 1) && num(a.temperature) !== undefined ? ["temperature"] : [];
  // media player: PAUSE 1, TURN_ON 128, TURN_OFF 256, PLAY 16384
  if (domain === "media_player") return [feature(a, 128) && feature(a, 256) && "toggle", feature(a, 1) && feature(a, 16384) && "playPause"].filter((x): x is string => !!x);
  // vacuum: START 8192, RETURN_HOME 16
  if (domain === "vacuum") return [feature(a, 8192) && "start", feature(a, 16) && "dock"].filter((x): x is string => !!x);
  return [];
}

export function show(raw: RawState, area = ""): Shown {
  const domain = raw.entity_id.split(".")[0]!;
  const a = raw.attributes;
  const out: Shown = {
    id: raw.entity_id,
    name: str(a.friendly_name) || raw.entity_id,
    domain,
    state: raw.state,
    unit: str(a.unit_of_measurement),
    kind: str(a.device_class),
    area,
    actions: actionsOf(raw),
    at: Date.parse(raw.last_changed ?? "") || 0,
  };
  if (domain === "light" && raw.state === "on" && num(a.brightness) !== undefined) out.brightness = Math.round((num(a.brightness)! / 255) * 100);
  if (domain === "climate") {
    out.target = num(a.temperature);
    out.current = num(a.current_temperature);
    out.min = num(a.min_temp);
    out.max = num(a.max_temp);
    out.step = num(a.target_temp_step) ?? 0.5;
  }
  return out;
}

/**
 * The service a press calls: `{ domain, service, data }`, or null when the action is not one the entity
 * has or the number is out of its range. The entity goes as the target.
 */
export function serviceOf(raw: RawState, action: unknown, value?: unknown): { domain: string; service: string; data: Record<string, unknown> } | null {
  if (typeof action !== "string" || !actionsOf(raw).includes(action)) return null;
  const domain = raw.entity_id.split(".")[0]!;
  const call = (service: string, data: Record<string, unknown> = {}, on = domain) => ({ domain: on, service, data });
  switch (action) {
    case "toggle":
      // a player and a fan are switched with their own words; the rest know "toggle"
      return domain === "media_player" ? call(raw.state === "off" ? "turn_on" : "turn_off") : call("toggle");
    case "brightness": {
      const pct = typeof value === "number" ? Math.round(value) : NaN;
      if (!(pct >= 0 && pct <= 100)) return null;
      return pct === 0 ? call("turn_off") : call("turn_on", { brightness_pct: pct });
    }
    case "open":
      return call(domain === "valve" ? "open_valve" : "open_cover");
    case "close":
      return call(domain === "valve" ? "close_valve" : "close_cover");
    case "stop":
      return call(domain === "valve" ? "stop_valve" : "stop_cover");
    case "lock":
    case "unlock":
      return call(action);
    case "run":
      return call("turn_on");
    case "press":
      return call("press");
    case "playPause":
      return call("media_play_pause");
    case "start":
      return call("start");
    case "dock":
      return call("return_to_base");
    case "temperature": {
      const a = raw.attributes;
      const t = typeof value === "number" ? value : NaN;
      const min = num(a.min_temp) ?? -50;
      const max = num(a.max_temp) ?? 100;
      if (!(t >= min && t <= max)) return null;
      return call("set_temperature", { temperature: Math.round(t * 10) / 10 });
    }
  }
  return null;
}

/** An update Home Assistant offers: of itself, its system, an add-on, a device's firmware */
export interface Update {
  entity: string;
  name: string;
  title: string;
  installed: string;
  latest: string;
  summary: string;
  url: string;
  /** Home Assistant can install it (INSTALL 1) */
  install: boolean;
  /** …and make a backup first (BACKUP 8) */
  backup: boolean;
  running: boolean;
  /** Percent while it runs, when the update says */
  percent: number | null;
  at: number;
}

export function updatesOf(states: Iterable<RawState>): Update[] {
  const out: Update[] = [];
  for (const s of states) {
    if (!s.entity_id.startsWith("update.") || (s.state !== "on" && s.attributes.in_progress !== true)) continue;
    const a = s.attributes;
    out.push({
      entity: s.entity_id,
      name: str(a.friendly_name) || s.entity_id,
      title: str(a.title),
      installed: str(a.installed_version),
      latest: str(a.latest_version),
      summary: str(a.release_summary).slice(0, 500),
      url: /^https?:\/\//.test(str(a.release_url)) ? str(a.release_url) : "",
      install: feature(a, 1),
      backup: feature(a, 8),
      running: a.in_progress === true,
      percent: num(a.update_percentage) ?? null,
      at: Date.parse(s.last_changed ?? "") || 0,
    });
  }
  // Home Assistant itself first: core, then its system and supervisor, then the rest by name
  const rank = (u: Update) => (/^update\.home_assistant_core/.test(u.entity) ? 0 : /^update\.home_assistant_/.test(u.entity) ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Batteries that want changing: a percentage at or below `BATTERY_LOW`, or a battery sensor that says "low" */
export function lowBatteries(states: Iterable<RawState>): { entity: string; name: string; level: number | null }[] {
  const out: { entity: string; name: string; level: number | null }[] = [];
  for (const s of states) {
    if (s.attributes.device_class !== "battery") continue;
    const name = str(s.attributes.friendly_name) || s.entity_id;
    if (s.entity_id.startsWith("sensor.")) {
      const level = Number(s.state);
      if (s.state !== "" && Number.isFinite(level) && level <= BATTERY_LOW) out.push({ entity: s.entity_id, name, level: Math.round(level) });
    } else if (s.entity_id.startsWith("binary_sensor.") && s.state === "on") out.push({ entity: s.entity_id, name, level: null });
  }
  return out;
}

/** An entity's room: its own, else its device's */
export function areaOf(entity: { ai?: string | null; di?: string | null }, devices: Map<string, string | null>, areas: Map<string, string>): string {
  const id = entity.ai || (entity.di ? devices.get(entity.di) : null);
  return id ? (areas.get(id) ?? "") : "";
}

/** Who sees a server's tiles besides the administrators: everybody, or the users named */
export type People = "all" | string[];
export function cleanPeople(value: unknown): People {
  if (value === "all") return "all";
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)))].slice(0, 500);
}
export const sees = (people: People | undefined, user: { id: string; role: string }): boolean => user.role === "admin" || people === "all" || (Array.isArray(people) && people.includes(user.id));

/** What `trouble` needs to know of a server */
export interface Watched {
  id: string;
  name: string;
  error: { code: string; since: number } | null;
  /** Its states were read at least once since Hata started */
  ready: boolean;
  updates: Update[];
  low: { entity: string; name: string; level: number | null }[];
}

export function trouble(h: Watched, now = Date.now()): AttentionItem[] {
  const base = { host: h.id, name: h.name };
  if (h.error) {
    if (h.error.code === "ha.badToken") return [{ id: `ha:${h.id}`, severity: "danger", code: "ha.badToken", detail: base }];
    return now - h.error.since > AWAY_MS ? [{ id: `ha:${h.id}`, severity: "warn", code: "ha.away", detail: base }] : [];
  }
  if (!h.ready) return [];
  const items: AttentionItem[] = [];
  if (h.updates.length) {
    const first = h.updates[0]!;
    // a new version is news: the latest one decides when it "happened"
    items.push({ id: `ha:${h.id}:updates`, severity: "warn", code: "ha.updates", detail: { ...base, n: h.updates.length, update: first.title || first.name, version: first.latest }, at: Math.max(...h.updates.map((u) => u.at)) || undefined });
  }
  for (const b of h.low) items.push({ id: `ha:${h.id}:battery:${b.entity}`, severity: "warn", code: b.level === null ? "ha.batteryLow" : "ha.battery", detail: { ...base, device: b.name, level: b.level ?? "" } });
  return items.map((item) => (item.at === undefined ? (delete item.at, item) : item));
}
