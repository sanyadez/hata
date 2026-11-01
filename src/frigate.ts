/** What Frigate's API says, read without touching anything: pure and tested. The talking is in `frigates.ts`. */
import type { AttentionItem } from "./attention";

const AWAY_MS = 5 * 60_000;

export const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** An event's id: the time and a random piece */
export const EVENT_RE = /^[0-9]+\.[0-9]+-[a-z0-9]{1,16}$/;

export interface Camera {
  name: string;
  enabled: boolean;
  detect: boolean;
  /** Frames arriving; null — not known yet */
  fps: number | null;
  online: boolean;
}

export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  /** 0–100; null — none given */
  score: number | null;
  start: number;
  /** null — still going on */
  end: number | null;
  zones: string[];
  snapshot: boolean;
  clip: boolean;
}

type Raw = Record<string, unknown>;
const rec = (x: unknown): Raw => (x && typeof x === "object" && !Array.isArray(x) ? (x as Raw) : {});

/** The cameras of the config and what the stats say of them. A camera that is switched off is not one that fails. */
export function readCameras(config: unknown, stats: unknown): Camera[] {
  const cameras = rec(rec(config).cameras);
  const live = rec(rec(stats).cameras);
  return Object.entries(cameras).map(([name, raw]) => {
    const c = rec(raw);
    const enabled = c.enabled !== false;
    const seen = rec(live[name]);
    const fps = typeof seen.camera_fps === "number" ? seen.camera_fps : null;
    return { name, enabled, detect: rec(c.detect).enabled !== false, fps, online: enabled && fps !== null && fps > 0 };
  });
}

export function readEvent(raw: unknown): FrigateEvent {
  const e = rec(raw);
  const data = rec(e.data);
  const score = typeof data.top_score === "number" ? data.top_score : typeof data.score === "number" ? data.score : typeof e.top_score === "number" ? e.top_score : null;
  return {
    id: String(e.id ?? ""),
    camera: String(e.camera ?? ""),
    label: String(e.sub_label && typeof e.sub_label === "string" ? e.sub_label : (e.label ?? "")),
    score: score === null ? null : Math.round(score * 100),
    start: typeof e.start_time === "number" ? e.start_time * 1000 : 0,
    end: typeof e.end_time === "number" ? e.end_time * 1000 : null,
    zones: Array.isArray(e.zones) ? e.zones.map(String) : [],
    snapshot: e.has_snapshot === true,
    clip: e.has_clip === true,
  };
}

/** The session's cookie out of what the login answered */
export function tokenCookie(headers: string[]): string {
  for (const line of headers) {
    const pair = line.split(";")[0]!.trim();
    if (/^frigate_token=./.test(pair)) return pair;
  }
  return "";
}

/** The asked for filter of the events, only what is safe to pass on */
export function eventsQuery(input: { camera?: unknown; label?: unknown; before?: unknown; limit?: unknown }): string {
  const q = new URLSearchParams();
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 40));
  q.set("limit", String(limit));
  if (typeof input.camera === "string" && NAME_RE.test(input.camera)) q.set("cameras", input.camera);
  if (typeof input.label === "string" && NAME_RE.test(input.label)) q.set("labels", input.label);
  const before = Number(input.before);
  if (Number.isFinite(before) && before > 0) q.set("before", String(before));
  return q.toString();
}

export interface Watched {
  id: string;
  name: string;
  error: { code: string; since: number } | null;
  ready: boolean;
  cameras: Camera[];
}

export function trouble(f: Watched, now = Date.now()): AttentionItem[] {
  const base = { host: f.id, name: f.name };
  if (f.error) {
    if (f.error.code === "frigate.badLogin" || f.error.code === "frigate.certChanged") return [{ id: `frigate:${f.id}`, severity: "danger", code: f.error.code, detail: base }];
    return now - f.error.since > AWAY_MS ? [{ id: `frigate:${f.id}`, severity: "warn", code: "frigate.away", detail: base }] : [];
  }
  if (!f.ready) return [];
  return f.cameras.filter((c) => c.enabled && c.fps !== null && !c.online).map((c) => ({ id: `frigate:${f.id}:camera:${c.name}`, severity: "warn" as const, code: "frigate.camera", detail: { ...base, camera: c.name } }));
}
